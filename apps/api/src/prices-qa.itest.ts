/**
 * M1-04 验收测试（测试工程师）：价格规则、调价规则、价格日历、取整单位、节假日。
 * 开发自己的测试在 prices.itest.ts 和 tenant-isolation.itest.ts；这里补的是：
 * - 价格日历经真实接口、真实数据库算出来的数，和一份独立写的对照实现逐日逐分钟核对；
 * - 并发、幂等、批量上限、全成或全败；
 * - 上架联动、日期边界（跨午夜、有夏令时的城市）、取整单位对已上架商品的影响；
 * - 混入别的供应商的编号、各角色的权限、平台节假日接口的权限；
 * - 应答和 openapi.yaml 逐字段（含嵌套、类型、多余字段）对账；规则 4。
 * 测试数据都在这里构造，结束时连同 schema 一起删除。时钟从 2026-10-07 10:00（东京）起，最后一个测试会拨过午夜。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
let other: TenantFixture;
let openapi: any;
const ids: Record<string, string> = {};
const MISSING = "99999999-9999-4999-8999-999999999999";
const TODAY = "2026-10-07";

const platform = (method: HttpMethod, path: string, body?: unknown, token: string = root): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });

interface Options {
  token?: string;
  body?: unknown;
  version?: number;
  key?: string | null;
}
const KEYED = /(^\/(products|brands|areas)$)|\/(price-rules|price-rules\/batch|adjust-rules)$/;
const call = (method: HttpMethod, path: string, options: Options = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && options.key !== null && KEYED.test(path) ? { "idempotency-key": options.key ?? randomUUID() } : {}),
    },
  });

async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

function issues(res: ApiResponse): [string, string | undefined][] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]);
}

const square = (lng: number, lat: number) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + 0.2, lat], [lng + 0.2, lat + 0.2], [lng, lat + 0.2], [lng, lat]]] });
let serial = 0;

async function area(options: { token?: string; city?: string; at?: [number, number] } = {}): Promise<string> {
  api.clock.advance(1_000);
  const [lng, lat] = options.at ?? [139.6, 35.6];
  const body = { city_id: options.city ?? ids["tokyo"], name: { zh: `验收区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: square(lng, lat) }] };
  return (await ok(call("POST", "/areas", { body, ...(options.token ? { token: options.token } : {}) }), 201)).id;
}

type Category = "airport_transfer" | "point_to_point" | "charter";

async function product(category: Category = "airport_transfer", extra: Record<string, unknown> = {}, token?: string): Promise<string> {
  api.clock.advance(1_000);
  const body = {
    brand_id: ids["brand"],
    city_id: ids["tokyo"],
    category,
    ...(category === "airport_transfer" ? { poi_id: ids["narita"] } : {}),
    areas: [{ area_id: ids["a1"] }, { area_id: ids["a2"] }],
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
    dispatchers: [{ name: "调度小王", phone: "09012345678" }],
    ...extra,
  };
  return (await ok(call("POST", "/products", { body, ...(token ? { token } : {}) }), 201)).id;
}

/** 除了价格规则，上架条件都满足。 */
async function publishable(category: Category = "airport_transfer", extra: Record<string, unknown> = {}): Promise<string> {
  const id = await product(category, extra);
  const freeWait = category === "airport_transfer" ? { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } : { general: { mode: "unlimited" } };
  const rules = await ok(call("PUT", `/products/${id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: freeWait } }));
  await ok(call("PUT", `/products/${id}/content`, { version: rules.version, body: { zh: { title: "验收商品", ...(category === "airport_transfer" ? { pickup_guide: "到达大厅 3 号门" } : {}) } } }));
  return id;
}

const version = async (productId: string, token?: string): Promise<number> => (await ok(call("GET", `/products/${productId}/price-rules`, token ? { token } : {}))).version;

const fixed = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "fixed", base_price: 20_000, valid_from: "2026-10-01", ...extra });
const adjustBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "旺季", cycle: { type: "daily" }, steps: [{ type: "percent", value: 2_000 }], ...extra });

async function addPrice(productId: string, body: Record<string, unknown>): Promise<any> {
  return (await ok(call("POST", `/products/${productId}/price-rules`, { version: await version(productId), body }), 201)).price_rule;
}
async function addAdjust(productId: string, body: Record<string, unknown>): Promise<any> {
  return (await ok(call("POST", `/products/${productId}/adjust-rules`, { version: await version(productId), body }), 201)).adjust_rule;
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
}
async function audits(resource: string, id: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_email, before, after from audit_logs where resource = $1 and resource_id = $2 order by id", [resource, id])).rows;
}
async function storedPrices(productId: string): Promise<any[]> {
  return (await api.db.owner.query("select id, area_id, vehicle_group_id, direction, package_hours, valid_from::text as valid_from, valid_to::text as valid_to, status, params from price_rules where product_id = $1 order by valid_from, id", [productId])).rows;
}

/** 库里同一个组合的日期重叠的对数（应当恒为 0）。 */
async function overlapsInDb(productId: string): Promise<number> {
  const result = await api.db.owner.query(
    `select count(*)::int as n from price_rules a join price_rules b
       on a.product_id = b.product_id and a.id < b.id and a.area_id = b.area_id and a.vehicle_group_id = b.vehicle_group_id
      and a.direction is not distinct from b.direction and a.package_hours is not distinct from b.package_hours
      and a.valid_from <= coalesce(b.valid_to, 'infinity') and b.valid_from <= coalesce(a.valid_to, 'infinity')
     where a.product_id = $1`,
    [productId],
  );
  return result.rows[0].n;
}

async function brandVersion(brandId: string): Promise<number> {
  return (await ok(call("GET", "/brands"))).items.find((item: any) => item.id === brandId).version;
}
async function setRounding(brandId: string, unit: number): Promise<void> {
  await ok(call("PUT", `/brands/${brandId}/rounding-unit`, { version: await brandVersion(brandId), body: { rounding_unit: unit } }));
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "验收甲车队", "qa-admin@a.test");
  other = await api.tenantWithAdmin(root, "验收乙车队", "qa-admin@b.test");
  openapi = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8"));
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["nyc"] = (await ok(platform("POST", "/master/cities", { country_code: "US", timezone: "America/New_York", code: "CTY-US-NYC", name: { zh: "纽约" }, center: { lng: -74.006, lat: 40.7128 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["lux4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "豪华 4 座" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "验收 JPY", currency: "JPY" } }), 201)).id;
  ids["a1"] = await area();
  ids["a2"] = await area();
  ids["a3"] = await area();
  // 乙车队：自己的子品牌、区域、商品、价格、调价
  ids["b-brand"] = (await ok(call("POST", "/brands", { token: other.adminToken, body: { name: "乙 JPY", currency: "JPY" } }), 201)).id;
  ids["b-area"] = await area({ token: other.adminToken });
  ids["b-product"] = await product("airport_transfer", { brand_id: ids["b-brand"], areas: [{ area_id: ids["b-area"] }] }, other.adminToken);
  ids["b-price"] = (await ok(call("POST", `/products/${ids["b-product"]}/price-rules`, { token: other.adminToken, version: 1, body: fixed({ area_id: ids["b-area"], base_price: 77_777 }) }), 201)).price_rule.id;
  ids["b-adjust"] = (await ok(call("POST", `/products/${ids["b-product"]}/adjust-rules`, { token: other.adminToken, version: 2, body: adjustBody({ name: "乙的秘密调价" }) }), 201)).adjust_rule.id;
});
after(() => api.close());

// ───────────── 对照实现（独立于 @nozomi/domain；写法见 packages/domain/src/pricing.oracle.qa.test.ts）─────────────

type Q = [bigint, bigint];
const qAdd = (a: Q, b: Q): Q => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
function qRound(a: Q, unit: bigint): bigint {
  const negative = a[0] < 0n;
  const n = negative ? -a[0] : a[0];
  const steps = (2n * n + unit * a[1]) / (2n * unit * a[1]);
  return (negative ? -steps : steps) * unit;
}
/** 写得尽的十进制字符串 → 分数。 */
function qText(text: string): Q {
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  return [BigInt(whole + fraction) * (negative ? -1n : 1n), 10n ** BigInt(fraction.length)];
}
const qSame = (a: Q, b: Q): boolean => a[0] * b[1] === b[0] * a[1];

function dayNumber(date: string): number {
  let y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
const weekdayOfDay = (day: number): number => ((((day + 3) % 7) + 7) % 7) + 1;
const minuteOf = (text: string): number => (text === "24:00" ? 1440 : Number(text.slice(0, 2)) * 60 + Number(text.slice(3, 5)));

interface OraclePrice {
  id: string;
  area_id: string;
  vehicle_group_id: string;
  direction: string | null;
  package_hours: number | null;
  lowest: number;
  valid_from: string;
  valid_to: string | null;
  status: string;
}
interface OracleAdjust {
  id: string;
  travel_from: string | null;
  travel_to: string | null;
  cycle: any;
  time_slot: { start: string; end: string } | null;
  area_ids: string[];
  vehicle_group_ids: string[];
  directions: string[];
  package_hours: number[];
  steps: { type: string; value: number }[];
  status: string;
}

function oracleDay(rule: OracleAdjust, day: number, holidayDays: ReadonlyMap<string, Set<number>>): boolean {
  if (rule.travel_from !== null && day < dayNumber(rule.travel_from)) return false;
  if (rule.travel_to !== null && day > dayNumber(rule.travel_to)) return false;
  if (rule.cycle.type === "weekly") return rule.cycle.weekdays.includes(weekdayOfDay(day));
  if (rule.cycle.type === "dates") return rule.cycle.dates.some((date: string) => dayNumber(date) === day);
  if (rule.cycle.type === "holidays") return rule.cycle.countries.some((country: string) => holidayDays.get(country)?.has(day) === true);
  return true;
}

function oracleQuote(
  prices: readonly OraclePrice[],
  adjusts: readonly OracleAdjust[],
  holidayDays: ReadonlyMap<string, Set<number>>,
  unit: number,
  query: { area: string; group: string; direction: string | null; hours: number | null; date: string; minute: number },
): { priceId: string | null; adjustIds: string[]; final: number | null; unrounded: Q | null } {
  const day = dayNumber(query.date);
  const live = prices.filter((price) => price.status === "enabled" && price.area_id === query.area && price.vehicle_group_id === query.group && price.package_hours === query.hours && dayNumber(price.valid_from) <= day && (price.valid_to === null || day <= dayNumber(price.valid_to)));
  const price = query.direction === null ? live.find((entry) => entry.direction === null) : (live.find((entry) => entry.direction === query.direction) ?? live.find((entry) => entry.direction === "both"));
  if (!price) return { priceId: null, adjustIds: [], final: null, unrounded: null };
  const matched = adjusts.filter((rule) => {
    if (rule.status !== "enabled") return false;
    if (rule.area_ids.length > 0 && !rule.area_ids.includes(query.area)) return false;
    if (rule.vehicle_group_ids.length > 0 && !rule.vehicle_group_ids.includes(query.group)) return false;
    if (rule.directions.length > 0 && (query.direction === null || !rule.directions.includes(query.direction))) return false;
    if (rule.package_hours.length > 0 && (query.hours === null || !rule.package_hours.includes(query.hours))) return false;
    if (rule.time_slot === null) return oracleDay(rule, day, holidayDays);
    const start = minuteOf(rule.time_slot.start);
    const end = minuteOf(rule.time_slot.end);
    if (start < end) return query.minute >= start && query.minute < end && oracleDay(rule, day, holidayDays);
    if (query.minute >= start) return oracleDay(rule, day, holidayDays);
    return query.minute < end && oracleDay(rule, day - 1, holidayDays);
  });
  let current: Q = [BigInt(price.lowest), 1n];
  for (const rule of matched) for (const step of rule.steps) current = step.type === "percent" ? [current[0] * BigInt(10_000 + step.value), current[1] * 10_000n] : qAdd(current, [BigInt(step.value), 1n]);
  const rounded = qRound(current, BigInt(unit));
  return { priceId: price.id, adjustIds: matched.map((rule) => rule.id), final: current[0] <= 0n || rounded <= 0n ? null : Number(rounded), unrounded: current };
}

/** 这条价格能报出的最低数（对照实现自己算，不用接口返回的 base）。 */
function lowestOf(rule: any): number {
  if (rule.pricing_model === "fixed") return rule.base_price;
  if (rule.pricing_model === "mileage_time") return rule.min_price !== null && rule.min_price > rule.start_price ? rule.min_price : rule.start_price;
  return rule.package_price;
}

/** 取这个商品的价格日历，和对照实现逐日逐分钟比；返回比过的分钟数和其中有价的。 */
async function compareCalendar(productId: string, query: { area: string; groups: string[]; direction: string | null; hours: number | null; from: string; to: string }, holidays: { country_code: string; date: string }[], token?: string): Promise<{ minutes: number; priced: number; adjusted: number; notPositive: number }> {
  const auth = token ? { token } : {};
  const priceView = await ok(call("GET", `/products/${productId}/price-rules`, auth));
  const prices: OraclePrice[] = priceView.items.map((item: any) => ({ ...item, lowest: lowestOf(item) }));
  const adjusts: OracleAdjust[] = (await ok(call("GET", `/products/${productId}/adjust-rules`, auth))).items;
  const unit: number = priceView.rounding_unit;
  const holidayDays = new Map<string, Set<number>>();
  for (const holiday of holidays) holidayDays.set(holiday.country_code, (holidayDays.get(holiday.country_code) ?? new Set<number>()).add(dayNumber(holiday.date)));
  const search = new URLSearchParams({ area_id: query.area, vehicle_group_id: query.groups.join(","), from: query.from, to: query.to, ...(query.direction ? { direction: query.direction } : {}), ...(query.hours ? { package_hours: String(query.hours) } : {}) });
  const view = await ok(call("GET", `/products/${productId}/price-calendar?${search}`, auth));
  assert.equal(view.rounding_unit, unit);
  assert.deepEqual(view.groups.map((group: any) => group.vehicle_group_id), query.groups);
  assert.deepEqual(view.days, view.groups[0].days, "days 是第一个车型组的");
  const stats = { minutes: 0, priced: 0, adjusted: 0, notPositive: 0 };
  for (const group of view.groups) {
    assert.equal(group.days.length, dayNumber(query.to) - dayNumber(query.from) + 1);
    for (const [index, day] of group.days.entries()) {
      assert.equal(dayNumber(day.date), dayNumber(query.from) + index, "日期连续");
      assert.equal(day.weekday, weekdayOfDay(dayNumber(day.date)), `${day.date} 的星期`);
      assert.equal(day.segments[0].from, "00:00");
      assert.equal(day.segments.at(-1).to, "24:00");
      for (const [position, segment] of day.segments.entries()) {
        if (position > 0) assert.equal(segment.from, day.segments[position - 1].to, `${day.date} 的段首尾相接`);
        // 应答自己内部要自洽：base + 各步 delta = unrounded；每一步 after = 上一步 + delta（只核对写得尽的）
        if (segment.base !== null) {
          let running = qText(segment.base);
          for (const adjust of segment.adjusts) {
            for (const step of adjust.steps) {
              const decimals = (text: string): number => (text.split(".")[1] ?? "").length;
              if (decimals(step.after) < 6 && decimals(step.delta) < 6) assert.ok(qSame(qAdd(running, qText(step.delta)), qText(step.after)), `${day.date} ${segment.from} 上一步 + delta = after`);
              running = qText(step.after);
            }
          }
          assert.equal(segment.unrounded, segment.adjusts.length === 0 ? segment.base : segment.adjusts.at(-1).steps.at(-1).after, `${day.date} ${segment.from} unrounded 是最后一步之后的数`);
        }
        for (let minute = minuteOf(segment.from); minute < minuteOf(segment.to); minute += 1) {
          const expected = oracleQuote(prices, adjusts, holidayDays, unit, { area: query.area, group: group.vehicle_group_id, direction: query.direction, hours: query.hours, date: day.date, minute });
          const where = `${day.date} ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")} 车型组 ${group.vehicle_group_id}`;
          stats.minutes += 1;
          assert.equal(segment.final, expected.final, `${where}：结算价`);
          assert.deepEqual(segment.adjusts.map((adjust: any) => adjust.rule_id), expected.adjustIds, `${where}：命中的调价规则和顺序`);
          if (expected.priceId === null) {
            assert.ok(["NO_RULE", "NOT_IN_EFFECT", "RULE_DISABLED"].includes(segment.no_price_reason), `${where}：没有价格的原因 ${segment.no_price_reason}`);
            assert.equal(segment.base, null);
            continue;
          }
          assert.equal(day.price_rule?.id, expected.priceId, `${where}：命中的价格规则`);
          assert.equal(segment.no_price_reason, expected.final === null ? "NOT_POSITIVE" : null, where);
          if ((segment.unrounded.split(".")[1] ?? "").length < 6) assert.ok(qSame(qText(segment.unrounded), expected.unrounded as Q), `${where}：取整前的精确值 ${segment.unrounded}`);
          if (expected.final === null) stats.notPositive += 1;
          else stats.priced += 1;
          if (expected.adjustIds.length > 0) stats.adjusted += 1;
        }
      }
    }
  }
  return stats;
}

