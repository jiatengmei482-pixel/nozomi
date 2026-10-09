/**
 * 修改取整单位（docs/design/pages/tenant-prices.md 第 7 节）。取整单位存在子品牌上，这个子品牌下的所有商品共用；只有管理员能改。
 * 选项来自 @nozomi/domain 的 roundingUnitOptions，例子用 roundToUnit 现算。
 */
import { PRODUCT_STATUS_NAMES, isCurrencyCode, roundToUnit, roundingUnitOptions } from "@nozomi/domain";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../../api/client.ts";
import { getPriceRules, saveRoundingUnit } from "../../../api/prices.ts";
import { listBrands } from "../../../api/products.ts";
import { usePortalSession } from "../../../auth/PortalSession.tsx";
import { Alert } from "../../../components/Alert.tsx";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import { useToast } from "../../../components/Toast.tsx";
import { moneyText } from "../../../lib/product-display.ts";
import { saveFailureText } from "../../../lib/product-failure.ts";
import { pricePath } from "../../../lib/product-paths.ts";

export function RoundingUnitDialog({ open, productId, brandId, brandName, currency, current, onClose, onSaved }: { open: boolean; productId: string; brandId: string; brandName: string; currency: string; current: number; onClose(): void; onSaved(): void }) {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [unit, setUnit] = useState(current);
  const [latest, setLatest] = useState(current);
  const [version, setVersion] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; code: string; status: string; prices: number }[]>([]);
  const [productCount, setProductCount] = useState<number | null>(null);
  const options = isCurrencyCode(currency) ? roundingUnitOptions(currency) : [1];

  /** 取子品牌的版本号（保存时做 If-Match）。 */
  const loadVersion = async (): Promise<void> => {
    const brands = await listBrands(token);
    setVersion(brands.find((brand) => brand.id === brandId)?.version ?? null);
  };
  useEffect(() => {
    if (!open) return;
    setUnit(current);
    setLatest(current);
    setProblem(null);
    setVersion(null);
    loadVersion().catch((err: unknown) => {
      if (!handleAuthFailure(err)) setProblem("子品牌的设置没有加载出来，请关闭后重试。");
    });
    // 只在打开时取一次
  }, [open]);

  const save = async (): Promise<void> => {
    if (unit === latest) return onClose();
    if (version === null || saving) return;
    setSaving(true);
    setProblem(null);
    setBlocked([]);
    try {
      const saved = await saveRoundingUnit(token, brandId, version, unit);
      toast(saved.changed_price_count > 0 ? `已保存取整单位，有 ${saved.changed_price_count.toLocaleString("en-US")} 条价格取整后的数变了` : "已保存取整单位");
      onSaved();
      onClose();
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT") {
        try {
          const [fresh] = await Promise.all([getPriceRules(token, productId), loadVersion()]);
          setUnit(fresh.rounding_unit);
          setLatest(fresh.rounding_unit);
          onSaved();
          setProblem("这个子品牌刚被别人修改过。已经载入最新的设置，请确认后再保存。");
        } catch {
          setProblem("这个子品牌刚被别人修改过，最新的设置没有加载出来。请关闭后重试。");
        }
      } else if (err instanceof ApiError && err.code === "ROUNDING_UNIT_ZEROES_PRICES") {
        // 取整单位太大：比半个单位还小的价格会取整成 0，报不出价
        const count = (key: string): number | null => (typeof err.details[key] === "number" ? (err.details[key] as number) : null);
        const prices = count("price_count");
        const published = count("published_product_count");
        setProductCount(count("product_count"));
        const listed = Array.isArray(err.details["products"]) ? (err.details["products"] as unknown[]) : [];
        setBlocked(
          listed.flatMap((entry) => {
            const row = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
            return typeof row["product_id"] === "string" && typeof row["code"] === "string" ? [{ id: row["product_id"], code: row["code"], status: typeof row["status"] === "string" ? row["status"] : "", prices: typeof row["price_count"] === "number" ? row["price_count"] : 0 }] : [];
          }),
        );
        setProblem(`不能改成 ${label(unit)}：这个子品牌下有${prices !== null ? ` ${prices.toLocaleString("en-US")} 条` : ""}价格取整后会变成 0，报不出价${published !== null && published > 0 ? `（其中 ${published.toLocaleString("en-US")} 个商品已上架）` : ""}。请选小一点的取整单位，或先把这些价格改大。`);
      } else if (err instanceof ApiError && err.status === 403) setProblem("你没有权限修改取整单位。");
      else setProblem(saveFailureText(err, "保存"));
    } finally {
      setSaving(false);
    }
  };

  const label = (value: number): string => (value === 1 ? `不另外取整（${moneyText(1, currency)}）` : moneyText(value, currency));
  // 例子：正好一半的往大的取，差一点的往小的取
  const half = unit > 1 ? 231 * unit + unit / 2 : null;
  return (
    <Dialog
      open={open}
      size="form"
      title="修改取整单位"
      busy={saving}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" loading={saving} loadingText="保存中…" disabled={version === null && unit !== latest} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <div className="form">
        <div role="alert">
          {problem !== null && (
            <Alert kind="danger">
              <span>{problem}</span>
              {blocked.length > 0 && (
                <span className="error-summary__list">
                  {blocked.map((entry) => (
                    <Link key={entry.id} className="link error-summary__item" to={pricePath(entry.id)} onClick={onClose}>
                      {`${entry.code}（${(PRODUCT_STATUS_NAMES as Record<string, string>)[entry.status] ?? "商品"}）：${entry.prices.toLocaleString("en-US")} 条价格`}
                    </Link>
                  ))}
                  {productCount !== null && productCount > blocked.length && <span>{`还有 ${(productCount - blocked.length).toLocaleString("en-US")} 个商品`}</span>}
                </span>
              )}
            </Alert>
          )}
        </div>
        <Alert kind="warning">
          <strong className="alert__title">{`这是子品牌「${brandName}」的设置。`}</strong>
          <span>这个子品牌下的所有商品都会跟着变，已上架的商品也一样。</span>
        </Alert>
        <div className="field">
          <label className="field__label" htmlFor="rounding-unit">
            取整到
            <span className="field__required" aria-hidden="true">
              {" *"}
            </span>
          </label>
          <select className="input select" id="rounding-unit" data-autofocus aria-describedby="rounding-unit-hint" value={String(unit)} disabled={saving} onChange={(event) => setUnit(Number(event.target.value))}>
            {[...new Set([...options, latest])].sort((x, y) => x - y).map((value) => (
              <option key={value} value={String(value)}>
                {label(value)}
              </option>
            ))}
          </select>
          <p className="field__hint" id="rounding-unit-hint" aria-live="polite">
            {half === null ? "调价后的结算价只按币种的最小单位四舍五入，不另外取整。" : `例：${moneyText(half, currency)} → ${moneyText(roundToUnit(half, unit), currency)}；${moneyText(half - 1, currency)} → ${moneyText(roundToUnit(half - 1, unit), currency)}。四舍五入，正好一半时往大的取。`}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
