/**
 * 运营后台供应商详情的「企业信息」和「资料修改申请」（M4-34，ADR 0071）的组件测试：谁看得到编辑按钮、编辑后发了什么请求（带 If-Match）、
 * 版本冲突怎么说、申请的发起复核和驳回。接口用测试替身；真实后端由 e2e/tenant-profile.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { CompanyOverview, CompanyProfile, PlatformTenantProfileChange } from "../../api/onboarding.ts";
import type { PlatformUser, Tenant } from "../../api/types.ts";
import { roleName } from "../../lib/portal.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith, TENANT_EXTRAS } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const CHANGE_ID = "9a9a9a9a-aaaa-4bbb-8ccc-ddddeeeeffff";
const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "NOZOMI 自营车队", status: "active", ...TENANT_EXTRAS, ...stamps, version: 4, ...changes });
const meOf = (role: string): PlatformUser => ({ id: "11111111-1111-4111-8111-111111111111", email: "kato@example.com", name: "加藤", role, role_name: roleName("platform", role) ?? role, status: "active", ...stamps });
const PROFILE: CompanyProfile = { country_code: "JP", legal_name: "株式会社のぞみ交通", registration_no: "0100-01-000001", address: "東京都千代田区1-1", contact_name: "山田", contact_phone: "+81 3-0000-0000", contact_email: "ops@nozomi.test", version: 3, updated_at: stamps.updated_at };
const companyOf = (tenant: Tenant, profile: CompanyProfile | null): CompanyOverview => ({ tenant, today: "2026-11-09", profile, required_document_types: [], requirements: [], documents: [], contracts: [], effective_contract: null, next_step_issues: [] });
const changeOf = (changes: Partial<PlatformTenantProfileChange> = {}): PlatformTenantProfileChange => ({
  id: CHANGE_ID,
  fields: ["name", "legal_name"],
  proposed: { name: "のぞみ交通", legal_name: "株式会社のぞみ新交通" },
  previous: { name: "NOZOMI 自营车队", legal_name: "株式会社のぞみ交通" },
  note: "公司更名",
  status: "pending",
  submitted_by: { id: "33333333-3333-4333-8333-333333333333", name: "供应商管理员", email: "admin@nozomi.test" },
  submitted_at: "2026-11-08T01:00:00.000Z",
  decided_at: null,
  reject_reason: null,
  rejected_by: null,
  approval_id: null,
  pending_approval_id: null,
  version: 1,
  ...changes,
});

type Route = (call: ApiCall & { url: URL }) => Response | null;
function open(role: string, world: { tenant?: Tenant; profile?: CompanyProfile | null; changes?: PlatformTenantProfileChange[] } = {}, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method !== "GET") return null;
    const at = call.url.pathname;
    const tenant = world.tenant ?? tenantOf();
    if (at === "/platform/v1/auth/me") return json(200, { user: meOf(role), permissions: [], must_change_password: false });
    if (at === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenant);
    if (at === `/platform/v1/tenants/${TENANT_ID}/company`) return json(200, companyOf(tenant, world.profile === undefined ? PROFILE : world.profile));
    if (at === `/platform/v1/tenants/${TENANT_ID}/profile-changes`) return json(200, { items: world.changes ?? [] });
    if (at === `/platform/v1/tenants/${TENANT_ID}/status-events`) return json(200, { items: [] });
    if (at === "/platform/v1/products") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/platform/tenants/${TENANT_ID}`]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const card = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { name: "企业信息" })).closest("section") as HTMLElement;

test("企业信息卡片：显示名称、国家、法定名称、登记号、注册地址、联系人、电话、邮箱；有 tenant.edit 才有「编辑企业信息」", async () => {
  open("operations");
  const section = await card();
  await within(section).findByText("株式会社のぞみ交通");
  for (const text of ["对外显示名称", "NOZOMI 自营车队", "JP", "0100-01-000001", "東京都千代田区1-1", "山田", "+81 3-0000-0000", "ops@nozomi.test", "注册地址", "联系邮箱"]) assert.ok(within(section).getByText(text), text);
  assert.ok(within(section).getByRole("button", { name: "编辑企业信息" }));

  for (const role of ["readonly", "channel_manager"]) {
    resetBrowser();
    open(role);
    const readonlyCard = await card();
    await within(readonlyCard).findByText("株式会社のぞみ交通");
    assertAbsent(within(readonlyCard).queryByRole("button", { name: "编辑企业信息" }));
  }
});

test("编辑：改了名称发 PATCH（If-Match 供应商的版本），改了企业信息发 PUT（If-Match 企业信息的版本）；什么都没改不发；名称不能为空", async () => {
  const actor = userEvent.setup();
  const calls = open("tenant_onboarding", {}, (call) => {
    if (call.method === "PATCH") return json(200, tenantOf({ name: "のぞみ交通", version: 5 }));
    if (call.method === "PUT") return json(200, { ...PROFILE, contact_name: "佐藤", version: 4 });
    return null;
  });
  const section = await card();
  await within(section).findByText("株式会社のぞみ交通");
  await actor.click(within(section).getByRole("button", { name: "编辑企业信息" }));
  let dialog = screen.getByRole("dialog", { name: "编辑企业信息" });
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await screen.findByText("企业信息已保存");
  assert.equal(writes(calls).length, 0, "什么都没改不发请求");

  await actor.click(within(await card()).getByRole("button", { name: "编辑企业信息" }));
  dialog = screen.getByRole("dialog", { name: "编辑企业信息" });
  const name = within(dialog).getByLabelText("对外显示名称");
  await actor.clear(name);
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(within(dialog).getByText("请填对外显示名称"));
  assert.equal(writes(calls).length, 0);
  await actor.type(name, " のぞみ交通 ");
  const contact = within(dialog).getByLabelText("联系人");
  await actor.clear(contact);
  await actor.type(contact, "佐藤");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await screen.findByRole("heading", { level: 1, name: "のぞみ交通" });
  const [patch, put] = writes(calls);
  assert.deepEqual([patch?.method, patch?.path, patch?.body, patch?.headers["if-match"]], ["PATCH", `/platform/v1/tenants/${TENANT_ID}`, { name: "のぞみ交通" }, '"4"']);
  assert.deepEqual([put?.method, put?.path, (put?.body as Record<string, unknown>)["contact_name"], put?.headers["if-match"]], ["PUT", `/platform/v1/tenants/${TENANT_ID}/company/profile`, "佐藤", '"3"']);
});

test("编辑：别人刚改过（版本冲突）时说清楚，请刷新；还没有企业信息时第一次保存不带 If-Match", async () => {
  const actor = userEvent.setup();
  const calls = open("super_admin", { profile: null }, (call) => (call.method === "PUT" ? apiError(409, "VERSION_CONFLICT", "冲突", { current_version: 1 }) : null));
  const section = await card();
  await within(section).findByText("供应商还没有填企业信息。");
  await actor.click(within(section).getByRole("button", { name: "编辑企业信息" }));
  const dialog = screen.getByRole("dialog", { name: "编辑企业信息" });
  await actor.type(within(dialog).getByLabelText(/法定名称/), "株式会社テスト");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("刚被别人改过。请关闭对话框，刷新页面看最新的内容，再改。");
  assert.equal(writes(calls)[0]?.headers["if-match"], undefined);
});

test("资料修改申请：等处理的显示改前改后；有 tenant.review 能发起复核、驳回（原因必填）；已发起复核的指向「待审核」；只读只能看", async () => {
  const actor = userEvent.setup();
  let changes = [changeOf(), changeOf({ id: "8a8a8a8a-aaaa-4bbb-8ccc-ddddeeeeffff", fields: ["registration_no"], proposed: { registration_no: "9" }, previous: { registration_no: "1" }, status: "rejected", reject_reason: "对不上", decided_at: "2026-11-01T00:00:00.000Z" })];
  const calls = open("tenant_onboarding", { changes }, (call) => {
    if (call.method === "GET" && call.url.pathname.endsWith("/profile-changes")) return json(200, { items: changes });
    if (call.method === "POST" && call.path.endsWith("/approval")) {
      changes = [changeOf({ pending_approval_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })];
      return json(202, { approval: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "tenant.profile_change", status: "pending" } });
    }
    return null;
  });
  const section = (await screen.findByRole("heading", { name: "资料修改申请" })).closest("section") as HTMLElement;
  const table = within(section).getByRole("region", { name: "申请修改的内容" });
  for (const text of ["对外显示名称", "NOZOMI 自营车队", "のぞみ交通", "株式会社のぞみ新交通"]) assert.ok(within(table).getByText(text), text);
  assert.match(section.textContent ?? "", /说明：公司更名/);
  assert.match(section.textContent ?? "", /驳回原因：对不上/);
  await actor.click(within(section).getByRole("button", { name: "驳回" }));
  const reject = screen.getByRole("dialog", { name: "驳回修改申请" });
  await actor.click(within(reject).getByRole("button", { name: "驳回" }));
  assert.ok(within(reject).getByText("请写驳回的原因（供应商看得到）"));
  await actor.click(within(reject).getByRole("button", { name: "取消" }));
  await actor.click(within(section).getByRole("button", { name: "核对无误，发起复核" }));
  await screen.findByText("已发起复核，等另一位同事审核后生效");
  assert.deepEqual([writes(calls)[0]?.path, writes(calls)[0]?.body], [`/platform/v1/tenants/${TENANT_ID}/profile-changes/${CHANGE_ID}/approval`, { note: null }]);
  await within(section).findByRole("link", { name: "「待审核」" });
  assertAbsent(within(section).queryByRole("button", { name: "核对无误，发起复核" }));

  resetBrowser();
  open("readonly", { changes: [changeOf()] });
  const viewOnly = (await screen.findByRole("heading", { name: "资料修改申请" })).closest("section") as HTMLElement;
  assertAbsent(within(viewOnly).queryByRole("button", { name: "核对无误，发起复核" }));
  assertAbsent(within(viewOnly).queryByRole("button", { name: "驳回" }));
});
