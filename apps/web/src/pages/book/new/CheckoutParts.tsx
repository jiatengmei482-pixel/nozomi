/**
 * 新预订页右侧栏（手机第 3 步顶部）的几块和「怎么联系你」（M8-04，ADR 0069「修正版 v2」「B15 / B16 → A」；规范 site-booking-v2.md 5、6）：
 * - 路线：谷歌静态地图（M8-10，后端出图；没开通时退回现有底图画折线）+「约 X 分钟 · Y 公里」；取不到路线不显示；
 * - 附加服务：报价给的这个车型能加的（`available_addons`），每项 − 0 +；改了数量页面带 `addons` 重新报价，这里只显示「合计差额」，不另算单价；
 * - 车费、合计（订单币种）、参考价「≈ 客人币种」（汇率不可用时不显示）、取消规则、去付款、支付方式（只有银行卡）；
 * - 「怎么联系你」：字段、校验、下单和旧下单页同一套（`lib/site-order-form.ts`）。
 * 页面上没有供应商、结算价、加价比例、附加服务单价。
 */
import { FX_CURRENCIES, MESSAGING_APPS, type MessagingApp, ORDER_FIELD_LIMITS } from "@nozomi/domain";
import type { FormEvent, ReactNode } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import type { SiteAddonOption, SiteFxReference, SiteMoney, SiteRoutePreview } from "../../../api/site.ts";
import { AlertSlot, type Notice } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { ADDON_QUANTITY, FX_REFERENCE_NOTE, type TripPoint, decodePolyline, referenceMoney, routeSummaryText } from "../../../lib/book-new.ts";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { CONSENT_HELP, CONSENT_TEXT, FIELD_HINTS, MESSAGING_NAMES, type OrderErrors } from "../../../lib/site-order-form.ts";
import { SitePrice } from "../SitePrice.tsx";
import { RoutePicture } from "./StaticRouteMap.tsx";
import { Stepper } from "./TravellersField.tsx";

export const CONTACT_FORM_ID = "book-contact-form";

/**
 * 路线：谷歌静态地图（M8-10，后端出图）+「约 X 分钟 · Y 公里」；平台还没开通静态地图时退回现有底图画折线（有折线和底图才画）；
 * 图出不来只写字；取不到路线（null）整块不显示。
 */
export function RouteBlock({ route, tiles, from, to }: { route: SiteRoutePreview | null; tiles: MapTiles | null; from: TripPoint; to: TripPoint }) {
  if (route === null) return null;
  const points = route.polyline === null ? [] : decodePolyline(route.polyline);
  const text = routeSummaryText(route.minutes, route.meters);
  return (
    <div className="book-summary__block">
      <RoutePicture from={from} to={to} points={points} tiles={tiles} label={`路线图：${from.name} → ${to.name}，${text}`} />
      <p className="book-summary__route">
        <Icon name="clock" />
        <span>{text}</span>
      </p>
    </div>
  );
}

/** 附加服务（选填）：每项 − 0 +；按单计的最多 1 个。 */
export function AddonsBlock({ options, quantities, onChange }: { options: readonly SiteAddonOption[]; quantities: Readonly<Record<string, number>>; onChange(id: string, quantity: number): void }) {
  if (options.length === 0) return null;
  return (
    <section className="book-summary__block book-addons" aria-labelledby="book-addons-title">
      <h3 id="book-addons-title" className="book-new__subtitle">
        附加服务（选填）
      </h3>
      {options.map((option) => {
        const name = displayName(option.name);
        return <Stepper key={option.id} label={name.text} value={quantities[option.id] ?? 0} min={0} max={option.charge_unit === "per_order" ? ADDON_QUANTITY.perOrderMax : ADDON_QUANTITY.max} onChange={(quantity) => onChange(option.id, quantity)} />;
      })}
    </section>
  );
}

export type PricedState = { kind: "ready"; total: SiteMoney; difference: SiteMoney | null } | { kind: "loading" } | { kind: "unavailable" } | { kind: "failed"; message: string };

/** 车费、附加服务（合计差额）、合计、参考价。 */
export function PriceBlock({
  fare,
  priced,
  currency,
  onCurrency,
  reference,
}: {
  fare: SiteMoney;
  priced: PricedState;
  currency: string;
  onCurrency(currency: string): void;
  reference: SiteFxReference | null;
}) {
  const approx = priced.kind === "ready" && reference !== null && reference.to !== priced.total.currency ? referenceMoney(priced.total, reference) : null;
  return (
    <div className="book-summary__block">
      <dl className="book-prices">
        <div className="book-prices__row">
          <dt>车费</dt>
          <dd>{moneyText(fare)}</dd>
        </div>
        {priced.kind === "ready" && priced.difference !== null && (
          <div className="book-prices__row">
            <dt>附加服务（合计差额）</dt>
            <dd>+{moneyText(priced.difference)}</dd>
          </div>
        )}
        <div className="book-prices__row book-prices__row--total">
          <dt>合计</dt>
          <dd>
            {priced.kind === "ready" && <SitePrice text={moneyText(priced.total)} size="lg" />}
            {priced.kind === "loading" && <span className="site-muted">正在重新计算…</span>}
            {priced.kind === "unavailable" && <span>这个车型现在加不了所选的附加服务，请减少附加服务或换一个车型。</span>}
            {priced.kind === "failed" && <span>{priced.message}</span>}
          </dd>
        </div>
      </dl>
      {approx !== null && (
        <p className="book-prices__approx">
          ≈ {moneyText(approx)}
          <span className="book-prices__note">{FX_REFERENCE_NOTE}</span>
        </p>
      )}
      <SelectField label="参考币种" value={currency} options={FX_CURRENCIES.map((code) => ({ value: code, label: code }))} hint="只影响参考价，实际按订单币种付款" onChange={onCurrency} />
    </div>
  );
}

