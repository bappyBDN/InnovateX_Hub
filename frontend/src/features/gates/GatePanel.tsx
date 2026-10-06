import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Send, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError, errorMessage } from '@/api/client';
import { Callout } from '@/components/domain';
import { Badge, Button, Card, CardHeader, ErrorState, Field, Input, RichText, RichTextEditor, Select, Skeleton } from '@/components/ui';
import { QuickAddJudge } from '@/features/judging/QuickAdd';
import type { AddJudgesResult } from '@/features/judging/types';
import { formatDateTime } from '@/utils/dates';
import { DECISIONS, DECISION_TONE, GATE_TONE, type GateDecision, type GateField, type GateOverview, type GateStage, type GateView } from './types';

export const gateKey = (entityType: string, entityId: string) => ['gates', entityType, entityId] as const;

/** The answers of a form, read only. Links open in a new tab; long answers keep their bold, lists and links. */
export function GateAnswers({ fields, content, stage }: { fields: GateField[]; content: Record<string, string>; stage: string }) {
  const { t } = useTranslation();
  return (
    <dl className="space-y-3 text-sm">
      {fields
        .filter((f) => content[f.key])
        .map((f) => (
          <div key={f.key}>
            <dt className="font-medium text-ink-muted">{t(`gates.fieldLabel.${stage}.${f.key}`, f.label)}</dt>
            <dd className="mt-0.5 break-words text-ink">
              {f.kind === 'URL' ? (
                <a href={content[f.key]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
                  {content[f.key]}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <RichText value={content[f.key]} />
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function Tally({ gate }: { gate: GateView }) {
  const { t } = useTranslation();
  const y = gate.tally;
  if (!y.total) return <p className="text-sm text-ink-muted">{t('gates.noJudges')}</p>;
  return (
    <p className="text-sm text-ink-muted">
      {t('gates.tally', { decided: y.total - y.pending, total: y.total })}
      {y.total - y.pending > 0 && ` · ${t('gates.tallyDetail', { approve: y.approve, revise: y.revise, reject: y.reject })}`}
    </p>
  );
}

function FeedbackList({ gate }: { gate: GateView }) {
  const { t } = useTranslation();
  const items = gate.feedback.filter((f) => f.decision);
  if (!items.length && !gate.decision_note) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">{t('gates.feedbackTitle')}</p>
      {gate.decision_note && (
        <Callout tone="info" title={t('gates.adminDecision')}>
          <RichText value={gate.decision_note} />
        </Callout>
      )}
      <ul className="space-y-2">
        {items.map((f, i) => (
          <li key={i} className="rounded-panel border border-line bg-surface px-3 py-2 text-sm">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={DECISION_TONE[f.decision!]}>{t(`gates.decision.${f.decision}`)}</Badge>
              <span className="text-ink-muted">{f.judge ? f.judge.full_name : t('gates.aJudge', { n: i + 1 })}</span>
            </span>
            {f.feedback && <RichText className="mt-1" value={f.feedback} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageCard({ stage, entityType, entityId, canManage, reload }: { stage: GateStage; entityType: string; entityId: string; canManage: boolean; reload: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const gate = stage.gate;
  const [values, setValues] = useState<Record<string, string>>(gate?.content ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState<GateDecision | ''>('');
  const [note, setNote] = useState('');
  useEffect(() => setValues(gate?.content ?? {}), [gate?.id, gate?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (submit: boolean) => api.put<{ status: string }>(`/gates/${entityType}/${entityId}/${stage.stage}`, { content: values, submit }),
    onSuccess: async (res) => {
      setErrors({});
      toast.success(res.status === 'SUBMITTED' ? t('gates.sent') : t('gates.draftSaved'));
      await reload();
    },
    onError: (e) => {
      const fields = e instanceof ApiError ? (e.details as { fields?: Record<string, string> }).fields : undefined;
      setErrors(fields ?? {});
      toast.error(errorMessage(e));
    },
  });
  const addSuggested = useMutation({
    mutationFn: () => api.post<AddJudgesResult>(`/gates/${gate!.id}/judges`, { user_ids: (stage.suggested_judges ?? []).map((j) => j.id) }),
    onSuccess: async () => {
      toast.success(t('judging.added', { count: stage.suggested_judges?.length ?? 0 }));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sendForReview = useMutation({
    mutationFn: () => api.post(`/gates/${gate!.id}/send-for-review`, { user_ids: [] }),
    onSuccess: async () => {
      toast.success(t('gates.sentToJudges'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeJudge = useMutation({
    mutationFn: (userId: string) => api.del(`/gates/${gate!.id}/judges/${userId}`),
    onSuccess: async () => {
      toast.success(t('judging.removed'));
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decide = useMutation({
    mutationFn: () => api.post(`/gates/${gate!.id}/decide`, { decision, note }),
    onSuccess: async () => {
      toast.success(t('gates.decisionSaved'));
      setDecision('');
      setNote('');
      await reload();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const status = gate?.status;
  const title = t(`gates.stage.${stage.stage}`, stage.title);
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={t(`gates.stageHelp.${stage.stage}`)}
        actions={
          gate ? (
            <span className="flex flex-wrap items-center gap-2">
              {gate.round_no > 1 && <Badge>{t('gates.round', { n: gate.round_no })}</Badge>}
              <Badge tone={GATE_TONE[gate.status]}>{t(`gates.status.${gate.status}`)}</Badge>
            </span>
          ) : undefined
        }
      />
      <div className="mt-4 space-y-4">
        {status === 'CHANGES_REQUESTED' && <Callout tone="warning" title={t('gates.changesTitle')}>{stage.can_edit ? t('gates.changesBody') : null}</Callout>}
        {stage.stage === 'PILOT' && stage.can_edit && (!gate || gate.status === 'DRAFT') && <Callout tone="success" title={t('gates.eligibleTitle')}>{t('gates.eligibleBody')}</Callout>}
        {status === 'SUBMITTED' && !canManage && <Callout tone="info" title={t('gates.submittedTitle')}>{t('gates.submittedBody')}</Callout>}
        {status === 'APPROVED' && <Callout tone="success" title={t(`gates.approved.${stage.stage}`)} />}
        {status === 'REJECTED' && <Callout tone="danger" title={t('gates.rejectedTitle')} />}
        {gate && gate.status !== 'DRAFT' && <FeedbackList gate={gate} />}

        {stage.can_edit ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(true);
            }}
          >
            {stage.fields.map((f) => (
              <Field key={f.key} label={t(`gates.fieldLabel.${stage.stage}.${f.key}`, f.label)} required={f.required} error={errors[f.key]} help={t(`gates.fieldHelp.${stage.stage}.${f.key}`, '')}>
                {f.kind === 'URL' ? (
                  <Input type="url" placeholder="https://" value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <RichTextEditor rows={6} maxLength={4000} value={values[f.key] ?? ''} onChange={(v) => setValues((all) => ({ ...all, [f.key]: v }))} />
                )}
              </Field>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" icon={<Send className="h-4 w-4" aria-hidden />} loading={save.isPending && save.variables === true}>
                {status === 'CHANGES_REQUESTED' ? t('gates.sendAgain') : t('gates.send')}
              </Button>
              <Button type="button" variant="secondary" loading={save.isPending && save.variables === false} onClick={() => save.mutate(false)}>
                {t('common.saveDraft')}
              </Button>
            </div>
            <p className="text-sm text-ink-muted">{t('gates.sendHelp')}</p>
          </form>
        ) : gate && gate.status !== 'DRAFT' ? (
          <>
            <GateAnswers fields={stage.fields} content={gate.content} stage={stage.stage} />
            <p className="text-sm text-ink-muted">{t('gates.sentOn', { date: formatDateTime(gate.submitted_at) })}</p>
            {gate.status === 'IN_REVIEW' && <Tally gate={gate} />}
          </>
        ) : (
          <p className="text-sm text-ink-muted">{stage.closed_reason ?? t('gates.notSentYet')}</p>
        )}

        {canManage && gate && gate.status !== 'DRAFT' && (
          <div className="space-y-4 rounded-panel border border-line bg-canvas p-4">
            <p className="font-medium text-ink">{status === 'SUBMITTED' ? t('gates.chooseTitle') : t('gates.adminTitle')}</p>
            {status === 'SUBMITTED' && <p className="text-sm text-ink-muted">{t('gates.chooseHelp')}</p>}
            {status === 'SUBMITTED' && (stage.suggested_judges ?? []).length > 0 && (
              <div className="space-y-2 rounded-panel border border-line bg-surface p-3">
                <p className="text-sm font-medium text-ink">{t('gates.suggested')}</p>
                <p className="text-sm text-ink-muted">{(stage.suggested_judges ?? []).map((j) => j.full_name).join(', ')}</p>
                <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" aria-hidden />} loading={addSuggested.isPending} onClick={() => addSuggested.mutate()}>
                  {t('gates.addSuggested')}
                </Button>
              </div>
            )}
            {(gate.status === 'IN_REVIEW' || gate.status === 'SUBMITTED') && (
              <QuickAddJudge
                excludeIds={(stage.judges ?? []).map((j) => j.user?.id ?? '')}
                submit={(payload) => api.post<AddJudgesResult>(`/gates/${gate.id}/judges`, { user_ids: payload.user_ids })}
                onDone={() => void reload()}
                hideDays
              />
            )}
            {(stage.judges ?? []).length > 0 && (
              <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
                {(stage.judges ?? []).map(
                  (j) =>
                    j.user && (
                      <li key={j.user.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="font-medium text-ink">{j.user.full_name}</span>
                        <span className="flex items-center gap-2">
                          {j.decision ? <Badge tone={DECISION_TONE[j.decision]}>{t(`gates.decision.${j.decision}`)}</Badge> : <Badge>{t('gates.waiting')}</Badge>}
                          {(gate.status === 'IN_REVIEW' || gate.status === 'SUBMITTED') && !j.decision && (
                            <Button variant="ghost" size="sm" loading={removeJudge.isPending && removeJudge.variables === j.user.id} onClick={() => removeJudge.mutate(j.user!.id)}>
                              {t('common.remove')}
                            </Button>
                          )}
                        </span>
                      </li>
                    ),
                )}
              </ul>
            )}
            {status === 'SUBMITTED' && (
              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <Button
                  icon={<Send className="h-4 w-4" aria-hidden />}
                  disabled={(stage.judges ?? []).length === 0}
                  disabledReason={t('gates.needJudge')}
                  loading={sendForReview.isPending}
                  onClick={() => sendForReview.mutate()}
                >
                  {t('gates.sendToJudges')}
                </Button>
                {(stage.judges ?? []).length === 0 && <span className="text-sm text-ink-muted">{t('gates.needJudge')}</span>}
              </div>
            )}
            {gate.status === 'IN_REVIEW' && (
              <div className="space-y-3 border-t border-line pt-4">
                <p className="text-sm font-medium text-ink">{t('gates.finalCall')}</p>
                <p className="text-sm text-ink-muted">{t('gates.finalCallHelp')}</p>
                <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                  <Field label={t('gates.decisionField')}>
                    <Select value={decision} onChange={(e) => setDecision(e.target.value as GateDecision | '')} placeholder={t('gates.chooseDecision')} options={DECISIONS.map((d) => ({ value: d, label: t(`gates.decision.${d}`) }))} />
                  </Field>
                  <Field label={t('gates.reason')} required>
                    <RichTextEditor compact rows={3} value={note} onChange={setNote} />
                  </Field>
                </div>
                <Button variant="secondary" disabled={!decision || note.trim().length < 10} disabledReason={t('gates.reasonNeeded')} loading={decide.isPending} onClick={() => decide.mutate()}>
                  {t('gates.decideNow')}
                </Button>
              </div>
            )}
          </div>
        )}

        {stage.earlier.length > 0 && (
          <details className="rounded-panel border border-line px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-ink">{t('gates.earlierRounds', { count: stage.earlier.length })}</summary>
            <div className="mt-3 space-y-4">
              {stage.earlier.map((g) => (
                <div key={g.id} className="space-y-2 border-t border-line pt-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge>{t('gates.round', { n: g.round_no })}</Badge>
                    <Badge tone={GATE_TONE[g.status]}>{t(`gates.status.${g.status}`)}</Badge>
                  </span>
                  <GateAnswers fields={stage.fields} content={g.content} stage={stage.stage} />
                  <FeedbackList gate={g} />
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

/**
 * Prototype review and pilot review of one idea or challenge entry.
 * The candidate fills the form; staff see progress; the admin chooses judges and can make the final call.
 * Renders nothing when no review step applies yet.
 */
export function GatePanel({ entityType, entityId, onChange, emptyText }: { entityType: 'initiative' | 'challenge_entry'; entityId: string; onChange?: () => void; emptyText?: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: gateKey(entityType, entityId), queryFn: () => api.get<GateOverview>(`/gates/${entityType}/${entityId}`), retry: false });
  const reload = async () => {
    await qc.invalidateQueries({ queryKey: gateKey(entityType, entityId) });
    onChange?.();
  };
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError) return emptyText ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null;
  const d = q.data!;
  if (!d.stages.length) return emptyText ? <Card><p className="text-sm text-ink-muted">{emptyText}</p></Card> : null;
  return (
    <div className="space-y-4">
      {d.stages.map((s) => (
        <StageCard key={s.stage + (s.gate?.id ?? '')} stage={s} entityType={entityType} entityId={entityId} canManage={d.can_manage} reload={reload} />
      ))}
    </div>
  );
}
