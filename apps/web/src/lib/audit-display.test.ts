import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@nozomi/domain";
import { APPROVAL_KIND_NAMES } from "./channel-display.ts";
import { ACTION_FILTER_OPTIONS, ACTION_NAMES, ACTION_NAMES_BY_RESOURCE, FIELD_NAMES_BY_RESOURCE, RESOURCE_NAMES, actionFilterOption, actionName, fieldName, isActionFilter, auditDiff, foldable, localDayInstant, objectName, resourceName, shortId, shownValue } from "./audit-display.ts";

test("对象类型和操作：认识的写中文，不认识的原样（页面用等宽字体显示）", () => {
  assert.deepEqual(resourceName("tenant"), { text: "供应商", known: true });
  assert.deepEqual(resourceName("price_rule"), { text: "价格规则", known: true });
  assert.deepEqual(resourceName("fx_fetch"), { text: "汇率拉取", known: true });
  assert.deepEqual(resourceName("settlement"), { text: "settlement", known: false });
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

test("全部操作留审计（M4-03）：后端会写的每一种对象类型、每一种操作在审计日志页都有中文名；按对象换的说法也只用后端认识的值", () => {
  for (const resource of AUDIT_RESOURCES) assert.equal(resourceName(resource).known, true, `对象类型 ${resource} 没有中文名`);
  for (const action of AUDIT_ACTIONS) assert.equal(actionName(action).known, true, `操作 ${action} 没有中文名`);
  for (const [resource, actions] of Object.entries(ACTION_NAMES_BY_RESOURCE)) {
    assert.ok((AUDIT_RESOURCES as readonly string[]).includes(resource), `按对象的说法里有后端没有的对象类型 ${resource}`);
    for (const action of Object.keys(actions)) assert.ok((AUDIT_ACTIONS as readonly string[]).includes(action), `按对象的说法里有后端没有的操作 ${action}`);
  }
  // 名称表里也不留后端已经不用的值（筛选下拉框里不出现点了也查不到的选项）
  assert.deepEqual(Object.keys(RESOURCE_NAMES).filter((key) => !(AUDIT_RESOURCES as readonly string[]).includes(key)), []);
  assert.deepEqual(Object.keys(ACTION_NAMES).filter((key) => !(AUDIT_ACTIONS as readonly string[]).includes(key)), []);
});

test("同一个操作在订单中心、财务结算的对象上换成业务说法；状态按对象说", () => {
  assert.equal(actionName("close", "payout_batch").text, "锁定");
  assert.equal(actionName("issue", "statement").text, "出账");
  assert.equal(actionName("reply", "statement").text, "答复异议");
  assert.equal(actionName("note", "ticket").text, "内部备注");
  assert.equal(actionName("claim", "order_exception").text, "认领 / 转交");
  assert.equal(actionName("close").text, "关闭");
  assert.equal(shownValue("status", "awaiting_tenant", "ticket").text, "等供应商回复");
  assert.equal(shownValue("status", "claimed", "order_exception").text, "处理中");
  assert.equal(shownValue("status", "in_payout", "statement").text, "待付款");
});

test("双人复核的审计（M4-10）：kind、resource_id 等字段有中文名；每一种复核类别的值都换成中文并带原值；同名字段在别的对象上不受影响", () => {
  assert.equal(fieldName("kind", "approval"), "复核类别");
  assert.equal(fieldName("resource_id", "approval"), "复核对象的编号");
  for (const field of Object.keys(FIELD_NAMES_BY_RESOURCE["approval"] ?? {})) assert.ok(fieldName(field, "approval"), field);
  assert.equal(fieldName("kind", "order_exception"), undefined, "别的对象上的 kind 不叫复核类别");
  assert.equal(fieldName("status", "approval"), "状态", "通用的照用");
  const kinds = Object.keys(APPROVAL_KIND_NAMES);
  assert.ok(kinds.includes("compensation_table.update"));
  for (const kind of kinds) {
    const shown = shownValue("kind", kind, "approval");
    assert.equal(shown.raw, kind, kind);
    assert.match(shown.text, /[\u4e00-\u9fff]/, kind);
  }
  assert.deepEqual(shownValue("kind", "compensation_table.update", "approval"), { text: "修改客人赔付表", raw: "compensation_table.update", block: false, empty: false });
  assert.deepEqual(shownValue("resource", "compensation_table", "approval").raw, "compensation_table");
  assert.equal(shownValue("kind", "compensation_table.update", "order").raw, undefined);
});

test("「操作」筛选（M4-10）：同名的动作合成一项（启用、暂停各只出现一次），选项值是这几个动作逗号连起来；每个动作都在某一项里；以前链接里的单个动作对上它所在的组", () => {
  const labels = ACTION_FILTER_OPTIONS.map((option) => option.label);
  assert.equal(new Set(labels).size, labels.length, "名称不重复");
  assert.equal(labels.filter((label) => label === "启用").length, 1);
  assert.equal(labels.filter((label) => label === "暂停").length, 1);
  assert.deepEqual(ACTION_FILTER_OPTIONS.find((option) => option.label === "启用")?.value.split(",").sort(), ["activate", "enable"]);
  assert.deepEqual(ACTION_FILTER_OPTIONS.find((option) => option.label === "暂停")?.value.split(",").sort(), ["pause", "suspend"]);
  assert.deepEqual(ACTION_FILTER_OPTIONS.flatMap((option) => option.value.split(",")).sort(), Object.keys(ACTION_NAMES).sort(), "每个动作恰好在一项里");
  for (const option of ACTION_FILTER_OPTIONS) {
    assert.ok(isActionFilter(option.value), option.value);
    for (const action of option.value.split(",")) assert.equal(ACTION_NAMES[action], option.label);
  }
  assert.equal(actionFilterOption("suspend"), ACTION_FILTER_OPTIONS.find((option) => option.label === "暂停")?.value);
  assert.equal(actionFilterOption("login"), "login");
  assert.equal(actionFilterOption("unknown_action"), "unknown_action");
  assert.equal(isActionFilter("enable,activate"), true);
  assert.equal(isActionFilter("enable,,activate"), false);
  assert.equal(isActionFilter("Enable"), false);
  assert.equal(isActionFilter(Array.from({ length: 11 }, () => "enable").join(",")), false);
});
