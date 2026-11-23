/**
 * 三份法律文案（M9E-24）的链接，排成一行（放不下自动换行）。链接文字是日文，列表标 `lang="ja"`。
 * - 主站页脚：站内普通链接（`newTab` 不给）；
 * - 预订第 4 步「核对订单」、嵌入页顶部：新标签页打开（嵌入页的文档里不能站内跳转，见 pages/embed/EmbedApp.tsx），地址是主站的相对路径。
 * 不用 <nav>：嵌入页里不放导航地标（embed-flow.test.tsx）；页脚那一处由 SiteLayout 自己包 <nav>。
 */
import { Link } from "react-router";
import { LEGAL_PAGE_LINKS } from "../lib/legal-display.ts";
import { NewTabLink } from "./NewTabLink.tsx";

/** `label`：列表的读屏名字（核对页、嵌入页给「法律文案」；页脚外面已有同名的 <nav>，不再给） */
export function LegalLinks({ newTab = false, label }: { newTab?: boolean; label?: string }) {
  return (
    <ul className="legal-links" lang="ja" aria-label={label}>
      {LEGAL_PAGE_LINKS.map((page) => (
        <li key={page.path}>
          {newTab ? (
            <NewTabLink to={page.path}>{page.title}</NewTabLink>
          ) : (
            <Link className="link" to={page.path}>
              {page.title}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
