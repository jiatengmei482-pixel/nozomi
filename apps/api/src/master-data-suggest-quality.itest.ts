/**
 * M1-11：机场的城市建议不再只看距离——数据源说的「所属城市」名称对上的排第一，其余按人口和距离；
 * 城市导入不再把区和市内的街区当成城市；重新导入会给已有的机场、城市回填这两项数据源信息，且不算修改。
 * 真的跑导入命令和接口、真实 PostgreSQL。机场和城市是测试里编的（编号用 96 / 99 开头的大数），
 * 坐标、人口取自真实的大致情况，便于对照「羽田该建议东京而不是川崎」这类结论。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { geonamesCityCode } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { leakedSecrets, testEnv } from "./testing/fixtures.ts";
import { exitWithin, startNode } from "./testing/process.ts";

const CITIES_ENTRY = fileURLToPath(new URL("./cli/masterdata-import-cities.ts", import.meta.url));
const AIRPORTS_ENTRY = fileURLToPath(new URL("./cli/masterdata-import-airports.ts", import.meta.url));

interface CityRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  population: number;
  code: string;
  admin1: string;
  admin2?: string;
  country?: string;
}

function cityLine(row: CityRow): string {
  const country = row.country ?? "JP";
  return [row.id, row.name, row.name, "", row.lat, row.lng, "P", row.code, country, "", row.admin1, row.admin2 ?? "", "", "", row.population, "", "10", country === "KR" ? "Asia/Seoul" : "Asia/Tokyo", "2026-01-01"].join("\t");
}

const TOKYO: CityRow = { id: 990101, name: "Tokyo", lat: 35.6895, lng: 139.69171, population: 9_733_276, code: "PPLC", admin1: "40" };
const KAWASAKI: CityRow = { id: 990102, name: "Kawasaki", lat: 35.52056, lng: 139.71722, population: 1_538_262, code: "PPLA2", admin1: "19", admin2: "1859635" };
const YOKOHAMA: CityRow = { id: 990103, name: "Yokohama", lat: 35.43333, lng: 139.65, population: 3_777_491, code: "PPLA", admin1: "19", admin2: "1848350" };
const CHIBA: CityRow = { id: 990104, name: "Chiba", lat: 35.6, lng: 140.11667, population: 979_768, code: "PPLA", admin1: "04", admin2: "2113012" };
const KASHIWA: CityRow = { id: 990105, name: "Kashiwa", lat: 35.86224, lng: 139.97732, population: 433_436, code: "PPLA2", admin1: "04", admin2: "2112330" };
const OTA: CityRow = { id: 990106, name: "Ōta", lat: 35.56126, lng: 139.71605, population: 748_081, code: "PPLA2", admin1: "40", admin2: "1853655" };
const SAGAMIHARA: CityRow = { id: 990107, name: "Sagamihara", lat: 35.55306, lng: 139.35444, population: 720_780, code: "PPLA2", admin1: "19", admin2: "1853293" };
const AIHARA: CityRow = { id: 990108, name: "Aihara", lat: 35.6, lng: 139.31667, population: 725_493, code: "PPL", admin1: "19", admin2: "1853293" };
const SEOUL: CityRow = { id: 990109, name: "Seoul", lat: 37.566, lng: 126.9784, population: 10_349_312, code: "PPLC", admin1: "11", country: "KR" };
const INCHEON: CityRow = { id: 990110, name: "Incheon", lat: 37.45646, lng: 126.70515, population: 3_015_482, code: "PPLA", admin1: "12", country: "KR" };
const BUCHEON: CityRow = { id: 990111, name: "Bucheon-si", lat: 37.49889, lng: 126.78306, population: 850_731, code: "PPL", admin1: "13", admin2: "31050", country: "KR" };
const ALL_CITIES = [TOKYO, KAWASAKI, YOKOHAMA, CHIBA, KASHIWA, OTA, SAGAMIHARA, AIHARA, SEOUL, INCHEON, BUCHEON];
const nameLine = (cityId: number, tag: string, name: string): string => [1, cityId, tag, name, "", "", "", "", "", ""].join("\t");
const JP_NAMES = [nameLine(OTA.id, "ja", "大田区"), nameLine(KAWASAKI.id, "ja", "川崎市"), nameLine(TOKYO.id, "ja", "東京")].join("\n");

const AIRPORT_HEADER = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,municipality,scheduled_service,iata_code";
const AIRPORTS: [id: number, iata: string, name: string, lat: number, lng: number, country: string, municipality: string][] = [
  [960101, "ZHN", "Test Haneda", 35.549678, 139.786958, "JP", "Tokyo"],
  [960102, "ZNR", "Test Narita", 35.76858, 140.388714, "JP", "Narita"],
  [960103, "ZGM", "Test Gimpo", 37.5583, 126.791, "KR", ""],
  [960104, "ZIC", "Test Incheon", 37.4691, 126.4509, "KR", "Seoul"],
  [960105, "ZOK", "Test Naha", 26.195801, 127.646004, "JP", "Naha"],
];
const airportsCsv = (withMunicipality: boolean): string =>
  `${withMunicipality ? AIRPORT_HEADER : AIRPORT_HEADER.replace(",municipality", "")}\n${AIRPORTS.map(([id, iata, name, lat, lng, country, municipality]) =>
    [id, `T${id}`, "large_airport", name, lat, lng, country, ...(withMunicipality ? [`"${municipality}"`] : []), "yes", iata].join(","),
  ).join("\n")}\n`;

let api: TestApi;
let root: string;
let dir: string;
const at = (name: string): string => join(dir, name);

async function run(entry: string, args: string[]): Promise<string> {
  const running = startNode(entry, testEnv(api.db.url), args);
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.equal(code, 0, running.output());
  assert.deepEqual(leakedSecrets(running.output()), [], "输出里不能有密钥");
  return running.output();
}

const importCities = (file: string, extra: string[] = []): Promise<string> => run(CITIES_ENTRY, ["--country", "JP,KR", "--file", at(file), "--names-file", at("JP.txt"), ...extra]);
const importAirports = (file: string, extra: string[] = []): Promise<string> => run(AIRPORTS_ENTRY, ["--country", "JP,KR", "--file", at(file), ...extra]);

async function rows(table: "cities" | "places", extra: string): Promise<Record<string, any>> {
  const result = await api.db.owner.query(`select code, version, status, updated_at, source_overridden, ${extra} as hint from ${table}`);
  return Object.fromEntries(result.rows.map((row) => [row.code, row]));
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
}

/** 平台「待指定城市」列表里各机场的建议：三字码 → 候选城市的英文名（按建议的顺序）。 */
async function suggestions(): Promise<Record<string, string[]>> {
  const res = await api.call("GET", "/platform/v1/master/places?city_id=none&sort=code", { token: root });
  assert.equal(res.status, 200, res.text);
  const byPlace = new Map<string, any>(res.body.city_suggestions.map((entry: any) => [entry.place_id, entry]));
  return Object.fromEntries(
    res.body.items.map((item: any) => {
      const entry = byPlace.get(item.id);
      assert.deepEqual(Object.keys(entry).sort(), ["nearby_cities", "place_id", "suggested_city"]);
      assert.deepEqual(entry.suggested_city, entry.nearby_cities[0] ?? null, "首选就是候选里的第一个");
      for (const city of entry.nearby_cities) assert.deepEqual(Object.keys(city).sort(), ["code", "distance_km", "id", "name"], "应答的结构没有变（前端的契约测试钉着）");
      return [item.code, entry.nearby_cities.map((city: any) => city.name.en)];
    }),
  );
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-suggest-"));
  await writeFile(at("cities.txt"), `${ALL_CITIES.map(cityLine).join("\n")}\n`);
  await writeFile(at("JP.txt"), JP_NAMES);
  await writeFile(at("airports-old.csv"), airportsCsv(false));
  await writeFile(at("airports.csv"), airportsCsv(true));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

test("城市导入：区（大田区）和市内的街区（相原，和相模原在同一个市）不导入，输出里写明原因；人口随城市一起存下", async () => {
  const output = await importCities("cities.txt", ["--activate"]);
  assert.match(output, /共 9 个/);
  assert.match(output, /新增 9 个/);
  assert.match(output, /没有选的 2 条（人口够，但不是城市）/);
  assert.match(output, new RegExp(`大田区（${geonamesCityCode("JP", OTA.id)}）：是城市里的区`));
  assert.match(output, new RegExp(`Aihara（${geonamesCityCode("JP", AIHARA.id)}）：是某个市里面的街区`));
  assert.doesNotMatch(output, /以前导入过、其实不是城市的/);
  const cities = await rows("cities", "population");
  assert.equal(Object.keys(cities).length, 9);
  assert.equal(cities[geonamesCityCode("JP", OTA.id)], undefined);
  assert.equal(cities[geonamesCityCode("JP", AIHARA.id)], undefined);
  assert.equal(cities[geonamesCityCode("JP", TOKYO.id)].hint, 9_733_276);
  assert.equal(cities[geonamesCityCode("KR", BUCHEON.id)].hint, 850_731, "韩国的 PPL 城市（没有同一个市的首府记录）照常导入");
});

test("老文件导入的机场没有「所属城市名」：建议只能靠人口和距离——羽田、成田、金浦已经是大城市在前，但仁川机场还是仁川市", async () => {
  await importAirports("airports-old.csv");
  const places = await rows("places", "municipality");
  assert.deepEqual(Object.values(places).map((place) => place.hint), [null, null, null, null, null]);
  assert.deepEqual(await suggestions(), {
    ZGM: ["Seoul", "Incheon", "Bucheon-si"],
    ZHN: ["Tokyo", "Kawasaki", "Yokohama"],
    ZIC: ["Incheon", "Seoul", "Bucheon-si"],
    ZNR: ["Tokyo", "Chiba", "Yokohama"],
    ZOK: [],
  });
});

test("重新导入机场：给已有的机场回填「所属城市名」，不算修改——版本号、更新时间、「平台改过」、审计日志都不变；平台改过的机场同样回填", async () => {
  // 平台改过其中一个机场的英文名：导入不再覆盖它的名称，但所属城市名照样回填
  const listed = await api.call("GET", "/platform/v1/master/places?code=ZIC", { token: root });
  const edited = listed.body.items[0];
  const patched = await api.call("PATCH", `/platform/v1/master/places/${edited.id}`, { token: root, headers: { "if-match": `"${edited.version}"` }, body: { name: { en: "Incheon (edited)" } } });
  assert.equal(patched.status, 200, patched.text);
  const before = await rows("places", "municipality");
  assert.equal(before["ZIC"].source_overridden, true);
  const audits = await auditCount();

  const dry = await importAirports("airports.csv", ["--dry-run"]);
  assert.match(dry, /给 4 个已有的机场将补上数据源里的「所属城市名」/);
  assert.deepEqual(await rows("places", "municipality"), before, "试运行什么都不写");

  api.clock.advance(60_000);
  const output = await importAirports("airports.csv");
  assert.match(output, /新增 0 个/);
  assert.match(output, /更新 0 个；没有变化 4 个；平台改过、没有覆盖 1 个/);
  assert.match(output, /给 4 个已有的机场补上了数据源里的「所属城市名」（只用来建议城市，不算修改，也不算平台改过）/);
  const after = await rows("places", "municipality");
  assert.deepEqual(Object.fromEntries(Object.entries(after).map(([code, place]) => [code, place.hint])), { ZGM: null, ZHN: "Tokyo", ZIC: "Seoul", ZNR: "Narita", ZOK: "Naha" });
  for (const code of Object.keys(after)) {
    assert.deepEqual([after[code].version, after[code].updated_at, after[code].source_overridden, after[code].status], [before[code].version, before[code].updated_at, before[code].source_overridden, before[code].status], code);
  }
  assert.equal(await auditCount(), audits, "不写审计日志");
  assert.equal((await api.call("GET", `/platform/v1/master/places/${edited.id}`, { token: root })).body.name.en, "Incheon (edited)");
  // 再来一次：没有可回填的了
  assert.doesNotMatch(await importAirports("airports.csv"), /所属城市名/);
});

test("有了所属城市名：仁川机场建议首尔（48 公里，比仁川市远一倍）、羽田建议东京（最近的是川崎）；数据源说的城市库里没有时仍按人口和距离（成田 → 东京）；没有合适的城市仍是空", async () => {
  assert.deepEqual(await suggestions(), {
    ZGM: ["Seoul", "Incheon", "Bucheon-si"],
    ZHN: ["Tokyo", "Kawasaki", "Yokohama"],
    ZIC: ["Seoul", "Incheon", "Bucheon-si"],
    ZNR: ["Tokyo", "Chiba", "Yokohama"],
    ZOK: [],
  });
  // 距离仍是到城市中心的实际距离，不因为排在前面而变
  const res = await api.call("GET", "/platform/v1/master/places?city_id=none&code=ZIC", { token: root });
  const [seoul, incheon, bucheon] = res.body.city_suggestions[0].nearby_cities;
  assert.ok(seoul.distance_km > 40 && seoul.distance_km > incheon.distance_km && bucheon.distance_km > incheon.distance_km, "首选不是最近的那个，也可以比其余的候选远");
  // 名称对上的城市停用了：不再建议它
  const stop = await api.call("POST", `/platform/v1/master/cities/${seoul.id}/disable`, { token: root });
  assert.equal(stop.status, 200, stop.text);
  assert.deepEqual((await suggestions())["ZIC"], ["Incheon", "Bucheon-si"]);
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${seoul.id}/enable`, { token: root })).status, 200);
  // 租户的列表、普通列表仍然不带建议
  assert.equal("city_suggestions" in (await api.call("GET", "/platform/v1/master/places", { token: root })).body, false);
});

test("以前导入过的区和街区：重新导入时不停用、不删除、不更新，在输出里列出来请人处理；已有城市的人口被回填，不算修改", async () => {
  // 摆出「M1-09 时导入的」样子：区和街区当时被当成城市导入了，所有城市都还没有人口
  for (const row of [OTA, AIHARA]) {
    const res = await api.call("POST", "/platform/v1/master/cities", {
      token: root,
      body: { code: geonamesCityCode("JP", row.id), country_code: "JP", name: { en: row.name }, timezone: "Asia/Tokyo", center: { lng: row.lng, lat: row.lat } },
    });
    assert.equal(res.status, 201, res.text);
    await api.db.owner.query("update cities set source = 'geonames', source_ref = $2, source_synced_at = now() where id = $1", [res.body.id, String(row.id)]);
  }
  await api.db.owner.query("update cities set population = null");
  const before = await rows("cities", "population");
  const audits = await auditCount();

  const dry = await importCities("cities.txt", ["--dry-run"]);
  assert.match(dry, /给 9 个已有的城市将补上数据源里的人口/);
  assert.deepEqual(await rows("cities", "population"), before);

  api.clock.advance(60_000);
  const output = await importCities("cities.txt");
  assert.match(output, /新增 0 个/);
  assert.match(output, /更新 0 个；没有变化 9 个/);
  assert.match(output, /给 9 个已有的城市补上了数据源里的人口（只用来给机场建议城市，不算修改）/);
  assert.match(output, /以前导入过、其实不是城市的 2 个（没有自动停用，也没有删除；请在后台核对后停用/);
  assert.match(output, new RegExp(`  - 大田区（${geonamesCityCode("JP", OTA.id)}）：是城市里的区`));
  assert.match(output, new RegExp(`  - Aihara（${geonamesCityCode("JP", AIHARA.id)}）：是某个市里面的街区`));
  const after = await rows("cities", "population");
  assert.equal(Object.keys(after).length, 11, "一个都没有删");
  for (const code of Object.keys(after)) {
    assert.deepEqual([after[code].version, after[code].updated_at, after[code].source_overridden, after[code].status], [before[code].version, before[code].updated_at, before[code].source_overridden, before[code].status], code);
  }
  assert.equal(after[geonamesCityCode("JP", TOKYO.id)].hint, 9_733_276);
  assert.equal(after[geonamesCityCode("JP", OTA.id)].hint, null, "不算城市的记录不回填");
  assert.equal(after[geonamesCityCode("JP", OTA.id)].status, "active", "没有自动停用");
  assert.equal(await auditCount(), audits);
  // 这个「区」还启用着、又没有人口（按 30 万算）：羽田的首选仍是名称对上的东京；人把它停用后它就从候选里消失
  assert.equal((await suggestions())["ZHN"]?.[0], "Tokyo");
});
