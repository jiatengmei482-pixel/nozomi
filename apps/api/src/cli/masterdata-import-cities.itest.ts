/**
 * M1-09 验收标准 1：主要城市从注明来源和许可的公开数据导入，可重复运行，不覆盖人工修改。
 * 真的启动 `pnpm masterdata:import-cities` 背后的入口文件，读测试里现场构造的小样本文件（不联网、不用真实数据文件；
 * 编号用 99 开头的大数，和真实数据无关），再从接口和数据库核对结果。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { geonamesCityCode, selectCities } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import { tryLockCityImport } from "../repos/master-data.ts";
import { CityImportError, importCities } from "../services/city-import.ts";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";
import { buildZip } from "../testing/zip.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-cities.ts", import.meta.url));

interface Row {
  id: number;
  name: string;
  lat: number;
  lng: number;
  population: number;
  country?: string;
  code?: string;
  timezone?: string;
}

/** GeoNames 城市文件的一行：19 列、制表符分隔。 */
function cityLine(row: Row): string {
  const country = row.country ?? "JP";
  return [row.id, row.name, row.name, "", row.lat, row.lng, "P", row.code ?? "PPL", country, "", "01", "", "", "", row.population, "", "10", row.timezone ?? (country === "KR" ? "Asia/Seoul" : "Asia/Tokyo"), "2026-01-01"].join("\t");
}

const citiesFile = (rows: Row[]): string => `${rows.map(cityLine).join("\n")}\n`;
const nameLine = (cityId: number, tag: string, name: string, preferred = false): string => [1, cityId, tag, name, preferred ? "1" : "", "", "", "", "", ""].join("\t");

const ALPHA: Row = { id: 990001, name: "Test Alpha", lat: 35.6895123, lng: 139.6917111, population: 9_000_000, code: "PPLC" };
const BRAVO: Row = { id: 990002, name: "Test Bravo", lat: 34.69379, lng: 135.50107, population: 2_700_000, code: "PPLA" };
const CHARLIE: Row = { id: 990003, name: "Test Charlie", lat: 43.06667, lng: 141.35, population: 150_000 };
const DELTA: Row = { id: 990004, name: "Test Delta", lat: 26.213, lng: 127.67851, population: 90_000, code: "PPLA" };
const ECHO: Row = { id: 990005, name: "Test Echo", lat: 37.566, lng: 126.9784, population: 10_000_000, country: "KR", code: "PPLC" };
const FOXTROT: Row = { id: 990006, name: "Test Foxtrot", lat: 40.7, lng: -74, population: 8_000_000, country: "US", timezone: "America/New_York" };
const SAMPLE = [ALPHA, BRAVO, CHARLIE, DELTA, ECHO, FOXTROT];
const JP_NAMES = [nameLine(990001, "ja", "テスト甲", true), nameLine(990001, "zh-CN", "测试甲"), nameLine(990001, "ko", "테스트 갑"), nameLine(990002, "ja", "テスト乙")].join("\n");
const KR_NAMES = [nameLine(990005, "ko", "테스트 무", true), nameLine(990005, "ja", "テスト戊")].join("\n");

let api: TestApi;
let root: string;
let dir: string;

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-cities-"));
  await writeFile(join(dir, "cities.txt"), citiesFile(SAMPLE));
  await writeFile(join(dir, "cities15000.zip"), buildZip([{ name: "cities15000.txt", content: Buffer.from(citiesFile(SAMPLE)) }]));
  await writeFile(join(dir, "JP.zip"), buildZip([{ name: "readme.txt", content: Buffer.from("x") }, { name: "JP.txt", content: Buffer.from(JP_NAMES) }]));
  await writeFile(join(dir, "KR.txt"), KR_NAMES);
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

const at = (name: string): string => join(dir, name);

async function run(args: string[]): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(api.db.url), args);
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.deepEqual(leakedSecrets(running.output()), [], "输出里不能有密钥");
  assert.doesNotMatch(running.output(), /\n\s+at .+:\d+:\d+/, "不应把程序的调用栈打给用户");
  return { code, output: running.output() };
}

