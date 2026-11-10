-- InovaRegistry: Expo Exhibitors columns as their own fields, plus uploaded business cards.
-- The backend also adds these columns on start (app/core/migrate.py); this file is for running by hand.
ALTER TABLE registry_projects ADD COLUMN IF NOT EXISTS ai_tags JSON;
ALTER TABLE registry_projects ADD COLUMN IF NOT EXISTS tagline VARCHAR(300);
ALTER TABLE registry_projects ADD COLUMN IF NOT EXISTS services TEXT;
ALTER TABLE registry_projects ADD COLUMN IF NOT EXISTS projects_products TEXT;
-- Likes: one row per employee per record.
CREATE TABLE IF NOT EXISTS registry_likes (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP, updated_at TIMESTAMP, created_by VARCHAR(36), updated_by VARCHAR(36),
    CONSTRAINT uq_registry_like UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_registry_likes_project_id ON registry_likes (project_id);
CREATE INDEX IF NOT EXISTS ix_registry_likes_user_id ON registry_likes (user_id);
-- Uploaded cards reuse registry_business_cards (content_type is image/webp or image/jpeg); no change needed there.
