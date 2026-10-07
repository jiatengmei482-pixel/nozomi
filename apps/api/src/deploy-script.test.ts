/**
 * deploy/bin/deploy.sh 的流程测试：「哪一步失败 → 要不要回退 → 以什么退出码结束 → current / previous 指向哪」。
 *
 * 真实执行脚本，但把 `docker` 换成一个替身（放在 PATH 最前面）：它只记录每次调用的参数，
 * 并按测试指定的规则让某些调用失败。不需要 Docker，也不需要数据库。
 * 真实容器上的同一套流程由 CI 的 deploy/ci/smoke.sh 覆盖。
 *
 * 脚本依赖 Linux 的 flock、mv -T，所以只在 Linux 上运行（CI 和服务器都是 Linux）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOY_DIR = fileURLToPath(new URL("../../../deploy/", import.meta.url));
const linuxOnly = { skip: process.platform === "linux" ? false : "部署脚本只在 Linux 上运行" };

/** 明显的占位值：测试里没有任何真实密钥。 */
const PLACEHOLDER_PASSWORD = "test-placeholder-not-a-real-password";
const PLACEHOLDER_JWT = "test-placeholder-not-a-real-secret-0000000000";
const PLACEHOLDER_TOKEN = "test-placeholder-registry-token";
const IMAGE = "registry.example.test/nozomi/nozomi-api";

/**
 * docker 的替身。每次调用往 $STUB_DIR/calls.log 追加一行「[调用方环境里的 API_IMAGE] 全部参数」；
 * 参数匹配 $STUB_DIR/fail-patterns 里任意一条正则时以 1 退出。
 */
const DOCKER_STUB = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '[%s] %s\\n' "\${API_IMAGE:-}" "$args" >>"$STUB_DIR/calls.log"
if [[ "$args" == login* ]]; then cat >"$STUB_DIR/login-stdin"; fi
if [[ -f "$STUB_DIR/fail-patterns" ]]; then
  while IFS= read -r pattern; do
    if [[ -n "$pattern" && "$args" =~ $pattern ]]; then exit 1; fi
  done <"$STUB_DIR/fail-patterns"
