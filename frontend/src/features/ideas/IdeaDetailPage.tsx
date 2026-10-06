import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, ExternalLink, HelpCircle, MessageSquare, Pencil, Plus, Trophy, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { GatePanel } from '@/features/gates/GatePanel';
import { IdeaJudgesDialog } from '@/features/judging/IdeaJudgesDialog';
import { JudgeFeedbackPanel } from '@/features/judging/JudgeFeedbackPanel';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { AttachmentList, Callout, ConfidentialBanner, FeedbackCard, JourneyRail, StatusBadge, UserChip } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  ProgressBar,
  Select,
  Skeleton,
  Tabs,
  RichText,
  Textarea,
  isNotFound,
} from '@/components/ui';
import { AddKpiDialog, KpiCard, type KpiItem } from '@/features/impact/KpiParts';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { cn } from '@/utils/cn';
import { formatDate, formatDateTime } from '@/utils/dates';
import { money, num, statusLabel } from '@/utils/format';
import { tr } from '@/utils/i18n';
import { useLookups, type IdeaAction, type IdeaClarification, type IdeaDetail } from './shared';

type Tab = 'overview' | 'team' | 'evidence' | 'feedback' | 'impact' | 'milestones' | 'history';

export default function IdeaDetailPage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [action, setAction] = useState<IdeaAction | null>(null);
  const [dialog, setDialog] = useState<'assign' | 'ask' | 'publish' | null>(null);

  const idea = useQuery({ queryKey: queryKeys.ideas.detail(code), queryFn: () => api.get<IdeaDetail>(`/initiatives/${code}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.ideas.all });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
  };

  if (idea.isLoading) return <PageSkeleton rows={6} />;
  if (idea.error) {
    // The API answers 404 both for "does not exist" and "you may not see it".
    if (isNotFound(idea.error)) return <NotFoundPage />;
    return <ErrorState error={idea.error} onRetry={() => void idea.refetch()} />;
  }
  const d = idea.data!;
  const openQuestions = d.clarifications.filter((c) => c.status === 'OPEN');
  const mine = d.my_role === 'OWNER' || d.my_role === 'MEMBER';
  const catalogueReady = d.can_manage && !d.confidential && !d.is_published_to_catalogue && ['PRODUCTION', 'IMPACT_VERIFIED', 'SCALED'].includes(d.current_state_code);
  const canAsk = d.can_manage && ['SUBMITTED', 'TRIAGE', 'UNDER_REVIEW', 'CLARIFICATION_REQUESTED'].includes(d.current_state_code);
  const canAssign = !!d.can_assign_judges && ['TRIAGE', 'UNDER_REVIEW', 'CLARIFICATION_REQUESTED'].includes(d.current_state_code);

  return (
    <>
      <PageHeader
        title={d.title}
        breadcrumbs={[{ label: mine ? t('ideas.myIdeas') : t('ideas.portfolio'), to: mine ? '/ideas' : '/manage/ideas' }, { label: d.code ?? t('ideas.draft') }]}
        subtitle={
          <span className="tabular">
            {d.code ?? t('ideas.draft')}
            {d.category ? ` · ${tr(d.category.name_i18n)}` : ''}
            {d.org_unit ? ` · ${d.org_unit}` : ''}
          </span>
        }
        meta={
          <>
            <StatusBadge status={d.current_state_code} />
            {d.is_awarded && (
              <Badge tone="spark" icon={<Trophy className="h-3.5 w-3.5" aria-hidden />}>
                {t('ideas.awarded')}
              </Badge>
            )}
          </>
        }
        actions={
          d.can_edit ? (
            <ButtonLink to={`/ideas/${d.key}/edit`} variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden />}>
              {d.current_state_code === 'DRAFT' ? t('ideas.detail.continue') : t('ideas.detail.edit')}
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {d.confidential && <ConfidentialBanner />}

        {openQuestions.map((c) => (
          <ClarificationBox key={c.id} item={c} canReply={mine} onDone={refresh} />
        ))}

        <Card>
          <div className="overflow-x-auto pb-1">
            <JourneyRail stages={d.journey} size="full" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-medium text-ink-muted">{t('ideas.detail.nextStep')}</p>
              <p className="text-ink">{d.next_step.text}</p>
            </div>
            {mine && d.next_step.action_path && d.next_step.action_path !== `/ideas/${d.key}` && (
              <ButtonLink to={d.next_step.action_path}>{d.next_step.action_label}</ButtonLink>
            )}
          </div>
          {d.duplicate_of && (
            <p className="mt-3 text-sm text-ink-muted">
              {t('ideas.detail.duplicateOf', { code: d.duplicate_of.code, title: d.duplicate_of.title })}
            </p>
          )}
        </Card>

        {(d.allowed_actions.length > 0 || canAsk || canAssign || catalogueReady) && (
          <Card>
            <CardHeader title={t('ideas.detail.actions')} subtitle={mine ? t('ideas.detail.actionsOwner') : t('ideas.detail.actionsStaff')} />
            <div className="mt-3 flex flex-wrap gap-2">
              {d.allowed_actions.map((a) => (
                <Button key={a.action_code} variant={a.tone} onClick={() => setAction(a)}>
                  {a.label}
                </Button>
              ))}
              {canAssign && (
                <Button variant="secondary" icon={<UserPlus className="h-4 w-4" aria-hidden />} onClick={() => setDialog('assign')}>
                  {t('ideas.staff.assign')}
                </Button>
              )}
              {canAsk && (
                <Button variant="secondary" icon={<HelpCircle className="h-4 w-4" aria-hidden />} onClick={() => setDialog('ask')}>
                  {t('ideas.staff.ask')}
                </Button>
              )}
              {catalogueReady && (
                <Button variant="secondary" icon={<BookMarked className="h-4 w-4" aria-hidden />} onClick={() => setDialog('publish')}>
                  {t('ideas.staff.publish')}
                </Button>
              )}
            </div>
            {d.is_published_to_catalogue && <p className="mt-3 text-sm text-success">{t('ideas.staff.inCatalogue')}</p>}
          </Card>
        )}

        <Tabs
          ariaLabel={d.title}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          tabs={[
            { value: 'overview', label: t('ideas.tabs.overview') },
            { value: 'team', label: t('ideas.tabs.team'), count: d.members.length },
            { value: 'evidence', label: t('ideas.tabs.evidence') },
            { value: 'feedback', label: t('ideas.tabs.feedback'), count: d.feedback.length || undefined },
            { value: 'impact', label: t('ideas.tabs.impact') },
            { value: 'milestones', label: t('ideas.tabs.milestones') },
            { value: 'history', label: t('ideas.tabs.history') },
          ]}
        />

        {tab === 'overview' && <GatePanel entityType="initiative" entityId={d.id} onChange={refresh} />}
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'team' && <Team d={d} />}
        {tab === 'evidence' && (
          <Card>
            <AttachmentList entityType="initiative" entityId={d.id} canEdit={d.can_upload} title={t('ideas.detail.files')} />
            {(d.content?.links ?? []).length > 0 && (
              <div className="mt-5 border-t border-line pt-4">
                <h3 className="text-sm font-medium text-ink-muted">{t('ideas.fields.links')}</h3>
                <ul className="mt-2 space-y-1">
                  {(d.content.links ?? []).map((l, i) => (
                    <li key={i}>
                      <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary underline">
                        <ExternalLink className="h-4 w-4" aria-hidden />
                        {l.title || l.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}
        {tab === 'feedback' && <FeedbackTab d={d} />}
        {tab === 'impact' && <ImpactTab d={d} />}
        {tab === 'milestones' && <MilestonesTab d={d} />}
        {tab === 'history' && <HistoryTab ideaKey={d.key} />}

        <Comments d={d} />
      </div>

      {action && <ActionDialog idea={d} action={action} onClose={() => setAction(null)} onDone={refresh} />}
      {dialog === 'assign' && <IdeaJudgesDialog ideaKey={d.key} ideaCode={d.code ?? d.key} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'ask' && <AskDialog idea={d} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog === 'publish' && <PublishDialog idea={d} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
  );
}

// ---- Clarification (amber box at the top) ------------------------------------------------------
function ClarificationBox({ item, canReply, onDone }: { item: IdeaClarification; canReply: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: () => api.post(`/clarifications/${item.id}/answer`, { answer: answer.trim() }),
    onSuccess: () => {
      toast.success(t('ideas.clarification.sent'));
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Callout
      tone="warning"
      title={canReply ? t('ideas.clarification.title') : t('ideas.clarification.waiting')}
      action={canReply && !open ? <Button onClick={() => setOpen(true)}>{t('ideas.clarification.reply')}</Button> : undefined}
    >
      <p className="reading whitespace-pre-wrap text-ink">{item.question}</p>
      <p className="mt-1 text-sm">
        {item.asked_by ? `${item.asked_by} · ` : ''}
        {item.due_at ? t('ideas.clarification.due', { date: formatDateTime(item.due_at) }) : ''}
      </p>
      {open && (
        <div className="mt-3 space-y-3 text-ink">
          <Field label={t('ideas.clarification.yourReply')} required error={error}>
            <Textarea rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button loading={reply.isPending} onClick={() => (answer.trim() ? reply.mutate() : setError(t('ideas.clarification.replyRequired')))}>
              {t('ideas.clarification.send')}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </Callout>
  );
}

// ---- Tabs ----------------------------------------------------------------------------------------
function Row({ label, children, rich }: { label: string; children: React.ReactNode; rich?: boolean }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div>
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className={cn('reading text-ink', !rich && 'whitespace-pre-wrap')}>{empty ? '—' : rich && typeof children === 'string' ? <RichText value={children} /> : children}</dd>
    </div>
  );
}

function Overview({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  const lookups = useLookups();
  const label = (type: string, c: string | null) => {
    const v = lookups.data?.[type]?.find((x) => x.code === c);
    return v ? tr(v.label_i18n, v.label) : c ? statusLabel(c) : '';
  };
  const list = (type: string, codes: string[] | null) => (codes ?? []).map((c) => label(type, c)).join(', ');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <dl className="space-y-4">
          {d.summary && <Row label={t('ideas.fields.summary')}>{d.summary}</Row>}
          <Row rich label={t('ideas.fields.problem')}>{d.problem_statement}</Row>
          <Row rich label={t('ideas.fields.affected')}>{d.affected_users}</Row>
          <Row rich label={t('ideas.fields.currentProcess')}>{d.current_process}</Row>
          <Row rich label={t('ideas.fields.solution')}>{d.proposed_solution}</Row>
          <Row rich label={t('ideas.fields.technology')}>{d.technology_used}</Row>
          <Row rich label={t('ideas.fields.differentiator')}>{d.differentiator}</Row>
          <Row rich label={t('ideas.fields.benefit')}>{d.expected_benefit}</Row>
          <Row rich label={t('ideas.fields.dependencies')}>{d.dependencies}</Row>
        </dl>
      </Card>
      <Card>
        <dl className="space-y-4">
          <Row label={t('ideas.fields.type')}>{label('INNOVATION_TYPE', d.innovation_type_code)}</Row>
          <Row label={t('ideas.fields.kpi')}>{d.primary_kpi}</Row>
          <Row label={t('ideas.fields.baseline')}>{d.baseline_value}</Row>
          <Row label={t('ideas.fields.target')}>{d.target_value}</Row>
          <Row label={t('ideas.fields.benefitTypes')}>{list('BENEFIT_TYPE', d.benefit_types)}</Row>
          <Row label={t('ideas.fields.scalability')}>{label('SCALABILITY_LEVEL', d.scalability_level_code)}</Row>
          <Row label={t('ideas.fields.classification')}>{label('DATA_CLASSIFICATION', d.data_classification_code)}</Row>
          <Row label={t('ideas.fields.risks')}>{list('RISK_TYPE', d.risk_flags)}</Row>
          <Row label={t('ideas.fields.timeline')}>{d.expected_timeline}</Row>
          <Row label={t('ideas.fields.cost')}>{d.estimated_cost != null ? money(d.estimated_cost, d.currency_code) : ''}</Row>
          <Row label={t('ideas.detail.submitted')}>{d.submitted_at ? formatDateTime(d.submitted_at) : ''}</Row>
          {d.score_latest != null && <Row label={t('ideas.detail.score')}>{t('ideas.detail.scoreOf', { score: num(d.score_latest, 1) })}</Row>}
        </dl>
      </Card>
    </div>
  );
}

function Team({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  return (
    <Card>
      <ul className="divide-y divide-line">
        {d.members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <UserChip name={m.full_name} subtitle={[m.job_title, m.org_unit].filter(Boolean).join(' · ')} />
            <div className="flex items-center gap-3">
              <Badge tone={m.member_role === 'OWNER' ? 'primary' : 'neutral'}>{t(`ideas.roles.${m.member_role}`)}</Badge>
              <span className="tabular text-sm text-ink-muted">{m.credit_share_pct != null ? t('ideas.fields.credit', { pct: num(m.credit_share_pct, 0) }) : ''}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <Row label={t('ideas.fields.sponsor')}>{d.sponsor ? `${d.sponsor.full_name}${d.sponsor.job_title ? ` · ${d.sponsor.job_title}` : ''}` : t('ideas.detail.noSponsor')}</Row>
        <Row label={t('ideas.detail.submittedBy')}>
          {d.submitted_by?.full_name}
          {d.on_behalf_of ? ` (${t('ideas.detail.onBehalf', { name: d.on_behalf_of.full_name })})` : ''}
        </Row>
      </dl>
    </Card>
  );
}

function FeedbackTab({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  const answered = d.clarifications.filter((c) => c.status !== 'OPEN');
  return (
    <div className="space-y-4">
      {d.feedback.length === 0 && !d.reviews?.length && answered.length === 0 && (
        <EmptyState icon={<MessageSquare className="h-8 w-8" aria-hidden />} title={t('ideas.feedback.emptyTitle')} description={t('ideas.feedback.emptyBody')} />
      )}
      {d.feedback.map((f) => (
        <FeedbackCard key={f.id} feedback={f} title={t('ideas.feedback.title')} />
      ))}
      {answered.length > 0 && (
        <Card>
          <CardHeader title={t('ideas.feedback.questions')} />
          <ul className="mt-3 space-y-4">
            {answered.map((c) => (
              <li key={c.id}>
                <p className="font-medium text-ink">{c.question}</p>
                <p className="reading whitespace-pre-wrap text-ink">{c.answer}</p>
                <p className="text-xs text-ink-muted">{formatDateTime(c.answered_at)}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {d.reviews && (
        <Card>
          <CardHeader title={t('judgeFeedback.title')} subtitle={t('judgeFeedback.help')} />
          <div className="mt-4">
            <JudgeFeedbackPanel entityType="initiative" entityId={d.id} />
          </div>
        </Card>
      )}
    </div>
  );
}

function ImpactTab({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const kpis = useQuery({
    queryKey: queryKeys.kpis('initiative', d.id),
    queryFn: () => api.get<KpiItem[]>('/kpis', { entity_type: 'initiative', entity_id: d.id }),
  });
  const canEdit = d.can_upload;
  if (kpis.isLoading) return <Skeleton className="h-40 w-full" />;
  if (kpis.error) return <ErrorState error={kpis.error} onRetry={() => void kpis.refetch()} />;
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            {t('impact.addKpi')}
          </Button>
        </div>
      )}
      {kpis.data!.length === 0 ? (
        <EmptyState
          title={t('ideas.impact.emptyTitle')}
          description={t('ideas.impact.emptyBody')}
          action={canEdit ? <Button onClick={() => setAdding(true)}>{t('impact.addKpi')}</Button> : undefined}
        />
      ) : (
        kpis.data!.map((k) => <KpiCard key={k.id} kpi={k} canEdit={canEdit} />)
      )}
      {adding && <AddKpiDialog entityType="initiative" entityId={d.id} onClose={() => setAdding(false)} />}
    </div>
  );
}

interface Milestone {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED';
  owner: string | null;
}
const MILESTONE_STATES = ['PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED'];

function MilestonesTab({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = queryKeys.milestones('initiative', d.id);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ milestones: Milestone[]; percent_complete: number }>('/milestones', { entity_type: 'initiative', entity_id: d.id }),
  });
  const add = useMutation({
    mutationFn: () => api.post('/milestones', { entity_type: 'initiative', entity_id: d.id, title: title.trim(), due_date: due || null }),
    onSuccess: () => {
      toast.success(t('ideas.milestones.added'));
      setAdding(false);
      setTitle('');
      setDue('');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; status: string }) => api.patch(`/milestones/${v.id}`, { status: v.status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const canEdit = d.can_upload;
  if (list.isLoading) return <Skeleton className="h-40 w-full" />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  const items = list.data!.milestones;
  return (
    <Card>
      <CardHeader
        title={t('ideas.tabs.milestones')}
        actions={
          canEdit ? (
            <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
              {t('ideas.milestones.add')}
            </Button>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title={t('ideas.milestones.emptyTitle')}
          description={t('ideas.milestones.emptyBody')}
          action={canEdit ? <Button onClick={() => setAdding(true)}>{t('ideas.milestones.add')}</Button> : undefined}
        />
      ) : (
        <>
          <ProgressBar value={list.data!.percent_complete} label={t('ideas.milestones.progress')} showValue className="mt-3" />
          <ul className="mt-3 divide-y divide-line">
            {items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{m.title}</p>
                  <p className="text-sm text-ink-muted">
                    {m.due_date ? t('ideas.milestones.due', { date: formatDate(m.due_date) }) : t('ideas.milestones.noDue')}
                    {m.owner ? ` · ${m.owner}` : ''}
                  </p>
                </div>
                {canEdit ? (
                  <Select
                    aria-label={t('ideas.milestones.statusOf', { title: m.title })}
                    className="w-40"
                    value={m.status}
                    onChange={(e) => update.mutate({ id: m.id, status: e.target.value })}
                    options={MILESTONE_STATES.map((s) => ({ value: s, label: t(`status.${s}`, statusLabel(s)) }))}
                  />
                ) : (
                  <StatusBadge status={m.status} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title={t('ideas.milestones.add')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={add.isPending} onClick={() => (title.trim() ? add.mutate() : setError(t('ideas.milestones.titleRequired')))}>
              {t('ideas.milestones.add')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('ideas.milestones.title')} required error={error}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('ideas.milestones.dueDate')}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

interface HistoryRow {
  at: string;
  from_state: string | null;
  to_state: string;
  to_label: string;
  action_code: string;
  comment: string | null;
  who: string;
}

function HistoryTab({ ideaKey }: { ideaKey: string }) {
  const { t } = useTranslation();
  const history = useQuery({ queryKey: queryKeys.ideas.history(ideaKey), queryFn: () => api.get<HistoryRow[]>(`/initiatives/${ideaKey}/history`) });
  if (history.isLoading) return <Skeleton className="h-40 w-full" />;
  if (history.error) return <ErrorState error={history.error} onRetry={() => void history.refetch()} />;
  return (
    <Card>
      <ol className="space-y-4">
        {history.data!.map((h, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-ink">
                <span className="font-medium">{h.to_label}</span>
                <span className="text-ink-muted"> · {h.who}</span>
              </p>
              {h.comment && <p className="reading whitespace-pre-wrap text-sm text-ink">{h.comment}</p>}
              <p className="tabular text-xs text-ink-muted">{formatDateTime(h.at)}</p>
            </div>
          </li>
        ))}
        {history.data!.length === 0 && <li className="text-sm text-ink-muted">{t('ideas.history.empty')}</li>}
      </ol>
    </Card>
  );
}

interface CommentRow {
  id: string;
  body: string;
  visibility: string;
  created_at: string;
  author: string | null;
  is_mine: boolean;
}

function Comments({ d }: { d: IdeaDetail }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = queryKeys.comments('initiative', d.id);
  const staff = d.my_role === 'STAFF' || d.my_role === 'REVIEWER';
  const [body, setBody] = useState('');
  const [panelOnly, setPanelOnly] = useState(false);
  const list = useQuery({ queryKey: key, queryFn: () => api.get<CommentRow[]>('/comments', { entity_type: 'initiative', entity_id: d.id }) });
  const add = useMutation({
    mutationFn: () =>
      api.post('/comments', { entity_type: 'initiative', entity_id: d.id, body: body.trim(), visibility: staff && panelOnly ? 'REVIEWERS_ONLY' : 'PUBLIC_TO_TEAM' }),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={t('ideas.comments.title')} subtitle={t('ideas.comments.subtitle')} />
      {list.isLoading ? (
        <Skeleton className="mt-3 h-16 w-full" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <ul className="mt-3 space-y-3">
          {list.data!.length === 0 && <li className="text-sm text-ink-muted">{t('ideas.comments.empty')}</li>}
          {list.data!.map((c) => (
            <li key={c.id} className="rounded-control border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{c.is_mine ? t('ideas.comments.you') : c.author}</span>
                <span className="flex items-center gap-2">
                  <Badge tone={c.visibility === 'PUBLIC_TO_TEAM' ? 'neutral' : 'warning'}>
                    {c.visibility === 'PUBLIC_TO_TEAM' ? t('ideas.comments.teamVisible') : t('ideas.comments.reviewersOnly')}
                  </Badge>
                  <span className="tabular text-xs text-ink-muted">{formatDateTime(c.created_at)}</span>
                </span>
              </div>
              <p className="reading mt-1 whitespace-pre-wrap text-ink">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        <Field label={t('ideas.comments.add')}>
          <Textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {staff ? <Checkbox label={t('ideas.comments.reviewersOnlyToggle')} checked={panelOnly} onChange={(e) => setPanelOnly(e.target.checked)} /> : <span />}
          <Button variant="secondary" loading={add.isPending} disabled={!body.trim()} onClick={() => add.mutate()}>
            {t('ideas.comments.post')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---- Dialogs ---------------------------------------------------------------------------------------
interface DialogCommon {
  idea: IdeaDetail;
  onClose: () => void;
  onDone: () => void;
}

function ActionDialog({ idea, action, onClose, onDone }: DialogCommon & { action: IdeaAction }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [duplicate, setDuplicate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const isDuplicate = action.action_code === 'MARK_DUPLICATE';
  const run = useMutation({
    mutationFn: () =>
      api.post(`/initiatives/${idea.key}/actions/${action.action_code.toLowerCase()}`, {
        comment: comment.trim() || null,
        duplicate_of: isDuplicate ? duplicate.trim() : null,
      }),
    onSuccess: () => {
      toast.success(t('ideas.actions.done', { state: statusLabel(action.to_state) }));
      onDone();
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'STAGE_EVIDENCE_MISSING') setMissing((e.details.missing as string[]) ?? []);
      else if (e instanceof ApiError && (e.code === 'COMMENT_REQUIRED' || e.code === 'DUPLICATE_TARGET_REQUIRED')) setError(e.message);
      else toast.error(errorMessage(e));
    },
  });
  const go = () => {
    setMissing([]);
    if (action.requires_comment && !comment.trim()) return setError(t('ideas.actions.commentRequired'));
    if (isDuplicate && !duplicate.trim()) return setError(t('ideas.actions.duplicateRequired'));
    setError(null);
    run.mutate();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${action.label}?`}
      description={t('ideas.actions.moves', { code: idea.code ?? idea.title, state: statusLabel(action.to_state) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={action.tone === 'danger' ? 'danger' : 'primary'} loading={run.isPending} onClick={go}>
            {action.label}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {missing.length > 0 && (
          <Callout tone="warning" title={t('ideas.actions.missingTitle')}>
            <ul className="list-disc pl-5 text-sm text-ink">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Callout>
        )}
        {isDuplicate && (
          <Field label={t('ideas.actions.duplicateOf')} required help={t('ideas.actions.duplicateHelp')}>
            <Input value={duplicate} onChange={(e) => setDuplicate(e.target.value)} placeholder="INNO-2026-000123" />
          </Field>
        )}
        <Field
          label={action.requires_comment ? t('ideas.actions.reason') : t('ideas.actions.note')}
          required={action.requires_comment}
          help={t('ideas.actions.reasonHelp')}
          error={error}
        >
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function AskDialog({ idea, onClose, onDone }: DialogCommon) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => api.post(`/initiatives/${idea.key}/clarifications`, { question: question.trim() }),
    onSuccess: () => {
      toast.success(t('ideas.staff.asked'));
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ideas.staff.ask')}
      description={t('ideas.staff.askHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={ask.isPending} onClick={() => (question.trim() ? ask.mutate() : setError(t('ideas.staff.questionRequired')))}>
            {t('ideas.staff.sendQuestion')}
          </Button>
        </>
      }
    >
      <Field label={t('ideas.staff.question')} required error={error}>
        <Textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
      </Field>
    </Dialog>
  );
}

const ASSET_TYPES = ['PROCESS', 'COMPONENT', 'TEMPLATE', 'AGENT', 'PROMPT', 'API', 'DATASET', 'DASHBOARD'];

function PublishDialog({ idea, onClose, onDone }: DialogCommon) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [type, setType] = useState('PROCESS');
  const [summary, setSummary] = useState('');
  const publish = useMutation({
    mutationFn: () => api.post(`/initiatives/${idea.key}/catalogue`, { asset_type: type, impact_summary: summary.trim() }),
    onSuccess: () => {
      toast.success(t('ideas.staff.published'));
      void qc.invalidateQueries({ queryKey: ['catalogue'] });
      onDone();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ideas.staff.publish')}
      description={t('ideas.staff.publishHelp')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={publish.isPending} onClick={() => publish.mutate()}>
            {t('ideas.staff.publish')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('ideas.staff.assetType')}>
          <Select value={type} onChange={(e) => setType(e.target.value)} options={ASSET_TYPES.map((a) => ({ value: a, label: t(`catalogue.types.${a}`) }))} />
        </Field>
        <Field label={t('ideas.staff.impactSummary')} help={t('ideas.staff.impactSummaryHelp')}>
          <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
