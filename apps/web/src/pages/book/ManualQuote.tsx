/**
 * 官网报不出价时的「留下联系方式、人工报价」和「通过 WhatsApp 联系我们」（M8-21，ADR 0076；规范 site-booking-v2.md 第 11 节）。
 * 新预订页（接送、包车、所有区域之外）和旧预订页报不出价时都用这一块。
 *
 * - 只有两个框：邮箱、WhatsApp，至少填一项；行程由页面自动带上。提交按钮旁写「提交即同意…」，不另加勾选框。
 * - 陷阱字段 `website`：人看不到、键盘到不了，机器人会填。
 * - 提交后一律显示同一句「已收到」（接口一律 202，不说明是不是重复）。
 * - WhatsApp 按钮：官网配置里有客服号码才显示，新标签页打开 wa.me，预先写好行程要点。
 */
import { type FormEvent, useId, useRef, useState } from "react";
import { submitSiteManualQuote } from "../../api/site.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { TextField } from "../../components/TextField.tsx";
import { WhatsappLink } from "../../components/WhatsappLink.tsx";
import {
  MANUAL_QUOTE_TEXTS,
  type ManualQuoteContact,
  type ManualQuoteErrors,
  type ManualQuoteTripDraft,
  emptyManualQuoteContact,
  manualQuoteFieldErrors,
  manualQuoteRequestOf,
  missingTripParts,
  supportWhatsappMessage,
  validateManualQuoteContact,
} from "../../lib/manual-quote-form.ts";
import { siteFailureText } from "./SiteLayout.tsx";

/** 「通过 WhatsApp 联系我们」：没有设置客服号码时什么都不显示。 */
export function WhatsappButton({ supportWhatsapp, trip }: { supportWhatsapp: string | null; trip: ManualQuoteTripDraft }) {
  if (supportWhatsapp === null || supportWhatsapp === "") return null;
  return (
    <WhatsappLink digits={supportWhatsapp} text={supportWhatsappMessage(trip)} className="button button--secondary button--lg manual-quote__whatsapp" icon="message">
      <span>通过 WhatsApp 联系我们</span>
    </WhatsappLink>
  );
}

export function ManualQuoteBlock({ trip, supportWhatsapp, headingLevel = "h3" }: { trip: ManualQuoteTripDraft; supportWhatsapp: string | null; headingLevel?: "h2" | "h3" }) {
  const titleId = useId();
  const [contact, setContact] = useState<ManualQuoteContact>(emptyManualQuoteContact);
  const [errors, setErrors] = useState<ManualQuoteErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const whatsappRef = useRef<HTMLInputElement>(null);
  const Heading = headingLevel;
  const missing = missingTripParts(trip);

  const update = (changes: Partial<ManualQuoteContact>): void => {
    setContact((value) => ({ ...value, ...changes }));
    setErrors((value) => {
      const next = { ...value };
      for (const key of Object.keys(changes)) delete next[key as keyof ManualQuoteErrors];
      // 填了任何一项，「至少填一项」那条也一起收起
      if (next.email === MANUAL_QUOTE_TEXTS.required) delete next.email;
      return next;
    });
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (missing.length > 0) {
      setProblem(`请先在上面选好${missing.join("、")}，再提交。`);
      return;
    }
    const found = validateManualQuoteContact(contact);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setProblem(null);
      (found.email !== undefined ? emailRef.current : whatsappRef.current)?.focus();
      return;
    }
    const body = manualQuoteRequestOf(contact, trip);
    if (body === null) return;
    setProblem(null);
    setBusy(true);
    try {
      await submitSiteManualQuote(body);
      setDone(true);
    } catch (err) {
      const fields = manualQuoteFieldErrors(err);
      if (fields !== null) {
        setErrors(fields);
        (fields.email !== undefined ? emailRef.current : whatsappRef.current)?.focus();
      } else {
        const whatsapp = supportWhatsapp !== null && supportWhatsapp !== "";
        setProblem(`${siteFailureText(err, "提交")}${whatsapp ? "也可以点下面的「通过 WhatsApp 联系我们」。" : ""}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="manual-quote" aria-labelledby={titleId}>
      <Heading id={titleId} className="manual-quote__title">
        请客服人工报价
      </Heading>
      {done ? (
        <p className="manual-quote__done" role="status">
          <Icon name="check-circle" />
          <span>{MANUAL_QUOTE_TEXTS.success}</span>
        </p>
      ) : (
        <form className="manual-quote__form" noValidate onSubmit={(event) => void submit(event)}>
          <p className="site-muted">留下邮箱或 WhatsApp（至少一项），客服核对行程后联系您报价。行程会自动带上，不用再填。</p>
          <div role="alert">{problem !== null && <Alert kind="danger">{problem}</Alert>}</div>
          <div className="site-form__row">
            <TextField ref={emailRef} label="邮箱" size="lg" type="email" autoComplete="email" inputMode="email" spellCheck={false} maxLength={400} value={contact.email} errors={errors.email ? [errors.email] : []} onChange={(event) => update({ email: event.target.value })} />
            <TextField ref={whatsappRef} label="WhatsApp" size="lg" type="tel" autoComplete="tel" inputMode="tel" maxLength={60} value={contact.whatsapp} errors={errors.whatsapp ? [errors.whatsapp] : []} hint={MANUAL_QUOTE_TEXTS.whatsappHint} onChange={(event) => update({ whatsapp: event.target.value })} />
          </div>
          <div className="manual-quote__trap" aria-hidden="true">
            <label>
              网站（请留空）
              <input type="text" name="website" tabIndex={-1} autoComplete="off" value={contact.website} onChange={(event) => setContact((value) => ({ ...value, website: event.target.value }))} />
            </label>
          </div>
          <div className="manual-quote__actions">
            <Button type="submit" variant="primary" size="lg" loading={busy} loadingText="正在提交">
              提交
            </Button>
            <p className="manual-quote__consent">{MANUAL_QUOTE_TEXTS.consent}</p>
          </div>
        </form>
      )}
      <WhatsappButton supportWhatsapp={supportWhatsapp} trip={trip} />
    </section>
  );
}
