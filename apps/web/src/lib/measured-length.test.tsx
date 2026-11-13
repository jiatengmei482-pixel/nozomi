/**
 * 实测尺寸变量（M6-11）：只写登记过的变量，值固定是「整数px」；元素没了、组件卸载时去掉变量。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render } from "@testing-library/react";
import { resetBrowser } from "../testing/harness.tsx";
import { MEASURED_LENGTHS, type MeasuredLengthName, isMeasuredLengthName, measuredPixels, useMeasuredHeight } from "./measured-length.ts";

afterEach(resetBrowser);

const rootValue = (name: string): string => document.documentElement.style.getPropertyValue(name);

function Probe({ element, name }: { element: HTMLElement | null; name: MeasuredLengthName }) {
  useMeasuredHeight(element, name);
  return null;
}

const sized = (height: number): HTMLElement => {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 100, height });
  return element;
};

test("名单：只登记了 --driver-bar-height，只许 driver.css 引用", () => {
  assert.deepEqual(MEASURED_LENGTHS, { "--driver-bar-height": ["driver.css"] });
  assert.equal(isMeasuredLengthName("--driver-bar-height"), true);
  for (const name of ["--color-text", "--driver-bar-height ", "driver-bar-height", "toString", "__proto__", "constructor", ""]) assert.equal(isMeasuredLengthName(name), false, name);
});

test("值固定写成「整数px」：向上取整，不是有限正数时按 0px", () => {
  assert.equal(measuredPixels(64), "64px");
  assert.equal(measuredPixels(64.01), "65px");
  assert.equal(measuredPixels(0.2), "1px");
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.equal(measuredPixels(bad), "0px", String(bad));
  for (const value of [1, 12.5, 99.999, 1e6 + 0.1, Number.NaN, -1]) assert.match(measuredPixels(value), /^(0|[1-9]\d*)px$/);
});

test("量出来的高度写进 <html> 的变量；元素换成 null、组件卸载时去掉", () => {
  const view = render(<Probe element={sized(72.4)} name="--driver-bar-height" />);
  assert.equal(rootValue("--driver-bar-height"), "73px");
  view.rerender(<Probe element={null} name="--driver-bar-height" />);
  assert.equal(rootValue("--driver-bar-height"), "");
  view.rerender(<Probe element={sized(40)} name="--driver-bar-height" />);
  assert.equal(rootValue("--driver-bar-height"), "40px");
  view.unmount();
  assert.equal(rootValue("--driver-bar-height"), "");
});

test("没登记的变量名：报错，不写任何东西", () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    assert.throws(() => render(<Probe element={sized(10)} name={"--color-text" as MeasuredLengthName} />), /--color-text 不是登记过的实测尺寸变量/);
  } finally {
    console.error = original;
  }
  assert.equal(rootValue("--color-text"), "");
  assert.equal(document.documentElement.getAttribute("style") ?? "", "");
});
