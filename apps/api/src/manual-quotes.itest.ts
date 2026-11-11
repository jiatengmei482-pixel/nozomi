/**
 * M8-21：人工报价申请（官网提交、运营后台跟进、到期清除）和官网设置（客服 WhatsApp 号码），ADR 0076。经真实接口、真实 PostgreSQL。
 *
 * 覆盖：提交（邮箱 / WhatsApp 至少一项、格式、同意、行程按类型核对、陷阱字段、24 小时去重）、限速（地址、联系方式、全站）、
 * 加密存储（库里找不到联系方式和地点的原文）、各平台角色的权限、审计（查看、改状态、指派、备注、清除，审计里没有联系方式和备注原文）、
 * 到期清除（结束 180 天、提交 365 天）、租户碰不到（接口和数据库两层）、官网设置（只有超级管理员能改、公开配置里给出、审计）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let closedSite: SiteApi;
const staff = new Map<PlatformRole, Staff>();

let ipSeq = 0;
const nextIp = (): string => `10.82.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
let mailSeq = 0;
const nextEmail = (): string => `guest-${++mailSeq}@example.test`;

const trip = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  category: "point_to_point",
  city_id: m.ids.tokyo,
  pickup: { name: "新宿某酒店", lat: 35.6938, lng: 139.7034 },
  dropoff: { name: "成田机场第一航站楼", lat: 35.7647, lng: 140.3863 },
  service_local: "2026-12-01T09:30",
  passengers: 2,
  luggage: 1,
  ...overrides,
});

const submit = (body: Record<string, unknown>, ip = nextIp()) => {
  // 每次提交隔 1 秒：列表按提交时间排序，「最新的一条」要分得出先后
  api.clock.advance(1_000);
  return site.call("POST", "/site/v1/manual-quote-requests", { ip, body: { consent: true, trip: trip(), ...body } });
};
const token = (role: PlatformRole): string => (role === "super_admin" ? m.root : (staff.get(role) as Staff).token);
const platform = (role: PlatformRole, method: "GET" | "PATCH" | "POST" | "PUT", url: string, body?: unknown, headers?: Record<string, string>) =>
  api.call(method, `/platform/v1${url}`, { token: token(role), ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });

/** 最新的一条申请（运营后台看到的第一条） */
async function latest(): Promise<any> {
  return (await ok(platform("customer_service", "GET", "/manual-quote-requests?limit=1"))).items[0];
}

const countRows = async (): Promise<number> => (await api.db.owner.query<{ n: number }>("select count(*)::int as n from manual_quote_requests")).rows[0]?.n ?? 0;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    staff.set(key, key === "operations" ? m.staff.operations : key === "readonly" ? m.staff.readonly : key === "master_data" ? m.staff.masterData : key === "channel_manager" ? m.staff.cm1 : await addStaff(api, m.root, `${key.replace("_", "-")}@mq.test`, key));
  }
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const clientId = (await salesCredentials(api, m, channel.id)).clientId;
  site = await siteApi(api, clientId, new FakePaymentProvider());
  closedSite = await siteApi(api, null, new FakePaymentProvider());
});
after(async () => {
  await site?.close();
  await closedSite?.close();
  await api?.close();
});

