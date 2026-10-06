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

    # Email (leave SMTP_HOST empty to only log deliveries)
    smtp_host: str = ""
    smtp_port: int = 1025
    mail_from: str = "innovatex@anwargroup.example"

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
