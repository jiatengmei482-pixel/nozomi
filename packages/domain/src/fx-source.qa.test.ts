/**
 * 数据源响应解析的测试角色补充（M2-03）：各种数字写法（指数、超长小数、整数、负数、0、超大、超小、写成字符串）、
 * 重复键、嵌套位置的同名键、时间字段的各种写法与 5 分钟钟差边界、超大的完整响应。
 * 响应原文都在测试里现场拼，汇率是随手写的数，不是业务数据。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFxSource } from "./fx-source.ts";

const NOW = new Date("2026-10-07T01:00:00Z");
const LAST = Math.floor(new Date("2026-10-07T00:00:00Z").getTime() / 1000);
const OTHER = '"JPY":150,"CNY":7.2,"KRW":1400,"HKD":7.8,"TWD":32,"THB":36';

/** 拼一份响应原文：`rates` 是汇率表里的原文（不含 USD），`extra` 追加在顶层末尾。 */
function body(rates: string = OTHER, options: { usd?: string; last?: string; next?: string | null; extra?: string; key?: string } = {}): string {
  const next = options.next === null ? "" : `"time_next_update_unix":${options.next ?? String(LAST + 86_400)},`;
  const extra = options.extra === undefined ? "" : `,${options.extra}`;
  return `{"result":"success","time_last_update_unix":${options.last ?? String(LAST)},${next}"base_code":"USD","${options.key ?? "rates"}":{"USD":${options.usd ?? "1"},${rates}}${extra}}`;
}
const withJpy = (jpy: string): string => body(OTHER.replace('"JPY":150', `"JPY":${jpy}`));
function rateOf(text: string, currency = "JPY"): string | null {
  const parsed = parseFxSource(text, NOW);
  return parsed.ok ? (parsed.document.rates as Record<string, string>)[currency] ?? null : null;
}
function problemOf(text: string): string | null {
  const parsed = parseFxSource(text, NOW);
  return parsed.ok ? null : parsed.problem;
}

test("数字写法：指数、超长小数、整数、尾随 0 都按原文规范化；0、负数、超大、超小、写成字符串、true / null 整份拒收", () => {
  const accepted: [string, string][] = [
    ["1.5e2", "150"],
    ["15000e-2", "150"],
    ["1.49123456789012345678e2", "149.123456789012345678"],
    ["149.123456789012345678", "149.123456789012345678"],
    ["150.000000000000000000000", "150"],
    ["1e-5", "0.00001"],
    ["999999999999999", "999999999999999"],
  ];
  for (const [raw, expected] of accepted) assert.equal(rateOf(withJpy(raw)), expected, raw);
  const rejected = ["0", "0.0", "0e5", "-150", "-0", "1e15", "1e400", "1e-400", "0.0000000000000000001", '"150"', '"1.5e2"', "true", "null", "[150]", '{"value":150}'];
  for (const raw of rejected) assert.equal(problemOf(withJpy(raw)), "FX_SOURCE_BAD_RATE", raw);
});

test("USD 自己：1、1.0、1e0、10e-1 都算 1；0.99999999、1.00000001、写成字符串都拒收（基准不对）", () => {
  for (const usd of ["1", "1.0", "1e0", "10e-1", "1.000000000000000000000"]) assert.equal(parseFxSource(body(OTHER, { usd }), NOW).ok, true, usd);
  for (const usd of ["0.99999999", "1.00000001", '"1"', "2"]) assert.equal(problemOf(body(OTHER, { usd })), "FX_SOURCE_WRONG_BASE", usd);
});

test("重复键：取到的原文和 JSON.parse 的最终值是同一个（最后一个），不会张冠李戴", () => {
  // 汇率表里 JPY 出现两次：结果对应最后一个的原文
  assert.equal(rateOf(body(`${OTHER},"JPY":1.51210e2`)), "151.21");
  assert.equal(rateOf(body(`"JPY":1.51210e2,${OTHER}`)), "150");
  // 后一个写坏了：整份拒收（不会退回去用前一个）
  assert.equal(problemOf(body(`${OTHER},"JPY":"151"`)), "FX_SOURCE_BAD_RATE");
  // 顶层 result 重复：以最后一个为准
  assert.equal(problemOf(body(OTHER, { extra: '"result":"error"' })), "FX_SOURCE_ERROR_RESULT");
  // 顶层 rates 重复：用最后一张表
  assert.equal(rateOf(body(OTHER, { extra: `"rates":{"USD":1,${OTHER.replace('"JPY":150', '"JPY":155')}}` })), "155");
});

