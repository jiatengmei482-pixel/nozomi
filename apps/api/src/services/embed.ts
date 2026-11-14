/**
 * 嵌入组件（M9E-02，ADR 0090 第三、五节）：嵌入码与域名白名单、跨域的配置 / 地址提示 / 建草稿、来源统计。
 *
 * - 嵌入码是公开标识（不是密钥）；白名单存规范化后的 origin，请求的 `Origin` 完全相等才放行。
 * - 每次请求都查库：改白名单、停用立即在服务端生效（配置应答另有 60 秒浏览器缓存）。
 * - 来源只做统计：询价带了有效草稿时记到 `quote_embed_sources`；下单时再核一次「嵌入码仍启用、来源仍在当前白名单」，
 *   通过才记 `order_embed_sources`（`return_url` 也再核一次），否则什么都不记（按主站来的算），不拒单、不报错。
 */
import { createHash, randomBytes } from "node:crypto";
import {
  type BookingDraft,
  EMBED_RULES,
  type EmbedDelivery,
  type EmbedKeyStatus,
  type EmbedLang,
  type EmbedLayout,
  type EmbedService,
  bookingDraftIssues,
  embedKeyIssues,
  embedOriginAllowed,
  embedReturnUrl,
  normalizeEmbedOrigin,
  rateLimitKeyOf,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { type StoredBookingDraft, findLiveBookingDraft, insertBookingDraft } from "./booking-drafts.ts";
import { versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { type SalesRateScope, rateLimited, takeRateSlot } from "./rate-limit.ts";

export interface EmbedKey {
  id: string;
  key: string;
  name: string;
  allowedOrigins: string[];
  defaultLang: EmbedLang;
  defaultServices: EmbedService[];
  layout: EmbedLayout;
  /** 允许整页嵌入（M9E-16，ADR 0095 Q13）：打开了 /embed/v1/frame-check 才放行 /embed/book 被白名单里的网站嵌入；默认关 */
  allowHostPage: boolean;
  status: EmbedKeyStatus;
  note: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface EmbedKeyRow {
  id: string;
  key: string;
  name: string;
  allowed_origins: string[];
  default_lang: EmbedLang;
  default_services: EmbedService[];
  layout: EmbedLayout;
  allow_host_page: boolean;
  status: EmbedKeyStatus;
  note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const COLUMNS = "id, key, name, allowed_origins, default_lang, default_services, layout, allow_host_page, status, note, version, created_at, updated_at";
const fromRow = (row: EmbedKeyRow): EmbedKey => ({
  id: row.id,
  key: row.key,
  name: row.name,
  allowedOrigins: row.allowed_origins,
  defaultLang: row.default_lang,
  defaultServices: row.default_services,
  layout: row.layout,
  allowHostPage: row.allow_host_page,
  status: row.status,
  note: row.note,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const originOptions = (ctx: AppContext) => ({ allowLocalHttp: ctx.config.appEnv !== "production" });

export const embedOriginNotAllowed = (): AppError => new AppError(403, "EMBED_ORIGIN_NOT_ALLOWED", "此网站未获授权使用预订组件");
const embedKeyNotFound = (): AppError => new AppError(404, "NOT_FOUND", "嵌入码不存在");

// ---- 运营后台 ----

export async function listEmbedKeys(ctx: AppContext): Promise<EmbedKey[]> {
  const result = await withPlatformTx(ctx.pool, (db) => db.query<EmbedKeyRow>(`select ${COLUMNS} from embed_keys order by created_at desc, id`), { snapshot: true });
  return result.rows.map(fromRow);
}

export async function getEmbedKey(ctx: AppContext, id: string): Promise<EmbedKey> {
  const result = await withPlatformTx(ctx.pool, (db) => db.query<EmbedKeyRow>(`select ${COLUMNS} from embed_keys where id = $1`, [id]), { snapshot: true });
  const row = result.rows[0];
  if (row === undefined) throw embedKeyNotFound();
  return fromRow(row);
}

export interface EmbedKeyWrite {
  name: string;
  allowedOrigins: readonly string[];
  defaultLang: string;
  defaultServices: readonly string[];
  /** 外观；不填时新建按卡片、修改保持原值 */
  layout?: string | undefined;
  /** 允许整页嵌入（M9E-16）；不填时新建按关、修改保持原值 */
  allowHostPage?: boolean | undefined;
  note: string | null;
}

function checked(ctx: AppContext, input: EmbedKeyWrite): { name: string; origins: string[]; layout: EmbedLayout | null; note: string | null } {
  const note = input.note === null || input.note.trim() === "" ? null : input.note.trim();
  const { issues, origins } = embedKeyIssues({ name: input.name, allowed_origins: input.allowedOrigins, default_lang: input.defaultLang, default_services: input.defaultServices, layout: input.layout, note }, originOptions(ctx));
  if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_TEXT[issue.reason] ?? "写得不对" })));
  // 校验过了，这里只剩两种取值；null = 没填
  return { name: input.name.trim(), origins, layout: (input.layout ?? null) as EmbedLayout | null, note };
}

const ISSUE_TEXT: Readonly<Record<string, string>> = {
  REQUIRED: "必填",
  OUT_OF_RANGE: "超出允许的范围",
  INVALID: "写法不对：网站地址要写成 https://域名（可带端口），不带路径；不支持通配符",
  DUPLICATE: "重复了",
};

const auditJson = (key: EmbedKey) => ({ key: key.key, name: key.name, allowed_origins: key.allowedOrigins, default_lang: key.defaultLang, default_services: key.defaultServices, layout: key.layout, allow_host_page: key.allowHostPage, status: key.status, note: key.note });

export async function createEmbedKey(ctx: AppContext, principal: PlatformPrincipal, ip: string, input: EmbedKeyWrite): Promise<EmbedKey> {
  const { name, origins, layout, note } = checked(ctx, input);
  return withPlatformTx(ctx.pool, async (db) => {
    const now = ctx.now();
    const key = `nze_${randomBytes(24).toString("base64url")}`;
    const result = await db.query<EmbedKeyRow>(
      `insert into embed_keys (key, name, allowed_origins, default_lang, default_services, layout, allow_host_page, note, created_at, updated_at, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $10) returning ${COLUMNS}`,
      [key, name, origins, input.defaultLang, [...input.defaultServices], layout ?? "auto", input.allowHostPage ?? false, note, now, principal.user.id],
    );
    const created = fromRow(result.rows[0] as EmbedKeyRow);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "embed_key", resourceId: created.id, action: "create", before: null, after: auditJson(created) });
    return created;
  });
}

