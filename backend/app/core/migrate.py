"""Columns added after the first release. Tables are created from the models (no Alembic yet), and create_all
never changes an existing table, so the few added columns are listed here and added at start if they are missing."""
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

ADDED_COLUMNS = (
    ("panel_members", "stages", "JSON"),
    ("registry_projects", "contact_phone", "VARCHAR"),
    ("registry_projects", "contact_address", "TEXT"),
    ("users", "pending_manager_email", "VARCHAR"),
    ("users", "function_name", "VARCHAR"),
    ("users", "department_name", "VARCHAR"),
    ("registry_projects", "ai_unique_point", "TEXT"),
    ("registry_projects", "ai_work", "TEXT"),
    ("registry_projects", "ai_category", "VARCHAR"),
    ("registry_projects", "ai_intensity", "VARCHAR"),
    ("projects", "details", "JSON"),
    ("projects", "tasks", "JSON"),
    ("project_challenges", "deadline_source", "VARCHAR"),
    # Process Brain: AI / AES team, linked processes with RACI, delivery phases, chosen reward recipients
    ("projects", "team", "VARCHAR"),
    ("projects", "pb_id", "VARCHAR"),
    ("projects", "processes", "JSON"),
    ("projects", "phases", "JSON"),
    ("project_challenges", "recipients", "JSON"),
    # ProjectFlow single sign-on (see backend/migrations/2026-11-09_projectflow_sso.sql)
    ("users", "projectflow_user_id", "INTEGER"),
    ("users", "is_projectflow_native", "BOOLEAN DEFAULT FALSE"),
    ("users", "projectflow_role", "VARCHAR"),
    ("users", "sso_roles", "JSON"),
    # InovaRegistry: the Expo Exhibitors columns as their own fields
    ("registry_projects", "ai_tags", "JSON"),
    ("registry_projects", "tagline", "VARCHAR"),
    ("registry_projects", "services", "TEXT"),
    ("registry_projects", "projects_products", "TEXT"),
)

ADDED_INDEXES = (
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_users_projectflow_user_id ON users (projectflow_user_id)",
)


def ensure_columns(engine: Engine) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in ADDED_COLUMNS:
            if table in tables and column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
        for ddl in ADDED_INDEXES:
            conn.execute(text(ddl))
