import os
import socket

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

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
    # PostgreSQL (Neon pooler): keep a small pool and recycle before the server drops idle connections.
    # prepare_threshold=None turns off server-side prepared statements, which a transaction pooler cannot keep.
    engine = create_engine(url, pool_size=settings.db_pool_size, max_overflow=5, pool_recycle=240, pool_pre_ping=True,
                           connect_args={"prepare_threshold": None, "connect_timeout": 15, **_ipv4_only(url)})

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
