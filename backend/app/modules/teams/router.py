"""Teams, join links and join requests (data-model doc §4.7)."""
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit, publish_event
from app.core.permissions import CurrentUser, get_current_user, get_team_or_404
from app.core.security import sha256
from app.modules.challenges import service as svc
from app.modules.challenges.models import Challenge, ChallengeEntry, Team, TeamInviteLink, TeamJoinRequest, TeamMember
from app.shared.models.base import iso, utcnow
from app.shared.util import en, setting, user_brief

router = APIRouter(tags=["teams"])


def active_members(db: Session, team_id: str) -> list[TeamMember]:
    return list(db.scalars(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.status == "ACTIVE")
                           .order_by(TeamMember.joined_at)).all())


def split_equally(members: list[TeamMember]) -> None:
    """Default credit split: equal shares that always total 100 (the leader takes the rounding remainder)."""
    if not members:
        return
    share = round(100 / len(members), 2)
    for m in members:
        m.credit_share_pct = share
    lead = next((m for m in members if m.member_role == "LEAD"), members[0])
    lead.credit_share_pct = round(100 - share * (len(members) - 1), 2)


def _expire_links(db: Session, team: Team, ch: Challenge | None) -> None:
    now = utcnow()
    registration = svc.phase_of(db, ch.id, "REGISTRATION") if ch else None
    closed = registration is not None and not svc.phase_is_open(registration, now)
    for link in db.scalars(select(TeamInviteLink).where(TeamInviteLink.team_id == team.id,
                                                        TeamInviteLink.status == "ACTIVE")).all():
        if closed or (link.expires_at and link.expires_at < now):
            link.status = "EXPIRED"
        elif link.max_uses and (link.use_count or 0) >= link.max_uses:
            link.status = "EXHAUSTED"


def _link(link: TeamInviteLink) -> dict:
    return {"id": link.id, "masked": f"{settings.frontend_url}/join/{link.token_hint or ''}••••••••",
            "expires_at": iso(link.expires_at), "max_uses": link.max_uses, "use_count": link.use_count or 0,
            "status": link.status, "created_at": iso(link.created_at)}


@router.get("/teams/{team_id}")
def team_detail(team_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id)
    ch = db.get(Challenge, team.challenge_id) if team.challenge_id else None
    if ch:
        svc.sync_if_stale(db, ch)
    _expire_links(db, team, ch)
    db.commit()
    members = active_members(db, team.id)
    is_leader = team.lead_user_id == cu.id
    entry = db.scalar(select(ChallengeEntry).where(ChallengeEntry.team_id == team.id))
    registration = svc.phase_of(db, ch.id, "REGISTRATION") if ch else None
    max_size = ch.team_max_size if ch else 5
    out = {
        "id": team.id, "name": team.name, "description": team.description, "is_locked": team.is_locked,
        "challenge": {"id": ch.id, "slug": ch.slug, "title_i18n": ch.title_i18n} if ch else None,
        "entry": {"id": entry.id, "code": entry.code, "title": entry.title, "status_code": entry.status_code} if entry else None,
        "max_size": max_size, "min_size": ch.team_min_size if ch else 1, "member_count": len(members),
        "is_full": len(members) >= max_size, "is_leader": is_leader,
        "is_member": any(m.user_id == cu.id for m in members),
        "registration_closes_at": iso(registration.closes_at) if registration else None,
        "members": [{**(user_brief(db, m.user_id) or {}), "user_id": m.user_id, "member_role": m.member_role,
                     "credit_share_pct": m.credit_share_pct, "joined_at": iso(m.joined_at),
                     "skills_contributed": m.skills_contributed} for m in members],
        "credit_total": round(sum(m.credit_share_pct or 0 for m in members), 2),
    }
    if is_leader:  # management tools are for the leader only
        out["invite_links"] = [_link(l) for l in db.scalars(select(TeamInviteLink).where(
            TeamInviteLink.team_id == team.id).order_by(TeamInviteLink.created_at.desc()).limit(10)).all()]
        out["pending_requests"] = db.scalar(select(func.count()).select_from(TeamJoinRequest).where(
            TeamJoinRequest.team_id == team.id, TeamJoinRequest.status == "PENDING")) or 0
        out["default_link_days"] = setting(db, "default_join_link_days", 7)
    return out


class SharesIn(BaseModel):
    shares: dict[str, float]


