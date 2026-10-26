/**
 * 官网订单页（M3-05，ADR 0032）：客人凭链接（`/book/order#<令牌>`）看自己的这一张单——状态时间线、行程、付款、司机和车辆（派车后）、
 * 「我已落地」（接机）、取消（先看按政策退多少）、改单、事后加收和异议。令牌只在地址的 `#` 后面和请求头里，不存进任何存储。
 * 没有令牌（直接打开「查订单」）或令牌失效：用订单号 + 下单时的邮箱或手机号找回，换一个新链接。
 */
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteOrderEnvelope, type SitePayment, getSiteOrder, lookupSiteOrder } from "../../api/site.ts";
import { AlertSlot, Alert, type Notice } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { CopyButton } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { TextField } from "../../components/TextField.tsx";
import { GUEST_STATUS_BADGES, siteOrderUrl, siteTokenFromHash } from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { CancelSection, ChangeSection, DriverSection, ExtraChargesSection, LandingSection, PaymentSection, TimelineSection, TripSection } from "./OrderSections.tsx";
import { SiteLayout, siteFailureText, useSiteConfig } from "./SiteLayout.tsx";

/** 找回被限速（可能是这个订单号被别人试了太多次，要等几个小时）：告诉客人等多久，也可以联系客服。 */
export function lookupThrottledText(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || retryAfterSeconds <= 0) return "尝试次数过多，请稍后再试，或联系客服。";
  const wait = retryAfterSeconds < 60 ? `${retryAfterSeconds} 秒` : retryAfterSeconds < 3600 ? `${Math.ceil(retryAfterSeconds / 60)} 分钟` : `${Math.ceil(retryAfterSeconds / 3600)} 小时`;
  return `尝试次数过多，请 ${wait}后再试，或联系客服。`;
}

function LookupForm({ expired }: { expired: boolean }) {
  const navigate = useNavigate();
  const [orderNo, setOrderNo] = useState("");
  const [contact, setContact] = useState("");
  const [errors, setErrors] = useState<{ orderNo?: string; contact?: string }>({});
  const [notice, setNotice] = useState<Notice | null>(expired ? { kind: "warning", text: "订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。" } : null);
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
      setNotice({ kind: "danger", text: err instanceof ApiError && err.code === "ORDER_NOT_FOUND" ? "没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号。" : err instanceof ApiError && err.status === 429 ? lookupThrottledText(err.retryAfterSeconds) : siteFailureText(err, "查找订单") });
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

type Loaded = { kind: "loading" } | { kind: "invalid" } | { kind: "failed"; message: string } | { kind: "ready"; envelope: SiteOrderEnvelope };

export function OrderPage() {
  const location = useLocation();
  const token = siteTokenFromHash(location.hash);
  const arrival = location.state as { placed?: boolean; payment?: SitePayment | null } | null;
  const { state: config } = useSiteConfig();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [round, setRound] = useState(0);
  const orderNo = loaded.kind === "ready" ? loaded.envelope.order.order_no : null;
  useDocumentTitle(orderNo === null ? "查订单 · NOZOMI 用车" : `订单 ${orderNo} · NOZOMI 用车`);

  useEffect(() => {
    if (token === null) return;
    let alive = true;
    setLoaded((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    getSiteOrder(token).then(
      (envelope) => alive && setLoaded({ kind: "ready", envelope }),
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

  if (token === null || loaded.kind === "invalid") {
    return (
      <SiteLayout attribution={false}>
        <h1 className="site__title">查订单</h1>
        <p className="site-muted">输入订单号和下单时填的邮箱或手机号，就能查看订单、付款、取消或修改。</p>
        <LookupForm key={token ?? "none"} expired={loaded.kind === "invalid"} />
      </SiteLayout>
    );
  }
  if (loaded.kind === "loading") {
    return (
      <SiteLayout attribution={false}>
        <h1 className="site__title">订单</h1>
        <Skeleton lines={["medium", "long", "long", "control"]} label="正在读取订单" />
      </SiteLayout>
    );
  }
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
  const shareUrl = `${window.location.origin}${siteOrderUrl(token)}`;
  return (
    <SiteLayout>
      <div className="site-order__head">
        <h1 className="site__title site-order__no">订单 {order.order_no}</h1>
        <StatusBadge {...GUEST_STATUS_BADGES[order.status]} />
      </div>
      {arrival?.placed === true && (
        <Alert kind="success">
          <p>订单已提交。请收藏这个页面，之后凭这个链接查看订单；也可以随时用订单号和邮箱在「查订单」里找到它。</p>
          <p className="site-share">
            <span className="site-share__url">{shareUrl}</span>
            <CopyButton text={shareUrl} label="复制订单链接" />
          </p>
        </Alert>
      )}
      {order.status === "pending_payment" && <PaymentSection token={token} order={order} configPayments={config.kind === "ready" ? payments : undefined} initial={arrival?.payment ?? null} onPaid={refresh} />}
      <TripSection order={order} names={names} />
      <TimelineSection order={order} timeline={timeline} />
      <DriverSection order={order} />
      <LandingSection token={token} order={order} onChanged={replace} />
      <ExtraChargesSection token={token} order={order} onChanged={replace} />
      <ChangeSection token={token} order={order} onChanged={replace} />
      <CancelSection token={token} order={order} onChanged={replace} />
    </SiteLayout>
  );
}
