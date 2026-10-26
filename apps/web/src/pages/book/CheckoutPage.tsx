/**
 * 官网下单页（M3-05，ADR 0032）：核对行程和价格，填乘客、航班号（接机必填）、地址、即时通讯（选填）、备注，
 * 勾选同意保存支付方式（服务后的超时、超公里等费用用它补扣，第五轮决策 ⑤），提交后到订单页付款。
 * 选中的报价从询价页带过来；直接打开这一页（刷新、收藏）没有报价，提示回去重新查询。
 * 提交用一个幂等键：网络失败再点一次不会下出两张单；改了内容就换一个新的。
 */
import { MESSAGING_APPS, type MessagingApp, isFlightNo, isInternationalPhone } from "@nozomi/domain";
import { type FormEvent, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type SiteOrderRequest, createSiteOrder } from "../../api/site.ts";
import { AlertSlot, type Notice } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { SITE_HOME_PATH, guestCancelPolicyText, guestInstantText, guestLocalText, newIdempotencyKey, siteOrderUrl } from "../../lib/site-display.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import type { CheckoutState } from "./BookPage.tsx";
import { SiteLayout, siteFailureText } from "./SiteLayout.tsx";

const MESSAGING_NAMES: Readonly<Record<MessagingApp, string>> = { whatsapp: "WhatsApp", line: "LINE", wechat: "微信", kakaotalk: "KakaoTalk" };

interface Form {
  name: string;
  phone: string;
  email: string;
  flightNo: string;
  address: string;
  messagingApp: MessagingApp | "";
  messagingHandle: string;
  notes: string;
  consent: boolean;
}

type Field = "name" | "phone" | "email" | "flightNo" | "address" | "messagingHandle" | "notes" | "consent";
type Errors = Partial<Record<Field, string>>;

const SERVER_PATHS: Readonly<Record<string, Field>> = {
  "/passenger/name": "name",
  "/passenger/phone": "phone",
  "/passenger/email": "email",
  "/flight_no": "flightNo",
  "/pickup_address": "address",
  "/dropoff_address": "address",
  "/messaging/handle": "messagingHandle",
  "/notes": "notes",
  "/save_payment_method": "consent",
};

function validate(form: Form, pickup: boolean): Errors {
  const errors: Errors = {};
  if (form.name.trim() === "") errors.name = "请填写乘车人姓名";
  if (!isInternationalPhone(form.phone.trim())) errors.phone = "请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = "请填写正确的邮箱，订单确认和查看链接会发到这里";
  if (pickup && form.flightNo.trim() === "") errors.flightNo = "接机要填航班号，司机按航班落地时间等候";
  if (form.flightNo.trim() !== "" && !isFlightNo(form.flightNo)) errors.flightNo = "航班号的格式不对，如 NH211、MU523";
  if (form.address.trim() === "") errors.address = pickup ? "请填写下车的地址或酒店名" : "请填写上车的地址或酒店名";
  if (form.messagingApp !== "" && form.messagingHandle.trim() === "") errors.messagingHandle = "选了即时通讯就要填账号";
  if (!form.consent) errors.consent = "需要同意保存支付方式才能下单";
  return errors;
}

