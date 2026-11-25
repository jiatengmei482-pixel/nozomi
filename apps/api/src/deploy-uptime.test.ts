/**
 * deploy/bin/uptime-check.sh（服务可用性检查，M12-05，ADR 0110）：/health 的判断、最近 5 分钟 API 5xx 的统计和阈值、
 * 心跳地址没填 / 填错 / 发送失败时的行为。
 *
 * 真实执行脚本（经真实的 compose.sh），把 `docker` 和 `curl` 换成替身（放在 PATH 最前面）：
 * docker 替身对 `logs` 输出测试准备好的访问日志；curl 替身按测试指定的结果回 /health，并记下对心跳地址的访问。
 * 不需要 Docker，也不需要数据库。真实容器上的同一套检查（含 Caddy 真实的访问日志格式）由 CI 的 deploy/ci/smoke.sh 覆盖。
 *
 * 脚本依赖 Linux 的 flock，所以只在 Linux 上运行（CI 和服务器都是 Linux）。
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_PATH_PREFIXES } from "../../web/src/lib/api-prefixes.ts";

const DEPLOY_DIR = fileURLToPath(new URL("../../../deploy/", import.meta.url));
const linuxOnly = { skip: process.platform === "linux" ? false : "部署脚本只在 Linux 上运行" };

/** 测试里的心跳地址：带一段标记，用来确认它不出现在输出里。 */
const HEARTBEAT = "https://hc-ping.example.test/heartbeat-marker-0f3a";
/** 访问日志里的来源地址和路径标记：都不应出现在输出里。 */
const CLIENT_IP = "198.51.100.7";
const PATH_MARKER = "path-marker-7c1e";

/** docker 替身：`logs` 时输出 $STUB_DIR/caddy.log；$STUB_DIR/logs-fail 存在时以 1 退出。每次调用的参数记进 calls.log。 */
const DOCKER_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$STUB_DIR/calls.log"
if [[ "$*" == *" logs "* ]]; then
  [[ ! -f "$STUB_DIR/logs-fail" ]] || exit 1
  [[ ! -f "$STUB_DIR/caddy.log" ]] || cat "$STUB_DIR/caddy.log"
fi
`;

/**
 * curl 替身：访问 /health 时输出「$STUB_DIR/health-body、换行、$STUB_DIR/health-code」（脚本用 --write-out 取状态码），
 * health-code 是 000 时像连不上一样以 7 退出；其余访问当作心跳，记进 heartbeat.log，以 $STUB_DIR/heartbeat-exit 的值退出（默认 0）。
 * 每次调用的全部参数记进 curl.log。
 */
const CURL_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$STUB_DIR/curl.log"
if [[ "$*" == */health* ]]; then
  code="$(cat "$STUB_DIR/health-code")"
  printf '%s\\n%s' "$(cat "$STUB_DIR/health-body")" "$code"
  [[ "$code" != "000" ]] || exit 7
  exit 0
fi
printf '%s\\n' "\${!#}" >>"$STUB_DIR/heartbeat.log"
exit "$(cat "$STUB_DIR/heartbeat-exit" 2>/dev/null || printf 0)"
`;

const HEALTH_OK = '{"status":"ok","env":"staging","database":{"status":"ok"}}';

interface Sandbox {
  root: string;
  stubDir: string;
}

interface Result {
  code: number | null;
  output: string;
}

let sandbox: Sandbox;

async function writeRelease(edge: "standalone" | "behind-proxy"): Promise<void> {
  const lines = ["APP_ENV=staging", "APP_DOMAIN=staging.example.test", `EDGE_MODE=${edge}`, `EDGE_LISTEN=${edge === "behind-proxy" ? "127.0.0.1:18080" : ""}`];
  await writeFile(join(sandbox.root, "releases", "v1", "release.env"), `${lines.join("\n")}\n`);
}

async function writeEnv(extra: Record<string, string> = {}): Promise<void> {
  const lines = ["POSTGRES_PASSWORD=test-placeholder-not-a-real-password", ...Object.entries(extra).map(([key, value]) => `${key}=${value}`)];
  await writeFile(join(sandbox.root, ".env"), `${lines.join("\n")}\n`, { mode: 0o600 });
}

async function health(code: string, body = HEALTH_OK): Promise<void> {
  await writeFile(join(sandbox.stubDir, "health-code"), code);
  await writeFile(join(sandbox.stubDir, "health-body"), body);
}

