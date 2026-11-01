/**
 * M4-22 QA（ADR 0057）：加密件的边界值（已有 passenger-crypto.test.ts 没覆盖的）。纯内存，不连数据库；联系方式全部虚构。
 * 覆盖：怪字符往返、改动每一段密文、用途和种类隔离、盲索引的域分隔、规范化和 contactMatches 同口径、占位字面量、部署开关、迁移的锁风险。
 */
import { readFile } from "node:fs/promises";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "@nozomi/config";
import { ENCRYPTED_TEXT, contactLookupKey, normalizeEmailForIndex, normalizeNameForIndex, normalizePhoneForIndex } from "@nozomi/domain";
import { contactMatches, contactMatchesOrder } from "../services/site.ts";
import { FAKE_SECRETS, testEnv } from "../testing/fixtures.ts";
import { AppError } from "../errors.ts";
import { PassengerCrypto, type PassengerEncryptionSettings } from "./passenger-crypto.ts";
import { SecretBox } from "./secret-box.ts";

const DUAL: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true };
const RETIRED: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: false, backfillEnabled: true };
const PLAIN_READ: PassengerEncryptionSettings = { readSource: "plaintext", plaintextWrite: true, backfillEnabled: true };
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const box = new SecretBox(FAKE_SECRETS.dataEncryptionKey);
const repoFile = (path: string): Promise<string> => readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");

const logged = (settings: PassengerEncryptionSettings, sink: object[], key: SecretBox | null = box): PassengerCrypto => new PassengerCrypto(key, settings, { error: (obj) => void sink.push(obj) });

const EXOTIC: readonly [string, string][] = [
  ["emoji 和零宽连接", "星野👨‍👩‍👧‍👦🇯🇵"],
  ["组合字符（不能被规范化掉）", "é́ か゚"],
  ["从右到左", "مرحبا שלום"],
  ["孤立的高位代理项", "星野\ud83d"],
  ["孤立的低位代理项", "\ude00星野"],
  ["反序的代理项", "\ude00\ud83d"],
  ["JSON 和 SQL 的特殊字符", `"'\\\n\t{}[],:--;%_`],
  ["NUL 和控制字符", "a\u0000b\u0001c\u007f"],
  ["很长（一万字）", "長".repeat(10_000)],
  ["空串", ""],
  ["全是空白", " 　\t"],
];

for (const [label, value] of EXOTIC) {
  test(`往返一字不差：${label}`, () => {
    const sink: object[] = [];
    const crypto = logged(RETIRED, sink);
    const passenger = { name: value, phone: value, email: value };
    const sealed = crypto.sealOrderPassenger(TENANT_A, ORDER, passenger);
    assert.deepEqual(sealed.plain, { name: ENCRYPTED_TEXT, phone: ENCRYPTED_TEXT, email: ENCRYPTED_TEXT });
    assert.deepEqual(crypto.readOrderPassenger(TENANT_A, ORDER, sealed.enc, sealed.plain), passenger);
    const copy = crypto.sealValues("order_change", TENANT_A, ORDER, { before: { passenger }, after: { passenger, notes: value } });
    assert.deepEqual(crypto.readValues("order_change", TENANT_A, ORDER, copy.enc, copy.plain), { before: { passenger }, after: { passenger, notes: value } });
    assert.deepEqual(sink, []);
  });
}

test("空的和只有空白的联系方式都不建盲索引：空串的索引相等会让两张单互相对上", () => {
  const crypto = logged(DUAL, []);
  for (const empty of ["", " ", "　", "\t\n"]) {
    const sealed = crypto.sealOrderPassenger(TENANT_A, ORDER, { name: empty, phone: empty, email: empty });
    assert.deepEqual([sealed.emailBidx, sealed.phoneBidx, sealed.nameBidx], [null, null, null], JSON.stringify(empty));
  }
  // 只有分隔符的电话规范化后也是空
  assert.equal(crypto.sealOrderPassenger(TENANT_A, ORDER, { name: "a", phone: "-().", email: "a@b.test" }).phoneBidx, null);
});

