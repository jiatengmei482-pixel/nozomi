/**
 * 一次性链接（docs/design/pages/platform-tenants.md 第 2 节）：把接口这一次应答里的令牌拼成一条完整的链接，交到操作的人手里。
 * 令牌放在 `#` 后面：浏览器不会把它发给服务器。路径取自 lib/portal.ts，网址用当前页面的（两个后台现在同域）。
 * 这里都是纯函数；令牌只在调用它的对话框的内存状态里，不进地址、存储、日志。
 */
import { PORTALS, type Portal } from "./portal.ts";

export type LinkKind = "invite" | "reset";

export function oneTimeLink(origin: string, portal: Portal, kind: LinkKind, token: string): string {
  const path = kind === "invite" ? PORTALS[portal].paths.acceptInvite : PORTALS[portal].paths.resetPassword;
  return `${origin}${path}#token=${encodeURIComponent(token)}`;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** 绝对时间，查看者本地时区：`2026-10-16 14:30`。认不出来返回 null。 */
export function localMinute(iso: string | null): string | null {
  if (iso === null) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 有效期那一条：绝对时间 + 括号里的时长；接口没给时间时只写时长。 */
export function expiryText(kind: LinkKind, expiresAt: string | null): string {
  const span = kind === "invite" ? "7 天" : "24 小时";
  const at = localMinute(expiresAt);
  return at === null ? `有效期：${kind === "invite" ? "邀请" : "重置"} ${span}，只能用一次。` : `有效期到 ${at}（${span}），只能用一次。`;
}

/** 「复制链接和说明」复制的那段话（定稿）：除了链接，不带任何敏感信息。 */
export function linkMessage(input: { portal: Portal; kind: LinkKind; name: string; email: string; link: string; expiresAt: string | null }): string {
  const at = localMinute(input.expiresAt);
  return [
    `${input.name}，你好：`,
    `这是 NOZOMI ${PORTALS[input.portal].name}的${input.kind === "invite" ? "账号开通" : "密码重置"}链接，请在 ${at ?? (input.kind === "invite" ? "7 天内" : "24 小时内")}${at === null ? "" : " 前"}打开，设置你自己的密码：`,
    input.link,
    `链接只能用一次，请不要转发给别人。登录邮箱：${input.email}`,
  ].join("\n");
}
