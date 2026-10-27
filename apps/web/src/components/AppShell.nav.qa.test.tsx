/**
 * M4-10 测试角色：菜单与页面权限的反方向——看得了的页面，菜单里都要有入口（没有被藏掉的）；数据范围也算进去（ADR 0040：财务结算限定了范围就看不了）。
 * 正方向（菜单里每一项点进去都看得了）见 AppShell.nav.test.tsx；这里另外核对「页面要的查看权限」那张表本身是不是和页面代码一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLATFORM_MENUS, type PlatformAction, type PlatformDataScope, UNRESTRICTED_SCOPE, actionsOfGrants, allMenuGrants } from "@nozomi/domain";
import { platformAccountCan } from "../lib/use-master-access.ts";
import { type NavEntry, type NavLeaf, navEntries } from "./AppShell.tsx";

function leaves(entries: readonly NavEntry[]): NavLeaf[] {
  return entries.flatMap((entry) => ("children" in entry ? [...entry.children] : [entry]));
}

/** 不限、限城市、限渠道（编号只在测试里构造）。 */
const SCOPES: readonly { name: string; scope: PlatformDataScope }[] = [
  { name: "不限数据范围", scope: UNRESTRICTED_SCOPE },
  { name: "限城市", scope: { cityIds: ["c0c0c0c0-0000-4000-8000-0000000000aa"], channelIds: null } },
  { name: "限渠道", scope: { cityIds: null, channelIds: ["c4c4c4c4-0000-4000-8000-0000000000bb"] } },
];

/** 限定了数据范围就看不了的菜单（ADR 0040）：勾了「查看」、限定了范围时，它的页面不该在菜单里。 */
const UNSCOPED_ONLY_MENUS: ReadonlySet<string> = new Set(["finance"]);

function menuOf(grants: readonly string[], scope: PlatformDataScope = UNRESTRICTED_SCOPE): string[] {
  const account = { role: "custom_test", permissions: actionsOfGrants(grants), dataScope: scope };
  return leaves(navEntries("platform", "/platform", "custom_test", (action) => platformAccountCan(account, action))).map((leaf) => leaf.to);
}

const restricted = (scope: PlatformDataScope): boolean => scope.cityIds !== null || scope.channelIds !== null;

/** 角色页上每个「菜单」对应的页面（勾了这个菜单的「查看」，就该在左侧菜单里看到这些页面）。 */
const MENU_PAGES: Readonly<Record<string, readonly string[]>> = {
  tenants: ["/platform/tenants", "/platform/tenant-documents"],
  products: ["/platform/products"],
  quote_preview: ["/platform/quote-preview"],
  channels: ["/platform/channels"],
  orders: ["/platform/orders", "/platform/webhook-deliveries"],
  exceptions: ["/platform/exceptions"],
  rescues: ["/platform/rescues"],
  cancellation_policy: ["/platform/cancellation-policy"],
  tickets: ["/platform/tickets"],
  compensation_table: ["/platform/compensation-table"],
  approvals: ["/platform/approvals"],
  finance: ["/platform/finance/statements", "/platform/finance/payout-batches"],
  master_data: ["/platform/master/cities", "/platform/master/places", "/platform/master/vehicle-groups", "/platform/master/addons", "/platform/master/fx-rates"],
  staff: ["/platform/settings/staff"],
  roles: ["/platform/settings/roles"],
  audit_logs: ["/platform/settings/audit-logs"],
  integrations: ["/platform/settings/integrations"],
};

test("角色页的每个菜单都登记了对应页面（新加菜单要在这里登记）", () => {
  assert.deepEqual(PLATFORM_MENUS.map((menu) => menu.key).filter((key) => MENU_PAGES[key] === undefined), []);
});

