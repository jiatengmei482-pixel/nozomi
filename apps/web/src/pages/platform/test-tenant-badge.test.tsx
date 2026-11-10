/**
 * M8-24：运营后台供应商列表、详情给 QA 测试供应商（ADR 0077，`is_test_tenant`）显示「测试」标记和说明；
 * 测试供应商没有「开始试运营」；接口拒绝（409 TEST_TENANT_NOT_FOR_SALE）时对话框里是中文说明。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { CompanyOverview } from "../../api/onboarding.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { TEST_TENANT_TEXT, tenantOptionLabel } from "../../lib/platform-display.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith, TENANT_EXTRAS } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const REAL_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const QA_ID = "8c2d3e4f-aaaa-4bbb-8ccc-ddddeeeeffff";
const REAL: Tenant = { ...TENANT_EXTRAS, id: REAL_ID, name: "NOZOMI 自营车队", status: "signed", ...stamps, version: 3 };
const QA: Tenant = { ...TENANT_EXTRAS, id: QA_ID, name: "QA 测试供应商（验收专用）", status: "signed", is_test_tenant: true, ...stamps, version: 2 };
const me: PlatformUser = { id: "11111111-1111-4111-8111-111111111111", email: "kato@example.com", name: "加藤", role: "super_admin", role_name: roleName("platform", "super_admin") ?? "super_admin", status: "active", ...stamps };
const companyOf = (tenant: Tenant): CompanyOverview => ({ tenant, today: "2026-11-10", profile: null, required_document_types: [], requirements: [], documents: [], contracts: [], effective_contract: null, next_step_issues: [] });

type Route = (call: ApiCall & { url: URL }) => Response | null;
function open(path: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: me, permissions: [], must_change_password: false });
    if (at === "/platform/v1/tenants") return json(200, { items: [REAL, QA], next_cursor: null });
    for (const tenant of [REAL, QA]) {
      const base = `/platform/v1/tenants/${tenant.id}`;
      if (at === base) return json(200, tenant);
      if (at === `${base}/company`) return json(200, companyOf(tenant));
      if (at === `${base}/status-events` || at === `${base}/profile-changes`) return json(200, { items: [] });
    }
    if (at === "/platform/v1/products") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const badgeTexts = (root: HTMLElement): string[] => [...root.querySelectorAll(".badge")].map((node) => node.textContent ?? "");

test("供应商列表：测试供应商名称旁有中性色「测试」标记，真实供应商没有", async () => {
  open("/platform/tenants");
  const qaRow = (await screen.findByRole("link", { name: QA.name })).closest("tr") as HTMLElement;
  const qaName = within(qaRow).getByRole("link", { name: QA.name }).parentElement as HTMLElement;
  assert.deepEqual(badgeTexts(qaName), ["测试"]);
  assert.ok(qaName.querySelector(".badge")?.classList.contains("badge--neutral"));
  const realRow = screen.getByRole("link", { name: REAL.name }).closest("tr") as HTMLElement;
  assert.ok(!badgeTexts(realRow).includes("测试"));
});

test("测试供应商详情：标题旁和基本信息里有「测试」标记、有说明；已签约也没有「开始试运营」，并写明原因", async () => {
  open(`/platform/tenants/${QA_ID}`);
  await screen.findByRole("heading", { level: 1, name: QA.name });
  assert.ok(badgeTexts(document.querySelector(".page__meta") as HTMLElement).includes("测试"));
  const info = screen.getByRole("heading", { name: "基本信息" }).closest("section") as HTMLElement;
  assert.deepEqual(badgeTexts(info), ["测试"]);
  assert.ok(screen.getByText(TEST_TENANT_TEXT));
  const progress = (await screen.findByRole("heading", { name: "入驻进度" })).closest("section") as HTMLElement;
  assert.equal(within(progress).queryByRole("button", { name: "开始试运营" }), null);
  assert.ok(within(progress).getByText(/测试供应商不能开始试运营/));
  assert.ok(within(progress).getByRole("button", { name: "申请清退" }));
});

test("真实供应商详情：没有「测试」标记和说明，已签约时照常有「开始试运营」", async () => {
  open(`/platform/tenants/${REAL_ID}`);
  await screen.findByRole("heading", { level: 1, name: REAL.name });
  assert.ok(!badgeTexts(document.querySelector(".page__meta") as HTMLElement).includes("测试"));
  assert.equal(screen.queryByText(TEST_TENANT_TEXT), null);
  const progress = (await screen.findByRole("heading", { name: "入驻进度" })).closest("section") as HTMLElement;
  assert.ok(within(progress).getByRole("button", { name: "开始试运营" }));
  assert.equal(within(progress).queryByText(/测试供应商不能开始试运营/), null);
});

test("开始试运营被接口拒绝 409 TEST_TENANT_NOT_FOR_SALE（页面上的状态过时）：对话框里说明这是测试供应商、不能试运营", async () => {
  const calls = open(`/platform/tenants/${REAL_ID}`, (call) => (call.method === "POST" && call.url.pathname === `/platform/v1/tenants/${REAL_ID}/start-trial` ? apiError(409, "TEST_TENANT_NOT_FOR_SALE", "test tenant") : null));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "开始试运营" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText(/测试单的情况/), "测试单 A-1，加藤跑的，正常");
  await user.click(within(dialog).getByRole("button", { name: "开始试运营" }));
  const alert = await within(dialog).findByText(/这是测试供应商，只用于验收，不能开始试运营/);
  assert.ok(alert);
  assert.doesNotMatch(dialog.textContent ?? "", /TEST_TENANT_NOT_FOR_SALE/);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("下拉选项里的供应商名称：测试供应商后面加「（测试）」", () => {
  assert.equal(tenantOptionLabel(QA), "QA 测试供应商（验收专用）（测试）");
  assert.equal(tenantOptionLabel(REAL), "NOZOMI 自营车队");
});
