import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, Eye, Lock, Send, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, errorMessage, idempotencyKey } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import {
  AttachmentList,
  Callout,
  completeness,
  DeadlineCountdown,
  DynamicForm,
  DynamicFormView,
  SaveIndicator,
  validateForm,
  type FormErrors,
  type FormValue,
} from '@/components/domain';
import { Badge, Button, ButtonLink, Card, Dialog, ErrorState, isNotFound, PageHeader, PageSkeleton, ProgressBar } from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useAutosave, useServerTime, useUnsavedChangesGuard, type AutosaveStatus } from '@/hooks';
import { formatDateTime, parseServerDate } from '@/utils/dates';
import { tr } from '@/utils/i18n';
import type { SubmissionState } from './types';

export type SubmissionKind = 'methodology' | 'prototype' | 'final';

interface SubmitResult {
  status: string;
  version_no: number;
  submitted_at: string;
  closes_at: string | null;
}

const HOUR = 3_600_000;

export default function SubmissionFormPage({ kind }: { kind: SubmissionKind }) {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const path = `/entries/${id}/submissions/${kind}`;
  const q = useQuery({
    queryKey: queryKeys.entries.submission(id, kind),
    queryFn: () => api.get<SubmissionState>(path),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });

  const name = t(`entries.kind.${kind}.name`);
  const submitLabel = t(`entries.kind.${kind}.submit`);

  const [value, setValue] = useState<FormValue | undefined>(undefined);
  const [errors, setErrors] = useState<FormErrors | undefined>(undefined);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const savedRef = useRef<string>('');
  const loadedFor = useRef<string>('');
  const now = useServerTime(60_000);

  // Take the server's content once per entry + kind; later refetches must not overwrite what the user is typing.
  useEffect(() => {
    const key = `${id}:${kind}`;
    if (q.data && loadedFor.current !== key) {
      loadedFor.current = key;
      const initial = q.data.content ?? {};
      savedRef.current = JSON.stringify(initial);
      setValue(initial);
      setErrors(undefined);
      setDone(null);
      setStatus('idle');
    }
  }, [q.data, id, kind]);

  const canEdit = !!q.data?.can_edit;
  const snapshot = useMemo(() => (value ? JSON.stringify(value) : ''), [value]);
  const dirty = canEdit && !!value && snapshot !== savedRef.current;

  const save = useCallback(
    async (v: FormValue) => {
      const snap = JSON.stringify(v);
      if (snap === savedRef.current) return;
      setStatus('saving');
      try {
        await api.put(path, { content: v });
        savedRef.current = snap;
        setStatus('saved');
      } catch (e) {
        setStatus('error');
        if (e instanceof ApiError && e.status === 409) void q.refetch(); // the window closed while editing
        throw e;
      }
    },
    [path, q],
  );

  useAutosave(canEdit ? value : undefined, save, 5000, canEdit);
  useUnsavedChangesGuard(dirty);

  const submit = useMutation({
    mutationFn: (content: FormValue) =>
      api.post<SubmitResult>(`${path}/actions/submit`, { content }, { headers: { 'Idempotency-Key': idempotencyKey() } }),
    onSuccess: (res, content) => {
      savedRef.current = JSON.stringify(content);
      setStatus('saved');
      setErrors(undefined);
      setChecklistOpen(false);
      setDone(res);
      toast.success(t(`entries.kind.${kind}.submitted`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
      void qc.invalidateQueries({ queryKey: queryKeys.home });
    },
    onError: (e) => {
      setChecklistOpen(false);
      if (e instanceof ApiError && e.status === 422 && e.details?.fields) {
        setErrors(e.details.fields as FormErrors);
        savedRef.current = snapshot; // the server kept the draft
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (e instanceof ApiError && e.status === 409) {
        void q.refetch();
      }
      toast.error(errorMessage(e));
    },
  });

  if (q.isLoading || (q.data && value === undefined)) return <PageSkeleton rows={6} />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !q.data || !value) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const s = q.data;
  const form = s.form;
  const closesAt = s.window.closes_at;
  const msLeft = closesAt ? (parseServerDate(closesAt)?.getTime() ?? 0) - now.getTime() : null;
  const deadlineTone = msLeft == null ? 'info' : msLeft < 6 * HOUR ? 'danger' : msLeft < 48 * HOUR ? 'warning' : 'info';
  const clientErrors = form ? validateForm(form, value) : {};
  const missing = Object.keys(clientErrors).length;
  const declarationFields = form ? form.sections.flatMap((x) => x.fields).filter((f) => f.field_type === 'DECLARATION') : [];
  const declarationOk = declarationFields.every((f) => value[f.field_key] === true);
  const fieldsOk = Object.keys(clientErrors).filter((k) => !declarationFields.some((f) => f.field_key === k)).length === 0;
  const pctDone = form ? completeness(form, value) : 0;
  const version = done?.version_no ?? s.version_no;
  const submittedAt = done?.submitted_at ?? s.submitted_at;
  const unsubmitted = canEdit && version > 0 && (dirty || (!done && s.has_unsubmitted_changes) || (!!done && snapshot !== savedRef.current));

  const openChecklist = () => {
    if (missing) setErrors(clientErrors);
    else setErrors(undefined);
    setChecklistOpen(true);
  };

  const submitButton = (
    <Button
      onClick={openChecklist}
      icon={<Send className="h-4 w-4" aria-hidden />}
      disabled={!s.can_submit}
      disabledReason={t('entries.leaderOnlySubmit')}
    >
      {submitLabel}
    </Button>
  );

  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: fieldsOk, label: fieldsOk ? t('entries.checkFieldsOk') : t('entries.checkFieldsMissing', { count: missing - (declarationOk ? 0 : declarationFields.length) }) },
    ...(declarationFields.length ? [{ ok: declarationOk, label: t('entries.checkDeclaration') }] : []),
    { ok: s.window.is_open, label: t('entries.checkWindow') },
  ];
  const allOk = checks.every((c) => c.ok);

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('entries.myEntries'), to: '/entries' },
          { label: s.entry.code, to: `/entries/${s.entry.id}` },
          { label: name },
        ]}
        title={`${name} · ${s.entry.title}`}
        subtitle={tr(s.entry.challenge_title_i18n)}
        meta={
          version > 0 ? (
            <Badge tone="success">{t('entries.versionSubmitted', { version })}</Badge>
          ) : canEdit ? (
            <Badge tone="neutral">{t('entries.draft')}</Badge>
          ) : undefined
        }
        actions={
          canEdit && form ? (
            <div className="flex flex-wrap items-center gap-2">
              <SaveIndicator status={status} />
              <Button variant="secondary" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={() => setPreviewOpen(true)}>
                {t('entries.preview')}
              </Button>
              <span className="hidden md:inline-flex">{submitButton}</span>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-4">
        {done && (
          <Callout
            tone="success"
            title={<span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden />{t(`entries.kind.${kind}.submitted`)}</span>}
            action={<ButtonLink to={`/entries/${s.entry.id}`} variant="secondary" size="sm">{t('entries.backToEntry')}</ButtonLink>}
          >
            <p>{t('entries.submittedDetail', { version: done.version_no, date: formatDateTime(done.submitted_at) })}</p>
            {closesAt && <p>{t('entries.resubmitUntil', { date: formatDateTime(closesAt) })}</p>}
          </Callout>
        )}

        {!canEdit && (
          <Callout tone="info" title={<span className="inline-flex items-center gap-1.5"><Lock className="h-4 w-4" aria-hidden />{t('entries.readOnly')}</span>}>
            <p>{s.read_only_reason}</p>
            {version === 0 && s.status !== 'NOT_STARTED' && !s.window.is_open && <p>{t('entries.notSubmitted')}</p>}
          </Callout>
        )}

        {canEdit && closesAt && (
          <Callout tone={deadlineTone}>
            <DeadlineCountdown closesAt={closesAt} />
            {version > 0 && !done && (
              <p className="mt-1">
                {t('entries.lastSubmitted', { version, date: formatDateTime(submittedAt) })}{' '}
                {unsubmitted ? t('entries.unsubmittedChanges') : t('entries.judgesSeeLast')}
              </p>
            )}
            {done && unsubmitted && <p className="mt-1">{t('entries.unsubmittedChanges')}</p>}
          </Callout>
        )}

        {!form ? (
          <Card>
            <p className="text-sm text-ink-muted">{t('entries.noForm')}</p>
          </Card>
        ) : canEdit ? (
          <Card>
            {/* Save as soon as focus leaves a field, as well as every few seconds. */}
            <div
              onBlur={() => {
                if (snapshot !== savedRef.current) void save(value).catch(() => undefined);
              }}
            >
              <DynamicForm
                form={form}
                value={value}
                onChange={(v) => {
                  setValue(v);
                  if (errors) setErrors(undefined);
                }}
                errors={errors}
                lastStepAction={submitButton}
              >
                <div className="mt-6 border-t border-line pt-4">
                  <AttachmentList entityType="challenge_entry" entityId={s.entry.id} canEdit title={t('entries.files')} />
                </div>
              </DynamicForm>
            </div>
          </Card>
        ) : (
          <Card>
            {version > 0 && (
              <p className="mb-4 text-sm text-ink-muted">{t('entries.showingVersion', { version, date: formatDateTime(submittedAt) })}</p>
            )}
            <DynamicFormView form={form} value={value} />
            <div className="mt-6 border-t border-line pt-4">
              <AttachmentList entityType="challenge_entry" entityId={s.entry.id} title={t('entries.files')} />
            </div>
          </Card>
        )}
      </div>

      {canEdit && form && (
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 md:hidden">
          <ProgressBar value={pctDone} className="min-w-0 flex-1" label={t('entries.pctComplete', { pct: pctDone })} />
          {submitButton}
        </div>
      )}

      {form && (
        <Dialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          size="lg"
          title={t('entries.previewTitle')}
          description={t('entries.previewBody')}
          footer={<Button variant="secondary" onClick={() => setPreviewOpen(false)}>{t('common.close')}</Button>}
        >
          <DynamicFormView form={form} value={value} />
        </Dialog>
      )}

      <Dialog
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        title={`${submitLabel}?`}
        description={closesAt ? t('entries.submitDialogBody', { date: formatDateTime(closesAt) }) : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setChecklistOpen(false)}>
              {allOk ? t('common.cancel') : t('entries.backToForm')}
            </Button>
            <Button
              onClick={() => submit.mutate(value)}
              loading={submit.isPending}
              disabled={!allOk}
              disabledReason={t('entries.finishChecklist')}
            >
              {submitLabel}
            </Button>
          </>
        }
      >
        <ul className="space-y-2">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2 text-ink">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
              )}
              <span>
                <span className="sr-only">{c.ok ? t('entries.checkDone') : t('entries.checkMissing')}: </span>
                {c.label}
              </span>
            </li>
          ))}
          <li className="flex items-start gap-2 text-ink-muted">
            <Circle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>{t('entries.checkFilesNote')}</span>
          </li>
        </ul>
      </Dialog>
    </>
  );
}
