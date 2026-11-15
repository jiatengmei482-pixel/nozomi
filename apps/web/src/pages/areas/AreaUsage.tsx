/**
 * 区域详情的「在哪些商品里用」（M9P-13，规格第四节第 3 小节）：每个用到它的商品、当哪一层（① 基础价、② 行程、③ 上下车加价；
 * 接送机、点对点是服务区域），和按画面上的图形现算的包车三层重叠（#247 审查建议：只提醒、不拦保存）。
 */
import { Link } from "react-router";
import type { ProductAreaLayers } from "../../api/areas.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { type AreaUse, AREA_LAYER_SHORT, areaUses, productLabel, useLayerText } from "../../lib/area-layers.ts";
import { PRODUCT_STATUS_BADGES } from "../../lib/product-display.ts";
import { productPath } from "../../lib/product-paths.ts";
import { AREA_MAP_PATH } from "../../lib/area-paths.ts";

export interface AreaUsageProps {
  areaId: string;
  /** 本供应商每个商品的三层区域；`null` = 还没取到 */
  products: readonly ProductAreaLayers[] | null;
  loadFailed: boolean;
  onRetry(): void;
  canSeeProducts: boolean;
  /** 包车三层重叠（现算的），一条一句 */
  overlaps: readonly { key: string; text: string }[];
}

function UseRow({ use, canSeeProducts }: { use: AreaUse; canSeeProducts: boolean }) {
  const label = productLabel(use.product);
  return (
    <li className="area-usage__item" data-product-id={use.product.product_id}>
      {canSeeProducts ? (
        <Link className="link" to={productPath(use.product.product_id)}>
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      <StatusBadge {...PRODUCT_STATUS_BADGES[use.product.status]} />
      <span className="area-usage__layers">
        {use.product.category === "charter" ? (
          use.layers.map((layer) => (
            <span key={layer} className="tag" data-layer={layer}>
              {AREA_LAYER_SHORT[layer]}
            </span>
          ))
        ) : (
          <span className="tag">{useLayerText(use)}</span>
        )}
      </span>
      {use.product.category === "charter" && (
        <Link className="link" to={`${AREA_MAP_PATH}?product=${use.product.product_id}`} aria-label={`在地图上看「${label}」的全部区域`}>
          在地图上看全部
        </Link>
      )}
    </li>
  );
}

export function AreaUsage({ areaId, products, loadFailed, onRetry, canSeeProducts, overlaps }: AreaUsageProps) {
  const uses = products === null ? null : areaUses(areaId, products);
  return (
    <section className="card area-editor__usage" aria-labelledby="area-usage-title">
      <h2 className="card__title" id="area-usage-title">
        在哪些商品里用
      </h2>
      {uses === null ? (
        loadFailed ? (
          <p className="field__hint">
            没有加载出来。{" "}
            <Button size="sm" variant="text" onClick={onRetry}>
              重试
            </Button>
          </p>
        ) : (
          <p className="field__hint" role="status">
            正在加载…
          </p>
        )
      ) : uses.length === 0 ? (
        <p className="field__hint">还没有商品用到这个区域。</p>
      ) : (
        <>
          <ul className="area-usage" aria-label="用到这个区域的商品">
            {uses.map((use) => (
              <UseRow key={use.product.product_id} use={use} canSeeProducts={canSeeProducts} />
            ))}
          </ul>
          <p className="field__hint">① 基础价区域：商品的服务区域，在这里上下车按套餐价、不加价；② 行程区域：经停在这里收行程加价；③ 上下车加价区域：在这里上下车收上下车加价。</p>
        </>
      )}
      {overlaps.length > 0 && (
        <div role="status" data-charter-overlaps="">
          <Alert kind="warning">
            <strong className="alert__title">{`有 ${overlaps.length} 处三层区域重叠`}</strong>
            <span>同一个包车商品里，同一层的区域、基础价区域和上下车加价区域都不能重叠（一个点只能有一个答案）。只是提醒，可以保存；上架检查也会列出来。可以用「从本区域减去另一个区域」切掉重叠的部分。</span>
            <ul className="area-editor__overlap-list">
              {overlaps.map((entry) => (
                <li key={entry.key}>{entry.text}</li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
    </section>
  );
}
