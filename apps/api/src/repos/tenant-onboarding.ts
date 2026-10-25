/**
 * 供应商入驻的数据访问（M4-01，ADR 0028）：企业信息、资质文件、资质、合同版本、状态记录、提醒、每日评分和评分的输入。
 * 每个函数都显式接收 tenantId 并写在 where 里（ADR 0003 的第一道防线）。租户事务里行级安全再兜一层；
 * 平台事务（审核、合同、定时任务）跨供应商读写，SQL 自己带条件。
 */
import type { DocumentFileType, DocumentStatus, DocumentType, ObservationReason, ScoreInput, SuspensionReason, TenantStatus } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

// ---- 企业信息 ----

export interface StoredProfile {
  tenantId: string;
  countryCode: string | null;
  legalName: string | null;
  registrationNo: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  version: number;
  updatedAt: Date;
}

export type ProfileFields = Omit<StoredProfile, "tenantId" | "version" | "updatedAt">;

const PROFILE_COLUMNS = "tenant_id, country_code, legal_name, registration_no, address, contact_name, contact_phone, contact_email, version, updated_at";

function toProfile(row: Row): StoredProfile {
  return {
    tenantId: row["tenant_id"],
    countryCode: row["country_code"],
    legalName: row["legal_name"],
    registrationNo: row["registration_no"],
    address: row["address"],
    contactName: row["contact_name"],
    contactPhone: row["contact_phone"],
    contactEmail: row["contact_email"],
    version: row["version"],
    updatedAt: row["updated_at"],
  };
}

export async function findProfile(db: Db, tenantId: string, options: { lock?: boolean } = {}): Promise<StoredProfile | null> {
  const result = await db.query<Row>(`select ${PROFILE_COLUMNS} from tenant_profiles where tenant_id = $1 ${options.lock ? "for update" : ""}`, [tenantId]);
  const row = result.rows[0];
  return row ? toProfile(row) : null;
}

/** 新建或整体替换企业信息（版本加一）。调用方核对过 If-Match。 */
export async function upsertProfile(db: Db, tenantId: string, fields: ProfileFields, now: Date): Promise<StoredProfile> {
  const result = await db.query<Row>(
    `insert into tenant_profiles (tenant_id, country_code, legal_name, registration_no, address, contact_name, contact_phone, contact_email, version, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)
     on conflict (tenant_id) do update
       set country_code = excluded.country_code, legal_name = excluded.legal_name, registration_no = excluded.registration_no, address = excluded.address,
           contact_name = excluded.contact_name, contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
           version = tenant_profiles.version + 1, updated_at = excluded.updated_at
     returning ${PROFILE_COLUMNS}`,
    [tenantId, fields.countryCode, fields.legalName, fields.registrationNo, fields.address, fields.contactName, fields.contactPhone, fields.contactEmail, now],
  );
  return toProfile(result.rows[0] as Row);
}

// ---- 文件 ----

export type FilePurpose = "document" | "contract";

export interface StoredFileMeta {
  tenantId: string;
  id: string;
  purpose: FilePurpose;
  contentType: DocumentFileType;
  byteSize: number;
  sha256: string;
  fileName: string;
  uploadedAt: Date;
  uploadedBy: { type: "tenant_user" | "platform_user"; id: string };
}

const FILE_COLUMNS = "tenant_id, id, purpose, content_type, byte_size, sha256, file_name, uploaded_at, uploaded_by_type, uploaded_by";

function toFileMeta(row: Row): StoredFileMeta {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    purpose: row["purpose"],
    contentType: row["content_type"],
    byteSize: row["byte_size"],
    sha256: row["sha256"],
    fileName: row["file_name"],
    uploadedAt: row["uploaded_at"],
    uploadedBy: { type: row["uploaded_by_type"], id: row["uploaded_by"] },
  };
}

export async function insertFile(db: Db, file: Omit<StoredFileMeta, "id"> & { data: Buffer }): Promise<StoredFileMeta> {
  const result = await db.query<Row>(
    `insert into tenant_files (tenant_id, purpose, content_type, byte_size, sha256, data, file_name, uploaded_at, uploaded_by_type, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning ${FILE_COLUMNS}`,
    [file.tenantId, file.purpose, file.contentType, file.byteSize, file.sha256, file.data, file.fileName, file.uploadedAt, file.uploadedBy.type, file.uploadedBy.id],
  );
  return toFileMeta(result.rows[0] as Row);
}

