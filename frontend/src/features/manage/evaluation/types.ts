export type I18nText = Record<string, string | null | undefined> | null | undefined;
export type Decision = 'IN' | 'WAITLIST' | 'OUT';

export interface EntryBrief {
  id: string;
  code: string;
  title: string;
  status_code: string;
  entrant?: string | null;
}

export interface RoundReview {
  reviewer: string | null;
  status: string;
  weighted_score: number | null;
  recommendation: string | null;
  private_note: string | null;
  ratings: Record<string, number | null>;
  comments: Record<string, string>;
}

export interface RoundResultRow {
  id: string;
  rank: number | null;
  entity_id: string;
  entry: EntryBrief | null;
  final_score: number | null;
  raw_score: number | null;
  normalized_score: number | null;
  criterion_averages: Record<string, number>;
  reviews_expected: number;
  reviews_completed: number;
  failed_gates: string[];
  needs_discussion: boolean;
  disagreement_criteria: string[];
  discussion_resolved: boolean;
  discussion_resolution: string | null;
  discussion_note: string | null;
  is_frozen: boolean;
  reviews: RoundReview[];
}

export interface RoundCriterion {
  code: string;
  name: string;
  weight_pct: number;
  min_rating: number | null;
}

export interface RoundResults {
  round: {
    id: string;
    name: string;
    round_type: string;
    status: string;
    aggregation_method: string;
    normalize_scores: boolean;
    disagreement_threshold: number | null;
    due_at: string | null;
    show_scores_to_entrants: string;
  };
  challenge: { id: string; title_i18n: I18nText; slug: string; prototype_policy: string } | null;
  criteria: RoundCriterion[];
  rule: { text: string; method: string; top_n: number | null; min_score: number | null; waitlist_size: number | null };
  results: RoundResultRow[];
  can_propose: boolean;
  propose_blockers: string[];
  shortlist: { id: string; status: string } | null;
  can_manage: boolean;
}

export interface ShortlistRow {
  id: string;
  rank: number | null;
  final_score: number | null;
  system_decision: Decision;
  final_decision: Decision;
  is_override: boolean;
  override_reason: string | null;
  prototype_required: boolean;
  prototype_reason: string | null;
  has_feedback: boolean;
  feedback_id: string | null;
  entry: EntryBrief;
}

export interface ShortlistDetail {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'PUBLISHED';
  shortlist_type: string;
  rule: { text?: string; method?: string } | null;
  generated_at: string | null;
  confirmed_at: string | null;
  published_at: string | null;
  confirmed_by: string | null;
  round: { id: string; name: string; round_type: string };
  challenge: { id: string; title_i18n: I18nText; prototype_policy: string };
  prototype_editable: boolean;
  counts: Record<Decision, number>;
  missing_feedback: number;
  entries: ShortlistRow[];
  can_manage: boolean;
}

export interface FeedbackDraft {
  id: string;
  entry: { id: string; code: string; title: string; status_code: string };
  strengths: string | null;
  improvements: string | null;
  decision_reason: string | null;
  next_steps: string | null;
  score_shared: number | null;
  published_at: string | null;
  read_at: string | null;
  complete: boolean;
}

export interface FeedbackComposerData {
  round: { id: string; name: string };
  items: FeedbackDraft[];
}
