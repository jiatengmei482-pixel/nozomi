/**
 * M3-02：司机、车辆的管理（ADR 0027），经真实接口、真实 PostgreSQL。新增（幂等）、修改（版本号）、停用、校验、唯一、审计、权限。
 * 跨租户的验证在 tenant-isolation.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { newDriver, newVehicle } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const driverBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "佐藤一郎", phone: "+81 90-1111-2222", languages: ["ja", "en"], license_expires_on: "2028-03-31", driving_years: 15, gold: true, ...extra });

test("司机：新增（电话统一成国际格式、默认在职）、同一个幂等键重放、查看、列表、修改要带版本号、内容没变不加版本", async () => {
  const key = randomUUID();
  const created = await api.call("POST", "/tenant/v1/drivers", { token: m.a.adminToken, headers: { "idempotency-key": key }, body: driverBody() });
  assert.equal(created.status, 201, created.text);
  assertMatchesOpenApi("POST", "/tenant/v1/drivers", created);
  assert.deepEqual([created.body.phone, created.body.status, created.body.version, created.body.license_state], ["+819011112222", "active", 1, "valid"]);
  const replay = await api.call("POST", "/tenant/v1/drivers", { token: m.a.adminToken, headers: { "idempotency-key": key }, body: driverBody() });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.id, created.body.id);
  const reused = await api.call("POST", "/tenant/v1/drivers", { token: m.a.adminToken, headers: { "idempotency-key": key }, body: driverBody({ name: "别人" }) });
  assert.equal(reused.status, 422);
  assert.equal(reused.body.error.code, "IDEMPOTENCY_KEY_REUSED");

  const read = await api.call("GET", `/tenant/v1/drivers/${created.body.id}`, { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/drivers/{id}", read);
  const list = await api.call("GET", "/tenant/v1/drivers?q=佐藤", { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/drivers", list);
  assert.deepEqual(list.body.items.map((item: { id: string }) => item.id), [created.body.id]);

  const noVersion = await api.call("PUT", `/tenant/v1/drivers/${created.body.id}`, { token: m.a.adminToken, body: { ...driverBody(), status: "active" } });
  assert.equal(noVersion.status, 428);
  const same = await api.call("PUT", `/tenant/v1/drivers/${created.body.id}`, { token: m.a.adminToken, headers: { "if-match": '"1"' }, body: { ...driverBody(), status: "active" } });
  assert.equal(same.body.version, 1, "内容没变不加版本");
  const changed = await api.call("PUT", `/tenant/v1/drivers/${created.body.id}`, { token: m.a.adminToken, headers: { "if-match": '"1"' }, body: { ...driverBody({ languages: ["ja"] }), status: "active" } });
  assertMatchesOpenApi("PUT", "/tenant/v1/drivers/{id}", changed);
  assert.deepEqual([changed.body.version, changed.body.languages], [2, ["ja"]]);
  const stale = await api.call("PUT", `/tenant/v1/drivers/${created.body.id}`, { token: m.a.adminToken, headers: { "if-match": '"1"' }, body: { ...driverBody(), status: "active" } });
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details.current_version], [409, "VERSION_CONFLICT", 2]);
});

test("司机：电话要国际格式、语言来自主数据、同一个供应商里电话不能重复；停用（DELETE）后可以改回在职；全程写审计日志", async () => {
  const bad = await api.call("POST", "/tenant/v1/drivers", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: driverBody({ phone: "090-1234-5678", languages: ["fr"] }) });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((issue: { path: string }) => issue.path), ["/phone", "/languages/0"]);
  const driver = await newDriver(api, m.a, { phone: "+81 80-3333-4444" });
  const dup = await api.call("POST", "/tenant/v1/drivers", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: driverBody({ phone: "+818033334444" }) });
  assert.deepEqual([dup.status, dup.body.error.code], [409, "DRIVER_PHONE_TAKEN"]);
  const otherTenant = await api.call("POST", "/tenant/v1/drivers", { token: m.b.adminToken, headers: { "idempotency-key": randomUUID() }, body: driverBody({ phone: "+818033334444" }) });
  assert.equal(otherTenant.status, 201, "别的供应商可以登记同一个电话（两家都雇了他）");

  const disabled = await api.call("DELETE", `/tenant/v1/drivers/${driver.id}`, { token: m.a.adminToken });
  assertMatchesOpenApi("DELETE", "/tenant/v1/drivers/{id}", disabled);
  assert.equal(disabled.body.status, "disabled");
  assert.equal((await api.call("DELETE", `/tenant/v1/drivers/${driver.id}`, { token: m.a.adminToken })).body.version, disabled.body.version, "再停用一次什么都不变");
  const back = await api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: m.a.adminToken, headers: { "if-match": `"${disabled.body.version}"` }, body: { ...driverBody({ phone: "+818033334444" }), status: "active" } });
  assert.equal(back.body.status, "active");
  const filtered = await api.call("GET", "/tenant/v1/drivers?status=disabled", { token: m.a.adminToken });
  assert.ok(!filtered.body.items.some((item: { id: string }) => item.id === driver.id));
  const logs = await api.db.owner.query<{ action: string }>("select action from audit_logs where resource = 'driver' and resource_id = $1 order by id", [driver.id]);
  assert.deepEqual(logs.rows.map((row) => row.action), ["create", "disable", "update"]);
});

test("车辆：新增、新车标记（< 5 万公里）、证件快到期提醒；非营业牌照不能设为可用；车牌不能重复；车型组必须存在", async () => {
  const fresh = await newVehicle(api, m.a, m.ids.biz7, { mileage_km: 12_000, insurance_expires_on: "2026-10-20" });
  assert.deepEqual([fresh.is_new, fresh.insurance_state, fresh.inspection_state, fresh.status], [true, "expiring", "valid", "available"]);
  const old = await newVehicle(api, m.a, m.ids.biz7, { mileage_km: 50_000 });
  assert.equal(old.is_new, false);
  const privatePlate = await api.call("POST", "/tenant/v1/vehicles", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { plate: "练马 500 さ 1", vehicle_group_id: m.ids.biz7, model: "x", seats: 7, mileage_km: 1, plate_type: "private", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01" } });
  assert.equal(privatePlate.status, 400);
  assert.equal(privatePlate.body.error.details.issues[0].reason, "PLATE_NOT_BUSINESS");
  const parked = await api.call("POST", "/tenant/v1/vehicles", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { plate: "练马 500 さ 1", vehicle_group_id: m.ids.biz7, model: "x", seats: 7, mileage_km: 1, plate_type: "private", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01", status: "maintenance" } });
  assert.equal(parked.status, 201, "非营业牌照的车可以登记（维修 / 停用），只是不能启用");
  assertMatchesOpenApi("POST", "/tenant/v1/vehicles", parked);
  const dup = await api.call("POST", "/tenant/v1/vehicles", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { plate: ` ${fresh.plate.replaceAll(" ", "  ")} `, vehicle_group_id: m.ids.biz7, model: "x", seats: 7, mileage_km: 1, plate_type: "business", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01" } });
  assert.deepEqual([dup.status, dup.body.error.code], [409, "VEHICLE_PLATE_TAKEN"], "空格不同也是同一个车牌");
  const unknownGroup = await api.call("POST", "/tenant/v1/vehicles", { token: m.a.adminToken, headers: { "idempotency-key": randomUUID() }, body: { plate: "x 1", vehicle_group_id: randomUUID(), model: "x", seats: 7, mileage_km: 1, plate_type: "business", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01" } });
  assert.deepEqual([unknownGroup.status, unknownGroup.body.error.details.issues[0].path], [400, "/vehicle_group_id"]);
  const enable = await api.call("PUT", `/tenant/v1/vehicles/${parked.body.id}`, { token: m.a.adminToken, headers: { "if-match": '"1"' }, body: { plate: "练马 500 さ 1", vehicle_group_id: m.ids.biz7, model: "x", color: "", seats: 7, mileage_km: 1, plate_type: "private", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01", status: "available" } });
  assert.equal(enable.status, 400, "非营业牌照车辆不能启用");
  const list = await api.call("GET", "/tenant/v1/vehicles?status=maintenance", { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/vehicles", list);
  assert.deepEqual(list.body.items.map((item: { id: string }) => item.id), [parked.body.id]);
  const disabled = await api.call("DELETE", `/tenant/v1/vehicles/${old.id}`, { token: m.a.adminToken });
  assertMatchesOpenApi("DELETE", "/tenant/v1/vehicles/{id}", disabled);
  assert.equal(disabled.body.status, "disabled");
  assertMatchesOpenApi("GET", "/tenant/v1/vehicles/{id}", await api.call("GET", `/tenant/v1/vehicles/${old.id}`, { token: m.a.adminToken }));
  assertMatchesOpenApi("PUT", "/tenant/v1/vehicles/{id}", await api.call("PUT", `/tenant/v1/vehicles/${old.id}`, { token: m.a.adminToken, headers: { "if-match": `"${disabled.body.version}"` }, body: { plate: old.plate, vehicle_group_id: m.ids.biz7, model: "丰田埃尔法", color: "白", seats: 7, mileage_km: 50_100, plate_type: "business", insurance_expires_on: "2030-01-01", inspection_expires_on: "2030-01-01", status: "maintenance" } }));
});

test("权限：调度能管司机车辆，只读能看不能改，商品价格、财务看不到", async () => {
  const dispatcher = await addTenantUser(api, m.a.adminToken, "dispatch@fleet.test", "dispatch");
  const readonly = await addTenantUser(api, m.a.adminToken, "ro@fleet.test", "readonly");
  const pricing = await addTenantUser(api, m.a.adminToken, "pricing@fleet.test", "pricing");
  assert.equal((await api.call("POST", "/tenant/v1/drivers", { token: dispatcher.token, headers: { "idempotency-key": randomUUID() }, body: driverBody({ phone: "+818055556666" }) })).status, 201);
  assert.equal((await api.call("GET", "/tenant/v1/drivers", { token: readonly.token })).status, 200);
  const denied = await api.call("POST", "/tenant/v1/vehicles", { token: readonly.token, headers: { "idempotency-key": randomUUID() }, body: {} });
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "fleet.manage"]);
  assert.equal((await api.call("GET", "/tenant/v1/vehicles", { token: pricing.token })).status, 403);
  assert.equal((await ok(api.call("GET", "/tenant/v1/drivers", { token: dispatcher.token }))).total >= 1, true);
});