test("提交：邮箱或 WhatsApp 一项就行，202；库里一行，联系方式和两端地点只在密文里，明文列只有不指向个人的内容", async () => {
  const email = nextEmail();
  const res = await submit({ email: `  ${email.toUpperCase()} ` });
  assert.equal(res.status, 202, res.text);
  assert.deepEqual(res.body, { status: "accepted" });
  assertMatchesOpenApi("POST", "/site/v1/manual-quote-requests", res);
  const res2 = await submit({ whatsapp: "+81 90-1234-0001" });
  assert.equal(res2.status, 202, res2.text);

  const rows = (await api.db.owner.query("select * from manual_quote_requests order by created_at desc, id desc limit 2")).rows;
  const raw = JSON.stringify(rows);
  for (const secret of [email, "819012340001", "90-1234-0001", "新宿某酒店", "成田机场第一航站楼", "35.6938", "139.7034"]) assert.ok(!raw.includes(secret), `库里出现了原文 ${secret}`);
  const byEmail = rows.find((row) => row.has_email) as Record<string, unknown>;
  assert.equal(byEmail["has_whatsapp"], false);
  assert.match(String(byEmail["contact_enc"]), /^[0-9a-f]{8}:/);
  assert.match(String(byEmail["email_bidx"]), /^[0-9a-f]{8}:/);
  assert.equal(byEmail["whatsapp_bidx"], null);
  assert.equal(byEmail["status"], "new");
  assert.equal(byEmail["category"], "point_to_point");
  assert.equal(byEmail["city_id"], m.ids.tokyo);
  assert.match(String(byEmail["request_no"]), /^MQ\d{8}[0-9A-Z]{8}$/);
  const events = (await api.db.owner.query("select kind, actor_id from manual_quote_request_events where request_id = $1", [byEmail["id"]])).rows;
  assert.deepEqual(events, [{ kind: "created", actor_id: null }]);
  // 客人提交不写审计（审计只记员工的操作；客人的内容不进只能追加的审计表）
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'manual_quote_request'")).rows[0].n, 0);
});

