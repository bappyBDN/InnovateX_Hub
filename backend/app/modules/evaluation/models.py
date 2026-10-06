from sqlalchemy import JSON, String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, i18n, integer, json_col, num, ref, text, ts


class RatingScale(Base, StdColumns):
    __tablename__ = "rating_scales"
    code = sc(40, unique=True)
    min_value = integer(1)
    max_value = integer(5)
    step = num()
    levels = json_col(list)  # [{value, label, description}] — what each number means


class Scorecard(Base, StdColumns):
    __tablename__ = "scorecards"
    code = sc(60)
    name_i18n = i18n()
    purpose = sc(30)  # IDEA_REVIEW, METHODOLOGY, PROTOTYPE, FINAL_JURY
    version = integer(1)
    status = sc(20, default="PUBLISHED")
    rating_scale_id = ref()
    total_weight = num()


class ScorecardCriterion(Base, StdColumns):
    __tablename__ = "scorecard_criteria"
    scorecard_id = ref(False)
    code = sc(40)
    name_i18n = i18n()
    guidance_i18n = i18n()
    weight_pct = num()
    min_rating = num()                 # gate: below this average = fail
    comment_required_at = json_col(list)  # e.g. [1, 5]
    is_tie_breaker = flag(False)
    sort_order = integer(0)


class Panel(Base, StdColumns):
    __tablename__ = "panels"
    challenge_id = ref()
    name = sc(150)
    panel_type = sc(20, default="REVIEW")
    chair_user_id = ref()
    is_restricted = flag(False)


class PanelMember(Base, StdColumns):
    __tablename__ = "panel_members"
    panel_id = ref(False)
    user_id = ref(False)
    member_role = sc(20, default="MEMBER")
    vote_weight = num()
    stages = mapped_column(JSON, nullable=True)  # stages this judge may score, e.g. ["METHODOLOGY"]; empty = all stages


class JudgeInvite(Base, StdColumns):
    """Someone invited by email to judge a challenge or an idea. Applied when they sign up with the invitation link."""
    __tablename__ = "judge_invites"
    email = sc(200, index=True)
    invitation_id = ref()
    scope_type = sc(20)              # challenge or initiative
    scope_id = ref()
    stages = json_col(list)
    due_days = integer(10)
    invited_by = ref()
    status = sc(20, default="PENDING")  # PENDING, ACCEPTED, REVOKED


class ReviewRound(Base, StdColumns):
    __tablename__ = "review_rounds"
    challenge_id = ref()               # null for open-idea review
    challenge_phase_id = ref()
    round_type = sc(30)              # IDEA_REVIEW, METHODOLOGY, PROTOTYPE, FINAL_JURY
    name_i18n = i18n()
    scorecard_id = ref()
    panel_id = ref()
    reviewers_per_entry = integer(3)
    assignment_method = sc(20, default="BALANCED_LOAD")
    aggregation_method = sc(30, default="MEAN")
    normalize_scores = flag(False)
    disagreement_threshold = num()
    blind = flag(False)
    show_scores_to_entrants = sc(20, default="TOTAL_ONLY")  # NONE, TOTAL_ONLY, PER_CRITERION
    opens_at = ts()
    due_at = ts()
    status = sc(20, default="SETUP")  # SETUP, IN_PROGRESS, COMPLETED, PUBLISHED


class ConflictOfInterestDeclaration(Base, StdColumns):
    __tablename__ = "conflict_of_interest_declarations"
    review_round_id = ref()
    reviewer_user_id = ref()
    entity_type = sc(60)
    entity_id = ref()
    source = sc(20, default="SYSTEM_DETECTED")
    reason = sc(30)
    note = text()
    status = sc(20, default="EXCLUDED")


class ReviewAssignment(Base, StdColumns):
    __tablename__ = "review_assignments"
    review_round_id = ref(False)
    reviewer_user_id = ref(False)
    entity_type = sc(40)             # challenge_entry or initiative
    entity_id = ref(False)
    submission_version_id = ref()
    status = sc(20, default="ASSIGNED", index=True)  # ASSIGNED, IN_PROGRESS, SUBMITTED, DECLINED_COI
    due_at = ts()
    started_at = ts()
    submitted_at = ts()
    reviewer_weight = num()


class ReviewScore(Base, StdColumns):
    __tablename__ = "review_scores"
    review_assignment_id = ref(False)
    scorecard_criterion_id = ref(False)
    rating = num()
    comment = text()


