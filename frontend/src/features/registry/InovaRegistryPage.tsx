import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, BookOpen, Bot, Building2, Database, ExternalLink, Eye, Heart, IdCard, LayoutGrid, ListPlus, Mail, MapPin, PenTool, Pencil, Phone, Plus, Search, Sparkles, Table as TableIcon, Target, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError, errorMessage, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import { useMe } from '@/auth';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, DataTable, Dialog, EmptyState, ErrorState, Field, Input, PageHeader,
  Select, Skeleton, Stat, Textarea, type Column,
} from '@/components/ui';
import { useDebounce } from '@/hooks';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';

type SourceType = 'Web Scraped' | 'Manual Entry';
type AiIntensity = 'Low' | 'Medium' | 'High';

interface RegistryItem {
  id: string;
  code: string;
  title: string;
  summary: string | null;
  description: string | null;
  tech_stack: string[];
  impact: string | null;
  collected_at: string | null;
  event_name: string | null;
  contact_phone: string | null;
  contact_address: string | null;
  ai_unique_point: string | null;
  ai_work: string | null;
  ai_category: string | null;
  ai_intensity: AiIntensity | null;
  ai_tags?: string[];
  tagline?: string | null;
  services?: string | null;
  projects_products?: string | null;
  extra?: { zone?: string; stall?: string; expo_id?: string };
  like_count?: number;
  liked_by_me?: boolean;
  source_type: SourceType;
  source_url: string | null;
  submitted_by: string | null;
  submitted_by_user_id: string | null;
  created_at: string;
  creator: { id: string; full_name: string; email: string | null; user_type: string | null } | null;
  institution: { id: string; name: string; institution_type: string; website: string | null; country: string | null } | null;
  business_cards?: BusinessCardInfo[];
}

interface BusinessCardInfo {
  id: string;
  contact_name: string | null;
  designation: string | null;
  phone: string | null;
  email: string | null;
  details: { other_phones?: string; whatsapp?: string; address?: string; notes?: string; website?: string };
  width: number | null;
  height: number | null;
}

/** A business-card photo. The API needs the sign-in header, so the image is fetched as a blob and cached. */
function CardImage({ card, size, className }: { card: BusinessCardInfo; size: 'thumb' | 'full'; className?: string }) {
  const { t } = useTranslation();
  const img = useQuery({
    queryKey: ['registry', 'card-image', card.id, size],
    queryFn: async () => URL.createObjectURL(await api.blob(`/ideas/cards/${card.id}`, { size })),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
  });
  const ratio = card.width && card.height ? `${card.width} / ${card.height}` : '1.65 / 1';
  return (
    <div className={cn('overflow-hidden rounded-control border border-line bg-neutral-soft', className)} style={{ aspectRatio: ratio }}>
      {img.data ? (
        <img
          src={img.data}
          alt={t('registry.cards.alt', { name: card.contact_name ?? '' })}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={cn('flex h-full w-full items-center justify-center', img.isLoading && 'animate-pulse')}>
          <IdCard className="h-6 w-6 text-ink-muted" aria-hidden />
        </div>
      )}
    </div>
  );
}

interface Stats {
  total: number;
  scraped: number;
  manual: number;
  institutions: number;
  ai_projects?: number;
}

const SOURCES: SourceType[] = ['Web Scraped', 'Manual Entry'];
const INSTITUTION_TYPES = ['University', 'Company', 'Research Lab', 'Startup', 'Government / NGO'];
const CREATOR_TYPES = ['Student', 'Researcher', 'Faculty', 'Company Rep', 'Founder', 'Independent'];
const COLLECTED_AT = ['Industry Visit', 'University Visit', 'AI Summit', 'Conference / Expo', 'Hackathon', 'Online Research', 'Other'];
const AI_CATEGORIES = [
  'Generative AI / LLM',
  'Agentic AI',
  'Computer Vision',
  'NLP / Speech',
  'Predictive Analytics / ML',
  'Recommendation',
  'Robotics / Automation',
  'Other AI',
];
const AI_INTENSITIES: AiIntensity[] = ['Low', 'Medium', 'High'];
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PROGRAM_OWNER'];
const VIEW_KEY = 'ix.registry.view'; // a display preference only

function readView(): 'grid' | 'table' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

function SourceBadge({ source }: { source: SourceType }) {
  const { t } = useTranslation();
  const scraped = source === 'Web Scraped';
  return (
    <Badge
      tone={scraped ? 'info' : 'spark'}
      icon={scraped ? <Bot className="h-3.5 w-3.5" aria-hidden /> : <PenTool className="h-3.5 w-3.5" aria-hidden />}
    >
      {t(`registry.sourceTypes.${source}`, source)}
    </Badge>
  );
}

/** Three bars: how much of the solution is AI. Always with the word, never colour alone. */
function IntensityMeter({ level }: { level: AiIntensity }) {
  const { t } = useTranslation();
  const n = AI_INTENSITIES.indexOf(level) + 1;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted" title={t(`registry.ai.intensityHelp.${level}`)}>
      <span className="inline-flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('w-1.5 rounded-sm', i === 1 ? 'h-2' : i === 2 ? 'h-3' : 'h-4', i <= n ? 'bg-primary' : 'bg-line')} />
        ))}
      </span>
      <span>{t('registry.ai.intensityShort', { level: t(`registry.ai.intensities.${level}`) })}</span>
    </span>
  );
}

function AiLine({ item: p }: { item: RegistryItem }) {
  const { t } = useTranslation();
  if (!p.ai_category && !p.ai_intensity) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {p.ai_category && (
        <Badge tone="primary" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}>
          {t(`registry.ai.categories.${p.ai_category}`, p.ai_category)}
        </Badge>
      )}
      {p.ai_intensity && <IntensityMeter level={p.ai_intensity} />}
    </div>
  );
}

