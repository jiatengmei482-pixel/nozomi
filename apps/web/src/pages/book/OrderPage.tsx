/**
 * 官网订单页（M3-05，ADR 0032）：客人凭链接（`/book/order#<令牌>`）看自己的这一张单——状态时间线、行程、付款、司机和车辆（派车后）、
 * 「我已落地」（接机）、取消（先看按政策退多少）、改单、事后加收和异议、投诉和反馈（M4-03）。令牌只在地址的 `#` 后面和请求头里；
 * 唯一的例外是付款时被 Stripe 整页带去银行验证（M3-08，ADR 0046）：令牌临时放在本标签页的 sessionStorage，回到 `/book/order?payment_intent=…`
 * 时按付款编号取回、立刻删掉，地址换回 `#<令牌>`（Stripe 加在地址上的参数含 client_secret，一并去掉）。
 * 要挂 Stripe 表单的页面（M3-13，ADR 0046）：Stripe.js 会读所在页面的完整地址，所以挂之前把令牌从地址移到这条历史记录的 state 里（刷新、前进后退都还在），
 * 这个文档里 Stripe.js 加载过就不再放回地址；客人用页面上的「复制订单链接」取链接。
 * 没有令牌（直接打开「查订单」）或令牌失效：用订单号 + 下单时的邮箱或手机号找回，换一个新链接。
 */
import { type FormEvent, Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteOrderEnvelope, type SitePayment, getSiteOrder, lookupSiteOrder } from "../../api/site.ts";
import { AlertSlot, Alert, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { forgetPaymentReturn, hasPaymentReturnParams, paymentReturnParams, takePaymentReturn } from "../../lib/payment-return.ts";
import { stripeJsInPage } from "../../lib/stripe-js.ts";
import { GUEST_STATUS_BADGES, type OrderSectionKey, SITE_ORDER_PATH, orderSectionSequence, primaryOrderSection, siteOrderUrl, siteTokenFromHash } from "../../lib/site-display.ts";
import { useCopyText } from "../../lib/use-copy-text.tsx";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { CancelSection, ChangeSection, DriverSection, ExtraChargesSection, HelpSection, LandingSection, PaymentSection, TimelineSection, TripSection } from "./OrderSections.tsx";
import { SiteLayout, siteFailureText, useSiteConfig } from "./SiteLayout.tsx";
import { FeedbackSection } from "./FeedbackSection.tsx";

/** 找回被限速（可能是这个订单号被别人试了太多次，要等几个小时）：告诉客人等多久，也可以联系客服。 */
export function lookupThrottledText(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || retryAfterSeconds <= 0) return "尝试次数过多，请稍后再试，或联系客服。";
  const wait = retryAfterSeconds < 60 ? `${retryAfterSeconds} 秒` : retryAfterSeconds < 3600 ? `${Math.ceil(retryAfterSeconds / 60)} 分钟` : `${Math.ceil(retryAfterSeconds / 3600)} 小时`;
  return `尝试次数过多，请 ${wait}后再试，或联系客服。`;
}

/** 从银行验证页回来却取不回令牌（换了标签页或浏览器、存储被清）：付款结果以 Stripe 通知平台为准，客人用订单号找回订单就能看到。 */
const RETURN_LOST_TEXT = "付款结果已交给银行处理。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单查看付款结果；请不要重复付款。";
/**
 * 同上，但地址上写着付款失败。这里没有令牌、查不了订单，「失败」只是地址上的说法，所以写「银行返回的结果」，真正的状态让客人到订单页看；
 * 那里只有还没付成才会显示付款表单，不会诱导重复付款。平台现在不发确认邮件（ADR 0032：通知中心任务），找回只有订单号和客服。
 */
/** 所有查不到的情况都同样显示，不说明这个订单号存不存在（ADR 0055）。 */
export const LOOKUP_NOT_FOUND_TEXT = "没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号。如果这张订单已结束超过 180 天，联系方式可能已按隐私规则清除，不能再用邮箱或手机号查询，需要帮助请联系客服。";

const RETURN_FAILED_LOST_TEXT = "银行返回的结果是这次付款没有成功。这个页面没能自动打开您的订单，请用订单号和下单时的邮箱或手机号查找订单：订单页会显示最新的付款状态，还是待付款的话可以在那里重新付款。找不到订单号请联系客服。";

