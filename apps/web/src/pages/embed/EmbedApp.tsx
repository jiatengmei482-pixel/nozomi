/**
 * 嵌入预订页的文档（M9E-16，ADR 0095 第四节第 2 小节）：路径是 `/embed/book…` 时，main.tsx 只挂这一棵路由树，不挂登录、两个后台、主站页面。
 *
 * 这个文档是「允许被嵌入」的（Caddy 按嵌入码给 frame-ancestors），而 CSP 只在加载文档时定一次、前端换路由时不再检查，
 * 所以在这个文档里换到任何别的路径都只显示「请在新窗口打开」（新标签页链接），不渲染别的页面；这里也不放指向别的前缀的站内 <Link>。
 * 预订页（EmbedBookPage，`/book/new` 的四步）和订单页（EmbedOrderPage）都在 EmbedFrame 里：和宿主说话、发 ready / resize 由它统一管（M9E-17）。
 */
import { Route, Routes, useLocation } from "react-router";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { EMBED_BOOK_ORDER_PATH, EMBED_BOOK_PATH } from "../../embed/booking-protocol.ts";
import { EmbedBookPage } from "./EmbedBookPage.tsx";
import { EmbedFrame } from "./EmbedFrame.tsx";
import { EmbedOrderPage } from "./EmbedOrderPage.tsx";

/** 加载时的路径算不算嵌入页的文档：`/embed/book`，或 `/embed/book/` 下面的任何路径（不分大小写，和前端路由一样） */
export function isEmbedBookDocument(pathname: string): boolean {
  return /^\/embed\/book(\/|$)/i.test(pathname);
}

function OpenInNewWindow() {
  const { pathname, search } = useLocation();
  return (
    <section className="embed-book__section" role="status">
      <p>这个页面不能在合作网站里显示，请在新窗口打开。</p>
      <p>
        <NewTabLink to={`${pathname}${search}`}>在新窗口打开</NewTabLink>
      </p>
    </section>
  );
}

export function EmbedApp() {
  return (
    <EmbedFrame>
      <Routes>
        <Route path={EMBED_BOOK_PATH} element={<EmbedBookPage />} />
        {/* iframe 里的订单页（M9E-17；付款进 iframe 是第三期 M9E-19） */}
        <Route path={EMBED_BOOK_ORDER_PATH} element={<EmbedOrderPage />} />
        <Route path="*" element={<OpenInNewWindow />} />
      </Routes>
    </EmbedFrame>
  );
}
