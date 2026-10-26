import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MENU_OPERATIONS,
  PLATFORM_ACTIONS,
  PLATFORM_MENUS,
  PLATFORM_ROLES,
  SUPER_ADMIN_ONLY_GRANTS,
  UNRESTRICTED_SCOPE,
  actionsOfGrants,
  allMenuGrants,
  grantCan,
  grantsOfActions,
  isMenuGrant,
  platformPermissions,
  platformRoleCan,
  resolvePlatformGrant,
  roleGrantIssues,
  scopeAllowsChannel,
  scopeAllowsCity,
  scopeIsRestricted,
} from "./access.ts";

test("菜单 × 操作：每个接口操作都落在某一格里；格子的键不重复；操作只有查看 / 编辑 / 审核 / 导出", () => {
  assert.deepEqual(MENU_OPERATIONS.map((op) => op.name), ["查看", "编辑", "审核", "导出"]);
  const covered = new Set<string>(PLATFORM_MENUS.flatMap((menu) => Object.values(menu.operations).flat()));
  assert.deepEqual(PLATFORM_ACTIONS.filter((a) => !covered.has(a)), [], "没有落在任何一格的接口操作");
  assert.equal(new Set(PLATFORM_MENUS.map((m) => m.key)).size, PLATFORM_MENUS.length);
  for (const menu of PLATFORM_MENUS) assert.ok("view" in menu.operations, `${menu.key} 没有「查看」`);
});

test("内置角色换成勾选表再换回来，权限一个不多一个不少（角色页上显示的就是它真实的权限）", () => {
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    assert.deepEqual(actionsOfGrants(grantsOfActions(platformPermissions(key))), [...platformPermissions(key)], key);
  }
  assert.deepEqual(grantsOfActions(platformPermissions("super_admin")), allMenuGrants(), "超级管理员勾满全部格子（含只归它的三项）");
});

test("勾选换成接口操作：去重、按固定顺序；不认识的和只归超级管理员的忽略", () => {
  assert.deepEqual(actionsOfGrants(["channels:view", "channels:edit", "channels:view", "nope:view", "staff:edit", "roles:edit", "roles:review"]), ["channel.read", "channel.manage"]);
  assert.deepEqual(actionsOfGrants(["master_data:edit"]), ["master_data.manage", "fx.manage"]);
  assert.deepEqual(actionsOfGrants([]), []);
});

test("isMenuGrant：只认表里有的格子", () => {
  assert.equal(isMenuGrant("tenants:edit"), true);
  assert.equal(isMenuGrant("products:edit"), false);
  assert.equal(isMenuGrant("tenants"), false);
  assert.equal(isMenuGrant("tenants:view:x"), false);
  assert.equal(isMenuGrant("orders:export"), false, "导出还没有接口");
});

test("自建角色的勾选：编辑 / 审核要带查看；只归超级管理员的四项、不认识的、重复的都拦下", () => {
  assert.deepEqual(roleGrantIssues([]), []);
  assert.deepEqual(roleGrantIssues(["channels:view", "channels:edit", "channels:review", "staff:view", "roles:view", "audit_logs:view"]), []);
  assert.deepEqual(roleGrantIssues(["channels:edit"]), [{ grant: "channels:edit", reason: "VIEW_REQUIRED" }]);
  assert.deepEqual(roleGrantIssues(["staff:view", "staff:edit", "roles:view", "roles:edit", "roles:review"]), [
    { grant: "staff:edit", reason: "SUPER_ADMIN_ONLY" },
    { grant: "roles:edit", reason: "SUPER_ADMIN_ONLY" },
    { grant: "roles:review", reason: "SUPER_ADMIN_ONLY" },
  ]);
  // 第三方密钥（M4-09，ADR 0041）：查看可以给自建角色，填写、更换、清空、测试不行；万一库里存进了这一格，换算时也不给
  assert.deepEqual(roleGrantIssues(["integrations:view", "integrations:edit"]), [{ grant: "integrations:edit", reason: "SUPER_ADMIN_ONLY" }]);
  assert.deepEqual(actionsOfGrants(["integrations:view", "integrations:edit"]), ["integration.read"]);
  assert.ok(platformRoleCan("super_admin", "integration.manage"));
  assert.deepEqual(PLATFORM_ROLES.filter((role) => platformRoleCan(role.key, "integration.manage")).map((role) => role.key), ["super_admin"]);
  assert.deepEqual(roleGrantIssues(["x:view", "orders:view", "orders:view"]), [
    { grant: "x:view", reason: "UNKNOWN_GRANT" },
    { grant: "orders:view", reason: "DUPLICATE" },
  ]);
});

test("权限合并：内置角色以代码为准、不受库里的勾选和数据范围影响；自建角色按勾选和自己的数据范围", () => {
  const scope = { cityIds: ["c1"], channelIds: [] };
  const builtin = resolvePlatformGrant({ key: "finance", builtin: true, grants: ["channels:edit"], scope });
  assert.deepEqual([...builtin.actions], [...platformPermissions("finance")]);
  assert.deepEqual(builtin.scope, UNRESTRICTED_SCOPE);
  for (const action of PLATFORM_ACTIONS) assert.equal(grantCan(builtin, action), platformRoleCan("finance", action), action);
  const custom = resolvePlatformGrant({ key: "custom_x", builtin: false, grants: ["orders:view", "channels:view"], scope });
  assert.deepEqual([...custom.actions], ["channel.read", "order.read"]);
  assert.deepEqual(custom.scope, scope);
  assert.equal(grantCan(custom, "staff.manage"), false);
  assert.equal(resolvePlatformGrant({ key: "not-a-builtin", builtin: true, grants: null, scope }).actions.size, 0, "数据异常时不放大权限");
  assert.equal(resolvePlatformGrant({ key: "custom_y", builtin: false, grants: null, scope }).actions.size, 0);
});

test("角色管理只归超级管理员", () => {
  for (const { key } of PLATFORM_ROLES) {
    for (const action of ["role.read", "role.manage", "role.review"] as const) assert.equal(platformRoleCan(key, action), key === "super_admin", `${key} ${action}`);
  }
});

test("数据范围：null 不限制，数组只放行列出的，空数组一个都不放行", () => {
  assert.equal(scopeAllowsCity(UNRESTRICTED_SCOPE, "c1"), true);
  assert.equal(scopeAllowsChannel(UNRESTRICTED_SCOPE, "ch1"), true);
  assert.equal(scopeIsRestricted(UNRESTRICTED_SCOPE), false);
  const scope = { cityIds: ["c1"], channelIds: [] };
  assert.equal(scopeAllowsCity(scope, "c1"), true);
  assert.equal(scopeAllowsCity(scope, "c2"), false);
  assert.equal(scopeAllowsChannel(scope, "ch1"), false);
  assert.equal(scopeIsRestricted(scope), true);
  assert.equal(scopeIsRestricted({ cityIds: null, channelIds: ["x"] }), true);
});

test("数据范围：编号（UUID）不分大小写——请求里写成大写的也认得", () => {
  const id = "0b9f6c2e-4d1a-4c3b-9a7e-1f2d3c4b5a69";
  const scope = { cityIds: [id], channelIds: [id] };
  assert.equal(scopeAllowsCity(scope, id.toUpperCase()), true);
  assert.equal(scopeAllowsChannel(scope, id.toUpperCase()), true);
  assert.equal(scopeAllowsChannel(scope, "0B9F6C2E-4D1A-4C3B-9A7E-1F2D3C4B5A60"), false);
});
