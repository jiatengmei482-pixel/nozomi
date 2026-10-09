/**
 * 上架检查（docs/design/pages/tenant-products.md 第 7 节）：现在能不能上架？不能的话差什么？差的是我去补，还是在等功能开放？
 * 「功能即将开放」先于「没满足」判断：它不是出错，用信息色，不出现「失败」「错误」这些词。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type Product, type PublishCheckItemBody, type PublishCheckResult, setProductPublished } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { Skeleton, StateBlock } from "../../components/States.tsx";
import { useToast } from "../../components/Toast.tsx";
import { shortName } from "../../lib/master-display.ts";
import { CHECK_STEP, type CheckItemState, checkItemName, checkItemState, checkOverview, checkReasons, productName, quoteNames } from "../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, saveFailureText } from "../../lib/product-failure.ts";
import { pricePath, productPath } from "../../lib/product-paths.ts";
import type { ProductFrame } from "./frame.ts";
import { useProductActions } from "./useProductActions.tsx";

const STATE_LOOK: Readonly<Record<CheckItemState, { icon: IconName; tone: string }>> = {
  passed: { icon: "check-circle", tone: "success" },
  missing: { icon: "alert-triangle", tone: "warning" },
  unavailable: { icon: "clock", tone: "info" },
  optional: { icon: "minus", tone: "muted" },
};
const UNAVAILABLE_NOTES: Readonly<Record<string, string>> = { price_rules: "不是出错：设价格的页面还在开发。开放后在那里设好至少 1 条启用的价格规则，这一项就会满足。" };
const OPTIONAL_NOTES: Readonly<Record<string, string>> = { adjust_rules: "节假日、旺季想调价时才用。", inventory: "不设就是不限量；想限制每天接多少单时才用。" };

export function PublishStep({ frame, product, onReload, checkStatus }: { frame: ProductFrame; product: Product; onReload(): void; checkStatus: string }) {
  const { readOnly, checkContext } = frame;
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const rejection = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** 上架被拒时应答里带的最新结果：先用它，直到下一次重新检查 */
  const [rejected, setRejected] = useState<PublishCheckResult | null>(null);
  const name = productName(product).text;
  const actions = useProductActions({
    onUnpublished: (changed) => frame.saved(changed.version, changed),
    onDeleted: () => void navigate(frame.listPath, { state: frame.listState }),
    onStale: frame.refresh,
  });

  // 进入这一页就重新检查一次，不用别处缓存的
  useEffect(() => {
    onReload();
    heading.current?.focus();
  }, []);
  useEffect(() => {
    if (rejected) rejection.current?.focus();
  }, [rejected]);

  const check = rejected ?? frame.check;
  const recheck = (): void => {
    setRejected(null);
    onReload();
  };

  const publish = async (): Promise<void> => {
    setWorking(true);
    setFailure(null);
    try {
      const changed = await setProductPublished(token, product.id, "publish");
      setConfirming(false);
      toast(`已上架「${shortName(name)}」`);
      frame.saved(changed.version, changed);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "PUBLISH_CHECK_FAILED") {
        setConfirming(false);
        setRejected({ can_publish: false, items: Array.isArray(err.details["items"]) ? (err.details["items"] as PublishCheckItemBody[]) : (frame.check?.items ?? []) });
      } else if (err instanceof ApiError && err.status === 403) setFailure(PRODUCT_FORBIDDEN_TEXT);
      else if (err instanceof ApiError && err.status === 409 && /[一-鿿]/.test(err.message)) setFailure(err.message);
      else setFailure(`上架没有成功。${saveFailureText(err, "上架")}`);
    } finally {
      setWorking(false);
    }
  };

  const title = (
    <div className="step__title-row">
      <h2 className="step__title" ref={heading} tabIndex={-1}>
        上架检查
      </h2>
      <Button variant="text" size="sm" disabled={checkStatus === "loading"} onClick={recheck}>
        <Icon name="refresh" />
        重新检查
      </Button>
    </div>
  );
  if (check === null || checkContext === null) {
    return (
      <div className="step">
        {title}
        <section className="card">
          {checkStatus === "loading" ? (
            <Skeleton lines={["long", "control", "control", "control"]} label="正在检查" />
          ) : (
            <StateBlock
              title="检查结果没有加载出来"
              description="请检查网络后重试。"
              action={
                <Button variant="secondary" onClick={recheck}>
                  重试
                </Button>
              }
            />
          )}
        </section>
      </div>
    );
  }

  const overview = checkOverview(check);
  const published = product.status === "published";
  const failedCount = overview.failed.length;
  const waiting = quoteNames(overview.unavailable);
  const summary: { kind: "warning" | "info" | "success"; title: string; body: ReactNode } = published
    ? failedCount > 0
      ? { kind: "warning", title: `已上架，但有 ${failedCount} 项需要处理`, body: "这些问题会让这个商品报不出价，请尽快修改。" }
      : { kind: "success", title: "已上架", body: "这个商品正在参与报价和接单。修改任何一步，保存后大约 1 分钟生效。" }
    : failedCount > 0
      ? { kind: "warning", title: `还不能上架：还有 ${failedCount} 项要补`, body: `下面标了「${readOnly ? "去查看" : "去修改"}」的就是要补的。${overview.unavailable.length > 0 ? `另外，${waiting}功能还没有开放，见下面的说明。` : ""}` }
      : overview.unavailable.length > 0
        ? {
            kind: "info",
            title: "你能配的都配好了，现在还不能上架",
            body: (
              <>
                <strong>这不是出错。</strong>
                {`上架还需要${waiting}，这个功能正在开发，还没有开放。开放后把它配好，就可以回到这里上架。已经配好的内容都保存着，不用重做。`}
              </>
            ),
          }
        : { kind: "success", title: "可以上架了", body: "必须的检查都通过了。点下面的「上架」，这个商品就开始参与报价和接单。" };

  // 库存是限量、从今天起却没有一天有库存：不拦上架，但上了架也卖不出去
  const noStockAhead = check.items.some((item) => item.key === "inventory" && item.issues.some((issue) => issue.reason === "NO_INVENTORY_AHEAD"));
  const row = (item: PublishCheckItemBody): ReactNode => {
    const state = checkItemState(item);
    const look = STATE_LOOK[state];
    const itemName = checkItemName(item.key);
    const step = CHECK_STEP[item.key as keyof typeof CHECK_STEP];
    // 不是必须的项也可能有要提醒的（调价规则会把价格调到不大于 0）
    const reasons = state === "missing" || (state === "optional" && !item.passed) ? checkReasons(item, checkContext) : [];
    const stepPath = item.key === "adjust_rules" ? pricePath(product.id, "adjust") : step ? productPath(product.id, step) : null;
    const heedful = item.key === "inventory" && reasons.length > 0;
    const stateText = state === "passed" ? "已满足" : state === "missing" ? `还差 ${Math.max(1, reasons.length)} 项` : state === "unavailable" ? "功能即将开放" : heedful ? `有 ${reasons.length} 处要留意` : "不是必须";
    const optionalNote = item.key === "inventory" ? (frame.inventoryMode === "unlimited" ? "现在是不限量，每天接多少单都可以。想限制每天接多少单时才用设。" : frame.inventoryMode === "limited" ? "现在是限量，按每天设的库存接单。" : (OPTIONAL_NOTES[item.key] ?? "")) : (OPTIONAL_NOTES[item.key] ?? "");
    return (
      <li key={item.key} className="checklist__item" data-check={item.key}>
        <div className="checklist__head">
          <span className={`checklist__icon checklist__icon--${heedful ? "warning" : look.tone}`}>
            <Icon name={heedful ? "alert-triangle" : look.icon} />
          </span>
          <span className="checklist__name">
            {itemName}
            <span className="visually-hidden">，</span>
          </span>
          <span className={`checklist__state checklist__state--${heedful ? "warning" : look.tone}`}>{stateText}</span>
          {state === "missing" && step && (
            <LinkButton size="sm" className="checklist__action" to={productPath(product.id, step)} aria-label={`${readOnly ? "去查看" : "去修改"}：${itemName}`}>
              {readOnly ? "去查看" : "去修改"}
            </LinkButton>
          )}
        </div>
        {reasons.length > 0 && (
          <ul className="checklist__reasons">
            {reasons.map((reason) => (
              <li key={reason.text}>
                <span>{reason.text}</span>
                {reason.anchor !== null && step && stepPath ? (
                  <Link className="link checklist__go" to={step === "prices" ? (reason.anchor !== null && reason.anchor.startsWith("adjust/") ? pricePath(product.id, "adjust", reason.anchor.slice("adjust".length)) : stepPath) : productPath(product.id, step, reason.anchor === "" ? undefined : reason.anchor)} aria-label={`${readOnly ? "去查看" : item.key === "inventory" ? "去设" : "去填"}：${reason.text}`}>
                    {readOnly ? "去查看" : item.key === "inventory" ? "去设" : "去填"}
                    <Icon name="chevron-right" />
                  </Link>
                ) : (
                  reason.note && <span className="checklist__note">{reason.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {state === "unavailable" && <p className="checklist__text">{UNAVAILABLE_NOTES[item.key] ?? "不是出错：这个功能还在开发。开放后在那里配好，这一项就会满足。"}</p>}
        {state === "optional" && !heedful && <p className="checklist__text">{`${optionalNote}${step ? "" : "功能还在开发。"}`}</p>}
      </li>
    );
  };
  const required = check.items.filter((item) => item.required);
  const optional = check.items.filter((item) => !item.required);
  const canPublish = overview.canPublish;
  const blockedNote = failedCount > 0 ? `还不能上架：还有 ${failedCount} 项要补${overview.unavailable.length > 0 ? `，另有${waiting}功能未开放` : ""}。` : `还不能上架：${waiting}开放并配好以后才能上架。`;

  return (
    <div className="step">
      {title}
      {actions.notice}
      <section className={checkStatus === "loading" ? "card checklist-card checklist-card--refreshing" : "card checklist-card"}>
        {rejected && (
          <div role="alert" ref={rejection} tabIndex={-1}>
            <Alert kind="danger">
              <strong className="alert__title">没有上架。</strong>
              <span>检查结果和刚才不一样了，请看下面最新的结果。</span>
            </Alert>
          </div>
        )}
        <div role="status">
          <Alert kind={summary.kind}>
            <strong className="alert__title">{summary.title}</strong>
            <span>
              {summary.body}
              {noStockAhead && !published && " 另外，库存是限量的，但从今天起没有一天有库存，这个商品现在卖不出去（见下面「库存」一项）。"}
            </span>
          </Alert>
        </div>
        <h3 className="checklist__group">上架前必须满足</h3>
        <ul className="checklist">{required.map(row)}</ul>
        {optional.length > 0 && (
          <>
            <h3 className="checklist__group">可以不设</h3>
            <ul className="checklist">{optional.map(row)}</ul>
          </>
        )}
        {!readOnly && (
          <div className="publish-bar">
            {published ? (
              <>
                <Button className="button--danger-text" onClick={() => actions.requestUnpublish(product)}>
                  下架
                </Button>
                <span className="publish-bar__note">下架后不再参与报价，已经接到的订单不受影响。</span>
              </>
            ) : (
              <>
                <Button variant="primary" aria-disabled={!canPublish || undefined} aria-describedby="publish-note" onClick={() => canPublish && setConfirming(true)}>
                  上架
                </Button>
                <span className="publish-bar__note" id="publish-note">
                  {canPublish ? "上架后开始参与报价和接单。" : blockedNote}
                </span>
              </>
            )}
          </div>
        )}
      </section>
      {readOnly && (
        <div>
          <LinkButton to={frame.listPath} state={frame.listState}>
            回到列表
          </LinkButton>
        </div>
      )}
      <Dialog
        open={confirming}
        title={`上架「${name}」？`}
        busy={working}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" data-autofocus disabled={working} onClick={() => setConfirming(false)}>
              取消
            </Button>
            <Button variant="primary" loading={working} loadingText="上架中…" onClick={() => void publish()}>
              上架
            </Button>
          </>
        }
      >
        <div role="alert">{failure !== null && <Alert kind="danger">{failure}</Alert>}</div>
        <p>上架后，这个商品开始参与报价和接单：</p>
        <ul className="dialog__list">
          <li>销售端询价时，会按你设的价格报出结算价；</li>
          <li>
            客人下单并付款后，订单直接派给你们，<strong>不能拒单</strong>；
          </li>
          <li>之后修改任何规则，保存后大约 1 分钟生效。</li>
        </ul>
        {noStockAhead && (
          <p className="adjust-warning">
            <Icon name="alert-triangle" />
            <span>
              <strong>现在上架也卖不出去</strong>：库存是限量的，从今天起没有一天有库存。可以先去设库存，也可以先上架、之后再设。
            </span>
          </p>
        )}
      </Dialog>
      {actions.dialog}
    </div>
  );
}
