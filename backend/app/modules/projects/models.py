"""Project rewards and progress tracking.

`projects` is a local copy of the ProjectFlow projects that pass the filter (Digital Transformation department,
AI Analyst / AI analytics function, manager in the same), extended with the progress-sync columns. ProjectFlow is only
ever read; everything written here lives in this app's database."""
from sqlalchemy import Date, DateTime, Index, Integer, Numeric, UniqueConstraint
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, flag, json_col, num, ref, sc, text, ts, utcnow

PROGRESS_SOURCES = ("projectflow", "process_brain")
TEAMS = ("AI", "AES")
CHALLENGE_STATUSES = ("Active", "Achieved", "Expired")
MEMBER_ROLES = ("Project Manager", "Team Lead", "Developer")


class Project(Base, StdColumns):
    __tablename__ = "projects"
    external_id = mapped_column(Integer, unique=True, index=True, nullable=True)   # projects.id in ProjectFlow
    code = sc(40, index=True)
    name = sc(300)
    objective = text()
    company = sc(200, nullable=True)
    department = sc(200, nullable=True)
    function = sc(200, nullable=True)
    status = sc(40, nullable=True)
    health = sc(20, nullable=True)
    start_date = ts()
    # Progress (always read from ProjectFlow)
    completion_percentage = mapped_column(Integer, default=0)
    due_date = mapped_column(DateTime, nullable=True)

    progress_source = sc(20, default="projectflow")
    projectflow_completion = num()                  # ProjectFlow's own figure, kept for comparison
    total_items = mapped_column(Integer, nullable=True)       # top-level tasks in ProjectFlow
    completed_items = mapped_column(Integer, nullable=True)   # of which completed
    last_synced_at = ts()
    last_sync_error = text()
    is_eligible = flag(True)                        # false once it no longer passes the filter in ProjectFlow
    imported_at = ts()
    details = json_col()                            # objective, expected outcome, type, priority, sponsor, dates
    tasks = json_col(list)                          # top-level tasks with progress and RACI names
    # Process Brain
    team = sc(20, nullable=True)                    # AI | AES
    pb_id = sc(120, nullable=True, index=True)      # project id in Process Brain (PRJ-0001, AES-buildstrong)
    processes = json_col(list)                      # linked process groups: sub-processes and RACI people
    phases = json_col()                             # {req, dev, test, go} as 0..1
    week_baseline = json_col()                      # {week, pct}: progress when this week began (weekly score)


class ProjectMember(Base, StdColumns):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "external_user_id", "role", name="uq_project_member"),)
    project_id = ref(False)
    external_user_id = mapped_column(Integer, nullable=True)   # users.id in ProjectFlow
    user_id = ref()                                 # matching InnovateX account (by email), when there is one
    full_name = sc(200)
    email = sc(200, nullable=True)
    designation = sc(200, nullable=True)
    department = sc(200, nullable=True)
    function = sc(200, nullable=True)
    role = sc(40)                                   # Project Manager | Team Lead | Developer
    assigned_manually = flag(False)                 # a Team Lead chosen here survives the next import


class ProjectChallenge(Base, StdColumns):
    __tablename__ = "project_challenges"
    __table_args__ = (Index("ix_project_challenges_project_status", "project_id", "status"),)
    challenge_id = sc(20, unique=True, index=True)  # RC-00001
    project_id = ref(False)
    reward_amount = mapped_column(Numeric(14, 2))   # BDT
    target_date = mapped_column(DateTime)
    deadline_source = sc(20, nullable=True)         # projectflow = follows the project deadline; custom = set by admin
    target_percentage = mapped_column(Integer, default=100)
    status = sc(20, default="Active")               # Active | Achieved | Expired
    note = text()
    achieved_at = ts()
    notified = json_col(list)                       # [{name, email, role}] the alert went to
    recipients = json_col(list)                     # [{key, name, email, role}] everyone chosen for the reward
    # created_at comes from StdColumns


class ProjectScorecard(Base, StdColumns):
    """One week's team score for a project, worked out automatically on every sync (rules in scoring.py).
    One row per project and week; the current week is the score so far and is final once the week is over."""
    __tablename__ = "project_scorecards"
    __table_args__ = (UniqueConstraint("project_id", "week_start", name="uq_project_scorecard_week"),)
    project_id = ref(False)
    week_start = mapped_column(Date)                 # first day of the week (company time zone)
    progress_start = num()                           # % complete when the week began
    progress_end = num()                             # % complete when the week was scored
    weeks_left = mapped_column(Integer, nullable=True)
    required_pct = num()                             # weekly required progress (percentage points)
    quality = num()                                  # no longer scored (kept for old rows)
    deadline = num()                                 # 0..20
    communication = num()                            # 0..15
    missed_deadlines = mapped_column(Integer, default=0)
    rework = mapped_column(Integer, default=0)       # no longer scored (kept for old rows)
    missing_updates = mapped_column(Integer, default=0)
    target_points = num()                            # 0..65, calculated
    deductions = num()                               # calculated
    total = num()                                    # 0..100, calculated
    note = text()
    signals = json_col()                             # what the score was worked out from (tasks, update days, …)
    is_final = flag(False)                           # the week is over: no longer recalculated
