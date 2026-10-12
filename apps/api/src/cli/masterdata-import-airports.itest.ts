/**
 * M1-01 验收标准 1：机场坐标从公开数据源导入并注明来源。
 * 真的启动 `pnpm masterdata:import-airports` 背后的入口文件，读测试里现场构造的小样本文件（不联网、不用真实数据文件），
 * 再从接口和数据库核对结果。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-airports.ts", import.meta.url));
/** 和 OurAirports 的 airports.csv 一样的表头。下面的记录是为测试编的，编号用 9 开头的大数，和真实数据无关。 */
const HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';

interface Row {
  id: number;
  iata: string;
  name: string;
  lat: number;
  lng: number;
  country?: string;
  type?: string;
  scheduled?: string;
}

const SAMPLE: Row[] = [
  { id: 900001, iata: "TAA", name: "Test Alpha International Airport", lat: 35.5496781, lng: 139.7869584 },
  { id: 900002, iata: "TBB", name: 'Test "Bravo" Airport, North', lat: 34.427299, lng: 135.244003, type: "medium_airport" },
  { id: 900003, iata: "TCC", name: "Test Charlie Airport", lat: 37.469101, lng: 126.450996, country: "KR" },
  { id: 900004, iata: "TDD", name: "Test Delta Airfield", lat: 35.1, lng: 139.1, type: "small_airport" },
  { id: 900005, iata: "TEE", name: "Test Echo Heliport", lat: 35.2, lng: 139.2, type: "heliport" },
  { id: 900006, iata: "TFF", name: "Test Foxtrot Airport", lat: 35.3, lng: 139.3, scheduled: "no" },
  { id: 900007, iata: "", name: "Test Golf Airport", lat: 35.4, lng: 139.4 },
  { id: 900008, iata: "THH", name: "Test Hotel Airport", lat: 40.6, lng: -73.7, country: "US" },
];

function csv(rows: Row[]): string {
  const quote = (text: string): string => `"${text.replaceAll('"', '""')}"`;
  const lines = rows.map((row) =>
    [
      row.id, quote(`T${row.id}`), quote(row.type ?? "large_airport"), quote(row.name), row.lat, row.lng, 10, '"AS"', quote(row.country ?? "JP"),
      '"JP-13"', '"Testville"', quote(row.scheduled ?? "yes"), "", quote(row.iata), "", "", "", "", '"k1, k2"',
    ].join(","),
  );
  return `${[HEADER, ...lines].join("\n")}\n`;
}

let api: TestApi;
let root: string;
let dir: string;

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-airports-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

async function sampleFile(name: string, rows: Row[]): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, csv(rows), "utf8");
  return path;
}

async function sampleBytes(name: string, content: Buffer): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

async function run(args: string[]): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(api.db.url), args);
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  return { code, output: running.output() };
}

async function airports(): Promise<any[]> {
  const res = await api.call("GET", "/platform/v1/master/places?type=airport&limit=200", { token: root });
  assert.equal(res.status, 200, res.text);
  return (res.body.items as any[]).sort((x, y) => x.code.localeCompare(y.code));
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'place'")).rows[0].n;
}

test("迁移之后、导入之前：库里没有任何机场（没有预置数据）", async () => {
  assert.deepEqual(await airports(), []);
});

