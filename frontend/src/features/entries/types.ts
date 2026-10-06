import type { FormDefinition, FormValue, JourneyStage } from '@/components/domain';
import type { I18nText } from '@/utils/i18n';

export interface NextStep {
  text: string;
  action_label: string | null;
  action_path: string | null;
  due_at: string | null;
  tone: 'info' | 'warning' | 'success' | 'danger';
}

export interface UserBrief {
  id: string;
  full_name: string;
  job_title?: string | null;
  org_unit?: string | null;
}

export interface EntryCardData {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  entry_type: 'INDIVIDUAL' | 'TEAM';
  status_code: string;
  registered_at: string | null;
  prototype_required: boolean;
  final_rank: number | null;
  challenge: { id: string; slug: string; code: string; title_i18n: I18nText; status_code: string; prototype_policy: string };
  team: { id: string; name: string; member_count: number } | null;
  lead: UserBrief | null;
  journey: JourneyStage[];
  next_step: NextStep;
  is_finished: boolean;
}

export interface SubmissionInfo {
  type: 'METHODOLOGY' | 'PROTOTYPE' | 'FINAL_PROJECT';
  path: string;
  status: string;
  submission_id: string | null;
  version_no: number;
  submitted_at: string | null;
  completeness_pct: number;
  opens_at: string | null;
  closes_at: string | null;
  window_open: boolean;
  required: boolean;
}

export interface Clarification {
  id: string;
  question: string;
  answer: string | null;
  status: 'OPEN' | 'ANSWERED' | 'EXPIRED';
  due_at: string | null;
  asked_at: string | null;
  answered_at: string | null;
}

export interface EntryDetail extends EntryCardData {
  submissions: SubmissionInfo[];
  feedback_available: boolean;
  clarifications: Clarification[];
  is_member: boolean;
  is_lead: boolean;
  can_withdraw: boolean;
  show_shortlist_moment: boolean;
  current_score?: number | null;
  current_rank?: number | null;
}

export interface SubmissionState {
  kind: string;
  label: string;
  submission_id: string | null;
  entry: { id: string; code: string; title: string; status_code: string; challenge_title_i18n: I18nText; challenge_slug: string };
  form: FormDefinition | null;
  content: FormValue;
  status: string;
  version_no: number;
  submitted_at: string | null;
  has_unsubmitted_changes: boolean;
  completeness_pct: number;
  window: { opens_at: string | null; closes_at: string | null; is_open: boolean };
  can_edit: boolean;
  can_submit: boolean;
  read_only_reason: string | null;
}

export interface MilestoneRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  owner_user_id: string | null;
  owner: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
  completed_at: string | null;
  sort_order: number | null;
}

export interface ProgressUpdateRow {
  id: string;
  update_text: string;
  percent_complete: number | null;
  blockers: string | null;
  help_needed: string | null;
  posted_by_name: string | null;
  created_at: string | null;
}

export interface MilestonesData {
  milestones: MilestoneRow[];
  percent_complete: number;
  updates: ProgressUpdateRow[];
}

export interface DemoData {
  event: { id: string; title: string; starts_at: string; ends_at: string; location: string | null; online_link: string | null } | null;
  slots: Array<{ id: string; starts_at: string; duration_min: number; available: boolean; is_mine: boolean }>;
  my_slot: { id: string; starts_at: string; duration_min: number } | null;
  can_book: boolean;
  reschedule_locked?: boolean;
  checklist?: string[];
  message: string | null;
}

export interface FeedbackItem {
  id: string;
  round: string;
  decision_code: string | null;
  strengths: string | null;
  improvements: string | null;
  decision_reason: string | null;
  next_steps: string | null;
  score_shared: number | null;
  criterion_scores: Record<string, number>;
  judge_comments: Record<string, string[]>;
  published_at: string | null;
  appeal: { id: string; status: string; reason: string; decision_note: string | null } | null;
  can_appeal: boolean;
  appeal_deadline: string | null;
}

export interface FeedbackData {
  entry: { id: string; code: string; title: string; status_code: string };
  items: FeedbackItem[];
}
