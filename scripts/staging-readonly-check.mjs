/**
 * 测试环境的只读核对（M8-34，ADR 0086）：GitHub Actions 的「Staging readonly check」工作流调用它，不用 SSH、不登录服务器。
 *
 * 用一个只读的平台账号（密码 + 两步验证的动态码）登录测试环境，调用 `GET /platform/v1/reports/area-role-preview?days=N`
 * （和 `pnpm areas:role-preview --json` 同一份清单），把应答原样存成 JSON 文件（工作流把它作为产物保存），最后退出登录。
 *
 * 退出码：0 = 回放没有变化；2 = 回放有变化（`externalDiffCount` 或 `priority.changedCount` 大于 0）；1 = 没配好或调用失败。
 * 不打印密码、动态码密钥、动态码和令牌；接口的报错只打印状态码和错误代码。
 *
 * 环境变量：STAGING_READONLY_EMAIL、STAGING_READONLY_PASSWORD、STAGING_READONLY_TOTP（验证器的密钥，Base32）、
 * NOZOMI_BASE_URL（https://测试环境域名）、CHECK_DAYS（1–90，默认 30）、CHECK_OUTPUT（JSON 文件路径）、GITHUB_STEP_SUMMARY（可选）。
 */
import { createHmac } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SECRET_NAMES = ["STAGING_READONLY_EMAIL", "STAGING_READONLY_PASSWORD", "STAGING_READONLY_TOTP"];
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 90;
const AUTH_TIMEOUT_MS = 30_000;
/** 接口自己 45 秒内一定给出结果或 503，这里多留一些网络时间 */
const REPORT_TIMEOUT_MS = 90_000;
const TOTP_STEP_SECONDS = 30;

/** 调用失败：只带给人看的说明，不带应答原文 */
export class CheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckError";
  }
}

/** 环境里缺哪几个密钥（空字符串也算缺） */
export function missingSecrets(env) {
  return SECRET_NAMES.filter((name) => typeof env[name] !== "string" || env[name].trim() === "");
}

export function parseDays(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_DAYS;
  const text = String(raw).trim();
  const days = /^\d{1,2}$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw new CheckError(`天数要是 1 到 ${MAX_DAYS} 之间的整数（现在是「${text}」）。`);
  return days;
}

/** 测试环境的地址：只认 https，不带路径 */
export function parseBaseUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? "").trim());
  } catch {
    throw new CheckError("没有测试环境的地址：staging 环境的变量 APP_DOMAIN 没填。");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new CheckError("测试环境的地址要是 https://域名。");
  return url.origin;
}

function base32Decode(text) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new CheckError("STAGING_READONLY_TOTP 不是验证器的密钥（要是 Base32，绑定两步验证时页面上显示的那串字母和数字）。");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length === 0) throw new CheckError("STAGING_READONLY_TOTP 是空的。");
  return Buffer.from(bytes);
}

