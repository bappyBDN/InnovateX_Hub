import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Crown, Link2, Lock, LogOut, Mail, MessageCircle, UserMinus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { Callout, StatusBadge, UserChip } from '@/components/domain';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSkeleton,
  Spinner,
  Textarea,
  isNotFound,
} from '@/components/ui';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { formatDateTime, relativeFromNow } from '@/utils/dates';
import { tr, type I18nText } from '@/utils/i18n';

interface Member {
  user_id: string;
  full_name: string;
  job_title: string | null;
  org_unit: string | null;
  member_role: 'LEAD' | 'MEMBER';
  credit_share_pct: number | null;
}
interface InviteLink {
  id: string;
  masked: string;
  expires_at: string | null;
  max_uses: number | null;
  use_count: number;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXHAUSTED';
}
interface NewLink extends InviteLink {
  url: string;
}
interface Team {
  id: string;
  name: string;
  is_locked: boolean;
  challenge: { id: string; slug: string; title_i18n: I18nText } | null;
  entry: { id: string; code: string; title: string; status_code: string } | null;
  max_size: number;
  member_count: number;
  is_full: boolean;
  is_leader: boolean;
  is_member: boolean;
  registration_closes_at: string | null;
  members: Member[];
  credit_total: number;
  invite_links?: InviteLink[];
  pending_requests?: number;
  default_link_days?: number;
}
interface JoinRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  message: string;
  created_at: string;
  decline_reason: string | null;
  user: { full_name: string; job_title: string | null; org_unit: string | null };
}

type Confirm =
  | { kind: 'revoke'; link: InviteLink }
  | { kind: 'remove'; member: Member }
  | { kind: 'leader'; member: Member }
  | { kind: 'leave' }
  | null;

