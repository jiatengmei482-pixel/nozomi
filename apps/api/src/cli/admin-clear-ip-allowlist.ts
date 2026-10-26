/**
 * `pnpm admin:clear-ip-allowlist --email <邮箱>`：在服务器上清空一个在用的平台员工自己的 IP 白名单（ADR 0030）。
 *
 * 用途：员工（多半是超级管理员）被自己的 IP 白名单挡在门外——比如办公室换了出口地址——又没有别的超级管理员能在后台改。
 * 只清员工自己的名单；他的角色另有名单时仍按角色的（超级管理员是内置角色，没有角色名单）。会话不受影响。
 * 审计日志记为「系统 / 命令行」，记下清掉之前的名单。不接受别的参数；不读标准输入。
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConfigError, loadConfig } from "@nozomi/config";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { clearStaffAllowlistFromCli } from "../services/platform-staff.ts";
import { emailSchema } from "../validation.ts";

const USAGE = "用法：pnpm admin:clear-ip-allowlist --email <邮箱>";

class UsageError extends Error {}

function readEmail(argv: readonly string[]): string {
  let values: { email?: string | undefined };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { email: { type: "string" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const parsed = z.object({ email: emailSchema }).safeParse(values);
  if (!parsed.success) throw new UsageError("需要合法的 --email。");
  return parsed.data.email;
}

async function main(): Promise<void> {
  const email = readEmail(process.argv.slice(2));
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const user = await clearStaffAllowlistFromCli(pool, email, new Date());
    console.log(`已清空 ${user.email} 自己的 IP 白名单（原来 ${user.ipAllowlist.length} 条）。现在按他的角色的名单；角色没有名单就不限制来源地址。`);
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
  } else if (err instanceof AppError || err instanceof DbIdentityError) {
    console.error(`IP 白名单没有改动：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(`IP 白名单没有改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。`);
  } else {
    console.error(`IP 白名单没有改动：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exit(1);
}
