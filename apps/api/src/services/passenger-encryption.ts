/**
 * 乘客信息的回填（M4-22，ADR 0057）：把明文列已有、密文列还没有（或是旧密钥算的）的行加密。四张表：订单、改单、推送、给客人的通知。
 *
 * - 幂等：选中的条件就是「没有当前密钥的密文」，加密完就不会再被选中；可以随时中断，下一轮接着做。
 * - 多实例安全：`for update skip locked`，别的实例或业务事务锁着的行这一轮跳过，下一轮再来。
 * - 不影响线上：一批一个短事务、批次之间停一下；不改 `version`、`updated_at`，读请求不受锁影响。
 * - 脱敏过的单、明文只是占位的行不处理（没有可加密的内容）。
 * - 日志和命令行输出只有数量和错误码。
 */
import { ANONYMIZED_TEXT, ENCRYPTED_TEXT, type PassengerContact, containsPassenger, isPassengerPlaceholder, passengersArePlaceholders } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, passengerCryptoOfPool, withPlatformTx } from "../db/context.ts";
import { driverErrorCode } from "../db/pool.ts";
import type { PassengerCrypto } from "../integrations/passenger-crypto.ts";

export const BACKFILL_TABLES = ["orders", "order_changes", "webhook_deliveries", "notifications"] as const;
export type BackfillTable = (typeof BACKFILL_TABLES)[number];

export type BackfillCounts = Record<BackfillTable, number>;

interface Log {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const DEFAULT_BATCH = 100;
const PAUSE_MS = 50;
const FIRST_TICK_MS = 30_000;
const TICK_INTERVAL_MS = 3_600_000;
const STOP_WAIT_MS = 5_000;
/** 每轮最多多少批，防止一轮跑太久；剩下的下一轮接着做。 */
const MAX_BATCHES_PER_TICK = 500;

type Row = Record<string, any>;

interface Target {
  /** 还要加密的行。$1：当前密钥的前缀（like），$2：游标，$3：一批多少 */
  pending: string;
  /** 这些条件数数量用：$1 是前缀 */
  count: string;
  encrypt(db: Db, crypto: PassengerCrypto, row: Row): Promise<boolean>;
}

const notCurrent = (column: string): string => `(${column} is null or ${column} not like $1)`;
const orderNotAnonymized = (alias: string): string => `not exists (select 1 from orders o where o.id = ${alias}.order_id and o.passenger_anonymized_at is not null)`;

const ORDERS_WHERE = `${notCurrent("t.passenger_enc")} and t.passenger_anonymized_at is null and t.passenger ->> 'name' not in ('${ANONYMIZED_TEXT}', '${ENCRYPTED_TEXT}')`;
const CHANGES_WHERE = `${notCurrent("t.values_enc")} and (t.before ? 'passenger' or t.after ? 'passenger') and ${orderNotAnonymized("t")}`;
const DELIVERIES_WHERE = `${notCurrent("t.event_data_enc")} and jsonb_path_exists(t.event_data, '$.**.passenger') and ${orderNotAnonymized("t")}`;
const NOTIFICATIONS_WHERE = `${notCurrent("t.recipient_enc")} and t.audience = 'guest' and t.tenant_id is not null and t.recipient not in ('${ANONYMIZED_TEXT}', '${ENCRYPTED_TEXT}')`;

/** 每批按 (id, tenant_id) 往后走：同一轮里不会反复撞到同一条处理不了的行。 */
const pendingSql = (table: string, columns: string, where: string): string =>
  `select t.tenant_id, t.id, ${columns} from ${table} t where ${where} and ($2::text is null or (t.id::text, coalesce(t.tenant_id::text, '')) > (split_part($2, '|', 1), split_part($2, '|', 2))) order by t.id::text, coalesce(t.tenant_id::text, '') limit $3 for update of t skip locked`;

const TARGETS: Record<BackfillTable, Target> = {
  orders: {
    pending: pendingSql("orders", "t.passenger", ORDERS_WHERE),
    count: `select count(*)::int as n from orders t where ${ORDERS_WHERE}`,
    async encrypt(db, crypto, row) {
      const passenger = row["passenger"] as PassengerContact;
      const sealed = crypto.sealOrderPassenger(row["tenant_id"], row["id"], passenger);
      // 条件里再比一次明文：选中之后这一行被改过就不写（实际上锁着不会变，防的是以后有人去掉锁）
      const updated = await db.query(
        "update orders set passenger_enc = $3, passenger_email_bidx = $4, passenger_phone_bidx = $5, passenger_name_bidx = $6 where tenant_id = $1 and id = $2 and passenger = $7::jsonb and passenger_anonymized_at is null",
        [row["tenant_id"], row["id"], sealed.enc, sealed.emailBidx, sealed.phoneBidx, sealed.nameBidx, JSON.stringify(passenger)],
      );
      return (updated.rowCount ?? 0) === 1;
    },
  },
  order_changes: {
    pending: pendingSql("order_changes", "t.before, t.after", CHANGES_WHERE),
    count: `select count(*)::int as n from order_changes t where ${CHANGES_WHERE}`,
    async encrypt(db, crypto, row) {
      const values = { before: row["before"], after: row["after"] };
      if (passengersArePlaceholders(values)) return false;
      const sealed = crypto.sealValues("order_change", row["tenant_id"], row["id"], values);
      const updated = await db.query("update order_changes set values_enc = $3 where tenant_id = $1 and id = $2", [row["tenant_id"], row["id"], sealed.enc]);
      return (updated.rowCount ?? 0) === 1;
    },
  },
  webhook_deliveries: {
    pending: pendingSql("webhook_deliveries", "t.event_id, t.event_data", DELIVERIES_WHERE),
    count: `select count(*)::int as n from webhook_deliveries t where ${DELIVERIES_WHERE}`,
    async encrypt(db, crypto, row) {
      if (passengersArePlaceholders(row["event_data"])) return false;
      const sealed = crypto.sealValues("webhook_delivery", row["tenant_id"], row["event_id"], row["event_data"]);
      const updated = await db.query("update webhook_deliveries set event_data_enc = $2 where id = $1", [row["id"], sealed.enc]);
      return (updated.rowCount ?? 0) === 1;
    },
  },
  notifications: {
    pending: pendingSql("notifications", "t.event_id, t.recipient", NOTIFICATIONS_WHERE),
    count: `select count(*)::int as n from notifications t where ${NOTIFICATIONS_WHERE}`,
    async encrypt(db, crypto, row) {
      const sealed = crypto.sealRecipient(row["tenant_id"], row["event_id"], row["recipient"]);
      const updated = await db.query("update notifications set recipient_enc = $2 where id = $1", [row["id"], sealed.enc]);
      return (updated.rowCount ?? 0) === 1;
    },
  },
};

const emptyCounts = (): BackfillCounts => ({ orders: 0, order_changes: 0, webhook_deliveries: 0, notifications: 0 });

function cryptoFor(ctx: AppContext): PassengerCrypto & { currentPrefix: string } {
  const crypto = passengerCryptoOfPool(ctx.pool);
  if (crypto.currentPrefix === null) throw new Error("没有配置 DATA_ENCRYPTION_KEY");
  return crypto as PassengerCrypto & { currentPrefix: string };
}

/** dry-run：每张表还有多少行要加密。 */
export async function planPassengerBackfill(ctx: AppContext): Promise<BackfillCounts> {
  const crypto = cryptoFor(ctx);
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const counts = emptyCounts();
      for (const table of BACKFILL_TABLES) counts[table] = (await db.query<{ n: number }>(TARGETS[table].count, [`${crypto.currentPrefix}%`])).rows[0]?.n ?? 0;
      return counts;
    },
    { snapshot: true },
  );
}

