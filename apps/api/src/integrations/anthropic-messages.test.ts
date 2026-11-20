/**
 * AI 一句话行程调 Claude（M9T-32，ADR 0104 第四节第 2 小节）：用官方 SDK 打本机的假消息接口，核对请求的样子和结果归类。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type FakeService, anthropicErrorBody, anthropicMessageBody, startFakeAnthropicMessages } from "../testing/fake-integrations.ts";
import { type ClaudeJsonRequest, createClaudeJsonCaller } from "./anthropic.ts";

const KEY = `sk-ant-test-${"k".repeat(24)}`;
const request: ClaudeJsonRequest = { model: "claude-haiku-5-5", system: "SYSTEM PROMPT", user: "Today in Japan is 2026-11-20 (Friday).\n<customer_input>\n成田接机\n</customer_input>", schema: { type: "object", additionalProperties: false, required: [], properties: {} }, maxTokens: 4_000, timeoutMs: 2_000 };
let fake: FakeService;
let call: ReturnType<typeof createClaudeJsonCaller>;

before(async () => {
  fake = await startFakeAnthropicMessages();
  call = createClaudeJsonCaller(fake.origin);
});
after(async () => {
  await fake.close();
});

test("请求：POST /v1/messages，密钥在请求头；型号、max_tokens、effort low、结构化输出、系统提示带缓存；不传 thinking 和采样参数", async () => {
  fake.requests.length = 0;
  fake.respond({ body: anthropicMessageBody({ ok: true }) });
  const result = await call(KEY, request);
  assert.deepEqual(result, { ok: true, text: '{"ok":true}', usage: { inputTokens: 420, outputTokens: 900, cacheReadTokens: 2_800 } });
  const sent = fake.requests[0];
  assert.equal(sent?.method, "POST");
  assert.equal(sent?.path, "/v1/messages");
  // SDK 1.x 把密钥放在 Authorization 请求头里（不放在网址里）
  assert.equal(sent?.headers["authorization"], `Bearer ${KEY}`);
  assert.ok(!(sent?.path ?? "").includes(KEY), "密钥不在网址里");
  const body = JSON.parse(sent?.body ?? "{}");
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.max_tokens, 4_000);
  assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: request.schema } });
  assert.deepEqual(body.system, [{ type: "text", text: "SYSTEM PROMPT", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body.messages, [{ role: "user", content: request.user }]);
  for (const name of ["thinking", "temperature", "top_p", "top_k", "tools", "tool_choice"]) assert.equal(name in body, false, name);
});

test("归类：拒答、到上限、型号不可用、过载（SDK 重试 1 次后）、超时；都不带对方返回的原文", async () => {
  fake.respond({ body: anthropicMessageBody({}, { stopReason: "refusal" }) });
  assert.deepEqual(await call(KEY, request), { ok: false, failure: "refused", usage: { inputTokens: 420, outputTokens: 900, cacheReadTokens: 2_800 }, httpStatus: 200 });
  fake.respond({ body: anthropicMessageBody({}, { stopReason: "max_tokens" }) });
  const maxTokens = await call(KEY, request);
  assert.equal(!maxTokens.ok && maxTokens.failure, "max_tokens");
  fake.respond({ status: 404, body: anthropicErrorBody("not_found_error") });
  const missing = await call(KEY, request);
  assert.deepEqual(missing, { ok: false, failure: "model_unavailable", usage: null, httpStatus: 404 });
  fake.requests.length = 0;
  fake.respond({ status: 529, body: anthropicErrorBody("overloaded_error") });
  const overloaded = await call(KEY, request);
  assert.deepEqual(overloaded, { ok: false, failure: "error", usage: null, httpStatus: 529 });
  assert.equal(fake.requests.length, 2, "SDK 自带重试 1 次");
  fake.requests.length = 0;
  fake.respond({ body: anthropicMessageBody({}), delayMs: 600 });
  const slow = await call(KEY, { ...request, timeoutMs: 200 });
  assert.deepEqual(slow, { ok: false, failure: "timeout", usage: null, httpStatus: null });
});

test("端到端用的假服务：默认回固定行程；「讲个笑话」回空行程；「AI 出错」回 529", async () => {
  const fresh = await startFakeAnthropicMessages();
  try {
    const caller = createClaudeJsonCaller(fresh.origin);
    const trip = await caller(KEY, request);
    assert.equal(trip.ok && JSON.parse(trip.text).days.length, 2);
    const joke = await caller(KEY, { ...request, user: "讲个笑话" });
    assert.equal(joke.ok && JSON.parse(joke.text).days.length, 0);
    const broken = await caller(KEY, { ...request, user: "AI 出错" });
    assert.equal(!broken.ok && broken.httpStatus, 529);
  } finally {
    await fresh.close();
  }
});
