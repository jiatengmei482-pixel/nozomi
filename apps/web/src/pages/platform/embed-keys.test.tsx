/**
 * 运营后台「嵌入组件」（M9E-02，ADR 0090）的组件测试：列表显示嵌入码、白名单和要放的代码（可复制）；
 * 运营能新建（一行一个网站）、修改、停用；只读角色只能看；服务端的校验问题落到对应的栏。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { embedSnippets } from "@nozomi/domain";
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
  allow_host_page: false,
  booking_url: null,
  status: "active",
  note: null,
  version: 1,
  created_at: "2030-11-20T01:00:00.000Z",
  updated_at: "2030-11-20T01:00:00.000Z",
  snippet: `<div id="nozomi-booking"></div>\n<script src="https://nozomi.example/embed/widget-v1.js" defer></script>\n<script>NozomiBooking.init({ key: "${KEY}", root: "#nozomi-booking", lang: "ja", services: ["transfer","charter"] });</script>`,
  booking_snippet: null,
  snippet_fallback: "no_booking_url",
  ...changes,
});
const OPS = ["embed.read", "embed.manage"];

const DEMO = "https://embed-demo.moveglobal.io";
const DEMO_BOOKING = `${DEMO}/booking/`;
/** 和服务端一样按 packages/domain 生成代码（M9E-26），替身应答里的两段代码、原因和真接口一致 */
const withSnippets = (changes: Partial<EmbedKey> = {}): EmbedKey => {
  const key = keyOf(changes);
  const snippets = embedSnippets("https://nozomi.example", { key: key.key, lang: key.default_lang, services: key.default_services, allowedOrigins: key.allowed_origins, allowHostPage: key.allow_host_page, bookingUrl: key.booking_url });
  return { ...key, snippet: snippets.entry, booking_snippet: snippets.booking, snippet_fallback: snippets.fallback };
};

test("列表：嵌入码、允许的网站、默认值和要放的代码；能复制；只读角色没有新建、修改、停用", async () => {
  openApp("/platform/embed-keys", "platform", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys" ? json(200, { items: [keyOf()] }) : null), ["embed.read"]);
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.ok(within(card).getByText(KEY));
  assert.ok(within(card).getByText("https://embed-demo.moveglobal.io"));
  assert.ok(within(card).getByText("区间、包车"));
  assert.ok(within(card).getByText("自动"), "外观");
  assert.match(within(card).getByLabelText("MoveGlobal 演示站的① 入口小程序代码").textContent ?? "", /widget-v1\.js/);
  assert.ok(within(card).getByRole("button", { name: "复制MoveGlobal 演示站的① 入口小程序代码" }));
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
  assert.deepEqual(posted, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "auto", allow_host_page: false, booking_url: null, note: null });
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
  assert.doesNotMatch(within(card).getByLabelText("MoveGlobal 演示站的① 入口小程序代码").textContent ?? "", /layout/);
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
  assert.deepEqual(calls.find((call) => call.method === "PATCH")?.body, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "bar", allow_host_page: false, booking_url: null, note: null, status: "active" });
});

test("整页嵌入（M9E-16，Q13）：默认不允许；修改时打开，带版本号随其余字段一起提交；详情显示；停用时原样带上不关掉", async () => {
  let current = keyOf();
  const calls = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: [current] });
    if (call.method === "PATCH") {
      const body = call.body as { allow_host_page: boolean; status: "active" | "disabled" };
      current = keyOf({ allow_host_page: body.allow_host_page, status: body.status, version: current.version + 1 });
      return json(200, current);
    }
    return null;
  }, OPS);
  const actor = userEvent.setup();
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.ok(within(card).getByText("不允许（客人跳到主站预订）"), "默认关");
  await actor.click(within(card).getByRole("button", { name: "修改" }));
  const group = within(card).getByRole("group", { name: /^整页嵌入/ });
  assert.equal((within(group).getByRole("radio", { name: "不允许（客人跳到主站预订）" }) as HTMLInputElement).checked, true);
  await actor.click(within(group).getByRole("radio", { name: "允许（预订流程嵌在合作网站页面里）" }));
  await actor.click(within(card).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.ok(within(screen.getByRole("region", { name: /MoveGlobal 演示站/ })).getByText("允许（预订流程嵌在合作网站页面里）")));
  const saved = calls.find((call) => call.method === "PATCH");
  assert.equal(saved?.headers?.["if-match"], '"1"');
  assert.deepEqual(saved?.body, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "auto", allow_host_page: true, booking_url: null, note: null, status: "active" });

  await actor.click(within(screen.getByRole("region", { name: /MoveGlobal 演示站/ })).getByRole("button", { name: "停用" }));
  await actor.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "停用" }));
  await waitFor(() => assert.ok(screen.getByText("已停用")));
  const disabled = calls.filter((call) => call.method === "PATCH").at(-1);
  assert.equal(disabled?.headers?.["if-match"], '"2"');
  assert.equal((disabled?.body as { allow_host_page: boolean }).allow_host_page, true, "停用不顺手关掉整页嵌入");
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
  assert.deepEqual(patch?.body, { name: "MoveGlobal 演示站", allowed_origins: ["https://embed-demo.moveglobal.io"], default_lang: "ja", default_services: ["transfer", "charter"], layout: "auto", allow_host_page: false, booking_url: null, note: null, status: "disabled" });
});

