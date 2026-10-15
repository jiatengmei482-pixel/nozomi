import { test } from "node:test";
import assert from "node:assert/strict";
import { actionName, auditDiff, foldable, localDayInstant, objectName, resourceName, shortId, shownValue } from "./audit-display.ts";

test("对象类型和操作：认识的写中文，不认识的原样（页面用等宽字体显示）", () => {
  assert.deepEqual(resourceName("tenant"), { text: "供应商", known: true });
  assert.deepEqual(resourceName("price_rule"), { text: "price_rule", known: false });
  assert.deepEqual(actionName("request_password_reset"), { text: "发出密码重置", known: true });
  assert.deepEqual(actionName("archive"), { text: "archive", known: false });
});

test("对象的名称从改后、改前的值里找：name、email、code、title，多语言的取显示名；找不到是 null", () => {
  assert.equal(objectName({ before: null, after: { name: "Relaxcar" } }), "Relaxcar");
  assert.equal(objectName({ before: { email: "a@example.com" }, after: { status: "disabled" } }), "a@example.com");
  assert.equal(objectName({ before: null, after: { name: { zh: "东京", ja: "東京" } } }), "东京");
  assert.equal(objectName({ before: { code: "HND" }, after: null }), "HND");
  assert.equal(objectName({ before: { status: "active" }, after: { status: "suspended" } }), null);
  assert.equal(shortId("7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff"), "7b1c2d3e…");
});

test("改了什么：两边都有时只算变了的，变了的排前面；只有一边时全列；都没有是 none", () => {
  const both = auditDiff({ before: { status: "active", name: "Relaxcar", note: null }, after: { status: "suspended", name: "Relaxcar", reason: "资质到期" } });
  assert.equal(both.kind, "both");
  assert.deepEqual(both.rows.map((row) => [row.key, row.changed]), [["status", true], ["reason", true], ["name", false], ["note", false]]);
  assert.equal(both.unchanged, 2);
  assert.deepEqual([auditDiff({ before: null, after: { email: "a@example.com" } }).kind, auditDiff({ before: { name: "x" }, after: null }).kind, auditDiff({ before: null, after: null }).kind, auditDiff({ before: {}, after: {} }).kind], ["after", "before", "none", "none"]);
  // 嵌套的值按内容比，不按引用
  assert.equal(auditDiff({ before: { polygons: [[1, 2]] }, after: { polygons: [[1, 2]] } }).rows[0]?.changed, false);
});

test("值怎么显示：空、是否、认识的枚举带原值（状态按对象类型说）、一组东西是缩进好的文本块；长的可以折叠", () => {
  assert.deepEqual(shownValue("reason", ""), { text: "（空）", block: false, empty: true });
  assert.deepEqual(shownValue("temporary_password", true), { text: "是", block: false, empty: false });
  assert.deepEqual(shownValue("status", "suspended", "tenant"), { text: "已暂停", raw: "suspended", block: false, empty: false });
  assert.equal(shownValue("status", "active", "tenant").text, "正常");
  assert.equal(shownValue("status", "active", "platform_user").text, "在用");
  assert.equal(shownValue("status", "active", "city").text, "启用");
  assert.equal(shownValue("status", "published", "product").text, "已上架");
  assert.deepEqual(shownValue("role", "tenant_onboarding"), { text: "招商", raw: "tenant_onboarding", block: false, empty: false });
  assert.deepEqual(shownValue("role", "made_up"), { text: "made_up", block: false, empty: false });
  assert.deepEqual(shownValue("base_price", 20000), { text: "20000", block: false, empty: false });
  const block = shownValue("polygons", [{ lat: 35.1, lng: 139.2 }]);
  assert.equal(block.block, true);
  assert.match(block.text, /"lat": 35\.1/);
  assert.equal(foldable("短的"), null);
  assert.deepEqual(foldable(Array.from({ length: 10 }, (_, index) => `第 ${index} 行`).join("\n")), { folded: Array.from({ length: 6 }, (_, index) => `第 ${index} 行`).join("\n"), lines: 10 });
  assert.equal(foldable("字".repeat(301))?.lines, 1);
});

test("筛选的日期按查看者本地的整天换成时刻：「到」是第二天零点之前；不存在的日期不认", () => {
  const from = localDayInstant("2026-10-09", false) as string;
  const to = localDayInstant("2026-10-09", true) as string;
  assert.equal(new Date(to).getTime() - new Date(from).getTime(), 24 * 3600 * 1000);
  assert.equal(new Date(from).getHours(), 0);
  for (const bad of ["2026-02-31", "2026-13-01", "abc", ""]) assert.equal(localDayInstant(bad, false), null, bad);
});
