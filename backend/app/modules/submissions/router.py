"""Methodology, prototype and final submissions; the all-submissions browser; attachments."""
import hashlib
import json
import os

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event, record_history
from app.core.permissions import CurrentUser, get_current_user, get_entry_or_404, is_entry_member, require_roles
from app.modules.challenges import service as svc
from app.modules.challenges.models import Challenge, ChallengeEntry, EntrySubmission, SubmissionVersion, Team
from app.modules.initiatives.models import Attachment
from app.modules.masterdata.models import ChallengeDomain
from app.modules.masterdata.router import form_completeness, form_definition, validate_form
from app.shared.access import check_entity_access
from app.shared import cache
from app.shared.models.base import iso, row, utcnow, uuid7
from app.shared.util import en, setting, user_brief

router = APIRouter(tags=["submissions"])

KINDS = {
    "methodology": {"type": "METHODOLOGY", "phase": "METHODOLOGY", "label": "Methodology", "event": "METHODOLOGY_SUBMITTED",
                    "from": {"REGISTERED", "METHODOLOGY_SUBMITTED"}, "to": "METHODOLOGY_SUBMITTED"},
    "prototype": {"type": "PROTOTYPE", "phase": "PROTOTYPE", "label": "Prototype", "event": "PROTOTYPE_SUBMITTED",
                  "from": {"SHORTLISTED", "BUILDING", "PROTOTYPE_SUBMITTED"}, "to": "PROTOTYPE_SUBMITTED"},
    "final": {"type": "FINAL_PROJECT", "phase": "FINAL_SUBMISSION", "label": "Final project", "event": "FINAL_SUBMITTED",
              "from": {"SHORTLISTED", "BUILDING", "PROTOTYPE_SUBMITTED", "PROTOTYPE_REVIEWED", "FINALIST", "FINAL_SUBMITTED"},
              "to": "FINAL_SUBMITTED"},
}


def _kind(kind: str) -> dict:
    if kind not in KINDS:
        raise not_found("Page")
    return KINDS[kind]


def _last_version(db: Session, sub: EntrySubmission | None) -> SubmissionVersion | None:
    if not sub:
        return None
    return db.scalar(select(SubmissionVersion).where(SubmissionVersion.entry_submission_id == sub.id)
                     .order_by(SubmissionVersion.version_no.desc()))


def _state(db: Session, cu: CurrentUser, entry: ChallengeEntry, kind: str) -> dict:
    k = _kind(kind)
    ch = db.get(Challenge, entry.challenge_id)
    svc.sync_if_stale(db, ch)
    phase = svc.phase_of(db, ch.id, k["phase"])
    if not phase:
        raise not_found("Page")
    member = is_entry_member(db, entry, cu.id)
    sub = db.scalar(select(EntrySubmission).where(EntrySubmission.challenge_entry_id == entry.id,
                                                  EntrySubmission.submission_type == k["type"]))
    form = form_definition(db, phase.submission_form_template_id)
    last = _last_version(db, sub)
    now = utcnow()
    reason = None
    if not member:
        reason = "Read only. Only the entry's team can edit this."
    elif kind == "prototype" and not (entry.prototype_required or ch.prototype_policy in ("OPTIONAL", "REQUIRED_ALL")):
        reason = "No prototype needed for your entry."
    elif now < phase.opens_at:
        reason = f"The {k['label'].lower()} window opens on {svc._fmt(phase.opens_at)}."
    elif not svc.phase_is_open(phase, now):
        if last:
            reason = (f"The submission window closed. Your last submitted version (v{last.version_no}, "
                      f"{svc._fmt(last.submitted_at)}) will be reviewed.")
        else:
            reason = f"The {k['label'].lower()} window closed on {svc._fmt(phase.closes_at)}. Nothing was submitted."
    elif entry.status_code not in k["from"]:
        reason = "Your entry can't submit this at its current stage."
    leader_only = bool(setting(db, "team_submit_leader_only", False))
    content = (sub.content if sub else {}) or {}
    # Non-members (judges, privileged) only ever see the last submitted version.
    shown = content if member else (last.content if last else {})
    return {
        "kind": kind, "label": k["label"], "submission_id": sub.id if sub else None,
        "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code,
                  "challenge_title_i18n": ch.title_i18n, "challenge_slug": ch.slug},
        "form": form, "content": shown, "status": sub.status if sub else "NOT_STARTED",
        "version_no": sub.current_version_no if sub else 0, "submitted_at": iso(sub.submitted_at) if sub else None,
        "has_unsubmitted_changes": bool(member and last and content != last.content),
        "completeness_pct": form_completeness(form, shown) if form else 0,
        "window": {"opens_at": iso(phase.opens_at), "closes_at": iso(phase.closes_at), "is_open": svc.phase_is_open(phase, now)},
        "can_edit": reason is None, "can_submit": reason is None and (not leader_only or entry.lead_user_id == cu.id),
        "read_only_reason": reason, "_sub": sub, "_phase": phase, "_ch": ch,
    }


