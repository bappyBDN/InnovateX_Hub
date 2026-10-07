import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.errors import install_error_handlers
from app.core.migrate import ensure_columns
from app.modules.admin.router import router as admin_router
from app.modules.analytics.router import router as analytics_router
from app.modules.challenges.router import router as challenges_router
from app.modules.delivery.router import router as delivery_router
from app.modules.evaluation.gates_router import router as gates_router
from app.modules.evaluation.judges_router import router as judges_router
from app.modules.evaluation.router import router as evaluation_router
from app.modules.identity.accounts import router as accounts_router
from app.modules.identity.models import User
from app.modules.identity.router import router as identity_router
from app.modules.identity.sbu import ensure_sbus
from app.modules.initiatives.router import router as initiatives_router
from app.modules.masterdata.router import router as masterdata_router
from app.modules.submissions.router import router as submissions_router
from app.modules.teams.router import router as teams_router
from app.shared.models.base import Base, utcnow
from app.workers import scheduler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("innovatex")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Tables are created from the models if they are missing (works for PostgreSQL and SQLite).
    Base.metadata.create_all(engine)
    ensure_columns(engine)
    db = SessionLocal()
    try:
        if settings.seed_on_start and not db.scalar(select(func.count()).select_from(User)):
            from app.seed import seed_database
            log.info("Empty database: loading demo data…")
            seed_database(db)
            log.info("Demo data loaded.")
        ensure_sbus(db)
    finally:
        db.close()
    # A serverless function (Vercel) is frozen between requests, so the background thread only runs in a real server.
    serverless = bool(os.environ.get("VERCEL"))
    if not serverless:
        scheduler.start()
    yield
    if not serverless:
        scheduler.stop()


app = FastAPI(title=f"{settings.app_name} API", version="1.0.0", lifespan=lifespan,
              docs_url=f"{settings.api_prefix}/docs", openapi_url=f"{settings.api_prefix}/openapi.json")

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Request-Id", "Date", "Content-Disposition"])
install_error_handlers(app)

for r in (identity_router, accounts_router, admin_router, masterdata_router, challenges_router, teams_router, submissions_router,
          evaluation_router, judges_router, gates_router, initiatives_router, delivery_router, analytics_router):
    app.include_router(r, prefix=settings.api_prefix)


@app.get("/health", tags=["platform"])
def health():
    return {"status": "ok", "app": settings.app_name, "environment": settings.environment,
            "time": utcnow().isoformat(timespec="seconds") + "Z"}
