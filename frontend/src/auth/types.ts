export type Role =
  | 'DMD'
  | 'SUPER_ADMIN'
  | 'PROGRAM_OWNER'
  | 'EXECUTIVE'
  | 'JUDGE'
  | 'ADMIN'
  | 'HR'
  | 'FINANCE_VERIFIER'
  | 'SPONSOR'
  | 'EMPLOYEE';

export type Permission = string;

export interface MeTeam {
  id: string;
  name: string;
  role: 'LEAD' | 'MEMBER';
  challenge_id: string | null;
}

export interface Me {
  id: string;
  full_name: string;
  email: string | null;
  job_title: string | null;
  locale: string;
  org_unit: { id: string; name: string } | null;
  /** The SBU (group or company) the person's unit sits in. */
  sbu?: { id: string; name: string } | null;
  department?: string | null;
  roles: Role[];
  permissions: Permission[];
  /** True when the admin chose this person as a judge of a challenge or an idea (no role needed). */
  is_judge?: boolean;
  teams: MeTeam[];
  feature_flags: Record<string, boolean>;
  unread_notifications: number;
  server_time: string;
}

export interface DemoAccount {
  email: string;
  full_name: string;
  job_title: string | null;
  roles: Role[];
  note?: string | null;
}

export interface DemoAccountsResponse {
  password: string;
  accounts: DemoAccount[];
}

export const SEES_ALL_ROLES: Role[] = ['SUPER_ADMIN', 'PROGRAM_OWNER', 'EXECUTIVE', 'JUDGE'];
export const PRIVILEGED_ROLES: Role[] = ['SUPER_ADMIN', 'PROGRAM_OWNER'];
