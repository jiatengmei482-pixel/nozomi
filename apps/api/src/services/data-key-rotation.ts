/**
 * 换数据加密主密钥（ADR 0106）：把旧主密钥写的密文逐行解开、用新主密钥重新加密。
 *
 * - 由服务器上的管理员命令运行（`cli/data-key-rotation.ts`），用迁移账号（表的所有者）连库：供应商收款账号的密文列平台角色改不了（迁移 0160 的触发器），
 *   只有所有者能换；其余表也统一在这里换，不经过业务接口。
 * - 只换密文本身，内容不变：乘客信息和人工报价申请的盲索引一起按新密钥重算；人工报价的去重键不重算（只在 24 小时内有用，算不回原文）。
 * - 每张表一批一个短事务，`for update skip locked`，条件里再比一次旧密文：业务事务刚改过的行不会被旧内容覆盖。可以中断、重复运行。
 * - 带密钥标记的（乘客信息、人工报价）在库里按前缀数；不带标记的四种（Webhook 签名密钥、两步验证密钥、后台填写的第三方密钥、收款账号）行数很少，逐行试解。
 * - 输出只有表名和数量。
 */
import type { PassengerContact } from "@nozomi/domain";
import type { Pool, PoolClient } from "pg";
import { MANUAL_QUOTE_OWNER, type PassengerCrypto, type SealKind } from "../integrations/passenger-crypto.ts";
import type { SecretBox, SecretPurpose } from "../integrations/secret-box.ts";

type Row = Record<string, any>;

export interface RotationKeys {
  /** 带着旧主密钥的 SecretBox（`previous` 不为空） */
  box: SecretBox;
  crypto: PassengerCrypto;
}

interface Opened {
  /** 新密钥写进去的列和值 */
  set: Record<string, string | null>;
}

/** 带密钥标记的列：旧密钥的行按前缀选出来。 */
interface TaggedTarget {
  name: string;
  table: string;
  column: string;
  /** 定位一行的列（update 的条件） */
  keys: string[];
  /** 还要读的列 */
  extra?: string[];
  /** 解开旧密文、用新密钥加密；解不开返回 null */
  rekey(crypto: PassengerCrypto, row: Row): Opened | null;
}

/** 不带标记的列（SecretBox 直接存）：整表逐行试解。 */
interface SealedTarget {
  name: string;
  table: string;
  column: string;
  keys: string[];
  purpose: SecretPurpose;
  owner(row: Row): string;
}

const reseal = (crypto: PassengerCrypto, kind: SealKind, tenantId: string, id: string, enc: string, seal: (text: string) => Record<string, string | null>): Opened | null => {
  const text = crypto.openPrevious(kind, tenantId, id, enc);
  return text === null ? null : { set: seal(text) };
};

const sealRecipient = (crypto: PassengerCrypto, tenantId: string, id: string, column: string) => (text: string) => ({ [column]: crypto.sealRecipient(tenantId, id, text).enc });

