"""Prototype review and pilot review: the candidate's form, the judges' decisions and the admin's controls."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import not_found
from app.core.events import audit
from app.core.permissions import CurrentUser, get_current_user, get_entry_or_404, require_roles
from app.modules.evaluation import gates
from app.modules.evaluation.models import StageGate, StageGateVote
from app.shared.access import get_initiative_or_404
from app.shared.util import user_brief

router = APIRouter(tags=["prototype and pilot review"])
ADMIN = ("SUPER_ADMIN",)


def _subject(db: Session, cu: CurrentUser, entity_type: str, entity_id: str) -> gates.Subject:
    """The idea or entry, after the usual check that this person may see it (otherwise 404)."""
    if entity_type == "initiative":
        ini, _ = get_initiative_or_404(db, cu, entity_id)
        return gates.Subject(db, "initiative", ini.id)
    if entity_type == "challenge_entry":
        get_entry_or_404(db, cu, entity_id)
        return gates.Subject(db, "challenge_entry", entity_id)
    raise not_found("Page")


def _gate(db: Session, gate_id: str) -> tuple[StageGate, gates.Subject]:
    gate = db.get(StageGate, gate_id)
    if not gate:
        raise not_found("Review")
    return gate, gates.Subject(db, gate.entity_type, gate.entity_id)


class FormIn(BaseModel):
    content: dict = {}
    submit: bool = False


class JudgesIn(BaseModel):
    user_ids: list[str] = []


class VoteIn(BaseModel):
    decision: str
    feedback: str = ""


class DecideIn(BaseModel):
    decision: str
    note: str = ""


# ---- Candidate and staff: the review of one idea or entry ---------------------------------------
@router.get("/gates/{entity_type}/{entity_id}")
def gate_overview(entity_type: str, entity_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    subject = _subject(db, cu, entity_type, entity_id)
    out = gates.overview(db, cu, subject)
    if out["can_manage"]:
        for stage in out["stages"]:
            gate = stage["gate"]
            if gate:
                stage["judges"] = [{"user": user_brief(db, v.judge_user_id), "decision": v.decision}
                                   for v in gates.votes_of(db, db.get(StageGate, gate["id"]))]
    return out


@router.put("/gates/{entity_type}/{entity_id}/{stage}")
def save_form(entity_type: str, entity_id: str, stage: str, body: FormIn, request: Request,
              cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    subject = _subject(db, cu, entity_type, entity_id)
    gate = gates.save(db, cu, subject, stage.upper(), body.content, body.submit)
    if body.submit:
        audit(db, cu.id, "UPDATE", entity_type, subject.id, f"Sent {gates.STAGE_TITLE[gate.stage].lower()} (round {gate.round_no})", {},
              request.state.request_id)
    db.commit()
    return {"id": gate.id, "status": gate.status}


# ---- Admin: judges and the final call -----------------------------------------------------------
@router.post("/gates/{gate_id}/judges")
def add_judges(gate_id: str, body: JudgesIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
               db: Session = Depends(get_db)):
    gate, subject = _gate(db, gate_id)
    result = gates.add_judges(db, gate, subject, body.user_ids, cu.id)
    audit(db, cu.id, "CONFIG_CHANGE", gate.entity_type, gate.entity_id,
          f"Chose judges for the {gates.STAGE_TITLE[gate.stage].lower()}: {', '.join(result['added']) or 'no change'}", {},
          request.state.request_id)
    db.commit()
    return result


@router.delete("/gates/{gate_id}/judges/{user_id}")
def remove_judge(gate_id: str, user_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
                 db: Session = Depends(get_db)):
    gate, subject = _gate(db, gate_id)
    gates.remove_judge(db, gate, subject, user_id)
    audit(db, cu.id, "CONFIG_CHANGE", gate.entity_type, gate.entity_id,
          f"Removed a judge from the {gates.STAGE_TITLE[gate.stage].lower()}", {"judge": [user_id, None]}, request.state.request_id)
    db.commit()
    return {"ok": True}


@router.post("/gates/{gate_id}/decide")
def final_call(gate_id: str, body: DecideIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
               db: Session = Depends(get_db)):
    gate, _ = _gate(db, gate_id)
    gates.decide(db, cu, gate, body.decision, body.note)
    audit(db, cu.id, "OVERRIDE", gate.entity_type, gate.entity_id,
          f"Admin decision on the {gates.STAGE_TITLE[gate.stage].lower()}: {gate.status}", {"note": [None, body.note]},
          request.state.request_id)
    db.commit()
    return {"status": gate.status}


@router.get("/admin/gates")
def all_gates(cu: CurrentUser = Depends(require_roles("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")), db: Session = Depends(get_db)):
    """Every prototype and pilot review, newest first (latest round only)."""
    seen, rows = set(), []
    for gate in db.scalars(select(StageGate).where(StageGate.status != "DRAFT")
                           .order_by(StageGate.submitted_at.desc(), StageGate.round_no.desc())).all():
        key = (gate.entity_type, gate.entity_id, gate.stage)
        if key in seen:
            continue
        seen.add(key)
        try:
            subject = gates.Subject(db, gate.entity_type, gate.entity_id)
        except Exception:
            continue
        rows.append({"id": gate.id, "stage": gate.stage, "round_no": gate.round_no, "status": gate.status,
                     "submitted_at": gate.submitted_at.isoformat() + "Z" if gate.submitted_at else None,
                     "tally": gates.tally(gates.votes_of(db, gate)),
                     "entity": {"type": subject.entity_type, "id": subject.id, "code": subject.code, "title": subject.title,
                                "context": subject.context, "link": subject.link}})
    return {"items": rows, "total": len(rows), "can_manage": cu.has_role(*ADMIN)}


# ---- Judge: read it and decide ------------------------------------------------------------------
def _ballot(db: Session, cu: CurrentUser, vote_id: str) -> StageGateVote:
    ballot = db.get(StageGateVote, vote_id)
    if not ballot or (ballot.judge_user_id != cu.id and not cu.has_role(*ADMIN)):
        raise not_found("Review")
    return ballot


@router.get("/gate-votes/{vote_id}")
def read_review(vote_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    ballot = _ballot(db, cu, vote_id)
    gate, subject = _gate(db, ballot.gate_id)
    mine = ballot.judge_user_id == cu.id
    return {
        "id": ballot.id, "stage": gate.stage, "title": gates.STAGE_TITLE[gate.stage], "round_no": gate.round_no,
        "status": gate.status, "submitted_at": gate.submitted_at.isoformat() + "Z" if gate.submitted_at else None,
        "entity": {"type": subject.entity_type, "code": subject.code, "title": subject.title, "context": subject.context,
                   "summary": subject.summary},
        "fields": [{"key": k, "label": label, "kind": kind} for k, label, _, kind in gates.FIELDS[gate.stage]],
        "content": gate.content or {},
        "attachment_entity": {"entity_type": subject.entity_type, "entity_id": subject.id},
        "my_decision": ballot.decision, "my_feedback": ballot.feedback or "",
        "can_decide": mine and gate.status == "IN_REVIEW",
        "tally": gates.tally(gates.votes_of(db, gate)),
        # What the candidate was told in earlier rounds, so a returning judge sees what was asked for.
        "earlier_feedback": [{"round_no": g.round_no, "status": g.status,
                              "items": [v.feedback for v in gates.votes_of(db, g) if v.feedback]}
                             for g in gates.rounds(db, gate.entity_type, gate.entity_id, gate.stage) if g.round_no < gate.round_no],
    }


@router.post("/gate-votes/{vote_id}")
def give_decision(vote_id: str, body: VoteIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    ballot = db.get(StageGateVote, vote_id)
    if not ballot or ballot.judge_user_id != cu.id:
        raise not_found("Review")
    gate = gates.vote(db, cu, ballot, body.decision.upper(), body.feedback)
    audit(db, cu.id, "UPDATE", gate.entity_type, gate.entity_id,
          f"Judge decision on the {gates.STAGE_TITLE[gate.stage].lower()}: {ballot.decision}", {}, request.state.request_id)
    db.commit()
    return {"status": gate.status, "my_decision": ballot.decision}
