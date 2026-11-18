/**
 * M9E-26：嵌入码的「预订页地址」和两段代码（ADR 0095 附录 A），经真实接口、真实 PostgreSQL。
 *
 * 覆盖：booking_url 选填、规范化、https、必须落在这个嵌入码白名单的某个网站下（同源、带路径）、长度；
 * 改白名单后旧值的口径（拿掉了预订页的网站就 400，要同时改或清空；没填 booking_url 的旧客户端同样 400；把网站留着照常保存）；
 * 修改不填保持原值、null / 空白清空；两段代码（填了 + 允许整页嵌入 → ①带 bookingUrl、②mountBooking；否则只有①、和以前逐字一样）；
 * 权限（只读能看改不了、主数据运营看不到）；If-Match；审计；`/embed/v1/config` 不返回它（只加不减）；迁移只加列、旧行为空。
 * 测试数据全在本文件里建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { embedSnippet } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Staff, addStaff } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let root: string;
let staff: Record<"operations" | "cm" | "readonly" | "masterData", Staff>;
const PARTNER = "https://partner.example";
const OTHER = "https://other.example";
const BOOKING = `${PARTNER}/booking/`;
const BASE = { name: "合作网站", default_lang: "ja", default_services: ["transfer", "charter"] };

let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.96.${Math.floor(ipSeq / 200)}.${ipSeq % 200}`;
};

const create = (body: Record<string, unknown>, token = staff.operations.token) => api.call("POST", "/platform/v1/embed-keys", { token, body: { ...BASE, allowed_origins: [PARTNER], ...body } });

async function newKey(body: Record<string, unknown> = {}): Promise<any> {
  const res = await create(body);
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/embed-keys", res);
  return res.body;
}

/** 修改：默认带上新建时的全部字段（不带 booking_url，等于只认识旧字段的客户端） */
const patchKey = (key: { id: string; version: number }, body: Record<string, unknown>, token = staff.operations.token) =>
  api.call("PATCH", `/platform/v1/embed-keys/${key.id}`, { token, headers: { "if-match": `"${key.version}"` }, body: { ...BASE, allowed_origins: [PARTNER], status: "active", ...body } });

const issuesOf = (res: { body: any }): string[] => (res.body.error?.details?.issues ?? []).map((issue: any) => `${issue.path}:${issue.reason}`);

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  staff = {
    operations: await addStaff(api, root, "ops@embed-booking.test", "operations"),
    cm: await addStaff(api, root, "cm@embed-booking.test", "channel_manager"),
    readonly: await addStaff(api, root, "ro@embed-booking.test", "readonly"),
    masterData: await addStaff(api, root, "md@embed-booking.test", "master_data"),
  };
});

after(async () => {
  await api.close();
});

test("迁移只加列：booking_url 可空、没有默认值；已有的嵌入码（不填）为 null，要放的代码和以前逐字一样", async () => {
  const column = await api.db.owner.query<{ is_nullable: string; column_default: string | null }>(
    "select is_nullable, column_default from information_schema.columns where table_schema = current_schema() and table_name = 'embed_keys' and column_name = 'booking_url'",
  );
  assert.deepEqual(column.rows, [{ is_nullable: "YES", column_default: null }]);
  const plain = await newKey();
  assert.equal(plain.booking_url, null);
  assert.equal(plain.booking_snippet, null);
  assert.equal(plain.snippet_fallback, "no_booking_url");
  const siteOrigin = new URL(/src="([^"]+)"/.exec(plain.snippet)?.[1] ?? "").origin;
  assert.equal(plain.snippet, embedSnippet(siteOrigin, plain.key, "ja", ["transfer", "charter"]), "和 M9E-26 之前逐字一样");
  assert.doesNotMatch(plain.snippet, /bookingUrl/);
});

