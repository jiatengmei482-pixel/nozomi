/**
 * 角色编辑和 IP 白名单输入的纯函数（ADR 0030）。勾选规则和后端同一份（@nozomi/domain 的 `PLATFORM_MENUS`、`roleGrantIssues`）。
 */
import { MENU_OPERATIONS, type MenuOperation, PLATFORM_MENUS, SUPER_ADMIN_ONLY_GRANTS, normalizeAllowlist } from "@nozomi/domain";

export interface MatrixCell {
  grant: string;
  /** 这一格存在（这个菜单有这个操作） */
  exists: boolean;
  /** 只归超级管理员，自建角色勾不了 */
  superAdminOnly: boolean;
}

export interface MatrixRow {
  key: string;
  name: string;
  cells: Record<MenuOperation, MatrixCell>;
}

/** 勾选表：每个菜单一行，查看 / 编辑 / 审核 / 导出四列。 */
export function permissionMatrix(): MatrixRow[] {
  return PLATFORM_MENUS.map((menu) => {
    const cells = Object.fromEntries(
      MENU_OPERATIONS.map(({ key }) => {
        const grant = `${menu.key}:${key}`;
        return [key, { grant, exists: key in menu.operations, superAdminOnly: (SUPER_ADMIN_ONLY_GRANTS as readonly string[]).includes(grant) }];
      }),
    ) as Record<MenuOperation, MatrixCell>;
    return { key: menu.key, name: menu.name, cells };
  });
}

/**
 * 勾上 / 去掉一格：勾编辑、审核、导出时自动带上同一菜单的「查看」；去掉「查看」时同一菜单的其他格一起去掉
 * （后端要求勾了编辑 / 审核要也勾查看）。结果按菜单表的顺序排。
 */
export function toggleGrant(grants: readonly string[], grant: string, on: boolean): string[] {
  const [menu, operation] = grant.split(":") as [string, string];
  const set = new Set(grants);
  if (on) {
    set.add(grant);
    if (operation !== "view") set.add(`${menu}:view`);
  } else {
    set.delete(grant);
    if (operation === "view") for (const { key } of MENU_OPERATIONS) set.delete(`${menu}:${key}`);
  }
  const order = permissionMatrix().flatMap((row) => MENU_OPERATIONS.map(({ key }) => row.cells[key].grant));
  return order.filter((item) => set.has(item));
}

/** 文本框里的 IP 白名单：一行一个（逗号、空格也算分隔），空行忽略。 */
export function splitAllowlist(text: string): string[] {
  return text
    .split(/[\s,，、]+/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

const ISSUE_TEXT: Readonly<Record<string, string>> = {
  INVALID: "不是合法的 IP 地址或地址段",
  HOST_BITS_SET: "地址段写得不对",
  DUPLICATE: "和前面的重复了",
};

/** 保存前先在浏览器里查一遍（规则和后端同一份），逐条说哪里不对。 */
export function allowlistProblems(text: string): string[] {
  const entries = splitAllowlist(text);
  const problems = normalizeAllowlist(entries).issues.map((issue) => `第 ${issue.index + 1} 条「${issue.value}」${ISSUE_TEXT[issue.reason] ?? "不对"}${issue.suggestion ? `，应写成 ${issue.suggestion}` : ""}`);
  if (entries.length > 50) problems.push("最多 50 条");
  return problems;
}
