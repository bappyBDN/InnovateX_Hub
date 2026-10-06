from sqlalchemy import String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import (Base, BusinessColumns, StdColumns, sc, flag, i18n, integer, json_col, num, ref,
                                    text, ts)


class Challenge(Base, BusinessColumns):
    __tablename__ = "challenges"
    code = sc(30, unique=True)  # CHL-2026-007
    title_i18n = i18n()
    slug = sc(150, unique=True)
    domain_id = ref()
    category_id = ref()
    problem_statement_i18n = i18n()
    background_i18n = i18n()
    expected_outcome_i18n = i18n()
    rules_i18n = i18n()
    banner_color = sc(20, nullable=True)
    sponsor_user_id = ref()
    program_owner_user_id = ref()
    participation_mode = sc(20, default="BOTH")  # INDIVIDUAL, TEAM, BOTH
    team_min_size = integer(1)
    team_max_size = integer(5)
    max_entries_per_user = integer(1)
    allow_cross_org_teams = flag(True)
    prototype_policy = sc(20, default="PANEL_DECIDES")  # NONE, OPTIONAL, REQUIRED_ALL, PANEL_DECIDES
    blind_review = flag(False)
    peoples_choice_enabled = flag(False)
    leaderboard_enabled = flag(False)
    show_registration_count = flag(True)
    publish_winner_summaries = flag(True)
    data_classification_code = sc(20, default="INTERNAL")
    visibility = sc(20, default="ALL_EMPLOYEES")
    status_code = sc(40, default="DRAFT", index=True)
    total_prize_budget = num()
    currency_code = sc(3, default="BDT")
    published_at = ts()
    closed_at = ts()
    results_published_at = ts()
    results_approved_by = ref()
    results_approved_at = ts()


class ChallengePhase(Base, StdColumns):
    """The configurable timeline. A challenge without a prototype phase simply has no row for it."""
    __tablename__ = "challenge_phases"
    challenge_id = ref(False)
    phase_type = sc(30)
    name_i18n = i18n()
    sequence_no = integer(1)
    opens_at = ts()
    closes_at = ts()
    grace_minutes = integer(0)
    submission_form_template_id = ref()
    who_can_submit = sc(30, default="ALL_REGISTERED")
    allow_resubmit_until_close = flag(True)
    auto_lock_on_close = flag(True)
    review_round_id = ref()
    status = sc(20, default="UPCOMING")  # UPCOMING, OPEN, CLOSED, SKIPPED
    instructions_i18n = i18n()


class ChallengeEligibilityRule(Base, StdColumns):
    __tablename__ = "challenge_eligibility_rules"
    challenge_id = ref(False)
    rule_type = sc(30)  # ORG_UNIT, GRADE, EXCLUDE_USER
    rule_value = json_col()
    include = flag(True)


class ChallengePrize(Base, StdColumns):
    __tablename__ = "challenge_prizes"
    challenge_id = ref(False)
    rank_from = integer(1)
    rank_to = integer(1)
    award_category_id = ref()
    prize_type = sc(20, default="CASH")
    description_i18n = i18n()
    amount = num()
    currency_code = sc(3, default="BDT")


class ChallengeResource(Base, StdColumns):
    __tablename__ = "challenge_resources"
    challenge_id = ref(False)
    resource_type = sc(30, default="DOC")
    title = sc(200)
    url = mapped_column(String, nullable=True)
    access_level = sc(20, default="REGISTERED")  # PUBLIC, REGISTERED, SHORTLISTED


class ChallengeQuestion(Base, StdColumns):
    __tablename__ = "challenge_questions"
    challenge_id = ref(False)
    asked_by = ref()
    question = text()
    answer = text()
    answered_by = ref()
    answered_at = ts()
    is_published = flag(False)
    is_anonymous = flag(True)


class ChallengeEntry(Base, BusinessColumns):
    """One registration in a challenge: one person or one team."""
    __tablename__ = "challenge_entries"
    code = sc(40, unique=True)  # ENT-2026-007-0042
    challenge_id = ref(False)
    entry_type = sc(20, default="INDIVIDUAL")
    team_id = ref()
    lead_user_id = ref(False)
    title = mapped_column(String)
    summary = mapped_column(String, nullable=True)
    status_code = sc(40, default="REGISTERED", index=True)
    registered_at = ts()
    withdrawn_at = ts()
    withdraw_reason = text()
    prototype_required = flag(False)
    current_score = num()
    current_rank = integer()
    final_rank = integer()
    converted_initiative_id = ref()
    anonymous_alias = sc(30, nullable=True)
    registration_answers = json_col()
    declarations_accepted_at = ts()
    shortlist_moment_seen = flag(False)


class Team(Base, StdColumns):
    __tablename__ = "teams"
    name = sc(120)
    challenge_id = ref()
    lead_user_id = ref()
    is_locked = flag(False)
    locked_at = ts()
    description = text()


class TeamMember(Base, StdColumns):
    __tablename__ = "team_members"
    team_id = ref(False)
    user_id = ref(False)
    member_role = sc(20, default="MEMBER")  # LEAD, MEMBER
    credit_share_pct = num()
    status = sc(20, default="ACTIVE")  # ACTIVE, LEFT, REMOVED
    skills_contributed = text()
    joined_at = ts()
    left_at = ts()


class TeamInviteLink(Base, StdColumns):
    """Shareable join link. Only the SHA-256 of the token is stored; the raw token is shown once."""
    __tablename__ = "team_invite_links"
    team_id = ref(False)
    token_hash = sc(64, unique=True)
    token_hint = sc(12, nullable=True)
    expires_at = ts()
    max_uses = integer()
    use_count = integer(0)
    status = sc(20, default="ACTIVE")  # ACTIVE, REVOKED, EXPIRED, EXHAUSTED
    revoked_at = ts()
    revoked_by = ref()


class TeamJoinRequest(Base, StdColumns):
    __tablename__ = "team_join_requests"
    team_id = ref(False)
    invite_link_id = ref()
    user_id = ref(False)
    message = text()
    status = sc(20, default="PENDING")  # PENDING, APPROVED, DECLINED, CANCELLED
    decided_by = ref()
    decided_at = ts()
    decline_reason = text()


class EntrySubmission(Base, BusinessColumns):
    """One flexible structure for methodology, prototype and final submissions."""
    __tablename__ = "entry_submissions"
    challenge_entry_id = ref(False)
    challenge_phase_id = ref()
    submission_type = sc(20)  # METHODOLOGY, PROTOTYPE, FINAL_PROJECT
    status = sc(20, default="DRAFT")  # DRAFT, SUBMITTED, LOCKED
    current_version_no = integer(0)
    form_template_id = ref()
    content = json_col()
    submitted_at = ts()
    submitted_by = ref()
    locked_at = ts()
    is_late = flag(False)
    completeness_pct = integer(0)


class SubmissionVersion(Base, StdColumns):
    """Immutable snapshot on each submit; content_hash proves what was submitted."""
    __tablename__ = "submission_versions"
    entry_submission_id = ref(False)
    version_no = integer(1)
    content = json_col()
    submitted_at = ts()
    submitted_by = ref()
    content_hash = sc(64, nullable=True)
