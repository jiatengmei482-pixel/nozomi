/**
 * M12-06：按航站楼核对表给机场填地址、集合地点，新建航站楼，给已有的航站楼填空着的项。
 * 真的启动 `pnpm masterdata:import-airport-terminals-reviewed` 背后的入口文件，读测试里现场写的小核对表（不用仓库里的真表），再从数据库核对结果。
 * 机场经平台接口建好（羽田启用、有两个航站楼；神户单航站楼；福冈停用），另有一个平台已经录了地址的成田和一个平台手工建的航站楼。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./masterdata-import-airport-terminals-reviewed.ts", import.meta.url));

const TERMINAL = (suffix: string, lat: number, lng: number, extra: Record<string, unknown> = {}) => ({
  suffix,
  names: { ja: `第${suffix.slice(1)}ターミナル`, zh: `第${suffix.slice(1)}航站楼`, en: `Terminal ${suffix.slice(1)}` },
  lat,
  lng,
  coordSource: `测试：${suffix} 坐标来源`,
  flightScope: "domestic",
  meetingPoint: { zh: `${suffix} 到达大厅`, ja: `${suffix} 到着ロビー` },
  sources: [`测试：${suffix} 机场官网`],
  ...extra,
});

const TABLE = {
  description: "测试用",
  airports: [
    {
      code: "HND",
      country: "JP",
      address: { text: "〒144-0041 東京都大田区羽田空港3-3-2", source: "测试：羽田官网" },
      terminals: [
        TERMINAL("T1", 35.548, 139.7845),
        TERMINAL("T3", 35.5437, 139.7686, { flightScope: "international", address: { text: "〒144-0041 東京都大田区羽田空港2-6-5", source: "测试：T3 官网" } }),
        TERMINAL("T9", 35.7, 139.78),
      ],
    },
    { code: "UKB", country: "JP", address: { text: "〒650-0048 兵庫県神戸市中央区神戸空港1", source: "测试：神户官网" }, meetingPoint: { zh: "1 楼到达口", source: "测试：神户官网" } },
    { code: "FUK", country: "JP", address: { text: "〒812-0003 福岡県福岡市博多区下臼井778-1", source: "测试：福冈官网" }, terminals: [TERMINAL("T1", 33.5859, 130.4507)] },
    { code: "NRT", country: "JP", address: { text: "〒282-0004 千葉県成田市古込1-1", source: "测试：成田官网" }, meetingPoint: { zh: "到达大厅", source: "测试：成田官网" } },
    { code: "KIX", country: "JP", address: { text: "〒549-0001 大阪府泉佐野市泉州空港北1", source: "测试" }, meetingPoint: { zh: "到达大厅", source: "测试" } },
    { code: "ICN", country: "KR", address: { text: "272 Gonghang-ro, Incheon", source: "测试" }, meetingPoint: { zh: "1 楼到达大厅", source: "测试" } },
  ],
};

let api: TestApi;
let root: string;
let dir: string;
let table: string;
const ids: Record<string, string> = {};

async function createPlace(body: Record<string, unknown>, enable = true): Promise<string> {
  const res = await api.call("POST", "/platform/v1/master/places", { token: root, body });
  assert.equal(res.status, 201, res.text);
  if (!enable) {
    const disabled = await api.call("POST", `/platform/v1/master/places/${res.body.id}/disable`, { token: root });
    assert.equal(disabled.status, 200, disabled.text);
  }
  return res.body.id as string;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-reviewed-terminals-"));
  table = join(dir, "table.json");
  await writeFile(table, JSON.stringify(TABLE));
  const city = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code: "CTY-JP-TRM", country_code: "JP", name: { zh: "测试城市" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } },
  });
  assert.equal(city.status, 201, city.text);
  const cityId = city.body.id as string;
  const airport = (code: string, lat: number, lng: number) => ({ type: "airport", code, city_id: cityId, name: { en: `Test ${code}` }, location: { lat, lng } });
  ids["HND"] = await createPlace(airport("HND", 35.553333, 139.781111));
  ids["UKB"] = await createPlace(airport("UKB", 34.6328, 135.2239));
  ids["FUK"] = await createPlace(airport("FUK", 33.5859, 130.4507), false);
  ids["NRT"] = await createPlace({ ...airport("NRT", 35.764722, 140.386389), address: "平台录的成田地址" });
  // 平台手工建的 T1：只有中文名、平台写的集合地点
  ids["HND-T1"] = await createPlace({ type: "terminal", code: "HND-T1", parent_id: ids["HND"], name: { zh: "一号航站楼（平台）" }, location: { lat: 35.549, lng: 139.785 }, meeting_point: { zh: "平台写的集合地点" } });
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

interface Row {
  code: string;
  type: string;
  status: string;
  parent_id: string | null;
  city_id: string | null;
  name: Record<string, string>;
  address: string | null;
  meeting_point: Record<string, string> | null;
  lat: string;
  lng: string;
  flight_scope: string | null;
  version: number;
  name_sources: Record<string, { source: string; ref: string; text: string }>;
  content_sources: Record<string, { source: string; ref: string; value: unknown }>;
}

async function places(): Promise<Record<string, Row>> {
  const rows = await api.db.owner.query<Row>(
    "select code, type, status, parent_id, city_id, name, address, meeting_point, lat, lng, flight_scope, version, name_sources, content_sources from places where type in ('airport', 'terminal') order by code",
  );
  return Object.fromEntries(rows.rows.map((row) => [row.code, row]));
}

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'place' and actor_type = 'system'")).rows[0].n;
}

test("参数：必须给 --country；不认识的参数、空的 --file 报用法", async () => {
  for (const args of [["--dry-run"], ["--country", "JP", "--names-file", table], ["--country", "JP", "--file", ""]]) {
    const { code, output } = await run(args);
    assert.equal(code, 1, args.join(" "));
    assert.match(output, /用法：pnpm masterdata:import-airport-terminals-reviewed --country/);
  }
});

test("核对表不合格：整张不用，列出问题，数据库不变", async () => {
  const before = await places();
  const bad = join(dir, "bad.json");
  await writeFile(bad, JSON.stringify({ airports: [{ ...TABLE.airports[0], address: { text: "東京都大田区羽田空港", source: "x" } }, { ...TABLE.airports[1], meetingPoint: { ja: "到着口", source: "x" } }] }));
  const { code, output } = await run(["--country", "JP", "--file", bad]);
  assert.equal(code, 1);
  assert.match(output, /核对表有 2 处不合格，整张表没有用，数据库没有任何变化/);
  assert.match(output, /第 1 条 HND：日本的地址要带邮编/);
  assert.match(output, /第 2 条 UKB：集合地点的 zh 不合格/);
  assert.deepEqual(await places(), before);
  const notJson = join(dir, "not.json");
  await writeFile(notJson, "{");
  const broken = await run(["--country", "JP", "--file", notJson]);
  assert.equal(broken.code, 1);
  assert.match(broken.output, /读不出核对表/);
});

test("试运行：显示将要新建、填写和交给人看的，数据库不变", async () => {
  const before = await places();
  const audits = await auditCount();
  const { code, output } = await run(["--country", "JP", "--file", table, "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /试运行：下面是将要做的改动，数据库没有任何变化/);
  assert.match(output, /将新建航站楼 2 个（其中 1 个所属机场还没启用，建成停用的）/);
  assert.match(output, /HND-T3「第3航站楼」，距机场 1\.\d 公里，坐标：测试：T3 坐标来源/);
  assert.match(output, /FUK-T1「第1航站楼」（停用）/);
  assert.match(output, /将给 5 个机场 \/ 航站楼填了空着的项/);
  assert.match(output, /HND-T1：日文名、英文名/);
  assert.match(output, /NRT 地址：库里是「平台录的成田地址」/);
  assert.match(output, /HND-T1 集合地点：库里是「zh: 平台写的集合地点」/);
  assert.match(output, /HND-T9：坐标离机场 16\.\d 公里，超过 5 公里，没有用/);
  assert.match(output, /库里还没有的机场 1 个/);
  assert.deepEqual(await places(), before);
  assert.equal(await auditCount(), audits);
});

test("写入：新建航站楼、只填空着的项、记来源和审计；只写所选国家；再运行一次什么都不做", async () => {
  const before = await places();
  const audits = await auditCount();
  const first = await run(["--country", "JP", "--file", table]);
  assert.equal(first.code, 0, first.output);
  assert.match(first.output, /写入完成。/);
  const after = await places();

  // 机场：地址填上，来源记下；版本加一
  assert.equal(after["HND"]?.address, "〒144-0041 東京都大田区羽田空港3-3-2");
  assert.deepEqual(after["HND"]?.content_sources["address"], { source: "nozomi-reviewed", ref: "测试：羽田官网", value: "〒144-0041 東京都大田区羽田空港3-3-2" });
  assert.equal(after["HND"]?.meeting_point, null, "多航站楼的机场不在机场上写集合地点");
  assert.equal(after["HND"]?.version, (before["HND"]?.version ?? 0) + 1);
  // 单航站楼：集合地点挂在机场上
  assert.deepEqual(after["UKB"]?.meeting_point, { zh: "1 楼到达口" });
  // 平台录过的不改
  assert.equal(after["NRT"]?.address, "平台录的成田地址");
  assert.deepEqual(after["NRT"]?.meeting_point, { zh: "到达大厅" }, "空着的集合地点照样填");

  // 新建的 T3：启用、挂在羽田下、城市跟羽田、三种名称、坐标、国际属性、地址、集合地点
  const t3 = after["HND-T3"];
  assert.ok(t3);
  assert.deepEqual([t3.type, t3.status, t3.parent_id, t3.city_id, t3.flight_scope], ["terminal", "active", ids["HND"], after["HND"]?.city_id, "international"]);
  assert.deepEqual(t3.name, { ja: "第3ターミナル", zh: "第3航站楼", en: "Terminal 3" });
  assert.deepEqual([Number(t3.lat), Number(t3.lng)], [35.5437, 139.7686]);
  assert.equal(t3.address, "〒144-0041 東京都大田区羽田空港2-6-5");
  assert.deepEqual(t3.meeting_point, { zh: "T3 到达大厅", ja: "T3 到着ロビー" });
  assert.deepEqual(t3.name_sources["en"], { source: "nozomi-reviewed", ref: "测试：T3 机场官网", text: "Terminal 3" });
  // 机场停用：航站楼建成停用的
  assert.deepEqual([after["FUK-T1"]?.status, after["FUK-T1"]?.parent_id], ["disabled", ids["FUK"]]);
  // 超过 5 公里的没有建
  assert.equal(after["HND-T9"], undefined);
  // 平台建的 T1：只补空着的日文、英文名，中文名、集合地点、坐标不动
  const t1 = after["HND-T1"];
  assert.deepEqual(t1?.name, { zh: "一号航站楼（平台）", ja: "第1ターミナル", en: "Terminal 1" });
  assert.deepEqual(t1?.meeting_point, { zh: "平台写的集合地点" });
  assert.deepEqual([Number(t1?.lat), Number(t1?.lng)], [35.549, 139.785]);
  // 没选的国家不碰
  assert.equal(after["ICN"], undefined);

  // 审计：2 个新建 + 5 个填写（HND、UKB、FUK、NRT、HND-T1），来源都记下
  assert.equal(await auditCount(), audits + 7);
  const logs = await api.db.owner.query("select action, after from audit_logs where resource = 'place' and actor_type = 'system' order by occurred_at, id");
  const created = logs.rows.filter((row) => row.action === "create");
  assert.equal(created.length, 2);
  assert.ok(created.every((row) => row.after.fill_source.source === "nozomi-reviewed" && typeof row.after.fill_source.refs.coordinates === "string"));
  const hndLog = logs.rows.find((row) => row.action === "update" && row.after.address === "〒144-0041 東京都大田区羽田空港3-3-2");
  assert.deepEqual(hndLog?.after.fill_source, { source: "nozomi-reviewed", refs: { address: "测试：羽田官网" }, fields: ["address"] });

  // 平台接口读得到
  const t3Api = await api.call("GET", `/platform/v1/master/places?code=HND-T3`, { token: root });
  assert.deepEqual(t3Api.body.items[0].meeting_point, { zh: "T3 到达大厅", ja: "T3 到着ロビー" });

  const again = await run(["--country", "JP", "--file", table]);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /新建航站楼 0 个/);
  assert.match(again.output, /给 0 个机场 \/ 航站楼填了空着的项/);
  assert.deepEqual(await places(), after);
  assert.equal(await auditCount(), audits + 7);
});

test("平台删掉导入填的地址、集合地点、名称后，再运行不补回去", async () => {
  await api.db.owner.query("update places set address = null, meeting_point = null where code = 'UKB'");
  await api.db.owner.query("update places set name = name - 'en' where code = 'HND-T3'");
  const { code, output } = await run(["--country", "JP", "--file", table]);
  assert.equal(code, 0, output);
  assert.match(output, /以前导入过、平台后来删掉了，没有再填 3 处：/);
  const now = await places();
  assert.deepEqual([now["UKB"]?.address, now["UKB"]?.meeting_point, now["HND-T3"]?.name["en"]], [null, null, undefined]);
});

test("仓库里的核对表能直接用（不带 --file）：试运行成功", async () => {
  const { code, output } = await run(["--country", "JP,KR", "--dry-run"]);
  assert.equal(code, 0, output);
  assert.match(output, /核对表里 JP、KR 的机场 \d+ 个、航站楼 \d+ 个/);
});
