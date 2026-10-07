/**
 * `pnpm admin:create --email <邮箱> --name <姓名>`：创建一个平台超级管理员。
 *
 * 平台上不预置任何账号，第一个账号只能这样创建；之后的平台账号由超级管理员在后台创建。
 * 密码不接受命令行参数（会留在 shell 历史和进程列表里）：
 * - 在终端里运行时交互输入两遍，不回显；
 * - 自动化场景从标准输入读：`pnpm admin:create --email … --name … < 密码文件`。
 * 密码不会被打印，也不会进任何日志；数据库只存哈希。
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConfigError, loadConfig } from "@nozomi/config";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { createSuperAdmin } from "../services/platform-staff.ts";
import { emailSchema, personNameSchema } from "../validation.ts";
import { SecretInputAborted, readNewPassword } from "./read-secret.ts";

const USAGE = [
  "用法：pnpm admin:create --email <邮箱> --name <姓名>",
  "密码不能写在命令行参数里：在终端里运行时按提示输入（不回显），或者从标准输入传入（< 密码文件）。",
].join("\n");

class UsageError extends Error {}

function readOptions(argv: readonly string[]): { email: string; name: string } {
  let values: { email?: string | undefined; name?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: "string" }, name: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const parsed = z.object({ email: emailSchema, name: personNameSchema }).safeParse(values);
  if (!parsed.success) throw new UsageError("需要合法的 --email 和不为空的 --name。");
  return parsed.data;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  const password = await readNewPassword(process.stdin, process.stderr, {
    first: "设置密码（输入时不显示）：",
    confirm: "再输入一遍：",
    mismatch: "两次输入的密码不一致，没有创建账号。",
  });
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const user = await createSuperAdmin(pool, { ...options, password }, new Date());
    console.log(`已创建超级管理员：${user.email}（编号 ${user.id}）`);
    console.log("现在可以用这个邮箱和刚才设置的密码登录平台后台。");
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
    console.error("已取消，没有创建账号。");
  } else if (err instanceof AppError) {
    const issues = (err.details["issues"] ?? []) as { message: string }[];
    console.error([`没有创建账号：${err.message}`, ...issues.map((issue) => `- ${issue.message}`)].join("\n"));
  } else if (err instanceof DbIdentityError) {
    console.error(`没有创建账号：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(
      `没有创建账号：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。`,
    );
  } else {
    console.error(`没有创建账号：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exit(1);
}
