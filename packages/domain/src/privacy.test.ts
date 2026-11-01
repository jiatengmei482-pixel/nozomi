import { test } from "node:test";
import assert from "node:assert/strict";
import { ANONYMIZED_PASSENGER, ANONYMIZED_TEXT, isAnonymizedPassenger, isOrderApproval, isOrderAudit, maskContactsInText, maskName, maskOrderValues, maskPassenger, maskPhone, passengerRetentionCutoff, scrubContactsInText, scrubOrderValues } from "./privacy.ts";

test("姓名留第一个字；一个字的全打码；表情不会被切成半个", () => {
  assert.equal(maskName("王小明"), "王**");
  assert.equal(maskName("Satoh Ichiro"), "S**");
  assert.equal(maskName("王"), "*");
  assert.equal(maskName(""), "*");
  assert.equal(maskName("😀小明"), "😀**");
});

test("电话只留末 4 位，太短的全打码", () => {
  assert.equal(maskPhone("+819012345678"), "+********5678");
  assert.equal(maskPhone("09012345678"), "*******5678");
  assert.equal(maskPhone("+8112345"), "+****");
  assert.equal(maskPhone("1234"), "****");
});

test("打码后的结果里没有原文", () => {
  const masked = JSON.stringify(maskPassenger({ name: "王小明", phone: "+819012345678", email: "guest@example.com" }));
  for (const secret of ["小明", "90123", "guest"]) assert.ok(!masked.includes(secret), secret);
});

test("手写内容里的电话打码，只留末 4 位；短数字（次数、航站楼、分钟）不动", () => {
  assert.equal(maskContactsInText("打了 +81 90-1234-5678 没人接"), "打了 ****5678 没人接");
  assert.equal(maskContactsInText("电话０９０１２３４５６７８"), "电话****５６７８");
  assert.equal(maskContactsInText("第 3 次，T2 等了 15 分钟"), "第 3 次，T2 等了 15 分钟");
});

test("手写内容里的邮箱、乘客姓名打码；其他文字原样", () => {
  assert.equal(maskContactsInText("发到 guest@example.com，已读不回"), "发到 gu***@example.com，已读不回");
  assert.equal(maskContactsInText("王小明没有回复", "王小明"), "王**没有回复");
  assert.equal(maskContactsInText("LINE 已读不回", "王小明"), "LINE 已读不回");
  assert.equal(maskContactsInText("没有写名字", null), "没有写名字");
});

test("姓名按段匹配：只写姓、只写名、顺序反过来、敬称；单字的姓只在跟着敬称时打码（ADR 0054）", () => {
  assert.equal(maskContactsInText("太郎没接", "山田 太郎"), "太**没接");
  assert.equal(maskContactsInText("YAMADA TARO no answer", "Taro Yamada"), "Y** T** no answer");
  assert.equal(maskContactsInText("王先生没回，田里等", "王 小明"), "*先生没回，田里等");
  assert.equal(maskContactsInText("王府井等王先生", "王小明"), "王府井等*先生");
  assert.equal(maskContactsInText("小明没回", "王小明"), "小**没回");
  assert.equal(maskContactsInText("山田様は不在", "山田太郎"), "山**様は不在");
  assert.equal(maskContactsInText("东京站等", "田 东"), "东京站等", "单字不打普通词");
  assert.equal(maskContactsInText("打给 line 的客人", "Li Na"), "打给 line 的客人", "短的拉丁段不打");
  assert.equal(maskContactsInText("Taroko 的 Taro", "Taro Yamada"), "Taroko 的 T**", "连着字母的不算");
  assert.equal(maskContactsInText("写的是 (a+b)，不是 aab", "a+b c"), "写的是 (a**)，不是 aab", "姓名里的特殊字符按字面找，不当正则");
});

// ---- M4-21（ADR 0055）----

test("手写内容：订单号、工单号、带分隔的日期、带货币标记的金额不算电话；其他长数字照旧打码", () => {
  for (const kept of ["订单 NZ20261101ABCD2345 客人投诉", "工单 TK20261101ABC234 已处理", "2026-11-01 接机", "2026/11/01 10:30 到达", "2026年11月1日 改期", "退 ¥1500000", "退 1500000 JPY", "赔 1500000円"]) {
    assert.equal(maskContactsInText(kept), kept);
  }
  assert.equal(maskContactsInText("电话 09012345678，订单 NZ20261101ABCD2345"), "电话 ****5678，订单 NZ20261101ABCD2345");
  assert.equal(maskContactsInText("2026-13-45"), "****1345", "不合法的日期不算日期");
  assert.equal(maskContactsInText("1234567"), "****4567");
});

