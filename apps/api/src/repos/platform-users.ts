/**
 * 平台员工账号和会话的数据访问。平台表不带 tenant_id，只在 withPlatformTx 里调用。
 * 对外返回的 PlatformUser 不含密码哈希和邀请令牌哈希；需要它们的查询单独返回。
 */
import type { AccountStatus, PlatformDataScope } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  /** 角色键：内置角色（`PlatformRole`）或自建角色（`custom_…`，ADR 0030） */
  role: string;
  /** 角色的名字（自建角色的名字前端不认识，跟账号一起返回） */
  roleName: string;
  status: AccountStatus;
  /** 正在用临时密码，必须先修改密码（ADR 0013）。只给本人看，不进账号列表的返回 */
  mustChangePassword: boolean;
  /** 两步验证绑定的时间；没绑定为 null（ADR 0030） */
  totpEnabledAt: Date | null;
  /** 员工自己的 IP 白名单（规范写法的 CIDR）；空 = 按角色的 */
  ipAllowlist: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface PlatformUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  role_name: string;
  status: AccountStatus;
  must_change_password: boolean;
  totp_enabled_at: Date | null;
  ip_allowlist: string[];
  created_at: Date;
  updated_at: Date;
}

/** 账号的列（`platform_users` 不带别名时用；`returning` 里也能用）。角色名用子查询带出来。 */
const COLUMNS =
  "id, email, name, role, (select r.name from platform_roles r where r.key = platform_users.role) as role_name, status, must_change_password, totp_enabled_at, ip_allowlist, created_at, updated_at";

function toUser(row: PlatformUserRow): PlatformUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    roleName: row.role_name,
    status: row.status,
    mustChangePassword: row.must_change_password,
    totpEnabledAt: row.totp_enabled_at,
    ipAllowlist: row.ip_allowlist,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PlatformUserSecrets {
  user: PlatformUser;
  passwordHash: string | null;
  inviteExpiresAt: Date | null;
  resetExpiresAt: Date | null;
  /** 加密后的 TOTP 密钥（ADR 0030）；没绑定为 null */
  totpSecret: string | null;
  totpLastStep: number | null;
  totpPendingSecret: string | null;
  totpPendingExpiresAt: Date | null;
  /** 角色的 IP 白名单（员工自己的为空时生效） */
  roleIpAllowlist: string[];
}

type SecretsRow = PlatformUserRow & {
  password_hash: string | null;
  invite_expires_at: Date | null;
  reset_expires_at: Date | null;
  totp_secret: string | null;
  totp_last_step: string | null;
  totp_pending_secret: string | null;
  totp_pending_expires_at: Date | null;
  role_ip_allowlist: string[];
};

const SECRET_COLUMNS = `${COLUMNS}, password_hash, invite_expires_at, reset_expires_at, totp_secret, totp_last_step, totp_pending_secret, totp_pending_expires_at,
  (select r.ip_allowlist from platform_roles r where r.key = platform_users.role) as role_ip_allowlist`;

function toSecrets(row: SecretsRow | undefined): PlatformUserSecrets | null {
  if (!row) return null;
  return {
    user: toUser(row),
    passwordHash: row.password_hash,
    inviteExpiresAt: row.invite_expires_at,
    resetExpiresAt: row.reset_expires_at,
    totpSecret: row.totp_secret,
    totpLastStep: row.totp_last_step === null ? null : Number(row.totp_last_step),
    totpPendingSecret: row.totp_pending_secret,
    totpPendingExpiresAt: row.totp_pending_expires_at,
    roleIpAllowlist: row.role_ip_allowlist,
  };
}

/** 按邮箱取账号。`lock` 为真时锁住这一行直到事务结束（重发邀请前用，避免和「接受邀请」交错）。 */
export async function findPlatformUserByEmail(
  db: Db,
  email: string,
  options: { lock: boolean } = { lock: false },
): Promise<PlatformUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS} from platform_users where email = $1 ${options.lock ? "for update" : ""}`,
    [email],
  );
  return toSecrets(result.rows[0]);
}

/** 按编号取账号并锁住这一行，直到事务结束（改状态前用）。 */
export async function lockPlatformUser(db: Db, id: string): Promise<PlatformUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS} from platform_users where id = $1 for update`,
    [id],
  );
  return toSecrets(result.rows[0]);
}

