/**
 * 菜单的可见条件和页面自己的查看条件完全一致（M4-10）：菜单里出现的每一项，点进去都不能是「你没有权限查看这里」；看得了的页面菜单里都有入口。
 * 页面的查看条件 = 角色给了下面两张表里的查看权限，且（运营后台）没有被数据范围挡住：
 * 财务结算各页限定了任一维度的数据范围就看不了（ADR 0040，接口一律 403 `DATA_SCOPE_DENIED`）；其余页面限定了范围照常进得去，只是列表只列范围内的（ADR 0030）。
 * 首页的入口卡片同理（卡片点进去都看得了）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { type PlatformAction, type PlatformDataScope, PLATFORM_ROLES, TENANT_ROLES, type TenantAction, UNRESTRICTED_SCOPE, actionsOfGrants, allMenuGrants, platformPermissions, tenantRoleCan } from "@nozomi/domain";
import { PLATFORM_HOME_CARD_PAGES, platformHomeAccess } from "../pages/PlatformHomePage.tsx";
import { platformAccountCan } from "../lib/use-master-access.ts";
import { type NavEntry, type NavLeaf, navEntries } from "./AppShell.tsx";

const PLATFORM_PAGE_VIEW: Readonly<Record<string, PlatformAction>> = {
  "/platform/tenants": "tenant.read",
  "/platform/tenant-documents": "tenant.read",
  "/platform/products": "product.read",
  "/platform/quote-preview": "quote.preview",
  "/platform/channels": "channel.read",
  "/platform/approvals": "approval.read",
  "/platform/orders": "order.read",
  "/platform/exceptions": "order.read",
  "/platform/tickets": "ticket.read",
  "/platform/rescues": "order.read",
  "/platform/cancellation-policy": "master_data.read",
  "/platform/compensation-table": "master_data.read",
  "/platform/webhook-deliveries": "order.read",
  "/platform/finance/statements": "statement.read",
  "/platform/finance/payout-batches": "statement.read",
  "/platform/master/cities": "master_data.read",
  "/platform/master/places": "master_data.read",
  "/platform/master/vehicle-groups": "master_data.read",
  "/platform/master/addons": "master_data.read",
  "/platform/master/fx-rates": "master_data.read",
  "/platform/settings/staff": "staff.read",
  "/platform/settings/roles": "role.read",
  "/platform/settings/audit-logs": "audit_log.read",
  "/platform/settings/integrations": "integration.read",
};

/** 限定了数据范围（城市或渠道任一维度）就看不了的页面（ADR 0040：财务结算的接口一律 403）。 */
const UNSCOPED_ONLY_PAGES: ReadonlySet<string> = new Set(["/platform/finance/statements", "/platform/finance/payout-batches"]);

/** 遍历的数据范围：不限、限城市、限渠道，外加两个维度都限、限成空（一个都不看）。编号只在测试里构造。 */
const SCOPES: readonly { name: string; scope: PlatformDataScope }[] = [
  { name: "不限数据范围", scope: UNRESTRICTED_SCOPE },
  { name: "限城市", scope: { cityIds: ["c0c0c0c0-0000-4000-8000-000000000001"], channelIds: null } },
  { name: "限渠道", scope: { cityIds: null, channelIds: ["c4c4c4c4-0000-4000-8000-000000000002"] } },
  { name: "城市和渠道都限", scope: { cityIds: ["c0c0c0c0-0000-4000-8000-000000000001"], channelIds: ["c4c4c4c4-0000-4000-8000-000000000002"] } },
  { name: "限成一个城市都不看", scope: { cityIds: [], channelIds: null } },
];

const TENANT_PAGE_VIEW: Readonly<Record<string, TenantAction>> = {
  "/areas": "area.read",
  "/products": "product.read",
  "/price-rules": "product.read",
  "/orders": "order.read",
  "/rescue-offers": "order.dispatch",
  "/deductions": "order.read",
  "/tickets": "ticket.read",
  "/statements": "statement.read",
  "/fleet/drivers": "fleet.read",
  "/fleet/vehicles": "fleet.read",
  "/company": "company.read",
  "/performance": "performance.read",
  "/settings/webhook": "webhook.read",
};

function leaves(entries: readonly NavEntry[]): NavLeaf[] {
  return entries.flatMap((entry) => ("children" in entry ? [...entry.children] : [entry]));
}

/** 自建角色的账号（内置角色不限数据范围，见下面单独的用例）：和 AppShell 用同一个 `platformAccountCan` 判断。 */
function accountCan(actions: ReadonlySet<PlatformAction>, scope: PlatformDataScope): (action: PlatformAction) => boolean {
  const account = { role: "custom_test", permissions: [...actions], dataScope: scope };
  return (action) => platformAccountCan(account, action);
}

