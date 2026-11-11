/**
 * M4-30 测试角色：官网「查订单」改成把链接发到下单邮箱（ADR 0061）。接口用测试替身。
 * - 提交以后不管后端怎么说（只要是 202），页面都是同一句「如信息匹配，链接已发送到下单邮箱」，在 role=status 里；不跳转、不去取订单；
 * - 只填手机号：提示联系客服，不发请求；邮箱格式不对不发请求；
 * - 客服电话没登记：「收不到邮件？」照常显示、没有拨号按钮；登记了：tel: 链接只留数字和 +；
 * - 限速、邮件没配置（503）、官网没开（503）各自的说法，都不说订单存不存在；
 * - 链接失效、付款回跳取不回令牌时的说法改成「发到邮箱」。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig } from "../../api/site.ts";
import { type ApiCall, apiError, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

const SENT = /^如信息匹配，链接已发送到下单邮箱/;
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: false, page_width: "standard", map_tiles: null, ...changes });
const user = () => userEvent.setup();

function open(entry: string | { pathname: string; hash?: string; search?: string }, route: Route): ApiCall[] {
  const calls = stubApiWith(route);
  render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

function lookupRoute(answer: () => Response, config: SiteConfig = configOf()): Route {
  return (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, config);
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders/lookup") return answer();
    return null;
  };
}

async function submit(orderNo: string, email: string): Promise<void> {
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  if (orderNo !== "") await actor.type(screen.getByLabelText("订单号"), orderNo);
  if (email !== "") await actor.type(screen.getByLabelText("下单时的邮箱"), email);
  await actor.click(screen.getByRole("button", { name: "发送订单链接" }));
}

test("提交后统一提示在 role=status 里；不跳转、不取订单、不显示订单号对不对；同一个表单再提交一次照样是这一句", async () => {
  const calls = open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" })));
  await submit("NZ20261026QAQA2345", "qa@example.com");
  const status = await screen.findByRole("status");
  assert.match((await within(status).findByText(SENT)).textContent ?? "", SENT);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "查订单", "不跳转到订单页");
  assert.deepEqual(calls.filter((call) => call.path.startsWith("/site/v1/order") && !call.path.startsWith("/site/v1/orders/lookup")), [], "不去取订单");
  assert.equal(document.body.textContent?.includes("没有找到"), false);
  await user().click(screen.getByRole("button", { name: "发送订单链接" }));
  assert.ok(await screen.findByText(SENT));
  assert.equal(calls.filter((call) => call.method === "POST").length, 2);
});

test("只填手机号：提示只留了手机号的请联系客服，不发请求；邮箱格式不对、订单号格式不对也不发请求", async () => {
  const calls = open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" })));
  await submit("NZ20261026QAQA2345", "+81 90-8765-4321");
  assert.ok(await screen.findByText(/只留了手机号的，请联系客服/));
  const emailInput = screen.getByLabelText("下单时的邮箱");
  assert.equal(emailInput.getAttribute("aria-invalid"), "true", "错误挂在邮箱输入框上");
  const actor = user();
  await actor.clear(emailInput);
  await actor.type(emailInput, "qa@example");
  await actor.click(screen.getByRole("button", { name: "发送订单链接" }));
  assert.ok(await screen.findByText("请填写下单时的邮箱"));
  await actor.clear(screen.getByLabelText("订单号"));
  await actor.type(screen.getByLabelText("订单号"), "NZ123");
  await actor.clear(emailInput);
  await actor.type(emailInput, "qa@example.com");
  await actor.click(screen.getByRole("button", { name: "发送订单链接" }));
  assert.ok(await screen.findByText(/订单号是 NZ 开头的 18 位/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "格式不对的都不发请求");
});

test("邮箱输入框：type=email、autocomplete=email、不自动大写；页面说明「会把订单链接发到这个邮箱」", async () => {
  open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" })));
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  const input = screen.getByLabelText("下单时的邮箱");
  assert.deepEqual([input.getAttribute("type"), input.getAttribute("autocomplete"), input.getAttribute("autocapitalize")], ["email", "email", "none"]);
  assert.ok(screen.getByText(/我们会把订单链接发到这个邮箱/));
  assert.equal(screen.queryByLabelText(/手机号/), null, "没有手机号的输入框");
});

test("客服电话没登记：「收不到邮件？」照常显示、没有拨号链接；登记了：拨号链接只留 + 和数字", async () => {
  open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" })));
  const help = (await screen.findByRole("heading", { level: 2, name: "收不到邮件？" })).closest("section") as HTMLElement;
  assert.match(help.textContent ?? "", /只留了手机号、邮箱填错了/);
  assert.equal(help.querySelector("a[href^='tel:']"), null);
  resetBrowser();
  open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" }), configOf({ support_phone: " +81 3-1234-5678 " })));
  const withPhone = (await screen.findByRole("heading", { level: 2, name: "收不到邮件？" })).closest("section") as HTMLElement;
  const link = within(withPhone).getByRole("link", { name: /打电话给客服/ });
  assert.equal(link.getAttribute("href"), "tel:+81312345678");
  resetBrowser();
  open({ pathname: "/book/order" }, lookupRoute(() => json(202, { status: "accepted" }), configOf({ support_phone: "   " })));
  const blank = (await screen.findByRole("heading", { level: 2, name: "收不到邮件？" })).closest("section") as HTMLElement;
  assert.equal(blank.querySelector("a[href^='tel:']"), null, "只有空白的客服电话当没登记");
});

test("邮件没配置（503 ORDER_LINK_EMAIL_UNAVAILABLE）：请客人联系客服，不说订单存不存在；官网没开（503 SITE_NOT_OPEN）另有说法", async () => {
  open({ pathname: "/book/order" }, lookupRoute(() => apiError(503, "ORDER_LINK_EMAIL_UNAVAILABLE", "暂时发不了邮件，请联系客服找回订单")));
  await submit("NZ20261026QAQA2345", "qa@example.com");
  const alert = await screen.findByRole("alert");
  assert.equal(await within(alert).findByText("暂时发不了邮件，请联系客服找回订单。").then(() => true), true);
  assert.equal(screen.queryByText(SENT), null, "发不了邮件时不说「已发送」");
  assert.equal(/不存在|没有找到|对不上/.test(document.body.textContent ?? ""), false);
  resetBrowser();
  open({ pathname: "/book/order" }, lookupRoute(() => apiError(503, "SITE_NOT_OPEN", "官网暂未开放")));
  await submit("NZ20261026QAQA2345", "qa@example.com");
  assert.ok(await screen.findByText("官网暂未开放预订，请稍后再来。"));
});

test("限速：秒、分钟、小时三种等待时长的说法，都提到联系客服；不说是哪一层额度", async () => {
  for (const [seconds, text] of [[45, "尝试次数过多，请 45 秒后再试，或联系客服。"], [900, "尝试次数过多，请 15 分钟后再试，或联系客服。"], [86_000, "尝试次数过多，请 24 小时后再试，或联系客服。"]] as const) {
    open({ pathname: "/book/order" }, lookupRoute(() => apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { retry_after_seconds: seconds }, { "retry-after": String(seconds) })));
    await submit("NZ20261026QAQA2345", "qa@example.com");
    assert.ok(await screen.findByText(text));
    assert.equal(screen.queryByText(SENT), null);
    resetBrowser();
  }
});

test("链接失效：提示「填订单号和下单邮箱，我们会把新的订单链接发到您的邮箱」，不再提手机号", async () => {
  open({ pathname: "/book/order", hash: `#nzo_${"Z".repeat(43)}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, configOf());
    if (call.url.pathname === "/site/v1/order") return apiError(401, "ORDER_LINK_INVALID", "订单链接无效或已过期");
    return null;
  });
  assert.ok(await screen.findByText("订单链接无效或已过期。请填订单号和下单邮箱，我们会把新的订单链接发到您的邮箱。"));
  assert.equal(/邮箱或手机号/.test(document.body.textContent ?? ""), false, "旧说法「邮箱或手机号」不再出现");
});
