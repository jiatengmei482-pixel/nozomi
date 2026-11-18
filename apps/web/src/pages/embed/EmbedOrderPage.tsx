/**
 * iframe 里的订单页 `/embed/book/order`（M9E-17，ADR 0095 第四节第 1 小节、第八节第 2 小节）：嵌入页下单以后到这里。
 *
 * - 令牌从这条历史记录的 state 里取（下单时放的，同 M3-13，不进地址），其次是银行整页回跳时 `nozomi.payment-return` 里按付款编号记的（ADR 0046），
 *   再其次是本标签页的 `nozomi.embed-order`（按地址里的草稿号）；令牌从不发给宿主。
 * - **付款在 iframe 里**（M9E-19，ADR 0095 第七节）：待付款时直接显示主站同一个付款区块（Payment Element，只收银行卡），下单后不用再点任何按钮；
 *   和主站的差别只有：Stripe 表单按嵌入页语言；少数整页跳去银行验证时回到 `/embed/book/order?draft&key&lang&host&ch`（带 key、host 才过得了 frame-check，
 *   频道号随查询串带回来，回跳后发给宿主的消息仍带得上）；确认付款前后发 `modal{open}`，宿主把 iframe 摆进可视范围（3D 验证弹窗在 iframe 里居中）。
 *   回跳回来先把 Stripe 加的参数和频道号从地址里去掉，再挂付款表单。「在新窗口打开订单页付款」留作退路。
 * - 这一页每隔几秒读一次订单（标签页在后台时暂停，回来马上读一次）；变成已付款（不再是待付款、也没取消）就显示付款已提交，发 `step: paid` 和
 *   `completed{ orderNo, status: "submitted" }`（每张单只发一次），删掉 `nozomi.embed-order`。已取消也删。
 * - 进来时焦点移到订单号标题。
 * - 取消、改单不在 iframe 里做：一律「在新窗口打开订单页」（减少宿主页被入侵后用遮罩诱导点击的机会）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteOrderEnvelope, type SitePayment, getSiteConfig, getSiteOrder } from "../../api/site.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { Skeleton } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { EMBED_BOOK_ORDER_PATH } from "../../embed/booking-protocol.ts";
import { embedOrderFor, forgetEmbedOrder } from "../../embed/embed-order-store.ts";
import { hasPaymentReturnParams, paymentReturnParams, takePaymentReturn } from "../../lib/payment-return.ts";
import { GUEST_STATUS_BADGES, SITE_ORDER_PATH, siteOrderUrl, siteTokenFromHash } from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { type PaymentEmbedding, PaymentSection, TripSection } from "../book/OrderSections.tsx";
import { EmbedHeader, EmbedRefusal } from "./EmbedBookPage.tsx";
import { embedHash, embedSearch, useEmbedFrame } from "./EmbedFrame.tsx";

/** 待付款时多久读一次订单（毫秒）；测试里调短 */
export const ORDER_POLL = { ms: 5_000 };

type Loaded = { kind: "loading" } | { kind: "missing" } | { kind: "failed" } | { kind: "ready"; envelope: SiteOrderEnvelope };

