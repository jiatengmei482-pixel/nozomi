/**
 * 在新标签页打开的站内链接：正在填一张表、要去别的页面看一眼或建一样东西时用，不离开正在填的这一页。
 * 只接受站内的相对路径（以一个 / 开头）；站外地址用 ExternalLink。新页面拿不到本页的窗口（noopener）。
 */
import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** 是不是站内的相对路径：以单个 / 开头，不带协议、不是 //host，也没有反斜杠和控制字符。 */
export function isInternalPath(to: string): boolean {
  return /^\/(?![/\\])[^\\\u0000-\u001f]*$/.test(to);
}

export function NewTabLink({ to, className = "link", children }: { to: string; className?: string; children: ReactNode }) {
  if (!isInternalPath(to)) return <span>{children}</span>;
  return (
    <a className={className} href={to} target="_blank" rel="noopener">
      {children}
      <Icon name="external" />
      <span className="visually-hidden">（在新标签页打开）</span>
    </a>
  );
}