// ───────────── 计算正确性（经真实接口）─────────────

test("价格日历和对照实现逐日逐分钟一致：接送机商品 62 天 × 两个方向 × 两个车型组，含接送通用 / 具体方向交替、生效日期两端、每周几跨午夜、指定日期跨月、节假日、适用范围、停用、顺序；取整单位 1 → 100 → 1000 各比一遍", async () => {
  const id = await product();
  const holidays = [{ country_code: "JP", date: "2026-10-12" }, { country_code: "JP", date: "2026-11-03" }, { country_code: "JP", date: "2026-11-23" }, { country_code: "JP", date: "2026-10-31" }, { country_code: "KR", date: "2026-10-09" }];
  for (const holiday of holidays) await ok(platform("PUT", `/holidays/${holiday.country_code}/${holiday.date}`, { name: { zh: "假日" } }), 201);
  await ok(
    call("POST", `/products/${id}/price-rules/batch`, {
      version: 1,
      body: {
        create: [
          fixed({ direction: "both", base_price: 20_050, valid_from: "2026-10-03", valid_to: "2026-11-15" }),
          fixed({ direction: "pickup", base_price: 23_333, valid_from: "2026-10-10", valid_to: "2026-10-20" }),
          fixed({ direction: "dropoff", base_price: 18_000, valid_from: "2026-10-25", valid_to: "2026-10-25" }),
          fixed({ direction: "pickup", base_price: 9_999, valid_from: "2026-11-01", valid_to: "2026-11-05", status: "disabled" }),
          fixed({ direction: "both", base_price: 26_449, valid_from: "2026-11-16", valid_to: null }),
          { area_id: ids["a1"], vehicle_group_id: ids["eco4"], direction: "both", pricing_model: "mileage_time", start_price: 3_000, start_meters: 10_000, start_minutes: 30, per_km: 333, per_minute: 7, min_price: 3_340, valid_from: "2026-10-01" },
          fixed({ area_id: ids["a2"], direction: "pickup", base_price: 600, valid_from: "2026-10-01" }),
        ],
      },
    }),
  );
  await addAdjust(id, adjustBody({ name: "旺季 +12.5%", travel_from: "2026-10-05", travel_to: "2026-11-20", steps: [{ type: "percent", value: 1_250 }] }));
  await addAdjust(id, adjustBody({ name: "周五和周日夜间 +3,333", cycle: { type: "weekly", weekdays: [5, 7] }, time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 3_333 }] }));
  await addAdjust(id, adjustBody({ name: "月末夜 −33.33% 再 −50", cycle: { type: "dates", dates: ["2026-10-31", "2026-11-30"] }, time_slot: { start: "23:00", end: "02:00" }, steps: [{ type: "percent", value: -3_333 }, { type: "amount", value: -50 }] }));
  await addAdjust(id, adjustBody({ name: "日本和韩国假日白天 −500", cycle: { type: "holidays", countries: ["JP", "KR"] }, time_slot: { start: "06:00", end: "24:00" }, steps: [{ type: "amount", value: -500 }] }));
  await addAdjust(id, adjustBody({ name: "只调区域二 −95%", area_ids: [ids["a2"]], steps: [{ type: "percent", value: -9_500 }] }));
  await addAdjust(id, adjustBody({ name: "只送机 +1", directions: ["dropoff"], steps: [{ type: "amount", value: 1 }] }));
  await addAdjust(id, adjustBody({ name: "只经济型，到 10-31 为止，凌晨 −0.01%", vehicle_group_ids: [ids["eco4"]], travel_to: "2026-10-31", time_slot: { start: "00:00", end: "05:00" }, steps: [{ type: "percent", value: -1 }] }));
  await addAdjust(id, adjustBody({ name: "停用的 +1000%", steps: [{ type: "percent", value: 100_000 }], status: "disabled" }));

  const total = { minutes: 0, priced: 0, adjusted: 0, notPositive: 0 };
  for (const unit of [1, 100, 1_000]) {
    await setRounding(ids["brand"] as string, unit);
    for (const direction of ["pickup", "dropoff"]) {
      for (const areaKey of ["a1", "a2"]) {
        const stats = await compareCalendar(id, { area: ids[areaKey] as string, groups: [ids["biz7"] as string, ids["eco4"] as string], direction, hours: null, from: "2026-10-01", to: "2026-12-01" }, holidays);
        for (const key of ["minutes", "priced", "adjusted", "notPositive"] as const) total[key] += stats[key];
      }
    }
  }
  await setRounding(ids["brand"] as string, 1);
  // 3 个取整单位 × 2 个方向 × 2 个区域 × 2 个车型组 × 62 天 × 1440 分钟
  assert.equal(total.minutes, 3 * 2 * 2 * 2 * 62 * 1440);
  // 区域二的 600：10-31（周六，假日）23:00 起 +12.5% → −33.33% −50 → −500，调完是负的——每条规则单独都存得进去，叠起来才不大于 0
  assert.ok(total.priced > 500_000 && total.adjusted > 300_000 && total.notPositive >= 3 * 60, JSON.stringify(total));
  // 调完重排顺序：把「只调区域二 −95%」提到最前，再比一遍（顺序即优先级）
  const rules = (await ok(call("GET", `/products/${id}/adjust-rules`))).items;
  const reordered = [rules[4].id, ...rules.filter((_: unknown, index: number) => index !== 4).map((rule: any) => rule.id)];
  await ok(call("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: reordered } }));
  await compareCalendar(id, { area: ids["a2"] as string, groups: [ids["biz7"] as string], direction: "pickup", hours: null, from: "2026-10-01", to: "2026-10-31" }, holidays);
});

test("负责人确认的口径，用具体的数经接口再算一遍：20,050 取整到 100 报 20,100；23,149.5 报 23,150；周五 22:00–06:00 的调价周六 05:59 还在、06:00 没了；12-31 为止的夜间规则元旦 01:00 还在", async () => {
  const id = await product("point_to_point");
  await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body: fixed({ direction: undefined, base_price: 20_050, valid_from: "2026-10-01" }) }), 201);
  const query = (from: string, to: string): string => `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&from=${from}&to=${to}`;
  const finals = async (from: string, to: string): Promise<any[]> => (await ok(call("GET", `/products/${id}/price-calendar?${query(from, to)}`))).days.map((day: any) => day.segments.map((segment: any) => [segment.from, segment.to, segment.final]));
  await setRounding(ids["brand"] as string, 100);
  assert.deepEqual(await finals("2026-10-09", "2026-10-09"), [[["00:00", "24:00", 20_100]]], "没有调价命中也取整");
  await setRounding(ids["brand"] as string, 1);
  assert.deepEqual(await finals("2026-10-09", "2026-10-09"), [[["00:00", "24:00", 20_050]]]);
  // +15.459% → 20050 × 1.15459 = 23149.5295；这里用 +15.4589% 不行（基点只有两位小数），改用两步：+15% 再 +92 = 23149.5
  const half = await addAdjust(id, adjustBody({ name: "恰好一半", steps: [{ type: "percent", value: 1_500 }, { type: "amount", value: 92 }], travel_from: "2026-10-09", travel_to: "2026-10-09" }));
  const day = (await ok(call("GET", `/products/${id}/price-calendar?${query("2026-10-09", "2026-10-09")}`))).days[0];
  // 20050 × 1.15 = 23057.5；+92 = 23149.5 → 23150
  assert.deepEqual([day.segments[0].base, day.segments[0].adjusts[0].steps.map((step: any) => [step.delta, step.after]), day.segments[0].unrounded, day.segments[0].final], ["20050", [["3007.5", "23057.5"], ["92", "23149.5"]], "23149.5", 23_150]);
  await ok(call("DELETE", `/products/${id}/adjust-rules/${half.id}`, { version: await version(id) }));
  // 2026-10-09 是周五
  await addAdjust(id, adjustBody({ name: "周五夜间", cycle: { type: "weekly", weekdays: [5] }, time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 1_000 }], travel_to: "2026-12-31" }));
  assert.deepEqual(await finals("2026-10-09", "2026-10-10"), [
    [["00:00", "22:00", 20_050], ["22:00", "24:00", 21_050]],
    [["00:00", "06:00", 21_050], ["06:00", "24:00", 20_050]],
  ]);
  // 2026-12-31 是周四、2027-01-01 是周五：把规则改成每天、到 12-31 为止
  const night = (await ok(call("GET", `/products/${id}/adjust-rules`))).items[0];
  await ok(call("PUT", `/products/${id}/adjust-rules/${night.id}`, { version: await version(id), body: adjustBody({ name: "年末夜间", time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 1_000 }], travel_to: "2026-12-31" }) }));
  assert.deepEqual(await finals("2026-12-31", "2027-01-02"), [
    [["00:00", "06:00", 21_050], ["06:00", "22:00", 20_050], ["22:00", "24:00", 21_050]],
    [["00:00", "06:00", 21_050], ["06:00", "24:00", 20_050]],
    [["00:00", "24:00", 20_050]],
  ]);
});

test("两位小数的币种（人民币）和包车：取整单位 0.01 / 0.1 / 1 / 10 / 100 元下的结算价和对照实现一致；包车套餐按套餐时长命中", async () => {
  const brand = (await ok(call("POST", "/brands", { body: { name: "验收 CNY", currency: "CNY" } }), 201)).id;
  const id = await product("charter", { brand_id: brand });
  const pkg = (hours: number, price: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ area_id: ids["a1"], vehicle_group_id: ids["biz7"], package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 400, valid_from: "2026-10-01", ...extra });
  // 980.05 元、1234.56 元、0.49 元（取整到 1 元时会是 0）
  const made = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: [pkg(8, 98_005), pkg(10, 123_456), pkg(4, 49, { vehicle_group_id: ids["eco4"] })] } }));
  await addAdjust(id, adjustBody({ name: "只调 10 小时 +7.77%", package_hours: [10], steps: [{ type: "percent", value: 777 }] }));
  await addAdjust(id, adjustBody({ name: "周末 −0.05 元", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "amount", value: -5 }] }));
  const seen = new Map<number, number[]>();
  for (const unit of [1, 10, 100, 1_000, 10_000]) {
    if (unit === 100) {
      // 0.49 元取整到 1 元是 0：现在改取整单位会被拦住（修缺陷之后的行为），要先把这条价格调高。
      // 调到 50.01 元：取整到 100 元时平日是 100 元，周末 −0.05 元后是 49.96 元 → 0（调价 + 取整之后报不出价，这一支照样和对照实现比）
      const refused = await call("PUT", `/brands/${brand}/rounding-unit`, { version: await brandVersion(brand), body: { rounding_unit: unit } });
      assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.price_count], [409, "ROUNDING_UNIT_ZEROES_PRICES", 1], refused.text);
      await ok(call("PUT", `/products/${id}/price-rules/${made.created_ids[2]}`, { version: await version(id), body: pkg(4, 5_001, { vehicle_group_id: ids["eco4"] }) }));
    }
    await setRounding(brand, unit);
    for (const hours of [8, 10, 4]) {
      await compareCalendar(id, { area: ids["a1"] as string, groups: [ids["biz7"] as string, ids["eco4"] as string], direction: null, hours, from: "2026-10-05", to: "2026-10-18" }, []);
    }
    const days = (await ok(call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&package_hours=10&from=2026-10-09&to=2026-10-10`))).days;
    seen.set(unit, days.map((day: any) => day.segments[0].final));
  }
  // 1234.56 × 1.0777 = 1330.485312 元 = 133048.5312 分；周六再 −5 分 = 133043.5312
  assert.deepEqual([...seen], [[1, [133_049, 133_044]], [10, [133_050, 133_040]], [100, [133_000, 133_000]], [1_000, [133_000, 133_000]], [10_000, [130_000, 130_000]]]);
  // 日元没有 100 倍主单位的取整单位（10000）；人民币有
  const jpy = await call("PUT", `/brands/${ids["brand"]}/rounding-unit`, { version: await brandVersion(ids["brand"] as string), body: { rounding_unit: 10_000 } });
  assert.deepEqual(issues(jpy), [["/rounding_unit", "OUT_OF_RANGE"]]);
});

test("【缺陷】存得进去的调价规则让价格日历整个打不开：两条各 10 步「上调 1000%」的规则（都在允许的范围内）连乘后超出可表示的整数，price-calendar 返回 500", async () => {
  const id = await product("point_to_point");
  await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body: fixed({ direction: undefined }) }), 201);
  const steps = Array.from({ length: 10 }, () => ({ type: "percent", value: 100_000 }));
  // 修之前：这两条规则都能保存（201），之后 price-calendar 是 500 INTERNAL_ERROR，这个商品的价格日历从此打不开，直到删掉规则。
  // 修之后：单独一条就把现有价格调过结算价上限的，保存时拦住（20,000 × 11^10 ≈ 5.2e14 > 一万亿）
  const refused = await call("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ name: "十步一千", steps }) });
  assert.deepEqual([refused.status, refused.body.error.details.issues.map((issue: any) => [issue.path, issue.reason, issue.detail.count])], [400, [["/steps", "ADJUST_RESULT_TOO_LARGE", 1]]], refused.text);
  // 每条单独都不过上限、叠起来超出安全整数的（三条各 7 步：20,000 × 11^21 ≈ 1.5e26）存得进去——日历照常打开，那一段给出「报不出价」的原因
  const seven = steps.slice(0, 7);
  for (const name of ["七步一千", "又七步一千", "再七步一千"]) await addAdjust(id, adjustBody({ name, steps: seven }));
  const res = await call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&from=2026-10-09&to=2026-10-09`);
  assert.notEqual(res.status, 500, `price-calendar 不应当是服务器内部错误：${res.text}`);
  assert.equal(res.status, 200, res.text);
  const segment = res.body.days[0].segments[0];
  assert.deepEqual([segment.final, segment.no_price_reason, segment.adjusts.length, segment.unrounded], [null, "OVER_LIMIT", 3, (20_000n * 11n ** 21n).toString()]);
  // 上架校验的「调价规则」一项（不拦上架）指出是哪几条叠出来的
  const adjustItem = (await ok(call("GET", `/products/${id}/publish-check`))).items.find((item: any) => item.key === "adjust_rules");
  assert.deepEqual([adjustItem.required, adjustItem.passed, adjustItem.issues.map((issue: any) => [issue.path, issue.reason, issue.detail.names, issue.detail.price_count])], [false, false, [["/stacks/0", "ADJUST_STACK_OVER_LIMIT", "七步一千、又七步一千、再七步一千", 1]]]);
});