test("填写：规范化后存；https、同源带路径；写法不对、太长、网站不在白名单 400（/booking_url）；空白 = 没填", async () => {
  const created = await newKey({ allowed_origins: [PARTNER, OTHER], booking_url: "  https://Partner.Example:443/booking/?from=nozomi#top " });
  assert.equal(created.booking_url, `${PARTNER}/booking/?from=nozomi#top`);
  assert.equal((await newKey({ booking_url: "   " })).booking_url, null);
  assert.equal((await newKey({ booking_url: null })).booking_url, null);
  assert.equal((await newKey({ allowed_origins: [PARTNER, OTHER], booking_url: `${OTHER}/ja/reserve` })).booking_url, `${OTHER}/ja/reserve`, "白名单里任意一项都行");

  const cases: [unknown, string][] = [
    ["http://partner.example/booking/", "/booking_url:INVALID"],
    ["https://user:pass@partner.example/booking/", "/booking_url:INVALID"],
    ["/booking/", "/booking_url:INVALID"],
    ["javascript:alert(1)", "/booking_url:INVALID"],
    ["https://partner.example.evil.example/booking/", "/booking_url:NOT_ALLOWED_ORIGIN"],
    ["https://www.partner.example/booking/", "/booking_url:NOT_ALLOWED_ORIGIN"],
    ["https://partner.example:8443/booking/", "/booking_url:NOT_ALLOWED_ORIGIN"],
    [`${OTHER}/booking/`, "/booking_url:NOT_ALLOWED_ORIGIN"],
    [`${PARTNER}/${"a".repeat(2_001)}`, "/booking_url:OUT_OF_RANGE"],
  ];
  for (const [value, issue] of cases) {
    const res = await create({ booking_url: value });
    assert.equal(res.status, 400, String(value).slice(0, 60));
    assert.deepEqual(issuesOf(res), [issue], String(value).slice(0, 60));
  }
  for (const value of [42, true, ["https://partner.example/booking/"]]) assert.equal((await create({ booking_url: value })).status, 400, JSON.stringify(value));
  const message = (await create({ booking_url: `${OTHER}/booking/` })).body.error.details.issues[0].message as string;
  assert.match(message, /不在「允许的网站」里/);
});

test("两段代码：填了预订页地址并开了「允许整页嵌入」才有②，①的 init 带 bookingUrl；只填地址或只开开关都只有①，①不带 bookingUrl", async () => {
  const both = await newKey({ booking_url: BOOKING, allow_host_page: true });
  assert.equal(both.snippet_fallback, null);
  assert.match(both.snippet, new RegExp(`NozomiBooking\\.init\\(\\{ key: "${both.key}", root: "#nozomi-booking", lang: "ja", services: \\["transfer","charter"\\], bookingUrl: "https://partner\\.example/booking/" \\}\\);`));
  assert.match(both.booking_snippet, new RegExp(`NozomiBooking\\.mountBooking\\(\\{ key: "${both.key}", root: "#nozomi-booking-flow", lang: "ja" \\}\\);`));
  assert.match(both.booking_snippet, /^<div id="nozomi-booking-flow"><\/div>\n<script src="[^"]+\/embed\/widget-v1\.js" defer><\/script>/);

  const legacy = (await newKey()).snippet.replace(/nze_[A-Za-z0-9_-]{32}/, "KEY");
  const urlOnly = await newKey({ booking_url: BOOKING });
  assert.equal(urlOnly.snippet_fallback, "host_page_off");
  assert.equal(urlOnly.booking_snippet, null);
  assert.equal(urlOnly.snippet.replace(urlOnly.key, "KEY"), legacy, "只填地址：①和没填时逐字一样");
  const switchOnly = await newKey({ allow_host_page: true });
  assert.equal(switchOnly.snippet_fallback, "no_booking_url");
  assert.equal(switchOnly.booking_snippet, null);
  assert.equal(switchOnly.snippet.replace(switchOnly.key, "KEY"), legacy);

  // 关掉开关，②马上消失；再打开又出现
  const closed = await patchKey(both, { booking_url: BOOKING, allow_host_page: false });
  assert.equal(closed.status, 200, closed.text);
  assert.equal(closed.body.booking_snippet, null);
  assert.equal(closed.body.snippet_fallback, "host_page_off");
  assert.doesNotMatch(closed.body.snippet, /bookingUrl/);
  const listed = await api.call("GET", "/platform/v1/embed-keys", { token: staff.readonly.token });
  assertMatchesOpenApi("GET", "/platform/v1/embed-keys", listed);
  const item = listed.body.items.find((one: any) => one.id === both.id);
  assert.equal(item.booking_url, BOOKING, "只读角色在列表里看得到预订页地址");
});

