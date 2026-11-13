/**
 * 人工报价申请和官网设置的数据访问（M8-21，ADR 0076）。三张平台表，只在平台事务里用。
 * 这里只读写列；加密、解密、审计在 `services/manual-quotes.ts`。
 */
import type { ManualQuoteStatus, PlatformDataScope, ServiceCategory } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import type { TimeCursor } from "../pagination.ts";

export interface ManualQuoteRow {
  id: string;
  requestNo: string;
  status: ManualQuoteStatus;
  category: ServiceCategory;
  city: { id: string; code: string; name: Record<string, string> } | null;
  channelId: string;
  serviceLocal: string;
  passengers: number;
  luggage: number;
  packageHours: number | null;
  hasEmail: boolean;
  hasWhatsapp: boolean;
  contactEnc: string | null;
  /** 验收会话里提交的（M8-39，ADR 0078 补充）：服务端设，建好之后不能改 */
  isAcceptance: boolean;
  assignee: { id: string; name: string } | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  purgedAt: Date | null;
  /** 列表翻页用：数据库给出的时间文本 */
  createdAtText: string;
}

interface Row {
  id: string;
  request_no: string;
  status: ManualQuoteStatus;
  category: ServiceCategory;
  city_id: string | null;
  city_code: string | null;
  city_name: Record<string, string> | null;
  channel_id: string;
  service_local: string;
  passengers: number;
  luggage: number;
  package_hours: number | null;
  has_email: boolean;
  has_whatsapp: boolean;
  contact_enc: string | null;
  is_acceptance: boolean;
  assignee_id: string | null;
  assignee_name: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
  purged_at: Date | null;
  created_at_text: string;
}

const SELECT = `select m.id, m.request_no, m.status, m.category, m.city_id, c.code as city_code, c.name as city_name, m.channel_id, m.service_local,
       m.passengers, m.luggage, m.package_hours, m.has_email, m.has_whatsapp, m.contact_enc, m.is_acceptance, m.assignee_id, u.name as assignee_name,
       m.version, m.created_at, m.updated_at, m.finished_at, m.purged_at, m.created_at::text as created_at_text
  from manual_quote_requests m
  left join cities c on c.id = m.city_id
  left join platform_users u on u.id = m.assignee_id`;

function toRow(row: Row): ManualQuoteRow {
  return {
    id: row.id,
    requestNo: row.request_no,
    status: row.status,
    category: row.category,
    city: row.city_id === null ? null : { id: row.city_id, code: row.city_code ?? "", name: row.city_name ?? {} },
    channelId: row.channel_id,
    serviceLocal: row.service_local,
    passengers: row.passengers,
    luggage: row.luggage,
    packageHours: row.package_hours,
    hasEmail: row.has_email,
    hasWhatsapp: row.has_whatsapp,
    contactEnc: row.contact_enc,
    isAcceptance: row.is_acceptance,
    assignee: row.assignee_id === null ? null : { id: row.assignee_id, name: row.assignee_name ?? "" },
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    purgedAt: row.purged_at,
    createdAtText: row.created_at_text,
  };
}

export interface NewManualQuote {
  id: string;
  requestNo: string;
  category: ServiceCategory;
  cityId: string | null;
  channelId: string;
  serviceLocal: string;
  passengers: number;
  luggage: number;
  packageHours: number | null;
  hasEmail: boolean;
  hasWhatsapp: boolean;
  contactEnc: string;
  emailBidx: string | null;
  whatsappBidx: string | null;
  dedupKey: string;
  /** 验收会话里提交的 */
  isAcceptance: boolean;
}

/** 同一个去重键在这段时间之后有没有提交过（没清除的）。 */
export async function hasRecentDuplicate(db: Db, dedupKey: string, since: Date): Promise<boolean> {
  const result = await db.query("select 1 from manual_quote_requests where dedup_key = $1 and created_at > $2 limit 1", [dedupKey, since]);
  return (result.rowCount ?? 0) > 0;
}

