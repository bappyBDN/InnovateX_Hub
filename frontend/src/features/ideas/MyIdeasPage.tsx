import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { JourneyRail, StatusBadge } from '@/components/domain';
import { Badge, Button, ButtonLink, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { relativeFromNow } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import { CLOSED_STATES, type IdeaCard } from './shared';

type Tab = 'drafts' | 'submitted' | 'closed';

export default function MyIdeasPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab | null>(null);
  const [toDelete, setToDelete] = useState<IdeaCard | null>(null);

  const list = useQuery({
    queryKey: queryKeys.ideas.list({ scope: 'mine' }),
    queryFn: () => api.get<Page<IdeaCard>>('/initiatives', { scope: 'mine', page_size: 200 }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/initiatives/${id}`),
    onSuccess: () => {
      toast.success(t('ideas.list.draftDeleted'));
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.all });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = list.data?.items ?? [];
  const groups: Record<Tab, IdeaCard[]> = {
    drafts: all.filter((i) => i.current_state_code === 'DRAFT'),
    submitted: all.filter((i) => i.current_state_code !== 'DRAFT' && !CLOSED_STATES.includes(i.current_state_code)),
    closed: all.filter((i) => CLOSED_STATES.includes(i.current_state_code)),
  };
  const active: Tab = tab ?? (groups.submitted.length ? 'submitted' : groups.drafts.length ? 'drafts' : 'submitted');
  const items = groups[active];

  return (
    <>
      <PageHeader
        title={t('ideas.myIdeas')}
        subtitle={t('ideas.list.subtitle')}
        actions={
          <ButtonLink to="/ideas/new" icon={<Plus className="h-4 w-4" aria-hidden />}>
            {t('ideas.submitIdea')}
          </ButtonLink>
        }
      />
      {list.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="h-8 w-8" aria-hidden />}
          title={t('ideas.list.emptyTitle')}
          description={t('ideas.list.emptyBody')}
          action={<ButtonLink to="/ideas/new">{t('ideas.submitIdea')}</ButtonLink>}
        />
      ) : (
        <>
          <Tabs
            ariaLabel={t('ideas.myIdeas')}
            value={active}
            onChange={(v) => setTab(v as Tab)}
            tabs={[
              { value: 'drafts', label: t('ideas.list.drafts'), count: groups.drafts.length },
              { value: 'submitted', label: t('ideas.list.submitted'), count: groups.submitted.length },
              { value: 'closed', label: t('ideas.list.closed'), count: groups.closed.length },
            ]}
            className="mb-4"
          />
          {items.length === 0 ? (
            <EmptyState
              title={t(`ideas.list.none.${active}`)}
              action={active === 'drafts' ? <ButtonLink to="/ideas/new">{t('ideas.submitIdea')}</ButtonLink> : undefined}
            />
          ) : (
            <ul className="space-y-3">
              {items.map((idea) => {
                const draft = idea.current_state_code === 'DRAFT';
                const to = draft ? `/ideas/${idea.key}/edit` : `/ideas/${idea.key}`;
                return (
                  <li key={idea.id}>
                    <Card className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="tabular text-xs text-ink-muted">
                            {idea.code ?? t('ideas.draft')}
                            {idea.category ? ` · ${tr(idea.category.name_i18n)}` : ''}
                            {idea.updated_at ? ` · ${t('ideas.list.updated', { when: relativeFromNow(idea.updated_at) })}` : ''}
                          </p>
                          <h2 className="text-lg font-semibold text-ink">
                            <Link to={to} className="hover:text-primary hover:underline">
                              {idea.title}
                            </Link>
                          </h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {idea.is_awarded && <Badge tone="spark">{t('ideas.awarded')}</Badge>}
                          <StatusBadge status={idea.current_state_code} />
                        </div>
                      </div>
                      {!draft && (
                        <div className="overflow-x-auto">
                          <JourneyRail stages={idea.journey} size="compact" />
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="min-w-0 flex-1 text-sm text-ink-muted">{idea.next_step.text}</p>
                        <div className="flex gap-2">
                          {draft && (
                            <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={() => setToDelete(idea)}>
                              {t('ideas.list.deleteDraft')}
                            </Button>
                          )}
                          <ButtonLink to={idea.next_step.action_path ?? to} size="sm" variant={idea.next_step.action_path ? 'primary' : 'secondary'}>
                            {idea.next_step.action_label ?? t('ideas.openIdea')}
                          </ButtonLink>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t('ideas.list.deleteTitle')}
        description={t('ideas.list.deleteBody', { title: toDelete?.title ?? '' })}
        confirmLabel={t('ideas.list.deleteDraft')}
        variant="danger"
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
