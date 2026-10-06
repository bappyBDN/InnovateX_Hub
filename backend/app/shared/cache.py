"""Per-request table cache.

The database is remote (one network round trip per query), so helpers that used to run one small query per row
now read whole small tables once per request and look rows up in memory.

- table(db, Model)            all rows, loaded once per session; afterwards db.get(Model, id) is free (identity map)
- by(db, Model, "column")     rows grouped by a column value
- one(db, Model, id)          a row by primary key from the cached table

The cache lives in session.info and is dropped whenever the session inserts or deletes rows, so it never serves
rows that are missing or gone. Updates need no invalidation: cached rows are the session's own ORM objects.
A few reference tables that change rarely (roles, permissions) are also kept process-wide for a short time.
"""
import time
from collections import defaultdict

from sqlalchemy import event, select
from sqlalchemy.orm import Session


def table(db: Session, model) -> list:
    tables = db.info.setdefault("tables", {})
    if model not in tables:
        tables[model] = list(db.scalars(select(model)).all())
    return tables[model]


def by(db: Session, model, column: str) -> dict:
    indexes = db.info.setdefault("indexes", {})
    key = (model, column)
    if key not in indexes:
        groups = defaultdict(list)
        for row in table(db, model):
            groups[getattr(row, column)].append(row)
        indexes[key] = groups
    return indexes[key]


def one(db: Session, model, pk):
    if not pk:
        return None
    rows = by(db, model, "id").get(pk)
    return rows[0] if rows else None


def preload(db: Session, *models) -> None:
    for m in models:
        table(db, m)


def drop(db: Session) -> None:
    db.info.pop("tables", None)
    db.info.pop("indexes", None)


@event.listens_for(Session, "after_flush")
def _invalidate(session, _flush_context):
    if session.new or session.deleted:
        drop(session)


# ---- process-wide cache for rarely-changing reference data ---------------------------------------
_shared: dict = {}


def shared(key: str, loader, ttl: int = 60):
    hit = _shared.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    value = loader()
    _shared[key] = (time.time(), value)
    return value


def forget(key: str | None = None) -> None:
    if key is None:
        _shared.clear()
    else:
        _shared.pop(key, None)
