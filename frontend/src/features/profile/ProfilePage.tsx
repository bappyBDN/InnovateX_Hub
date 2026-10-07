import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Pencil, Star } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, errorMessage } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { Me } from '@/auth';
import { StatusBadge } from '@/components/domain';
import { Avatar, Badge, Button, ButtonLink, Card, CardHeader, Checkbox, Dialog, EmptyState, ErrorState, PageHeader, PageSkeleton, Stat } from '@/components/ui';
import { setLanguage } from '@/i18n';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';
import { money, num, statusLabel } from '@/utils/format';

interface Skill {
  id: string;
  name: string;
  category?: string | null;
}
interface ProfileData {
  user: Me & { grade?: string | null; employee_no?: string | null };
  manager: { full_name: string; job_title?: string | null } | null;
  joined_on: string | null;
  skills: (Skill & { level: number })[];
  all_skills: Skill[];
  badges: { code: string; name: string; description: string; awarded_at: string | null }[];
  rewards: { id: string; title: string | null; reward_type: string; amount: number | null; currency_code: string; share_pct: number | null; status: string; hr_reference: string | null; created_at: string }[];
  points_total: number;
  points: { id: string; points: number; reason_code: string; created_at: string }[];
}

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const lang = i18n.language.startsWith('bn') ? 'bn' : 'en';

  const profile = useQuery({ queryKey: queryKeys.recognition, queryFn: () => api.get<ProfileData>('/me/profile') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.recognition });
    void qc.invalidateQueries({ queryKey: queryKeys.me });
  };
  const saveSkills = useMutation({
    mutationFn: () => api.patch('/me', { skill_ids: picked }),
    onSuccess: () => {
      toast.success(t('profile.skillsSaved'));
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveLang = useMutation({
    mutationFn: (locale: 'en' | 'bn') => api.patch('/me', { locale }),
    onSuccess: (_d, locale) => {
      setLanguage(locale);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (profile.isLoading) return <PageSkeleton rows={5} />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const d = profile.data!;
  const u = d.user;
  const categories = [...new Set(d.all_skills.map((s) => s.category || t('profile.otherSkills')))];

  return (
    <>
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <Avatar name={u.full_name} size="lg" />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-ink">{u.full_name}</h2>
              <p className="truncate text-sm text-ink-muted">{u.job_title}</p>
            </div>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            {(
              [
                ['sbu', u.sbu?.name ?? u.org_unit?.name],
                ['department', u.department ?? (u.sbu?.id !== u.org_unit?.id ? u.org_unit?.name : null)],
                ['email', u.email],
                ['employeeNo', u.employee_no],
                ['grade', u.grade],
                ['manager', d.manager?.full_name],
                ['joined', d.joined_on ? formatDate(d.joined_on) : null],
              ] as [string, string | null | undefined][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-muted">{t(`profile.fields.${k}`)}</dt>
                <dd className="break-all text-right text-ink">{v || '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">{t('profile.readOnlyNote')}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {u.roles.map((r) => (
              <Badge key={r} tone="neutral">
                {t(`role.${r}`, statusLabel(r))}
              </Badge>
            ))}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title={t('profile.skills')}
              subtitle={t('profile.skillsHelp')}
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Pencil className="h-4 w-4" aria-hidden />}
                  onClick={() => {
                    setPicked(d.skills.map((s) => s.id));
                    setEditing(true);
                  }}
                >
                  {t('profile.editSkills')}
                </Button>
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {d.skills.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('profile.noSkills')}</p>
              ) : (
                d.skills.map((s) => (
                  <Badge key={s.id} tone="primary">
                    {s.name}
                  </Badge>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={t('profile.language')} subtitle={t('profile.languageHelp')} />
            <div className="mt-3 flex gap-2" role="radiogroup" aria-label={t('profile.language')}>
              {(['en', 'bn'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={lang === l}
                  disabled={saveLang.isPending}
                  onClick={() => saveLang.mutate(l)}
                  className={cn(
                    'min-h-[40px] rounded-control border px-4 text-sm font-medium',
                    lang === l ? 'border-primary bg-primary-soft text-primary' : 'border-line bg-surface text-ink hover:bg-neutral-soft',
                  )}
                >
                  {l === 'en' ? 'English' : 'বাংলা'}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-ink-muted">{t('profile.notificationNote')}</p>
          </Card>
        </div>
      </div>

      <section aria-labelledby="recognition" className="mt-8">
        <h2 id="recognition" className="text-xl font-semibold text-ink">
          {t('profile.recognition')}
        </h2>
        <p className="mb-3 text-sm text-ink-muted">{t('profile.recognitionHelp')}</p>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label={t('profile.points')} value={num(d.points_total)} icon={<Star className="h-5 w-5" aria-hidden />} />
          <Stat label={t('profile.badges')} value={d.badges.length} icon={<Award className="h-5 w-5" aria-hidden />} />
          <Stat label={t('profile.rewards')} value={d.rewards.length} />
        </div>

        {d.badges.length === 0 && d.rewards.length === 0 && d.points.length === 0 ? (
          <EmptyState
            icon={<Award className="h-8 w-8" aria-hidden />}
            title={t('profile.emptyTitle')}
            description={t('profile.emptyBody')}
            action={<ButtonLink to="/challenges">{t('profile.browse')}</ButtonLink>}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title={t('profile.badges')} />
              <ul className="mt-3 space-y-3">
                {d.badges.length === 0 && <li className="text-sm text-ink-muted">{t('profile.noBadges')}</li>}
                {d.badges.map((b, i) => (
                  <li key={`${b.code}-${i}`} className="flex gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-spark-soft text-spark-ink">
                      <Award className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{b.name}</p>
                      <p className="text-sm text-ink-muted">{b.description}</p>
                      <p className="tabular text-xs text-ink-muted">{formatDate(b.awarded_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title={t('profile.rewards')} />
              <ul className="mt-3 space-y-3">
                {d.rewards.length === 0 && <li className="text-sm text-ink-muted">{t('profile.noRewards')}</li>}
                {d.rewards.map((r) => (
                  <li key={r.id} className="space-y-1 border-b border-line pb-3 last:border-0 last:pb-0">
                    <p className="font-medium text-ink">{r.title ?? statusLabel(r.reward_type)}</p>
                    <p className="tabular text-sm text-ink">
                      {r.amount != null ? money(r.amount, r.currency_code) : statusLabel(r.reward_type)}
                      {r.share_pct != null && r.share_pct < 100 ? <span className="text-ink-muted"> · {t('profile.share', { pct: num(r.share_pct) })}</span> : null}
                    </p>
                    <StatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title={t('profile.pointsHistory')} subtitle={t('profile.pointsHelp')} />
              <ul className="mt-3 divide-y divide-line">
                {d.points.length === 0 && <li className="text-sm text-ink-muted">{t('profile.noPoints')}</li>}
                {d.points.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block text-ink">{t(`profile.reasons.${p.reason_code}`, statusLabel(p.reason_code))}</span>
                      <span className="tabular text-xs text-ink-muted">{formatDate(p.created_at)}</span>
                    </span>
                    <span className="tabular font-semibold text-ink">+{p.points}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
      </section>

      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t('profile.editSkills')}
        description={t('profile.skillsHelp')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={saveSkills.isPending} onClick={() => saveSkills.mutate()}>
              {t('profile.saveSkills')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {categories.map((cat) => (
            <fieldset key={cat}>
              <legend className="text-sm font-medium text-ink-muted">{cat}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {d.all_skills
                  .filter((s) => (s.category || t('profile.otherSkills')) === cat)
                  .map((s) => (
                    <Checkbox
                      key={s.id}
                      label={s.name}
                      checked={picked.includes(s.id)}
                      onChange={() => setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                    />
                  ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Dialog>
    </>
  );
}
