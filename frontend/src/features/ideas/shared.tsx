import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type Page } from '@/api/client';
import { queryKeys } from '@/api/queryKeys';
import type { JourneyStage } from '@/components/domain';
import { Input } from '@/components/ui';
import { useDebounce } from '@/hooks';
import type { I18nText } from '@/utils/i18n';

// ---- Types (mirror backend/app/modules/initiatives) ---------------------------------------
export interface UserBrief {
  id: string;
  full_name: string;
  job_title?: string | null;
  email?: string | null;
  org_unit?: string | null;
}

export interface IdeaMember extends UserBrief {
  user_id: string;
  member_role: 'OWNER' | 'CONTRIBUTOR' | 'MENTOR';
  credit_share_pct: number | null;
}

export interface IdeaNextStep {
  text: string;
  action_label: string | null;
  action_path: string | null;
}

export interface IdeaCard {
  id: string;
  code: string | null;
  key: string;
  title: string;
  summary: string | null;
  category: { id: string; name_i18n: I18nText; color?: string | null } | null;
  innovation_type_code: string | null;
  org_unit: string | null;
  current_state_code: string;
  stage_entered_at: string | null;
  submitted_at: string | null;
  updated_at: string | null;
  data_classification_code: string;
  is_in_idea_bank: boolean;
  is_awarded: boolean;
  score_latest: number | null;
  owner: UserBrief | null;
  journey: JourneyStage[];
  next_step: IdeaNextStep;
}

export interface IdeaLink {
  url: string;
  title?: string;
}

export interface IdeaFields {
  title: string;
  summary: string | null;
  problem_statement: string | null;
  affected_users: string | null;
  current_process: string | null;
  proposed_solution: string | null;
  technology_used: string | null;
  differentiator: string | null;
  category_id: string | null;
  innovation_type_code: string | null;
  org_unit_id: string | null;
  sponsor_user_id: string | null;
  data_classification_code: string | null;
  scalability_level_code: string | null;
  risk_flags: string[] | null;
  benefit_types: string[] | null;
  primary_kpi: string | null;
  baseline_value: string | null;
  target_value: string | null;
  expected_benefit: string | null;
  expected_timeline: string | null;
  estimated_cost: number | null;
  dependencies: string | null;
  declaration_accepted: boolean | null;
  on_behalf_of_user_id: string | null;
}

export interface IdeaClarification {
  id: string;
  question: string;
  answer: string | null;
  status: 'OPEN' | 'ANSWERED' | 'EXPIRED';
  due_at: string | null;
  asked_at: string | null;
  answered_at: string | null;
  asked_by: string | null;
}

export interface IdeaFeedback {
  id: string;
  decision_code: string | null;
  decision_reason: string | null;
  strengths: string | null;
  improvements: string | null;
  next_steps: string | null;
  score_shared: number | null;
  judge_comments: Record<string, string[]>;
  recommendations: string[];
  published_at: string | null;
}

export interface IdeaAction {
  action_code: string;
  label: string;
  to_state: string;
  requires_comment: boolean;
  tone: 'primary' | 'secondary' | 'danger';
}

export interface IdeaReview {
  id: string;
  reviewer: string | null;
  status: string;
  due_at: string | null;
  weighted_score: number | null;
  recommendation: string | null;
  strengths: string | null;
  improvements: string | null;
}

export interface IdeaDetail extends IdeaCard, Omit<IdeaFields, "title" | "summary" | "data_classification_code" | "innovation_type_code"> {
  content: { links?: IdeaLink[] } & Record<string, unknown>;
  row_version: number;
  currency_code: string;
  sponsor: UserBrief | null;
  submitted_by: UserBrief | null;
  on_behalf_of: UserBrief | null;
  members: IdeaMember[];
  my_role: 'OWNER' | 'MEMBER' | 'REVIEWER' | 'STAFF';
  can_edit: boolean;
  can_upload: boolean;
  allowed_actions: IdeaAction[];
  missing_fields: Record<string, string>;
  is_published_to_catalogue: boolean;
  confidential: boolean;
  can_manage: boolean;
  /** Only the admin chooses the judges of an idea. */
  can_assign_judges?: boolean;
  duplicate_of?: { code: string; title: string } | null;
  clarifications: IdeaClarification[];
  feedback: IdeaFeedback[];
  reviews?: IdeaReview[];
}

export interface LookupValue {
  id: string;
  code: string;
  label: string;
  label_i18n: I18nText;
  is_active: boolean;
}
export type Lookups = Record<string, LookupValue[]>;

export interface CategoryItem {
  id: string;
  code: string;
  name: string;
  name_i18n: I18nText;
}

export interface OrgUnitItem {
  id: string;
  name: string;
  name_i18n: I18nText;
  path: string;
  unit_type: string;
  is_active: boolean;
  is_sbu?: boolean;
}

// ---- Master data hooks --------------------------------------------------------------------
const LONG = 10 * 60_000;

export function useLookups() {
  return useQuery({ queryKey: queryKeys.masterdata.lookups('all'), queryFn: () => api.get<Lookups>('/lookups'), staleTime: LONG });
}
export function useCategories() {
  return useQuery({ queryKey: queryKeys.masterdata.categories, queryFn: () => api.get<CategoryItem[]>('/categories'), staleTime: LONG });
}
export function useOrgUnits() {
  return useQuery({ queryKey: queryKeys.masterdata.orgUnits, queryFn: () => api.get<OrgUnitItem[]>('/org-units'), staleTime: LONG });
}

/** Ideas the owner can no longer act on. */
export const CLOSED_STATES = ['CLOSED', 'NOT_SELECTED', 'DUPLICATE'];

// ---- People picker: shows name and department only -----------------------------------------
export function UserPicker({
  id,
  onSelect,
  excludeIds = [],
  placeholder,
}: {
  id?: string;
  onSelect: (user: UserBrief) => void;
  excludeIds?: string[];
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounce(q.trim(), 300);
  const users = useQuery({
    queryKey: queryKeys.masterdata.users(term),
    queryFn: () => api.get<Page<UserBrief>>('/users', { q: term, limit: 8 }),
    enabled: open && term.length >= 2,
  });
  const options = (users.data?.items ?? []).filter((u) => !excludeIds.includes(u.id));

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
        <Input
          id={id}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder ?? t('ideas.picker.placeholder')}
          className="pl-9"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && term.length >= 2}
          aria-autocomplete="list"
        />
      </div>
      {open && term.length >= 2 && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface py-1 shadow-float"
        >
          {users.isLoading && <li className="px-3 py-2 text-sm text-ink-muted">{t('common.loading')}</li>}
          {!users.isLoading && options.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-muted">{t('ideas.picker.none')}</li>
          )}
          {options.map((u) => (
            <li key={u.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-primary-soft focus:bg-primary-soft focus:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(u);
                  setQ('');
                  setOpen(false);
                }}
              >
                <span className="font-medium text-ink">{u.full_name}</span>
                <span className="text-xs text-ink-muted">{[u.job_title, u.org_unit].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A picked person shown as a removable chip. */
export function PickedUser({ user, onRemove, removeLabel }: { user: UserBrief; onRemove?: () => void; removeLabel: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-primary-soft py-1 pl-3 pr-1 text-sm text-ink">
      <span className="truncate">
        {user.full_name}
        {user.org_unit ? <span className="text-ink-muted"> · {user.org_unit}</span> : null}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-surface"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
