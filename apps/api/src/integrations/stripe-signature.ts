/**
 * Stripe Webhook 的签名校验（M3-01，ADR 0026）。按 Stripe 文档的算法自己实现，不经过网络，单元测试和 Stripe 官方库互相核对：
 * https://docs.stripe.com/webhooks#verify-manually
 *
 * - 请求头 `Stripe-Signature: t=<秒级时间戳>,v1=<签名>[,v1=<签名>…][,v0=…]`；
 * - 签名 = HMAC-SHA256(密钥, `${t}.${原始请求体}`) 的十六进制；密钥是整个 `whsec_…` 字符串；
 * - 只认 `v1`（`v0` 是测试模式的旧方案，忽略）；有几个 `v1`（Stripe 轮换密钥期间会同时带新旧两个）时任意一个对上即可；
 * - 比较用等时比较；
 * - 时间戳和现在相差超过容差（默认 300 秒，和 Stripe 官方库一样）就拒绝——防重放：截下来的请求过了 5 分钟就不能再用。
 *   官方库只拒绝太旧的，这里太新的（时间戳比现在晚 5 分钟以上）也拒绝：那是时钟出了错或者伪造的。
 *   5 分钟之内的重放靠事件编号去重（同一个事件只处理一次，services/payment-webhooks.ts）。
 * 必须用**原始请求体**（字节）校验：解析成 JSON 再序列化回去，空白和键的顺序一变签名就对不上。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** 时间戳容差（秒）：5 分钟，Stripe 官方库的默认值 */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type StripeSignatureFailure =
  /** 没有 Stripe-Signature 请求头 */
  | "SIGNATURE_MISSING"
  /** 请求头写得不对：没有 t=、时间戳不是整数 */
  | "SIGNATURE_MALFORMED"
  /** 请求头里没有 v1 签名 */
  | "SIGNATURE_NO_V1"
  /** 时间戳和现在相差超过容差（过期的请求，或者重放） */
  | "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE"
  /** 签名对不上：密钥不对、请求体被改过 */
  | "SIGNATURE_MISMATCH";

export class StripeSignatureError extends Error {
  readonly failure: StripeSignatureFailure;
  constructor(failure: StripeSignatureFailure) {
    super(`Stripe 通知的签名校验没有通过（${failure}）`);
    this.name = "StripeSignatureError";
    this.failure = failure;
  }
}

/** 解析 `Stripe-Signature` 请求头：时间戳和全部 v1 签名。写得不对抛 `StripeSignatureError`。 */
export function parseStripeSignatureHeader(header: string | undefined | null): { timestamp: number; signatures: string[] } {
  if (header === undefined || header === null || header.trim() === "") throw new StripeSignatureError("SIGNATURE_MISSING");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value) || timestamp !== null) throw new StripeSignatureError("SIGNATURE_MALFORMED");
      timestamp = Number(value);
    } else if (key === "v1" && value !== "") {
      signatures.push(value);
    }
  }
  if (timestamp === null) throw new StripeSignatureError("SIGNATURE_MALFORMED");
  if (signatures.length === 0) throw new StripeSignatureError("SIGNATURE_NO_V1");
  return { timestamp, signatures };
}

/** 计算签名：HMAC-SHA256(密钥, `${时间戳}.${原始请求体}`) 的十六进制。 */
export function computeStripeSignature(payload: Buffer | string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.`, "utf8")
    .update(typeof payload === "string" ? Buffer.from(payload, "utf8") : payload)
    .digest("hex");
}

/** 先比十六进制字符串的长度（且必须全是十六进制字符），再按字节定长比较：奇数长度在解码时会丢掉最后半个字节，不先比长度会把「正确签名 + 1 个字符」当成对的。 */
function sameHex(expected: string, actual: string): boolean {
  if (actual.length !== expected.length || !/^[0-9a-f]+$/i.test(actual)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(actual.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 校验一次 Stripe 通知。通过时返回签名里的时间戳；不通过抛 `StripeSignatureError`（`failure` 说明是哪一种）。
 * 先比签名再看时间：签名不对的请求不告诉对方时间戳的问题。
 */
export function verifyStripeSignature(payload: Buffer | string, header: string | undefined | null, secret: string, now: Date, toleranceSeconds: number = STRIPE_SIGNATURE_TOLERANCE_SECONDS): number {
  const { timestamp, signatures } = parseStripeSignatureHeader(header);
  const expected = computeStripeSignature(payload, timestamp, secret);
  if (!signatures.some((signature) => sameHex(expected, signature))) throw new StripeSignatureError("SIGNATURE_MISMATCH");
  const age = Math.floor(now.getTime() / 1000) - timestamp;
  if (Math.abs(age) > toleranceSeconds) throw new StripeSignatureError("SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE");
  return timestamp;
}

/** 生成一个 `Stripe-Signature` 请求头（测试和本地联调用；正式环境的签名由 Stripe 生成）。 */
export function stripeSignatureHeader(payload: Buffer | string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${computeStripeSignature(payload, timestamp, secret)}`;
}