test("改白名单后旧值的口径：拿掉了预订页的网站就 400（NOT_ALLOWED_ORIGIN），要同时改或清空；没带 booking_url 的旧客户端同样 400；网站留着照常保存", async () => {
  const key = await newKey({ allowed_origins: [PARTNER, OTHER], booking_url: BOOKING, allow_host_page: true });

  const dropped = await patchKey(key, { allowed_origins: [OTHER], booking_url: BOOKING });
  assert.equal(dropped.status, 400, dropped.text);
  assert.deepEqual(issuesOf(dropped), ["/booking_url:NOT_ALLOWED_ORIGIN"]);
  const legacyClient = await patchKey(key, { allowed_origins: [OTHER] });
  assert.equal(legacyClient.status, 400, "没带 booking_url = 保持原值，原值也要在这次的白名单里");
  assert.deepEqual(issuesOf(legacyClient), ["/booking_url:NOT_ALLOWED_ORIGIN"]);
  const unchanged = await api.call("GET", `/platform/v1/embed-keys/${key.id}`, { token: staff.operations.token });
  assert.deepEqual([unchanged.body.version, unchanged.body.allowed_origins, unchanged.body.booking_url], [key.version, [PARTNER, OTHER], BOOKING], "被拒时什么都没改");

  const kept = await patchKey(key, { allowed_origins: [PARTNER], name: "只拿掉别的网站" });
  assert.equal(kept.status, 200, kept.text);
  assert.equal(kept.body.booking_url, BOOKING, "没带 booking_url：保持原值");
  assert.ok(kept.body.booking_snippet !== null);

  const moved = await patchKey(kept.body, { allowed_origins: [OTHER], booking_url: `${OTHER}/booking/` });
  assert.equal(moved.status, 200, moved.text);
  assert.equal(moved.body.booking_url, `${OTHER}/booking/`, "同时改预订页地址");
  assert.match(moved.body.snippet, /bookingUrl: "https:\/\/other\.example\/booking\/"/);

  const cleared = await patchKey(moved.body, { allowed_origins: [PARTNER], booking_url: null });
  assert.equal(cleared.status, 200, cleared.text);
  assert.equal(cleared.body.booking_url, null, "同时清空");
  assert.equal(cleared.body.booking_snippet, null);
  assert.equal(cleared.body.snippet_fallback, "no_booking_url");
  const blank = await patchKey(cleared.body, { booking_url: "" });
  assert.equal(blank.status, 200, blank.text);
  assert.equal(blank.body.booking_url, null, "空字符串也是清空");

  // 停用、启用（后台只改状态）不受影响
  const withUrl = await newKey({ booking_url: BOOKING, allow_host_page: true });
  const disabled = await patchKey(withUrl, { booking_url: BOOKING, allow_host_page: true, status: "disabled" });
  assert.equal(disabled.status, 200, disabled.text);
  assert.equal(disabled.body.booking_url, BOOKING);
});

