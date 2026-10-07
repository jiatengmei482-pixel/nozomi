/**
 * deploy/bin/deploy.sh 的流程测试：「哪一步失败 → 要不要回退 → 以什么退出码结束 → current / previous 指向哪」。
 *
 * 真实执行脚本，但把 `docker` 换成一个替身（放在 PATH 最前面）：它只记录每次调用的参数，
 * 并按测试指定的规则让某些调用失败。不需要 Docker，也不需要数据库。
 * behind-proxy 模式下脚本还会用 `curl` 从本机访问入口端口：同样换成替身（并把 `sleep` 换成立即返回）。
 * 真实容器上的同一套流程由 CI 的 deploy/ci/smoke.sh 覆盖。
 *
 * 脚本依赖 Linux 的 flock、mv -T，所以只在 Linux 上运行（CI 和服务器都是 Linux）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEPLOY_DIR = fileURLToPath(new URL("../../../deploy/", import.meta.url));
const linuxOnly = { skip: process.platform === "linux" ? false : "部署脚本只在 Linux 上运行" };

/** 明显的占位值：测试里没有任何真实密钥。 */
const PLACEHOLDER_PASSWORD = "test-placeholder-not-a-real-password";
const PLACEHOLDER_JWT = "test-placeholder-not-a-real-secret-0000000000";
const PLACEHOLDER_APP_PASSWORD = "test-placeholder-not-a-real-app-password";
/** 在有应用账号之前初始化的服务器上的 .env：没有 POSTGRES_APP_PASSWORD。 */
const LEGACY_ENV_FILE = `POSTGRES_PASSWORD=${PLACEHOLDER_PASSWORD}\nAUTH_JWT_SECRET=${PLACEHOLDER_JWT}\nSTRIPE_SECRET_KEY=\n`;
const PLACEHOLDER_TOKEN = "test-placeholder-registry-token";
const IMAGE = "registry.example.test/nozomi/nozomi-api";
/** 配对的前端镜像：同一个仓库前缀、同一个标签，由 deploy.sh 从 API 镜像名推出来。 */
const WEB_IMAGE = "registry.example.test/nozomi/nozomi-web";

/**
 * docker 的替身。每次调用往 $STUB_DIR/calls.log 追加一行「[调用方环境里的 API_IMAGE 和 WEB_IMAGE] 全部参数」；
 * 参数匹配 $STUB_DIR/fail-patterns 里任意一条正则时以 1 退出。
 * `image ls <仓库名>` 只输出 $STUB_DIR/images 里属于这个仓库名的那些行（和真的 docker 一样）。
 */
const DOCKER_STUB = `#!/usr/bin/env bash
set -euo pipefail
args="$*"
printf '[%s] %s\\n' "\${API_IMAGE:-}\${WEB_IMAGE:+ \$WEB_IMAGE}" "$args" >>"$STUB_DIR/calls.log"
if [[ "$args" == login* ]]; then cat >"$STUB_DIR/login-stdin"; fi
if [[ -f "$STUB_DIR/fail-patterns" ]]; then
  while IFS= read -r pattern; do
    if [[ -n "$pattern" && "$args" =~ $pattern ]]; then exit 1; fi
  done <"$STUB_DIR/fail-patterns"
fi
if [[ "$args" == *"pg_dump"* ]]; then printf 'stub-dump'; fi
if [[ "$args" == "image ls"* && -f "$STUB_DIR/images" ]]; then
  awk -v prefix="\${!#}:" 'index(\$0, prefix) == 1' "$STUB_DIR/images"
fi
exit 0
`;

/**
 * curl 的替身：每次调用往 $STUB_DIR/curl.log 追加一行全部参数，并输出一个 HTTP 状态码
 * （脚本用 --write-out 取它）：$STUB_DIR/curl-status 存在时输出其内容，否则 200。
 */