export async function findFileMeta(db: Db, tenantId: string, fileId: string): Promise<StoredFileMeta | null> {
  const result = await db.query<Row>(`select ${FILE_COLUMNS} from tenant_files where tenant_id = $1 and id = $2`, [tenantId, fileId]);
  const row = result.rows[0];
  return row ? toFileMeta(row) : null;
}

export async function findFileWithData(db: Db, tenantId: string, fileId: string): Promise<(StoredFileMeta & { data: Buffer }) | null> {
  const result = await db.query<Row>(`select ${FILE_COLUMNS}, data from tenant_files where tenant_id = $1 and id = $2`, [tenantId, fileId]);
  const row = result.rows[0];
  return row ? { ...toFileMeta(row), data: row["data"] as Buffer } : null;
}

// ---- 资质 ----

export interface StoredDocument {
  tenantId: string;
  id: string;
  /** 提交的先后：同一类型里大的是新的 */
  seq: number;
  type: DocumentType;
  fileId: string;
  expiresOn: string | null;
  note: string | null;
  status: DocumentStatus;
  submittedAt: Date;
  submittedBy: string;
  reviewedAt: Date | null;
  reviewedBy: { id: string; name: string; email: string } | null;
  reviewReason: string | null;
  remindersSent: number[];
  expiredNotified: boolean;
  file: { contentType: DocumentFileType; byteSize: number; fileName: string };
}

const DOCUMENT_COLUMNS = `d.tenant_id, d.id, d.seq, d.doc_type, d.file_id, d.expires_on::text as expires_on, d.note, d.status, d.submitted_at, d.submitted_by,
  d.reviewed_at, d.reviewed_by, d.review_reason, d.reminders_sent, d.expired_notified, f.content_type, f.byte_size, f.file_name`;

function toDocument(row: Row, reviewers: ReadonlyMap<string, { name: string; email: string }>): StoredDocument {
  const reviewerId = row["reviewed_by"] as string | null;
  const reviewer = reviewerId === null ? undefined : reviewers.get(reviewerId);
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    seq: Number(row["seq"]),
    type: row["doc_type"],
    fileId: row["file_id"],
    expiresOn: row["expires_on"],
    note: row["note"],
    status: row["status"],
    submittedAt: row["submitted_at"],
    submittedBy: row["submitted_by"],
    reviewedAt: row["reviewed_at"],
    reviewedBy: reviewerId === null ? null : { id: reviewerId, name: reviewer?.name ?? "", email: reviewer?.email ?? "" },
    reviewReason: row["review_reason"],
    remindersSent: row["reminders_sent"],
    expiredNotified: row["expired_notified"],
    file: { contentType: row["content_type"], byteSize: row["byte_size"], fileName: row["file_name"] },
  };
}

/**
 * 审核人的姓名和邮箱（平台员工表）：只在平台事务里查得到；租户事务里不查（租户角色读不了平台员工表），审核人只给编号。
 */
async function reviewerNames(db: Db, rows: readonly Row[], withNames: boolean): Promise<Map<string, { name: string; email: string }>> {
  const ids = [...new Set(rows.map((row) => row["reviewed_by"] as string | null).filter((id): id is string => id !== null))];
  if (!withNames || ids.length === 0) return new Map();
  const result = await db.query<Row>("select id, name, email from platform_users where id = any($1::uuid[])", [ids]);
  return new Map(result.rows.map((row) => [row["id"] as string, { name: row["name"] as string, email: row["email"] as string }]));
}

/** 一个供应商交过的全部资质，按提交时间从早到晚。`withReviewerNames` 只在平台事务里给 true。 */
export async function listDocuments(db: Db, tenantId: string, options: { withReviewerNames: boolean }): Promise<StoredDocument[]> {
  const result = await db.query<Row>(
    `select ${DOCUMENT_COLUMNS} from tenant_documents d join tenant_files f on f.tenant_id = d.tenant_id and f.id = d.file_id
      where d.tenant_id = $1 order by d.seq`,
    [tenantId],
  );
  const reviewers = await reviewerNames(db, result.rows, options.withReviewerNames);
  return result.rows.map((row) => toDocument(row, reviewers));
}