type SortKey = 'ai' | 'likes' | 'newest';
const SORTS: SortKey[] = ['ai', 'likes', 'newest'];

/** Like / unlike a record. The count updates at once in every cached list; the order only changes on the next
 *  load, so a card never jumps away from under the pointer. */
function LikeButton({ item: p, size = 'sm' }: { item: RegistryItem; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const liked = !!p.liked_by_me;
  const count = p.like_count ?? 0;
  const patch = (code: string, like_count: number, liked_by_me: boolean) =>
    qc.setQueriesData<Page<RegistryItem>>({ queryKey: ['registry', 'list'] }, (old) =>
      old ? { ...old, items: old.items.map((x) => (x.code === code ? { ...x, like_count, liked_by_me } : x)) } : old,
    );
  const toggle = useMutation({
    mutationFn: (like: boolean) =>
      like
        ? api.post<{ code: string; like_count: number; liked_by_me: boolean }>(`/ideas/${p.code}/like`)
        : api.del<{ code: string; like_count: number; liked_by_me: boolean }>(`/ideas/${p.code}/like`),
    onMutate: (like) => patch(p.code, Math.max(0, count + (like ? 1 : -1)), like),
    onSuccess: (r) => patch(r.code, r.like_count, r.liked_by_me),
    onError: (e) => {
      patch(p.code, count, liked);
      toast.error(errorMessage(e));
    },
  });
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={t(liked ? 'registry.likes.unlike' : 'registry.likes.like', { count })}
      title={t(liked ? 'registry.likes.unlike' : 'registry.likes.like', { count })}
      disabled={toggle.isPending}
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate(!liked);
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-control border font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait',
        size === 'md' ? 'px-3 py-2 text-sm' : 'px-2.5 py-1 text-sm',
        liked ? 'border-danger/40 bg-danger-soft text-danger' : 'border-line bg-surface text-ink-muted hover:border-danger/40 hover:text-danger',
      )}
    >
      <Heart className={cn('h-4 w-4', liked && 'fill-current')} aria-hidden />
      <span className="tabular">{count}</span>
    </button>
  );
}

function StackPills({ items, max }: { items: string[]; max?: number }) {
  const shown = max ? items.slice(0, max) : items;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((s) => (
        <span key={s} className="rounded-control bg-neutral-soft px-2 py-0.5 text-xs text-ink">
          {s}
        </span>
      ))}
      {max && items.length > max && <span className="text-xs text-ink-muted">+{items.length - max}</span>}
    </div>
  );
}

