/**
 * 商品的下架（要确认）和删除草稿（要确认，删了不能恢复）：列表行和编辑页标题行的「更多」共用。
 * 上架只在「上架检查」那一页做（要先看检查清单）。docs/design/pages/tenant-products.md 7.5、7.6。
 */
import { PRODUCT_CATEGORY_NAMES } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type Product, type ProductSummary, deleteProduct, setProductPublished } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { useToast } from "../../components/Toast.tsx";
import { displayName, shortName } from "../../lib/master-display.ts";
import { productName } from "../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText } from "../../lib/product-failure.ts";
import { productPath } from "../../lib/product-paths.ts";

type Target = Pick<ProductSummary, "id" | "code" | "status" | "category" | "title" | "city">;

interface Pending {
  product: Target;
  action: "unpublish" | "delete";
  phase: "confirm" | "working" | "rejected" | "failed";
  text?: string;
}

export interface ProductActions {
  requestUnpublish(product: Target): void;
  requestDelete(product: Target): void;
  dialog: ReactNode;
  /** 要删的商品已经被别人删了等情况的页面级提示 */
  notice: ReactNode;
}

export function useProductActions(options: { onUnpublished(product: Product): void; onDeleted(product: Target): void; onStale(product: Target): void }): ProductActions {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    const { product, action } = pending;
    const name = productName(product).text;
    setPending({ product, action, phase: "working" });
    try {
      if (action === "unpublish") {
        const result = await setProductPublished(token, product.id, "unpublish");
        setPending(null);
        options.onUnpublished(result);
        toast(`已下架「${shortName(name)}」`);
      } else {
        await deleteProduct(token, product.id);
        setPending(null);
        options.onDeleted(product);
        toast(`已删除草稿「${shortName(name)}」`);
      }
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const verb = action === "unpublish" ? "下架" : "删除";
      if (err instanceof ApiError && err.status === 404) {
        setPending(null);
        options.onDeleted(product);
        setNotice(`「${name}」已经被别人删除了。`);
      } else if (err instanceof ApiError && err.code === "PRODUCT_NOT_DRAFT") {
        setPending({ product, action, phase: "rejected", text: "这个商品已经上过架，不再是草稿。不想卖的话可以下架。" });
      } else if (err instanceof ApiError && err.code === "PRODUCT_STATE_INVALID") {
        setPending(null);
        options.onStale(product);
      } else if (err instanceof ApiError && err.status === 403) {
        setPending({ product, action, phase: "rejected", text: PRODUCT_FORBIDDEN_TEXT });
      } else {
        setPending({ product, action, phase: "failed", text: `${verb}没有成功。${saveFailureText(err, verb)}` });
      }
    }
  };

  const close = (): void => {
    const stale = pending?.phase === "rejected" ? pending.product : null;
    setPending(null);
    if (stale) options.onStale(stale);
  };

  const product = pending?.product ?? null;
  const name = product ? productName(product).text : "";
  const working = pending?.phase === "working";
  const isDelete = pending?.action === "delete";
  const verb = isDelete ? "删除" : "下架";
  const dialog = (
    <Dialog
      open={pending !== null}
      title={isDelete ? `删除草稿「${name}」？` : `下架「${name}」？`}
      {...(product && isDelete ? { subtitle: `${PRODUCT_CATEGORY_NAMES[product.category]} · ${product.city ? displayName(product.city.name).text : "—"} · ${product.code}` } : {})}
      busy={working}
      onClose={close}
      footer={
        pending?.phase === "rejected" ? (
          <Button variant="secondary" data-autofocus onClick={close}>
            知道了
          </Button>
        ) : (
          <>
            <Button variant="secondary" data-autofocus disabled={working} onClick={close}>
              取消
            </Button>
            <Button variant="danger" loading={working} loadingText={`${verb}中…`} onClick={() => void confirm()}>
              {verb}
            </Button>
          </>
        )
      }
    >
      <div role="alert">
        {pending?.phase === "rejected" && (
          <Alert kind="danger">
            <strong className="alert__title">{`现在不能${verb}。`}</strong>
            <span>{pending.text}</span>
          </Alert>
        )}
        {pending?.phase === "failed" && <Alert kind="danger">{pending.text}</Alert>}
      </div>
      {pending?.phase !== "rejected" &&
        (isDelete ? (
          <p>删除后不能恢复。这个商品已经填好的基础信息、服务规则和商品详情会一起删除。</p>
        ) : (
          <p>
            下架后，这个商品不再参与报价，不会再有新订单。<strong>已经接到的订单不受影响，仍然要照常履约。</strong>之后可以重新上架，重新上架时会再检查一遍。
          </p>
        ))}
    </Dialog>
  );

  return {
    requestUnpublish: (target) => setPending({ product: target, action: "unpublish", phase: "confirm" }),
    requestDelete: (target) => setPending({ product: target, action: "delete", phase: "confirm" }),
    dialog,
    notice: <div role="status">{notice !== null && <Alert kind="info">{notice}</Alert>}</div>,
  };
}

/** 「更多」菜单里按状态给的项：草稿可以删除，已上架可以下架；`withCheck` 时最前面多一项「上架检查」。 */
export function ProductMoreItems({ product, actions, withCheck }: { product: Target; actions: ProductActions; withCheck: boolean }) {
  return (
    <>
      {withCheck && (
        <Link role="menuitem" className="menu-item" to={productPath(product.id, "publish")}>
          <span className="menu-item__text">上架检查</span>
        </Link>
      )}
      {product.status === "draft" && (
        <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => actions.requestDelete(product)}>
          <span className="menu-item__text">删除</span>
        </button>
      )}
      {product.status === "published" && (
        <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => actions.requestUnpublish(product)}>
          <span className="menu-item__text">下架</span>
        </button>
      )}
    </>
  );
}
