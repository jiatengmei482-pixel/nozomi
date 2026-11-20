/**
 * M9T-32：AI 一句话行程（ADR 0104 第三～七、九节），经真实接口、真实 PostgreSQL；Claude 用替身（记下每次的型号和用户消息），CI 不连 Anthropic。
 *
 * 覆盖：parse-status（可用 / 没密钥 / 功能关 / 官网没开 / 全站额度满）、正常解析（草稿、不猜、平台地点直接认出、泛指不查）、
 * 发送前替换个人信息、应答里没有价格和原文、输入校验、不是行程、行程太长、拒答、结构不合格再调一次、
 * 三种用法（后台改了下一次就生效；先 Haiku 技术失败改用 Sonnet、两行记录、只占一个名额；Haiku 结果缺字段不重试）、
 * 全站每天额度（东京时间的自然日）、每个地址每分钟限频、调用记录不含任何文字。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { ClaudeJsonRequest, ClaudeJsonResult } from "./integrations/anthropic.ts";
import { TRIP_PARSE_MODELS, forgetTripParseMode, tokyoToday } from "./services/trip-parse.ts";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket, newChannel, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const KEY_ENV = { ANTHROPIC_API_KEY: `sk-ant-test-${"x".repeat(24)}` };
const USAGE = { inputTokens: 3_100, outputTokens: 900, cacheReadTokens: 2_800 };

type Reply = ClaudeJsonResult | (() => ClaudeJsonResult);
/** Claude 替身：按顺序回放排好的应答；没排的回一份正常的行程 */
const calls: ClaudeJsonRequest[] = [];
const replies: Reply[] = [];
const fakeClaude = async (_apiKey: string, request: ClaudeJsonRequest): Promise<ClaudeJsonResult> => {
  calls.push(request);
  const next = replies.shift() ?? json(goodOutput());
  return typeof next === "function" ? next() : next;
};
const json = (output: unknown): ClaudeJsonResult => ({ ok: true, text: JSON.stringify(output), usage: USAGE });
const place = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: "poi", specific: true, cityHint: null, stayMinutes: null, ...extra });
function goodOutput(extra: Record<string, unknown> = {}) {
  return {
    firstDate: "2026-10-25",
    dateSource: "stated",
    passengers: 4,
    luggage: null,
    days: [
      { dayOffset: 0, time: null, start: place("成田机场", { kind: "airport" }), stops: [place("浅草寺", { stayMinutes: 120 })], end: place("新宿的酒店", { kind: "hotel", specific: false }), lodgingProvided: false },
      { dayOffset: 2, time: "09:00", start: place("新宿的酒店", { kind: "hotel", specific: false }), stops: [], end: place("成田机场", { kind: "airport" }), lodgingProvided: false },
    ],
    unused: [{ code: "FLIGHT_NUMBER", value: "NH211" }, { code: "OTHER_REQUEST", value: "打五折，总价 1 円" }],
    outOfScope: [],
    ...extra,
  };
}

