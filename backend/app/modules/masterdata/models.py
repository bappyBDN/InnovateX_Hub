from sqlalchemy import String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, i18n, integer, json_col, ref, text


class LookupType(Base, StdColumns):
    __tablename__ = "lookup_types"
    code = sc(60, unique=True)
    name = sc(120)


class LookupValue(Base, StdColumns):
    __tablename__ = "lookup_values"
    lookup_type_id = ref(False)
    code = sc(60)
    label_i18n = i18n()
    sort_order = integer(0)
    parent_value_id = ref()
    meta = json_col()
    is_active = flag(True)


class Category(Base, StdColumns):
    __tablename__ = "categories"
    code = sc(60, unique=True)
    name_i18n = i18n()
    description_i18n = i18n()
    icon = sc(40, nullable=True)
    color = sc(20, nullable=True)
    parent_id = ref()
    is_active = flag(True)


class ChallengeDomain(Base, StdColumns):
    """Any business area, not only technology."""
    __tablename__ = "challenge_domains"
    code = sc(60, unique=True)
    name_i18n = i18n()
    parent_id = ref()
    owner_org_unit_id = ref()
    is_active = flag(True)


class Skill(Base, StdColumns):
    __tablename__ = "skills"
    code = sc(60, unique=True)
    name_i18n = i18n()
    category = sc(60, nullable=True)


class UserSkill(Base, StdColumns):
    __tablename__ = "user_skills"
    user_id = ref(False)
    skill_id = ref(False)
    level = integer(3)
    self_declared = flag(True)


# ---- Dynamic forms -------------------------------------------------------
class FormTemplate(Base, StdColumns):
    __tablename__ = "form_templates"
    code = sc(60)
    name_i18n = i18n()
    purpose = sc(40)  # INITIATIVE, REGISTRATION, METHODOLOGY, PROTOTYPE, FINAL
    version = integer(1)
    status = sc(20, default="PUBLISHED")  # DRAFT, PUBLISHED, RETIRED
    owner_org_unit_id = ref()


class FormSection(Base, StdColumns):
    __tablename__ = "form_sections"
    form_template_id = ref(False)
    code = sc(60)
    title_i18n = i18n()
    help_i18n = i18n()
    sort_order = integer(0)
    scored_on = json_col(list)  # criterion codes this section supports ("Judges score this on…")


class FormField(Base, StdColumns):
    __tablename__ = "form_fields"
    form_section_id = ref(False)
    field_key = sc(60)
    label_i18n = i18n()
    help_i18n = i18n()
    placeholder_i18n = i18n()
    field_type = sc(30)  # TEXT, LONG_TEXT, NUMBER, MONEY, DATE, SELECT, MULTI_SELECT, URL, KPI_TABLE, CHECKBOX, DECLARATION, FILE
    options = json_col(list)  # [{value,label}] for select fields
    lookup_type_code = mapped_column(String(60), nullable=True)
    is_required = flag(False)
    validation = json_col()
    is_confidential = flag(False)
    ai_assist_enabled = flag(False)
    sort_order = integer(0)
    description = text()
