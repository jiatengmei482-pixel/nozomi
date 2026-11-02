/**
 * `pnpm price-sheet:import`（ADR 0062）的参数和离线计划：不连数据库也能出计划、偏差清单和异常清单；输出不能进仓库；终端不打印价格。
 * 连库的 dry-run、写入、撤回在 price-import.itest.ts。表格、地名、价格全是虚构的。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICE_SHEET_COUNTRIES, PRICE_SHEET_MILEAGE, PRICE_SHEET_NOTES, PRICE_SHEET_VEHICLES } from "@nozomi/domain";
import { type XlsxWriteCell, type XlsxWriteSheet, writeXlsx } from "../integrations/xlsx.ts";
import { PRICE_IMPORT_TARGET_SQL } from "../repos/price-import.ts";
import { readImportCommand } from "./price-sheet-import.ts";

const CLI = fileURLToPath(new URL("./price-sheet-import.ts", import.meta.url));
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const work = mkdtempSync(join(realpathSync(tmpdir()), "price-import-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

const num = (value: number): XlsxWriteCell => ({ number: String(value) });
const SECRET_PRICE = 73_517;

function book(): Buffer {
  const japan: XlsxWriteCell[][] = [
    ["甲城机场", "甲城市区", num(SECRET_PRICE), num(12_000)],
    ["甲城市区", "甲城机场", num(SECRET_PRICE), num(13_000)],
    ["甲城机场", "乙地区", num(9_950), null],
    ["甲城机场", "某某滑雪场", num(20_000), num(21_000)],
    ["甲城市区", "乙地区", num(5_000), num(6_000)],
  ];
  const sheets: XlsxWriteSheet[] = [
    { name: PRICE_SHEET_NOTES, rows: [["• 若未单独列出反向线路，反向同价。"], ...PRICE_SHEET_COUNTRIES.map((country): XlsxWriteCell[] => [`  ${country.sheet}：${country.sheet === "日本" ? japan.length : 0} 条`])] },
    { name: PRICE_SHEET_VEHICLES, rows: [["国家/地区", "车型", "代表车型（或同级）", "最多乘客", "最多行李"], ["日本", "Economy 5 Seater", "虚构车", num(4), num(2)], ["日本", "Economy 7 Seater", "虚构车", num(6), num(4)]] },
    ...PRICE_SHEET_COUNTRIES.map((country): XlsxWriteSheet => ({ name: country.sheet, rows: [["出发地", "目的地", "Economy 5 Seater", "Economy 7 Seater"], [null, null, "最多4人/2件", "最多6人/4件"], ...(country.sheet === "日本" ? japan : [])] })),
    { name: PRICE_SHEET_MILEAGE, rows: [["国家/地区", "车型", "价格包", "起步价（日元）", "最低消费（日元）", "超出后每公里（日元）", "来源"]] },
  ];
  return writeXlsx(sheets);
}

const bytes = book();
const sha = createHash("sha256").update(bytes).digest("hex");
const file = join(work, "虚构价格表.xlsx");
writeFileSync(file, bytes);
const mappingFile = join(work, "mapping.json");
writeFileSync(mappingFile, JSON.stringify({ airports: { 甲城机场: "AAA" }, regions: { 甲城市区: { lat: 35.1, lng: 139.1, radius_m: 10_000 }, 乙地区: { lat: 35.2, lng: 139.2, radius_m: 5_000 } }, vehicles: {} }));

let counter = 0;
const freshOut = (): string => join(work, `out${(counter += 1)}`);

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: REPO, env: { PATH: process.env.PATH ?? "" }, timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const base = (out: string): string[] => ["--file", file, "--expect-sha256", sha, "--mapping", mappingFile, "--batch", "TEST-1", "--out", out];

test("参数：批次号、数据来源三选一、--apply 只能连库用、撤回不带价格表", () => {
  assert.deepEqual(readImportCommand(["--print-target-sql"]), { kind: "print-sql" });
  assert.deepEqual(readImportCommand(["--revert", "--tenant", "00000000-0000-4000-8000-00000000000A", "--batch", "JP-1"]), { kind: "revert", tenantId: "00000000-0000-4000-8000-00000000000a", batch: "JP-1", apply: false });
  const plan = readImportCommand([...base("/x"), "--tenant", "00000000-0000-4000-8000-000000000001", "--channel", "00000000-0000-4000-8000-000000000002", "--apply"]);
  assert.equal(plan.kind === "plan" && plan.source.kind === "database" && plan.source.apply, true);
  const reject = (args: string[], pattern: RegExp): void => assert.throws(() => readImportCommand(args), pattern);
  reject(["--file", file], /--batch/);
  reject([...base("/x").slice(0, 6), "--batch", "有中文", "--out", "/x", "--target", "t.json"], /批次号/);
  reject([...base("/x"), "--target", "t.json", "--assume-pricing", "1000,1000,0,1"], /必须给且只能给一种/);
  reject([...base("/x"), "--assume-pricing", "1000,1000,0,1", "--apply"], /--apply/);
  reject([...base("/x"), "--tenant", "00000000-0000-4000-8000-000000000001"], /同时给/);
  reject([...base("/x"), "--assume-pricing", "10%,1000,0,1"], /四个整数/);
  reject(["--revert", "--tenant", "00000000-0000-4000-8000-000000000001", "--batch", "JP-1", "--file", file], /撤回不用/);
  reject(["--print-target-sql", "--batch", "JP-1"], /不和别的参数/);
  reject(["--revert", "--tenant", "not-a-uuid", "--batch", "JP-1"], /UUID/);
});

test("离线估算：写出计划、异常清单、重叠比价清单和 JSON，权限只给自己；终端只打印数字，不打印价格", () => {
  const out = freshOut();
  const result = runCli([...base(out), "--assume-pricing", "1000,1000,0,100"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["anomalies.md", "overlap.md", "plan.json", "plan.md"]);
  for (const name of readdirSync(out)) assert.equal(statSync(join(out, name)).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(String(SECRET_PRICE)) && !result.stdout.includes("73,517"), "终端不打印价格");
  assert.match(result.stdout, /机场↔地区 4 行，导入 3 行、4 格；不导入 1 项/);
  assert.match(result.stdout, /完全一致 2，有偏差 2（最大 50 日元）/);
  assert.match(result.stdout, /重叠：地区对 \d+，会被报低 \d+ 处，跳过 \d+ 格/);
  assert.match(readFileSync(join(out, "overlap.md"), "utf8"), /# 重叠比价跳过清单/);
  const plan = readFileSync(join(out, "plan.md"), "utf8");
  // 9,950 在取整到 100 日元时对不上：列在偏差清单里，显示 9,900、差 −50、高一档 10,000
  assert.match(plan, /\| 甲城机场 \| 乙地区 \| Economy 5 Seater \| 接送通用 \| 9,950 \| 9,000 \| 9,900 \| -50 \| 10,000 \|/);
  assert.match(plan, /某某滑雪场 \| 6 \| 整行 \| 滑雪场，暂不导/);
  const anomalies = readFileSync(join(out, "anomalies.md"), "utf8");
  assert.match(anomalies, /两个方向都列、价格不同 \| 1 格/);
  const json = JSON.parse(readFileSync(join(out, "plan.json"), "utf8"));
  assert.equal(json.mode, "offline_assumed");
  assert.equal(json.priced.length, 4);
});

test("离线计划（按目标环境的导出）：主数据里缺车型组、机场没指定城市，列为拦住写入的原因", () => {
  const target = join(work, "target.json");
  writeFileSync(
    target,
    JSON.stringify({
      tenant: { id: "00000000-0000-4000-8000-000000000001", name: "虚构车队", status: "active" },
      channel: { id: "00000000-0000-4000-8000-000000000002", name: "虚构官网", settle_currency: "JPY", default_markup_bp: 1_000, markup_floor_bp: 1_000, min_margin_minor: 0, sell_rounding: {} },
      markup_rules: [],
      cities: [],
      places: [{ id: "00000000-0000-4000-8000-000000000005", code: "AAA", type: "airport", status: "disabled", city_id: null, name: { zh: "甲城机场" } }],
      vehicle_groups: [{ id: "00000000-0000-4000-8000-000000000006", code: "VG-ECO-5", status: "active", combos: [{ passengers: 4, luggage: 2 }] }],
    }),
  );
  const out = freshOut();
  const result = runCli([...base(out), "--target", target]);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(readFileSync(join(out, "plan.json"), "utf8"));
  assert.deepEqual(json.issues.map((issue: { code: string }) => issue.code).sort(), ["AIRPORT_NOT_READY", "VEHICLE_GROUP_MISSING"]);
  assert.match(readFileSync(join(out, "plan.md"), "utf8"), /机场还没有指定所属城市/);
});

test("输出不能放进仓库；sha256 不符、映射写错都什么也不写", () => {
  const inside = runCli([...base(join(REPO, "tmp-price-import-out")), "--assume-pricing", "1000,1000,0,1"]);
  assert.equal(inside.status, 1);
  assert.match(inside.stderr, /git 仓库/);
  assert.throws(() => statSync(join(REPO, "tmp-price-import-out")));

  const out = freshOut();
  const wrongSha = runCli(["--file", file, "--expect-sha256", "0".repeat(64), "--mapping", mappingFile, "--batch", "TEST-1", "--out", out, "--assume-pricing", "1000,1000,0,1"]);
  assert.equal(wrongSha.status, 1);
  assert.match(wrongSha.stderr, /sha256 不符/);
  const badMapping = join(work, "bad-mapping.json");
  writeFileSync(badMapping, JSON.stringify({ airports: { 甲城机场: "aaa" }, regions: {}, vehicles: {} }));
  const wrongMapping = runCli(["--file", file, "--expect-sha256", sha, "--mapping", badMapping, "--batch", "TEST-1", "--out", out, "--assume-pricing", "1000,1000,0,1"]);
  assert.equal(wrongMapping.status, 1);
  assert.match(wrongMapping.stderr, /BAD_MAPPING/);
  assert.throws(() => statSync(out), "没有创建输出目录");
});

test("--print-target-sql 打印只读导出的 SQL：只有 select，没有写", () => {
  const result = runCli(["--print-target-sql"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), PRICE_IMPORT_TARGET_SQL.trim());
  assert.doesNotMatch(PRICE_IMPORT_TARGET_SQL, /\b(insert|update|delete|alter|drop|create|grant|truncate)\b/i);
});