export async function insertManualQuote(db: Db, input: NewManualQuote, now: Date): Promise<void> {
  await db.query(
    `insert into manual_quote_requests (id, request_no, category, city_id, channel_id, service_local, passengers, luggage, package_hours, has_email, has_whatsapp,
                                        contact_enc, email_bidx, whatsapp_bidx, dedup_key, is_acceptance, consent_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17, $17)`,
    [input.id, input.requestNo, input.category, input.cityId, input.channelId, input.serviceLocal, input.passengers, input.luggage, input.packageHours, input.hasEmail, input.hasWhatsapp, input.contactEnc, input.emailBidx, input.whatsappBidx, input.dedupKey, input.isAcceptance, now],
  );
  await db.query("insert into manual_quote_request_events (request_id, kind, created_at) values ($1, 'created', $2)", [input.id, now]);
}

export async function cityExists(db: Db, cityId: string): Promise<boolean> {
  return ((await db.query("select 1 from cities where id = $1", [cityId])).rowCount ?? 0) > 0;
}

export interface ManualQuoteFilter {
  status: ManualQuoteStatus | null;
  /** 指给谁：某人的编号；`unassigned` 是没人跟进的 */
  assignee: string | "unassigned" | null;
  /** 联系方式的盲索引（邮箱或 WhatsApp，精确匹配） */
  contactBidx: string | null;
}

/** 验收留资（M8-39）：默认 `exclude`（只列真实客人的）；`only` 只列验收的；`include` 两种都列。 */
export type ManualQuoteAcceptanceFilter = "exclude" | "only" | "include";

/** 验收留资的条件（参数是 `exclude` / `only` / `include`）。 */
const acceptanceWhere = (param: string): string => `(${param}::text = 'include' or m.is_acceptance = (${param}::text = 'only'))`;

/** 数据范围（ADR 0030）：限定了城市的只看这些城市的申请（认不出城市的看不到）；限定了渠道的只看这些渠道的。 */
const SCOPE_WHERE = "($1::uuid[] is null or m.city_id = any($1::uuid[])) and ($2::uuid[] is null or m.channel_id = any($2::uuid[]))";

export async function listManualQuotes(db: Db, filter: ManualQuoteFilter, acceptance: ManualQuoteAcceptanceFilter, scope: PlatformDataScope, limit: number, cursor: TimeCursor | null): Promise<ManualQuoteRow[]> {
  const result = await db.query<Row>(
    `${SELECT}
      where ${SCOPE_WHERE}
        and ${acceptanceWhere("$9")}
        and ($3::text is null or m.status = $3)
        and ($4::text is null or ($4 = 'unassigned' and m.assignee_id is null) or m.assignee_id::text = $4)
        and ($5::text is null or m.email_bidx = $5 or m.whatsapp_bidx = $5)
        and ($6::timestamptz is null or (m.created_at, m.id) < ($6::timestamptz, $7::uuid))
      order by m.created_at desc, m.id desc
      limit $8`,
    [scope.cityIds, scope.channelIds, filter.status, filter.assignee, filter.contactBidx, cursor?.t ?? null, cursor?.id ?? null, limit + 1, acceptance],
  );
  return result.rows.map(toRow);
}

/** 各状态的数量（范围内、只按验收留资的筛选，不带别的筛选）：列表上方的计数。默认不数验收留资（「新」的数量只算真实客人的）。 */
export async function countManualQuotesByStatus(db: Db, acceptance: ManualQuoteAcceptanceFilter, scope: PlatformDataScope): Promise<Record<ManualQuoteStatus, number>> {
  const result = await db.query<{ status: ManualQuoteStatus; n: number }>(`select m.status, count(*)::int as n from manual_quote_requests m where ${SCOPE_WHERE} and ${acceptanceWhere("$3")} group by m.status`, [scope.cityIds, scope.channelIds, acceptance]);
  const counts: Record<ManualQuoteStatus, number> = { new: 0, following: 0, quoted: 0, converted: 0, closed: 0 };
  for (const row of result.rows) counts[row.status] = row.n;
  return counts;
}

