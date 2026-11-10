"""InovaRegistry API.

GET  /ideas              every signed-in user; filters: search, source_type, institution_type, collected_at
GET  /ideas/stats        counts for the page header
GET  /ideas/{code}       one record with its creator and institution
POST /ideas              manual entry by any signed-in employee
PUT    /ideas/{code}     edit: the employee who logged it, or an admin
DELETE /ideas/{code}     the employee who logged it, or an admin
POST   /ideas/{code}/cards   add a business-card photo (multipart; same people as edit)
GET    /ideas/cards/{id}     the card photo (?size=full|thumb)
DELETE /ideas/cards/{id}     remove a card (same people as edit)
POST /scraper/ingest     webhook for web scrapers (X-Scraper-Key header); batch upsert without duplicates
"""
import hashlib
import hmac
import re
import uuid
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, File, Form, Header, Request, Response, UploadFile
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import String, case, cast, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit
from app.core.permissions import CurrentUser, get_current_user
from app.modules.registry.models import (AI_CATEGORIES, AI_INTENSITIES, COLLECTED_AT, CREATOR_TYPES, INSTITUTION_TYPES,
                                         BusinessCard, Institution, Project, RegistryLike,
                                         RegistryUser, RegistryUserInstitution)
from app.shared.models.base import iso

router = APIRouter(tags=["inova registry"])

MANUAL, SCRAPED = "Manual Entry", "Web Scraped"
ADMINS = {"SUPER_ADMIN", "ADMIN", "PROGRAM_OWNER"}


# ---- Helpers ----------------------------------------------------------------------------------------------------

def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip()).lower()


def _norm_url(url: str | None) -> str | None:
    """Same page, same key: no scheme, no www, no trailing slash, no #fragment, no utm_* parameters."""
    if not url or not url.strip():
        return None
    parts = urlsplit(url.strip() if "://" in url else f"https://{url.strip()}")
    host = (parts.hostname or "").lower().removeprefix("www.")
    query = "&".join(q for q in parts.query.split("&") if q and not q.lower().startswith("utm_"))
    return urlunsplit(("", host, parts.path.rstrip("/"), query, "")).lstrip("/") or None


def _dedup_key(title: str, institution: str, source_url: str | None) -> str:
    url = _norm_url(source_url)
    if url:
        return "url:" + url[:290]
    return "ti:" + hashlib.sha256(f"{_norm(title)}|{_norm(institution)}".encode()).hexdigest()


def _clean_stack(v) -> list[str]:
    items = v.split(",") if isinstance(v, str) else (v or [])
    out: list[str] = []
    for s in items:
        s = str(s).strip()
        if s and s.lower() not in {x.lower() for x in out}:
            out.append(s[:60])
    return out[:30]


def _next_code(db: Session) -> str:
    last = db.scalar(select(func.max(Project.code)))
    n = int(last.split("-")[1]) + 1 if last else 1
    return f"IR-{n:05d}"


def _institution(db: Session, name: str, itype: str | None, website: str | None = None,
                 country: str | None = None) -> Institution:
    key = _norm(name)[:200]
    inst = db.scalar(select(Institution).where(Institution.match_key == key))
    if not inst:
        inst = Institution(name=name.strip(), institution_type=itype or "Company", website=website, country=country,
                           match_key=key)
        db.add(inst)
        db.flush()
    else:
        inst.website = inst.website or website
        inst.country = inst.country or country
    return inst


def _creator(db: Session, name: str | None, email: str | None, user_type: str | None,
             inst: Institution, source_type: str, source_url: str | None) -> RegistryUser | None:
    if not (name or "").strip():
        return None
    key = (f"email:{_norm(email)}" if email else f"name:{_norm(name)}|{inst.match_key}")[:300]
    person = db.scalar(select(RegistryUser).where(RegistryUser.match_key == key))
    if not person:
        person = RegistryUser(full_name=name.strip(), email=(email or None), user_type=user_type, match_key=key)
        db.add(person)
        db.flush()
    elif user_type and not person.user_type:
        person.user_type = user_type
    link = db.scalar(select(RegistryUserInstitution).where(RegistryUserInstitution.user_id == person.id,
                                                           RegistryUserInstitution.institution_id == inst.id))
    if not link:
        db.add(RegistryUserInstitution(user_id=person.id, institution_id=inst.id, source_type=source_type,
                                       source_url=source_url))
    return person