/** 去付款（提交「怎么联系你」）和支付方式；报价过期时换成「重新查询价格」。 */
export function PayBlock({ busy, expired, onRequote }: { busy: boolean; expired: boolean; onRequote(): void }) {
  return (
    <div className="book-summary__block book-pay">
      {expired ? (
        <Button variant="primary" size="lg" block onClick={onRequote}>
          重新查询价格
        </Button>
      ) : (
        <Button type="submit" form={CONTACT_FORM_ID} variant="primary" size="lg" block loading={busy} loadingText="正在提交">
          去付款 →
        </Button>
      )}
      <p className="book-pay__methods">
        <span>支付方式：</span>
        <span className="book-pay__method">
          <Icon name="credit-card" />
          银行卡
        </span>
      </p>
    </div>
  );
}

export interface ContactForm {
  name: string;
  phone: string;
  email: string;
  messagingApp: MessagingApp | "";
  messagingHandle: string;
  notes: string;
  consent: boolean;
}

export const emptyContact = (): ContactForm => ({ name: "", phone: "", email: "", messagingApp: "", messagingHandle: "", notes: "", consent: false });

/** 「怎么联系你」：乘车人姓名、邮箱、手机号（含国家区号）、即时通讯（选填）、给司机的备注（选填）、同意保存银行卡。 */
export function ContactSection({
  form,
  errors,
  notice,
  onChange,
  onSubmit,
  extra,
  actions,
}: {
  form: ContactForm;
  errors: OrderErrors;
  notice: Notice | null;
  onChange(changes: Partial<ContactForm>): void;
  onSubmit(event: FormEvent): void;
  /** 手机第 3 步：接机的航班号（行程那一块这时不在屏幕上） */
  extra?: ReactNode;
  /** 手机：吸底的「去付款 →」；电脑放在右侧栏 */
  actions?: ReactNode;
}) {
  return (
    <section aria-labelledby="book-contact-title" className="site-section book-new__contact">
      <h2 id="book-contact-title" className="site-section__title">
        怎么联系你
      </h2>
      <form id={CONTACT_FORM_ID} className="site-form" noValidate onSubmit={onSubmit}>
        <AlertSlot notice={notice} />
        <TextField label="乘车人姓名" size="lg" required autoComplete="name" value={form.name} errors={errors.name ? [errors.name] : []} onChange={(event) => onChange({ name: event.target.value })} />
        <TextField label="邮箱" size="lg" required type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={form.email} errors={errors.email ? [errors.email] : []} hint={FIELD_HINTS.email} onChange={(event) => onChange({ email: event.target.value })} />
        <TextField label="手机号（含国家区号）" size="lg" required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} errors={errors.phone ? [errors.phone] : []} hint={FIELD_HINTS.phone} onChange={(event) => onChange({ phone: event.target.value })} />
        {extra}
        <div className="site-form__row">
          <SelectField<MessagingApp | "">
            label="微信 / LINE / WhatsApp（选填）"
            placeholder="不填"
            value={form.messagingApp}
            options={MESSAGING_APPS.map((app) => ({ value: app, label: MESSAGING_NAMES[app] }))}
            onChange={(messagingApp) => onChange({ messagingApp })}
          />
          <TextField label="即时通讯账号" size="lg" disabled={form.messagingApp === ""} value={form.messagingHandle} errors={errors.messagingHandle ? [errors.messagingHandle] : []} onChange={(event) => onChange({ messagingHandle: event.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="book-notes">
            给司机的备注（选填）
          </label>
          <textarea id="book-notes" className="input textarea" rows={3} maxLength={ORDER_FIELD_LIMITS.notesMax} value={form.notes} onChange={(event) => onChange({ notes: event.target.value })} />
        </div>
        <div className="field">
          <label className="choice site-consent">
            <input type="checkbox" checked={form.consent} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "book-consent-error book-consent-help" : "book-consent-help"} onChange={(event) => onChange({ consent: event.target.checked })} />
            <span className="choice__text">{CONSENT_TEXT}</span>
          </label>
          <p className="field__hint" id="book-consent-help">
            {CONSENT_HELP}
          </p>
          {errors.consent && (
            <p className="field__error" id="book-consent-error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{errors.consent}</span>
            </p>
          )}
        </div>
        {actions}
      </form>
    </section>
  );
}
