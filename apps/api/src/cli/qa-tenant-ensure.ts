/**
 * `pnpm qa:tenant-ensure --email <管理员邮箱> [--name <姓名>] [--reset-password]`：建出或核对测试环境专用的 QA 测试供应商（M8-16，ADR 0077）。
 *
 * - 只允许 APP_ENV 是 staging（以及本机 local、CI 的 ci，自动测试用）；production 直接拒绝，不读密码、不连数据库。
 * - 可以重复运行：已经有了就只核对并报告，什么都不改（不读密码）；加 `--reset-password` 才重设那位管理员的密码。
 * - 密码不接受命令行参数和环境变量：在终端里运行时交互输入两遍（不回显），自动化时从标准输入读（`… < 密码文件`）。
 *   密码不会被打印，也不进任何日志和审计；数据库只存哈希。
 * - 这不是迁移、也不是预置数据：部署和迁移永远不会建这一行，只有显式运行这条命令才会。
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { ConfigError, loadConfig } from "@nozomi/config";
import { DbIdentityError } from "../db/identity.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { QA_ADMIN_DEFAULT_NAME, QA_TENANT_ENVS, ensureQaTenant, qaTenantAllowed, qaTenantExists } from "../services/qa-tenant.ts";
import { emailSchema, personNameSchema } from "../validation.ts";
import { SecretInputAborted, readNewPassword } from "./read-secret.ts";

const USAGE = [
  "用法：pnpm qa:tenant-ensure --email <管理员邮箱> [--name <姓名>] [--reset-password]",
  "只在测试环境（APP_ENV=staging）运行；正式环境拒绝。",
  "密码不能写在命令行参数或环境变量里：在终端里运行时按提示输入（不回显），或者从标准输入传入（< 密码文件）。",
  "已经建好时只核对、不改动；加 --reset-password 才重设这位管理员的密码（从标准输入读新密码）。",
].join("\n");

class UsageError extends Error {}
class Refused extends Error {}

interface Options {
  email: string;
  name: string;
  resetPassword: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let values: { email?: string | undefined; name?: string | undefined; "reset-password"?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: "string" }, name: { type: "string" }, "reset-password": { type: "boolean" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const parsed = z.object({ email: emailSchema, name: personNameSchema.optional() }).safeParse(values);
  if (!parsed.success) throw new UsageError("需要合法的 --email（--name 可以不给，给了不能为空）。");
  return { email: parsed.data.email, name: parsed.data.name ?? QA_ADMIN_DEFAULT_NAME, resetPassword: values["reset-password"] === true };
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  if (!qaTenantAllowed(config.appEnv)) {
    throw new Refused(`当前环境是 ${config.appEnv}：QA 测试供应商只能在测试环境建（允许：${QA_TENANT_ENVS.join("、")}）。没有读密码，也没有做任何改动。`);
  }
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const exists = await qaTenantExists(pool);
    const needsPassword = !exists || options.resetPassword;
    const password = needsPassword
      ? await readNewPassword(process.stdin, process.stderr, {
          first: "设置 QA 测试供应商管理员的密码（输入时不显示）：",
          confirm: "再输入一遍：",
          mismatch: "两次输入的密码不一致，没有做任何改动。",
        })
      : null;
    const outcome = await ensureQaTenant(pool, { ...options, password }, new Date());
    const where = `供应商「${outcome.tenant.name}」（编号 ${outcome.tenant.id}，状态 ${outcome.tenant.status}，测试供应商：不能上架、不参与比价）`;
    if (outcome.kind === "created") {
      console.log(`已建好 QA 测试${where}`);
      console.log(`管理员：${outcome.admin.email}（编号 ${outcome.admin.id}）。现在可以用这个邮箱和刚才给的密码登录供应商后台。`);
      return;
    }
    if (outcome.kind === "password_reset") {
      console.log(`已重设 ${outcome.admin.email} 的密码，这个账号此前的登录全部失效。${where}`);
    } else {
      console.log(`QA 测试${where}已经存在，没有做任何改动。`);
      console.log(`管理员：${outcome.admin.email}（编号 ${outcome.admin.id}，角色 ${outcome.admin.role}，状态 ${outcome.admin.status}）。`);
    }
    if (outcome.issues.length === 0) {
      console.log("核对通过：可以用来做供应商端的写入验收。");
    } else {
      console.log(["核对发现问题（没有自动修改）：", ...outcome.issues.map((issue) => `- ${issue}`)].join("\n"));
      process.exitCode = 2;
    }
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`${err.message}\n${USAGE}`);
  } else if (err instanceof Refused) {
    console.error(`拒绝运行：${err.message}`);
  } else if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\n怎么配置：见 docs/secrets.md");
  } else if (err instanceof SecretInputAborted) {
    console.error("已取消，没有做任何改动。");
  } else if (err instanceof AppError) {
    const issues = (err.details["issues"] ?? []) as { message: string }[];
    console.error([`没有做任何改动：${err.message}`, ...issues.map((issue) => `- ${issue.message}`)].join("\n"));
  } else if (err instanceof DbIdentityError) {
    console.error(`没有做任何改动：${err.message}`);
  } else if (driverErrorCode(err) !== null) {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(`没有做任何改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动并且已经运行过 pnpm db:migrate。`);
  } else {
    console.error(`没有做任何改动：${err instanceof Error ? err.message : "未知错误"}`);
  }
  process.exit(1);
}
