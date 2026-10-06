"""Build, demo, impact, awards and catalogue tables."""
from sqlalchemy import Date, String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, i18n, integer, json_col, num, ref, text, ts


class Milestone(Base, StdColumns):
    __tablename__ = "milestones"
    entity_type = sc(60, index=True)
    entity_id = ref()
    title = sc(250)
    description = text()
    due_date = mapped_column(Date, nullable=True)
    owner_user_id = ref()
    status = sc(20, default="PLANNED")  # PLANNED, IN_PROGRESS, DONE, BLOCKED
    completed_at = ts()
    sort_order = integer(0)


class ProgressUpdate(Base, StdColumns):
    __tablename__ = "progress_updates"
    entity_type = sc(60, index=True)
    entity_id = ref()
    update_text = text()
    percent_complete = integer(0)
    blockers = text()
    help_needed = text()
    posted_by = ref()


class DemoEvent(Base, StdColumns):
    __tablename__ = "demo_events"
    challenge_id = ref()
    title = sc(200)
    starts_at = ts()
    ends_at = ts()
    location = sc(200, nullable=True)
    online_link = mapped_column(String, nullable=True)
    status = sc(20, default="SCHEDULED")


class DemoSlot(Base, StdColumns):
    __tablename__ = "demo_slots"
    demo_event_id = ref(False)
    entity_type = sc(60, nullable=True)
    entity_id = ref()
    starts_at = ts()
    duration_min = integer(20)
    status = sc(20, default="OPEN")  # OPEN, BOOKED, DONE


class Kpi(Base, StdColumns):
    __tablename__ = "kpis"
    entity_type = sc(60, index=True)
    entity_id = ref()
    name = sc(200)
    benefit_type_code = sc(40, nullable=True)
    unit_code = sc(20, default="hours")
    direction = sc(20, default="DECREASE")
    baseline_value = num()
    baseline_period = sc(60, nullable=True)
    target_value = num()
    target_date = mapped_column(Date, nullable=True)
    is_primary = flag(False)


class KpiMeasurement(Base, StdColumns):
    __tablename__ = "kpi_measurements"
    kpi_id = ref(False)
    period_start = mapped_column(Date, nullable=True)
    period_end = mapped_column(Date, nullable=True)
    measured_value = num()
    source = sc(20, default="MANUAL")
    measured_by = ref()
    note = text()
    # verification (folded in from impact_verifications for the demo)
    verification_status = sc(20, default="UNVERIFIED")  # UNVERIFIED, VERIFIED, ADJUSTED, REJECTED
    verification_type = sc(20, nullable=True)           # BUSINESS, FINANCE, TECHNICAL
    verified_value = num()
    verifier_user_id = ref()
    verification_note = text()
    verified_at = ts()


class KpiVerifierAssignment(Base, StdColumns):
    """The person the admin chose to verify one KPI measurement. It then appears in that person's judging panel."""
    __tablename__ = "kpi_verifier_assignments"
    measurement_id = ref(False)
    verifier_user_id = ref(False)
    assigned_by = ref()


class PresentationRequest(Base, StdColumns):
    """A finalist proposes a time for the live presentation; the admin accepts it or suggests another time."""
    __tablename__ = "presentation_requests"
    entry_id = ref(False)
    proposed_start = ts()
    proposed_by = ref()
    note = text()
    status = sc(20, default="PROPOSED")       # PROPOSED, COUNTER_PROPOSED, ACCEPTED, CANCELLED
    suggested_start = ts()                   # the admin's other suggestion
    admin_note = text()
    decided_by = ref()
    decided_at = ts()
    scheduled_start = ts()                   # the confirmed time


class BenefitRecord(Base, StdColumns):
    __tablename__ = "benefit_records"
    entity_type = sc(60)
    entity_id = ref()
    benefit_type_code = sc(40)
    period_label = sc(40, nullable=True)
    amount = num()
    currency_code = sc(3, default="BDT")
    hours_saved = num()
    is_verified = flag(False)


class AwardCategory(Base, StdColumns):
    __tablename__ = "award_categories"
    code = sc(60, unique=True)
    name_i18n = i18n()
    description_i18n = i18n()
    eligibility_rules = json_col()
    is_active = flag(True)


class AwardDecision(Base, StdColumns):
    __tablename__ = "award_decisions"
    challenge_id = ref()
    award_category_id = ref()
    entity_type = sc(60)
    entity_id = ref()
    rank = integer(1)  # 1 = winner
    result = sc(20, default="WINNER")  # WINNER, RUNNER_UP
    decision_note = text()
    jury_score = num()
    approved_by = ref()
    approved_at = ts()
    publication_status = sc(20, default="DRAFT")  # DRAFT, APPROVED, PUBLISHED
    published_at = ts()


class Reward(Base, StdColumns):
    __tablename__ = "rewards"
    recipient_user_id = ref(False)
    source_type = sc(40)
    source_id = ref()
    reward_type = sc(20, default="CASH")
    title = sc(200, nullable=True)
    amount = num()
    currency_code = sc(3, default="BDT")
    share_pct = num()
    status = sc(20, default="PROPOSED")  # PROPOSED, APPROVED, SENT_TO_HR, PAID
    hr_reference = sc(100, nullable=True)
    approved_by = ref()
    approved_at = ts()


class Badge(Base, StdColumns):
    __tablename__ = "badges"
    code = sc(60, unique=True)
    name_i18n = i18n()
    description_i18n = i18n()
    icon = sc(40, nullable=True)
    rule = json_col()
    is_active = flag(True)


class UserBadge(Base, StdColumns):
    __tablename__ = "user_badges"
    user_id = ref(False)
    badge_id = ref(False)
    source_entity_type = sc(60, nullable=True)
    source_entity_id = ref()
    awarded_at = ts()


class PointsLedger(Base, StdColumns):
    """Append-only. Points are given for quality steps, never for raw submission count."""
    __tablename__ = "points_ledger"
    user_id = ref(False)
    points = integer(0)
    reason_code = sc(40)
    source_entity_type = sc(60, nullable=True)
    source_entity_id = ref()


class ReusableAsset(Base, StdColumns):
    __tablename__ = "reusable_assets"
    code = sc(40, unique=True)
    title = sc(250)
    description = text()
    asset_type = sc(20, default="COMPONENT")
    source_initiative_id = ref()
    owner_user_id = ref()
    repo_url = mapped_column(String, nullable=True)
    maturity = sc(20, default="PRODUCTION")
    technology = sc(200, nullable=True)
    impact_summary = text()
    reused_by = json_col(list)
    data_classification_code = sc(20, default="INTERNAL")
    is_published = flag(True)
    published_at = ts()
