/**
 * 登录相关接口的请求、响应类型。手写，与 `apps/api/openapi.yaml` 对账：
 * `contract.test.ts` 逐个核对路径、方法、字段名和枚举值，后端改了接口那里会失败。
 */
import type { AccountStatus, PlatformAction, TenantAction, TenantRole } from "@nozomi/domain";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  /** 角色键：内置角色（`PlatformRole`）或自建角色（`custom_…`，ADR 0030） */
  role: string;
  /** 角色的名字（自建角色的名字前端不认识） */
  role_name: string;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

/** 会话的两步验证状态（ADR 0030） */
export type SecondFactorStatus = "enrollment_required" | "verify_required" | "verified";

export interface TenantUser {
  id: string;
  email: string;
  name: string;
  role: TenantRole;
  status: AccountStatus;
  created_at: string;
  updated_at: string;
}

export type TenantStatus = "active" | "suspended";

export interface Tenant {
  id: string;
  name: string;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface PlatformLoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_at: string;
  user: PlatformUser;
  /** 正在用临时密码：除了改密码和退出，别的都做不了（ADR 0013） */
  must_change_password: boolean;
  /** 密码对了之后的第二步：先绑定，或输入动态码（ADR 0030） */
  second_factor: { status: Exclude<SecondFactorStatus, "verified"> };
}

export interface TenantLoginResponse {
  access_token: string;
  token_type: "Bearer";
  expires_at: string;
  user: TenantUser;
  tenant: Tenant;
  must_change_password: boolean;
}

export interface PlatformMe {
  user: PlatformUser;
  permissions: PlatformAction[];
  data_scope: { city_ids: string[] | null; channel_ids: string[] | null };
  must_change_password: boolean;
  second_factor: { status: SecondFactorStatus; enabled_at: string | null; recovery_codes_remaining: number | null };
}

export interface TenantMe {
  user: TenantUser;
  tenant: Tenant;
  permissions: TenantAction[];
  must_change_password: boolean;
}

/** 接受邀请、凭重置令牌设密码共用同一种请求体。 */
export interface SetPasswordRequest {
  token: string;
  password: string;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/** 两个后台各自的类型，按后台取用。 */
export interface PortalTypes {
  tenant: { user: TenantUser; login: TenantLoginResponse; me: TenantMe };
  platform: { user: PlatformUser; login: PlatformLoginResponse; me: PlatformMe };
}

/** 对账用：上面每个类型的字段名清单。`satisfies` 保证清单里没有类型上不存在的字段。 */
export const SCHEMA_FIELDS = {
  PlatformUser: ["id", "email", "name", "role", "role_name", "status", "created_at", "updated_at"],
  TenantUser: ["id", "email", "name", "role", "status", "created_at", "updated_at"],
  Tenant: ["id", "name", "status", "created_at", "updated_at"],
  LoginRequest: ["email", "password"],
  PlatformLoginResponse: ["access_token", "token_type", "expires_at", "user", "must_change_password", "second_factor"],
  TenantLoginResponse: ["access_token", "token_type", "expires_at", "user", "tenant", "must_change_password"],
  AcceptInviteRequest: ["token", "password"],
  ResetPasswordRequest: ["token", "password"],
  ChangePasswordRequest: ["current_password", "new_password"],
} as const satisfies { [Name in keyof MirroredSchemas]: readonly (keyof MirroredSchemas[Name])[] };

interface MirroredSchemas {
  PlatformUser: PlatformUser;
  TenantUser: TenantUser;
  Tenant: Tenant;
  LoginRequest: LoginRequest;
  PlatformLoginResponse: PlatformLoginResponse;
  TenantLoginResponse: TenantLoginResponse;
  AcceptInviteRequest: SetPasswordRequest;
  ResetPasswordRequest: SetPasswordRequest;
  ChangePasswordRequest: ChangePasswordRequest;
}

type UnlistedFields = {
  [Name in keyof MirroredSchemas]: Exclude<keyof MirroredSchemas[Name], (typeof SCHEMA_FIELDS)[Name][number]>;
}[keyof MirroredSchemas];

/** 类型上有、清单里漏写的字段会让这一行编译失败。 */
export const SCHEMA_FIELDS_ARE_COMPLETE: [UnlistedFields] extends [never] ? true : never = true;

/** 对账用：`auth/me` 响应的顶层字段（OpenAPI 里是内联定义，没有具名 schema）。 */
export const ME_FIELDS = {
  platform: ["user", "permissions", "data_scope", "must_change_password", "second_factor"],
  tenant: ["user", "tenant", "permissions", "must_change_password"],
} as const satisfies { [P in keyof PortalTypes]: readonly (keyof PortalTypes[P]["me"])[] };

/** 前端认识的租户状态；OpenAPI 新增状态时对账测试会失败，届时请美工定颜色和文案。 */
export const TENANT_STATUSES = ["active", "suspended"] as const satisfies readonly TenantStatus[];