@router.put("/teams/{team_id}/credit-shares")
def set_credit_shares(team_id: str, body: SharesIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id, leader_only=True)
    members = active_members(db, team.id)
    if set(body.shares) != {m.user_id for m in members}:
        raise DomainError("SHARES_INCOMPLETE", "Set a share for every team member.")
    total = round(sum(body.shares.values()), 2)
    if total != 100 or any(v < 0 for v in body.shares.values()):
        raise DomainError("SHARES_NOT_100", f"Credit shares must total 100%. They total {total}%.")
    before = {m.user_id: m.credit_share_pct for m in members}
    for m in members:
        m.credit_share_pct = body.shares[m.user_id]
    audit(db, cu.id, "UPDATE", "team", team.id, f"Changed credit shares for {team.name}",
          {"shares": [before, body.shares]}, request.state.request_id)
    publish_event(db, "TEAM_CREDIT_CHANGED", "team", team.id, cu.id,
                  users=[m.user_id for m in members if m.user_id != cu.id],
                  title=f"Credit shares changed in {team.name}", body="Open the team page to see your share.",
                  link=f"/teams/{team.id}")
    db.commit()
    return {"ok": True}


def _guard_unlocked(team: Team):
    if team.is_locked:
        raise DomainError("TEAM_LOCKED", "Team is locked. Member changes are closed.")


@router.post("/teams/{team_id}/members/{user_id}/actions/{action}")
def member_action(team_id: str, user_id: str, action: str, request: Request,
                  cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id, leader_only=True)
    member = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user_id,
                                                TeamMember.status == "ACTIVE"))
    if not member or user_id == cu.id:
        raise not_found("Team member")
    name = (user_brief(db, user_id) or {}).get("full_name")
    if action == "remove":
        _guard_unlocked(team)
        member.status, member.left_at = "REMOVED", utcnow()   # access is removed immediately
        db.flush()
        split_equally(active_members(db, team.id))
        audit(db, cu.id, "UPDATE", "team", team.id, f"Removed {name} from {team.name}", {}, request.state.request_id)
        publish_event(db, "TEAM_MEMBER_LEFT", "team", team.id, cu.id, users=[user_id],
                      title=f"You were removed from {team.name}", body="You no longer have access to the team's work.",
                      link="/entries")
    elif action == "make-leader":
        me = db.scalar(select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == cu.id,
                                                TeamMember.status == "ACTIVE"))
        me.member_role, member.member_role, team.lead_user_id = "MEMBER", "LEAD", user_id
        entry = db.scalar(select(ChallengeEntry).where(ChallengeEntry.team_id == team.id))
        if entry:
            entry.lead_user_id = user_id
        audit(db, cu.id, "UPDATE", "team", team.id, f"Made {name} the leader of {team.name}", {}, request.state.request_id)
        publish_event(db, "TEAM_LEADER_CHANGED", "team", team.id, cu.id, users=[user_id],
                      title=f"You are now the leader of {team.name}", body="You can manage members and join links.",
                      link=f"/teams/{team.id}")
    else:
        raise not_found("Action")
    db.commit()
    return {"ok": True}


@router.post("/teams/{team_id}/actions/leave")
def leave_team(team_id: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    team = db.get(Team, team_id)
    member = db.scalar(select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == cu.id,
                                                TeamMember.status == "ACTIVE")) if team else None
    if not member:
        raise not_found("Team")
    if team.lead_user_id == cu.id:
        raise DomainError("LEADER_CANNOT_LEAVE", "Transfer leadership to another member before you leave the team.")
    _guard_unlocked(team)
    member.status, member.left_at = "LEFT", utcnow()
    db.flush()
    split_equally(active_members(db, team.id))
    audit(db, cu.id, "UPDATE", "team", team.id, f"Left {team.name}", {}, request.state.request_id)
    publish_event(db, "TEAM_MEMBER_LEFT", "team", team.id, cu.id, users=[team.lead_user_id],
                  title=f"{cu.user.full_name} left {team.name}", body="Credit shares were split equally again.",
                  link=f"/teams/{team.id}")
    db.commit()
    return {"ok": True}


# ---- Join links ----------------------------------------------------------------------------
class LinkIn(BaseModel):
    expires_at: datetime | None = None
    expires_in_days: int | None = None
    max_uses: int | None = None


@router.post("/teams/{team_id}/invite-links")
def create_link(team_id: str, body: LinkIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id, leader_only=True)
    _guard_unlocked(team)
    ch = db.get(Challenge, team.challenge_id) if team.challenge_id else None
    registration = svc.phase_of(db, ch.id, "REGISTRATION") if ch else None
    now = utcnow()
    if registration and not svc.phase_is_open(registration, now):
        raise DomainError("REGISTRATION_CLOSED", "Registration has closed, so join links can't be created.")
    if len(active_members(db, team.id)) >= (ch.team_max_size if ch else 5):
        raise DomainError("TEAM_FULL", "Team is full. Links are paused.")
    days = body.expires_in_days or setting(db, "default_join_link_days", 7)
    expires = svc.as_naive(body.expires_at) if body.expires_at else now + timedelta(days=days)
    if registration and expires > registration.closes_at:
        expires = registration.closes_at          # never after registration closes
    if expires <= now:
        raise DomainError("EXPIRY_IN_PAST", "Choose an expiry time in the future.")
    token = secrets.token_urlsafe(24)
    link = TeamInviteLink(team_id=team.id, token_hash=sha256(token), token_hint=token[:4], expires_at=expires,
                          max_uses=body.max_uses or None, use_count=0, status="ACTIVE", created_by=cu.id)
    db.add(link)
    audit(db, cu.id, "CREATE", "team_invite_link", link.id, f"Created a join link for {team.name}", {}, request.state.request_id)
    publish_event(db, "TEAM_INVITE_LINK_CREATED", "team", team.id, cu.id)
    db.commit()
    # The full link is returned only now; afterwards it is shown masked.
    return {**_link(link), "url": f"{settings.frontend_url}/join/{token}", "token": token}