test("试运行：只显示将要做什么，数据库没有任何变化", async () => {
  const file = await sampleFile("airports.csv", SAMPLE);
  const { code, output } = await run(["--country", "JP", "--file", file, "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /试运行：下面是将要做的改动，数据库没有任何变化/);
  assert.match(output, /新增 2 个/);
  assert.deepEqual(await airports(), []);
  assert.equal(await auditCount(), 0);
});

test("按国家导入：只导入所选国家里有定期航班的大中型机场；注明来源和许可；新机场是停用的、没有城市；每个都有审计日志", async () => {
  const file = await sampleFile("airports.csv", SAMPLE);
  const { code, output } = await run(["--country", "jp", "--file", file]);
  assert.equal(code, 0, output);
  assert.match(output, /数据来源：OurAirports（https:\/\/ourairports\.com\/data\/），许可：公有领域（Public Domain）/);
  assert.match(output, /共 8 条记录/);
  assert.match(output, /范围：JP 有定期航班的大型、中型机场，共 2 个/);
  assert.match(output, /新增 2 个/);
  assert.match(output, /更新 0 个；没有变化 0 个/);
  assert.match(output, /跳过 1 条不合格的记录：\n {2}- 第 8 条 Test Golf Airport：没有 IATA 三字码/);
  assert.deepEqual(leakedSecrets(output), []);

  const imported = await airports();
  assert.deepEqual(
    imported.map((place) => ({ code: place.code, type: place.type, country: place.country_code, name: place.name, location: place.location, city: place.city_id, status: place.status, version: place.version, source: place.source.name, ref: place.source.ref, overridden: place.source.overridden })),
    [
      { code: "TAA", type: "airport", country: "JP", name: { en: "Test Alpha International Airport" }, location: { lng: 139.786958, lat: 35.549678 }, city: null, status: "disabled", version: 1, source: "ourairports", ref: "900001", overridden: false },
      { code: "TBB", type: "airport", country: "JP", name: { en: 'Test "Bravo" Airport, North' }, location: { lng: 135.244003, lat: 34.427299 }, city: null, status: "disabled", version: 1, source: "ourairports", ref: "900002", overridden: false },
    ],
  );
  const logs = await api.db.owner.query("select actor_type, actor_id, source, action, tenant_id, resource_id, after from audit_logs where resource = 'place' order by id");
  assert.equal(logs.rows.length, 2);
  assert.deepEqual(
    logs.rows.map((row) => [row.actor_type, row.actor_id, row.source, row.action, row.tenant_id, row.after.code, row.after.source, row.after.status]),
    [["system", null, "cli", "create", null, "TAA", "ourairports", "disabled"], ["system", null, "cli", "create", null, "TBB", "ourairports", "disabled"]],
  );
  assert.deepEqual(logs.rows.map((row) => row.resource_id), imported.map((place) => place.id));
  // 租户默认看不到还没复核的机场
  const tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
  assert.deepEqual((await api.call("GET", "/tenant/v1/master/places", { token: tenant.adminToken })).body.items, []);
});

test("同一份文件再导入一次：什么都不变，不重复、不加版本、不写日志", async () => {
  const before = await airports();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP", "--file", join(dir, "airports.csv")]);
  assert.equal(code, 0, output);
  assert.match(output, /新增 0 个/);
  assert.match(output, /更新 0 个；没有变化 2 个/);
  const afterRun = await airports();
  assert.deepEqual(afterRun.map(({ source, ...rest }) => rest), before.map(({ source, ...rest }) => rest));
  assert.equal(await auditCount(), audits);
});

test("扩大国家范围再导入：只新增新国家的机场", async () => {
  const { code, output } = await run(["--country", "JP,KR", "--file", join(dir, "airports.csv")]);
  assert.equal(code, 0, output);
  assert.match(output, /范围：JP、KR/);
  assert.match(output, /新增 1 个/);
  assert.deepEqual((await airports()).map((place) => place.code), ["TAA", "TBB", "TCC"]);
});

test("数据源更新后再导入：名称和坐标变了的更新并写审计；平台改过的、手工录入的不覆盖；三字码变了的和已关闭的只提示", async () => {
  const [alpha, bravo, charlie] = await airports();
  const patch = (id: string, version: number, body: unknown) =>
    api.call("PATCH", `/platform/v1/master/places/${id}`, { token: root, body, headers: { "if-match": `"${version}"` } });
  // 平台给 TAA 补了中文名（不算改数据源的内容），纠正了 TBB 的坐标（算）
  assert.equal((await patch(alpha.id, 1, { name: { en: alpha.name.en, zh: "测试甲机场" } })).status, 200);
  const corrected = await patch(bravo.id, 1, { location: { lng: 135.25, lat: 34.43 } });
  assert.equal(corrected.body.source.overridden, true);
  // 平台手工录入了一个机场，数据源里后来也有了同一个三字码
  const city = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code: "CTY-JP-TST", country_code: "JP", name: { zh: "测试市" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.6 } },
  });
  assert.equal(city.status, 201, city.text);
  const manual = await api.call("POST", "/platform/v1/master/places", {
    token: root,
    body: { type: "airport", code: "TMM", city_id: city.body.id, name: { zh: "手工录入的机场" }, location: { lng: 139.9, lat: 35.9 } },
  });
  assert.equal(manual.status, 201, manual.text);

  const audits = await auditCount();
  const file = await sampleFile("airports-v2.csv", [
    { id: 900001, iata: "TAA", name: "Test Alpha Renamed Airport", lat: 35.55, lng: 139.79 },
    { id: 900002, iata: "TBB", name: 'Test "Bravo" Airport, North', lat: 34.427299, lng: 135.244003, type: "medium_airport" },
    { id: 900003, iata: "TCX", name: "Test Charlie Airport", lat: 37.469101, lng: 126.450996, country: "KR" },
    { id: 900009, iata: "TMM", name: "Test Mike Airport", lat: 36, lng: 140 },
    { id: 900010, iata: "TNN", name: "Test November Airport", lat: 36.5, lng: 140.5 },
  ]);
  const first = await run(["--country", "JP,KR", "--file", file]);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /新增 1 个/);
  assert.match(first.output, /更新 1 个；没有变化 0 个；平台改过、没有覆盖 1 个/);
  assert.match(first.output, /平台改过的：TBB/);
  assert.match(first.output, /需要人工处理 2 个/);
  assert.match(first.output, /- TCX：数据源里这个机场的三字码由 TCC 变成了 TCX/);
  assert.match(first.output, /- TMM：后台已经手工录入了这个三字码的机场，没有覆盖/);

  const byCode = Object.fromEntries((await airports()).map((place) => [place.code, place]));
  assert.deepEqual(Object.keys(byCode), ["TAA", "TBB", "TCC", "TMM", "TNN"]);
  assert.deepEqual([byCode["TAA"].name, byCode["TAA"].location, byCode["TAA"].version], [{ en: "Test Alpha Renamed Airport", zh: "测试甲机场" }, { lng: 139.79, lat: 35.55 }, 3]);
  assert.deepEqual([byCode["TBB"].location, byCode["TBB"].version], [{ lng: 135.25, lat: 34.43 }, 2], "平台纠正过的坐标没有被覆盖");
  assert.deepEqual([byCode["TCC"].version, byCode["TCC"].name], [1, charlie.name]);
  assert.deepEqual([byCode["TMM"].name, byCode["TMM"].source, byCode["TMM"].status], [{ zh: "手工录入的机场" }, null, "active"]);
  assert.equal(byCode["TNN"].status, "disabled");
  assert.equal(await auditCount(), audits + 2, "一条更新、一条新增");
  const update = await api.db.owner.query("select before, after, actor_type, source from audit_logs where resource = 'place' and action = 'update' and resource_id = $1 order by id desc limit 1", [alpha.id]);
  assert.deepEqual(update.rows[0], {
    before: { name: { en: "Test Alpha International Airport", zh: "测试甲机场" }, lng: 139.786958, lat: 35.549678 },
    after: { name: { en: "Test Alpha Renamed Airport", zh: "测试甲机场" }, lng: 139.79, lat: 35.55, source: "ourairports" },
    actor_type: "system",
    source: "cli",
  });

  // 再来一次：结果稳定
  const second = await run(["--country", "JP,KR", "--file", file]);
  assert.match(second.output, /新增 0 个/);
  assert.match(second.output, /更新 0 个；没有变化 2 个；平台改过、没有覆盖 1 个/);
  assert.equal(await auditCount(), audits + 2);

  // 数据源里 TNN 关闭了：只提示，不自动停用、不删除
  const closed = await sampleFile("airports-v3.csv", [{ id: 900010, iata: "TNN", name: "Test November Airport", lat: 36.5, lng: 140.5, type: "closed" }]);
  const third = await run(["--country", "JP", "--file", closed]);
  assert.equal(third.code, 0, third.output);
  assert.match(third.output, /已关闭或不再有定期航班的 1 个（没有自动停用，请人工确认）：TNN/);
  assert.equal((await airports()).length, 5);
});