// ───────────── 唯一性、批量、并发、幂等 ─────────────

test("批量保存按保存之后的样子判断重叠：先删后加同一个组合、两条互换日期、把一条拆成前后两段都可以；批内两条新增互相重叠、新增撞上没动的旧规则都被拒绝并指明是谁；同一条既改又删是 400", async () => {
  const id = await product();
  const first = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: [fixed({ valid_from: "2026-10-01", valid_to: "2026-10-31", ref: "十月" }), fixed({ valid_from: "2026-11-01", valid_to: "2026-11-30", base_price: 22_000, ref: "十一月" })] } }));
  const [october, november] = first.created_ids as [string, string];
  // 互换日期：单看任何一条都撞上另一条的旧日期，但保存之后不重叠
  const swapped = await ok(
    call("POST", `/products/${id}/price-rules/batch`, { version: first.version, body: { update: [{ id: october, ...fixed({ valid_from: "2026-11-01", valid_to: "2026-11-30" }) }, { id: november, ...fixed({ valid_from: "2026-10-01", valid_to: "2026-10-31", base_price: 22_000 }) }] } }),
  );
  assert.deepEqual(swapped.items.map((item: any) => [item.id, item.valid_from, item.base_price]).sort(), [[october, "2026-11-01", 20_000], [november, "2026-10-01", 22_000]].sort());
  // 把十月那条（现在是 november）删掉，换成前后两段，中间留一天空档给第三条
  const split = await ok(
    call("POST", `/products/${id}/price-rules/batch`, {
      version: swapped.version,
      body: { delete: [november], create: [fixed({ valid_from: "2026-10-01", valid_to: "2026-10-15", ref: "上半" }), fixed({ valid_from: "2026-10-17", valid_to: "2026-10-31", ref: "下半" }), fixed({ valid_from: "2026-10-16", valid_to: "2026-10-16", base_price: 30_000, ref: "当天" })] },
    }),
  );
  assert.equal(split.items.length, 4);
  assert.equal(await overlapsInDb(id), 0);
  const count = await auditCount();
  // 批内两条新增互相重叠（都没撞上库里的）
  const mutual = await call("POST", `/products/${id}/price-rules/batch`, { version: split.version, body: { create: [fixed({ valid_from: "2027-01-01", valid_to: "2027-01-31", ref: "甲" }), fixed({ valid_from: "2027-01-31", valid_to: "2027-02-28", ref: "乙" }), fixed({ direction: "dropoff", valid_from: "2027-01-01", ref: "不相干" })] } });
  assert.deepEqual([mutual.status, mutual.body.error.code], [409, "PRICE_RULE_CONFLICT"], mutual.text);
  assert.deepEqual(mutual.body.error.details.conflicts, [
    { ref: "甲", valid_from: "2027-01-01", valid_to: "2027-01-31", with: [{ ref: "乙", valid_from: "2027-01-31", valid_to: "2027-02-28" }] },
    { ref: "乙", valid_from: "2027-01-31", valid_to: "2027-02-28", with: [{ ref: "甲", valid_from: "2027-01-01", valid_to: "2027-01-31" }] },
  ]);
  // 新增的撞上没动的旧规则（开放结束的新规则压住后面所有的）
  const open = await call("POST", `/products/${id}/price-rules/batch`, { version: split.version, body: { create: [fixed({ valid_from: "2026-10-16", ref: "开放" })] } });
  assert.equal(open.body.error.code, "PRICE_RULE_CONFLICT");
  assert.deepEqual(open.body.error.details.conflicts[0].with.map((entry: any) => entry.valid_from).sort(), ["2026-10-16", "2026-10-17", "2026-11-01"]);
  // 删掉一条、同一批里又改它
  const both = await call("POST", `/products/${id}/price-rules/batch`, { version: split.version, body: { update: [{ id: october, ...fixed({ base_price: 1 }) }], delete: [october] } });
  assert.deepEqual(issues(both), [["/delete/0", "DUPLICATE"]]);
  // 同一条删两次
  const twice = await call("POST", `/products/${id}/price-rules/batch`, { version: split.version, body: { delete: [october, october] } });
  assert.deepEqual(issues(twice), [["/delete/1", "DUPLICATE"]]);
  // 失败的都没有留下任何东西：价格、版本号、审计日志
  assert.deepEqual([(await ok(call("GET", `/products/${id}/price-rules`))).version, (await storedPrices(id)).length, await auditCount()], [split.version, 4, count]);
  // 停用的也占日期；相邻一天可以
  const disabled = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: split.version, body: { create: [fixed({ valid_from: "2027-03-01", valid_to: "2027-03-31", status: "disabled", ref: "停用" })] } }));
  const hit = await call("POST", `/products/${id}/price-rules`, { version: disabled.version, body: fixed({ valid_from: "2027-03-31", valid_to: "2027-04-30" }) });
  assert.equal(hit.body.error.code, "PRICE_RULE_CONFLICT");
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: disabled.version, body: fixed({ valid_from: "2027-04-01", valid_to: "2027-04-30" }) })).status, 201);
  assert.equal(await overlapsInDb(id), 0);
});

test("批量上限：一次正好 500 条可以，501 条被拒绝（新增、修改、删除合计）；500 条里有一条写错，一条都不保存，也不留审计日志", async () => {
  const id = await product();
  const day = (index: number): string => new Date(Date.UTC(2027, 0, 1 + index)).toISOString().slice(0, 10);
  const rows = (count: number, offset = 0): Record<string, unknown>[] => Array.from({ length: count }, (_, index) => fixed({ valid_from: day(offset + index), valid_to: day(offset + index), base_price: 10_000 + index, ref: `r${offset + index}` }));
  const count = await auditCount();
  const tooMany = await call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: rows(501) } });
  assert.deepEqual(issues(tooMany), [["/", "TOO_MANY"]]);
  const oneBad = rows(500);
  (oneBad[499] as Record<string, unknown>)["base_price"] = 0;
  assert.deepEqual(issues(await call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: oneBad } })), [["/create/499/base_price", "OUT_OF_RANGE"]]);
  const overlapLast = rows(500);
  (overlapLast[499] as Record<string, unknown>)["valid_from"] = day(0);
  const conflict = await call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: overlapLast } });
  assert.equal(conflict.body.error.code, "PRICE_RULE_CONFLICT");
  assert.deepEqual([(await storedPrices(id)).length, await auditCount(), await version(id)], [0, count, 1]);
  const saved = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: rows(500) } }));
  assert.deepEqual([saved.items.length, saved.created_ids.length, saved.version, await auditCount()], [500, 500, 2, count + 500]);
  // 合计：250 删 + 250 改 + 1 加 = 501
  const mixed = { delete: saved.items.slice(0, 250).map((item: any) => item.id), update: saved.items.slice(250).map((item: any) => ({ id: item.id, ...fixed({ valid_from: item.valid_from, valid_to: item.valid_to, base_price: 5 }) })), create: rows(1, 600) };
  assert.deepEqual(issues(await call("POST", `/products/${id}/price-rules/batch`, { version: 2, body: mixed })), [["/", "TOO_MANY"]]);
  const mixedOk = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 2, body: { ...mixed, create: [] } }));
  assert.deepEqual([mixedOk.items.length, mixedOk.items.every((item: any) => item.base_price === 5), await overlapsInDb(id)], [250, true, 0]);
});

test("并发：8 个请求（单条新增和批量保存混着）同时给同一个组合加互相重叠的价格，只有 1 个成功，其余是 409；库里没有重叠；商品版本号只加了 1", async () => {
  const id = await product();
  const attempts = Array.from({ length: 8 }, (_, index) =>
    index % 2 === 0
      ? call("POST", `/products/${id}/price-rules`, { version: 1, body: fixed({ valid_from: `2026-10-${String(10 + index).padStart(2, "0")}`, valid_to: "2026-12-31", base_price: 20_000 + index }) })
      : call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: [fixed({ valid_from: `2026-11-${String(10 + index).padStart(2, "0")}`, base_price: 20_000 + index, ref: `并发 ${index}` })] } }),
  );
  const results = await Promise.all(attempts);
  const succeeded = results.filter((res) => res.status === 200 || res.status === 201);
  assert.equal(succeeded.length, 1, results.map((res) => `${res.status} ${res.body?.error?.code ?? ""}`).join("；"));
  for (const res of results) if (res.status >= 400) assert.ok(res.status === 409 && ["VERSION_CONFLICT", "PRICE_RULE_CONFLICT", "CONCURRENT_UPDATE"].includes(res.body.error.code), res.text);
  assert.deepEqual([(await storedPrices(id)).length, await overlapsInDb(id), await version(id)], [1, 0, 2]);
});

test("并发：两个人各自拿着最新的版本号、几乎同时加互相重叠的价格（一个先到、另一个用同一个版本号紧跟）——应用层检查加锁之后不会两条都成功", async () => {
  const id = await product();
  // 20 轮：每轮两个互相重叠的新增同时发出，都带当时最新的版本号
  for (let round = 0; round < 20; round += 1) {
    const current = await version(id);
    const from = `2027-${String((round % 12) + 1).padStart(2, "0")}-01`;
    const pair = await Promise.all([
      call("POST", `/products/${id}/price-rules`, { version: current, body: fixed({ direction: round < 12 ? "pickup" : "dropoff", valid_from: from, valid_to: `${from.slice(0, 8)}20` }) }),
      call("POST", `/products/${id}/price-rules`, { version: current, body: fixed({ direction: round < 12 ? "pickup" : "dropoff", valid_from: `${from.slice(0, 8)}20`, valid_to: `${from.slice(0, 8)}28`, base_price: 1 }) }),
    ]);
    assert.deepEqual(pair.map((res) => res.status).sort(), [201, 409], pair.map((res) => res.text).join("\n"));
  }
  assert.deepEqual([(await storedPrices(id)).length, await overlapsInDb(id)], [20, 0]);
});

test("并发：同时新增 6 条调价规则（同一个版本号）只有 1 条成功；之后顺序号没有重复；同时上架和删掉最后一条价格，结果要么是「已上架且还有价格」，要么是「没上架且价格删了」", async () => {
  const id = await publishable();
  const price = await addPrice(id, fixed());
  const current = await version(id);
  const created = await Promise.all(Array.from({ length: 6 }, (_, index) => call("POST", `/products/${id}/adjust-rules`, { version: current, body: adjustBody({ name: `并发调价 ${index}` }) })));
  assert.equal(created.filter((res) => res.status === 201).length, 1, created.map((res) => res.status).join(","));
  await addAdjust(id, adjustBody({ name: "第二条" }));
  await addAdjust(id, adjustBody({ name: "第三条" }));
  const positions = (await api.db.owner.query("select position from adjust_rules where product_id = $1 order by position", [id])).rows.map((row: any) => row.position);
  assert.deepEqual(positions, [0, 1, 2]);
  // 上架 ∥ 删最后一条价格
  const [published, removed] = await Promise.all([call("POST", `/products/${id}/publish`), call("DELETE", `/products/${id}/price-rules/${price.id}`, { version: await version(id) })]);
  const status = (await ok(call("GET", `/products/${id}`))).status;
  const left = (await storedPrices(id)).length;
  assert.ok((status === "published" && left === 1) || (status === "draft" && left === 0), `上架 ${published.status}、删除 ${removed.status} ${removed.body?.error?.code ?? ""}，结果：${status}、剩 ${left} 条价格`);
});

test("幂等：同一个幂等键重复提交（新增一条 / 批量 / 新增调价）只生效一次、返回同一个应答；同一个键换了内容是 422；没带键是 400", async () => {
  const id = await product();
  const key = randomUUID();
  const first = await call("POST", `/products/${id}/price-rules`, { version: 1, key, body: fixed() });
  const again = await call("POST", `/products/${id}/price-rules`, { version: 1, key, body: fixed() });
  assert.deepEqual([first.status, again.status], [201, 201]);
  assert.deepEqual(again.body, first.body);
  assert.deepEqual([(await storedPrices(id)).length, await version(id), (await audits("price_rule", first.body.price_rule.id)).length], [1, 2, 1]);
  const changed = await call("POST", `/products/${id}/price-rules`, { version: 1, key, body: fixed({ base_price: 1 }) });
  assert.deepEqual([changed.status, changed.body.error.code], [422, "IDEMPOTENCY_KEY_REUSED"]);
  // 没带同一个键的重复提交：版本号已经变了 → 409，不会多出一条
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: 1, body: fixed() })).body.error.code, "VERSION_CONFLICT");
  const batchKey = randomUUID();
  const body = { create: [fixed({ direction: "dropoff", ref: "x" })] };
  const batch = await call("POST", `/products/${id}/price-rules/batch`, { version: 2, key: batchKey, body });
  const batchAgain = await call("POST", `/products/${id}/price-rules/batch`, { version: 2, key: batchKey, body });
  assert.deepEqual([batch.status, batchAgain.status], [200, 200]);
  assert.deepEqual(batchAgain.body, batch.body);
  assert.equal((await storedPrices(id)).length, 2);
  // 两个一模一样的请求同时到（双击保存）：只多一条
  const doubleKey = randomUUID();
  const double = await Promise.all([1, 2].map(() => call("POST", `/products/${id}/adjust-rules`, { version: 3, key: doubleKey, body: adjustBody() })));
  assert.ok(double.every((res) => res.status === 201 || res.status === 409), double.map((res) => res.text).join("\n"));
  assert.equal((await ok(call("GET", `/products/${id}/adjust-rules`))).items.length, 1);
  const replay = await call("POST", `/products/${id}/adjust-rules`, { version: 3, key: doubleKey, body: adjustBody() });
  assert.equal(replay.status, 201);
  assert.equal((await ok(call("GET", `/products/${id}/adjust-rules`))).items.length, 1);
  for (const path of ["price-rules", "price-rules/batch", "adjust-rules"]) {
    const res = await call("POST", `/products/${id}/${path}`, { version: 4, key: null, body: path === "adjust-rules" ? adjustBody() : path === "price-rules" ? fixed({ area_id: ids["a2"] }) : {} });
    assert.equal(res.status, 400, `${path} 没带幂等键：${res.text}`);
  }
  assert.equal((await call("PUT", `/products/${id}/price-rules/${first.body.price_rule.id}`, { body: fixed() })).status, 428, "修改没带 If-Match");
});

test("幂等键只在自己的供应商里有意义：甲和乙碰巧用了同一个幂等键，各建各的，谁也拿不到对方的应答", async () => {
  const id = await product();
  const key = randomUUID();
  const mine = await call("POST", `/products/${id}/price-rules`, { version: 1, key, body: fixed({ base_price: 12_345 }) });
  const theirVersion = await version(ids["b-product"] as string, other.adminToken);
  const theirs = await call("POST", `/products/${ids["b-product"]}/price-rules`, { token: other.adminToken, version: theirVersion, key, body: fixed({ area_id: ids["b-area"], direction: "dropoff", base_price: 54_321 }) });
  assert.deepEqual([mine.status, theirs.status], [201, 201], `${mine.text}\n${theirs.text}`);
  assert.deepEqual([mine.body.price_rule.base_price, theirs.body.price_rule.base_price], [12_345, 54_321]);
  assert.notEqual(mine.body.price_rule.id, theirs.body.price_rule.id);
  // 清掉乙多出来的这一条，别的测试要核对乙的数据不变
  await ok(call("DELETE", `/products/${ids["b-product"]}/price-rules/${theirs.body.price_rule.id}`, { token: other.adminToken, version: theirVersion + 1 }));
});

