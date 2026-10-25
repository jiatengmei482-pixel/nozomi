/**
 * M3-01 测试角色补充：Stripe 签名校验和通知整理的边界（不连网络，密钥现场生成）。
 * 与 stripe-signature.test.ts / stripe.test.ts 不重复：签名的长度要严格一致、和官方库对同一批畸形签名的判断一致、请求体的字节级差异、
 * 通知内容里各种看不懂的字段。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { StripeSignatureError, computeStripeSignature, verifyStripeSignature } from "./stripe-signature.ts";
import { normalizeStripeEvent } from "./stripe.ts";
import { PaymentWebhookPayloadError } from "./payments.ts";

const secret = `whsec_${randomBytes(24).toString("hex")}`;
const now = new Date("2026-10-07T01:00:00.000Z");
const t = Math.floor(now.getTime() / 1000);
const payload = JSON.stringify({ id: "evt_qa_1", object: "event", type: "payment_intent.succeeded", created: t, livemode: false, data: { object: { id: "pi_1", object: "payment_intent", amount: 1000, currency: "jpy", status: "succeeded" } } });

const accepts = (body: string | Buffer, header: string): boolean => {
  try {
    verifyStripeSignature(body, header, secret, now);
    return true;
  } catch (err) {
    assert.ok(err instanceof StripeSignatureError, String(err));
    assert.ok(!err.message.includes(secret) && !err.message.includes(secret.slice(6)), "异常信息里不能有密钥");
    return false;
  }
};

const officialAccepts = (body: string, header: string): boolean => {
  const stripe = new Stripe("sk_test_qa_not_a_real_key");
  try {
    stripe.webhooks.constructEvent(body, header, secret, 300, undefined, t);
    return true;
  } catch {
    return false;
  }
};

/**
 * 防回归（曾经的缺陷，已修）：签名比较按「十六进制解码后的字节」比，奇数长度的十六进制解码时最后半个字节被丢掉，于是「正确签名 + 1 个十六进制字符」也被接受。
 * 官方库按字符串原样比较，会拒绝。没有安全影响（要先有正确签名），但和 ADR 写的「与官方库互相核对、算法一致」不符。
 * 原因：integrations/stripe-signature.ts `sameHex` 没有检查两边的十六进制长度一样。
 */
test("签名后面多一个十六进制字符：拒绝（和官方库一致）", () => {
  const signature = computeStripeSignature(payload, t, secret);
  for (const extra of ["0", "f", "a"]) {
    const header = `t=${t},v1=${signature}${extra}`;
    assert.equal(officialAccepts(payload, header), false, "官方库拒绝");
    assert.equal(accepts(payload, header), false, `多了一个「${extra}」也通过了`);
  }
});

test("签名长度不对、截短、空白、十六进制以外的字符：拒绝，和官方库一致", () => {
  const signature = computeStripeSignature(payload, t, secret);
  const headers = [`t=${t},v1=${signature.slice(0, 63)}`, `t=${t},v1=${signature.slice(0, 32)}`, `t=${t},v1=${signature}00`, `t=${t},v1=${signature.slice(0, 62)}zz`, `t=${t},v1=0x${signature.slice(2)}`, `t=${t},v1=${"0".repeat(64)}`];
  for (const header of headers) {
    assert.equal(officialAccepts(payload, header), false, header);
    assert.equal(accepts(payload, header), false, header);
  }
  // 正常的对照
  assert.equal(accepts(payload, `t=${t},v1=${signature}`), true);
  assert.equal(officialAccepts(payload, `t=${t},v1=${signature}`), true);
});

test("请求体的字节级差异：多一个换行、BOM、空白重排、Unicode 转义写法不同，签名都对不上", () => {
  const signature = computeStripeSignature(payload, t, secret);
  const header = `t=${t},v1=${signature}`;
  for (const variant of [`${payload}\n`, `﻿${payload}`, JSON.stringify(JSON.parse(payload), null, 2), payload.replace('"jpy"', '"\\u006apy"')]) assert.equal(accepts(variant, header), false);
  const multibyte = JSON.stringify({ note: "東京 🚕" });
  assert.equal(accepts(Buffer.from(multibyte, "utf8"), `t=${t},v1=${computeStripeSignature(multibyte, t, secret)}`), true, "多字节字符按 UTF-8 字节算");
  assert.equal(accepts("", `t=${t},v1=${computeStripeSignature("", t, secret)}`), true, "空请求体照样能验签（之后由内容校验拒绝）");
});

test("用别的时间戳签的签名不能换个 t 再用；t 前面补 0 的判断和官方库一致", () => {
  const old = computeStripeSignature(payload, t - 1_000, secret);
  assert.equal(accepts(payload, `t=${t},v1=${old}`), false);
  const signature = computeStripeSignature(payload, t, secret);
  assert.equal(accepts(payload, `t=0${t},v1=${signature}`), officialAccepts(payload, `t=0${t},v1=${signature}`));
});

test("通知整理：缺字段、类型不对都抛内容错误（接口回 400），不抛别的异常", () => {
  const base = JSON.parse(payload);
  const variants: unknown[] = [
    null,
    [],
    "event",
    { ...base, object: "evt" },
    { ...base, id: "" },
    { ...base, id: 1 },
    { ...base, type: null },
    { ...base, created: "1760000000" },
    { ...base, created: 1.5 },
    { ...base, data: null },
    { ...base, data: { object: [] } },
    { ...base, data: { object: { ...base.data.object, amount: -0.5 } } },
    { ...base, data: { object: { ...base.data.object, amount: Number.MAX_SAFE_INTEGER + 2 } } },
    { ...base, data: { object: { ...base.data.object, status: "paid" } } },
    { ...base, data: { object: { ...base.data.object, currency: "" } } },
    { ...base, data: { object: { ...base.data.object, object: "charge" } } },
    { ...base, type: "charge.refunded", data: { object: { id: "ch_1", object: "charge", amount: 1000, amount_refunded: "10" } } },
    { ...base, type: "charge.dispute.created", data: { object: { object: "dispute", amount: 1000 } } },
  ];
  for (const raw of variants) assert.throws(() => normalizeStripeEvent(raw), PaymentWebhookPayloadError, JSON.stringify(raw)?.slice(0, 80));
  // livemode 不是 true 的都当测试模式（"true" 字符串不算正式模式）
  assert.equal(normalizeStripeEvent({ ...base, livemode: "true" }).livemode, false);
  // 不认识的类型、对象里什么都没有：归为 other，不抛
  assert.equal(normalizeStripeEvent({ ...base, type: "customer.created", data: { object: {} } }).object.kind, "other");
});
