"""All runtime configuration comes from environment variables (see .env.example)."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parents[2]
# One .env in the project root is shared by backend, frontend and Docker.
# backend/.env.local (optional) overrides it when you run the API without Docker.
_ENV_FILES = (_BACKEND_DIR.parent / ".env", _BACKEND_DIR / ".env.local")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore")

    app_name: str = "InnovateX Hub"
    environment: str = "development"

    # Server
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    api_prefix: str = "/api/v1"

    # URLs
    frontend_url: str = "http://localhost:5173"   # used in email links and team join links
    cors_origins: str = "http://localhost:5173"   # comma separated

    # Database: PostgreSQL (e.g. Neon). A plain "postgresql://..." URL is accepted. SQLite also works for local use.
    database_url: str = "sqlite:///./data/innovatex.db"
    db_pool_size: int = 5

    # Auth
    jwt_secret: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    # Files
    upload_dir: str = "./data/uploads"
    max_upload_mb: int = 25

    # Demo data
    signup_enabled: bool = True
    invitation_expiry_days: int = 7
    demo_mode: bool = True
    demo_password: str = "Password@123"
    seed_on_start: bool = True
    # With SEED_ON_START=false an empty database gets only reference data and this one Super Admin
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = "System Admin"

    # Single sign-on from ProjectFlow: the same secret must be set in ProjectFlow (at least 32 characters; empty = off)
    shared_sso_secret: str = ""
    projectflow_url: str = ""                      # where "Back to ProjectFlow" goes from the sign-on page
    # ProjectFlow roles (comma separated, any case) that get full access here
    # In ProjectFlow the DMD has the role "group_executive" ("dmd" is accepted too)
    sso_dmd_roles: str = "group_executive,dmd"                  # -> DMD (every feature, same as Super Admin)
    sso_admin_roles: str = "admin,coo,managing_director,director,md"   # -> Super Admin

    # InovaRegistry: web scrapers send this in the X-Scraper-Key header to POST /scraper/ingest (empty = turned off)
    scraper_api_key: str = ""

    # Project rewards: projects are read (never written) from the ProjectFlow database
    # ProjectFlow is read through its read-only Data API when these two are set (preferred: it can't change anything).
    projectflow_api_url: str = ""
    projectflow_api_key: str = ""
    projectflow_database_url: str = ""              # fallback: direct database read, used only when the API is not set
    projectflow_department: str = "Digital Transformation"   # project and its manager must be in this department
    projectflow_function_pattern: str = "AI anal%"           # and in a function like this (AI Analyst, AI analytics, AI analysis)
    # Process Brain (Anwar Group process registry): the AI and AES team projects with their linked processes,
    # sub-processes and RACI. URL is the API base, e.g. https://host/api/process-brain; the projects come from the
    # same host's /api/live feed.
    process_brain_url: str = ""
    process_brain_api_key: str = ""
    data_api_key: str = ""          # machine access to /projects endpoints: send it in the X-API-Key header

    # Email (leave SMTP_HOST empty to only log deliveries)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""            # the mailbox that signs in; empty = no sign-in (Mailpit)
    smtp_password: str = ""
    smtp_security: str = "auto"    # auto, starttls, ssl or none. auto: SSL on port 465, otherwise STARTTLS when offered
    mail_from: str = "aopl.growthanalytics5@anwargroup.net"
    mail_from_name: str = "InnovateX Hub"

    # Background worker
    outbox_poll_seconds: int = 5
    display_timezone: str = "Asia/Dhaka"

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url.strip()
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
