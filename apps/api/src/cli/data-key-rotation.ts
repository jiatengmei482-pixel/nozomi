/**
 * `pnpm data-key:rotate`：换数据加密主密钥后，把旧主密钥写的密文用新主密钥重新加密（ADR 0106）。
 * 默认 dry-run：只打印每张表还有几行是旧密钥、几行两把都解不开，不改任何数据。`--execute` 真正换一遍，可以中断、反复运行。
 * 用迁移账号连库（DATABASE_MIGRATION_URL），需要 DATA_ENCRYPTION_KEY（新）和 DATA_ENCRYPTION_KEY_PREVIOUS（旧）。输出只有表名和数量。
 */
import { parseArgs } from "node:util";
import { ConfigError, loadDataKeyRotationConfig } from "@nozomi/config";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { PassengerCrypto } from "../integrations/passenger-crypto.ts";
import { SecretBox } from "../integrations/secret-box.ts";
import { type RotationPlan, planDataKeyRotation, rotationDone, runDataKeyRotation } from "../services/data-key-rotation.ts";

const USAGE = "用法：pnpm data-key:rotate [--dry-run]（默认，只看数量）\n      pnpm data-key:rotate --execute（真正重新加密，可以反复运行）";

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

function print(plan: RotationPlan): void {
  for (const [name, counts] of Object.entries(plan)) console.log(`${name}：旧密钥 ${counts.previous} 行，两把都解不开 ${counts.unreadable} 行`);
}

async function main(): Promise<void> {
  const mode = readMode(process.argv.slice(2));
  const config = loadDataKeyRotationConfig();
  const box = new SecretBox(config.dataEncryptionKey, config.dataEncryptionPreviousKey);
  const keys = { box, crypto: new PassengerCrypto(box, { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: false }) };
  const pool = createPool(config.databaseMigrationUrl, { max: 2, queryTimeoutMs: 0, statementTimeoutMs: 0 });
  try {
    const before = await planDataKeyRotation(pool, keys);
    print(before);
    if (mode === "dry-run") {
      console.log("这是 dry-run，没有改任何数据。");
      return;
    }
    const run = await runDataKeyRotation(pool, keys);
    for (const [name, count] of Object.entries(run.rekeyed)) if (count > 0) console.log(`${name}：这一轮重新加密了 ${count} 行`);
    console.log(`没换成 ${run.failed} 行（解不开，或刚被别的操作改过、锁着；重新运行会再试）。`);
    console.log("换完之后：");
    const after = await planDataKeyRotation(pool, keys);
    print(after);
    if (rotationDone(after)) {
      console.log("结论：全部换成新密钥了。可以从服务器的 .env 删掉 DATA_ENCRYPTION_KEY_PREVIOUS 再重启（见 docs/deploy.md「更换数据加密密钥」）。");
    } else {
      console.log("结论：还不能删旧密钥。还有旧密钥的行就重新运行一次；两把都解不开的要人工看。");
      process.exitCode = 1;
    }
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
    console.error("\n怎么配置：见 docs/deploy.md「更换数据加密密钥」");
  } else {
    console.error(`执行失败（错误码 ${driverErrorCode(err) ?? "无"}）。已经换好的不受影响，重新运行会接着做。`);
  }
}
