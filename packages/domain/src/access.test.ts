import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORM_ACTIONS,
  PLATFORM_ROLES,
  TENANT_ACTIONS,
  TENANT_ROLES,
  checkStatusChange,
  isPlatformRole,
  isTenantRole,
  platformPermissions,
  platformRoleCan,
  removesLastKeyRoleHolder,
  tenantPermissions,
  tenantRoleCan,
} from "./access.ts";

test("角色清单与需求文档一致：平台 10 个、租户 5 个，键不重复", () => {
  assert.deepEqual(
    PLATFORM_ROLES.map((role) => role.name),
    ["超级管理员", "运营", "招商", "渠道经理", "客服", "财务", "风控", "主数据运营", "技术", "只读"],
  );
  assert.deepEqual(
    TENANT_ROLES.map((role) => role.name),
    ["管理员", "商品价格", "调度", "财务", "只读"],
  );
  assert.equal(new Set(PLATFORM_ROLES.map((role) => role.key)).size, PLATFORM_ROLES.length);
  assert.equal(new Set(TENANT_ROLES.map((role) => role.key)).size, TENANT_ROLES.length);
});

test("isPlatformRole / isTenantRole 只认清单里的键", () => {
  assert.equal(isPlatformRole("super_admin"), true);
  assert.equal(isPlatformRole("admin"), false);
  assert.equal(isTenantRole("admin"), true);
  assert.equal(isTenantRole("super_admin"), false);
  assert.equal(isTenantRole(""), false);
});

test("超级管理员拥有全部平台操作", () => {
  assert.deepEqual(platformPermissions("super_admin"), PLATFORM_ACTIONS);
  for (const action of PLATFORM_ACTIONS) assert.equal(platformRoleCan("super_admin", action), true);
});

test("平台账号管理和审计日志只有超级管理员能碰", () => {
  for (const { key } of PLATFORM_ROLES) {
    const expected = key === "super_admin";
    assert.equal(platformRoleCan(key, "staff.manage"), expected, key);
    assert.equal(platformRoleCan(key, "staff.read"), expected, key);
    assert.equal(platformRoleCan(key, "audit_log.read"), expected, key);
  }
});

test("租户管理归招商和运营；只读角色只能看；技术只能看集成状态", () => {
  for (const role of ["operations", "tenant_onboarding"] as const) {
    assert.deepEqual(platformPermissions(role), ["tenant.read", "tenant.create", "tenant.change_status", "master_data.read"]);
  }
  assert.deepEqual(platformPermissions("readonly"), ["tenant.read", "master_data.read"]);
  assert.deepEqual(platformPermissions("tech"), ["integration.read", "master_data.read"]);
  assert.equal(platformRoleCan("readonly", "tenant.create"), false);
  assert.equal(platformRoleCan("operations", "integration.read"), false);
  for (const role of ["channel_manager", "customer_service", "finance", "risk"] as const) {
    assert.deepEqual(platformPermissions(role), ["master_data.read"]);
  }
});

test("主数据：每个平台角色都能看，只有主数据运营和超级管理员能改；租户每个角色都能看，没有「改主数据」这个操作", () => {
  for (const { key } of PLATFORM_ROLES) {
    assert.equal(platformRoleCan(key, "master_data.read"), true, key);
    assert.equal(platformRoleCan(key, "master_data.manage"), key === "master_data" || key === "super_admin", key);
  }
  assert.deepEqual(platformPermissions("master_data"), ["master_data.read", "master_data.manage"]);
  for (const { key } of TENANT_ROLES) assert.equal(tenantRoleCan(key, "master_data.read"), true, key);
  assert.ok(!(TENANT_ACTIONS as readonly string[]).some((action) => action.startsWith("master_data.") && action !== "master_data.read"));
});

test("租户：操作日志只有管理员能看", () => {
  for (const { key } of TENANT_ROLES) assert.equal(tenantRoleCan(key, "audit_log.read"), key === "admin", key);
  assert.deepEqual(tenantPermissions("readonly"), ["user.read", "master_data.read", "area.read", "product.read"]);
});