/** RFC 6238 的 6 位动态码（SHA-1、30 秒一个），和服务端、常见验证器一样 */
export function totp(secret, nowMs) {
  const counter = Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

/** 回放有没有变化 */
export function hasChanges(report) {
  return report.replay.externalDiffCount > 0 || report.replay.priority.changedCount > 0;
}

/** 给人看的结果（中文，没有客人信息；清单本身也没有） */
export function summarize(report) {
  const { replay } = report;
  const added = Object.entries(replay.priority.newOffers).map(([basis, n]) => `${basis} ${n} 个`).join("、") || "没有";
  return [
    `回放最近 ${replay.days} 天（${replay.since} 起）的询价日志 ${replay.logs} 条：回放 ${replay.replayed} 条、跳过 ${replay.skipped} 条，算了 ${replay.evaluations} 次。`,
    `区域用途（M8-20）对外结果不同：${replay.externalDiffCount} 处。`,
    `报价优先级（M8-30）之前报得出的价有变化：${replay.priority.changedCount} 处；没变的 ${replay.priority.keptOffers} 个；之前报不出、现在新报出的：${added}。`,
    hasChanges(report) ? "结论：有变化，不通过。看产物里的 externalDiffs、priority.changed。" : "结论：0 处变化，通过。",
  ];
}

function errorCode(body) {
  const code = body?.error?.code;
  return typeof code === "string" && /^[A-Z_]{1,60}$/.test(code) ? code : "未知";
}

async function call(fetchImpl, baseUrl, method, path, { token, body, timeoutMs }) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new CheckError(timedOut ? `${method} ${path} 超过 ${timeoutMs / 1000} 秒没有应答。` : `${method} ${path} 连不上测试环境（网络错误）。`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

/** 登录（密码 → 两步验证），返回令牌。同一时间窗的动态码服务端只收一次：碰上 MFA_CODE_REUSED 等到下一个时间窗再试一次。 */
export async function login(io, credentials) {
  const signedIn = await call(io.fetch, io.baseUrl, "POST", "/platform/v1/auth/login", { body: { email: credentials.email, password: credentials.password }, timeoutMs: AUTH_TIMEOUT_MS });
  if (signedIn.status !== 200) {
    const hint = signedIn.status === 401 ? "（邮箱或密码不对，请在 staging 环境的 secrets 里核对）" : signedIn.status === 429 ? "（登录尝试太多，过 15 分钟再试）" : "";
    throw new CheckError(`登录失败：${signedIn.status} ${errorCode(signedIn.body)}${hint}`);
  }
  const token = signedIn.body?.access_token;
  if (typeof token !== "string") throw new CheckError("登录的应答里没有令牌。");
  if (signedIn.body.must_change_password === true) throw new CheckError("这个账号还在用临时密码：请先用它登录运营后台改密码，再把新密码填进 STAGING_READONLY_PASSWORD。");
  const step = signedIn.body.second_factor?.status;
  if (step === "enrollment_required") throw new CheckError("这个账号还没绑定两步验证：请先用它登录运营后台绑定，把验证器的密钥填进 STAGING_READONLY_TOTP。");
  if (step !== "verify_required") return token;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const verified = await call(io.fetch, io.baseUrl, "POST", "/platform/v1/auth/mfa/verify", { token, body: { code: totp(credentials.totp, io.now()) }, timeoutMs: AUTH_TIMEOUT_MS });
    if (verified.status === 200) return typeof verified.body?.access_token === "string" ? verified.body.access_token : token;
    const code = errorCode(verified.body);
    if (code !== "MFA_CODE_REUSED" || attempt > 0) {
      const hint = code === "MFA_CODE_INVALID" ? "（动态码不对：STAGING_READONLY_TOTP 要是这个账号绑定时的密钥）" : "";
      throw new CheckError(`两步验证失败：${verified.status} ${code}${hint}`);
    }
    const stepMs = TOTP_STEP_SECONDS * 1000;
    await io.sleep(stepMs - (io.now() % stepMs) + 1000);
  }
  throw new CheckError("两步验证失败。");
}

/** 取清单 */
export async function fetchReport(io, token, days) {
  const res = await call(io.fetch, io.baseUrl, "GET", `/platform/v1/reports/area-role-preview?days=${days}`, { token, timeoutMs: REPORT_TIMEOUT_MS });
  if (res.status === 200 && typeof res.body?.replay === "object" && res.body.replay !== null) return res.body;
  const code = errorCode(res.body);
  const hints = {
    FORBIDDEN: "（这个账号的角色没有「报价试算」）",
    DATA_SCOPE_DENIED: "（这个账号的角色限定了数据范围，换一个不限范围的角色）",
    RATE_LIMITED: "（每个账号 10 分钟最多 3 次，稍后再试）",
    REPORT_TIMEOUT: "（回放太久，把天数改小再试）",
    NOT_FOUND: "（测试环境还没部署这个接口）",
  };
  throw new CheckError(`取清单失败：${res.status} ${code}${hints[code] ?? ""}`);
}

async function logout(io, token) {
  try {
    await call(io.fetch, io.baseUrl, "POST", "/platform/v1/auth/logout", { token, timeoutMs: AUTH_TIMEOUT_MS });
  } catch {
    // 退出失败不影响结论：令牌 8 小时后自己过期
  }
}

/**
 * 跑一次核对。`io`：fetch、baseUrl、now、sleep、log、writeOutput（存 JSON）、writeSummary（工作流摘要，可选）。
 * 返回退出码。
 */
export async function runCheck(env, io) {
  const missing = missingSecrets(env);
  if (missing.length > 0) {
    io.log(`没有配置：staging 环境的 secrets 里缺 ${missing.join("、")}。请仓库所有者在 Settings → Environments → staging 里填写（说明见 docs/secrets.md「测试环境只读核对的账号」）。`);
    return 1;
  }
  try {
    const days = parseDays(env.CHECK_DAYS);
    const scoped = { ...io, baseUrl: parseBaseUrl(env.NOZOMI_BASE_URL) };
    const token = await login(scoped, { email: env.STAGING_READONLY_EMAIL.trim(), password: env.STAGING_READONLY_PASSWORD, totp: env.STAGING_READONLY_TOTP.trim() });
    let report;
    try {
      report = await fetchReport(scoped, token, days);
    } finally {
      await logout(scoped, token);
    }
    await io.writeOutput(`${JSON.stringify(report, null, 2)}\n`);
    const lines = summarize(report);
    for (const line of lines) io.log(line);
    if (io.writeSummary !== undefined) await io.writeSummary(["## 测试环境只读核对", "", ...lines.map((line) => `- ${line}`), ""].join("\n"));
    return hasChanges(report) ? 2 : 0;
  } catch (err) {
    io.log(err instanceof CheckError ? err.message : "核对失败：未知错误。");
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.env.CHECK_OUTPUT ?? "staging-readonly-check/area-role-preview.json";
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  process.exitCode = await runCheck(process.env, {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line),
    writeOutput: async (text) => {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, text, "utf8");
    },
    ...(summaryFile ? { writeSummary: (text) => appendFile(summaryFile, text, "utf8") } : {}),
  });
}