test("改动密文的任何一段都解不开（认证标签起作用），不会读出错的内容；退回明文并报警，报警里没有密文", () => {
  const sink: object[] = [];
  const crypto = logged(DUAL, sink);
  const passenger = { name: "星野测试", phone: "+818011112222", email: "qa@fictional.example.test" };
  const sealed = crypto.sealOrderPassenger(TENANT_A, ORDER, passenger);
  const prefix = sealed.enc.slice(0, sealed.enc.indexOf(":") + 1);
  const parts = sealed.enc.slice(prefix.length).split(".");
  assert.equal(parts.length, 4);
  const other = { name: "别的内容", phone: "+818099998888", email: "other@fictional.example.test" };
  for (let index = 1; index < 4; index += 1) {
    const flipped = [...parts];
    const segment = Buffer.from(flipped[index] as string, "base64url");
    segment[0] = (segment[0] as number) ^ 1;
    flipped[index] = segment.toString("base64url");
    const tampered = `${prefix}${flipped.join(".")}`;
    assert.equal(crypto.openForVerify("order", TENANT_A, ORDER, tampered), null, `第 ${index} 段`);
    assert.deepEqual(crypto.readOrderPassenger(TENANT_A, ORDER, tampered, other), other);
  }
  for (const broken of [`${prefix}`, `${prefix}v1`, `${prefix}v2.${parts.slice(1).join(".")}`, `${prefix}${parts.join(".")}.extra`]) assert.deepEqual(crypto.readOrderPassenger(TENANT_A, ORDER, broken, other), other);
  assert.ok(sink.length >= 1);
  const text = JSON.stringify(sink);
  assert.ok(!text.includes(parts[3] as string) && !text.includes(passenger.email) && !text.includes(other.email));
});

test("密文绑定种类、租户、记录：四种种类互相解不开；同一条密文换租户、换编号都解不开", () => {
  const crypto = logged(DUAL, []);
  const kinds = ["order", "order_change", "webhook_delivery", "notification"] as const;
  const sealedOrder = crypto.sealOrderPassenger(TENANT_A, ORDER, { name: "a", phone: "b", email: "c" }).enc;
  const sealedChange = crypto.sealValues("order_change", TENANT_A, ORDER, { passenger: { name: "a" } }).enc as string;
  const sealedDelivery = crypto.sealValues("webhook_delivery", TENANT_A, ORDER, { passenger: { name: "a" } }).enc as string;
  const sealedRecipient = crypto.sealRecipient(TENANT_A, ORDER, "qa@fictional.example.test").enc as string;
  const sealed = { order: sealedOrder, order_change: sealedChange, webhook_delivery: sealedDelivery, notification: sealedRecipient };
  for (const from of kinds) {
    assert.notEqual(crypto.openForVerify(from, TENANT_A, ORDER, sealed[from]), null, from);
    assert.equal(crypto.openForVerify(from, TENANT_B, ORDER, sealed[from]), null, `${from} 换租户`);
    assert.equal(crypto.openForVerify(from, TENANT_A, TENANT_B, sealed[from]), null, `${from} 换编号`);
    for (const to of kinds) if (to !== from) assert.equal(crypto.openForVerify(to, TENANT_A, ORDER, sealed[from]), null, `${from} 当 ${to}`);
  }
});

test("不同用途的派生密钥互不相通：乘客密文用别的用途打不开，别的用途的密文也不能当乘客密文；盲索引密钥也不是加密密钥", () => {
  const purposes = ["tenant-webhook-secret", "platform-totp-secret", "integration-secret", "payout-account", "passenger-index"] as const;
  const owner = `order:${TENANT_A}:${ORDER}`;
  const sealed = box.seal("passenger-data", owner, "内容");
  assert.equal(box.open("passenger-data", owner, sealed), "内容");
  for (const purpose of purposes) {
    assert.throws(() => box.open(purpose, owner, sealed), purpose);
    assert.throws(() => box.open("passenger-data", owner, box.seal(purpose, owner, "内容")), purpose);
    assert.notEqual(box.mac(purpose, "x"), box.mac("passenger-data", "x"), purpose);
  }
});

test("盲索引：带密钥的 HMAC，不是裸哈希，也不是直接拿主密钥算的；只有规范化后的值加密钥标记之外看不出别的", () => {
  const crypto = logged(DUAL, []);
  const email = "qa.index@fictional.example.test";
  const value = crypto.index(TENANT_A, "email", email);
  const [kid, hex] = value.split(":") as [string, string];
  assert.match(kid, /^[0-9a-f]{8}$/);
  assert.match(hex, /^[0-9a-f]{64}$/);
  for (const input of [email, JSON.stringify([TENANT_A, "email", email]), `${TENANT_A}:email:${email}`]) {
    assert.notEqual(hex, createHash("sha256").update(input).digest("hex"), "裸哈希");
    assert.notEqual(hex, createHmac("sha256", FAKE_SECRETS.dataEncryptionKey).update(input).digest("hex"), "直接用主密钥");
  }
  assert.notEqual(value, new PassengerCrypto(new SecretBox("another-fake-master-key-for-rotation-0123456789"), DUAL).index(TENANT_A, "email", email));
});

