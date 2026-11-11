/**
 * 新预订页右侧栏（手机第 3 步顶部）的几块和「怎么联系你」（M8-04，ADR 0069「修正版 v2」「B15 / B16 → A」；规范 site-booking-v2.md 5、6）：
 * - 路线：谷歌静态地图（M8-10，后端出图；没开通时退回现有底图画折线）+「约 X 分钟 · Y 公里」；取不到路线不显示；
 * - 附加服务：报价给的这个车型能加的（`available_addons`），每项 − 0 +；改了数量页面带 `addons` 重新报价，这里只显示「合计差额」，不另算单价；
 * - 车费、合计（订单币种）、参考价「≈ 客人币种」（汇率不可用时不显示）、取消规则、去付款、支付方式（只有银行卡）；
 * - 「怎么联系你」：字段、校验、下单和旧下单页同一套（`lib/site-order-form.ts`）。
 * 页面上没有供应商、结算价、加价比例、附加服务单价。
 */
import { FX_CURRENCIES, MESSAGING_APPS, type MessagingApp, ORDER_FIELD_LIMITS } from "@nozomi/domain";
import type { FormEvent, ReactNode, Ref } from "react";
import type { MapTiles } from "../../../api/areas.ts";
import type { SiteAddonOption, SiteFxReference, SiteMoney, SiteRoutePreview } from "../../../api/site.ts";
import { AlertSlot, type Notice } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { SelectField } from "../../../components/FormFields.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TextField } from "../../../components/TextField.tsx";
import { ADDON_QUANTITY, FX_REFERENCE_NOTE, RIDER_NAME_MAX, RIDER_PHONE_MAX, type TripPoint, decodePolyline, lockedRouteSummaryText, referenceMoney, routeSummaryText } from "../../../lib/book-new.ts";
import { moneyText } from "../../../lib/dispatch-display.ts";
import { displayName } from "../../../lib/master-display.ts";
import { AREA_SURCHARGE_NOTE } from "../../../lib/site-display.ts";
import { CONSENT_HELP, CONSENT_TEXT, FIELD_HINTS, MESSAGING_NAMES, type OrderErrors } from "../../../lib/site-order-form.ts";
import { SitePrice } from "../SitePrice.tsx";
import { RoutePicture } from "./StaticRouteMap.tsx";
import { Stepper } from "./TravellersField.tsx";

export const CONTACT_FORM_ID = "book-contact-form";

/**
 * 路线：谷歌静态地图（M8-10，后端出图）+「约 X 分钟 · Y 公里」；平台还没开通静态地图时退回现有底图画折线（有折线和底图才画）；
 * 图出不来只写字；取不到路线（null）整块不显示。
 */
