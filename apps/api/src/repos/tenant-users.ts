/**
 * 租户用户和租户会话的数据访问（ADR 0003）。
 *
 * - 每个函数都显式接收 `tenantId`，每条 SQL 都带 `tenant_id = …` 条件。
 * - 租户请求在 withTenantTx 里调用它们（行级安全是第二道防线）；
 *   平台员工替租户操作（创建租户时邀请管理员、给管理员发重置令牌）在 withPlatformTx 里调用，条件同样带租户。
 * - 只有文件末尾的两个 `…AcrossTenants` 函数不带租户条件：登录时只有邮箱、接受邀请时只有令牌，
 *   它们只返回「是哪个租户的哪个用户」，后续操作仍回到租户事务里做。
 * - 对外返回的 TenantUser 不含密码哈希和邀请令牌哈希。
 */
import type { AccountStatus, TenantRole } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export interface TenantUser {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: TenantRole;
  status: AccountStatus;
  /** 必须先修改密码（ADR 0013）。只给本人看，不进账号列表的返回 */
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface TenantUserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  role: TenantRole;
  status: AccountStatus;
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, tenant_id, email, name, role, status, must_change_password, created_at, updated_at";

function toUser(row: TenantUserRow): TenantUser {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface TenantUserSecrets {
  user: TenantUser;
  passwordHash: string | null;
  inviteExpiresAt: Date | null;
  resetExpiresAt: Date | null;
}

type SecretsRow = TenantUserRow & {
  password_hash: string | null;
  invite_expires_at: Date | null;
  reset_expires_at: Date | null;
};

const SECRET_COLUMNS = `${COLUMNS}, password_hash, invite_expires_at, reset_expires_at`;

function toSecrets(row: SecretsRow | undefined): TenantUserSecrets | null {
  if (!row) return null;
  return {
    user: toUser(row),
    passwordHash: row.password_hash,
    inviteExpiresAt: row.invite_expires_at,
    resetExpiresAt: row.reset_expires_at,
  };
}

export async function findTenantUserSecrets(db: Db, tenantId: string, userId: string): Promise<TenantUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS} from tenant_users where tenant_id = $1 and id = $2`,
    [tenantId, userId],
  );
  return toSecrets(result.rows[0]);
}

/** 按编号取用户并锁住这一行，直到事务结束（改角色、改状态前用）。 */
export async function lockTenantUser(db: Db, tenantId: string, userId: string): Promise<TenantUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS}
       from tenant_users
      where tenant_id = $1 and id = $2
        for update`,
    [tenantId, userId],
  );
  return toSecrets(result.rows[0]);
}

