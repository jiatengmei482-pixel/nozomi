import { test } from "node:test";
import assert from "node:assert/strict";
import { QA_ACCEPTANCE_TOKEN_LENGTH } from "@nozomi/config";
import { QA_ACCEPTANCE_RULES } from "@nozomi/domain";
import { testConfig } from "../testing/fixtures.ts";
import { secretValues } from "../logging.ts";
import { qaAcceptanceActive, sessionCookie, sessionFromCookieHeader, tokenMatches } from "./qa-acceptance.ts";

const TOKEN = "qa-acceptance-token-for-unit-tests-Lp27Xw91Kd";

test("口令比较：只有完全相同才对；长度不同、前缀相同、大小写不同都不对", () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true);
  for (const given of ["", TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase(), ` ${TOKEN}`]) assert.equal(tokenMatches(given, TOKEN), false, given);
});

test("会话 Cookie：HttpOnly、Secure、SameSite=Strict、只在 /site/v1 下发送、4 小时；清掉时 Max-Age=0", () => {
  assert.equal(sessionCookie("abc"), "nozomi_qa=abc; Path=/site/v1; Max-Age=14400; HttpOnly; Secure; SameSite=Strict");
  assert.equal(sessionCookie(null), "nozomi_qa=; Path=/site/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
});

test("从 Cookie 请求头取会话：只认 nozomi_qa；没有、空值都当作没带", () => {
  assert.equal(sessionFromCookieHeader(undefined), null);
  assert.equal(sessionFromCookieHeader("theme=dark"), null);
  assert.equal(sessionFromCookieHeader("theme=dark; nozomi_qa=abc123; other=1"), "abc123");
  assert.equal(sessionFromCookieHeader("nozomi_qa_old=x; nozomi_qa=y"), "y");
  assert.equal(sessionFromCookieHeader("nozomi_qa="), null);
  assert.equal(sessionFromCookieHeader(["a=1", "nozomi_qa=z"]), "z");
});

test("验收通道开没开：配了口令、不是 production；production 就算配置对象里有口令也不开（第二道关）", () => {
  const base = testConfig();
  assert.equal(qaAcceptanceActive({ config: base }), false);
  const configured = { ...base, qaAcceptance: { token: TOKEN } };
  assert.equal(qaAcceptanceActive({ config: configured }), true);
  assert.equal(qaAcceptanceActive({ config: { ...configured, appEnv: "staging" } }), true);
  assert.equal(qaAcceptanceActive({ config: { ...configured, appEnv: "production" } }), false);
});

test("口令在日志脱敏的清单里；config 和 domain 的长度规则一致", () => {
  assert.ok(secretValues({ ...testConfig(), qaAcceptance: { token: TOKEN } }).includes(TOKEN));
  assert.deepEqual(QA_ACCEPTANCE_TOKEN_LENGTH, { min: QA_ACCEPTANCE_RULES.tokenMinLength, max: QA_ACCEPTANCE_RULES.tokenMaxLength });
});