test("前后值打码：乘客、即时通讯账号、手写键打码；编号、金额、员工账号、枚举不动", () => {
  const masked = maskOrderValues(
    { order_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", amount_minor: 12345678, email: "staff@platform.test", name: "员工甲", reason: "GUEST_REQUEST", passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, messaging: { app: "line", handle: "wang_xm_88" }, notes: "王小明电话 09012345678", nested: [{ note: "发到 guest@example.com" }] },
    null,
  );
  assert.deepEqual(masked, {
    order_id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    amount_minor: 12345678,
    email: "staff@platform.test",
    name: "员工甲",
    reason: "GUEST_REQUEST",
    passenger: { name: "王**", phone: "+********5678", email: "gu***@example.com" },
    messaging: { app: "line", handle: "wa***" },
    notes: "王**电话 ****5678",
    nested: [{ note: "发到 gu***@example.com" }],
  });
});

test("前后值打码：叫 Guest 的乘客不会打坏枚举；再打一次结果不变（读取时打旧记录，新记录已打过）", () => {
  assert.deepEqual(maskOrderValues({ reason: "GUEST_REQUEST", note: "Guest called" }, "Guest"), { reason: "GUEST_REQUEST", note: "G** called" });
  const once = maskOrderValues({ passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, note: "王小明 09012345678 guest@example.com" }, "王小明");
  assert.deepEqual(maskOrderValues(once, "王小明"), once);
});

test("脱敏：占位不留原文片段；打码函数认得占位，不会把它打成半截", () => {
  assert.equal(scrubContactsInText("王小明 09012345678 guest@example.com 在 T2 等", ["王小明"]), "[已脱敏] [已脱敏] [已脱敏] 在 T2 等");
  assert.equal(scrubContactsInText("旧名字李大伟，新名字王小明", ["王小明", "李大伟"]), "旧名字[已脱敏]，新名字[已脱敏]");
  assert.equal(scrubContactsInText("订单 NZ20261101ABCD2345 2026-11-01 退 ¥1500000", []), "订单 NZ20261101ABCD2345 2026-11-01 退 ¥1500000");
  assert.deepEqual(maskPassenger(ANONYMIZED_PASSENGER), { name: "[已脱敏]", phone: "[已脱敏]", email: "[已脱敏]" });
  assert.equal(maskContactsInText("[已脱敏] 没接", ANONYMIZED_TEXT), "[已脱敏] 没接");
  assert.equal(isAnonymizedPassenger(ANONYMIZED_PASSENGER), true);
});

test("脱敏前后值：乘客换成占位，手写键清联系方式，即时通讯账号和别的字段不动", () => {
  assert.deepEqual(scrubOrderValues({ flight_no: "NH211", passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, messaging: { app: "line", handle: "wang" }, notes: "王小明 T2" }, ["王小明"]), {
    flight_no: "NH211",
    passenger: { name: "[已脱敏]", phone: "[已脱敏]", email: "[已脱敏]" },
    messaging: { app: "line", handle: "wang" },
    notes: "[已脱敏] T2",
  });
});

test("哪些审计、复核算和订单有关", () => {
  assert.equal(isOrderAudit({ resource: "order_change" }), true);
  assert.equal(isOrderAudit({ resource: "channel" }), false);
  assert.equal(isOrderAudit({ resource: "approval", after: { resource: "order", kind: "order.cancel_refund" } }), true);
  assert.equal(isOrderAudit({ resource: "approval", after: { kind: "ticket.decision" } }), true);
  assert.equal(isOrderAudit({ resource: "approval", after: { kind: "channel.update" } }), false);
  assert.equal(isOrderApproval({ resource: "rescue" }), true);
  assert.equal(isOrderApproval({ resource: "channel" }), false);
});

test("保存期限按东京日历日：今天 − 结束日期 > 天数才算超过；低于 180 天拒绝", () => {
  // 东京 2026-11-01 00:30；往前 180 天是 2026-05-05
  const now = new Date("2026-10-31T15:30:00Z");
  const cutoff = passengerRetentionCutoff(now, 180);
  assert.equal(cutoff.toISOString(), "2026-05-04T15:00:00.000Z");
  assert.equal(new Date("2026-05-04T14:59:59Z") < cutoff, true, "东京 5 月 4 日 23:59:59，第 181 天：动");
  assert.equal(new Date("2026-05-04T15:00:00Z") < cutoff, false, "东京 5 月 5 日 00:00，第 180 天：不动");
  assert.equal(passengerRetentionCutoff(new Date("2026-10-31T14:59:59Z"), 180).toISOString(), "2026-05-03T15:00:00.000Z", "东京还是 10 月 31 日");
  assert.equal(passengerRetentionCutoff(now, 200).toISOString(), "2026-04-14T15:00:00.000Z");
  for (const days of [179, 0, -1, 180.5]) assert.throws(() => passengerRetentionCutoff(now, days), RangeError);
});
