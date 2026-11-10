/**
 * 测试环境专用的 QA 测试供应商（M8-16，ADR 0077）：`pnpm qa:tenant-ensure` 背后的逻辑。
 *
 * - 全平台最多一家（`tenants.is_test_tenant`，部分唯一索引）；它从「申请中」开始，永远进不了试运营、正式、暂停
 *   （`assertTestTenantStaysOff` + 迁移 0300 的检查约束），所以商品不能上架、不参与官网和销售端比价，但区域、商品、价格、加价、导入、试算都能做。
 * - 可以重复运行：已经有了就只核对并报告，什么都不改；只有显式要求重设密码时才改那位管理员的密码（会话全部失效）。
 * - 只允许 staging（以及本机 local、CI 的 ci，测试用），production 拒绝。
 * - 密码只从调用方（命令行从标准输入或交互输入）传进来，只存哈希；审计里没有密码。审计记为「系统 / 命令行」。
 */
import type { AppEnv } from "@nozomi/config";
import { checkPasswordStrength } from "@nozomi/domain";
import { hashPassword } from "../auth/password.ts";
import { isUniqueViolation, withPlatformTx, withTenantTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type TenantUser,
  deleteTenantSessionsOfUser,
  findTenantUserByEmail,
  insertActiveTenantUser,
  lockTenantUser,
  setTenantUserPassword,
} from "../repos/tenant-users.ts";
import { type Tenant, findTestTenant, insertTestTenant } from "../repos/tenants.ts";
import { SYSTEM_ACTOR, accountValues } from "./audit.ts";
import { weakPassword } from "./errors.ts";
import { asEmailTaken } from "./tenant-users.ts";

export const QA_TENANT_NAME = "QA 测试供应商（验收专用）";
export const QA_TENANT_NAME_MARK = "QA 测试";
export const QA_ADMIN_DEFAULT_NAME = "QA 验收管理员";

/** 允许运行的环境：测试环境，以及本机和 CI（自动测试）。正式环境永远不建。 */
export const QA_TENANT_ENVS: readonly AppEnv[] = ["staging", "local", "ci"];

export function qaTenantAllowed(appEnv: AppEnv): boolean {
  return QA_TENANT_ENVS.includes(appEnv);
}

export interface QaTenantInput {
  /** 管理员邮箱（已转小写） */
  email: string;
  /** 管理员姓名：只在新建时用 */
  name: string;
  /** 新建或重设密码时必填；只核对时为 null */
  password: string | null;
  resetPassword: boolean;
}

export type QaTenantOutcome =
  | { kind: "created"; tenant: Tenant; admin: TenantUser }
  | { kind: "verified"; tenant: Tenant; admin: TenantUser; issues: string[] }
  | { kind: "password_reset"; tenant: Tenant; admin: TenantUser; issues: string[] };

/** 已经有 QA 测试供应商吗（命令行据此决定要不要读密码）。 */
export async function qaTenantExists(pool: Pool): Promise<boolean> {
  return (await withPlatformTx(pool, (db) => findTestTenant(db, { lock: false }))) !== null;
}

function cliOrigin(now: Date): AuditOrigin {
  return { occurredAt: now, actor: SYSTEM_ACTOR, ip: null, source: "cli" };
}

function passwordRequired(): AppError {
  return new AppError(400, "PASSWORD_REQUIRED", "需要密码：新建 QA 测试供应商或重设密码时要从标准输入给出密码");
}

/** 已有的 QA 测试供应商和它的管理员有没有哪里不能用来验收（只报告，不改）。 */
function verificationIssues(tenant: Tenant, admin: TenantUser, hasPassword: boolean): string[] {
  const issues: string[] = [];
  if (!tenant.name.includes(QA_TENANT_NAME_MARK)) issues.push(`供应商名称「${tenant.name}」里没有「${QA_TENANT_NAME_MARK}」字样（可能被运营改过）`);
  if (tenant.status === "terminated") issues.push("这家 QA 测试供应商已被清退：只能查看，不能再写入");
  if (admin.role !== "admin") issues.push(`这个邮箱的角色是 ${admin.role}，不是管理员`);
  if (admin.status !== "active") issues.push(`这个账号现在是 ${admin.status}（不是在用），登录不了`);
  if (!hasPassword) issues.push("这个账号还没有设置密码：加 --reset-password 并从标准输入给出密码");
  return issues;
}

