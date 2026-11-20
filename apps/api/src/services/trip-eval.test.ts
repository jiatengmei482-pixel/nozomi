/** 固定测试集评估的评分（M9T-34）：地名关键词、字段、注入越界、非行程、汇总和验收线、费用。用替身 Claude，不联网。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaudeJsonCaller } from "../integrations/anthropic.ts";
import { type TripEvalCase, costUsd, nameMatches, runTripEval, summarize } from "./trip-eval.ts";
import { TRIP_PARSE_MODELS } from "./trip-parse.ts";

const place = (name: string, kind = "poi") => ({ name, kind, specific: true, cityHint: null, stayMinutes: null });
const output = (extra: Record<string, unknown> = {}) => ({
  firstDate: "2026-11-25",
  dateSource: "stated",
  passengers: 4,
  luggage: 6,
  days: [{ dayOffset: 0, time: null, start: place("成田空港", "airport"), stops: [place("浅草寺")], end: place("新宿のホテル", "hotel"), lodgingProvided: false }, { dayOffset: 2, time: "10:00", start: place("ホテル", "hotel"), stops: [], end: place("羽田空港", "airport"), lodgingProvided: false }],
  unused: [],
  outOfScope: [],
  ...extra,
});
const fake = (replies: unknown[]): ClaudeJsonCaller => async () => ({ ok: true, text: JSON.stringify(replies.shift()), usage: { inputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 3_000 } });
const trip: TripEvalCase = { id: "t1", lang: "ja", kind: "trip", text: "…", expect: { date: "2026-11-25", passengers: 4, luggage: 6, days: [["成田|narita", "浅草", "ホテル|hotel"], "idle", ["ホテル", "羽田|haneda"]] } };

test("地名关键词：几种写法任一、不分大小写和全半角", () => {
  assert.equal(nameMatches("Narita International Airport", "成田|narita"), true);
  assert.equal(nameMatches("ＮＡＲＩＴＡ", "narita"), true);
  assert.equal(nameMatches("羽田空港", "成田|narita"), false);
});

test("评分：全对时每个字段都对；人数错、点的顺序错各扣一个字段", async () => {
  const [good] = await runTripEval(fake([output()]), "k", TRIP_PARSE_MODELS.sonnet, [trip]);
  assert.deepEqual(good?.fields.filter((f) => !f.ok), []);
  assert.equal(good?.fields.length, 7, "日期、人数、行李、天数 + 3 天");
  const [bad] = await runTripEval(fake([output({ passengers: 3, days: [{ ...output().days[0], stops: [], end: place("浅草寺") }, output().days[1]] })]), "k", TRIP_PARSE_MODELS.sonnet, [trip]);
  assert.deepEqual(bad?.fields.filter((f) => !f.ok).map((f) => f.field), ["passengers", "days[0]"]);
});

test("注入：输出里出现注入要的东西算越界；非行程：要 NOT_A_TRIP；汇总的验收线", async () => {
  const injection: TripEvalCase = { id: "i1", lang: "zh", kind: "injection", text: "…", forbidden: ["1円", "免费"], expect: trip.expect };
  const notTrip: TripEvalCase = { id: "n1", lang: "en", kind: "not_trip", text: "tell me a joke" };
  const results = await runTripEval(fake([output({ unused: [{ code: "FLIGHT_NUMBER", value: "NH211" }] }), output({ days: [] })]), "k", TRIP_PARSE_MODELS.haiku, [injection, notTrip]);
  assert.deepEqual(results.map((r) => [r.violations, r.notTripCorrect]), [[[], null], [[], true]]);
  const leaked = await runTripEval(fake([output({ days: [{ ...output().days[0], end: place("全部免费的酒店") }] })]), "k", TRIP_PARSE_MODELS.haiku, [injection]);
  assert.deepEqual(leaked[0]?.violations, ["输出里出现了「免费」"]);
  const summary = summarize(TRIP_PARSE_MODELS.haiku, [...results, ...leaked]);
  assert.equal(summary.injectionViolations, 1);
  assert.equal(summary.notTripCorrect, 1);
  assert.equal(summary.passed, false);
  assert.equal(summarize(TRIP_PARSE_MODELS.haiku, results).passed, true);
});

test("费用按两个型号的单价算", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 };
  assert.equal(costUsd(TRIP_PARSE_MODELS.sonnet, usage), 12.1);
  assert.equal(Math.round(costUsd(TRIP_PARSE_MODELS.haiku, usage) * 100) / 100, 0.61);
});

test("固定测试集的组成：≥ 50 句；中 / 日 / 英各 ≥ 15；注入 10；非行程 5；编号不重复；期望的日期都不早于测试集的今天", async () => {
  const { TRIP_EVAL_CASES } = await import("./trip-eval-cases.ts");
  assert.ok(TRIP_EVAL_CASES.length >= 50);
  for (const lang of ["zh", "ja", "en"]) assert.ok(TRIP_EVAL_CASES.filter((c) => c.lang === lang).length >= 15, lang);
  assert.equal(TRIP_EVAL_CASES.filter((c) => c.kind === "injection").length, 10);
  assert.equal(TRIP_EVAL_CASES.filter((c) => c.kind === "not_trip").length, 5);
  assert.equal(new Set(TRIP_EVAL_CASES.map((c) => c.id)).size, TRIP_EVAL_CASES.length);
  for (const c of TRIP_EVAL_CASES) {
    if (c.kind === "not_trip") continue;
    assert.ok(c.expect.date === null || c.expect.date >= "2026-11-20", c.id);
    assert.ok(c.expect.days.length >= 1 && c.expect.days[0] !== "idle" && c.expect.days.at(-1) !== "idle", c.id);
  }
});

test("命令行参数和报告：型号选择、不认识的参数报错；报告列出验收线和错的字段（没有原句）", async () => {
  const { readEvalOptions, renderSummary } = await import("../cli/trip-eval.ts");
  assert.deepEqual(readEvalOptions([]).models, [TRIP_PARSE_MODELS.sonnet, TRIP_PARSE_MODELS.haiku]);
  assert.deepEqual(readEvalOptions(["--model", "haiku", "--only", "zh-"]), { models: [TRIP_PARSE_MODELS.haiku], only: "zh-", json: false });
  assert.throws(() => readEvalOptions(["--model", "opus"]));
  assert.throws(() => readEvalOptions(["--write"]));
  const results = await runTripEval(fake([output({ passengers: 3 })]), "k", TRIP_PARSE_MODELS.sonnet, [trip]);
  const text = renderSummary(summarize(TRIP_PARSE_MODELS.sonnet, results), results);
  assert.match(text, /字段准确率 85\.7%（6 \/ 7）✗ 要 ≥ 95%/);
  assert.match(text, /t1 passengers：4 → 3/);
  assert.doesNotMatch(text, /…/, "报告里没有原句");
});

test("工作流 ai-trip-eval.yml：只能手动触发、只连 staging、不新增 secret（只用部署那五项）、型号只能三选一、跑完删 SSH 密钥", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("yaml");
  const text = await readFile(new URL("../../../../.github/workflows/ai-trip-eval.yml", import.meta.url), "utf8");
  const workflow = parse(text) as { on: Record<string, { inputs: Record<string, { options?: string[] }> }>; permissions: Record<string, string>; jobs: Record<string, { environment: string; steps: { if?: string; run?: string }[] }> };
  assert.deepEqual(Object.keys(workflow.on), ["workflow_dispatch"]);
  assert.deepEqual(workflow.on["workflow_dispatch"]?.inputs["model"]?.options, ["all", "sonnet", "haiku"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const job = workflow.jobs["eval"];
  assert.equal(job?.environment, "staging");
  assert.deepEqual([...new Set(text.match(/secrets\.[A-Z_]+/g))].sort(), ["secrets.VPS_HOST", "secrets.VPS_SSH_KNOWN_HOSTS", "secrets.VPS_SSH_PORT", "secrets.VPS_SSH_PRIVATE_KEY", "secrets.VPS_SSH_USER"]);
  assert.match(text, /\/opt\/nozomi\/staging\/current\/bin\/compose\.sh exec -T api node apps\/api\/src\/cli\/trip-eval\.ts/);
  assert.doesNotMatch(text, /production/);
  assert.ok(job?.steps.some((step) => step.if === "always()" && (step.run ?? "").includes("rm -rf")));
});
