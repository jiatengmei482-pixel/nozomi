import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATFORM_MENUS, roleGrantIssues } from "@nozomi/domain";
import { allowlistProblems, permissionMatrix, splitAllowlist, toggleGrant } from "./role-form.ts";

test("勾选表：每个菜单一行、四列；没有的格子标出来；只归超级管理员的三格标出来", () => {
  const rows = permissionMatrix();
  assert.equal(rows.length, PLATFORM_MENUS.length);
  const products = rows.find((row) => row.key === "products");
  assert.equal(products?.cells.view.exists, true);
  assert.equal(products?.cells.edit.exists, false);
  assert.equal(products?.cells.review.exists, false);
  assert.equal(products?.cells.export.exists, false);
  assert.equal(rows.find((row) => row.key === "tenants")?.cells.review.exists, true, "供应商的复核（M4-01）");
  const locked = rows.flatMap((row) => Object.values(row.cells)).filter((cell) => cell.superAdminOnly).map((cell) => cell.grant);
  assert.deepEqual(locked.sort(), ["roles:edit", "roles:review", "staff:edit"]);
});

test("勾编辑自动带上查看；去掉查看同一菜单的其他格一起去掉；结果总是后端认的（没有 VIEW_REQUIRED）", () => {
  let grants = toggleGrant([], "channels:review", true);
  assert.deepEqual(grants, ["channels:view", "channels:review"]);
  grants = toggleGrant(grants, "orders:view", true);
  grants = toggleGrant(grants, "channels:edit", true);
  assert.deepEqual(grants, ["channels:view", "channels:edit", "channels:review", "orders:view"]);
  assert.deepEqual(roleGrantIssues(grants), []);
  grants = toggleGrant(grants, "channels:view", false);
  assert.deepEqual(grants, ["orders:view"]);
  assert.deepEqual(toggleGrant(grants, "orders:view", false), []);
});

test("IP 白名单的文本框：一行一个，逗号、空格也行；逐条指出写错的", () => {
  assert.deepEqual(splitAllowlist(" 10.0.0.0/8\n\n203.0.113.5, 2001:db8::/32 "), ["10.0.0.0/8", "203.0.113.5", "2001:db8::/32"]);
  assert.deepEqual(allowlistProblems("10.0.0.0/8\n203.0.113.5"), []);
  assert.deepEqual(allowlistProblems("10.1.2.3/8\nhello\n10.0.0.0/8"), ["第 1 条「10.1.2.3/8」地址段写得不对，应写成 10.0.0.0/8", "第 2 条「hello」不是合法的 IP 地址或地址段"]);
  assert.deepEqual(allowlistProblems("10.0.0.0/8 10.0.0.0/8"), ["第 2 条「10.0.0.0/8」和前面的重复了"]);
  assert.deepEqual(allowlistProblems(""), []);
});
