import { test } from "node:test";
import assert from "node:assert/strict";
import { ENCRYPTED_PASSENGER, ENCRYPTED_TEXT } from "@nozomi/domain";
import { AppError } from "../errors.ts";
import { PassengerCrypto, type PassengerCryptoLog, type PassengerEncryptionSettings } from "./passenger-crypto.ts";
import { SecretBox } from "./secret-box.ts";

const KEY = "unit-test-master-key-0123456789-abcdef";
const OTHER_KEY = "unit-test-other-master-key-0123456789-xyz";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const PASSENGER = { name: "虚构测试", phone: "+819000000000", email: "fictional@example.test" };
const DUAL: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true };
const make = (settings: PassengerEncryptionSettings = DUAL, key = KEY, log: PassengerCryptoLog = { warn: () => undefined, error: () => undefined }): PassengerCrypto => new PassengerCrypto(new SecretBox(key), settings, log);

test("双写：密文解得开，和明文一致；密文里看不到原文；每次加密结果不同", () => {
  const crypto = make();
  const a = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  const b = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  assert.notEqual(a.enc, b.enc);
  assert.deepEqual(a.plain, PASSENGER);
  for (const part of [PASSENGER.name, PASSENGER.phone, PASSENGER.email]) assert.ok(!a.enc.includes(part));
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, a.enc, PASSENGER), PASSENGER);
});

test("盲索引：带密钥（换主密钥结果不同）、按租户隔离、同一租户同一内容结果相同；用途和加密互不相通", () => {
  const crypto = make();
  const bidx = crypto.sealOrderPassenger(T1, ORDER, PASSENGER).emailBidx;
  assert.equal(bidx, crypto.index(T1, "email", PASSENGER.email));
  assert.notEqual(bidx, crypto.index(T2, "email", PASSENGER.email), "不同租户");
  assert.notEqual(bidx, crypto.index(T1, "phone", PASSENGER.email), "不同种类");
  assert.notEqual(bidx?.split(":")[1], make(DUAL, OTHER_KEY).index(T1, "email", PASSENGER.email).split(":")[1], "没有主密钥算不出来");
});

test("空的邮箱、电话不建盲索引：空串永远不会和什么相等", () => {
  const sealed = make().sealOrderPassenger(T1, ORDER, { ...PASSENGER, email: " ", phone: "" });
  assert.deepEqual([sealed.emailBidx, sealed.phoneBidx], [null, null]);
});

test("密文搬到别的租户、别的单：解不开，退回明文并报警；报警里没有内容；同一种报警一分钟只有一条", () => {
  const alerts: object[] = [];
  const crypto = make(DUAL, KEY, { warn: () => undefined, error: (obj) => void alerts.push(obj) });
  const { enc } = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  assert.deepEqual(crypto.readOrderPassenger(T2, ORDER, enc, PASSENGER), PASSENGER);
  assert.deepEqual(crypto.readOrderPassenger(T1, T2, enc, PASSENGER), PASSENGER);
  assert.equal(alerts.length, 1);
  assert.equal((alerts[0] as { event: string }).event, "passenger.decrypt_failed");
  assert.ok(!JSON.stringify(alerts).includes(PASSENGER.email));
});

test("解开了但和明文不一样：读密文，报警", () => {
  const alerts: { event: string }[] = [];
  const crypto = make(DUAL, KEY, { warn: () => undefined, error: (obj) => void alerts.push(obj as { event: string }) });
  const { enc } = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  const stale = { ...PASSENGER, name: "别的姓名" };
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, enc, stale), PASSENGER);
  assert.deepEqual(alerts.map((alert) => alert.event), ["passenger.cipher_mismatch"]);
});

test("读明文开关：不解密（密文坏了也不报警）", () => {
  const alerts: object[] = [];
  const crypto = make({ ...DUAL, readSource: "plaintext" }, KEY, { warn: () => undefined, error: (obj) => void alerts.push(obj) });
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, `${crypto.currentPrefix}坏的`, PASSENGER), PASSENGER);
  assert.deepEqual(alerts, []);
});

