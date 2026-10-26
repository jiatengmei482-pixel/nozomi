/**
 * 赔付表的数据访问（M4-02，ADR 0034）。全平台一份，按版本追加；还没有任何版本时用 @nozomi/domain 的默认表（需求原表，版本 0）。
 * 平台表，只有平台事务能读写（批准复核时追加）。
 */
import { COMPENSATION_SCENARIOS, type CompensationScenario, type CompensationTable, DEFAULT_COMPENSATION_TABLE } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface StoredCompensationTable extends CompensationTable {
  /** 这一版什么时候生效的；默认表为 null */
  createdAt: Date | null;
  approvalId: string | null;
}

/** 库里存的（接口的写法）。 */
export interface CompensationRulesJson {
  customer_bp: Record<CompensationScenario, number>;
  minimum_jpy: number;
  reimbursement_cap_bp: number;
  review_at_or_above_sell_bp: number;
}

export function rulesJson(table: Omit<CompensationTable, "version">): CompensationRulesJson {
  return {
    customer_bp: Object.fromEntries(COMPENSATION_SCENARIOS.map((scenario) => [scenario, table.customerBp[scenario]])) as Record<CompensationScenario, number>,
    minimum_jpy: table.minimumJpy,
    reimbursement_cap_bp: table.reimbursementCapBp,
    review_at_or_above_sell_bp: table.reviewAtOrAboveSellBp,
  };
}

export function rulesFromJson(version: number, rules: CompensationRulesJson): CompensationTable {
  return { version, customerBp: { ...rules.customer_bp }, minimumJpy: rules.minimum_jpy, reimbursementCapBp: rules.reimbursement_cap_bp, reviewAtOrAboveSellBp: rules.review_at_or_above_sell_bp };
}

export async function currentCompensationTable(db: Db): Promise<StoredCompensationTable> {
  const row = (await db.query<Row>("select version, rules, created_at, approval_id from compensation_tables order by version desc limit 1")).rows[0];
  if (row === undefined) return { ...DEFAULT_COMPENSATION_TABLE, customerBp: { ...DEFAULT_COMPENSATION_TABLE.customerBp }, createdAt: null, approvalId: null };
  return { ...rulesFromJson(row["version"], row["rules"]), createdAt: row["created_at"], approvalId: row["approval_id"] };
}

/** 两个批准同时生效时排队（事务结束自动释放）：后到的看到前一个写入的新版本，按「已过时」处理。 */
export async function lockCompensationTable(db: Db): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.compensation-table'))");
}

export async function insertCompensationTable(db: Db, table: { version: number; rules: CompensationRulesJson; approvalId: string; requestedBy: string; approvedBy: string; now: Date }): Promise<void> {
  await db.query("insert into compensation_tables (version, rules, approval_id, requested_by, approved_by, created_at) values ($1, $2::jsonb, $3, $4, $5, $6)", [
    table.version, JSON.stringify(table.rules), table.approvalId, table.requestedBy, table.approvedBy, table.now,
  ]);
}
