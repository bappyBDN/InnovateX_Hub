-- ProjectFlow -> InnovateX Hub single sign-on: InnovateX Hub database only (PostgreSQL).
-- Nothing in the ProjectFlow database is created, changed or migrated.
--
-- The Hub already keeps its people in "users" (UUID ids, used by every other table), so the SSO fields are added
-- there instead of a second "hub_users" table that would have to be kept in step with it:
--   hub_users.projectflow_user_id     -> users.projectflow_user_id   (NULL for direct Hub sign-ups)
--   hub_users.email                   -> users.email                 (already unique)
--   hub_users.full_name               -> users.full_name
--   hub_users.role                    -> users.projectflow_role + user_role_assignments (the Hub's RBAC)
--   hub_users.is_projectflow_native   -> users.is_projectflow_native
--   hub_users.created_at / updated_at -> users.created_at / updated_at
--
-- The backend applies the same changes on start (app/core/migrate.py), so running this by hand is optional.
-- Safe to run more than once.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS projectflow_user_id   INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_projectflow_native BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS projectflow_role      VARCHAR;      -- ProjectFlow role at the last sign-on
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_roles             JSON;         -- Hub roles granted by sign-on

-- One Hub account per ProjectFlow person (NULLs, i.e. direct Hub sign-ups, are not limited).
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_projectflow_user_id ON users (projectflow_user_id);

-- Single-use sign-on tokens: a token id (jti) is refused the second time. Rows are cleared once expired.
CREATE TABLE IF NOT EXISTS sso_token_uses (
    id                  VARCHAR(36) PRIMARY KEY,
    jti                 VARCHAR     NOT NULL UNIQUE,
    projectflow_user_id INTEGER,
    expires_at          TIMESTAMP,
    created_at          TIMESTAMP,
    updated_at          TIMESTAMP,
    created_by          VARCHAR(36),
    updated_by          VARCHAR(36)
);
CREATE INDEX IF NOT EXISTS ix_sso_token_uses_expires_at ON sso_token_uses (expires_at);

COMMIT;
