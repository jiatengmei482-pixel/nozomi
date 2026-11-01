/**
 * 运营后台填写第三方密钥和邮件发送的表单（ADR 0041、0048）：提交前的提示性检查、把后端逐项的出错落到字段上。
 * 前端只查「有没有填」「开头对不对」「邮件发送的端口是不是数字」这类一眼能看出的，长度、字符、端口和主机准不准用、能不能在这个环境用，以后端的校验为准。
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
  host: "发信服务器的地址，例如 smtp.example.com。一般在邮件服务商的 SMTP 设置页能找到。",
  port: "一般和主机写在同一页。只能填 25、465、587、2525，常用 465 或 587；云服务器常常封了 25，不建议用。",
  encryption: "发信时怎么加密，要和端口相配：465 选 TLS，587 选 STARTTLS。服务商写的是 SSL 时，选 TLS。",
  username: "登录邮件服务器用的账号，通常是完整的邮箱地址，也可能是服务商给的一串字符。",
  password: "不一定是邮箱的登录密码：很多服务商要用「应用专用密码」或「SMTP 密钥」，在服务商的设置页生成。至少 8 个字符。",
  from_name: "收件人看到的发件人名字，例如「NOZOMI 用车」。",
  from_address: "收件人看到的发件地址，例如 noreply@example.com。要是这个账号有权使用的地址，否则邮件服务器会拒收。",
};

const PREFIXES: Partial<Record<SecretFieldName, { pattern: RegExp; text: string }>> = {
  secret_key: { pattern: /^sk_(test|live)_/, text: "开头不对：Secret key 以 sk_test_ 开头（正式环境是 sk_live_）。请确认没有复制成别的那一项。" },
  publishable_key: { pattern: /^pk_(test|live)_/, text: "开头不对：Publishable key 以 pk_test_ 开头（正式环境是 pk_live_）。请确认没有复制成别的那一项。" },
  webhook_secret: { pattern: /^whsec_/, text: "开头不对：Webhook signing secret 以 whsec_ 开头。请确认没有复制成别的那一项。" },
};

/** 每个「测试一下」失败原因的一句话：什么问题、怎么办。不认识的代码用接口给的 message。 */
export const EMAIL_TEST_FAILURES: Readonly<Record<string, string>> = {
  UNREACHABLE: "连不上邮件服务器。请检查主机和端口有没有填错；云服务器常常封了 25 端口，可以换 465 或 587。",
  TLS_FAILED: "和邮件服务器建立加密连接失败。请检查加密方式和端口是否相配（465 配 TLS、587 配 STARTTLS）；都对的话，可能是服务器的证书有问题，请联系邮件服务商。",
  AUTH_FAILED: "邮件服务器不接受这组用户名和密码。请重新填写；很多邮箱要用「应用专用密码」或 SMTP 专用密码，不是登录密码。",
  SENDER_REJECTED: "邮件服务器拒绝了发件人地址。请确认这个账号可以用这个发件人地址发信，或换成在邮件服务商那里验证过的地址。",
  RECIPIENT_REJECTED: "邮件服务器拒绝了收件人（你的登录邮箱）。请确认这个邮箱能正常收信；有的试用账号只能发给验证过的地址，可以到邮件服务商那里添加它。",
  MESSAGE_REJECTED: "邮件服务器拒绝了这封邮件，分不清是发件人还是收件人的问题。请先确认这个账号可以用这个发件人地址发信，或换成在邮件服务商那里验证过的地址；再确认你的登录邮箱能正常收信。",
  TEMPORARILY_REJECTED: "邮件服务器暂时不接收这封邮件（可能是限流或对方暂时不可用），配置不一定有问题。请过几分钟再试；一直这样请联系邮件服务商。",
  TARGET_FORBIDDEN: "主机是内网地址，或解析到了内网地址，不允许连接。请填写邮件服务商给的公网主机名。",
  TIMEOUT: "邮件服务器在 15 秒内没有完成。请检查主机和端口，以及加密方式和端口是否相配（465 配 TLS、587 配 STARTTLS）；都对的话，过一会儿再试。",
  UNEXPECTED: "邮件服务器的应答看不懂。请确认主机和端口填的是 SMTP 服务。",
  MESSAGE_INVALID: "你的登录邮箱不能用来收这封测试邮件（地址的写法不被接受），所以没有发出。请换一个超级管理员账号来测试，或联系技术人员。",
};

const PASSWORD_MIN_LENGTH = 8;
const PORT_MAX = 65_535;

/** 邮件发送七项的提交前检查：端口要能变成数字，其余是否准用看后端。 */
function emailFormErrors(values: Partial<Record<SecretFieldName, string>>, fields: readonly SecretFieldName[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    if ((values[field] ?? "") === "") errors[field] = [field === "password" ? "请重新填写密码（每次保存都要填）" : "请填写这一项（七项要一起填）"];
  }
  const port = values.port ?? "";
  if (port !== "" && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > PORT_MAX)) errors.port = ["端口是一个数字，例如 465"];
  const password = values.password ?? "";
  if (password !== "" && password.length < PASSWORD_MIN_LENGTH) errors.password = [`密码至少 ${PASSWORD_MIN_LENGTH} 个字符`];
  const address = values.from_address ?? "";
  if (address !== "" && !/^[^\s@]+@[^\s@]+$/.test(address)) errors.from_address = ["这不是一个邮箱地址，例如 noreply@example.com"];
  return errors;
}

const modeOf = (value: string): string | null => /^[sp]k_(test|live)_/.exec(value)?.[1] ?? null;

/** 提交前的检查（值已去掉首尾空白）。没有问题返回空对象。 */
export function secretFormErrors(key: IntegrationSecretKey, values: Partial<Record<SecretFieldName, string>>, fields: readonly SecretFieldName[]): FieldErrors {
  if (key === "email") return emailFormErrors(values, fields);
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
