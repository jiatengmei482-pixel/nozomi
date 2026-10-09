/**
 * 新建 / 编辑商品的框架（docs/design/pages/tenant-products.md 第 3 节）：标题行、步骤导航、当前步骤。
 * 每一步单独保存；整个商品只有一个版本号，存在这里各步共用；每一步的完成情况取自上架检查。
 */
import { PRODUCT_CATEGORY_NAMES } from "@nozomi/domain";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { type Product, type PublishCheckResult, getProduct, getPublishCheck } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { AppShell, Page } from "../../components/AppShell.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { CopyButton } from "../../components/FormFields.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { type StepEntry, StepNav, type StepStatus } from "../../components/StepNav.tsx";
import { displayName, formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { CHECK_STEP, type CheckContext, PRODUCT_STATUS_BADGES, checkItemGap, checkOverview, productName } from "../../lib/product-display.ts";
import { PRODUCT_LIST_PATH, PRODUCT_STEP_SLUGS, type ProductStepSlug, productPath } from "../../lib/product-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { readListPage } from "../master/shared.tsx";
import { BasicStep } from "./BasicStep.tsx";
import { ContentStep } from "./ContentStep.tsx";
import { PublishStep } from "./PublishStep.tsx";
import { ServiceRulesStep } from "./ServiceRulesStep.tsx";
import type { ProductFrame } from "./frame.ts";
import { ProductMoreItems, useProductActions } from "./useProductActions.tsx";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 五个步骤。`slug` 有值的是开放的（有页面）；以后的任务上线一步，就给那一步接上地址。 */
const STEPS: readonly { key: string; name: string; slug: ProductStepSlug | null; check: string }[] = [
  { key: "basic", name: "基础信息", slug: "basic", check: "basic_info" },
  { key: "service-rules", name: "服务规则", slug: "service-rules", check: "service_rules" },
  { key: "price-rules", name: "价格规则", slug: null, check: "price_rules" },
  { key: "inventory", name: "库存", slug: null, check: "inventory" },
  { key: "content", name: "商品详情", slug: "content", check: "content" },
];
const STEP_TITLES: Readonly<Record<ProductStepSlug, string>> = { basic: "基础信息", "service-rules": "服务规则", content: "商品详情", publish: "上架检查" };
const SOON: StepStatus = { icon: "clock", tone: "muted", text: "即将开放" };
const UNKNOWN: StepStatus = { icon: null, tone: "muted", text: "—" };

function returnTo(state: unknown): string {
  const from = typeof state === "object" && state !== null ? (state as { from?: unknown }).from : undefined;
  return typeof from === "string" && (from === PRODUCT_LIST_PATH || from.startsWith(`${PRODUCT_LIST_PATH}?`)) ? from : PRODUCT_LIST_PATH;
}

function checkContextOf(product: Product): CheckContext {
  return {
    category: product.category,
    brandName: product.brand?.name ?? "",
    cityName: product.city ? displayName(product.city.name).text : "",
    placeName: product.poi ? displayName(product.poi.name).text : null,
    station: product.poi?.type === "station",
  };
}

export function ProductEditorPage() {
  const { id, step } = useParams();
  const isNew = id === undefined;
  const validId = isNew || UUID_PATTERN.test(id);
  const location = useLocation();
  const navigate = useNavigate();
  const { portal, account } = usePortalSession();
  const canRead = useTenantCan("product.read");
  const canManage = useTenantCan("product.manage");
  const loaded = useLoad<Product>(`product:${id ?? "new"}`, !isNew && validId && canRead ? (token) => getProduct(token, id) : null);
  const checked = useLoad<PublishCheckResult>(`product-check:${id ?? "new"}`, !isNew && validId && canRead ? (token) => getPublishCheck(token, id) : null);
  const product = isNew ? null : loaded.state.data;
  const check = isNew ? null : checked.state.data;
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (product) setVersion((current) => Math.max(current, product.version));
  }, [product]);
  useEffect(() => setVersion(0), [id]);

  const listPath = returnTo(location.state);
  const listPage = readListPage(location.state);
  const listState = useMemo(() => (listPage ? { listPage } : undefined), [listPage?.key, listPage?.stack.length]);
  const slug = (PRODUCT_STEP_SLUGS as readonly string[]).includes(step ?? "") ? (step as ProductStepSlug) : null;
  const shown = product ? productName(product) : null;
  const pageTitle = isNew ? "新建商品" : (shown?.text ?? "商品");
  useDocumentTitle(isNew ? `新建商品 · NOZOMI ${portal.name}` : slug && shown ? `${STEP_TITLES[slug]} · ${shown.text} · NOZOMI ${portal.name}` : `商品 · NOZOMI ${portal.name}`);

  const reloadProduct = loaded.reload;
  const reloadCheck = checked.reload;
  const setProduct = loaded.set;
  const saved = useCallback(
    (next: number, changed?: Product) => {
      setVersion(next);
      if (changed) setProduct(changed);
      else reloadProduct();
      reloadCheck();
    },
    [setProduct, reloadProduct, reloadCheck],
  );
  const refresh = useCallback(() => {
    reloadProduct();
    reloadCheck();
  }, [reloadProduct, reloadCheck]);
  const actions = useProductActions({
    onUnpublished: (changed) => {
      setVersion(changed.version);
      setProduct(changed);
      reloadCheck();
    },
    onDeleted: () => void navigate(listPath, { state: listState }),
    onStale: refresh,
  });

  const trail = [{ label: "商品配置" }, { label: "商品", to: PRODUCT_LIST_PATH }];
  const shell = (content: ReactNode, header: { action?: ReactNode; meta?: ReactNode } = {}): ReactNode => (
    <AppShell pageName={pageTitle} trail={trail}>
      <Page title={pageTitle} {...(shown && !shown.unnamed ? { titleLang: shown.lang } : {})} width="content" {...header}>
        {content}
      </Page>
    </AppShell>
  );
  const forbidden = <StateBlock tone="neutral" title="你没有权限查看这里" description="需要的话，请联系你们的管理员开通。" />;
  if (account.status === "ready" && (!canRead || (isNew && !canManage))) return shell(forbidden);
  if (!validId || loaded.state.status === "not-found") {
    return shell(
      <StateBlock
        tone="neutral"
        title="找不到这个商品"
        description="它可能已被删除，或链接有误。"
        action={
          <LinkButton variant="primary" to={PRODUCT_LIST_PATH}>
            回到商品列表
          </LinkButton>
        }
      />,
    );
  }
  if (loaded.state.status === "forbidden") return shell(forbidden);

  const readOnly = !canManage;
  const context = product ? checkContextOf(product) : null;
  // 地址里没有步骤：换到第一个还没完成的开放步骤；都完成了去上架检查；完成情况取不到去 ①
  if (!isNew && product && slug === null) {
    if (step !== undefined) return <Navigate to={productPath(product.id)} replace state={location.state} />;
    if (check !== null || checked.state.status !== "loading") {
      const pending = check ? STEPS.find((entry) => entry.slug !== null && check.items.some((item) => item.key === entry.check && !item.passed)) : STEPS[0];
      return <Navigate to={productPath(product.id, check === null ? "basic" : (pending?.slug ?? "publish"))} replace state={location.state} />;
    }
  }

  const checkFailed = !isNew && check === null && checked.state.status === "error";
  const stepStatus = (entry: (typeof STEPS)[number]): StepStatus | "loading" => {
    if (entry.slug === null) return SOON;
    if (isNew) return entry.key === "basic" ? { icon: "circle", tone: "muted", text: "未保存" } : { icon: "lock", tone: "muted", text: "先保存第 1 步" };
    if (check === null || context === null) return checkFailed ? UNKNOWN : "loading";
    const item = check.items.find((candidate) => candidate.key === entry.check);
    if (!item) return UNKNOWN;
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
  const current: ProductStepSlug = isNew ? "basic" : (slug ?? "basic");
  const steps: StepEntry[] = STEPS.map((entry, index) => ({
    key: entry.key,
    number: index + 1,
    name: entry.name,
    current: entry.slug === current,
    status: stepStatus(entry),
    ...(entry.slug !== null && product ? { to: productPath(product.id, entry.slug) } : {}),
  }));
  const done = steps.filter((entry) => entry.status !== "loading" && entry.status.text === "已完成").length;
  const closing: StepEntry[] = [{ key: "publish", name: "上架检查", current: current === "publish", status: publishStatus(), ...(product ? { to: productPath(product.id, "publish") } : {}) }];
  const soon = STEPS.filter((entry) => entry.slug === null).map((entry) => `「${entry.name}」`);
  const nav = <StepNav title="配置步骤" progress={`已完成 ${done} / ${STEPS.length}`} steps={steps} closing={closing} {...(soon.length > 0 ? { note: `${soon.join("")}正在开发，开放后会出现在这里。现在可以先把其他几步配好。` } : {})} />;

  const frame: ProductFrame = { product, version, readOnly, check, checkContext: context, saved, syncVersion: setVersion, refresh, listPath, listState };
  let content: ReactNode;
  if (isNew) content = <BasicStep key="new" frame={frame} />;
  else if (product === null) {
    content =
      loaded.state.status === "error" ? (
        <section className="card">
          <StateBlock
            title="加载失败"
            description="请检查网络后重试。"
            action={
              <Button variant="secondary" onClick={refresh}>
                重试
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <section className="card">
            <Skeleton lines={["medium", "control", "control"]} />
          </section>
          <section className="card">
            <Skeleton lines={["medium", "long", "control"]} label="" />
          </section>
        </>
      );
  } else if (current === "basic") content = <BasicStep key={product.id} frame={frame} />;
  else if (current === "service-rules") content = <ServiceRulesStep key={product.id} frame={frame} product={product} />;
  else if (current === "content") content = <ContentStep key={product.id} frame={frame} product={product} />;
  else content = <PublishStep key={product.id} frame={frame} product={product} onReload={reloadCheck} checkStatus={checked.state.status} />;

  const disabledRefs = product
    ? [
        ...(product.city?.status === "disabled" ? [{ kind: "城市", name: displayName(product.city.name).text, platform: true }] : []),
        ...(product.poi?.status === "disabled" ? [{ kind: "接送点", name: displayName(product.poi.name).text, platform: true }] : []),
        ...(product.brand?.status === "disabled" ? [{ kind: "子品牌", name: product.brand.name, platform: false }] : []),
      ]
    : [];
  const header =
    product && shown
      ? {
          meta: (
            <>
              <StatusBadge {...PRODUCT_STATUS_BADGES[product.status]} />
              <span className="product-meta__code">
                <span className="product-code">{product.code}</span>
                <CopyButton text={product.code} label="复制商品编号" />
              </span>
              <span>{[PRODUCT_CATEGORY_NAMES[product.category], product.city ? displayName(product.city.name).text : null, product.poi ? `${displayName(product.poi.name).text}（${product.poi.code}）` : null].filter((part) => part !== null).join(" · ")}</span>
              <span>{`最近修改 ${formatLocalDateTime(product.updated_at)}`}</span>
            </>
          ),
          ...(canManage && product.status !== "unpublished"
            ? {
                action: (
                  <Dropdown buttonClassName="button button--secondary button--md" buttonContent="更多" label={`${shortName(shown.text)} 的更多操作`} align="end">
                    <ProductMoreItems product={product} actions={actions} withCheck={false} />
                  </Dropdown>
                ),
              }
            : {}),
        }
      : {};

  return shell(
    <div className="steps">
      {actions.notice}
      {readOnly && <Alert kind="info">你可以查看商品，但不能修改。需要修改的话，请联系你们的管理员开通。</Alert>}
      {disabledRefs.map((entry) => (
        <Alert key={entry.kind} kind="warning">
          <strong className="alert__title">{`这个商品的${entry.kind}「${entry.name}」已停用。`}</strong>
          <span>{`配置可以照常修改，但商品不能上架、不会参与报价。${entry.platform ? "请联系平台运营确认。" : ""}`}</span>
        </Alert>
      ))}
      {checkFailed && (
        <Alert kind="warning">
          <span>配置进度没有加载出来，不影响填写和保存。</span>
          <Button variant="text" size="sm" onClick={reloadCheck}>
            重试
          </Button>
        </Alert>
      )}
      <div className="steps__layout">
        {nav}
        <div className="steps__content">{content}</div>
      </div>
      {actions.dialog}
    </div>,
    header,
  );
}

