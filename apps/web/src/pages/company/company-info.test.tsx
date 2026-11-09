/**
 * 供应商后台「设置 › 企业信息」（M4-34，ADR 0071）的组件测试：菜单入口、审核通过以后只能直接改联系方式、
 * 改名称 / 法定名称 / 登记号走申请（只发改了的项）、撤回、申请中每一项都能改、财务只能看。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { CompanyOverview, CompanyProfile, TenantProfileChange } from "../../api/onboarding.ts";
import type { Tenant } from "../../api/types.ts";
import { type ApiCall, TENANT_EXTRAS, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const CHANGE_ID = "9a9a9a9a-aaaa-4bbb-8ccc-ddddeeeeffff";
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "丙车队", status: "active", ...TENANT_EXTRAS, ...stamps, ...changes });
const PROFILE: CompanyProfile = { country_code: "JP", legal_name: "株式会社丙交通", registration_no: "0100-01-123456", address: "東京都千代田区", contact_name: "丙", contact_phone: "+81312345678", contact_email: "ops@c.example", version: 2, updated_at: stamps.updated_at };
const companyOf = (tenant: Tenant, profile: CompanyProfile | null = PROFILE): CompanyOverview => ({ tenant, today: "2026-11-09", profile, required_document_types: [], requirements: [], documents: [], contracts: [], effective_contract: null, next_step_issues: [] });
const changeOf = (changes: Partial<TenantProfileChange> = {}): TenantProfileChange => ({
  id: CHANGE_ID,
  fields: ["name"],
  proposed: { name: "丙交通" },
  previous: { name: "丙车队" },
  note: null,
  status: "pending",
  submitted_by: { name: "管理员" },
  submitted_at: "2026-11-08T01:00:00.000Z",
  decided_at: null,
  reject_reason: null,
  version: 1,
  ...changes,
});

type Route = (call: ApiCall & { url: URL }) => Response | null;
function open(role: string, world: { tenant?: Tenant; profile?: CompanyProfile | null; changes?: () => TenantProfileChange[] } = {}, routes: Route = () => null, path = "/settings/company"): ApiCall[] {
  signIn("tenant", "tenant-token");
  const tenant = world.tenant ?? tenantOf();
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    const at = call.url.pathname;
    if (at === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "admin@c.example", name: "管理员", role, status: "active", ...stamps }, tenant, permissions: [], must_change_password: false });
    if (call.method === "GET" && at === "/tenant/v1/company") return json(200, companyOf(tenant, world.profile === undefined ? PROFILE : world.profile));
    if (call.method === "GET" && at === "/tenant/v1/company/profile-changes") return json(200, { items: world.changes?.() ?? [] });
    if (at === "/tenant/v1/company/status-events") return json(200, { items: [] });
    if (at === "/tenant/v1/company/notices") return json(200, { items: [], next_cursor: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
/** 第一次渲染整个应用（加载模块）比较慢，等久一点 */
const sectionOf = async (name: string): Promise<HTMLElement> => (await screen.findByRole("heading", { name }, { timeout: 5000 })).closest("section") as HTMLElement;

test("菜单「设置」下有「企业信息」（管理员、财务、只读），调度和商品价格没有", async () => {
  const user = userEvent.setup();
  for (const [role, shown] of [["admin", true], ["finance", true], ["readonly", true], ["dispatch", false], ["pricing", false]] as const) {
    resetBrowser();
    open(role, {}, () => null, "/settings/company");
    await screen.findByRole("heading", { level: 1, name: "企业信息" }, { timeout: 5000 });
    const nav = (await screen.findAllByRole("navigation", { name: "主菜单" }))[0] as HTMLElement;
    const settings = within(nav).queryByRole("button", { name: /设置/ });
    if (settings !== null && settings.getAttribute("aria-expanded") === "false") await user.click(settings);
    const link = within(nav).queryByRole("link", { name: "企业信息" });
    if (shown) assert.equal(link?.getAttribute("href"), "/settings/company", role);
    else assertAbsent(link);
  }
});

test("审核通过以后：只能直接改注册地址和联系方式（整份带回、If-Match 当前版本）；法定名称、登记号、国家只显示", async () => {
  const user = userEvent.setup();
  const calls = open("admin", {}, (call) => (call.method === "PUT" ? json(200, { ...PROFILE, contact_name: "佐藤", version: 3 }) : null));
  const edit = await sectionOf("修改注册地址和联系方式");
  assertAbsent(within(edit).queryByLabelText("法定名称"));
  assertAbsent(within(edit).queryByLabelText(/所在国家/));
  const contact = within(edit).getByLabelText("联系人");
  await user.clear(contact);
  await user.type(contact, "佐藤");
  await user.click(within(edit).getByRole("button", { name: "保存" }));
  await screen.findByText("企业信息已保存");
  const [put] = writes(calls);
  assert.deepEqual([put?.path, put?.headers["if-match"]], ["/tenant/v1/company/profile", '"2"']);
  assert.deepEqual(put?.body, { country_code: "JP", legal_name: "株式会社丙交通", registration_no: "0100-01-123456", address: "東京都千代田区", contact_name: "佐藤", contact_phone: "+81312345678", contact_email: "ops@c.example" });
  const current = await sectionOf("现在的企业信息");
  for (const text of ["丙车队", "株式会社丙交通", "0100-01-123456", "JP"]) assert.ok(within(current).getByText(text), text);
});

