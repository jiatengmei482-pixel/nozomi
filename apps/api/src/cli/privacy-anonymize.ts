/**
 * `pnpm privacy:anonymize`：看有多少单到了乘客信息的脱敏期限（ADR 0055）。默认 dry-run，只打印数量，不改任何数据。
 * `--execute` 才真正跑一轮（和定时任务同一份逻辑，多实例安全）。脱敏不可逆；开关 `PASSENGER_RETENTION_ENABLED=false` 时拒绝。
 * 输出只有数量和时间范围，没有订单编号和乘客信息。
 */
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@nozomi/config";
import type { AppContext } from "../context.ts";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { planPassengerRetention, runPassengerRetention } from "../services/passenger-retention.ts";

const USAGE = "用法：pnpm privacy:anonymize [--dry-run]（默认，只看数量）\n      pnpm privacy:anonymize --execute（真正脱敏一轮，不可逆）";

const BLOCKER_NAMES: Record<string, string> = {
  open_ticket: "未结工单或赔付没付完",
  open_statement: "账单未结",
  payment_pending: "收款还没有结果",
  carried_balance: "账单转入下期，后续账单还没结清",
  carried_terminated: "账单转入下期，供应商已清退，结不了（要人工处理）",
  unbilled: "应付还没出账",
  dispute: "争议中（拒付、加收）",
  refund: "退款没走完",
  open_work: "异常、改单、救援、复核没结束",
  sending: "通知或推送还在发",
};

class UsageError extends Error {}

function readMode(argv: readonly string[]): "dry-run" | "execute" {
  let values: { "dry-run"?: boolean | undefined; execute?: boolean | undefined };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { "dry-run": { type: "boolean" }, execute: { type: "boolean" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  if (values["dry-run"] === true && values.execute === true) throw new UsageError("--dry-run 和 --execute 只能选一个。");
  return values.execute === true ? "execute" : "dry-run";
}

const day = (at: Date | null): string => (at === null ? "无" : at.toISOString().slice(0, 10));

async function main(): Promise<void> {
  const mode = readMode(process.argv.slice(2));
  const config = loadConfig();
  if (mode === "execute" && !config.passengerRetention.enabled) throw new UsageError("PASSENGER_RETENTION_ENABLED 是 false：开关关闭时不能执行。");
  const pool = createPool(config.databaseUrl, { max: 2 });
  const ctx = { pool, config, now: () => new Date() } as unknown as AppContext;
  try {
    const plan = await planPassengerRetention(ctx);
    console.log(`保存期限 ${plan.retentionDays} 天；结束时间早于 ${plan.cutoff.toISOString()} 的单算超过期限（东京日历日）。自动任务：${config.passengerRetention.enabled ? "开" : "关"}`);
    console.log(`超过期限、还没脱敏：${plan.summary.aged} 单；现在可以脱敏：${plan.summary.ready} 单（结束日期 ${day(plan.summary.earliestEndedAt)} ~ ${day(plan.summary.latestEndedAt)}，UTC）`);
    for (const [key, count] of Object.entries(plan.summary.blocked)) if (count > 0) console.log(`  等结案：${BLOCKER_NAMES[key] ?? key} ${count} 单`);
    if (mode === "dry-run") {
      console.log("这是 dry-run，没有改任何数据。");
      return;
    }
    const result = await runPassengerRetention(ctx, { info: () => undefined, error: (obj) => console.error(`有一单失败，下一轮再试（错误码 ${(obj as { code?: string | null }).code ?? "未知"}）`) }, "cli");
    console.log(result.busy ? "别的实例正在跑，这次没有做。" : `已脱敏 ${result.anonymized} 单，跳过 ${result.skipped} 单。`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n${USAGE}`);
  } else if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\n怎么配置：见 docs/secrets.md");
  } else if (err instanceof DbIdentityError) {
    console.error(`没有改动：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(`没有改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并已执行迁移。`);
  } else {
    console.error(`没有改动：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exitCode = 1;
}
