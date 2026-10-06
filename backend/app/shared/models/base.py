"""Base model, standard columns and small helpers shared by every module."""
import os
import time
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text, event
from sqlalchemy.orm import DeclarativeBase, mapped_column


def utcnow() -> datetime:
    """All times are stored in UTC (naive, because SQLite has no timezone type)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def uuid7() -> str:
    """Time-ordered UUID (v7) so ids sort by creation time."""
    ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (
        ((ms & ((1 << 48) - 1)) << 80)
        | (0x7 << 76)
        | (((rand >> 68) & 0xFFF) << 64)
        | (0b10 << 62)
        | (rand & ((1 << 62) - 1))
    )
    return str(uuid.UUID(int=value))


class Base(DeclarativeBase):
    pass


@event.listens_for(Base, "init", propagate=True)
def _assign_id(target, args, kwargs):
    """Give every new row its id at construction time, so it can be referenced before the first flush."""
    if "id" not in kwargs:
        kwargs["id"] = uuid7()


class StdColumns:
    id = mapped_column(String(36), primary_key=True, default=uuid7)
    created_at = mapped_column(DateTime, default=utcnow)
    updated_at = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    created_by = mapped_column(String(36), nullable=True)
    updated_by = mapped_column(String(36), nullable=True)


class BusinessColumns(StdColumns):
    org_unit_id = mapped_column(String(36), index=True, nullable=True)
    row_version = mapped_column(Integer, default=1)
    deleted_at = mapped_column(DateTime, nullable=True)
    extra = mapped_column(JSON, default=dict)


# Short column helpers keep the model files readable.
def ref(nullable: bool = True, index: bool = True):
    return mapped_column(String(36), nullable=nullable, index=index)


def sc(n: int = 40, **kw):
    """Short text. No length limit in the database (PostgreSQL rejects over-long input); n is only a hint."""
    return mapped_column(String, **kw)


def text():
    return mapped_column(Text, nullable=True)


def i18n():
    return mapped_column(JSON, default=dict)


def json_col(default=dict):
    return mapped_column(JSON, default=default)


def flag(default: bool = False):
    return mapped_column(Boolean, default=default)


def num():
    return mapped_column(Float, nullable=True)


def integer(default=None):
    return mapped_column(Integer, default=default, nullable=True)


def ts():
    return mapped_column(DateTime, nullable=True)


def iso(v):
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds") + "Z"
    if isinstance(v, date):
        return v.isoformat()
    return v


def row(obj, exclude: tuple = (), only: tuple | None = None) -> dict | None:
    """Turn a model instance into a JSON-friendly dict."""
    if obj is None:
        return None
    out = {}
    for c in obj.__table__.columns:
        if c.name in exclude or (only and c.name not in only):
            continue
        out[c.name] = iso(getattr(obj, c.name))
    return out