_CARD_COLUMNS = (BusinessCard.id, BusinessCard.project_id, BusinessCard.contact_name, BusinessCard.designation,
                 BusinessCard.phone, BusinessCard.email, BusinessCard.details, BusinessCard.width, BusinessCard.height,
                 BusinessCard.sort_order)


def _cards_for(db: Session, project_ids: set[str]) -> dict[str, list[dict]]:
    """Business-card details by record, without the image bytes (those come from /ideas/cards/{id})."""
    out: dict[str, list[dict]] = {}
    if not project_ids:
        return out
    rows = db.execute(select(*_CARD_COLUMNS).where(BusinessCard.project_id.in_(project_ids))
                      .order_by(BusinessCard.sort_order, BusinessCard.contact_name)).all()
    for r in rows:
        out.setdefault(r.project_id, []).append({
            "id": r.id, "contact_name": r.contact_name, "designation": r.designation, "phone": r.phone,
            "email": r.email, "details": r.details or {}, "width": r.width, "height": r.height})
    return out


def _likes_for(db: Session, project_ids: set[str], user_id: str | None) -> tuple[dict[str, int], set[str]]:
    """Like count per record, and which of them this user has liked."""
    if not project_ids:
        return {}, set()
    counts = dict(db.execute(select(RegistryLike.project_id, func.count()).where(RegistryLike.project_id.in_(project_ids))
                             .group_by(RegistryLike.project_id)).all())
    mine = set(db.scalars(select(RegistryLike.project_id).where(RegistryLike.project_id.in_(project_ids),
                                                                RegistryLike.user_id == user_id)).all()) if user_id else set()
    return counts, mine


def _out(db: Session, p: Project, people: dict | None = None, insts: dict | None = None,
         cards: dict | None = None, user_id: str | None = None,
         likes: tuple[dict[str, int], set[str]] | None = None) -> dict:
    card_list = (cards if cards is not None else _cards_for(db, {p.id})).get(p.id, [])
    like_counts, liked = likes if likes is not None else _likes_for(db, {p.id}, user_id)
    person =(people or {}).get(p.creator_id) if people is not None else (db.get(RegistryUser, p.creator_id) if p.creator_id else None)
    inst = (insts or {}).get(p.institution_id) if insts is not None else (db.get(Institution, p.institution_id) if p.institution_id else None)
    return {
        "id": p.id, "code": p.code, "title": p.title, "summary": p.summary, "description": p.description,
        "tech_stack": p.tech_stack or [], "impact": p.impact, "collected_at": p.collected_at, "event_name": p.event_name,
        "contact_phone": p.contact_phone, "contact_address": p.contact_address,
        "ai_unique_point": p.ai_unique_point, "ai_work": p.ai_work, "ai_category": p.ai_category,
        "ai_intensity": p.ai_intensity, "ai_tags": p.ai_tags or [], "tagline": p.tagline, "services": p.services,
        "projects_products": p.projects_products,
        "source_type": p.source_type, "source_url": p.source_url, "submitted_by": p.submitted_by_label,
        "submitted_by_user_id": p.submitted_by_user_id, "created_at": iso(p.created_at),
        "extra": p.extra or {}, "business_cards": card_list,
        "like_count": like_counts.get(p.id, 0), "liked_by_me": p.id in liked,
        "creator": {"id": person.id, "full_name": person.full_name, "email": person.email,
                    "user_type": person.user_type} if person else None,
        "institution": {"id": inst.id, "name": inst.name, "institution_type": inst.institution_type,
                        "website": inst.website, "country": inst.country} if inst else None,
    }


def _get(db: Session, code: str) -> Project:
    p = db.scalar(select(Project).where(or_(Project.code == code, Project.id == code)))
    if not p:
        raise not_found("Registry record")
    return p


# ---- Read -------------------------------------------------------------------------------------------------------

