/**
 * `pnpm admin:reset-2fa --email <邮箱>`：在服务器上清掉一个在用的平台员工的两步验证（ADR 0030）。
 *
 * 用途：紧急情况——员工的手机和恢复码都丢了，而后台的「重置两步验证」要另一位超级管理员审核（双人复核），
 * 平台上只有一位超级管理员、或者丢了手机的正是唯一的超级管理员时用它。
 * 清掉之后这个账号的密钥、恢复码作废，全部登录会话失效；下次登录（密码不变）时重新绑定。审计日志记为「系统 / 命令行」。
 * 不接受别的参数；不读标准输入。
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConfigError, loadConfig } from "@nozomi/config";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { resetStaffMfaFromCli } from "../services/platform-mfa.ts";
import { emailSchema } from "../validation.ts";

const USAGE = "用法：pnpm admin:reset-2fa --email <邮箱>";

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
    const user = await resetStaffMfaFromCli(pool, email, new Date());
    console.log(`已清掉 ${user.email} 的两步验证，该账号此前的登录全部失效。下次用密码登录后，按页面提示重新绑定验证器。`);
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
    console.error(`两步验证没有改动：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(`两步验证没有改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。`);
  } else {
    console.error(`两步验证没有改动：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exit(1);
}
