import { CheckCircle2, Trophy, Users, XCircle } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { DeadlineCountdown, StatusBadge } from '@/components/domain';
import { Badge, ButtonLink, Card } from '@/components/ui';
import { formatDateTime } from '@/utils/dates';
import { money } from '@/utils/format';
import { tr } from '@/utils/i18n';
import type { ChallengeCardData } from './types';

export function participationText(
  t: TFunction,
  c: Pick<ChallengeCardData, 'participation_mode' | 'team_min_size' | 'team_max_size'>,
): string {
  if (c.participation_mode === 'INDIVIDUAL') return t('challenges.modeIndividual');
  const size = { min: c.team_min_size, max: c.team_max_size };
  return c.participation_mode === 'TEAM' ? t('challenges.modeTeam', size) : t('challenges.modeBoth', size);
}

/** Public card: problem, domain, dates and prize. Never any participant names. */
export function ChallengeCard({ challenge: c }: { challenge: ChallengeCardData }) {
  const { t } = useTranslation();
  const title = tr(c.title_i18n);
  const phase = c.current_phase;
  const canRegister = !c.my_entry_id && c.registration.is_open && c.eligibility.eligible;

  return (
    <Card padded={false} className="flex h-full flex-col overflow-hidden">
      <div className="h-2" style={{ backgroundColor: c.banner_color ?? 'rgb(var(--primary))' }} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {c.domain && <Badge tone="primary">{tr(c.domain.name_i18n)}</Badge>}
          <StatusBadge status={c.status_code} />
        </div>
        <h3 className="text-lg font-semibold leading-snug text-ink">
          <Link to={`/challenges/${c.slug}`} className="hover:text-primary hover:underline">
            {title}
          </Link>
        </h3>
        <p className="line-clamp-3 text-sm text-ink-muted">{tr(c.problem_statement_i18n)}</p>

        <dl className="space-y-1.5 text-sm text-ink">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
            <dt className="sr-only">{t('challenges.participation')}</dt>
            <dd>{participationText(t, c)}</dd>
          </div>
          {!!c.total_prize_budget && (
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 shrink-0 text-spark" aria-hidden />
              <dt className="sr-only">{t('challenges.prizePool')}</dt>
              <dd>{t('challenges.prizePoolValue', { amount: money(c.total_prize_budget, c.currency_code) })}</dd>
            </div>
          )}
          {c.registration.count !== null && (
            <div className="text-ink-muted">{t('challenges.registeredCount', { count: c.registration.count })}</div>
          )}
        </dl>

        {phase && (
          <div className="rounded-control bg-canvas px-3 py-2 text-sm">
            <div className="font-medium text-ink">{tr(phase.name_i18n)}</div>
            {phase.status === 'OPEN' ? (
              <DeadlineCountdown closesAt={phase.closes_at} />
            ) : phase.status === 'UPCOMING' ? (
              <span className="text-ink-muted">{t('challenges.opensOn', { date: formatDateTime(phase.opens_at) })}</span>
            ) : (
              <span className="text-ink-muted">{t('challenges.closedOn', { date: formatDateTime(phase.closes_at) })}</span>
            )}
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          {c.my_entry_id ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
              {t('challenges.youAreRegistered')}
            </Badge>
          ) : c.eligibility.eligible ? (
            <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}>
              {t('challenges.youCanJoin')}
            </Badge>
          ) : (
            <Badge tone="neutral" icon={<XCircle className="h-3.5 w-3.5" aria-hidden />} className="!whitespace-normal">
              {t('challenges.notEligible', { reason: c.eligibility.reason ?? '' })}
            </Badge>
          )}
          {c.my_entry_id ? (
            <ButtonLink to={`/entries/${c.my_entry_id}`} size="sm">
              {t('challenges.viewMyEntry')}
            </ButtonLink>
          ) : canRegister ? (
            <ButtonLink to={`/challenges/${c.slug}/register`} size="sm">
              {t('challenges.register')}
            </ButtonLink>
          ) : (
            <ButtonLink to={`/challenges/${c.slug}`} size="sm" variant="secondary">
              {t('challenges.viewChallenge')}
            </ButtonLink>
          )}
        </div>
      </div>
    </Card>
  );
}