test("库里的旧值不在白名单（绕过接口写进去的）：读的时候也只给①、不带 bookingUrl", async () => {
  const key = await newKey({ allow_host_page: true });
  await api.db.owner.query("update embed_keys set booking_url = $2 where id = $1", [key.id, `${OTHER}/booking/`]);
  const detail = await api.call("GET", `/platform/v1/embed-keys/${key.id}`, { token: staff.operations.token });
  assert.equal(detail.status, 200);
  assertMatchesOpenApi("GET", "/platform/v1/embed-keys/{id}", detail);
  assert.equal(detail.body.snippet_fallback, "booking_url_not_allowed");
  assert.equal(detail.body.booking_snippet, null);
  assert.doesNotMatch(detail.body.snippet, /bookingUrl/);
  const tooLong = await api.db.owner.query("update embed_keys set booking_url = $2 where id = $1", [key.id, "x".repeat(2_001)]).then(
    () => null,
    (err: { code?: string }) => err.code,
  );
  assert.equal(tooLong, "23514", "库里兜底：超过 2,000 字符违反检查约束");
});

test("权限、If-Match、审计：运营、渠道经理能填；只读看得到改不了；主数据运营看不到；版本不对 409、不带 428；前后值写进审计", async () => {
  const byCm = await create({ booking_url: BOOKING }, staff.cm.token);
  assert.equal(byCm.status, 201, byCm.text);
  assert.equal((await create({ booking_url: BOOKING }, staff.readonly.token)).status, 403);
  assert.equal((await create({ booking_url: BOOKING }, staff.masterData.token)).status, 403);
  assert.equal((await api.call("GET", `/platform/v1/embed-keys/${byCm.body.id}`, { token: staff.masterData.token })).status, 403);
  assert.equal((await patchKey(byCm.body, { booking_url: null }, staff.readonly.token)).status, 403);

  const key = await newKey();
  assert.equal((await patchKey({ id: key.id, version: key.version + 3 }, { booking_url: BOOKING })).status, 409);
  const noHeader = await api.call("PATCH", `/platform/v1/embed-keys/${key.id}`, { token: staff.operations.token, body: { ...BASE, allowed_origins: [PARTNER], status: "active", booking_url: BOOKING } });
  assert.equal(noHeader.status, 428);
  const filled = await patchKey(key, { booking_url: BOOKING });
  assert.equal(filled.status, 200, filled.text);
  assertMatchesOpenApi("PATCH", "/platform/v1/embed-keys/{id}", filled);
  const cleared = await patchKey(filled.body, { booking_url: null });
  assert.equal(cleared.status, 200, cleared.text);

  const audits = await api.db.owner.query<{ action: string; before: { booking_url?: string | null } | null; after: { booking_url?: string | null } }>(
    "select action, before, after from audit_logs where resource = 'embed_key' and resource_id = $1 order by id",
    [key.id],
  );
  assert.deepEqual(
    audits.rows.map((row) => [row.action, row.before === null ? "-" : row.before.booking_url, row.after.booking_url]),
    [
      ["create", "-", null],
      ["update", null, BOOKING],
      ["update", BOOKING, null],
    ],
  );
});

test("公开接口不变：/embed/v1/config 不返回预订页地址（只加不减，字段和以前一样）；frame-check 不看预订页地址", async () => {
  const key = await newKey({ booking_url: BOOKING, allow_host_page: true });
  const config = await api.call("GET", `/embed/v1/config?key=${key.key}`, { ip: nextIp(), headers: { origin: PARTNER } });
  assert.equal(config.status, 200, config.text);
  assert.deepEqual(Object.keys(config.body).sort(), ["lang", "layout", "services", "site_origin"]);
  assert.ok(!config.text.includes("booking"), "应答里没有预订页地址");
  const check = await api.call("GET", `/embed/v1/frame-check?key=${encodeURIComponent(key.key)}&host=${encodeURIComponent(PARTNER)}`, { ip: nextIp() });
  assert.equal(check.status, 204);
  const noUrl = await newKey({ allow_host_page: true });
  const stillOk = await api.call("GET", `/embed/v1/frame-check?key=${encodeURIComponent(noUrl.key)}&host=${encodeURIComponent(PARTNER)}`, { ip: nextIp() });
  assert.equal(stillOk.status, 204, "没填预订页地址也照样能嵌（已经按 M9E-16 接好的合作网站不受影响）");
});
