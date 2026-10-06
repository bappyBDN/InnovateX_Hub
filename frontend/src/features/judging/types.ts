export interface JudgeUser {
  id: string;
  full_name: string;
  job_title?: string | null;
  org_unit?: string | null;
  email?: string | null;
}

export interface StageOption {
  code: string;
  name: string;
  /** False when this challenge does not have that stage. */
  in_challenge: boolean;
}

export interface JudgeInviteRow {
  id: string;
  email: string;
  stages: string[];
  all_stages: boolean;
  sent_at: string | null;
  expires_at: string | null;
  expired: boolean;
}

export interface ChallengeJudgeRow {
  user: JudgeUser;
  /** Empty list = all stages. */
  stages: string[];
  all_stages: boolean;
  assigned: number;
  done: number;
}

export interface ChallengeJudges {
  stages: StageOption[];
  judges: ChallengeJudgeRow[];
  invites: JudgeInviteRow[];
  can_edit: boolean;
}

export interface IdeaJudgeRow {
  user: JudgeUser;
  status: string;
  due_at: string | null;
  /** This judge's score (0-100) once submitted. */
  score: number | null;
}

export interface IdeaJudges {
  /** Average of the judges who have scored; used for shortlisting. */
  average_score: number | null;
  scored: number;
  total: number;
  judges: IdeaJudgeRow[];
  invites: JudgeInviteRow[];
  can_edit: boolean;
}

export interface AddJudgesPayload {
  user_ids: string[];
  emails: string;
  stages: string[];
  due_days: number;
  message: string;
}

export interface AddJudgesResult {
  added: string[];
  updated?: string[];
  skipped: { name: string; reason: string }[];
  created: number;
  invited: { email: string; invite_url: string; email_status: string }[];
  invalid_emails: string[];
}

/** What the judges said about one idea or entry (staff only). From GET /judge-feedback/{type}/{id}. */
export interface JudgeFeedbackCriterion {
  code: string;
  name: string;
  weight_pct: number | null;
  rating: number | null;
  comment: string | null;
}

export interface JudgeFeedbackReview {
  id: string;
  judge: { id: string; full_name: string; job_title?: string | null } | null;
  status: string;
  submitted_at: string | null;
  weighted_score: number | null;
  recommendation: string | null;
  strengths: string | null;
  improvements: string | null;
  private_note: string | null;
  criteria: JudgeFeedbackCriterion[];
}

export interface JudgeFeedbackRound {
  round_id: string;
  name: string;
  round_type: string;
  status: string;
  scale_max: number;
  average_score: number | null;
  reviews_done: number;
  reviews_total: number;
  reviews: JudgeFeedbackReview[];
}

export interface JudgeFeedbackGate {
  id: string;
  stage: 'PROTOTYPE' | 'PILOT';
  title: string;
  round_no: number;
  status: string;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_by_admin: boolean;
  judges: { judge: { id: string; full_name: string; job_title?: string | null } | null; decision: string | null; feedback: string | null; decided_at: string | null }[];
}

export interface JudgeFeedbackSummary {
  average_score: number | null;
  reviews_done: number;
  reviews_total: number;
  recommendations: Record<string, number>;
}

export interface JudgeFeedbackData {
  entity_type: string;
  entity_id: string;
  rounds: JudgeFeedbackRound[];
  gates: JudgeFeedbackGate[];
  summary: JudgeFeedbackSummary;
}

export interface ChallengeJudgeFeedbackRow {
  entry: { id: string; code: string; title: string; status_code: string; entrant: string | null };
  summary: JudgeFeedbackSummary;
  gates: { stage: string; round_no: number; status: string }[];
}
