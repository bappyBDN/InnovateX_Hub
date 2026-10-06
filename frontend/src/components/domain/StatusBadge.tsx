import { AlertCircle, CheckCircle2, Circle, Clock, Trophy, XCircle } from 'lucide-react';
import { Badge, type Tone } from '@/components/ui/Layout';
import { statusLabel } from '@/utils/format';

/** Status groups (spec §6.2): status is never shown by colour alone — always colour + icon + text. */
const GROUPS: Record<Exclude<Tone, 'primary'>, string[]> = {
  neutral: [
    'DRAFT', 'REGISTERED', 'WITHDRAWN', 'CLOSED', 'NO_SUBMISSION', 'PARTICIPANT', 'CANCELLED', 'UPCOMING', 'PLANNED',
    'ASSIGNED', 'EXPIRED', 'REVOKED', 'OUT', 'UNVERIFIED', 'DUPLICATE', 'SCHEDULED', 'LOCKED', 'SETUP', 'SKIPPED',
    'CANCELLED_REQUEST', 'EXHAUSTED', 'RETIRED', 'LEFT', 'REMOVED',
  ],
  info: [
    'SUBMITTED', 'METHODOLOGY_SUBMITTED', 'UNDER_REVIEW', 'TRIAGE', 'PROTOTYPE_SUBMITTED', 'PROTOTYPE_REVIEWED',
    'FINAL_SUBMITTED', 'JUDGED', 'IN_PROGRESS', 'PENDING', 'PROPOSED', 'BUILDING', 'BUILD', 'PROTOTYPE', 'PILOT',
    'DEMO_VALIDATION', 'METHODOLOGY_REVIEW', 'SHORTLISTING', 'PROTOTYPE_REVIEW', 'FINAL_SUBMISSION',
    'DEMO_AND_JUDGING', 'QUEUED', 'BOOKED', 'PROCESSING', 'OPEN',
  ],
  warning: [
    'CLARIFICATION_REQUESTED', 'WAITLISTED', 'WAITLIST', 'ON_HOLD', 'OVERDUE', 'RESULTS_PENDING_APPROVAL', 'BLOCKED',
    'DECLINED_COI', 'ADJUSTED', 'DUE_SOON', 'RETURNED',
  ],
  success: [
    'SHORTLISTED', 'FINALIST', 'APPROVED', 'CONFIRMED', 'PUBLISHED', 'PRODUCTION', 'IMPACT_VERIFIED', 'SCALED', 'IN',
    'VERIFIED', 'DONE', 'ACTIVE', 'SENT', 'RUNNER_UP', 'OPEN_FOR_REGISTRATION', 'METHODOLOGY_OPEN',
    'RESULTS_PUBLISHED', 'CONVERTED_TO_INITIATIVE', 'COMPLETED', 'ANSWERED', 'UPHELD', 'PAID', 'DELIVERED', 'CLEAN',
  ],
  danger: ['NOT_SHORTLISTED', 'NOT_SELECTED', 'DECLINED', 'REJECTED', 'FAILED', 'DISMISSED', 'INFECTED', 'BREACHED'],
  spark: ['WINNER', 'AWARDED', 'AWARD'],
};

const TONE_BY_CODE: Record<string, Tone> = {};
(Object.keys(GROUPS) as Array<keyof typeof GROUPS>).forEach((tone) => {
  GROUPS[tone].forEach((code) => {
    TONE_BY_CODE[code] = tone;
  });
});

const ICONS: Record<Tone, typeof Circle> = {
  neutral: Circle,
  info: Clock,
  warning: AlertCircle,
  success: CheckCircle2,
  danger: XCircle,
  spark: Trophy,
  primary: Circle,
};

export function statusTone(code: string | null | undefined): Tone {
  return (code && TONE_BY_CODE[code]) || 'neutral';
}

export interface StatusBadgeProps {
  /** Any status code: entry, idea, challenge, review, shortlist… */
  status: string | null | undefined;
  /** Override the text (e.g. owner-friendly label from the server). */
  label?: string;
  tone?: Tone;
  className?: string;
}

export function StatusBadge({ status, label, tone, className }: StatusBadgeProps) {
  if (!status && !label) return null;
  const t = tone ?? statusTone(status);
  const Icon = ICONS[t];
  return (
    <Badge tone={t} className={className} icon={<Icon className="h-3.5 w-3.5" aria-hidden />}>
      {label ?? statusLabel(status)}
    </Badge>
  );
}
