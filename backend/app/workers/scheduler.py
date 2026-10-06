"""In-process background worker (one daemon thread).

Outbox dispatcher: sends notifications and retries failures.
Phase scheduler: opens/closes challenge phases on time and locks submissions at the deadline.
In production these move to Celery/ARQ workers; the functions they call stay the same.
"""
import logging
import threading
import time

from app.core.config import settings
from app.core.db import SessionLocal
from app.modules.challenges.service import sync_all_challenges
from app.modules.notifications.service import process_outbox, retry_failed_deliveries

log = logging.getLogger("worker")
_stop = threading.Event()


def run_once() -> None:
    db = SessionLocal()
    try:
        process_outbox(db)
    except Exception:
        db.rollback()
        log.exception("outbox dispatch failed")
    finally:
        db.close()


def _loop() -> None:
    tick = 0
    while not _stop.is_set():
        tick += 1
        run_once()
        if tick % 12 == 0:   # roughly every minute with the default 5 s poll
            db = SessionLocal()
            try:
                sync_all_challenges(db)
                retry_failed_deliveries(db)
            except Exception:
                db.rollback()
                log.exception("scheduler tick failed")
            finally:
                db.close()
        _stop.wait(settings.outbox_poll_seconds)


def start() -> None:
    threading.Thread(target=_loop, name="innovatex-worker", daemon=True).start()


def stop() -> None:
    _stop.set()
    time.sleep(0)
