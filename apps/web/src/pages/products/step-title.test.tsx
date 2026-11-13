/**
 * 步骤标题聚焦框的输入方式（docs/design/01-tokens.md 第 5 节「程序聚焦的例外」，M6-10）：事件本身怎么算、这一次导航带没带、标题自己的事件。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StepTitle, inputSourceOf, markStepChange, navigationSource, resetStepChange } from "./step-title.tsx";

afterEach(() => {
  cleanup();
  resetStepChange();
});

test("输入方式由触发的那次事件本身定：click 有 detail 是点击，没有（键盘 Enter / 空格、读屏）是按键；pointerdown 是点击，keydown 是按键", () => {
  assert.equal(inputSourceOf({ type: "click", detail: 1 }), "pointer");
  assert.equal(inputSourceOf({ type: "click", detail: 2 }), "pointer");
  assert.equal(inputSourceOf({ type: "click", detail: 0 }), "keyboard");
  assert.equal(inputSourceOf({ type: "click" }), "keyboard");
  assert.equal(inputSourceOf({ type: "pointerdown", detail: 0 }), "pointer");
  assert.equal(inputSourceOf({ type: "keydown", detail: 0 }), "keyboard");
});

test("这一次导航带没带输入方式：只认记下的地址（或它下面的步骤）、同一次导航；后退 / 前进和没记过的一律 unknown", () => {
  assert.equal(navigationSource({ pathname: "/products/p1/basic", key: "a" }, "PUSH"), "unknown", "没有记下：直接打开网址");
  markStepChange("pointer", "/products/p1/content");
  assert.equal(navigationSource({ pathname: "/products/p1/content", key: "b" }, "POP"), "unknown", "后退 / 前进不看记下的");
  assert.equal(navigationSource({ pathname: "/products/p1/basic", key: "c" }, "PUSH"), "unknown", "去的不是记下的地址");
  assert.equal(navigationSource({ pathname: "/products/p1/content", key: "d" }, "PUSH"), "pointer");
  assert.equal(navigationSource({ pathname: "/products/p1/content", key: "d" }, "PUSH"), "pointer", "同一次导航可以再取（开发模式副作用跑两遍）");
  assert.equal(navigationSource({ pathname: "/products/p1/content", key: "e" }, "PUSH"), "unknown", "下一次导航不再沿用");

  markStepChange("keyboard", "http://localhost/products/p2");
  assert.equal(navigationSource({ pathname: "/products/p2/service-rules", key: "f" }, "REPLACE"), "keyboard", "从列表点进 /products/{id}，再转到第一个没完成的步骤");
  assert.equal(navigationSource({ pathname: "/products/p22/basic", key: "g" }, "PUSH"), "unknown");
});

test("标题自己：pointerdown 写 pointer；非修饰键写 keyboard，只按 Shift / Ctrl / Alt / Meta 不算；失去焦点去掉；运营后台（不启用）不写", () => {
  render(
    <>
      <StepTitle enabled>① 基础信息</StepTitle>
      <StepTitle enabled={false}>② 服务规则</StepTitle>
    </>,
  );
  const title = screen.getByRole("heading", { name: "① 基础信息" });
  assert.equal(title.getAttribute("tabindex"), "-1");
  assert.equal(title.className, "step__title");
  fireEvent.pointerDown(title);
  title.focus();
  assert.equal(title.dataset["focusSource"], "pointer");
  for (const key of ["Shift", "Control", "Alt", "Meta"]) {
    fireEvent.keyDown(title, { key });
    assert.equal(title.dataset["focusSource"], "pointer", `${key} 是修饰键`);
  }
  fireEvent.keyDown(title, { key: "ArrowDown" });
  assert.equal(title.dataset["focusSource"], "keyboard");
  fireEvent.blur(title);
  assert.equal(title.hasAttribute("data-focus-source"), false);

  const platform = screen.getByRole("heading", { name: "② 服务规则" });
  fireEvent.pointerDown(platform);
  fireEvent.keyDown(platform, { key: "a" });
  assert.equal(platform.hasAttribute("data-focus-source"), false);
});
