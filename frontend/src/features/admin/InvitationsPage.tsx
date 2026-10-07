import { useQuery } from '@tanstack/react-query';
import { Copy, MailPlus, RotateCw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Callout } from '@/components/domain';
import {
  Badge, Button, Checkbox, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader, PageSkeleton,
  Textarea, type Column,
} from '@/components/ui';
import { formatDate, formatDateTime } from '@/utils/dates';
import { useAdminMutation } from './shared';

interface Invitation {
  id: string;
  email: string;
  full_name: string | null;
  role_codes: string[];
  roles: string[];
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  created_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  invited_by: string | null;
  accepted_user: string | null;
  invite_url?: string;
  email_status?: string;
}
interface RoleRow {
  code: string;
  name: string;
  description: string | null;
  is_assignable: boolean;
}

const KEY = ['admin', 'invitations'];
const TONE = { PENDING: 'warning', ACCEPTED: 'success', REVOKED: 'neutral', EXPIRED: 'neutral' } as const;

/** Super Admin sends invitations to sign up as a Judge or another privileged role. */
export default function InvitationsPage() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<{ items: Invitation[]; default_expiry_days: number }>('/admin/invitations') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RoleRow[]>('/roles') });
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Invitation | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);

  const revoke = useAdminMutation((id: string) => api.post(`/admin/invitations/${id}/actions/revoke`), {
    success: t('adminPanel.invite.revoked'),
    invalidate: [KEY, ['admin', 'overview']],
    onDone: () => setRevoking(null),
  });
  const resend = useAdminMutation((id: string) => api.post<Invitation>(`/admin/invitations/${id}/actions/resend`), {
    success: t('adminPanel.invite.resent'),
    invalidate: [KEY],
    onDone: (data) => setSent(data),
  });

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const columns: Column<Invitation>[] = [
    {
      key: 'email',
      header: t('adminPanel.invite.email'),
      sortValue: (i) => i.email,
      render: (i) => (
        <span>
          <span className="block font-medium text-ink">{i.email}</span>
          {i.full_name && <span className="block text-sm text-ink-muted">{i.full_name}</span>}
        </span>
      ),
    },
    { key: 'roles', header: t('adminPanel.invite.roles'), render: (i) => <span className="flex flex-wrap gap-1">{i.roles.map((r) => <Badge key={r} tone="primary">{r}</Badge>)}</span> },
    {
      key: 'status',
      header: t('adminPanel.invite.status'),
      sortValue: (i) => i.status,
      render: (i) => (
        <span>
          <Badge tone={TONE[i.status]}>{t(`adminPanel.invite.statuses.${i.status}`)}</Badge>
          {i.status === 'ACCEPTED' && i.accepted_at && <span className="mt-0.5 block text-xs text-ink-muted">{formatDate(i.accepted_at)}</span>}
        </span>
      ),
    },
    { key: 'created_at', header: t('adminPanel.invite.sentOn'), hideOnMobile: true, sortValue: (i) => i.created_at ?? '', render: (i) => (i.created_at ? formatDateTime(i.created_at) : '—') },
    { key: 'expires_at', header: t('adminPanel.invite.expires'), hideOnMobile: true, render: (i) => (i.status === 'PENDING' && i.expires_at ? formatDate(i.expires_at) : '—') },
    { key: 'invited_by', header: t('adminPanel.invite.invitedBy'), hideOnMobile: true, render: (i) => i.invited_by ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (i) =>
        i.status === 'ACCEPTED' ? null : (
          <span className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" icon={<RotateCw className="h-4 w-4" aria-hidden />} loading={resend.isPending && resend.variables === i.id} onClick={() => resend.mutate(i.id)}>
              {t('adminPanel.invite.resend')}
            </Button>
            {i.status === 'PENDING' && (
              <Button size="sm" variant="ghost" icon={<XCircle className="h-4 w-4" aria-hidden />} onClick={() => setRevoking(i)}>
                {t('adminPanel.invite.revoke')}
              </Button>
            )}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('adminPanel.invite.title')}
        subtitle={t('adminPanel.invite.subtitle')}
        breadcrumbs={[{ label: t('adminPanel.title'), to: '/admin' }, { label: t('adminPanel.invite.title') }]}
        actions={<Button icon={<MailPlus className="h-4 w-4" aria-hidden />} onClick={() => setOpen(true)}>{t('adminPanel.invite.new')}</Button>}
      />

      {q.data.items.length === 0 ? (
        <EmptyState
          icon={<MailPlus className="h-6 w-6" aria-hidden />}
          title={t('adminPanel.invite.empty')}
          description={t('adminPanel.invite.emptyBody')}
          action={<Button onClick={() => setOpen(true)}>{t('adminPanel.invite.new')}</Button>}
        />
      ) : (
        <DataTable columns={columns} rows={q.data.items} rowKey={(i) => i.id} initialSort={{ key: 'created_at', dir: 'desc' }} />
      )}

      {open && (
        <InviteDialog
          roles={(roles.data ?? []).filter((r) => r.is_assignable)}
          defaultDays={q.data.default_expiry_days}
          onClose={() => setOpen(false)}
          onSent={(inv) => {
            setOpen(false);
            setSent(inv);
          }}
        />
      )}

      <Dialog
        open={!!sent}
        onOpenChange={(o) => !o && setSent(null)}
        title={t('adminPanel.invite.sentTitle', { email: sent?.email ?? '' })}
        footer={<Button onClick={() => setSent(null)}>{t('adminPanel.invite.done')}</Button>}
      >
        {sent && (
          <div className="space-y-3">
            {sent.email_status !== 'SENT' ? <Callout tone="warning" title={t('adminPanel.invite.emailFailed')} /> : <p className="text-sm text-ink-muted">{t('adminPanel.invite.sentBody')}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={sent.invite_url ?? ''} onFocus={(e) => e.target.select()} aria-label={t('adminPanel.invite.copy')} className="min-w-0 flex-1" />
              <Button
                variant="secondary"
                icon={<Copy className="h-4 w-4" aria-hidden />}
                onClick={() => {
                  void navigator.clipboard.writeText(sent.invite_url ?? '').then(() => toast.success(t('adminPanel.invite.copied')));
                }}
              >
                {t('adminPanel.invite.copy')}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('adminPanel.invite.revokeTitle')}
        description={t('adminPanel.invite.revokeBody', { email: revoking?.email ?? '' })}
        confirmLabel={t('adminPanel.invite.revoke')}
        variant="danger"
        loading={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
      />
    </div>
  );
}

function InviteDialog({ roles, defaultDays, onClose, onSent }: { roles: RoleRow[]; defaultDays: number; onClose: () => void; onSent: (inv: Invitation) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>(['JUDGE']);
  const [message, setMessage] = useState('');
  const [days, setDays] = useState(String(defaultDays));
  const [error, setError] = useState<string | null>(null);

  const send = useAdminMutation(
    () => api.post<Invitation>('/admin/invitations', { email, full_name: name || null, role_codes: picked, message: message || null, expires_in_days: Number(days) || defaultDays }),
    { success: t('adminPanel.invite.sent'), invalidate: [KEY, ['admin', 'overview']], onDone: onSent },
  );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('adminPanel.invite.new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={send.isPending}
            disabled={!email}
            onClick={() => {
              if (picked.length === 0) return setError(t('adminPanel.invite.rolesRequired'));
              setError(null);
              send.mutate(undefined);
            }}
          >
            {t('adminPanel.invite.send')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('adminPanel.invite.email')} required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('adminPanel.invite.fullName')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium text-ink">
            {t('adminPanel.invite.roles')} <span className="text-danger">*</span>
          </legend>
          <p className="text-sm text-ink-muted">{t('adminPanel.invite.rolesHelp')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <Checkbox
                key={r.code}
                checked={picked.includes(r.code)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.code] : p.filter((x) => x !== r.code)))}
                label={r.name}
                description={r.description ?? undefined}
              />
            ))}
          </div>
          {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        </fieldset>
        <Field label={t('adminPanel.invite.message')} help={t('adminPanel.invite.messageHelp')}>
          <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field label={t('adminPanel.invite.expiry')}>
          <Input type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} className="w-28" />
        </Field>
      </div>
    </Dialog>
  );
}
