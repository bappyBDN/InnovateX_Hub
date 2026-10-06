import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Rocket, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError, api, errorMessage, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import { Badge, Button, Card, ConfirmDialog, ErrorState, PageHeader, PageSkeleton, isNotFound } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useUnsavedChangesGuard } from '@/hooks';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/dates';
import { money } from '@/utils/format';
import { tr } from '@/utils/i18n';
import {
  BasicsStep,
  EligibilityStep,
  FormsStep,
  JudgingStep,
  PrizesStep,
  ProblemStep,
  ReviewStep,
  ShortlistStep,
  TimelineStep,
  prizeTotal,
  type StepProps,
} from './builder/steps';
import {
  emptyConfig,
  toPayload,
  type BuilderLookups,
  type ChallengeConfig,
  type ChecklistItem,
  type FormItem,
  type NamedItem,
  type OrgUnitItem,
  type ScorecardItem,
  type UserBrief,
} from './builder/types';

interface ManageDetail {
  id: string;
  code: string;
  slug: string;
  status_code: string;
  config: ChallengeConfig;
  publish_checklist: ChecklistItem[];
  can_manage: boolean;
}

const STEPS = ['basics', 'problem', 'eligibility', 'timeline', 'forms', 'judging', 'shortlist', 'prizes', 'review'] as const;