test("盲索引有域分隔：同一个值当邮箱、电话、姓名结果不同；租户和值的边界拼接不出相同输入", () => {
  const crypto = logged(DUAL, []);
  const value = "+818011112222";
  assert.equal(new Set([crypto.index(TENANT_A, "email", value), crypto.index(TENANT_A, "phone", value), crypto.index(TENANT_A, "name", value)]).size, 3);
  assert.notEqual(crypto.index("a", "email", 'b","email","c'), crypto.index('a","email","b', "email", "c"));
  assert.notEqual(crypto.index(TENANT_A, "email", value), crypto.index(TENANT_B, "email", value));
});

/**
 * 迁移之前 `contactMatches` 的口径，抄在这里作为参照（services/site.ts 的注释：NFKC；邮箱不分大小写、去首尾空白；电话去空格、括号、连字符、点；有 @ 的按邮箱比；少于 6 位不算）。
 */
function legacyMatches(contact: string, passenger: { email: string; phone: string }): boolean {
  const given = contact.normalize("NFKC").trim();
  if (given === "") return false;
  if (given.includes("@")) return given.toLowerCase() === passenger.email.normalize("NFKC").trim().toLowerCase();
  const digits = (text: string): string => text.normalize("NFKC").trim().replace(/[\s\-().]/g, "");
  const phone = digits(given);
  return phone.length >= 6 && phone === digits(passenger.phone);
}

const STORED = [
  { email: "Hoshino.Taro+tag@Fictional.Example.Test", phone: "+818011112222" },
  { email: "ｆｕｌｌ＠ｆｉｃｔｉｏｎａｌ．ｅｘａｍｐｌｅ．ｔｅｓｔ", phone: "＋８１ ８０－１１１１－２２２２" },
  { email: "İstanbul.K@fictional.example.test", phone: "(+81) 80.1111.3333" },
  { email: "straße@fictional.example.test", phone: "+81 80 1111 4444" },
];
const CONTACTS = [
  "hoshino.taro+tag@fictional.example.test",
  "  HOSHINO.TARO+TAG@FICTIONAL.EXAMPLE.TEST　",
  "ｈｏｓｈｉｎｏ．ｔａｒｏ＋ｔａｇ＠ｆｉｃｔｉｏｎａｌ．ｅｘａｍｐｌｅ．ｔｅｓｔ",
  "hoshino.taro@fictional.example.test",
  "full@fictional.example.test",
  "İstanbul.K@fictional.example.test",
  "i̇stanbul.K@fictional.example.test",
  "STRASSE@fictional.example.test",
  "straße@fictional.example.test",
  "+818011112222",
  "＋８１８０１１１１２２２２",
  "+81 80-1111-2222",
  "+81(80)1111.2222",
  "　+81　80　1111　2222 ",
  "+81－80－1111－2222",
  "+81–80–1111–2222",
  "+81ー80ー1111ー2222",
  "08011112222",
  "818011112222",
  "+818011113333",
  "+818011114444",
  "12345",
  "-----",
  "",
  " ",
  "@",
];

test("规范化：盲索引和明文两条路、新旧口径，在所有写法上结论都一样（大小写、全半角、空格、+81、连字符）", () => {
  const crypto = logged(DUAL, []);
  for (const stored of STORED) {
    const sealed = crypto.sealOrderPassenger(TENANT_A, ORDER, { name: "星野", ...stored });
    const found = { tenantId: TENANT_A, ...stored, emailBidx: sealed.emailBidx, phoneBidx: sealed.phoneBidx };
    const noIndex = { ...found, emailBidx: null, phoneBidx: null };
    for (const contact of CONTACTS) {
      const label = `${JSON.stringify(contact)} 对 ${JSON.stringify(stored)}`;
      const plain = contactMatches(contact, stored);
      assert.equal(contactMatchesOrder(crypto, contact, found), plain, `盲索引和明文不一致：${label}`);
      assert.equal(contactMatchesOrder(crypto, contact, noIndex), plain, `没回填的路不一致：${label}`);
      assert.equal(plain, legacyMatches(contact, stored), `和原来的 contactMatches 不一致：${label}`);
    }
  }
});