export const TAGGED_TARGETS: readonly TaggedTarget[] = [
  {
    name: "orders",
    table: "orders",
    column: "passenger_enc",
    keys: ["tenant_id", "id"],
    rekey: (crypto, row) =>
      reseal(crypto, "order", row["tenant_id"], row["id"], row["passenger_enc"], (text) => {
        const sealed = crypto.sealOrderPassenger(row["tenant_id"], row["id"], JSON.parse(text) as PassengerContact);
        return { passenger_enc: sealed.enc, passenger_email_bidx: sealed.emailBidx, passenger_phone_bidx: sealed.phoneBidx, passenger_name_bidx: sealed.nameBidx };
      }),
  },
  {
    name: "order_changes",
    table: "order_changes",
    column: "values_enc",
    keys: ["tenant_id", "id"],
    rekey: (crypto, row) => reseal(crypto, "order_change", row["tenant_id"], row["id"], row["values_enc"], (text) => ({ values_enc: crypto.sealValues("order_change", row["tenant_id"], row["id"], JSON.parse(text)).enc })),
  },
  {
    name: "webhook_deliveries",
    table: "webhook_deliveries",
    column: "event_data_enc",
    keys: ["id"],
    extra: ["tenant_id", "event_id"],
    rekey: (crypto, row) => reseal(crypto, "webhook_delivery", row["tenant_id"], row["event_id"], row["event_data_enc"], (text) => ({ event_data_enc: crypto.sealValues("webhook_delivery", row["tenant_id"], row["event_id"], JSON.parse(text)).enc })),
  },
  {
    name: "notifications",
    table: "notifications",
    column: "recipient_enc",
    keys: ["id"],
    extra: ["tenant_id", "event_id"],
    rekey: (crypto, row) => (row["tenant_id"] === null ? null : reseal(crypto, "notification", row["tenant_id"], row["event_id"], row["recipient_enc"], sealRecipient(crypto, row["tenant_id"], row["event_id"], "recipient_enc"))),
  },
  {
    name: "passenger_email_changes.email",
    table: "passenger_email_changes",
    column: "email_enc",
    keys: ["id"],
    extra: ["seal_tenant_id"],
    rekey: (crypto, row) => reseal(crypto, "notification", row["seal_tenant_id"], row["id"], row["email_enc"], sealRecipient(crypto, row["seal_tenant_id"], row["id"], "email_enc")),
  },
  {
    name: "passenger_email_changes.previous_email",
    table: "passenger_email_changes",
    column: "previous_email_enc",
    keys: ["id"],
    extra: ["seal_tenant_id"],
    rekey: (crypto, row) => reseal(crypto, "notification", row["seal_tenant_id"], `${row["id"]}:previous`, row["previous_email_enc"], sealRecipient(crypto, row["seal_tenant_id"], `${row["id"]}:previous`, "previous_email_enc")),
  },
  {
    name: "view_link_requests",
    table: "view_link_requests",
    column: "recipient_enc",
    keys: ["id"],
    extra: ["seal_tenant_id"],
    rekey: (crypto, row) => reseal(crypto, "notification", row["seal_tenant_id"], row["id"], row["recipient_enc"], sealRecipient(crypto, row["seal_tenant_id"], row["id"], "recipient_enc")),
  },
  {
    name: "manual_quote_requests",
    table: "manual_quote_requests",
    column: "contact_enc",
    keys: ["id"],
    rekey: (crypto, row) =>
      reseal(crypto, "manual_quote_request", MANUAL_QUOTE_OWNER, row["id"], row["contact_enc"], (text) => {
        const contact = JSON.parse(text) as { email: string | null; whatsapp: string | null };
        return {
          contact_enc: crypto.sealManualQuote("manual_quote_request", row["id"], text),
          email_bidx: contact.email === null ? null : crypto.manualQuoteIndex("email", contact.email),
          whatsapp_bidx: contact.whatsapp === null ? null : crypto.manualQuoteIndex("phone", contact.whatsapp),
        };
      }),
  },
  {
    name: "manual_quote_request_events",
    table: "manual_quote_request_events",
    column: "note_enc",
    keys: ["id"],
    rekey: (crypto, row) => reseal(crypto, "manual_quote_note", MANUAL_QUOTE_OWNER, row["id"], row["note_enc"], (text) => ({ note_enc: crypto.sealManualQuote("manual_quote_note", row["id"], text) })),
  },
];

export const SEALED_TARGETS: readonly SealedTarget[] = [
  { name: "tenant_webhooks", table: "tenant_webhooks", column: "secret_ciphertext", keys: ["tenant_id"], purpose: "tenant-webhook-secret", owner: (row) => row["tenant_id"] },
  { name: "platform_users.totp", table: "platform_users", column: "totp_secret", keys: ["id"], purpose: "platform-totp-secret", owner: (row) => row["id"] },
  { name: "integration_secrets", table: "integration_secrets", column: "sealed", keys: ["integration"], purpose: "integration-secret", owner: (row) => row["integration"] },
  { name: "payout_accounts", table: "payout_accounts", column: "account_sealed", keys: ["tenant_id", "id"], purpose: "payout-account", owner: (row) => `${row["tenant_id"]}:${row["id"]}` },
];