export default function TeamPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({ queryKey: queryKeys.teams.detail(id), queryFn: () => api.get<Team>(`/teams/${id}`) });
  const team = q.data;
  const requests = useQuery({
    queryKey: queryKeys.teams.joinRequests(id),
    queryFn: () => api.get<JoinRequest[]>(`/teams/${id}/join-requests`),
    enabled: !!team?.is_leader,
  });

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [days, setDays] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [created, setCreated] = useState<NewLink | null>(null);
  const [declining, setDeclining] = useState<JoinRequest | null>(null);
  const [reason, setReason] = useState('');
  const [shares, setShares] = useState<Record<string, string> | null>(null);

  const refresh = (membership = false) => {
    void qc.invalidateQueries({ queryKey: queryKeys.teams.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.teams.joinRequests(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.home });
    if (membership) {
      void qc.invalidateQueries({ queryKey: queryKeys.me });
      void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
    }
  };
  const fail = (e: unknown) => toast.error(errorMessage(e));

  const createLink = useMutation({
    mutationFn: () => api.post<NewLink>(`/teams/${id}/invite-links`, { expires_in_days: Number(days) || undefined, max_uses: Number(maxUses) || undefined }),
    onSuccess: (link) => {
      setCreated(link);
      toast.success(t('teams.linkCreated'));
      refresh();
    },
    onError: fail,
  });
  const revoke = useMutation({
    mutationFn: (linkId: string) => api.post(`/invite-links/${linkId}/actions/revoke`),
    onSuccess: () => {
      toast.success(t('teams.linkRevoked'));
      setConfirm(null);
      refresh();
    },
    onError: fail,
  });
  const decide = useMutation({
    mutationFn: (v: { req: JoinRequest; action: 'approve' | 'decline'; reason?: string }) =>
      api.post(`/join-requests/${v.req.id}/actions/${v.action}`, { reason: v.reason || null }),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'approve' ? t('teams.requestApproved', { name: v.req.user.full_name }) : t('teams.requestDeclined', { name: v.req.user.full_name }));
      setDeclining(null);
      setReason('');
      refresh(true);
    },
    onError: fail,
  });
  const memberAction = useMutation({
    mutationFn: (v: { member: Member; action: 'remove' | 'make-leader' }) => api.post(`/teams/${id}/members/${v.member.user_id}/actions/${v.action}`),
    onSuccess: (_d, v) => {
      toast.success(v.action === 'remove' ? t('teams.memberRemoved', { name: v.member.full_name }) : t('teams.leaderChanged', { name: v.member.full_name }));
      setConfirm(null);
      refresh(true);
    },
    onError: fail,
  });
  const leave = useMutation({
    mutationFn: () => api.post(`/teams/${id}/actions/leave`),
    onSuccess: () => {
      toast.success(t('teams.leftTeam'));
      refresh(true);
      navigate('/entries');
    },
    onError: fail,
  });
  const saveShares = useMutation({
    mutationFn: (s: Record<string, number>) => api.put(`/teams/${id}/credit-shares`, { shares: s }),
    onSuccess: () => {
      toast.success(t('teams.sharesSaved'));
      setShares(null);
      refresh();
    },
    onError: fail,
  });

  if (q.isLoading) return <PageSkeleton />;
  if (isNotFound(q.error)) return <NotFoundPage />;
  if (q.isError || !team) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const challengeTitle = team.challenge ? tr(team.challenge.title_i18n) : '';
  const activeLinks = (team.invite_links ?? []).filter((l) => l.status === 'ACTIVE');
  const pending = (requests.data ?? []).filter((r) => r.status === 'PENDING');
  const decided = (requests.data ?? []).filter((r) => r.status !== 'PENDING');
  const shareTotal = shares ? Math.round(Object.values(shares).reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100 : 0;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('teams.linkCopied'));
    } catch {
      toast.error(t('teams.copyFailed'));
    }
  };
  const openLinkDialog = () => {
    setCreated(null);
    setDays(String(team.default_link_days ?? 7));
    setMaxUses('');
    setLinkOpen(true);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={team.name}
        subtitle={challengeTitle}
        className="mb-0"
        breadcrumbs={[{ label: t('teams.myEntries'), to: '/entries' }, { label: team.name }]}
        meta={<Badge tone={team.is_full ? 'warning' : 'neutral'} icon={<Users className="h-3.5 w-3.5" aria-hidden />}>{t('teams.sizeOf', { current: team.member_count, max: team.max_size })}</Badge>}
        actions={team.entry ? <ButtonLink to={`/entries/${team.entry.id}`} variant="secondary">{t('teams.openEntry')}</ButtonLink> : undefined}
      />

      {team.is_locked && <Callout tone="warning" title={<span className="inline-flex items-center gap-2"><Lock className="h-4 w-4" aria-hidden />{t('teams.lockedBanner')}</span>} />}
      {!team.is_member && <Callout tone="info" title={t('teams.readOnly')} />}

      {team.entry && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular text-xs text-ink-muted">{team.entry.code}</p>
            <p className="font-medium text-ink">{team.entry.title}</p>
          </div>
          <StatusBadge status={team.entry.status_code} />
        </Card>
      )}

      <Card>
        <CardHeader
          title={t('teams.members')}
          actions={team.is_leader && team.members.length > 1 ? (
            <Button variant="secondary" size="sm" onClick={() => setShares(Object.fromEntries(team.members.map((m) => [m.user_id, String(m.credit_share_pct ?? 0)])))}>
              {t('teams.editShares')}
            </Button>
          ) : undefined}
        />
        <ul className="divide-y divide-line">
          {team.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <UserChip name={m.full_name} subtitle={[m.job_title, m.org_unit].filter(Boolean).join(' · ')} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={m.member_role === 'LEAD' ? 'primary' : 'neutral'} icon={m.member_role === 'LEAD' ? <Crown className="h-3.5 w-3.5" aria-hidden /> : undefined}>
                  {m.member_role === 'LEAD' ? t('teams.leader') : t('teams.member')}
                </Badge>
                <span className="tabular text-sm text-ink-muted">{t('teams.credit', { pct: m.credit_share_pct ?? 0 })}</span>
                {team.is_leader && m.member_role !== 'LEAD' && (
                  <>
                    <Button variant="ghost" size="sm" icon={<Crown className="h-4 w-4" aria-hidden />} onClick={() => setConfirm({ kind: 'leader', member: m })}>
                      {t('teams.makeLeader')}
                    </Button>
                    <Button variant="ghost" size="sm" icon={<UserMinus className="h-4 w-4" aria-hidden />} disabled={team.is_locked} disabledReason={t('teams.lockedBanner')} onClick={() => setConfirm({ kind: 'remove', member: m })}>
                      {t('teams.removeMember')}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {team.is_leader && !team.is_locked && (
        <Card>
          <CardHeader
            title={t('teams.joinLink')}
            subtitle={t('teams.joinLinkHint')}
            actions={
              <Button onClick={openLinkDialog} icon={<Link2 className="h-4 w-4" aria-hidden />} disabled={team.is_full} disabledReason={t('teams.fullBanner', { current: team.member_count, max: team.max_size })} variant={activeLinks.length ? 'secondary' : 'primary'}>
                {activeLinks.length ? t('teams.newLink') : t('teams.createLink')}
              </Button>
            }
          />
          {team.is_full ? (
            <Callout tone="warning" title={t('teams.fullBanner', { current: team.member_count, max: team.max_size })} />
          ) : activeLinks.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('teams.noActiveLink')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {activeLinks.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="tabular truncate font-medium text-ink">{l.masked}</p>
                    <p className="text-sm text-ink-muted">
                      {t('teams.linkExpires', { date: formatDateTime(l.expires_at) })} · {l.max_uses ? t('teams.linkUsedOf', { count: l.use_count, max: l.max_uses }) : t('teams.linkUsed', { count: l.use_count })}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setConfirm({ kind: 'revoke', link: l })}>{t('teams.revoke')}</Button>
                </li>
              ))}
            </ul>
          )}
          {activeLinks.length > 0 && !team.is_full && <p className="mt-2 text-xs text-ink-muted">{t('teams.maskedHint')}</p>}
        </Card>
      )}

      {team.is_leader && !team.is_locked && (
        <Card>
          <CardHeader title={t('teams.joinRequests', { count: pending.length })} />
          {requests.isLoading ? (
            <Spinner />
          ) : requests.isError ? (
            <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
          ) : pending.length === 0 && decided.length === 0 ? (
            <EmptyState title={t('teams.noRequests')} description={t('teams.noRequestsHint')} />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <li key={r.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <UserChip name={r.user.full_name} subtitle={[r.user.job_title, r.user.org_unit].filter(Boolean).join(' · ')} />
                    <span className="text-xs text-ink-muted">{relativeFromNow(r.created_at)}</span>
                  </div>
                  <p className="rounded-control bg-canvas px-3 py-2 text-sm text-ink">“{r.message}”</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={decide.isPending && decide.variables?.req.id === r.id && decide.variables.action === 'approve'} disabled={team.is_full} disabledReason={t('teams.fullBanner', { current: team.member_count, max: team.max_size })} onClick={() => decide.mutate({ req: r, action: 'approve' })}>
                      {t('common.approve')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { setReason(''); setDeclining(r); }}>{t('common.decline')}</Button>
                  </div>
                </li>
              ))}
              {decided.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <UserChip name={r.user.full_name} subtitle={r.user.org_unit} size="sm" />
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {team.is_member && !team.is_leader && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">{team.is_locked ? t('teams.lockedBanner') : t('teams.leaveHint')}</p>
          <Button variant="secondary" icon={<LogOut className="h-4 w-4" aria-hidden />} disabled={team.is_locked} disabledReason={t('teams.lockedBanner')} onClick={() => setConfirm({ kind: 'leave' })}>{t('teams.leave')}</Button>
        </Card>
      )}
      {team.is_leader && team.members.length > 1 && <p className="text-sm text-ink-muted">{t('teams.leaderCannotLeave')}</p>}

      {/* Create join link: the full link is shown once */}
      <Dialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={created ? t('teams.linkReadyTitle') : t('teams.createLinkTitle')}
        description={created ? t('teams.linkReadyBody') : t('teams.createLinkBody')}
        footer={created ? (
          <Button onClick={() => setLinkOpen(false)}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setLinkOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={createLink.isPending} onClick={() => createLink.mutate()}>{t('teams.createLink')}</Button>
          </>
        )}
      >
        {created ? (
          <div className="space-y-3">
            <Field label={t('teams.joinLink')}>
              <Input readOnly value={created.url} onFocus={(e) => e.target.select()} className="tabular" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => void copy(created.url)}>{t('teams.copyLink')}</Button>
              <a className="control inline-flex w-auto items-center gap-2 text-sm" href={`mailto:?subject=${encodeURIComponent(t('teams.shareSubject', { team: team.name }))}&body=${encodeURIComponent(created.url)}`}>
                <Mail className="h-4 w-4" aria-hidden />{t('teams.shareEmail')}
              </a>
              <a className="control inline-flex w-auto items-center gap-2 text-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${t('teams.shareSubject', { team: team.name })} ${created.url}`)}`}>
                <MessageCircle className="h-4 w-4" aria-hidden />WhatsApp
              </a>
            </div>
            <p className="text-sm text-ink-muted">{t('teams.linkExpires', { date: formatDateTime(created.expires_at) })}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('teams.expiresInDays')} help={team.registration_closes_at ? t('teams.expiresHelp', { date: formatDateTime(team.registration_closes_at) }) : undefined}>
              <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Field label={t('teams.maxUses')} help={t('teams.maxUsesHelp')}>
              <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder={t('teams.unlimited')} />
            </Field>
          </div>
        )}
      </Dialog>

      {/* Decline with an optional reason */}
      <Dialog
        open={!!declining}
        onOpenChange={(o) => !o && setDeclining(null)}
        size="sm"
        title={t('teams.declineTitle', { name: declining?.user.full_name ?? '' })}
        description={t('teams.declineBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeclining(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={decide.isPending} onClick={() => declining && decide.mutate({ req: declining, action: 'decline', reason: reason.trim() })}>{t('teams.declineRequest')}</Button>
          </>
        }
      >
        <Field label={t('teams.declineReason')} hint={t('common.optional')}>
          <Textarea value={reason} maxLength={300} rows={3} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>

      {/* Credit shares must total 100% */}
      <Dialog
        open={!!shares}
        onOpenChange={(o) => !o && setShares(null)}
        size="sm"
        title={t('teams.editShares')}
        description={t('teams.sharesBody')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShares(null)}>{t('common.cancel')}</Button>
            <Button loading={saveShares.isPending} disabled={shareTotal !== 100} disabledReason={t('teams.sharesError', { total: shareTotal })}
              onClick={() => shares && saveShares.mutate(Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, Number(v) || 0])))}>
              {t('teams.saveShares')}
            </Button>
          </>
        }
      >
        {shares && (
          <div className="space-y-3">
            {team.members.map((m) => (
              <Field key={m.user_id} label={m.full_name}>
                <Input type="number" min={0} max={100} step="0.01" value={shares[m.user_id] ?? ''} onChange={(e) => setShares({ ...shares, [m.user_id]: e.target.value })} />
              </Field>
            ))}
            <p className={shareTotal === 100 ? 'tabular text-sm text-success' : 'tabular text-sm text-danger'} role={shareTotal === 100 ? undefined : 'alert'}>
              {shareTotal === 100 ? t('teams.sharesOk') : t('teams.sharesError', { total: shareTotal })}
            </p>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('teams.revokeTitle')}
        description={t('teams.revokeBody')}
        confirmLabel={t('teams.revokeLink')}
        variant="danger"
        loading={revoke.isPending}
        onConfirm={() => confirm?.kind === 'revoke' && revoke.mutate(confirm.link.id)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('teams.removeTitle', { name: confirm?.kind === 'remove' ? confirm.member.full_name : '' })}
        description={t('teams.removeBody')}
        confirmLabel={t('teams.removeFromTeam')}
        variant="danger"
        loading={memberAction.isPending}
        onConfirm={() => confirm?.kind === 'remove' && memberAction.mutate({ member: confirm.member, action: 'remove' })}
      />
      <ConfirmDialog
        open={confirm?.kind === 'leader'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('teams.leaderTitle', { name: confirm?.kind === 'leader' ? confirm.member.full_name : '' })}
        description={t('teams.leaderBody')}
        confirmLabel={t('teams.makeLeader')}
        loading={memberAction.isPending}
        onConfirm={() => confirm?.kind === 'leader' && memberAction.mutate({ member: confirm.member, action: 'make-leader' })}
      />
      <ConfirmDialog
        open={confirm?.kind === 'leave'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('teams.leaveTitle')}
        description={t('teams.leaveBody')}
        confirmLabel={t('teams.leave')}
        variant="danger"
        loading={leave.isPending}
        onConfirm={() => leave.mutate()}
      />
    </div>
  );
}