export interface BackfillBatchResult {
  encrypted: number;
  /** 这一批处理不了的（出错、明文只有占位）；不重试，下一轮再来 */
  failed: number;
  /** 这一批选中了几行：少于批大小说明这张表这一轮走完了 */
  selected: number;
  cursor: string | null;
}

/** 处理一批。一个事务；每行一个保存点，一行出错只跳过这一行。 */
export async function backfillBatch(ctx: AppContext, table: BackfillTable, cursor: string | null, limit: number = DEFAULT_BATCH, log?: Log): Promise<BackfillBatchResult> {
  const crypto = cryptoFor(ctx);
  return withPlatformTx(ctx.pool, async (db) => {
    const rows = (await db.query<Row>(TARGETS[table].pending, [`${crypto.currentPrefix}%`, cursor, limit])).rows;
    let encrypted = 0;
    let failed = 0;
    let last = cursor;
    for (const row of rows) {
      last = `${row["id"]}|${row["tenant_id"] ?? ""}`;
      await db.query("savepoint passenger_backfill");
      try {
        if (await TARGETS[table].encrypt(db, crypto, row)) encrypted += 1;
        else failed += 1;
        await db.query("release savepoint passenger_backfill");
      } catch (err) {
        await db.query("rollback to savepoint passenger_backfill");
        failed += 1;
        log?.error({ event: "passenger.backfill_row_failed", table, code: driverErrorCode(err) }, "这一行加密失败，下一轮再试");
      }
    }
    return { encrypted, failed, selected: rows.length, cursor: last };
  });
}

export interface BackfillRunResult {
  encrypted: BackfillCounts;
  failed: number;
  batches: number;
}

