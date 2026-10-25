/**
 * 端到端测试里的两步验证（ADR 0030）：平台员工登录时自动完成第二步——没绑定的绑定、绑定过的输入当前的动态码。
 * 只在测试代码里：生产代码没有任何「跳过两步验证」的开关。
 *
 * 动态码按真实时间算。同一个人在同一个 30 秒里登录好几次时，同一时间窗的码只能用一次（防重放）：
 * 这里记下每把密钥用过的时间窗，下一次用更晚的那个（服务端容忍后一个时间窗）；别的并行进程恰好用掉了（MFA_CODE_REUSED），等下一个时间窗再试。
 */
import { createHmac } from "node:crypto";
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { base32Decode, totpCode, totpStep } from "@nozomi/domain";

const hmac = (key: Uint8Array, message: Uint8Array): Uint8Array => createHmac("sha1", key).update(message).digest();

/** 邮箱 → 绑定的密钥（本进程里绑定过的；管理员的由 global-setup 交过来） */
const secrets = new Map<string, string>();
/** 密钥 → 用过的最晚的时间窗 */
const usedSteps = new Map<string, number>();

export function rememberSecret(email: string, secret: string): void {
  secrets.set(email.toLowerCase(), secret.replace(/\s/g, ""));
}

export function secretOf(email: string): string {
  const fromEnv = process.env["E2E_ADMIN_EMAIL"]?.toLowerCase() === email.toLowerCase() ? process.env["E2E_ADMIN_TOTP_SECRET"] : undefined;
  const secret = secrets.get(email.toLowerCase()) ?? fromEnv;
  if (!secret) throw new Error(`${email} 绑定过两步验证，但测试不知道它的密钥`);
  return secret;
}

function codeAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  if (key === null) throw new Error("不是 Base32 的密钥");
  return totpCode(hmac, key, step);
}

/** 下一个可以用的动态码（必要时等到下一个时间窗）。 */
export async function nextCode(secret: string): Promise<{ code: string; step: number }> {
  for (;;) {
    const now = totpStep(Date.now());
    const step = Math.max(now, (usedSteps.get(secret) ?? -1) + 1);
    if (step <= now + 1) {
      usedSteps.set(secret, step);
      return { code: codeAt(secret, step), step };
    }
    await new Promise((resolve) => setTimeout(resolve, (now + 1) * 30_000 - Date.now() + 200));
  }
}

/** 用一个码试，被并行的进程用掉了就换下一个，最多试几次。 */
async function withFreshCode<T>(secret: string, attempt: (code: string) => Promise<{ reused: boolean; value?: T }>): Promise<T> {
  for (let tries = 0; tries < 6; tries++) {
    const { code } = await nextCode(secret);
    const result = await attempt(code);
    if (!result.reused) return result.value as T;
  }
  throw new Error("动态码一直被别的进程用掉");
}

/** 经接口完成第二步（准备数据用）。返回令牌（同一个，已经完成两步验证）。 */
export async function apiSecondFactor(request: APIRequestContext, email: string, token: string, status: string): Promise<string> {
  const headers = { authorization: `Bearer ${token}` };
  if (status === "enrollment_required") {
    const started = await request.post("/platform/v1/auth/mfa/enrollment", { headers, data: {} });
    expect(started.ok(), `开始绑定失败：HTTP ${started.status()}`).toBe(true);
    const { secret } = (await started.json()) as { secret: string };
    rememberSecret(email, secret);
    const { code } = await nextCode(secret);
    const confirmed = await request.post("/platform/v1/auth/mfa/enrollment/confirm", { headers, data: { code } });
    expect(confirmed.ok(), `确认绑定失败：HTTP ${confirmed.status()}`).toBe(true);
    return token;
  }
  const secret = secretOf(email);
  return withFreshCode(secret, async (code) => {
    const verified = await request.post("/platform/v1/auth/mfa/verify", { headers, data: { code } });
    if (verified.status() === 400 && ((await verified.json()) as { error: { code: string } }).error.code === "MFA_CODE_REUSED") return { reused: true };
    expect(verified.ok(), `两步验证失败：HTTP ${verified.status()} ${await verified.text()}`).toBe(true);
    return { reused: false, value: token };
  });
}

/** 平台员工经接口登录并完成两步验证，返回令牌。 */
export async function platformApiLogin(request: APIRequestContext, email: string, password: string): Promise<string> {
  const response = await request.post("/platform/v1/auth/login", { data: { email, password } });
  expect(response.ok(), `平台登录失败：HTTP ${response.status()}`).toBe(true);
  const body = (await response.json()) as { access_token: string; second_factor: { status: string } };
  return apiSecondFactor(request, email, body.access_token, body.second_factor.status);
}

/** 在页面上完成第二步：绑定（读出页面上的密钥、输入动态码、勾选已保存恢复码）或输入动态码。 */
export async function uiSecondFactor(page: Page, email: string, status: string): Promise<void> {
  if (status === "enrollment_required") {
    await expect(page.getByRole("heading", { level: 1, name: "绑定两步验证" })).toBeVisible();
    const secret = ((await page.locator(".mfa-secret__value").textContent()) ?? "").replace(/\s/g, "");
    rememberSecret(email, secret);
    const { code } = await nextCode(secret);
    await page.getByLabel("动态码").fill(code);
    await page.getByRole("button", { name: "完成绑定" }).click();
    await expect(page.getByRole("list", { name: "恢复码" })).toBeVisible();
    await page.getByLabel("我已经把恢复码存好了").check();
    await page.getByRole("button", { name: "继续" }).click();
    return;
  }
  await expect(page.getByRole("heading", { level: 1, name: "两步验证" })).toBeVisible();
  const secret = secretOf(email);
  await withFreshCode(secret, async (code) => {
    await page.getByLabel("动态码").fill(code);
    const responded = page.waitForResponse((response) => response.url().endsWith("/platform/v1/auth/mfa/verify"));
    await page.getByRole("button", { name: "验证" }).click();
    const response = await responded;
    if (response.status() === 400 && ((await response.json()) as { error: { code: string } }).error.code === "MFA_CODE_REUSED") return { reused: true };
    return { reused: false, value: undefined };
  });
}