test("提交的校验：两项都没填、格式不对、没同意、行程和类型对不上、城市不存在都是 400，不记任何东西", async () => {
  const before = await countRows();
  const cases: [Record<string, unknown>, string, string][] = [
    [{}, "/email", "REQUIRED"],
    [{ email: " ", whatsapp: "" }, "/email", "REQUIRED"],
    [{ email: "not-an-email" }, "/email", "FORMAT"],
    [{ whatsapp: "090-1234-5678" }, "/whatsapp", "FORMAT"],
    [{ whatsapp: "819012345678" }, "/whatsapp", "FORMAT"],
    [{ email: nextEmail(), trip: trip({ dropoff: null }) }, "/trip/dropoff", "REQUIRED"],
    [{ email: nextEmail(), trip: trip({ category: "charter", dropoff: null }) }, "/trip/package_hours", "REQUIRED"],
    [{ email: nextEmail(), trip: trip({ package_hours: 4 }) }, "/trip/package_hours", "NOT_APPLICABLE"],
    [{ email: nextEmail(), trip: trip({ service_local: "2026-02-30T10:00" }) }, "/trip/service_local", "INVALID"],
    [{ email: nextEmail(), trip: trip({ city_id: "00000000-0000-4000-8000-000000000000" }) }, "/trip/city_id", "NOT_FOUND"],
  ];
  for (const [body, path, reason] of cases) {
    const res = await submit(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assert.ok(res.body.error.details.issues.some((issue: { path: string; reason?: string }) => issue.path === path && issue.reason === reason), `${path} ${reason}：${res.text}`);
  }
  const noConsent = await site.call("POST", "/site/v1/manual-quote-requests", { ip: nextIp(), body: { email: nextEmail(), consent: false, trip: trip() } });
  assert.equal(noConsent.status, 400);
  const extra = await submit({ email: nextEmail(), name: "张三" });
  assert.equal(extra.status, 400, "不收集多余的信息（姓名等）");
  assert.equal(await countRows(), before);
});

test("包车：下车地点可以没有、要有时长；接送机的两端都要有", async () => {
  assert.equal((await submit({ email: nextEmail(), trip: trip({ category: "charter", dropoff: null, package_hours: 8 }) })).status, 202);
  assert.equal((await submit({ email: nextEmail(), trip: trip({ category: "airport_transfer" }) })).status, 202);
  const row = (await api.db.owner.query("select category, package_hours from manual_quote_requests where category = 'charter' order by created_at desc limit 1")).rows[0];
  assert.deepEqual(row, { category: "charter", package_hours: 8 });
});

test("防刷：陷阱字段有内容时照样 202、什么都不记；同一个联系方式同一个行程 24 小时内只记一次，过了 24 小时再记", async () => {
  const before = await countRows();
  const bot = await submit({ email: nextEmail(), website: "http://spam.example" });
  assert.equal(bot.status, 202);
  assert.equal(await countRows(), before);

  const email = nextEmail();
  assert.equal((await submit({ email })).status, 202);
  assert.equal((await submit({ email: email.toUpperCase() })).status, 202, "重复提交的应答一样");
  assert.equal(await countRows(), before + 1);
  assert.equal((await submit({ email, trip: trip({ passengers: 3 }) })).status, 202, "行程不同另算一条");
  assert.equal(await countRows(), before + 2);
  // 把那一条挪到 25 小时前（不拨时钟：后面的用例还要用这些员工的登录）
  await api.db.owner.query("update manual_quote_requests set created_at = created_at - interval '25 hours' where id = (select id from manual_quote_requests order by created_at desc, id desc offset 1 limit 1)");
  // 同一个邮箱今天已经提交了 3 次（按联系方式的额度），这里测的是去重，不是限速
  await api.db.owner.query("delete from sales_rate_limits where bucket like 'site_manual_quote_contact:%'");
  assert.equal((await submit({ email })).status, 202);
  assert.equal(await countRows(), before + 3);
});

test("限速：每个地址 15 分钟 3 次（校验之前就计）；每个联系方式每天 3 次（换地址也挡）；全站每小时 300 次", async () => {
  const ip = nextIp();
  const statuses = [];
  for (let i = 0; i < 4; i += 1) statuses.push((await submit(i === 0 ? {} : { email: nextEmail() }, ip)).status);
  assert.deepEqual(statuses, [400, 202, 202, 429]);
  const limited = await submit({ email: nextEmail() }, ip);
  assert.equal(limited.status, 429);
  assert.ok(limited.body.error.details.retry_after_seconds > 0);
  assertMatchesOpenApi("POST", "/site/v1/manual-quote-requests", limited);

  const whatsapp = "+44 7700 900123";
  const perContact = [];
  for (let i = 0; i < 4; i += 1) perContact.push((await submit({ whatsapp, trip: trip({ passengers: i + 1 }) })).status);
  assert.deepEqual(perContact, [202, 202, 202, 429]);

  const bucket = `site_manual_quote_all:${createHash("sha256").update("manual-quote:all", "utf8").digest("hex")}`;
  await api.db.owner.query("insert into sales_rate_limits (bucket, window_started_at, attempt_count) values ($1, $2, 300) on conflict (bucket) do update set window_started_at = $2, attempt_count = 300", [bucket, api.clock.now()]);
  assert.equal((await submit({ email: nextEmail() })).status, 429, "全站到了上限，谁都要等");
  await api.db.owner.query("delete from sales_rate_limits where bucket = $1", [bucket]);
  assert.equal((await submit({ email: nextEmail() })).status, 202);
});

test("官网没开时 503 SITE_NOT_OPEN，不记", async () => {
  const before = await countRows();
  const res = await closedSite.call("POST", "/site/v1/manual-quote-requests", { ip: nextIp(), body: { email: nextEmail(), consent: true, trip: trip() } });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, "SITE_NOT_OPEN");
  assert.equal(await countRows(), before);
});

