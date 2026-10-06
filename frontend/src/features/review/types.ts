import type { FormDefinition, FormValue } from '@/components/domain';

export interface ReviewEntity {
  type: 'challenge_entry' | 'initiative';
  id: string;
  code: string | null;
  title: string;
  context: string;
  context_i18n: Record<string, string>;
  entrant: string | null;
  confidential: boolean;
}

export interface QueueItem {
  id: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED';
  due_at: string | null;
  submitted_at: string | null;
  round_type: string;
  round_name: string;
  blind: boolean;
  entity: ReviewEntity;
  overdue_days: number;
  /** True for a prototype or pilot review: a decision with feedback, not a score. */
  gate?: boolean;
}

export interface QueueResponse {
  items: QueueItem[];
  total: number;
  summary: { due_today: number; due_this_week: number; overdue: number; done: number; open: number };
}

export interface ScaleLevel {
  value: number;
  label: string;
  description?: string;
}

export interface Criterion {
  id: string;
  code: string;
  name: string;
  guidance: string | null;
  weight_pct: number;
  min_rating: number | null;
  comment_required_at: number[];
}

export interface Scorecard {
  id: string;
  name: string;
  scale: { min: number; max: number; levels: ScaleLevel[] };
  criteria: Criterion[];
}

export interface ScoreRow {
  criterion_id: string;
  rating: number | null;
  comment: string | null;
}

export interface Clarification {
  id: string;
  question: string;
  answer: string | null;
  status: string;
  asked_at: string | null;
  answered_at: string | null;
}

export interface Workspace {
  id: string;
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'DECLINED_COI';
  due_at: string | null;
  submitted_at: string | null;
  round: { id: string; name: string; round_type: string; blind: boolean };
  entity: ReviewEntity;
  submission: { form: FormDefinition | null; content: FormValue; version_no: number; submitted_at: string | null };
  attachment_entity: { entity_type: string; entity_id: string };
  scorecard: Scorecard | null;
  scores: ScoreRow[];
  summary: { recommendation: string | null; strengths: string | null; improvements: string | null; private_note: string | null };
  weighted_score: number | null;
  read_only: boolean;
  blind_note: string | null;
  clarifications: Clarification[];
}

/** What the judge is editing; this is also the request body for save and submit. */
export interface ReviewDraft {
  scores: ScoreRow[];
  recommendation: string | null;
  strengths: string;
  improvements: string;
  private_note: string;
}

export function draftFrom(ws: Workspace): ReviewDraft {
  const byId = new Map(ws.scores.map((s) => [s.criterion_id, s]));
  return {
    scores: (ws.scorecard?.criteria ?? []).map((c) => ({
      criterion_id: c.id,
      rating: byId.get(c.id)?.rating ?? null,
      comment: byId.get(c.id)?.comment ?? null,
    })),
    recommendation: ws.summary.recommendation,
    strengths: ws.summary.strengths ?? '',
    improvements: ws.summary.improvements ?? '',
    private_note: ws.summary.private_note ?? '',
  };
}

/** Σ rating ÷ max × weight — same formula the server uses (the server's number always wins). */
export function liveTotal(card: Scorecard, scores: ScoreRow[]): number {
  const byId = new Map(scores.map((s) => [s.criterion_id, s.rating]));
  const total = card.criteria.reduce((sum, c) => sum + ((byId.get(c.id) ?? 0) / card.scale.max) * c.weight_pct, 0);
  return Math.round(total * 100) / 100;
}
