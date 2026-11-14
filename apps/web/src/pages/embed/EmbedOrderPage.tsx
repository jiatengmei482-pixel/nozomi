/**
 * iframe 里的订单页 `/embed/book/order`（M9E-17，ADR 0095 第四节第 1 小节、第八节第 2 小节）：嵌入页下单以后到这里。
 *
 * - 令牌从这条历史记录的 state 里取（下单时放的，同 M3-13，不进地址），其次是本标签页的 `nozomi.embed-order`（按地址里的草稿号）；令牌从不发给宿主。
 * - 第二期**不在 iframe 里付款**（付款进 iframe 是第三期 M9E-19，ADR 0095 第十一节）：待付款时给「在新窗口打开订单页付款」（主站 `/book/order#<令牌>`，
 *   新标签页），这一页每隔几秒读一次订单；变成已付款（不再是待付款、也没取消）就显示付款已提交，发 `step: paid` 和
 *   `completed{ orderNo, status: "submitted" }`（每张单只发一次），删掉 `nozomi.embed-order`。已取消也删。
 * - 取消、改单不在 iframe 里做：一律「在新窗口打开订单页」（减少宿主页被入侵后用遮罩诱导点击的机会）。
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteOrderEnvelope, getSiteOrder } from "../../api/site.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { embedOrderFor, forgetEmbedOrder } from "../../embed/embed-order-store.ts";
import { GUEST_STATUS_BADGES, SITE_ORDER_PATH, siteOrderUrl, siteTokenFromHash } from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { TripSection } from "../book/OrderSections.tsx";
import { EmbedHeader, EmbedRefusal } from "./EmbedBookPage.tsx";
import { useEmbedFrame } from "./EmbedFrame.tsx";

/** 待付款时多久读一次订单（毫秒）；测试里调短 */
export const ORDER_POLL = { ms: 5_000 };

type Loaded = { kind: "loading" } | { kind: "missing" } | { kind: "failed" } | { kind: "ready"; envelope: SiteOrderEnvelope };

export function EmbedOrderPage() {
  const { params, inFrame, t, send, announce } = useEmbedFrame();
  useDocumentTitle(t.title);
  const location = useLocation();
  const arrival = location.state as { orderToken?: unknown; placed?: unknown } | null;
  // 只在进来时定一次：之后 state、存储变了也还是这一张单
  const [token] = useState<string | null>(() => {
    const held = typeof arrival?.orderToken === "string" ? siteTokenFromHash(arrival.orderToken) : null;
    return held ?? (params.draft === null ? null : embedOrderFor(params.draft));
  });
  // 这张单是这个标签页里刚下的（存储里还有记录）：之后看到付款完成要告诉宿主
  const [fresh] = useState(() => token !== null && params.draft !== null && embedOrderFor(params.draft) === token);
  const [loaded, setLoaded] = useState<Loaded>(() => (token === null ? { kind: "missing" } : { kind: "loading" }));
  const [round, setRound] = useState(0);
  const sawPending = useRef(false);
  const completed = useRef(false);

  useEffect(() => {
    if (!inFrame || params.host === null || token === null) return;
    let alive = true;
    getSiteOrder(token).then(
      (envelope) => alive && setLoaded({ kind: "ready", envelope }),
      (err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) {
          forgetEmbedOrder();
          setLoaded({ kind: "missing" });
        } else setLoaded((current) => (current.kind === "ready" ? current : { kind: "failed" }));
      },
    );
    return () => {
      alive = false;
    };
  }, [inFrame, params.host, token, round]);

  // 页面有了结论就 ready（刷新、续接时这是文档里的第一页；从预订页过来时已经发过，不再发）
  useEffect(() => {
    if (loaded.kind !== "loading" && inFrame && params.host !== null) announce(null);
  }, [loaded.kind]);

  const status = loaded.kind === "ready" ? loaded.envelope.order.status : null;
  const orderNo = loaded.kind === "ready" ? loaded.envelope.order.order_no : null;

  // 待付款：告诉宿主到了付款这一步，隔几秒再读一次（客人在新窗口付完回来，这一页自己更新）
  useEffect(() => {
    if (status !== "pending_payment") return;
    if (!sawPending.current) send({ type: "step", step: "payment" });
    sawPending.current = true;
    const timer = setTimeout(() => setRound((value) => value + 1), ORDER_POLL.ms);
    return () => clearTimeout(timer);
  }, [status, round]);

  // 付款已提交（不再待付款、也没取消）：这张单是这里下的，就告诉宿主一次；存储里的记录用完即删。已取消也删
  useEffect(() => {
    if (status === null || status === "pending_payment") return;
    if (status !== "cancelled" && orderNo !== null && !completed.current && (fresh || sawPending.current)) {
      completed.current = true;
      send({ type: "step", step: "paid" });
      send({ type: "completed", orderNo, status: "submitted" });
    }
    forgetEmbedOrder();
  }, [status, orderNo]);

  if (!inFrame || params.host === null) return <EmbedRefusal />;
  if (loaded.kind === "loading") {
    return (
      <>
        <EmbedHeader />
        <Skeleton lines={["medium", "long", "long"]} label={t.loading} />
      </>
    );
  }
  if (loaded.kind === "missing" || loaded.kind === "failed") {
    return (
      <>
        <EmbedHeader />
        <section className="embed-book__section" role="alert">
          <p>{loaded.kind === "missing" ? t.orderMissing : t.orderFailed}</p>
          <p className="embed-book__actions">
            {loaded.kind === "failed" && <Button onClick={() => setRound((value) => value + 1)}>{t.retry}</Button>}
            <NewTabLink to={SITE_ORDER_PATH}>{t.lookup}</NewTabLink>
          </p>
        </section>
      </>
    );
  }

  const { order, names } = loaded.envelope;
  const pending = order.status === "pending_payment";
  // 令牌只在新窗口的地址 # 后面（主站订单页的写法，ADR 0032）：# 后面不发给服务器、不进 Referer
  const orderLink = token === null ? SITE_ORDER_PATH : siteOrderUrl(token);
  return (
    <>
      <EmbedHeader />
      <section className="embed-book__section" aria-labelledby="embed-order-no">
        <div className="embed-book__order-head">
          <h2 id="embed-order-no" className="embed-book__subtitle">
            {t.orderNo} {order.order_no}
          </h2>
          <span lang="zh-CN">
            <StatusBadge {...GUEST_STATUS_BADGES[order.status]} />
          </span>
        </div>
        <div role="status">
          {pending && <Alert kind="info">{`${arrival?.placed === true ? `${t.orderPlaced} ` : ""}${t.orderPending}`}</Alert>}
          {order.status === "cancelled" && <Alert kind="warning">{t.cancelled}</Alert>}
          {!pending && order.status !== "cancelled" && <Alert kind="success">{t.paid}</Alert>}
        </div>
        <p className="embed-book__actions">
          <NewTabLink to={orderLink} className={pending ? "button button--primary button--lg" : "link"}>
            {pending ? t.payInNewWindow : t.openOrder}
          </NewTabLink>
        </p>
        <p className="embed-book__note">{t.manageNote}</p>
      </section>
      <div lang="zh-CN">
        <TripSection order={order} names={names} breakdown={loaded.envelope.price_breakdown ?? null} />
      </div>
    </>
  );
}
