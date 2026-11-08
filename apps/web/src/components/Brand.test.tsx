/**
 * 品牌标识（ADR 0066）：标志是装饰，读屏只读到字标「NOZOMI」；颜色全部来自令牌（不写死十六进制）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanup, render, screen } from "@testing-library/react";
import { AuthLayout } from "./AuthLayout.tsx";
import { Brand } from "./Brand.tsx";

afterEach(cleanup);

test("品牌：标志对读屏隐藏、不可聚焦，可读的名字只有一个「NOZOMI」", () => {
  const { container } = render(<Brand />);
  const svg = container.querySelector("svg");
  assert.ok(svg);
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(container.textContent, "NOZOMI");
  assert.ok(container.querySelector(".brand--default"));
});

test("登录类页面的版式：品牌在页眉里、用色带样式；正文在 main 里；主题切换排在卡片之后", () => {
  const { container } = render(
    <AuthLayout>
      <h1>运营后台</h1>
    </AuthLayout>,
  );
  const brand = screen.getByText("NOZOMI");
  assert.ok(brand.closest("header"));
  assert.ok(brand.closest(".brand--on-brand"));
  assert.equal(screen.getByRole("main").textContent, "运营后台");
  const order = [...container.querySelectorAll("header, main, .auth-page__theme")].map((node) => node.tagName.toLowerCase());
  assert.deepEqual(order, ["header", "main", "div"]);
});

test("品牌和价格的共用样式只引用令牌，不写死颜色", async () => {
  const css = await readFile(new URL("../styles/brand.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
  for (const name of ["--color-brand", "--color-on-brand", "--font-size-5xl", "--font-weight-heavy"]) assert.match(css, new RegExp(name));
  assert.match(css, /tabular-nums/);
});
