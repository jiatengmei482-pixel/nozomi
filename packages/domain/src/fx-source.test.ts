import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFxSource } from "./fx-source.ts";

const NOW = new Date("2026-10-07T01:00:00Z");
/** 2026-10-07T00:02:31Z / 2026-10-08T00:02:31Z 的 Unix 秒 */
const LAST = 1791331351;
const NEXT = LAST + 86_400;

/** 按数据源的格式拼一份响应原文（测试里现场构造；汇率是随手写的数，不是业务数据）。 */
function body(overrides: Record<string, string> = {}, rates: string = '"USD":1,"AED":3.6725,"CNY":7.1234,"EUR":0.8612,"HKD":7.7731,"JPY":151.210,"KRW":1422.53,"THB":36.21,"TWD":32.115'): string {
  const fields: Record<string, string> = {
    result: '"success"',
    provider: '"https://www.exchangerate-api.com"',
    time_last_update_unix: String(LAST),
    time_last_update_utc: '"Wed, 07 Oct 2026 00:02:31 +0000"',
    time_next_update_unix: String(NEXT),
    base_code: '"USD"',
    rates: `{${rates}}`,
    ...overrides,
  };
  return `{${Object.entries(fields).map(([key, value]) => `"${key}":${value}`).join(",")}}`;
}

test("正常的响应：取平台币种的汇率，按数字原文保留（151.210 → 151.21，不经过浮点数）；别的币种不取", () => {
  const parsed = parseFxSource(body(), NOW);
  assert.deepEqual(parsed, {
    ok: true,
    document: {
      base: "USD",
      asOf: "2026-10-07T00:02:31.000Z",
      nextUpdateAt: "2026-10-08T00:02:31.000Z",
      rates: { JPY: "151.21", KRW: "1422.53", CNY: "7.1234", HKD: "7.7731", TWD: "32.115", THB: "36.21" },
    },
  });
});

test("浮点数表示不了的写法原样保留；指数写法换成十进制；付费档的 conversion_rates 也认", () => {
  const precise = parseFxSource(body({}, '"USD":1.0,"CNY":7.100000000000000005,"HKD":7.7731,"JPY":1.5121e2,"KRW":1422.53,"THB":36.21,"TWD":32.115'), NOW);
  assert.ok(precise.ok);
  assert.equal(precise.document.rates.CNY, "7.100000000000000005");
  assert.equal(precise.document.rates.JPY, "151.21");
  const paid = parseFxSource(body({ rates: "null", conversion_rates: '{"USD":1,"CNY":7.1,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32}' }).replace('"rates":null,', ""), NOW);
  assert.ok(paid.ok);
  assert.equal(paid.document.rates.JPY, "150");
  const noNext = parseFxSource(body().replace(`"time_next_update_unix":${NEXT},`, ""), NOW);
  assert.ok(noNext.ok);
  assert.equal(noNext.document.nextUpdateAt, null);
});

test("内容不对的整份拒收，并说明原因：不是 JSON、对方报错、基准不是 USD、缺 USD、缺币种、汇率不是正数、汇率写成字符串、时间不对", () => {
  const problem = (text: string): string => {
    const parsed = parseFxSource(text, NOW);
    return parsed.ok ? "ok" : parsed.problem;
  };
  assert.equal(problem("<html>维护中</html>"), "FX_SOURCE_NOT_JSON");
  assert.equal(problem("[1,2]"), "FX_SOURCE_NOT_JSON");
  assert.equal(problem(body({ rates: "[]" })), "FX_SOURCE_NOT_JSON");
  assert.equal(problem('{"result":"error","error-type":"unsupported-code"}'), "FX_SOURCE_ERROR_RESULT");
  assert.equal(problem(body({ base_code: '"EUR"' })), "FX_SOURCE_WRONG_BASE");
  assert.equal(problem(body({}, '"CNY":7.1,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_WRONG_BASE", "缺 USD");
  assert.equal(problem(body({}, '"USD":1.01,"CNY":7.1,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_WRONG_BASE", "USD 不是 1");
  assert.equal(problem(body({}, '"USD":1,"CNY":7.1,"HKD":7.7,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_MISSING_CURRENCY");
  assert.equal(problem(body({}, '"USD":1,"CNY":0,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_BAD_RATE");
  assert.equal(problem(body({}, '"USD":1,"CNY":-7.1,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_BAD_RATE");
  assert.equal(problem(body({}, '"USD":1,"CNY":"7.1","HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_BAD_RATE");
  assert.equal(problem(body({}, '"USD":1,"CNY":null,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_BAD_RATE");
  assert.equal(problem(body({}, '"USD":1,"CNY":1e400,"HKD":7.7,"JPY":150,"KRW":1400,"THB":36,"TWD":32')), "FX_SOURCE_BAD_RATE");
  assert.equal(problem(body({ time_last_update_unix: '"昨天"' })), "FX_SOURCE_BAD_TIME");
  assert.equal(problem(body({ time_last_update_unix: "1791331351.5" })), "FX_SOURCE_BAD_TIME");
  assert.equal(problem(body({ time_last_update_unix: String(LAST + 7_200) })), "FX_SOURCE_BAD_TIME", "比现在晚 1 小时");
  assert.equal(problem(body({ time_last_update_unix: String(Math.floor(NOW.getTime() / 1000) + 300) })), "ok", "钟差 5 分钟以内照收");
});