test("权限：列表、详情、跟进只给超级管理员、运营、客服；其他角色 403；没登录 401", async () => {
  await submit({ email: nextEmail() });
  const id = (await latest()).id as string;
  for (const { key: role } of PLATFORM_ROLES) {
    const list = await platform(role, "GET", "/manual-quote-requests");
    const detail = await platform(role, "GET", `/manual-quote-requests/${id}`);
    const assignees = await platform(role, "GET", "/manual-quote-requests/assignees");
    const note = await platform(role, "POST", `/manual-quote-requests/${id}/notes`, { note: `权限检查 ${role}` });
    const expected = platformRoleCan(role, "manual_quote.read");
    assert.equal(expected, ["super_admin", "operations", "customer_service"].includes(role), role);
    assert.equal(list.status, expected ? 200 : 403, `${role} 列表`);
    assert.equal(detail.status, expected ? 200 : 403, `${role} 详情`);
    assert.equal(assignees.status, expected ? 200 : 403, `${role} 跟进人`);
    assert.equal(note.status, expected ? 201 : 403, `${role} 备注`);
    if (!expected) assert.deepEqual(list.body.error.details, { required: "manual_quote.read" });
  }
  assert.equal((await api.call("GET", "/platform/v1/manual-quote-requests")).status, 401);
});

test("列表没有个人信息；按状态、跟进人、联系方式（盲索引）筛；带各状态的数量；翻页", async () => {
  const email = nextEmail();
  await submit({ email, whatsapp: "+81 80 5555 0001", trip: trip({ pickup: { name: "列表测试酒店", lat: 35.7, lng: 139.7 } }) });
  const res = await platform("customer_service", "GET", "/manual-quote-requests");
  assert.equal(res.status, 200);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests", res);
  for (const secret of [email, "805555", "列表测试酒店"]) assert.ok(!res.text.includes(secret), `列表里出现了 ${secret}`);
  assert.equal(res.body.items[0].has_email, true);
  assert.equal(res.body.items[0].has_whatsapp, true);
  assert.deepEqual(res.body.items[0].city, { id: m.ids.tokyo, code: "CTY-JP-TYO", name: { zh: "东京" } });
  assert.ok(res.body.counts.new >= 1);

  const byEmail = await ok(platform("customer_service", "GET", `/manual-quote-requests?contact=${encodeURIComponent(email.toUpperCase())}`));
  assert.equal(byEmail.items.length, 1);
  const byWhatsapp = await ok(platform("customer_service", "GET", `/manual-quote-requests?contact=${encodeURIComponent("818055550001")}`));
  assert.deepEqual(byWhatsapp.items.map((item: { id: string }) => item.id), byEmail.items.map((item: { id: string }) => item.id));
  assert.equal((await ok(platform("customer_service", "GET", "/manual-quote-requests?contact=nobody%40example.test"))).items.length, 0);
  assert.equal((await platform("customer_service", "GET", "/manual-quote-requests?contact=abc")).status, 400);

  const page1 = await ok(platform("operations", "GET", "/manual-quote-requests?limit=2"));
  assert.equal(page1.items.length, 2);
  const page2 = await ok(platform("operations", "GET", `/manual-quote-requests?limit=2&cursor=${page1.next_cursor}`));
  assert.ok(page2.items.every((item: { id: string }) => !page1.items.some((first: { id: string }) => first.id === item.id)));
  assert.ok((await ok(platform("operations", "GET", "/manual-quote-requests?assignee=unassigned"))).items.length >= 1);
  assert.equal((await ok(platform("operations", "GET", "/manual-quote-requests?status=closed&assignee=me"))).items.length, 0);
});

test("详情：解密联系方式、地点和备注；每次打开写一条审计（只有申请编号，没有联系方式）", async () => {
  const email = nextEmail();
  await submit({ email, whatsapp: "+81 90 7777 0001" });
  const id = (await latest()).id as string;
  const res = await platform("customer_service", "GET", `/manual-quote-requests/${id}`);
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests/{id}", res);
  assert.deepEqual(res.body.contact, { email, whatsapp: "+819077770001" });
  assert.deepEqual(res.body.pickup, { name: "新宿某酒店", lat: 35.6938, lng: 139.7034 });
  assert.deepEqual(res.body.dropoff, { name: "成田机场第一航站楼", lat: 35.7647, lng: 140.3863 });
  assert.deepEqual(res.body.events.map((event: { kind: string }) => event.kind), ["created"]);
  await platform("customer_service", "GET", `/manual-quote-requests/${id}`);
  const audits = (await api.db.owner.query("select actor_id, action, before, after from audit_logs where resource = 'manual_quote_request' and resource_id = $1 order by id", [id])).rows;
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[0], { actor_id: staff.get("customer_service")?.id, action: "view_passenger", before: null, after: { request_no: res.body.request.request_no } });
  assert.equal((await platform("customer_service", "GET", "/manual-quote-requests/00000000-0000-4000-8000-000000000000")).status, 404);
});