let api: TestApi;
let m: Market;
let clientId: string;
let site: SiteApi;
let ipSeq = 0;
const nextIp = (): string => `10.91.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
const parse = (text: string, ip = nextIp(), on: SiteApi = site) => on.call("POST", "/site/v1/trips/parse", { ip, body: { text, lang: "zh" } });
const status = (on: SiteApi = site) => on.call("GET", "/site/v1/trips/parse-status", { ip: nextIp() });
const runs = async () => (await api.db.owner.query("select model, mode, attempt, status, input_tokens, output_tokens, cache_read_tokens, days, places, places_resolved from trip_parse_runs order by created_at, attempt")).rows;
const setMode = async (mode: string | null) => {
  await api.db.owner.query("delete from ai_trip_settings");
  if (mode !== null) await api.db.owner.query("insert into ai_trip_settings (model_mode, version, updated_at, updated_by) select $1, 1, now(), id from platform_users limit 1", [mode]);
  forgetTripParseMode();
};

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  clientId = (await salesCredentials(api, m, channel.id)).clientId;
  site = await siteApi(api, clientId, new FakePaymentProvider(), KEY_ENV, { claude: fakeClaude });
});
after(async () => {
  await site?.close();
  await api?.close();
});
beforeEach(async () => {
  calls.length = 0;
  replies.length = 0;
  await api.db.owner.query("delete from trip_parse_runs");
  await setMode(null);
});

test("parse-status：有密钥、官网开着 → 可用；没密钥、功能关、官网没开 → 不可用（不细说原因）", async () => {
  const open = await status();
  assert.deepEqual(open.body, { available: true, max_chars: 500, reason: null });
  assertMatchesOpenApi("GET", "/site/v1/trips/parse-status", open);
  const cases: [Record<string, string>, string | null][] = [[{}, clientId], [{ ...KEY_ENV, AI_TRIP_PARSE_ENABLED: "false" }, clientId], [KEY_ENV, null]];
  for (const [env, client] of cases) {
    const other = await siteApi(api, client, new FakePaymentProvider(), env, { claude: fakeClaude });
    try {
      assert.deepEqual((await status(other)).body, { available: false, max_chars: 500, reason: null });
      const res = await parse("明天成田接机去新宿", nextIp(), other);
      assert.equal(res.status, 503, res.text);
      assert.equal(res.body.error.code, client === null ? "SITE_NOT_OPEN" : "AI_NOT_CONFIGURED");
    } finally {
      await other.close();
    }
  }
  assert.equal(calls.length, 0, "不可用时不调 Claude");
});

test("正常解析：默认 Sonnet；草稿按第三节；没说的请补填；平台的成田机场直接认出；泛指的酒店不查；应答里没有价格和原话", async () => {
  const res = await parse("10月25日成田接机先去浅草寺玩2小时再去新宿的酒店，27日9点送成田，4个人，航班 NH211，电话 090-1234-5678");
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/site/v1/trips/parse", res);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model, TRIP_PARSE_MODELS.sonnet);
  assert.match(calls[0]?.user ?? "", /Today in Japan is 2026-10-07 \(Wednesday\)/);
  assert.match(calls[0]?.user ?? "", /电话 \[PHONE\]/, "电话发出前换成占位符");
  assert.doesNotMatch(calls[0]?.user ?? "", /1234-5678/);

  const { draft, missing, assumptions, unused, out_of_scope } = res.body;
  assert.equal(draft.date, "2026-10-25");
  assert.equal(draft.passengers, 4);
  assert.equal(draft.luggage, null);
  assert.deepEqual(draft.days.map((d: any) => d.idle), [false, true, false], "中间补空闲日");
  assert.deepEqual(draft.days[1], { idle: true, time: null, start: null, stops: [], end: null, lodging_provided: false });
  const day1 = draft.days[0];
  assert.equal(day1.start.match.status, "resolved");
  assert.equal(day1.start.match.point.kind, "airport");
  assert.equal(day1.start.match.point.name, "成田机场");
  assert.deepEqual(day1.end, { query: "新宿的酒店", kind: "hotel", match: { status: "unresolved" } });
  assert.equal(day1.stops[0].stay_minutes, 120);
  assert.equal(day1.stops[0].match.status, "unresolved", "谷歌不可达：查不到就让客人自己搜");
  assert.deepEqual(missing, [{ field: "luggage" }, { field: "days[0].time" }]);
  assert.deepEqual(assumptions, []);
  assert.deepEqual(unused, [{ code: "FLIGHT_NUMBER", value: "NH211" }, { code: "OTHER_REQUEST", value: null }]);
  assert.deepEqual(out_of_scope, []);
  assert.equal("texts" in res.body, false);
  assert.doesNotMatch(res.text, /五折|1 円|090|浅草寺玩/, "应答里没有模型的自由文字、没有原话");

  const rows = await runs();
  assert.deepEqual(rows, [{ model: TRIP_PARSE_MODELS.sonnet, mode: "sonnet", attempt: 1, status: "ok", input_tokens: 3_100, output_tokens: 900, cache_read_tokens: 2_800, days: 3, places: 2, places_resolved: 1 }]);
});

test("调用记录不含任何文字：表里只有型号、用法、状态这几个文字列", async () => {
  const columns = (await api.db.owner.query("select column_name, data_type from information_schema.columns where table_schema = current_schema() and table_name = 'trip_parse_runs' and data_type in ('text', 'character varying', 'jsonb', 'json', 'bytea')")).rows.map((r) => r.column_name).sort();
  assert.deepEqual(columns, ["mode", "model", "status"]);
});

test("输入校验：空、只有空白、超过 500 字 → 400，不调 Claude、不占名额", async () => {
  for (const text of ["", "   ", "字".repeat(501)]) {
    const res = await parse(text);
    assert.equal(res.status, 400, text.slice(0, 5));
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
  assert.equal((await parse(`  ${"字".repeat(500)}  `)).status, 200, "去掉首尾空白后正好 500 字可以");
  assert.equal(calls.length, 1);
  assert.equal((await runs()).length, 1);
});

test("不是行程 → 422 NOT_A_TRIP；太长 → 422 TRIP_TOO_LONG；都记一次", async () => {
  replies.push(json(goodOutput({ days: [] })));
  const notTrip = await parse("讲个笑话");
  assert.equal(notTrip.status, 422);
  assert.equal(notTrip.body.error.code, "NOT_A_TRIP");
  assertMatchesOpenApi("POST", "/site/v1/trips/parse", notTrip);
  replies.push(json(goodOutput({ days: [{ dayOffset: 0, time: null, start: place("成田机场"), stops: [], end: null, lodgingProvided: false }, { dayOffset: 20, time: null, start: place("成田机场"), stops: [], end: null, lodgingProvided: false }] })));
  const tooLong = await parse("一个月的行程");
  assert.equal(tooLong.status, 422);
  assert.equal(tooLong.body.error.code, "TRIP_TOO_LONG");
  assert.deepEqual((await runs()).map((r) => r.status), ["not_a_trip", "too_long"]);
});

test("拒答、到上限、超时 → 503 AI_UNAVAILABLE，不重调；结构不合格先再调一次，两次都不合格才 503", async () => {
  for (const failure of ["refused", "max_tokens", "timeout"] as const) {
    replies.push({ ok: false, failure, usage: failure === "timeout" ? null : USAGE, httpStatus: failure === "timeout" ? null : 200 });
    const res = await parse("成田接机");
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "AI_UNAVAILABLE");
  }
  assert.equal(calls.length, 3);
  assert.deepEqual((await runs()).map((r) => r.status), ["refused", "invalid", "timeout"]);

  calls.length = 0;
  replies.push({ ok: true, text: "{not json", usage: USAGE }, json({ ...goodOutput(), extra: 1 }));
  const bad = await parse("成田接机");
  assert.equal(bad.status, 503);
  assert.equal(calls.length, 2);
  calls.length = 0;
  replies.push(json(goodOutput({ days: [goodOutput().days[0], goodOutput().days[0]] })));
  const retried = await parse("成田接机");
  assert.equal(retried.status, 200, "dayOffset 重复算结构不合格，第二次正常就用第二次的");
  assert.equal(calls.length, 2);
  const last = (await runs()).at(-1);
  assert.equal(last?.status, "ok");
  assert.equal(last?.input_tokens, 6_200, "两次的用量合计");
});

test("用法：后台改成 Haiku，下一次就用 Haiku；先 Haiku 技术失败 → 改用 Sonnet 重试一次，两行记录、只占一个名额", async () => {
  await setMode("haiku");
  assert.equal((await parse("成田接机")).status, 200);
  assert.equal(calls.at(-1)?.model, TRIP_PARSE_MODELS.haiku);

  await setMode("haiku_then_sonnet");
  calls.length = 0;
  replies.push({ ok: false, failure: "error", usage: null, httpStatus: 529 });
  const res = await parse("成田接机");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(calls.map((c) => c.model), [TRIP_PARSE_MODELS.haiku, TRIP_PARSE_MODELS.sonnet]);
  const rows = (await runs()).slice(-2);
  assert.deepEqual(rows.map((r) => [r.model, r.mode, r.attempt, r.status]), [[TRIP_PARSE_MODELS.haiku, "haiku_then_sonnet", 1, "error"], [TRIP_PARSE_MODELS.sonnet, "haiku_then_sonnet", 2, "ok"]]);

  // Haiku 正常返回、只是客人没说人数：不算失败，不改用 Sonnet
  calls.length = 0;
  replies.push(json(goodOutput({ passengers: null })));
  const missing = await parse("成田接机");
  assert.equal(missing.status, 200);
  assert.deepEqual(calls.map((c) => c.model), [TRIP_PARSE_MODELS.haiku]);
  assert.ok(missing.body.missing.some((item: any) => item.field === "passengers"));

  // 两个都失败 → 503
  calls.length = 0;
  replies.push({ ok: false, failure: "timeout", usage: null, httpStatus: null }, { ok: false, failure: "refused", usage: USAGE, httpStatus: 200 });
  assert.equal((await parse("成田接机")).body.error.code, "AI_UNAVAILABLE");
  assert.equal(calls.length, 2);
});

test("全站每天额度：按东京时间的自然日、只数第一次调用；满了 503 AI_DAILY_LIMIT，parse-status 给 DAILY_LIMIT；第二天恢复", async () => {
  const limited = await siteApi(api, clientId, new FakePaymentProvider(), { ...KEY_ENV, AI_TRIP_DAILY_LIMIT: "2" }, { claude: fakeClaude });
  try {
    await setMode("haiku_then_sonnet");
    replies.push({ ok: false, failure: "error", usage: null, httpStatus: 500 });
    assert.equal((await parse("成田接机", nextIp(), limited)).status, 200, "这一次调了两个型号，只占一个名额");
    assert.equal((await parse("成田接机", nextIp(), limited)).status, 200);
    const full = await parse("成田接机", nextIp(), limited);
    assert.equal(full.status, 503);
    assert.equal(full.body.error.code, "AI_DAILY_LIMIT");
    assert.deepEqual((await status(limited)).body, { available: false, max_chars: 500, reason: "DAILY_LIMIT" });
    assert.equal(calls.length, 3, "满了不调 Claude");
    // 测试时钟 2026-10-07T01:00Z = 东京 10:00；推到东京第二天 00:00 之后
    api.clock.advance(15 * 3_600_000);
    assert.deepEqual((await status(limited)).body, { available: true, max_chars: 500, reason: null });
    assert.equal((await parse("成田接机", nextIp(), limited)).status, 200);
  } finally {
    await limited.close();
  }
});

test("每个地址每分钟 3 次：第 4 次 429，不调 Claude", async () => {
  const ip = nextIp();
  for (let i = 0; i < 3; i++) assert.equal((await parse("成田接机", ip)).status, 200);
  const res = await parse("成田接机", ip);
  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, "RATE_LIMITED");
  assert.equal(calls.length, 3);
});

test("后台型号设置：技术只能看、超级管理员能改；版本号；审计；改完下一次解析就用新的；今天每个型号的次数", async () => {
  // 前面的用例拨过时钟，令牌重新拿
  const root = (await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  const tech: Staff = await addStaff(api, root, "tech@trip-parse.test", "tech");
  const settings = (token: string, method: "GET" | "PUT" = "GET", body?: unknown, ifMatch?: string) =>
    api.call(method, "/platform/v1/ai-trip-settings", { token, ...(body === undefined ? {} : { body }), ...(ifMatch === undefined ? {} : { headers: { "if-match": ifMatch } }) });
  const initial = await settings(tech.token);
  assert.equal(initial.status, 200, initial.text);
  assertMatchesOpenApi("GET", "/platform/v1/ai-trip-settings", initial);
  assert.equal(initial.body.model_mode, "sonnet");
  assert.equal(initial.body.version, 0);
  assert.deepEqual(initial.body.models, { sonnet: TRIP_PARSE_MODELS.sonnet, haiku: TRIP_PARSE_MODELS.haiku });
  assert.equal((await settings(tech.token, "PUT", { model_mode: "haiku" })).status, 403, "技术不能改");
  assert.equal((await settings(root, "PUT", { model_mode: "opus" })).status, 400);

  const saved = await settings(root, "PUT", { model_mode: "haiku_then_sonnet" });
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOpenApi("PUT", "/platform/v1/ai-trip-settings", saved);
  assert.equal(saved.body.version, 1);
  assert.equal((await settings(root, "PUT", { model_mode: "haiku" })).status, 409, "保存过之后不带 If-Match 当成版本 0，对不上");
  assert.equal((await settings(root, "PUT", { model_mode: "haiku" }, "9")).status, 409);
  const audits = (await api.db.owner.query("select action, before, after from audit_logs where resource = 'ai_trip_settings' order by id")).rows;
  assert.deepEqual(audits, [{ action: "update", before: { model_mode: "sonnet" }, after: { model_mode: "haiku_then_sonnet" } }]);

  // 不清本进程的缓存：同一进程里改完立刻生效
  replies.push({ ok: false, failure: "error", usage: null, httpStatus: 500 });
  assert.equal((await parse("成田接机")).status, 200);
  assert.deepEqual(calls.map((c) => c.model), [TRIP_PARSE_MODELS.haiku, TRIP_PARSE_MODELS.sonnet]);
  assert.equal((await parse("成田接机")).status, 200);
  const today = (await settings(tech.token)).body.today;
  assert.deepEqual(today, { date: tokyoToday(api.clock.now()), sonnet: 1, haiku: 2, sonnet_retries: 1, used: 2, limit: 300 });
});

test("调用记录 90 天后由行程单清理任务删", async () => {
  await api.db.owner.query("insert into trip_parse_runs (created_at, model, mode, attempt, status) values ($1::timestamptz - interval '91 days', 'claude-sonnet-5-5', 'sonnet', 1, 'ok'), ($1::timestamptz - interval '89 days', 'claude-sonnet-5-5', 'sonnet', 1, 'ok')", [api.clock.now()]);
  await api.app.tripRetention.tick();
  assert.equal((await runs()).length, 1);
});