fi
if [[ "$args" == *"pg_dump"* ]]; then printf 'stub-dump'; fi
if [[ "$args" == "image ls"* && -f "$STUB_DIR/images" ]]; then cat "$STUB_DIR/images"; fi
exit 0
`;

interface Sandbox {
  root: string;
  stubDir: string;
}

interface Result {
  code: number | null;
  output: string;
}

let sandbox: Sandbox;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "nozomi-deploy-test-"));
  const root = join(base, "staging");
  const stubDir = join(base, "stub");
  await mkdir(join(root, "releases"), { recursive: true });
  await mkdir(join(root, "backups"));
  await mkdir(join(stubDir, "bin"), { recursive: true });
  await writeFile(join(stubDir, "bin", "docker"), DOCKER_STUB);
  await chmod(join(stubDir, "bin", "docker"), 0o755);
  await writeFile(
    join(root, ".env"),
    `POSTGRES_PASSWORD=${PLACEHOLDER_PASSWORD}\nAUTH_JWT_SECRET=${PLACEHOLDER_JWT}\nSTRIPE_SECRET_KEY=\n`,
    { mode: 0o644 },
  );
  sandbox = { root, stubDir };
});

afterEach(async () => {
  await rm(join(sandbox.root, ".."), { recursive: true, force: true });
});

/** 和流水线上传到服务器的是同一组文件。 */
async function installRelease(id: string): Promise<string> {
  const dir = join(sandbox.root, "releases", id);
  await mkdir(dir, { recursive: true });
  for (const entry of ["compose.yml", "Caddyfile", "bin"]) {
    await cp(join(DEPLOY_DIR, entry), join(dir, entry), { recursive: true });
  }
  return dir;
}

function run(script: string, args: string[], env: Record<string, string>, stdin = ""): Result {
  const result = spawnSync("bash", [script, ...args], {
    env: { PATH: `${join(sandbox.stubDir, "bin")}:${process.env["PATH"] ?? ""}`, STUB_DIR: sandbox.stubDir, ...env },
    input: stdin,
    encoding: "utf8",
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

async function deploy(id: string, extraEnv: Record<string, string> = {}, stdin = ""): Promise<Result> {
  const dir = await installRelease(id);
  return run(
    join(dir, "bin", "deploy.sh"),
    ["deploy"],
    { APP_ENV: "staging", API_IMAGE: `${IMAGE}:${id}`, APP_DOMAIN: "staging.example.test", ...extraEnv },
    stdin,
  );
}

function rollback(fromRelease: string): Result {
  return run(join(sandbox.root, "releases", fromRelease, "bin", "deploy.sh"), ["rollback"], {});
}

async function failWhen(...patterns: string[]): Promise<void> {
  await writeFile(join(sandbox.stubDir, "fail-patterns"), patterns.map((pattern) => `${pattern}\n`).join(""));
}

async function calls(): Promise<string[]> {
  const path = join(sandbox.stubDir, "calls.log");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

async function clearCalls(): Promise<void> {
  await rm(join(sandbox.stubDir, "calls.log"), { force: true });
}

async function linkTarget(name: string): Promise<string | null> {
  try {
    return await readlink(join(sandbox.root, name));
  } catch {
    return null;
  }
}

/** 某个版本的「启动全部容器并等健康」那一次调用。 */
function activationOf(id: string): RegExp {
  return new RegExp(`releases/${id}/compose\\.yml up -d --wait --wait-timeout \\d+ --remove-orphans$`);
}

function indexOfCall(log: string[], pattern: RegExp): number {
  return log.findIndex((line) => pattern.test(line));
}

test("首次部署成功：拉镜像 → 起数据库 → 迁移 → 启动，顺序正确；current 指向新版本，没有 previous，也不做迁移前备份", linuxOnly, async () => {
  const result = await deploy("v1");
  assert.equal(result.code, 0, result.output);
  assert.equal(await linkTarget("current"), "releases/v1");
  assert.equal(await linkTarget("previous"), null);

  const log = await calls();
  const pull = indexOfCall(log, /pull --quiet api$/);
  const database = indexOfCall(log, /up -d --wait --wait-timeout \d+ db$/);
  const migrate = indexOfCall(log, /run --rm --no-deps -T api node apps\/api\/src\/db\/migrate-cli\.ts$/);
  const activate = indexOfCall(log, activationOf("v1"));
  assert.ok(pull >= 0 && database > pull && migrate > database && activate > migrate, log.join("\n"));
  assert.ok(!log.some((line) => line.includes("pg_dump")), "首次部署时数据库是空的，不应备份");
  assert.deepEqual(await readdir(join(sandbox.root, "backups")), []);
});

test("每次 docker compose 调用都带项目名、密钥文件和该版本的变量文件", linuxOnly, async () => {
  await deploy("v1");
  const composeCalls = (await calls()).filter((line) => line.includes("] compose "));
  assert.ok(composeCalls.length >= 3);
  for (const line of composeCalls) {
    assert.match(line, /--project-name nozomi-staging /);
    assert.ok(line.includes(`--env-file ${join(sandbox.root, ".env")} `), line);
    assert.ok(line.includes(`--env-file ${join(sandbox.root, "releases", "v1", "release.env")} `), line);
  }
});

test("release.env 只有非密钥项；证书方式随 ACME_EMAIL 有无而变；.env 的权限被收紧为 600、内容不变", linuxOnly, async () => {
  const before = await readFile(join(sandbox.root, ".env"), "utf8");
  await deploy("v1");
  const withoutEmail = await readFile(join(sandbox.root, "releases", "v1", "release.env"), "utf8");
  assert.match(withoutEmail, /^APP_ENV=staging$/m);
  assert.match(withoutEmail, /^APP_DOMAIN=staging\.example\.test$/m);
  assert.match(withoutEmail, /^CADDY_TLS_MODE=auto$/m);
  assert.match(withoutEmail, new RegExp(`^API_IMAGE=${IMAGE.replaceAll(".", "\\.")}:v1$`, "m"));
  assert.ok(!withoutEmail.includes(PLACEHOLDER_PASSWORD) && !withoutEmail.includes(PLACEHOLDER_JWT));

  await deploy("v2", { ACME_EMAIL: "ops@example.test" });
  const withEmail = await readFile(join(sandbox.root, "releases", "v2", "release.env"), "utf8");
  assert.match(withEmail, /^CADDY_TLS_MODE=email$/m);
  assert.match(withEmail, /^ACME_EMAIL=ops@example\.test$/m);

  assert.equal(await readFile(join(sandbox.root, ".env"), "utf8"), before);
  const mode = spawnSync("stat", ["-c", "%a", join(sandbox.root, ".env")], { encoding: "utf8" }).stdout.trim();
  assert.equal(mode, "600");
});

test("上传的文件权限过严时，部署会把 Caddyfile 改成所有人可读（反向代理容器没有无视权限的特权）", linuxOnly, async () => {
  const dir = await installRelease("v1");
  await chmod(join(dir, "Caddyfile"), 0o600);
  const result = run(join(dir, "bin", "deploy.sh"), ["deploy"], {
    APP_ENV: "staging",
    API_IMAGE: `${IMAGE}:v1`,
    APP_DOMAIN: "staging.example.test",
  });
  assert.equal(result.code, 0, result.output);
  const mode = spawnSync("stat", ["-c", "%a", join(dir, "Caddyfile")], { encoding: "utf8" }).stdout.trim();
  assert.equal(mode, "644");
});

test("第二次部署成功：迁移前先备份；previous 指向上一个版本；更早的版本目录和用不到的镜像被清理", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  await writeFile(join(sandbox.stubDir, "images"), [`${IMAGE}:v1`, `${IMAGE}:v2`, `${IMAGE}:v3`].join("\n") + "\n");
  await clearCalls();
  for (const name of await readdir(join(sandbox.root, "backups"))) await rm(join(sandbox.root, "backups", name));

  const result = await deploy("v3");
  assert.equal(result.code, 0, result.output);
  assert.equal(await linkTarget("current"), "releases/v3");
  assert.equal(await linkTarget("previous"), "releases/v2");
  assert.deepEqual((await readdir(join(sandbox.root, "releases"))).sort(), ["v2", "v3"]);

  const log = await calls();
  const backup = indexOfCall(log, /exec -T db pg_dump /);
  const migrate = indexOfCall(log, /migrate-cli\.ts$/);
  assert.ok(backup >= 0 && backup < migrate, "备份必须在迁移之前");
  const backups = await readdir(join(sandbox.root, "backups"));
  assert.equal(backups.length, 1, "这次部署应生成一份迁移前备份");
  assert.ok(backups.every((name) => /^nozomi-staging-pre-deploy-\d{8}T\d{6}Z\.dump$/.test(name)), backups.join());

  assert.ok(log.some((line) => line.endsWith(`image rm ${IMAGE}:v1`)), "应删除不再需要的 v1 镜像");
  assert.ok(!log.some((line) => /image rm .*:(v2|v3)$/.test(line)), "current 和 previous 的镜像不能删");
});

test("拉镜像失败：退出码 10，旧版本没有被碰（不迁移、不启动新版本），current 不变", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("pull --quiet api$");
  const result = await deploy("v2");
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /拉取镜像失败/);
  assert.equal(await linkTarget("current"), "releases/v1");
  const log = await calls();
  assert.equal(indexOfCall(log, /migrate-cli\.ts$/), -1);
  assert.equal(indexOfCall(log, /--remove-orphans$/), -1);
});

test("迁移前备份失败：退出码 10，不执行迁移", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("pg_dump");
  const result = await deploy("v2");
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /迁移前备份失败/);
  assert.equal(indexOfCall(await calls(), /migrate-cli\.ts$/), -1);
  assert.deepEqual(await readdir(join(sandbox.root, "backups")), [], "失败的备份不应留下半截文件");
});

test("迁移失败：退出码 10，不启动新版本，current 不变", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("migrate-cli\\.ts$");
  const result = await deploy("v2");
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /数据库迁移失败/);
  assert.equal(await linkTarget("current"), "releases/v1");
  assert.equal(indexOfCall(await calls(), /--remove-orphans$/), -1, "迁移失败后不应替换正在运行的容器");
});

test("新版本不健康：回退到上一个版本，退出码 20；current / previous 不变；回退用的是旧版本目录里记录的镜像", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  await clearCalls();
  await failWhen("releases/v3/compose\\.yml up -d --wait .*--remove-orphans$");
  const result = await deploy("v3");
  assert.equal(result.code, 20, result.output);
  assert.match(result.output, /已回退，上一个版本 v2 运行正常/);
  assert.equal(await linkTarget("current"), "releases/v2");
  assert.equal(await linkTarget("previous"), "releases/v1");

  const log = await calls();
  const failed = indexOfCall(log, activationOf("v3"));
  const restored = indexOfCall(log, activationOf("v2"));
  assert.ok(failed >= 0 && restored > failed, log.join("\n"));
  assert.ok(existsSync(join(sandbox.root, "releases", "v1")), "失败的部署不应清理旧版本");
  assert.ok(!log.some((line) => line.includes("image rm")), "失败的部署不应清理镜像");
});

test("调用方环境里的 API_IMAGE 不会传给 docker compose（否则回退时新版本的镜像会盖掉旧版本的）", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("releases/v2/compose\\.yml up -d --wait .*--remove-orphans$");
  await deploy("v2");
  const composeCalls = (await calls()).filter((line) => line.includes("] compose "));
  assert.ok(composeCalls.length > 0);
  for (const line of composeCalls) assert.ok(line.startsWith("[] "), line);
});

test("首次部署就不健康：没有可回退的版本，退出码 30，不建立 current", linuxOnly, async () => {
  await failWhen("--remove-orphans$");
  const result = await deploy("v1");
  assert.equal(result.code, 30, result.output);
  assert.match(result.output, /没有可回退的版本/);
  assert.equal(await linkTarget("current"), null);
});

test("新版本不健康且回退后的版本也不健康：退出码 30，明确提示服务可能不可用", linuxOnly, async () => {
  await deploy("v1");
  await failWhen("--remove-orphans$");
  const result = await deploy("v2");
  assert.equal(result.code, 30, result.output);
  assert.match(result.output, /服务可能不可用/);
  assert.equal(await linkTarget("current"), "releases/v1");
});

test("重新部署当前版本失败时，回退到再上一个版本", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  await clearCalls();
  await failWhen("releases/v2/compose\\.yml up -d --wait .*--remove-orphans$");
  const result = await deploy("v2");
  assert.equal(result.code, 20, result.output);
  assert.ok(indexOfCall(await calls(), activationOf("v1")) >= 0);
  assert.equal(await linkTarget("current"), "releases/v2");
});

test("rollback 命令：切回 previous，之后不再有 previous（不会在两个版本间来回跳）", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  await clearCalls();
  const result = rollback("v2");
  assert.equal(result.code, 0, result.output);
  assert.equal(await linkTarget("current"), "releases/v1");
  assert.equal(await linkTarget("previous"), null);
  assert.ok(indexOfCall(await calls(), activationOf("v1")) >= 0);

  await clearCalls();
  const again = rollback("v1");
  assert.equal(again.code, 30, again.output);
  assert.match(again.output, /没有可回退的版本/);
  assert.deepEqual(await calls(), [], "没有 previous 时不应动任何容器");
});

test("rollback 后的版本不健康：退出码 30，current 不变", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  await failWhen("--remove-orphans$");
  const result = rollback("v2");
  assert.equal(result.code, 30, result.output);
  assert.equal(await linkTarget("current"), "releases/v2");
  assert.equal(await linkTarget("previous"), "releases/v1");
});

test("镜像仓库的令牌只从标准输入传给 docker login，不出现在任何命令行参数和输出里；成功和失败都会登出", linuxOnly, async () => {
  const registry = { REGISTRY_HOST: "registry.example.test", REGISTRY_USER: "deployer" };
  const ok = await deploy("v1", registry, PLACEHOLDER_TOKEN);
  assert.equal(ok.code, 0, ok.output);
  let log = await calls();
  assert.equal(await readFile(join(sandbox.stubDir, "login-stdin"), "utf8"), PLACEHOLDER_TOKEN);
  assert.ok(log.some((line) => line.endsWith("login registry.example.test --username deployer --password-stdin")));
  assert.ok(indexOfCall(log, /\] login /) < indexOfCall(log, /pull --quiet api$/));
  assert.ok(log.at(-1)?.endsWith("logout registry.example.test"), "最后一步应是登出");
  assert.ok(!log.join("\n").includes(PLACEHOLDER_TOKEN) && !ok.output.includes(PLACEHOLDER_TOKEN));

  await clearCalls();
  await failWhen("migrate-cli\\.ts$");
  const failed = await deploy("v2", registry, PLACEHOLDER_TOKEN);
  assert.equal(failed.code, 10);
  log = await calls();
  assert.ok(log.at(-1)?.endsWith("logout registry.example.test"), "失败时也要登出");
});

test("登录镜像仓库失败：退出码 10，什么都没动", linuxOnly, async () => {
  await failWhen("^login ");
  const result = await deploy("v1", { REGISTRY_HOST: "registry.example.test", REGISTRY_USER: "deployer" }, PLACEHOLDER_TOKEN);
  assert.equal(result.code, 10, result.output);
  assert.equal(indexOfCall(await calls(), /\] compose /), -1);
});

test("DEPLOY_SKIP_PULL=1 时不拉镜像（CI 冒烟用本机构建的镜像）", linuxOnly, async () => {
  const result = await deploy("v1", { DEPLOY_SKIP_PULL: "1" });
  assert.equal(result.code, 0, result.output);
  assert.equal(indexOfCall(await calls(), /pull/), -1);
});

test("参数不合法：退出码 1，不调用 docker，报错里说明是哪一项", linuxOnly, async () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ APP_ENV: "local" }, /APP_ENV/],
    [{ API_IMAGE: "nozomi-api" }, /API_IMAGE/],
    [{ API_IMAGE: "nozomi-api:v1; touch /tmp/x" }, /API_IMAGE/],
    [{ APP_DOMAIN: "https://staging.example.test" }, /APP_DOMAIN/],
    [{ APP_DOMAIN: "staging.example.test/path" }, /APP_DOMAIN/],
    [{ APP_DOMAIN: "" }, /APP_DOMAIN/],
    [{ ACME_EMAIL: "not-an-email" }, /ACME_EMAIL/],
  ];
  for (const [env, message] of cases) {
    const result = await deploy("v1", env);
    assert.equal(result.code, 1, JSON.stringify(env) + result.output);
    assert.match(result.output, message);
  }
  assert.deepEqual(await calls(), []);
});

test("服务器没初始化（没有 .env、缺自动生成的密钥、数据库密码含连接串里的特殊字符）：退出码 1，报错不含密钥原文", linuxOnly, async () => {
  const envFile = join(sandbox.root, ".env");
  const variants: [string | null, RegExp][] = [
    [null, /请先运行服务器初始化/],
    [`AUTH_JWT_SECRET=${PLACEHOLDER_JWT}\n`, /没有 POSTGRES_PASSWORD/],
    [`POSTGRES_PASSWORD=\nAUTH_JWT_SECRET=${PLACEHOLDER_JWT}\n`, /没有 POSTGRES_PASSWORD/],
    [`POSTGRES_PASSWORD=${PLACEHOLDER_PASSWORD}\n`, /没有 AUTH_JWT_SECRET/],
    [`POSTGRES_PASSWORD=bad@placeholder/value\nAUTH_JWT_SECRET=${PLACEHOLDER_JWT}\n`, /只能包含字母、数字/],
  ];
  for (const [content, message] of variants) {
    await rm(envFile, { force: true });
    if (content !== null) await writeFile(envFile, content);
    const result = await deploy("v1");
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, message);
    assert.ok(!result.output.includes(PLACEHOLDER_JWT) && !result.output.includes("bad@placeholder"));
  }
  assert.deepEqual(await calls(), []);
});

test("同一个环境已有部署在进行时，第二个部署立即以退出码 1 结束，不碰任何容器", linuxOnly, async () => {
  const lockFile = join(sandbox.root, ".deploy.lock");
  const holder = spawn("flock", [lockFile, "sleep", "30"], { stdio: "ignore" });
  try {
    // 等持锁进程真的拿到锁
    for (let i = 0; i < 100; i++) {
      if (spawnSync("flock", ["-n", lockFile, "true"]).status !== 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const result = await deploy("v1");
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /另一个部署或回退正在进行/);
    assert.deepEqual(await calls(), []);
  } finally {
    holder.kill("SIGKILL");
  }
});

test("backup.sh：失败时不留半截文件、不删旧备份；成功后只删超过 14 天的备份", linuxOnly, async () => {
  await deploy("v1");
  const backups = join(sandbox.root, "backups");
  const old = join(backups, "nozomi-staging-daily-20000101T000000Z.dump");
  const recent = join(backups, "nozomi-staging-daily-20990101T000000Z.dump");
  const unrelated = join(backups, "notes.txt");
  for (const file of [old, recent, unrelated]) await writeFile(file, "x");
  spawnSync("touch", ["-d", "20 days ago", old, unrelated]);
  spawnSync("touch", ["-d", "13 days ago", recent]);
  const script = join(sandbox.root, "current", "bin", "backup.sh");

  await failWhen("pg_restore --list");
  const failed = run(script, ["daily"], {});
  assert.notEqual(failed.code, 0);
  assert.match(failed.output, /校验失败/);
  assert.deepEqual((await readdir(backups)).sort(), [old, recent, unrelated].map((p) => p.split("/").at(-1)).sort());

  await failWhen();
  const ok = run(script, ["daily"], {});
  assert.equal(ok.code, 0, ok.output);
  const names = await readdir(backups);
  assert.ok(!names.includes("nozomi-staging-daily-20000101T000000Z.dump"), "超过 14 天的备份应删除");
  assert.ok(names.includes("nozomi-staging-daily-20990101T000000Z.dump"), "14 天内的备份应保留");
  assert.ok(names.includes("notes.txt"), "不是备份的文件不能动");
  const created = names.filter((name) => /^nozomi-staging-daily-\d{8}T\d{6}Z\.dump$/.test(name) && !name.includes("20990101"));
  assert.equal(created.length, 1);
  const mode = spawnSync("stat", ["-c", "%a", join(backups, created[0] ?? "")], { encoding: "utf8" }).stdout.trim();
  assert.equal(mode, "600", "备份文件只有属主可读");
});

test("restore.sh：文件不是可用的备份或确认没通过时，不停服务、不动数据库", linuxOnly, async () => {
  await deploy("v1");
  const script = join(sandbox.root, "current", "bin", "restore.sh");
  const dump = join(sandbox.root, "backups", "nozomi-staging-daily-20990101T000000Z.dump");
  await writeFile(dump, "stub-dump");
  const destructive = /\] compose .* (stop api|exec -T db psql|exec -T db pg_restore -U)/;

  await clearCalls();
  const missing = run(script, [join(sandbox.root, "backups", "nope.dump"), "--yes"], {});
  assert.notEqual(missing.code, 0);
  assert.deepEqual(await calls(), []);

  await failWhen("pg_restore --list");
  const invalid = run(script, [dump, "--yes"], {});
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.output, /数据库没有被改动/);
  assert.ok(!(await calls()).some((line) => destructive.test(line)));

  await failWhen();
  await clearCalls();
  const refused = run(script, [dump], {}, "production\n");
  assert.notEqual(refused.code, 0);
  assert.match(refused.output, /已取消/);
  assert.ok(!(await calls()).some((line) => destructive.test(line)));
});

test("restore.sh 确认后的顺序：停 API → 备份当前库 → 删库重建 → 导入 → 迁移 → 启动", linuxOnly, async () => {
  await deploy("v1");
  const script = join(sandbox.root, "current", "bin", "restore.sh");
  const dump = join(sandbox.root, "backups", "nozomi-staging-daily-20990101T000000Z.dump");
  await writeFile(dump, "stub-dump");
  await clearCalls();
  const result = run(script, [dump], {}, "staging\n");
  assert.equal(result.code, 0, result.output);
  const log = await calls();
  const order = [
    /stop api$/,
    /exec -T db pg_dump /,
    /exec -T db psql .*drop database if exists nozomi/,
    /exec -T db pg_restore -U nozomi -d nozomi /,
    /migrate-cli\.ts$/,
    /up -d --wait --wait-timeout \d+$/,
  ].map((pattern) => indexOfCall(log, pattern));
  assert.ok(order.every((index) => index >= 0), log.join("\n"));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), log.join("\n"));
  assert.ok((await readdir(join(sandbox.root, "backups"))).some((name) => name.includes("pre-restore")));
});