function platformMenu(can: (action: PlatformAction) => boolean): NavLeaf[] {
  return leaves(navEntries("platform", "/platform", "custom_test", can)).filter((leaf) => leaf.to !== "/platform");
}

/** 页面自己的查看条件：角色给了查看权限，且没有被数据范围挡住。 */
function pageViewable(path: string, granted: (action: PlatformAction) => boolean, scope: PlatformDataScope): boolean {
  const needed = PLATFORM_PAGE_VIEW[path];
  if (needed === undefined || !granted(needed)) return false;
  return !(UNSCOPED_ONLY_PAGES.has(path) && (scope.cityIds !== null || scope.channelIds !== null));
}

/** 菜单和页面对不上的地方：菜单里有却看不了的、看得了却没有入口的；首页卡片点进去看不了的。 */
function mismatches(granted: (action: PlatformAction) => boolean, scope: PlatformDataScope, can: (action: PlatformAction) => boolean): string[] {
  const menu = platformMenu(can);
  const unviewable = menu.filter((leaf) => !pageViewable(leaf.to, granted, scope)).map((leaf) => `菜单里有却看不了：${leaf.label}（${leaf.to}）`);
  const hidden = Object.keys(PLATFORM_PAGE_VIEW)
    .filter((path) => pageViewable(path, granted, scope) && !menu.some((leaf) => leaf.to === path))
    .map((path) => `看得了却没有入口：${path}`);
  const access = platformHomeAccess(can);
  const cards = (Object.keys(PLATFORM_HOME_CARD_PAGES) as (keyof typeof PLATFORM_HOME_CARD_PAGES)[])
    .filter((key) => access[key])
    .flatMap((key) => PLATFORM_HOME_CARD_PAGES[key].filter((path) => !pageViewable(path.split("?")[0] ?? path, granted, scope)).map((path) => `首页卡片点进去看不了：${path}`));
  return [...unviewable, ...hidden, ...cards];
}

test("运营后台菜单：每一项都登记了页面的查看权限（新加菜单项要在这里登记）；首页卡片指向的页面也都登记了", () => {
  const all = platformMenu(() => true);
  assert.deepEqual(all.map((leaf) => leaf.to).filter((to) => PLATFORM_PAGE_VIEW[to] === undefined), []);
  assert.deepEqual(Object.keys(PLATFORM_PAGE_VIEW).filter((to) => !all.some((leaf) => leaf.to === to)), [], "表里登记的页面超级管理员都看得到");
  const cardPages = Object.values(PLATFORM_HOME_CARD_PAGES).flat().map((path) => path.split("?")[0] ?? path);
  assert.deepEqual(cardPages.filter((path) => PLATFORM_PAGE_VIEW[path] === undefined), []);
  for (const path of UNSCOPED_ONLY_PAGES) assert.ok(PLATFORM_PAGE_VIEW[path] !== undefined, path);
});

test("运营后台菜单：菜单条件用到的权限的所有组合 × 数据范围（不限 / 限城市 / 限渠道…）下，菜单里每一项都看得了，看得了的都有入口，首页卡片点进去都看得了", () => {
  // 菜单条件里会用到的权限：各页面的查看权限，加上取消政策、赔付表的发起 / 审核权限（看它们会不会被误当成查看条件）
  const relevant = [...new Set<PlatformAction>([...Object.values(PLATFORM_PAGE_VIEW), "cancellation_policy.manage", "cancellation_policy.review", "compensation_table.manage", "compensation_table.review"])];
  assert.ok(relevant.length <= 17, "组合数不超过 131,072");
  for (let mask = 0; mask < 1 << relevant.length; mask += 1) {
    const actions = new Set(relevant.filter((_, index) => (mask & (1 << index)) !== 0));
    for (const { name, scope } of SCOPES) {
      const bad = mismatches((action) => actions.has(action), scope, accountCan(actions, scope));
      if (bad.length > 0) assert.fail(`权限 ${[...actions].join("、") || "（无）"}、${name} 时：${bad.join("、")}`);
    }
  }
});