/** Caddy 访问日志的一行（和 deploy/Caddyfile 的 log 配置输出的格式一样：一行一个紧凑的 JSON）。 */
function accessLine(uri: string, status: number): string {
  return JSON.stringify({
    level: status >= 500 ? "error" : "info",
    ts: 1764028800.123,
    logger: "http.log.access.log0",
    msg: "handled request",
    request: {
      remote_ip: CLIENT_IP,
      remote_port: "51234",
      client_ip: CLIENT_IP,
      proto: "HTTP/2.0",
      method: "GET",
      host: "staging.example.test",
      uri,
      headers: { "User-Agent": ["Mozilla/5.0"], Accept: ["*/*"] },
    },
    bytes_read: 0,
    user_id: "",
    duration: 0.0123,
    size: 42,
    status,
    resp_headers: { "Content-Type": ["application/json"] },
  });
}

/** 生成访问日志：每项是「次数、路径、状态码」。 */
async function accessLog(...entries: Array<[number, string, number]>): Promise<void> {
  const lines = entries.flatMap(([count, uri, status]) => Array.from({ length: count }, () => accessLine(uri, status)));
  await writeFile(join(sandbox.stubDir, "caddy.log"), lines.map((line) => `${line}\n`).join(""));
}

async function heartbeats(): Promise<string[]> {
  const path = join(sandbox.stubDir, "heartbeat.log");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

async function curlCalls(): Promise<string[]> {
  const path = join(sandbox.stubDir, "curl.log");
  if (!existsSync(path)) return [];
  return (await readFile(path, "utf8")).split("\n").filter(Boolean);
}

function check(env: Record<string, string> = {}): Result {
  const result = spawnSync("bash", [join(sandbox.root, "current", "bin", "uptime-check.sh")], {
    env: { PATH: `${join(sandbox.stubDir, "bin")}:${process.env["PATH"] ?? ""}`, STUB_DIR: sandbox.stubDir, ...env },
    encoding: "utf8",
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

/** 输出里不能有心跳地址、访问日志里的来源地址和路径。 */
function assertNothingLeaked(output: string): void {
  for (const secret of [HEARTBEAT, "heartbeat-marker", CLIENT_IP, PATH_MARKER, "hc-ping"]) {
    assert.ok(!output.includes(secret), `输出里不应出现 ${secret}：\n${output}`);
  }
}

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), "nozomi-uptime-test-"));
  const root = join(base, "staging");
  const stubDir = join(base, "stub");
  sandbox = { root, stubDir };
  const release = join(root, "releases", "v1");
  await mkdir(release, { recursive: true });
  for (const entry of ["compose.yml", "compose.behind-proxy.yml", "Caddyfile", "bin"]) {
    await cp(join(DEPLOY_DIR, entry), join(release, entry), { recursive: true });
  }
  await symlink("releases/v1", join(root, "current"));
  await mkdir(join(stubDir, "bin"), { recursive: true });
  for (const [name, content] of [["docker", DOCKER_STUB], ["curl", CURL_STUB]] as const) {
    await writeFile(join(stubDir, "bin", name), content);
    await chmod(join(stubDir, "bin", name), 0o755);
  }
  await writeRelease("standalone");
  await writeEnv({ UPTIME_HEARTBEAT_URL: HEARTBEAT });
  await health("200");
  await accessLog([50, "/platform/v1/orders", 200], [3, "/site/v1/quotes", 500]);
});

afterEach(async () => {
  await rm(join(sandbox.root, ".."), { recursive: true, force: true });
});

test("全部正常：经 standalone 入口（本机 443、按域名验证书）访问 /health，访问一次心跳地址，退出码 0；输出里没有心跳地址", linuxOnly, async () => {
  const result = check();
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(await heartbeats(), [HEARTBEAT]);
  const healthCall = (await curlCalls()).find((line) => line.includes("/health"));
  assert.match(healthCall ?? "", /--resolve staging\.example\.test:443:127\.0\.0\.1 https:\/\/staging\.example\.test:443\/health$/);
  assert.ok(!healthCall?.includes("--insecure") && !healthCall?.includes(" -k "), "不能跳过证书验证");
  assert.match(result.output, /正常：\/health 返回 200，status 是 ok（入口模式 standalone）/);
  assert.match(result.output, /最近 5 分钟 API 请求 53 次，其中 5xx 3 次/);
  assert.match(result.output, /全部正常\n$/);
  assertNothingLeaked(result.output);
  // 访问日志经 compose.sh 读（带项目名），只读最近 5 分钟、只读反向代理
  const dockerCalls = (await readFile(join(sandbox.stubDir, "calls.log"), "utf8")).split("\n").filter(Boolean);
  assert.equal(dockerCalls.length, 1);
  assert.match(dockerCalls[0] ?? "", /^compose --project-name nozomi-staging .* logs --no-log-prefix --since 5m caddy$/);
});

