import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/Feedback';
import NotFoundPage from '@/features/misc/NotFoundPage';
import { useAuth } from './AuthProvider';
import type { Permission, Role } from './types';

const LandingPage = lazy(() => import('@/features/landing/LandingPage'));
import { useAccess } from './useAccess';

/** Hide a part of the page unless the user has the permission or one of the roles. */
export function Can({
  permission,
  roles,
  children,
  fallback = null,
}: {
  permission?: Permission;
  roles?: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, hasRole } = useAccess();
  const okPerm = permission ? can(permission) : true;
  const okRole = roles && roles.length ? hasRole(...roles) : true;
  return <>{okPerm && okRole ? children : fallback}</>;
}

/** Sends signed-out users to /login and brings them back afterwards (keeps /join/:token links working). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { isAuthenticated, isLoading, error } = useAuth();
  const location = useLocation();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-live="polite">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (!isAuthenticated) {
    void error;
    // The first page for visitors who are not signed in is the public landing page.
    if (location.pathname === '/') {
      return (
        <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
          <LandingPage />
        </Suspense>
      );
    }
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children ?? <Outlet />}</>;
}

/**
 * Protects a route. A user without access sees the same "Page not found" page as for a
 * missing record, so the page never confirms that something exists (spec §3.1).
 */
export function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { hasRole } = useAccess();
  if (!hasRole(...roles)) return <NotFoundPage />;
  return <>{children ?? <Outlet />}</>;
}
