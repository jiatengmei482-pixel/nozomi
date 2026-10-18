/**
 * M1-15：机场的中文名、日文名从 GeoNames 导入（ADR 0024）。
 * 真的启动 `pnpm masterdata:import-airport-names` 背后的入口文件，读测试里现场构造的小样本文件（不联网、不用真实数据文件；
 * GeoNames 编号用 99 开头的大数，和真实数据无关），再从接口和数据库核对结果。
 * 机场先用机场导入（OurAirports 的格式，同样是现场构造的样本）建好，另有一个平台在后台手工建的机场。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAirportNames, selectAirports } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import { tryLockAirportNameImport } from "../repos/master-data.ts";
import { importAirports } from "../services/airport-import.ts";
import { AirportNameImportError, importAirportNames } from "../services/airport-name-import.ts";
import { type TenantFixture, type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";
import { buildZip } from "../testing/zip.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-airport-names.ts", import.meta.url));

// ---- 机场（OurAirports 的 airports.csv 格式）----
const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
const AIRPORTS = [
  { id: 990901, iata: "NRT", name: "Test Narita International Airport", lat: 35.764702, lng: 140.386002, country: "JP" },
  { id: 990902, iata: "HND", name: "Test Tokyo Haneda International Airport", lat: 35.552299, lng: 139.779999, country: "JP" },
  { id: 990903, iata: "ICN", name: "Test Incheon International Airport", lat: 37.469101, lng: 126.450996, country: "KR" },
  { id: 990904, iata: "QZZ", name: "Test Unknown Airport", lat: 33.5, lng: 130.5, country: "JP" },
];
const airportsCsv = `${[
  HEADER,
  ...AIRPORTS.map((row) => [row.id, `"T${row.id}"`, '"large_airport"', `"${row.name}"`, row.lat, row.lng, 10, '"AS"', `"${row.country}"`, '"XX-01"', '"Testville"', '"yes"', "", `"${row.iata}"`, "", "", "", "", ""].join(",")),
].join("\n")}\n`;

// ---- GeoNames：国家文件（19 列）和各语言名称文件 ----
function feature(id: number, name: string, cls: string, code: string, lat: number, lng: number, country: string): string {
  return [id, name, name, "", lat, lng, cls, code, country, "", "12", "", "", "", 0, "", 10, country === "KR" ? "Asia/Seoul" : "Asia/Tokyo", "2026-01-01"].join("\t");
}
const JP_PLACES = [
  feature(990001, "Test Narita International Airport", "S", "AIRP", 35.76472, 140.38639, "JP"),
  feature(990002, "Test Tokyo International Airport", "S", "AIRP", 35.55222, 139.77944, "JP"),
  // 同一个三字码也挂在一个城市上：不是机场，不算
  feature(990003, "Test Narita City", "P", "PPLA2", 35.78333, 140.31667, "JP"),
  feature(990004, "Test Kansai International Airport", "S", "AIRP", 34.42733, 135.24400, "JP"),
].join("\n");
const KR_PLACES = feature(990010, "Test Incheon International Airport", "S", "AIRP", 37.46907, 126.45048, "KR");

let nameId = 9_000_000;
const alt = (geonameId: number, tag: string, name: string, preferred = false): string => [nameId++, geonameId, tag, name, preferred ? "1" : "", "", "", "", "", ""].join("\t");
const JP_NAMES = [
  alt(990001, "iata", "NRT"),
  alt(990001, "ja", "成田国際空港"),
  alt(990001, "zh", "成田国际机场"),
  alt(990001, "zh-Hant", "成田國際機場"),
  alt(990001, "en", "Narita International Airport"),
  alt(990002, "iata", "HND"),
  alt(990002, "ja", "Tōkyō Kokusai Kūkō"),
  alt(990002, "ja", "東京国際空港"),
  alt(990002, "ja", "羽田空港"),
  alt(990002, "zh", "東京國際機場"),
  alt(990003, "iata", "NRT"),
  alt(990003, "ja", "成田市"),
  alt(990004, "iata", "KIX"),
  alt(990004, "ja", "関西国際空港"),
  alt(990004, "zh", "关西国际机场"),
].join("\n");
const KR_NAMES = [alt(990010, "iata", "ICN"), alt(990010, "ja", "仁川国際空港"), alt(990010, "zh-CN", "仁川国际机场")].join("\n");

let api: TestApi;
let root: string;
let tenant: TenantFixture;
let dir: string;
let cityId: string;
const at = (...parts: string[]): string => join(dir, ...parts);
const LOCAL = (): string[] => ["--file", at("JP.zip"), "--names-file", at("alternatenames", "JP.zip")];

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
  dir = await mkdtemp(join(tmpdir(), "nozomi-airport-names-"));
  await mkdir(at("alternatenames"));
  await writeFile(at("JP.zip"), buildZip([{ name: "readme.txt", content: Buffer.from("x") }, { name: "JP.txt", content: Buffer.from(`${JP_PLACES}\n`) }]));
  await writeFile(at("alternatenames", "JP.zip"), buildZip([{ name: "JP.txt", content: Buffer.from(`${JP_NAMES}\n`) }]));
  await writeFile(at("KR.txt"), `${KR_PLACES}\n`);
  await writeFile(at("alternatenames", "KR.txt"), `${KR_NAMES}\n`);
  await importAirports(api.db.pool, selectAirports(airportsCsv, ["JP", "KR"]), api.clock.now(), { dryRun: false });
  const city = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.6917, lat: 35.6895 } },
  });
  assert.equal(city.status, 201, city.text);
  cityId = city.body.id;
  // 平台在后台手工建的关西机场（手工建的直接是启用的），中文名已经由平台填好
  const kix = await api.call("POST", "/platform/v1/master/places", {
    token: root,
    body: { type: "airport", code: "KIX", country_code: "JP", city_id: cityId, name: { zh: "关西机场（平台）" }, location: { lng: 135.244003, lat: 34.427299 } },
  });
  assert.equal(kix.status, 201, kix.text);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

async function run(args: string[]): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(api.db.url), args);
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.deepEqual(leakedSecrets(running.output()), [], "输出里不能有密钥");
  assert.doesNotMatch(running.output(), /\n\s+at .+:\d+:\d+/, "不应把程序的调用栈打给用户");
  return { code, output: running.output() };
}

interface Snapshot {
  name: Record<string, string>;
  version: number;
  status: string;
  nameSources: Record<string, unknown>;
  source: string | null;
  sourceOverridden: boolean;
}

async function airports(): Promise<Record<string, Snapshot>> {
  const rows = await api.db.owner.query("select code, name, version, status, name_sources, source, source_overridden from places where type = 'airport' order by code");
  return Object.fromEntries(
    rows.rows.map((row) => [row.code, { name: row.name, version: row.version, status: row.status, nameSources: row.name_sources, source: row.source, sourceOverridden: row.source_overridden }]),
  );
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'place' and action = 'update'")).rows[0].n;
}

test("参数：必须给 --country；--file 和 --names-file 要一起给；不认识的参数报用法", async () => {
  for (const args of [["--dry-run"], ["--country", "JP", "--file", at("JP.zip")], ["--country", "JP", "--names-file", at("alternatenames", "JP.zip")], ["--country", "JP", "--all-countries"], ["--country", "XX"]]) {
    const { code, output } = await run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(output, /用法：pnpm masterdata:import-airport-names --country/);
  }
  const missing = await run(["--country", "JP", "--file", at("nope.zip"), "--names-file", at("alternatenames", "JP.zip")]);
  assert.equal(missing.code, 1);
  assert.match(missing.output, /读不到文件/);
});

test("试运行：显示将要填的名称，数据库没有任何变化", async () => {
  const before = await airports();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP", ...LOCAL(), "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /试运行：下面是将要做的改动，数据库没有任何变化/);
  assert.match(output, /将给 3 个机场填名称（日文 3 个、中文 1 个）/);
  assert.match(output, /NRT：日文「成田国際空港」，中文「成田国际机场」/);
  assert.deepEqual(await airports(), before);
  assert.equal(await auditCount(), audits);
});

test("导入：注明来源和许可；按三字码只填空着的日文、中文；中文只有繁体的不填；不在所选国家的不碰；写审计日志", async () => {
  const before = await airports();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP", ...LOCAL()]);
  assert.equal(code, 0, output);
  assert.match(output.split("\n")[0] ?? "", /^数据来源：GeoNames（https:\/\/www\.geonames\.org\/），许可：知识共享 署名 4\.0（CC BY 4\.0），使用时须注明来源 GeoNames/);
  assert.match(output, /数据源里 JP 的机场记录 3 个，其中有三字码的 3 个/);
  assert.match(output, /库里 JP 的机场：对上了 3 个；数据源里找不到三字码的 1 个；需要人工处理 0 个/);
  assert.match(output, /数据源里只有繁体中文名、中文名没有填的 1 个（请在后台填简体）：HND/);
  assert.match(output, /已经有名称、和数据源的不一样，没有覆盖 1 处：\n {2}- KIX 中文：库里是「关西机场（平台）」（平台填的），数据源是「关西国际机场」/);
  assert.match(output, /数据源里找不到的：QZZ/);

  const now = await airports();
  assert.deepEqual(now["NRT"]?.name, { en: "Test Narita International Airport", ja: "成田国際空港", zh: "成田国际机场" });
  assert.deepEqual(now["HND"]?.name, { en: "Test Tokyo Haneda International Airport", ja: "東京国際空港" }, "日文取编号最小的正式名称；罗马字不要；繁体中文不要");
  assert.deepEqual(now["KIX"]?.name, { zh: "关西机场（平台）", ja: "関西国際空港" }, "手工建的机场同样只填空着的语言");
  assert.deepEqual(now["ICN"], before["ICN"], "没有选的国家不碰");
  assert.deepEqual(now["QZZ"], before["QZZ"]);
  for (const code of ["NRT", "HND", "KIX"]) {
    assert.equal(now[code]?.version, (before[code]?.version ?? 0) + 1, `${code} 的版本号加一`);
    assert.equal(now[code]?.status, before[code]?.status, "不改启用状态");
    assert.equal(now[code]?.source, before[code]?.source, "OurAirports 的来源标记不变");
    assert.equal(now[code]?.sourceOverridden, false);
  }
  assert.deepEqual(now["NRT"]?.nameSources, { ja: { source: "geonames", ref: "990001", text: "成田国際空港" }, zh: { source: "geonames", ref: "990001", text: "成田国际机场" } });
  assert.deepEqual(now["KIX"]?.nameSources, { ja: { source: "geonames", ref: "990004", text: "関西国際空港" } });

  assert.equal(await auditCount(), audits + 3);
  const log = await api.db.owner.query(
    "select actor_type, source, before, after from audit_logs where resource = 'place' and action = 'update' and resource_id = (select id::text from places where code = 'NRT') order by occurred_at desc limit 1",
  );
  assert.deepEqual(log.rows[0], {
    actor_type: "system",
    source: "cli",
    before: { name: { en: "Test Narita International Airport" } },
    after: { name: now["NRT"]?.name, name_source: { source: "geonames", source_ref: "990001", languages: ["ja", "zh"] } },
  });
});

test("可重复运行：同样的文件再导入一次，什么都不变（版本号、审计日志都不动）", async () => {
  const before = await airports();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP", ...LOCAL()]);
  assert.equal(code, 0, output);
  assert.match(output, /给 0 个机场填了名称（日文 0 个、中文 0 个）；没有要填的 3 个/);
  assert.deepEqual(await airports(), before);
  assert.equal(await auditCount(), audits);
});

test("导入后供应商在接送点里输入「成田」能找到成田机场；租户看到的应答里没有导入的内部记录", async () => {
  for (const code of ["NRT", "HND"]) {
    const place = (await api.call("GET", `/platform/v1/master/places?code=${code}&status=all`, { token: root })).body.items[0];
    const enabled = await api.call("POST", `/platform/v1/master/places/${place.id}/enable`, { token: root, body: { city_id: cityId } });
    assert.equal(enabled.status, 200, enabled.text);
  }
  // 接送点的选项：这个城市下启用中的机场和车站（前端按名称和编码在里面找）
  const options = await api.call("GET", `/tenant/v1/master/places?city_id=${cityId}&type=airport,station&sort=code`, { token: tenant.adminToken });
  assert.equal(options.status, 200, options.text);
  const found = options.body.items.filter((place: any) => `${Object.values(place.name).join(" ")} ${place.code}`.includes("成田"));
  assert.deepEqual(found.map((place: any) => place.code), ["NRT"]);
  assert.equal(found[0].name.ja, "成田国際空港", "导入的日文名");
  // 后端的关键字搜索同样找得到
  const searched = await api.call("GET", `/tenant/v1/master/places?q=${encodeURIComponent("成田")}`, { token: tenant.adminToken });
  assert.deepEqual(searched.body.items.map((place: any) => place.code), ["NRT"]);
  assert.ok(!JSON.stringify(options.body).includes("name_sources") && !JSON.stringify(options.body).includes("geonames"), "导入的内部记录不出现在应答里");
});

test("不覆盖人工修改：平台改了导入的日文名、删掉了导入的中文名之后再导入，改的保留，删的不补回去", async () => {
  const nrt = (await api.call("GET", "/platform/v1/master/places?code=NRT&status=all", { token: root })).body.items[0];
  const patched = await api.call("PATCH", `/platform/v1/master/places/${nrt.id}`, {
    token: root,
    headers: { "if-match": `"${nrt.version}"` },
    body: { name: { en: nrt.name.en, ja: "成田空港" } },
  });
  assert.equal(patched.status, 200, patched.text);
  const before = await airports();
  const { code, output } = await run(["--country", "JP", ...LOCAL()]);
  assert.equal(code, 0, output);
  assert.match(output, /NRT 日文：库里是「成田空港」（平台填的），数据源是「成田国際空港」/);
  assert.match(output, /以前导入过、平台后来删掉了，没有再填 1 处：NRT 中文/);
  assert.deepEqual(await airports(), before);
});

test("另一个国家用不解压的 .txt 也能导入；同时只能有一次导入在运行", async () => {
  const { code, output } = await run(["--country", "KR", "--file", at("KR.txt"), "--names-file", at("alternatenames", "KR.txt")]);
  assert.equal(code, 0, output);
  assert.deepEqual((await airports())["ICN"]?.name, { en: "Test Incheon International Airport", ja: "仁川国際空港", zh: "仁川国际机场" });

  const selection = selectAirportNames([`${JP_PLACES}\n`], [`${JP_NAMES}\n`], ["JP"]);
  await withPlatformTx(api.db.pool, async (db) => {
    assert.equal(await tryLockAirportNameImport(db), true);
    await assert.rejects(
      importAirportNames(api.db.pool, selection, api.clock.now(), { countries: ["JP"], dryRun: false }),
      (err: unknown) => err instanceof AirportNameImportError && err.code === "IMPORT_ALREADY_RUNNING",
    );
    const dry = await importAirportNames(api.db.pool, selection, api.clock.now(), { countries: ["JP"], dryRun: true });
    assert.equal(dry.fills.length, 0, "试运行不需要锁");
  });
});
