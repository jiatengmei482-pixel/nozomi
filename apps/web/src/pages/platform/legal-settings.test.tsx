/**
 * 运营后台「官网设置 → 法律文案的待补项」（M9E-24，ADR 0107）的组件测试：缺项提示、正式环境 / 测试站的说明、
 * 保存时 10 项全给（空的为 null）、第一次不带 If-Match 之后带版本号、400 的字段错误落在对应的框下面、版本冲突时刷新；
 * 运营只读不能编辑；三个页面的预览链接。接口用测试替身；真实后端由 e2e/legal-pages.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { LEGAL_FIELD_KEYS } from "@nozomi/domain";
import type { LegalFieldValues, LegalSettings } from "../../api/legal.ts";
import type { SiteSettings } from "../../api/manual-quotes.ts";
import { COLLEAGUE, ME, openApp } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();

const EMPTY = Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, null])) as LegalFieldValues;
const siteSettings: SiteSettings = { support_whatsapp: null, page_width: "standard", maps_browser_key: null, version: 0, updated_at: null, updated_by: null };

function legalOf(fields: Partial<LegalFieldValues>, changes: Partial<LegalSettings> = {}): LegalSettings {
  const all = { ...EMPTY, ...fields };
  const missing = LEGAL_FIELD_KEYS.filter((key) => all[key] === null);
  return { fields: all, missing, complete: missing.length === 0, required_for_launch: false, version: 0, updated_at: null, updated_by: null, ...changes };
}

function openLegal(role: string, legal: LegalSettings, put: (call: ApiCall) => Response = () => json(200, legal)): ApiCall[] {
  return openApp("/platform/settings/site", "platform", role, (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/site-settings") return json(200, siteSettings);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/legal-settings") return json(200, legal);
    if (call.method === "PUT" && call.url.pathname === "/platform/v1/legal-settings") return put(call);
    return null;
  });
}

const card = async () => within(await screen.findByRole("region", { name: "法律文案的待补项" }));
const puts = (calls: ApiCall[]) => calls.filter((call) => call.method === "PUT" && call.path === "/platform/v1/legal-settings");

test("测试站、都没填：写还缺 10 项和各项名称，说明页面显示「未設定」；没有正式环境的错误提示；三个页面的预览链接新标签页打开", async () => {
  openLegal("super_admin", legalOf({}));
  const legal = await card();
  assert.ok(await legal.findByText(/^还缺 10 项：販売事業者（销售主体）、日本国内の連絡先、メールアドレス（联系邮箱）、/));
  assert.ok(legal.getByText("测试站：没填的地方页面显示「未設定」，官网照常开放。"));
  assertAbsent(legal.queryByText(/正式环境/));
  assert.ok(legal.getByText("还没有设置过"));
  assert.deepEqual(
    legal.getAllByRole("link").map((link) => [link.getAttribute("href"), link.getAttribute("target")]),
    [
      ["/legal/tokushoho", "_blank"],
      ["/legal/cancellation", "_blank"],
      ["/legal/privacy", "_blank"],
    ],
  );
  assert.ok(legal.getByText(/特定商取引法表記「販売事業者」、プライバシーポリシー开头/), "每一项写明用在哪里");
  assert.equal(legal.getByLabelText("日本国内の連絡先").tagName, "TEXTAREA");
  assert.equal(legal.getByLabelText("メールアドレス（联系邮箱）").getAttribute("type"), "email");
  assert.equal(legal.getByLabelText("公開日（制定日）").getAttribute("type"), "date");
});

test("正式环境：没填齐时用错误色写明官网不开放预订；填齐了只说明不影响", async () => {
  openLegal("super_admin", legalOf({ seller_name: "テスト販売" }, { required_for_launch: true }));
  const legal = await card();
  assert.ok(await legal.findByText(/^还缺 9 项：日本国内の連絡先、/));
  const alert = legal.getByText(/正式环境：没填齐前官网不开放预订/).closest(".alert");
  assert.ok(alert?.classList.contains("alert--danger"));
  assertAbsent(legal.queryByText(/测试站/));
  resetBrowser();
  const full = Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, key === "contact_email" ? "a@example.com" : key === "published_on" ? "2026-12-01" : "値"])) as LegalFieldValues;
  openLegal("super_admin", legalOf(full, { required_for_launch: true, version: 2 }));
  const done = await card();
  assert.ok(await done.findByText("10 项都已填写。"));
  assert.ok(done.getByText("正式环境：都已填齐，不影响官网开放预订。"));
  assertAbsent(done.queryByText(/不开放预订。/));
});

test("保存：10 项全给、空着的为 null；第一次不带 If-Match，之后带版本号；前端先查邮箱格式，不对不发请求", async () => {
  let version = 0;
  const calls = openLegal("super_admin", legalOf({}), (call) => {
    version += 1;
    const fields = (call.body as { fields: LegalFieldValues }).fields;
    return json(200, legalOf(fields, { version, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: ME, name: "测试员工" } }));
  });
  const actor = user();
  const legal = await card();
  await actor.type(await legal.findByLabelText("販売事業者（销售主体）"), "テスト販売株式会社");
  await actor.type(legal.getByLabelText("日本国内の連絡先"), "東京都{Enter}03-0000-0000");
  await actor.type(legal.getByLabelText("メールアドレス（联系邮箱）"), "not-an-email");
  fireEvent.change(legal.getByLabelText("公開日（制定日）"), { target: { value: "2026-12-01" } });
  await actor.click(legal.getByRole("button", { name: "保存" }));
  assert.ok(legal.getByText(/邮箱的格式不对/));
  assert.equal(puts(calls).length, 0, "格式不对不发请求");
  await actor.clear(legal.getByLabelText("メールアドレス（联系邮箱）"));
  await actor.type(legal.getByLabelText("メールアドレス（联系邮箱）"), "legal@example.com");
  await actor.click(legal.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(puts(calls).length, 1));
  const first = puts(calls)[0];
  assert.deepEqual(first?.body, { fields: { ...EMPTY, seller_name: "テスト販売株式会社", japan_contact: "東京都\n03-0000-0000", contact_email: "legal@example.com", published_on: "2026-12-01" } });
  assert.equal(first?.headers["if-match"], undefined, "第一次保存不带 If-Match");
  assert.ok(await screen.findByText("已保存，还缺 6 项"));
  const again = await card();
  assert.ok(await again.findByText(/^还缺 6 项：/));
  await actor.clear(again.getByLabelText("販売事業者（销售主体）"));
  await actor.click(again.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(puts(calls).length, 2));
  const second = puts(calls)[1];
  assert.equal(second?.headers["if-match"], '"1"');
  assert.equal((second?.body as { fields: LegalFieldValues }).fields.seller_name, null, "清空的当没填");
  assert.deepEqual(Object.keys((second?.body as { fields: LegalFieldValues }).fields), [...LEGAL_FIELD_KEYS], "10 个键全给");
});

test("后端 400：issues 的 /fields/<键> 落在对应的框下面（太长、邮箱、日期），填的内容还在；版本冲突时说明并刷新", async () => {
  const calls = openLegal("super_admin", legalOf({ seller_name: "テスト販売" }, { version: 4 }), () =>
    apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", {
      issues: [
        { path: "/fields/seller_name", reason: "TOO_LONG", message: "x" },
        { path: "/fields/published_on", reason: "DATE_INVALID", message: "x" },
      ],
    }),
  );
  const actor = user();
  const legal = await card();
  await actor.click(await legal.findByRole("button", { name: "保存" }));
  const seller = legal.getByLabelText("販売事業者（销售主体）");
  await waitFor(() => assert.equal(seller.getAttribute("aria-invalid"), "true"));
  assert.match(document.getElementById(seller.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /太长了：最多 200 个字/);
  const date = legal.getByLabelText("公開日（制定日）");
  assert.match(document.getElementById(date.getAttribute("aria-describedby")?.split(" ")[0] ?? "")?.textContent ?? "", /日期不对/);
  assert.equal(legal.getByLabelText("メールアドレス（联系邮箱）").getAttribute("aria-invalid"), null);
  assert.ok(legal.getByText(/有几项填得不对/));
  assert.equal((seller as HTMLInputElement).value, "テスト販売");
  assert.equal(puts(calls)[0]?.headers["if-match"], '"4"');
  resetBrowser();

  let reads = 0;
  openApp("/platform/settings/site", "platform", "super_admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/site-settings") return json(200, siteSettings);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/legal-settings") {
      reads += 1;
      return json(200, legalOf({ seller_name: reads === 1 ? "旧" : "新しい名前" }, { version: reads === 1 ? 4 : 5 }));
    }
    if (call.method === "PUT" && call.url.pathname === "/platform/v1/legal-settings") return apiError(409, "VERSION_CONFLICT", "x");
    return null;
  });
  const conflict = await card();
  await actor.click(await conflict.findByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText(/刚被别人改过，页面已刷新成最新的样子/));
  await waitFor(() => assert.equal((conflict.getByLabelText("販売事業者（销售主体）") as HTMLInputElement).value, "新しい名前"));
});

test("运营只读：看得到各项的值（没填的写「还没有填」）、说明只有超级管理员能改，没有输入框和保存按钮；也有缺项提示和预览链接", async () => {
  const calls = openLegal("operations", legalOf({ seller_name: "テスト販売", japan_contact: "東京都\n03-0000-0000" }, { version: 2, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: COLLEAGUE, name: "佐藤" } }));
  const legal = await card();
  assert.ok(await legal.findByText("テスト販売"));
  assert.equal(legal.getByText(/^東京都/).textContent, "東京都\n03-0000-0000");
  assert.equal(legal.getAllByText("还没有填").length, 8);
  assert.ok(legal.getByText("只有超级管理员能改法律文案的待补项。"));
  assert.ok(legal.getByText(/^还缺 8 项：/));
  assertAbsent(legal.queryByRole("textbox"));
  assertAbsent(legal.queryByRole("button", { name: "保存" }));
  assert.equal(legal.getAllByRole("link").length, 3);
  assert.ok(legal.getByText(/佐藤/));
  assert.equal(puts(calls).length, 0);
});

test("读不出来：说明并给「重试」，重试后显示", async () => {
  let reads = 0;
  openApp("/platform/settings/site", "platform", "super_admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/site-settings") return json(200, siteSettings);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/legal-settings") {
      reads += 1;
      return reads === 1 ? apiError(500, "INTERNAL_ERROR", "x") : json(200, legalOf({}));
    }
    return null;
  });
  const legal = await card();
  assert.ok(await legal.findByText("法律文案的待补项没有加载出来"));
  await user().click(legal.getByRole("button", { name: "重试" }));
  assert.ok(await legal.findByText(/^还缺 10 项：/));
});