test("【缺陷】删除一个区域时，草稿 / 已下架商品里这个区域的价格跟着被删掉，但价格的审计日志里没有任何记录，商品的版本号也没变（别人手里的旧页面不知道价格已经没了）", async () => {
  const zone = await area();
  const id = await product("point_to_point", { areas: [{ area_id: ids["a1"] }, { area_id: zone }] });
  const kept = await addPrice(id, fixed({ direction: undefined, base_price: 11_000 }));
  const lost = await addPrice(id, fixed({ area_id: zone, direction: undefined, base_price: 22_000 }));
  const before = await version(id);
  // 复现：这个商品是草稿，区域可以直接删
  const removed = await call("DELETE", `/areas/${zone}`);
  assert.equal(removed.status, 204, removed.text);
  const after = await ok(call("GET", `/products/${id}/price-rules`));
  assert.deepEqual(after.items.map((item: any) => item.id), [kept.id], "区域二的价格跟着区域一起没了（ADR 0018 的设计）");
  const logs = await audits("price_rule", lost.id);
  // 期望：被连带删除的价格有一条 delete 日志（带删之前的内容），商品的版本号加一；实际：只有当初的 create，版本号不变
  assert.deepEqual([logs.map((log) => log.action), after.version > before], [["create", "delete"], true], `价格 ${lost.id} 的日志：${JSON.stringify(logs.map((log) => log.action))}；商品版本号 ${before} → ${after.version}`);
});

// ───────────── 上架联动 ─────────────

test("已上架的商品：批量把价格全删、全停用、全改成过期都被 PUBLISH_CHECK_FAILED 拒绝且什么都不变；只剩一条以后才生效的价格可以；调价规则把仅有的价格调到不大于 0 存不了", async () => {
  const id = await publishable();
  const created = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ ref: "a" }), fixed({ direction: "dropoff", ref: "b" }), fixed({ area_id: ids["a2"], direction: "both", status: "disabled", ref: "c" })] } }));
  await ok(call("POST", `/products/${id}/publish`));
  const before = await ok(call("GET", `/products/${id}/price-rules`));
  const count = await auditCount();
  const refused = async (body: unknown, label: string): Promise<void> => {
    const res = await call("POST", `/products/${id}/price-rules/batch`, { version: before.version, body });
    assert.deepEqual([res.status, res.body.error.code], [409, "PUBLISH_CHECK_FAILED"], `${label}：${res.text}`);
    const item = res.body.error.details.items.find((entry: any) => entry.key === "price_rules");
    assert.equal(item.passed, false, label);
    assert.deepEqual(await ok(call("GET", `/products/${id}/price-rules`)), before, `${label}：什么都没变`);
    assert.equal(await auditCount(), count, `${label}：不留审计日志`);
  };
  const enabled = before.items.filter((item: any) => item.status === "enabled");
  const input = (item: any, extra: Record<string, unknown>): Record<string, unknown> => fixed({ area_id: item.area_id, direction: item.direction, valid_from: item.valid_from, ...extra });
  await refused({ delete: created.created_ids }, "全删");
  await refused({ delete: enabled.map((item: any) => item.id) }, "只留停用的");
  await refused({ update: enabled.map((item: any) => ({ id: item.id, ...input(item, { status: "disabled" }) })) }, "全停用");
  await refused({ update: enabled.map((item: any) => ({ id: item.id, ...input(item, { valid_to: "2026-10-06" }) })) }, "全过期（昨天到期）");
  // 今天到期的还算数
  const today = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: before.version, body: { update: enabled.map((item: any) => ({ id: item.id, ...input(item, { valid_to: TODAY }) })) } }));
  // 全删，同时加一条明年才生效的：算「启用且未过期」
  const future = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: today.version, body: { delete: created.created_ids, create: [fixed({ valid_from: "2027-04-01", base_price: 1_000 })] } }));
  assert.deepEqual([future.items.length, (await ok(call("GET", `/products/${id}`))).status], [1, "published"]);
  // 把这条 1,000 的价格调到不大于 0 的规则存不了；停用着存可以，启用它不行
  const bad = adjustBody({ name: "减一千", steps: [{ type: "amount", value: -1_000 }] });
  const rejected = await call("POST", `/products/${id}/adjust-rules`, { version: future.version, body: bad });
  assert.deepEqual(issues(rejected), [["/steps", "ADJUST_RESULT_NOT_POSITIVE"]]);
  assert.equal(rejected.body.error.details.issues[0].detail.count, 1);
  const parked = (await ok(call("POST", `/products/${id}/adjust-rules`, { version: future.version, body: { ...bad, status: "disabled" } }), 201)).adjust_rule;
  assert.deepEqual(issues(await call("POST", `/products/${id}/adjust-rules/${parked.id}/enable`)), [["/steps", "ADJUST_RESULT_NOT_POSITIVE"]]);
  // 减 999 可以（剩 1）
  assert.equal((await call("PUT", `/products/${id}/adjust-rules/${parked.id}`, { version: await version(id), body: { ...bad, steps: [{ type: "amount", value: -999 }] } })).status, 200);
  // 价格后来降到 999：价格照样能存；上架检查的「调价规则」一项指出是哪一条，但不影响上架
  const price = (await ok(call("GET", `/products/${id}/price-rules`))).items[0];
  await ok(call("PUT", `/products/${id}/price-rules/${price.id}`, { version: await version(id), body: fixed({ valid_from: "2027-04-01", base_price: 999 }) }));
  const check = await ok(call("GET", `/products/${id}/publish-check`));
  const adjustItem = check.items.find((item: any) => item.key === "adjust_rules");
  assert.deepEqual([check.can_publish, adjustItem.required, adjustItem.passed, adjustItem.issues.map((issue: any) => [issue.reason, issue.detail.rule_id, issue.detail.name])], [true, false, false, [["ADJUST_RESULT_NOT_POSITIVE", parked.id, "减一千"]]]);
  // 日历上这一天是「调完不大于 0」
  const day = (await ok(call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2027-04-01&to=2027-04-01`))).days[0];
  assert.deepEqual([day.segments[0].final, day.segments[0].no_price_reason, day.segments[0].unrounded], [null, "NOT_POSITIVE", "0"]);
});

test("【缺陷】已上架的商品把唯一有价格的区域去掉后仍然保持上架：剩下的区域一条价格都没有，任何组合都报不出价，上架检查却还算「有启用且未过期的价格」", async () => {
  const id = await publishable();
  // 只给区域一设了价格，上架
  await addPrice(id, fixed({ direction: "both" }));
  await ok(call("POST", `/products/${id}/publish`));
  // 复现：把区域一从商品里去掉，只留没有任何价格的区域二
  const current = (await ok(call("GET", `/products/${id}`))).version;
  const patched = await call("PATCH", `/products/${id}`, { version: current, body: { areas: [{ area_id: ids["a2"] }] } });
  const coverage = await ok(call("GET", `/products/${id}/price-coverage`));
  const check = await ok(call("GET", `/products/${id}/publish-check`));
  const status = (await ok(call("GET", `/products/${id}`))).status;
  // 期望：这次修改被 PUBLISH_CHECK_FAILED 拒绝，或者上架检查的「价格规则」一项不通过（商品现在选的区域 × 车型组里没有任何一个组合有价格）
  // 实际：修改成功、商品仍是已上架，price-coverage 说 4 个组合 4 个都缺价，publish-check 的 price_rules 仍然 passed
  const priceItem = check.items.find((item: any) => item.key === "price_rules");
  assert.ok(
    patched.status === 409 || status !== "published" || priceItem.passed === false || coverage.priced > 0,
    `修改 ${patched.status}，商品状态 ${status}，该有价格的组合 ${coverage.total} 个、有价格的 ${coverage.priced} 个，上架检查「价格规则」passed = ${priceItem.passed}`,
  );
});

test("取整单位改大对已上架商品的影响：结算价比半个取整单位还小的价格，取整后会是 0（不报价）——这样的修改被拦住并说明是哪些商品；不会归零的可以改，应答里有「取整后变了的价格条数」", async () => {
  // 原来记录的现状是「修改本身不被拦，也没有任何提示」；修缺陷之后改为拦住 / 提示，这里跟着改成断言新的行为。
  const brand = (await ok(call("POST", "/brands", { body: { name: "验收取整", currency: "JPY" } }), 201)).id;
  const id = await publishable("airport_transfer", { brand_id: brand });
  await ok(call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ base_price: 499 }), fixed({ direction: "dropoff", base_price: 500 })] } }));
  await ok(call("POST", `/products/${id}/publish`));
  const finals = async (): Promise<unknown[]> => {
    const out: unknown[] = [];
    for (const direction of ["pickup", "dropoff"]) {
      const segment = (await ok(call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=${direction}&from=2026-10-09&to=2026-10-09`))).days[0].segments[0];
      out.push([segment.final, segment.no_price_reason]);
    }
    return out;
  };
  assert.deepEqual(await finals(), [[499, null], [500, null]]);
  // 改成 1000：499 会变成 0（报不出），500 会变成 1000 —— 被拦住，什么都不变，不留日志
  const count = await auditCount();
  const refused = await call("PUT", `/brands/${brand}/rounding-unit`, { version: await brandVersion(brand), body: { rounding_unit: 1_000 } });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "ROUNDING_UNIT_ZEROES_PRICES"], refused.text);
  const product = (await ok(call("GET", `/products/${id}`)));
  assert.deepEqual(refused.body.error.details, { rounding_unit: 1_000, price_count: 1, product_count: 1, published_product_count: 1, products: [{ product_id: id, code: product.code, status: "published", price_count: 1 }] });
  assert.deepEqual([await finals(), await auditCount(), (await ok(call("GET", `/products/${id}/price-rules`))).rounding_unit], [[[499, null], [500, null]], count, 1]);
  // 停用那条 499 的价格之后（停用的不算可以卖的价格）就可以改了
  const rules = (await ok(call("GET", `/products/${id}/price-rules`))).items;
  const low = rules.find((item: any) => item.base_price === 499);
  await ok(call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { update: [{ id: low.id, ...fixed({ base_price: 499, status: "disabled" }) }] } }));
  const saved = await ok(call("PUT", `/brands/${brand}/rounding-unit`, { version: await brandVersion(brand), body: { rounding_unit: 1_000 } }));
  assert.deepEqual([saved.rounding_unit, saved.changed_price_count], [1_000, 1], "500 → 1000：一条价格取整后变了");
  assert.deepEqual(await finals(), [[null, "RULE_DISABLED"], [1_000, null]]);
  const check = await ok(call("GET", `/products/${id}/publish-check`));
  assert.deepEqual([product.status, check.can_publish], ["published", true]);
  // 审计日志记了改前改后
  const log = (await audits("brand", brand)).at(-1);
  assert.deepEqual([log.action, log.before, log.after], ["update", { rounding_unit: 1 }, { rounding_unit: 1_000 }]);
  // 不变的不记
  const after = await auditCount();
  await setRounding(brand, 1_000);
  assert.equal(await auditCount(), after);
});

// ───────────── 租户隔离、权限 ─────────────

