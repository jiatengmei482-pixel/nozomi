/**
 * 数据范围挡住的操作（M4-10）：后端对「限定了数据范围」的员工一律 403 `DATA_SCOPE_DENIED` 的地方，和前端隐藏入口的清单（`SCOPE_DENIED_OPERATIONS`）一一对应。
 * 扫描后端路由源码里每一处 `dataScopeDenied()`：在哪个接口（或公共鉴权函数）、按哪个维度挡；前端少登记一处就会出现「显示了却必然 403」的按钮。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type PlatformAction, type PlatformDataScope, UNRESTRICTED_SCOPE } from "@nozomi/domain";
import { ACTION_SCOPE_OPERATIONS, SCOPE_DENIED_OPERATIONS, type ScopeDeniedOperation, platformAccountCan, scopeDenies } from "./use-master-access.ts";

const API_SRC = new URL("../../../api/src/", import.meta.url);
const read = (relative: string, base: URL = API_SRC): string => readFileSync(fileURLToPath(new URL(relative, base)), "utf8");

/** 后端每一处 `dataScopeDenied()` 对应前端清单里的哪个操作。 */
const BACKEND_SITES: Readonly<Record<string, ScopeDeniedOperation>> = {
  "routes/billing.ts platform()": "finance",
  "routes/channels.ts POST /platform/v1/channels": "channel.create",
  "routes/rescues.ts POST /platform/v1/tenants/:id/rescue": "tenant.rescue",
};

/** 前端在哪个页面按这个操作隐藏按钮（财务结算整个菜单走 `ACTION_SCOPE_OPERATIONS`，见 AppShell.nav.test.tsx）。 */
const FRONTEND_USES: Readonly<Record<Exclude<ScopeDeniedOperation, "finance">, string>> = {
  "channel.create": "../pages/platform/ChannelPages.tsx",
  "tenant.rescue": "../pages/platform/RescuePages.tsx",
};

interface Site {
  key: string;
  dimension: "any" | "city" | "channel" | "unknown";
}

function scanBackend(): Site[] {
  const sites: Site[] = [];
  for (const dir of ["routes", "services"]) {
    for (const name of readdirSync(fileURLToPath(new URL(`${dir}/`, API_SRC)))) {
      if (!name.endsWith(".ts") || name.includes(".test.") || name.includes(".itest.") || name === "errors.ts") continue;
      const lines = read(`${dir}/${name}`).split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("dataScopeDenied()")) return;
        let key = `${dir}/${name} 第 ${index + 1} 行（认不出在哪个接口）`;
        for (let back = index; back >= 0; back -= 1) {
          const route = /app\.(get|post|put|patch|delete)\("([^"]+)"/.exec(lines[back] ?? "");
          if (route) {
            key = `${dir}/${name} ${route[1]?.toUpperCase()} ${route[2]}`;
            break;
          }
          const helper = /const (\w+) = async/.exec(lines[back] ?? "");
          if (helper) {
            key = `${dir}/${name} ${helper[1]}()`;
            break;
          }
        }
        const dimension = line.includes("scopeIsRestricted(") ? "any" : /channelIds !== null/.test(line) ? "channel" : /cityIds !== null/.test(line) ? "city" : "unknown";
        sites.push({ key, dimension });
      });
    }
  }
  return sites;
}

test("后端每一处因数据范围 403 的地方，前端都登记了同一个操作、同一个维度；前端登记的每一项后端都确实会 403", () => {
  const sites = scanBackend();
  assert.deepEqual(sites.map((site) => site.key).sort(), Object.keys(BACKEND_SITES).sort(), "后端新加或去掉了一处 dataScopeDenied()：同步 SCOPE_DENIED_OPERATIONS 和这里的对应表");
  for (const site of sites) {
    const operation = BACKEND_SITES[site.key];
    assert.ok(operation !== undefined, site.key);
    assert.equal(site.dimension, SCOPE_DENIED_OPERATIONS[operation], `${site.key} 按 ${site.dimension} 挡，前端登记的是 ${SCOPE_DENIED_OPERATIONS[operation]}`);
  }
  assert.deepEqual([...new Set(Object.values(BACKEND_SITES))].sort(), (Object.keys(SCOPE_DENIED_OPERATIONS) as ScopeDeniedOperation[]).sort(), "前端清单里没有多余的项");
});

test("财务结算：后端每个运营后台的财务接口都经过那个公共鉴权（限定了范围就 403），用到的权限和付款复核的审核权限，前端都按「被数据范围挡住」处理", () => {
  const source = read("routes/billing.ts");
  assert.equal((source.match(/authenticatePlatform\(/g) ?? []).length, 1, "只有公共鉴权函数里直接鉴权，财务接口都走它");
  const actions = [...new Set([...source.matchAll(/platform\(request, "([a-z_.]+)"\)/g)].map((match) => match[1] as PlatformAction))];
  assert.ok(actions.length > 0);
  for (const action of actions) assert.equal(ACTION_SCOPE_OPERATIONS[action], "finance", action);
  // 审核付款（statement.review）不在财务接口里，在待审核里：这一类复核标了 unscopedOnly，限定了范围的人看不到、审不了
  const services = read("services/billing.ts");
  const unscopedReview = /reviewAction: "([a-z_.]+)",[^}]*?unscopedOnly: true/s.exec(services)?.[1];
  for (const [action, operation] of Object.entries(ACTION_SCOPE_OPERATIONS)) assert.ok(operation !== "finance" || actions.includes(action as PlatformAction) || action === unscopedReview, `${action} 既不是财务接口用到的权限，也不是只给不限范围的人的复核`);
});

test("前端：新建渠道、按供应商批量发起救援的按钮都经过集中的判断（usePlatformScopeDenies）", () => {
  for (const [operation, file] of Object.entries(FRONTEND_USES)) {
    assert.match(read(file, new URL(import.meta.url)), new RegExp(`usePlatformScopeDenies\\("${operation.replace(".", "\\.")}"\\)`), `${file} 用 ${operation}`);
  }
});

test("scopeDenies：不限、限城市、限渠道、都限时，各操作挡不挡", () => {
  const city: PlatformDataScope = { cityIds: [], channelIds: null };
  const channel: PlatformDataScope = { cityIds: null, channelIds: ["c4c4c4c4-0000-4000-8000-000000000002"] };
  const both: PlatformDataScope = { cityIds: ["c0c0c0c0-0000-4000-8000-000000000001"], channelIds: [] };
  const table: [PlatformDataScope, Record<ScopeDeniedOperation, boolean>][] = [
    [UNRESTRICTED_SCOPE, { finance: false, "channel.create": false, "tenant.rescue": false }],
    [city, { finance: true, "channel.create": false, "tenant.rescue": true }],
    [channel, { finance: true, "channel.create": true, "tenant.rescue": true }],
    [both, { finance: true, "channel.create": true, "tenant.rescue": true }],
  ];
  for (const [scope, expected] of table) {
    for (const operation of Object.keys(expected) as ScopeDeniedOperation[]) assert.equal(scopeDenies(scope, operation), expected[operation], `${JSON.stringify(scope)} ${operation}`);
  }
  assert.equal(platformAccountCan({ role: "custom_x", permissions: ["statement.manage"], dataScope: city }, "statement.manage"), false);
  assert.equal(platformAccountCan({ role: "custom_x", permissions: ["channel.manage"], dataScope: channel }, "channel.manage"), true, "渠道的其余修改按编号限定范围，不整体挡");
});
