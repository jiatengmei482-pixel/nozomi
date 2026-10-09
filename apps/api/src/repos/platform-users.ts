/**
 * 平台员工账号和会话的数据访问。平台表不带 tenant_id，只在 withPlatformTx 里调用。
 * 对外返回的 PlatformUser 不含密码哈希和邀请令牌哈希；需要它们的查询单独返回。
 */
import type { AccountStatus, PlatformRole } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  status: AccountStatus;
  /** 正在用临时密码，必须先修改密码（ADR 0013）。只给本人看，不进账号列表的返回 */
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PlatformUserRow {
  id: string;
  email: string;
  name: string;
  role: PlatformRole;
  status: AccountStatus;
  must_change_password: boolean;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, email, name, role, status, must_change_password, created_at, updated_at";

function toUser(row: PlatformUserRow): PlatformUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PlatformUserSecrets {
  user: PlatformUser;
  passwordHash: string | null;
  inviteExpiresAt: Date | null;
  resetExpiresAt: Date | null;
}

type SecretsRow = PlatformUserRow & {
  password_hash: string | null;
  invite_expires_at: Date | null;
  reset_expires_at: Date | null;
};

const SECRET_COLUMNS = `${COLUMNS}, password_hash, invite_expires_at, reset_expires_at`;

function toSecrets(row: SecretsRow | undefined): PlatformUserSecrets | null {
  if (!row) return null;
  return {
    user: toUser(row),
    passwordHash: row.password_hash,
    inviteExpiresAt: row.invite_expires_at,
    resetExpiresAt: row.reset_expires_at,
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
  role: PlatformRole;
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
  role: PlatformRole;
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

/** 会话还有效（存在、没过期）时返回它的账号；账号状态由调用方判断。 */
export async function findPlatformSessionUser(db: Db, sessionId: string, userId: string, now: Date): Promise<PlatformUser | null> {
  const result = await db.query<PlatformUserRow>(
    `select u.id, u.email, u.name, u.role, u.status, u.must_change_password, u.created_at, u.updated_at
       from platform_sessions s
       join platform_users u on u.id = s.user_id
      where s.id = $1 and s.user_id = $2 and s.expires_at > $3`,
    [sessionId, userId, now],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
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
