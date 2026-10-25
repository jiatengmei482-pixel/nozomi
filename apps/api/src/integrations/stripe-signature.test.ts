/**
 * Stripe Webhook 签名校验（M3-01，ADR 0026）。不连网络：密钥在测试里现场生成，签名一部分用我们自己的实现生成，一部分用 Stripe 官方库生成，
 * 两边互相核对——证明我们的校验和 Stripe 的算法一致（`t`、`v1`、HMAC-SHA256、时间容差、多个 v1、错误签名、重放）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import Stripe from "stripe";
import { STRIPE_SIGNATURE_TOLERANCE_SECONDS, StripeSignatureError, type StripeSignatureFailure, computeStripeSignature, parseStripeSignatureHeader, stripeSignatureHeader, verifyStripeSignature } from "./stripe-signature.ts";

const secret = `whsec_${randomBytes(24).toString("hex")}`;
const otherSecret = `whsec_${randomBytes(24).toString("hex")}`;
const payload = JSON.stringify({ id: "evt_test_1", object: "event", type: "payment_intent.succeeded", data: { object: { id: "pi_1", object: "payment_intent" } } }, null, 2);
const now = new Date("2026-10-07T01:00:00.000Z");
const t = Math.floor(now.getTime() / 1000);

function failure(run: () => unknown): StripeSignatureFailure {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof StripeSignatureError, String(err));
    return err.failure;
  }
  assert.fail("应当校验失败");
}

test("签名 = HMAC-SHA256(整个 whsec_ 密钥, `${t}.${原始请求体}`) 的十六进制", () => {
  const manual = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  assert.equal(computeStripeSignature(payload, t, secret), manual);
  assert.equal(computeStripeSignature(Buffer.from(payload), t, secret), manual, "字节和字符串结果一样");
  assert.equal(stripeSignatureHeader(payload, secret, t), `t=${t},v1=${manual}`);
});

test("和 Stripe 官方库一致：官方库生成的签名我们认；我们生成的签名官方库也认", () => {
  const official = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: t });
  assert.equal(verifyStripeSignature(payload, official, secret, now), t);
  assert.equal(official, stripeSignatureHeader(payload, secret, t));
  const event = Stripe.webhooks.constructEvent(payload, stripeSignatureHeader(payload, secret, t), secret, STRIPE_SIGNATURE_TOLERANCE_SECONDS, undefined, now.getTime());
  assert.equal(event.id, "evt_test_1");
  // 错误签名两边都拒绝
  const forged = stripeSignatureHeader(payload, otherSecret, t);
  assert.equal(failure(() => verifyStripeSignature(payload, forged, secret, now)), "SIGNATURE_MISMATCH");
  assert.throws(() => Stripe.webhooks.constructEvent(payload, forged, secret, STRIPE_SIGNATURE_TOLERANCE_SECONDS, undefined, now.getTime()), /signature/i);
});

test("错误签名：密钥不对、请求体被改了一个字节、签名被改了一位、不是十六进制，都拒绝", () => {
  assert.equal(failure(() => verifyStripeSignature(payload, stripeSignatureHeader(payload, otherSecret, t), secret, now)), "SIGNATURE_MISMATCH");
  assert.equal(failure(() => verifyStripeSignature(`${payload} `, stripeSignatureHeader(payload, secret, t), secret, now)), "SIGNATURE_MISMATCH");
  const reparsed = JSON.stringify(JSON.parse(payload));
  assert.equal(failure(() => verifyStripeSignature(reparsed, stripeSignatureHeader(payload, secret, t), secret, now)), "SIGNATURE_MISMATCH", "解析后再序列化的请求体对不上：必须用原始请求体");
  const signature = computeStripeSignature(payload, t, secret);
  const flipped = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t},v1=${flipped}`, secret, now)), "SIGNATURE_MISMATCH");
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t},v1=${signature.slice(0, 10)}`, secret, now)), "SIGNATURE_MISMATCH", "截短的签名");
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t},v1=zz${signature.slice(2)}`, secret, now)), "SIGNATURE_MISMATCH");
  // 时间戳被改了：签名是连着时间戳算的，也对不上
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t + 1},v1=${signature}`, secret, now)), "SIGNATURE_MISMATCH");
});

test("多个 v1：任意一个对上就通过（Stripe 轮换密钥期间同时带新旧两个）；v0 不算", () => {
  const good = computeStripeSignature(payload, t, secret);
  const stale = computeStripeSignature(payload, t, otherSecret);
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${stale},v1=${good}`, secret, now), t);
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${good},v1=${stale}`, secret, now), t);
  assert.equal(verifyStripeSignature(payload, `t=${t}, v1=${good}, v0=${stale}`, secret, now), t, "逗号后有空格也认");
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t},v0=${good}`, secret, now)), "SIGNATURE_NO_V1");
  assert.equal(failure(() => verifyStripeSignature(payload, `t=${t},v1=${stale},v1=${stale}`, secret, now)), "SIGNATURE_MISMATCH");
});

test("时间容差 300 秒：正好 300 秒还认；超过 1 秒就拒绝（防重放）；比现在晚 5 分钟以上的也拒绝", () => {
  const at = (offsetSeconds: number): string => stripeSignatureHeader(payload, secret, t + offsetSeconds);
  assert.equal(verifyStripeSignature(payload, at(-300), secret, now), t - 300);
  assert.equal(failure(() => verifyStripeSignature(payload, at(-301), secret, now)), "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE");
  assert.equal(failure(() => verifyStripeSignature(payload, at(-86_400), secret, now)), "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE", "一天前截下来的请求重放");
  assert.equal(verifyStripeSignature(payload, at(300), secret, now), t + 300);
  assert.equal(failure(() => verifyStripeSignature(payload, at(301), secret, now)), "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE");
  // 同一个请求：5 分钟内重发签名照样通过（靠事件编号去重），过了 5 分钟就不认了
  const header = at(0);
  assert.equal(verifyStripeSignature(payload, header, secret, new Date(now.getTime() + 299_000)), t);
  assert.equal(failure(() => verifyStripeSignature(payload, header, secret, new Date(now.getTime() + 301_000))), "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE");
  // 可以收紧容差
  assert.equal(failure(() => verifyStripeSignature(payload, at(-10), secret, now, 5)), "SIGNATURE_TIMESTAMP_OUT_OF_TOLERANCE");
});

test("签名错的请求先报签名错，不透露时间戳的问题", () => {
  assert.equal(failure(() => verifyStripeSignature(payload, stripeSignatureHeader(payload, otherSecret, t - 10_000), secret, now)), "SIGNATURE_MISMATCH");
});

test("请求头缺失或写得不对", () => {
  for (const header of [undefined, null, "", "   "]) assert.equal(failure(() => verifyStripeSignature(payload, header, secret, now)), "SIGNATURE_MISSING");
  const signature = computeStripeSignature(payload, t, secret);
  assert.equal(failure(() => parseStripeSignatureHeader(`v1=${signature}`)), "SIGNATURE_MALFORMED", "没有 t");
  assert.equal(failure(() => parseStripeSignatureHeader(`t=abc,v1=${signature}`)), "SIGNATURE_MALFORMED");
  assert.equal(failure(() => parseStripeSignatureHeader(`t=-5,v1=${signature}`)), "SIGNATURE_MALFORMED");
  assert.equal(failure(() => parseStripeSignatureHeader(`t=${t},t=${t},v1=${signature}`)), "SIGNATURE_MALFORMED", "两个 t");
  assert.equal(failure(() => parseStripeSignatureHeader(`t=${t}`)), "SIGNATURE_NO_V1");
  assert.equal(failure(() => parseStripeSignatureHeader(`t=${t},v1=`)), "SIGNATURE_NO_V1");
  assert.deepEqual(parseStripeSignatureHeader(`t=${t},v1=aa,garbage,v1=bb,x=y`), { timestamp: t, signatures: ["aa", "bb"] });
});
