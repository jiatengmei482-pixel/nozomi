/** 新建子品牌（docs/design/pages/tenant-products.md 4.2）：名称 + 结算币种。币种创建后不能改，对话框里明确提醒。 */
import { PRODUCT_LIMITS, hasVisibleText } from "@nozomi/domain";
import { type FormEvent, useId, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type Brand, createBrand } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { useToast } from "../../components/Toast.tsx";
import { saveFailureText } from "../../lib/product-failure.ts";
import { CURRENCY_OPTIONS } from "../../lib/product-display.ts";

export function BrandDialog({ onClose, onCreated }: { onClose(): void; onCreated(brand: Brand): void }) {
  const id = useId();
  const toast = useToast();
  const { token, handleAuthFailure } = usePortalSession();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [working, setWorking] = useState(false);
  const [taken, setTaken] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());

  const trimmed = name.trim();
  const nameErrors = [
    ...(attempted && !hasVisibleText(trimmed) ? ["请填写名称"] : []),
    ...(trimmed.length > PRODUCT_LIMITS.maxBrandNameLength ? [`名称最多 ${PRODUCT_LIMITS.maxBrandNameLength} 个字`] : []),
    ...(taken ? ["已经有同名的子品牌，请换一个名字"] : []),
  ];
  const currencyErrors = attempted && currency === "" ? ["请选择结算币种"] : [];

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (working) return;
    setAttempted(true);
    setFailure(null);
    if (!hasVisibleText(trimmed) || trimmed.length > PRODUCT_LIMITS.maxBrandNameLength) return document.getElementById(`${id}-name`)?.focus();
    if (currency === "") return document.getElementById(`${id}-currency`)?.focus();
    setWorking(true);
    try {
      const brand = await createBrand(token, { name: trimmed, currency }, key);
      toast(`已新建子品牌「${brand.name}」`);
      onCreated(brand);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "BRAND_NAME_TAKEN") {
        setTaken(true);
        document.getElementById(`${id}-name`)?.focus();
      } else if (err instanceof ApiError && err.status === 403) setFailure("你没有权限新建子品牌。请联系你们的管理员。");
      else setFailure(saveFailureText(err, "新建"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open
      size="form"
      title="新建子品牌"
      busy={working}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={working} onClick={onClose}>
            取消
          </Button>
          <Button type="submit" form={`${id}-form`} variant="primary" loading={working} loadingText="新建中…">
            新建
          </Button>
        </>
      }
    >
      <form className="form" id={`${id}-form`} noValidate onSubmit={(event) => void submit(event)}>
        <div role="alert">{failure !== null && <Alert kind="danger">{failure}</Alert>}</div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-name`}>
            名称
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </label>
          <input
            className="input"
            id={`${id}-name`}
            data-autofocus
            required
            autoComplete="off"
            readOnly={working}
            aria-invalid={nameErrors.length > 0 || undefined}
            aria-describedby={`${id}-name-error ${id}-name-hint`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setTaken(false);
            }}
          />
          <FieldErrors id={`${id}-name-error`} errors={nameErrors} />
          <p className="field__hint" id={`${id}-name-hint`}>
            你们对外用的品牌名。只有一个品牌的话，填公司或车队的名字就行。
          </p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-currency`}>
            结算币种
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </label>
          <select className="input select" id={`${id}-currency`} required disabled={working} aria-invalid={currencyErrors.length > 0 || undefined} aria-describedby={`${id}-currency-error ${id}-currency-hint`} value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="">请选择</option>
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldErrors id={`${id}-currency-error`} errors={currencyErrors} />
          <p className="field__hint" id={`${id}-currency-hint`}>
            这个子品牌下所有商品的价格都用这种币种填写，平台也按它跟你们结算。
          </p>
        </div>
        <Alert kind="warning">
          <strong className="alert__title">币种创建后不能修改。</strong>
          <span>选错了只能另建一个子品牌。</span>
        </Alert>
      </form>
    </Dialog>
  );
}
