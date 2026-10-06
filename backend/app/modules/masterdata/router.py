"""Master data, dynamic forms and scorecards (all configurable without a code release)."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import DomainError, not_found
from app.core.events import audit
from app.core.permissions import CurrentUser, get_current_user, require_roles
from app.modules.evaluation.models import RatingScale, Scorecard, ScorecardCriterion
from app.modules.masterdata.models import (Category, ChallengeDomain, FormField, FormSection, FormTemplate, LookupType,
                                           LookupValue, Skill)
from app.shared.models.base import row
from app.shared.util import en

router = APIRouter(tags=["master data"])
ADMINS = ("SUPER_ADMIN", "ADMIN")
BUILDERS = ("SUPER_ADMIN", "PROGRAM_OWNER")

SIMPLE = {"domains": ChallengeDomain, "categories": Category, "skills": Skill}


def _simple(o) -> dict:
    d = row(o, exclude=("created_by", "updated_by"))
    d["name"] = en(o.name_i18n)
    return d


class SimpleIn(BaseModel):
    code: str | None = None
    name: str
    name_bn: str | None = None
    is_active: bool = True
    category: str | None = None


def _register_simple(kind: str, model):
    @router.get(f"/{kind}", name=f"list_{kind}")
    def list_items(include_inactive: bool = False, cu: CurrentUser = Depends(get_current_user),
                   db: Session = Depends(get_db)):
        items = db.scalars(select(model).order_by(model.code)).all()
        return [_simple(i) for i in items if include_inactive or getattr(i, "is_active", True)]

    @router.post(f"/{kind}", name=f"create_{kind}")
    def create_item(body: SimpleIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMINS)),
                    db: Session = Depends(get_db)):
        code = (body.code or body.name).upper().replace(" ", "_")[:60]
        if db.scalar(select(model).where(model.code == code)):
            raise DomainError("CODE_EXISTS", "This code is already used.")
        item = model(code=code, name_i18n={"en": body.name, **({"bn": body.name_bn} if body.name_bn else {})})
        if hasattr(item, "is_active"):
            item.is_active = body.is_active
        if hasattr(item, "category") and body.category:
            item.category = body.category
        db.add(item)
        audit(db, cu.id, "CONFIG_CHANGE", kind, item.id, f"Added {kind[:-1]} {body.name}", {}, request.state.request_id)
        db.commit()
        return _simple(item)

    @router.patch(f"/{kind}/{{item_id}}", name=f"update_{kind}")
    def update_item(item_id: str, body: SimpleIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMINS)),
                    db: Session = Depends(get_db)):
        item = db.get(model, item_id)
        if not item:
            raise not_found("Item")
        before = en(item.name_i18n)
        item.name_i18n = {"en": body.name, **({"bn": body.name_bn} if body.name_bn else {})}
        if hasattr(item, "is_active"):
            item.is_active = body.is_active
        audit(db, cu.id, "CONFIG_CHANGE", kind, item.id, f"Edited {kind[:-1]} {body.name}",
              {"name": [before, body.name]}, request.state.request_id)
        db.commit()
        return _simple(item)


for _kind, _model in SIMPLE.items():
    _register_simple(_kind, _model)


# ---- Lookups ---------------------------------------------------------------------
@router.get("/lookups")
def all_lookups(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """Every lookup list in one call: {TYPE_CODE: [{id, code, label, label_i18n, is_active}]}."""
    types = {t.id: t for t in db.scalars(select(LookupType)).all()}
    out: dict[str, list] = {t.code: [] for t in types.values()}
    for v in db.scalars(select(LookupValue).order_by(LookupValue.sort_order)).all():
        t = types.get(v.lookup_type_id)
        if t:
            out[t.code].append({"id": v.id, "code": v.code, "label": en(v.label_i18n), "label_i18n": v.label_i18n,
                                "is_active": v.is_active, "sort_order": v.sort_order, "meta": v.meta})
    return out


class LookupIn(BaseModel):
    code: str | None = None
    label: str
    label_bn: str | None = None
    is_active: bool = True


@router.post("/lookups/{type_code}")
def add_lookup(type_code: str, body: LookupIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMINS)),
               db: Session = Depends(get_db)):
    t = db.scalar(select(LookupType).where(LookupType.code == type_code))
    if not t:
        raise not_found("Lookup type")
    count = len(db.scalars(select(LookupValue).where(LookupValue.lookup_type_id == t.id)).all())
    v = LookupValue(lookup_type_id=t.id, code=(body.code or body.label).upper().replace(" ", "_")[:60],
                    label_i18n={"en": body.label, **({"bn": body.label_bn} if body.label_bn else {})},
                    sort_order=count + 1, is_active=body.is_active)
    db.add(v)
    audit(db, cu.id, "CONFIG_CHANGE", "lookup_value", v.id, f"Added {type_code}: {body.label}", {}, request.state.request_id)
    db.commit()
    return {"id": v.id}


@router.patch("/lookups/values/{value_id}")
def edit_lookup(value_id: str, body: LookupIn, request: Request, cu: CurrentUser = Depends(require_roles(*ADMINS)),
                db: Session = Depends(get_db)):
    v = db.get(LookupValue, value_id)
    if not v:
        raise not_found("Lookup value")
    before = en(v.label_i18n)
    v.label_i18n = {"en": body.label, **({"bn": body.label_bn} if body.label_bn else {})}
    v.is_active = body.is_active
    audit(db, cu.id, "CONFIG_CHANGE", "lookup_value", v.id, f"Edited lookup {body.label}",
          {"label": [before, body.label]}, request.state.request_id)
    db.commit()
    return {"id": v.id}


# ---- Forms -----------------------------------------------------------------------
def form_definition(db: Session, template_id: str | None) -> dict | None:
    t = db.get(FormTemplate, template_id) if template_id else None
    if not t:
        return None
    sections = db.scalars(select(FormSection).where(FormSection.form_template_id == t.id)
                          .order_by(FormSection.sort_order)).all()
    out = {"id": t.id, "code": t.code, "name_i18n": t.name_i18n, "name": en(t.name_i18n), "purpose": t.purpose,
           "version": t.version, "status": t.status, "sections": []}
    for s in sections:
        fields = db.scalars(select(FormField).where(FormField.form_section_id == s.id).order_by(FormField.sort_order)).all()
        out["sections"].append({
            "id": s.id, "code": s.code, "title_i18n": s.title_i18n, "help_i18n": s.help_i18n, "scored_on": s.scored_on or [],
            "fields": [{"id": f.id, "field_key": f.field_key, "label_i18n": f.label_i18n, "help_i18n": f.help_i18n,
                        "placeholder_i18n": f.placeholder_i18n, "field_type": f.field_type, "options": f.options or [],
                        "is_required": f.is_required, "validation": f.validation or {}} for f in fields]})
    return out


def validate_form(form: dict, content: dict) -> dict:
    """Server-side required/length checks. Returns {field_key: message}."""
    errors = {}
    for section in form["sections"]:
        for f in section["fields"]:
            v = (content or {}).get(f["field_key"])
            empty = v in (None, "", [], False)
            if f["is_required"] and empty:
                errors[f["field_key"]] = "This field is required."
            max_len = (f["validation"] or {}).get("max_len")
            if max_len and isinstance(v, str) and len(v) > max_len:
                errors[f["field_key"]] = f"Keep this under {max_len} characters."
    return errors


def form_completeness(form: dict, content: dict) -> int:
    required = [f["field_key"] for s in form["sections"] for f in s["fields"] if f["is_required"]]
    if not required:
        return 100
    done = sum(1 for k in required if (content or {}).get(k) not in (None, "", [], False))
    return round(done * 100 / len(required))


@router.get("/forms")
def list_forms(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return [{"id": t.id, "code": t.code, "name": en(t.name_i18n), "purpose": t.purpose, "version": t.version,
             "status": t.status} for t in db.scalars(select(FormTemplate).order_by(FormTemplate.purpose, FormTemplate.code)).all()]


@router.get("/forms/{form_id}")
def get_form(form_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    form = form_definition(db, form_id)
    if not form:
        raise not_found("Form")
    return form


class FieldIn(BaseModel):
    label: str
    help: str | None = None
    field_type: str = "LONG_TEXT"
    is_required: bool = False
    max_len: int | None = None


@router.post("/forms/sections/{section_id}/fields")
def add_field(section_id: str, body: FieldIn, request: Request, cu: CurrentUser = Depends(require_roles(*BUILDERS)),
              db: Session = Depends(get_db)):
    section = db.get(FormSection, section_id)
    if not section:
        raise not_found("Section")
    count = len(db.scalars(select(FormField).where(FormField.form_section_id == section.id)).all())
    key = "".join(c if c.isalnum() else "_" for c in body.label.lower())[:50] + f"_{count + 1}"
    f = FormField(form_section_id=section.id, field_key=key, label_i18n={"en": body.label},
                  help_i18n={"en": body.help} if body.help else {}, field_type=body.field_type,
                  is_required=body.is_required, validation={"max_len": body.max_len} if body.max_len else {},
                  sort_order=count + 1)
    db.add(f)
    audit(db, cu.id, "CONFIG_CHANGE", "form_field", f.id, f"Added form field '{body.label}'", {}, request.state.request_id)
    db.commit()
    return {"id": f.id, "field_key": key}


@router.patch("/forms/fields/{field_id}")
def edit_field(field_id: str, body: FieldIn, request: Request, cu: CurrentUser = Depends(require_roles(*BUILDERS)),
               db: Session = Depends(get_db)):
    f = db.get(FormField, field_id)
    if not f:
        raise not_found("Field")
    before = en(f.label_i18n)
    f.label_i18n = {**(f.label_i18n or {}), "en": body.label}
    f.help_i18n = {**(f.help_i18n or {}), "en": body.help or ""}
    f.field_type, f.is_required = body.field_type, body.is_required
    f.validation = {**(f.validation or {}), **({"max_len": body.max_len} if body.max_len else {})}
    audit(db, cu.id, "CONFIG_CHANGE", "form_field", f.id, f"Edited form field '{body.label}'",
          {"label": [before, body.label]}, request.state.request_id)
    db.commit()
    return {"id": f.id}


@router.delete("/forms/fields/{field_id}")
def delete_field(field_id: str, request: Request, cu: CurrentUser = Depends(require_roles(*BUILDERS)),
                 db: Session = Depends(get_db)):
    f = db.get(FormField, field_id)
    if not f:
        raise not_found("Field")
    audit(db, cu.id, "CONFIG_CHANGE", "form_field", f.id, f"Removed form field '{en(f.label_i18n)}'", {}, request.state.request_id)
    db.delete(f)
    db.commit()
    return {"ok": True}


# ---- Scorecards ------------------------------------------------------------------
def scorecard_definition(db: Session, scorecard_id: str | None) -> dict | None:
    sc = db.get(Scorecard, scorecard_id) if scorecard_id else None
    if not sc:
        return None
    scale = db.get(RatingScale, sc.rating_scale_id) if sc.rating_scale_id else None
    criteria = db.scalars(select(ScorecardCriterion).where(ScorecardCriterion.scorecard_id == sc.id)
                          .order_by(ScorecardCriterion.sort_order)).all()
    return {
        "id": sc.id, "code": sc.code, "name": en(sc.name_i18n), "name_i18n": sc.name_i18n, "purpose": sc.purpose,
        "version": sc.version, "status": sc.status, "total_weight": sum(c.weight_pct or 0 for c in criteria),
        "scale": {"min": scale.min_value, "max": scale.max_value, "levels": scale.levels} if scale else
                 {"min": 1, "max": 5, "levels": []},
        "criteria": [{"id": c.id, "code": c.code, "name": en(c.name_i18n), "name_i18n": c.name_i18n,
                      "guidance": en(c.guidance_i18n), "guidance_i18n": c.guidance_i18n, "weight_pct": c.weight_pct,
                      "min_rating": c.min_rating, "comment_required_at": c.comment_required_at or [],
                      "is_tie_breaker": c.is_tie_breaker, "sort_order": c.sort_order} for c in criteria]}


@router.get("/scorecards")
def list_scorecards(cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return [scorecard_definition(db, s.id) for s in db.scalars(select(Scorecard).order_by(Scorecard.code)).all()]


@router.get("/scorecards/{scorecard_id}")
def get_scorecard(scorecard_id: str, cu: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sc = scorecard_definition(db, scorecard_id)
    if not sc:
        raise not_found("Scorecard")
    return sc


class CriterionIn(BaseModel):
    id: str | None = None
    name: str
    guidance: str | None = None
    weight_pct: float
    min_rating: float | None = None
    is_tie_breaker: bool = False


class ScorecardIn(BaseModel):
    criteria: list[CriterionIn]


@router.put("/scorecards/{scorecard_id}/criteria")
def save_criteria(scorecard_id: str, body: ScorecardIn, request: Request,
                  cu: CurrentUser = Depends(require_roles(*BUILDERS)), db: Session = Depends(get_db)):
    """Change criteria and weights without a code release. Weights must total 100; every change is audited."""
    sc = db.get(Scorecard, scorecard_id)
    if not sc:
        raise not_found("Scorecard")
    total = round(sum(c.weight_pct for c in body.criteria), 2)
    if total != 100:
        raise DomainError("WEIGHTS_NOT_100", f"Weights must total 100%. They total {total}%.")
    existing = {c.id: c for c in db.scalars(select(ScorecardCriterion).where(ScorecardCriterion.scorecard_id == sc.id)).all()}
    changes, keep = {}, set()
    for i, c in enumerate(body.criteria):
        cur = existing.get(c.id) if c.id else None
        if cur:
            if cur.weight_pct != c.weight_pct:
                changes[cur.code] = [cur.weight_pct, c.weight_pct]
            cur.name_i18n = {**(cur.name_i18n or {}), "en": c.name}
            cur.guidance_i18n = {**(cur.guidance_i18n or {}), "en": c.guidance or ""}
            cur.weight_pct, cur.min_rating, cur.is_tie_breaker, cur.sort_order = c.weight_pct, c.min_rating, c.is_tie_breaker, i
            keep.add(cur.id)
        else:
            new = ScorecardCriterion(scorecard_id=sc.id, code=c.name.upper().replace(" ", "_")[:40],
                                     name_i18n={"en": c.name}, guidance_i18n={"en": c.guidance or ""},
                                     weight_pct=c.weight_pct, min_rating=c.min_rating, is_tie_breaker=c.is_tie_breaker,
                                     comment_required_at=[1, 5], sort_order=i)
            db.add(new)
            changes[new.code] = [None, c.weight_pct]
    for cid, cur in existing.items():
        if cid not in keep:
            changes[cur.code] = [cur.weight_pct, None]
            db.delete(cur)
    sc.total_weight, sc.updated_by = 100, cu.id
    audit(db, cu.id, "CONFIG_CHANGE", "scorecard", sc.id, f"Changed scorecard {en(sc.name_i18n)}", changes,
          request.state.request_id)
    db.commit()
    return scorecard_definition(db, sc.id)