/** 按邮箱取本租户的用户。`lock` 为真时锁住这一行直到事务结束（重发邀请前用，避免和「接受邀请」交错）。 */
export async function findTenantUserByEmail(
  db: Db,
  tenantId: string,
  email: string,
  options: { lock: boolean } = { lock: false },
): Promise<TenantUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS}
       from tenant_users
      where tenant_id = $1 and email = $2
        ${options.lock ? "for update" : ""}`,
    [tenantId, email],
  );
  return toSecrets(result.rows[0]);
}

export async function listTenantUsers(db: Db, tenantId: string, limit: number, after: TimeCursor | null): Promise<Page<TenantUser>> {
  const result = await db.query<TenantUserRow & { cursor_time: string }>(
    `select ${COLUMNS}, created_at::text as cursor_time
       from tenant_users
      where tenant_id = $1
        and ($2::timestamptz is null or (created_at, id) > ($2::timestamptz, $3::uuid))
      order by created_at, id
      limit $4`,
    [tenantId, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  return toPage(result.rows, limit, toUser, (row) => ({ t: row.cursor_time, id: row.id }));
}

export interface NewInvitedTenantUser {
  email: string;
  name: string;
  role: TenantRole;
  inviteTokenHash: string;
  inviteExpiresAt: Date;
}

export async function insertInvitedTenantUser(db: Db, tenantId: string, input: NewInvitedTenantUser, now: Date): Promise<TenantUser> {
  const result = await db.query<TenantUserRow>(
    `insert into tenant_users
       (tenant_id, email, name, role, status, invite_token_hash, invite_expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'invited', $5, $6, $7, $7)
     returning ${COLUMNS}`,
    [tenantId, input.email, input.name, input.role, input.inviteTokenHash, input.inviteExpiresAt, now],
  );
  return toUser(result.rows[0] as TenantUserRow);
}

/**
 * 给一个从未激活过的用户重新发邀请：换令牌，姓名和角色按本次请求更新，状态回到待激活。
 * 用户在这期间已经被激活（设了密码）时不做任何改动，返回 null。
 */
export async function reissueTenantInvite(
  db: Db,
  tenantId: string,
  userId: string,
  input: NewInvitedTenantUser,
  now: Date,
): Promise<TenantUser | null> {
  const result = await db.query<TenantUserRow>(
    `update tenant_users
        set name = $3, role = $4, status = 'invited', invite_token_hash = $5, invite_expires_at = $6, updated_at = $7
      where tenant_id = $1 and id = $2 and password_hash is null
      returning ${COLUMNS}`,
    [tenantId, userId, input.name, input.role, input.inviteTokenHash, input.inviteExpiresAt, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/**
 * 凭邀请令牌激活：写入密码、作废令牌。密码是本人自己设的，所以不是临时密码。只有「待激活且令牌没过期」的用户会被更新；
 * 令牌已被用掉或已过期时返回 null（并发提交同一个令牌，只有一个成功）。
 */
export async function activateTenantUser(
  db: Db,
  tenantId: string,
  tokenHash: string,
  passwordHash: string,
  now: Date,
): Promise<TenantUser | null> {
  const result = await db.query<TenantUserRow>(
    `update tenant_users
        set status = 'active', password_hash = $3, must_change_password = false,
            invite_token_hash = null, invite_expires_at = null, updated_at = $4
      where tenant_id = $1 and invite_token_hash = $2 and status = 'invited' and invite_expires_at > $4
      returning ${COLUMNS}`,
    [tenantId, tokenHash, passwordHash, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export interface TenantUserChanges {
  name: string;
  role: TenantRole;
  status: AccountStatus;
}

/** 整体替换姓名、角色、状态。状态变成停用时同时作废还没用掉的邀请令牌和重置令牌。 */
export async function updateTenantUser(
  db: Db,
  tenantId: string,
  userId: string,
  changes: TenantUserChanges,
  now: Date,
): Promise<TenantUser> {
  const result = await db.query<TenantUserRow>(
    `update tenant_users
        set name = $3, role = $4, status = $5, updated_at = $6,
            invite_token_hash = case when $5 = 'disabled' then null else invite_token_hash end,
            invite_expires_at = case when $5 = 'disabled' then null else invite_expires_at end,
            reset_token_hash = case when $5 = 'disabled' then null else reset_token_hash end,
            reset_expires_at = case when $5 = 'disabled' then null else reset_expires_at end
      where tenant_id = $1 and id = $2
      returning ${COLUMNS}`,
    [tenantId, userId, changes.name, changes.role, changes.status, now],
  );
  return toUser(result.rows[0] as TenantUserRow);
}

/** 本租户在用的管理员数量；同时锁住这些行，防止两个管理员同时把彼此降级或停用。 */
export async function countActiveAdminsForUpdate(db: Db, tenantId: string): Promise<number> {
  const result = await db.query(
    `select id from tenant_users
      where tenant_id = $1 and role = 'admin' and status = 'active'
      order by id
        for update`,
    [tenantId],
  );
  return result.rows.length;
}

export interface TenantSession {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function insertTenantSession(db: Db, tenantId: string, session: TenantSession): Promise<void> {
  await db.query(
    "insert into tenant_sessions (tenant_id, id, user_id, created_at, expires_at) values ($1, $2, $3, $4, $5)",
    [tenantId, session.id, session.userId, session.createdAt, session.expiresAt],
  );
  await db.query("delete from tenant_sessions where tenant_id = $1 and user_id = $2 and expires_at <= $3", [
    tenantId,
    session.userId,
    session.createdAt,
  ]);
}

/** 会话还有效（存在、没过期）时返回它的用户；用户和租户的状态由调用方判断。 */
export async function findTenantSessionUser(
  db: Db,
  tenantId: string,
  sessionId: string,
  userId: string,
  now: Date,
): Promise<TenantUser | null> {
  const result = await db.query<TenantUserRow>(
    `select u.id, u.tenant_id, u.email, u.name, u.role, u.status, u.must_change_password, u.created_at, u.updated_at
       from tenant_sessions s
       join tenant_users u on u.tenant_id = s.tenant_id and u.id = s.user_id
      where s.tenant_id = $1 and s.id = $2 and s.user_id = $3 and s.expires_at > $4`,
    [tenantId, sessionId, userId, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function deleteTenantSession(db: Db, tenantId: string, sessionId: string): Promise<void> {
  await db.query("delete from tenant_sessions where tenant_id = $1 and id = $2", [tenantId, sessionId]);
}

export async function deleteTenantSessionsOfUser(db: Db, tenantId: string, userId: string): Promise<void> {
  await db.query("delete from tenant_sessions where tenant_id = $1 and user_id = $2", [tenantId, userId]);
}

/** 退出除当前会话以外的全部会话（自己改密码后用）。 */
export async function deleteOtherTenantSessions(db: Db, tenantId: string, userId: string, keepSessionId: string): Promise<void> {
  await db.query("delete from tenant_sessions where tenant_id = $1 and user_id = $2 and id <> $3", [
    tenantId,
    userId,
    keepSessionId,
  ]);
}

/**
 * 本人换密码。还没用掉的重置令牌同时作废；「必须先修改密码」的标记同时清掉
 * （租户用户没有生成临时密码的途径，所以这里没有把标记置为 true 的参数）。
 */
export async function setTenantUserPassword(db: Db, tenantId: string, userId: string, passwordHash: string, now: Date): Promise<void> {
  await db.query(
    `update tenant_users
        set password_hash = $3, must_change_password = false, reset_token_hash = null, reset_expires_at = null, updated_at = $4
      where tenant_id = $1 and id = $2`,
    [tenantId, userId, passwordHash, now],
  );
}

/** 记下一个新的重置令牌（覆盖之前没用掉的）。不动现有密码。 */
export async function setTenantResetToken(
  db: Db,
  tenantId: string,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
  now: Date,
): Promise<void> {
  await db.query(
    `update tenant_users
        set reset_token_hash = $3, reset_expires_at = $4, updated_at = $5
      where tenant_id = $1 and id = $2`,
    [tenantId, userId, tokenHash, expiresAt, now],
  );
}

export async function findTenantUserByResetToken(db: Db, tenantId: string, tokenHash: string): Promise<TenantUserSecrets | null> {
  const result = await db.query<SecretsRow>(
    `select ${SECRET_COLUMNS} from tenant_users where tenant_id = $1 and reset_token_hash = $2`,
    [tenantId, tokenHash],
  );
  return toSecrets(result.rows[0]);
}

/**
 * 凭重置令牌换密码、作废令牌。密码是本人自己设的，所以不是临时密码。只有「在用且令牌没过期」的用户会被更新；
 * 令牌已被用掉或已过期时返回 null（并发提交同一个令牌，只有一个成功）。
 */
export async function resetTenantUserPassword(
  db: Db,
  tenantId: string,
  tokenHash: string,
  passwordHash: string,
  now: Date,
): Promise<TenantUser | null> {
  const result = await db.query<TenantUserRow>(
    `update tenant_users
        set password_hash = $3, must_change_password = false, reset_token_hash = null, reset_expires_at = null, updated_at = $4
      where tenant_id = $1 and reset_token_hash = $2 and status = 'active' and reset_expires_at > $4
      returning ${COLUMNS}`,
    [tenantId, tokenHash, passwordHash, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

/** 用户在哪个租户：登录前的定位结果，不含任何账号信息。 */
export interface TenantUserLocator {
  tenantId: string;
  userId: string;
}

/**
 * 登录时按邮箱定位用户（邮箱全平台唯一）。只在 withPreAuthTx 里调用：
 * 登录前的角色读不了 tenant_users，只能调用这个数据库函数（迁移 0005），它只返回两个编号。
 */
export async function locateTenantUserByEmailAcrossTenants(db: Db, email: string): Promise<TenantUserLocator | null> {
  const result = await db.query<{ tenant_id: string; user_id: string }>(
    "select tenant_id, user_id from locate_tenant_user_by_email($1)",
    [email],
  );
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
}

/** 接受邀请时按令牌哈希定位用户。只在 withPreAuthTx 里调用，同样只经数据库函数返回两个编号。 */
export async function locateTenantUserByInviteTokenAcrossTenants(db: Db, tokenHash: string): Promise<TenantUserLocator | null> {
  const result = await db.query<{ tenant_id: string; user_id: string }>(
    "select tenant_id, user_id from locate_tenant_user_by_invite_token($1)",
    [tokenHash],
  );
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, userId: row.user_id } : null;
}
