import os
import socket
import time

from sqlalchemy import create_engine, event
from sqlalchemy.exc import DisconnectionError
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

try:
    from psycopg import pq
except ImportError:      # SQLite only
    pq = None

url = settings.sqlalchemy_url
is_sqlite = url.startswith("sqlite")


def _ipv4_only(db_url: str) -> dict:
    """Connect over IPv4. The database host also has IPv6 addresses, and a Docker network usually has no IPv6 route:
    those attempts fail with "Network is unreachable" and hide the real reason when IPv4 fails as well.
    The host name is kept (it is needed for TLS and for the pooler); only the addresses to dial are fixed."""
    host = make_url(db_url).host
    if not host or "," in host:
        return {}
    try:
        socket.inet_aton(host)      # already an IPv4 address
        return {}
    except OSError:
        pass
    try:
        found = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)
    except OSError:
        return {}
    ips = list(dict.fromkeys(info[4][0] for info in found))
    return {"host": ",".join([host] * len(ips)), "hostaddr": ",".join(ips)} if ips else {}

if is_sqlite:
    db_path = url.split("sqlite:///", 1)[-1]
    folder = os.path.dirname(db_path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()
else:
    # PostgreSQL (Neon pooler). The database is far away (about 60 ms per round trip), so every round trip that does
    # no work is removed:
    #   - Reads run without a transaction (autocommit): no BEGIN before the first query, no ROLLBACK at the end.
    #     Each statement sees the latest committed data, exactly as under the default READ COMMITTED level.
    #   - The first write (INSERT/UPDATE/DELETE, a lock or a savepoint) opens a real transaction, so everything up to
    #     the commit is still all-or-nothing; commit and rollback work as before.
    #   - A connection is only tested ("ping") when it has been idle for a while, not before every request.
    # prepare_threshold=None turns off server-side prepared statements, which a transaction pooler cannot keep.
    engine = create_engine(url, pool_size=settings.db_pool_size, max_overflow=10, pool_recycle=240, pool_pre_ping=False,
                           isolation_level="AUTOCOMMIT",
                           connect_args={"prepare_threshold": None, "connect_timeout": 15, **_ipv4_only(url)})

    _WRITES = ("INSERT", "UPDATE", "DELETE", "SAVEPOINT", "LOCK", "CREATE", "ALTER", "DROP", "TRUNCATE", "MERGE")
    _IDLE_PING_SECONDS = 30

    @event.listens_for(engine, "before_cursor_execute")
    def _begin_on_first_write(conn, cursor, statement, parameters, context, executemany):
        head = statement.lstrip()[:10].upper()
        if head.startswith(_WRITES) or (head.startswith(("SELECT", "WITH")) and "FOR UPDATE" in statement.upper()):
            raw = cursor.connection
            if raw.info.transaction_status == pq.TransactionStatus.IDLE:
                raw.execute("BEGIN")

    @event.listens_for(engine, "checkin")
    def _remember_checkin(dbapi_conn, record):
        record.info["checked_in"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _ping_if_idle(dbapi_conn, record, proxy):
        last = record.info.get("checked_in")
        if last is None or time.monotonic() - last < _IDLE_PING_SECONDS:
            return
        try:
            dbapi_conn.execute("SELECT 1")
        except Exception as exc:  # noqa: BLE001 — any failure means the connection is gone
            raise DisconnectionError() from exc

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