/** 平台接口看到的城市，另从数据库补上来源（接口的应答里目前没有来源字段，见 ADR 0014）。 */
async function cities(): Promise<any[]> {
  const res = await api.call("GET", "/platform/v1/master/cities?limit=200&sort=code", { token: root });
  assert.equal(res.status, 200, res.text);
  const rows = await api.db.owner.query("select id, source, source_ref, source_overridden, source_synced_at from cities");
  const sources = new Map(rows.rows.map((row) => [row.id, row.source === null ? null : { name: row.source, ref: row.source_ref, overridden: row.source_overridden, synced_at: row.source_synced_at }]));
  return res.body.items.map((item: any) => ({ ...item, source: sources.get(item.id) ?? null }));
}

async function overridden(cityId: string): Promise<boolean> {
  return (await api.db.owner.query("select source_overridden from cities where id = $1", [cityId])).rows[0].source_overridden;
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'city'")).rows[0].n;
}

const code = (row: Row): string => geonamesCityCode(row.country ?? "JP", row.id);

test("迁移之后、导入之前：库里没有任何城市（没有预置数据）", async () => {
  assert.deepEqual(await cities(), []);
});

test("试运行：只显示将要做什么，数据库没有任何变化", async () => {
  const { code: exit, output } = await run(["--country", "JP", "--file", at("cities15000.zip"), "--names-file", at("JP.zip"), "--dry-run"]);
  assert.equal(exit, 0, output);
  assert.match(output, /试运行：下面是将要做的改动，数据库没有任何变化/);
  assert.match(output, /新增 3 个/);
  assert.deepEqual(await cities(), []);
  assert.equal(await auditCount(), 0);
});

test("按国家导入：人口达到门槛的城市加首都和一级行政区首府；注明来源和许可；多语言名称有就填；默认是停用的；每个都有审计日志", async () => {
  const { code: exit, output } = await run(["--country", "jp", "--file", at("cities15000.zip"), "--names-file", at("JP.zip")]);
  assert.equal(exit, 0, output);
  assert.match(output, /数据来源：GeoNames（https:\/\/www\.geonames\.org\/），许可：知识共享 署名 4\.0（CC BY 4\.0），使用时须注明来源 GeoNames/);
  assert.match(output, /共 6 行/);
  assert.match(output, /范围：JP 人口不少于 300000 的城市，外加首都和一级行政区首府，共 3 个/);
  assert.match(output, /其中有名称的：ja 2、zh 1、en 3、ko 1/);
  assert.match(output, /新增 3 个（停用状态，等平台在后台复核后启用；要直接启用请加 --activate）/);
  assert.match(output, /新增的：Test Alpha、Test Bravo、Test Delta/);

  const imported = await cities();
  assert.deepEqual(
    imported.map((city) => ({ code: city.code, country: city.country_code, name: city.name, timezone: city.timezone, center: city.center, boundary: city.boundary, status: city.status, version: city.version, source: city.source.name, ref: city.source.ref, overridden: city.source.overridden })),
    [
      { code: code(ALPHA), country: "JP", name: { en: "Test Alpha", ja: "テスト甲", zh: "测试甲", ko: "테스트 갑" }, timezone: "Asia/Tokyo", center: { lng: 139.691711, lat: 35.689512 }, boundary: null, status: "disabled", version: 1, source: "geonames", ref: "990001", overridden: false },
      { code: code(BRAVO), country: "JP", name: { en: "Test Bravo", ja: "テスト乙" }, timezone: "Asia/Tokyo", center: { lng: 135.50107, lat: 34.69379 }, boundary: null, status: "disabled", version: 1, source: "geonames", ref: "990002", overridden: false },
      { code: code(DELTA), country: "JP", name: { en: "Test Delta" }, timezone: "Asia/Tokyo", center: { lng: 127.67851, lat: 26.213 }, boundary: null, status: "disabled", version: 1, source: "geonames", ref: "990004", overridden: false },
    ].sort((x, y) => (x.code < y.code ? -1 : 1)),
  );
  const logs = await api.db.owner.query("select actor_type, actor_id, source, action, tenant_id, after from audit_logs where resource = 'city' order by id");
  assert.equal(logs.rows.length, 3);
  for (const row of logs.rows) {
    assert.deepEqual([row.actor_type, row.actor_id, row.source, row.action, row.tenant_id, row.after.source, row.after.status], ["system", null, "cli", "create", null, "geonames", "disabled"]);
    assert.equal("activated_on_import" in row.after, false);
  }
  // 租户默认看不到还没复核的城市；看得到的时候也没有来源信息
  const tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
  assert.deepEqual((await api.call("GET", "/tenant/v1/master/cities", { token: tenant.adminToken })).body.items, []);
  const all = await api.call("GET", "/tenant/v1/master/cities?status=all", { token: tenant.adminToken });
  assert.equal(all.body.total, 3);
  assert.doesNotMatch(all.text, /source|geonames|overridden|synced/);
});