export const ROTATION_TARGETS: readonly string[] = [...TAGGED_TARGETS.map((target) => target.name), ...SEALED_TARGETS.map((target) => target.name)];

export interface TargetCounts {
  /** 还是旧密钥的 */
  previous: number;
  /** 新旧两把都解不开的：换完以后也读不出来，要人工看 */
  unreadable: number;
}

export type RotationPlan = Record<string, TargetCounts>;

export interface RotationRun {
  rekeyed: Record<string, number>;
  /** 选中了但没换成（解不开、刚被别的事务改过） */
  failed: number;
}

const DEFAULT_BATCH = 200;

async function inTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

function prefixes(crypto: PassengerCrypto): { current: string; previous: string } {
  if (crypto.currentPrefix === null || crypto.previousPrefix === null) throw new Error("换密钥要同时有新主密钥和旧主密钥");
  return { current: `${crypto.currentPrefix}%`, previous: `${crypto.previousPrefix}%` };
}

function sealedState(box: SecretBox, target: SealedTarget, row: Row): "current" | "previous" | "unreadable" {
  const sealed = row[target.column] as string;
  try {
    box.openCurrent(target.purpose, target.owner(row), sealed);
    return "current";
  } catch {
    try {
      box.previous?.openCurrent(target.purpose, target.owner(row), sealed);
      return box.previous === null ? "unreadable" : "previous";
    } catch {
      return "unreadable";
    }
  }
}

/** dry-run：每张表还有几行是旧密钥、几行两把都解不开。只读。 */
export async function planDataKeyRotation(pool: Pool, keys: RotationKeys): Promise<RotationPlan> {
  const { current, previous } = prefixes(keys.crypto);
  const plan: RotationPlan = {};
  for (const target of TAGGED_TARGETS) {
    const row = (
      await pool.query<{ previous: number; unreadable: number }>(
        `select count(*) filter (where ${target.column} like $2)::int as previous,
                count(*) filter (where ${target.column} not like $1 and ${target.column} not like $2)::int as unreadable
           from ${target.table} where ${target.column} is not null`,
        [current, previous],
      )
    ).rows[0];
    plan[target.name] = { previous: row?.previous ?? 0, unreadable: row?.unreadable ?? 0 };
  }
  for (const target of SEALED_TARGETS) {
    const counts: TargetCounts = { previous: 0, unreadable: 0 };
    const rows = (await pool.query<Row>(`select ${[...target.keys, target.column].join(", ")} from ${target.table} where ${target.column} is not null`)).rows;
    for (const row of rows) {
      const state = sealedState(keys.box, target, row);
      if (state !== "current") counts[state] += 1;
    }
    plan[target.name] = counts;
  }
  return plan;
}

const where = (keys: string[], offset: number): string => keys.map((key, index) => `${key} = $${index + offset}`).join(" and ");

/** 游标：定位列拼成一段文字，按它往后走，解不开的行不会在下一批又被选中。 */
const cursorOf = (keys: string[]): string => `concat_ws('|', ${keys.map((key) => `${key}::text`).join(", ")})`;

