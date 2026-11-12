/**
 * 测试环境只读核对（M8-34，ADR 0086）：
 * - 脚本 scripts/staging-readonly-check.mjs：登录（密码 → 两步验证）、取清单、存 JSON、按有无变化给退出码；不打印密钥；缺 secrets 清楚提示。
 *   全部用替身的 fetch，不联网。
 * - 工作流 .github/workflows/staging-readonly-check.yml 的静态检查：只能手动触发、环境只能是 staging、没有 SSH 和部署钥匙。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type CheckIo, type RolePreviewReport, hasChanges, missingSecrets, parseBaseUrl, parseDays, runCheck, summarize, totp } from "../../../scripts/staging-readonly-check.mjs";

const ROOT = new URL("../../../", import.meta.url);

/** 明显的占位值：测试里没有任何真实密钥。RFC 6238 附录 B 的 SHA-1 测试密钥是 ASCII「12345678901234567890」，Base32 写法如下。 */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const PLACEHOLDER_PASSWORD = "test-placeholder-not-a-real-password";
const PLACEHOLDER_TOKEN = "test-placeholder-token-0000";
const ENV = { STAGING_READONLY_EMAIL: "readonly@example.test", STAGING_READONLY_PASSWORD: PLACEHOLDER_PASSWORD, STAGING_READONLY_TOTP: RFC_SECRET, NOZOMI_BASE_URL: "https://staging.example.test", CHECK_DAYS: "7" };

const report = (externalDiffCount = 0, changedCount = 0): RolePreviewReport & Record<string, unknown> => ({
  migrated: true,
  suppliers: [],
  totalAreas: 0,
  published: [],
  replay: { days: 7, since: "2026-11-05T00:00:00.000Z", logs: 3, replayed: 3, skipped: 0, evaluations: 6, externalDiffCount, externalDiffs: [], refinements: {}, priority: { changedCount, changed: [], keptOffers: 4, newOffers: { distance: 1 } } },
});

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** 测试环境的替身：按「方法 路径」依次给出应答 */
function stage(responses: Record<string, { status: number; body: unknown }[]>, nowMs = 59_000) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const outputs: string[] = [];
  const summaries: string[] = [];
  const sleeps: number[] = [];
  let clock = nowMs;
  const io: CheckIo = {
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      calls.push({ method: init.method, url, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) });
      const queue = responses[`${init.method} ${path}`];
      const next = queue?.shift();
      if (next === undefined) throw new Error(`没有准备 ${init.method} ${path} 的应答`);
      return { status: next.status, json: async () => next.body };
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    log: (line) => lines.push(line),
    writeOutput: async (text) => {
      outputs.push(text);
    },
    writeSummary: async (text) => {
      summaries.push(text);
    },
  };
  return { io, calls, lines, outputs, summaries, sleeps };
}

const loggedIn = (status: "verify_required" | "enrollment_required" | null = "verify_required", extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { access_token: PLACEHOLDER_TOKEN, token_type: "Bearer", must_change_password: false, ...(status === null ? {} : { second_factor: { status } }), ...extra },
});
const verified = { status: 200, body: { second_factor: { status: "verified", method: "totp", recovery_codes_remaining: 8 } } };
const loggedOut = { status: 204, body: null };

function assertNoSecrets(texts: readonly string[]): void {
  for (const text of texts) {
    for (const secret of [PLACEHOLDER_PASSWORD, PLACEHOLDER_TOKEN, RFC_SECRET, "287082"]) assert.ok(!text.includes(secret), `输出里出现了密钥：${text}`);
  }
}

test("动态码：RFC 6238 附录 B 的 SHA-1 测试向量（取后 6 位）", () => {
  assert.equal(totp(RFC_SECRET, 59_000), "287082");
  assert.equal(totp(RFC_SECRET, 1_111_111_109_000), "081804");
  assert.equal(totp(RFC_SECRET, 1_234_567_890_000), "005924");
  assert.equal(totp(RFC_SECRET.toLowerCase(), 59_000), "287082");
  assert.throws(() => totp("not base32!", 59_000), /Base32/);
});

test("天数、地址、缺哪些 secrets", () => {
  assert.equal(parseDays(undefined), 30);
  assert.equal(parseDays(""), 30);
  assert.equal(parseDays(" 7 "), 7);
  assert.equal(parseDays("90"), 90);
  for (const raw of ["0", "91", "1.5", "-1", "x", "100"]) assert.throws(() => parseDays(raw), /1 到 90/, raw);
  assert.equal(parseBaseUrl("https://staging.example.test/"), "https://staging.example.test");
  assert.throws(() => parseBaseUrl("https://"), /APP_DOMAIN/);
  assert.throws(() => parseBaseUrl("http://staging.example.test"), /https/);
  assert.deepEqual(missingSecrets({}), ["STAGING_READONLY_EMAIL", "STAGING_READONLY_PASSWORD", "STAGING_READONLY_TOTP"]);
  assert.deepEqual(missingSecrets({ ...ENV, STAGING_READONLY_TOTP: " " }), ["STAGING_READONLY_TOTP"]);
  assert.deepEqual(missingSecrets(ENV), []);
});