/** 按编号取一条（范围外的当作不存在）。`lock` 时锁住这一行（改状态、指派、写备注）。 */
export async function findManualQuote(db: Db, id: string, scope: PlatformDataScope, lock: boolean): Promise<ManualQuoteRow | null> {
  const result = await db.query<Row>(`${SELECT} where ${SCOPE_WHERE} and m.id = $3${lock ? " for update of m" : ""}`, [scope.cityIds, scope.channelIds, id]);
  const row = result.rows[0];
  return row === undefined ? null : toRow(row);
}

export interface ManualQuoteEventRow {
  id: string;
  kind: "created" | "status" | "assign" | "note";
  fromStatus: ManualQuoteStatus | null;
  toStatus: ManualQuoteStatus | null;
  assignee: { id: string; name: string } | null;
  noteEnc: string | null;
  actor: { id: string; name: string } | null;
  createdAt: Date;
}

export async function listManualQuoteEvents(db: Db, requestId: string): Promise<ManualQuoteEventRow[]> {
  const result = await db.query<{
    id: string;
    kind: ManualQuoteEventRow["kind"];
    from_status: ManualQuoteStatus | null;
    to_status: ManualQuoteStatus | null;
    assignee_id: string | null;
    assignee_name: string | null;
    note_enc: string | null;
    actor_id: string | null;
    actor_name: string | null;
    created_at: Date;
  }>(
    `select e.id, e.kind, e.from_status, e.to_status, e.assignee_id, a.name as assignee_name, e.note_enc, e.actor_id, u.name as actor_name, e.created_at
       from manual_quote_request_events e
       left join platform_users a on a.id = e.assignee_id
       left join platform_users u on u.id = e.actor_id
      where e.request_id = $1
      order by e.seq`,
    [requestId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    assignee: row.assignee_id === null ? null : { id: row.assignee_id, name: row.assignee_name ?? "" },
    noteEnc: row.note_enc,
    actor: row.actor_id === null ? null : { id: row.actor_id, name: row.actor_name ?? "" },
    createdAt: row.created_at,
  }));
}

export async function updateManualQuote(db: Db, id: string, change: { status: ManualQuoteStatus; assigneeId: string | null; finishedAt: Date | null }, now: Date): Promise<void> {
  await db.query("update manual_quote_requests set status = $2, assignee_id = $3, finished_at = $4, version = version + 1, updated_at = $5 where id = $1", [id, change.status, change.assigneeId, change.finishedAt, now]);
}

/** 写备注只动更新时间：备注是追加的，和同时在改状态、指派的人不冲突，不动版本。 */
export async function touchManualQuote(db: Db, id: string, now: Date): Promise<void> {
  await db.query("update manual_quote_requests set updated_at = $2 where id = $1", [id, now]);
}

export async function insertManualQuoteEvent(
  db: Db,
  event: { id: string; requestId: string; kind: "status" | "assign" | "note"; fromStatus?: ManualQuoteStatus; toStatus?: ManualQuoteStatus; assigneeId?: string | null; noteEnc?: string; actorId: string },
  now: Date,
): Promise<void> {
  await db.query(
    "insert into manual_quote_request_events (id, request_id, kind, from_status, to_status, assignee_id, note_enc, actor_id, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [event.id, event.requestId, event.kind, event.fromStatus ?? null, event.toStatus ?? null, event.assigneeId ?? null, event.noteEnc ?? null, event.actorId, now],
  );
}

/** 能被指派跟进的员工：在用的账号，角色给了 `manual_quote.read`（内置角色按代码里的表、自建角色按勾选，由调用方判断）。 */
export async function listActiveStaffWithRoles(db: Db): Promise<{ id: string; name: string; role: { key: string; builtin: boolean; grants: string[] | null; scope: PlatformDataScope } }[]> {
  const result = await db.query<{ id: string; name: string; role: string; builtin: boolean; grants: string[] | null; scope_city_ids: string[] | null; scope_channel_ids: string[] | null }>(
    `select u.id, u.name, u.role, r.builtin, r.grants, r.scope_city_ids, r.scope_channel_ids
       from platform_users u join platform_roles r on r.key = u.role
      where u.status = 'active'
      order by u.name, u.id`,
  );
  return result.rows.map((row) => ({ id: row.id, name: row.name, role: { key: row.role, builtin: row.builtin, grants: row.grants, scope: { cityIds: row.scope_city_ids, channelIds: row.scope_channel_ids } } }));
}