async function rekeyTaggedBatch(pool: Pool, keys: RotationKeys, target: TaggedTarget, cursor: string | null, limit: number): Promise<{ rekeyed: number; failed: number; selected: number; cursor: string | null }> {
  const { previous } = prefixes(keys.crypto);
  return inTx(pool, async (client) => {
    const columns = [...new Set([...target.keys, ...(target.extra ?? []), target.column])];
    const rows = (
      await client.query<Row>(
        `select ${columns.join(", ")}, ${cursorOf(target.keys)} as rotation_cursor from ${target.table}
          where ${target.column} like $1 and ($2::text is null or ${cursorOf(target.keys)} > $2)
          order by ${cursorOf(target.keys)} limit $3 for update skip locked`,
        [previous, cursor, limit],
      )
    ).rows;
    let rekeyed = 0;
    let failed = 0;
    for (const row of rows) {
      const opened = target.rekey(keys.crypto, row);
      if (opened === null) {
        failed += 1;
        continue;
      }
      const sets = Object.keys(opened.set);
      const values = [...sets.map((column) => opened.set[column]), ...target.keys.map((key) => row[key]), row[target.column]];
      const updated = await client.query(
        `update ${target.table} set ${sets.map((column, index) => `${column} = $${index + 1}`).join(", ")} where ${where(target.keys, sets.length + 1)} and ${target.column} = $${sets.length + target.keys.length + 1}`,
        values,
      );
      if ((updated.rowCount ?? 0) === 1) rekeyed += 1;
      else failed += 1;
    }
    return { rekeyed, failed, selected: rows.length, cursor: rows.at(-1)?.["rotation_cursor"] ?? cursor };
  });
}

async function rekeySealed(pool: Pool, keys: RotationKeys, target: SealedTarget): Promise<{ rekeyed: number; failed: number }> {
  return inTx(pool, async (client) => {
    const rows = (await client.query<Row>(`select ${[...target.keys, target.column].join(", ")} from ${target.table} where ${target.column} is not null for update skip locked`)).rows;
    let rekeyed = 0;
    let failed = 0;
    for (const row of rows) {
      const state = sealedState(keys.box, target, row);
      if (state === "current") continue;
      if (state === "unreadable" || keys.box.previous === null) {
        failed += 1;
        continue;
      }
      const owner = target.owner(row);
      const sealed = keys.box.seal(target.purpose, owner, keys.box.previous.openCurrent(target.purpose, owner, row[target.column]));
      const updated = await client.query(`update ${target.table} set ${target.column} = $1 where ${where(target.keys, 2)} and ${target.column} = $${target.keys.length + 2}`, [sealed, ...target.keys.map((key) => row[key]), row[target.column]]);
      if ((updated.rowCount ?? 0) === 1) rekeyed += 1;
      else failed += 1;
    }
    return { rekeyed, failed };
  });
}

/**
 * 换一遍：每张表一批一批做到没有旧密钥的行（或这一批全都换不成）为止。解不开的行留着、计入 `failed`，不挡别的行。
 * `stop` 返回真时做完这一批就停。
 */
export async function runDataKeyRotation(pool: Pool, keys: RotationKeys, options: { batchSize?: number; stop?: () => boolean } = {}): Promise<RotationRun> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const run: RotationRun = { rekeyed: Object.fromEntries(ROTATION_TARGETS.map((name) => [name, 0])), failed: 0 };
  for (const target of TAGGED_TARGETS) {
    let cursor: string | null = null;
    for (;;) {
      if (options.stop?.()) return run;
      const batch = await rekeyTaggedBatch(pool, keys, target, cursor, batchSize);
      run.rekeyed[target.name] = (run.rekeyed[target.name] ?? 0) + batch.rekeyed;
      run.failed += batch.failed;
      if (batch.selected < batchSize) break;
      cursor = batch.cursor;
    }
  }
  for (const target of SEALED_TARGETS) {
    if (options.stop?.()) return run;
    const result = await rekeySealed(pool, keys, target);
    run.rekeyed[target.name] = (run.rekeyed[target.name] ?? 0) + result.rekeyed;
    run.failed += result.failed;
  }
  return run;
}

/** 全部换完、没有解不开的：可以删掉旧主密钥了。 */
export function rotationDone(plan: RotationPlan): boolean {
  return Object.values(plan).every((counts) => counts.previous === 0 && counts.unreadable === 0);
}