test("变化的判定和摘要", () => {
  assert.equal(hasChanges(report()), false);
  assert.equal(hasChanges(report(1, 0)), true);
  assert.equal(hasChanges(report(0, 2)), true);
  assert.match(summarize(report()).join("\n"), /0 处变化，通过/);
  assert.match(summarize(report(0, 2)).join("\n"), /有变化，不通过/);
});

test("没有变化：密码 → 两步验证 → 取清单 → 退出登录；存原样的 JSON，退出码 0；不打印密钥", async () => {
  const body = report();
  const s = stage({ "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [verified], "GET /platform/v1/reports/area-role-preview": [{ status: 200, body }], "POST /platform/v1/auth/logout": [loggedOut] });
  assert.equal(await runCheck(ENV, s.io), 0);
  assert.deepEqual(s.calls.map((call) => `${call.method} ${call.url}`), [
    "POST https://staging.example.test/platform/v1/auth/login",
    "POST https://staging.example.test/platform/v1/auth/mfa/verify",
    "GET https://staging.example.test/platform/v1/reports/area-role-preview?days=7",
    "POST https://staging.example.test/platform/v1/auth/logout",
  ]);
  assert.deepEqual(s.calls[0]?.body, { email: "readonly@example.test", password: PLACEHOLDER_PASSWORD });
  assert.equal(s.calls[0]?.headers["authorization"], undefined);
  assert.deepEqual(s.calls[1]?.body, { code: "287082" });
  for (const call of s.calls.slice(1)) assert.equal(call.headers["authorization"], `Bearer ${PLACEHOLDER_TOKEN}`);
  assert.deepEqual(JSON.parse(s.outputs[0] ?? ""), body);
  assert.match(s.summaries[0] ?? "", /## 测试环境只读核对/);
  assertNoSecrets([...s.lines, ...s.summaries]);
});

test("回放有变化：照样存清单，退出码 2（工作流失败）", async () => {
  const s = stage({ "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [verified], "GET /platform/v1/reports/area-role-preview": [{ status: 200, body: report(1, 0) }], "POST /platform/v1/auth/logout": [loggedOut] });
  assert.equal(await runCheck(ENV, s.io), 2);
  assert.equal(s.outputs.length, 1);
  assert.match(s.lines.join("\n"), /对外结果不同：1 处/);
});

test("同一时间窗的动态码已经用过（MFA_CODE_REUSED）：等到下一个时间窗再试一次", async () => {
  const s = stage({
    "POST /platform/v1/auth/login": [loggedIn()],
    "POST /platform/v1/auth/mfa/verify": [{ status: 400, body: { error: { code: "MFA_CODE_REUSED", message: "", details: {} } } }, verified],
    "GET /platform/v1/reports/area-role-preview": [{ status: 200, body: report() }],
    "POST /platform/v1/auth/logout": [loggedOut],
  });
  assert.equal(await runCheck(ENV, s.io), 0);
  assert.equal(s.sleeps.length, 1);
  const codes = s.calls.filter((call) => call.url.endsWith("/mfa/verify")).map((call) => (call.body as { code: string }).code);
  assert.equal(codes.length, 2);
  assert.notEqual(codes[0], codes[1]);
});

test("缺 secrets：清楚提示缺哪几个、在哪填，不调用测试环境，退出码 1", async () => {
  const s = stage({});
  assert.equal(await runCheck({ NOZOMI_BASE_URL: "https://staging.example.test", STAGING_READONLY_EMAIL: "readonly@example.test" }, s.io), 1);
  assert.equal(s.calls.length, 0);
  assert.match(s.lines.join("\n"), /STAGING_READONLY_PASSWORD、STAGING_READONLY_TOTP/);
  assert.match(s.lines.join("\n"), /Settings → Environments → staging/);
});

test("失败的几种情况都给出退出码 1 和中文说明，只有状态码和错误代码，不打印密钥和应答原文", async () => {
  const error = (status: number, code: string) => ({ status, body: { error: { code, message: `原文-${PLACEHOLDER_PASSWORD}`, details: {} } } });
  const cases: [string, Record<string, { status: number; body: unknown }[]>, RegExp][] = [
    ["密码不对", { "POST /platform/v1/auth/login": [error(401, "INVALID_CREDENTIALS")] }, /登录失败：401 INVALID_CREDENTIALS（邮箱或密码不对/],
    ["临时密码", { "POST /platform/v1/auth/login": [loggedIn("verify_required", { must_change_password: true })] }, /临时密码/],
    ["没绑定两步验证", { "POST /platform/v1/auth/login": [loggedIn("enrollment_required")] }, /还没绑定两步验证/],
    ["动态码不对", { "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [error(400, "MFA_CODE_INVALID")] }, /两步验证失败：400 MFA_CODE_INVALID/],
    ["没有权限", { "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [verified], "GET /platform/v1/reports/area-role-preview": [error(403, "FORBIDDEN")], "POST /platform/v1/auth/logout": [loggedOut] }, /403 FORBIDDEN（这个账号的角色没有「报价试算」）/],
    ["限速", { "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [verified], "GET /platform/v1/reports/area-role-preview": [error(429, "RATE_LIMITED")], "POST /platform/v1/auth/logout": [loggedOut] }, /429 RATE_LIMITED/],
    ["超时", { "POST /platform/v1/auth/login": [loggedIn()], "POST /platform/v1/auth/mfa/verify": [verified], "GET /platform/v1/reports/area-role-preview": [error(503, "REPORT_TIMEOUT")], "POST /platform/v1/auth/logout": [loggedOut] }, /把天数改小/],
  ];
  for (const [name, responses, message] of cases) {
    const s = stage(responses);
    assert.equal(await runCheck(ENV, s.io), 1, name);
    assert.match(s.lines.join("\n"), message, name);
    assert.equal(s.outputs.length, 0, name);
    assertNoSecrets(s.lines);
    assert.ok(!s.lines.join("\n").includes("原文-"), `${name}：不打印应答原文`);
    if (s.calls.some((call) => call.url.includes("/reports/"))) assert.ok(s.calls.at(-1)?.url.endsWith("/auth/logout"), `${name}：取过清单就要退出登录`);
  }
  const offline = stage({});
  offline.io.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  assert.equal(await runCheck(ENV, offline.io), 1);
  assert.match(offline.lines.join("\n"), /连不上测试环境/);
  const badDays = stage({});
  assert.equal(await runCheck({ ...ENV, CHECK_DAYS: "91" }, badDays.io), 1);
  assert.equal(badDays.calls.length, 0);
});

interface Step {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, { inputs?: Record<string, { default?: string; type?: string }> }>;
  permissions?: Record<string, string>;
  jobs: Record<string, { environment?: unknown; steps: Step[]; permissions?: Record<string, string> }>;
}

test("工作流：只能手动触发；环境只能是 staging；不用 SSH、不用部署钥匙；只用官方 action；只调用这个脚本", async () => {
  const text = await readFile(new URL(".github/workflows/staging-readonly-check.yml", ROOT), "utf8");
  const workflow = parse(text) as Workflow;
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(Object.keys(workflow.on["workflow_dispatch"]?.inputs ?? {}), ["days"]);
  assert.equal(workflow.on["workflow_dispatch"]?.inputs?.["days"]?.default, "30");
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const jobs = Object.values(workflow.jobs);
  assert.equal(jobs.length, 1);
  for (const job of jobs) {
    assert.equal(job.environment, "staging", "环境固定 staging，不能由输入决定");
    assert.equal(job.permissions, undefined);
  }
  // 注释里会说明「不用 SSH」，只查注释以外的内容
  const code = text.split("\n").filter((line) => !/^\s*#/.test(line)).join("\n");
  assert.doesNotMatch(code, /ssh|VPS_|deploy[_-]?key|PRIVATE_KEY|production|set -x/i);
  const steps = jobs.flatMap((job) => job.steps);
  for (const step of steps) if (step.uses !== undefined) assert.match(step.uses, /^actions\/(checkout|setup-node|upload-artifact)@v\d+$/, `不允许的 action：${step.uses}`);
  const runs = steps.flatMap((step) => (step.run === undefined ? [] : [step.run.trim()]));
  assert.deepEqual(runs, ["node scripts/staging-readonly-check.mjs"]);
  const call = steps.find((step) => step.run !== undefined);
  assert.deepEqual(Object.keys(call?.env ?? {}).sort(), ["CHECK_DAYS", "CHECK_OUTPUT", "NOZOMI_BASE_URL", "STAGING_READONLY_EMAIL", "STAGING_READONLY_PASSWORD", "STAGING_READONLY_TOTP"]);
  for (const name of ["STAGING_READONLY_EMAIL", "STAGING_READONLY_PASSWORD", "STAGING_READONLY_TOTP"]) assert.equal(call?.env?.[name], `\${{ secrets.${name} }}`);
  // 输入只经由环境变量进脚本，不拼进命令行
  assert.equal(call?.env?.["CHECK_DAYS"], "${{ inputs.days }}");
  const upload = steps.find((step) => step.uses?.startsWith("actions/upload-artifact@") === true);
  assert.equal(upload?.if, "always()");
  assert.equal(upload?.with?.["path"], call?.env?.["CHECK_OUTPUT"]);
});
