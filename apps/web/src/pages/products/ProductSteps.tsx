/**
 * 商品的步骤导航和当前步骤（docs/design/pages/tenant-products.md 3.1、3.2）。
 * 供应商后台的新建 / 编辑页和运营后台的只读查看页（docs/design/pages/platform-products.md）共用这一份：
 * 步骤和它们的完成情况、各步骤的内容组件都是同一套，差别只在 `frame`（只读、数据从哪来、链接指向哪）。
 */
import { INVENTORY_MODE_NAMES } from "@nozomi/domain";
import type { ReactNode } from "react";
import type { Product, PublishCheckResult } from "../../api/products.ts";
import { type StepEntry, StepNav, type StepStatus } from "../../components/StepNav.tsx";
import { displayName } from "../../lib/master-display.ts";
import { type CheckContext, checkItemGap, checkOverview } from "../../lib/product-display.ts";
import type { ProductStepSlug } from "../../lib/product-paths.ts";
import { BasicStep } from "./BasicStep.tsx";
import { ContentStep } from "./ContentStep.tsx";
import type { ProductFrame } from "./frame.ts";
import { ImportPage } from "./inventory/ImportPage.tsx";
import { InventoryStep } from "./inventory/InventoryStep.tsx";
import { PricesStep } from "./prices/PricesStep.tsx";
import { PublishStep } from "./PublishStep.tsx";
import { ServiceRulesStep } from "./ServiceRulesStep.tsx";

/** 五个步骤。`slug` 有值的是开放的（有页面）；以后的任务上线一步，就给那一步接上地址。 */
export const PRODUCT_STEPS: readonly { key: string; name: string; slug: ProductStepSlug | null; check: string }[] = [
  { key: "basic", name: "基础信息", slug: "basic", check: "basic_info" },
  { key: "service-rules", name: "服务规则", slug: "service-rules", check: "service_rules" },
  { key: "price-rules", name: "价格规则", slug: "prices", check: "price_rules" },
  { key: "inventory", name: "库存", slug: "inventory", check: "inventory" },
  { key: "content", name: "商品详情", slug: "content", check: "content" },
];
export const PRODUCT_STEP_TITLES: Readonly<Record<ProductStepSlug, string>> = { basic: "基础信息", "service-rules": "服务规则", prices: "价格规则", inventory: "库存", content: "商品详情", publish: "上架检查" };
const SOON: StepStatus = { icon: "clock", tone: "muted", text: "即将开放" };
const UNKNOWN: StepStatus = { icon: null, tone: "muted", text: "—" };

export function checkContextOf(product: Product): CheckContext {
  return {
    category: product.category,
    brandName: product.brand?.name ?? "",
    cityName: product.city ? displayName(product.city.name).text : "",
    placeName: product.poi ? displayName(product.poi.name).text : null,
    station: product.poi?.type === "station",
  };
}

/** 第一个还没完成的开放步骤；都完成了是上架检查。 */
export function firstPendingStep(check: PublishCheckResult): ProductStepSlug {
  return PRODUCT_STEPS.find((entry) => entry.slug !== null && check.items.some((item) => item.key === entry.check && !item.passed))?.slug ?? "publish";
}

export interface ProductStepsProps {
  frame: ProductFrame;
  /** 新建页（还没保存过） */
  isNew?: boolean;
  current: ProductStepSlug;
  /** 步骤后面的分区（第 ③ 步的页签、某一条调价规则、导入页） */
  rest: readonly string[];
  /** 检查结果这次取的情况（"loading" / "error" / …） */
  checkStatus: string;
  onReloadCheck(): void;
  /** 商品还没取到时右栏显示什么（加载中、加载失败） */
  placeholder?: ReactNode;
  /** 换掉第 ④ 步的内容（运营后台没有每天的库存，只看模式和还有几天可卖） */
  inventory?: ReactNode;
}

