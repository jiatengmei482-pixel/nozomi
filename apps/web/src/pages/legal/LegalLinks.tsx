/**
 * 三个法律页面的链接（M9E-24，ADR 0107）：嵌入页顶部、核对页用，新窗口打开（嵌入页在 iframe 里，打开的是主站的页面；
 * 核对页上客人正在填的表不丢）。不用 nav / footer（嵌入页里不出现主站的导航、页脚）。
 */
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { LEGAL_LINKS } from "../../lib/legal-pages.ts";

export function LegalLinks({ className }: { className: string }) {
  return (
    <ul className={`legal-links ${className}`} lang="ja">
      {LEGAL_LINKS.map((link) => (
        <li key={link.key}>
          <NewTabLink to={link.to}>{link.label}</NewTabLink>
        </li>
      ))}
    </ul>
  );
}