@router.get("/teams/{team_id}/invite-links")
def list_links(team_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id, leader_only=True)
    _expire_links(db, team, db.get(Challenge, team.challenge_id) if team.challenge_id else None)
    db.commit()
    return [_link(l) for l in db.scalars(select(TeamInviteLink).where(TeamInviteLink.team_id == team.id)
                                         .order_by(TeamInviteLink.created_at.desc())).all()]


@router.post("/invite-links/{link_id}/actions/revoke")
def revoke_link(link_id: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    link = db.get(TeamInviteLink, link_id)
    if not link:
        raise not_found("Link")
    team = get_team_or_404(db, cu, link.team_id, leader_only=True)
    link.status, link.revoked_at, link.revoked_by = "REVOKED", utcnow(), cu.id   # stops working immediately
    audit(db, cu.id, "UPDATE", "team_invite_link", link.id, f"Revoked a join link for {team.name}", {}, request.state.request_id)
    publish_event(db, "TEAM_INVITE_LINK_REVOKED", "team", team.id, cu.id)
    db.commit()
    return _link(link)


def _join_state(db: Session, token: str, cu: CurrentUser) -> dict:
    """Everything the join page may show: team name, challenge, leader and size — nothing else."""
    link = db.scalar(select(TeamInviteLink).where(TeamInviteLink.token_hash == sha256(token)))
    dead = {"state": "LINK_INVALID", "message": "This join link no longer works. Ask the team leader for a new one."}
    if not link:
        return dead
    team = db.get(Team, link.team_id)
    ch = db.get(Challenge, team.challenge_id) if team.challenge_id else None
    if ch:
        svc.sync_if_stale(db, ch)
    _expire_links(db, team, ch)
    members = active_members(db, team.id)
    max_size = ch.team_max_size if ch else 5
    card = {"team_id": None, "team_name": team.name, "leader_name": (user_brief(db, team.lead_user_id) or {}).get("full_name"),
            "challenge": {"slug": ch.slug, "title_i18n": ch.title_i18n} if ch else None,
            "size": {"current": len(members), "max": max_size}, "my_request": None, "link_id": link.id}
    mine = db.scalar(select(TeamJoinRequest).where(TeamJoinRequest.team_id == team.id, TeamJoinRequest.user_id == cu.id)
                     .order_by(TeamJoinRequest.created_at.desc()))
    if mine:
        card["my_request"] = {"id": mine.id, "status": mine.status, "created_at": iso(mine.created_at),
                              "decline_reason": mine.decline_reason}
    if any(m.user_id == cu.id for m in members):
        return {**card, "state": "ALREADY_MEMBER", "team_id": team.id, "message": f"You're already in {team.name}."}
    if mine and mine.status == "PENDING":
        return {**card, "state": "REQUEST_PENDING",
                "message": f"Join request sent. We'll notify you when {card['leader_name']} responds."}
    registration = svc.phase_of(db, ch.id, "REGISTRATION") if ch else None
    if registration and not svc.phase_is_open(registration):
        return {**card, "state": "REGISTRATION_CLOSED",
                "message": f"Registration for this challenge closed on {svc._fmt(registration.closes_at)}."}
    if link.status != "ACTIVE":
        return {**card, **dead}
    if len(members) >= max_size:
        return {**card, "state": "TEAM_FULL", "message": "This team is full."}
    if ch:
        other = svc.my_entry_in(db, ch.id, cu.id)
        if other:
            other_team = db.get(Team, other.team_id) if other.team_id else None
            where = other_team.name if other_team else "this challenge as an individual"
            return {**card, "state": "ALREADY_IN_CHALLENGE", "my_entry_id": other.id,
                    "team_id": other_team.id if other_team else None,
                    "message": f"You're already in {where} for this challenge."}
        elig = svc.eligibility(db, ch, cu)
        if not elig["eligible"]:
            return {**card, "state": "NOT_ELIGIBLE", "message": elig["reason"]}
    return {**card, "state": "OK", "message": None}


@router.get("/join/{token}")
def join_card(token: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    out = _join_state(db, token, cu)
    db.commit()
    out.pop("link_id", None)
    return out


class JoinIn(BaseModel):
    message: str


@router.post("/join/{token}/requests")
def send_join_request(token: str, body: JoinIn, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    state = _join_state(db, token, cu)
    if state["state"] != "OK":
        raise DomainError(state["state"], state["message"], 409)
    message = body.message.strip()
    if not message:
        raise DomainError("MESSAGE_REQUIRED", "Write a short message to the team leader.")
    if len(message) > 500:
        raise DomainError("MESSAGE_TOO_LONG", "Keep your message under 500 characters.")
    link = db.get(TeamInviteLink, state["link_id"])
    team = db.get(Team, link.team_id)
    req = TeamJoinRequest(team_id=team.id, invite_link_id=link.id, user_id=cu.id, message=message, status="PENDING",
                          created_by=cu.id)
    db.add(req)
    link.use_count = (link.use_count or 0) + 1
    if link.max_uses and link.use_count >= link.max_uses:
        link.status = "EXHAUSTED"
    publish_event(db, "TEAM_JOIN_REQUESTED", "team", team.id, cu.id, users=[team.lead_user_id],
                  title=f"{cu.user.full_name} asked to join {team.name}", body=message[:200],
                  link=f"/teams/{team.id}", needs_action=True, vars={"team": team.name, "requester": cu.user.full_name})
    db.commit()
    return {"id": req.id, "status": req.status}


@router.get("/teams/{team_id}/join-requests")
def join_requests(team_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    team = get_team_or_404(db, cu, team_id, leader_only=True)
    out = []
    for r in db.scalars(select(TeamJoinRequest).where(TeamJoinRequest.team_id == team.id)
                        .order_by(TeamJoinRequest.created_at.desc())).all():
        out.append({"id": r.id, "status": r.status, "message": r.message, "created_at": iso(r.created_at),
                    "decided_at": iso(r.decided_at), "decline_reason": r.decline_reason, "user": user_brief(db, r.user_id)})
    return out


class DecideIn(BaseModel):
    reason: str | None = None


@router.post("/join-requests/{request_id}/actions/{action}")
def decide_join_request(request_id: str, action: str, body: DecideIn | None = None, request: Request = None,
                        cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    req = db.get(TeamJoinRequest, request_id)
    if not req:
        raise not_found("Join request")
    team = db.get(Team, req.team_id)
    if action == "cancel":
        if req.user_id != cu.id or req.status != "PENDING":
            raise not_found("Join request")
        req.status, req.decided_at = "CANCELLED", utcnow()
        db.commit()
        return {"status": req.status}
    if team.lead_user_id != cu.id:
        raise not_found("Join request")
    if req.status != "PENDING":
        raise DomainError("REQUEST_ALREADY_DECIDED", "This request was already decided.")
    name = (user_brief(db, req.user_id) or {}).get("full_name")
    ch = db.get(Challenge, team.challenge_id) if team.challenge_id else None
    if action == "approve":
        _guard_unlocked(team)
        members = active_members(db, team.id)
        if len(members) >= (ch.team_max_size if ch else 5):
            raise DomainError("TEAM_FULL", "Team is full. You can't approve more requests.")
        if ch and svc.my_entry_in(db, ch.id, req.user_id):
            raise DomainError("ALREADY_IN_CHALLENGE", f"{name} has already joined this challenge another way.")
        db.add(TeamMember(team_id=team.id, user_id=req.user_id, member_role="MEMBER", status="ACTIVE", joined_at=utcnow()))
        db.flush()
        split_equally(active_members(db, team.id))
        req.status, req.decided_by, req.decided_at = "APPROVED", cu.id, utcnow()
        audit(db, cu.id, "UPDATE", "team", team.id, f"Approved {name} to join {team.name}", {}, request.state.request_id)
        publish_event(db, "TEAM_JOIN_APPROVED", "team", team.id, cu.id, users=[req.user_id],
                      title=f"You're in: {team.name}", body="Your join request was approved. You can now see the team's work.",
                      link=f"/teams/{team.id}", vars={"team": team.name})
    elif action == "decline":
        req.status, req.decided_by, req.decided_at = "DECLINED", cu.id, utcnow()
        req.decline_reason = (body.reason if body else None) or None
        publish_event(db, "TEAM_JOIN_DECLINED", "team", team.id, cu.id, users=[req.user_id],
                      title=f"Your request to join {team.name} was not accepted",
                      body=req.decline_reason or "The team leader could not add you this time. You can still join another team or enter on your own.",
                      link="/challenges", vars={"team": team.name})
    else:
        raise not_found("Action")
    db.commit()
    return {"status": req.status}