test("没有 embed.read 的角色看到无权限说明，不请求列表", async () => {
  const calls = openApp("/platform/embed-keys", "platform", "finance", () => null, ["order.read"]);
  await waitFor(() => assert.ok(screen.getByText(/没有权限|无权/)));
  assert.equal(calls.filter((call) => call.path.startsWith("/platform/v1/embed-keys")).length, 0);
});

test("两段代码（M9E-26）：填了预订页地址并允许整页嵌入时，①入口小程序带 bookingUrl、②预订程序 mountBooking，各有一句说明和复制按钮；复制的就是这一段，复制后有「已复制」", async () => {
  openApp("/platform/embed-keys", "platform", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys" ? json(200, { items: [withSnippets({ allow_host_page: true, booking_url: DEMO_BOOKING })] }) : null), ["embed.read"]);
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.ok(within(card).getByText(DEMO_BOOKING), "详情显示预订页地址");
  const entry = within(card).getByRole("region", { name: "① 入口小程序" });
  const booking = within(card).getByRole("region", { name: "② 预订程序" });
  assert.ok(within(entry).getByText("放在任何页面（首页、文章页等），客人填好行程后会跳到你的预订页。"));
  assert.ok(within(booking).getByText("只放在预订页，接收入口传来的行程，显示报价和下单流程。"));
  const entryCode = within(entry).getByLabelText("MoveGlobal 演示站的① 入口小程序代码").textContent ?? "";
  const bookingCode = within(booking).getByLabelText("MoveGlobal 演示站的② 预订程序代码").textContent ?? "";
  assert.match(entryCode, /NozomiBooking\.init\(\{ key: "nze_A{32}", root: "#nozomi-booking", lang: "ja", services: \["transfer","charter"\], bookingUrl: "https:\/\/embed-demo\.moveglobal\.io\/booking\/" \}\);/);
  assert.match(bookingCode, /NozomiBooking\.mountBooking\(\{ key: "nze_A{32}", root: "#nozomi-booking-flow", lang: "ja" \}\);/);
  assert.doesNotMatch(bookingCode, /NozomiBooking\.init/);
  assertAbsent(within(card).queryByText(/这里会出现第二段代码/));
  assert.match(within(card).getByText(/复制后交给合作网站/).textContent ?? "", /frame-src/, "有第二段时 CSP 提示加 frame-src");

  // user-event 的 setup 会换上自己的剪贴板替身，所以先 setup 再换成记录用的
  const actor = userEvent.setup();
  const clipboard = navigator.clipboard;
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) } });
  try {
    const copyEntry = within(entry).getByRole("button", { name: "复制MoveGlobal 演示站的① 入口小程序代码" });
    const copyBooking = within(booking).getByRole("button", { name: "复制MoveGlobal 演示站的② 预订程序代码" });
    assert.equal(copyEntry.getAttribute("type"), "button");
    // 键盘：焦点在第一个复制按钮上按 Enter 复制，Tab 往后能走到第二个
    copyEntry.focus();
    await actor.keyboard("{Enter}");
    await screen.findByText("已复制");
    for (let step = 0; step < 10 && document.activeElement !== copyBooking; step += 1) await actor.tab();
    assert.equal(document.activeElement, copyBooking, "Tab 能走到第二个复制按钮");
    await actor.keyboard("{Enter}");
    await waitFor(() => assert.equal(copied.length, 2));
    assert.deepEqual(copied, [entryCode, bookingCode], "各复制各自那一段");
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
  }
});