test("规范化是幂等的：规范化两次和一次的盲索引相同（筛选和回填都可能再过一遍）", () => {
  for (const { email, phone } of STORED) {
    assert.equal(normalizeEmailForIndex(normalizeEmailForIndex(email)), normalizeEmailForIndex(email), email);
    assert.equal(normalizePhoneForIndex(normalizePhoneForIndex(phone)), normalizePhoneForIndex(phone), phone);
    assert.equal(normalizeNameForIndex(normalizeNameForIndex(email)), normalizeNameForIndex(email), email);
    const key = contactLookupKey(email);
    assert.equal(key?.value, normalizeEmailForIndex(email));
  }
});

test("客人真的把姓名写成占位的字样：有密文时，读明文模式也要读出这位客人写的内容，不能 503（官网下单没有拦这个字样）", () => {
  const crypto = logged(DUAL, []);
  const passenger = { name: ENCRYPTED_TEXT, phone: "+818011112222", email: "literal@fictional.example.test" };
  const sealed = crypto.sealOrderPassenger(TENANT_A, ORDER, passenger);
  assert.deepEqual(crypto.readOrderPassenger(TENANT_A, ORDER, sealed.enc, sealed.plain), passenger);
  const plainMode = logged(PLAIN_READ, []);
  assert.deepEqual(plainMode.readOrderPassenger(TENANT_A, ORDER, sealed.enc, sealed.plain), passenger);
});

test("明文只是占位、密文解得开：切回读明文也读得出真内容，不能因为开关把能读的单变成 503（PASSENGER_READ_SOURCE 来回切内容相同）", () => {
  const passenger = { name: "星野测试", phone: "+818011112222", email: "toggle@fictional.example.test" };
  const sealed = logged(RETIRED, []).sealOrderPassenger(TENANT_A, ORDER, passenger);
  assert.equal(sealed.plain.name, ENCRYPTED_TEXT);
  assert.deepEqual(logged(PLAIN_READ, []).readOrderPassenger(TENANT_A, ORDER, sealed.enc, sealed.plain), passenger);
  const change = logged(RETIRED, []).sealValues("order_change", TENANT_A, ORDER, { before: { passenger }, after: { passenger } });
  assert.deepEqual(logged(PLAIN_READ, []).readValues("order_change", TENANT_A, ORDER, change.enc, change.plain), { before: { passenger }, after: { passenger } });
  const recipient = logged(RETIRED, []).sealRecipient(TENANT_A, ORDER, passenger.email);
  assert.equal(logged(PLAIN_READ, []).readRecipient(TENANT_A, ORDER, recipient.enc, recipient.plain), passenger.email);
});

test("占位绝不当内容：解不开时三种副本都报 503，错误里没有内容；密钥不对时也一样", () => {
  const passenger = { name: "星野测试", phone: "+818011112222", email: "unreadable@fictional.example.test" };
  const writer = logged(RETIRED, []);
  const reader = logged(RETIRED, [], new SecretBox("another-fake-master-key-for-rotation-0123456789"));
  const isUnreadable = (err: unknown): boolean => {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 503);
    assert.equal(err.code, "PASSENGER_DECRYPT_FAILED");
    assert.ok(!JSON.stringify({ ...err, message: err.message }).includes(passenger.email));
    return true;
  };
  const order = writer.sealOrderPassenger(TENANT_A, ORDER, passenger);
  assert.throws(() => reader.readOrderPassenger(TENANT_A, ORDER, order.enc, order.plain), isUnreadable);
  assert.throws(() => reader.readOrderPassenger(TENANT_A, ORDER, null, order.plain), isUnreadable);
  const change = writer.sealValues("order_change", TENANT_A, ORDER, { after: { passenger }, before: { passenger } });
  assert.throws(() => reader.readValues("order_change", TENANT_A, ORDER, change.enc, change.plain), isUnreadable);
  const recipient = writer.sealRecipient(TENANT_A, ORDER, passenger.email);
  assert.throws(() => reader.readRecipient(TENANT_A, ORDER, recipient.enc, recipient.plain), isUnreadable);
  assert.throws(() => reader.readRecipient(null, ORDER, null, recipient.plain), isUnreadable);
});

test("副本里只有一层乘客是占位（比如改单前是占位、改单后是新值），解不开时同样不能带着占位继续", () => {
  const reader = logged(RETIRED, []);
  const mixed = { before: { passenger: { name: ENCRYPTED_TEXT, phone: ENCRYPTED_TEXT, email: ENCRYPTED_TEXT } }, after: { passenger: { name: "新名字", phone: "+818011112222", email: "mixed@fictional.example.test" } } };
  assert.throws(() => reader.readValues("order_change", TENANT_A, ORDER, null, mixed), (err) => err instanceof AppError && err.code === "PASSENGER_DECRYPT_FAILED");
});