test("behind-proxy：从本机访问 EDGE_LISTEN 的 /health，不连 443", linuxOnly, async () => {
  await writeRelease("behind-proxy");
  const result = check();
  assert.equal(result.code, 0, result.output);
  const healthCall = (await curlCalls()).find((line) => line.includes("/health"));
  assert.match(healthCall ?? "", / http:\/\/127\.0\.0\.1:18080\/health$/);
  assert.ok(!healthCall?.includes("--resolve"));
  assert.match(result.output, /入口模式 behind-proxy/);
  assert.deepEqual(await heartbeats(), [HEARTBEAT]);
});

test("CI 冒烟用的两个变量：换本机端口、换根证书（真实服务器上不设）", linuxOnly, async () => {
  const result = check({ UPTIME_CHECK_HTTPS_PORT: "18443", UPTIME_CHECK_CA_FILE: "/tmp/ci-root.crt" });
  assert.equal(result.code, 0, result.output);
  const healthCall = (await curlCalls()).find((line) => line.includes("/health"));
  assert.match(healthCall ?? "", /--resolve staging\.example\.test:18443:127\.0\.0\.1 --cacert \/tmp\/ci-root\.crt https:\/\/staging\.example\.test:18443\/health$/);
});

test("/health 不通：503、连不上、200 但 status 不是 ok，都不访问心跳地址，退出码 1，写明原因且不打印响应内容", linuxOnly, async () => {
  for (const [code, body, reason] of [
    ["503", '{"status":"error","database":{"status":"error","errorCode":"DB_UNREACHABLE"}}', /没有返回 200（返回的是 503/],
    ["000", "", /没有返回 200（返回的是 000，000 表示连不上或超时/],
    ["502", "<html>Bad Gateway</html>", /没有返回 200（返回的是 502/],
    ["200", '{"status":"degraded"}', /返回了 200，但 status 不是 ok/],
  ] as const) {
    await health(code, body);
    const result = check();
    assert.equal(result.code, 1, `${code}：${result.output}`);
    assert.match(result.output, reason);
    assert.match(result.output, /共 1 项异常，没有发送心跳/);
    assert.ok(!result.output.includes("DB_UNREACHABLE") && !result.output.includes("Bad Gateway"), "不打印响应内容");
    assertNothingLeaked(result.output);
  }
  assert.deepEqual(await heartbeats(), []);
});

test("5xx 阈值（默认至少 20 次并且至少 10%）：两个条件都满足才算异常", linuxOnly, async () => {
  const cases: Array<{ entries: Array<[number, string, number]>; abnormal: boolean; label: string }> = [
    { entries: [[180, "/platform/v1/orders", 200], [20, "/tenant/v1/orders", 500]], abnormal: true, label: "20 次、正好 10%" },
    { entries: [[0, "/platform/v1/orders", 200], [19, "/tenant/v1/orders", 502]], abnormal: false, label: "19 次、100%：次数不够" },
    { entries: [[300, "/platform/v1/orders", 200], [25, "/sales/v1/quotes", 500]], abnormal: false, label: "25 次、7%：占比不够" },
    { entries: [[10, "/driver/v1/jobs", 200], [40, "/embed/v1/quotes", 504]], abnormal: true, label: "40 次、80%（反向代理回的 504 也算）" },
    { entries: [[181, "/site/v1/quotes", 200], [20, "/webhooks/stripe", 500]], abnormal: false, label: "20 次、不到 10%" },
    { entries: [], abnormal: false, label: "没有请求" },
  ];
  for (const { entries, abnormal, label } of cases) {
    await accessLog(...entries);
    const result = check();
    assert.equal(result.code, abnormal ? 1 : 0, `${label}：${result.output}`);
    if (abnormal) assert.match(result.output, /异常：最近 5 分钟 API 有 \d+ 次 5xx，占 \d+ 次请求的 \d+%（阈值：至少 20 次并且至少 10%）/, label);
  }
  // 只有判为正常的那几次发了心跳
  assert.equal((await heartbeats()).length, 4);
});