test("嵌套位置的同名键不被误用：别处的 rates / result / JPY 不顶替顶层的；顶层没有汇率表就拒收", () => {
  // 顶层汇率表正常，另有嵌套的 rates：用顶层的
  assert.equal(rateOf(body(OTHER, { extra: `"meta":{"rates":{"USD":1,"JPY":999}},"JPY":888` })), "150");
  // 汇率表在嵌套位置（顶层没有）：拒收
  const nested = `{"result":"success","time_last_update_unix":${LAST},"base_code":"USD","data":{"rates":{"USD":1,${OTHER}}}}`;
  assert.equal(problemOf(nested), "FX_SOURCE_NOT_JSON");
  // result 只在嵌套位置：拒收
  const nestedResult = `{"meta":{"result":"success"},"time_last_update_unix":${LAST},"base_code":"USD","rates":{"USD":1,${OTHER}}}`;
  assert.equal(problemOf(nestedResult), "FX_SOURCE_ERROR_RESULT");
  // 汇率表里某个币种是对象，对象里有同名键：拒收
  assert.equal(problemOf(withJpy('{"JPY":150}')), "FX_SOURCE_BAD_RATE");
  // rates 和 conversion_rates 都有：用 rates
  assert.equal(rateOf(body(OTHER, { extra: `"conversion_rates":{"USD":1,${OTHER.replace('"JPY":150', '"JPY":160')}}` })), "150");
  // rates 是 null、conversion_rates 正常：用 conversion_rates
  assert.equal(rateOf(body(OTHER, { key: "conversion_rates", extra: '"rates":null' })), "150");
});

test("时间字段：Unix 秒的整数才认；小数、指数、字符串、负数、毫秒都拒收；比现在晚正好 5 分钟收，晚 5 分 1 秒拒收", () => {
  for (const last of [`${LAST}.0`, `${LAST}.5`, "1.7913e9", `"${LAST}"`, `-${LAST}`, `${LAST}000`, "null"]) assert.equal(problemOf(body(OTHER, { last })), "FX_SOURCE_BAD_TIME", last);
  const nowSeconds = NOW.getTime() / 1000;
  const atLimit = parseFxSource(body(OTHER, { last: String(nowSeconds + 300) }), NOW);
  assert.equal(atLimit.ok && atLimit.document.asOf, "2026-10-07T01:05:00.000Z");
  assert.equal(problemOf(body(OTHER, { last: String(nowSeconds + 301) })), "FX_SOURCE_BAD_TIME");
  // 下次更新时间写坏了、没给：不影响这一批，记为 null
  for (const next of ['"tomorrow"', "1.5", null]) {
    const parsed = parseFxSource(body(OTHER, { next }), NOW);
    assert.equal(parsed.ok && parsed.document.nextUpdateAt, null, String(next));
  }
});

test("完整的大响应（160 多个币种、各种写法）：只取平台币种；别的币种写坏了不影响", () => {
  const others: string[] = [];
  for (let i = 0; i < 170; i += 1) {
    const code = `X${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
    others.push(`"${code}":${i % 3 === 0 ? "1.23e-7" : i % 3 === 1 ? String(10 ** (i % 12)) : `"${i}"`}`);
  }
  const parsed = parseFxSource(body(`${others.join(",")},${OTHER}`), NOW);
  assert.ok(parsed.ok);
  assert.deepEqual(Object.keys(parsed.document.rates).sort(), ["CNY", "HKD", "JPY", "KRW", "THB", "TWD"]);
});

test("不是 JSON 的各种响应：HTML、空、只有空白、截断、JSON 数组、裸数字、带 BOM：都按 FX_SOURCE_NOT_JSON 拒收，不抛异常", () => {
  for (const text of ["<!doctype html><title>维护中</title>", "", "   ", body().slice(0, -5), "[]", "150", "null", `﻿${body()}`]) {
    assert.equal(problemOf(text), "FX_SOURCE_NOT_JSON", JSON.stringify(text.slice(0, 30)));
  }
});