/**
 * 建出或核对那一家 QA 测试供应商和它的管理员。
 * - 还没有：新建供应商（申请中、`is_test_tenant`）和一位在用的管理员（密码就是给的这个，不是临时密码）。
 * - 已经有、邮箱是它的用户：核对并报告；`resetPassword` 时重设这位管理员的密码并让他已有的登录全部失效。
 * - 已经有、邮箱不是它的用户：409 `QA_TENANT_EMAIL_MISMATCH`，什么都不改（不会再建第二家）。
 */
export async function ensureQaTenant(pool: Pool, input: QaTenantInput, now: Date): Promise<QaTenantOutcome> {
  let passwordHash: string | null = null;
  if (input.password !== null) {
    const issues = checkPasswordStrength(input.password, input.email);
    if (issues.length > 0) throw weakPassword(issues);
    passwordHash = await hashPassword(input.password);
  }
  let step: QaTenantOutcome | { kind: "reset"; tenant: Tenant; admin: TenantUser };
  try {
    step = await withPlatformTx(pool, async (db) => {
      const existing = await findTestTenant(db, { lock: true });
      if (existing === null) {
        if (passwordHash === null) throw passwordRequired();
        const origin = cliOrigin(now);
        const tenant = await insertTestTenant(db, QA_TENANT_NAME, now);
        await insertAuditLog(db, origin, {
          tenantId: tenant.id,
          resource: "tenant",
          resourceId: tenant.id,
          action: "create",
          before: null,
          after: { name: tenant.name, status: tenant.status, is_test_tenant: true },
        });
        const admin = await insertActiveTenantUser(db, tenant.id, { email: input.email, name: input.name, role: "admin", passwordHash }, now);
        await insertAuditLog(db, origin, {
          tenantId: tenant.id,
          resource: "tenant_user",
          resourceId: admin.id,
          action: "create",
          before: null,
          after: accountValues(admin),
        });
        return { kind: "created" as const, tenant, admin };
      }

      const found = await findTenantUserByEmail(db, existing.id, input.email);
      if (found === null) {
        const admins = await db.query<{ email: string }>("select email from tenant_users where tenant_id = $1 and role = 'admin' order by created_at, id", [existing.id]);
        throw new AppError(409, "QA_TENANT_EMAIL_MISMATCH", `已经有一家 QA 测试供应商「${existing.name}」，这个邮箱不是它的账号（它的管理员：${admins.rows.map((row) => row.email).join("、") || "无"}）。没有做任何改动`, {
          tenant_id: existing.id,
        });
      }
      if (!input.resetPassword) {
        return { kind: "verified" as const, tenant: existing, admin: found.user, issues: verificationIssues(existing, found.user, found.passwordHash !== null) };
      }
      return { kind: "reset" as const, tenant: existing, admin: found.user };
    });
  } catch (err) {
    if (isUniqueViolation(err, "tenants_one_test_tenant")) {
      throw new AppError(409, "QA_TENANT_RACE", "另一次运行刚刚建好了 QA 测试供应商：请重新运行一次（这次会只核对）");
    }
    throw asEmailTaken(err);
  }
  if (step.kind !== "reset") return step;

  // 重设密码在这个供应商自己的事务里做（会话表只有租户角色能删）；租户编号来自上面找到的那一家 QA 测试供应商
  if (passwordHash === null) throw passwordRequired();
  const { tenant, admin } = step;
  const hash = passwordHash;
  await withTenantTx(pool, tenant.id, async (db) => {
    const locked = await lockTenantUser(db, tenant.id, admin.id);
    if (locked === null || locked.user.status !== "active") {
      throw new AppError(409, "ACCOUNT_NOT_ACTIVE", `这个账号现在是 ${locked?.user.status ?? "不存在"}（不是在用），密码没有改动：请先在平台后台启用它`);
    }
    await setTenantUserPassword(db, tenant.id, admin.id, hash, now);
    await deleteTenantSessionsOfUser(db, tenant.id, admin.id);
    await insertAuditLog(db, cliOrigin(now), {
      tenantId: tenant.id,
      resource: "tenant_user",
      resourceId: admin.id,
      action: "reset_password",
      before: null,
      after: null,
    });
  });
  return { kind: "password_reset", tenant, admin, issues: verificationIssues(tenant, admin, true) };
}