/** 跑一轮：四张表依次走到头。`stop` 返回真时做完这一批就停（服务关闭、测试模拟中断）。 */
export async function runPassengerBackfill(ctx: AppContext, options: { batchSize?: number; maxBatches?: number; pauseMs?: number; stop?: () => boolean; log?: Log } = {}): Promise<BackfillRunResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_TICK;
  const pauseMs = options.pauseMs ?? PAUSE_MS;
  const result: BackfillRunResult = { encrypted: emptyCounts(), failed: 0, batches: 0 };
  for (const table of BACKFILL_TABLES) {
    let cursor: string | null = null;
    while (result.batches < maxBatches && !options.stop?.()) {
      const batch: BackfillBatchResult = await backfillBatch(ctx, table, cursor, batchSize, options.log);
      result.batches += 1;
      result.encrypted[table] += batch.encrypted;
      result.failed += batch.failed;
      cursor = batch.cursor;
      if (batch.selected < batchSize) break;
      if (pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  }
  return result;
}

export interface VerifyResult {
  checked: BackfillCounts;
  /** 解不开的行 */
  undecryptable: BackfillCounts;
  /** 解开了但和明文对不上的行 */
  mismatched: BackfillCounts;
}

const VERIFY_SQL: Record<BackfillTable, string> = {
  orders: "select tenant_id, id, id::text as owner_id, passenger as plain, passenger_enc as enc from orders where passenger_enc like $1 and (id::text, tenant_id::text) > ($2, $3) order by id::text, tenant_id::text limit $4",
  order_changes: "select tenant_id, id, id::text as owner_id, jsonb_build_object('before', before, 'after', after) as plain, values_enc as enc from order_changes where values_enc like $1 and (id::text, tenant_id::text) > ($2, $3) order by id::text, tenant_id::text limit $4",
  webhook_deliveries: "select tenant_id, id, event_id::text as owner_id, event_data as plain, event_data_enc as enc from webhook_deliveries where event_data_enc like $1 and (id::text, tenant_id::text) > ($2, $3) order by id::text, tenant_id::text limit $4",
  notifications: "select tenant_id, id, event_id::text as owner_id, to_jsonb(recipient) as plain, recipient_enc as enc from notifications where recipient_enc like $1 and (id::text, tenant_id::text) > ($2, $3) order by id::text, tenant_id::text limit $4",
};

const VERIFY_KIND = { orders: "order", order_changes: "order_change", webhook_deliveries: "webhook_delivery", notifications: "notification" } as const;

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => sameJson((a as Row)[key], (b as Row)[key]));
  }
  return a === b;
}

/** 清明文之前的核对（第 6 步的前提）：每一行密文都解得开、和明文一致。只读，只出数量。明文已是占位的行只核对解得开。 */
export async function verifyPassengerEncryption(ctx: AppContext, pageSize: number = 500): Promise<VerifyResult> {
  const crypto = cryptoFor(ctx);
  const result: VerifyResult = { checked: emptyCounts(), undecryptable: emptyCounts(), mismatched: emptyCounts() };
  for (const table of BACKFILL_TABLES) {
    let afterId = "";
    let afterTenant = "";
    for (;;) {
      const rows = await withPlatformTx(ctx.pool, async (db) => (await db.query<Row>(VERIFY_SQL[table], [`${crypto.currentPrefix}%`, afterId, afterTenant, pageSize])).rows, { snapshot: true });
      for (const row of rows) {
        result.checked[table] += 1;
        const opened = crypto.openForVerify(VERIFY_KIND[table], row["tenant_id"], row["owner_id"], row["enc"]);
        if (opened === null) {
          result.undecryptable[table] += 1;
          continue;
        }
        const plain: unknown = row["plain"];
        const placeholder = table === "orders" ? isPassengerPlaceholder((plain as Row)["name"]) : table === "notifications" ? isPassengerPlaceholder(plain) : containsPassenger(plain) && passengersArePlaceholders(plain);
        if (placeholder) continue;
        const decrypted: unknown = table === "notifications" ? opened : JSON.parse(opened);
        if (!sameJson(decrypted, plain)) result.mismatched[table] += 1;
      }
      const last = rows.at(-1);
      if (last === undefined || rows.length < pageSize) break;
      afterId = String(last["id"]);
      afterTenant = String(last["tenant_id"] ?? "");
    }
  }
  return result;
}

/** 后台任务：启动 30 秒后第一次，之后每小时一轮（代码回退过、密钥换过时能自己补上）。没配置主密钥或开关关闭时什么都不做。 */
export class PassengerEncryptionJobs {
  private readonly ctx: AppContext;
  private readonly log: Log;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: Log) {
    this.ctx = ctx;
    this.log = log;
  }

  private get enabled(): boolean {
    return passengerCryptoOfPool(this.ctx.pool).backfillEnabled;
  }

  async tick(): Promise<BackfillRunResult | null> {
    if (!this.enabled) return null;
    const result = await runPassengerBackfill(this.ctx, { stop: () => this.stopped, log: this.log });
    const total = BACKFILL_TABLES.reduce((sum, table) => sum + result.encrypted[table], 0);
    if (total > 0 || result.failed > 0) this.log.info({ event: "passenger.backfill", encrypted: result.encrypted, failed: result.failed, batches: result.batches }, "乘客信息回填");
    return result;
  }

  start(): void {
    if (!this.stopped || !this.enabled) return;
    this.stopped = false;
    this.schedule(FIRST_TICK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.error({ code: driverErrorCode(err) }, "乘客信息回填这一轮失败"))
        .finally(() => {
          this.ticking = null;
          this.schedule(TICK_INTERVAL_MS);
        });
    }, delay);
    this.timer.unref();
  }
}
