import type { JourneyStage } from '@/components/domain';
import type { I18nText } from '@/utils/i18n';

export interface NextStep {
  text: string;
  action_label: string | null;
  action_path: string | null;
  due_at?: string | null;
  tone?: 'info' | 'warning' | 'success' | 'danger';
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
  challenge: { id: string; slug: string; code: string; title_i18n: I18nText; status_code: string };
  team: { id: string; name: string; member_count: number } | null;
  journey: JourneyStage[];
  next_step: NextStep;
  is_finished: boolean;
}

export interface PhaseBrief {
  phase_type: string;
  name_i18n: I18nText;
  opens_at: string | null;
  closes_at: string | null;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'SKIPPED';
}

export interface ChallengeCardData {
  id: string;
  code: string;
  slug: string;
  title_i18n: I18nText;
  status_code: string;
  domain: { id: string; code: string; name_i18n: I18nText } | null;
  banner_color: string | null;
  participation_mode: 'INDIVIDUAL' | 'TEAM' | 'BOTH';
  team_min_size: number;
  team_max_size: number;
  problem_statement_i18n: I18nText;
  total_prize_budget: number | null;
  currency_code: string;
  current_phase: PhaseBrief | null;
  registration: { is_open: boolean; opens_at: string | null; closes_at: string | null; count: number | null };
  eligibility: { eligible: boolean; reason: string | null };
  my_entry_id: string | null;
  published_at: string | null;
  results_published_at: string | null;
}

export interface Criterion {
  name: string;
  name_i18n: I18nText;
  guidance: string;
  weight_pct: number;
}

export interface ChallengeDetailData extends ChallengeCardData {
  background_i18n: I18nText;
  expected_outcome_i18n: I18nText;
  rules_i18n: I18nText;
  prototype_policy: string;
  blind_review: boolean;
  sponsor: { full_name: string; job_title: string | null } | null;
  allow_cross_org_teams: boolean;
  who_can_join: string;
  phases: Array<PhaseBrief & { id: string; sequence_no: number; note: string | null }>;
  prizes: Array<{
    rank_from: number;
    rank_to: number;
    prize_type: string;
    description: string;
    amount: number | null;
    currency_code: string;
  }>;
  methodology_criteria: Criterion[];
  final_criteria: Criterion[];
  resources: Array<{
    id: string;
    title: string;
    resource_type: string;
    access_level: string;
    locked: boolean;
    url: string | null;
    locked_reason: string | null;
  }>;
  my_entry: EntryCardData | null;
}

export interface Question {
  id: string;
  question: string;
  answer: string | null;
  is_published: boolean;
  asked_at: string | null;
  answered_at: string | null;
  is_mine: boolean;
  asked_by: string | null;
  answered_by: string | null;
}
