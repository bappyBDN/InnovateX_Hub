from sqlalchemy import Date, String
from sqlalchemy.orm import mapped_column

from app.shared.models.base import Base, StdColumns, sc, flag, i18n, integer, json_col, ref, text, ts


class Organization(Base, StdColumns):
    __tablename__ = "organizations"
    code = sc(30, unique=True)
    name_i18n = i18n()
    default_locale = sc(10, default="en")
    timezone = sc(50, default="Asia/Dhaka")
    settings = json_col()
    is_active = flag(True)


class OrgUnit(Base, StdColumns):
    """Tree: Group > Company > Function > Department > Team. Groups and companies are the SBUs (see sbu.py)."""
    __tablename__ = "org_units"
    organization_id = ref()
    parent_id = ref()
    unit_type = sc(30)
    code = sc(50, index=True)
    name_i18n = i18n()
    path = mapped_column(String, index=True)  # e.g. "anwar.aes.delivery" (ltree stand-in)
    head_user_id = ref()
    external_ref = sc(100, nullable=True)
    is_active = flag(True)


class User(Base, StdColumns):
    __tablename__ = "users"
    organization_id = ref()
    external_id = sc(100, nullable=True)
    employee_no = sc(50, nullable=True)
    email = mapped_column(String, unique=True, index=True, nullable=True)
    password_hash = mapped_column(String, nullable=True)  # local login fallback until Entra ID
    full_name = mapped_column(String)
    job_title = sc(150, nullable=True)
    grade = sc(30, nullable=True)
    joined_on = mapped_column(Date, nullable=True)
    primary_org_unit_id = ref()
    manager_id = ref()
    pending_manager_email = sc(200, nullable=True)  # manager named at sign-up who has no account yet; linked when they join
    function_name = sc(150, nullable=True)          # typed at sign-up when the function is not in the list
    department_name = sc(150, nullable=True)        # typed at sign-up when the department is not in the list
    phone = sc(30, nullable=True)
    locale = sc(10, default="en")
    has_corporate_login = flag(True)
    is_active = flag(True)
    last_login_at = ts()
    # ProjectFlow single sign-on. Kept here only: nothing is ever written to ProjectFlow.
    projectflow_user_id = integer()                 # ProjectFlow users.id; NULL for people who signed up on the Hub
    is_projectflow_native = flag(False)             # True when the account was created by a ProjectFlow sign-on
    projectflow_role = sc(40, nullable=True)        # role in ProjectFlow at the last sign-on (e.g. "dmd")
    sso_roles = json_col(list)                      # Hub roles the sign-on granted, so a demotion removes only those


class SsoTokenUse(Base, StdColumns):
    """Each ProjectFlow sign-on token works once. Its id (jti) is kept until it would have expired anyway."""
    __tablename__ = "sso_token_uses"
    jti = sc(64, unique=True)
    projectflow_user_id = integer()
    expires_at = ts()


class Role(Base, StdColumns):
    """Fixed list, seeded. Roles can be assigned but never created or renamed from the UI."""
    __tablename__ = "roles"
    code = sc(40, unique=True)
    hierarchy_level = integer(9)
    sees_all_submissions = flag(False)
    name_i18n = i18n()
    description = text()
    is_system = flag(True)
    is_assignable = flag(True)


class Permission(Base, StdColumns):
    __tablename__ = "permissions"
    code = sc(80, unique=True)
    module = sc(40)
    description = text()


class RolePermission(Base, StdColumns):
    __tablename__ = "role_permissions"
    role_id = ref(False)
    permission_id = ref(False)


class UserInvitation(Base, StdColumns):
    """Invitation to sign up with a privileged role (Judge, Program Owner, ...). Only the token hash is stored."""
    __tablename__ = "user_invitations"
    email = mapped_column(String, index=True)
    full_name = sc(200, nullable=True)
    role_codes = json_col(list)
    token_hash = sc(64, unique=True)
    message = text()
    invited_by = ref()
    expires_at = ts()
    status = sc(20, default="PENDING")  # PENDING, ACCEPTED, REVOKED, EXPIRED
    accepted_user_id = ref()
    accepted_at = ts()


class UserRoleAssignment(Base, StdColumns):
    __tablename__ = "user_role_assignments"
    user_id = ref(False)
    role_id = ref(False)
    scope_type = sc(30, default="GLOBAL")  # GLOBAL, ORG_UNIT, CHALLENGE, PANEL
    scope_id = ref()
    include_children = flag(True)
    valid_from = ts()
    valid_to = ts()
    granted_by = ref()
