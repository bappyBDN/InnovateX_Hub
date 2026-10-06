import { useMutation } from '@tanstack/react-query';
import { Copy, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorMessage } from '@/api/client';
import { Callout } from '@/components/domain';
import { Button, Checkbox, Dialog, Field, Input, Textarea } from '@/components/ui';
import { UserPicker } from '@/features/ideas/shared';
import { statusLabel } from '@/utils/format';
import type { AddJudgesPayload, AddJudgesResult, JudgeUser, StageOption } from './types';

/** Stage checkboxes: "All stages" or a choice of single stages. An empty list means all stages. */
export interface StageChoice {
  all: boolean;
  stages: string[];
}
/** What to send to the server: an empty list means all stages. */
export const stagesToSend = (c: StageChoice) => (c.all ? [] : c.stages);
export const stageChoiceValid = (c: StageChoice) => c.all || c.stages.length > 0;

export function StagePicker({ stages, value: choice, onChange: setChoice }: { stages: StageOption[]; value: StageChoice; onChange: (v: StageChoice) => void }) {
  const { t } = useTranslation();
  const all = choice.all;
  const value = choice.stages;
  const onChange = (v: string[]) => setChoice({ all: false, stages: v });
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">{t('judging.whatToJudge')}</legend>
      <Checkbox
        label={t('judging.allStages')}
        description={t('judging.allStagesHelp')}
        checked={all}
        onChange={(e) => setChoice({ all: e.target.checked, stages: value })}
      />
      {!all && (
        <div className="space-y-2 border-l-2 border-line pl-4">
          {stages.map((s) => (
            <Checkbox
              key={s.code}
              label={t(`judging.stage.${s.code}`, s.name)}
              description={s.in_challenge ? undefined : t('judging.stageNotInChallenge')}
              disabled={!s.in_challenge}
              checked={value.includes(s.code)}
              onChange={() => onChange(value.includes(s.code) ? value.filter((x) => x !== s.code) : [...value, s.code])}
            />
          ))}
          {value.length === 0 && <p className="text-sm text-danger">{t('judging.pickStage')}</p>}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Choose judges: pick any people who have an account and/or type email addresses of people who don't.
 * Used for a challenge (with stages) and for one idea (with days to finish).
 */
export function AddJudgesDialog({
  title,
  description,
  stages,
  excludeIds = [],
  withDueDays = false,
  submit,
  onDone,
  onClose,
}: {
  title: string;
  description: string;
  /** Pass for a challenge; leave out for an idea. */
  stages?: StageOption[];
  excludeIds?: string[];
  withDueDays?: boolean;
  submit: (payload: AddJudgesPayload) => Promise<AddJudgesResult>;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [people, setPeople] = useState<JudgeUser[]>([]);
  const [emails, setEmails] = useState('');
  const [choice, setChoice] = useState<StageChoice>({ all: true, stages: [] });
  const [message, setMessage] = useState('');
  const [days, setDays] = useState('10');
  const [result, setResult] = useState<AddJudgesResult | null>(null);

  const add = useMutation({
    mutationFn: () => submit({ user_ids: people.map((p) => p.id), emails, stages: stagesToSend(choice), due_days: Number(days) || 10, message }),
    onSuccess: (res) => {
      onDone();
      const quiet = !res.skipped.length && !res.invited.length && !res.invalid_emails.length;
      if (res.added.length) toast.success(t('judging.added', { count: res.added.length }));
      if (quiet) onClose();
      else setResult(res);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const nothing = people.length === 0 && !emails.trim();
  const stageMissing = !!stages && !stageChoiceValid(choice);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.success(t('common.copied'));
  };

  if (result) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title={t('judging.resultTitle')} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
        <div className="space-y-4 text-sm text-ink">
          {result.added.length > 0 && <Callout tone="success">{t('judging.addedNames', { names: result.added.join(', ') })}</Callout>}
          {result.invited.length > 0 && (
            <Callout tone="info" title={t('judging.invitedTitle', { count: result.invited.length })}>
              <p>{t('judging.invitedHelp')}</p>
              <ul className="mt-2 space-y-2">
                {result.invited.map((i) => (
                  <li key={i.email} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{i.email}</span>
                    <span className="text-ink-muted">{i.email_status === 'SENT' ? t('judging.emailSent') : t('judging.emailNotSent')}</span>
                    <Button variant="secondary" size="sm" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => copy(i.invite_url)}>
                      {t('judging.copyLink')}
                    </Button>
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {result.skipped.length > 0 && (
            <Callout tone="warning" title={t('judging.skippedTitle')}>
              <ul className="list-disc pl-5">
                {result.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name} — {t(`judging.reason.${s.reason}`, statusLabel(s.reason))}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {result.invalid_emails.length > 0 && (
            <Callout tone="warning" title={t('judging.invalidEmails')}>
              {result.invalid_emails.join(', ')}
            </Callout>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={add.isPending} disabled={nothing || stageMissing} disabledReason={nothing ? t('judging.chooseSomeone') : t('judging.pickStage')} onClick={() => add.mutate()}>
            {t('judging.addButton')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t('judging.people')} help={t('judging.peopleHelp')}>
          <UserPicker
            excludeIds={[...excludeIds, ...people.map((p) => p.id)]}
            onSelect={(u) => setPeople((p) => [...p, u])}
            placeholder={t('judging.searchPeople')}
          />
        </Field>
        {people.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={t('judging.chosen')}>
            {people.map((p) => (
              <li key={p.id} className="flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink">
                {p.full_name}
                <button
                  type="button"
                  className="rounded-full p-0.5 text-ink-muted hover:text-danger"
                  aria-label={t('judging.removeName', { name: p.full_name })}
                  onClick={() => setPeople((list) => list.filter((x) => x.id !== p.id))}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label={t('judging.emails')} help={t('judging.emailsHelp')}>
          <Textarea rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com, another@company.com" />
        </Field>
        {emails.trim() && (
          <Field label={t('judging.message')} help={t('judging.messageHelp')}>
            <Textarea rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
        )}
        {stages && (
          <StagePicker stages={stages} value={choice} onChange={setChoice} />
        )}
        {withDueDays && (
          <Field label={t('judging.dueDays')}>
            <Input type="number" min={1} max={60} className="w-28" value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