test("运营后台菜单：内置角色（不限数据范围）、每一项勾选和任意两项勾选的自建角色 × 数据范围，菜单和页面一致", () => {
  for (const role of PLATFORM_ROLES) {
    const can = (action: PlatformAction) => platformAccountCan({ role: role.key, permissions: [], dataScope: UNRESTRICTED_SCOPE }, action);
    const granted = new Set(platformPermissions(role.key));
    assert.deepEqual(mismatches((action) => granted.has(action), UNRESTRICTED_SCOPE, can), [], role.name);
  }
  const grants = allMenuGrants();
  for (const { name, scope } of SCOPES) {
    for (const first of grants) {
      for (const second of grants) {
        const actions = new Set(actionsOfGrants([first, second]));
        assert.deepEqual(mismatches((action) => actions.has(action), scope, accountCan(actions, scope)), [], `${first} + ${second}，${name}`);
      }
    }
  }
});

test("验收报告 M4-10 第 2 条的角色（供应商审核、渠道审核、订单查看、待审核、财务结算查看）：限定了城市和渠道时菜单里没有账单、付款批次，首页也没有财务结算；不限时都有", () => {
  const actions = new Set(actionsOfGrants(["tenants:view", "tenants:review", "channels:view", "channels:review", "orders:view", "approvals:view", "finance:view"]));
  const scoped = SCOPES[3]?.scope ?? UNRESTRICTED_SCOPE;
  const scopedLabels = platformMenu(accountCan(actions, scoped)).map((leaf) => leaf.label);
  assert.ok(!scopedLabels.includes("账单") && !scopedLabels.includes("付款批次"), scopedLabels.join("、"));
  assert.ok(scopedLabels.includes("订单") && scopedLabels.includes("渠道"));
  assert.equal(platformHomeAccess(accountCan(actions, scoped)).statements, false);
  for (const { scope } of SCOPES.slice(1)) assert.ok(!platformMenu(accountCan(actions, scope)).some((leaf) => leaf.to.startsWith("/platform/finance/")));
  const openLabels = platformMenu(accountCan(actions, UNRESTRICTED_SCOPE)).map((leaf) => leaf.label);
  assert.ok(openLabels.includes("账单") && openLabels.includes("付款批次"));
  assert.equal(platformHomeAccess(accountCan(actions, UNRESTRICTED_SCOPE)).statements, true);
});

test("首页：只勾了「工单 · 查看」的自建角色没有赔付表卡片（赔付表页面要看主数据的权限）；勾了赔付表的查看就有", () => {
  assert.equal(platformHomeAccess(accountCan(new Set(actionsOfGrants(["tickets:view"])), UNRESTRICTED_SCOPE)).compensation, false);
  assert.equal(platformHomeAccess(accountCan(new Set(actionsOfGrants(["tickets:view", "compensation_table:view"])), UNRESTRICTED_SCOPE)).compensation, true);
});

test("运营后台菜单：只勾了「订单 · 查看」的自建角色看不到「取消政策」；能看主数据的（勾了取消政策、赔付表或主数据的查看）都看得到", () => {
  const labels = (grants: string[]) => platformMenu(accountCan(new Set(actionsOfGrants(grants)), UNRESTRICTED_SCOPE)).map((leaf) => leaf.label);
  assert.ok(!labels(["orders:view"]).includes("取消政策"));
  assert.ok(labels(["orders:view"]).includes("订单"));
  assert.ok(labels(["orders:view", "cancellation_policy:view"]).includes("取消政策"));
  assert.ok(labels(["cancellation_policy:view", "cancellation_policy:review"]).includes("取消政策"));
  assert.ok(labels(["cancellation_policy:view", "cancellation_policy:edit"]).includes("取消政策"));
  assert.ok(labels(["master_data:view"]).includes("取消政策"), "菜单和页面的条件一致：看得了主数据就看得了取消政策，菜单里就有入口");
  assert.ok(labels(["cancellation_policy:view"]).includes("取消政策"));
  assert.ok(labels(["compensation_table:view"]).includes("赔付表"));
  assert.ok(!labels(["tickets:view"]).includes("赔付表"), "只勾了「工单 · 查看」没有主数据查看：赔付表页面看不了，菜单不放");
  assert.ok(labels(["tickets:view", "compensation_table:view"]).includes("赔付表"));
});

test("供应商后台菜单：每个角色的菜单里都没有点进去没权限的项，每一项都登记了页面的查看权限", () => {
  for (const role of TENANT_ROLES) {
    const menu = leaves(navEntries("tenant", "/", role.key, () => false)).filter((leaf) => leaf.to !== "/");
    const bad = menu.filter((leaf) => {
      const needed = TENANT_PAGE_VIEW[leaf.to];
      return needed === undefined || !tenantRoleCan(role.key, needed);
    });
    assert.deepEqual(bad.map((leaf) => leaf.to), [], role.name);
  }
});
