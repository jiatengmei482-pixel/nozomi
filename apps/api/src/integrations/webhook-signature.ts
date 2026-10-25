/**
 * 推送给供应商的请求的签名（M3-02，ADR 0027）。需求「API 通用约定」：HMAC-SHA256 签名（`X-Timestamp` + `X-Signature`，5 分钟防重放）。
 *
 * - `X-Timestamp`：发送时的 Unix 时间（秒）；
 * - `X-Signature: v1=<十六进制>`：HMAC-SHA256(签名密钥, `<X-Timestamp>.<请求体原文>`)；
 * - 接收方：用自己保存的签名密钥按同样的方法算一遍，定长比较；时间戳和自己的时钟相差超过 300 秒的拒绝（防重放）；
 *   同一个 `X-Event-Id` 只处理一次（5 分钟之内的重放、我们的重试都靠它去重）。
 * `verifyWebhookSignature` 是接收方的参考实现（文档和测试用；平台自己不接收这种请求）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { WEBHOOK_RULES, webhookSignedContent } from "@nozomi/domain";

export function webhookSignature(secret: string, timestampSeconds: number, body: string): string {
  return `v1=${createHmac("sha256", secret).update(webhookSignedContent(timestampSeconds, body), "utf8").digest("hex")}`;
}

export type WebhookSignatureFailure = "MISSING" | "MALFORMED" | "TIMESTAMP_OUT_OF_TOLERANCE" | "MISMATCH";

/** 接收方的校验：通过返回 null，不通过返回原因。先比签名再看时间。 */
export function verifyWebhookSignature(secret: string, headers: { timestamp: string | undefined; signature: string | undefined }, body: string, now: Date): WebhookSignatureFailure | null {
  if (headers.timestamp === undefined || headers.signature === undefined) return "MISSING";
  if (!/^\d{1,12}$/.test(headers.timestamp)) return "MALFORMED";
  const match = /^v1=([0-9a-f]{64})$/.exec(headers.signature);
  if (match === null) return "MALFORMED";
  const timestamp = Number(headers.timestamp);
  const expected = Buffer.from(webhookSignature(secret, timestamp, body).slice(3), "hex");
  const actual = Buffer.from(match[1] as string, "hex");
  if (!timingSafeEqual(expected, actual)) return "MISMATCH";
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestamp) > WEBHOOK_RULES.signatureToleranceSeconds) return "TIMESTAMP_OUT_OF_TOLERANCE";
  return null;
}
