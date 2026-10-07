import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, TENANT_ROLES } from "@nozomi/domain";
import { API_PATH_PREFIXES, isApiPath } from "./api-prefixes.ts";
import { PORTALS, portalOfPath, roleName, safeReturnPath } from "./portal.ts";

test("前端路由不占用归 API 的路径前缀", () => {
  for (const portal of Object.values(PORTALS)) {
    for (const [name, path] of Object.entries(portal.paths)) {
      assert.equal(isApiPath(path), false, `${portal.key}.${name} = ${path} 落在 API 前缀下`);
    }
  }
  assert.ok(API_PATH_PREFIXES.includes("/platform/v1"));
  assert.equal(isApiPath("/platform/v1/auth/login"), true);
  assert.equal(isApiPath("/platform/login"), false);
  assert.equal(isApiPath("/healthy"), false);
});

test("两个后台的路径互不重复，接口前缀各自对应", () => {
  const all = Object.values(PORTALS).flatMap((portal) => Object.values(portal.paths));
  assert.equal(new Set(all).size, all.length);
  assert.equal(PORTALS.tenant.apiBase, "/tenant/v1");
  assert.equal(PORTALS.platform.apiBase, "/platform/v1");
  assert.equal(PORTALS.tenant.switchTo.portal, "platform");
  assert.equal(PORTALS.platform.switchTo.portal, "tenant");
});

test("路径属于哪个后台", () => {
  assert.equal(portalOfPath("/"), "tenant");
  assert.equal(portalOfPath("/account/password"), "tenant");
  assert.equal(portalOfPath("/platform"), "platform");
  assert.equal(portalOfPath("/platform/account/password"), "platform");
  assert.equal(portalOfPath("/platformx"), "tenant");
});

test("登录后的回跳地址只接受本后台内的站内路径", () => {
  assert.equal(safeReturnPath("tenant", "/account/password"), "/account/password");
  assert.equal(safeReturnPath("platform", "/platform/account/password?x=1"), "/platform/account/password?x=1");
  for (const bad of [undefined, null, 42, "", "https://evil.example/", "//evil.example", "/\\evil.example", "account"]) {
    assert.equal(safeReturnPath("tenant", bad), "/");
  }
  assert.equal(safeReturnPath("tenant", "/platform"), "/", "另一个后台的页面不回跳");
  assert.equal(safeReturnPath("platform", "/account/password"), "/platform");
  assert.equal(safeReturnPath("tenant", "/login"), "/", "不回跳到登录页本身");
  assert.equal(safeReturnPath("platform", "/platform/accept-invite"), "/platform");
});

test("角色名取自 domain 的角色清单，未知角色返回 null", () => {
  for (const role of TENANT_ROLES) assert.equal(roleName("tenant", role.key), role.name);
  for (const role of PLATFORM_ROLES) assert.equal(roleName("platform", role.key), role.name);
  assert.equal(roleName("tenant", "super_admin"), null);
});