test("租户隔离：甲在自己的商品里混入乙的区域、价格编号、调价编号，一律当作不存在（不泄露乙的任何内容）；乙的商品、子品牌对甲是 404；全程乙的数据一行没变", async () => {
  const id = await product();
  const mine = await addPrice(id, fixed());
  const myAdjust = await addAdjust(id, adjustBody());
  const snapshot = async (): Promise<unknown> => ({
    prices: (await api.db.owner.query("select * from price_rules where tenant_id = $1 order by id", [other.tenantId])).rows,
    adjusts: (await api.db.owner.query("select * from adjust_rules where tenant_id = $1 order by id", [other.tenantId])).rows,
    brands: (await api.db.owner.query("select * from brands where tenant_id = $1 order by id", [other.tenantId])).rows,
    products: (await api.db.owner.query("select id, version, status, updated_at from products where tenant_id = $1 order by id", [other.tenantId])).rows,
  });
  const before = await snapshot();
  const v = await version(id);
  const leak = (res: ApiResponse, label: string): void => {
    assert.doesNotMatch(res.text, /77777|77,777|乙的秘密调价|乙 JPY|验收乙车队/, `${label} 泄露了乙的内容：${res.text}`);
    assert.ok(!res.text.includes(other.tenantId), `${label} 带出了乙的租户编号`);
  };
  // 乙的区域
  const foreignArea = await call("POST", `/products/${id}/price-rules`, { version: v, body: fixed({ area_id: ids["b-area"], direction: "dropoff" }) });
  assert.deepEqual(issues(foreignArea), [["/area_id", "AREA_NOT_IN_PRODUCT"]]);
  leak(foreignArea, "乙的区域");
  const foreignBatch = await call("POST", `/products/${id}/price-rules/batch`, { version: v, body: { create: [fixed({ area_id: ids["b-area"], ref: "x" })], update: [{ id: ids["b-price"], ...fixed({ base_price: 1 }) }], delete: [ids["b-price"]] } });
  assert.deepEqual(issues(foreignBatch), [["/create/0/area_id", "AREA_NOT_IN_PRODUCT"], ["/update/0/id", "UNKNOWN_PRICE_RULE"], ["/delete/0", "UNKNOWN_PRICE_RULE"]]);
  leak(foreignBatch, "批量里乙的价格编号");
  // 把自己的价格改到乙的区域上
  assert.deepEqual(issues(await call("PUT", `/products/${id}/price-rules/${mine.id}`, { version: v, body: fixed({ area_id: ids["b-area"] }) })), [["/area_id", "AREA_NOT_IN_PRODUCT"]]);
  // 乙的价格 / 调价编号放在自己的商品路径下
  for (const [method, path, body] of [
    ["PUT", `/products/${id}/price-rules/${ids["b-price"]}`, fixed({ base_price: 1 })],
    ["DELETE", `/products/${id}/price-rules/${ids["b-price"]}`, undefined],
    ["PUT", `/products/${id}/adjust-rules/${ids["b-adjust"]}`, adjustBody({ name: "被甲改了" })],
    ["DELETE", `/products/${id}/adjust-rules/${ids["b-adjust"]}`, undefined],
    ["POST", `/products/${id}/adjust-rules/${ids["b-adjust"]}/disable`, undefined],
    ["POST", `/products/${id}/adjust-rules/${ids["b-adjust"]}/enable`, undefined],
  ] as [HttpMethod, string, unknown][]) {
    const res = await call(method, path, { version: v, body });
    assert.equal(res.status, 404, `${method} ${path}：${res.text}`);
    leak(res, `${method} ${path}`);
  }
  const order = await call("PUT", `/products/${id}/adjust-rules/order`, { version: v, body: { ids: [ids["b-adjust"]] } });
  assert.deepEqual(issues(order), [["/ids", "IDS_MISMATCH"]]);
  const orderBoth = await call("PUT", `/products/${id}/adjust-rules/order`, { version: v, body: { ids: [myAdjust.id, ids["b-adjust"]] } });
  assert.deepEqual(issues(orderBoth), [["/ids", "IDS_MISMATCH"]]);
  // 调价规则的适用区域里混入乙的区域
  const scoped = await call("POST", `/products/${id}/adjust-rules`, { version: v, body: adjustBody({ area_ids: [ids["a1"], ids["b-area"]] }) });
  assert.deepEqual(issues(scoped), [["/area_ids/1", "AREA_NOT_IN_PRODUCT"]]);
  leak(scoped, "调价规则里乙的区域");
  // 日历查乙的区域：和「这个组合没有价格」一样，看不出区别
  const theirs = await ok(call("GET", `/products/${id}/price-calendar?area_id=${ids["b-area"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-09&to=2026-10-09`));
  const nobody = await ok(call("GET", `/products/${id}/price-calendar?area_id=${MISSING}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-09&to=2026-10-09`));
  assert.deepEqual(theirs, nobody);
  assert.equal(theirs.days[0].segments[0].no_price_reason, "NO_RULE");
  // 乙的商品、子品牌：17 个租户接口逐个 404
  const q = `area_id=${ids["b-area"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-09&to=2026-10-09`;
  const p = `/products/${ids["b-product"]}`;
  const all: [HttpMethod, string, unknown?][] = [
    ["GET", `${p}/price-rules`],
    ["POST", `${p}/price-rules`, fixed({ area_id: ids["b-area"], direction: "dropoff" })],
    ["POST", `${p}/price-rules/batch`, { delete: [ids["b-price"]] }],
    ["PUT", `${p}/price-rules/${ids["b-price"]}`, fixed({ area_id: ids["b-area"], base_price: 1 })],
    ["DELETE", `${p}/price-rules/${ids["b-price"]}`],
    ["GET", `${p}/price-coverage`],
    ["GET", `${p}/price-calendar?${q}`],
    ["GET", `${p}/adjust-rules`],
    ["POST", `${p}/adjust-rules`, adjustBody()],
    ["PUT", `${p}/adjust-rules/order`, { ids: [ids["b-adjust"]] }],
    ["PUT", `${p}/adjust-rules/${ids["b-adjust"]}`, adjustBody()],
    ["DELETE", `${p}/adjust-rules/${ids["b-adjust"]}`],
    ["POST", `${p}/adjust-rules/${ids["b-adjust"]}/enable`],
    ["POST", `${p}/adjust-rules/${ids["b-adjust"]}/disable`],
    ["PUT", `/brands/${ids["b-brand"]}/rounding-unit`, { rounding_unit: 100 }],
  ];
  for (const [method, path, body] of all) {
    for (const guess of [1, 2, 3]) {
      const res = await call(method, path, { version: guess, body });
      assert.equal(res.status, 404, `${method} ${path}（版本号 ${guess}）：${res.text}`);
      leak(res, `${method} ${path}`);
    }
  }
  // 另外两个没有商品编号的接口：只看得到自己的
  const overview = await ok(call("GET", `/price-overview?tenant_id=${other.tenantId}`));
  assert.ok(overview.items.every((item: any) => item.product_id !== ids["b-product"]));
  leak(await call("GET", "/price-overview"), "price-overview");
  assert.equal((await call("GET", `/holidays?from=2026-10-01&to=2026-10-31&tenant_id=${other.tenantId}`)).status, 200);
  // 请求体里塞 tenant_id 不起作用：存下来的是甲自己的
  const smuggled = await call("POST", `/products/${id}/price-rules`, { version: v, body: { ...fixed({ direction: "dropoff" }), tenant_id: other.tenantId } });
  if (smuggled.status === 201) assert.equal((await api.db.owner.query("select tenant_id from price_rules where id = $1", [smuggled.body.price_rule.id])).rows[0].tenant_id, tenant.tenantId);
  else assert.equal(smuggled.status, 400, smuggled.text);
  assert.deepEqual(await snapshot(), before, "乙的数据一行没变");
  // 反过来：乙也读不到甲的
  assert.equal((await call("GET", `/products/${id}/price-rules`, { token: other.adminToken })).status, 404);
});

test("权限：取整单位只有管理员能改（商品价格、只读、调度、财务都是 403）；平台的令牌进不了租户接口，租户的令牌进不了平台节假日接口；过期 / 乱写的令牌是 401", async () => {
  const id = await product();
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `qa-${role}@a.test`, role)).token;
  const brandBefore = (await api.db.owner.query("select rounding_unit, version from brands where id = $1", [ids["brand"]])).rows[0];
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) {
    const res = await call("PUT", `/brands/${ids["brand"]}/rounding-unit`, { token: tokens[role] as string, version: brandBefore.version, body: { rounding_unit: 100 } });
    assert.deepEqual([res.status, res.body.error.code], [403, "FORBIDDEN"], `${role}：${res.text}`);
  }
  assert.deepEqual((await api.db.owner.query("select rounding_unit, version from brands where id = $1", [ids["brand"]])).rows[0], brandBefore);
  // 商品价格角色：价格和调价的全部写操作都能做，并且审计日志记的是他
  const pricing = tokens["pricing"] as string;
  const made = await ok(call("POST", `/products/${id}/price-rules/batch`, { token: pricing, version: 1, body: { create: [fixed({ ref: "p" })] } }));
  const rule = (await ok(call("POST", `/products/${id}/adjust-rules`, { token: pricing, version: made.version, body: adjustBody() }), 201)).adjust_rule;
  assert.equal((await call("PUT", `/products/${id}/adjust-rules/order`, { token: pricing, version: made.version + 1, body: { ids: [rule.id] } })).status, 200);
  assert.deepEqual((await audits("adjust_rule", rule.id)).map((log) => log.actor_email), ["qa-pricing@a.test"]);
  // 只读：看得到价格日历和缺价，改不了任何东西（含不要求版本号的启停）
  const readonly = tokens["readonly"] as string;
  assert.equal((await call("GET", `/products/${id}/price-coverage`, { token: readonly })).status, 200);
  for (const action of ["enable", "disable"]) assert.equal((await call("POST", `/products/${id}/adjust-rules/${rule.id}/${action}`, { token: readonly })).status, 403);
  // 权限先于存在性：没有权限的角色问一个不存在的商品也是 403，不是 404（不能拿来探测编号）
  assert.equal((await call("GET", `/products/${MISSING}/price-rules`, { token: tokens["dispatch"] as string })).status, 403);
  // 令牌串用
  const tenantPaths: [HttpMethod, string][] = [["GET", `/tenant/v1/products/${id}/price-rules`], ["GET", "/tenant/v1/price-overview"], ["GET", "/tenant/v1/holidays?from=2026-10-01&to=2026-10-31"], ["PUT", `/tenant/v1/brands/${ids["brand"]}/rounding-unit`]];
  for (const [method, path] of tenantPaths) {
    assert.equal((await api.call(method, path, { token: root, body: method === "PUT" ? { rounding_unit: 1 } : undefined, headers: { "if-match": '"1"' } })).status, 401, `平台令牌 ${method} ${path}`);
    assert.equal((await api.call(method, path, { body: method === "PUT" ? { rounding_unit: 1 } : undefined, headers: { "if-match": '"1"' } })).status, 401, `没有令牌 ${method} ${path}`);
    assert.equal((await api.call(method, path, { token: "not-a-token", headers: { "if-match": '"1"' } })).status, 401);
  }
  const platformPaths: [HttpMethod, string, unknown?][] = [["GET", "/platform/v1/holidays?from=2026-10-01&to=2026-10-31"], ["PUT", "/platform/v1/holidays/JP/2029-01-01", { name: { zh: "元旦" } }], ["DELETE", "/platform/v1/holidays/JP/2029-01-01"]];
  for (const [method, path, body] of platformPaths) {
    assert.equal((await api.call(method, path, { token: tenant.adminToken, ...(body ? { body } : {}) })).status, 401, `租户令牌 ${method} ${path}`);
    assert.equal((await api.call(method, path, body ? { body } : {})).status, 401, `没有令牌 ${method} ${path}`);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from holidays where holiday_date = '2029-01-01'")).rows[0].n, 0);
});

