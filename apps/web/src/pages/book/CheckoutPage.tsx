/**
 * 官网下单页（M3-05，ADR 0032；M3-10 加上点对点、包车）：核对行程和价格，填乘客、航班号（只有接送机有，接机必填）、
 * 地址（接送机是机场之外的那一端，点对点两端，包车上车点）、即时通讯（选填）、备注，
 * 勾选同意保存支付方式（服务后的超时、超公里等费用用它补扣，第五轮决策 ⑤），提交后到订单页付款。
 * 选中的报价从询价页带过来；直接打开这一页（刷新、收藏）没有报价，提示回去重新查询。
 * 提交用一个幂等键：网络失败再点一次不会下出两张单；改了内容就换一个新的。
 */
import { MESSAGING_APPS, type MessagingApp, ORDER_FIELD_LIMITS } from "@nozomi/domain";
import { type FormEvent, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { createSiteOrder } from "../../api/site.ts";
import { AlertSlot, type Notice } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { SelectField } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StateBlock } from "../../components/States.tsx";
import { TextField } from "../../components/TextField.tsx";
import { VehicleLabelItems } from "../../components/VehicleLabelFacts.tsx";
import { moneyText } from "../../lib/dispatch-display.ts";
import { displayName } from "../../lib/master-display.ts";
import { ADDRESS_LABELS, SITE_HOME_PATH, addressEnds, guestCancelPolicyText, guestInstantText, guestLocalText, newIdempotencyKey, packageText, priceNote, serviceTimeLabels, siteOrderUrl } from "../../lib/site-display.ts";
import { ADDRESS_FIELDS, CONSENT_HELP, CONSENT_TEXT, FIELD_HINTS, MESSAGING_NAMES, type OrderErrors, type OrderForm, orderFailureOf, orderRequestOf, validateOrderForm } from "../../lib/site-order-form.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import type { CheckoutState } from "./BookPage.tsx";
import { SiteLayout, siteFailureText } from "./SiteLayout.tsx";
import { SitePrice } from "./SitePrice.tsx";

type Form = OrderForm;