function Preview({ cfg, lookups }: { cfg: ChallengeConfig; lookups: BuilderLookups }) {
  const { t } = useTranslation();
  const domain = lookups.domains.find((d) => d.id === cfg.domain_id);
  const sponsor = lookups.users.find((u) => u.id === cfg.sponsor_user_id);
  const registration = cfg.phases.find((p) => p.phase_type === 'REGISTRATION');
  const total = prizeTotal(cfg.prizes);
  return (
    <Card padded={false} className="overflow-hidden">
      <div className="h-20" style={{ backgroundColor: cfg.banner_color ?? undefined }} aria-hidden />
      <div className="space-y-2 p-4">
        <p className="text-xs font-medium text-ink-muted">{t('manage.builder.preview')}</p>
        <h3 className="text-lg font-semibold text-ink">{cfg.title || t('manage.builder.previewUntitled')}</h3>
        {cfg.title_bn && (
          <p className="text-sm text-ink-muted" lang="bn">
            {cfg.title_bn}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {domain && <Badge tone="primary">{tr(domain.name_i18n, domain.name)}</Badge>}
          <Badge>
            {cfg.participation_mode === 'INDIVIDUAL'
              ? t('manage.mode.INDIVIDUAL')
              : t('manage.builder.previewTeam', { min: cfg.team_min_size, max: cfg.team_max_size })}
          </Badge>
          {total > 0 && <Badge tone="spark">{money(total)}</Badge>}
        </div>
        {sponsor && <p className="text-sm text-ink-muted">{t('manage.builder.previewSponsor', { name: sponsor.full_name })}</p>}
        {cfg.problem_statement && <p className="line-clamp-4 text-sm text-ink">{cfg.problem_statement}</p>}
        {registration?.closes_at && (
          <p className="text-sm text-ink-muted">{t('manage.builder.previewRegCloses', { date: formatDateTime(registration.closes_at) })}</p>
        )}
      </div>
    </Card>
  );
}

export default function ChallengeBuilderPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const routeId = useParams().id;
  const [search, setSearch] = useSearchParams();
  const [id, setId] = useState<string | undefined>(routeId);
  const [cfg, setCfg] = useState<ChallengeConfig>(emptyConfig);
  const [saved, setSaved] = useState<string>(() => JSON.stringify(emptyConfig()));
  const [missing, setMissing] = useState<string[]>([]);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const stepParam = search.get('step');
  const step = Math.max(0, STEPS.indexOf((stepParam ?? 'basics') as (typeof STEPS)[number]));
  const goTo = (i: number) => {
    const next = new URLSearchParams(search);
    next.set('step', STEPS[Math.min(Math.max(i, 0), STEPS.length - 1)]);
    setSearch(next, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const detail = useQuery({
    queryKey: queryKeys.manage.challenge(id ?? 'new'),
    queryFn: () => api.get<ManageDetail>(`/manage/challenges/${id}`),
    enabled: !!id,
  });
  const domains = useQuery({ queryKey: queryKeys.masterdata.domains, queryFn: () => api.get<NamedItem[]>('/domains') });
  const categories = useQuery({ queryKey: queryKeys.masterdata.categories, queryFn: () => api.get<NamedItem[]>('/categories') });
  const users = useQuery({ queryKey: queryKeys.masterdata.users('all'), queryFn: () => api.get<Page<UserBrief>>('/users', { limit: 50 }) });
  const orgUnits = useQuery({ queryKey: queryKeys.masterdata.orgUnits, queryFn: () => api.get<OrgUnitItem[]>('/org-units') });
  const forms = useQuery({ queryKey: queryKeys.admin.forms, queryFn: () => api.get<FormItem[]>('/forms') });
  const scorecards = useQuery({ queryKey: queryKeys.admin.scorecards, queryFn: () => api.get<ScorecardItem[]>('/scorecards') });

  // Load the saved configuration once per challenge (never overwrite what the user is typing).
  useEffect(() => {
    if (detail.data && loadedFor.current !== detail.data.id) {
      loadedFor.current = detail.data.id;
      const loaded = { ...emptyConfig(), ...detail.data.config };
      setCfg(loaded);
      setSaved(JSON.stringify(loaded));
    }
  }, [detail.data]);

  const lookups: BuilderLookups = useMemo(
    () => ({
      domains: domains.data ?? [],
      categories: categories.data ?? [],
      users: users.data?.items ?? [],
      orgUnits: orgUnits.data ?? [],
      forms: forms.data ?? [],
      scorecards: scorecards.data ?? [],
    }),
    [domains.data, categories.data, users.data, orgUnits.data, forms.data, scorecards.data],
  );

  const dirty = JSON.stringify(cfg) !== saved;
  useUnsavedChangesGuard(dirty);
  // After the first save, move to the edit URL (once nothing is unsaved, so the leave-page guard stays quiet).
  useEffect(() => {
    if (id && id !== routeId && !dirty) navigate(`/manage/challenges/${id}/edit?step=${stepParam ?? 'basics'}`, { replace: true });
  }, [id, routeId, dirty, navigate, stepParam]);
  const status = detail.data?.status_code ?? 'DRAFT';
  const locked = !!id && status !== 'DRAFT';
  const set = (patch: Partial<ChallengeConfig>) => setCfg((c) => ({ ...c, ...patch }));

  const save = useMutation({
    mutationFn: async (): Promise<string> => {
      const body = toPayload(cfg);
      if (id) {
        await api.put(`/challenges/${id}`, body);
        return id;
      }
      const created = await api.post<{ id: string }>('/challenges', body);
      return created.id;
    },
    onSuccess: async (savedId) => {
      setSaved(JSON.stringify(cfg));
      if (!id) {
        loadedFor.current = savedId; // keep the local state; do not reload over it
        setId(savedId);
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(savedId) }),
        qc.invalidateQueries({ queryKey: ['manage', 'challenges'] }),
        qc.invalidateQueries({ queryKey: queryKeys.challenges.all }),
      ]);
    },
  });

  const saveDraft = () => {
    if (!cfg.title.trim()) {
      toast.error(t('manage.builder.titleRequired'));
      goTo(0);
      return;
    }
    save.mutate(undefined, {
      onSuccess: () => toast.success(locked ? t('manage.builder.changesSaved') : t('manage.builder.draftSaved')),
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const publish = useMutation({
    mutationFn: async () => {
      const savedId = await save.mutateAsync();
      await api.post(`/challenges/${savedId}/actions/publish`);
      return savedId;
    },
    onSuccess: async (savedId) => {
      toast.success(t('manage.builder.published'));
      await qc.invalidateQueries({ queryKey: queryKeys.manage.challenge(savedId) });
      navigate(`/manage/challenges/${savedId}`);
    },
    onError: (e) => {
      setConfirmPublish(false);
      if (e instanceof ApiError && e.code === 'PUBLISH_CHECKLIST_INCOMPLETE') {
        const list = (e.details as { missing?: string[] } | undefined)?.missing ?? [];
        setMissing(list);
        goTo(STEPS.length - 1);
      }
      toast.error(errorMessage(e));
    },
  });

  if (id && isNotFound(detail.error)) return <NotFoundPage />;
  if (id && detail.isError) return <ErrorState error={detail.error} onRetry={() => detail.refetch()} />;
  if (id && detail.isLoading) return <PageSkeleton rows={6} />;
  if (detail.data && !detail.data.can_manage) return <NotFoundPage />;

  const props: StepProps = { cfg, set, lookups, locked };
  const current = STEPS[step];
  const checklist = detail.data?.publish_checklist ?? null;
  const allOk = !!checklist && checklist.every((c) => c.ok || c.optional);

  return (
    <div className="space-y-6">
      <PageHeader
        title={id ? t('manage.builder.editTitle') : t('manage.builder.newTitle')}
        subtitle={t('manage.builder.subtitle')}
        breadcrumbs={[
          { label: t('manage.list.pageTitle'), to: '/manage/challenges' },
          ...(id && detail.data ? [{ label: detail.data.code, to: `/manage/challenges/${id}` }] : []),
          { label: id ? t('common.edit') : t('manage.list.create') },
        ]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-sm text-ink-muted" aria-live="polite">
              {save.isPending ? t('common.saving') : dirty ? t('manage.builder.unsaved') : id ? t('common.saved') : ''}
            </span>
          </span>
        }
        actions={
          <Button variant="secondary" icon={<Save className="h-4 w-4" aria-hidden />} onClick={saveDraft} loading={save.isPending && !publish.isPending}>
            {locked ? t('manage.builder.saveChanges') : t('common.saveDraft')}
          </Button>
        }
      />

      {locked && <Callout tone="info">{t('manage.builder.lockedBanner')}</Callout>}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <nav aria-label={t('manage.builder.stepsLabel')}>
          <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
            {STEPS.map((s, i) => (
              <li key={s} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={i === step ? 'step' : undefined}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 rounded-control px-3 py-2 text-left text-sm',
                    i === step ? 'bg-primary-soft font-medium text-primary' : 'text-ink hover:bg-neutral-soft',
                  )}
                >
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs tabular', i === step ? 'border-primary' : 'border-line')}>
                    {i + 1}
                  </span>
                  <span className="whitespace-nowrap">{t(`manage.builder.step.${s}`)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <Card>
          <h2 className="mb-1 text-xl font-semibold text-ink">
            {step + 1}. {t(`manage.builder.step.${current}`)}
          </h2>
          <p className="mb-5 text-sm text-ink-muted">{t(`manage.builder.stepHelp.${current}`)}</p>
          {current === 'basics' && <BasicsStep {...props} />}
          {current === 'problem' && <ProblemStep {...props} />}
          {current === 'eligibility' && <EligibilityStep {...props} />}
          {current === 'timeline' && <TimelineStep {...props} />}
          {current === 'forms' && <FormsStep {...props} />}
          {current === 'judging' && <JudgingStep {...props} />}
          {current === 'shortlist' && <ShortlistStep {...props} />}
          {current === 'prizes' && <PrizesStep {...props} />}
          {current === 'review' && <ReviewStep {...props} checklist={checklist} dirty={dirty} missing={missing} />}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => goTo(step - 1)} disabled={step === 0}>
              {t('common.back')}
            </Button>
            {current !== 'review' ? (
              <Button onClick={() => goTo(step + 1)}>{t('common.next')}</Button>
            ) : locked ? (
              <Button icon={<Check className="h-4 w-4" aria-hidden />} onClick={saveDraft} loading={save.isPending}>
                {t('manage.builder.saveChanges')}
              </Button>
            ) : (
              <Button
                icon={<Rocket className="h-4 w-4" aria-hidden />}
                onClick={() => (cfg.title.trim() ? setConfirmPublish(true) : saveDraft())}
                disabled={!!checklist && !dirty && !allOk}
                disabledReason={t('manage.builder.finishChecklist')}
              >
                {t('manage.builder.publish')}
              </Button>
            )}
          </div>
        </Card>

        <aside className="hidden xl:block">
          <div className="sticky top-20">
            <Preview cfg={cfg} lookups={lookups} />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={t('manage.builder.publishConfirmTitle')}
        description={t('manage.builder.publishConfirmBody')}
        confirmLabel={t('manage.builder.publish')}
        loading={publish.isPending}
        onConfirm={() => publish.mutate()}
      />
    </div>
  );
}
