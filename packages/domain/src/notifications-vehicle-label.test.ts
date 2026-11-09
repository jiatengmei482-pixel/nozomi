/** M7-04：订单相关邮件里的车型标识（ADR 0068 第 3 节）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMailHtml } from "./mail-html.ts";
import { GUEST_VARIABLES, DRIVER_VARIABLES, NOTIFICATION_TEMPLATES, OPTIONAL_LINE_VARIABLES, TENANT_FORBIDDEN_PATTERN, TENANT_VARIABLES, type NotificationTemplate, findNotificationTemplate, renderNotification, templatePlaceholders } from "./notifications.ts";
import { vehicleLabelMailVariables } from "./vehicle-label.ts";

const GROUP = { sample_models: ["Toyota Noah / Voxy", "Nissan Serena"], combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] };

function template(event: NotificationTemplate["event"], audience: NotificationTemplate["audience"]): NotificationTemplate {
  const found = findNotificationTemplate(event, audience, "zh-CN", "email");
  assert.ok(found, `${event}/${audience}`);
  return found;
}

const fill = (target: NotificationTemplate, overrides: Record<string, string>): Record<string, string> => ({ ...Object.fromEntries(templatePlaceholders(target).map((name) => [name, `v-${name}`])), ...overrides });

test("邮件变量：同级车型说明、最多乘客、最多行李按 VEHICLE_LABEL_TEXTS 的写法；没填代表车型、找不到车型组时为空字符串", () => {
  assert.deepEqual(vehicleLabelMailVariables(GROUP), { vehicle_similar: "Toyota Noah / Voxy, Nissan Serena or similar", vehicle_max_persons: "6 人", vehicle_max_luggage: "5 件" });
  assert.deepEqual(vehicleLabelMailVariables({ sample_models: [" ", ""], combos: GROUP.combos }), { vehicle_similar: "", vehicle_max_persons: "6 人", vehicle_max_luggage: "5 件" });
  assert.deepEqual(vehicleLabelMailVariables(null), { vehicle_similar: "", vehicle_max_persons: "", vehicle_max_luggage: "" });
});

test("凡是有「车型：{{vehicle_group}}」的模板（客人、供应商、司机），下面紧跟同级车型一行、最多乘客 / 行李一行；三类接收方的白名单都有这三个变量", () => {
  const withGroup = NOTIFICATION_TEMPLATES.filter((target) => target.body.includes("车型：{{vehicle_group}}"));
  assert.deepEqual([...new Set(withGroup.map((target) => target.audience))].sort(), ["driver", "guest", "tenant"]);
  assert.ok(withGroup.length >= 19, String(withGroup.length));
  for (const target of withGroup) {
    assert.match(target.body, /车型：\{\{vehicle_group\}\}\n同级车型：\{\{vehicle_similar\}\}\n最多乘客：\{\{vehicle_max_persons\}\}，最多行李：\{\{vehicle_max_luggage\}\}\n?/, `${target.event}/${target.audience}`);
  }
  for (const names of [GUEST_VARIABLES, TENANT_VARIABLES, DRIVER_VARIABLES]) for (const name of OPTIONAL_LINE_VARIABLES) assert.ok((names as readonly string[]).includes(name), name);
  for (const target of NOTIFICATION_TEMPLATES) for (const name of OPTIONAL_LINE_VARIABLES) assert.ok(!target.subject.includes(`{{${name}}}`), `${target.event}/${target.audience} 主题里不能用 ${name}`);
  for (const name of OPTIONAL_LINE_VARIABLES) assert.doesNotMatch(name, TENANT_FORBIDDEN_PATTERN);
});

test("客人确认邮件：车型下面是同级说明和最多乘客 / 行李；纯文字版和 HTML 版内容一致", () => {
  const target = template("order.confirmed", "guest");
  const rendered = renderNotification(target, fill(target, { vehicle_group: "商务 7 座", ...vehicleLabelMailVariables(GROUP) }));
  assert.ok(rendered);
  assert.match(rendered.text, /车型：商务 7 座\n同级车型：Toyota Noah \/ Voxy, Nissan Serena or similar\n最多乘客：6 人，最多行李：5 件\n/);
  const html = renderMailHtml(rendered);
  assert.match(html, /同级车型：Toyota Noah \/ Voxy, Nissan Serena or similar/);
  assert.match(html, /最多乘客：6 人，最多行李：5 件/);
});

test("没填代表车型：同级车型那一行不出现（没有空标签、undefined），其余照常；找不到车型组时两行都不出现", () => {
  for (const [event, audience] of [["order.confirmed", "guest"], ["order.confirmed", "tenant"], ["order.driver_link", "driver"]] as const) {
    const target = template(event, audience);
    const noModels = renderNotification(target, fill(target, { vehicle_group: "商务 7 座", ...vehicleLabelMailVariables({ sample_models: [], combos: GROUP.combos }) }));
    assert.ok(noModels, `${event}/${audience}`);
    assert.doesNotMatch(noModels.text, /同级车型|or similar|undefined/);
    assert.match(noModels.text, /车型：商务 7 座\n最多乘客：6 人，最多行李：5 件\n/);
    const noGroup = renderNotification(target, fill(target, { vehicle_group: "见订单", ...vehicleLabelMailVariables(null) }));
    assert.ok(noGroup);
    assert.doesNotMatch(noGroup.text, /同级车型|最多乘客|最多行李/);
    assert.match(noGroup.text, /车型：见订单\n/);
  }
});

test("可省略的变量写在主题里时缺了照样整封不发；别的变量缺了仍然不发", () => {
  const smuggled: NotificationTemplate = { event: "order.confirmed", audience: "guest", locale: "zh-CN", channel: "email", subject: "{{vehicle_similar}}", body: "车型：{{vehicle_group}}" };
  assert.equal(renderNotification(smuggled, { vehicle_group: "x" }), null);
  const target = template("order.confirmed", "tenant");
  const { vehicle_group: _dropped, ...missing } = fill(target, vehicleLabelMailVariables(GROUP));
  assert.equal(renderNotification(target, missing), null);
});