test("跟进：指派、改状态（If-Match）、备注；每一项一条跟进记录和一条审计；备注加密、审计里没有原文", async () => {
  await submit({ email: nextEmail() });
  const summary = await latest();
  const id = summary.id as string;
  const cs = staff.get("customer_service") as Staff;
  const url = `/manual-quote-requests/${id}`;

  assert.equal((await platform("customer_service", "PATCH", url, { status: "following" })).status, 428, "没带 If-Match");
  assert.equal((await platform("customer_service", "PATCH", url, { status: "following" }, { "if-match": '"9"' })).status, 409, "版本对不上");
  const assignees = await ok(platform("customer_service", "GET", "/manual-quote-requests/assignees"));
  assert.ok(assignees.items.some((person: { id: string }) => person.id === cs.id));
  assert.ok(!assignees.items.some((person: { id: string }) => person.id === staff.get("finance")?.id), "财务不能跟进");

  const changed = await platform("customer_service", "PATCH", url, { status: "following", assignee_id: cs.id }, { "if-match": `"${summary.version}"` });
  assert.equal(changed.status, 200, changed.text);
  assertMatchesOpenApi("PATCH", "/platform/v1/manual-quote-requests/{id}", changed);
  assert.equal(changed.body.request.status, "following");
  assert.deepEqual(changed.body.request.assignee, { id: cs.id, name: "customer-service" });
  assert.equal(changed.body.request.version, summary.version + 1);
  assert.equal(changed.body.request.contact, undefined, "改动的应答里没有个人信息");
  assert.equal((await ok(platform("customer_service", "GET", "/manual-quote-requests?assignee=me"))).items.some((item: { id: string }) => item.id === id), true);

  const version = changed.body.request.version as number;
  const toNew = await platform("customer_service", "PATCH", url, { status: "new" }, { "if-match": `"${version}"` });
  assert.equal(toNew.status, 409);
  assert.equal(toNew.body.error.code, "MANUAL_QUOTE_STATUS_INVALID");
  const finance = await platform("customer_service", "PATCH", url, { assignee_id: staff.get("finance")?.id }, { "if-match": `"${version}"` });
  assert.equal(finance.status, 400);
  assert.equal(finance.body.error.details.issues[0].reason, "NOT_ELIGIBLE");
  const same = await ok(platform("customer_service", "PATCH", url, { status: "following" }, { "if-match": `"${version}"` }));
  assert.equal(same.request.version, version, "什么都没变时不改版本");

  const noteText = "客人电话 +81 90 0000 1111，周三回电";
  const note = await platform("customer_service", "POST", `${url}/notes`, { note: noteText });
  assert.equal(note.status, 201, note.text);
  assertMatchesOpenApi("POST", "/platform/v1/manual-quote-requests/{id}/notes", note);
  assert.equal(note.body.event.note, noteText);
  assert.equal((await platform("customer_service", "POST", `${url}/notes`, { note: "   " })).status, 400);
  assert.equal((await platform("customer_service", "POST", `${url}/notes`, { note: "字".repeat(2_001) })).status, 400);

  const closed = await ok(platform("operations", "PATCH", url, { status: "closed" }, { "if-match": `"${version}"` }));
  assert.equal(closed.request.status, "closed");
  assert.ok(closed.request.finished_at !== null);

  const stored = (await api.db.owner.query("select note_enc from manual_quote_request_events where request_id = $1 and kind = 'note'", [id])).rows;
  assert.equal(stored.length, 1);
  assert.ok(!String(stored[0].note_enc).includes("0000 1111"));
  const detail = await ok(platform("operations", "GET", url));
  assert.deepEqual(detail.events.map((event: { kind: string }) => event.kind), ["created", "status", "assign", "note", "status"]);
  assert.equal(detail.events[3].note, noteText);
  assert.deepEqual(detail.events[3].actor, { id: cs.id, name: "customer-service" });

  const audits = (await api.db.owner.query("select action, before, after from audit_logs where resource = 'manual_quote_request' and resource_id = $1 and action <> 'view_passenger' order by id", [id])).rows;
  assert.deepEqual(audits.map((row) => row.action), ["change", "assign", "note", "change"]);
  assert.deepEqual(audits[0].after, { request_no: summary.request_no, status: "following" });
  assert.deepEqual(audits[1].after, { request_no: summary.request_no, assignee_id: cs.id });
  assert.deepEqual(Object.keys(audits[2].after).sort(), ["length", "note_id", "request_no"]);
  assert.ok(!JSON.stringify(audits).includes("0000 1111"));
});