test("申请修改：只发改了的项和说明；没改不发；提交后显示等平台审核和撤回；已有等审核的被拦时说清楚", async () => {
  const user = userEvent.setup();
  let changes: TenantProfileChange[] = [];
  const calls = open("admin", { changes: () => changes }, (call) => {
    if (call.method === "POST" && call.path === "/tenant/v1/company/profile-changes") {
      changes = [changeOf({ fields: ["name", "registration_no"], proposed: { name: "丙交通", registration_no: "0100-01-999999" }, previous: { name: "丙车队", registration_no: "0100-01-123456" }, note: "更名" })];
      return json(201, changes[0]);
    }
    if (call.method === "POST" && call.path.endsWith("/withdraw")) {
      changes = [changeOf({ status: "withdrawn", decided_at: "2026-11-09T00:00:00.000Z" })];
      return json(200, changes[0]);
    }
    return null;
  });
  let card = await sectionOf("申请修改名称、法定名称、登记号");
  await user.click(within(card).getByRole("button", { name: "提交申请" }));
  assert.ok(within(card).getByText("没有改动：请先改要改的那一项。"));
  assert.equal(writes(calls).length, 0);
  const name = within(card).getByLabelText("对外显示名称");
  await user.clear(name);
  await user.type(name, "丙交通");
  const number = within(card).getByLabelText("登记号");
  await user.clear(number);
  await user.type(number, "0100-01-999999");
  await user.type(within(card).getByLabelText(/说明/), "更名");
  await user.click(within(card).getByRole("button", { name: "提交申请" }));
  await screen.findByText("已提交，等平台审核");
  assert.deepEqual(writes(calls)[0]?.body, { name: "丙交通", registration_no: "0100-01-999999", note: "更名" });
  card = await sectionOf("申请修改名称、法定名称、登记号");
  await within(card).findByText("等平台审核");
  const table = within(card).getByRole("region", { name: "申请修改的内容" });
  for (const text of ["对外显示名称", "丙车队", "丙交通", "0100-01-999999"]) assert.ok(within(table).getByText(text), text);
  assert.match(card.textContent ?? "", /审核期间客人和渠道看到的仍是原来的内容/);
  await user.click(within(card).getByRole("button", { name: "撤回申请" }));
  await screen.findByText("已撤回申请");
  assert.equal(writes(calls)[1]?.path, `/tenant/v1/company/profile-changes/${CHANGE_ID}/withdraw`);

  resetBrowser();
  open("admin", {}, (call) => (call.method === "POST" ? apiError(409, "PROFILE_CHANGE_PENDING_EXISTS", "已有") : null));
  const again = await sectionOf("申请修改名称、法定名称、登记号");
  const legal = within(again).getByLabelText("法定名称");
  await user.clear(legal);
  await user.type(legal, "株式会社丙新交通");
  await user.click(within(again).getByRole("button", { name: "提交申请" }));
  await within(again).findByText("已经有一条等平台审核的申请。要改内容，请先撤回那一条再提交。");
});

test("申请中：每一项都能直接改，并指向「企业资质」；财务只能看，没有任何表单", async () => {
  open("admin", { tenant: tenantOf({ status: "applying" }), profile: null });
  const edit = await sectionOf("修改企业信息");
  assert.ok(within(edit).getByLabelText("法定名称") && within(edit).getByLabelText(/所在国家/));
  assert.equal(within(edit).getByRole("link", { name: "「企业资质」" }).getAttribute("href"), "/company");

  resetBrowser();
  open("finance", { changes: () => [changeOf({ status: "rejected", reject_reason: "和执照不一致", decided_at: "2026-11-09T00:00:00.000Z" })] });
  await screen.findByText("企业信息由管理员维护，你可以查看。");
  assertAbsent(screen.queryByRole("heading", { name: "修改注册地址和联系方式" }));
  const card = await sectionOf("申请修改名称、法定名称、登记号");
  assertAbsent(within(card).queryByRole("button", { name: "提交申请" }));
  assert.match(card.textContent ?? "", /平台的意见：和执照不一致/);
});