/** 到期该清除的申请（结束早于 `finishedBefore`，或提交早于 `createdBefore`），锁住、跳过别人锁着的。 */
export async function lockPurgeCandidates(db: Db, cutoffs: { finishedBefore: Date; createdBefore: Date }, limit: number): Promise<{ id: string; createdAt: Date }[]> {
  const result = await db.query<{ id: string; created_at: Date }>(
    `select id, created_at from manual_quote_requests
      where purged_at is null and (finished_at < $1 or created_at < $2)
      order by created_at, id
      limit $3
      for update skip locked`,
    [cutoffs.finishedBefore, cutoffs.createdBefore, limit],
  );
  return result.rows.map((row) => ({ id: row.id, createdAt: row.created_at }));
}

/** 清除一批：密文、盲索引、去重键清空，备注的密文清空。行和跟进记录（谁、什么时候、改成什么状态）留下。 */
export async function purgeManualQuotes(db: Db, ids: readonly string[], now: Date): Promise<number> {
  if (ids.length === 0) return 0;
  await db.query("update manual_quote_request_events set note_enc = null where request_id = any($1::uuid[]) and note_enc is not null", [ids]);
  const result = await db.query("update manual_quote_requests set contact_enc = null, email_bidx = null, whatsapp_bidx = null, dedup_key = null, purged_at = $2, updated_at = $2 where id = any($1::uuid[]) and purged_at is null", [ids, now]);
  return result.rowCount ?? 0;
}

// ---- 官网设置 ----

export type SitePageWidth = "standard" | "wide" | "full";

export interface SiteSettingsRow {
  supportWhatsapp: string | null;
  /** 官网页面宽度（M8-28，ADR 0079）；没设过是 standard */
  pageWidth: SitePageWidth;
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
}

export async function readSiteSettings(db: Db, lock = false): Promise<SiteSettingsRow> {
  const result = await db.query<{ support_whatsapp: string | null; page_width: SitePageWidth; version: number; updated_at: Date; updated_by: string; updated_by_name: string }>(
    `select s.support_whatsapp, s.page_width, s.version, s.updated_at, s.updated_by, u.name as updated_by_name
       from site_settings s join platform_users u on u.id = s.updated_by${lock ? " for update of s" : ""}`,
  );
  const row = result.rows[0];
  if (row === undefined) return { supportWhatsapp: null, pageWidth: "standard", version: 0, updatedAt: null, updatedBy: null };
  return { supportWhatsapp: row.support_whatsapp, pageWidth: row.page_width, version: row.version, updatedAt: row.updated_at, updatedBy: { id: row.updated_by, name: row.updated_by_name } };
}

/** 保存（第一次写入那一行）；`expectedVersion` 对不上返回 false。 */
export async function saveSiteSettings(db: Db, supportWhatsapp: string | null, pageWidth: SitePageWidth, expectedVersion: number, userId: string, now: Date): Promise<boolean> {
  const result =
    expectedVersion === 0
      ? await db.query("insert into site_settings (id, support_whatsapp, page_width, version, updated_at, updated_by) values (true, $1, $2, 1, $3, $4) on conflict (id) do nothing", [supportWhatsapp, pageWidth, now, userId])
      : await db.query("update site_settings set support_whatsapp = $1, page_width = $2, version = version + 1, updated_at = $3, updated_by = $4 where version = $5", [supportWhatsapp, pageWidth, now, userId, expectedVersion]);
  return (result.rowCount ?? 0) === 1;
}

/** 官网的公开配置只要号码和页面宽度。 */
export async function readPublicSiteSettings(db: Db): Promise<{ supportWhatsapp: string | null; pageWidth: SitePageWidth }> {
  const row = (await db.query<{ support_whatsapp: string | null; page_width: SitePageWidth }>("select support_whatsapp, page_width from site_settings")).rows[0];
  return { supportWhatsapp: row?.support_whatsapp ?? null, pageWidth: row?.page_width ?? "standard" };
}
