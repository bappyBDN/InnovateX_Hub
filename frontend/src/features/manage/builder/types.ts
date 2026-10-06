import type { I18nText } from '@/utils/i18n';

export interface PhaseRow {
  phase_type: string;
  name?: string | null;
  opens_at: string; // ISO UTC, '' while not set
  closes_at: string;
}

export interface PrizeRow {
  rank_from: number;
  rank_to: number;
  prize_type: string;
  description: string;
  amount: number | null;
}

/** Mirrors `ChallengeIn` in backend/app/modules/challenges/router.py. */
export interface ChallengeConfig {
  title: string;
  title_bn: string | null;
  domain_id: string | null;
  category_id: string | null;
  sponsor_user_id: string | null;
  banner_color: string | null;
  problem_statement: string;
  background: string;
  expected_outcome: string;
  rules: string;
  participation_mode: string;
  team_min_size: number;
  team_max_size: number;
  allow_cross_org_teams: boolean;
  eligibility_org_unit_ids: string[];
  phases: PhaseRow[];
  methodology_form_id: string | null;
  prototype_form_id: string | null;
  final_form_id: string | null;
  methodology_scorecard_id: string | null;
  final_scorecard_id: string | null;
  judge_user_ids: string[];
  reviewers_per_entry: number;
  blind_review: boolean;
  aggregation_method: string;
  show_scores_to_entrants: string;
  shortlist_method: string;
  top_n: number | null;
  min_score: number | null;
  top_percent: number | null;
  waitlist_size: number;
  prototype_policy: string;
  prizes: PrizeRow[];
  publish_winner_summaries: boolean;
  peoples_choice_enabled: boolean;
  leaderboard_enabled: boolean;
  show_registration_count: boolean;
}

export const REQUIRED_PHASES = ['REGISTRATION', 'METHODOLOGY', 'METHODOLOGY_REVIEW'];
export const PHASE_TYPES = [
  'REGISTRATION',
  'METHODOLOGY',
  'METHODOLOGY_REVIEW',
  'SHORTLIST',
  'BUILD',
  'PROTOTYPE',
  'PROTOTYPE_REVIEW',
  'FINAL_SUBMISSION',
  'DEMO',
  'JUDGING',
  'RESULTS',
];
export const BANNER_COLORS = ['#0B6E6E', '#2459A6', '#1E7F4F', '#B26B00', '#B42318', '#7A4FB5', '#0E7490', '#55657A'];

export function emptyConfig(): ChallengeConfig {
  return {
    title: '',
    title_bn: null,
    domain_id: null,
    category_id: null,
    sponsor_user_id: null,
    banner_color: BANNER_COLORS[0],
    problem_statement: '',
    background: '',
    expected_outcome: '',
    rules: '',
    participation_mode: 'BOTH',
    team_min_size: 1,
    team_max_size: 5,
    allow_cross_org_teams: true,
    eligibility_org_unit_ids: [],
    phases: REQUIRED_PHASES.map((p) => ({ phase_type: p, opens_at: '', closes_at: '' })),
    methodology_form_id: null,
    prototype_form_id: null,
    final_form_id: null,
    methodology_scorecard_id: null,
    final_scorecard_id: null,
    judge_user_ids: [],
    reviewers_per_entry: 3,
    blind_review: false,
    aggregation_method: 'MEAN',
    show_scores_to_entrants: 'TOTAL_ONLY',
    shortlist_method: 'TOP_N',
    top_n: 5,
    min_score: null,
    top_percent: null,
    waitlist_size: 2,
    prototype_policy: 'PANEL_DECIDES',
    prizes: [],
    publish_winner_summaries: true,
    peoples_choice_enabled: false,
    leaderboard_enabled: false,
    show_registration_count: true,
  };
}

/** Body for POST/PUT: phases without both dates are left out so the API never gets an invalid datetime. */
export function toPayload(cfg: ChallengeConfig): ChallengeConfig {
  return { ...cfg, phases: cfg.phases.filter((p) => p.opens_at && p.closes_at) };
}

export interface TimelineIssue {
  tone: 'danger' | 'warning';
  code: 'missing' | 'incomplete' | 'window' | 'gap' | 'duplicate';
  phase: string;
  other?: string;
}

export function timelineIssues(phases: PhaseRow[]): TimelineIssue[] {
  const out: TimelineIssue[] = [];
  const types = phases.map((p) => p.phase_type);
  for (const r of REQUIRED_PHASES) if (!types.includes(r)) out.push({ tone: 'danger', code: 'missing', phase: r });
  types.forEach((ty, i) => {
    if (types.indexOf(ty) !== i) out.push({ tone: 'danger', code: 'duplicate', phase: ty });
  });
  for (const p of phases) {
    if (!p.opens_at || !p.closes_at) out.push({ tone: 'warning', code: 'incomplete', phase: p.phase_type });
    else if (new Date(p.closes_at) <= new Date(p.opens_at)) out.push({ tone: 'danger', code: 'window', phase: p.phase_type });
  }
  const dated = phases
    .filter((p) => p.opens_at && p.closes_at)
    .sort((a, b) => new Date(a.opens_at).getTime() - new Date(b.opens_at).getTime());
  let reach = dated.length ? new Date(dated[0].closes_at).getTime() : 0;
  let last = dated[0];
  for (const p of dated.slice(1)) {
    if (new Date(p.opens_at).getTime() > reach + 60_000) out.push({ tone: 'warning', code: 'gap', phase: last.phase_type, other: p.phase_type });
    if (new Date(p.closes_at).getTime() >= reach) {
      reach = new Date(p.closes_at).getTime();
      last = p;
    }
  }
  return out;
}

export interface NamedItem {
  id: string;
  name?: string;
  name_i18n?: I18nText;
}
export interface UserBrief {
  id: string;
  full_name: string;
  job_title: string | null;
  org_unit: string | null;
}
export interface OrgUnitItem {
  id: string;
  name: string;
  unit_type: string;
  path: string;
}
export interface FormItem {
  id: string;
  code: string;
  name: string;
  purpose: string;
  version: number;
  status: string;
}
export interface ScorecardItem {
  id: string;
  name: string;
  purpose: string;
  total_weight: number;
  criteria: { id: string; name: string; weight_pct: number }[];
}
export interface ChecklistItem {
  code: string;
  label: string;
  ok: boolean;
  /** Shown in the list but never blocks publishing (for example: judges, which the admin adds later). */
  optional?: boolean;
}
export interface BuilderLookups {
  domains: NamedItem[];
  categories: NamedItem[];
  users: UserBrief[];
  orgUnits: OrgUnitItem[];
  forms: FormItem[];
  scorecards: ScorecardItem[];
}