test("只数归 API 的请求：前端页面、静态文件、像 API 但不是的路径、不是访问日志的行都不算；带查询串的 API 路径照算", linuxOnly, async () => {
  const lines = [
    ...Array.from({ length: 30 }, () => accessLine("/assets/index-abc.js", 500)),
    ...Array.from({ length: 30 }, () => accessLine("/book", 502)),
    ...Array.from({ length: 30 }, () => accessLine("/platform/v1x", 500)),
    ...Array.from({ length: 30 }, () => accessLine("/healthz", 500)),
    ...Array.from({ length: 30 }, () => JSON.stringify({ level: "error", msg: "dial tcp: lookup api", status: 502, request: { uri: "/platform/v1" } })),
    "{not json at all",
    ...Array.from({ length: 4 }, () => accessLine(`/platform/v1/${PATH_MARKER}`, 200)),
    ...Array.from({ length: 2 }, () => accessLine("/health?probe=1", 503)),
    accessLine("/tenant/v1", 500),
  ];
  await writeFile(join(sandbox.stubDir, "caddy.log"), `${lines.join("\n")}\n`);
  const result = check();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /最近 5 分钟 API 请求 7 次，其中 5xx 3 次/);
  assertNothingLeaked(result.output);

  // 同一份日志，阈值调低到 3 次、40%：3/7 = 42% → 异常
  await writeEnv({ UPTIME_HEARTBEAT_URL: HEARTBEAT, UPTIME_5XX_MIN_COUNT: "3", UPTIME_5XX_MIN_PERCENT: "40" });
  const tuned = check();
  assert.equal(tuned.code, 1, tuned.output);
  assert.match(tuned.output, /API 有 3 次 5xx，占 7 次请求的 42%（阈值：至少 3 次并且至少 40%）/);
  assertNothingLeaked(tuned.output);
});

test(".env 里的阈值填错（不是整数、0、超过 100%）：算异常、不发心跳，写明是哪一项", linuxOnly, async () => {
  for (const [key, value, reason] of [
    ["UPTIME_5XX_MIN_COUNT", "abc", /UPTIME_5XX_MIN_COUNT 应是 1 以上的整数/],
    ["UPTIME_5XX_MIN_COUNT", "0", /UPTIME_5XX_MIN_COUNT 应是 1 以上的整数/],
    ["UPTIME_5XX_MIN_PERCENT", "101", /UPTIME_5XX_MIN_PERCENT 应是 1 到 100 的整数/],
    ["UPTIME_5XX_MIN_PERCENT", "5.5", /UPTIME_5XX_MIN_PERCENT 应是 1 到 100 的整数/],
  ] as const) {
    await writeEnv({ UPTIME_HEARTBEAT_URL: HEARTBEAT, [key]: value });
    const result = check();
    assert.equal(result.code, 1, `${key}=${value}：${result.output}`);
    assert.match(result.output, reason);
  }
  assert.deepEqual(await heartbeats(), []);
});

test("读不到访问日志（容器没在运行、Docker 没响应）：算异常、不发心跳", linuxOnly, async () => {
  await writeFile(join(sandbox.stubDir, "logs-fail"), "");
  const result = check();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /读不到反向代理最近 5 分钟的访问日志/);
  assert.deepEqual(await heartbeats(), []);
});

test("没填 UPTIME_HEARTBEAT_URL：检查照做、只记日志，不访问任何心跳地址，退出码 0（不报错）", linuxOnly, async () => {
  for (const env of [{}, { UPTIME_HEARTBEAT_URL: "" }]) {
    await writeEnv(env);
    const result = check();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /全部正常（没有配置 UPTIME_HEARTBEAT_URL，只记日志）/);
  }
  assert.deepEqual(await heartbeats(), []);
  // 只访问了 /health，没有别的请求
  assert.ok((await curlCalls()).every((line) => line.includes("/health")));
});