test("租户碰不到：租户令牌调运营后台接口 401；租户的数据库角色读不到、写不了这三张表；/tenant/v1 没有这类接口", async () => {
  const tenantToken = m.a.adminToken;
  for (const url of ["/platform/v1/manual-quote-requests", "/platform/v1/site-settings"]) {
    assert.equal((await api.call("GET", url, { token: tenantToken })).status, 401, url);
  }
  for (const table of ["manual_quote_requests", "manual_quote_request_events", "site_settings"]) {
    await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query(`select * from ${table}`)), (err: unknown) => deniedByDatabase(err), table);
    await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(`update ${table} set id = id`)), (err: unknown) => deniedByDatabase(err), table);
  }
  assert.ok(!api.app.registeredRoutes.some((route) => route.path.startsWith("/tenant/v1") && /manual|site-settings/.test(route.path)));
});

test("官网设置：客服 WhatsApp 号码只有超级管理员能改；运营、客服能看；格式核对；公开配置里给出；审计前后值", async () => {
  const empty = await platform("customer_service", "GET", "/site-settings");
  assert.equal(empty.status, 200);
  assertMatchesOpenApi("GET", "/platform/v1/site-settings", empty);
  assert.deepEqual(empty.body, { support_whatsapp: null, page_width: "standard", version: 0, updated_at: null, updated_by: null });
  assert.equal((await site.call("GET", "/site/v1/config", { ip: nextIp() })).body.support_whatsapp, null, "没设置时不给号码，页面不显示按钮");

  for (const { key: role } of PLATFORM_ROLES) {
    assert.equal((await platform(role, "GET", "/site-settings")).status, platformRoleCan(role, "site_settings.read") ? 200 : 403, role);
    if (role !== "super_admin") assert.equal((await platform(role, "PUT", "/site-settings", { support_whatsapp: "+81 3 1234 5678" })).status, 403, role);
  }
  for (const bad of ["03-1234-5678", "0081312345678", "+1234567", "abc"]) {
    const res = await platform("super_admin", "PUT", "/site-settings", { support_whatsapp: bad });
    assert.equal(res.status, 400, bad);
  }
  const saved = await platform("super_admin", "PUT", "/site-settings", { support_whatsapp: "+81 3-1234-5678" });
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOpenApi("PUT", "/platform/v1/site-settings", saved);
  assert.equal(saved.body.support_whatsapp, "81312345678");
  assert.equal(saved.body.version, 1);
  const config = await site.call("GET", "/site/v1/config", { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/config", config);
  assert.equal(config.body.support_whatsapp, "81312345678");
  assert.equal((await site.call("GET", "/site/v1/config", { ip: nextIp() })).body.support_whatsapp, "81312345678");

  assert.equal((await platform("super_admin", "PUT", "/site-settings", { support_whatsapp: "+44 20 7946 0000" })).status, 409, "设置过之后要带 If-Match");
  const cleared = await ok(platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null }, { "if-match": '"1"' }));
  assert.equal(cleared.support_whatsapp, null);
  assert.equal(cleared.version, 2);
  assert.equal((await site.call("GET", "/site/v1/config", { ip: nextIp() })).body.support_whatsapp, null);

  const audits = (await api.db.owner.query("select actor_type, action, before, after from audit_logs where resource = 'site_settings' order by id")).rows;
  assert.deepEqual(audits, [
    { actor_type: "platform_user", action: "update", before: { support_whatsapp: null, page_width: "standard" }, after: { support_whatsapp: "81312345678", page_width: "standard" } },
    { actor_type: "platform_user", action: "update", before: { support_whatsapp: "81312345678", page_width: "standard" }, after: { support_whatsapp: null, page_width: "standard" } },
  ]);
});