test("平台节假日接口的权限：只有超级管理员和主数据运营能登记、修改、删除；其余 8 个平台角色能看不能改；写了审计日志（改前改后），没变化不记，失败不留", async () => {
  const staff = async (email: string, role: string): Promise<string> => {
    const invited = await ok(platform("POST", "/staff", { email, name: email, role }), 201);
    await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    return (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
  };
  const editor = await staff("qa-holiday-editor@platform.test", "master_data");
  const key = "holiday";
  const logs = async (date: string): Promise<any[]> => audits(key, `KR:${date}`);
  const created = await platform("PUT", "/holidays/KR/2029-03-01", { name: { zh: "三一节" } }, editor);
  assert.equal(created.status, 201, created.text);
  assert.deepEqual([created.body.country_code, created.body.date, created.body.name], ["KR", "2029-03-01", { zh: "三一节" }]);
  const same = await platform("PUT", "/holidays/KR/2029-03-01", { name: { zh: "三一节" } }, editor);
  assert.equal(same.status, 200);
  const renamed = await platform("PUT", "/holidays/KR/2029-03-01", { name: { ko: "삼일절" } }, editor);
  assert.equal(renamed.status, 200);
  assert.deepEqual((await logs("2029-03-01")).map((log) => [log.action, log.tenant_id, log.actor_email, log.before, log.after]), [
    ["create", null, "qa-holiday-editor@platform.test", null, { country_code: "KR", date: "2029-03-01", name: { zh: "三一节" } }],
    ["update", null, "qa-holiday-editor@platform.test", { name: { zh: "三一节" } }, { country_code: "KR", date: "2029-03-01", name: { ko: "삼일절" } }],
  ]);
  const holidayLogs = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'holiday'")).rows[0].n;
  const count = await holidayLogs();
  for (const role of ["operations", "tenant_onboarding", "channel_manager", "customer_service", "finance", "risk", "tech", "readonly"]) {
    const token = await staff(`qa-holiday-${role}@platform.test`, role);
    assert.equal((await platform("GET", "/holidays?from=2029-01-01&to=2029-12-31", undefined, token)).status, 200, `${role} 能看`);
    for (const [method, path, body] of [["PUT", "/holidays/KR/2029-03-01", { name: { zh: "被改了" } }], ["PUT", "/holidays/KR/2029-05-05", { name: { zh: "新的" } }], ["DELETE", "/holidays/KR/2029-03-01", undefined]] as [HttpMethod, string, unknown][]) {
      const res = await platform(method, path, body, token);
      assert.deepEqual([res.status, res.body.error.code], [403, "FORBIDDEN"], `${role} ${method} ${path}：${res.text}`);
    }
  }
  // 写错的：国家码、日期、名称；都不留痕迹
  for (const path of ["/holidays/kr/2029-03-02", "/holidays/KOR/2029-03-02", "/holidays/KR/2029-02-30", "/holidays/KR/2029-3-2", "/holidays/KR/20290302"]) {
    assert.equal((await platform("PUT", path, { name: { zh: "写错了" } }, editor)).status, 404, path);
    assert.equal((await platform("DELETE", path, undefined, editor)).status, 404, path);
  }
  for (const name of [{}, { zh: "   " }, { zh: "" }, { xx: "不认识的语言" }, "元旦", null]) {
    assert.equal((await platform("PUT", "/holidays/KR/2029-03-02", { name }, editor)).status, 400, JSON.stringify(name));
  }
  assert.equal((await platform("DELETE", "/holidays/KR/2029-03-02", undefined, editor)).status, 404, "删不存在的");
  assert.deepEqual([await holidayLogs(), (await api.db.owner.query("select count(*)::int as n from holidays where country_code = 'KR' and holiday_date between '2029-01-01' and '2029-09-30'")).rows[0].n], [count, 1]);
  // 查询的边界：最多 800 天；日期写反；国家码写错
  assert.equal((await platform("GET", "/holidays?from=2029-01-01&to=2031-03-11", undefined, editor)).status, 200);
  assert.deepEqual(issues(await platform("GET", "/holidays?from=2029-01-01&to=2031-03-12", undefined, editor)), [["/to", "TOO_MANY"]]);
  assert.deepEqual(issues(await platform("GET", "/holidays?from=2029-03-02&to=2029-03-01", undefined, editor)), [["/to", "DATE_RANGE_REVERSED"]]);
  assert.deepEqual(issues(await platform("GET", "/holidays?from=2029-03-01&to=2029-03-01&country_code=kr", undefined, editor)), [["/country_code", "INVALID_COUNTRY"]]);
  // 两端都含；按国家筛
  const listed = await ok(platform("GET", "/holidays?from=2029-03-01&to=2029-03-01&country_code=KR,JP", undefined, editor));
  assert.deepEqual(listed.items.map((item: any) => [item.country_code, item.date]), [["KR", "2029-03-01"]]);
  assert.deepEqual((await ok(platform("GET", "/holidays?from=2029-03-01&to=2029-03-01&country_code=JP", undefined, editor))).items, []);
  // 租户读到的是同一份
  assert.deepEqual((await ok(call("GET", "/holidays?from=2029-03-01&to=2029-03-01"))).items, listed.items);
  assert.equal((await platform("DELETE", "/holidays/KR/2029-03-01", undefined, editor)).status, 204);
  assert.deepEqual((await logs("2029-03-01")).at(-1)?.action, "delete");
  assert.deepEqual((await logs("2029-03-01")).at(-1)?.before, { country_code: "KR", date: "2029-03-01", name: { ko: "삼일절" } });
});

test("【缺陷】节假日名称有两种以上语言时，原样再提交一次也被当成修改：多写一条改前改后完全相同的审计日志（应当是没变化、不记）", async () => {
  const name = { ko: "개천절", zh: "开天节", en: "National Foundation Day" };
  await ok(platform("PUT", "/holidays/KR/2029-10-03", { name }), 201);
  // 复现：把读回来的名称原样再提交
  const stored = (await ok(platform("GET", "/holidays?from=2029-10-03&to=2029-10-03&country_code=KR"))).items[0];
  assert.deepEqual(stored.name, name);
  await ok(platform("PUT", "/holidays/KR/2029-10-03", { name: stored.name }));
  await ok(platform("PUT", "/holidays/KR/2029-10-03", { name }));
  const logs = await audits("holiday", "KR:2029-10-03");
  // 期望：只有登记的那一条；实际：每次原样提交都多一条 update，before.name 和 after.name 内容相同（只是键的先后不同）
  assert.deepEqual(logs.map((log) => log.action), ["create"], `多出来的日志：${JSON.stringify(logs.slice(1).map((log) => [log.before, log.after]))}`);
});

// ───────────── 输入 ─────────────

test("金额和数字的输入：小数（0.1 + 0.2 这一类）、科学计数法的大数、字符串写的数、负数、负零、超上限，一律 400 并指到那一项；任何乱写都不会是 500，也不会存进去", async () => {
  const id = await product();
  const logStart = api.logs().length;
  const post = (body: unknown): Promise<ApiResponse> => call("POST", `/products/${id}/price-rules`, { version: 1, body });
  const reasons = async (extra: Record<string, unknown>): Promise<string> => JSON.stringify(issues(await post(fixed(extra))));
  assert.equal(await reasons({ base_price: 0.1 + 0.2 }), '[["/base_price","NOT_INTEGER"]]');
  assert.equal(await reasons({ base_price: 20000.5 }), '[["/base_price","NOT_INTEGER"]]');
  assert.equal(await reasons({ base_price: 1e21 }), '[["/base_price","OUT_OF_RANGE"]]');
  assert.equal(await reasons({ base_price: 1_000_000_001 }), '[["/base_price","OUT_OF_RANGE"]]');
  assert.equal(await reasons({ base_price: -1 }), '[["/base_price","OUT_OF_RANGE"]]');
  assert.equal(await reasons({ base_price: 0 }), '[["/base_price","OUT_OF_RANGE"]]');
  assert.equal(await reasons({ base_price: 9_007_199_254_740_993 }), '[["/base_price","OUT_OF_RANGE"]]');
  for (const bad of ["20000", "2e4", true, [20_000], { minor: 20_000 }]) assert.equal((await post(fixed({ base_price: bad }))).status, 400, JSON.stringify(bad));
  assert.equal((await api.app.inject({ method: "POST", url: `/tenant/v1/products/${id}/price-rules`, headers: { authorization: `Bearer ${tenant.adminToken}`, "content-type": "application/json", "if-match": '"1"', "idempotency-key": randomUUID() }, payload: `{"area_id":"${ids["a1"]}","vehicle_group_id":"${ids["biz7"]}","direction":"pickup","pricing_model":"fixed","base_price":1e400,"valid_from":"2026-10-01"}` })).statusCode, 400, "1e400（JSON 里读出来是无穷大）");
  // 日期
  for (const date of ["2026-02-30", "2026-13-01", "2026-10-1", "20261001", "2026/10/01", "", "0000-01-01", "2026-10-01T00:00:00Z"]) assert.equal((await post(fixed({ valid_from: date }))).status, 400, `valid_from ${date}`);
  assert.equal(await reasons({ valid_from: "2026-10-02", valid_to: "2026-10-01" }), '[["/valid_to","DATE_RANGE_REVERSED"]]');
  // 里程 + 时长：起步里程不是 100 米的整数倍、小数、超上限；起步价 0 又没有最低消费
  const mt = (extra: Record<string, unknown>): Record<string, unknown> => ({ area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", pricing_model: "mileage_time", start_price: 3_000, start_meters: 10_000, start_minutes: 30, per_km: 300, per_minute: 50, valid_from: "2026-10-01", ...extra });
  assert.deepEqual(issues(await post(mt({ start_meters: 10_050 }))), [["/start_meters", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await post(mt({ start_meters: 1_000_100 }))), [["/start_meters", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await post(mt({ start_minutes: 1_441 }))), [["/start_minutes", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await post(mt({ per_km: 0.5 }))), [["/per_km", "NOT_INTEGER"]]);
  assert.deepEqual(issues(await post(mt({ start_price: 0 }))), [["/start_price", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await post(mt({ min_price: 0 }))), [["/min_price", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await post(mt({ base_price: 1 }))), [["/base_price", "NOT_APPLICABLE"]]);
  // 调价规则：基点和金额必须是整数；0 不行；范围；名称里的控制字符和超长；时段；周几；指定日期
  const adjust = (extra: Record<string, unknown>): Promise<ApiResponse> => call("POST", `/products/${id}/adjust-rules`, { version: 1, body: adjustBody(extra) });
  const step = async (type: string, value: unknown): Promise<string> => JSON.stringify(issues(await adjust({ steps: [{ type, value }] })));
  assert.equal(await step("percent", 12.5), '[["/steps/0/value","NOT_INTEGER"]]');
  assert.equal(await step("percent", 0), '[["/steps/0/value","ZERO_STEP"]]');
  assert.equal(await step("percent", -0), '[["/steps/0/value","ZERO_STEP"]]');
  assert.equal(await step("percent", -10_000), '[["/steps/0/value","OUT_OF_RANGE"]]');
  assert.equal(await step("percent", 100_001), '[["/steps/0/value","OUT_OF_RANGE"]]');
  assert.equal(await step("amount", 0.1 + 0.2), '[["/steps/0/value","NOT_INTEGER"]]');
  assert.equal(await step("amount", 1_000_000_001), '[["/steps/0/value","OUT_OF_RANGE"]]');
  assert.equal(await step("amount", -1_000_000_001), '[["/steps/0/value","OUT_OF_RANGE"]]');
  assert.equal((await adjust({ steps: [{ type: "multiply", value: 2 }] })).status, 400);
  assert.equal((await adjust({ steps: Array.from({ length: 11 }, () => ({ type: "amount", value: 1 })) })).status, 400, "最多 10 步");
  assert.equal((await adjust({ steps: [] })).status, 400);
  for (const name of ["", "   ", "​​", "字".repeat(51), "带\u0000空字符"]) {
    const res = await adjust({ name });
    assert.equal(res.status, 400, `名称 ${JSON.stringify(name)}：${res.status} ${res.text}`);
  }
  for (const slot of [{ start: "22:00", end: "22:00" }, { start: "24:00", end: "06:00" }, { start: "25:00", end: "06:00" }, { start: "22:60", end: "06:00" }, { start: "2200", end: "0600" }, { start: "00:00", end: "00:00" }]) {
    assert.equal((await adjust({ time_slot: slot })).status, 400, JSON.stringify(slot));
  }
  for (const cycle of [{ type: "weekly", weekdays: [] }, { type: "weekly", weekdays: [0] }, { type: "weekly", weekdays: [8] }, { type: "weekly", weekdays: [1, 1] }, { type: "weekly", weekdays: [1.5] }, { type: "dates", dates: [] }, { type: "dates", dates: ["2026-02-30"] }, { type: "dates", dates: ["2026-10-09", "2026-10-09"] }, { type: "holidays", countries: [] }, { type: "holidays", countries: ["jp"] }, { type: "holidays", countries: ["JPN"] }, { type: "monthly" }]) {
    assert.equal((await adjust({ cycle })).status, 400, JSON.stringify(cycle));
  }
  assert.equal((await adjust({ travel_from: "2026-10-10", travel_to: "2026-10-09" })).status, 400);
  assert.equal((await adjust({ package_hours: [10] })).status, 400, "接送机商品不能选套餐");
  // 日历的参数
  const cal = (query: string): Promise<ApiResponse> => call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&${query}`);
  assert.equal((await cal("direction=pickup&from=2026-10-01&to=2026-12-01")).status, 200, "62 天可以");
  assert.deepEqual(issues(await cal("direction=pickup&from=2026-10-01&to=2026-12-02")), [["/to", "TOO_MANY"]]);
  assert.deepEqual(issues(await cal("direction=pickup&from=2026-10-02&to=2026-10-01")), [["/to", "DATE_RANGE_REVERSED"]]);
  assert.deepEqual(issues(await cal("from=2026-10-01&to=2026-10-01")), [["/direction", "REQUIRED"]]);
  assert.deepEqual(issues(await cal("direction=pickup&package_hours=10&from=2026-10-01&to=2026-10-01")), [["/package_hours", "NOT_APPLICABLE"]]);
  assert.equal((await cal("direction=both&from=2026-10-01&to=2026-10-01")).status, 400);
  assert.equal((await cal("direction=pickup&from=2026-02-30&to=2026-03-01")).status, 400);
  const many = Array.from({ length: 21 }, () => randomUUID()).join(",");
  assert.equal((await call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${many}&direction=pickup&from=2026-10-01&to=2026-10-01`)).status, 400, "最多 20 个车型组");
  // 以上全部：没有一个 500，库里什么都没存
  assert.deepEqual(api.logs().slice(logStart).split("\n").filter((line) => /"statusCode":5\d\d/.test(line)), []);
  assert.deepEqual([(await storedPrices(id)).length, (await ok(call("GET", `/products/${id}/adjust-rules`))).items.length, await version(id)], [0, 0, 1]);
});

// ───────────── 审计 ─────────────

test("审计：批量保存里的每一条新增、修改、删除各一条日志，带改前改后（修改只记变了的字段）；调价规则的新增、修改、启停、删除、重排同样；记的是操作人和本租户", async () => {
  const id = await product();
  const first = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: [fixed({ ref: "a" }), fixed({ direction: "dropoff", base_price: 18_000, ref: "b" }), fixed({ area_id: ids["a2"], ref: "c" })] } }));
  const [a, b, c] = first.created_ids as [string, string, string];
  const second = await ok(
    call("POST", `/products/${id}/price-rules/batch`, {
      version: first.version,
      body: { update: [{ id: a, ...fixed({ base_price: 21_000, valid_to: "2026-12-31" }) }, { id: c, ...fixed({ area_id: ids["a2"] }) }], delete: [b], create: [fixed({ direction: "both", vehicle_group_id: ids["eco4"], base_price: 12_000, ref: "d" })] },
    }),
  );
  const d = second.created_ids[0] as string;
  const full = (extra: Record<string, unknown>): Record<string, unknown> => ({ product_id: id, area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", package_hours: null, pricing_model: "fixed", params: { basePriceMinor: 20_000 }, valid_from: "2026-10-01", valid_to: null, status: "enabled", ...extra });
  const rows = async (ruleId: string): Promise<unknown[]> => (await audits("price_rule", ruleId)).map((log) => [log.action, log.tenant_id, log.actor_email, log.before, log.after]);
  const who = [tenant.tenantId, "qa-admin@a.test"];
  assert.deepEqual(await rows(a), [["create", ...who, null, full({})], ["update", ...who, { params: { basePriceMinor: 20_000 }, valid_to: null }, { params: { basePriceMinor: 21_000 }, valid_to: "2026-12-31" }]]);
  assert.deepEqual(await rows(b), [["create", ...who, null, full({ direction: "dropoff", params: { basePriceMinor: 18_000 } })], ["delete", ...who, full({ direction: "dropoff", params: { basePriceMinor: 18_000 } }), null]]);
  assert.deepEqual(await rows(c), [["create", ...who, null, full({ area_id: ids["a2"] })]], "没变化的修改不记");
  assert.deepEqual(await rows(d), [["create", ...who, null, full({ direction: "both", vehicle_group_id: ids["eco4"], params: { basePriceMinor: 12_000 } })]]);
  // 调价规则
  const one = await addAdjust(id, adjustBody({ name: "一" }));
  const two = await addAdjust(id, adjustBody({ name: "二", steps: [{ type: "amount", value: -100 }] }));
  await ok(call("PUT", `/products/${id}/adjust-rules/${one.id}`, { version: await version(id), body: adjustBody({ name: "一改", steps: [{ type: "percent", value: 2_000 }, { type: "amount", value: 500 }], time_slot: { start: "22:00", end: "06:00" } }) }));
  await ok(call("POST", `/products/${id}/adjust-rules/${one.id}/disable`));
  await ok(call("POST", `/products/${id}/adjust-rules/${one.id}/disable`));
  await ok(call("POST", `/products/${id}/adjust-rules/${one.id}/enable`));
  await ok(call("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: [two.id, one.id] } }));
  await ok(call("DELETE", `/products/${id}/adjust-rules/${one.id}`, { version: await version(id) }));
  const logs = await audits("adjust_rule", one.id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "disable", "enable", "delete"]);
  assert.deepEqual([logs[0].before, logs[0].after.name, logs[0].after.position, logs[0].after.steps], [null, "一", 0, [{ type: "percent", value: 2_000 }]]);
  assert.deepEqual([logs[1].before, logs[1].after], [{ name: "一", time_slot: null, steps: [{ type: "percent", value: 2_000 }] }, { name: "一改", time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "percent", value: 2_000 }, { type: "amount", value: 500 }] }]);
  assert.deepEqual([logs[2].before, logs[2].after, logs[3].before, logs[3].after], [{ status: "enabled" }, { status: "disabled" }, { status: "disabled" }, { status: "enabled" }]);
  assert.deepEqual([logs[4].before.name, logs[4].before.position, logs[4].after], ["一改", 1, null]);
  assert.ok(logs.every((log) => log.tenant_id === tenant.tenantId && log.actor_email === "qa-admin@a.test"));
  const order = (await audits("product", id)).find((log) => log.before?.adjust_rule_order);
  assert.deepEqual([order.before, order.after], [{ adjust_rule_order: [one.id, two.id] }, { adjust_rule_order: [two.id, one.id] }]);
  // 失败的请求不留日志：版本冲突、校验失败、重叠、不大于 0
  const count = await auditCount();
  const v = await version(id);
  assert.equal((await call("PUT", `/products/${id}/price-rules/${a}`, { version: v - 1, body: fixed({ base_price: 1 }) })).status, 409);
  assert.equal((await call("PUT", `/products/${id}/price-rules/${a}`, { version: v, body: fixed({ base_price: 0 }) })).status, 400);
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: v, body: fixed() })).status, 409);
  assert.equal((await call("PUT", `/products/${id}/adjust-rules/${two.id}`, { version: v, body: adjustBody({ steps: [{ type: "amount", value: -30_000 }] }) })).status, 400);
  assert.equal((await call("DELETE", `/products/${id}/adjust-rules/${two.id}`, { version: v - 1 })).status, 409);
  assert.deepEqual([await auditCount(), await version(id)], [count, v]);
});

// ───────────── 接口定义对账、规则 4 ─────────────

/** 按 openapi.yaml 的 schema 逐字段核对一个值：类型、必有字段、多余字段、枚举、嵌套。返回不符合的地方。 */
function schemaErrors(value: unknown, schema: any, at: string): string[] {
  if (schema === undefined || schema === true) return [];
  if (schema.$ref) return schemaErrors(value, schema.$ref.split("/").slice(1).reduce((node: any, key: string) => node[key], openapi), at);
  const errors: string[] = [];
  if (schema.allOf) for (const part of schema.allOf) errors.push(...schemaErrors(value, part, at));
  for (const keyword of ["oneOf", "anyOf"]) {
    if (!schema[keyword]) continue;
    const results = schema[keyword].map((option: any) => schemaErrors(value, option, at));
    const passing = results.filter((result: string[]) => result.length === 0).length;
    if (passing === 0) errors.push(`${at}：不符合 ${keyword} 的任何一种（${results.map((result: string[]) => result[0]).join(" | ")}）`);
    if (keyword === "oneOf" && passing > 1) errors.push(`${at}：同时符合 oneOf 的 ${passing} 种`);
  }
  const typeOf = (input: unknown): string => (input === null ? "null" : Array.isArray(input) ? "array" : Number.isInteger(input) ? "integer" : typeof input);
  if (schema.type !== undefined) {
    const allowed: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!allowed.includes(actual) && !(actual === "integer" && allowed.includes("number"))) return [...errors, `${at}：类型是 ${actual}，定义是 ${allowed.join(" | ")}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}：${JSON.stringify(value)} 不在枚举 ${JSON.stringify(schema.enum)} 里`);
  if (schema.const !== undefined && schema.const !== value) errors.push(`${at}：不是 ${JSON.stringify(schema.const)}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}：${value} 小于 minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}：${value} 大于 maximum ${schema.maximum}`);
  }
  if (typeof value === "string") {
    if (schema.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${at}：不是 date`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${at}：不是 date-time`);
    if (schema.format === "uuid" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) errors.push(`${at}：不是 uuid`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}：不符合 pattern ${schema.pattern}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}：超过 maxLength`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}：超过 maxItems`);
    if (schema.items) value.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, `${at}[${index}]`)));
  } else if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${at}：缺少必有字段 ${key}`);
    for (const [key, child] of Object.entries(record)) {
      if (schema.properties && key in schema.properties) errors.push(...schemaErrors(child, schema.properties[key], `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}：多出了定义里没有的字段 ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...schemaErrors(child, schema.additionalProperties, `${at}.${key}`));
    }
  }
  return errors;
}