test("没配置主密钥：下单的加密报 503；不会把任何内容放进返回值", () => {
  const crypto = logged(DUAL, [], null);
  assert.throws(() => crypto.sealOrderPassenger(TENANT_A, ORDER, { name: "a", phone: "b", email: "c" }), (err) => err instanceof AppError && err.statusCode === 503 && err.code === "PASSENGER_ENCRYPTION_NOT_CONFIGURED");
  assert.throws(() => crypto.index(TENANT_A, "email", "a@b.test"), (err) => err instanceof AppError && err.code === "PASSENGER_ENCRYPTION_NOT_CONFIGURED");
  assert.equal(crypto.currentPrefix, null);
  assert.equal(crypto.isCurrent("abcd1234:v1.x.y.z"), false);
});

const env = testEnv("postgres://fake:fake@localhost:5432/fake");

test("开关的非法值启动失败：只认小写的 true、false 和两个读取来源", () => {
  for (const [name, values] of [
    ["PASSENGER_READ_SOURCE", ["both", "PLAINTEXT", "Ciphertext", "true"]],
    ["PASSENGER_PLAINTEXT_WRITE", ["no", "0", "1", "FALSE", "True", "off"]],
    ["PASSENGER_BACKFILL_ENABLED", ["no", "0", "1", "FALSE", "True", "off"]],
    ["PASSENGER_RETENTION_ENABLED", ["no", "0", "1", "FALSE"]],
  ] as const) {
    for (const value of values) assert.throws(() => loadConfig({ ...env, [name]: value }), new RegExp(name), `${name}=${value}`);
  }
});

test("默认值是安全的一边：读密文、明文照写、回填开；只写空白等于没配置", () => {
  assert.deepEqual(loadConfig({ ...env, PASSENGER_READ_SOURCE: "  ", PASSENGER_PLAINTEXT_WRITE: "\t", PASSENGER_BACKFILL_ENABLED: " " }).passengerEncryption, { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true });
});

test("主密钥：太短、和登录密钥相同都起不来；报错里没有密钥原文", () => {
  const short = "short-fake-key";
  assert.throws(() => loadConfig({ ...env, DATA_ENCRYPTION_KEY: short }), (err: Error) => /至少 32/.test(err.message) && !err.message.includes(short));
  const same = "same-fake-secret-for-both-purposes-0123456789";
  assert.throws(() => loadConfig({ ...env, DATA_ENCRYPTION_KEY: same, AUTH_JWT_SECRET: same }), (err: Error) => /不能和 AUTH_JWT_SECRET/.test(err.message) && !err.message.includes(same));
});

test("没有主密钥时 config:check 写明后果（ADR 0057）", async () => {
  const source = await repoFile("packages/config/src/index.ts");
  assert.match(source, /未配置，不能下新订单和改乘客信息/);
});

test("文档：先核对再关明文，这个组合没有启动拦截，靠 deploy.md 的前提；关明文之前必须 --verify 全部一致", async () => {
  const deploy = await repoFile("docs/deploy.md");
  const section = deploy.slice(deploy.indexOf("### 乘客信息加密存储"));
  const verify = section.indexOf("--verify` 输出「全部一致」");
  const disable = section.indexOf("PASSENGER_PLAINTEXT_WRITE=false");
  assert.ok(verify > 0 && disable > verify, "--verify 全部一致要写在关明文之前");
  assert.match(section, /不可逆/);
  assert.match(section, /备份/);
});

test("迁移 0200 不重写表、不动数据：只加可空、无默认值的列，没有 update / 类型变更；开着 PASSENGER_PLAINTEXT_WRITE=false 也不需要它改数据", async () => {
  const sql = (await readFile(new URL("../../migrations/0200_passenger_encryption.sql", import.meta.url), "utf8")).replace(/--.*$/gm, "");
  for (const [, column] of sql.matchAll(/add column (.*?)[,;]/g)) {
    assert.match(column as string, /^\w+ text$/, `这一列要是可空、无默认值：${column}`);
  }
  assert.ok(!/\bupdate\s+\w+\s+set\b/i.test(sql), "迁移不能改数据");
  assert.ok(!/alter column|set not null|\bdefault\b/i.test(sql), "不能有要扫表或重写表的改动");
});
