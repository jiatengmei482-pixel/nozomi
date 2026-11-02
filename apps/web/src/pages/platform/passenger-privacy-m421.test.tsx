/**
 * M4-21 的组件测试（ADR 0055）：看手写内容的原文、脱敏后的订单、编辑框不把打码后的备注存回去、工单详情的「查看原文」。接口用测试替身，数据都是虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { EXPIRED_LINK_HINT, LOOKUP_SENT_TEXT } from "../book/OrderPage.tsx";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { ACTION_NAMES } from "../../lib/audit-display.ts";
import { NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TENANT_ID, TICKET_ID, openApp, platformTicketDetailOf } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const money = (amount: string) => ({ amount, currency: "JPY" });
const orderOf = (changes: Partial<PlatformOrder> = {}): PlatformOrder =>
  ({
    ...NOT_DISPATCHED,
    id: ORDER_ID,
    order_no: "NZ20261007ABCDEFGH",
    status: "confirmed",
    category: "airport_transfer",
    direction: "pickup",
    vehicle_group_id: "g1",
    package_hours: null,
    service_time: "2026-10-20T01:00:00.000Z",
    service_local: "2026-10-20T10:00",
    timezone: "Asia/Tokyo",
    passengers: 2,
    luggage: 1,
    pickup: null,
    dropoff: { address: "东京站" },
    flight_no: "NH211",
    passenger: { name: "王**", phone: "+********5678", email: "g***@example.com" },
    notes: null,
    notes_masked: false,
    passenger_anonymized_at: null,
    tenant: { id: TENANT_ID, name: "供应商" },
    channel: { id: "c1", name: "官网" },
    channel_order_no: null,
    sell: money("100.00"),
    settlement: { total: money("80.00") },
    markup_bp: 1000,
    fx: null,
    payment: null,
    cancel_policy: null,
    cancellation: null,
    version: 3,
    created_at: "2026-10-07T01:00:00.000Z",
    ...changes,
  }) as PlatformOrder;
const detailOf = (order: PlatformOrder): PlatformOrderDetail => ({ order, events: [], records: NO_RECORDS, payments: [], refunds: [], changes: [], extra_charges: [], rescues: [], exceptions: [], tickets: [], webhook_deliveries: [], payment_events: [], quote: null, pending_proxy_review: null }) as unknown as PlatformOrderDetail;

const REVEAL = `/platform/v1/orders/${ORDER_ID}/passenger/reveal`;
const FULL = { passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, messaging: { app: "line", handle: "wang-88" }, notes: "王小明要儿童座椅 09012345678", anonymized_at: null, texts: [{ source: "contact_note", source_id: "x1", text: "打了 09012345678 没人接" }, { source: "ticket_note", source_id: TICKET_ID, text: "内部：客人是王小明" }] };

async function openOrder(order: PlatformOrder, role = "operations", extra: (call: any) => Response | null = () => null) {
  const calls = openApp(`/platform/orders/${ORDER_ID}`, "platform", role, (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, detailOf(order));
    if (call.method === "POST" && call.url.pathname === REVEAL) return json(200, FULL);
    return extra(call);
  });
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  return calls;
}

test("订单详情：点「查看联系方式」才显示即时通讯账号、备注原文和手写内容的原文，标明每条来自哪里", async () => {
  const user = userEvent.setup();
  const calls = await openOrder(orderOf({ notes: "王**要儿童座椅 ****5678", notes_masked: true }));
  assert.equal(screen.queryByText(/wang-88/), null);
  assert.equal(screen.queryByText(/打了 09012345678/), null);
  assert.ok(screen.getByText("王**要儿童座椅 ****5678"), "打码后的备注");
  await user.click(screen.getByRole("button", { name: "查看联系方式" }));
  await screen.findByText(/王小明 · \+819012345678 · guest@example.com/);
  assert.ok(screen.getByText("即时通讯：line wang-88"));
  assert.ok(screen.getByText("备注原文：王小明要儿童座椅 09012345678"));
  assert.ok(screen.getByText("司机的联系记录"));
  assert.ok(screen.getByText("打了 09012345678 没人接"));
  assert.ok(screen.getByText("工单内部备注"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("脱敏后的订单：显示已清除，没有「查看」按钮，不调接口", async () => {
  const anonymized = { name: "[已脱敏]", phone: "[已脱敏]", email: "[已脱敏]" };
  const calls = await openOrder(orderOf({ passenger: anonymized, passenger_anonymized_at: "2026-10-01T00:00:00.000Z" }));
  assert.ok(screen.getByText(/已按隐私规则清除，无法恢复/));
  assert.equal(screen.queryByRole("button", { name: "查看联系方式" }), null);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("改单框：备注被打了码时不拿打码后的内容当初始值；留空不发备注，不会把打码内容存回去；填写才整条替换", async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  await openOrder(orderOf({ notes: "王**要儿童座椅 ****5678", notes_masked: true }), "operations", (call) => {
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) {
      bodies.push(call.body);
      return json(200, { change: { id: "c9", status: "applied" } });
    }
    return null;
  });
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  const notes = (await screen.findByLabelText(/^备注/)) as HTMLInputElement;
  assert.equal(notes.value, "");
  assert.ok(screen.getByText(/留空不改，填写则整条替换/));
  await user.clear(screen.getByLabelText("航班号"));
  await user.type(screen.getByLabelText("航班号"), "JL001");
  await user.type(notes, "新的备注");
  const submit = screen.getAllByRole("button").filter((button) => /提交|确认|保存/.test(button.textContent ?? "")).at(-1) as HTMLElement;
  await user.click(submit);
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { flight_no: "JL001", notes: "新的备注" });
});

const TICKET_REVEAL = `/platform/v1/tickets/${TICKET_ID}/texts/reveal`;

test("工单详情：有打码内容才有「查看原文」，点了只调工单的接口、只显示工单文字；记审计的提示写明", async () => {
  const user = userEvent.setup();
  const calls = openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}`) return json(200, platformTicketDetailOf(undefined, { texts_masked: true }));
    if (call.method === "POST" && call.url.pathname === TICKET_REVEAL) return json(200, { texts: [{ source: "ticket_note", source_id: TICKET_ID, text: "内部：客人是王小明" }] });
    return null;
  });
  const button = await screen.findByRole("button", { name: "查看原文" });
  assert.ok(screen.getByText(/查看会记进审计日志/));
  assert.equal(screen.queryByText("内部：客人是王小明"), null);
  await user.click(button);
  await screen.findByText("内部：客人是王小明");
  const posts = calls.filter((call) => call.method === "POST");
  assert.deepEqual(posts.map((call) => call.path), [TICKET_REVEAL], "不走订单的 reveal：不多传联系方式");
});

test("工单详情：没有打码内容时不显示「查看原文」，也不调接口", async () => {
  const calls = openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}` ? json(200, platformTicketDetailOf(undefined, { texts_masked: false })) : null));
  await screen.findByRole("heading", { name: platformTicketDetailOf().ticket.subject });
  assert.equal(screen.queryByRole("button", { name: "查看原文" }), null);
  assert.equal(screen.queryByText(/查看会记进审计日志/), null);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("工单详情：有打码内容但没有看订单的权限，不显示「查看原文」", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "custom_no_orders", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/tickets/${TICKET_ID}` ? json(200, platformTicketDetailOf(undefined, { texts_masked: true })) : null), ["ticket.read"]);
  await screen.findByRole("heading", { name: platformTicketDetailOf().ticket.subject });
  assert.equal(screen.queryByRole("button", { name: "查看原文" }), null);
});

test("审计页认得看工单文字这个操作", () => {
  assert.equal(ACTION_NAMES["view_ticket_text"], "查看工单文字原文");
});

test("官网查订单的提示不说订单存不存在（ADR 0061），链接失效时说清楚 180 天的规则；审计页认得脱敏这个操作", () => {
  assert.match(LOOKUP_SENT_TEXT, /^如信息匹配/);
  assert.match(EXPIRED_LINK_HINT, /超过 180 天.*隐私规则清除.*联系客服/);
  assert.equal(ACTION_NAMES["anonymize_passenger"], "乘客信息自动脱敏");
});

test("改单框：改过姓名、备注写的是旧姓名（notes_masked 为真）时只改航班号，不发备注，打码内容不会写回", async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  await openOrder(orderOf({ notes: "王**要儿童座椅", notes_masked: true, passenger: { name: "李**", phone: "+********0000", email: "ne***@example.com" } }), "operations", (call) => {
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) {
      bodies.push(call.body);
      return json(200, { change: { id: "c9", status: "applied" } });
    }
    return null;
  });
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  assert.equal(((await screen.findByLabelText(/^备注/)) as HTMLInputElement).value, "");
  await user.clear(screen.getByLabelText("航班号"));
  await user.type(screen.getByLabelText("航班号"), "JL002");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { flight_no: "JL002" });
});
