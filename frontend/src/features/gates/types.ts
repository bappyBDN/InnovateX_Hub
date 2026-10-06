import type { Tone } from '@/components/ui';

export type GateStatus = 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';
export type GateDecision = 'APPROVE' | 'REVISE' | 'REJECT';

export interface GateField {
  key: string;
  label: string;
  required?: boolean;
  kind: 'URL' | 'TEXT';
}

export interface GateTally {
  approve: number;
  revise: number;
  reject: number;
  pending: number;
  total: number;
}

export interface GateFeedback {
  decision: GateDecision | null;
  feedback: string | null;
  decided_at: string | null;
  /** Only staff see who the judge is. */
  judge: { id: string; full_name: string } | null;
}

export interface GateView {
  id: string;
  stage: 'PROTOTYPE' | 'PILOT';
  round_no: number;
  status: GateStatus;
  content: Record<string, string>;
  submitted_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  decided_by_admin: boolean;
  tally: GateTally;
  feedback: GateFeedback[];
}

export interface GateStage {
  stage: 'PROTOTYPE' | 'PILOT';
  title: string;
  fields: GateField[];
  can_edit: boolean;
  /** A challenge entry's demo is scored (score + comment) and the top N become finalists. */
  scored?: boolean;
  deadline?: string | null;
  round_id?: string;
  closed_reason: string | null;
  gate: GateView | null;
  earlier: GateView[];
  /** Admin only. */
  judges?: { user: { id: string; full_name: string; job_title?: string | null } | null; decision: GateDecision | null; scored?: boolean; score?: number | null }[];
  /** Admin only, while the form waits for judges: people who judged this work before. */
  suggested_judges?: { id: string; full_name: string; job_title?: string | null }[];
}

export interface GateOverview {
  entity: { type: string; id: string; code: string; title: string; context: string; challenge_id?: string | null };
  stages: GateStage[];
  is_member: boolean;
  can_manage: boolean;
}

export interface GateBallot {
  id: string;
  stage: 'PROTOTYPE' | 'PILOT';
  title: string;
  round_no: number;
  status: GateStatus;
  submitted_at: string | null;
  entity: { type: string; code: string; title: string; context: string; summary: string };
  fields: GateField[];
  content: Record<string, string>;
  my_decision: GateDecision | null;
  my_feedback: string;
  can_decide: boolean;
  tally: GateTally;
  earlier_feedback: { round_no: number; status: GateStatus; items: string[] }[];
}

export interface GateRow {
  id: string;
  stage: 'PROTOTYPE' | 'PILOT';
  round_no: number;
  status: GateStatus;
  submitted_at: string | null;
  tally: GateTally;
  entity: { type: string; id: string; code: string; title: string; context: string; link: string };
}

export const GATE_TONE: Record<GateStatus, Tone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  IN_REVIEW: 'info',
  APPROVED: 'success',
  CHANGES_REQUESTED: 'warning',
  REJECTED: 'danger',
};
export const DECISION_TONE: Record<GateDecision, Tone> = { APPROVE: 'success', REVISE: 'warning', REJECT: 'danger' };
export const DECISIONS: GateDecision[] = ['APPROVE', 'REVISE', 'REJECT'];