export async function updateEmbedKey(ctx: AppContext, principal: PlatformPrincipal, ip: string, id: string, version: number, input: EmbedKeyWrite & { status: EmbedKeyStatus }): Promise<EmbedKey> {
  const { name, origins, layout, note } = checked(ctx, input);
  return withPlatformTx(ctx.pool, async (db) => {
    const current = await db.query<EmbedKeyRow>(`select ${COLUMNS} from embed_keys where id = $1 for update`, [id]);
    const row = current.rows[0];
    if (row === undefined) throw embedKeyNotFound();
    const before = fromRow(row);
    if (before.version !== version) throw versionConflict(before.version);
    const now = ctx.now();
    const result = await db.query<EmbedKeyRow>(
      `update embed_keys set name = $2, allowed_origins = $3, default_lang = $4, default_services = $5, layout = $6, allow_host_page = $11, note = $7, status = $8, version = version + 1, updated_at = $9, updated_by = $10
       where id = $1 returning ${COLUMNS}`,
      // 没填外观、整页嵌入开关就保持原值（只会改名称、白名单的旧客户端不会把横条改回卡片，也不会关掉整页嵌入）
      [id, name, origins, input.defaultLang, [...input.defaultServices], layout ?? before.layout, note, input.status, now, principal.user.id, input.allowHostPage ?? before.allowHostPage],
    );
    const after = fromRow(result.rows[0] as EmbedKeyRow);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "embed_key", resourceId: id, action: "update", before: auditJson(before), after: auditJson(after) });
    return after;
  });
}

// ---- /embed/v1：白名单核对 ----

export interface EmbedGate {
  embedKey: EmbedKey;
  /** 规范化后的请求 Origin（已核对在白名单里） */
  origin: string;
}

async function findActiveKey(db: Db, key: string): Promise<EmbedKey | null> {
  const result = await db.query<EmbedKeyRow>(`select ${COLUMNS} from embed_keys where key = $1 and status = 'active'`, [key]);
  const row = result.rows[0];
  return row === undefined ? null : fromRow(row);
}

/** 嵌入码存在、启用，请求的 Origin 完全等于白名单某项：否则一律 403（不区分原因） */
export async function embedGate(ctx: AppContext, key: unknown, originHeader: string | undefined): Promise<EmbedGate> {
  if (typeof key !== "string" || key.length > 64) throw embedOriginNotAllowed();
  const embedKey = await withPlatformTx(ctx.pool, (db) => findActiveKey(db, key), { snapshot: true });
  if (embedKey === null) throw embedOriginNotAllowed();
  const origin = embedOriginAllowed(originHeader, embedKey.allowedOrigins, originOptions(ctx));
  if (origin === null) throw embedOriginNotAllowed();
  return { embedKey, origin };
}

