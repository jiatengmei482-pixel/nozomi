/**
 * 两个后台（供应商后台、运营后台）各自的入口、接口前缀和文案。
 * 两边是同一套页面组件，区别只在这张表里。
 */
import { PLATFORM_ROLES, TENANT_ROLES } from "@nozomi/domain";

export type Portal = "tenant" | "platform";

export interface PortalConfig {
  key: Portal;
  /** 后台名称，显示在登录页副标题和侧边栏顶部 */
  name: string;
  apiBase: string;
  paths: {
    home: string;
    login: string;
    acceptInvite: string;
    resetPassword: string;
    changePassword: string;
  };
  /** 登录页底部去另一个后台的链接 */
  switchTo: { portal: Portal; label: string };
}

export const PORTALS: Readonly<Record<Portal, PortalConfig>> = {
  tenant: {
    key: "tenant",
    name: "供应商后台",
    apiBase: "/tenant/v1",
    paths: {
      home: "/",
      login: "/login",
      acceptInvite: "/accept-invite",
      resetPassword: "/reset-password",
      changePassword: "/account/password",
    },
    switchTo: { portal: "platform", label: "我是平台员工，去运营后台登录" },
  },
  platform: {
    key: "platform",
    name: "运营后台",
    apiBase: "/platform/v1",
    paths: {
      home: "/platform",
      login: "/platform/login",
      acceptInvite: "/platform/accept-invite",
      resetPassword: "/platform/reset-password",
      changePassword: "/platform/account/password",
    },
    switchTo: { portal: "tenant", label: "我是供应商，去供应商后台登录" },
  },
};

const ROLE_NAMES: Readonly<Record<Portal, ReadonlyMap<string, string>>> = {
  tenant: new Map(TENANT_ROLES.map((role) => [role.key, role.name])),
  platform: new Map(PLATFORM_ROLES.map((role) => [role.key, role.name])),
};

/** 角色的中文名（来自 @nozomi/domain 的角色清单）；清单里没有的角色返回 null，由页面显示「—」。 */
export function roleName(portal: Portal, role: string): string | null {
  return ROLE_NAMES[portal].get(role) ?? null;
}

/** 控制字符（含制表符、换行）：浏览器解析网址时会把它们去掉，「/<Tab>/host」就成了「//host」。 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * 登录后回到哪里：只接受本后台内的站内路径，其他一律回首页。
 * 「//host」「/\host」会被浏览器当成另一个站点，必须挡掉；带控制字符的一律不要。
 */
export function safeReturnPath(portal: Portal, candidate: unknown): string {
  const { paths } = PORTALS[portal];
  if (typeof candidate !== "string" || CONTROL_CHARACTERS.test(candidate)) return paths.home;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return paths.home;
  const pathname = candidate.split(/[?#]/)[0] ?? "";
  if (portalOfPath(pathname) !== portal) return paths.home;
  if (Object.values(PORTALS).some((p) => [p.paths.login, p.paths.acceptInvite, p.paths.resetPassword].includes(pathname))) {
    return paths.home;
  }
  return candidate;
}

/** 一个站内路径属于哪个后台：/platform 开头的归运营后台，其余归供应商后台。 */
export function portalOfPath(pathname: string): Portal {
  return pathname === "/platform" || pathname.startsWith("/platform/") ? "platform" : "tenant";
}
