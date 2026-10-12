/**
 * 站外链接：只能链到 lib/external-links.ts 里登记过的地址，在新标签页打开。
 * 固定带 rel="noopener noreferrer"：对方页面拿不到本站窗口，也看不到是从哪个地址点过去的。
 */
import type { ReactNode } from "react";
import { EXTERNAL_LINKS, type ExternalLinkKey } from "../lib/external-links.ts";
import { Icon } from "./Icon.tsx";

export function ExternalLink({ to, children }: { to: ExternalLinkKey; children: ReactNode }) {
  return (
    <a className="link external-link" href={EXTERNAL_LINKS[to]} target="_blank" rel="noopener noreferrer">
      {children}
      <Icon name="external" className="external-link__icon" />
      <span className="visually-hidden">（在新标签页打开）</span>
    </a>
  );
}