export function CheckoutPage() {
  useDocumentTitle("填写订单 · NOZOMI 用车");
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as CheckoutState | null;
  const pickup = state?.draft.direction !== "dropoff";
  const [form, setForm] = useState<Form>({ name: "", phone: "", email: "", flightNo: "", address: state?.draft.address ?? "", messagingApp: "", messagingHandle: "", notes: "", consent: false });
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  if (state === null || state.quote === undefined) {
    return (
      <SiteLayout>
        <h1 className="site__title">填写订单</h1>
        <StateBlock tone="neutral" title="还没有选车" description="请先查询价格、选好车型再来填写订单。" action={<LinkButton to={SITE_HOME_PATH} variant="primary" size="lg">去查询价格</LinkButton>} />
      </SiteLayout>
    );
  }
  const { quote, draft, city, airport } = state;
  const group = displayName(quote.vehicle_group.name);
  const airportName = `${displayName(airport.name).text}（${airport.code}）`;
  const update = (changes: Partial<Form>): void => {
    setForm((current) => ({ ...current, ...changes }));
    key.current = null;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validate(form, pickup);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      return;
    }
    setNotice(null);
    const address = form.address.trim();
    const body: SiteOrderRequest = {
      quote_id: quote.quote_id,
      passenger: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() },
      flight_no: form.flightNo.trim() === "" ? null : form.flightNo.trim(),
      pickup_address: pickup ? null : address,
      dropoff_address: pickup ? address : null,
      messaging: form.messagingApp === "" ? null : { app: form.messagingApp, handle: form.messagingHandle.trim() },
      notes: form.notes.trim() === "" ? null : form.notes.trim(),
      save_payment_method: form.consent,
    };
    key.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const created = await createSiteOrder(body, key.current);
      navigate(siteOrderUrl(created.link.token), { state: { placed: true, payment: created.payment } });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "QUOTE_EXPIRED" || err.code === "QUOTE_ALREADY_ORDERED" || err.code === "QUOTE_NO_LONGER_AVAILABLE" || err.code === "SOLD_OUT")) {
        setExpired(true);
        setNotice({ kind: "warning", text: err.code === "QUOTE_EXPIRED" ? "报价已经过了 30 分钟的有效期，请重新查询价格。" : err.code === "QUOTE_ALREADY_ORDERED" ? "这个报价已经下过单了。要再订一辆，请重新查询价格。" : "这辆车刚刚被订完或暂停预订了，请重新查询价格。" });
        return;
      }
      if (err instanceof ApiError && err.code === "VALIDATION_FAILED") {
        const issues = Array.isArray(err.details["issues"]) ? (err.details["issues"] as { path?: string; message?: string }[]) : [];
        const mapped: Errors = {};
        for (const issue of issues) {
          const field = SERVER_PATHS[issue.path ?? ""];
          if (field !== undefined && issue.message) mapped[field] = issue.message;
        }
        setErrors(mapped);
        setNotice({ kind: "danger", text: Object.keys(mapped).length > 0 ? "有几项没有通过检查，请看标红的地方。" : "提交的内容不符合要求，请检查后重试。" });
        return;
      }
      setNotice({ kind: "danger", text: `${siteFailureText(err, "提交订单")}${err instanceof ApiError && err.status >= 500 ? "再点一次「提交订单」不会重复下单。" : ""}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SiteLayout>
      <h1 className="site__title">填写订单</h1>
      <section className="site-section site-summary" aria-labelledby="site-summary-title">
        <h2 id="site-summary-title" className="site-section__title">
          行程
        </h2>
        <dl className="site-facts">
          <div className="site-facts__item">
            <dt>{pickup ? "接机" : "送机"}</dt>
            <dd>{pickup ? `${airportName} → ${draft.address}` : `${draft.address} → ${airportName}`}</dd>
          </div>
          <div className="site-facts__item">
            <dt>{pickup ? "航班计划到达" : "上车时间"}</dt>
            <dd>
              {guestLocalText(`${draft.date}T${draft.time}`, city.timezone, new Date())}（{displayName(city.name).text}当地时间）
            </dd>
          </div>
          <div className="site-facts__item">
            <dt>车型</dt>
            <dd lang={group.lang}>{group.text}</dd>
          </div>
          <div className="site-facts__item">
            <dt>人数 / 行李</dt>
            <dd>
              {draft.passengers} 人 / {draft.luggage} 件
            </dd>
          </div>
          <div className="site-facts__item">
            <dt>总价（按车计价，已含高速费和停车费）</dt>
            <dd className="site-price">{moneyText(quote.price.total)}</dd>
          </div>
          <div className="site-facts__item">
            <dt>取消政策</dt>
            <dd>{guestCancelPolicyText(quote.cancel_policy.tiers)}</dd>
          </div>
        </dl>
        <p className="site-muted">报价有效到当地时间 {guestInstantText(quote.expires_at, city.timezone, new Date())}。</p>
        <LinkButton to={SITE_HOME_PATH} state={{ draft }} variant="text">
          返回修改行程
        </LinkButton>
      </section>

      <form className="site-form" noValidate onSubmit={(event) => void submit(event)}>
        <h2 className="site-section__title">乘车人和联系方式</h2>
        <AlertSlot notice={notice} />
        <TextField label="乘车人姓名" size="lg" required autoComplete="name" value={form.name} errors={errors.name ? [errors.name] : []} onChange={(event) => update({ name: event.target.value })} />
        <TextField label="手机号（带国家码）" size="lg" required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} errors={errors.phone ? [errors.phone] : []} hint="以 + 和国家码开头，如 +81 90-1234-5678。司机和客服用它联系您" onChange={(event) => update({ phone: event.target.value })} />
        <TextField label="邮箱" size="lg" required type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={form.email} errors={errors.email ? [errors.email] : []} hint="以后可以用订单号和这个邮箱查找订单" onChange={(event) => update({ email: event.target.value })} />
        <TextField label={pickup ? "航班号" : "航班号（选填）"} size="lg" required={pickup} autoCapitalize="characters" value={form.flightNo} errors={errors.flightNo ? [errors.flightNo] : []} hint={pickup ? "如 NH211。航班延误时司机按实际落地时间等候" : "如 NH211"} onChange={(event) => update({ flightNo: event.target.value })} />
        <TextField label={pickup ? "下车地址或酒店名" : "上车地址或酒店名"} size="lg" required value={form.address} errors={errors.address ? [errors.address] : []} hint="写给司机看的，酒店名或详细地址" onChange={(event) => update({ address: event.target.value })} />
        <div className="site-form__row">
          <SelectField<MessagingApp | "">
            label="即时通讯（选填）"
            placeholder="不填"
            value={form.messagingApp}
            options={MESSAGING_APPS.map((app) => ({ value: app, label: MESSAGING_NAMES[app] }))}
            onChange={(messagingApp) => update({ messagingApp })}
          />
          <TextField label="即时通讯账号" size="lg" disabled={form.messagingApp === ""} value={form.messagingHandle} errors={errors.messagingHandle ? [errors.messagingHandle] : []} onChange={(event) => update({ messagingHandle: event.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="site-notes">
            备注（选填）
          </label>
          <textarea id="site-notes" className="input textarea" rows={3} maxLength={2000} value={form.notes} onChange={(event) => update({ notes: event.target.value })} />
        </div>
        <div className="field">
          <label className="choice site-consent">
            <input type="checkbox" checked={form.consent} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "site-consent-error site-consent-help" : "site-consent-help"} onChange={(event) => update({ consent: event.target.checked })} />
            <span className="choice__text">同意保存这次付款用的银行卡，用于服务后产生的费用（如超时等候）</span>
          </label>
          <p className="field__hint" id="site-consent-help">
            服务后的费用会先通知您，48 小时内可以在订单页提异议；没有异议才会扣款。
          </p>
          {errors.consent && (
            <p className="field__error" id="site-consent-error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{errors.consent}</span>
            </p>
          )}
        </div>
        <div className="site-actions">
          {expired ? (
            <LinkButton to={SITE_HOME_PATH} state={{ draft }} variant="primary" size="lg" block>
              重新查询价格
            </LinkButton>
          ) : (
            <Button type="submit" variant="primary" size="lg" block loading={busy} loadingText="正在提交">
              提交订单（{moneyText(quote.price.total)}）
            </Button>
          )}
        </div>
      </form>
    </SiteLayout>
  );
}
