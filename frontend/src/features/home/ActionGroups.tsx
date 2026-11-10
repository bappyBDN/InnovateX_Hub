import { AlertTriangle, ClipboardCheck, Clock, Gavel, Lightbulb, ListChecks, MonitorPlay, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card } from '@/components/ui';
import { cn } from '@/utils/cn';

export interface ActionItem {
  title: string;
  code: string | null;
  context: string;
  waiting_days: number | null;
  link: string;
  action: string;
  count?: number;
  judges?: string[];
}
export interface ActionGroup {
  key: 'ideas_need_judges' | 'demos_need_judges' | 'shortlists' | 'results' | 'overdue_reviews' | string;
  tone: 'warning' | 'danger';
  total: number;
  items: ActionItem[];
  see_all: string;
}

const ICONS: Record<string, typeof Lightbulb> = {
  ideas_need_judges: Lightbulb,
  demos_need_judges: MonitorPlay,
  shortlists: ListChecks,
  results: Trophy,
  overdue_reviews: Clock,
};
const ACTION_ICONS: Record<string, typeof Gavel> = { chase_reviews: AlertTriangle, publish_results: Trophy, record_results: ClipboardCheck };

/** One summary chip per kind of work; clicking jumps to its list. */
export function ActionSummary({ groups }: { groups: ActionGroup[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t('home.actions.summary')}>
      {groups.map((g) => {
        const Icon = ICONS[g.key] ?? ListChecks;
        return (
          <li key={g.key}>
            <a
              href={`#todo-${g.key}`}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                g.tone === 'danger' ? 'border-danger/40 bg-danger-soft text-ink hover:border-danger' : 'border-warning/40 bg-warning-soft text-ink hover:border-warning',
              )}
            >
              <Icon className={cn('h-4 w-4', g.tone === 'danger' ? 'text-danger' : 'text-warning')} aria-hidden />
              <span className="tabular font-semibold">{g.total}</span>
              {t(`home.actions.${g.key}.short`)}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function Waiting({ item, tone, groupKey }: { item: ActionItem; tone: ActionGroup['tone']; groupKey: string }) {
  const { t } = useTranslation();
  if (item.waiting_days == null) return <span className="text-sm text-ink-muted">—</span>;
  const late = groupKey === 'overdue_reviews';
  const urgent = late || item.waiting_days >= 7;
  return (
    <span className={cn('tabular text-sm', urgent ? (tone === 'danger' || late ? 'font-medium text-danger' : 'font-medium text-warning') : 'text-ink-muted')}>
      {late
        ? item.waiting_days === 0
          ? t('home.actions.lateToday')
          : t('home.actions.late', { count: item.waiting_days })
        : item.waiting_days === 0
          ? t('home.actions.today')
          : t('home.actions.waiting', { count: item.waiting_days })}
    </span>
  );
}

/** Every piece of work the innovation office has to do, item by item, with the button that does it. */
export function ActionGroups({ groups }: { groups: ActionGroup[] }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const Icon = ICONS[g.key] ?? ListChecks;
        const more = g.total - g.items.length;
        return (
          <Card key={g.key} id={`todo-${g.key}`} padded={false} className="scroll-mt-24 overflow-hidden">
            <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
              <span
                className={cn(
                  'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                  g.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-snug text-ink">
                  {t(`home.actions.${g.key}.title`)}
                  <Badge tone={g.tone}>{g.total}</Badge>
                </h3>
                <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-ink-muted">{t(`home.actions.${g.key}.help`)}</p>
              </div>
              <Link to={g.see_all} className="shrink-0 self-center text-sm font-medium text-primary hover:underline">
                {t('home.actions.seeAll')}
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {g.items.map((item, i) => {
                const ActionIcon = ACTION_ICONS[item.action];
                return (
                  <li
                    key={`${item.link}-${i}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1fr)_9rem_11rem]"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink" title={item.title}>
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-ink-muted">
                        {[item.code, item.context].filter(Boolean).join(' · ')}
                        {item.count != null && ` · ${t('home.actions.reviews', { count: item.count })}`}
                      </p>
                      {item.judges && item.judges.length > 0 && (
                        <p className="mt-0.5 truncate text-sm text-ink-muted" title={item.judges.join(', ')}>
                          {t('home.actions.judges', { names: item.judges.join(', ') })}
                        </p>
                      )}
                    </div>
                    <div className="col-start-1 row-start-2 md:col-start-2 md:row-start-1 md:text-right">
                      <Waiting item={item} tone={g.tone} groupKey={g.key} />
                    </div>
                    <div className="col-start-2 row-span-2 row-start-1 justify-self-end md:col-start-3 md:row-span-1">
                      <ButtonLink
                        to={item.link}
                        size="sm"
                        variant={i === 0 ? 'primary' : 'secondary'}
                        icon={ActionIcon ? <ActionIcon className="h-4 w-4" aria-hidden /> : undefined}
                        className="w-full justify-center md:w-44"
                      >
                        {t(`home.actions.do.${item.action}`)}
                      </ButtonLink>
                    </div>
                  </li>
                );
              })}
            </ul>
            {more > 0 && (
              <div className="border-t border-line bg-canvas px-4 py-2.5 text-sm sm:px-5">
                <Link to={g.see_all} className="font-medium text-primary hover:underline">
                  {t('home.actions.more', { count: more })}
                </Link>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