const CURL_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$STUB_DIR/curl.log"
if [[ -f "$STUB_DIR/curl-status" ]]; then cat "$STUB_DIR/curl-status"; else printf '200'; fi
`;

const SLEEP_STUB = "#!/usr/bin/env bash\nexit 0\n";

const BEHIND_PROXY = { EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:18080" };

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
  for (const [name, content] of [["docker", DOCKER_STUB], ["curl", CURL_STUB], ["sleep", SLEEP_STUB]] as const) {
    await writeFile(join(stubDir, "bin", name), content);
    await chmod(join(stubDir, "bin", name), 0o755);
  }
  await writeFile(
    join(root, ".env"),
    `POSTGRES_PASSWORD=${PLACEHOLDER_PASSWORD}\nPOSTGRES_APP_PASSWORD=${PLACEHOLDER_APP_PASSWORD}\nAUTH_JWT_SECRET=${PLACEHOLDER_JWT}\nSTRIPE_SECRET_KEY=\n`,
    { mode: 0o644 },
  );
  sandbox = { root, stubDir };
});

afterEach(async () => {
  await rm(join(sandbox.root, ".."), { recursive: true, force: true });
});

/** 和 deploy/client/remote.sh 上传到服务器的是同一组文件。 */
async function installRelease(id: string): Promise<string> {
  const dir = join(sandbox.root, "releases", id);
  await mkdir(dir, { recursive: true });
  for (const entry of ["compose.yml", "compose.behind-proxy.yml", "Caddyfile", "bin"]) {
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
  await rm(join(sandbox.stubDir, "curl.log"), { force: true });
}

/** curl 替身被调用的记录（behind-proxy 模式下从本机访问入口端口）。 */
async function curlCalls(): Promise<string[]> {
  const path = join(sandbox.stubDir, "curl.log");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

/** 让本机访问入口端口得到指定的状态码（不传则恢复为 200）。 */
async function edgeAnswers(status?: string): Promise<void> {
  const path = join(sandbox.stubDir, "curl-status");
  if (status === undefined) await rm(path, { force: true });
  else await writeFile(path, status);
}

async function releaseEnv(id: string): Promise<string> {
  return readFile(join(sandbox.root, "releases", id, "release.env"), "utf8");
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

test("首次部署成功：拉镜像 → 起数据库 → 建应用账号 → 迁移 → 启动，顺序正确；current 指向新版本，没有 previous，也不做迁移前备份", linuxOnly, async () => {
  const result = await deploy("v1");
  assert.equal(result.code, 0, result.output);
  assert.equal(await linkTarget("current"), "releases/v1");
  assert.equal(await linkTarget("previous"), null);

  const log = await calls();
  const pull = indexOfCall(log, /pull --quiet api caddy$/);
  const database = indexOfCall(log, /up -d --wait --wait-timeout \d+ db$/);
  // 建账号和迁移都在临时的 migrate 容器里用迁移账号执行，不在 api 容器里（api 拿不到迁移账号的密码）
  const provision = indexOfCall(log, /run --rm --no-deps -T migrate node apps\/api\/src\/db\/provision-cli\.ts$/);
  const migrate = indexOfCall(log, /run --rm --no-deps -T migrate node apps\/api\/src\/db\/migrate-cli\.ts$/);
  const activate = indexOfCall(log, activationOf("v1"));
  assert.ok(pull >= 0 && database > pull && provision > database && migrate > provision && activate > migrate, log.join("\n"));
  assert.ok(!log.some((line) => / -T api node /.test(line)), "数据库管理任务不应在 api 容器里执行");
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
  assert.match(withoutEmail, new RegExp(`^WEB_IMAGE=${WEB_IMAGE.replaceAll(".", "\\.")}:v1$`, "m"));
  assert.ok(!withoutEmail.includes(PLACEHOLDER_PASSWORD) && !withoutEmail.includes(PLACEHOLDER_JWT));
  assert.ok(!withoutEmail.includes(PLACEHOLDER_APP_PASSWORD));

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
  await writeFile(join(sandbox.stubDir, "images"), [IMAGE, WEB_IMAGE].flatMap((name) => [`${name}:v1`, `${name}:v2`, `${name}:v3`]).join("\n") + "\n");
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
  assert.ok(log.some((line) => line.endsWith(`image rm ${WEB_IMAGE}:v1`)), "配对的 v1 前端镜像也应删除");
  assert.ok(!log.some((line) => /image rm .*:(v2|v3)$/.test(line)), "current 和 previous 的镜像不能删");
});

test("拉镜像失败：退出码 10，旧版本没有被碰（不迁移、不启动新版本），current 不变", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("pull --quiet api caddy$");
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

test("容器里解析不了数据库的服务名（Docker 内置 DNS 不工作）：退出码 10，提示指向内核模块；不建账号、不迁移、不启动新版本", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("migrate node -e ");
  const result = await deploy("v2");
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /容器里解析不了数据库的服务名 db：Docker 内置 DNS 不工作，旧版本没有被替换/);
  assert.match(result.output, /kernel-modules-extra/);
  assert.equal(await linkTarget("current"), "releases/v1");
  const log = await calls();
  assert.ok(indexOfCall(log, /run --rm --no-deps -T migrate node -e /) > indexOfCall(log, /up -d --wait --wait-timeout \d+ db$/), "数据库起来之后才检查");
  assert.equal(indexOfCall(log, /provision-cli\.ts$/), -1);
  assert.equal(indexOfCall(log, /migrate-cli\.ts$/), -1);
  assert.equal(indexOfCall(log, /--remove-orphans$/), -1);
});

test("建应用账号失败：退出码 10，不执行迁移，不启动新版本，current 不变", linuxOnly, async () => {
  await deploy("v1");
  await clearCalls();
  await failWhen("provision-cli\\.ts$");
  const result = await deploy("v2");
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /创建数据库的应用账号失败/);
  assert.equal(await linkTarget("current"), "releases/v1");
  const log = await calls();
  assert.equal(indexOfCall(log, /migrate-cli\.ts$/), -1);
  assert.equal(indexOfCall(log, /--remove-orphans$/), -1, "建账号失败后不应替换正在运行的容器");
});

test("应用账号的数据库密码：.env 里没有时部署自动生成（只写进 .env，不打印），已有的不改；和迁移账号的密码相同、含特殊字符时拒绝部署", linuxOnly, async () => {
  const envFile = join(sandbox.root, ".env");
  const before = LEGACY_ENV_FILE;
  await writeFile(envFile, before, { mode: 0o644 });
  const first = await deploy("v1");
  assert.equal(first.code, 0, first.output);
  const after = await readFile(envFile, "utf8");
  assert.ok(after.startsWith(before), "原有的内容必须原样保留");
  const generated = /^POSTGRES_APP_PASSWORD=([0-9a-f]{48})$/m.exec(after.slice(before.length))?.[1];
  assert.ok(generated, "应追加一行 48 位十六进制的 POSTGRES_APP_PASSWORD");
  assert.notEqual(generated, PLACEHOLDER_PASSWORD);
  assert.equal(after.slice(before.length).trim().split("\n").length, 1, "只应追加这一行");
  assert.equal(spawnSync("stat", ["-c", "%a", envFile], { encoding: "utf8" }).stdout.trim(), "600");
  assert.match(first.output, /POSTGRES_APP_PASSWORD（应用账号的数据库密码）原先没有，已自动生成/);
  assert.ok(!first.output.includes(generated), "生成的密码不能出现在输出里");
  assert.ok(!(await calls()).some((line) => line.includes(generated)), "生成的密码不能出现在 docker 的命令行参数里");

  const second = await deploy("v2");
  assert.equal(second.code, 0, second.output);
  assert.equal(await readFile(envFile, "utf8"), after, "已有的 POSTGRES_APP_PASSWORD 不能被改动");
  assert.ok(!second.output.includes("已自动生成"));

  // 文件末尾没有换行、或这一项留了空位：都补成完整的一行，不和别的行粘在一起
  for (const content of [before.trimEnd(), `${before}POSTGRES_APP_PASSWORD=\n`]) {
    await writeFile(envFile, content);
    const result = await deploy("v3");
    assert.equal(result.code, 0, result.output);
    const lines = (await readFile(envFile, "utf8")).split("\n").filter(Boolean);
    assert.deepEqual(lines.slice(0, 3), before.trimEnd().split("\n"));
    assert.equal(lines.length, 4);
    assert.match(lines[3] ?? "", /^POSTGRES_APP_PASSWORD=[0-9a-f]{48}$/);
  }

  await clearCalls();
  const rejected: [string, RegExp][] = [
    [`POSTGRES_APP_PASSWORD=${PLACEHOLDER_PASSWORD}\n`, /不能和 POSTGRES_PASSWORD 相同/],
    ["POSTGRES_APP_PASSWORD=bad@placeholder/value\n", /只能包含字母、数字/],
    ["POSTGRES_APP_PASSWORD=short\n", /至少 8 个字符/],
  ];
  for (const [line, message] of rejected) {
    await writeFile(envFile, before + line);
    const result = await deploy("v4");
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, message);
    assert.ok(!result.output.includes("bad@placeholder") && !result.output.includes(PLACEHOLDER_PASSWORD));
  }
  assert.deepEqual(await calls(), [], "密码不合规时不应碰任何容器");
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
  assert.ok(indexOfCall(log, /\] login /) < indexOfCall(log, /pull --quiet api caddy$/));
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

test("DEPLOY_SKIP_PULL=1（手工部署：镜像已传到本机）：先确认镜像在本机；不拉取、不登录镜像仓库；其余步骤和顺序与拉镜像的部署完全一样", linuxOnly, async () => {
  await deploy("v1");
  const pulled = (await calls()).filter((line) => !/pull --quiet api caddy$/.test(line));
  await rm(join(sandbox.root, "current"));
  await clearCalls();

  // 即使调用方带了镜像仓库的账号，也不去登录
  const result = await deploy("v1", { DEPLOY_SKIP_PULL: "1", REGISTRY_HOST: "registry.example.test", REGISTRY_USER: "deployer" }, PLACEHOLDER_TOKEN);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /镜像已在本机，不拉取/);
  const log = await calls();
  assert.ok(log[0]?.endsWith(`image inspect ${IMAGE}:v1`), "第一件事应是确认镜像在本机");
  assert.ok(log[1]?.endsWith(`image inspect ${WEB_IMAGE}:v1`), "配对的前端镜像也要确认在本机");
  assert.equal(indexOfCall(log, /pull|login|logout/), -1, log.join("\n"));
  assert.deepEqual(log.slice(2), pulled, "除了「拉镜像」换成「确认镜像在本机」，其余调用应完全一样");
});

test("DEPLOY_SKIP_PULL=1 但镜像不在本机：退出码 10，不碰数据库和容器", linuxOnly, async () => {
  await failWhen("^image inspect ");
  const result = await deploy("v1", { DEPLOY_SKIP_PULL: "1" });
  assert.equal(result.code, 10, result.output);
  assert.match(result.output, /不在这台机器上/);
  assert.equal(indexOfCall(await calls(), /\] compose /), -1);
  assert.equal(await linkTarget("current"), null);
});

test("DEPLOY_SKIP_PULL=1 但只传了 API 镜像、配对的前端镜像不在本机：同样退出码 10，不碰数据库和容器", linuxOnly, async () => {
  await failWhen("^image inspect .*/nozomi-web:");
  const result = await deploy("v1", { DEPLOY_SKIP_PULL: "1" });
  assert.equal(result.code, 10, result.output);
  assert.ok(result.output.includes(`镜像 ${WEB_IMAGE}:v1 不在这台机器上`), result.output);
  assert.equal(indexOfCall(await calls(), /\] compose /), -1);
  assert.equal(await linkTarget("current"), null);
});

test("入口模式 standalone（默认）：API 信任 1 层代理，Caddy 的站点地址是域名；不叠加 behind-proxy 的 compose 文件，不做本机入口检查", linuxOnly, async () => {
  for (const [id, env] of [["v1", {}], ["v2", { EDGE_MODE: "standalone" }]] as const) {
    const result = await deploy(id, env);
    assert.equal(result.code, 0, result.output);
    const written = await releaseEnv(id);
    assert.match(written, /^EDGE_MODE=standalone$/m);
    assert.match(written, /^EDGE_LISTEN=$/m);
    assert.match(written, /^TRUST_PROXY_HOPS=1$/m);
    assert.match(written, /^CADDY_SITE_ADDRESS=staging\.example\.test$/m);
    assert.match(written, /^CADDY_TLS_MODE=auto$/m);
  }
  const composeCalls = (await calls()).filter((line) => line.includes("] compose "));
  assert.ok(composeCalls.length > 0);
  for (const line of composeCalls) assert.ok(!line.includes("compose.behind-proxy.yml"), line);
  assert.deepEqual(await curlCalls(), []);
});

test("入口模式 behind-proxy：API 信任 2 层代理，Caddy 只在容器内提供 HTTP、不用证书；每次 compose 调用都叠加只改端口的文件；容器健康后从本机访问 EDGE_LISTEN 的 /health", linuxOnly, async () => {
  // 带了 ACME_EMAIL 也不申请证书
  const result = await deploy("v1", { ...BEHIND_PROXY, ACME_EMAIL: "ops@example.test" });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /入口模式 behind-proxy（本机 127\.0\.0\.1:18080，不占用 80\/443）/);
  assert.match(result.output, /本机访问 http:\/\/127\.0\.0\.1:18080\/health 返回 200/);
  const written = await releaseEnv("v1");
  assert.match(written, /^EDGE_MODE=behind-proxy$/m);
  assert.match(written, /^EDGE_LISTEN=127\.0\.0\.1:18080$/m);
  assert.match(written, /^TRUST_PROXY_HOPS=2$/m);
  assert.match(written, /^CADDY_SITE_ADDRESS=http:\/\/:8080$/m);
  assert.match(written, /^CADDY_TLS_MODE=off$/m);
  assert.match(written, /^APP_DOMAIN=staging\.example\.test$/m);

  const composeCalls = (await calls()).filter((line) => line.includes("] compose "));
  assert.ok(composeCalls.length >= 3);
  const dir = join(sandbox.root, "releases", "v1");
  for (const line of composeCalls) {
    assert.ok(line.includes(`-f ${join(dir, "compose.yml")} -f ${join(dir, "compose.behind-proxy.yml")} `), line);
    assert.match(line, /--project-name nozomi-staging /);
  }
  const probes = await curlCalls();
  assert.equal(probes.length, 1, "容器健康后应访问一次本机入口");
  assert.ok(probes[0]?.endsWith("http://127.0.0.1:18080/health"), probes[0]);
  const mode = spawnSync("stat", ["-c", "%a", join(dir, "compose.behind-proxy.yml")], { encoding: "utf8" }).stdout.trim();
  assert.equal(mode, "644");
});

test("behind-proxy：容器都健康但本机入口不通——有上一个版本时回退（退出码 20），首次部署时退出码 30 且不建立 current", linuxOnly, async () => {
  await edgeAnswers("000");
  const first = await deploy("v1", BEHIND_PROXY);
  assert.equal(first.code, 30, first.output);
  assert.match(first.output, /从本机访问 http:\/\/127\.0\.0\.1:18080\/health 没有返回 200（最后一次是 000）/);
  assert.equal(await linkTarget("current"), null);
  assert.ok((await curlCalls()).length > 1, "应重试几次再判定不通");

  await edgeAnswers();
  assert.equal((await deploy("v1", BEHIND_PROXY)).code, 0);
  await clearCalls();
  // 新版本换了一个不通的端口；上一个版本的端口仍然是通的
  await writeFile(
    join(sandbox.stubDir, "bin", "curl"),
    CURL_STUB.replace("if [[ -f", 'if [[ "$*" == *:18999/health ]]; then printf 502; exit 0; fi\nif [[ -f'),
  );
  const second = await deploy("v2", { EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:18999" });
  assert.equal(second.code, 20, second.output);
  assert.match(second.output, /已回退，上一个版本 v1 运行正常/);
  assert.equal(await linkTarget("current"), "releases/v1");
  const log = await calls();
  assert.ok(indexOfCall(log, /releases\/v2\/compose\.behind-proxy\.yml up -d --wait .*--remove-orphans$/) >= 0, "应先启动过新版本");
  assert.ok(indexOfCall(log, /releases\/v1\/compose\.behind-proxy\.yml up -d --wait .*--remove-orphans$/) >= 0, "应重新启动上一个版本");
  const probes = await curlCalls();
  assert.ok(probes.at(-1)?.endsWith("http://127.0.0.1:18080/health"), "回退后检查的是上一个版本自己记录的入口");
});

test("behind-proxy：rollback 命令同样以本机入口可达为准", linuxOnly, async () => {
  await deploy("v1", BEHIND_PROXY);
  await deploy("v2", BEHIND_PROXY);
  await clearCalls();
  await edgeAnswers("502");
  const failed = rollback("v2");
  assert.equal(failed.code, 30, failed.output);
  assert.equal(await linkTarget("current"), "releases/v2");

  await edgeAnswers();
  const ok = rollback("v2");
  assert.equal(ok.code, 0, ok.output);
  assert.equal(await linkTarget("current"), "releases/v1");
});

test("入口模式的参数不合法：退出码 1，不调用 docker；EDGE_LISTEN 只接受回环地址", linuxOnly, async () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ EDGE_MODE: "proxy" }, /EDGE_MODE 必须是 standalone 或 behind-proxy/],
    [{ EDGE_MODE: "behind-proxy" }, /必须设置 EDGE_LISTEN/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "0.0.0.0:18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "192.0.2.10:18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: ":18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "localhost:18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.256:18080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:18080:8080" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:18080; touch /tmp/x" }, /回环地址/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:70000" }, /1 到 65535/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:443" }, /不能用 80 或 443/],
    [{ EDGE_MODE: "behind-proxy", EDGE_LISTEN: "127.0.0.1:80" }, /不能用 80 或 443/],
    [{ EDGE_LISTEN: "127.0.0.1:18080" }, /只在 EDGE_MODE=behind-proxy 时使用/],
    [{ API_IMAGE: "registry.example.test/other/mysql:v1" }, /镜像名必须是 nozomi-api/],
    [{ API_IMAGE: "not-nozomi-api:v1" }, /镜像名必须是 nozomi-api/],
  ];
  for (const [env, message] of cases) {
    const result = await deploy("v1", env);
    assert.equal(result.code, 1, JSON.stringify(env) + result.output);
    assert.match(result.output, message);
  }
  assert.deepEqual(await calls(), []);
  assert.deepEqual(await curlCalls(), []);

  for (const listen of ["127.0.0.1:1", "127.0.0.1:65535", "127.255.255.254:8443"]) {
    const result = await deploy("v1", { EDGE_MODE: "behind-proxy", EDGE_LISTEN: listen });
    assert.equal(result.code, 0, listen + result.output);
  }
});

test("清理旧镜像：只按标签逐个删本次的两个镜像（API、前端）所在仓库名下的镜像，从不使用 prune", linuxOnly, async () => {
  await deploy("v1");
  await deploy("v2");
  const neighbor = "registry.example.test/someone-else/site";
  const present = [...[IMAGE, WEB_IMAGE].flatMap((name) => ["v0", "v1", "v2", "v3"].map((tag) => `${name}:${tag}`)), `${neighbor}:v0`, "caddy:2"];
  await writeFile(join(sandbox.stubDir, "images"), present.join("\n") + "\n");
  await clearCalls();
  assert.equal((await deploy("v3")).code, 0);
  const log = await calls();
  const listing = log.filter((line) => /\] image ls /.test(line)).map((line) => line.split(" ").at(-1));
  assert.deepEqual(listing, [IMAGE, WEB_IMAGE], "列镜像时必须限定在本次两个镜像各自的仓库名下");
  const removed = log.filter((line) => /\] image rm /.test(line)).map((line) => line.split(" ").at(-1));
  assert.deepEqual(removed.sort(), [`${IMAGE}:v0`, `${IMAGE}:v1`, `${WEB_IMAGE}:v0`, `${WEB_IMAGE}:v1`]);
  assert.ok(!log.some((line) => /prune|rmi|volume rm|network rm|system /.test(line)), log.join("\n"));
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

test("restore.sh 确认后的顺序：停 API → 备份当前库 → 删库重建 → 建应用账号和权限角色 → 导入 → 迁移 → 启动", linuxOnly, async () => {
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
    // 角色不在备份里：导入之前必须先有，否则备份里「把某张表授权给某个角色」的语句会失败
    /run --rm --no-deps -T migrate node apps\/api\/src\/db\/provision-cli\.ts$/,
    /exec -T db pg_restore -U nozomi -d nozomi --no-owner /,
    /run --rm --no-deps -T migrate node apps\/api\/src\/db\/migrate-cli\.ts$/,
    /up -d --wait --wait-timeout \d+$/,
  ].map((pattern) => indexOfCall(log, pattern));
  assert.ok(order.every((index) => index >= 0), log.join("\n"));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), log.join("\n"));
  assert.ok((await readdir(join(sandbox.root, "backups"))).some((name) => name.includes("pre-restore")));
});

/**
 * 接入前端之前部署的版本目录（服务器上现有的那种）：release.env 里没有 WEB_IMAGE，反向代理用的是官方 caddy 镜像。
 * 这里把它摆成正在运行的版本。
 */
async function installLegacyCurrent(id: string): Promise<void> {
  const dir = await installRelease(id);
  await writeFile(
    join(dir, "release.env"),
    [
      "APP_ENV=staging",
      "APP_DOMAIN=staging.example.test",
      "ACME_EMAIL=",
      "CADDY_TLS_MODE=auto",
      `API_IMAGE=${IMAGE}:${id}`,
      "EDGE_MODE=standalone",
      "EDGE_LISTEN=",
      "CADDY_SITE_ADDRESS=staging.example.test",
      "TRUST_PROXY_HOPS=1",
      "",
    ].join("\n"),
  );
  await symlink(`releases/${id}`, join(sandbox.root, "current"));
}

test("前端镜像的名字由 API 镜像推出：同一个仓库前缀、同一个标签（带端口的仓库地址、不带仓库地址都一样）；调用方传的 WEB_IMAGE 不被采信", linuxOnly, async () => {
  for (const [id, apiImage, webImage] of [
    ["v1", "nozomi-api:abc123", "nozomi-web:abc123"],
    ["v2", "registry.example.test:5000/team/nozomi-api:v2", "registry.example.test:5000/team/nozomi-web:v2"],
    ["v3", "ghcr.io/owner/nozomi-api:0f3c", "ghcr.io/owner/nozomi-web:0f3c"],
  ] as const) {
    await clearCalls();
    const result = await deploy(id, { API_IMAGE: apiImage, WEB_IMAGE: "registry.example.test/someone-else/site:latest" });
    assert.equal(result.code, 0, result.output);
    const env = await releaseEnv(id);
    assert.ok(env.includes(`\nAPI_IMAGE=${apiImage}\n`), env);
    assert.ok(env.includes(`\nWEB_IMAGE=${webImage}\n`), env);
    assert.ok(!env.includes("someone-else"), "调用方环境里的 WEB_IMAGE 不能进 release.env");
    // 两个镜像名都只从这个版本的 release.env 进 docker compose，不从调用方的环境进
    const composeCalls = (await calls()).filter((line) => line.includes("] compose "));
    assert.ok(composeCalls.length > 0);
    for (const line of composeCalls) assert.ok(line.startsWith("[] "), line);
  }
});

test("在只含后端的旧部署之上直接部署：不需要重新初始化；previous 指向旧版本，它的镜像不被清理", linuxOnly, async () => {
  await installLegacyCurrent("legacy");
  await writeFile(join(sandbox.stubDir, "images"), [`${IMAGE}:older`, `${IMAGE}:legacy`, `${IMAGE}:v2`, `${WEB_IMAGE}:v2`].join("\n") + "\n");
  const result = await deploy("v2");
  assert.equal(result.code, 0, result.output);
  assert.equal(await linkTarget("current"), "releases/v2");
  assert.equal(await linkTarget("previous"), "releases/legacy");
  const log = await calls();
  assert.ok(indexOfCall(log, /exec -T db pg_dump /) >= 0, "已有部署时迁移前要备份");
  const removed = log.filter((line) => /\] image rm /.test(line)).map((line) => line.split(" ").at(-1));
  assert.deepEqual(removed, [`${IMAGE}:older`], "只删用不到的旧标签；旧版本的 API 镜像要留着供回退");
  assert.ok(!(await releaseEnv("legacy")).includes("WEB_IMAGE"), "旧版本目录不应被改动");
});

test("在只含后端的旧部署之上部署的新版本不健康：回退到旧版本目录（它自己的 compose 文件和镜像），退出码 20；之后手动回退同样可用", linuxOnly, async () => {
  await installLegacyCurrent("legacy");
  await failWhen("releases/v2/compose\\.yml up -d --wait .*--remove-orphans$");
  const failed = await deploy("v2");
  assert.equal(failed.code, 20, failed.output);
  assert.ok(failed.output.includes(`回退到上一个版本 legacy（镜像 ${IMAGE}:legacy）`), failed.output);
  assert.equal(await linkTarget("current"), "releases/legacy");
  const log = await calls();
  const restored = log.filter((line) => activationOf("legacy").test(line));
  assert.equal(restored.length, 1);
  // 回退用的是旧版本目录自己的两个变量文件；新版本的镜像名（API 和前端）都不会漏进去
  assert.ok(restored[0]?.startsWith("[] "), restored[0]);
  assert.ok(restored[0]?.includes(`--env-file ${join(sandbox.root, "releases", "legacy", "release.env")} `));

  await failWhen();
  assert.equal((await deploy("v3")).code, 0);
  await clearCalls();
  const back = rollback("v3");
  assert.equal(back.code, 0, back.output);
  assert.equal(await linkTarget("current"), "releases/legacy");
  assert.ok((await calls()).some((line) => activationOf("legacy").test(line)));
});
