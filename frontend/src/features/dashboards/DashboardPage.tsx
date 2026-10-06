import { useQuery } from '@tanstack/react-query';
import { BarChart3, Trophy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useAccess } from '@/auth';
import { BarChart, FunnelChart, StatTile, StatusBadge, type ChartDatum } from '@/components/domain';
import { Button, Card, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton, Tabs, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { num, statusLabel } from '@/utils/format';

type Kind = 'me' | 'judge' | 'program' | 'challenge' | 'executive';
type Series = { label: string; value: number }[];
interface Tile {
  label: string;
  value: number | string | null;
}
interface ProgressRow {
  id: string;
  title: string;
  status_code: string;
  registered: number;
  methodologies_submitted: number;
  reviews_assigned: number;
  reviews_done: number;
  reviews_overdue: number;
  shortlisted: number;
}
interface TopInnovation {
  code: string;
  title: string;
  state: string;
  score: number | null;
  is_awarded: boolean;
}
interface DashboardData {
  kind: string;
  summary: string;
  tiles: Tile[];
  funnel?: Series;
  entries_by_status?: Series;
  ideas_by_state?: Series;
  by_round?: Series;
  participation_by_org_unit?: Series;
  participation_by_domain?: Series;
  score_distribution?: Series;
  conversions?: Series;
  top_domains?: Series;
  ideas_by_org_unit?: Series;
  trend_by_month?: Series;
  challenge_progress?: ProgressRow[];
  top_innovations?: TopInnovation[];
  challenges?: { id: string; title: string }[];
}

const top = (s: Series) => s.reduce<Series[number] | null>((best, d) => (!best || d.value > best.value ? d : best), null);
const total = (s: Series) => s.reduce((sum, d) => sum + d.value, 0);

/** Chart with its one-sentence summary above it and a "View data" table toggle (spec §11.2). */
function ChartCard({
  title,
  summary,
  data,
  kind = 'bar',
  format,
  maxValue,
  codes,
}: {
  title: string;
  summary: string;
  data: Series | undefined;
  kind?: 'bar' | 'funnel';
  format?: (n: number) => string;
  maxValue?: number;
  /** Labels are status codes — show them as readable text. */
  codes?: boolean;
}) {
  const { t } = useTranslation();
  const [showData, setShowData] = useState(false);
  if (!data) return null;
  const rows: ChartDatum[] = data.map((d) => ({ label: codes ? statusLabel(d.label) : d.label, value: d.value }));
  const fmt = format ?? ((n: number) => num(n));
  return (
    <Card>
      {rows.length === 0 ? (
        <BarChart title={title} data={[]} emptyText={t('dashboards.noData')} />
      ) : kind === 'funnel' ? (
        <FunnelChart title={title} summary={summary} stages={rows} format={fmt} />
      ) : (
        <BarChart title={title} summary={summary} data={rows} format={fmt} maxValue={maxValue} />
      )}
      {rows.length > 0 && (
        <div className="mt-3">
          <Button size="sm" variant="ghost" aria-expanded={showData} onClick={() => setShowData((v) => !v)}>
            {showData ? t('dashboards.hideData') : t('dashboards.viewData')}
          </Button>
          {showData && (
            <table className="mt-2 w-full text-sm">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="py-1.5 font-medium">{t('dashboards.label')}</th>
                  <th className="py-1.5 text-right font-medium">{t('dashboards.value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-line last:border-0">
                    <td className="py-1.5 text-ink">{r.label}</td>
                    <td className="tabular py-1.5 text-right text-ink">{fmt(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Card>
  );
}

function TableCard({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <Card padded={false} className="lg:col-span-2">
      <div className="px-4 pt-4 md:px-5">
        <p className="font-semibold text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{summary}</p>
      </div>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </Card>
  );
}

function DashboardBody({ kind, challengeId }: { kind: Kind; challengeId: string }) {
  const { t } = useTranslation();
  const params = kind === 'challenge' ? { challenge_id: challengeId } : undefined;
  const query = useQuery({
    queryKey: queryKeys.dashboards(kind, params),
    queryFn: () => api.get<DashboardData>(`/dashboards/${kind}`, params),
    enabled: kind !== 'challenge' || !!challengeId,
  });

  if (kind === 'challenge' && !challengeId)
    return <EmptyState icon={<BarChart3 className="h-8 w-8" aria-hidden />} title={t('dashboards.chooseChallenge')} description={t('dashboards.chooseChallengeHelp')} />;
  if (query.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-2/3" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  if (isNotFound(query.error)) return <NotFoundPage />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const d = query.data;
  const none = t('dashboards.noneYet');
  const topOf = (s?: Series) => (s && top(s)) || { label: none, value: 0 };
  const sparkTiles = ['Verified hours saved', 'Verified value (BDT)', 'Awards given', 'Badges', 'Points'];
  const mine = kind === 'me';

  return (
    <div className="space-y-5">
      <p className="reading text-ink">{d.summary}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {d.tiles.map((tile) => (
          <StatTile
            key={tile.label}
            label={tile.label}
            spark={sparkTiles.includes(tile.label)}
            value={tile.value == null ? '—' : typeof tile.value === 'number' ? num(tile.value, Number.isInteger(tile.value) ? 0 : 1) : tile.value}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {d.funnel && (
          <ChartCard
            kind="funnel"
            title={kind === 'executive' ? t('dashboards.ideaFunnel') : t('dashboards.funnel')}
            summary={
              kind === 'executive'
                ? t('dashboards.ideaFunnelSummary', { submitted: d.funnel[0]?.value ?? 0, production: d.funnel.find((f) => f.label === 'Production')?.value ?? 0 })
                : t('dashboards.funnelSummary', { first: d.funnel[0]?.value ?? 0, last: d.funnel[d.funnel.length - 1]?.value ?? 0 })
            }
            data={d.funnel}
          />
        )}
        {d.conversions && (
          <ChartCard
            title={t('dashboards.conversions')}
            summary={t('dashboards.conversionsSummary', { value: d.conversions.find((c) => c.label.startsWith('Pilot'))?.value ?? 0 })}
            data={d.conversions}
            format={(n) => `${num(n)}%`}
            maxValue={100}
          />
        )}
        {d.entries_by_status && (
          <ChartCard codes title={t('dashboards.entriesByStatus')} summary={t('dashboards.entriesByStatusSummary', { total: total(d.entries_by_status) })} data={d.entries_by_status} />
        )}
        {d.by_round && <ChartCard title={t('dashboards.byRound')} summary={t('dashboards.byRoundSummary', { total: total(d.by_round) })} data={d.by_round} />}
        {d.participation_by_org_unit && (
          <ChartCard
            title={t('dashboards.byOrgUnit')}
            summary={t('dashboards.byOrgUnitSummary', { top: topOf(d.participation_by_org_unit).label, value: topOf(d.participation_by_org_unit).value })}
            data={d.participation_by_org_unit}
          />
        )}
        {d.participation_by_domain && (
          <ChartCard
            title={t('dashboards.byDomain')}
            summary={t('dashboards.byDomainSummary', { top: topOf(d.participation_by_domain).label, value: topOf(d.participation_by_domain).value })}
            data={d.participation_by_domain}
          />
        )}
        {d.top_domains && (
          <ChartCard
            title={t('dashboards.topDomains')}
            summary={t('dashboards.byDomainSummary', { top: topOf(d.top_domains).label, value: topOf(d.top_domains).value })}
            data={d.top_domains}
          />
        )}
        {d.score_distribution && (
          <ChartCard
            title={t('dashboards.scoreDistribution')}
            summary={t('dashboards.scoreDistributionSummary', { top: topOf(d.score_distribution).label })}
            data={d.score_distribution}
          />
        )}
        {d.ideas_by_state && (
          <ChartCard
            codes
            title={mine ? t('dashboards.myIdeasByState') : t('dashboards.ideasByState')}
            summary={
              mine
                ? t('dashboards.myIdeasByStateSummary', { total: total(d.ideas_by_state) })
                : t('dashboards.ideasByStateSummary', { total: total(d.ideas_by_state), top: statusLabel(topOf(d.ideas_by_state).label) })
            }
            data={mine ? d.ideas_by_state : d.ideas_by_state.filter((s) => s.value > 0)}
          />
        )}
        {d.ideas_by_org_unit && (
          <ChartCard
            title={t('dashboards.ideasByOrgUnit')}
            summary={t('dashboards.ideasByOrgUnitSummary', { top: topOf(d.ideas_by_org_unit).label, value: topOf(d.ideas_by_org_unit).value })}
            data={d.ideas_by_org_unit}
          />
        )}
        {d.trend_by_month && (
          <ChartCard
            title={t('dashboards.trend')}
            summary={t('dashboards.trendSummary', { top: topOf(d.trend_by_month).label, value: topOf(d.trend_by_month).value })}
            data={d.trend_by_month}
          />
        )}

        {d.challenge_progress && d.challenge_progress.length > 0 && (
          <TableCard title={t('dashboards.challengeProgress')} summary={t('dashboards.challengeProgressSummary', { count: d.challenge_progress.length })}>
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="px-4 py-2 font-medium md:px-5">{t('dashboards.challenge')}</th>
                  <th className="px-2 py-2 font-medium">{t('dashboards.status')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('dashboards.registered')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('dashboards.submitted')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('dashboards.reviewsDone')}</th>
                  <th className="px-2 py-2 text-right font-medium">{t('dashboards.overdue')}</th>
                  <th className="px-4 py-2 text-right font-medium md:px-5">{t('dashboards.shortlisted')}</th>
                </tr>
              </thead>
              <tbody>
                {d.challenge_progress.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 md:px-5">
                      <Link className="font-medium text-primary hover:underline" to={`/manage/challenges/${c.id}`}>
                        {c.title}
                      </Link>
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={c.status_code} />
                    </td>
                    <td className="tabular px-2 py-2 text-right">{c.registered}</td>
                    <td className="tabular px-2 py-2 text-right">{c.methodologies_submitted}</td>
                    <td className="tabular px-2 py-2 text-right">
                      {c.reviews_done}/{c.reviews_assigned}
                    </td>
                    <td className={`tabular px-2 py-2 text-right ${c.reviews_overdue ? 'font-semibold text-danger' : ''}`}>{c.reviews_overdue}</td>
                    <td className="tabular px-4 py-2 text-right md:px-5">{c.shortlisted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}

        {d.top_innovations && d.top_innovations.length > 0 && (
          <TableCard title={t('dashboards.topInnovations')} summary={t('dashboards.topInnovationsSummary')}>
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="px-4 py-2 font-medium md:px-5">{t('dashboards.code')}</th>
                  <th className="px-2 py-2 font-medium">{t('dashboards.ideaTitle')}</th>
                  <th className="px-2 py-2 font-medium">{t('dashboards.stage')}</th>
                  <th className="px-4 py-2 text-right font-medium md:px-5">{t('dashboards.score')}</th>
                </tr>
              </thead>
              <tbody>
                {d.top_innovations.map((i) => (
                  <tr key={i.code} className="border-b border-line last:border-0">
                    <td className="tabular whitespace-nowrap px-4 py-2 md:px-5">
                      <Link className="text-primary hover:underline" to={`/ideas/${i.code}`}>
                        {i.code}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-ink">
                      {i.title}
                      {i.is_awarded && <Trophy className="ml-1.5 inline h-4 w-4 text-spark-ink" aria-label={t('dashboards.awarded')} />}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={i.state} />
                    </td>
                    <td className="tabular px-4 py-2 text-right md:px-5">{i.score == null ? '—' : num(i.score, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { type } = useParams();
  const navigate = useNavigate();
  const { hasRole, isPrivileged } = useAccess();
  const [challengeId, setChallengeId] = useState('');

  const allowed: Kind[] = [
    ...(hasRole('EXECUTIVE', 'SUPER_ADMIN', 'PROGRAM_OWNER') ? (['executive'] as Kind[]) : []),
    ...(isPrivileged ? (['program', 'challenge'] as Kind[]) : []),
    ...(hasRole('JUDGE') ? (['judge'] as Kind[]) : []),
    'me',
  ];
  // Most senior dashboard first: program for the innovation office, executive for executives, judge for judges.
  const fallback: Kind = isPrivileged ? 'program' : allowed[0];
  const kind = (type ?? fallback) as Kind;

  // The challenge picker needs the list of published challenges (privileged only).
  const program = useQuery({
    queryKey: queryKeys.dashboards('program'),
    queryFn: () => api.get<DashboardData>('/dashboards/program'),
    enabled: isPrivileged && kind === 'challenge',
  });

  if (!allowed.includes(kind)) return <NotFoundPage />;

  const labels: Record<Kind, string> = {
    me: t('dashboards.tabMe'),
    judge: t('dashboards.tabJudge'),
    program: t('dashboards.tabProgram'),
    challenge: t('dashboards.tabChallenge'),
    executive: t('dashboards.tabExecutive'),
  };
  const order: Kind[] = ['me', 'judge', 'program', 'challenge', 'executive'];

  return (
    <div className="space-y-5">
      <PageHeader title={t('dashboards.title')} />
      {allowed.length > 1 && (
        <Tabs
          ariaLabel={t('dashboards.title')}
          value={kind}
          onChange={(v) => navigate(`/dashboards/${v}`)}
          tabs={order.filter((k) => allowed.includes(k)).map((k) => ({ value: k, label: labels[k] }))}
        />
      )}
      {kind === 'challenge' && (
        <Field label={t('dashboards.challenge')} className="max-w-md">
          <Select
            value={challengeId}
            onChange={(e) => setChallengeId(e.target.value)}
            placeholder={t('dashboards.chooseChallenge')}
            options={(program.data?.challenges ?? []).map((c) => ({ value: c.id, label: c.title }))}
          />
        </Field>
      )}
      <DashboardBody key={`${kind}-${challengeId}`} kind={kind} challengeId={challengeId} />
    </div>
  );
}