// ---- /embed/v1/frame-check（M9E-16，ADR 0095 第五节第 1 小节）----

/**
 * `/embed/book` 能不能被 `host` 这个网站嵌入：嵌入码存在、启用、打开了「允许整页嵌入」，`host` 是规范的 origin 并且完全等于白名单某一项，
 * 才返回这个 origin（只有协议、主机名、端口，没有空格、分号、引号，可以原样写进 frame-ancestors）；其余一律 null，不区分原因。
 * 不看请求的 `Origin`（iframe 的页面导航不带它，而且调用方是 Caddy）：这是 ADR 0090「Origin 不在白名单一律 403」的例外。
 */
export async function frameAncestorOf(ctx: AppContext, key: unknown, host: unknown): Promise<string | null> {
  if (typeof key !== "string" || key.length > 64 || typeof host !== "string" || host.length > 300) return null;
  // 规范化前后必须一样：带路径、结尾斜杠、大写的都不算（iframe 地址里的 host 由组件按 location.origin 填，本来就是规范的）
  const origin = normalizeEmbedOrigin(host, originOptions(ctx));
  if (origin === null || origin !== host) return null;
  const embedKey = await withPlatformTx(ctx.pool, (db) => findActiveKey(db, key), { snapshot: true });
  if (embedKey === null || !embedKey.allowHostPage || !embedKey.allowedOrigins.includes(origin)) return null;
  return origin;
}

/** frame-check 的限速：按来源地址单独一档（不和官网的 site_read 共用），每地址每分钟 60 次 */
export async function takeFrameCheckSlot(ctx: AppContext, ip: string): Promise<void> {
  await take(ctx, "embed_frame_check", bucket("ip", rateLimitKeyOf(ip)));
}

const bucket = (kind: "ip" | "key", value: string): string => createHash("sha256").update(`embed-${kind}:${value}`, "utf8").digest("hex");

async function take(ctx: AppContext, scope: SalesRateScope, key: string): Promise<void> {
  const decision = await withPlatformTx(ctx.pool, (db) => takeRateSlot(db, key, scope, ctx.now()));
  if (!decision.allowed) throw rateLimited(decision.retryAfterSeconds);
}

/** 地址提示：每个嵌入码每分钟 600 次（每地址的额度由调用方按官网的规则另算） */
export async function takeEmbedPlacesSlot(ctx: AppContext, gate: EmbedGate): Promise<void> {
  await take(ctx, "embed_places_key", bucket("key", gate.embedKey.id));
}

export const embedDraftLimit = (): AppError => new AppError(429, "EMBED_DRAFT_LIMIT", "这个嵌入码同时有效的预订草稿太多了，请稍后再试");

/**
 * 建草稿：内容逐项校验，`return_url` 不合格就忽略；每地址 10 分钟 30 次、每嵌入码每分钟 60 次、每嵌入码有效草稿 5,000 个。
 * `delivery`（M9E-16）：组件传了 bookingUrl 时是 host_page，没传时不带（存空，按 redirect 算）；只做统计
 */
export async function createEmbedDraft(ctx: AppContext, gate: EmbedGate, ip: string, body: { draft: unknown; return_url?: unknown; delivery?: EmbedDelivery | undefined }, log?: { warn(obj: object, msg: string): void }): Promise<StoredBookingDraft> {
  await take(ctx, "embed_draft_ip", bucket("ip", rateLimitKeyOf(ip)));
  await take(ctx, "embed_draft_key", bucket("key", gate.embedKey.id));
  const issues = bookingDraftIssues(body.draft);
  if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: `/draft${issue.path}`, reason: issue.reason, message: "预订条件写得不对" })));
  const returnUrl = embedReturnUrl(body.return_url, gate.origin, gate.embedKey.allowedOrigins, originOptions(ctx));
  return withPlatformTx(ctx.pool, async (db) => {
    const now = ctx.now();
    // 同一个嵌入码的建草稿排队数数，数和写之间不会被并发的请求插队超出上限
    await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.embed-drafts:' || $1::text))", [gate.embedKey.id]);
    const active = await db.query<{ count: string }>("select count(*) from booking_drafts where embed_key_id = $1 and expires_at > $2", [gate.embedKey.id, now]);
    if (Number(active.rows[0]?.count ?? 0) >= EMBED_RULES.activeDraftsPerKey) throw embedDraftLimit();
    const count = Number(active.rows[0]?.count ?? 0) + 1;
    // 到上限的 80% 写告警日志（运维告警按它报）：可能有人伪造 Origin 在占满上限，运营可以给合作网站换码（ADR 0090 第五节第 1 小节）
    // 只在刚到 4,000 和之后每多 250 个时写一条，不是每建一个都写
    if (count >= EMBED_RULES.activeDraftsWarnAt && (count - EMBED_RULES.activeDraftsWarnAt) % 250 === 0) log?.warn({ event: "embed.draft_limit_near", embed_key_id: gate.embedKey.id, active: count, limit: EMBED_RULES.activeDraftsPerKey }, "嵌入码的有效预订草稿接近上限");
    return insertBookingDraft(db, body.draft as BookingDraft, { embedKeyId: gate.embedKey.id, embedOrigin: gate.origin, returnUrl, delivery: body.delivery ?? null }, now);
  });
}

