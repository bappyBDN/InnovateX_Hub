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