/** 这个接口这个状态码在 openapi.yaml 里定义的应答 schema；没定义这个状态码返回 undefined。 */
function responseSchema(method: HttpMethod, template: string, status: number): { defined: boolean; schema: any } {
  const operation = openapi.paths[template]?.[method.toLowerCase()];
  assert.ok(operation, `openapi.yaml 里没有 ${method} ${template}`);
  let response = operation.responses[String(status)];
  if (!response) return { defined: false, schema: undefined };
  if (response.$ref) response = response.$ref.split("/").slice(1).reduce((node: any, key: string) => node[key], openapi);
  return { defined: true, schema: response.content?.["application/json"]?.schema };
}

test("接口定义对账：17 个租户接口 + 3 个平台接口的成功应答和各种失败应答，逐字段（含嵌套、类型、枚举、多余字段）符合 openapi.yaml；每个实际出现的状态码定义里都有", async () => {
  const brand = (await ok(call("POST", "/brands", { body: { name: "验收对账", currency: "JPY" } }), 201)).id;
  const id = await publishable("airport_transfer", { brand_id: brand });
  const charterId = await product("charter", { brand_id: brand });
  await ok(platform("PUT", "/holidays/JP/2028-01-01", { name: { ja: "元日", zh: "元旦" } }), 201);
  const problems: string[] = [];
  const seen = new Set<string>();
  const check = async (method: HttpMethod, template: string, res: Promise<ApiResponse>, expected: number): Promise<any> => {
    const done = await res;
    assert.equal(done.status, expected, `${method} ${template}：${done.text}`);
    seen.add(`${method} ${template}`);
    // 401 / 403 在 openapi.yaml 开头统一说明，各接口不重复列；这里只核对它们是标准的错误应答
    const general = done.status === 401 || done.status === 403;
    const { defined, schema } = general ? { defined: true, schema: { $ref: "#/components/schemas/ErrorResponse" } } : responseSchema(method, template, done.status);
    if (!defined) problems.push(`${method} ${template}：实际返回了 ${done.status}，定义里没有这个状态码`);
    else if (schema === undefined) {
      if (done.text !== "") problems.push(`${method} ${template} ${done.status}：定义里没有应答内容，实际有`);
    } else problems.push(...schemaErrors(done.body, schema, `${method} ${template} ${done.status}`));
    return done.body;
  };
  const P = "/tenant/v1/products/{id}";
  const tenantCall = (method: HttpMethod, path: string, options: Options = {}): Promise<ApiResponse> => call(method, path, options);
  // 价格规则
  const mileage = { area_id: ids["a1"], vehicle_group_id: ids["eco4"], direction: "both", pricing_model: "mileage_time", start_price: 3_000, start_meters: 10_000, start_minutes: 30, per_km: 300, per_minute: 50, min_price: 3_500, valid_from: "2026-10-01", valid_to: "2026-12-31" };
  const saved = await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed() }), 201);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), body: mileage }), 201);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${charterId}/price-rules`, { version: 1, body: { area_id: ids["a1"], vehicle_group_id: ids["biz7"], package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 98_000, overtime_per_hour: 5_000, over_km_per_km: 400, valid_from: "2027-01-01" } }), 201);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed({ base_price: 0.5 }) }), 400);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed() }), 409);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: 999, body: fixed({ direction: "dropoff" }) }), 409);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${MISSING}/price-rules`, { version: 1, body: fixed() }), 404);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { body: fixed() }), 428);
  const reused = randomUUID();
  await tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), key: reused, body: fixed({ direction: "dropoff" }) });
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { version: await version(id), key: reused, body: fixed({ direction: "dropoff", base_price: 1 }) }), 422);
  await check("GET", `${P}/price-rules`, tenantCall("GET", `/products/${id}/price-rules`), 200);
  await check("GET", `${P}/price-rules`, tenantCall("GET", `/products/${charterId}/price-rules`), 200);
  await check("GET", `${P}/price-rules`, tenantCall("GET", `/products/${MISSING}/price-rules`), 404);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ area_id: ids["a2"], ref: "x" })], update: [{ id: saved.price_rule.id, ...fixed({ base_price: 21_000 }) }] } }), 200);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ ref: "x" })] } }), 409);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { delete: [MISSING] } }), 400);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${MISSING}/price-rules/batch`, { version: 1, body: {} }), 404);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${id}/price-rules/batch`, { body: {} }), 428);
  await check("PUT", `${P}/price-rules/{ruleId}`, tenantCall("PUT", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: await version(id), body: fixed({ base_price: 22_000 }) }), 200);
  await check("PUT", `${P}/price-rules/{ruleId}`, tenantCall("PUT", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: await version(id), body: fixed({ base_price: -1 }) }), 400);
  await check("PUT", `${P}/price-rules/{ruleId}`, tenantCall("PUT", `/products/${id}/price-rules/${MISSING}`, { version: await version(id), body: fixed() }), 404);
  await check("PUT", `${P}/price-rules/{ruleId}`, tenantCall("PUT", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: 999, body: fixed() }), 409);
  await check("PUT", `${P}/price-rules/{ruleId}`, tenantCall("PUT", `/products/${id}/price-rules/${saved.price_rule.id}`, { body: fixed() }), 428);
  await check("GET", `${P}/price-coverage`, tenantCall("GET", `/products/${id}/price-coverage`), 200);
  await check("GET", `${P}/price-coverage`, tenantCall("GET", `/products/${charterId}/price-coverage`), 200);
  await check("GET", `${P}/price-coverage`, tenantCall("GET", `/products/${MISSING}/price-coverage`), 404);
  // 调价规则
  const A = `${P}/adjust-rules`;
  const weekly = (await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ name: "周末夜间", cycle: { type: "weekly", weekdays: [6, 7] }, time_slot: { start: "22:00", end: "06:00" }, travel_from: "2026-10-01", travel_to: "2027-12-31", area_ids: [ids["a1"]], vehicle_group_ids: [ids["biz7"]], directions: ["pickup"], steps: [{ type: "percent", value: 1_250 }, { type: "amount", value: -100 }] }) }), 201)).adjust_rule;
  await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ name: "指定日期", cycle: { type: "dates", dates: ["2028-01-01"] } }) }), 201);
  await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ name: "假日", cycle: { type: "holidays", countries: ["JP"] }, steps: [{ type: "amount", value: 333 }] }) }), 201);
  await check("POST", A, tenantCall("POST", `/products/${charterId}/adjust-rules`, { version: 2, body: adjustBody({ name: "包车", package_hours: [10] }) }), 201);
  await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ steps: [{ type: "amount", value: -9_999_999 }] }) }), 400);
  await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { version: 999, body: adjustBody() }), 409);
  await check("POST", A, tenantCall("POST", `/products/${MISSING}/adjust-rules`, { version: 1, body: adjustBody() }), 404);
  await check("POST", A, tenantCall("POST", `/products/${id}/adjust-rules`, { body: adjustBody() }), 428);
  const list = await check("GET", A, tenantCall("GET", `/products/${id}/adjust-rules`), 200);
  await check("GET", A, tenantCall("GET", `/products/${MISSING}/adjust-rules`), 404);
  const orderIds = list.items.map((item: any) => item.id).reverse();
  await check("PUT", `${A}/order`, tenantCall("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: orderIds } }), 200);
  await check("PUT", `${A}/order`, tenantCall("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: orderIds.slice(1) } }), 400);
  await check("PUT", `${A}/order`, tenantCall("PUT", `/products/${id}/adjust-rules/order`, { version: 999, body: { ids: orderIds } }), 409);
  await check("PUT", `${A}/order`, tenantCall("PUT", `/products/${MISSING}/adjust-rules/order`, { version: 1, body: { ids: [] } }), 404);
  await check("PUT", `${A}/order`, tenantCall("PUT", `/products/${id}/adjust-rules/order`, { body: { ids: orderIds } }), 428);
  await check("PUT", `${A}/{ruleId}`, tenantCall("PUT", `/products/${id}/adjust-rules/${weekly.id}`, { version: await version(id), body: adjustBody({ name: "周末夜间（改）", cycle: { type: "weekly", weekdays: [6] }, time_slot: { start: "22:00", end: "24:00" } }) }), 200);
  await check("PUT", `${A}/{ruleId}`, tenantCall("PUT", `/products/${id}/adjust-rules/${weekly.id}`, { version: await version(id), body: adjustBody({ name: "" }) }), 400);
  await check("PUT", `${A}/{ruleId}`, tenantCall("PUT", `/products/${id}/adjust-rules/${MISSING}`, { version: await version(id), body: adjustBody() }), 404);
  await check("PUT", `${A}/{ruleId}`, tenantCall("PUT", `/products/${id}/adjust-rules/${weekly.id}`, { version: 999, body: adjustBody() }), 409);
  await check("PUT", `${A}/{ruleId}`, tenantCall("PUT", `/products/${id}/adjust-rules/${weekly.id}`, { body: adjustBody() }), 428);
  await check("POST", `${A}/{ruleId}/disable`, tenantCall("POST", `/products/${id}/adjust-rules/${weekly.id}/disable`), 200);
  await check("POST", `${A}/{ruleId}/disable`, tenantCall("POST", `/products/${id}/adjust-rules/${MISSING}/disable`), 404);
  await check("POST", `${A}/{ruleId}/enable`, tenantCall("POST", `/products/${id}/adjust-rules/${weekly.id}/enable`), 200);
  await check("POST", `${A}/{ruleId}/enable`, tenantCall("POST", `/products/${id}/adjust-rules/${MISSING}/enable`), 404);
  // 启用一条会把价格调到不大于 0 的规则：400
  const parked = (await ok(tenantCall("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ name: "停着的", steps: [{ type: "amount", value: -9_999_999 }], status: "disabled" }) }), 201)).adjust_rule;
  await check("POST", `${A}/{ruleId}/enable`, tenantCall("POST", `/products/${id}/adjust-rules/${parked.id}/enable`), 400);
  // 价格日历：有假日、有命中的规则、有分段、没有价格的日子
  const C = `${P}/price-calendar`;
  const q = `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]},${ids["eco4"]}&direction=pickup`;
  const view = await check("GET", C, tenantCall("GET", `/products/${id}/price-calendar?${q}&from=2027-12-30&to=2028-01-02`), 200);
  assert.ok(view.days.some((day: any) => day.holiday !== null) && view.days.some((day: any) => day.segments.length > 1) && view.days.some((day: any) => day.segments.some((segment: any) => segment.adjusts.length > 1)), "日历的例子要覆盖到假日、分段、多条规则");
  await check("GET", C, tenantCall("GET", `/products/${id}/price-calendar?${q}&from=2026-09-01&to=2026-09-02`), 200);
  await check("GET", C, tenantCall("GET", `/products/${charterId}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&package_hours=10&from=2027-01-01&to=2027-01-02`), 200);
  await check("GET", C, tenantCall("GET", `/products/${id}/price-calendar?${q}&from=2026-10-01&to=2027-10-01`), 400);
  await check("GET", C, tenantCall("GET", `/products/${MISSING}/price-calendar?${q}&from=2026-10-01&to=2026-10-01`), 404);
  // 已上架后删光：409 PUBLISH_CHECK_FAILED
  await ok(tenantCall("POST", `/products/${id}/publish`));
  const everything = (await ok(tenantCall("GET", `/products/${id}/price-rules`))).items.map((item: any) => item.id);
  await check("POST", `${P}/price-rules/batch`, tenantCall("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { delete: everything } }), 409);
  await ok(tenantCall("POST", `/products/${id}/unpublish`));
  await check("DELETE", `${A}/{ruleId}`, tenantCall("DELETE", `/products/${id}/adjust-rules/${weekly.id}`, { version: 999 }), 409);
  await check("DELETE", `${A}/{ruleId}`, tenantCall("DELETE", `/products/${id}/adjust-rules/${weekly.id}`), 428);
  await check("DELETE", `${A}/{ruleId}`, tenantCall("DELETE", `/products/${id}/adjust-rules/${weekly.id}`, { version: await version(id) }), 200);
  await check("DELETE", `${A}/{ruleId}`, tenantCall("DELETE", `/products/${id}/adjust-rules/${weekly.id}`, { version: await version(id) }), 404);
  await check("DELETE", `${P}/price-rules/{ruleId}`, tenantCall("DELETE", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: 999 }), 409);
  await check("DELETE", `${P}/price-rules/{ruleId}`, tenantCall("DELETE", `/products/${id}/price-rules/${saved.price_rule.id}`), 428);
  await check("DELETE", `${P}/price-rules/{ruleId}`, tenantCall("DELETE", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: await version(id) }), 200);
  await check("DELETE", `${P}/price-rules/{ruleId}`, tenantCall("DELETE", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: await version(id) }), 404);
  // 概况、取整单位、节假日
  await check("GET", "/tenant/v1/price-overview", tenantCall("GET", "/price-overview"), 200);
  await check("GET", "/tenant/v1/price-overview", tenantCall("GET", "/price-overview?summary=1"), 200);
  const R = "/tenant/v1/brands/{id}/rounding-unit";
  await check("PUT", R, tenantCall("PUT", `/brands/${brand}/rounding-unit`, { version: await brandVersion(brand), body: { rounding_unit: 100 } }), 200);
  await check("PUT", R, tenantCall("PUT", `/brands/${brand}/rounding-unit`, { version: await brandVersion(brand), body: { rounding_unit: 7 } }), 400);
  await check("PUT", R, tenantCall("PUT", `/brands/${brand}/rounding-unit`, { version: 999, body: { rounding_unit: 10 } }), 409);
  await check("PUT", R, tenantCall("PUT", `/brands/${MISSING}/rounding-unit`, { version: 1, body: { rounding_unit: 10 } }), 404);
  await check("PUT", R, tenantCall("PUT", `/brands/${brand}/rounding-unit`, { body: { rounding_unit: 10 } }), 428);
  await check("GET", "/tenant/v1/holidays", tenantCall("GET", "/holidays?from=2028-01-01&to=2028-01-31&country_code=JP"), 200);
  await check("GET", "/tenant/v1/holidays", tenantCall("GET", "/holidays?from=2028-01-01&to=2031-01-31"), 400);
  const H = "/platform/v1/holidays";
  await check("GET", H, platform("GET", "/holidays?from=2028-01-01&to=2028-01-31"), 200);
  await check("GET", H, platform("GET", "/holidays?from=2028-01-31&to=2028-01-01"), 400);
  await check("PUT", `${H}/{country}/{date}`, platform("PUT", "/holidays/JP/2028-02-11", { name: { ja: "建国記念の日" } }), 201);
  await check("PUT", `${H}/{country}/{date}`, platform("PUT", "/holidays/JP/2028-02-11", { name: { ja: "建国記念の日", en: "National Foundation Day" } }), 200);
  await check("PUT", `${H}/{country}/{date}`, platform("PUT", "/holidays/JP/2028-02-11", { name: {} }), 400);
  await check("PUT", `${H}/{country}/{date}`, platform("PUT", "/holidays/JP/2028-02-30", { name: { ja: "ない日" } }), 404);
  await check("DELETE", `${H}/{country}/{date}`, platform("DELETE", "/holidays/JP/2028-02-11"), 204);
  await check("DELETE", `${H}/{country}/{date}`, platform("DELETE", "/holidays/JP/2028-02-11"), 404);
  // 没有权限、没有令牌：定义里也要有
  const reader = (await addTenantUser(api, tenant.adminToken, "qa-openapi-readonly@a.test", "readonly")).token;
  await check("PUT", R, tenantCall("PUT", `/brands/${brand}/rounding-unit`, { token: reader, version: 1, body: { rounding_unit: 10 } }), 403);
  await check("POST", `${P}/price-rules`, tenantCall("POST", `/products/${id}/price-rules`, { token: reader, version: 1, body: fixed() }), 403);
  await check("GET", `${P}/price-rules`, api.call("GET", `/tenant/v1/products/${id}/price-rules`), 401);
  await check("PUT", `${H}/{country}/{date}`, api.call("PUT", "/platform/v1/holidays/JP/2028-02-11", { body: { name: { ja: "x" } } }), 401);

  assert.equal(seen.size, 20, `应当覆盖 17 个租户接口 + 3 个平台接口（平台的查询、登记、删除），实际 ${seen.size}：${[...seen].join("、")}`);
  // 批量保存 200 的 created_ids 另有一个【缺陷】测试
  assert.deepEqual(problems.filter((problem) => !problem.includes("created_ids")), []);
});

test("【缺陷】openapi.yaml 的 PriceRulesSaved 自相矛盾：它是「PriceRules + created_ids」，但 PriceRules 写了 additionalProperties: false，按定义校验时批量保存的真实应答（带 created_ids）通不过", async () => {
  const id = await product();
  const saved = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: { create: [fixed({ ref: "x" })] } }));
  assert.equal(saved.created_ids.length, 1);
  // 期望：真实应答符合 openapi.yaml 里这个接口 200 的定义；实际：created_ids 被 PriceRules 的 additionalProperties: false 判为多余字段
  assert.deepEqual(schemaErrors(saved, responseSchema("POST", "/tenant/v1/products/{id}/price-rules/batch", 200).schema, "batch 200"), []);
});

test("规则 4：价格相关的 20 个接口的成功和失败应答里，没有任何字段名或文字涉及对外价、加价比例、渠道、汇率（逐层扫描全部字段名）", async () => {
  const id = await publishable();
  const forbiddenKey = /markup|margin|sell|sale_price|public|retail|channel|commission|fx|exchange|customer_price|outward|external_price/i;
  const forbiddenText = /对外价|加价比例|加价率|渠道价|销售价|佣金|汇率/;
  const bodies: [string, ApiResponse][] = [];
  const record = async (label: string, res: Promise<ApiResponse>): Promise<ApiResponse> => {
    const done = await res;
    bodies.push([label, done]);
    return done;
  };
  const created = await record("新增价格", call("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed({ direction: "both" }) }));
  const adjust = await record("新增调价", call("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody() }));
  await record("批量", call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ area_id: ids["a2"], ref: "r" })] } }));
  await record("修改价格", call("PUT", `/products/${id}/price-rules/${created.body.price_rule.id}`, { version: await version(id), body: fixed({ direction: "both", base_price: 30_000 }) }));
  await record("修改调价", call("PUT", `/products/${id}/adjust-rules/${adjust.body.adjust_rule.id}`, { version: await version(id), body: adjustBody({ name: "改" }) }));
  await record("重排", call("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: [adjust.body.adjust_rule.id] } }));
  await record("停用", call("POST", `/products/${id}/adjust-rules/${adjust.body.adjust_rule.id}/disable`));
  await record("启用", call("POST", `/products/${id}/adjust-rules/${adjust.body.adjust_rule.id}/enable`));
  await record("上架", call("POST", `/products/${id}/publish`));
  for (const path of [`/products/${id}/price-rules`, `/products/${id}/price-coverage`, `/products/${id}/adjust-rules`, `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]},${ids["eco4"]}&direction=pickup&from=2026-10-01&to=2026-12-01`, "/price-overview", "/price-overview?summary=1", `/products/${id}/publish-check`, `/products/${id}`, "/brands", "/holidays?from=2026-01-01&to=2027-12-31"]) {
    await record(`GET ${path}`, call("GET", path));
  }
  await record("取整单位", call("PUT", `/brands/${ids["brand"]}/rounding-unit`, { version: await brandVersion(ids["brand"] as string), body: { rounding_unit: 1 } }));
  // 失败的应答
  await record("重叠", call("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed({ direction: "both" }) }));
  await record("校验失败", call("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed({ base_price: 0 }) }));
  await record("调到不大于 0", call("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ steps: [{ type: "amount", value: -99_999_999 }] }) }));
  await record("删光（已上架）", call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { delete: (await ok(call("GET", `/products/${id}/price-rules`))).items.map((item: any) => item.id) } }));
  await record("删调价", call("DELETE", `/products/${id}/adjust-rules/${adjust.body.adjust_rule.id}`, { version: await version(id) }));
  await record("平台节假日", platform("GET", "/holidays?from=2026-01-01&to=2027-12-31"));
  const keys = (value: unknown, out: Set<string> = new Set()): Set<string> => {
    if (Array.isArray(value)) for (const item of value) keys(item, out);
    else if (value !== null && typeof value === "object") for (const [key, child] of Object.entries(value)) (out.add(key), keys(child, out));
    return out;
  };
  assert.ok(bodies.length >= 25);
  for (const [label, res] of bodies) {
    assert.ok(res.status < 500, `${label}：${res.status}`);
    const bad = [...keys(res.body)].filter((key) => forbiddenKey.test(key));
    assert.deepEqual(bad, [], `${label} 的应答里有不该有的字段`);
    assert.doesNotMatch(res.text, forbiddenText, label);
  }
});

// ───────────── 缺价、概况 ─────────────

test("缺价的组合：price-overview 里每个商品的缺价数和它自己的 price-coverage、price-rules 里的概况一致（接送机 / 点对点 / 包车各一个）；过期、停用的不算有价格，以后才生效的算", async () => {
  const brand = (await ok(call("POST", "/brands", { body: { name: "验收缺价", currency: "JPY" } }), 201)).id;
  const transfer = await product("airport_transfer", { brand_id: brand });
  const p2p = await product("point_to_point", { brand_id: brand });
  const charterId = await product("charter", { brand_id: brand });
  await ok(
    call("POST", `/products/${transfer}/price-rules/batch`, {
      version: 1,
      body: {
        create: [
          fixed({ direction: "both" }), // a1 × biz7：接、送都有
          fixed({ vehicle_group_id: ids["eco4"], direction: "pickup", valid_to: "2026-10-06" }), // 昨天过期：不算
          fixed({ vehicle_group_id: ids["eco4"], direction: "dropoff", status: "disabled" }), // 停用：不算
          fixed({ area_id: ids["a2"], direction: "pickup", valid_from: "2027-01-01" }), // 以后才生效：算（upcoming）
          fixed({ area_id: ids["a2"], vehicle_group_id: ids["eco4"], direction: "dropoff", valid_to: TODAY }), // 今天到期：算
        ],
      },
    }),
  );
  await ok(call("POST", `/products/${p2p}/price-rules`, { version: 1, body: fixed({ direction: undefined }) }), 201);
  const pkg = (hours: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ area_id: ids["a1"], vehicle_group_id: ids["biz7"], package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: 98_000, overtime_per_hour: 5_000, over_km_per_km: 400, valid_from: "2026-10-01", ...extra });
  await ok(call("POST", `/products/${charterId}/price-rules/batch`, { version: 1, body: { create: [pkg(8), pkg(10), pkg(10, { area_id: ids["a2"], status: "disabled" })] } }));
  const overview = await ok(call("GET", "/price-overview"));
  const expected: Record<string, [number, number]> = { [transfer]: [8, 4], [p2p]: [4, 3], [charterId]: [8, 6] };
  for (const [productId, [total, missing]] of Object.entries(expected)) {
    const coverage = await ok(call("GET", `/products/${productId}/price-coverage`));
    const rules = await ok(call("GET", `/products/${productId}/price-rules`));
    const item = overview.items.find((entry: any) => entry.product_id === productId);
    assert.deepEqual([coverage.total, coverage.missing, coverage.priced], [total, missing, total - missing], `price-coverage ${productId}`);
    assert.deepEqual(rules.coverage, { total, priced: total - missing, missing }, `price-rules 里的概况 ${productId}`);
    assert.deepEqual(item.coverage, { total, missing }, `price-overview ${productId}`);
    assert.equal(coverage.combos.filter((combo: any) => combo.state === "missing").length, missing);
    assert.equal(item.price_rule_count, rules.items.length);
  }
  const combos = (await ok(call("GET", `/products/${transfer}/price-coverage`))).combos;
  const state = (areaKey: string, group: string, direction: string): unknown => {
    const combo = combos.find((entry: any) => entry.area_id === ids[areaKey] && entry.vehicle_group_id === ids[group] && entry.direction === direction);
    return [combo.state, combo.via_both, combo.from];
  };
  assert.deepEqual(state("a1", "biz7", "pickup"), ["priced", true, "2026-10-01"]);
  assert.deepEqual(state("a1", "eco4", "pickup"), ["missing", false, null]);
  assert.deepEqual(state("a1", "eco4", "dropoff"), ["missing", false, null]);
  assert.deepEqual(state("a2", "biz7", "pickup"), ["upcoming", false, "2027-01-01"]);
  assert.deepEqual(state("a2", "eco4", "dropoff"), ["priced", false, "2026-10-01"]);
  // 缺价不拦保存也不拦上架（负责人确认的口径）：8 个组合缺 4 个的商品照样有「启用且未过期的价格」
  assert.equal(overview.items.find((entry: any) => entry.product_id === transfer).has_active_price, true);
});

// ───────────── 日期边界（最后一个：会把时钟拨过午夜）─────────────

test("过期按城市当地的今天判断：今天到期的价格，东京 23:59 还能上架、00:00 就过期了；同一个时刻纽约（有夏令时的城市）还是前一天，同样日期的价格在纽约的商品上仍然有效；概况、缺价、上架检查三处口径一致", async () => {
  const relogin = async (): Promise<void> => {
    const res = await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD } }));
    tenant = { ...tenant, adminToken: res.access_token };
  };
  const brand = (await ok(call("POST", "/brands", { body: { name: "验收午夜", currency: "JPY" } }), 201)).id;
  const usBrand = (await ok(call("POST", "/brands", { body: { name: "验收纽约", currency: "USD" } }), 201)).id;
  const tokyo = await publishable("point_to_point", { brand_id: brand });
  const second = await publishable("point_to_point", { brand_id: brand });
  const nyArea = await area({ city: ids["nyc"] as string, at: [-74.1, 40.6] });
  const ny = await publishable("point_to_point", { brand_id: usBrand, city_id: ids["nyc"], areas: [{ area_id: nyArea }] });
  // 当地 2026-10-07 到期的价格
  for (const [productId, areaId] of [[tokyo, ids["a1"]], [second, ids["a1"]], [ny, nyArea]] as [string, string][]) {
    await ok(call("POST", `/products/${productId}/price-rules`, { version: await version(productId), body: fixed({ area_id: areaId, direction: undefined, valid_from: "2026-10-01", valid_to: "2026-10-07" }) }), 201);
  }
  await ok(call("POST", `/products/${tokyo}/publish`));
  const facts = async (productId: string): Promise<unknown> => {
    const rules = await ok(call("GET", `/products/${productId}/price-rules`));
    const check = await ok(call("GET", `/products/${productId}/publish-check`));
    const item = (await ok(call("GET", "/price-overview"))).items.find((entry: any) => entry.product_id === productId);
    const adjusts = await ok(call("GET", `/products/${productId}/adjust-rules`));
    assert.equal(adjusts.today, rules.today, "各接口的「今天」一致");
    return [rules.today, rules.coverage.priced > 0, check.items.find((entry: any) => entry.key === "price_rules").issues.map((issue: any) => issue.reason), item.has_active_price, item.coverage.missing < item.coverage.total];
  };
  // 拨到东京 2026-10-07 23:59:30（UTC 14:59:30）
  const target = Date.parse("2026-10-07T14:59:30.000Z");
  api.clock.advance(target - api.clock.now().getTime());
  await relogin();
  assert.deepEqual(await facts(tokyo), ["2026-10-07", true, [], true, true]);
  assert.deepEqual(await facts(second), ["2026-10-07", true, [], true, true]);
  // 纽约此刻是 10-07 10:59（夏令时，UTC−4）
  assert.deepEqual(await facts(ny), ["2026-10-07", true, [], true, true]);
  // 过 31 秒：东京 2026-10-08 00:00:01
  api.clock.advance(31_000);
  assert.deepEqual(await facts(tokyo), ["2026-10-08", false, ["ALL_PRICE_RULES_EXPIRED"], false, false]);
  assert.deepEqual(await facts(second), ["2026-10-08", false, ["ALL_PRICE_RULES_EXPIRED"], false, false]);
  assert.deepEqual(await facts(ny), ["2026-10-07", true, [], true, true], "纽约还是 10-07");
  const refusedPublish = await call("POST", `/products/${second}/publish`);
  assert.deepEqual([refusedPublish.status, refusedPublish.body.error.code], [409, "PUBLISH_CHECK_FAILED"]);
  assert.equal((await ok(call("POST", `/products/${ny}/publish`))).status, "published", "纽约的商品此刻还能上架");
  // 东京那个已经上架的商品：价格过了午夜自然过期，商品还挂着「已上架」（没有定时下架）；这时把结束日期延到今天就恢复
  assert.equal((await ok(call("GET", `/products/${tokyo}`))).status, "published");
  const rule = (await ok(call("GET", `/products/${tokyo}/price-rules`))).items[0];
  const stillExpired = await call("PUT", `/products/${tokyo}/price-rules/${rule.id}`, { version: await version(tokyo), body: fixed({ direction: undefined, valid_to: "2026-10-07", base_price: 21_000 }) });
  assert.deepEqual([stillExpired.status, stillExpired.body.error.code], [409, "PUBLISH_CHECK_FAILED"], "改了价但没延期：仍然不满足上架条件");
  assert.equal((await call("PUT", `/products/${tokyo}/price-rules/${rule.id}`, { version: await version(tokyo), body: fixed({ direction: undefined, valid_to: "2026-10-08" }) })).status, 200);
  assert.deepEqual(await facts(tokyo), ["2026-10-08", true, [], true, true]);
  // 纽约夏令时结束那一夜（2026-11-01 01:59 EDT → 01:00 EST）：两次「01:30」都是 11-01；价格 11-01 到期
  const nyRule = (await ok(call("GET", `/products/${ny}/price-rules`))).items[0];
  await ok(call("PUT", `/products/${ny}/price-rules/${nyRule.id}`, { version: await version(ny), body: fixed({ area_id: nyArea, direction: undefined, valid_from: "2026-10-01", valid_to: "2026-11-01" }) }));
  const moveTo = async (iso: string): Promise<void> => {
    api.clock.advance(Date.parse(iso) - api.clock.now().getTime());
    await relogin();
  };
  await moveTo("2026-11-01T03:59:00.000Z"); // 10-31 23:59 EDT
  assert.equal((await ok(call("GET", `/products/${ny}/price-rules`))).today, "2026-10-31");
  await moveTo("2026-11-01T05:30:00.000Z"); // 11-01 01:30 EDT
  assert.equal((await ok(call("GET", `/products/${ny}/price-rules`))).today, "2026-11-01");
  await moveTo("2026-11-01T06:30:00.000Z"); // 11-01 01:30 EST（第二次）
  assert.deepEqual(await facts(ny), ["2026-11-01", true, [], true, true]);
  await moveTo("2026-11-02T04:59:00.000Z"); // 11-01 23:59 EST
  assert.deepEqual(await facts(ny), ["2026-11-01", true, [], true, true]);
  await moveTo("2026-11-02T05:00:30.000Z"); // 11-02 00:00 EST
  assert.deepEqual(await facts(ny), ["2026-11-02", false, ["ALL_PRICE_RULES_EXPIRED"], false, false]);
});
