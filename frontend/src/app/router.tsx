import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router-dom';
import { RequireAuth, RequireRole } from '@/auth/guards';
import type { Role } from '@/auth/types';
import { ErrorState, PageSkeleton } from '@/components/ui/Feedback';
import LoginPage from '@/features/auth/LoginPage';
import SignupPage from '@/features/auth/SignupPage';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { AppShell } from './layout/AppShell';

// Every page is its own chunk (lazy route).
const page = (load: () => Promise<{ default: ComponentType }>): ReactNode => {
  const C = lazy(load);
  return <C />;
};

const SubmissionFormPage = lazy(() => import('@/features/entries/SubmissionFormPage'));
const EntryPrototypePage = lazy(() => import('@/features/gates/EntryPrototypePage'));

const guard = (roles: Role[], element: ReactNode): ReactNode => <RequireRole roles={roles}>{element}</RequireRole>;

const SEES_ALL: Role[] = ['SUPER_ADMIN', 'PROGRAM_OWNER', 'EXECUTIVE', 'JUDGE'];
const MANAGE: Role[] = ['PROGRAM_OWNER', 'SUPER_ADMIN'];
const PORTFOLIO: Role[] = ['PROGRAM_OWNER', 'SUPER_ADMIN', 'EXECUTIVE'];
const SA: Role[] = ['SUPER_ADMIN'];
const MASTER: Role[] = ['SUPER_ADMIN', 'ADMIN'];

function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-reading p-6">
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/signup', element: <SignupPage />, errorElement: <RouteError /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { path: '/', element: page(() => import('@/features/home/HomePage')) },

      // Challenges, teams, entries
      { path: '/challenges', element: page(() => import('@/features/challenges/ChallengeListPage')) },
      { path: '/challenges/:slug', element: page(() => import('@/features/challenges/ChallengeDetailPage')) },
      { path: '/challenges/:slug/register', element: page(() => import('@/features/challenges/RegisterPage')) },
      { path: '/join/:token', element: page(() => import('@/features/teams/JoinPage')) },
      { path: '/join', element: page(() => import('@/features/teams/JoinPage')) },
      { path: '/teams/:id', element: page(() => import('@/features/teams/TeamPage')) },
      { path: '/entries', element: page(() => import('@/features/entries/MyEntriesPage')) },
      { path: '/entries/:id', element: page(() => import('@/features/entries/EntryOverviewPage')) },
      {
        path: '/entries/:id/methodology',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <SubmissionFormPage key="methodology" kind="methodology" />
          </Suspense>
        ),
      },
      {
        path: '/entries/:id/prototype',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <EntryPrototypePage />
          </Suspense>
        ),
      },
      {
        path: '/entries/:id/final',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <SubmissionFormPage key="final" kind="final" />
          </Suspense>
        ),
      },
      { path: '/entries/:id/milestones', element: page(() => import('@/features/entries/MilestonesPage')) },
      { path: '/entries/:id/demo', element: page(() => import('@/features/entries/DemoBookingPage')) },
      { path: '/entries/:id/feedback', element: page(() => import('@/features/entries/FeedbackPage')) },

      // Ideas
      { path: '/ideas/new', element: page(() => import('@/features/ideas/IdeaFormPage')) },
      { path: '/ideas/:code/edit', element: page(() => import('@/features/ideas/IdeaFormPage')) },
      { path: '/ideas', element: page(() => import('@/features/ideas/MyIdeasPage')) },
      { path: '/ideas/:code', element: page(() => import('@/features/ideas/IdeaDetailPage')) },

      // Judges
      // Open to everyone who is signed in: the list shows only what the person was chosen to judge.
      { path: '/review', element: page(() => import('@/features/review/ReviewQueuePage')) },
      { path: '/review/decision/:voteId', element: page(() => import('@/features/gates/GateDecisionPage')) },
      { path: '/review/:assignmentId', element: page(() => import('@/features/review/ScoringWorkspacePage')) },
      { path: '/submissions', element: guard(SEES_ALL, page(() => import('@/features/submissions/SubmissionsBrowserPage'))) },
      { path: '/submissions/:id', element: guard(SEES_ALL, page(() => import('@/features/submissions/SubmissionViewPage'))) },

      // Program owner / super admin
      { path: '/manage/ideas', element: guard(PORTFOLIO, page(() => import('@/features/manage/IdeasPortfolioPage'))) },
      { path: '/manage/challenges', element: guard(MANAGE, page(() => import('@/features/manage/ManageChallengesPage'))) },
      { path: '/manage/challenges/new', element: guard(MANAGE, page(() => import('@/features/manage/ChallengeBuilderPage'))) },
      { path: '/manage/challenges/:id/edit', element: guard(MANAGE, page(() => import('@/features/manage/ChallengeBuilderPage'))) },
      { path: '/manage/challenges/:id', element: guard(MANAGE, page(() => import('@/features/manage/ControlCentrePage'))) },
      {
        path: '/manage/challenges/:id/rounds/:roundId',
        element: guard(MANAGE, page(() => import('@/features/manage/RoundResultsPage'))),
      },
      {
        path: '/manage/challenges/:id/shortlist/:shortlistId',
        element: guard(MANAGE, page(() => import('@/features/manage/ShortlistPage'))),
      },
      { path: '/manage/challenges/:id/results', element: guard(MANAGE, page(() => import('@/features/manage/ResultsDecisionPage'))) },

      // Everyone
      { path: '/results', element: page(() => import('@/features/results/ResultsPage')) },
      { path: '/catalogue', element: page(() => import('@/features/catalogue/CataloguePage')) },
      { path: '/impact', element: page(() => import('@/features/impact/ImpactPage')) },
      { path: '/dashboards', element: page(() => import('@/features/dashboards/DashboardPage')) },
      { path: '/dashboards/:type', element: page(() => import('@/features/dashboards/DashboardPage')) },
      { path: '/notifications', element: page(() => import('@/features/notifications/NotificationsPage')) },
      { path: '/profile', element: page(() => import('@/features/profile/ProfilePage')) },

      // Admin
      { path: '/admin', element: guard(SA, page(() => import('@/features/admin/AdminHomePage'))) },
      { path: '/admin/invitations', element: guard(SA, page(() => import('@/features/admin/InvitationsPage'))) },
      { path: '/admin/privileges', element: guard(SA, page(() => import('@/features/admin/PrivilegesPage'))) },
      { path: '/admin/users', element: guard(SA, page(() => import('@/features/admin/UsersPage'))) },
      { path: '/admin/judges', element: guard(SA, page(() => import('@/features/judging/JudgesAdminPage'))) },
      { path: '/admin/org', element: guard(MASTER, page(() => import('@/features/admin/OrgPage'))) },
      { path: '/admin/master-data', element: guard(MASTER, page(() => import('@/features/admin/MasterDataPage'))) },
      { path: '/admin/forms', element: guard(MANAGE, page(() => import('@/features/admin/FormsPage'))) },
      { path: '/admin/scorecards', element: guard(MANAGE, page(() => import('@/features/admin/ScorecardsPage'))) },
      { path: '/admin/workflows', element: guard(SA, page(() => import('@/features/admin/WorkflowsPage'))) },
      { path: '/admin/notifications', element: guard(MANAGE, page(() => import('@/features/admin/NotificationsAdminPage'))) },
      { path: '/admin/settings', element: guard(SA, page(() => import('@/features/admin/SettingsPage'))) },
      { path: '/admin/audit', element: guard(SA, page(() => import('@/features/admin/AuditPage'))) },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
