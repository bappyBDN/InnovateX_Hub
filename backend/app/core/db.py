import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

url = settings.sqlalchemy_url
is_sqlite = url.startswith("sqlite")

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
                           connect_args={"prepare_threshold": None})

SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
