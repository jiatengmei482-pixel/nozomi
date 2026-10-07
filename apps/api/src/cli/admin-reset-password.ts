/**
 * `pnpm admin:reset-password --email <邮箱>`：在服务器上给一个在用的平台超级管理员重设密码。
 *
 * 用途：超级管理员忘了密码、又没有别的超级管理员能给他发重置链接时的恢复途径。
 * 只对「在用的超级管理员」有效；其他平台员工由超级管理员在后台发重置链接。
 * 和 admin:create 一样，密码不接受命令行参数：在终端里交互输入两遍（不回显），或从标准输入读。
 * 重设后这个账号的全部登录会话失效；审计日志里记为「系统 / 命令行」。
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConfigError, loadConfig } from "@nozomi/config";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { resetSuperAdminPassword } from "../services/platform-staff.ts";
import { emailSchema } from "../validation.ts";
import { SecretInputAborted, readNewPassword } from "./read-secret.ts";

const USAGE = [
  "用法：pnpm admin:reset-password --email <邮箱>",
  "密码不能写在命令行参数里：在终端里运行时按提示输入（不回显），或者从标准输入传入（< 密码文件）。",
].join("\n");

class UsageError extends Error {}

function readOptions(argv: readonly string[]): { email: string } {
  let values: { email?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const parsed = z.object({ email: emailSchema }).safeParse(values);
  if (!parsed.success) throw new UsageError("需要合法的 --email。");
  return parsed.data;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  const password = await readNewPassword(process.stdin, process.stderr, {
    first: "设置新密码（输入时不显示）：",
    confirm: "再输入一遍：",
    mismatch: "两次输入的密码不一致，密码没有改动。",
  });
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const user = await resetSuperAdminPassword(pool, { email: options.email, password }, new Date());
    console.log(`已重设超级管理员 ${user.email} 的密码，该账号此前的登录全部失效。`);
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
  } else if (err instanceof SecretInputAborted) {
    console.error("已取消，密码没有改动。");
  } else if (err instanceof AppError) {
    const issues = (err.details["issues"] ?? []) as { message: string }[];
    console.error([`密码没有改动：${err.message}`, ...issues.map((issue) => `- ${issue.message}`)].join("\n"));
  } else if (err instanceof DbIdentityError) {
    console.error(`密码没有改动：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(
      `密码没有改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。`,
    );
  } else {
    console.error(`密码没有改动：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exit(1);
}