class ReviewSummary(Base, StdColumns):
    __tablename__ = "review_summaries"
    review_assignment_id = ref(False)
    weighted_score = num()             # 0-100, always calculated by the server
    normalized_score = num()
    recommendation = sc(30, nullable=True)  # STRONG_YES, YES, MAYBE, NO
    strengths = text()                 # shared with the entrant, anonymised
    improvements = text()
    private_note = text()              # panel only


class RoundResult(Base, StdColumns):
    __tablename__ = "round_results"
    review_round_id = ref(False)
    entity_type = sc(40)
    entity_id = ref(False)
    reviews_expected = integer(0)
    reviews_completed = integer(0)
    raw_score = num()
    normalized_score = num()
    final_score = num()
    criterion_averages = json_col()
    failed_gates = json_col(list)
    needs_discussion = flag(False)
    disagreement_criteria = json_col(list)
    discussion_resolved = flag(False)
    discussion_resolution = sc(30, nullable=True)
    discussion_note = text()
    rank = integer()
    calculated_at = ts()
    is_frozen = flag(False)


class Feedback(Base, StdColumns):
    __tablename__ = "feedback"
    entity_type = sc(40, index=True)
    entity_id = ref()
    review_round_id = ref()
    strengths = text()
    improvements = text()
    decision_code = sc(30, nullable=True)
    decision_reason = text()
    next_steps = text()
    score_shared = num()
    criterion_scores = json_col()
    written_by = ref()
    published_at = ts()
    read_at = ts()


class Appeal(Base, StdColumns):
    __tablename__ = "appeals"
    entity_type = sc(40)
    entity_id = ref()
    feedback_id = ref()
    raised_by = ref()
    reason = text()
    status = sc(20, default="OPEN")  # OPEN, UPHELD, DISMISSED
    decided_by = ref()
    decision_note = text()
    decided_at = ts()


class ShortlistRule(Base, StdColumns):
    __tablename__ = "shortlist_rules"
    review_round_id = ref(False)
    method = sc(30, default="TOP_N")  # TOP_N, THRESHOLD, TOP_N_WITH_THRESHOLD, TOP_PERCENT, MANUAL
    top_n = integer()
    min_score = num()
    top_percent = num()
    waitlist_size = integer(0)
    tie_break_rules = json_col(list)
    exclude_failed_gates = flag(True)
    require_all_reviews_done = flag(True)


class Shortlist(Base, StdColumns):
    __tablename__ = "shortlists"
    review_round_id = ref(False)
    shortlist_type = sc(30, default="SHORTLIST")  # SHORTLIST, FINALISTS
    status = sc(20, default="PROPOSED")  # PROPOSED, CONFIRMED, PUBLISHED
    generated_at = ts()
    confirmed_by = ref()
    confirmed_at = ts()
    published_at = ts()
    rule_snapshot = json_col()


class ShortlistEntry(Base, StdColumns):
    __tablename__ = "shortlist_entries"
    shortlist_id = ref(False)
    entity_type = sc(40, default="challenge_entry")
    entity_id = ref(False)
    final_score = num()
    rank = integer()
    system_decision = sc(20)  # IN, WAITLIST, OUT
    final_decision = sc(20)
    is_override = flag(False)
    override_reason = text()
    prototype_required = flag(False)
    prototype_reason = text()


class StageGate(Base, StdColumns):
    """A prototype or pilot sent for review. The candidate fills a short form (link, how to use it / pilot report);
    judges chosen by the admin each approve, send it back for changes or reject. One row per round of submission."""
    __tablename__ = "stage_gates"
    entity_type = sc(40, index=True)     # initiative or challenge_entry
    entity_id = ref(False)
    stage = sc(20)                       # PROTOTYPE or PILOT
    round_no = integer(1)
    content = json_col()                 # the answers, keyed by field
    status = sc(20, default="DRAFT", index=True)   # DRAFT, IN_REVIEW, APPROVED, CHANGES_REQUESTED, REJECTED
    submitted_by = ref()
    submitted_at = ts()
    decided_by = ref()                   # set when the admin made the final call; empty = decided by the judges
    decided_at = ts()
    decision_note = text()


class StageGateVote(Base, StdColumns):
    """One judge's decision on a prototype or pilot review."""
    __tablename__ = "stage_gate_votes"
    gate_id = ref(False)
    judge_user_id = ref(False)
    decision = sc(20, nullable=True)     # APPROVE, REVISE, REJECT; empty = not decided yet
    feedback = text()
    decided_at = ts()
