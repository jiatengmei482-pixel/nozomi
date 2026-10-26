/**
 * 官网页面的外观（M3-05，ADR 0032；docs/design/03-layout.md「官网下单页」）：不用后台的菜单壳。
 * 单栏、内容最宽 `layout-reading-max-width`、居中；顶部是品牌和「查订单」，右上角主题切换；底部是数据来源的署名
 * （页面上有城市、机场的名称：GeoNames CC BY 4.0、OurAirports 公有领域）。
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteConfig, getSiteConfig } from "../../api/site.ts";
import { Attributions, placeSources } from "../../components/Attribution.tsx";
import { failureText } from "../../lib/failure.ts";
import { SITE_HOME_PATH, SITE_ORDER_PATH } from "../../lib/site-display.ts";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher.tsx";

export function SiteLayout({ children, attribution = true }: { children: ReactNode; attribution?: boolean }) {
  return (
    <div className="site">
      <header className="site__header">
        <Link to={SITE_HOME_PATH} className="site__brand">
          NOZOMI 用车
        </Link>
        <nav className="site__nav" aria-label="官网">
          <Link to={SITE_HOME_PATH} className="site__nav-link">
            预订接送机
          </Link>
          <Link to={SITE_ORDER_PATH} className="site__nav-link">
            查订单
          </Link>
        </nav>
        <ThemeSwitcher />
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

export type ConfigState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; config: SiteConfig };

/** 官网的配置（开没开、币种、付款）：每个页面进来取一次。 */
export function useSiteConfig(): { state: ConfigState; reload(): void } {
  const [state, setState] = useState<ConfigState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    getSiteConfig().then(
      (config) => alive && setState({ kind: "ready", config }),
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
    if (err.code === "ORDER_LINK_INVALID") return "订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。";
    if (err.status === 429) return err.retryAfterSeconds !== null && err.retryAfterSeconds > 0 ? `操作太频繁了，请 ${err.retryAfterSeconds < 60 ? `${err.retryAfterSeconds} 秒` : `${Math.ceil(err.retryAfterSeconds / 60)} 分钟`}后再试。` : "操作太频繁了，请稍后再试。";
  }
  return failureText(err, action);
}