function LookupForm({ expired, paymentReturnLost = null }: { expired: boolean; paymentReturnLost?: "failed" | "unknown" | null }) {
  const navigate = useNavigate();
  const [orderNo, setOrderNo] = useState("");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<{ orderNo?: string; contact?: string }>({});
  const [notice, setNotice] = useState<Notice | null>(
    paymentReturnLost !== null ? { kind: "warning", text: paymentReturnLost === "failed" ? RETURN_FAILED_LOST_TEXT : RETURN_LOST_TEXT } : expired ? { kind: "warning", text: "订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。" } : null,
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const no = orderNo.trim().toUpperCase();
    // 联系方式的全角（日文 / 中文输入法常见）先转半角，和后端同一个口径（NFKC）
    const given = contact.normalize("NFKC").trim();
    const found: typeof errors = {};
    if (!/^NZ\d{8}[0-9A-Z]{8}$/.test(no)) found.orderNo = "订单号是 NZ 开头的 18 位，如 NZ20261026AB12CD34";
    if (given.length < 3) found.contact = "请填写下单时的邮箱或手机号";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const { link } = await lookupSiteOrder(no, given);
      navigate(siteOrderUrl(link.token), { replace: true });
    } catch (err) {
      setNotice({ kind: "danger", text: err instanceof ApiError && err.code === "ORDER_NOT_FOUND" ? LOOKUP_NOT_FOUND_TEXT : err instanceof ApiError && err.status === 429 ? lookupThrottledText(err.retryAfterSeconds) : siteFailureText(err, "查找订单") });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
      <AlertSlot notice={notice} />
      <TextField label="订单号" size="lg" required autoCapitalize="characters" autoComplete="off" spellCheck={false} hint="NZ 开头的 18 位，在订单页顶部" value={orderNo} errors={errors.orderNo ? [errors.orderNo] : []} onChange={(event) => setOrderNo(event.target.value)} />
      <TextField label="下单时的邮箱或手机号" size="lg" required autoComplete="email" value={contact} errors={errors.contact ? [errors.contact] : []} onChange={(event) => setContact(event.target.value)} />
      <div className="site-actions">
        <Button type="submit" variant="primary" size="lg" block loading={busy} loadingText="正在查找">
          查找订单
        </Button>
      </div>
    </form>
  );
}

/** 刚下单时的链接和「复制链接」按钮（F5：带文字的按钮，复制不了时给手动复制的框）。 */
function ShareLink({ url }: { url: string }) {
  const { copy, dialog } = useCopyText();
  return (
    <p className="site-share">
      <span className="site-share__url">{url}</span>
      <Button onClick={() => copy(url)}>
        <Icon name="copy" />
        复制链接
      </Button>
      {dialog}
    </p>
  );
}

/** 地址栏里没有令牌时（ADR 0046）：地址栏复制不到这张单的链接，告诉客人，并给一个能复制的按钮。 */
function HiddenLinkNote({ url }: { url: string }) {
  const { copy, dialog } = useCopyText();
  return (
    <p className="site-share">
      <span className="site-muted">为保护您的订单，付款时地址栏不显示订单链接。要保存或转发这张单，请用这个按钮。</span>
      <Button onClick={() => copy(url)}>
        <Icon name="copy" />
        复制订单链接
      </Button>
      {dialog}
    </p>
  );
}

type Loaded = { kind: "loading" } | { kind: "invalid" } | { kind: "failed"; message: string } | { kind: "ready"; envelope: SiteOrderEnvelope };

type Arrival = { placed?: boolean; payment?: SitePayment | null; paymentReturnLost?: "failed" | "unknown"; paymentReturnFailed?: boolean; orderToken?: string };

function OrderLoading() {
  useDocumentTitle("查订单 · NOZOMI 用车");
  return (
    <SiteLayout attribution={false}>
      <h1 className="site__title">订单</h1>
      <Skeleton lines={["medium", "long", "long", "control"]} label="正在读取订单" />
    </SiteLayout>
  );
}

function LookupPage({ formKey, expired, paymentReturnLost }: { formKey: string; expired: boolean; paymentReturnLost: "failed" | "unknown" | null }) {
  useDocumentTitle("查订单 · NOZOMI 用车");
  return (
    <SiteLayout attribution={false}>
      <h1 className="site__title">查订单</h1>
      <p className="site-muted">输入订单号和下单时填的邮箱或手机号，就能查看订单、付款、取消或修改。</p>
      <LookupForm key={formKey} expired={expired} paymentReturnLost={paymentReturnLost} />
    </SiteLayout>
  );
}

