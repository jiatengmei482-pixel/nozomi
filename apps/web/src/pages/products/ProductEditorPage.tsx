/**
 * 新建 / 编辑商品的框架（docs/design/pages/tenant-products.md 第 3 节）：标题行、步骤导航、当前步骤。
 * 每一步单独保存；整个商品只有一个版本号，存在这里各步共用；每一步的完成情况取自上架检查。
 */
import { type InventoryMode, PRODUCT_CATEGORY_NAMES } from "@nozomi/domain";
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
import { displayName, formatLocalDateTime, shortName } from "../../lib/master-display.ts";
import { PRODUCT_STATUS_BADGES, productName } from "../../lib/product-display.ts";
import { PRODUCT_LIST_PATH, PRODUCT_STEP_SLUGS, type ProductStepSlug, productPath } from "../../lib/product-paths.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { useLoad } from "../../lib/use-load.ts";
import { useTenantCan } from "../../lib/use-master-access.ts";
import { readListPage } from "../master/shared.tsx";
import { type Inventory, getInventory } from "../../api/inventory.ts";
import type { ProductFrame } from "./frame.ts";
import { PRODUCT_STEP_TITLES, ProductSteps, checkContextOf, firstPendingStep } from "./ProductSteps.tsx";
import { TENANT_PRODUCT_SOURCE } from "./source.ts";
import { ProductMoreItems, useProductActions } from "./useProductActions.tsx";

/** 只用来给「取一天的库存」这个请求填日期（要的是应答里的模式）；页面上的「今天」一律用接口给的。 */
const requestDate = new Date().toISOString().slice(0, 10);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function returnTo(state: unknown): string {
  const from = typeof state === "object" && state !== null ? (state as { from?: unknown }).from : undefined;
  return typeof from === "string" && (from === PRODUCT_LIST_PATH || from.startsWith(`${PRODUCT_LIST_PATH}?`)) ? from : PRODUCT_LIST_PATH;
}

export function ProductEditorPage() {
  const params = useParams();
  const id = params["id"];
  // 步骤后面还可以有分区（第 ③ 步的页签、某一条调价规则）：/products/{id}/prices/adjust/{规则编号}
  const [step, ...rest] = (params["*"] ?? "").split("/").filter((part) => part !== "") as [string | undefined, ...string[]];
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
  useDocumentTitle(isNew ? `新建商品 · NOZOMI ${portal.name}` : slug && shown ? `${rest[0] === "import" && slug === "prices" ? "导入价格" : rest[0] === "import" && slug === "inventory" ? "导入库存" : PRODUCT_STEP_TITLES[slug]} · ${shown.text} · NOZOMI ${portal.name}` : `商品 · NOZOMI ${portal.name}`);

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
  // 库存是哪种模式：进入编辑页时取一次（只为了步骤导航和上架检查上的那句话）；第 ④ 步里每次取数、改模式后再告诉这里
  const [inventoryMode, setInventoryMode] = useState<InventoryMode | null>(null);
  const modeLoaded = useLoad<Inventory>(`product-inventory:${id ?? "new"}`, !isNew && validId && canRead ? (token) => getInventory(token, id, { from: requestDate, to: requestDate }) : null);
  const loadedMode = modeLoaded.state.data?.mode ?? null;
  useEffect(() => {
    if (loadedMode !== null) setInventoryMode(loadedMode);
  }, [loadedMode]);
  useEffect(() => setInventoryMode(null), [id]);
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
    if (check !== null || checked.state.status !== "loading") return <Navigate to={productPath(product.id, check === null ? "basic" : firstPendingStep(check))} replace state={location.state} />;
  }

  const checkFailed = !isNew && check === null && checked.state.status === "error";
  const current: ProductStepSlug = isNew ? "basic" : (slug ?? "basic");
  const frame: ProductFrame = { product, version, readOnly, source: TENANT_PRODUCT_SOURCE, check, checkContext: context, inventoryMode, setInventoryMode, saved, syncVersion: setVersion, refresh, listPath, listState };
  const placeholder =
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
      <ProductSteps frame={frame} isNew={isNew} current={current} rest={rest} checkStatus={checked.state.status} onReloadCheck={reloadCheck} placeholder={placeholder} />
      {actions.dialog}
    </div>,
    header,
  );
}