def _public(state: dict) -> dict:
    return {k: v for k, v in state.items() if not k.startswith("_")}


@router.get("/entries/{entry_id}/submissions/{kind}")
def get_submission_form(entry_id: str, kind: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id)
    state = _state(db, cu, entry, kind)
    db.commit()
    return _public(state)


class ContentIn(BaseModel):
    content: dict


def _save(db: Session, cu: CurrentUser, entry: ChallengeEntry, state: dict, content: dict) -> EntrySubmission:
    if not state["can_edit"]:
        code = "SUBMISSION_WINDOW_CLOSED" if not state["window"]["is_open"] else "ENTRY_NOT_ALLOWED_TO_SUBMIT"
        raise DomainError(code, state["read_only_reason"], 409)
    sub, phase, k = state["_sub"], state["_phase"], KINDS[state["kind"]]
    if not sub:
        sub = EntrySubmission(challenge_entry_id=entry.id, challenge_phase_id=phase.id, submission_type=k["type"],
                              status="DRAFT", current_version_no=0, form_template_id=phase.submission_form_template_id,
                              org_unit_id=entry.org_unit_id, created_by=cu.id)
        db.add(sub)
    sub.content, sub.updated_by = content, cu.id
    sub.completeness_pct = form_completeness(state["form"], content) if state["form"] else 0
    db.flush()
    return sub


