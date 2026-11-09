/** M8-09：订单确认邮件里的一口价说明（ADR 0070）：客人那封写「费用说明」，供应商那封包车单写「包车报价须包含高速费、停车费」。说法来自 `fixed-price-includes.ts`。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_SUPPLIER_PRICE_NOTE, fixedPriceFeeNote } from "./fixed-price-includes.ts";
import { renderMailHtml } from "./mail-html.ts";
import { NOTIFICATION_TEMPLATES, TENANT_FORBIDDEN_PATTERN, findNotificationTemplate, renderNotification, templatePlaceholders } from "./notifications.ts";

const fill = (event: "order.confirmed", audience: "guest" | "tenant", overrides: Record<string, string>): { text: string; html: string } => {
  const target = findNotificationTemplate(event, audience, "zh-CN", "email");
  assert.ok(target);
  const rendered = renderNotification(target, { ...Object.fromEntries(templatePlaceholders(target).map((name) => [name, `v-${name}`])), ...overrides });
  assert.ok(rendered, `${event}/${audience}`);
  return { text: rendered.text, html: renderMailHtml(rendered) };
};

test("客人确认邮件：接送机写「一口价已含所有费用」；包车再写超出套餐的时长和公里服务后按实际收取；HTML 版一致", () => {
  const transfer = fill("order.confirmed", "guest", { fee_note: fixedPriceFeeNote("transfer") });
  assert.match(transfer.text, /已付金额：v-paid_amount\n费用说明：一口价已含所有费用（高速费、停车费等），无需另付\n/);
  assert.doesNotMatch(transfer.text, /超出套餐/);
  const charter = fill("order.confirmed", "guest", { fee_note: fixedPriceFeeNote("charter") });
  assert.match(charter.text, /费用说明：一口价已含所有费用（高速费、停车费等），无需另付；超出套餐的时长和公里服务后按实际收取\n/);
  assert.match(charter.html, /费用说明：一口价已含所有费用（高速费、停车费等），无需另付；超出套餐的时长和公里服务后按实际收取/);
});

test("分界前下的包车单（费用说明为空）：那一行整行不出现，其余照常", () => {
  const legacy = fill("order.confirmed", "guest", { fee_note: "" });
  assert.doesNotMatch(legacy.text, /费用说明|含所有费用/);
  assert.match(legacy.text, /已付金额：v-paid_amount\n\n派好司机后/);
});

test("供应商新订单邮件：包车单写「包车报价须包含高速费、停车费」，别的单整行不出现；不含对外价等禁用词；只有这两封确认邮件用这两个变量", () => {
  const charter = fill("order.confirmed", "tenant", { charter_price_note: CHARTER_SUPPLIER_PRICE_NOTE });
  assert.match(charter.text, /派车截止：v-dispatch_due_at（东京时间）\n包车报价须包含高速费、停车费：/);
  assert.doesNotMatch(CHARTER_SUPPLIER_PRICE_NOTE, TENANT_FORBIDDEN_PATTERN);
  const transfer = fill("order.confirmed", "tenant", { charter_price_note: "" });
  assert.doesNotMatch(transfer.text, /包车报价/);
  assert.match(transfer.text, /派车截止：v-dispatch_due_at（东京时间）\n\n到后台处理/);
  const users = (name: string): string[] => NOTIFICATION_TEMPLATES.filter((target) => templatePlaceholders(target).includes(name)).map((target) => `${target.event}/${target.audience}`);
  assert.deepEqual(users("fee_note"), ["order.confirmed/guest"]);
  assert.deepEqual(users("charter_price_note"), ["order.confirmed/tenant"]);
});