test("自建角色只勾某个菜单的「查看」× 数据范围：看得了的页面菜单里都有（看得了却没有入口 = 被藏掉）；财务结算限定了范围时不在菜单里", () => {
  const wrong: string[] = [];
  for (const { name, scope } of SCOPES) {
    for (const menu of PLATFORM_MENUS) {
      const shown = menuOf([`${menu.key}:view`], scope);
      const expected = !(UNSCOPED_ONLY_MENUS.has(menu.key) && restricted(scope));
      for (const page of MENU_PAGES[menu.key] ?? []) if (shown.includes(page) !== expected) wrong.push(`只勾「${menu.name} · 查看」、${name}：菜单里${expected ? "没有" : "却有"} ${page}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("自建角色勾了某个菜单的「查看」，再加任何一格别的勾选 × 数据范围：这个菜单的页面在不在菜单里只取决于数据范围（财务结算），不受别的勾选影响", () => {
  const grants = allMenuGrants();
  const wrong = new Set<string>();
  for (const { name, scope } of SCOPES) {
    for (const menu of PLATFORM_MENUS) {
      const expected = !(UNSCOPED_ONLY_MENUS.has(menu.key) && restricted(scope));
      for (const other of grants) {
        const shown = menuOf([`${menu.key}:view`, other], scope);
        for (const page of MENU_PAGES[menu.key] ?? []) if (shown.includes(page) !== expected) wrong.add(`「${menu.name} · 查看」+ ${other}、${name}：${page}`);
      }
    }
  }
  assert.deepEqual([...wrong], []);
});

/** 页面文件里检查的查看权限（`usePlatformCan("xxx.read")` 那一行的 canRead）。 */
const PAGE_GUARDS: readonly [string, string, PlatformAction][] = [
  ["/platform/cancellation-policy", "../pages/platform/CancellationPolicyPage.tsx", "master_data.read"],
  ["/platform/compensation-table", "../pages/platform/CompensationTablePage.tsx", "master_data.read"],
  ["/platform/rescues", "../pages/platform/RescuePages.tsx", "order.read"],
  ["/platform/exceptions", "../pages/platform/ExceptionPages.tsx", "order.read"],
  ["/platform/webhook-deliveries", "../pages/webhooks/WebhookPages.tsx", "order.read"],
  ["/platform/tenant-documents", "../pages/platform/DocumentQueuePage.tsx", "tenant.read"],
  ["/platform/tickets", "../pages/platform/TicketPages.tsx", "ticket.read"],
  ["/platform/finance/statements", "../pages/platform/FinancePages.tsx", "statement.read"],
];

test("页面代码里检查的查看权限，和菜单权限表（AppShell.nav.test.tsx）登记的一致；除了「主数据运营不放取消政策、赔付表」这条有意的例外，只有这项权限时菜单里就有这个页面", () => {
  for (const [path, file, action] of PAGE_GUARDS) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    assert.match(source, new RegExp(`canRead = usePlatformCan\\("${action.replace(".", "\\.")}"\\)`), `${file} 检查的是 ${action}`);
    if (action === "master_data.read") continue;
    const shown = leaves(navEntries("platform", "/platform", "custom_test", (candidate) => candidate === action)).map((leaf) => leaf.to);
    assert.ok(shown.includes(path), `只有 ${action} 时 ${path} 页面看得了，菜单里却没有`);
  }
});

test("财务结算页面：查看条件和菜单用同一个判断（含数据范围），被数据范围挡住时说明原因，而不是先发请求再收 403", () => {
  const source = readFileSync(fileURLToPath(new URL("../pages/platform/FinancePages.tsx", import.meta.url)), "utf8");
  const pages = source.match(/canRead = usePlatformCan\("statement\.read"\)/g) ?? [];
  const scopeChecks = source.match(/scopeBlocked = usePlatformScopeBlocks\("statement\.read"\)/g) ?? [];
  assert.equal(pages.length, 4, "账单列表、账单详情、付款批次列表、付款批次详情");
  assert.equal(scopeChecks.length, pages.length, "四个页面都分辨「被数据范围挡住」");
  for (const { name, scope } of SCOPES) {
    const can = platformAccountCan({ role: "custom_test", permissions: ["statement.read"], dataScope: scope }, "statement.read");
    assert.equal(can, !restricted(scope), name);
  }
});
