/**
 * ③ 价格规则（docs/design/pages/tenant-prices.md 第 2 节）：标题、说明行（币种、取整、时区）、三个页签。
 * 页签各有自己的地址，所以是一组链接，不是 tablist。价格规则和调价规则在这里取一次，三个页签共用。
 */
import { CURRENCIES, isCurrencyCode } from "@nozomi/domain";
import { type ReactNode, useEffect, useRef } from "react";
import { Link } from "react-router";
import { type AdjustRules, type PriceRules, getAdjustRules, getPriceRules } from "../../../api/prices.ts";
import type { Product } from "../../../api/products.ts";
import { Button, LinkButton } from "../../../components/Button.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../../components/States.tsx";
import { displayName } from "../../../lib/master-display.ts";
import { tableCoverage } from "../../../lib/price-form.ts";
import { rowFromRule } from "../../../lib/price-form.ts";
import { CURRENCY_NAMES, amountText } from "../../../lib/product-display.ts";
import { type PriceTab, pricePath, productPath } from "../../../lib/product-paths.ts";
import { useLoad } from "../../../lib/use-load.ts";
import type { ProductFrame } from "../frame.ts";
import { AdjustRuleForm } from "./AdjustRuleForm.tsx";
import { AdjustRulesTab } from "./AdjustRulesTab.tsx";
import { CalendarTab } from "./CalendarTab.tsx";
import { PriceRulesTab } from "./PriceRulesTab.tsx";

export interface PricesShared {
  frame: ProductFrame;
  product: Product;
  prices: PriceRules;
  adjusts: AdjustRules | null;
  setPrices(next: PriceRules): void;
  reloadPrices(): void;
  setAdjusts(next: AdjustRules): void;
  reloadAdjusts(): void;
}

export function PricesStep({ frame, product, rest }: { frame: ProductFrame; product: Product; rest: readonly string[] }) {
  const prices = useLoad<PriceRules>(`price-rules:${product.id}`, (token) => getPriceRules(token, product.id));
  const adjusts = useLoad<AdjustRules>(`adjust-rules:${product.id}`, (token) => getAdjustRules(token, product.id));
  const heading = useRef<HTMLHeadingElement>(null);
  const tab: PriceTab = rest[0] === "adjust" ? "adjust" : rest[0] === "calendar" ? "calendar" : "rules";
  useEffect(() => heading.current?.focus(), []);
  const syncVersion = frame.syncVersion;
  const loadedVersion = prices.state.data?.version ?? null;
  useEffect(() => {
    if (loadedVersion !== null) syncVersion(loadedVersion);
  }, [loadedVersion, syncVersion]);

  const data = prices.state.data;
  const currency = data?.currency ?? product.brand?.currency ?? "";
  const digits = isCurrencyCode(currency) ? CURRENCIES[currency].minorDigits : 0;
  const station = product.poi?.type === "station";
  const missing = data ? tableCoverage(data.items.map((item) => rowFromRule(item, currency)), { category: product.category, currency, today: data.today, station }, product.areas.map((area) => area.area_id), product.vehicle_groups.map((group) => group.vehicle_group_id)).missing : 0;
  const enabledAdjusts = (adjusts.state.data?.items ?? []).filter((rule) => rule.status === "enabled" && !rule.ended).length;

  const tabs: { key: PriceTab; name: string; extra?: ReactNode }[] = [
    {
      key: "rules",
      name: "价格规则",
      ...(missing > 0
        ? {
            extra: (
              <span className="price-tabs__missing">
                <Icon name="alert-triangle" />
                {`缺 ${missing}`}
              </span>
            ),
          }
        : {}),
    },
    { key: "adjust", name: "调价规则", ...(enabledAdjusts > 0 ? { extra: <span className="price-tabs__count">{enabledAdjusts}</span> } : {}) },
    { key: "calendar", name: "价格日历" },
  ];

  let body: ReactNode;
  if (data === null) {
    body =
      prices.state.status === "error" ? (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={prices.reload}>
                重试
              </Button>
            }
          />
        </section>
      ) : (
        <section className="card">
          <Skeleton lines={["long", "control", "control", "control"]} />
        </section>
      );
  } else if (product.areas.length === 0 || product.vehicle_groups.length === 0) {
    const lacks = product.areas.length === 0 && product.vehicle_groups.length === 0 ? "服务区域和车型组" : product.areas.length === 0 ? "服务区域" : "车型组";
    body = (
      <section className="card">
        <StateBlock
          tone="neutral"
          title="先选服务区域和车型组"
          description={`价格是按「区域 × 车型组」一格一格设的。这个商品还没有选${lacks}。`}
          action={
            <LinkButton variant="primary" to={productPath(product.id, "basic", product.areas.length === 0 ? "areas" : "vehicle-groups")}>
              {frame.readOnly ? "去第 ① 步看" : "去第 ① 步选"}
            </LinkButton>
          }
        />
      </section>
    );
  } else {
    const shared: PricesShared = { frame, product, prices: data, adjusts: adjusts.state.data, setPrices: prices.set, reloadPrices: prices.reload, setAdjusts: adjusts.set, reloadAdjusts: adjusts.reload };
    if (tab === "adjust" && rest.length > 1) body = <AdjustRuleForm key={rest[1]} shared={shared} ruleId={rest[1] === "new" ? null : (rest[1] ?? null)} />;
    else if (tab === "adjust") body = <AdjustRulesTab shared={shared} loadStatus={adjusts.state.status} />;
    else if (tab === "calendar") body = <CalendarTab shared={shared} />;
    else body = <PriceRulesTab shared={shared} />;
  }

  return (
    <div className="step">
      <h2 className="step__title" ref={heading} tabIndex={-1}>
        ③ 价格规则
      </h2>
      {data === null ? (
        <p className="price-info" aria-hidden="true">
          <span className="step-nav__status step-nav__status--loading" />
        </p>
      ) : (
        <p className="price-info">
          金额都是<strong>结算价</strong>，币种 <strong>{currency}</strong>
          {digits === 0 ? `（${CURRENCY_NAMES[currency] ?? currency}没有小数）` : `（最多 ${digits} 位小数）`} · {data.rounding_unit > 1 ? "调价后的结算价取整到 " : "调价后的结算价四舍五入到 "}
          <strong>{`${currency} ${amountText(data.rounding_unit, currency)}`}</strong> · 日期按<strong>{`${product.city ? displayName(product.city.name).text : ""}当地时间`}</strong>
        </p>
      )}
      <nav className="price-tabs" aria-label="价格规则的分区">
        {tabs.map((entry) => (
          <Link key={entry.key} className={entry.key === tab ? "price-tabs__tab price-tabs__tab--current" : "price-tabs__tab"} to={pricePath(product.id, entry.key)} aria-current={entry.key === tab ? "page" : undefined}>
            {entry.name}
            {entry.extra}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
