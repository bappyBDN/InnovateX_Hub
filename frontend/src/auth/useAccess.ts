import { useMemo } from 'react';
import { useMe } from './AuthProvider';
import { PRIVILEGED_ROLES, SEES_ALL_ROLES, type Permission, type Role } from './types';

export function useAccess() {
  const { data: me } = useMe();
  return useMemo(() => {
    const roles = new Set<Role>(me?.roles ?? []);
    const perms = new Set<Permission>(me?.permissions ?? []);
    const hasRole = (...r: Role[]) => r.some((x) => roles.has(x));
    return {
      me,
      roles: me?.roles ?? [],
      hasRole,
      can: (p: Permission) => perms.has(p),
      /** Super Admin, Program Owner, Executive and Judges see all submissions. */
      seesAllSubmissions: hasRole(...SEES_ALL_ROLES),
      /** Super Admin or Program Owner. */
      isPrivileged: hasRole(...PRIVILEGED_ROLES),
      isTeamLeader: (teamId: string) => me?.teams.some((t) => t.id === teamId && t.role === 'LEAD') ?? false,
      isTeamMember: (teamId: string) => me?.teams.some((t) => t.id === teamId) ?? false,
      flag: (code: string) => !!me?.feature_flags?.[code],
    };
  }, [me]);
}
