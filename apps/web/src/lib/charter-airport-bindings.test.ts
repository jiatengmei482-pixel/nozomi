/** 商品页「机场套餐」绑定（M9P-22，ADR 0098 第三节第 2 小节）的纯逻辑：先查的问题、提交顺序、后端问题对回到行和格、有没有未保存的修改。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CharterAirportBinding } from "../api/charter-airports.ts";
import { type BindingDraft, MAX_AIRPORTS_PER_SCENARIO, bindingDraftsOf, bindingInputs, bindingProblems, bindingsDirty, placeBindingIssues } from "./charter-airport-bindings.ts";

const NRT = "11111111-1111-4111-8111-111111111111";
const HND = "22222222-2222-4222-8222-222222222222";
const NRT_AREA = "33333333-3333-4333-8333-333333333333";
const HND_AREA = "44444444-4444-4444-8444-444444444444";
const draft = (key: string, change: Partial<BindingDraft> = {}): BindingDraft => ({ key, scenario: "airport_start", placeId: NRT, areaId: NRT_AREA, shortName: "", ...change });
const binding = (change: Partial<CharterAirportBinding> = {}): CharterAirportBinding => ({ scenario: "airport_start", place_id: NRT, place_code: "PL-NRT", place_name: { zh: "成田国际机场" }, area_id: NRT_AREA, area_name: { zh: "成田机场" }, short_name_zh: "成田机场", effective: true, ...change });

test("先查的问题：机场、机场区域必选；同一组里机场、机场区域不能重复（两组之间可以）；简称最多 20 字；一组最多 10 个", () => {
  assert.deepEqual(bindingProblems([draft("a")]), []);
  assert.deepEqual(
    bindingProblems([draft("a", { placeId: "", areaId: "" })]).map((problem) => [problem.key, problem.field, problem.text]),
    [
      ["a", "place_id", "请选择机场"],
      ["a", "area_id", "请选择机场区域"],
    ],
  );
  assert.deepEqual(
    bindingProblems([draft("a"), draft("b"), draft("c", { scenario: "airport_end" })]).map((problem) => [problem.key, problem.field]),
    [
      ["b", "place_id"],
      ["b", "area_id"],
    ],
  );
  assert.deepEqual(bindingProblems([draft("a", { shortName: "一二三四五六七八九十一二三四五六七八九十一" })]).map((problem) => problem.field), ["short_name_zh"]);
  const many = Array.from({ length: MAX_AIRPORTS_PER_SCENARIO + 1 }, (_, index) => draft(`k${index}`, { placeId: `p${index}`, areaId: `a${index}` }));
  assert.deepEqual(bindingProblems(many).map((problem) => [problem.key, problem.text]), [[null, "一个场景最多绑 10 个机场"]]);
});

test("提交：机场开始在前、机场结束在后；简称去掉首尾空白，空的提交 null；后端 /bindings/{序号}/{字段} 按同一顺序对回到行", () => {
  const drafts = [draft("end", { scenario: "airport_end", placeId: HND, areaId: HND_AREA, shortName: "  " }), draft("start", { shortName: " 成田机场 " })];
  assert.deepEqual(bindingInputs(drafts), [
    { scenario: "airport_start", place_id: NRT, area_id: NRT_AREA, short_name_zh: "成田机场" },
    { scenario: "airport_end", place_id: HND, area_id: HND_AREA, short_name_zh: null },
  ]);
  const placed = placeBindingIssues(
    [
      { path: "/bindings/1/area_id", reason: "AIRPORT_NOT_IN_AREA", message: "机场或航站楼不在这个机场区域里：羽田机场 第 3 航站楼" },
      { path: "/bindings/0/area_id", reason: "AIRPORT_AREA_NOT_COVERED", message: "机场区域有约 1200 平方米不在本商品的服务区域或上下车加价区域里" },
      { path: "/bindings", reason: "TOO_MANY", message: "x" },
    ],
    drafts,
  );
  assert.deepEqual(placed.map((problem) => [problem.key, problem.field]), [
    ["end", "area_id"],
    ["start", "area_id"],
    [null, null],
  ]);
  assert.match(placed[0]?.text ?? "", /第 3 航站楼/);
});

test("有没有未保存的修改：从保存的内容读出来的一样 = 没有；改了简称 = 有", () => {
  const saved = [binding(), binding({ scenario: "airport_end", place_id: HND, area_id: HND_AREA, short_name_zh: null })];
  const drafts = bindingDraftsOf(saved);
  assert.equal(bindingsDirty(drafts, saved), false);
  assert.equal(bindingsDirty(drafts.map((entry) => (entry.scenario === "airport_end" ? { ...entry, shortName: "羽田机场" } : entry)), saved), true);
});
