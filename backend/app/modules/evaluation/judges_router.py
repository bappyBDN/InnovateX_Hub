"""Choosing judges. Only the admin (Super Admin; the DMD counts as one) can add, change or remove judges.

Judges are chosen for a challenge (all stages or only some) or for one idea. Anyone with an account can be chosen,
and people without an account can be invited by email.
"""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError
from app.core.events import audit
from app.core.permissions import CurrentUser, require_roles
from app.modules.challenges.router import get_challenge
from app.modules.evaluation import judging
from app.shared.access import get_initiative_or_404
from app.shared.util import en

router = APIRouter(tags=["judges"])
ADMIN = ("SUPER_ADMIN",)
VIEWERS = ("SUPER_ADMIN", "PROGRAM_OWNER", "EXECUTIVE")


class JudgesIn(BaseModel):
    user_ids: list[str] = []
    emails: list[str] | str = []        # people without an account get an invitation email
    stages: list[str] = []              # challenge only: empty = all stages
    due_days: int = 10                  # idea only
    message: str | None = None


class StagesIn(BaseModel):
    stages: list[str] = []


def _nothing_chosen(body: JudgesIn) -> bool:
    return not body.user_ids and not judging.split_emails(body.emails)


# ---- Challenge ----------------------------------------------------------------------------------
@router.get("/challenges/{challenge_id}/judges")
def list_challenge_judges(challenge_id: str, cu: CurrentUser = Depends(require_roles(*VIEWERS)), db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    return {**judging.challenge_judges(db, ch), "can_edit": cu.has_role(*ADMIN)}


@router.post("/challenges/{challenge_id}/judges")
def add_challenge_judges(challenge_id: str, body: JudgesIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
                         db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    if _nothing_chosen(body):
        raise DomainError("NO_ONE_CHOSEN", "Choose at least one person or type an email address.")
    mail = judging.invite_by_email(db, judging.split_emails(body.emails), "challenge", ch.id, en(ch.title_i18n), body.stages,
                                   body.due_days, body.message, cu.user)
    result = judging.add_challenge_judges(db, ch, [*body.user_ids, *mail["existing_user_ids"]], body.stages, cu.id)
    audit(db, cu.id, "CONFIG_CHANGE", "challenge", ch.id,
          f"Chose judges for {ch.code}: {', '.join(result['added'] + [i['email'] + ' (invited)' for i in mail['invited']]) or 'no change'}"
          f" — {judging.stage_text(judging.clean_stages(body.stages))}", {}, request.state.request_id)
    db.commit()
    return {**result, "invited": mail["invited"], "invalid_emails": mail["invalid"]}


@router.patch("/challenges/{challenge_id}/judges/{user_id}")
def change_judge_stages(challenge_id: str, user_id: str, body: StagesIn, request: Request,
                        cu: CurrentUser = Depends(require_roles(*ADMIN)), db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    judging.set_stages(db, ch, user_id, body.stages, cu.id)
    audit(db, cu.id, "CONFIG_CHANGE", "challenge", ch.id,
          f"Changed what a judge may score in {ch.code}: {judging.stage_text(judging.clean_stages(body.stages))}",
          {"judge": [None, user_id]}, request.state.request_id)
    db.commit()
    return {"ok": True}


@router.delete("/challenges/{challenge_id}/judges/{user_id}")
def remove_challenge_judge(challenge_id: str, user_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
                           db: Session = Depends(get_db)):
    ch = get_challenge(db, challenge_id)
    result = judging.remove_challenge_judge(db, ch, user_id, cu.id)
    audit(db, cu.id, "CONFIG_CHANGE", "challenge", ch.id, f"Removed a judge from {ch.code}", {"judge": [user_id, None]},
          request.state.request_id)
    db.commit()
    return result


@router.post("/challenges/{challenge_id}/judges/actions/share-out")
def share_out(challenge_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)), db: Session = Depends(get_db)):
    """Give every entry that is waiting for scores to the chosen judges."""
    ch = get_challenge(db, challenge_id)
    result = judging.share_out(db, ch, cu.id)
    audit(db, cu.id, "UPDATE", "challenge", ch.id, f"Shared entries among judges ({result['created']} new)", {},
          request.state.request_id)
    db.commit()
    return result


# ---- Idea ---------------------------------------------------------------------------------------
@router.get("/initiatives/{key}/judges")
def list_idea_judges(key: str, cu: CurrentUser = Depends(require_roles(*VIEWERS)), db: Session = Depends(get_db)):
    ini, _ = get_initiative_or_404(db, cu, key)
    return {**judging.idea_judges(db, ini), "can_edit": cu.has_role(*ADMIN)}


@router.post("/initiatives/{key}/judges")
def add_idea_judges(key: str, body: JudgesIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
                    db: Session = Depends(get_db)):
    ini, _ = get_initiative_or_404(db, cu, key)
    if _nothing_chosen(body):
        raise DomainError("NO_ONE_CHOSEN", "Choose at least one person or type an email address.")
    mail = judging.invite_by_email(db, judging.split_emails(body.emails), "initiative", ini.id, f"the idea {ini.code}", [],
                                   body.due_days, body.message, cu.user)
    result = judging.add_idea_judges(db, ini, [*body.user_ids, *mail["existing_user_ids"]], body.due_days, cu.id)
    audit(db, cu.id, "UPDATE", "initiative", ini.id,
          f"Chose {result['created']} judge(s) for {ini.code}" + (f", invited {len(mail['invited'])}" if mail["invited"] else ""),
          {}, request.state.request_id)
    db.commit()
    return {**result, "invited": mail["invited"], "invalid_emails": mail["invalid"]}


@router.delete("/initiatives/{key}/judges/{user_id}")
def remove_idea_judge(key: str, user_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)),
                      db: Session = Depends(get_db)):
    ini, _ = get_initiative_or_404(db, cu, key)
    result = judging.remove_idea_judge(db, ini, user_id)
    audit(db, cu.id, "UPDATE", "initiative", ini.id, f"Removed a judge from {ini.code}", {"judge": [user_id, None]},
          request.state.request_id)
    db.commit()
    return result


# ---- Email invitations --------------------------------------------------------------------------
@router.delete("/judge-invites/{invite_id}")
def cancel_invite(invite_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*ADMIN)), db: Session = Depends(get_db)):
    judging.revoke_invite(db, invite_id)
    audit(db, cu.id, "CONFIG_CHANGE", "judge_invite", invite_id, "Cancelled a judge invitation", {}, request.state.request_id)
    db.commit()
    return {"ok": True}