@router.get("/ideas")
def list_ideas(search: str | None = None, source_type: str | None = None, institution_type: str | None = None,
               collected_at: str | None = None, ai_category: str | None = None, ai_intensity: str | None = None,
               sort: Literal["ai", "likes", "newest"] = "ai", page: int = 1, page_size: int = 50,
               cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """sort=ai (default): records with AI work first, then the most liked; sort=likes: most liked first;
    sort=newest: latest logged first."""
    page, page_size = max(page, 1), min(max(page_size, 1), 200)
    like_sq = (select(RegistryLike.project_id.label("pid"), func.count().label("n"))
               .group_by(RegistryLike.project_id).subquery())
    q = (select(Project).outerjoin(Institution, Institution.id == Project.institution_id)
         .outerjoin(RegistryUser, RegistryUser.id == Project.creator_id)
         .outerjoin(like_sq, like_sq.c.pid == Project.id))
    if source_type and source_type != "All":
        q = q.where(Project.source_type == source_type)
    if institution_type and institution_type != "All":
        q = q.where(Institution.institution_type == institution_type)
    if collected_at and collected_at != "All":
        q = q.where(Project.collected_at == collected_at)
    if ai_category and ai_category != "All":
        q = q.where(Project.ai_category.is_not(None)) if ai_category == "Any AI" else q.where(Project.ai_category == ai_category)
    if ai_intensity and ai_intensity != "All":
        q = q.where(Project.ai_intensity == ai_intensity)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.where(or_(Project.title.ilike(like), Project.summary.ilike(like), Project.code.ilike(like),
                        Project.event_name.ilike(like), Institution.name.ilike(like), RegistryUser.full_name.ilike(like),
                        Project.ai_unique_point.ilike(like), Project.ai_work.ilike(like),
                        Project.tagline.ilike(like), Project.services.ilike(like),
                        Project.projects_products.ilike(like), cast(Project.ai_tags, String).ilike(like),
                        cast(Project.tech_stack, String).ilike(like)))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    like_n = func.coalesce(like_sq.c.n, 0)
    has_ai = case((or_(Project.ai_work.is_not(None), Project.ai_category.is_not(None)), 1), else_=0)
    ai_level = case((Project.ai_intensity == "High", 3), (Project.ai_intensity == "Medium", 2),
                    (Project.ai_intensity == "Low", 1), else_=0)
    order = {"ai": (has_ai.desc(), like_n.desc(), ai_level.desc()),
             "likes": (like_n.desc(),),
             "newest": ()}[sort] + (Project.created_at.desc(), Project.code.desc())
    items = db.scalars(q.order_by(*order).offset((page - 1) * page_size).limit(page_size)).all()
    people = {u.id: u for u in db.scalars(select(RegistryUser).where(
        RegistryUser.id.in_({p.creator_id for p in items if p.creator_id})))}
    insts = {i.id: i for i in db.scalars(select(Institution).where(
        Institution.id.in_({p.institution_id for p in items if p.institution_id})))}
    cards = _cards_for(db, {p.id for p in items})
    likes = _likes_for(db, {p.id for p in items}, cu.id)
    return {"items": [_out(db, p, people, insts, cards, likes=likes) for p in items], "total": total, "page": page}


@router.get("/ideas/cards/{card_id}")
def business_card_image(card_id: str, size: Literal["full", "thumb"] = "full",
                        cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """The card photo (WebP). Signed-in users only: cards carry people's contact details."""
    col = BusinessCard.thumb if size == "thumb" else BusinessCard.image
    row = db.execute(select(col, BusinessCard.content_type).where(BusinessCard.id == card_id)).first()
    if not row or not row[0]:
        raise not_found("Business card")
    return Response(content=row[0], media_type=row[1] or "image/webp",
                    headers={"Cache-Control": "private, max-age=86400"})


@router.get("/ideas/stats")
def idea_stats(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    by_source = dict(db.execute(select(Project.source_type, func.count()).group_by(Project.source_type)).all())
    return {"total": sum(by_source.values()), "scraped": by_source.get(SCRAPED, 0), "manual": by_source.get(MANUAL, 0),
            "institutions": db.scalar(select(func.count(func.distinct(Project.institution_id)))) or 0,
            "ai_projects": db.scalar(select(func.count()).where(Project.ai_category.is_not(None))) or 0,
            "options": {"institution_types": INSTITUTION_TYPES, "creator_types": CREATOR_TYPES,
                        "collected_at": COLLECTED_AT, "source_types": (SCRAPED, MANUAL),
                        "ai_categories": AI_CATEGORIES, "ai_intensities": AI_INTENSITIES}}


@router.get("/ideas/{code}")
def get_idea(code: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _out(db, _get(db, code), user_id=cu.id)


# ---- Manual entry -----------------------------------------------------------------------------------------------

class IdeaIn(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    summary: str = Field(min_length=10, max_length=2000)
    description: str | None = Field(None, max_length=10000)
    tech_stack: list[str] | str = []
    impact: str | None = Field(None, max_length=2000)
    institution: str = Field(min_length=2, max_length=200)
    institution_type: Literal[INSTITUTION_TYPES] = "University"  # type: ignore[valid-type]
    creator: str | None = Field(None, max_length=200)
    creator_email: str | None = Field(None, max_length=200)
    creator_type: Literal[CREATOR_TYPES] | None = None  # type: ignore[valid-type]
    collected_at: Literal[COLLECTED_AT] | None = None  # type: ignore[valid-type]
    event_name: str | None = Field(None, max_length=200)
    contact_phone: str | None = Field(None, max_length=40)
    contact_address: str | None = Field(None, max_length=500)
    ai_unique_point: str | None = Field(None, max_length=2000)
    ai_work: str | None = Field(None, max_length=2000)
    ai_category: Literal[AI_CATEGORIES] | None = None  # type: ignore[valid-type]
    ai_intensity: Literal[AI_INTENSITIES] | None = None  # type: ignore[valid-type]
    ai_tags: list[str] | str = []
    tagline: str | None = Field(None, max_length=300)
    services: str | None = Field(None, max_length=10000)
    projects_products: str | None = Field(None, max_length=10000)
    website: str | None = Field(None, max_length=400)
    source_url: str | None = Field(None, max_length=1000)

    @field_validator("ai_category", "ai_intensity", mode="before")
    @classmethod
    def _blank_is_none(cls, v):
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("contact_phone")
    @classmethod
    def _phone(cls, v):
        if v and not re.fullmatch(r"[0-9+()\-\s./]{5,40}", v.strip()):
            raise ValueError("Use digits, spaces, + ( ) - only, e.g. +880 1928-773714")
        return v.strip() if v and v.strip() else None

    @field_validator("source_url")
    @classmethod
    def _url(cls, v):
        if v and not re.match(r"^https?://", v.strip(), re.I):
            raise ValueError("The link must start with http:// or https://")
        return v.strip() if v else None

    @field_validator("website")
    @classmethod
    def _website(cls, v):
        v = (v or "").strip()
        if not v:
            return None
        if " " in v or "." not in v:
            raise ValueError("Enter a web address, e.g. https://example.com")
        return v if re.match(r"^https?://", v, re.I) else f"https://{v}"


def _txt(v: str | None) -> str | None:
    return (v or "").strip() or None


def _apply_details(p: Project, body: IdeaIn) -> None:
    """The optional Expo-style fields, shared by create and edit."""
    p.tagline, p.services, p.projects_products = _txt(body.tagline), _txt(body.services), _txt(body.projects_products)
    p.ai_tags = _clean_stack(body.ai_tags)


@router.post("/ideas", status_code=201)
def create_idea(body: IdeaIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)):
    key = _dedup_key(body.title, body.institution, body.source_url)
    existing = db.scalar(select(Project).where(Project.dedup_key == key))
    if existing:
        raise DomainError("DUPLICATE", f"This solution is already in the registry as {existing.code}.", 409,
                          {"code": existing.code})
    inst = _institution(db, body.institution, body.institution_type, body.website)
    person = _creator(db, body.creator, body.creator_email, body.creator_type, inst, MANUAL, body.source_url)
    p = Project(code=_next_code(db), title=body.title.strip(), summary=body.summary.strip(),
                description=(body.description or "").strip() or None, tech_stack=_clean_stack(body.tech_stack),
                impact=(body.impact or "").strip() or None, collected_at=body.collected_at,
                event_name=(body.event_name or "").strip() or None, contact_phone=body.contact_phone,
                contact_address=(body.contact_address or "").strip() or None, creator_id=person.id if person else None,
                ai_unique_point=(body.ai_unique_point or "").strip() or None, ai_work=(body.ai_work or "").strip() or None,
                ai_category=body.ai_category, ai_intensity=body.ai_intensity,
                institution_id=inst.id, source_type=MANUAL, source_url=body.source_url,
                submitted_by_user_id=cu.id, submitted_by_label=cu.user.full_name, dedup_key=key, created_by=cu.id)
    _apply_details(p, body)
    db.add(p)
    audit(db, cu.id, "CREATE", "registry_project", p.id, f"Logged {p.code} {p.title} in InovaRegistry", {},
          request.state.request_id)
    db.commit()
    return _out(db, p, user_id=cu.id)


def _check_owner(p: Project, cu: CurrentUser, verb: str) -> None:
    if p.submitted_by_user_id != cu.id and not (cu.roles & ADMINS):
        raise DomainError("FORBIDDEN", f"Only the person who logged this record or an admin can {verb} it.", 403)


@router.put("/ideas/{code}")
def update_idea(code: str, body: IdeaIn, request: Request, cu: CurrentUser = Depends(get_current_user),
                db: Session = Depends(get_db)):
    p = _get(db, code)
    _check_owner(p, cu, "edit")
    key = _dedup_key(body.title, body.institution, body.source_url)
    clash = db.scalar(select(Project).where(Project.dedup_key == key, Project.id != p.id))
    if clash:
        raise DomainError("DUPLICATE", f"Another record already has this link or title: {clash.code}.", 409,
                          {"code": clash.code})
    inst = _institution(db, body.institution, body.institution_type)
    inst.institution_type = body.institution_type          # an edit can correct the type
    if body.website:
        inst.website = body.website
    person = _creator(db, body.creator, body.creator_email, body.creator_type, inst, p.source_type, body.source_url)
    if person:
        person.user_type = body.creator_type or person.user_type
        person.email = body.creator_email or person.email
    before = {"title": p.title, "institution_id": p.institution_id}
    p.title, p.summary = body.title.strip(), body.summary.strip()
    p.description = (body.description or "").strip() or None
    p.tech_stack = _clean_stack(body.tech_stack)
    p.impact = (body.impact or "").strip() or None
    p.collected_at, p.event_name = body.collected_at, (body.event_name or "").strip() or None
    p.contact_phone, p.contact_address = body.contact_phone, (body.contact_address or "").strip() or None
    p.ai_unique_point, p.ai_work = (body.ai_unique_point or "").strip() or None, (body.ai_work or "").strip() or None
    p.ai_category, p.ai_intensity = body.ai_category, body.ai_intensity
    _apply_details(p, body)
    p.creator_id, p.institution_id = (person.id if person else None), inst.id
    p.source_url, p.dedup_key, p.updated_by = body.source_url, key, cu.id
    audit(db, cu.id, "UPDATE", "registry_project", p.id, f"Edited {p.code} {p.title} in InovaRegistry",
          {"title": [before["title"], p.title]}, request.state.request_id)
    db.commit()
    return _out(db, p, user_id=cu.id)


@router.delete("/ideas/{code}")
def delete_idea(code: str, request: Request, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, code)
    _check_owner(p, cu, "delete")
    audit(db, cu.id, "DELETE", "registry_project", p.id, f"Deleted {p.code} {p.title} from InovaRegistry", {},
          request.state.request_id)
    db.execute(delete(BusinessCard).where(BusinessCard.project_id == p.id))
    db.execute(delete(RegistryLike).where(RegistryLike.project_id == p.id))
    db.delete(p)
    db.commit()
    return {"ok": True}


# ---- Likes ------------------------------------------------------------------------------------------------------
# Any signed-in employee can like a record once. Both calls are safe to repeat and return the new state.

def _like_state(db: Session, p: Project, user_id: str) -> dict:
    counts, mine = _likes_for(db, {p.id}, user_id)
    return {"code": p.code, "like_count": counts.get(p.id, 0), "liked_by_me": p.id in mine}


@router.post("/ideas/{code}/like")
def like_idea(code: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, code)
    if not db.scalar(select(RegistryLike.id).where(RegistryLike.project_id == p.id, RegistryLike.user_id == cu.id)):
        try:
            with db.begin_nested():
                db.add(RegistryLike(project_id=p.id, user_id=cu.id, created_by=cu.id))
            db.commit()
        except IntegrityError:          # a double click from two tabs: the like is already there
            db.rollback()
    return _like_state(db, p, cu.id)


@router.delete("/ideas/{code}/like")
def unlike_idea(code: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, code)
    db.execute(delete(RegistryLike).where(RegistryLike.project_id == p.id, RegistryLike.user_id == cu.id))
    db.commit()
    return _like_state(db, p, cu.id)


# ---- Business cards ---------------------------------------------------------------------------------------------
# The browser shrinks the photo before upload (WebP, or JPEG where the browser cannot write WebP), so the server only
# checks what it gets: a real image, small, at most MAX_CARDS per record.

MAX_CARD_BYTES, MAX_THUMB_BYTES, MAX_CARDS = 400_000, 120_000, 20


def _image_type(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    return None


def _read_image(f: UploadFile | None, limit: int) -> tuple[bytes, str] | None:
    if f is None:
        return None
    data = f.file.read(limit + 1)
    if len(data) > limit:
        raise DomainError("CARD_TOO_LARGE", f"The card photo must be under {limit // 1000} KB after resizing.", 413)
    kind = _image_type(data)
    if not kind:
        raise DomainError("CARD_NOT_IMAGE", "The card photo must be a WebP or JPEG image.", 422)
    return data, kind


def _opt(v: str | None, n: int) -> str | None:
    v = (v or "").strip()
    return v[:n] or None


@router.post("/ideas/{code}/cards", status_code=201)
def add_business_card(code: str, request: Request, image: UploadFile = File(...), thumb: UploadFile | None = File(None),
                      contact_name: str | None = Form(None), designation: str | None = Form(None),
                      phone: str | None = Form(None), email: str | None = Form(None), notes: str | None = Form(None),
                      width: int | None = Form(None, ge=1, le=6000), height: int | None = Form(None, ge=1, le=6000),
                      cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get(db, code)
    _check_owner(p, cu, "add a business card to")
    count = db.scalar(select(func.count()).where(BusinessCard.project_id == p.id)) or 0
    if count >= MAX_CARDS:
        raise DomainError("TOO_MANY_CARDS", f"A record can hold up to {MAX_CARDS} business cards.", 422)
    full, kind = _read_image(image, MAX_CARD_BYTES)
    small = _read_image(thumb, MAX_THUMB_BYTES)
    if small and small[1] != kind:
        small = None                                   # one content type per card; fall back to the full photo
    last = db.scalar(select(func.max(BusinessCard.sort_order)).where(BusinessCard.project_id == p.id))
    card = BusinessCard(project_id=p.id, contact_name=_opt(contact_name, 200), designation=_opt(designation, 200),
                        phone=_opt(phone, 80), email=_opt(email, 300),
                        details={"notes": n} if (n := _opt(notes, 1000)) else {},
                        image=full, thumb=small[0] if small else full, content_type=kind, width=width, height=height,
                        sort_order=(last or 0) + 1, match_key=f"upload:{uuid.uuid4().hex}", created_by=cu.id)
    db.add(card)
    db.flush()
    audit(db, cu.id, "UPDATE", "registry_project", p.id, f"Added a business card to {p.code} {p.title}",
          {"card_id": card.id}, request.state.request_id)
    db.commit()
    return _cards_for(db, {p.id}).get(p.id, [])


@router.delete("/ideas/cards/{card_id}")
def delete_business_card(card_id: str, request: Request, cu: CurrentUser = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    card = db.get(BusinessCard, card_id)
    if not card:
        raise not_found("Business card")
    p = db.get(Project, card.project_id)
    if p:
        _check_owner(p, cu, "remove a business card from")
    db.delete(card)
    if p:
        audit(db, cu.id, "UPDATE", "registry_project", p.id, f"Removed a business card from {p.code} {p.title}",
              {"card_id": card_id}, request.state.request_id)
    db.commit()
    return {"ok": True}


# ---- Scraper webhook --------------------------------------------------------------------------------------------

class ScrapedRecord(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    summary: str | None = Field(None, max_length=4000)
    description: str | None = Field(None, max_length=20000)
    tech_stack: list[str] | str = []
    impact: str | None = Field(None, max_length=4000)
    institution: str = Field(min_length=2, max_length=200)
    institution_type: str | None = None
    institution_website: str | None = None
    country: str | None = None
    creator: str | None = None
    creator_email: str | None = None
    creator_type: str | None = None
    source_url: str | None = Field(None, max_length=1000)
    collected_at: str | None = None
    event_name: str | None = None
    contact_phone: str | None = Field(None, max_length=40)
    contact_address: str | None = Field(None, max_length=500)
    ai_unique_point: str | None = Field(None, max_length=2000)
    ai_work: str | None = Field(None, max_length=2000)
    ai_category: str | None = None          # matched to the list without minding letter case; unknown â†’ "Other AI"
    ai_intensity: str | None = None         # Low | Medium | High


class IngestIn(BaseModel):
    scraper: str = Field("Web Scraper", max_length=120)   # shown as "Via: â€¦" on the record
    records: list[ScrapedRecord] = Field(min_length=1, max_length=1000)


def _pick(value: str | None, allowed: tuple, default: str | None) -> str | None:
    if not value:
        return default
    for a in allowed:
        if a.lower() == value.strip().lower():
            return a
    return default


@router.post("/scraper/ingest")
def scraper_ingest(body: IngestIn, request: Request, x_scraper_key: str | None = Header(None),
                   db: Session = Depends(get_db)):
    if not settings.scraper_api_key:
        raise DomainError("SCRAPER_DISABLED", "Set SCRAPER_API_KEY on the server to turn on scraper ingest.", 503)
    if not x_scraper_key or not hmac.compare_digest(x_scraper_key, settings.scraper_api_key):
        raise DomainError("UNAUTHENTICATED", "Missing or wrong X-Scraper-Key header.", 401)

    created, updated, skipped, errors = [], [], [], []
    seen: set[str] = set()
    for i, r in enumerate(body.records):
        key = _dedup_key(r.title, r.institution, r.source_url)
        if key in seen:
            skipped.append({"index": i, "reason": "duplicate in this batch"})
            continue
        seen.add(key)
        try:
            with db.begin_nested():
                inst = _institution(db, r.institution, _pick(r.institution_type, INSTITUTION_TYPES, "Company"),
                                    r.institution_website, r.country)
                person = _creator(db, r.creator, r.creator_email, _pick(r.creator_type, CREATOR_TYPES, None), inst,
                                  SCRAPED, r.source_url)
                p = db.scalar(select(Project).where(Project.dedup_key == key))
                if p:
                    # Already stored: only fill what is still empty, never overwrite an employee's text.
                    changed = False
                    for field, value in (("summary", r.summary), ("description", r.description), ("impact", r.impact),
                                         ("event_name", r.event_name), ("contact_phone", r.contact_phone),
                                         ("contact_address", r.contact_address), ("ai_unique_point", r.ai_unique_point),
                                         ("ai_work", r.ai_work),
                                         ("ai_category", _pick(r.ai_category, AI_CATEGORIES, "Other AI") if r.ai_category else None),
                                         ("ai_intensity", _pick(r.ai_intensity, AI_INTENSITIES, None))):
                        if value and not getattr(p, field):
                            setattr(p, field, value.strip())
                            changed = True
                    stack = _clean_stack(r.tech_stack)
                    if stack and not p.tech_stack:
                        p.tech_stack, changed = stack, True
                    if person and not p.creator_id:
                        p.creator_id, changed = person.id, True
                    (updated if changed else skipped).append(
                        {"index": i, "code": p.code, **({} if changed else {"reason": "already stored"})})
                    continue
                p = Project(code=_next_code(db), title=r.title.strip(), summary=(r.summary or "").strip() or None,
                            description=(r.description or "").strip() or None, tech_stack=_clean_stack(r.tech_stack),
                            impact=(r.impact or "").strip() or None,
                            collected_at=_pick(r.collected_at, COLLECTED_AT, "Online Research"),
                            event_name=r.event_name, contact_phone=(r.contact_phone or "").strip() or None,
                            contact_address=(r.contact_address or "").strip() or None,
                            ai_unique_point=(r.ai_unique_point or "").strip() or None, ai_work=(r.ai_work or "").strip() or None,
                            ai_category=_pick(r.ai_category, AI_CATEGORIES, "Other AI") if r.ai_category else None,
                            ai_intensity=_pick(r.ai_intensity, AI_INTENSITIES, None),
                            creator_id=person.id if person else None, institution_id=inst.id,
                            source_type=SCRAPED, source_url=r.source_url, submitted_by_label=body.scraper,
                            dedup_key=key)
                db.add(p)
                db.flush()
                created.append({"index": i, "code": p.code})
        except Exception as exc:  # one bad record must not lose the rest of the batch
            errors.append({"index": i, "error": str(exc)[:300]})
    if created:
        audit(db, None, "CREATE", "registry_project", None,
              f"{body.scraper} pushed {len(created)} new record(s) into InovaRegistry", {}, request.state.request_id)
    db.commit()
    return {"received": len(body.records), "created": len(created), "updated": len(updated), "skipped": len(skipped),
            "failed": len(errors), "details": {"created": created, "updated": updated, "skipped": skipped,
                                               "errors": errors}}
