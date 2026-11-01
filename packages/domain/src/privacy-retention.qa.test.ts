/**
 * M4-21 QA：脱敏和打码的纯函数边界（ADR 0055）。已有 privacy.test.ts 覆盖的不重复；这里是期限的时区和日历边界、把手写内容当系统枚举放过、编号和日期被姓名或相邻数字打坏。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ANONYMIZED_TEXT, PASSENGER_RETENTION_MIN_DAYS, isAnonymizedPassenger, maskContactsInText, maskOrderValues, maskPassenger, passengerRetentionCutoff, scrubContactsInText, scrubOrderValues } from "./index.ts";

const ORIGINAL_TZ = process.env["TZ"];
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
  else process.env["TZ"] = ORIGINAL_TZ;
});

const tokyo = (text: string): Date => new Date(`${text}+09:00`);

test("期限：东京 23:59:59 和第二天 00:00:00 差一天；UTC 同一天也算两天", () => {
  assert.equal(passengerRetentionCutoff(tokyo("2026-09-29T23:59:59"), 180).toISOString(), tokyo("2026-04-02T00:00:00").toISOString());
  assert.equal(passengerRetentionCutoff(tokyo("2026-09-30T00:00:00"), 180).toISOString(), tokyo("2026-04-03T00:00:00").toISOString());
  assert.equal(new Date("2026-09-29T15:00:00Z").toISOString(), tokyo("2026-09-30T00:00:00").toISOString());
});

test("期限：跨月、跨年、闰年二月都按日历日", () => {
  assert.equal(passengerRetentionCutoff(tokyo("2027-01-01T00:00:00"), 180).toISOString(), tokyo("2026-07-05T00:00:00").toISOString());
  assert.equal(passengerRetentionCutoff(tokyo("2028-08-27T12:00:00"), 180).toISOString(), tokyo("2028-02-29T00:00:00").toISOString());
  assert.equal(passengerRetentionCutoff(tokyo("2027-08-27T12:00:00"), 180).toISOString(), tokyo("2027-02-28T00:00:00").toISOString());
});

test("期限：服务器时区不影响结果", () => {
  const now = new Date("2026-09-29T20:00:00Z");
  const expected = passengerRetentionCutoff(now, 180).toISOString();
  for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Tokyo"]) {
    process.env["TZ"] = zone;
    assert.equal(passengerRetentionCutoff(now, 180).toISOString(), expected, zone);
  }
});

test("期限：配置错了也挡住，不静默算出一个很近的截止时间", () => {
  const now = new Date("2026-10-07T01:00:00Z");
  for (const days of [179, 0, -1, -180, 180.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.throws(() => passengerRetentionCutoff(now, days), RangeError, String(days));
  assert.ok(passengerRetentionCutoff(now, PASSENGER_RETENTION_MIN_DAYS).getTime() <= now.getTime() - 179 * 86_400_000);
});

test("期限：一定不晚于 days 天前（今天的单任何配置都不会到期）", () => {
  const now = tokyo("2026-11-01T00:00:01");
  assert.ok(passengerRetentionCutoff(now, 180).getTime() <= now.getTime() - 180 * 86_400_000);
});

test("前后值：手写键的值只有一串电话，不能当枚举放过", () => {
  const masked = maskOrderValues({ notes: "09012345678", reason: "09012345678", decision_note: "+819012345678" }, "王小明");
  assert.ok(!JSON.stringify(masked).includes("09012345678"), JSON.stringify(masked));
  assert.ok(!JSON.stringify(masked).includes("819012345678"), JSON.stringify(masked));
});

test("脱敏：手写键的值只有一串电话，不能当枚举留下原文", () => {
  const scrubbed = scrubOrderValues({ notes: "09012345678", after: { notes: "08099990000" } }, ["王小明"]);
  assert.ok(!JSON.stringify(scrubbed).includes("09012345678"), JSON.stringify(scrubbed));
  assert.ok(!JSON.stringify(scrubbed).includes("08099990000"), JSON.stringify(scrubbed));
});

test("前后值：手写键的值只有全大写姓名，或带下划线的账号形状的姓名，不能当枚举放过", () => {
  assert.notEqual(maskOrderValues({ notes: "WANG" }, "Wang Xiaoming").notes, "WANG");
  assert.notEqual(scrubOrderValues({ notes: "WANG" }, ["Wang Xiaoming"]).notes, "WANG");
  assert.notEqual(maskOrderValues({ notes: "wang_xiaoming" }, "Wang Xiaoming").notes, "wang_xiaoming");
});

test("真正的枚举还是原样：GUEST_REQUEST、refund_failed、DRIVER_NO_SHOW", () => {
  for (const code of ["GUEST_REQUEST", "refund_failed", "DRIVER_NO_SHOW", "NO_SHOW_APPROVED"]) {
    assert.equal(maskOrderValues({ reason: code }, "Guest Driver").reason, code);
    assert.equal(scrubOrderValues({ reason: code }, ["Guest Driver"]).reason, code);
  }
});

test("误伤：订单号里碰巧有和姓名一样的字母，订单号不能被打坏", () => {
  const no = "NZ20261001TAN23456";
  assert.equal(maskContactsInText(`订单 ${no}`, "Tan Lee"), `订单 ${no}`);
  assert.equal(scrubContactsInText(`订单 ${no}`, ["Tan Lee"]), `订单 ${no}`);
  const ticket = "TK20261001TAN234";
  assert.equal(maskContactsInText(`工单 ${ticket}`, "Tan Lee"), `工单 ${ticket}`);
});

test("误伤：日期前面紧挨一个短数字（时间、人数），日期不能被连起来打码", () => {
  assert.equal(maskContactsInText("用车 10:00 2026-11-01"), "用车 10:00 2026-11-01");
  assert.equal(maskContactsInText("2 人 2026-11-01"), "2 人 2026-11-01");
  assert.equal(maskContactsInText("3 2026-11-01 用车"), "3 2026-11-01 用车");
  assert.equal(scrubContactsInText("用车 10:00 2026-11-01", []), "用车 10:00 2026-11-01");
});

test("误伤：金额和日期挨着也都留着", () => {
  assert.equal(maskContactsInText("¥15000 2026-11-01"), "¥15000 2026-11-01");
  assert.equal(maskContactsInText("2026-11-01 ¥15000"), "2026-11-01 ¥15000");
  assert.equal(maskContactsInText("15000円 2026-11-01"), "15000円 2026-11-01");
});

test("占位：再打码、再脱敏都不变，也不会被当成姓名去匹配", () => {
  assert.equal(maskContactsInText(`联系人 ${ANONYMIZED_TEXT}`, ANONYMIZED_TEXT), `联系人 ${ANONYMIZED_TEXT}`);
  assert.equal(scrubContactsInText(`联系人 ${ANONYMIZED_TEXT}`, []), `联系人 ${ANONYMIZED_TEXT}`);
  assert.deepEqual(maskPassenger({ name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT }), { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT });
  assert.equal(isAnonymizedPassenger({ name: ANONYMIZED_TEXT }), true);
  assert.deepEqual(scrubOrderValues({ passenger: { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT }, notes: ANONYMIZED_TEXT }, []), { passenger: { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT }, notes: ANONYMIZED_TEXT });
});

test("脱敏：不留末 4 位、不留首字，各种写法的电话和邮箱都清掉", () => {
  for (const text of ["090-1234-5678", "090 1234 5678", "+81 (90) 1234-5678", "０９０１２３４５６７８", "090‐1234‐5678", "guest@example.com", "guest＠example．com", "<guest@example.com>"]) {
    const out = scrubContactsInText(`联系 ${text} 谢谢`, []);
    assert.ok(out.includes(ANONYMIZED_TEXT), `${text} → ${out}`);
    assert.ok(!/5678|５６７８|guest/.test(out), `${text} → ${out}`);
    assert.ok(out.startsWith("联系 ") && out.endsWith(" 谢谢"), out);
  }
});

test("脱敏：姓名按全名、分段、敬称都清掉；含正则特殊字符的姓名不报错", () => {
  assert.equal(scrubContactsInText("王小明、小明、王先生都是他", ["王小明"]), `${ANONYMIZED_TEXT}、${ANONYMIZED_TEXT}、${ANONYMIZED_TEXT}先生都是他`);
  assert.equal(scrubContactsInText("O'Brien (Jr.) 来了", ["O'Brien (Jr.)"]).includes("Brien"), false);
  assert.doesNotThrow(() => scrubContactsInText("文字", ["a[b", "(*", "\\"]));
});
