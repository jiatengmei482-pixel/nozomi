/** M8-13：客人确认邮件里的「（含区域加价）」和「公里数」一行（ADR 0073 第四部分；规范 site-booking-v2.md 10.5）。文字来自 `included-km.ts`，和官网订单页同一个函数。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_SURCHARGE_MAIL_NOTE, includedKmNote } from "./included-km.ts";
import { renderMailHtml } from "./mail-html.ts";
import { NOTIFICATION_TEMPLATES, OPTIONAL_LINE_VARIABLES, OPTIONAL_SUFFIX_VARIABLES, TENANT_VARIABLES, findNotificationTemplate, renderNotification, templatePlaceholders } from "./notifications.ts";

const guestConfirmed = (overrides: Record<string, string>): { text: string; html: string } => {
  const target = findNotificationTemplate("order.confirmed", "guest", "zh-CN", "email");
  assert.ok(target);
  const rendered = renderNotification(target, { ...Object.fromEntries(templatePlaceholders(target).map((name) => [name, `v-${name}`])), paid_amount: "JPY 99,000", ...overrides });
  assert.ok(rendered);
  return { text: rendered.text, html: renderMailHtml(rendered) };
};

test("含公里数的点对点单：已付金额下面一行「公里数：含 30 公里，本次路线约 34.2 公里，超出 5 公里 × 330 JPY（已含在一口价里）」，HTML 版一致", () => {
  const note = includedKmNote({ includedKm: 30, routeMeters: 34_200, overKm: 5, overKmPerKmMinor: 330, currency: "JPY" });
  const mail = guestConfirmed({ area_surcharge_note: "", distance_note: note });
  assert.match(mail.text, /\n已付金额：JPY 99,000\n公里数：含 30 公里，本次路线约 34\.2 公里，超出 5 公里 × 330 JPY（已含在一口价里）\n费用说明：/);
  assert.match(mail.html, /公里数：含 30 公里，本次路线约 34\.2 公里，超出 5 公里 × 330 JPY（已含在一口价里）/);
});

test("含区域加价的包车单：「（含区域加价）」接在已付金额后面，不写金额；没有含公里数时「公里数」整行不出现", () => {
  const mail = guestConfirmed({ area_surcharge_note: AREA_SURCHARGE_MAIL_NOTE, distance_note: "" });
  assert.match(mail.text, /\n已付金额：JPY 99,000（含区域加价）\n费用说明：/);
  assert.doesNotMatch(mail.text, /公里数/);
});

test("没有这些数的单（旧单、接送机）：已付金额一行和以前一模一样，没有「公里数」", () => {
  const mail = guestConfirmed({ area_surcharge_note: "", distance_note: "" });
  assert.match(mail.text, /\n已付金额：JPY 99,000\n费用说明：/);
  assert.doesNotMatch(mail.text, /区域加价|公里数/);
  const missing = findNotificationTemplate("order.confirmed", "guest", "zh-CN", "email");
  assert.ok(missing);
  const vars = Object.fromEntries(templatePlaceholders(missing).filter((name) => name !== "area_surcharge_note" && name !== "distance_note").map((name) => [name, `v-${name}`]));
  assert.match(renderNotification(missing, vars)?.text ?? "", /\n已付金额：v-paid_amount\n费用说明：/, "变量没给时同样");
});

test("只有客人的确认邮件用这两个变量；不在供应商白名单里；主题里不能用", () => {
  const users = (name: string): string[] => NOTIFICATION_TEMPLATES.filter((target) => templatePlaceholders(target).includes(name)).map((target) => `${target.event}/${target.audience}`);
  assert.deepEqual(users("area_surcharge_note"), ["order.confirmed/guest"]);
  assert.deepEqual(users("distance_note"), ["order.confirmed/guest"]);
  for (const name of ["area_surcharge_note", "distance_note"]) assert.ok(!(TENANT_VARIABLES as readonly string[]).includes(name), name);
  assert.ok((OPTIONAL_LINE_VARIABLES as readonly string[]).includes("distance_note"));
  assert.ok((OPTIONAL_SUFFIX_VARIABLES as readonly string[]).includes("area_surcharge_note"));
  const target = findNotificationTemplate("order.confirmed", "guest", "zh-CN", "email");
  assert.ok(target);
  assert.equal(renderNotification({ ...target, subject: "确认{{area_surcharge_note}}" }, { ...Object.fromEntries(templatePlaceholders(target).map((name) => [name, `v-${name}`])), area_surcharge_note: "" }), null, "主题里为空照样算缺");
});