test("同一批文件再导入一次：什么都不变，不重复、不加版本、不写日志", async () => {
  const before = await cities();
  const audits = await auditCount();
  const { code: exit, output } = await run(["--country", "JP", "--file", at("cities15000.zip"), "--names-file", at("JP.zip")]);
  assert.equal(exit, 0, output);
  assert.match(output, /新增 0 个/);
  assert.match(output, /更新 0 个；没有变化 3 个/);
  const strip = (items: any[]): unknown => items.map(({ source, ...rest }) => ({ ...rest, source: { ...source, synced_at: null } }));
  assert.deepEqual(strip(await cities()), strip(before));
  assert.equal(await auditCount(), audits);
});

test("--activate：这次新增的城市直接启用，审计里记明；以前导入的停用城市不受影响。解压好的 .txt 也能读，名称文件可以给多个", async () => {
  const { code: exit, output } = await run(["--country", "JP,KR", "--file", at("cities.txt"), "--names-file", at("JP.zip"), "--names-file", at("KR.txt"), "--activate"]);
  assert.equal(exit, 0, output);
  assert.match(output, /范围：JP、KR/);
  assert.match(output, /新增 1 个（已直接启用：--activate）/);
  assert.match(output, /没有变化 3 个/);
  const byCode = Object.fromEntries((await cities()).map((city) => [city.code, city]));
  assert.deepEqual([byCode[code(ECHO)].status, byCode[code(ECHO)].name, byCode[code(ECHO)].timezone], ["active", { en: "Test Echo", ko: "테스트 무", ja: "テスト戊" }, "Asia/Seoul"]);
  assert.deepEqual([byCode[code(ALPHA)].status, byCode[code(BRAVO)].status, byCode[code(DELTA)].status], ["disabled", "disabled", "disabled"]);
  const log = await api.db.owner.query("select after from audit_logs where resource = 'city' and resource_id = $1", [byCode[code(ECHO)].id]);
  assert.deepEqual([log.rows[0].after.status, log.rows[0].after.activated_on_import], ["active", true]);
  const tenant = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@fleet.test", password: "Quiet-Harbor-2026" } });
  assert.deepEqual((await api.call("GET", "/tenant/v1/master/cities", { token: tenant.body.access_token })).body.items.map((city: any) => city.code), [code(ECHO)]);
});

test("--min-population 调范围：门槛降低后多导入一个，已有的不动", async () => {
  const { code: exit, output } = await run(["--country", "JP", "--file", at("cities.txt"), "--min-population", "100000"]);
  assert.equal(exit, 0, output);
  assert.match(output, /人口不少于 100000 的城市/);
  assert.match(output, /各语言名称：没有给 --names-file，只导入英文名/);
  assert.match(output, /新增 1 个/);
  assert.match(output, /没有变化 3 个/, "这次没给名称文件：已有城市的日文、中文名不会因此被删掉");
  const byCode = Object.fromEntries((await cities()).map((city) => [city.code, city]));
  assert.deepEqual(byCode[code(CHARLIE)].name, { en: "Test Charlie" });
  assert.deepEqual(byCode[code(ALPHA)].name, { en: "Test Alpha", ja: "テスト甲", zh: "测试甲", ko: "테스트 갑" });
});

