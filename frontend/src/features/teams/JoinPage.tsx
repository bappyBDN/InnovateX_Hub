import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Users, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge } from '@/components/domain';
import { Button, ButtonLink, Card, ConfirmDialog, ErrorState, Field, PageSkeleton, Textarea } from '@/components/ui';
import { tr, type I18nText } from '@/utils/i18n';

type JoinState = 'OK' | 'REQUEST_PENDING' | 'ALREADY_MEMBER' | 'ALREADY_IN_CHALLENGE' | 'TEAM_FULL' | 'REGISTRATION_CLOSED' | 'NOT_ELIGIBLE' | 'LINK_INVALID';
interface JoinCard {
  state: JoinState;
  message: string | null;
  team_id?: string | null;
  team_name?: string;
  leader_name?: string;
  challenge?: { slug: string; title_i18n: I18nText } | null;
  size?: { current: number; max: number };
  my_request?: { id: string; status: string; decline_reason: string | null } | null;
  my_entry_id?: string | null;
}
const MAX = 500;

export default function JoinPage() {
  const { t } = useTranslation();
  const params = useParams();
  // Keep the token in memory only; it is removed from the address bar after the first load.
  // sessionStorage lets a browser refresh on /join keep working for this tab.
  const [token] = useState(() => {
    const fromUrl = params.token ?? '';
    try {
      if (fromUrl) sessionStorage.setItem('ix.joinToken', fromUrl);
      return fromUrl || sessionStorage.getItem('ix.joinToken') || '';
    } catch {
      return fromUrl;
    }
  });
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const q = useQuery({ queryKey: queryKeys.teams.join(token), queryFn: () => api.get<JoinCard>(`/join/${encodeURIComponent(token)}`), enabled: !!token });

  useEffect(() => {
    if (q.isSuccess && window.location.pathname !== '/join') window.history.replaceState(window.history.state, '', '/join');
  }, [q.isSuccess]);

  const send = useMutation({
    mutationFn: () => api.post(`/join/${encodeURIComponent(token)}/requests`, { message: message.trim() }),
    onSuccess: () => {
      toast.success(t('teams.requestSent'));
      void qc.invalidateQueries({ queryKey: queryKeys.teams.join(token) });
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void q.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/join-requests/${id}/actions/cancel`, {}),
    onSuccess: () => {
      toast.success(t('teams.requestCancelled'));
      setCancelOpen(false);
      void qc.invalidateQueries({ queryKey: queryKeys.teams.join(token) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-6">
        <Callout tone="warning" title={t('teams.linkInvalid')} action={<ButtonLink to="/challenges" variant="secondary">{t('teams.browseChallenges')}</ButtonLink>} />
      </div>
    );
  }
  if (q.isLoading) return <div className="mx-auto max-w-md"><PageSkeleton rows={2} /></div>;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const empty = !message.trim();

  if (d.state === 'LINK_INVALID' && !d.team_name) {
    return (
      <div className="mx-auto max-w-md py-6">
        <Callout tone="warning" title={t('teams.linkInvalid')} action={<ButtonLink to="/challenges" variant="secondary">{t('teams.browseChallenges')}</ButtonLink>} />
      </div>
    );
  }

  const declined = d.my_request?.status === 'DECLINED';

  return (
    <div className="mx-auto max-w-md py-2">
      <Card className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t('teams.joinTitle', { team: d.team_name })}</h1>
          <dl className="mt-3 space-y-1.5 text-sm">
            {d.challenge && (
              <div className="flex gap-2"><dt className="text-ink-muted">{t('teams.challengeLabel')}</dt><dd className="font-medium text-ink">{tr(d.challenge.title_i18n)}</dd></div>
            )}
            <div className="flex gap-2"><dt className="text-ink-muted">{t('teams.leaderLabel')}</dt><dd className="font-medium text-ink">{d.leader_name}</dd></div>
            {d.size && (
              <div className="flex items-center gap-2"><dt className="text-ink-muted">{t('teams.sizeLabel')}</dt><dd className="inline-flex items-center gap-1.5 font-medium text-ink"><Users className="h-4 w-4 text-ink-muted" aria-hidden />{t('teams.sizeOf', { current: d.size.current, max: d.size.max })}</dd></div>
            )}
          </dl>
        </div>

        {d.state === 'OK' && (
          <form
            className="space-y-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (!empty) send.mutate();
            }}
          >
            {declined && <Callout tone="info" title={t('teams.previousDeclined')}>{d.my_request?.decline_reason}</Callout>}
            <Field label={t('teams.messageLabel')} required help={t('teams.messageHelp')} error={touched && empty ? t('teams.messageRequired') : null} hint={`${message.length} / ${MAX}`}>
              <Textarea value={message} maxLength={MAX} rows={5} onChange={(e) => setMessage(e.target.value)} onBlur={() => setTouched(true)} />
            </Field>
            <Button type="submit" fullWidth loading={send.isPending}>{t('teams.sendRequest')}</Button>
          </form>
        )}

        {d.state === 'REQUEST_PENDING' && (
          <div className="space-y-3">
            <Callout tone="info" title={<span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" aria-hidden />{t('teams.requestSent')}</span>}>
              {t('teams.requestPendingBody', { name: d.leader_name })}
            </Callout>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge status="PENDING" />
              <Button variant="secondary" size="sm" onClick={() => setCancelOpen(true)}>{t('teams.cancelRequest')}</Button>
            </div>
          </div>
        )}

        {d.state === 'ALREADY_MEMBER' && (
          <Callout tone="success" title={<span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4" aria-hidden />{t('teams.alreadyMember', { team: d.team_name })}</span>}
            action={d.team_id ? <ButtonLink to={`/teams/${d.team_id}`}>{t('teams.goToMyTeam')}</ButtonLink> : undefined} />
        )}

        {d.state === 'ALREADY_IN_CHALLENGE' && (
          <Callout tone="warning" title={d.message}
            action={d.team_id ? <ButtonLink to={`/teams/${d.team_id}`} variant="secondary">{t('teams.goToMyTeam')}</ButtonLink> : d.my_entry_id ? <ButtonLink to={`/entries/${d.my_entry_id}`} variant="secondary">{t('teams.goToMyEntry')}</ButtonLink> : undefined} />
        )}

        {(d.state === 'TEAM_FULL' || d.state === 'REGISTRATION_CLOSED' || d.state === 'NOT_ELIGIBLE' || d.state === 'LINK_INVALID') && (
          <Callout tone="warning" title={<span className="inline-flex items-center gap-2"><XCircle className="h-4 w-4 shrink-0" aria-hidden />{d.state === 'TEAM_FULL' ? t('teams.teamFull') : d.state === 'LINK_INVALID' ? t('teams.linkInvalid') : d.message}</span>}
            action={<ButtonLink to={d.challenge && d.state === 'TEAM_FULL' ? `/challenges/${d.challenge.slug}` : '/challenges'} variant="secondary">{d.state === 'TEAM_FULL' ? t('teams.viewChallenge') : t('teams.browseChallenges')}</ButtonLink>} />
        )}
      </Card>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('teams.cancelTitle')}
        description={t('teams.cancelBody')}
        confirmLabel={t('teams.cancelRequest')}
        cancelLabel={t('teams.keepRequest')}
        variant="danger"
        loading={cancel.isPending}
        onConfirm={() => d.my_request && cancel.mutate(d.my_request.id)}
      />
    </div>
  );
}
