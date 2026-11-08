/**
 * 官网价格的样式包装（M6-05）：文字和 `moneyText` 给的完全一样，只是数字、币种分开套样式。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import { moneyText } from "../../lib/dispatch-display.ts";
import { SitePrice } from "./SitePrice.tsx";

afterEach(cleanup);

test("价格：数字和币种分两段，整体文字不变（读屏、复制出来仍是「22,000 JPY」）", () => {
  const { container } = render(<SitePrice text={moneyText({ amount: "22000", currency: "JPY" })} />);
  const price = container.querySelector(".price");
  assert.ok(price);
  assert.equal(price.className, "price");
  assert.equal(price.textContent, "22,000 JPY");
  assert.equal(price.querySelector(".price__amount")?.textContent, "22,000");
  assert.equal(price.querySelector(".price__currency")?.textContent, "JPY");
});

test("价格：尺寸用共用样式的修饰类；负数、小数照原样显示", () => {
  const { container } = render(<SitePrice text={moneyText({ amount: "-1234.5", currency: "USD" })} size="lg" />);
  const price = container.querySelector(".price");
  assert.equal(price?.className, "price price--lg");
  assert.equal(price?.querySelector(".price__amount")?.textContent, "-1,234.5");
  assert.equal(price?.textContent, "-1,234.5 USD");
});

test("价格：没有币种的文字整段当数字显示，不丢字", () => {
  const { container } = render(<SitePrice text="22,000" size="sm" />);
  assert.equal(container.querySelector(".price")?.textContent, "22,000");
  assert.equal(container.querySelector(".price__currency"), null);
});
