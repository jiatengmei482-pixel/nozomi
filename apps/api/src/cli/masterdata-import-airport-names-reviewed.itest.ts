/**
 * M12-06：按机场名称核对表补空着的日文、简体中文名。
 * 真的启动 `pnpm masterdata:import-airport-names-reviewed` 背后的入口文件，读测试里现场写的小核对表（不用仓库里的真表），再从数据库核对结果。
 * 机场先用机场导入（OurAirports 格式的现场样本）建好，另有一个平台在后台手工建的、中文名已经填好的机场。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectAirports } from "@nozomi/domain";
import { importAirports } from "../services/airport-import.ts";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-airport-names-reviewed.ts", import.meta.url));

const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
const AIRPORTS = [
  { id: 991901, iata: "HND", name: "Test Tokyo Haneda International Airport", lat: 35.552299, lng: 139.779999, country: "JP" },
  { id: 991902, iata: "NGS", name: "Test Nagasaki Airport", lat: 32.916901, lng: 129.914001, country: "JP" },
  { id: 991903, iata: "ICN", name: "Test Incheon International Airport", lat: 37.469101, lng: 126.450996, country: "KR" },
];
const airportsCsv = `${[
  HEADER,
  ...AIRPORTS.map((row) => [row.id, `"T${row.id}"`, '"large_airport"', `"${row.name}"`, row.lat, row.lng, 10, '"AS"', `"${row.country}"`, '"XX-01"', '"Testville"', '"yes"', "", `"${row.iata}"`, "", "", "", "", ""].join(",")),
].join("\n")}\n`;

const TABLE = {
  airports: [
    { code: "HND", country: "JP", names: { zh: "东京国际机场", ja: "東京国際空港" }, sources: { zh: "测试：繁体转简体", ja: "测试：维基数据" } },
    { code: "NGS", country: "JP", names: { zh: "长崎机场" }, sources: { zh: "测试：维基数据" } },
    { code: "KIX", country: "JP", names: { zh: "关西国际机场" }, sources: { zh: "测试：维基数据" } },
    { code: "ICN", country: "KR", names: { zh: "仁川国际机场" }, sources: { zh: "测试：维基数据" } },
    { code: "QQQ", country: "JP", names: { zh: "库里没有的机场" }, sources: { zh: "测试" } },
  ],
};

let api: TestApi;
let dir: string;
let table: string;

before(async () => {
  api = await createTestApi();
  const root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-reviewed-names-"));
  table = join(dir, "table.json");
  await writeFile(table, JSON.stringify(TABLE));
  await importAirports(api.db.pool, selectAirports(airportsCsv, ["JP", "KR"]), api.clock.now(), { dryRun: false });
  const city = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code: "CTY-JP-OSA", country_code: "JP", name: { zh: "大阪" }, timezone: "Asia/Tokyo", center: { lng: 135.5023, lat: 34.6937 } },
  });
  assert.equal(city.status, 201, city.text);
  const kix = await api.call("POST", "/platform/v1/master/places", {
    token: root,
    body: { type: "airport", code: "KIX", country_code: "JP", city_id: city.body.id, name: { zh: "关西机场（平台）" }, location: { lng: 135.244003, lat: 34.427299 } },
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

async function names(): Promise<Record<string, { name: Record<string, string>; version: number; nameSources: Record<string, { source: string; ref: string; text: string }>; searchNames: string[] }>> {
  const rows = await api.db.owner.query("select code, name, version, name_sources, search_names from places where type = 'airport' order by code");
  return Object.fromEntries(rows.rows.map((row) => [row.code, { name: row.name, version: row.version, nameSources: row.name_sources, searchNames: row.search_names }]));
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'place' and action = 'update'")).rows[0].n;
}

test("参数：必须给 --country；不认识的参数、空的 --file 报用法", async () => {
  for (const args of [["--dry-run"], ["--country", "JP", "--names-file", table], ["--country", "JP", "--file", ""]]) {
    const { code, output } = await run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(output, /用法：pnpm masterdata:import-airport-names-reviewed --country/);
  }
});

test("核对表不合格：整张不用，列出问题，数据库不变", async () => {
  const before = await names();
  const bad = join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ airports: [{ code: "HND", country: "JP", names: { zh: "東京國際機場" }, sources: { zh: "x" } }] }));
  const { code, output } = await run(["--country", "JP", "--file", bad]);
  assert.equal(code, 1);
  assert.match(output, /核对表有 1 处不合格，整张表没有用，数据库没有任何变化/);
  assert.match(output, /第 1 条 HND：中文名「東京國際機場」里有繁体/);
  assert.deepEqual(await names(), before);
});

test("试运行：显示将要填的名称和来源，数据库不变", async () => {
  const before = await names();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP,KR", "--file", table, "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /试运行：下面是将要做的改动，数据库没有任何变化/);
  assert.match(output, /将给 3 个机场填名称（日文 1 个、中文 3 个）/);
  assert.match(output, /HND：日文「東京国際空港」（测试：维基数据）；中文「东京国际机场」（测试：繁体转简体）/);
  assert.match(output, /KIX 中文：库里是「关西机场（平台）」，核对表是「关西国际机场」/);
  assert.match(output, /库里还没有的 1 个/);
  assert.deepEqual(await names(), before);
  assert.equal(await auditCount(), audits);
});

test("写入：只填空着的语言、记来源和审计、不动搜索别名；只写所选国家；再运行一次什么都不做", async () => {
  const before = await names();
  const audits = await auditCount();
  const jp = await run(["--country", "JP", "--file", table]);
  assert.equal(jp.code, 0, jp.output);
  assert.match(jp.output, /写入完成。/);
  assert.match(jp.output, /给 2 个机场填了名称（日文 1 个、中文 2 个）/);
  const after = await names();
  assert.equal(after["HND"]?.name["zh"], "东京国际机场");
  assert.equal(after["HND"]?.name["ja"], "東京国際空港");
  assert.equal(after["HND"]?.name["en"], before["HND"]?.name["en"]);
  assert.equal(after["HND"]?.version, (before["HND"]?.version ?? 0) + 1);
  assert.deepEqual(after["HND"]?.nameSources["zh"], { source: "nozomi-reviewed", ref: "测试：繁体转简体", text: "东京国际机场" });
  assert.equal(after["NGS"]?.name["zh"], "长崎机场");
  assert.equal(after["KIX"]?.name["zh"], "关西机场（平台）", "已有的不改");
  assert.equal(after["ICN"]?.name["zh"], undefined, "没选的国家不碰");
  for (const code of ["HND", "NGS", "KIX", "ICN"]) assert.deepEqual(after[code]?.searchNames, before[code]?.searchNames, `${code} 的搜索别名不动`);
  assert.equal(await auditCount(), audits + 2);
  const log = await api.db.owner.query("select after from audit_logs where resource = 'place' and action = 'update' order by occurred_at desc, id desc limit 2");
  assert.ok(log.rows.every((row) => row.after.name_source.source === "nozomi-reviewed"));

  const again = await run(["--country", "JP", "--file", table]);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /给 0 个机场填了名称/);
  assert.deepEqual(await names(), after);
  assert.equal(await auditCount(), audits + 2);
});

test("平台删掉核对表填的名称后，再运行不补回去", async () => {
  await api.db.owner.query("update places set name = name - 'zh' where code = 'NGS'");
  const { code, output } = await run(["--country", "JP", "--file", table]);
  assert.equal(code, 0, output);
  assert.match(output, /以前导入过、平台后来删掉了，没有再填 1 处：NGS 中文/);
  assert.equal((await names())["NGS"]?.name["zh"], undefined);
});

test("仓库里的核对表能直接用（不带 --file）：试运行成功", async () => {
  const { code, output } = await run(["--country", "JP,KR", "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /核对表里 JP、KR 的机场 \d+ 个/);
});