export async function findDocument(db: Db, tenantId: string, documentId: string, options: { lock?: boolean; withReviewerNames: boolean }): Promise<StoredDocument | null> {
  if (options.lock) await db.query("select 1 from tenant_documents where tenant_id = $1 and id = $2 for update", [tenantId, documentId]);
  const result = await db.query<Row>(`select ${DOCUMENT_COLUMNS} from tenant_documents d join tenant_files f on f.tenant_id = d.tenant_id and f.id = d.file_id where d.tenant_id = $1 and d.id = $2`, [tenantId, documentId]);
  const row = result.rows[0];
  if (!row) return null;
  return toDocument(row, await reviewerNames(db, [row], options.withReviewerNames));
}

export async function insertDocument(db: Db, input: { tenantId: string; type: DocumentType; fileId: string; expiresOn: string | null; note: string | null; submittedBy: string; now: Date }): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into tenant_documents (tenant_id, doc_type, file_id, expires_on, note, status, submitted_at, submitted_by) values ($1, $2, $3, $4::date, $5, 'pending', $6, $7) returning id",
    [input.tenantId, input.type, input.fileId, input.expiresOn, input.note, input.now, input.submittedBy],
  );
  return (result.rows[0] as { id: string }).id;
}

/** 写审核结论。通过时可以改到期日（运营照证件上的日期改正）。 */
export async function setDocumentReview(db: Db, tenantId: string, documentId: string, review: { status: DocumentStatus; reason: string | null; expiresOn: string | null; reviewerId: string; now: Date }): Promise<void> {
  await db.query(
    "update tenant_documents set status = $3, review_reason = $4, expires_on = $5::date, reviewed_by = $6, reviewed_at = $7 where tenant_id = $1 and id = $2",
    [tenantId, documentId, review.status, review.reason, review.expiresOn, review.reviewerId, review.now],
  );
}

/** 同一类型里更早提交的（审核通过、审核中、驳回、要求补充的）都被新通过的这一份取代。已有的审核人和时间原样保留。 */
export async function supersedeEarlierDocuments(db: Db, tenantId: string, type: DocumentType, beforeSeq: number, reviewerId: string, now: Date): Promise<void> {
  await db.query(
    `update tenant_documents set status = 'superseded', reviewed_by = coalesce(reviewed_by, $4), reviewed_at = coalesce(reviewed_at, $5)
      where tenant_id = $1 and doc_type = $2 and seq < $3 and status <> 'superseded'`,
    [tenantId, type, beforeSeq, reviewerId, now],
  );
}

/** 同一类型里有没有比它晚提交的（没被取代的）：有的话这一份已经被供应商换掉了，不能再审。 */
export async function hasLaterDocument(db: Db, tenantId: string, type: DocumentType, seq: number): Promise<boolean> {
  const result = await db.query("select 1 from tenant_documents where tenant_id = $1 and doc_type = $2 and seq > $3 and status <> 'superseded' limit 1", [tenantId, type, seq]);
  return (result.rowCount ?? 0) > 0;
}

export async function markDocumentReminder(db: Db, tenantId: string, documentId: string, change: { reminder?: number; expired?: boolean }): Promise<void> {
  if (change.reminder !== undefined) await db.query("update tenant_documents set reminders_sent = array_append(reminders_sent, $3) where tenant_id = $1 and id = $2", [tenantId, documentId, change.reminder]);
  if (change.expired === true) await db.query("update tenant_documents set expired_notified = true where tenant_id = $1 and id = $2", [tenantId, documentId]);
}

export interface QueuedDocument {
  document: StoredDocument;
  tenantName: string;
  tenantStatus: TenantStatus;
}

/**
 * 审核队列（跨供应商）：`pending` = 待审核的（每个供应商每个类型只列最新提交的一份，更早的那份已经被它代替了），提交得早的在前；
 * `expiring` = 现在生效、在 `beforeDate` 之前到期的（含已过期），到期早的在前。
 */