export function EmbedOrderPage() {
  const { params, inFrame, lang, t, send, announce } = useEmbedFrame();
  useDocumentTitle(t.title);
  const location = useLocation();
  const navigate = useNavigate();
  const arrival = location.state as { orderToken?: unknown; placed?: unknown; payment?: SitePayment | null } | null;
  // 从银行页面整页回来（M9E-19）：地址上有 Stripe 加的 payment_intent、redirect_status（只在进来时读一次）
  const [returned] = useState(() => paymentReturnParams(location.search));
  // 只在进来时定一次：之后 state、存储变了也还是这一张单
  const [token] = useState<string | null>(() => {
    const held = typeof arrival?.orderToken === "string" ? siteTokenFromHash(arrival.orderToken) : null;
    const back = returned === null ? null : takePaymentReturn(returned.intentId);
    return held ?? (back === null ? null : siteTokenFromHash(back)) ?? (params.draft === null ? null : embedOrderFor(params.draft));
  });
  // 回跳回来的参数（含 client_secret）和查询串里的频道号先从地址里去掉，再挂付款表单（频道号已在内存里）
  useLayoutEffect(() => {
    const query = new URLSearchParams(location.search);
    if (!hasPaymentReturnParams(location.search) && !query.has("ch")) return;
    // 频道号从查询串移到 # 后（不发给服务器）：iframe 之后再刷新也带得上
    void navigate({ pathname: location.pathname, search: embedSearch(location.search), hash: embedHash(params.ch) }, { replace: true, state: location.state });
  }, []);
  // 整页去银行验证前发过 modal{open:true}，那个文档没机会再发 false：回来先告诉宿主验证窗口已关，宿主恢复按内容高度
  useEffect(() => {
    if (returned !== null && inFrame) send({ type: "modal", open: false });
  }, []);
  // 付款配置（publishable key；没配 Stripe 时 null = 付款暂未开放）
  // 读配置失败（"failed"）不能说成「付款暂未开放」：单独提示、可以重试
  const [payments, setPayments] = useState<{ publishable_key: string } | null | undefined | "failed">(undefined);
  const [configRound, setConfigRound] = useState(0);
  useEffect(() => {
    if (!inFrame || params.host === null || token === null) return;
    let alive = true;
    setPayments(undefined);
    getSiteConfig().then(
      (config) => alive && setPayments(config.payments),
      () => alive && setPayments("failed"),
    );
    return () => {
      alive = false;
    };
  }, [inFrame, params.host, token, configRound]);
  const embedding = useMemo<PaymentEmbedding>(() => {
    const query = new URLSearchParams(embedSearch(window.location.search));
    if (params.ch !== null) query.set("ch", params.ch);
    return {
      returnUrl: `${window.location.origin}${EMBED_BOOK_ORDER_PATH}?${query.toString()}`,
      locale: lang,
      onModal: (open) => send({ type: "modal", open }),
    };
  }, [params.ch, lang, send]);
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

  // 标签页在后台（客人正在新窗口付款）时不轮询；回到这个标签页时马上读一次
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const onChange = (): void => {
      const now = document.visibilityState !== "hidden";
      setVisible(now);
      if (now) setRound((value) => value + 1);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // 待付款：告诉宿主到了付款这一步，隔几秒再读一次（客人在新窗口付完回来，这一页自己更新）
  useEffect(() => {
    if (status !== "pending_payment") return;
    if (!sawPending.current) send({ type: "step", step: "payment" });
    sawPending.current = true;
    if (!visible) return;
    const timer = setTimeout(() => setRound((value) => value + 1), ORDER_POLL.ms);
    return () => clearTimeout(timer);
  }, [status, round, visible]);

  // 进订单页时焦点移到订单号标题（点「去付款」的按钮已经卸载，焦点不能掉到 body；同四步换步的做法）
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (loaded.kind !== "ready" || focused.current) return;
    focused.current = true;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "start" });
  }, [loaded.kind]);

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
          <h2 id="embed-order-no" ref={heading} tabIndex={-1} className="embed-book__subtitle">
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
      </section>
      {/* 付款就在这一页（M9E-19，业主验收意见 2026-11-16）：下单后直接显示付款表单，不用再点按钮、不开新窗口 */}
      {pending && token !== null && payments !== "failed" && (
        <div lang="zh-CN">
          <PaymentSection token={token} order={order} configPayments={payments} initial={arrival?.payment ?? null} returnFailed={returned?.redirectStatus === "failed"} onRefresh={() => setRound((value) => value + 1)} embedding={embedding} />
        </div>
      )}
      {pending && payments === "failed" && (
        <section className="embed-book__section" role="alert">
          <p>{t.payLoadFailed}</p>
          <p className="embed-book__actions">
            <Button onClick={() => setConfigRound((value) => value + 1)}>{t.retry}</Button>
          </p>
        </section>
      )}
      <section className="embed-book__section">
        {pending ? (
          <p className="embed-book__pay-hint">
            {t.payHint}{" "}
            <NewTabLink to={orderLink}>{t.payInNewWindow}</NewTabLink>
          </p>
        ) : (
          <p className="embed-book__actions">
            <NewTabLink to={orderLink}>{t.openOrder}</NewTabLink>
          </p>
        )}
        <p className="embed-book__note">{t.manageNote}</p>
      </section>
      <div lang="zh-CN">
        <TripSection order={order} names={names} breakdown={loaded.envelope.price_breakdown ?? null} />
      </div>
    </>
  );
}
