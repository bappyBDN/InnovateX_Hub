from sqlalchemy import String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import (Base, BusinessColumns, StdColumns, sc, flag, integer, json_col, num, ref, text,
                                    ts)


class Initiative(Base, BusinessColumns):
    """An open idea submitted outside a challenge."""
    __tablename__ = "initiatives"
    code = sc(30, unique=True, nullable=True)  # INNO-2026-000123, set at submit and never changed
    title = mapped_column(String)
    summary = mapped_column(String, nullable=True)
    problem_statement = text()
    affected_users = text()
    current_process = text()
    proposed_solution = text()
    technology_used = text()
    differentiator = text()
    category_id = ref()
    innovation_type_code = sc(40, nullable=True)
    challenge_entry_id = ref()
    owner_user_id = ref()
    submitted_by_user_id = ref()
    on_behalf_of_user_id = ref()
    sponsor_user_id = ref()
    data_classification_code = sc(20, default="INTERNAL")
    scalability_level_code = sc(20, nullable=True)
    risk_flags = json_col(list)
    benefit_types = json_col(list)
    primary_kpi = sc(200, nullable=True)
    baseline_value = sc(200, nullable=True)
    target_value = sc(200, nullable=True)
    expected_benefit = text()
    expected_timeline = sc(200, nullable=True)
    estimated_cost = num()
    currency_code = sc(3, default="BDT")
    dependencies = text()
    current_state_code = sc(40, default="DRAFT", index=True)
    current_stage_entered_at = ts()
    submitted_at = ts()
    closed_at = ts()
    is_in_idea_bank = flag(False)
    is_awarded = flag(False)
    duplicate_of_id = ref()
    score_latest = num()
    declaration_accepted = flag(False)
    content = json_col()
    is_published_to_catalogue = flag(False)
    implemented_on = ts()


class InitiativeMember(Base, StdColumns):
    __tablename__ = "initiative_members"
    initiative_id = ref(False)
    user_id = ref(False)
    member_role = sc(20, default="CONTRIBUTOR")  # OWNER, CONTRIBUTOR, MENTOR
    credit_share_pct = num()
    joined_at = ts()
    left_at = ts()


class InitiativeVersion(Base, StdColumns):
    __tablename__ = "initiative_versions"
    initiative_id = ref(False)
    version_no = integer(1)
    snapshot = json_col()
    reason = sc(40, default="SUBMIT")


# ---- Shared content (polymorphic: entity_type + entity_id) -------------------
class Comment(Base, StdColumns):
    __tablename__ = "comments"
    entity_type = sc(60, index=True)
    entity_id = ref()
    parent_comment_id = ref()
    body = text()
    visibility = sc(20, default="PUBLIC_TO_TEAM")  # PUBLIC_TO_TEAM, REVIEWERS_ONLY, PANEL_ONLY
    comment_type = sc(30, default="GENERAL")
    deleted_at = ts()


class ClarificationRequest(Base, StdColumns):
    __tablename__ = "clarification_requests"
    entity_type = sc(60, index=True)
    entity_id = ref()
    requested_by = ref()
    question = text()
    answer = text()
    answered_by = ref()
    answered_at = ts()
    due_at = ts()
    status = sc(20, default="OPEN")  # OPEN, ANSWERED, EXPIRED
    pauses_sla = flag(True)
    resume_state = sc(40, nullable=True)  # state to return to once answered


class Attachment(Base, StdColumns):
    __tablename__ = "attachments"
    entity_type = sc(60, index=True)
    entity_id = ref()
    file_name = mapped_column(String)
    mime_type = sc(120, nullable=True)
    size_bytes = integer(0)
    storage_key = mapped_column(String)  # path under UPLOAD_DIR; never a public URL
    checksum_sha256 = sc(64, nullable=True)
    evidence_type_code = sc(40, default="DOCUMENT")
    stage_code = sc(40, nullable=True)
    scan_status = sc(20, default="CLEAN")
    data_classification_code = sc(20, default="INTERNAL")
    is_current = flag(True)


class ExternalLink(Base, StdColumns):
    __tablename__ = "external_links"
    entity_type = sc(60, index=True)
    entity_id = ref()
    link_type = sc(20, default="DOC")  # PROTOTYPE, REPO, VIDEO, DOC, DASHBOARD
    url = mapped_column(String)
    title = sc(200, nullable=True)
