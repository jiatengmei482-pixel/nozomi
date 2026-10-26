/**
 * 运营后台填写第三方密钥的表单（ADR 0041）：提交前的提示性检查、把后端逐项的出错落到字段上。
 * 前端只查「有没有填」「开头对不对」，长度、字符、能不能在这个环境用，以后端的校验为准。
 * 这里只处理字段名和出错文字，从不保存、返回或拼接填进来的值。
 */
import { ApiError } from "../api/client.ts";
import type { IntegrationSecretKey, SecretFieldName } from "../api/platform.ts";

export type FieldErrors = Partial<Record<SecretFieldName, string[]>>;

/** 每一项输入框下面的帮助说明：去哪里复制、开头是什么样子。 */
export const SECRET_FIELD_HINTS: Readonly<Record<SecretFieldName, string>> = {
  api_key: "在谷歌云控制台「API 和服务 → 凭据」里复制，通常以 AIza 开头。",
  secret_key: "测试环境以 sk_test_ 开头（正式环境是 sk_live_）。在 Stripe 控制台「开发者 → API 密钥」里复制。",
  publishable_key: "测试环境以 pk_test_ 开头（正式环境是 pk_live_），和 Secret key 在同一页。",
  webhook_secret: "以 whsec_ 开头。在 Stripe 控制台「开发者 → Webhooks」里，点开给 NOZOMI 设的那个端点，复制「签名密钥」。",
};

const PREFIXES: Partial<Record<SecretFieldName, { pattern: RegExp; text: string }>> = {
  secret_key: { pattern: /^sk_(test|live)_/, text: "开头不对：Secret key 以 sk_test_ 开头（正式环境是 sk_live_）。请确认没有复制成别的那一项。" },
  publishable_key: { pattern: /^pk_(test|live)_/, text: "开头不对：Publishable key 以 pk_test_ 开头（正式环境是 pk_live_）。请确认没有复制成别的那一项。" },
  webhook_secret: { pattern: /^whsec_/, text: "开头不对：Webhook signing secret 以 whsec_ 开头。请确认没有复制成别的那一项。" },
};

const modeOf = (value: string): string | null => /^[sp]k_(test|live)_/.exec(value)?.[1] ?? null;

/** 提交前的检查（值已去掉首尾空白）。没有问题返回空对象。 */
export function secretFormErrors(key: IntegrationSecretKey, values: Partial<Record<SecretFieldName, string>>, fields: readonly SecretFieldName[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const value = values[field] ?? "";
    if (value === "") {
      errors[field] = [key === "stripe" ? "请粘贴这一项（Stripe 的三项要一起填）" : "请粘贴密钥"];
      continue;
    }
    const prefix = PREFIXES[field];
    if (key === "stripe" && prefix && !prefix.pattern.test(value)) errors[field] = [prefix.text];
  }
  if (key === "stripe" && errors.secret_key === undefined && errors.publishable_key === undefined) {
    const secret = modeOf(values.secret_key ?? "");
    const publishable = modeOf(values.publishable_key ?? "");
    if (secret !== null && publishable !== null && secret !== publishable) errors.publishable_key = ["Secret key 和 Publishable key 要同为测试（test）或同为正式（live）"];
  }
  return errors;
}

/**
 * 后端 400 `VALIDATION_FAILED` 的逐项出错（`details.issues[].path` 如 `/secret_key`）落到字段上。
 * 不是这一类错误、或说不出是哪一项的，返回 null，由表单顶部的提示条说明。
 */
export function serverFieldErrors(err: unknown, fields: readonly SecretFieldName[]): FieldErrors | null {
  if (!(err instanceof ApiError) || err.status !== 400 || err.code !== "VALIDATION_FAILED") return null;
  const issues = err.details["issues"];
  if (!Array.isArray(issues)) return null;
  const errors: FieldErrors = {};
  for (const issue of issues) {
    if (typeof issue !== "object" || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    const field = typeof path === "string" ? (path.replace(/^\//, "") as SecretFieldName) : null;
    if (field === null || !fields.includes(field)) continue;
    const text = typeof message === "string" && message !== "" ? message : "这一项不符合要求，请检查是否复制完整";
    errors[field] = [...(errors[field] ?? []), text];
  }
  return Object.keys(errors).length > 0 ? errors : null;
}