test("数据源更新后再导入：变了的更新并写审计，平台补的语言保留；平台改过的不覆盖；和手工建的城市看起来相同的不合并也不重复创建", async () => {
  const byCode = Object.fromEntries((await cities()).map((city) => [city.code, city]));
  const patch = (id: string, version: number, body: unknown) => api.call("PATCH", `/platform/v1/master/cities/${id}`, { token: root, body, headers: { "if-match": `"${version}"` } });
  // 平台只给 BRAVO 画了边界（不是数据源管的内容，不算「改过」），纠正了 DELTA 的中心坐标（算）
  const bounded = await patch(byCode[code(BRAVO)].id, 1, { boundary: { type: "Polygon", coordinates: [[[135, 34], [136, 34], [136, 35], [135, 35], [135, 34]]] } });
  assert.deepEqual([bounded.status, await overridden(byCode[code(BRAVO)].id)], [200, false]);
  const corrected = await patch(byCode[code(DELTA)].id, 1, { center: { lng: 127.68, lat: 26.21 } });
  assert.deepEqual([corrected.status, await overridden(byCode[code(DELTA)].id)], [200, true]);
  // 平台手工建了两个城市：一个和数据源里的 GOLF 同名，一个离 HOTEL 不到 5 公里
  const manual = async (body: unknown): Promise<any> => {
    const res = await api.call("POST", "/platform/v1/master/cities", { token: root, body });
    assert.equal(res.status, 201, res.text);
    return res.body;
  };
  const golf = await manual({ code: "CTY-JP-GLF", country_code: "JP", name: { zh: "手工的高尔夫市", en: "test golf" }, timezone: "Asia/Tokyo", center: { lng: 130, lat: 33 } });
  await manual({ code: "CTY-JP-HTL", country_code: "JP", name: { zh: "手工的酒店市" }, timezone: "Asia/Tokyo", center: { lng: 140.0101, lat: 36.0101 } });

  const audits = await auditCount();
  await writeFile(
    at("cities-v2.txt"),
    citiesFile([
      { ...ALPHA, name: "Test Alpha Renamed", lat: 35.7 },
      { ...BRAVO, timezone: "Asia/Seoul" },
      { ...DELTA },
      { id: 990007, name: "Test Golf", lat: 31, lng: 131, population: 500_000 },
      { id: 990008, name: "Test Hotel", lat: 36, lng: 140, population: 500_000 },
      { id: 990009, name: "Test India", lat: 38, lng: 141, population: 500_000, timezone: "Asia/Atlantis" },
    ]),
  );
  const first = await run(["--country", "JP", "--file", at("cities-v2.txt"), "--names-file", at("JP.zip")]);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /新增 0 个/);
  assert.match(first.output, /更新 2 个；没有变化 0 个；平台改过、没有覆盖 1 个/);
  assert.match(first.output, new RegExp(`平台改过的：${code(DELTA)}`));
  assert.match(first.output, /跳过 1 条不合格的记录：\n {2}- 第 6 行 Test India：时区 Asia\/Atlantis 不是合法的 IANA 时区名/);
  assert.match(first.output, /需要人工处理 2 个（这次没有动它们）/);
  assert.match(first.output, /- Test Golf（CTY-JP-G[0-9A-Z]+）：后台已经有一个看起来相同的城市 CTY-JP-GLF/);
  assert.match(first.output, /- Test Hotel（CTY-JP-G[0-9A-Z]+）：后台已经有一个看起来相同的城市 CTY-JP-HTL/);

  const now = Object.fromEntries((await cities()).map((city) => [city.code, city]));
  assert.equal(Object.keys(now).length, 7, "没有重复创建");
  assert.deepEqual([now[code(ALPHA)].name, now[code(ALPHA)].center, now[code(ALPHA)].version], [{ en: "Test Alpha Renamed", ja: "テスト甲", zh: "测试甲", ko: "테스트 갑" }, { lng: 139.691711, lat: 35.7 }, 2]);
  assert.deepEqual([now[code(BRAVO)].timezone, now[code(BRAVO)].boundary, now[code(BRAVO)].version], ["Asia/Seoul", bounded.body.boundary, 3], "边界是平台的，导入不碰");
  assert.deepEqual([now[code(DELTA)].center, now[code(DELTA)].version], [{ lng: 127.68, lat: 26.21 }, 2], "平台纠正过的坐标没有被覆盖");
  assert.deepEqual([now["CTY-JP-GLF"].name, now["CTY-JP-GLF"].source, now["CTY-JP-GLF"].version], [golf.name, null, 1]);
  assert.equal(await auditCount(), audits + 2);
  const update = await api.db.owner.query("select before, after, actor_type, source from audit_logs where resource = 'city' and action = 'update' and resource_id = $1 order by id desc limit 1", [now[code(ALPHA)].id]);
  assert.deepEqual(update.rows[0], {
    before: { name: { en: "Test Alpha", ja: "テスト甲", zh: "测试甲", ko: "테스트 갑" }, timezone: "Asia/Tokyo", center_lng: 139.691711, center_lat: 35.689512 },
    after: { name: { en: "Test Alpha Renamed", ja: "テスト甲", zh: "测试甲", ko: "테스트 갑" }, timezone: "Asia/Tokyo", center_lng: 139.691711, center_lat: 35.7, source: "geonames" },
    actor_type: "system",
    source: "cli",
  });
  // 再来一次：结果稳定
  const second = await run(["--country", "JP", "--file", at("cities-v2.txt"), "--names-file", at("JP.zip")]);
  assert.match(second.output, /更新 0 个；没有变化 2 个；平台改过、没有覆盖 1 个/);
  assert.equal(await auditCount(), audits + 2);
});