test("心跳地址不是 https://：不访问它，退出码 1；本机回环地址上的 http://（CI 冒烟的假接收端）可以", linuxOnly, async () => {
  for (const url of ["http://hc-ping.example.test/abc", "ftp://example.test/x", "https://has space.example.test/x", "http://127.0.0.2/x"]) {
    await writeEnv({ UPTIME_HEARTBEAT_URL: url });
    const result = check();
    assert.equal(result.code, 1, `${url}：${result.output}`);
    assert.match(result.output, /UPTIME_HEARTBEAT_URL 应以 https:\/\/ 开头/);
    assert.ok(!result.output.includes(url));
  }
  assert.deepEqual(await heartbeats(), []);
  await writeEnv({ UPTIME_HEARTBEAT_URL: "http://127.0.0.1:18093/ping/smoke" });
  assert.equal(check().code, 0);
  assert.deepEqual(await heartbeats(), ["http://127.0.0.1:18093/ping/smoke"]);
});

test("发送心跳失败：只提示一行（带 curl 退出码、不带地址），检查结果仍是正常；访问心跳时有超时和重试", linuxOnly, async () => {
  await writeFile(join(sandbox.stubDir, "heartbeat-exit"), "28");
  const result = check();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /发送心跳失败（curl 退出码 28；监控服务那边会在超时后报警）/);
  assertNothingLeaked(result.output);
  const call = (await curlCalls()).find((line) => line.endsWith(HEARTBEAT)) ?? "";
  assert.match(call, /--max-time 10 --retry 3/);
  assert.ok(!call.includes("--show-error"), "curl 的报错里可能带着地址，不打开");
});

test("上一次检查还没结束：这一次不检查、不发心跳，退出码 1", linuxOnly, async () => {
  const holder = spawnSync("bash", ["-c", `exec 9>"$1/.uptime-check.lock"; flock -n 9 && STUB_DIR="$2" PATH="$3" bash "$1/current/bin/uptime-check.sh"`, "_", sandbox.root, sandbox.stubDir, `${join(sandbox.stubDir, "bin")}:${process.env["PATH"] ?? ""}`], { encoding: "utf8" });
  assert.equal(holder.status, 1, holder.stdout + holder.stderr);
  assert.match(holder.stdout + holder.stderr, /上一次检查还没有结束/);
  assert.deepEqual(await heartbeats(), []);
  assert.deepEqual(await curlCalls(), []);
});

test("脚本里归 API 的路径前缀和前端、反向代理用的那张表（apps/web/src/lib/api-prefixes.ts）一致", async () => {
  const script = await readFile(join(DEPLOY_DIR, "bin", "uptime-check.sh"), "utf8");
  const list = script.match(/^API_PATH_PREFIXES=\(([^)]*)\)$/m)?.[1];
  assert.deepEqual(list?.split(" "), [...API_PATH_PREFIXES]);
});

test("定时任务：初始化脚本装每 5 分钟一次的检查，结果进系统日志；.env 留好心跳地址的空位；还没装上的服务器部署时会提示", async () => {
  const bootstrap = await readFile(join(DEPLOY_DIR, "bootstrap.sh"), "utf8");
  assert.match(
    bootstrap,
    /^\*\/5 \* \* \* \* \$DEPLOY_USER \[ -x \$env_dir\/current\/bin\/uptime-check\.sh \] && \$env_dir\/current\/bin\/uptime-check\.sh 2>&1 \| logger -t nozomi-uptime$/m,
  );
  assert.match(bootstrap, /cron_file="\/etc\/cron\.d\/nozomi-uptime-\$1"/);
  assert.match(bootstrap, /BACKUP_HEARTBEAT_URL UPTIME_HEARTBEAT_URL; do\n\s+ensure_placeholder/);
  assert.ok(bootstrap.indexOf('install_uptime_cron "$app_env" "$env_dir"') > bootstrap.indexOf('install_backup_cron "$app_env" "$env_dir"\n'), "定时任务服务由 install_backup_cron 先装好");
  const deployScript = await readFile(join(DEPLOY_DIR, "bin", "deploy.sh"), "utf8");
  assert.match(deployScript, /if \[\[ -f "\/etc\/cron\.d\/nozomi-backup-\$APP_ENV" && ! -f "\/etc\/cron\.d\/nozomi-uptime-\$APP_ENV" \]\]; then\n\s+log "提示：这台服务器还没有服务可用性检查的定时任务/);
});
