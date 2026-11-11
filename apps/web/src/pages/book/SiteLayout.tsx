/**
 * 官网页面的外观（M3-05，ADR 0032；docs/design/03-layout.md「官网下单页」）：不用后台的菜单壳。
 * 单栏、内容最宽 `layout-reading-max-width`、居中；顶部是品牌、主题切换和两个入口；底部是数据来源的署名
 * （页面上有城市、机场的名称：GeoNames CC BY 4.0、OurAirports 公有领域）。
 */
import { Component, type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { ApiError } from "../../api/client.ts";
import { SITE_PAGE_WIDTHS, type SiteConfig, type SitePageWidth, getSiteConfig } from "../../api/site.ts";
import { Attributions, placeSources } from "../../components/Attribution.tsx";
import { Brand } from "../../components/Brand.tsx";
import { Button } from "../../components/Button.tsx";
import { StateBlock } from "../../components/States.tsx";
import { SITE_NEW_BOOKING_PATH } from "../../lib/book-new.ts";
import { failureText } from "../../lib/failure.ts";
import { SITE_CHECKOUT_PATH, SITE_HOME_PATH, SITE_ORDER_PATH } from "../../lib/site-display.ts";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher.tsx";

/** 顶栏的入口：当前页是哪一个（F11）。询价、新预订页（M8-03）和下单都算「预订用车」，订单页和查订单都算「查订单」。 */
function navCurrent(pathname: string, target: string): "page" | "true" | undefined {
  if (pathname === target) return "page";
  if (target === SITE_HOME_PATH && (pathname === SITE_CHECKOUT_PATH || pathname === SITE_NEW_BOOKING_PATH)) return "true";
  return undefined;
}

// ---- 页面宽度（M8-28，ADR 0079）：/site/v1/config 的 page_width，所有官网页面共用一个值，写到 .site 的 data-width 上（CSS 变量 --site-max-width） ----

let pageWidth: SitePageWidth = "standard";
let widthRequested = false;
const widthListeners = new Set<() => void>();

/** 读到官网配置时记下页面宽度（不认识的值、缺省按标准）。 */
export function rememberSitePageWidth(value: unknown): void {
  widthRequested = true;
  const next = SITE_PAGE_WIDTHS.find((width) => width === value) ?? "standard";
  if (next === pageWidth) return;
  pageWidth = next;
  for (const listener of widthListeners) listener();
}

/** 测试用：回到还没读过配置的样子。 */
export function resetSitePageWidth(): void {
  pageWidth = "standard";
  widthRequested = false;
}

function useSitePageWidth(): SitePageWidth {
  const width = useSyncExternalStore(
    (listener) => {
      widthListeners.add(listener);
      return () => widthListeners.delete(listener);
    },
    () => pageWidth,
  );
  // 自己不读配置的页面（下单页）直接打开时，补读一次；读不出来就按标准，不报错
  useEffect(() => {
    if (widthRequested) return;
    widthRequested = true;
    getSiteConfig().then(
      (config) => rememberSitePageWidth(config.page_width),
      () => undefined,
    );
  }, []);
  return width;
}

/**
 * 顶栏：DOM 顺序是品牌、主题切换、入口（F10）。品牌和主题切换在第一行两端（品牌色带上，M6-05），入口在色带下面的第二行；
 * 各宽度都是这样排，Tab 顺序和看到的顺序一致。品牌链接的可读名字仍是「NOZOMI 用车」（标志对读屏隐藏）。
 */
export function SiteLayout({ children, attribution = true }: { children: ReactNode; attribution?: boolean }) {
  const { pathname } = useLocation();
  const width = useSitePageWidth();
  return (
    <div className="site" data-width={width}>
      <header className="site__header">
        <Link to={SITE_HOME_PATH} className="site__brand">
          <Brand tone="on-brand" /> <span className="site__brand-service">用车</span>
        </Link>
        <div className="site__theme">
          <ThemeSwitcher />
        </div>
        <nav className="site__nav" aria-label="官网">
          <Link to={SITE_HOME_PATH} className="site__nav-link" aria-current={navCurrent(pathname, SITE_HOME_PATH)}>
            预订用车
          </Link>
          <Link to={SITE_ORDER_PATH} className="site__nav-link" aria-current={navCurrent(pathname, SITE_ORDER_PATH)}>
            查订单
          </Link>
        </nav>
      </header>
      <main className="site__main">{children}</main>
      {attribution && (
        <footer className="site__footer">
          <Attributions sources={placeSources(true)} />
        </footer>
      )}
    </div>
  );
}

/**
 * 官网页面崩溃（前端异常）时的兜底（F3，pages/site-booking.md 第 7 节）：客人没有「管理员」，
 * 告诉他订单不受影响、可以在「查订单」找到。用官网自己的外观，不用后台的兜底。
 */
class SiteCrashBoundary extends Component<{ locationKey: string; children: ReactNode }, { failed: boolean; locationKey: string }> {
  override state = { failed: false, locationKey: this.props.locationKey };

  static getDerivedStateFromError(): Partial<{ failed: boolean }> {
    return { failed: true };
  }

  /** 出错后客人去了别处（哪怕地址一样，如订单页 → 点「查订单」）：重新开始。没出错时换地址不重建页面。 */
  static getDerivedStateFromProps(props: { locationKey: string }, state: { failed: boolean; locationKey: string }): Partial<{ failed: boolean; locationKey: string }> | null {
    if (props.locationKey === state.locationKey) return null;
    return { failed: false, locationKey: props.locationKey };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <SiteLayout attribution={false}>
        <StateBlock
          headingLevel="h1"
          title="页面出了点问题"
          description="请刷新重试。您的订单不受影响，可以随时在「查订单」里找到。"
          action={
            <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
              刷新页面
            </Button>
          }
        />
      </SiteLayout>
    );
  }
}