/** 这个地址要看哪张单：地址里的令牌优先，其次是这条历史记录的 state。银行回跳的参数和没有令牌的情况在这里处理，有令牌才交给 `OrderView`。 */
export function OrderPage() {
  const location = useLocation();
  const hashToken = siteTokenFromHash(location.hash);
  const arrival = location.state as Arrival | null;
  const hashText = location.hash.replace(/^#/, "").trim();
  // 地址里没有 `#` 时，令牌可能在这条历史记录的 state 里（要挂 Stripe 表单时从地址移过去的）。地址上有 `#` 就只认地址：客人贴了别的链接
  const heldToken = hashText === "" && arrival?.orderToken !== undefined ? siteTokenFromHash(arrival.orderToken) : null;
  const token = hashToken ?? heldToken;
  // `#` 后面有内容却不是令牌的格式（被截断、改坏）：和失效的链接一样提示，不说是哪种失效（页面规范第 6 节）
  const malformed = token === null && hashText !== "";
  const navigate = useNavigate();
  const carriesReturn = hasPaymentReturnParams(location.search);
  const handledReturn = useRef(false);

  // 地址带着银行回跳的参数（其中有 client_secret）：不管手里有没有令牌，都先去掉参数、删掉 sessionStorage 里的记录，再往下走；参数在地址上时不挂表单。
  // 令牌取回了，放回地址（要挂表单时 `OrderView` 再移走）；取不回就去「查订单」。参数不合格的（不是从银行回来的）只清掉，不提示
  useEffect(() => {
    if (!carriesReturn) {
      handledReturn.current = false;
      return;
    }
    if (handledReturn.current) return;
    handledReturn.current = true;
    const params = paymentReturnParams(location.search);
    const failed = params?.redirectStatus === "failed";
    const saved = params === null ? null : takePaymentReturn(params.intentId);
    forgetPaymentReturn();
    if (hashToken !== null) navigate(siteOrderUrl(hashToken), { replace: true, state: { ...arrival, paymentReturnFailed: failed } });
    else if (heldToken !== null) navigate(SITE_ORDER_PATH, { replace: true, state: { ...arrival, paymentReturnFailed: failed } });
    else if (saved !== null && siteTokenFromHash(saved) !== null) navigate(siteOrderUrl(saved), { replace: true, state: { paymentReturnFailed: failed } });
    else navigate(SITE_ORDER_PATH, { replace: true, state: params === null ? null : { paymentReturnLost: failed ? "failed" : "unknown" } });
  }, [carriesReturn, location.search, hashToken, heldToken, navigate]);

  if (carriesReturn) return <OrderLoading />;
  if (token === null) {
    return <LookupPage formKey={malformed ? "malformed" : arrival?.paymentReturnLost !== undefined ? `return-lost-${arrival.paymentReturnLost}` : "none"} expired={malformed} paymentReturnLost={arrival?.paymentReturnLost ?? null} />;
  }
  // 按令牌给 key：订单数据、付款表单、提示都属于这一个令牌。换令牌时整个卸载（Stripe 表单跟着拆掉），新的令牌从「正在读取」开始，上一张单的任何东西都留不下来
  return <OrderView key={token} token={token} hashToken={hashToken} heldToken={heldToken} arrival={arrival} />;
}

/** 一个令牌对应的订单页。只能通过 `key={token}` 挂载：这里的状态全部属于这个令牌。 */
function OrderView({ token, hashToken, heldToken, arrival }: { token: string; hashToken: string | null; heldToken: string | null; arrival: Arrival | null }) {
  const navigate = useNavigate();
  const { state: config } = useSiteConfig();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [round, setRound] = useState(0);
  // 这次看页面时订单从「待付款」变成了已确认（客人刚在这里付完款）：顶部说一句，付款区块消失后客人知道结果
  const [justPaid, setJustPaid] = useState(false);
  const lastStatus = useRef<string | null>(null);
  // 客人在排第一的区块里刚做完事（点了「我已落地」、提了异议）：这次看页面时它留在原位，结果提示不会跟着区块跑到下面去
  const [pinned, setPinned] = useState<OrderSectionKey | null>(null);
  const orderNo = loaded.kind === "ready" ? loaded.envelope.order.order_no : null;
  useDocumentTitle(orderNo === null ? "查订单 · NOZOMI 用车" : `订单 ${orderNo} · NOZOMI 用车`);

  const pendingOrder = loaded.kind === "ready" && loaded.envelope.order.status === "pending_payment";
  // 这个页面会挂 Stripe 表单：待付款、并且配了 Stripe
  const payable = pendingOrder && config.kind === "ready" && config.config.payments !== null;
  // 不会挂表单：订单已经不是待付款，或没配 Stripe
  const notPayable = loaded.kind === "ready" && (!pendingOrder || (config.kind === "ready" && config.config.payments === null));

  // 令牌只在 Stripe.js 读不到地址的时候才放在地址里（ADR 0046）。付款区块在地址干净之前不挂表单，所以 Stripe.js 从头到尾读不到令牌；
  // Stripe.js 加载过的文档里不放回去（实测它在确认付款时还会重读地址），刷新后是新文档，订单不用付款了就放回去，地址栏又能复制链接
  useLayoutEffect(() => {
    if (hashToken !== null && (payable || stripeJsInPage())) {
      navigate(SITE_ORDER_PATH, { replace: true, state: { ...arrival, orderToken: hashToken } });
    } else if (heldToken !== null && notPayable && !stripeJsInPage()) {
      const { orderToken: _moved, ...rest } = arrival ?? {};
      navigate(siteOrderUrl(heldToken), { replace: true, state: rest });
    }
  }, [hashToken, heldToken, payable, notPayable, navigate]);

  useEffect(() => {
    let alive = true;
    getSiteOrder(token).then(
      (envelope) => {
        if (!alive) return;
        const status = envelope.order.status;
        if (lastStatus.current === "pending_payment" && status !== "pending_payment" && status !== "cancelled") setJustPaid(true);
        lastStatus.current = status;
        setLoaded({ kind: "ready", envelope });
      },
      (err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) setLoaded({ kind: "invalid" });
        else setLoaded({ kind: "failed", message: siteFailureText(err, "读取订单") });
      },
    );
    return () => {
      alive = false;
    };
  }, [token, round]);

  const refresh = useCallback(() => setRound((value) => value + 1), []);
  const replace = useCallback((envelope: SiteOrderEnvelope) => setLoaded({ kind: "ready", envelope }), []);
  const replaceKeeping = (section: OrderSectionKey) => (envelope: SiteOrderEnvelope) => {
    setPinned(section);
    replace(envelope);
  };

  if (loaded.kind === "invalid") return <LookupPage formKey={token} expired paymentReturnLost={null} />;
  if (loaded.kind === "loading") return <OrderLoading />;
  if (loaded.kind === "failed") {
    return (
      <SiteLayout attribution={false}>
        <h1 className="site__title">订单</h1>
        <StateBlock title="订单没有读出来" description={loaded.message} action={<Button size="lg" onClick={refresh}>重试</Button>} />
      </SiteLayout>
    );
  }

  const { order, timeline, names } = loaded.envelope;
  const payments = config.kind === "ready" ? config.config.payments : null;
  const supportPhone = config.kind === "ready" ? config.config.support_phone : null;
  const shareUrl = `${window.location.origin}${siteOrderUrl(token)}`;
  // 区块顺序（F1，pages/site-booking.md 5.1）：客人现在要做的那件事排在状态下面第一位，其余按默认顺序
  const computed = primaryOrderSection(order, new Date());
  const primary = pinned !== null && computed === "trip" ? pinned : computed;
  const sections: Readonly<Record<OrderSectionKey, ReactNode>> = {
    // 地址里的令牌还没移走（只差这一帧）：先按「还在读配置」显示占位，不挂表单
    payment: order.status === "pending_payment" && <PaymentSection token={token} order={order} configPayments={config.kind === "ready" && !(hashToken !== null && payable) ? payments : undefined} initial={arrival?.payment ?? null} returnFailed={arrival?.paymentReturnFailed === true} onRefresh={refresh} />,
    trip: <TripSection order={order} names={names} />,
    timeline: <TimelineSection order={order} timeline={timeline} />,
    driver: <DriverSection order={order} />,
    landing: <LandingSection token={token} order={order} onChanged={replaceKeeping("landing")} />,
    charges: <ExtraChargesSection token={token} order={order} onChanged={replaceKeeping("charges")} />,
    change: <ChangeSection token={token} order={order} onChanged={replace} />,
    cancel: <CancelSection token={token} order={order} onChanged={replace} />,
    feedback: <FeedbackSection token={token} order={order} />,
    help: <HelpSection order={order} phone={supportPhone} />,
  };
  return (
    <SiteLayout>
      <div className="site-order__head">
        <h1 className="site__title site-order__no">订单 {order.order_no}</h1>
        <StatusBadge {...GUEST_STATUS_BADGES[order.status]} />
      </div>
      <div role="status">{justPaid && <Alert kind="success">付款成功，订单已确认。派车后这里会显示司机和车辆。</Alert>}</div>
      {arrival?.placed === true && (
        <Alert kind="success">
          <p>{hashToken === null ? "订单已提交。请复制下面的链接保存，之后凭这个链接查看订单；也可以随时用订单号和邮箱在「查订单」里找到它。" : "订单已提交。请收藏这个页面，之后凭这个链接查看订单；也可以随时用订单号和邮箱在「查订单」里找到它。"}</p>
          <ShareLink url={shareUrl} />
        </Alert>
      )}
      {hashToken === null && arrival?.placed !== true && <HiddenLinkNote url={shareUrl} />}
      {/* 区块按订单编号区分：同一个标签页换成另一张单的链接时，展开的表单、确认框都重新开始，不带上一张单的内容 */}
      {orderSectionSequence(primary).map((key) => (
        <Fragment key={`${order.id}-${key}`}>{sections[key]}</Fragment>
      ))}
    </SiteLayout>
  );
}