export default function InovaRegistryPage() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [instType, setInstType] = useState('');
  const [collectedAt, setCollectedAt] = useState('');
  const [aiCategory, setAiCategory] = useState('');
  const [aiIntensity, setAiIntensity] = useState('');
  const [sort, setSort] = useState<SortKey>('ai');
  const [view, setViewState] = useState<'grid' | 'table'>(readView);
  const [open, setOpen] = useState<RegistryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RegistryItem | null>(null);
  const [deleting, setDeleting] = useState<RegistryItem | null>(null);
  const term = useDebounce(q.trim(), 300);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const canManage = (p: RegistryItem) =>
    !!me && (p.submitted_by_user_id === me.id || me.roles.some((r) => ADMIN_ROLES.includes(r)));
  const startEdit = (p: RegistryItem) => {
    setOpen(null);
    setEditing(p);
  };
  const startDelete = (p: RegistryItem) => setDeleting(p);
  const del = useMutation({
    mutationFn: (p: RegistryItem) => api.del(`/ideas/${p.code}`),
    onSuccess: () => {
      toast.success(t('registry.detail.deleted'));
      void qc.invalidateQueries({ queryKey: queryKeys.registry.all });
      setDeleting(null);
      setOpen(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const setView = (v: 'grid' | 'table') => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const params = {
    search: term,
    source_type: source,
    institution_type: instType,
    collected_at: collectedAt,
    ai_category: aiCategory,
    ai_intensity: aiIntensity,
    sort,
    page_size: 200,
  };
  const list = useQuery({
    queryKey: queryKeys.registry.list(params),
    queryFn: () => api.get<Page<RegistryItem>>('/ideas', params),
    placeholderData: (prev) => prev,
  });
  const stats = useQuery({ queryKey: queryKeys.registry.stats, queryFn: () => api.get<Stats>('/ideas/stats') });
  const items = list.data?.items ?? [];
  // The open record follows the list cache, so a like in the dialog shows at once.
  const openItem = open ? (items.find((x) => x.id === open.id) ?? open) : null;
  const filtered = !!term || !!source || !!instType || !!collectedAt || !!aiCategory || !!aiIntensity;

  const columns: Column<RegistryItem>[] = [
    {
      key: 'title',
      header: t('registry.col.project'),
      sortValue: (r) => r.title,
      render: (r) => (
        <div>
          <div className="font-medium text-ink">{r.title}</div>
          <div className="tabular text-xs text-ink-muted">{r.code}</div>
        </div>
      ),
    },
    {
      key: 'creator',
      header: t('registry.col.creator'),
      sortValue: (r) => r.institution?.name ?? '',
      render: (r) => (
        <div>
          <div className="text-ink">{r.creator?.full_name ?? '—'}</div>
          <div className="text-xs text-ink-muted">{r.institution?.name}</div>
        </div>
      ),
    },
    { key: 'source', header: t('registry.col.source'), sortValue: (r) => r.source_type, render: (r) => <SourceBadge source={r.source_type} /> },
    {
      key: 'ai',
      header: t('registry.col.ai'),
      hideOnMobile: true,
      sortValue: (r) => `${r.ai_category ?? '~'} ${AI_INTENSITIES.indexOf(r.ai_intensity as AiIntensity)}`,
      render: (r) =>
        r.ai_category || r.ai_intensity ? (
          <div className="space-y-1">
            {r.ai_category && <div className="text-ink">{t(`registry.ai.categories.${r.ai_category}`, r.ai_category)}</div>}
            {r.ai_intensity && <IntensityMeter level={r.ai_intensity} />}
          </div>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    { key: 'stack', header: t('registry.col.stack'), hideOnMobile: true, render: (r) => <StackPills items={r.tech_stack} max={3} /> },
    { key: 'likes', header: t('registry.likes.col'), sortValue: (r) => r.like_count ?? 0, render: (r) => <LikeButton item={r} /> },
    { key: 'added', header: t('registry.col.added'), sortValue: (r) => r.created_at, render: (r) => <span className="tabular">{formatDate(r.created_at)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('registry.col.actions')}</span>,
      align: 'right',
      render: (r) => (canManage(r) ? <RowActions onEdit={() => startEdit(r)} onDelete={() => startDelete(r)} /> : null),
    },
  ];

  return (
    <>
      <PageHeader
        title={t('registry.title')}
        subtitle={t('registry.subtitle')}
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
            {t('registry.add')}
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label={t('registry.stats.total')} value={stats.data?.total ?? '—'} tone="primary" icon={<BookOpen className="h-4 w-4" aria-hidden />} />
        <Stat label={t('registry.stats.scraped')} value={stats.data?.scraped ?? '—'} tone="info" icon={<Bot className="h-4 w-4" aria-hidden />} />
        <Stat label={t('registry.stats.manual')} value={stats.data?.manual ?? '—'} tone="spark" icon={<PenTool className="h-4 w-4" aria-hidden />} />
        <Stat label={t('registry.stats.institutions')} value={stats.data?.institutions ?? '—'} tone="success" icon={<Building2 className="h-4 w-4" aria-hidden />} />
        <Stat label={t('registry.stats.ai')} value={stats.data?.ai_projects ?? '—'} tone="primary" icon={<Sparkles className="h-4 w-4" aria-hidden />} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input aria-label={t('registry.search')} placeholder={t('registry.search')} className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1 rounded-control border border-line bg-surface p-1" role="group">
          {(['grid', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              title={t(v === 'grid' ? 'registry.gridView' : 'registry.tableView')}
              aria-label={t(v === 'grid' ? 'registry.gridView' : 'registry.tableView')}
              className={cn('rounded-control p-1.5', view === v ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-neutral-soft')}
            >
              {v === 'grid' ? <LayoutGrid className="h-4 w-4" aria-hidden /> : <TableIcon className="h-4 w-4" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select
          aria-label={t('registry.allSources')}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={t('registry.allSources')}
          options={SOURCES.map((v) => ({ value: v, label: t(`registry.sourceTypes.${v}`) }))}
        />
        <Select
          aria-label={t('registry.allInstitutionTypes')}
          value={instType}
          onChange={(e) => setInstType(e.target.value)}
          placeholder={t('registry.allInstitutionTypes')}
          options={INSTITUTION_TYPES.map((v) => ({ value: v, label: t(`registry.institutionTypes.${v}`) }))}
        />
        <Select
          aria-label={t('registry.allCollectedAt')}
          value={collectedAt}
          onChange={(e) => setCollectedAt(e.target.value)}
          placeholder={t('registry.allCollectedAt')}
          options={COLLECTED_AT.map((v) => ({ value: v, label: t(`registry.collectedAtOptions.${v}`) }))}
        />
        <Select
          aria-label={t('registry.ai.allCategories')}
          value={aiCategory}
          onChange={(e) => setAiCategory(e.target.value)}
          placeholder={t('registry.ai.allCategories')}
          options={[
            { value: 'Any AI', label: t('registry.ai.anyAi') },
            ...AI_CATEGORIES.map((v) => ({ value: v, label: t(`registry.ai.categories.${v}`) })),
          ]}
        />
        <Select
          aria-label={t('registry.ai.allIntensities')}
          value={aiIntensity}
          onChange={(e) => setAiIntensity(e.target.value)}
          placeholder={t('registry.ai.allIntensities')}
          options={AI_INTENSITIES.map((v) => ({ value: v, label: t(`registry.ai.intensities.${v}`) }))}
        />
      </div>

      {list.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Database className="h-8 w-8" aria-hidden />}
          title={filtered ? t('registry.noMatchTitle') : t('registry.emptyTitle')}
          description={filtered ? t('registry.noMatchBody') : t('registry.emptyBody')}
          action={
            !filtered && (
              <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>
                {t('registry.add')}
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-muted" aria-live="polite">
              {t('registry.count', { count: list.data?.total ?? items.length })}
            </p>
            <div className="flex items-center gap-2 text-sm text-ink-muted" role="group" aria-label={t('registry.likes.sortBy')}>
              <ArrowDownUp className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t('registry.likes.sortBy')}</span>
              <div className="flex gap-1 rounded-control border border-line bg-surface p-1">
                {SORTS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={sort === s}
                    onClick={() => setSort(s)}
                    className={cn(
                      'rounded-control px-2.5 py-1 text-sm',
                      sort === s ? 'bg-primary text-primary-fg' : 'text-ink-muted hover:bg-neutral-soft hover:text-ink',
                    )}
                  >
                    {t(`registry.likes.sort.${s}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {view === 'grid' ? (
            <ul className="grid gap-4 md:grid-cols-2">
              {items.map((p) => (
                <li key={p.id}>
                  <RegistryCard
                    item={p}
                    onOpen={() => setOpen(p)}
                    actions={canManage(p) ? <RowActions onEdit={() => startEdit(p)} onDelete={() => startDelete(p)} /> : null}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <DataTable key={sort} columns={columns} rows={items} rowKey={(r) => r.id} onRowClick={setOpen} />
          )}
        </>
      )}

      <FormDialog open={adding} onOpenChange={setAdding} />
      {editing && <FormDialog key={editing.id} open item={editing} onOpenChange={(o) => !o && setEditing(null)} />}
      {openItem && (
        <DetailDialog
          item={openItem}
          onClose={() => setOpen(null)}
          onEdit={canManage(openItem) ? () => startEdit(openItem) : undefined}
          onDelete={canManage(openItem) ? () => startDelete(openItem) : undefined}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('registry.detail.deleteTitle')}
        description={t('registry.detail.deleteBody', { code: deleting?.code ?? '' })}
        confirmLabel={t('registry.detail.delete')}
        variant="danger"
        loading={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting)}
      />
    </>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  // stopPropagation: in the table a row click opens the details panel.
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        icon={<Pencil className="h-4 w-4" aria-hidden />}
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        {t('registry.detail.edit')}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-danger"
        icon={<Trash2 className="h-4 w-4" aria-hidden />}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        {t('registry.detail.delete')}
      </Button>
    </div>
  );
}

function RegistryCard({ item: p, onOpen, actions }: { item: RegistryItem; onOpen: () => void; actions?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.creator?.full_name ?? p.institution?.name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{p.creator?.full_name ?? p.institution?.name}</div>
            <div className="flex flex-wrap items-center gap-1 text-xs text-ink-muted">
              {p.creator?.user_type && <Badge>{t(`registry.creatorTypes.${p.creator.user_type}`, p.creator.user_type)}</Badge>}
              {p.creator && <span>·</span>}
              <span className="text-ink">{p.institution?.name}</span>
              {p.institution && <span>({t(`registry.institutionTypes.${p.institution.institution_type}`, p.institution.institution_type)})</span>}
            </div>
          </div>
        </div>
        <SourceBadge source={p.source_type} />
      </div>
      <div>
        <div className="flex flex-wrap justify-between gap-2 text-xs text-ink-muted">
          <span className="tabular">{p.code}</span>
          {p.submitted_by && (
            <span>
              {t('registry.via')}: {p.submitted_by}
            </span>
          )}
        </div>
        <h2 className="mt-1 text-lg font-semibold text-ink">{p.title}</h2>
        {p.summary && <p className="mt-1 text-sm text-ink">{p.summary}</p>}
      </div>
      {!!p.business_cards?.length && (
        <button
          type="button"
          onClick={onOpen}
          className="group flex items-center gap-3 rounded-control text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={t('registry.cards.open', { count: p.business_cards.length })}
        >
          <span className="relative w-36 shrink-0 sm:w-40">
            <CardImage card={p.business_cards[0]} size="thumb" className="shadow-sm transition-transform duration-150 group-hover:scale-[1.02]" />
            {p.business_cards.length > 1 && (
              <span className="absolute -right-1.5 -top-1.5 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-fg">
                +{p.business_cards.length - 1}
              </span>
            )}
          </span>
          <span className="min-w-0 text-xs text-ink-muted">
            <span className="flex items-center gap-1 font-medium text-ink">
              <IdCard className="h-3.5 w-3.5 text-primary" aria-hidden />
              {t('registry.cards.count', { count: p.business_cards.length })}
            </span>
            {p.business_cards[0].contact_name && <span className="block truncate">{p.business_cards[0].contact_name}</span>}
            {p.business_cards[0].designation && <span className="block truncate">{p.business_cards[0].designation}</span>}
          </span>
        </button>
      )}
      {(p.collected_at || p.event_name) && (
        <p className="flex items-center gap-1.5 text-xs text-ink-muted">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          {[p.collected_at && t(`registry.collectedAtOptions.${p.collected_at}`, p.collected_at), p.event_name].filter(Boolean).join(' · ')}
        </p>
      )}
      <AiLine item={p} />
      {!!p.ai_tags?.length && <StackPills items={p.ai_tags} max={4} />}
      {p.tech_stack.length > 0 && <StackPills items={p.tech_stack} />}
      {p.impact && (
        <p className="flex gap-2 rounded-control bg-success-soft p-3 text-sm text-ink">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <span>
            <span className="font-medium">{t('registry.impact')}: </span>
            {p.impact}
          </span>
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <LikeButton item={p} />
          <Button variant="ghost" size="sm" icon={<Eye className="h-4 w-4" aria-hidden />} onClick={onOpen}>
            {t('registry.details')}
          </Button>
          {p.source_url && (
            <a href={p.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary underline">
              {t('registry.sourceLink')} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
        {actions}
      </div>
    </Card>
  );
}

function DetailDialog({
  item: p,
  onClose,
  onEdit,
  onDelete,
}: {
  item: RegistryItem;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && onClose()}
        size="lg"
        title={p.title}
        description={`${p.code} · ${t('registry.detail.loggedOn', { date: formatDate(p.created_at) })}`}
        footer={
          <>
            <span className="mr-auto">
              <LikeButton item={p} size="md" />
            </span>
            {onDelete && (
              <Button variant="danger" icon={<Trash2 className="h-4 w-4" aria-hidden />} onClick={onDelete}>
                {t('registry.detail.delete')}
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={onEdit}>
                {t('registry.detail.edit')}
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        <div className="space-y-5 text-sm">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-control border border-line p-3">
              <div className="text-xs text-ink-muted">{t('registry.detail.creator')}</div>
              <div className="font-medium text-ink">{p.creator?.full_name ?? t('registry.detail.noCreator')}</div>
              {p.creator?.user_type && <div className="text-xs text-ink-muted">{t(`registry.creatorTypes.${p.creator.user_type}`, p.creator.user_type)}</div>}
              {p.creator?.email && <div className="break-all text-xs text-ink-muted">{p.creator.email}</div>}
              {p.contact_phone && (
                <a href={`tel:${p.contact_phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-1 text-xs text-primary underline">
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {p.contact_phone}
                </a>
              )}
              {p.contact_address && (
                <div className="mt-0.5 flex gap-1 text-xs text-ink-muted">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{p.contact_address}</span>
                </div>
              )}
            </div>
            <div className="rounded-control border border-line p-3">
              <div className="text-xs text-ink-muted">{t('registry.detail.institution')}</div>
              <div className="font-medium text-ink">{p.institution?.name ?? '—'}</div>
              {p.institution && (
                <div className="text-xs text-ink-muted">{t(`registry.institutionTypes.${p.institution.institution_type}`, p.institution.institution_type)}</div>
              )}
              {p.institution?.website && (
                <a href={p.institution.website} target="_blank" rel="noreferrer noopener" className="mt-0.5 flex items-center gap-1 break-all text-xs text-primary underline">
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {p.institution.website.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}
                </a>
              )}
              {(p.extra?.stall || p.extra?.zone) && (
                <div className="mt-0.5 text-xs text-ink-muted">
                  {t('registry.detail.expo')}: {[p.extra.zone, p.extra.stall].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <div className="rounded-control border border-line p-3">
              <div className="text-xs text-ink-muted">{t('registry.detail.source')}</div>
              <div className="mt-1">
                <SourceBadge source={p.source_type} />
              </div>
              {p.submitted_by && <div className="mt-1 text-xs text-ink-muted">{t('registry.via')}: {p.submitted_by}</div>}
            </div>
          </div>
          {(p.collected_at || p.event_name) && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.foundAt')}</h3>
              <p className="text-ink">
                {[p.collected_at && t(`registry.collectedAtOptions.${p.collected_at}`, p.collected_at), p.event_name].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}
          {!!p.business_cards?.length && (
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-ink-muted">
                <IdCard className="h-3.5 w-3.5 text-primary" aria-hidden />
                {t('registry.cards.title')}
              </h3>
              <ul className="grid gap-4 sm:grid-cols-2">
                {p.business_cards.map((c) => (
                  <li key={c.id} className="rounded-control border border-line p-2">
                    <CardImage card={c} size="full" />
                    <div className="mt-2 space-y-0.5 px-1 text-xs">
                      {c.contact_name && <div className="text-sm font-medium text-ink">{c.contact_name}</div>}
                      {c.designation && <div className="text-ink-muted">{c.designation}</div>}
                      {c.phone && (
                        <a href={`tel:${c.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-1 text-primary underline">
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {c.phone}
                        </a>
                      )}
                      {c.email &&
                        c.email.split(/\s+/).filter(Boolean).map((e) => (
                          <a key={e} href={`mailto:${e}`} className="flex items-center gap-1 break-all text-primary underline">
                            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {e}
                          </a>
                        ))}
                      {c.details.other_phones && <div className="whitespace-pre-line text-ink-muted">{c.details.other_phones}</div>}
                      {c.details.notes && <div className="pt-1 text-ink-muted">{c.details.notes}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(p.description || p.summary) && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.detail.description')}</h3>
              {p.tagline && p.tagline !== (p.description || p.summary) && <p className="mb-2 font-medium text-ink">{p.tagline}</p>}
              <p className="whitespace-pre-line rounded-control bg-neutral-soft p-3 text-ink">{p.description || p.summary}</p>
            </div>
          )}
          {p.services && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.form.services')}</h3>
              <p className="whitespace-pre-line text-ink">{p.services}</p>
            </div>
          )}
          {p.projects_products && (
            <div>
              <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.form.projectsProducts')}</h3>
              <p className="whitespace-pre-line text-ink">{p.projects_products}</p>
            </div>
          )}
          {(p.ai_category || p.ai_intensity || p.ai_work || p.ai_unique_point || !!p.ai_tags?.length) && (
            <section className="rounded-control border border-primary/30 bg-primary-soft/40 p-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-ink-muted">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
                {t('registry.ai.title')}
              </h3>
              <dl className="divide-y divide-line">
                {p.ai_category && (
                  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-ink-muted">{t('registry.ai.category')}</dt>
                    <dd className="font-medium text-ink">{t(`registry.ai.categories.${p.ai_category}`, p.ai_category)}</dd>
                  </div>
                )}
                {!!p.ai_tags?.length && (
                  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-ink-muted">{t('registry.ai.tags')}</dt>
                    <dd>
                      <StackPills items={p.ai_tags} />
                    </dd>
                  </div>
                )}
                {p.ai_intensity && (
                  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 py-2">
                    <dt className="text-ink-muted">{t('registry.ai.intensity')}</dt>
                    <dd className="text-ink">
                      <IntensityMeter level={p.ai_intensity} />
                      <span className="mt-0.5 block text-xs text-ink-muted">{t(`registry.ai.intensityHelp.${p.ai_intensity}`)}</span>
                    </dd>
                  </div>
                )}
                {p.ai_work && (
                  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-ink-muted">{t('registry.ai.work')}</dt>
                    <dd className="whitespace-pre-line text-ink">{p.ai_work}</dd>
                  </div>
                )}
                {p.ai_unique_point && (
                  <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2">
                    <dt className="text-ink-muted">{t('registry.ai.uniquePoint')}</dt>
                    <dd className="whitespace-pre-line text-ink">{p.ai_unique_point}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {p.tech_stack.length > 0 && (
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.stack')}</h3>
                <StackPills items={p.tech_stack} />
              </div>
            )}
            {p.impact && (
              <div>
                <h3 className="mb-1 text-xs font-medium uppercase text-ink-muted">{t('registry.impact')}</h3>
                <p className="rounded-control bg-success-soft p-2 text-ink">{p.impact}</p>
              </div>
            )}
          </div>
          {p.source_url && (
            <a href={p.source_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 break-all text-primary underline">
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              {p.source_url}
            </a>
          )}
        </div>
      </Dialog>
    </>
  );
}

const EMPTY = {
  title: '',
  institution: '',
  institution_type: 'University',
  creator: '',
  creator_email: '',
  creator_type: '',
  collected_at: '',
  event_name: '',
  contact_phone: '',
  contact_address: '',
  ai_category: '',
  ai_intensity: '',
  ai_work: '',
  ai_unique_point: '',
  ai_tags: '',
  tagline: '',
  website: '',
  services: '',
  projects_products: '',
  tech_stack: '',
  summary: '',
  description: '',
  impact: '',
  source_url: '',
};

/** A card photo picked in the form, shrunk in the browser and uploaded after the record is saved. */
interface PendingCard {
  key: string;
  preview: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  contact_name: string;
  designation: string;
  phone: string;
  email: string;
}

const CARD_MAX = 20;

function canvasBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, quality));
}

/** Resize to `width` px and encode as WebP (JPEG where the browser can't write WebP), stepping the quality down until
 *  the file is under `cap` bytes, so a phone photo of a card ends up at a few dozen KB and still reads clearly. */
async function encodeCard(bmp: ImageBitmap, width: number, quality: number, cap: number) {
  const scale = Math.min(1, width / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  let q = quality;
  for (;;) {
    let blob = await canvasBlob(c, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await canvasBlob(c, 'image/jpeg', q);
    if (!blob) throw new Error('encode');
    if (blob.size <= cap || q <= 0.45) return { blob, width: c.width, height: c.height };
    q -= 0.07;
  }
}

async function shrinkCard(file: File): Promise<Omit<PendingCard, 'contact_name' | 'designation' | 'phone' | 'email'>> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const full = await encodeCard(bmp, 900, 0.78, 60_000);
    const thumb = await encodeCard(bmp, 320, 0.65, 14_000);
    return {
      key: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      preview: URL.createObjectURL(full.blob),
      full: full.blob,
      thumb: thumb.blob,
      width: full.width,
      height: full.height,
    };
  } finally {
    bmp.close();
  }
}

function CardUploader({
  existing,
  removed,
  onToggleRemove,
  pending,
  setPending,
}: {
  existing: BusinessCardInfo[];
  removed: string[];
  onToggleRemove: (id: string) => void;
  pending: PendingCard[];
  setPending: Dispatch<SetStateAction<PendingCard[]>>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const room = CARD_MAX - (existing.length - removed.length) - pending.length;

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const list = Array.from(files).slice(0, Math.max(room, 0));
    for (const file of list) {
      try {
        const shrunk = await shrinkCard(file);
        setPending((s) => [...s, { ...shrunk, contact_name: '', designation: '', phone: '', email: '' }]);
      } catch {
        toast.error(t('registry.cards.badFile', { name: file.name }));
      }
    }
    if (files.length > list.length) toast.error(t('registry.cards.tooMany', { max: CARD_MAX }));
    setBusy(false);
  };

  const edit = (key: string, field: 'contact_name' | 'designation' | 'phone' | 'email') => (e: { target: { value: string } }) =>
    setPending((s) => s.map((c) => (c.key === key ? { ...c, [field]: e.target.value } : c)));
  const drop = (key: string) =>
    setPending((s) => {
      const c = s.find((x) => x.key === key);
      if (c) URL.revokeObjectURL(c.preview);
      return s.filter((x) => x.key !== key);
    });

  return (
    <fieldset className="rounded-control border border-line p-4 sm:col-span-2">
      <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
        <IdCard className="h-4 w-4 text-primary" aria-hidden />
        {t('registry.cards.formTitle')}
      </legend>
      <p className="mb-3 text-sm leading-relaxed text-ink-muted">{t('registry.cards.formHelp')}</p>

      {existing.length > 0 && (
        <ul className="mb-3 grid gap-3 sm:grid-cols-3">
          {existing.map((c) => {
            const gone = removed.includes(c.id);
            return (
              <li key={c.id} className={cn('rounded-control border border-line p-2', gone && 'opacity-50')}>
                <CardImage card={c} size="thumb" />
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span className={cn('truncate text-xs text-ink', gone && 'line-through')}>{c.contact_name ?? '—'}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={gone ? '' : 'text-danger'}
                    icon={gone ? <Undo2 className="h-4 w-4" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                    onClick={() => onToggleRemove(c.id)}
                  >
                    {gone ? t('registry.cards.keep') : t('registry.cards.remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="mb-3 space-y-3">
          {pending.map((c) => (
            <li key={c.key} className="grid gap-3 rounded-control border border-line p-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div>
                <img src={c.preview} alt="" className="w-full rounded-control border border-line object-cover" style={{ aspectRatio: `${c.width} / ${c.height}` }} />
                <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
                  <span className="tabular">{Math.max(1, Math.round(c.full.size / 1024))} KB</span>
                  <button type="button" onClick={() => drop(c.key)} className="inline-flex items-center gap-1 text-danger underline">
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {t('registry.cards.remove')}
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('registry.cards.name')}>
                  <Input maxLength={200} value={c.contact_name} onChange={edit(c.key, 'contact_name')} />
                </Field>
                <Field label={t('registry.cards.designation')}>
                  <Input maxLength={200} value={c.designation} onChange={edit(c.key, 'designation')} />
                </Field>
                <Field label={t('registry.cards.phone')}>
                  <Input type="tel" maxLength={80} value={c.phone} onChange={edit(c.key, 'phone')} />
                </Field>
                <Field label={t('registry.cards.email')}>
                  <Input type="email" maxLength={300} value={c.email} onChange={edit(c.key, 'email')} />
                </Field>
              </div>
            </li>
          ))}
        </ul>
      )}

      {room > 0 ? (
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed border-line px-4 py-5 text-center text-sm text-ink-muted transition-colors hover:border-primary hover:text-ink focus-within:border-primary',
            busy && 'pointer-events-none animate-pulse',
          )}
        >
          <Upload className="h-5 w-5 text-primary" aria-hidden />
          <span className="font-medium text-ink">{busy ? t('registry.cards.processing') : t('registry.cards.add')}</span>
          <span className="text-xs">{t('registry.cards.addHelp')}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      ) : (
        <p className="text-xs text-ink-muted">{t('registry.cards.tooMany', { max: CARD_MAX })}</p>
      )}
    </fieldset>
  );
}

function fromItem(p: RegistryItem): typeof EMPTY {
  return {
    title: p.title,
    institution: p.institution?.name ?? '',
    institution_type: p.institution?.institution_type ?? 'University',
    creator: p.creator?.full_name ?? '',
    creator_email: p.creator?.email ?? '',
    creator_type: p.creator?.user_type ?? '',
    collected_at: p.collected_at ?? '',
    event_name: p.event_name ?? '',
    contact_phone: p.contact_phone ?? '',
    contact_address: p.contact_address ?? '',
    ai_category: p.ai_category ?? '',
    ai_intensity: p.ai_intensity ?? '',
    ai_work: p.ai_work ?? '',
    ai_unique_point: p.ai_unique_point ?? '',
    ai_tags: (p.ai_tags ?? []).join(', '),
    tagline: p.tagline ?? '',
    website: p.institution?.website ?? '',
    services: p.services ?? '',
    projects_products: p.projects_products ?? '',
    tech_stack: p.tech_stack.join(', '),
    summary: p.summary ?? '',
    description: p.description ?? '',
    impact: p.impact ?? '',
    source_url: p.source_url ?? '',
  };
}

/** Add a new record, or edit `item` when it is given. */
function FormDialog({ open, onOpenChange, item }: { open: boolean; onOpenChange: (o: boolean) => void; item?: RegistryItem }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEdit = !!item;
  const [f, setF] = useState(() => (item ? fromItem(item) : EMPTY));
  const [pending, setPending] = useState<PendingCard[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const hasMore = !!(item && (item.tagline || item.services || item.projects_products || item.institution?.website));
  const [showMore, setShowMore] = useState(hasMore);

  // Free the preview images when the dialog goes away.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((c) => URL.revokeObjectURL(c.preview)), []);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { ...f };
      for (const k of Object.keys(body)) if (body[k] === '') body[k] = null;
      body.institution_type = f.institution_type;
      body.tech_stack = f.tech_stack;
      body.ai_tags = f.ai_tags;
      const r = item ? await api.put<RegistryItem>(`/ideas/${item.code}`, body) : await api.post<RegistryItem>('/ideas', body);
      // The record is saved; cards follow. A failed card does not undo the record.
      let failed = 0;
      for (const id of removed) {
        try {
          await api.del(`/ideas/cards/${id}`);
        } catch {
          failed += 1;
        }
      }
      for (const c of pending) {
        const ext = c.full.type === 'image/webp' ? 'webp' : 'jpg';
        const fd = new FormData();
        fd.append('image', c.full, `card.${ext}`);
        fd.append('thumb', c.thumb, `card-thumb.${ext}`);
        fd.append('width', String(c.width));
        fd.append('height', String(c.height));
        for (const k of ['contact_name', 'designation', 'phone', 'email'] as const) if (c[k].trim()) fd.append(k, c[k].trim());
        try {
          await api.upload(`/ideas/${r.code}/cards`, fd);
        } catch {
          failed += 1;
        }
      }
      return { r, failed };
    },
    onSuccess: ({ r, failed }) => {
      toast.success(t(isEdit ? 'registry.form.updated' : 'registry.form.saved', { code: r.code }));
      if (failed) toast.error(t('registry.cards.uploadFailed', { count: failed }));
      void qc.invalidateQueries({ queryKey: queryKeys.registry.all });
      setF(EMPTY);
      pending.forEach((c) => URL.revokeObjectURL(c.preview));
      setPending([]);
      setRemoved([]);
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE') toast.error(t('registry.form.duplicate', { code: String(e.details.code ?? '') }));
      else toast.error(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isEdit ? t('registry.form.editTitle', { code: item.code }) : t('registry.form.title')}
      description={t('registry.form.description')}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="registry-form" loading={save.isPending}>
            {t(isEdit ? 'registry.form.saveChanges' : 'registry.form.save')}
          </Button>
        </>
      }
    >
      <form id="registry-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('registry.form.projectTitle')} required className="sm:col-span-2">
          <Input required minLength={3} maxLength={300} placeholder={t('registry.form.projectTitlePh')} value={f.title} onChange={set('title')} />
        </Field>
        <Field label={t('registry.form.institution')} required>
          <Input required minLength={2} maxLength={200} placeholder={t('registry.form.institutionPh')} value={f.institution} onChange={set('institution')} />
        </Field>
        <Field label={t('registry.form.institutionType')} required>
          <Select
            value={f.institution_type}
            onChange={set('institution_type')}
            options={INSTITUTION_TYPES.map((v) => ({ value: v, label: t(`registry.institutionTypes.${v}`) }))}
          />
        </Field>
        <Field label={t('registry.form.creator')}>
          <Input maxLength={200} placeholder={t('registry.form.creatorPh')} value={f.creator} onChange={set('creator')} />
        </Field>
        <Field label={t('registry.form.creatorType')}>
          <Select
            value={f.creator_type}
            onChange={set('creator_type')}
            placeholder="—"
            options={CREATOR_TYPES.map((v) => ({ value: v, label: t(`registry.creatorTypes.${v}`) }))}
          />
        </Field>
        <Field label={t('registry.form.creatorEmail')}>
          <Input type="email" maxLength={200} value={f.creator_email} onChange={set('creator_email')} />
        </Field>
        <Field label={t('registry.form.contactPhone')}>
          <Input
            type="tel"
            maxLength={40}
            placeholder="+880 1XXX-XXXXXX"
            value={f.contact_phone}
            onChange={set('contact_phone')}
          />
        </Field>
        <Field label={t('registry.form.contactAddress')} className="sm:col-span-2">
          <Input maxLength={500} placeholder={t('registry.form.contactAddressPh')} value={f.contact_address} onChange={set('contact_address')} />
        </Field>
        <Field label={t('registry.form.collectedAt')}>
          <Select
            value={f.collected_at}
            onChange={set('collected_at')}
            placeholder="—"
            options={COLLECTED_AT.map((v) => ({ value: v, label: t(`registry.collectedAtOptions.${v}`) }))}
          />
        </Field>
        <Field label={t('registry.form.eventName')}>
          <Input maxLength={200} placeholder={t('registry.form.eventNamePh')} value={f.event_name} onChange={set('event_name')} />
        </Field>
        <Field label={t('registry.form.summary')} required className="sm:col-span-2">
          <Textarea required minLength={10} maxLength={2000} rows={3} placeholder={t('registry.form.summaryPh')} value={f.summary} onChange={set('summary')} />
        </Field>
        <Field label={t('registry.form.fullDescription')} className="sm:col-span-2">
          <Textarea maxLength={10000} rows={4} value={f.description} onChange={set('description')} />
        </Field>
        <Field label={t('registry.form.techStack')} help={t('registry.form.techStackHelp')} className="sm:col-span-2">
          <Input value={f.tech_stack} onChange={set('tech_stack')} />
        </Field>
        {showMore ? (
          <fieldset className="rounded-control border border-line p-4 sm:col-span-2">
            <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
              <ListPlus className="h-4 w-4 text-primary" aria-hidden />
              {t('registry.form.moreTitle')}
            </legend>
            <p className="mb-3 text-sm leading-relaxed text-ink-muted">{t('registry.form.moreHelp')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('registry.form.tagline')}>
                <Input maxLength={300} placeholder={t('registry.form.taglinePh')} value={f.tagline} onChange={set('tagline')} />
              </Field>
              <Field label={t('registry.form.website')}>
                <Input inputMode="url" maxLength={400} placeholder="https://" value={f.website} onChange={set('website')} />
              </Field>
              <Field label={t('registry.form.services')} className="sm:col-span-2">
                <Textarea maxLength={10000} rows={3} placeholder={t('registry.form.servicesPh')} value={f.services} onChange={set('services')} />
              </Field>
              <Field label={t('registry.form.projectsProducts')} className="sm:col-span-2">
                <Textarea maxLength={10000} rows={3} placeholder={t('registry.form.projectsProductsPh')} value={f.projects_products} onChange={set('projects_products')} />
              </Field>
            </div>
          </fieldset>
        ) : (
          <div className="sm:col-span-2">
            <Button type="button" variant="secondary" size="sm" icon={<ListPlus className="h-4 w-4" aria-hidden />} onClick={() => setShowMore(true)}>
              {t('registry.form.moreAdd')}
            </Button>
          </div>
        )}
        <fieldset className="rounded-control border border-line p-4 sm:col-span-2">
          <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            {t('registry.ai.formTitle')}
          </legend>
          <p className="mb-3 text-sm leading-relaxed text-ink-muted">{t('registry.ai.formHelp')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('registry.ai.category')}>
              <Select
                value={f.ai_category}
                onChange={set('ai_category')}
                placeholder="—"
                options={AI_CATEGORIES.map((v) => ({ value: v, label: t(`registry.ai.categories.${v}`) }))}
              />
            </Field>
            <Field label={t('registry.ai.intensity')} help={f.ai_intensity ? t(`registry.ai.intensityHelp.${f.ai_intensity}`) : t('registry.ai.intensityPick')}>
              <Select
                value={f.ai_intensity}
                onChange={set('ai_intensity')}
                placeholder="—"
                options={AI_INTENSITIES.map((v) => ({ value: v, label: t(`registry.ai.intensities.${v}`) }))}
              />
            </Field>
            <Field label={t('registry.ai.tags')} help={t('registry.ai.tagsHelp')} className="sm:col-span-2">
              <Input maxLength={600} placeholder={t('registry.ai.tagsPh')} value={f.ai_tags} onChange={set('ai_tags')} />
            </Field>
            <Field label={t('registry.ai.work')} className="sm:col-span-2">
              <Textarea maxLength={2000} rows={3} placeholder={t('registry.ai.workPh')} value={f.ai_work} onChange={set('ai_work')} />
            </Field>
            <Field label={t('registry.ai.uniquePoint')} className="sm:col-span-2">
              <Textarea maxLength={2000} rows={2} placeholder={t('registry.ai.uniquePointPh')} value={f.ai_unique_point} onChange={set('ai_unique_point')} />
            </Field>
          </div>
        </fieldset>
        <CardUploader
          existing={item?.business_cards ?? []}
          removed={removed}
          onToggleRemove={(id) => setRemoved((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          pending={pending}
          setPending={setPending}
        />
        <Field label={t('registry.form.impact')}>
          <Input maxLength={2000} placeholder={t('registry.form.impactPh')} value={f.impact} onChange={set('impact')} />
        </Field>
        <Field label={t('registry.form.sourceUrl')}>
          <Input type="url" maxLength={1000} placeholder="https://" value={f.source_url} onChange={set('source_url')} />
        </Field>
      </form>
    </Dialog>
  );
}