test("全部国家：--all-countries", async () => {
  const { code: exit, output } = await run(["--all-countries", "--file", at("cities.txt"), "--dry-run"]);
  assert.equal(exit, 0, output);
  assert.match(output, /范围：全部国家/);
  assert.match(output, /新增 1 个/, "只剩美国那一个还没导入");
});

test("两次城市导入不能同时进行；导入期间平台改了同一个城市的不覆盖", async () => {
  const selection = selectCities(citiesFile([{ id: 990020, name: "Test Busy", lat: 33, lng: 131.5, population: 900_000 }]), [], { countries: ["JP"], minPopulation: 300_000 });
  await withPlatformTx(api.db.pool, async (db) => {
    assert.equal(await tryLockCityImport(db), true);
    await assert.rejects(
      importCities(api.db.pool, selection, new Date(), { dryRun: false, activate: false }),
      (err: unknown) => err instanceof CityImportError && err.code === "IMPORT_ALREADY_RUNNING" && /另一个城市导入正在运行/.test(err.message),
    );
    assert.equal((await importCities(api.db.pool, selection, new Date(), { dryRun: true, activate: false })).creates.length, 1, "试运行不受影响");
  });
  await importCities(api.db.pool, selection, new Date(), { dryRun: false, activate: false });
  const { id } = (await api.db.owner.query("select id from cities where source_ref = '990020'")).rows[0];

  // 用一个没提交的事务占住那一行：导入算好了要更新它，写的时候排在锁后面；平台的修改先提交
  const changed = selectCities(citiesFile([{ id: 990020, name: "Test Busy Renamed", lat: 33.5, lng: 131.5, population: 900_000 }]), [], { countries: ["JP"], minPopulation: 300_000 });
  const platform = await api.db.owner.connect();
  let importing: ReturnType<typeof importCities>;
  try {
    await platform.query("begin");
    await platform.query(`update cities set center_lat = 34.123456, name = name || '{"ja": "人工补的"}'::jsonb, source_overridden = true, version = version + 1 where id = $1`, [id]);
    importing = importCities(api.db.pool, changed, new Date(), { dryRun: false, activate: false });
    for (let waited = 0; waited < 5_000; waited += 50) {
      const blocked = await api.db.owner.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update cities%'");
      if (blocked.rows[0].n > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await platform.query("commit");
  } finally {
    platform.release();
  }
  const result = await importing;
  assert.deepEqual([result.updates, result.conflicts.length], [[], 1]);
  assert.match(result.conflicts[0]?.reason ?? "", /导入期间平台在后台改了这个城市，没有覆盖/);
  const row = (await api.db.owner.query("select name, center_lat::float8 as lat from cities where id = $1", [id])).rows[0];
  assert.deepEqual([row.lat, row.name.ja, row.name.en], [34.123456, "人工补的", "Test Busy"]);
});

test("参数不对、文件不对：退出码 1，说明原因，数据库不变", async () => {
  const before = await cities();
  await writeFile(at("latin1.txt"), Buffer.from(citiesFile([{ id: 990030, name: "São Test", lat: 1, lng: 1, population: 900_000 }]), "latin1"));
  await writeFile(at("nul.txt"), citiesFile([ALPHA, { id: 990031, name: "Bad\u0000Name", lat: 36, lng: 140, population: 900_000 }]));
  await writeFile(at("other.zip"), buildZip([{ name: "something-else.txt", content: Buffer.from("x") }]));
  const zip = buildZip([{ name: "broken.txt", content: Buffer.from(citiesFile(SAMPLE).repeat(20)) }]);
  await writeFile(at("broken.zip"), zip.subarray(0, zip.length - 40));
  await writeFile(at("csv.txt"), "id,name\n1,Tokyo\n");
  const cases: [string[], RegExp][] = [
    [["--file", at("cities.txt")], /--country 和 --all-countries 必须给且只能给一个/],
    [["--country", "JPN", "--file", at("cities.txt")], /不是合法的国家码：JPN/],
    [["--country", "JP", "--file", at("nope.txt")], /读不到文件/],
    [["--country", "JP", "--names-file", at("KR.txt")], /--names-file 要和 --file 一起用/],
    [["--country", "JP", "--file", at("cities.txt"), "--names-file", at("nope.zip")], /读不到文件/],
    [["--country", "JP", "--file", at("cities.txt"), "--min-population", "many"], /--min-population 必须是不小于 0 的整数/],
    [["--country", "JP", "--file", at("cities.txt"), "--min-population", "-5"], /参数不正确/],
    [["--country", "JP", "--file", at("cities.txt"), "--min-population", "1.5"], /--min-population 必须是不小于 0 的整数/],
    [["--country", "JP", "--file", at("cities.txt"), "--force"], /参数不正确/],
    [["--country", "JP", "--file", at("latin1.txt")], /没有导入：文件不是 UTF-8 编码.*数据库没有任何变化/],
    [["--country", "JP", "--file", at("nul.txt")], /没有导入：城市文件的第 2 行里有 NUL 字符.*数据库没有任何变化/],
    [["--country", "JP", "--file", at("other.zip")], /没有导入：压缩包里没有 other\.txt（里面有：something-else\.txt）/],
    [["--country", "JP", "--file", at("broken.zip")], /没有导入：.*(压缩包|zip)/],
    [["--country", "JP", "--file", at("csv.txt")], /没有导入：城市文件不是 GeoNames 的 cities15000\.txt/],
    [["--country", "JP", "--file", at("cities.txt"), "--names-file", at("csv.txt")], /没有导入：名称文件的第 1 行不是 GeoNames 的 alternateNames 格式/],
  ];
  for (const [args, expected] of cases) {
    const { code: exit, output } = await run(args);
    assert.equal(exit, 1, `${args.join(" ")}\n${output}`);
    assert.match(output, expected);
    assert.doesNotMatch(output, /请确认数据库已启动|23505/, "文件的问题不能说成数据库的问题");
  }
  assert.deepEqual(await cities(), before);
});

test("根目录的 package.json 里有这条命令，指向这个入口", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["masterdata:import-cities"], "node --env-file-if-exists=.env apps/api/src/cli/masterdata-import-cities.ts");
});
