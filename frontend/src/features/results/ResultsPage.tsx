import { useQuery } from '@tanstack/react-query';
import { Award, BadgeCheck, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { StatusBadge } from '@/components/domain';
import { Badge, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';
import { money, num } from '@/utils/format';
import { tr, type I18nText } from '@/utils/i18n';

interface Winner {
  rank: number;
  result: 'WINNER' | 'RUNNER_UP';
  award_category: string | null;
  title: string | null;
  team_name: string | null;
  summary: string | null;
  prize: { description: string; amount: number | null; currency_code: string; prize_type: string } | null;
}
interface ResultChallenge {
  id: string;
  slug: string;
  code: string;
  title_i18n: I18nText;
  results_published_at: string | null;
  winners: Winner[];
}
interface HallItem {
  code: string;
  title: string;
  summary: string | null;
  is_awarded: boolean;
  current_state_code: string;
  owner: string | null;
  impact: { name: string; baseline: number | null; actual: number | null; unit: string; verified: boolean } | null;
}
interface ResultsData {
  challenges: ResultChallenge[];
  hall_of_fame: HallItem[];
}

export default function ResultsPage() {
  const { t } = useTranslation();
  const results = useQuery({ queryKey: queryKeys.results, queryFn: () => api.get<ResultsData>('/results') });

  if (results.isLoading) return <PageSkeleton rows={5} />;
  if (results.error) return <ErrorState error={results.error} onRetry={() => void results.refetch()} />;
  const d = results.data!;

  return (
    <>
      <PageHeader title={t('results.title')} subtitle={t('results.subtitle')} />
      {d.challenges.length === 0 && d.hall_of_fame.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-8 w-8" aria-hidden />}
          title={t('results.emptyTitle')}
          description={t('results.emptyBody')}
          action={<ButtonLink to="/challenges">{t('results.browse')}</ButtonLink>}
        />
      ) : (
        <div className="space-y-10">
          {d.challenges.map((c) => (
            <section key={c.id} aria-labelledby={`res-${c.id}`}>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id={`res-${c.id}`} className="text-xl font-semibold text-ink">
                    <Link to={`/challenges/${c.slug}`} className="hover:text-primary hover:underline">
                      {tr(c.title_i18n)}
                    </Link>
                  </h2>
                  <p className="text-sm text-ink-muted">{t('results.publishedOn', { date: formatDate(c.results_published_at) })}</p>
                </div>
              </div>
              <ul className="grid gap-4 md:grid-cols-2">
                {c.winners.map((w) => {
                  const first = w.result === 'WINNER';
                  return (
                    <li key={`${w.rank}-${w.title}`}>
                      <Card className={cn('h-full space-y-3', first && 'border-spark bg-spark-soft')}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={first ? 'spark' : 'neutral'} icon={first ? <Trophy className="h-3.5 w-3.5" aria-hidden /> : <Award className="h-3.5 w-3.5" aria-hidden />}>
                            {first ? t('results.winner') : t('results.runnerUp')}
                          </Badge>
                          {w.award_category && <span className="text-sm text-ink-muted">{w.award_category}</span>}
                        </div>
                        {w.title ? (
                          <>
                            <div>
                              <h3 className="text-lg font-semibold text-ink">{w.title}</h3>
                              {w.team_name && <p className="text-sm text-ink-muted">{w.team_name}</p>}
                            </div>
                            {w.summary && <p className="reading text-ink">{w.summary}</p>}
                          </>
                        ) : (
                          <p className="text-sm text-ink-muted">{t('results.summaryHidden')}</p>
                        )}
                        {w.prize && (
                          <p className="border-t border-line pt-3 text-sm text-ink">
                            <span className="font-medium">{t('results.prize')}: </span>
                            {w.prize.description}
                            {w.prize.amount ? <span className="tabular"> · {money(w.prize.amount, w.prize.currency_code)}</span> : null}
                          </p>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {d.hall_of_fame.length > 0 && (
            <section aria-labelledby="hall">
              <h2 id="hall" className="text-xl font-semibold text-ink">
                {t('results.hallTitle')}
              </h2>
              <p className="mb-3 text-sm text-ink-muted">{t('results.hallSubtitle')}</p>
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {d.hall_of_fame.map((h) => (
                  <li key={h.code}>
                    <Card className="flex h-full flex-col gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="tabular text-xs text-ink-muted">{h.code}</span>
                        <span className="flex flex-wrap gap-2">
                          {h.is_awarded && (
                            <Badge tone="spark" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />}>
                              {t('results.awarded')}
                            </Badge>
                          )}
                          <StatusBadge status={h.current_state_code} />
                        </span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-ink">{h.title}</h3>
                        {h.owner && <p className="text-sm text-ink-muted">{h.owner}</p>}
                      </div>
                      {h.summary && <p className="text-sm text-ink">{h.summary}</p>}
                      {h.impact && h.impact.actual != null && (
                        <p className="mt-auto flex gap-2 border-t border-line pt-3 text-sm text-ink">
                          {h.impact.verified && <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />}
                          <span>
                            {h.impact.name}:{' '}
                            <span className="tabular font-medium">
                              {h.impact.baseline != null ? `${num(h.impact.baseline)} → ` : ''}
                              {num(h.impact.actual)} {h.impact.unit}
                            </span>{' '}
                            <span className="text-ink-muted">({h.impact.verified ? t('results.verified') : t('results.notVerified')})</span>
                          </span>
                        </p>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}
