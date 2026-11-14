/**
 * 新预订页的「页面外壳」（M9E-17，ADR 0095 第四节第 1 小节）：`/book/new` 的四步在主站和嵌入预订页 `/embed/book` 里是同一份组件，
 * 两边只在这里列的几处不同。默认值（`MAIN_BOOKING_SHELL`）就是主站现在的行为，主站不传任何东西，请求和页面逐字不变；
 * 嵌入页的取值在 `pages/embed/EmbedBookPage.tsx` 里给。
 */
import { type ReactNode, createContext, useContext } from "react";
import type { NavigateFunction } from "react-router";
import type { MapTiles } from "../../../api/areas.ts";
import { type BookingDraft, type SiteLink, type SiteOrderEnvelope, type SitePayment, getSiteBookingDraft } from "../../../api/site.ts";
import type { BookStep } from "../../../lib/book-new.ts";
import { siteOrderUrl } from "../../../lib/site-display.ts";
import { SiteLayout } from "../SiteLayout.tsx";

/** 下单接口的应答（`createSiteOrder`） */
export type PlacedOrder = SiteOrderEnvelope & { payment: SitePayment | null; link: SiteLink };

export interface BookingShell {
  /** 浏览器标签页的标题 */
  title: string;
  /** 页面外壳：主站是 SiteLayout（顶栏、页脚）+ 页面标题；嵌入页没有顶栏页脚，标题和卖方说明在嵌入页自己那一层 */
  frame(body: ReactNode): ReactNode;
  /** 一直单栏（右侧栏变成顶部可展开的摘要条，就是主站 < 1024px 的样子）：嵌入页宽度跟 iframe，不分两栏 */
  narrow: boolean;
  /**
   * 地图选点（`SiteMapPicker`）和路线后备图（`RouteMap`）用的底图。两者都是 Leaflet：嵌入页一律 null——不提供地图选点，
   * 静态路线图失败时只留「约 X 分钟 · Y 公里」（ADR 0095 第九节第 5 小节、Q11）。
   */
  tiles(configured: MapTiles | null): MapTiles | null;
  /** 读预订草稿；`sourceMatches` 为 false 时询价不带 `draft_id`，来源按主站记 */
  readDraft(id: string): Promise<{ draft: BookingDraft; sourceMatches: boolean }>;
  /** 下单成功以后去哪儿 */
  placed(created: PlacedOrder, navigate: NavigateFunction): void;
  /** 换到了第几步（第一次显示也算） */
  stepShown(step: BookStep): void;
}

export const MAIN_BOOKING_SHELL: BookingShell = {
  title: "预订用车 · NOZOMI 用车",
  frame: (body) => (
    <SiteLayout>
      <h1 className="site__title">预订接送车</h1>
      <p className="site-muted">输入出发地和目的地，马上看到所有车型的一口价</p>
      {body}
    </SiteLayout>
  ),
  narrow: false,
  tiles: (configured) => configured,
  // 主站不带 key、host：请求和以前一样；主站自己的草稿来源由服务端按草稿记，这里总是带上编号
  readDraft: (id) => getSiteBookingDraft(id).then(({ draft }) => ({ draft, sourceMatches: true })),
  placed: (created, navigate) => {
    void navigate(siteOrderUrl(created.link.token), { state: { placed: true, payment: created.payment } });
  },
  stepShown: () => undefined,
};

export const BookingShellContext = createContext<BookingShell>(MAIN_BOOKING_SHELL);

export const useBookingShell = (): BookingShell => useContext(BookingShellContext);
