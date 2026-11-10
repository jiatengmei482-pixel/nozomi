/**
 * 去 WhatsApp 的链接（M8-21，ADR 0076）：官网「通过 WhatsApp 联系我们」、运营后台给客人发 WhatsApp、官网设置里「打开看看」。
 * 地址只由 @nozomi/domain 的 `whatsappChatUrl` 拼（`https://wa.me/<纯数字>?text=…`），号码必须是 wa.me 要的纯数字，否则不生成链接。
 * 新标签页打开，rel 写死 noopener noreferrer：对方页面拿不到本站窗口，也看不到是从哪个地址点过去的。
 */
import { whatsappChatUrl } from "@nozomi/domain";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

const DIGITS = /^[1-9]\d{7,14}$/;

export function WhatsappLink({ digits, text, className = "link", icon, children }: { digits: string; text: string; className?: string; icon?: IconName; children: ReactNode }) {
  if (!DIGITS.test(digits)) return <span>{children}</span>;
  return (
    <a className={className} href={whatsappChatUrl(digits, text)} target="_blank" rel="noopener noreferrer">
      {icon !== undefined && <Icon name={icon} />}
      {children}
      {icon === undefined && <Icon name="external" />}
      <span className="visually-hidden">（在新标签页打开）</span>
    </a>
  );
}