test("全部国家：--all-countries", async () => {
  const { code, output } = await run(["--all-countries", "--file", join(dir, "airports.csv"), "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /范围：全部国家/);
  assert.match(output, /新增 1 个/, "只剩美国那一个还没导入");
});

test("参数不对、文件不对：退出码 1，说明原因，数据库不变", async () => {
  const before = await airports();
  const file = join(dir, "airports.csv");
  const cases: [string[], RegExp][] = [
    [["--file", file], /--country 和 --all-countries 必须给且只能给一个/],
    [["--country", "JP", "--all-countries", "--file", file], /必须给且只能给一个/],
    [["--country", "JPN", "--file", file], /不是合法的国家码：JPN/],
    [["--country", "JP,ZZ", "--file", file], /不是合法的国家码：ZZ/],
    [["--country", "JP", "--file", join(dir, "nope.csv")], /读不到文件/],
    [["--country", "JP", "--file", file, "--force"], /参数不正确/],
    [["--country", "JP", "--file", fileURLToPath(import.meta.url)], /缺少列|没有闭合/],
    [["--country", "JP", "--file", await sampleBytes("cr.csv", Buffer.from(csv(SAMPLE).replaceAll("\n", "\r"), "utf8"))], /没有导入：文件用的是只有 CR 的旧式换行/],
    [["--country", "JP", "--file", await sampleBytes("latin1.csv", Buffer.from(csv([{ id: 900020, iata: "TQB", name: "Aéroport de Test", lat: 46, lng: -71 }]), "latin1"))], /没有导入：文件不是 UTF-8 编码/],
    [["--country", "JP", "--file", await sampleBytes("nul.csv", Buffer.from(csv([SAMPLE[0] as Row, { id: 900021, iata: "TNU", name: "Bad\u0000Name", lat: 36, lng: 140 }]), "utf8"))], /没有导入：文件的第 3 条记录（TNU）里有 NUL 字符.*数据库没有任何变化/],
  ];
  for (const [args, expected] of cases) {
    const { code, output } = await run(args);
    assert.equal(code, 1, `${args.join(" ")}\n${output}`);
    assert.match(output, expected);
    assert.doesNotMatch(output, /请确认数据库已启动|23505/, "文件的问题不能说成数据库的问题");
    assert.deepEqual(leakedSecrets(output), []);
  }
  const notCsv = join(dir, "other.csv");
  await writeFile(notCsv, "code,city\nHND,Tokyo\n", "utf8");
  const wrong = await run(["--country", "JP", "--file", notCsv]);
  assert.equal(wrong.code, 1);
  assert.match(wrong.output, /没有导入：文件不是 OurAirports 的 airports\.csv：缺少列/);
  assert.deepEqual(await airports(), before);
});

test("根目录的 package.json 里有这条命令，指向这个入口", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["masterdata:import-airports"], "node --env-file-if-exists=.env apps/api/src/cli/masterdata-import-airports.ts");
});
