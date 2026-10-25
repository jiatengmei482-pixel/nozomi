/**
 * 平台统一取消政策的数据访问（M3-03，ADR 0029）。全平台一份，按版本追加；还没有任何版本时用 @nozomi/domain 的默认政策（需求表，版本 0）。
 * 平台事务、租户事务都能读（租户只读，供应商后台的取消规则只读展示它）；只有平台事务能追加（批准复核时）。
 */
import { type CancellationRule, DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface StoredCancellationPolicy {
  /** 0 = 默认政策（需求表），还没有人改过 */
  version: number;
  rules: CancellationRule[];
  /** 这一版什么时候生效的；默认政策为 null */
  createdAt: Date | null;
  approvalId: string | null;
}

export async function currentCancellationPolicy(db: Db): Promise<StoredCancellationPolicy> {
  const row = (await db.query<Row>("select version, rules, created_at, approval_id from cancellation_policies order by version desc limit 1")).rows[0];
  if (row === undefined) return { version: 0, rules: DEFAULT_CANCELLATION_POLICY.map((rule) => ({ ...rule, tiers: rule.tiers.map((tier) => ({ ...tier })) })), createdAt: null, approvalId: null };
  return { version: row["version"], rules: row["rules"], createdAt: row["created_at"], approvalId: row["approval_id"] };
}

/** 两个批准同时生效时排队（事务结束自动释放）：后到的看到前一个写入的新版本，按「已过时」处理。 */
export async function lockCancellationPolicy(db: Db): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.cancellation-policy'))");
}

export async function insertCancellationPolicy(db: Db, policy: { version: number; rules: readonly CancellationRule[]; approvalId: string; requestedBy: string; approvedBy: string; now: Date }): Promise<void> {
  await db.query("insert into cancellation_policies (version, rules, approval_id, requested_by, approved_by, created_at) values ($1, $2::jsonb, $3, $4, $5, $6)", [
    policy.version, JSON.stringify(policy.rules), policy.approvalId, policy.requestedBy, policy.approvedBy, policy.now,
  ]);
}