test("租户：账号管理只归管理员，只读角色只能看账号列表，其他角色都不行", () => {
  assert.deepEqual(tenantPermissions("admin"), TENANT_ACTIONS);
  assert.equal(tenantRoleCan("admin", "user.manage"), true);
  assert.equal(tenantRoleCan("readonly", "user.read"), true);
  assert.equal(tenantRoleCan("readonly", "user.manage"), false);
  for (const role of ["pricing", "dispatch", "finance"] as const) {
    assert.deepEqual(tenantPermissions(role), role === "pricing" ? ["master_data.read", "area.read", "area.manage", "product.read", "product.manage"] : ["master_data.read"]);
    assert.equal(tenantRoleCan(role, "user.read"), false);
  }
});

test("至少保留一个管理员：唯一在用的管理员不能被降级或停用", () => {
  const admin = { role: "admin", status: "active" } as const;
  assert.equal(removesLastKeyRoleHolder("admin", 1, admin, { role: "readonly", status: "active" }), true);
  assert.equal(removesLastKeyRoleHolder("admin", 1, admin, { role: "admin", status: "disabled" }), true);
});

test("至少保留一个管理员：还有别的管理员、或改动不影响管理员身份时放行", () => {
  const admin = { role: "admin", status: "active" } as const;
  assert.equal(removesLastKeyRoleHolder("admin", 2, admin, { role: "readonly", status: "active" }), false);
  assert.equal(removesLastKeyRoleHolder("admin", 1, admin, { role: "admin", status: "active" }), false);
  // 目标不是在用的管理员：怎么改都不会减少管理员
  assert.equal(
    removesLastKeyRoleHolder("admin", 1, { role: "dispatch", status: "active" }, { role: "dispatch", status: "disabled" }),
    false,
  );
  assert.equal(
    removesLastKeyRoleHolder("admin", 0, { role: "admin", status: "invited" }, { role: "admin", status: "disabled" }),
    false,
  );
  assert.equal(
    removesLastKeyRoleHolder("admin", 1, { role: "admin", status: "disabled" }, { role: "readonly", status: "disabled" }),
    false,
  );
});

test("账号状态变更：不能手工改成待激活；没激活过的账号不能手工启用；其余允许", () => {
  assert.equal(checkStatusChange("active", true, "active"), null);
  assert.equal(checkStatusChange("invited", false, "invited"), null);
  assert.equal(checkStatusChange("active", true, "disabled"), null);
  assert.equal(checkStatusChange("disabled", true, "active"), null);
  assert.equal(checkStatusChange("invited", false, "disabled"), null);
  assert.equal(checkStatusChange("active", true, "invited"), "STATUS_INVITED_IS_NOT_SETTABLE");
  assert.equal(checkStatusChange("disabled", false, "invited"), "STATUS_INVITED_IS_NOT_SETTABLE");
  assert.equal(checkStatusChange("invited", false, "active"), "ACCOUNT_NOT_ACTIVATED");
  assert.equal(checkStatusChange("disabled", false, "active"), "ACCOUNT_NOT_ACTIVATED");
});

test("区域：管理员和商品价格能改，只读能看不能改，调度和财务都不能", () => {
  const expected: Record<string, [boolean, boolean]> = { admin: [true, true], pricing: [true, true], dispatch: [false, false], finance: [false, false], readonly: [true, false] };
  for (const { key } of TENANT_ROLES) {
    assert.deepEqual([tenantRoleCan(key, "area.read"), tenantRoleCan(key, "area.manage")], expected[key], key);
  }
});

test("商品：管理员和商品价格能改，只读能看不能改，调度和财务都不能；子品牌只有管理员能建", () => {
  const expected: Record<string, [boolean, boolean, boolean]> = {
    admin: [true, true, true], pricing: [true, true, false], dispatch: [false, false, false], finance: [false, false, false], readonly: [true, false, false],
  };
  for (const { key } of TENANT_ROLES) {
    assert.deepEqual([tenantRoleCan(key, "product.read"), tenantRoleCan(key, "product.manage"), tenantRoleCan(key, "brand.manage")], expected[key], key);
  }
});