/** 官网路由的外层：每次导航（点顶栏入口，即使地址和现在一样）都会离开兜底页，不会一直停在那里。 */
export function SiteErrorBoundary() {
  const { key } = useLocation();
  return (
    <SiteCrashBoundary locationKey={key}>
      <Outlet />
    </SiteCrashBoundary>
  );
}

export type ConfigState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; config: SiteConfig };

/** 官网的配置（开没开、币种、付款）：每个页面进来取一次。 */
export function useSiteConfig(): { state: ConfigState; reload(): void } {
  const [state, setState] = useState<ConfigState>(() => {
    // 这个页面自己读配置（页面宽度也从这里来），外壳不用再读一次
    widthRequested = true;
    return { kind: "loading" };
  });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getSiteConfig().then(
      (config) => {
        rememberSitePageWidth(config.page_width);
        if (alive) setState({ kind: "ready", config });
      },
      (err: unknown) => alive && setState({ kind: "failed", message: siteFailureText(err, "打开页面") }),
    );
    return () => {
      alive = false;
    };
  }, [round]);
  const reload = useCallback(() => setRound((value) => value + 1), []);
  return { state, reload };
}

/** 官网的出错说法：官网没开、链接失效、限速单独说明，其余同后台。 */
export function siteFailureText(err: unknown, action: string): string {
  if (err instanceof ApiError) {
    if (err.code === "SITE_NOT_OPEN") return "官网暂未开放预订，请稍后再来。";
    if (err.code === "ORDER_LINK_INVALID") return "订单链接无效或已过期，请在「查订单」填订单号和下单邮箱，我们会把新链接发到您的邮箱。";
    if (err.status === 429) return err.retryAfterSeconds !== null && err.retryAfterSeconds > 0 ? `操作太频繁了，请 ${err.retryAfterSeconds < 60 ? `${err.retryAfterSeconds} 秒` : `${Math.ceil(err.retryAfterSeconds / 60)} 分钟`}后再试。` : "操作太频繁了，请稍后再试。";
  }
  return failureText(err, action);
}