test("兜底（M9E-26）：没填预订页地址、没开整页嵌入时只有①，①不带 bookingUrl、说明写跳主站，旁边写明为什么没有第二段", async () => {
  const cases: [Partial<EmbedKey>, string][] = [
    [{}, "填写预订页地址并开启「允许整页嵌入」后，这里会出现第二段代码（预订程序）。"],
    [{ allow_host_page: true }, "填写预订页地址后，这里会出现第二段代码（预订程序）。"],
    [{ booking_url: DEMO_BOOKING }, "开启「允许整页嵌入」后，这里会出现第二段代码（预订程序）。"],
    [{ allow_host_page: true, booking_url: "https://other.example/booking/" }, "预订页地址的网站不在「允许的网站」里，改好预订页地址后，这里会出现第二段代码（预订程序）。"],
  ];
  for (const [changes, reason] of cases) {
    const key = withSnippets(changes);
    openApp("/platform/embed-keys", "platform", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys" ? json(200, { items: [key] }) : null), ["embed.read"]);
    const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
    const label = JSON.stringify(changes);
    assert.ok(within(card).getByText(reason), label);
    assertAbsent(within(card).queryByRole("region", { name: "② 预订程序" }));
    assertAbsent(within(card).queryByText(/mountBooking/));
    const entry = within(card).getByRole("region", { name: "① 入口小程序" });
    assert.ok(within(entry).getByText("放在任何页面（首页、文章页等），客人填好行程后跳到 NOZOMI 主站完成预订。"), label);
    assert.doesNotMatch(within(entry).getByLabelText("MoveGlobal 演示站的① 入口小程序代码").textContent ?? "", /bookingUrl/, label);
    assert.ok(within(entry).getByRole("button", { name: "复制MoveGlobal 演示站的① 入口小程序代码" }));
    assert.ok(within(card).getByText(changes.booking_url ?? "未填写"), label);
    resetBrowser();
  }
});

test("白名单有几个网站时，①下面提醒要放在和预订页同一个网站的页面上", async () => {
  openApp("/platform/embed-keys", "platform", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys" ? json(200, { items: [withSnippets({ allowed_origins: [DEMO, "https://www.moveglobal.io"], allow_host_page: true, booking_url: DEMO_BOOKING })] }) : null), ["embed.read"]);
  const entry = await screen.findByRole("region", { name: "① 入口小程序" });
  assert.ok(within(entry).getByText(`要放在和预订页同一个网站（${DEMO}）的页面上；放在别的网站上时，客人会跳到 NOZOMI 主站。`));
});

test("表单的预订页地址（M9E-26）：有标签和说明；新建时填写随其余字段提交；修改时带出原值、清空提交 null；服务端说不在白名单就标在这一栏", async () => {
  let current: EmbedKey | null = null;
  const calls: ApiCall[] = openApp("/platform/embed-keys", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/embed-keys") return json(200, { items: current === null ? [] : [current] });
    if (call.method !== "POST" && call.method !== "PATCH") return null;
    const body = call.body as { booking_url: string | null; allow_host_page: boolean };
    if (body.booking_url !== null && !body.booking_url.startsWith(`${DEMO}/`)) {
      return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/booking_url", reason: "NOT_ALLOWED_ORIGIN", message: "x" }] });
    }
    current = withSnippets({ allow_host_page: body.allow_host_page, booking_url: body.booking_url, version: (current?.version ?? 0) + 1 });
    return json(call.method === "POST" ? 201 : 200, current);
  }, OPS);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "新建嵌入码" }));
  const field = screen.getByLabelText("预订页地址（选填）") as HTMLInputElement;
  assert.equal(field.type, "url");
  assert.match(field.getAttribute("aria-describedby") === null ? "" : (document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent ?? ""), /https:\/\/embed-demo\.moveglobal\.io\/booking\//, "说明里有示例地址");
  await actor.type(screen.getByLabelText(/^名称/), "MoveGlobal 演示站");
  await actor.type(screen.getByLabelText(/^允许的网站/), DEMO);
  await actor.click(screen.getByRole("radio", { name: "允许（预订流程嵌在合作网站页面里）" }));
  await actor.type(field, "https://other.example/booking/");
  await actor.click(screen.getByRole("button", { name: "生成嵌入码" }));
  const error = await screen.findByText(/这个地址的网站不在「允许的网站」里/);
  assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.ok((field.getAttribute("aria-describedby") ?? "").split(" ").some((id) => document.getElementById(id)?.contains(error)), "出错文字关联到输入框");
  await actor.clear(field);
  await actor.type(field, `  ${DEMO_BOOKING}  `);
  await actor.click(screen.getByRole("button", { name: "生成嵌入码" }));
  const card = await screen.findByRole("region", { name: /MoveGlobal 演示站/ });
  assert.equal((calls.filter((call) => call.method === "POST").at(-1)?.body as { booking_url: string }).booking_url, DEMO_BOOKING, "去掉首尾空格后提交");
  assert.ok(await within(card).findByRole("region", { name: "② 预订程序" }), "保存后马上看到两段代码");

  await actor.click(within(screen.getByRole("region", { name: /MoveGlobal 演示站/ })).getByRole("button", { name: "修改" }));
  const editing = within(screen.getByRole("region", { name: /MoveGlobal 演示站/ })).getByLabelText("预订页地址（选填）") as HTMLInputElement;
  assert.equal(editing.value, DEMO_BOOKING, "带出原值");
  await actor.clear(editing);
  await actor.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByText("填写预订页地址后，这里会出现第二段代码（预订程序）。");
  const patch = calls.filter((call) => call.method === "PATCH").at(-1);
  assert.equal(patch?.headers?.["if-match"], '"1"');
  assert.equal((patch?.body as { booking_url: string | null }).booking_url, null, "清空提交 null");
});
