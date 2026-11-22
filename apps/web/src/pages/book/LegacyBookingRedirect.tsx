/**
 * 以前的预订地址（`SITE_LEGACY_BOOKING_PATHS`：`/book/new`、`/book/checkout`）转到预订页 `/book`（M8-05，ADR 0069 A5）。
 * 查询串（链接参数 from / to / date / time / pax / bags / mode / type、`?draft=`、`?step=`）、`#` 后面和路由 state（行程报价页带来的报价）原样带过去；
 * 用替换，浏览器「后退」不会回到这个转接地址再被转一次。
 */
import { Navigate, useLocation } from "react-router";
import { SITE_HOME_PATH } from "../../lib/site-display.ts";

export function LegacyBookingRedirect() {
  const { search, hash, state } = useLocation();
  return <Navigate to={{ pathname: SITE_HOME_PATH, search, hash }} state={state} replace />;
}
