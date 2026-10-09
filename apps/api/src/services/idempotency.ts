/**
 * 创建类接口的幂等（需求文档「API 通用约定」：所有创建类 POST 带 `Idempotency-Key`，24 小时内同一个键返回同一结果）。
 * 通用实现，以后每个创建类的租户接口都用它（ADR 0015）。
 *
 * 做法：键的记录和业务写入在**同一个事务**里。
 * - 第一次：先插入键的记录（占位），做业务，再把应答存进记录，一起提交。业务失败则整体回滚，键没有被占用，可以带同一个键重试。
 * - 同一个键同时来两次：后到的那次在插入时等前一次的事务结束，然后读到已经存好的应答，原样返回——业务只做了一次。
 * - 同一个键、内容不同：拒绝（422），不悄悄返回上一次的结果。上一次建成的那条的编号和当时的版本号带在 `details.created` 里
 *   （存下的应答里有 `id`、`version` 时）：第一次的应答丢了、用户改了内容再存的时候，调用方可以转成对那一条的修改。
 * - 键只在「同一个租户 + 同一个接口」里有意义；过了 24 小时的键可以重新使用。
 */
import { createHash } from "node:crypto";
import type { Db } from "../db/context.ts";
import { idempotencyKeyReused } from "./errors.ts";

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IdempotentCall {
  tenantId: string;
  /** 哪个接口，如 `POST /tenant/v1/areas` */
  scope: string;
  key: string;
  /** 校验过的请求内容：同一个键只能配同样的内容 */
  request: unknown;
  now: Date;
}

export interface IdempotentResult {
  status: number;
  body: Record<string, unknown>;
  /** 这次是不是原样返回了以前存下的应答（业务没有再做一遍） */
  replayed: boolean;
}

/** 内容的指纹：对象的键按字典序排好再算，键的先后不同不算不同的内容。 */
export function requestHash(value: unknown): string {
  const canonical = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(canonical);
    if (typeof node === "object" && node !== null) {
      return Object.fromEntries(Object.keys(node).sort().map((key) => [key, canonical((node as Record<string, unknown>)[key])]));
    }
    return node;
  };
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

/**
 * 在当前的租户事务里按幂等键执行一次创建。`work` 做业务并返回应答；键以前成功用过时不调用 `work`，返回存下的应答。
 */
export async function runIdempotent(db: Db, call: IdempotentCall, work: () => Promise<{ status: number; body: Record<string, unknown> }>): Promise<IdempotentResult> {
  const hash = requestHash(call.request);
  const expiredBefore = new Date(call.now.getTime() - IDEMPOTENCY_TTL_MS);
  await db.query("delete from idempotency_keys where tenant_id = $1 and scope = $2 and key = $3 and created_at < $4", [call.tenantId, call.scope, call.key, expiredBefore]);
  const inserted = await db.query(
    `insert into idempotency_keys (tenant_id, scope, key, request_hash, created_at) values ($1, $2, $3, $4, $5)
     on conflict (tenant_id, scope, key) do nothing`,
    [call.tenantId, call.scope, call.key, hash, call.now],
  );
  if (inserted.rowCount === 0) {
    const existing = await db.query<{ request_hash: string; response_status: number | null; response_body: Record<string, unknown> | null }>(
      "select request_hash, response_status, response_body from idempotency_keys where tenant_id = $1 and scope = $2 and key = $3",
      [call.tenantId, call.scope, call.key],
    );
    const row = existing.rows[0];
    if (!row || row.response_status === null || row.response_body === null) throw idempotencyKeyReused();
    if (row.request_hash !== hash) {
      const { id, version } = row.response_body;
      throw idempotencyKeyReused(typeof id === "string" && typeof version === "number" ? { id, version } : null);
    }
    return { status: row.response_status, body: row.response_body, replayed: true };
  }
  const result = await work();
  await db.query("update idempotency_keys set response_status = $4, response_body = $5::jsonb where tenant_id = $1 and scope = $2 and key = $3", [
    call.tenantId,
    call.scope,
    call.key,
    result.status,
    JSON.stringify(result.body),
  ]);
  return { ...result, replayed: false };
}
