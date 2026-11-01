/** Stripe 的错误 → 给客人看的中文（ADR 0046）：不用 Stripe 的原话；英文不出现；建议只说一遍；高风险代码不告诉客人真实原因。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAYMENT_FAILURE_TEXTS, paymentFailureText } from "./payment-errors.ts";

const GENERIC_DECLINE = "您的银行卡被拒绝了。请换一张卡，或联系发卡银行。";
const UNKNOWN = "银行没有接受这次付款。请换一张卡，或稍后再试；一直不行请联系客服。";

test("decline_code 优先于 code：同样是 card_declined，余额不足要说余额不足", () => {
  assert.equal(paymentFailureText({ type: "card_error", code: "card_declined", decline_code: "insufficient_funds" }), "您的银行卡余额不足。请换一张卡。");
  assert.equal(paymentFailureText({ type: "card_error", code: "card_declined", decline_code: "generic_decline" }), GENERIC_DECLINE);
  assert.equal(paymentFailureText({ type: "card_error", code: "card_declined" }), GENERIC_DECLINE);
  assert.equal(paymentFailureText({ code: "expired_card", decline_code: "expired_card" }), "这张卡已过期。请换一张卡。");
  assert.equal(paymentFailureText({ code: "payment_intent_authentication_failure" }), "银行验证没有通过。请重新付款并完成验证，或换一张卡。");
});

test("Stripe 的原话一律不用：给了英文说明也只看代码", () => {
  const withMessage = { code: "card_declined", message: "Your card was declined." };
  assert.equal(paymentFailureText(withMessage), GENERIC_DECLINE);
});

test("疑似盗刷、挂失、风控拦截：Stripe 要求不告诉客人真实原因，一律说被拒绝", () => {
  for (const decline_code of ["fraudulent", "lost_card", "stolen_card", "pickup_card", "merchant_blacklist", "restricted_card", "security_violation"]) {
    assert.equal(paymentFailureText({ type: "card_error", code: "card_declined", decline_code }), GENERIC_DECLINE, decline_code);
  }
});

test("不认识的代码：卡被拒的说被拒，填写的说检查，其余给通用提示；Object 原型上的名字不能当成代码命中", () => {
  assert.equal(paymentFailureText({ type: "card_error", code: "card_declined", decline_code: "some_future_decline" }), GENERIC_DECLINE);
  assert.equal(paymentFailureText({ type: "validation_error", code: "some_future_validation" }), "请检查银行卡信息后再付。");
  assert.equal(paymentFailureText({ type: "card_error", code: "some_future_code" }), UNKNOWN);
  assert.equal(paymentFailureText({}), UNKNOWN);
  for (const code of ["constructor", "__proto__", "toString"]) assert.equal(paymentFailureText({ code }), UNKNOWN, code);
});

test("每一句：只有中文（看不到英文）、句号结尾、同一句建议不说两遍", () => {
  const all = [...PAYMENT_FAILURE_TEXTS, GENERIC_DECLINE, UNKNOWN];
  assert.ok(all.length >= 15);
  for (const text of all) {
    assert.doesNotMatch(text, /[A-Za-z]/, text);
    assert.match(text, /。$/, text);
    const sentences = text.split("。").filter(Boolean);
    assert.equal(new Set(sentences).size, sentences.length, text);
    assert.ok((text.match(/换一张卡/g) ?? []).length <= 1, text);
  }
});