test("官网设置的页面宽度（M8-28）：三档、不给是不改、别的值 400；只有超级管理员能改；公开配置里给出；审计前后值", async () => {
  const current = await ok(platform("super_admin", "GET", "/site-settings"));
  assert.equal(current.page_width, "standard", "没改过是标准");
  const config = await site.call("GET", "/site/v1/config", { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/config", config);
  assert.equal(config.body.page_width, "standard");
  const ifMatch = (version: number) => ({ "if-match": `"${version}"` });

  for (const bad of ["narrow", "", "WIDE", 2, null]) {
    const res = await platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null, page_width: bad }, ifMatch(current.version));
    assert.equal(res.status, 400, String(bad));
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assert.ok(res.body.error.details.issues.some((issue: { path: string }) => issue.path === "/page_width"), res.text);
  }
  for (const { key: role } of PLATFORM_ROLES) {
    if (role !== "super_admin") assert.equal((await platform(role, "PUT", "/site-settings", { support_whatsapp: null, page_width: "wide" }, ifMatch(current.version))).status, 403, role);
  }
  assert.equal((await ok(platform("super_admin", "GET", "/site-settings"))).version, current.version, "被拒的请求什么都没改");

  const wide = await platform("super_admin", "PUT", "/site-settings", { support_whatsapp: "+81 3-1234-5678", page_width: "wide" }, ifMatch(current.version));
  assert.equal(wide.status, 200, wide.text);
  assertMatchesOpenApi("PUT", "/platform/v1/site-settings", wide);
  assert.equal(wide.body.page_width, "wide");
  assert.equal((await site.call("GET", "/site/v1/config", { ip: nextIp() })).body.page_width, "wide");

  const numberOnly = await ok(platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null }, ifMatch(wide.body.version)));
  assert.equal(numberOnly.page_width, "wide", "只改号码的请求不动页面宽度");
  assert.equal(numberOnly.support_whatsapp, null);

  const full = await ok(platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null, page_width: "full" }, ifMatch(numberOnly.version)));
  assert.equal(full.page_width, "full");
  assert.equal((await site.call("GET", "/site/v1/config", { ip: nextIp() })).body.page_width, "full");
  const same = await ok(platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null, page_width: "full" }, ifMatch(full.version)));
  assert.equal(same.version, full.version, "没变化不加版本、不记审计");

  const audits = (await api.db.owner.query("select before, after from audit_logs where resource = 'site_settings' order by id")).rows.slice(-3);
  assert.deepEqual(audits, [
    { before: { support_whatsapp: null, page_width: "standard" }, after: { support_whatsapp: "81312345678", page_width: "wide" } },
    { before: { support_whatsapp: "81312345678", page_width: "wide" }, after: { support_whatsapp: null, page_width: "wide" } },
    { before: { support_whatsapp: null, page_width: "wide" }, after: { support_whatsapp: null, page_width: "full" } },
  ]);

  await ok(platform("super_admin", "PUT", "/site-settings", { support_whatsapp: null, page_width: "standard" }, ifMatch(full.version)));
});