test("没回填、密钥换过：读明文，不报警；核对得出不是当前密钥", () => {
  const alerts: object[] = [];
  const crypto = make(DUAL, KEY, { warn: () => undefined, error: (obj) => void alerts.push(obj) });
  const old = make(DUAL, OTHER_KEY).sealOrderPassenger(T1, ORDER, PASSENGER);
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, null, PASSENGER), PASSENGER);
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, old.enc, PASSENGER), PASSENGER);
  assert.equal(crypto.isCurrent(old.enc), false);
  assert.equal(crypto.isCurrent(old.emailBidx), false);
  assert.deepEqual(alerts, []);
});

test("明文不再写时：写的是占位；解不开时报错，绝不把占位当乘客信息", () => {
  const crypto = make({ ...DUAL, plaintextWrite: false });
  const sealed = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  assert.deepEqual(sealed.plain, ENCRYPTED_PASSENGER);
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, sealed.enc, sealed.plain), PASSENGER);
  assert.throws(() => crypto.readOrderPassenger(T2, ORDER, sealed.enc, sealed.plain), (err) => err instanceof AppError && err.code === "PASSENGER_DECRYPT_FAILED");
  assert.throws(() => crypto.readOrderPassenger(T1, ORDER, null, sealed.plain), (err) => err instanceof AppError && err.code === "PASSENGER_DECRYPT_FAILED");
  assert.throws(() => crypto.readValues("order_change", T1, ORDER, null, { after: { passenger: ENCRYPTED_PASSENGER } }), (err) => err instanceof AppError && err.code === "PASSENGER_DECRYPT_FAILED");
  assert.throws(() => crypto.readRecipient(T1, ORDER, null, ENCRYPTED_TEXT), (err) => err instanceof AppError && err.code === "PASSENGER_DECRYPT_FAILED");
});

test("副本：只有含乘客的才加密；明文不再写时只换掉乘客，别的字段留着", () => {
  const dual = make();
  const noPassenger = { from_status: "a" };
  assert.deepEqual(dual.sealValues("webhook_delivery", T1, ORDER, noPassenger), { plain: noPassenger, enc: null });
  const withPassenger = { before: { passenger: PASSENGER, notes: "备注" }, after: { flight_no: "NH211" } };
  const sealed = dual.sealValues("webhook_delivery", T1, ORDER, withPassenger);
  assert.deepEqual(sealed.plain, withPassenger);
  assert.deepEqual(dual.readValues("webhook_delivery", T1, ORDER, sealed.enc, sealed.plain), withPassenger);
  const retired = make({ ...DUAL, plaintextWrite: false }).sealValues("webhook_delivery", T1, ORDER, withPassenger);
  assert.deepEqual(retired.plain, { before: { passenger: ENCRYPTED_PASSENGER, notes: "备注" }, after: { flight_no: "NH211" } });
  assert.deepEqual(make({ ...DUAL, plaintextWrite: false }).readValues("webhook_delivery", T1, ORDER, retired.enc, retired.plain), withPassenger);
  assert.notEqual(dual.readValues("order_change", T1, ORDER, sealed.enc, null), withPassenger, "种类不同解不开");
});

test("没配置主密钥：写乘客信息报清楚的错；读明文照常；副本不加密（数量由 dry-run 看得到）", () => {
  const crypto = new PassengerCrypto(null, DUAL);
  assert.equal(crypto.configured, false);
  assert.equal(crypto.backfillEnabled, false);
  assert.throws(() => crypto.sealOrderPassenger(T1, ORDER, PASSENGER), (err) => err instanceof AppError && err.statusCode === 503 && err.code === "PASSENGER_ENCRYPTION_NOT_CONFIGURED");
  assert.deepEqual(crypto.readOrderPassenger(T1, ORDER, "x:y", PASSENGER), PASSENGER);
  assert.deepEqual(crypto.sealRecipient(T1, ORDER, PASSENGER.email), { plain: PASSENGER.email, enc: null });
});

test("性能：一页 200 行解密在几十毫秒量级（不做 N+1 查询，只有内存里的解密）", () => {
  const crypto = make();
  const { enc } = crypto.sealOrderPassenger(T1, ORDER, PASSENGER);
  const started = performance.now();
  for (let i = 0; i < 200; i += 1) crypto.readOrderPassenger(T1, ORDER, enc, PASSENGER);
  assert.ok(performance.now() - started < 200, "200 行超过 200 毫秒");
});
