"""Columns added after the first release. Tables are created from the models (no Alembic yet), and create_all
never changes an existing table, so the few added columns are listed here and added at start if they are missing."""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

ADDED_COLUMNS = (
    ("panel_members", "stages", "JSON"),
    ("users", "department", "VARCHAR(150)"),
)


def ensure_columns(engine: Engine) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if table in tables and column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