test("到期清除：关闭 180 天后、或提交 365 天后清空联系方式、地点和备注；行和跟进记录留下；之后不能再跟进；每批一条审计", async () => {
  await submit({ email: nextEmail() });
  const closing = await latest();
  await ok(platform("customer_service", "POST", `/manual-quote-requests/${closing.id}/notes`, { note: "清除测试的备注" }), 201);
  await ok(platform("customer_service", "PATCH", `/manual-quote-requests/${closing.id}`, { status: "closed" }, { "if-match": `"${closing.version}"` }));
  api.clock.advance(1_000);
  await submit({ email: nextEmail() });
  const open = await latest();

  api.clock.advance(179 * 86_400_000);
  // 拨了时钟，登录都过期了：客服重新登录（放在最后一个用例，前面的用例不受影响）
  const relogin = async (): Promise<void> => {
    const cs = staff.get("customer_service") as Staff;
    const login = await ok(api.platformLogin({ body: { email: cs.email, password: TEST_PASSWORD } }));
    staff.set("customer_service", { ...cs, token: login.access_token });
  };
  assert.equal((await api.app.manualQuoteRetention.tick()).purged, 0, "还没满 180 天");
  api.clock.advance(86_400_000);
  const first = await api.app.manualQuoteRetention.tick();
  assert.ok(first.purged >= 1);
  const purged = (await api.db.owner.query("select contact_enc, email_bidx, whatsapp_bidx, dedup_key, purged_at, status from manual_quote_requests where id = $1", [closing.id])).rows[0];
  assert.equal(purged.contact_enc, null);
  assert.equal(purged.email_bidx, null);
  assert.equal(purged.dedup_key, null);
  assert.notEqual(purged.purged_at, null);
  assert.equal(purged.status, "closed");
  assert.equal((await api.db.owner.query("select count(*)::int as n from manual_quote_request_events where request_id = $1 and note_enc is not null", [closing.id])).rows[0].n, 0);
  assert.equal((await api.db.owner.query("select purged_at from manual_quote_requests where id = $1", [open.id])).rows[0].purged_at, null, "没关闭的还在");

  await relogin();
  const detail = await platform("customer_service", "GET", `/manual-quote-requests/${closing.id}`);
  assert.equal(detail.status, 200, detail.text);
  assertMatchesOpenApi("GET", "/platform/v1/manual-quote-requests/{id}", detail);
  assert.equal(detail.body.contact, null);
  assert.equal(detail.body.pickup, null);
  assert.equal(detail.body.events.find((event: { kind: string }) => event.kind === "note").note, null);
  const after = (await ok(platform("customer_service", "GET", `/manual-quote-requests/${closing.id}`))).request;
  const reopen = await platform("customer_service", "PATCH", `/manual-quote-requests/${closing.id}`, { status: "following" }, { "if-match": `"${after.version}"` });
  assert.equal(reopen.status, 409);
  assert.equal(reopen.body.error.code, "MANUAL_QUOTE_PURGED");
  assert.equal((await platform("customer_service", "POST", `/manual-quote-requests/${closing.id}/notes`, { note: "再写" })).status, 409);

  api.clock.advance(186 * 86_400_000);
  await api.app.manualQuoteRetention.tick();
  assert.notEqual((await api.db.owner.query("select purged_at from manual_quote_requests where id = $1", [open.id])).rows[0].purged_at, null, "提交满 365 天，没关闭也清除");

  const audits = (await api.db.owner.query("select actor_type, resource_id, after from audit_logs where resource = 'manual_quote_request' and action = 'anonymize_passenger' order by id")).rows;
  assert.ok(audits.length >= 2);
  assert.deepEqual(Object.keys(audits[0].after).sort(), ["count", "created_before", "finished_before"]);
  assert.equal(audits[0].actor_type, "system");
  assert.equal(audits[0].resource_id, null);
});