export function RouteBlock({ route, tiles, from, to, lockedMeters = null }: { route: SiteRoutePreview | null; tiles: MapTiles | null; from: TripPoint; to: TripPoint; lockedMeters?: number | null }) {
  if (route === null) return null;
  const points = route.polyline === null ? [] : decodePolyline(route.polyline);
  // 选了含公里数的车型（M8-13，规范 10.3）：公里数用报价锁定的路线、同一个取整（向上到 0.1 公里），和「公里数」那句话的 D 一样
  const text = lockedMeters === null ? routeSummaryText(route.minutes, route.meters) : lockedRouteSummaryText(route.minutes, lockedMeters);
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
  areaSurcharge = false,
  kmNote = null,
}: {
  fare: SiteMoney;
  priced: PricedState;
  currency: string;
  onCurrency(currency: string): void;
  reference: SiteFxReference | null;
  /** 这个车型的报价含区域加价（M8-19）：车费下面说一句「含区域加价，已算在这个价格里」，不写金额 */
  areaSurcharge?: boolean;
  /** 含公里数那一句（M8-13，规范 10.3）：车费下面一行；没设为 null */
  kmNote?: string | null;
}) {
  const approx = priced.kind === "ready" && reference !== null && reference.to !== priced.total.currency ? referenceMoney(priced.total, reference) : null;
  return (
    <div className="book-summary__block">
      <dl className="book-prices">
        <div className="book-prices__row">
          <dt>车费</dt>
          <dd>
            {moneyText(fare)}
            {areaSurcharge && <span className="book-prices__surcharge">{AREA_SURCHARGE_NOTE}</span>}
          </dd>
        </div>
        {kmNote !== null && (
          <div className="book-prices__row book-prices__row--note">
            <dt className="visually-hidden">公里数</dt>
            <dd>{kmNote}</dd>
          </div>
        )}
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
  /** 接机的举牌姓名（选填，M8-27）：没改过时跟着乘车人的名字（`signEdited` 为假），订单接口还没有这一栏，下单时写在备注最前面 */
  signName: string;
  signEdited: boolean;
  /** 为他人预订（M8-27）：联系人（收确认邮件的）是预订人，另填乘车人姓名和电话 / WhatsApp，也写在备注最前面（M8-32 前） */
  forOther: boolean;
  riderName: string;
  riderPhone: string;
  consent: boolean;
}

export const emptyContact = (): ContactForm => ({ name: "", phone: "", email: "", messagingApp: "", messagingHandle: "", notes: "", signName: "", signEdited: false, forOther: false, riderName: "", riderPhone: "", consent: false });

/**
 * 第 3 步「乘客信息」（M8-27；字段和校验沿用 M8-04 的「怎么联系你」）：乘车人姓名、邮箱、手机号（含国家区号）、
 * 接机的航班号和举牌姓名（`extra`）、即时通讯（选填）、给司机的备注（选填）。同意保存银行卡在第 4 步付款前。
 */
export function ContactSection({
  form,
  errors,
  notice,
  onChange,
  onSubmit,
  extra,
  actions,
  headingRef,
  riderErrors = {},
}: {
  form: ContactForm;
  errors: OrderErrors;
  notice: Notice | null;
  onChange(changes: Partial<ContactForm>): void;
  onSubmit(event: FormEvent): void;
  /** 接机的航班号、举牌姓名 */
  extra?: ReactNode;
  /** 「下一步：核对订单」 */
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  /** 为他人预订时乘车人两栏的校验结果 */
  riderErrors?: Partial<Record<"riderName" | "riderPhone", string>>;
}) {
  return (
    <section aria-labelledby="book-contact-title" className="site-section book-new__contact">
      <h2 id="book-contact-title" className="site-section__title" tabIndex={-1} ref={headingRef}>
        乘客信息
      </h2>
      <form className="site-form" noValidate onSubmit={onSubmit}>
        <AlertSlot notice={notice} />
        <fieldset className="book-mode">
          <legend className="visually-hidden">为谁预订</legend>
          {([false, true] as const).map((forOther) => (
            <label key={String(forOther)} className={form.forOther === forOther ? "book-mode__option book-mode__option--checked" : "book-mode__option"}>
              <input type="radio" name="book-for" className="book-mode__input" checked={form.forOther === forOther} onChange={() => onChange({ forOther })} />
              {forOther ? "为他人预订" : "为自己预订"}
            </label>
          ))}
        </fieldset>
        <TextField label={form.forOther ? "预订人姓名" : "乘车人姓名"} size="lg" required autoComplete="name" value={form.name} errors={errors.name ? [errors.name] : []} onChange={(event) => onChange({ name: event.target.value })} />
        <TextField label="邮箱" size="lg" required type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} value={form.email} errors={errors.email ? [errors.email] : []} hint={FIELD_HINTS.email} onChange={(event) => onChange({ email: event.target.value })} />
        <TextField label="手机号（含国家区号）" size="lg" required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} errors={errors.phone ? [errors.phone] : []} hint={FIELD_HINTS.phone} onChange={(event) => onChange({ phone: event.target.value })} />
        {form.forOther && (
          <div className="site-form__row">
            <TextField label="乘车人姓名" size="lg" required maxLength={RIDER_NAME_MAX} value={form.riderName} errors={riderErrors.riderName ? [riderErrors.riderName] : []} hint="确认邮件仍发给上面的预订人" onChange={(event) => onChange({ riderName: event.target.value })} />
            <TextField label="乘车人电话/WhatsApp" size="lg" required type="tel" inputMode="tel" maxLength={RIDER_PHONE_MAX} value={form.riderPhone} errors={riderErrors.riderPhone ? [riderErrors.riderPhone] : []} hint="司机当天联系乘车人用，如 +81 90-1234-5678" onChange={(event) => onChange({ riderPhone: event.target.value })} />
          </div>
        )}
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
          <textarea id="book-notes" className="input textarea" rows={3} maxLength={ORDER_FIELD_LIMITS.notesMax} value={form.notes} aria-invalid={errors.notes ? true : undefined} aria-describedby={errors.notes ? "book-notes-error" : undefined} onChange={(event) => onChange({ notes: event.target.value })} />
          {errors.notes && (
            <p className="field__error" id="book-notes-error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{errors.notes}</span>
            </p>
          )}
        </div>
        {actions}
      </form>
    </section>
  );
}

/** 第 4 步付款前：同意保存银行卡（文字和说明同旧下单页）。 */
export function ConsentField({ checked, error, onChange }: { checked: boolean; error: string | undefined; onChange(checked: boolean): void }) {
  return (
    <div className="field">
      <label className="choice site-consent">
        <input type="checkbox" checked={checked} aria-invalid={error !== undefined ? true : undefined} aria-describedby={error !== undefined ? "book-consent-error book-consent-help" : "book-consent-help"} onChange={(event) => onChange(event.target.checked)} />
        <span className="choice__text">{CONSENT_TEXT}</span>
      </label>
      <p className="field__hint" id="book-consent-help">
        {CONSENT_HELP}
      </p>
      {error !== undefined && (
        <p className="field__error" id="book-consent-error">
          <Icon name="alert-triangle" className="field__error-icon" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