@router.put("/entries/{entry_id}/submissions/{kind}")
def save_draft(entry_id: str, kind: str, body: ContentIn, cu: CurrentUser = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Autosave. The server clock decides whether the window is still open."""
    entry = get_entry_or_404(db, cu, entry_id, members_only=True)
    state = _state(db, cu, entry, kind)
    sub = _save(db, cu, entry, state, body.content)
    db.commit()
    return {"saved_at": iso(utcnow()), "completeness_pct": sub.completeness_pct, "status": sub.status}


@router.post("/entries/{entry_id}/submissions/{kind}/actions/submit")
def submit(entry_id: str, kind: str, body: ContentIn, request: Request, cu: CurrentUser = Depends(get_current_user),
           db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id, members_only=True)
    state = _state(db, cu, entry, kind)
    k = KINDS[kind]
    if state["can_edit"] and not state["can_submit"]:
        raise DomainError("LEADER_ONLY", "Only the team leader can submit for this challenge.")
    sub = _save(db, cu, entry, state, body.content)
    errors = validate_form(state["form"], body.content) if state["form"] else {}
    if errors:
        raise DomainError("FORM_INCOMPLETE", "Some required fields are missing.", 422, {"fields": errors})
    now = utcnow()
    sub.current_version_no = (sub.current_version_no or 0) + 1
    sub.status, sub.submitted_at, sub.submitted_by = "SUBMITTED", now, cu.id
    digest = hashlib.sha256(json.dumps(body.content, sort_keys=True, default=str).encode()).hexdigest()
    db.add(SubmissionVersion(entry_submission_id=sub.id, version_no=sub.current_version_no, content=body.content,
                             submitted_at=now, submitted_by=cu.id, content_hash=digest))
    if entry.status_code != k["to"]:
        record_history(db, "challenge_entry", entry.id, entry.status_code, k["to"], f"SUBMIT_{k['type']}", cu.id)
        entry.status_code = k["to"]
    audit(db, cu.id, "UPDATE", "entry_submission", sub.id, f"{k['label']} submitted for {entry.code} (v{sub.current_version_no})",
          {"content_hash": [None, digest]}, request.state.request_id)
    closes = state["window"]["closes_at"]
    publish_event(db, k["event"], "challenge_entry", entry.id, cu.id, users=svc.notify_entry(db, entry),
                  title=f"{k['label']} submitted: {entry.title}",
                  body=f"Version {sub.current_version_no} was submitted by {cu.user.full_name}. You can edit and resubmit until the deadline.",
                  link=f"/entries/{entry.id}", vars={"entry_code": entry.code, "version": sub.current_version_no},
                  data={"submission_id": sub.id})
    db.commit()
    return {"status": sub.status, "version_no": sub.current_version_no, "submitted_at": iso(now), "closes_at": closes}


@router.get("/entries/{entry_id}/submissions")
def entry_submissions(entry_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    entry = get_entry_or_404(db, cu, entry_id)
    return [row(s, exclude=("content", "extra", "created_by", "updated_by")) for s in db.scalars(
        select(EntrySubmission).where(EntrySubmission.challenge_entry_id == entry.id)).all()]


# ---- All-submissions browser (Super Admin, Program Owner, Executive, Judges) ---------------------------
BROWSERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE", "JUDGE")


@router.get("/submissions")
def browse(challenge_id: str = "", type: str = "", status: str = "", domain: str = "", q: str = "", page: int = 1,
           cu: CurrentUser = Depends(require_roles(*BROWSERS)), db: Session = Depends(get_db)):
    show_scores = cu.privileged or cu.has_role("EXECUTIVE")
    items = []
    stmt = select(EntrySubmission).where(EntrySubmission.status.in_(["SUBMITTED", "LOCKED"]))
    if type:
        stmt = stmt.where(EntrySubmission.submission_type == type)
    if status:
        stmt = stmt.where(EntrySubmission.status == status)
    challenges: dict[str, Challenge] = {}
    cache.preload(db, ChallengeEntry, Challenge, Team, ChallengeDomain)   # db.get() below is then free
    for sub in db.scalars(stmt.order_by(EntrySubmission.submitted_at.desc())).all():
        entry = db.get(ChallengeEntry, sub.challenge_entry_id)
        if not entry or (challenge_id and entry.challenge_id != challenge_id):
            continue
        ch = challenges.setdefault(entry.challenge_id, db.get(Challenge, entry.challenge_id))
        if domain and ch.domain_id != domain:
            continue
        blind = svc.blind_for(cu, ch)
        team = db.get(Team, entry.team_id) if entry.team_id else None
        entrant = "Hidden (blind review)" if blind else team.name if team else (user_brief(db, entry.lead_user_id) or {}).get("full_name")
        if q and q.lower() not in f"{entry.code} {entry.title} {'' if blind else entrant}".lower():
            continue
        dom = db.get(ChallengeDomain, ch.domain_id) if ch.domain_id else None
        items.append({
            "id": sub.id, "entry_id": entry.id, "code": entry.anonymous_alias if blind else entry.code, "title": entry.title,
            "entrant": entrant, "entry_type": entry.entry_type, "submission_type": sub.submission_type, "status": sub.status,
            "entry_status": entry.status_code, "version_no": sub.current_version_no, "submitted_at": iso(sub.submitted_at),
            "challenge": {"id": ch.id, "title_i18n": ch.title_i18n, "slug": ch.slug}, "domain": en(dom.name_i18n) if dom else None,
            "confidential": ch.data_classification_code in ("CONFIDENTIAL", "RESTRICTED"),
            "score": entry.current_score if show_scores else None,
        })
    start = (page - 1) * 50
    return {"items": items[start:start + 50], "total": len(items), "page": page, "can_export": True,
            "challenges": [{"id": c.id, "title": en(c.title_i18n)} for c in db.scalars(
                select(Challenge).where(Challenge.status_code != "DRAFT").order_by(Challenge.code)).all()]}


@router.get("/submissions/{submission_id}")
def view_submission(submission_id: str, request: Request, cu: CurrentUser = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    sub = db.get(EntrySubmission, submission_id)
    if not sub:
        raise not_found("Submission")
    entry = get_entry_or_404(db, cu, sub.challenge_entry_id)
    ch = db.get(Challenge, entry.challenge_id)
    member = is_entry_member(db, entry, cu.id)
    last = _last_version(db, sub)
    if not last and not member:
        raise not_found("Submission")
    blind = svc.blind_for(cu, ch) and not member
    confidential = ch.data_classification_code in ("CONFIDENTIAL", "RESTRICTED")
    if confidential and not member:
        audit(db, cu.id, "VIEW_CONFIDENTIAL", "entry_submission", sub.id, f"Viewed confidential submission {entry.code}", {},
              request.state.request_id)
        db.commit()
    team = db.get(Team, entry.team_id) if entry.team_id else None
    return {
        "id": sub.id, "submission_type": sub.submission_type, "status": sub.status,
        "version_no": last.version_no if last else 0, "submitted_at": iso(last.submitted_at) if last else None,
        "content_hash": last.content_hash if last else None,
        "form": form_definition(db, sub.form_template_id), "content": last.content if last else sub.content,
        "entry": {"id": entry.id, "code": entry.anonymous_alias if blind else entry.code, "title": entry.title,
                  "status_code": entry.status_code, "entry_type": entry.entry_type,
                  "team": None if blind else team.name if team else None,
                  "lead": None if blind else (user_brief(db, entry.lead_user_id) or {}).get("full_name")},
        "challenge": {"id": ch.id, "slug": ch.slug, "title_i18n": ch.title_i18n},
        "blind": blind, "confidential": confidential,
        "read_only_note": "Read only. You can score only entries assigned to you." if cu.has_role("JUDGE") and not member else None,
        "can_download": True,
        "attachment_entity": {"entity_type": "challenge_entry", "entity_id": entry.id},
    }


@router.get("/submissions/{submission_id}/versions")
def versions(submission_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.get(EntrySubmission, submission_id)
    if not sub:
        raise not_found("Submission")
    get_entry_or_404(db, cu, sub.challenge_entry_id)
    return [{"version_no": v.version_no, "submitted_at": iso(v.submitted_at), "content_hash": v.content_hash,
             "submitted_by": (user_brief(db, v.submitted_by) or {}).get("full_name")}
            for v in db.scalars(select(SubmissionVersion).where(SubmissionVersion.entry_submission_id == sub.id)
                                .order_by(SubmissionVersion.version_no.desc())).all()]


# ---- Attachments (stored on disk, never public; downloads need the auth header) --------------------------
ALLOWED_EXT = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".csv", ".txt",
               ".zip", ".mp4", ".md"}


def _attachment(a: Attachment, db: Session) -> dict:
    return {"id": a.id, "file_name": a.file_name, "mime_type": a.mime_type, "size_bytes": a.size_bytes,
            "scan_status": a.scan_status, "evidence_type_code": a.evidence_type_code, "created_at": iso(a.created_at),
            "uploaded_by": (user_brief(db, a.created_by) or {}).get("full_name"), "is_mine": False}


@router.get("/attachments")
def list_attachments(entity_type: str, entity_id: str, cu: CurrentUser = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    check_entity_access(db, cu, entity_type, entity_id)
    out = []
    for a in db.scalars(select(Attachment).where(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id,
                                                 Attachment.is_current.is_(True)).order_by(Attachment.created_at)).all():
        out.append({**_attachment(a, db), "is_mine": a.created_by == cu.id})
    return out


@router.post("/attachments")
async def upload_attachment(request: Request, file: UploadFile = File(...), entity_type: str = Form(...),
                            entity_id: str = Form(...), evidence_type_code: str = Form("DOCUMENT"),
                            cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    check_entity_access(db, cu, entity_type, entity_id, write=True)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise DomainError("FILE_TYPE_NOT_ALLOWED", f"Files of type {ext or 'unknown'} can't be uploaded.")
    data = await file.read()
    limit = int(setting(db, "max_upload_mb", settings.max_upload_mb))
    if len(data) > limit * 1024 * 1024:
        raise DomainError("FILE_TOO_LARGE", f"The file is larger than {limit} MB.")
    key = f"{entity_type}/{entity_id}/{uuid7()}{ext}"
    path = os.path.join(settings.upload_dir, key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(data)
    a = Attachment(entity_type=entity_type, entity_id=entity_id, file_name=os.path.basename(file.filename or "file"),
                   mime_type=file.content_type, size_bytes=len(data), storage_key=key,
                   checksum_sha256=hashlib.sha256(data).hexdigest(), evidence_type_code=evidence_type_code,
                   scan_status="CLEAN", created_by=cu.id)
    db.add(a)
    audit(db, cu.id, "CREATE", "attachment", a.id, f"Uploaded {a.file_name}", {}, request.state.request_id)
    db.commit()
    return {**_attachment(a, db), "is_mine": True}


@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    a = db.get(Attachment, attachment_id)
    if not a:
        raise not_found("File")
    check_entity_access(db, cu, a.entity_type, a.entity_id)
    path = os.path.join(settings.upload_dir, a.storage_key)
    if not os.path.exists(path):
        raise not_found("File")
    return FileResponse(path, filename=a.file_name, media_type=a.mime_type or "application/octet-stream")


@router.delete("/attachments/{attachment_id}")
def delete_attachment(attachment_id: str, request: Request, cu: CurrentUser = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    a = db.get(Attachment, attachment_id)
    if not a:
        raise not_found("File")
    check_entity_access(db, cu, a.entity_type, a.entity_id, write=True)
    a.is_current = False   # soft delete: nothing important is ever hard-deleted
    audit(db, cu.id, "DELETE", "attachment", a.id, f"Removed {a.file_name}", {}, request.state.request_id)
    db.commit()
    return {"ok": True}
