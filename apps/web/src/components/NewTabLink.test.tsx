import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen } from "@testing-library/react";
import { NewTabLink, isInternalPath } from "./NewTabLink.tsx";

afterEach(cleanup);

test("新标签页打开的站内链接：只认以一个 / 开头的相对路径；别的一律不生成链接", () => {
  for (const to of ["/areas/new?city=1&biz=charter", "/products?area=abc", "/"]) assert.equal(isInternalPath(to), true, to);
  for (const to of ["//evil.example/x", "https://evil.example", "javascript:alert(1)", "areas/new", "/\\evil.example", "/a\tb", ""]) assert.equal(isInternalPath(to), false, JSON.stringify(to));
  render(<NewTabLink to="/areas/new">新增区域</NewTabLink>);
  const link = screen.getByRole("link", { name: "新增区域 （在新标签页打开）" });
  assert.equal(link.getAttribute("href"), "/areas/new");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.equal(link.getAttribute("rel"), "noopener");
  cleanup();
  render(<NewTabLink to="//evil.example">坏链接</NewTabLink>);
  assert.equal(screen.queryByRole("link"), null);
  assert.ok(screen.getByText("坏链接"));
});
