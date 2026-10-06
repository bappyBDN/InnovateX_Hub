import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { api, type Page } from '@/api/client';
import { Badge, ButtonLink, Card, DataTable, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton, Tabs } from '@/components/ui';
import { GATE_TONE, type GateRow } from '@/features/gates/types';
import type { I18nText } from '@/utils/i18n';
import { tr } from '@/utils/i18n';
import { statusLabel } from '@/utils/format';
import { ChallengeFeedbackTab } from './ChallengeFeedbackTab';
import { ChallengeJudgesTab } from './ChallengeJudgesTab';
import { JudgeFeedbackPanel } from './JudgeFeedbackPanel';
import { IdeaJudgesPanel } from './IdeaJudgesDialog';

interface ChallengeRow {
  id: string;
  code: string;
  title_i18n: I18nText;
  status_code: string;
}
interface IdeaRow {
  key: string;
  code: string | null;
  title: string;
  current_state_code: string;
}
/** Ideas that are waiting for, or in, judging. */
const JUDGEABLE = ['SUBMITTED', 'TRIAGE', 'UNDER_REVIEW', 'CLARIFICATION_REQUESTED'];

/** Admin page: choose judges for a challenge or for an idea. Everything is picked from dropdown lists. */
export default function JudgesAdminPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const tab = (['ideas', 'reviews', 'feedback'] as const).find((k) => k === search.get('tab')) ?? 'challenges';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };

  const challenges = useQuery({ queryKey: ['manage', 'challenges', { for: 'judges' }], queryFn: () => api.get<Page<ChallengeRow>>('/manage/challenges') });
  const ideas = useQuery({
    queryKey: ['ideas', 'for-judges'],
    queryFn: () => api.get<Page<IdeaRow>>('/initiatives', { scope: 'all', page_size: 200 }),
    enabled: tab === 'ideas' || tab === 'feedback',
  });

  const gates = useQuery({ queryKey: ['admin', 'gates'], queryFn: () => api.get<Page<GateRow>>('/admin/gates') });
  const challengeId = search.get('challenge') ?? '';
  const ideaKey = search.get('idea') ?? '';
  const ideaRows = (ideas.data?.items ?? []).filter((i) => tab === 'feedback' || JUDGEABLE.includes(i.current_state_code) || i.key === ideaKey);
  const idea = ideaRows.find((i) => i.key === ideaKey);

  return (
    <div className="space-y-6">
      <PageHeader title={t('judging.adminTitle')} subtitle={t('judging.adminSubtitle')} />
      <Tabs
        ariaLabel={t('judging.adminTitle')}
        value={tab}
        onChange={(v) => set('tab', v === 'challenges' ? '' : v)}
        tabs={[
          { value: 'challenges', label: t('judging.tabChallenges') },
          { value: 'ideas', label: t('judging.tabIdeas') },
          { value: 'feedback', label: t('judgeFeedback.tab') },
          { value: 'reviews', label: t('gates.adminTab'), count: gates.data?.items.filter((g) => g.status === 'IN_REVIEW' || g.status === 'SUBMITTED').length },
        ]}
      />

      {tab === 'challenges' && (
        <div role="tabpanel" aria-label={t('judging.tabChallenges')} className="space-y-4">
          {challenges.isError ? (
            <ErrorState error={challenges.error} onRetry={() => void challenges.refetch()} />
          ) : (
            <Card>
              <Field label={t('judging.challengeField')} help={t('judging.challengeFieldHelp')} className="max-w-2xl">
                <Select
                  value={challengeId}
                  onChange={(e) => set('challenge', e.target.value)}
                  placeholder={challenges.isLoading ? t('common.loading') : t('judging.chooseChallenge')}
                  options={(challenges.data?.items ?? []).map((c) => ({ value: c.id, label: `${tr(c.title_i18n)} — ${statusLabel(c.status_code)}` }))}
                />
              </Field>
            </Card>
          )}
          {challengeId ? (
            <ChallengeJudgesTab key={challengeId} challengeId={challengeId} refresh={() => challenges.refetch()} />
          ) : (
            !challenges.isError && <EmptyState title={t('judging.chooseChallengeFirst')} />
          )}
        </div>
      )}

      {tab === 'feedback' && (
        <div role="tabpanel" aria-label={t('judgeFeedback.tab')} className="space-y-6">
          <Card>
            <h2 className="text-lg font-semibold text-ink">{t('judgeFeedback.innovationTitle')}</h2>
            <p className="mb-3 text-sm text-ink-muted">{t('judgeFeedback.innovationHelp')}</p>
            {ideas.isError ? (
              <ErrorState error={ideas.error} onRetry={() => void ideas.refetch()} />
            ) : (
              <Field label={t('judgeFeedback.ideaField')} className="max-w-2xl">
                <Select
                  value={ideaKey}
                  onChange={(e) => set('idea', e.target.value)}
                  placeholder={ideas.isLoading ? t('common.loading') : t('judgeFeedback.chooseIdea')}
                  options={ideaRows.map((i) => ({ value: i.key, label: `${i.code ?? ''} — ${i.title} — ${statusLabel(i.current_state_code)}` }))}
                />
              </Field>
            )}
            {ideaKey && idea ? (
              <div className="mt-4 border-t border-line pt-4">
                <JudgeFeedbackPanel key={ideaKey} entityType="initiative" entityId={ideaKey} />
              </div>
            ) : (
              !ideas.isLoading && !ideas.isError && <p className="mt-4 text-sm text-ink-muted">{ideaRows.length ? t('judgeFeedback.chooseIdeaFirst') : t('judgeFeedback.noIdeas')}</p>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold text-ink">{t('judgeFeedback.challengeTitle')}</h2>
            <Field label={t('judging.challengeField')} className="mt-3 max-w-2xl">
              <Select
                value={challengeId}
                onChange={(e) => set('challenge', e.target.value)}
                placeholder={challenges.isLoading ? t('common.loading') : t('judging.chooseChallenge')}
                options={(challenges.data?.items ?? []).map((c) => ({ value: c.id, label: `${tr(c.title_i18n)} — ${statusLabel(c.status_code)}` }))}
              />
            </Field>
            {challengeId ? (
              <div className="mt-4 border-t border-line pt-4">
                <ChallengeFeedbackTab key={challengeId} challengeId={challengeId} />
              </div>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">{t('judging.chooseChallengeFirst')}</p>
            )}
          </Card>
        </div>
      )}

      {tab === 'reviews' && (
        <div role="tabpanel" aria-label={t('gates.adminTab')} className="space-y-4">
          {gates.isError ? (
            <ErrorState error={gates.error} onRetry={() => void gates.refetch()} />
          ) : (
            <Card>
              <p className="mb-3 text-sm text-ink-muted">{t('gates.adminHelp')}</p>
              <DataTable
                loading={gates.isLoading}
                rows={gates.data?.items}
                rowKey={(r) => r.id}
                caption={t('gates.adminTab')}
                empty={<EmptyState title={t('gates.adminEmpty')} />}
                columns={[
                  { key: 'code', header: t('review.colCode'), render: (r) => <span className="font-medium text-ink">{r.entity.code}</span> },
                  { key: 'title', header: t('review.colTitle'), render: (r) => <span>{r.entity.title}<span className="block text-xs text-ink-muted">{r.entity.context}</span></span> },
                  { key: 'stage', header: t('review.colRound'), render: (r) => `${t(`gates.stage.${r.stage}`)}${r.round_no > 1 ? ` · ${t('gates.round', { n: r.round_no })}` : ''}` },
                  { key: 'judges', header: t('judging.title'), render: (r) => (r.tally.total ? t('gates.tally', { decided: r.tally.total - r.tally.pending, total: r.tally.total }) : <Badge tone="warning">{t('gates.noJudgesShort')}</Badge>) },
                  { key: 'status', header: t('review.colStatus'), render: (r) => <Badge tone={GATE_TONE[r.status]}>{t(`gates.status.${r.status}`)}</Badge> },
                  { key: 'open', header: '', align: 'right', render: (r) => <ButtonLink to={r.entity.link} size="sm" variant="secondary">{t('common.open')}</ButtonLink> },
                ]}
              />
            </Card>
          )}
        </div>
      )}

      {tab === 'ideas' && (
        <div role="tabpanel" aria-label={t('judging.tabIdeas')} className="space-y-4">
          {ideas.isError ? (
            <ErrorState error={ideas.error} onRetry={() => void ideas.refetch()} />
          ) : (
            <Card>
              <Field label={t('judging.ideaField')} help={t('judging.ideaFieldHelp')} className="max-w-2xl">
                <Select
                  value={ideaKey}
                  onChange={(e) => set('idea', e.target.value)}
                  placeholder={ideas.isLoading ? t('common.loading') : t('judging.chooseIdea')}
                  options={ideaRows.map((i) => ({ value: i.key, label: `${i.code ?? ''} — ${i.title} — ${statusLabel(i.current_state_code)}` }))}
                />
              </Field>
            </Card>
          )}
          {ideas.isLoading && <Skeleton className="h-24 w-full" />}
          {ideaKey && idea ? (
            <Card>
              <h2 className="text-lg font-semibold text-ink">{t('judging.ideaTitle', { code: idea.code ?? idea.key })}</h2>
              <p className="mb-4 text-sm text-ink-muted">{idea.title}</p>
              <IdeaJudgesPanel key={ideaKey} ideaKey={ideaKey} ideaCode={idea.code ?? idea.key} />
            </Card>
          ) : (
            !ideas.isError && !ideas.isLoading && <EmptyState title={ideaRows.length ? t('judging.chooseIdeaFirst') : t('judging.noIdeasToJudge')} />
          )}
        </div>
      )}
    </div>
  );
}
