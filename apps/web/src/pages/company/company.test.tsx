/**
 * 供应商入驻（M4-01）的组件测试：供应商后台「企业资质」「履约评分」、运营后台供应商详情的入驻部分、「资质审核」队列。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { CompanyOverview, DocumentRequirement, TenantDocument, TenantPerformance } from "../../api/onboarding.ts";
import type { Tenant } from "../../api/types.ts";
import { type ApiCall, TENANT_EXTRAS, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" };
const TENANT_ID = "7b1c2d3e-aaaa-4bbb-8ccc-ddddeeeeffff";
const DOC_ID = "d0c00000-0000-4000-8000-000000000001";
const FILE_ID = "f1100000-0000-4000-8000-000000000001";
const tenantOf = (changes: Partial<Tenant> = {}): Tenant => ({ id: TENANT_ID, name: "丙车队", status: "applying", ...TENANT_EXTRAS, ...stamps, ...changes });
const requirement = (type: DocumentRequirement["type"], name: string, changes: Partial<DocumentRequirement> = {}): DocumentRequirement => ({ type, type_name: name, required: true, expiry: "required", state: "missing", approved_document_id: null, latest_document_id: null, expires_on: null, days_left: null, ...changes });
const documentOf = (changes: Partial<TenantDocument> = {}): TenantDocument => ({ id: DOC_ID, type: "vehicle_insurance", type_name: "营运车辆商业保险", status: "pending", expires_on: "2027-10-01", note: null, file: { id: FILE_ID, content_type: "application/pdf", byte_size: 2048, file_name: "保单.pdf" }, submitted_at: "2026-10-05T01:00:00.000Z", reviewed_at: null, review_reason: null, ...changes });
const companyOf = (changes: Partial<CompanyOverview> = {}): CompanyOverview => ({
  tenant: tenantOf(),
  today: "2026-10-07",
  profile: null,
  required_document_types: ["business_license", "passenger_transport_license", "vehicle_insurance", "settlement_account"],
  requirements: [requirement("business_license", "营业执照", { expiry: "optional" }), requirement("passenger_transport_license", "旅客运输营运许可"), requirement("vehicle_insurance", "营运车辆商业保险"), requirement("settlement_account", "结算账户证明", { expiry: "none" })],
  documents: [],
  contracts: [],
  effective_contract: null,
  next_step_issues: [{ path: "/company/country_code", reason: "REQUIRED" }, { path: "/documents/vehicle_insurance", reason: "DOCUMENT_MISSING" }],
  ...changes,
});
const performanceOf = (changes: Partial<TenantPerformance> = {}): TenantPerformance => ({
  today: "2026-10-07",
  status: "active",
  observation_reasons: [],
  suspension_reasons: [],
  rules: { window_days: 90, default_score_centi: 450, min_completed_orders: 20, observation_below_centi: 400, suspend_below_centi: 350, no_show_window_days: 30, no_show_observation: 2, no_show_suspend: 3, weights_bp: { dispatch: 2500, arrival: 2500, rating: 2000, complaint: 2000, failure: 1000 }, trial_daily_order_limit: 10 },
  latest: {
    date: "2026-10-07",
    window_from: "2026-07-10",
    score_centi: 492,
    raw_score_centi: 492,
    is_default: false,
    completed_orders: 20,
    no_shows: 0,
    components: {
      dispatch: { value: 9500, points_centi: 475, weight_bp: 2500 },
      arrival: { value: 10000, points_centi: 500, weight_bp: 2500 },
      rating: { value: 490, points_centi: 490, weight_bp: 2000 },
      complaint: { value: 0, points_centi: 500, weight_bp: 2000 },
      failure: { value: 0, points_centi: 500, weight_bp: 1000 },
    },
    inputs: { dispatch_on_time: 19, dispatch_total: 20 },
  },
  trend: [
    { date: "2026-10-06", score_centi: 450, raw_score_centi: 500, is_default: true, completed_orders: 19 },
    { date: "2026-10-07", score_centi: 492, raw_score_centi: 492, is_default: false, completed_orders: 20 },
  ],
  ...changes,
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function openTenant(path: string, role: string, routes: Route): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return json(200, { user: { id: "u1", email: "admin@c.example", name: "管理员", role, status: "active", ...stamps }, tenant: tenantOf(), permissions: [], must_change_password: false });
    if (call.url.pathname === "/tenant/v1/company/status-events") return json(200, { items: [] });
    if (call.url.pathname === "/tenant/v1/company/notices") return json(200, { items: [], next_cursor: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

function openPlatform(path: string, role: string, routes: Route): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return json(200, { user: { id: "p1", email: "bd@platform.example", name: "招商", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (call.url.pathname === `/platform/v1/tenants/${TENANT_ID}/status-events`) return json(200, { items: [] });
    if (call.url.pathname === `/platform/v1/tenants/${TENANT_ID}/performance`) return json(200, performanceOf({ latest: null, trend: [] }));
    if (call.url.pathname === "/platform/v1/audit-logs") return json(200, { items: [], next_cursor: null });
    if (call.url.pathname === "/platform/v1/products") return json(200, { items: [], next_cursor: null, total: 0 });
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

test("企业资质：入驻进度列出还缺什么；按清单逐项上传——先查文件大小和到期日，再先传文件、后交资质；提交审核被拦时说清楚缺什么", async () => {
  const user = userEvent.setup();
  let company = companyOf();
  const calls = openTenant("/company", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/company") return json(200, company);
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/company/files") return json(201, { id: FILE_ID, purpose: "document", content_type: "application/pdf", byte_size: 12, sha256: "0".repeat(64), file_name: "保单.pdf", uploaded_at: "2026-10-07T01:00:00.000Z" });
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/company/documents") {
      company = companyOf({ documents: [documentOf()], requirements: company.requirements.map((item) => (item.type === "vehicle_insurance" ? { ...item, state: "pending", latest_document_id: DOC_ID } : item)) });
      return json(201, documentOf());
    }
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/company/submit") return apiError(409, "TENANT_CONDITIONS_UNMET", "没交齐", { issues: [{ path: "/documents/settlement_account", reason: "DOCUMENT_MISSING" }] });
    return null;
  });
  const progress = await screen.findByRole("region", { name: "入驻进度" });
  assert.match(progress.textContent ?? "", /所在国家：必填/);
  assert.match(progress.textContent ?? "", /营运车辆商业保险：还没有提交/);

  await user.click(screen.getByRole("button", { name: "上传 营运车辆商业保险" }));
  const dialog = screen.getByRole("dialog", { name: "上传：营运车辆商业保险" });
  // 没选文件、没填到期日：不发请求
  await user.click(within(dialog).getByRole("button", { name: "提交" }));
  await within(dialog).findByText("请选择文件");
  const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "大.pdf", { type: "application/pdf" });
  fireEvent.change(within(dialog).getByLabelText(/^文件/), { target: { files: [big] } });
  await user.click(within(dialog).getByRole("button", { name: "提交" }));
  await within(dialog).findByText("文件太大了：最大 10 MB");
  fireEvent.change(within(dialog).getByLabelText(/^文件/), { target: { files: [new File(["%PDF-1.7"], "保单.pdf", { type: "application/pdf" })] } });
  await user.click(within(dialog).getByRole("button", { name: "提交" }));
  await within(dialog).findByText("请填证件上的到期日");
  fireEvent.change(within(dialog).getByLabelText(/^到期日/), { target: { value: "2026-10-07" } });
  await user.click(within(dialog).getByRole("button", { name: "提交" }));
  await within(dialog).findByText(/到期日已经到了或过了/);
  assert.equal(writes(calls).length, 0, "页面先拦下");
  fireEvent.change(within(dialog).getByLabelText(/^到期日/), { target: { value: "2027-10-01" } });
  await user.click(within(dialog).getByRole("button", { name: "提交" }));
  await screen.findByText("已提交「营运车辆商业保险」，等平台审核");
  const sent = writes(calls);
  assert.deepEqual(sent.map((call) => call.path.split("?")[0]), ["/tenant/v1/company/files", "/tenant/v1/company/documents"]);
  assert.equal(new URL(sent[0]?.path ?? "", "http://localhost").searchParams.get("file_name"), "保单.pdf");
  assert.equal(sent[0]?.headers["content-type"], "application/pdf");
  assert.deepEqual(sent[1]?.body, { type: "vehicle_insurance", file_id: FILE_ID, expires_on: "2027-10-01", note: null });
  await waitFor(() => assert.match(screen.getByRole("region", { name: "资质清单" }).textContent ?? "", /营运车辆商业保险.*审核中/));
  assert.match(screen.getByRole("row", { name: /营运车辆商业保险/ }).textContent ?? "", /2027-10-01（审核中）/, "审核前就看得到填的到期日");

  await user.click(screen.getByRole("button", { name: "提交审核" }));
  await screen.findByText("还不能提交：结算账户证明：还没有提交。");
});

test("企业资质：只读角色只能看（没有上传、提交、编辑）；提交审核后企业信息只读；被驳回的写着平台的意见", async () => {
  const company = companyOf({
    tenant: tenantOf({ status: "applying" }),
    profile: { country_code: "KR", legal_name: "丙株式会社", registration_no: "1", address: "首尔", contact_name: "丙", contact_phone: "+82", contact_email: "c@c.example", version: 1, updated_at: stamps.updated_at },
    documents: [documentOf({ status: "rejected", review_reason: "保单上的车牌看不清", reviewed_at: "2026-10-06T00:00:00.000Z" })],
    requirements: companyOf().requirements.map((item) => (item.type === "vehicle_insurance" ? { ...item, state: "rejected", latest_document_id: DOC_ID } : item)),
  });
  openTenant("/company", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/company" ? json(200, company) : null));
  await screen.findByText("企业信息和资质由管理员维护，你可以查看。");
  assertAbsent(screen.queryByRole("button", { name: /^上传/ }));
  assertAbsent(screen.queryByRole("button", { name: "提交审核" }));
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  assert.match(screen.getByRole("region", { name: "资质清单" }).textContent ?? "", /保单上的车牌看不清/);
  assert.ok(screen.getByText("丙株式会社"));
  assert.match(document.body.textContent ?? "", /按 KR 的必交清单。/, "国家代码前后有空格");
});

test("履约评分：比价用的分、各项指标和权重、趋势；在观察期时说清原因和影响；默认分说明", async () => {
  openTenant("/performance", "dispatch", (call) => (call.url.pathname === "/tenant/v1/performance" ? json(200, performanceOf({ observation_reasons: ["driver_no_show"] })) : null));
  await screen.findByRole("heading", { level: 1, name: "履约评分" });
  await screen.findByText("4.92", { selector: ".score-summary__value" });
  const table = screen.getByRole("region", { name: "评分的各项指标" });
  assert.match(table.textContent ?? "", /按时派车率95\.0%4\.7525%/);
  assert.match(table.textContent ?? "", /客人评价均分4\.90 分4\.9020%/);
  assert.match(document.body.textContent ?? "", /在观察期。原因：近 30 天司机未到 2 次。观察期里比价时排序价按对外价 ×1\.05 计算/);
  assert.match(screen.getByRole("region", { name: "评分趋势（最近 14 天）" }).textContent ?? "", /2026-10-064\.50（默认）5\.0019/);
  assert.doesNotMatch(document.body.textContent ?? "", /加价|对外价\d/);
});

test("运营后台供应商详情：审核中的可以签约；资质逐项审核——驳回和要求补充必须写原因，通过可以改正到期日；资质审核队列链到详情", async () => {
  const user = userEvent.setup();
  const tenant = tenantOf({ status: "reviewing" });
  const company = companyOf({ tenant, documents: [documentOf()], requirements: companyOf().requirements.map((item) => (item.type === "vehicle_insurance" ? { ...item, state: "pending", latest_document_id: DOC_ID } : item)), next_step_issues: [{ path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" }] });
  const calls = openPlatform(`/platform/tenants/${TENANT_ID}`, "tenant_onboarding", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenant);
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}/company`) return json(200, company);
    if (call.method === "POST" && call.url.pathname.endsWith("/reject")) return json(200, { document: documentOf({ status: "rejected", review_reason: "看不清" }), tenant: tenantOf({ status: "applying" }) });
    if (call.method === "POST" && call.url.pathname.endsWith("/approve")) return json(200, { document: documentOf({ status: "approved" }), tenant });
    if (call.method === "POST" && call.url.pathname.endsWith("/sign")) return apiError(409, "TENANT_CONDITIONS_UNMET", "x", { issues: [{ path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" }] });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "丙车队" });
  const progress = await screen.findByRole("region", { name: "入驻进度" });
  assert.match(progress.textContent ?? "", /签约前还缺：还没有已生效的合同/);
  assert.match((await screen.findByRole("row", { name: /营运车辆商业保险/ })).textContent ?? "", /2027-10-01（审核中）/, "运营审核前在资质表里就看得到供应商填的到期日");
  await user.click(within(progress).getByRole("button", { name: "签约" }));
  const sign = screen.getByRole("dialog", { name: "和「丙车队」签约" });
  await user.click(within(sign).getByRole("button", { name: "签约" }));
  await within(sign).findByText("条件还不满足：还没有已生效的合同。");
  await user.click(within(sign).getByRole("button", { name: "取消" }));

  await user.click(screen.getByRole("button", { name: "驳回 营运车辆商业保险" }));
  const reject = screen.getByRole("dialog", { name: "驳回：营运车辆商业保险" });
  await user.click(within(reject).getByRole("button", { name: "驳回" }));
  await within(reject).findByText("必填：供应商会看到这段文字");
  assert.equal(writes(calls).filter((call) => call.path.endsWith("/reject")).length, 0);
  await user.type(within(reject).getByLabelText(/驳回原因/), "看不清");
  await user.click(within(reject).getByRole("button", { name: "驳回" }));
  await screen.findByText("营运车辆商业保险：已驳回");
  assert.deepEqual(writes(calls).find((call) => call.path.endsWith("/reject"))?.body, { reason: "看不清" });

  await user.click(screen.getByRole("button", { name: "通过 营运车辆商业保险" }));
  const approve = screen.getByRole("dialog", { name: "通过：营运车辆商业保险" });
  fireEvent.change(within(approve).getByLabelText("到期日"), { target: { value: "2027-09-30" } });
  await user.click(within(approve).getByRole("button", { name: "通过" }));
  await screen.findByText("营运车辆商业保险：已通过");
  assert.deepEqual(writes(calls).find((call) => call.path.endsWith("/approve"))?.body, { expires_on: "2027-09-30" });
  assert.equal(writes(calls).find((call) => call.path.endsWith("/approve"))?.path, `/platform/v1/tenants/${TENANT_ID}/documents/${DOC_ID}/approve`);
});

test("运营后台：资质全部通过、合同已生效的「审核中」供应商，入驻进度写可以签约，不再写资质正在审核（M4-10）", async () => {
  const tenant = tenantOf({ status: "reviewing" });
  openPlatform(`/platform/tenants/${TENANT_ID}`, "tenant_onboarding", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenant);
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}/company`) return json(200, companyOf({ tenant, next_step_issues: [] }));
    return null;
  });
  const progress = await screen.findByRole("region", { name: "入驻进度" });
  assert.match(progress.textContent ?? "", /资质已全部审核通过、合同已生效，可以签约。/);
  assert.doesNotMatch(progress.textContent ?? "", /资质正在审核/);
});

test("运营后台：只读角色看得到入驻进度和资质，但没有签约、审核、下载、发起合同的按钮；资质审核队列列出待审核的、能切到快到期的", async () => {
  const user = userEvent.setup();
  const tenant = tenantOf({ status: "reviewing" });
  openPlatform(`/platform/tenants/${TENANT_ID}`, "readonly", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}`) return json(200, tenant);
    if (call.method === "GET" && call.url.pathname === `/platform/v1/tenants/${TENANT_ID}/company`) return json(200, companyOf({ tenant, documents: [documentOf()], requirements: companyOf().requirements.map((item) => (item.type === "vehicle_insurance" ? { ...item, state: "pending", latest_document_id: DOC_ID } : item)) }));
    return null;
  });
  await screen.findByRole("region", { name: "资质清单" });
  for (const name of ["签约", "申请清退", "发起新版本", "通过 营运车辆商业保险", "下载 营运车辆商业保险"]) assertAbsent(screen.queryByRole("button", { name }));

  resetBrowser();
  const queue = openPlatform("/platform/tenant-documents", "tenant_onboarding", (call) => {
    if (call.url.pathname !== "/platform/v1/tenant-documents") return null;
    const kind = call.url.searchParams.get("kind");
    return json(200, { items: [{ tenant: { id: TENANT_ID, name: "丙车队", status: "reviewing" }, document: documentOf(kind === "expiring" ? { status: "approved", expires_on: "2026-10-20" } : {}) }], next_cursor: null, total: 1 });
  });
  await screen.findByRole("heading", { level: 1, name: "资质审核" });
  const link = await screen.findByRole("link", { name: "去审核 丙车队 的 营运车辆商业保险" });
  assert.equal(link.getAttribute("href"), `/platform/tenants/${TENANT_ID}`);
  await user.selectOptions(screen.getByLabelText("看哪些"), "expiring");
  await screen.findByRole("link", { name: "去查看 丙车队 的 营运车辆商业保险" });
  assert.ok(screen.getByText("2026-10-20"));
  assert.deepEqual(queue.filter((call) => call.path.startsWith("/platform/v1/tenant-documents")).map((call) => new URL(call.path, "http://localhost").searchParams.get("kind")), ["pending", "expiring"]);
});
