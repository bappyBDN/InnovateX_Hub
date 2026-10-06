import {
  BarChart3, Bell, BookOpen, ClipboardCheck, Gavel, ClipboardList, FileSearch, FileText, Flag, GitBranch, Home, Layers,
  Lightbulb, LineChart, ListChecks, Mail, Network, PlusCircle, ScrollText, Settings, Settings2, SlidersHorizontal,
  Trophy, UserCog, Users, type LucideIcon,
} from 'lucide-react';
import type { Me, Role } from '@/auth/types';

export interface NavItem {
  key: string;
  /** i18n key, or plain text when `rawLabel` is set. */
  labelKey: string;
  rawLabel?: string;
  to: string;
  icon: LucideIcon;
  /** Match only the exact path when highlighting. */
  end?: boolean;
}

export interface NavGroup {
  key: string;
  titleKey?: string;
  items: NavItem[];
}

/** Role-based menu, exactly as the table in UI/UX spec §4.1. */
export function buildNav(me: Me | undefined): NavGroup[] {
  const roles = new Set<Role>(me?.roles ?? []);
  const has = (...r: Role[]) => r.some((x) => roles.has(x));
  const privileged = has('SUPER_ADMIN', 'PROGRAM_OWNER');
  // Executive viewers are read-only: no own entries or ideas unless they also hold another working role.
  const executiveOnly = has('EXECUTIVE') && !privileged && !has('JUDGE');

  const work: NavItem[] = [
    { key: 'home', labelKey: 'nav.home', to: '/', icon: Home, end: true },
    { key: 'challenges', labelKey: 'nav.challenges', to: '/challenges', icon: Flag },
  ];
  if (!executiveOnly) work.push({ key: 'entries', labelKey: 'nav.myEntries', to: '/entries', icon: ClipboardList });
  if (!privileged && !executiveOnly) {
    for (const team of me?.teams ?? []) {
      work.push({
        key: `team-${team.id}`,
        labelKey: 'nav.myTeam',
        rawLabel: (me?.teams.length ?? 0) > 1 ? team.name : undefined,
        to: `/teams/${team.id}`,
        icon: Users,
      });
    }
  }
  if (!executiveOnly) {
    work.push({ key: 'idea-new', labelKey: 'nav.submitIdea', to: '/ideas/new', icon: PlusCircle });
    work.push({ key: 'ideas', labelKey: 'nav.myIdeas', to: '/ideas', icon: Lightbulb, end: true });
  }

  const review: NavItem[] = [];
  if (has('JUDGE', 'PROGRAM_OWNER', 'SUPER_ADMIN') || me?.is_judge)
    review.push({ key: 'review', labelKey: 'nav.reviewQueue', to: '/review', icon: ClipboardCheck });
  if (has('JUDGE', 'EXECUTIVE', 'PROGRAM_OWNER', 'SUPER_ADMIN'))
    review.push({ key: 'submissions', labelKey: 'nav.allSubmissions', to: '/submissions', icon: FileSearch });

  const program: NavItem[] = [];
  if (has('PROGRAM_OWNER', 'SUPER_ADMIN', 'EXECUTIVE'))
    program.push({ key: 'portfolio', labelKey: 'nav.ideasPortfolio', to: '/manage/ideas', icon: Layers });
  if (privileged)
    program.push({ key: 'manage', labelKey: 'nav.manageChallenges', to: '/manage/challenges', icon: Settings2 });

  const explore: NavItem[] = [
    { key: 'results', labelKey: 'nav.results', to: '/results', icon: Trophy },
    { key: 'catalogue', labelKey: 'nav.catalogue', to: '/catalogue', icon: BookOpen },
    { key: 'impact', labelKey: 'nav.impact', to: '/impact', icon: LineChart },
    { key: 'dashboards', labelKey: 'nav.dashboards', to: '/dashboards', icon: BarChart3 },
    { key: 'notifications', labelKey: 'nav.notifications', to: '/notifications', icon: Bell },
  ];

  const admin: NavItem[] = [];
  const sa = has('SUPER_ADMIN');
  if (sa) {
    admin.push({ key: 'a-home', labelKey: 'adminPanel.navHome', to: '/admin', icon: Settings, end: true });
    admin.push({ key: 'a-users', labelKey: 'nav.adminUsers', to: '/admin/users', icon: UserCog });
    admin.push({ key: 'a-judges', labelKey: 'judging.adminTitle', to: '/admin/judges', icon: Gavel });
    admin.push({ key: 'a-invites', labelKey: 'adminPanel.navInvitations', to: '/admin/invitations', icon: Mail });
    admin.push({ key: 'a-priv', labelKey: 'adminPanel.navPrivileges', to: '/admin/privileges', icon: ListChecks });
  }
  if (sa || has('ADMIN')) {
    admin.push({ key: 'a-org', labelKey: 'nav.adminOrg', to: '/admin/org', icon: Network });
    admin.push({ key: 'a-md', labelKey: 'nav.adminMasterData', to: '/admin/master-data', icon: ListChecks });
  }
  if (privileged) {
    admin.push({ key: 'a-forms', labelKey: 'nav.adminForms', to: '/admin/forms', icon: FileText });
    admin.push({ key: 'a-score', labelKey: 'nav.adminScorecards', to: '/admin/scorecards', icon: SlidersHorizontal });
  }
  if (sa) admin.push({ key: 'a-wf', labelKey: 'nav.adminWorkflows', to: '/admin/workflows', icon: GitBranch });
  if (privileged) admin.push({ key: 'a-notif', labelKey: 'nav.adminNotifications', to: '/admin/notifications', icon: Mail });
  if (sa) {
    admin.push({ key: 'a-settings', labelKey: 'nav.adminSettings', to: '/admin/settings', icon: Settings });
    admin.push({ key: 'a-audit', labelKey: 'nav.adminAudit', to: '/admin/audit', icon: ScrollText });
  }

  return [
    { key: 'work', items: work },
    { key: 'review', titleKey: 'nav.sectionReview', items: review },
    { key: 'program', titleKey: 'nav.sectionProgram', items: program },
    { key: 'explore', titleKey: 'nav.sectionExplore', items: explore },
    { key: 'admin', titleKey: 'nav.admin', items: admin },
  ].filter((g) => g.items.length > 0);
}

/** The 3 most-used items for the phone bottom bar (the 4th slot is "More"). */
export function bottomNavItems(me: Me | undefined): NavItem[] {
  const all = buildNav(me).flatMap((g) => g.items);
  const pick = (key: string) => all.find((i) => i.key === key);
  const roles = new Set<Role>(me?.roles ?? []);
  const third =
    (roles.has('JUDGE') && pick('review')) ||
    ((roles.has('PROGRAM_OWNER') || roles.has('SUPER_ADMIN')) && pick('manage')) ||
    pick('entries') ||
    pick('dashboards');
  return [pick('home'), pick('challenges'), third || undefined].filter((x): x is NavItem => !!x);
}