export async function listDocumentQueue(db: Db, filter: { kind: "pending" | "expiring"; beforeDate: string }, limit: number, after: TimeCursor | null): Promise<Page<QueuedDocument> & { total: number }> {
  const pendingWhere = `d.status = 'pending' and not exists (
      select 1 from tenant_documents later where later.tenant_id = d.tenant_id and later.doc_type = d.doc_type and later.seq > d.seq and later.status <> 'superseded')`;
  const expiringWhere = "d.status = 'approved' and d.expires_on is not null and d.expires_on <= $1::date and t.status <> 'terminated'";
  const where = filter.kind === "pending" ? `${pendingWhere} and $1::date is not null` : expiringWhere;
  const order = filter.kind === "pending" ? "d.submitted_at" : "d.expires_on::timestamptz";
  const result = await db.query<Row>(
    `select ${DOCUMENT_COLUMNS}, t.name as tenant_name, t.status as tenant_status, (${order})::text as cursor_time
       from tenant_documents d join tenant_files f on f.tenant_id = d.tenant_id and f.id = d.file_id join tenants t on t.id = d.tenant_id
      where ${where} and ($2::timestamptz is null or (${order}, d.id) > ($2::timestamptz, $3::uuid))
      order by ${order}, d.id limit $4`,
    [filter.beforeDate, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from tenant_documents d join tenants t on t.id = d.tenant_id where ${where}`, [filter.beforeDate]);
  const reviewers = await reviewerNames(db, result.rows, true);
  const page = toPage(result.rows, limit, (row): QueuedDocument => ({ document: toDocument(row, reviewers), tenantName: row["tenant_name"], tenantStatus: row["tenant_status"] }), (row) => ({ t: row["cursor_time"], id: row["id"] }));
  return { ...page, total: (total.rows[0] as { n: number }).n };
}

// ---- 合同 ----

export interface StoredContract {
  tenantId: string;
  id: string;
  version: number;
  validFrom: string;
  settleCurrency: string;
  settleCycle: "monthly";
  paymentDay: number;
  fileId: string | null;
  note: string | null;
  approvalId: string;
  requestedBy: string;
  approvedBy: string;
  createdAt: Date;
}

const CONTRACT_COLUMNS = "tenant_id, id, version, valid_from::text as valid_from, settle_currency, settle_cycle, payment_day, file_id, note, approval_id, requested_by, approved_by, created_at";

function toContract(row: Row): StoredContract {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    version: row["version"],
    validFrom: row["valid_from"],
    settleCurrency: row["settle_currency"],
    settleCycle: row["settle_cycle"],
    paymentDay: row["payment_day"],
    fileId: row["file_id"],
    note: row["note"],
    approvalId: row["approval_id"],
    requestedBy: row["requested_by"],
    approvedBy: row["approved_by"],
    createdAt: row["created_at"],
  };
}

/** 一个供应商的全部合同版本，版本号从小到大。 */
export async function listContracts(db: Db, tenantId: string): Promise<StoredContract[]> {
  const result = await db.query<Row>(`select ${CONTRACT_COLUMNS} from tenant_contracts where tenant_id = $1 order by version`, [tenantId]);
  return result.rows.map(toContract);
}

export async function insertContract(db: Db, contract: Omit<StoredContract, "id" | "version">): Promise<StoredContract> {
  const result = await db.query<Row>(
    `insert into tenant_contracts (tenant_id, version, valid_from, settle_currency, settle_cycle, payment_day, file_id, note, approval_id, requested_by, approved_by, created_at)
     values ($1, (select coalesce(max(version), 0) + 1 from tenant_contracts where tenant_id = $1), $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${CONTRACT_COLUMNS}`,
    [contract.tenantId, contract.validFrom, contract.settleCurrency, contract.settleCycle, contract.paymentDay, contract.fileId, contract.note, contract.approvalId, contract.requestedBy, contract.approvedBy, contract.createdAt],
  );
  return toContract(result.rows[0] as Row);
}

// ---- 状态记录 ----

export interface StatusEvent {
  id: string;
  trigger: string;
  fromStatus: TenantStatus;
  toStatus: TenantStatus;
  suspensionBefore: SuspensionReason[];
  suspensionAfter: SuspensionReason[];
  observationBefore: ObservationReason[];
  observationAfter: ObservationReason[];
  actor: { type: "tenant_user" | "platform_user" | "system"; id: string | null; email: string | null };
  note: string | null;
  approvalId: string | null;
  occurredAt: Date;
}

export async function insertStatusEvent(db: Db, tenantId: string, event: Omit<StatusEvent, "id" | "actor"> & { actor: { type: StatusEvent["actor"]["type"]; id: string | null } }): Promise<void> {
  await db.query(
    `insert into tenant_status_events (tenant_id, trigger, from_status, to_status, suspension_before, suspension_after, observation_before, observation_after, actor_type, actor_id, note, approval_id, occurred_at)
     values ($1, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::text[], $9, $10, $11, $12, $13)`,
    [tenantId, event.trigger, event.fromStatus, event.toStatus, event.suspensionBefore, event.suspensionAfter, event.observationBefore, event.observationAfter, event.actor.type, event.actor.id, event.note, event.approvalId, event.occurredAt],
  );
}

/**
 * 状态记录，新的在前。`withActorEmails` 只在平台事务里给 true：操作者的邮箱从平台员工、租户用户表里查（租户事务里查不到平台员工）。
 */
export async function listStatusEvents(db: Db, tenantId: string, options: { withActorEmails: boolean; limit: number }): Promise<StatusEvent[]> {
  const result = await db.query<Row>(
    `select e.id, e.trigger, e.from_status, e.to_status, e.suspension_before, e.suspension_after, e.observation_before, e.observation_after,
            e.actor_type, e.actor_id, e.note, e.approval_id, e.occurred_at
            ${options.withActorEmails ? ", coalesce(pu.email, tu.email) as actor_email" : ", null::text as actor_email"}
       from tenant_status_events e
       ${options.withActorEmails ? "left join platform_users pu on e.actor_type = 'platform_user' and pu.id = e.actor_id left join tenant_users tu on e.actor_type = 'tenant_user' and tu.tenant_id = e.tenant_id and tu.id = e.actor_id" : ""}
      where e.tenant_id = $1 order by e.occurred_at desc, e.seq desc limit $2`,
    [tenantId, options.limit],
  );
  return result.rows.map((row) => ({
    id: row["id"],
    trigger: row["trigger"],
    fromStatus: row["from_status"],
    toStatus: row["to_status"],
    suspensionBefore: row["suspension_before"],
    suspensionAfter: row["suspension_after"],
    observationBefore: row["observation_before"],
    observationAfter: row["observation_after"],
    actor: { type: row["actor_type"], id: row["actor_id"], email: row["actor_email"] },
    note: row["note"],
    approvalId: row["approval_id"],
    occurredAt: row["occurred_at"],
  }));
}

// ---- 提醒 ----

export type NoticeKind = "document_expiring" | "document_expired" | "document_reviewed" | "status_changed" | "observation_started" | "observation_ended";

export interface Notice {
  id: string;
  kind: NoticeKind;
  data: Record<string, unknown>;
  createdAt: Date;
}

/** 写一条提醒；同一个 `dedupeKey` 已经有了就什么都不做（同一件事只提醒一次）。 */
export async function insertNotice(db: Db, tenantId: string, notice: { kind: NoticeKind; dedupeKey: string; data: Record<string, unknown>; now: Date }): Promise<void> {
  await db.query(
    "insert into tenant_notices (tenant_id, kind, dedupe_key, data, created_at) values ($1, $2, $3, $4::jsonb, $5) on conflict (tenant_id, dedupe_key) do nothing",
    [tenantId, notice.kind, notice.dedupeKey, JSON.stringify(notice.data), notice.now],
  );
}

export async function listNotices(db: Db, tenantId: string, limit: number, after: TimeCursor | null): Promise<Page<Notice>> {
  const result = await db.query<Row>(
    `select id, kind, data, created_at, created_at::text as cursor_time from tenant_notices
      where tenant_id = $1 and ($2::timestamptz is null or (created_at, id) < ($2::timestamptz, $3::uuid))
      order by created_at desc, id desc limit $4`,
    [tenantId, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  return toPage(result.rows, limit, (row): Notice => ({ id: row["id"], kind: row["kind"], data: row["data"], createdAt: row["created_at"] }), (row) => ({ t: row["cursor_time"], id: row["id"] }));
}

// ---- 评分 ----

export interface ScoreDay {
  date: string;
  windowFrom: string;
  input: ScoreInput;
  noShows: number;
  rawScoreCenti: number | null;
  scoreCenti: number;
  isDefault: boolean;
  computedAt: Date;
}

const SCORE_COLUMNS = `score_date::text as score_date, window_from::text as window_from, completed_orders, dispatch_on_time, dispatch_total, arrival_on_time, arrival_total,
  rating_sum, rating_count, upheld_complaints, failures, no_shows, raw_score_centi, score_centi, is_default, computed_at`;

function toScoreDay(row: Row): ScoreDay {
  return {
    date: row["score_date"],
    windowFrom: row["window_from"],
    input: {
      completedOrders: row["completed_orders"],
      dispatch: { onTime: row["dispatch_on_time"], total: row["dispatch_total"] },
      arrival: { onTime: row["arrival_on_time"], total: row["arrival_total"] },
      ratings: { sum: row["rating_sum"], count: row["rating_count"] },
      upheldComplaints: row["upheld_complaints"],
      failures: row["failures"],
    },
    noShows: row["no_shows"],
    rawScoreCenti: row["raw_score_centi"],
    scoreCenti: row["score_centi"],
    isDefault: row["is_default"],
    computedAt: row["computed_at"],
  };
}

/** 写（或重写）某一天的评分。 */
export async function upsertScoreDay(db: Db, tenantId: string, day: ScoreDay): Promise<void> {
  const input = day.input;
  await db.query(
    `insert into tenant_score_daily (tenant_id, score_date, window_from, completed_orders, dispatch_on_time, dispatch_total, arrival_on_time, arrival_total,
            rating_sum, rating_count, upheld_complaints, failures, no_shows, raw_score_centi, score_centi, is_default, computed_at)
     values ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (tenant_id, score_date) do update set
       window_from = excluded.window_from, completed_orders = excluded.completed_orders, dispatch_on_time = excluded.dispatch_on_time, dispatch_total = excluded.dispatch_total,
       arrival_on_time = excluded.arrival_on_time, arrival_total = excluded.arrival_total, rating_sum = excluded.rating_sum, rating_count = excluded.rating_count,
       upheld_complaints = excluded.upheld_complaints, failures = excluded.failures, no_shows = excluded.no_shows, raw_score_centi = excluded.raw_score_centi,
       score_centi = excluded.score_centi, is_default = excluded.is_default, computed_at = excluded.computed_at`,
    [tenantId, day.date, day.windowFrom, input.completedOrders, input.dispatch.onTime, input.dispatch.total, input.arrival.onTime, input.arrival.total, input.ratings.sum, input.ratings.count, input.upheldComplaints, input.failures, day.noShows, day.rawScoreCenti, day.scoreCenti, day.isDefault, day.computedAt],
  );
}

/** 一段日期里的每日评分（评分趋势），日期从早到晚。 */
export async function listScoreDays(db: Db, tenantId: string, from: string, to: string): Promise<ScoreDay[]> {
  const result = await db.query<Row>(`select ${SCORE_COLUMNS} from tenant_score_daily where tenant_id = $1 and score_date between $2::date and $3::date order by score_date`, [tenantId, from, to]);
  return result.rows.map(toScoreDay);
}

/**
 * 算评分要的数：[from, to) 这段时间里——
 * 完成订单数（状态流水里变成「已完成」的单）、派车 / 到达事件的按时数和总数、客人评价的总分和条数、成立的投诉、履约失败；
 * 另给 [noShowFrom, to) 里「司机未到」的次数。
 */
export async function loadScoreInput(db: Db, tenantId: string, window: { from: Date; to: Date; noShowFrom: Date }): Promise<{ input: ScoreInput; noShows: number }> {
  const completed = await db.query<{ n: number }>(
    `select count(distinct e.order_id)::int as n from order_events e join orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      where e.tenant_id = $1 and e.to_status = 'completed' and o.status = 'completed' and e.occurred_at >= $2 and e.occurred_at < $3`,
    [tenantId, window.from, window.to],
  );
  const inWindow = await db.query<Row>(
    "select kind, count(*)::int as total, count(*) filter (where on_time)::int as on_time from tenant_performance_events where tenant_id = $1 and occurred_at >= $2 and occurred_at < $3 group by kind",
    [tenantId, window.from, window.to],
  );
  // 司机未到按 30 天的窗口另数
  const noShows = await db.query<{ n: number }>(
    "select count(*)::int as n from tenant_performance_events where tenant_id = $1 and kind = 'failure' and failure_type = 'driver_no_show' and occurred_at >= $2 and occurred_at < $3",
    [tenantId, window.noShowFrom, window.to],
  );
  const counted = (kind: string): Row | undefined => inWindow.rows.find((row) => row["kind"] === kind);
  const ratings = await db.query<Row>("select coalesce(sum(rating), 0)::int as sum, count(*)::int as count from order_reviews where tenant_id = $1 and submitted_at >= $2 and submitted_at < $3", [tenantId, window.from, window.to]);
  const rating = ratings.rows[0] as Row;
  return {
    input: {
      completedOrders: (completed.rows[0] as { n: number }).n,
      dispatch: { onTime: counted("dispatch")?.["on_time"] ?? 0, total: counted("dispatch")?.["total"] ?? 0 },
      arrival: { onTime: counted("arrival")?.["on_time"] ?? 0, total: counted("arrival")?.["total"] ?? 0 },
      ratings: { sum: rating["sum"], count: rating["count"] },
      upheldComplaints: counted("complaint")?.["total"] ?? 0,
      failures: counted("failure")?.["total"] ?? 0,
    },
    noShows: (noShows.rows[0] as { n: number }).n,
  };
}

/** 试运营以来（`since` 起）完成的订单数和成立的重大投诉数：转正式的条件。 */
export async function loadTrialProgress(db: Db, tenantId: string, since: Date, until: Date): Promise<{ completed: number; majorComplaints: number }> {
  const completed = await db.query<{ n: number }>(
    `select count(distinct e.order_id)::int as n from order_events e join orders o on o.tenant_id = e.tenant_id and o.id = e.order_id
      where e.tenant_id = $1 and e.to_status = 'completed' and o.status = 'completed' and e.occurred_at >= $2 and e.occurred_at < $3`,
    [tenantId, since, until],
  );
  const major = await db.query<{ n: number }>("select count(*)::int as n from tenant_performance_events where tenant_id = $1 and kind = 'complaint' and major and occurred_at >= $2 and occurred_at < $3", [tenantId, since, until]);
  return { completed: (completed.rows[0] as { n: number }).n, majorComplaints: (major.rows[0] as { n: number }).n };
}

/**
 * 记一条履约事件（评分的输入）。派车、履约回传（M3-02）、救援改派（M3-04）、工单判定投诉成立（M3-06）各自在自己的事务里调；
 * 同一单同一类只记一次（重复的忽略），返回有没有新记。
 */
export async function recordPerformanceEvent(
  db: Db,
  event: { tenantId: string; orderId: string; kind: "dispatch" | "arrival" | "complaint" | "failure"; onTime?: boolean; major?: boolean; failureType?: "rescue" | "driver_no_show" | "major_delay"; occurredAt: Date; now: Date },
): Promise<boolean> {
  const result = await db.query(
    `insert into tenant_performance_events (tenant_id, order_id, kind, on_time, major, failure_type, occurred_at, recorded_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (tenant_id, order_id, kind) do nothing`,
    [event.tenantId, event.orderId, event.kind, event.onTime ?? null, event.major ?? false, event.failureType ?? null, event.occurredAt, event.now],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 记一条客人评价（一单一条；重复的忽略）。入口在客人订单页（M3-05）。 */
export async function recordOrderReview(db: Db, review: { tenantId: string; orderId: string; rating: number; comment: string | null; now: Date }): Promise<boolean> {
  const result = await db.query("insert into order_reviews (tenant_id, order_id, rating, comment, submitted_at) values ($1, $2, $3, $4, $5) on conflict do nothing", [review.tenantId, review.orderId, review.rating, review.comment, review.now]);
  return (result.rowCount ?? 0) > 0;
}

// ---- 其他 ----

/** 还没结束的订单（清退的前提：已有订单全部履约完毕）。 */
export async function countOpenOrders(db: Db, tenantId: string): Promise<number> {
  const result = await db.query<{ n: number }>("select count(*)::int as n from orders where tenant_id = $1 and status not in ('completed', 'cancelled')", [tenantId]);
  return (result.rows[0] as { n: number }).n;
}

/** 这些供应商从 `since` 起（今天 0 点）接的、没取消的订单数（试运营的每日上限）。 */
export async function countOrdersSince(db: Db, tenantIds: readonly string[], since: Date): Promise<Map<string, number>> {
  if (tenantIds.length === 0) return new Map();
  const result = await db.query<Row>(
    "select tenant_id, count(*)::int as n from orders where tenant_id = any($1::uuid[]) and status <> 'cancelled' and created_at >= $2 group by tenant_id",
    [tenantIds, since],
  );
  return new Map(result.rows.map((row) => [row["tenant_id"] as string, row["n"] as number]));
}