export function CheckoutPage() {
  useDocumentTitle("填写订单 · NOZOMI 用车");
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as CheckoutState | null;
  const draftOk = state !== null && state.quote !== undefined && typeof state.draft?.from === "object";
  const category = draftOk ? state.draft.category : "airport_transfer";
  const direction = draftOk && category === "airport_transfer" ? state.draft.direction : null;
  const transfer = category === "airport_transfer";
  const arrival = transfer && direction === "pickup";
  const ends = addressEnds(category, direction);
  const prefill = (end: "pickup" | "dropoff"): string => {
    if (!draftOk || !ends.includes(end)) return "";
    const { draft } = state;
    if (transfer) return draft.address.address;
    return end === "pickup" ? draft.from.address : draft.to.address;
  };
  const [form, setForm] = useState<Form>({ name: "", phone: "", email: "", flightNo: "", pickupAddress: prefill("pickup"), dropoffAddress: prefill("dropoff"), messagingApp: "", messagingHandle: "", notes: "", consent: false });
  const [errors, setErrors] = useState<OrderErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  if (!draftOk) {
    return (
      <SiteLayout>
        <h1 className="site__title">填写订单</h1>
        <StateBlock tone="neutral" title="还没有选车" description="请先查询价格、选好车型再来填写订单。" action={<LinkButton to={SITE_HOME_PATH} variant="primary" size="lg">去查询价格</LinkButton>} />
      </SiteLayout>
    );
  }
  const { quote, draft, city, airport } = state;
  const group = displayName(quote.vehicle_group.name);
  const airportName = airport === null ? "机场" : `${displayName(airport.name).text}（${airport.code}）`;
  const labels = serviceTimeLabels(category, direction);
  let route: { label: string; text: string };
  if (transfer) route = arrival ? { label: "接机", text: `${airportName} → ${draft.address.address}` } : { label: "送机", text: `${draft.address.address} → ${airportName}` };
  else if (category === "point_to_point") route = { label: "点对点", text: `${draft.from.address} → ${draft.to.address}` };
  else route = { label: "包车上车点", text: draft.from.address };
  const update = (changes: Partial<Form>): void => {
    setForm((current) => ({ ...current, ...changes }));
    key.current = null;
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const trip = { transfer, arrival, ends };
    const found = validateOrderForm(form, trip);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setNotice({ kind: "danger", text: "有几项没有填好，请看标红的地方。" });
      return;
    }
    setNotice(null);
    const body = orderRequestOf(quote.quote_id, form, trip);
    key.current ??= newIdempotencyKey();
    setBusy(true);
    try {
      const created = await createSiteOrder(body, key.current);
      navigate(siteOrderUrl(created.link.token), { state: { placed: true, payment: created.payment } });
    } catch (err) {
      const failure = orderFailureOf(err);
      if (failure.kind === "expired") {
        setExpired(true);
        setNotice({ kind: "warning", text: failure.text });
        return;
      }
      if (failure.kind === "fields") {
        setErrors(failure.errors);
        setNotice({ kind: "danger", text: failure.text });
        return;
      }
      setNotice({ kind: "danger", text: `${siteFailureText(err, "提交订单")}${failure.retrySafe ? "再点一次「提交订单」不会重复下单。" : ""}` });
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
            <dt>{route.label}</dt>
            <dd>{route.text}</dd>
          </div>
          {quote.package !== null && (
            <div className="site-facts__item">
              <dt>包车套餐</dt>
              <dd>{packageText(quote.package.hours, quote.package.km)}</dd>
            </div>
          )}
          <div className="site-facts__item">
            <dt>{labels.fact}</dt>
            <dd>
              {guestLocalText(`${draft.date}T${draft.time}`, city.timezone, new Date())}（{displayName(city.name).text}当地时间）
            </dd>
          </div>
          <div className="site-facts__item">
            <dt>车型</dt>
            <dd lang={group.lang}>{group.text}</dd>
          </div>
          <VehicleLabelItems group={quote.vehicle_group} itemClassName="site-facts__item" />
          <div className="site-facts__item">
            <dt>人数 / 行李</dt>
            <dd>
              {draft.passengers} 人 / {draft.luggage} 件
            </dd>
          </div>
          <div className="site-facts__item site-facts__item--total">
            <dt>{category === "charter" ? "总价（按车计价的套餐价，已含高速费和停车费）" : "总价（按车计价，已含高速费和停车费）"}</dt>
            <dd>
              <SitePrice text={moneyText(quote.price.total)} size="lg" />
            </dd>
          </div>
          <div className="site-facts__item">
            <dt>取消政策</dt>
            <dd>{guestCancelPolicyText(quote.cancel_policy.tiers)}</dd>
          </div>
        </dl>
        <p className="site-muted">
          {priceNote(category)}报价有效到当地时间 {guestInstantText(quote.expires_at, city.timezone, new Date())}。
        </p>
        <LinkButton to={SITE_HOME_PATH} state={{ draft }} variant="text">
          返回修改行程
        </LinkButton>
      </section>

      <form className="site-form site-section" noValidate onSubmit={(event) => void submit(event)}>
        <h2 className="site-section__title">乘车人和联系方式</h2>
        <AlertSlot notice={notice} />
        <TextField label="乘车人姓名" size="lg" required autoComplete="name" value={form.name} errors={errors.name ? [errors.name] : []} onChange={(event) => update({ name: event.target.value })} />
        <TextField label="手机号（带国家码）" size="lg" required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} errors={errors.phone ? [errors.phone] : []} hint={FIELD_HINTS.phone} onChange={(event) => update({ phone: event.target.value })} />
        <TextField label="邮箱" size="lg" required type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={form.email} errors={errors.email ? [errors.email] : []} hint={FIELD_HINTS.email} onChange={(event) => update({ email: event.target.value })} />
        {transfer && (
          <TextField label={arrival ? "航班号" : "航班号（选填）"} size="lg" required={arrival} autoCapitalize="characters" value={form.flightNo} errors={errors.flightNo ? [errors.flightNo] : []} hint={arrival ? FIELD_HINTS.arrivalFlight : "如 NH211"} onChange={(event) => update({ flightNo: event.target.value })} />
        )}
        {ends.map((end) => {
          const field = ADDRESS_FIELDS[end];
          const error = errors[field];
          return <TextField key={end} label={ADDRESS_LABELS[end]} size="lg" required value={form[field]} errors={error ? [error] : []} hint="写给司机看的，酒店名或详细地址" onChange={(event) => update({ [field]: event.target.value })} />;
        })}
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
          <textarea id="site-notes" className="input textarea" rows={3} maxLength={ORDER_FIELD_LIMITS.notesMax} value={form.notes} onChange={(event) => update({ notes: event.target.value })} />
        </div>
        <div className="field">
          <label className="choice site-consent">
            <input type="checkbox" checked={form.consent} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "site-consent-error site-consent-help" : "site-consent-help"} onChange={(event) => update({ consent: event.target.checked })} />
            <span className="choice__text">{CONSENT_TEXT}</span>
          </label>
          <p className="field__hint" id="site-consent-help">
            {CONSENT_HELP}
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