/** 按编号取账号（不加锁）。 */
export async function findPlatformUser(db: Db, id: string): Promise<PlatformUserSecrets | null> {
  const result = await db.query<SecretsRow>(`select ${SECRET_COLUMNS} from platform_users where id = $1`, [id]);
  return toSecrets(result.rows[0]);
}

export async function findPlatformUserByInviteToken(db: Db, tokenHash: string): Promise<PlatformUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS} from platform_users where invite_token_hash = $1`,
    [tokenHash],
  );
  return toSecrets(result.rows[0]);
}

export async function listPlatformUsers(db: Db, limit: number, after: TimeCursor | null): Promise<Page<PlatformUser>> {
  const result = await db.query<PlatformUserRow & { cursor_time: string }>(
    `select ${COLUMNS}, created_at::text as cursor_time
       from platform_users
      where $1::timestamptz is null or (created_at, id) > ($1::timestamptz, $2::uuid)
      order by created_at, id
      limit $3`,
    [after?.t ?? null, after?.id ?? null, limit + 1],
  );
  return toPage(result.rows, limit, toUser, (row) => ({ t: row.cursor_time, id: row.id }));
}

export interface NewInvitedPlatformUser {
  email: string;
  name: string;
  role: string;
  inviteTokenHash: string;
  inviteExpiresAt: Date;
}

export async function insertInvitedPlatformUser(db: Db, input: NewInvitedPlatformUser, now: Date): Promise<PlatformUser> {
  const result = await db.query<PlatformUserRow>(
    `insert into platform_users (email, name, role, status, invite_token_hash, invite_expires_at, created_at, updated_at)
     values ($1, $2, $3, 'invited', $4, $5, $6, $6)
     returning ${COLUMNS}`,
    [input.email, input.name, input.role, input.inviteTokenHash, input.inviteExpiresAt, now],
  );
  return toUser(result.rows[0] as PlatformUserRow);
}

/**
 * 给一个从未激活过的账号重新发邀请：换令牌，姓名和角色按本次请求更新，状态回到待激活。
 * 账号在这期间已经被激活（设了密码）时不做任何改动，返回 null。
 */
export async function reissuePlatformInvite(db: Db, id: string, input: NewInvitedPlatformUser, now: Date): Promise<PlatformUser | null> {
  const result = await db.query<PlatformUserRow>(
    `update platform_users
        set name = $2, role = $3, status = 'invited', invite_token_hash = $4, invite_expires_at = $5, updated_at = $6
      where id = $1 and password_hash is null
      returning ${COLUMNS}`,
    [id, input.name, input.role, input.inviteTokenHash, input.inviteExpiresAt, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export interface NewActivePlatformUser {
  email: string;
  name: string;
  role: "super_admin";
  passwordHash: string;
  /** 这个密码是不是临时密码（第一次登录必须改掉） */
  mustChangePassword: boolean;
}

/** 直接创建一个在用的账号（只有命令行创建超级管理员时用）。 */
export async function insertActivePlatformUser(db: Db, input: NewActivePlatformUser, now: Date): Promise<PlatformUser> {
  const result = await db.query<PlatformUserRow>(
    `insert into platform_users (email, name, role, status, password_hash, must_change_password, created_at, updated_at)
     values ($1, $2, $3, 'active', $4, $5, $6, $6)
     returning ${COLUMNS}`,
    [input.email, input.name, input.role, input.passwordHash, input.mustChangePassword, now],
  );
  return toUser(result.rows[0] as PlatformUserRow);
}

/**
 * 凭邀请令牌激活：写入密码、作废令牌。密码是本人自己设的，所以不是临时密码。只有「待激活且令牌没过期」的账号会被更新；
 * 令牌已被用掉或已过期时返回 null（并发提交同一个令牌，只有一个成功）。
 */
export async function activatePlatformUser(db: Db, tokenHash: string, passwordHash: string, now: Date): Promise<PlatformUser | null> {
  const result = await db.query<PlatformUserRow>(
    `update platform_users
        set status = 'active', password_hash = $2, must_change_password = false,
            invite_token_hash = null, invite_expires_at = null, updated_at = $3
      where invite_token_hash = $1 and status = 'invited' and invite_expires_at > $3
      returning ${COLUMNS}`,
    [tokenHash, passwordHash, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** 改状态。同时作废还没用掉的邀请令牌和重置令牌。 */
export async function setPlatformUserStatus(db: Db, id: string, status: "active" | "disabled", now: Date): Promise<PlatformUser> {
  const result = await db.query<PlatformUserRow>(
    `update platform_users
        set status = $2, invite_token_hash = null, invite_expires_at = null,
            reset_token_hash = null, reset_expires_at = null, updated_at = $3
      where id = $1
      returning ${COLUMNS}`,
    [id, status, now],
  );
  return toUser(result.rows[0] as PlatformUserRow);
}

/** 改员工的角色、姓名、IP 白名单（超级管理员在后台操作）。 */
export async function updatePlatformUserProfile(db: Db, id: string, change: { name: string; role: string; ipAllowlist: readonly string[] }, now: Date): Promise<PlatformUser> {
  const result = await db.query<PlatformUserRow>(
    `update platform_users set name = $2, role = $3, ip_allowlist = $4, updated_at = $5 where id = $1 returning ${COLUMNS}`,
    [id, change.name, change.role, change.ipAllowlist, now],
  );
  return toUser(result.rows[0] as PlatformUserRow);
}

/** 清空员工自己的 IP 白名单（命令行救急用）。 */
export async function clearPlatformUserAllowlist(db: Db, id: string, now: Date): Promise<void> {
  await db.query("update platform_users set ip_allowlist = '{}', updated_at = $2 where id = $1", [id, now]);
}

/** 用某个角色的账号数（含待激活、已停用：它们都还指着这个角色）。 */
export async function countPlatformUsersWithRole(db: Db, role: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from platform_users where role = $1", [role]);
  return result.rows[0]?.n ?? 0;
}

// ---- 两步验证（ADR 0030） ----

/** 记下正在绑定的新密钥（覆盖之前没确认的）。不动已经生效的密钥。 */
export async function setPendingTotp(db: Db, id: string, sealedSecret: string, expiresAt: Date): Promise<void> {
  await db.query("update platform_users set totp_pending_secret = $2, totp_pending_expires_at = $3 where id = $1", [id, sealedSecret, expiresAt]);
}

/** 确认绑定：新密钥生效、记下这次用掉的时间窗、清掉待确认的。 */
export async function activatePendingTotp(db: Db, id: string, sealedSecret: string, step: number, now: Date): Promise<void> {
  await db.query(
    `update platform_users
        set totp_secret = $2, totp_enabled_at = $4, totp_last_step = $3, totp_pending_secret = null, totp_pending_expires_at = null, updated_at = $4
      where id = $1`,
    [id, sealedSecret, step, now],
  );
}

/**
 * 记下这次接受的时间窗。只有比上次的更晚才写（并发的两次验证用同一个码，只有一次成功）；返回是否写成功。
 * `expectedSecret`：验证用的是这把密钥；这期间换过或被重置了就不算。
 */
export async function claimTotpStep(db: Db, id: string, expectedSecret: string, step: number): Promise<boolean> {
  const result = await db.query(
    "update platform_users set totp_last_step = $3 where id = $1 and totp_secret = $2 and (totp_last_step is null or totp_last_step < $3)",
    [id, expectedSecret, step],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 清掉两步验证（重置）：密钥、待确认的密钥、时间窗、全部恢复码。下次登录要重新绑定。 */
export async function clearPlatformTotp(db: Db, id: string, now: Date): Promise<void> {
  await db.query(
    `update platform_users
        set totp_secret = null, totp_enabled_at = null, totp_last_step = null, totp_pending_secret = null, totp_pending_expires_at = null, updated_at = $2
      where id = $1`,
    [id, now],
  );
  await db.query("delete from platform_recovery_codes where user_id = $1", [id]);
}

/** 整组换掉恢复码（只存哈希）。 */
export async function replaceRecoveryCodes(db: Db, userId: string, codeHashes: readonly string[], now: Date): Promise<void> {
  await db.query("delete from platform_recovery_codes where user_id = $1", [userId]);
  await db.query(
    "insert into platform_recovery_codes (user_id, code_hash, created_at) select $1, h, $3 from unnest($2::text[]) as h",
    [userId, codeHashes, now],
  );
}

/** 用掉一个恢复码：没用过的才算；返回是否用成功（并发的两次只有一次成功）。 */
export async function useRecoveryCode(db: Db, userId: string, codeHash: string, now: Date): Promise<boolean> {
  const result = await db.query(
    "update platform_recovery_codes set used_at = $3 where user_id = $1 and code_hash = $2 and used_at is null",
    [userId, codeHash, now],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countUnusedRecoveryCodes(db: Db, userId: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from platform_recovery_codes where user_id = $1 and used_at is null", [userId]);
  return result.rows[0]?.n ?? 0;
}

/** 在用的超级管理员数量；同时锁住这些行，防止两个请求同时把彼此停用。 */
export async function countActiveSuperAdminsForUpdate(db: Db): Promise<number> {
  const result = await db.query(
    "select id from platform_users where role = 'super_admin' and status = 'active' order by id for update",
  );
  return result.rows.length;
}

export interface PlatformSession {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

/** 建一个会话。新会话都是「待验证」的（还没做两步验证，ADR 0030）；顺手清掉这个账号过期的会话。 */
export async function insertPlatformSession(db: Db, session: PlatformSession): Promise<void> {
  await db.query("insert into platform_sessions (id, user_id, created_at, expires_at) values ($1, $2, $3, $4)", [
    session.id,
    session.userId,
    session.createdAt,
    session.expiresAt,
  ]);
  await db.query("delete from platform_sessions where user_id = $1 and expires_at <= $2", [
    session.userId,
    session.createdAt,
  ]);
}

export type MfaMethod = "totp" | "recovery_code" | "enrollment";

/**
 * 会话完成两步验证：记下时间和方式，过期时间改成令牌本身的过期时间（登录起 8 小时）。
 * 只改还是「待验证」、没过期的会话；返回是否改到了（并发的两次验证只有一次算数）。
 */
export async function markPlatformSessionVerified(db: Db, sessionId: string, method: MfaMethod, expiresAt: Date, now: Date): Promise<boolean> {
  const result = await db.query(
    "update platform_sessions set mfa_verified_at = $2, mfa_method = $3, expires_at = $4 where id = $1 and mfa_verified_at is null and expires_at > $2",
    [sessionId, now, method, expiresAt],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 一个已登录请求需要知道的全部：账号、会话的两步验证状态、角色给的权限和数据范围、两份 IP 白名单。一条查询。 */
export interface PlatformSessionUser {
  user: PlatformUser;
  sessionVerified: boolean;
  enrolled: boolean;
  role: { key: string; builtin: boolean; grants: string[] | null; scope: PlatformDataScope; ipAllowlist: string[] };
}

type SessionUserRow = PlatformUserRow & {
  mfa_verified_at: Date | null;
  enrolled: boolean;
  role_builtin: boolean;
  role_grants: string[] | null;
  scope_city_ids: string[] | null;
  scope_channel_ids: string[] | null;
  role_ip_allowlist: string[];
};

/** 会话还有效（存在、没过期）时返回它的账号和角色；账号状态由调用方判断。 */
export async function findPlatformSessionUser(db: Db, sessionId: string, userId: string, now: Date): Promise<PlatformSessionUser | null> {
  const result = await db.query<SessionUserRow>(
    `select u.id, u.email, u.name, u.role, r.name as role_name, u.status, u.must_change_password, u.totp_enabled_at, u.ip_allowlist,
            u.created_at, u.updated_at, s.mfa_verified_at, (u.totp_secret is not null) as enrolled,
            r.builtin as role_builtin, r.grants as role_grants, r.scope_city_ids, r.scope_channel_ids, r.ip_allowlist as role_ip_allowlist
       from platform_sessions s
       join platform_users u on u.id = s.user_id
       join platform_roles r on r.key = u.role
      where s.id = $1 and s.user_id = $2 and s.expires_at > $3`,
    [sessionId, userId, now],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    user: toUser(row),
    sessionVerified: row.mfa_verified_at !== null,
    enrolled: row.enrolled,
    role: {
      key: row.role,
      builtin: row.role_builtin,
      grants: row.role_grants,
      scope: { cityIds: row.scope_city_ids, channelIds: row.scope_channel_ids },
      ipAllowlist: row.role_ip_allowlist,
    },
  };
}

export async function deletePlatformSession(db: Db, sessionId: string): Promise<void> {
  await db.query("delete from platform_sessions where id = $1", [sessionId]);
}

export async function deletePlatformSessionsOfUser(db: Db, userId: string): Promise<void> {
  await db.query("delete from platform_sessions where user_id = $1", [userId]);
}

/** 退出除当前会话以外的全部会话（自己改密码后用）。 */
export async function deleteOtherPlatformSessions(db: Db, userId: string, keepSessionId: string): Promise<void> {
  await db.query("delete from platform_sessions where user_id = $1 and id <> $2", [userId, keepSessionId]);
}

/**
 * 换密码。还没用掉的重置令牌同时作废。
 * `mustChangePassword`：新密码是不是临时密码。本人自己改密码时是 false（同时清掉之前的标记）；
 * 命令行生成临时密码时是 true。每个调用方都要明确写出来，没有默认值。
 */
export async function setPlatformUserPassword(
  db: Db,
  id: string,
  passwordHash: string,
  mustChangePassword: boolean,
  now: Date,
): Promise<void> {
  await db.query(
    `update platform_users
        set password_hash = $2, must_change_password = $3, reset_token_hash = null, reset_expires_at = null, updated_at = $4
      where id = $1`,
    [id, passwordHash, mustChangePassword, now],
  );
}

/** 记下一个新的重置令牌（覆盖之前没用掉的）。不动现有密码。 */
export async function setPlatformResetToken(db: Db, id: string, tokenHash: string, expiresAt: Date, now: Date): Promise<void> {
  await db.query("update platform_users set reset_token_hash = $2, reset_expires_at = $3, updated_at = $4 where id = $1", [
    id,
    tokenHash,
    expiresAt,
    now,
  ]);
}

export async function findPlatformUserByResetToken(db: Db, tokenHash: string): Promise<PlatformUserSecrets | null> {
  const result = await db.query<SecretsRow>(`select ${SECRET_COLUMNS} from platform_users where reset_token_hash = $1`, [
    tokenHash,
  ]);
  return toSecrets(result.rows[0]);
}

/**
 * 凭重置令牌换密码、作废令牌。密码是本人自己设的，所以不是临时密码。只有「在用且令牌没过期」的账号会被更新；
 * 令牌已被用掉或已过期时返回 null（并发提交同一个令牌，只有一个成功）。
 */
export async function resetPlatformUserPassword(db: Db, tokenHash: string, passwordHash: string, now: Date): Promise<PlatformUser | null> {
  const result = await db.query<PlatformUserRow>(
    `update platform_users
        set password_hash = $2, must_change_password = false, reset_token_hash = null, reset_expires_at = null, updated_at = $3
      where reset_token_hash = $1 and status = 'active' and reset_expires_at > $3
      returning ${COLUMNS}`,
    [tokenHash, passwordHash, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}