// ---- 来源统计 ----

/** 官网询价带了 `draft_id`：草稿有效、有来源时，给这次返回的每个报价记下来源。草稿过期、不存在、没有来源时什么都不做 */
export async function recordQuoteEmbedSources(ctx: AppContext, draftId: string | undefined, quoteIds: readonly string[]): Promise<void> {
  if (draftId === undefined || quoteIds.length === 0) return;
  await withPlatformTx(ctx.pool, async (db) => {
    const now = ctx.now();
    const draft = await findLiveBookingDraft(db, draftId, now);
    if (draft === null || draft.source === null) return;
    for (const quoteId of quoteIds) {
      await db.query("insert into quote_embed_sources (quote_id, embed_key_id, embed_origin, return_url, delivery, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (quote_id) do nothing", [
        quoteId,
        draft.source.embedKeyId,
        draft.source.embedOrigin,
        draft.source.returnUrl,
        draft.source.delivery,
        now,
      ]);
    }
  });
}

/** delivery（M9E-16）：redirect 跳主站下单、host_page 在合作网站页面里下单；旧来源为空，按 redirect 算 */
export type OrderEntrySource = { kind: "embed"; embedKeyId: string; embedKeyName: string; embedOrigin: string; returnUrl: string | null; delivery: EmbedDelivery } | { kind: "book" };

/** 下单后：按报价的来源再核一次当前的嵌入码和白名单，通过才记到订单上（同一张单只记一次）。返回记下的来源 */
export async function recordOrderEmbedSource(ctx: AppContext, orderId: string, quoteId: string): Promise<OrderEntrySource> {
  return withPlatformTx(ctx.pool, async (db) => {
    const source = await db.query<{ embed_key_id: string; embed_origin: string; return_url: string | null; delivery: EmbedDelivery | null }>("select embed_key_id, embed_origin, return_url, delivery from quote_embed_sources where quote_id = $1", [quoteId]);
    const row = source.rows[0];
    if (row === undefined) return { kind: "book" };
    const key = await db.query<EmbedKeyRow>(`select ${COLUMNS} from embed_keys where id = $1 and status = 'active'`, [row.embed_key_id]);
    const embedKey = key.rows[0] === undefined ? null : fromRow(key.rows[0]);
    if (embedKey === null || !embedKey.allowedOrigins.includes(row.embed_origin)) return { kind: "book" };
    const returnUrl = row.return_url === null ? null : embedReturnUrl(row.return_url, row.embed_origin, embedKey.allowedOrigins, originOptions(ctx));
    await db.query("insert into order_embed_sources (order_id, embed_key_id, embed_origin, return_url, delivery, created_at) values ($1, $2, $3, $4, $5, $6) on conflict (order_id) do nothing", [
      orderId,
      embedKey.id,
      row.embed_origin,
      returnUrl,
      row.delivery,
      ctx.now(),
    ]);
    return { kind: "embed", embedKeyId: embedKey.id, embedKeyName: embedKey.name, embedOrigin: row.embed_origin, returnUrl, delivery: row.delivery ?? "redirect" };
  });
}

/** 订单的来源（运营后台、官网订单页用；供应商接口不调用） */
export async function orderEntrySource(ctx: AppContext, orderId: string): Promise<OrderEntrySource> {
  const result = await withPlatformTx(
    ctx.pool,
    (db) =>
      db.query<{ embed_key_id: string; name: string; embed_origin: string; return_url: string | null; delivery: EmbedDelivery | null }>(
        "select s.embed_key_id, k.name, s.embed_origin, s.return_url, s.delivery from order_embed_sources s join embed_keys k on k.id = s.embed_key_id where s.order_id = $1",
        [orderId],
      ),
    { snapshot: true },
  );
  const row = result.rows[0];
  return row === undefined ? { kind: "book" } : { kind: "embed", embedKeyId: row.embed_key_id, embedKeyName: row.name, embedOrigin: row.embed_origin, returnUrl: row.return_url, delivery: row.delivery ?? "redirect" };
}
