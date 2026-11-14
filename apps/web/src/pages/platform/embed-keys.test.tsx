/**
 * 运营后台「嵌入组件」（M9E-02，ADR 0090）的组件测试：列表显示嵌入码、白名单和要放的代码（可复制）；
 * 运营能新建（一行一个网站）、修改、停用；只读角色只能看；服务端的校验问题落到对应的栏。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { EmbedKey } from "../../api/embed.ts";
import { openApp } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const KEY = `nze_${"A".repeat(32)}`;
const keyOf = (changes: Partial<EmbedKey> = {}): EmbedKey => ({
  id: "66666666-6666-4666-8666-666666666666",
  key: KEY,
  name: "MoveGlobal 演示站",
  allowed_origins: ["https://embed-demo.moveglobal.io"],
  default_lang: "ja",
  default_services: ["transfer", "charter"],
  layout: "auto",
  status: "active",
  note: null,
  version: 1,
  created_at: "2030-11-20T01:00:00.000Z",
  updated_at: "2030-11-20T01:00:00.000Z",
  snippet: `<div id="nozomi-booking"></div>\n<script src="https://nozomi.example/embed/widget-v1.js" defer></script>\n<script>NozomiBooking.init({ key: "${KEY}", root: "#nozomi-booking", lang: "ja", services: ["transfer","charter"] });</script>`,
  ...changes,
});
const OPS = ["embed.read", "embed.manage"];

test("列表：嵌入码、允许的网站、默认值和要放的代码；能复制；只读角色没有新建、修改、停用", async () => {
  openApp("/platform/embed-keys", "platform", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys" ? json(200, { items: [keyOf()] }) : null), ["embed.read"]);
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.ok(within(card).getByText(KEY));
  assert.ok(within(card).getByText("https://embed-demo.moveglobal.io"));
  assert.ok(within(card).getByText("区间、包车"));
  assert.ok(within(card).getByText("自动"), "外观");
  assert.match(within(card).getByLabelText("MoveGlobal 演示站的嵌入代码").textContent ?? "", /widget-v1\.js/);
  assert.ok(within(card).getByRole("button", { name: "复制MoveGlobal 演示站的嵌入代码" }));
  assertAbsent(screen.queryByRole("button", { name: "新建嵌入码" }));
  assertAbsent(within(card).queryByRole("button", { name: "停用" }));
});

test("新建：一行一个网站，按区间、包车的顺序提交；服务端说哪一行写法不对就标在「允许的网站」", async () => {
  let created = false;
  const calls: ApiCall[] = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: created ? [keyOf()] : [] });
    if (call.method === "POST" && call.url.pathname === "/platform/v1/embed-keys") {
      const body = call.body as { allowed_origins: string[] };
      if (body.allowed_origins.includes("https://*.bad.example")) return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/allowed_origins/1", reason: "INVALID", message: "x" }] });
      created = true;
      return json(201, keyOf());
    }
    return null;
  }, OPS);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "新建嵌入码" }));
  await actor.type(screen.getByLabelText(/^名称/), "MoveGlobal 演示站");
  await actor.type(screen.getByLabelText(/^允许的网站/), "https://embed-demo.moveglobal.io\nhttps://*.bad.example");
  await actor.click(screen.getByRole("button", { name: "生成嵌入码" }));
  assert.ok(await screen.findByText("第 2 行写法不对：要以 https 开头、只写到域名，可带端口，不带路径"));
  const input = screen.getByLabelText(/^允许的网站/) as HTMLTextAreaElement;
  await actor.clear(input);
  await actor.type(input, "  https://embed-demo.moveglobal.io  \n\n");
  await actor.click(screen.getByRole("button", { name: "生成嵌入码" }));
  await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  const posted = calls.filter((call) => call.method === "POST").at(-1)?.body;
  assert.deepEqual(posted, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "auto", note: null });
});

test("外观：新建时默认自动、可选卡片 / 横条并提交；详情显示外观，要放的代码里不写 layout", async () => {
  let created: EmbedKey | null = null;
  const calls: ApiCall[] = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: created === null ? [] : [created] });
    if (call.method === "POST" && call.url.pathname === "/platform/v1/embed-keys") {
      created = keyOf({ layout: "bar" });
      return json(201, created);
    }
    return null;
  }, OPS);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "新建嵌入码" }));
  const layout = screen.getByRole("group", { name: /^外观/ });
  assert.deepEqual(within(layout).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value), ["auto", "card", "bar"]);
  assert.equal((within(layout).getByRole("radio", { name: "自动" }) as HTMLInputElement).checked, true, "默认自动");
  await actor.click(within(layout).getByRole("radio", { name: "横条" }));
  await actor.type(screen.getByLabelText(/^名称/), "MoveGlobal 演示站");
  await actor.type(screen.getByLabelText(/^允许的网站/), "https://embed-demo.moveglobal.io");
  await actor.click(screen.getByRole("button", { name: "生成嵌入码" }));
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.equal((calls.find((call) => call.method === "POST")?.body as { layout?: string }).layout, "bar");
  assert.ok(within(card).getByText("横条"));
  assert.doesNotMatch(within(card).getByLabelText("MoveGlobal 演示站的嵌入代码").textContent ?? "", /layout/);
});

test("修改外观：表单带出现在的外观，改成横条后随其余字段一起提交", async () => {
  let current = keyOf();
  const calls = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: [current] });
    if (call.method === "PATCH") {
      current = keyOf({ layout: "bar", version: 2 });
      return json(200, current);
    }
    return null;
  }, OPS);
  const actor = userEvent.setup();
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  await actor.click(within(card).getByRole("button", { name: "修改" }));
  const layout = within(card).getByRole("group", { name: /^外观/ });
  assert.equal((within(layout).getByRole("radio", { name: "自动" }) as HTMLInputElement).checked, true);
  await actor.click(within(layout).getByRole("radio", { name: "横条" }));
  await actor.click(within(card).getByRole("button", { name: "保存" }));
  await waitFor(() => assertAbsent(screen.queryByRole("radio", { name: "横条" })));
  assert.ok(within(screen.getByRole("region", { name: /MoveGlobal 演示站/ })).getByText("横条"), "保存后详情显示横条");
  assert.deepEqual(calls.find((call) => call.method === "PATCH")?.body, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "bar", note: null, status: "active" });
});

test("停用：先确认；带版本号，状态改成停用，其余原样", async () => {
  let current = keyOf();
  const calls = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: [current] });
    if (call.method === "PATCH") {
      current = keyOf({ status: "disabled", version: 2 });
      return json(200, current);
    }
    return null;
  }, OPS);
  const actor = userEvent.setup();
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  await actor.click(within(card).getByRole("button", { name: "停用" }));
  const dialog = await screen.findByRole("dialog", { name: "停用「MoveGlobal 演示站」？" });
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0, "点「停用」先确认，不直接改");
  await actor.click(within(dialog).getByRole("button", { name: "停用" }));
  await waitFor(() => assert.ok(screen.getByText("已停用")));
  const patch = calls.find((call) => call.method === "PATCH");
  assert.equal(patch?.headers?.["if-match"], '"1"');
  assert.deepEqual(patch?.body, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "auto", note: null, status: "disabled" });
});

test("没有 embed.read 的角色看到无权限说明，不请求列表", async () => {
  const calls = openApp("/platform/embed-keys", "platform", "finance", () => null, ["order.read"]);
  await waitFor(() => assert.ok(screen.getByText(/没有权限|无权/)));
  assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/embed-keys")).length, 0);
});
