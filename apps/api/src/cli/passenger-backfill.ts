/**
 * `pnpm passenger:backfill`：把已有的乘客信息加密（ADR 0057）。默认 dry-run，只打印每张表还有多少行要加密，不改任何数据。
 * `--execute` 真正跑一轮（和后台任务同一份逻辑，幂等、可中断、多实例安全）。`--verify` 核对已有的密文都解得开、和明文一致（清明文之前必须全部通过）。
 * 输出只有数量和错误码，没有订单编号和乘客信息。
 */
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@nozomi/config";
import type { AppContext } from "../context.ts";
import { attachPassengerCrypto } from "../db/context.ts";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { PassengerCrypto } from "../integrations/passenger-crypto.ts";
import { SecretBox } from "../integrations/secret-box.ts";
import { BACKFILL_TABLES, planPassengerBackfill, runPassengerBackfill, verifyPassengerEncryption } from "../services/passenger-encryption.ts";

const USAGE = "用法：pnpm passenger:backfill [--dry-run]（默认，只看数量）\n      pnpm passenger:backfill --execute（真正加密一轮，可以反复运行）\n      pnpm passenger:backfill --verify（核对密文，只读）";

class UsageError extends Error {}

function readMode(argv: readonly string[]): "dry-run" | "execute" | "verify" {
  let values: { "dry-run"?: boolean | undefined; execute?: boolean | undefined; verify?: boolean | undefined };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { "dry-run": { type: "boolean" }, execute: { type: "boolean" }, verify: { type: "boolean" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  if ([values["dry-run"], values.execute, values.verify].filter((item) => item === true).length > 1) throw new UsageError("--dry-run、--execute、--verify 只能选一个。");
  return values.execute === true ? "execute" : values.verify === true ? "verify" : "dry-run";
}

async function main(): Promise<void> {
  const mode = readMode(process.argv.slice(2));
  const config = loadConfig();
  if (config.dataEncryptionKey === null) throw new UsageError("没有配置 DATA_ENCRYPTION_KEY：不能加密。");
  const pool = createPool(config.databaseUrl, { max: 2 });
  attachPassengerCrypto(pool, new PassengerCrypto(new SecretBox(config.dataEncryptionKey), config.passengerEncryption));
  const ctx = { pool, config, now: () => new Date() } as unknown as AppContext;
  try {
    if (mode === "verify") {
      const verified = await verifyPassengerEncryption(ctx);
      for (const table of BACKFILL_TABLES) console.log(`${table}：核对 ${verified.checked[table]} 行，解不开或内容已丢 ${verified.undecryptable[table]} 行，和明文不一致 ${verified.mismatched[table]} 行`);
      console.log(`orders：盲索引和内容不一致 ${verified.indexMismatched} 行`);
      const pending = await planPassengerBackfill(ctx);
      for (const table of BACKFILL_TABLES) console.log(`${table}：还没加密 ${pending[table]} 行`);
      const bad = verified.indexMismatched > 0 || BACKFILL_TABLES.some((table) => verified.undecryptable[table] > 0 || verified.mismatched[table] > 0 || pending[table] > 0);
      console.log(bad ? "结论：还不能进入清明文那一步。" : "结论：数据全部一致。这只是清明文的前提之一，还要满足 docs/deploy.md 列的其他条件（观察一个发布周期、恢复演练、负责人知晓）；清明文不可逆。");
      if (bad) process.exitCode = 1;
      return;
    }
    const plan = await planPassengerBackfill(ctx);
    for (const table of BACKFILL_TABLES) console.log(`${table}：还要加密 ${plan[table]} 行`);
    if (mode === "dry-run") {
      console.log("这是 dry-run，没有改任何数据。");
      return;
    }
    const result = await runPassengerBackfill(ctx, { log: { info: () => undefined, error: (obj) => console.error(`有一行失败，下一轮再试（错误码 ${(obj as { code?: unknown }).code ?? "无"}）`) } });
    for (const table of BACKFILL_TABLES) console.log(`${table}：这一轮加密了 ${result.encrypted[table]} 行`);
    console.log(`失败 ${result.failed} 行，共 ${result.batches} 批。`);
    if (result.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  process.exitCode = 1;
  if (err instanceof UsageError) {
    console.error(`${err.message}\n${USAGE}`);
  } else if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\n怎么配置：见 docs/secrets.md");
  } else if (err instanceof DbIdentityError) {
    console.error(`没有改动：${err.message}`);
  } else {
    console.error(`执行失败（错误码 ${driverErrorCode(err) ?? "无"}）。已经加密的不受影响，重新运行会接着做。`);
  }
}