export function ProductSteps({ frame, isNew = false, current, rest, checkStatus, onReloadCheck, placeholder, inventory }: ProductStepsProps) {
  const { product, check, checkContext: context, inventoryMode } = frame;
  const checkFailed = !isNew && check === null && checkStatus === "error";
  const stepStatus = (entry: (typeof PRODUCT_STEPS)[number]): StepStatus | "loading" => {
    if (entry.slug === null) return SOON;
    if (isNew) return entry.key === "basic" ? { icon: "circle", tone: "muted", text: "未保存" } : { icon: "lock", tone: "muted", text: "先保存第 1 步" };
    if (check === null || context === null) return checkFailed ? UNKNOWN : "loading";
    const item = check.items.find((candidate) => candidate.key === entry.check);
    if (!item) return UNKNOWN;
    // 库存不是必须的：不限量 / 限量都算完成；限量但从今天起没有库存时提醒（不拦上架）
    if (entry.key === "inventory") {
      if (item.issues.some((issue) => issue.reason === "NO_INVENTORY_AHEAD")) return { icon: "alert-triangle", tone: "warning", text: "从今天起没有库存" };
      return { icon: "check", tone: "success", text: inventoryMode === null ? "已完成" : `已完成 · ${INVENTORY_MODE_NAMES[inventoryMode]}` };
    }
    return item.passed ? { icon: "check", tone: "success", text: "已完成" } : { icon: "alert-triangle", tone: "warning", text: `还差 ${Math.max(1, checkItemGap(item, context))} 项` };
  };
  const publishStatus = (): StepStatus | "loading" => {
    if (isNew) return { icon: "lock", tone: "muted", text: "先保存第 1 步" };
    if (product?.status === "published") return { icon: "check", tone: "success", text: "已上架" };
    if (check === null) return checkFailed ? UNKNOWN : "loading";
    const overview = checkOverview(check);
    if (overview.canPublish) return { icon: "check", tone: "success", text: "可以上架" };
    if (overview.failed.length > 0) return { icon: "alert-triangle", tone: "warning", text: `还差 ${overview.failed.length} 项` };
    return { icon: "clock", tone: "info", text: `等待开放 ${overview.unavailable.length} 步` };
  };
  const paths = frame.source.paths;
  const steps: StepEntry[] = PRODUCT_STEPS.map((entry, index) => ({
    key: entry.key,
    number: index + 1,
    name: entry.name,
    current: entry.slug === current,
    status: stepStatus(entry),
    ...(entry.slug !== null && product ? { to: paths.step(product.id, entry.slug) } : {}),
  }));
  const done = steps.filter((entry) => entry.status !== "loading" && entry.status.text.startsWith("已完成")).length;
  const closing: StepEntry[] = [{ key: "publish", name: "上架检查", current: current === "publish", status: publishStatus(), ...(product ? { to: paths.step(product.id, "publish") } : {}) }];
  const soon = PRODUCT_STEPS.filter((entry) => entry.slug === null).map((entry) => `「${entry.name}」`);
  const nav = <StepNav title="配置步骤" progress={`已完成 ${done} / ${PRODUCT_STEPS.length}`} steps={steps} closing={closing} {...(soon.length > 0 ? { note: `${soon.join("")}正在开发，开放后会出现在这里。现在可以先把其他几步配好。` } : {})} />;

  let content: ReactNode;
  if (isNew) content = <BasicStep key="new" frame={frame} />;
  else if (product === null) content = placeholder;
  else if (current === "basic") content = <BasicStep key={product.id} frame={frame} />;
  else if (current === "service-rules") content = <ServiceRulesStep key={product.id} frame={frame} product={product} />;
  else if (current === "prices" && rest[0] === "import") content = <ImportPage key={`${product.id}-prices`} kind="prices" frame={frame} product={product} />;
  else if (current === "prices") content = <PricesStep key={product.id} frame={frame} product={product} rest={rest} />;
  else if (current === "inventory" && inventory !== undefined) content = inventory;
  else if (current === "inventory" && rest[0] === "import") content = <ImportPage key={`${product.id}-inventory`} kind="inventory" frame={frame} product={product} />;
  else if (current === "inventory") content = <InventoryStep key={product.id} frame={frame} product={product} />;
  else if (current === "content") content = <ContentStep key={product.id} frame={frame} product={product} />;
  else content = <PublishStep key={product.id} frame={frame} product={product} onReload={onReloadCheck} checkStatus={checkStatus} />;

  const wide = (current === "prices" || (current === "inventory" && inventory === undefined)) && rest[0] !== "import" && !(rest[0] === "adjust" && rest.length > 1);
  return (
    <div className="steps__layout">
      {nav}
      <div className={wide ? "steps__content steps__content--wide" : "steps__content"}>{content}</div>
    </div>
  );
}
