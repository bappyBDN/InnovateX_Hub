import type { I18nText } from '@/utils/i18n';
import type { ChecklistItem, UserBrief } from '../builder/types';

export interface PhaseInfo {
  id: string;
  phase_type: string;
  name_i18n: I18nText;
  sequence_no: number;
  opens_at: string;
  closes_at: string;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'SKIPPED';
  note: string | null;
}

export interface RoundInfo {
  id: string;
  round_type: string;
  name: string;
  status: string;
  reviewers_per_entry: number;
  aggregation_method: string;
  blind: boolean;
  due_at: string | null;
  assigned: number;
  submitted: number;
  overdue: number;
  shortlist: { id: string; status: string } | null;
}

export interface DemoSlotInfo {
  id: string;
  starts_at: string;
  duration_min: number;
  status: string;
  entry: { id: string; code: string; title: string } | null;
}

export interface CentreDetail {
  id: string;
  code: string;
  slug: string;
  title_i18n: I18nText;
  status_code: string;
  domain: { id: string; name_i18n: I18nText } | null;
  current_phase: { phase_type: string; name_i18n: I18nText; opens_at: string; closes_at: string; status: string } | null;
  registration: { is_open: boolean; closes_at: string | null; count: number | null };
  phases: PhaseInfo[];
  numbers: {
    registered: number;
    teams: number;
    methodologies_submitted: number;
    reviews_assigned: number;
    reviews_done: number;
    reviews_overdue: number;
    reviews_done_pct: number;
    shortlisted: number;
    finalists: number;
    winners: number;
    shortlists_waiting: number;
    feedback_published: number;
  };
  judges: (UserBrief | null)[];
  rounds: RoundInfo[];
  publish_checklist: ChecklistItem[];
  owner: UserBrief | null;
  sponsor: UserBrief | null;
  results_status: 'DRAFT' | 'APPROVED' | 'PUBLISHED' | null;
  demo_event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    location: string | null;
    online_link: string | null;
    slots: DemoSlotInfo[];
  } | null;
  can_manage: boolean;
  /** Only the admin chooses judges and shares entries among them. */
  can_assign_judges: boolean;
}

export interface EntryRow {
  id: string;
  code: string;
  title: string;
  entry_type: string;
  status_code: string;
  team: string | null;
  lead: string | null;
  registered_at: string | null;
  methodology_status: string;
  methodology_submission_id: string | null;
  current_score: number | null;
  current_rank: number | null;
  prototype_required: boolean;
}

export interface QuestionRow {
  id: string;
  question: string;
  answer: string | null;
  is_published: boolean;
  asked_at: string | null;
  answered_at: string | null;
  asked_by: string | null;
  answered_by: string | null;
}

export interface ActivityRow {
  at: string | null;
  who: string;
  what: string;
  kind: string;
}

export interface AssignResult {
  created: number;
  entries: number;
  exclusions: { reviewer: string; entry: string; reason: string }[];
  short_of_reviewers: string[];
}

export interface TabProps {
  detail: CentreDetail;
  /** Refetch the control-centre detail and anything that depends on it. */
  refresh: () => Promise<unknown>;
}
