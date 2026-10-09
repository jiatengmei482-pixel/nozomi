/**
 * 一步的外壳：标题、页面级提示、吸底的操作区、保存、保存被拒、别人先改了、离开或换步骤时的确认。
 * 每一步只管自己的字段和「怎么提交」；这里管所有步骤都一样的事（docs/design/pages/tenant-products.md 3.3、3.4、第 8 节）。
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import type { PublishCheckItemBody } from "../../api/products.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert, type AlertKind } from "../../components/Alert.tsx";
import { Button, LinkButton } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useToast } from "../../components/Toast.tsx";
import { CHECK_STEP, checkItemName, checkReasons, isUnavailable } from "../../lib/product-display.ts";
import { PRODUCT_FORBIDDEN_TEXT, type ServerIssue, saveFailureText, serverIssues } from "../../lib/product-failure.ts";
import { PRODUCT_LIST_PATH, type ProductStepSlug, productPath } from "../../lib/product-paths.ts";
import { useLeaveGuard } from "../../lib/use-leave-guard.ts";
import { type ProductFrame, type StepProblem, focusAnchor } from "./frame.ts";

const LOCKED_FIELD_NAMES: Readonly<Record<string, string>> = { brand_id: "子品牌", city_id: "城市", category: "品类", poi_id: "接送点" };

export interface StepController {
  /** 当前内容和上次取到（或保存成功）时不同 */
  dirty: boolean;
  /** 按页面上现在的内容算，上架前这一步还差几项；`anchor` 是第一处 */
  missing: { count: number; anchor: string | null };
  /** 「写错了的」。没有就返回空数组 */
  validate(): StepProblem[];
  /** 提交；成功返回商品编号（新建时是新商品的）。失败抛出接口的错误 */
  submit(): Promise<string>;
  /** 后端在 400 里指出的问题 → 落到字段上，并返回要列在页面顶部的条目；返回空数组表示对不上任何字段 */
  placeServerIssues(issues: ServerIssue[]): StepProblem[];
  /** 重新取这一步的内容（别人先改了之后） */
  reload(): void;
  /** 现在不能保存的原因（如「还没有子品牌」）；能保存是 null */
  blocked?: string | null;
  /** 用户没动过，但页面上有替他填好、还没存过的建议值：点保存要真的提交 */
  pending?: boolean;
  /** 保存成功后 Toast 上的话；不给就是「已保存」 */
  successText?(): string;
  /** 这一步自己处理的拒绝（如价格的日期重叠）：处理了返回 true，别的照常走下面的通用处理 */
  handleRejection?(err: unknown): boolean;
  /** 别人先改了之后「载入最新内容」会不会保留这一步没保存的修改（价格表会：一次可能改了几十行） */
  keepsEditsOnReload?: boolean;
  /** 操作区左侧的概况；不给就是「这一步已完成 / 还差 N 项」 */
  summary?: ReactNode;
}

export interface StepView {
  /** 提交中：字段只读 */
  busy: boolean;
  /** 点过保存：显示「写错了的」 */
  attempted: boolean;
  /** 从「去填」或「这一步还差 N 项」带过来的锚点：对应字段下面显示「上架前要填这一项。」 */
  hint: string | null;
}

interface TopNotice {
  kind: AlertKind;
  title?: string;
  text: string;
  items?: StepProblem[];
  action?: ReactNode;
}

export function StepShell({
  frame,
  slug,
  title,
  next,
  controller,
  hideTitle = false,
  intro,
  children,
}: {
  frame: ProductFrame;
  slug: ProductStepSlug;
  title: string;
  /** 「保存并下一步」去哪 */
  next: { slug: ProductStepSlug; label: string };
  controller: StepController;
  /** 标题由外面画（第 ③ 步：标题下面还有说明行和页签） */
  hideTitle?: boolean;
  intro?: ReactNode;
  children(view: StepView): ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { handleAuthFailure } = usePortalSession();
  const [saving, setSaving] = useState<"stay" | "next" | "leave" | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [problems, setProblems] = useState<StepProblem[]>([]);
  const [notice, setNotice] = useState<TopNotice | null>(null);
  const [conflict, setConflict] = useState(false);
  const [locked, setLocked] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  // 带着锚点来的（上架检查的「去填」）：那个字段下面的提示从第一次渲染起就在，不等焦点落过去以后再出现
  const [hint, setHint] = useState<string | null>(() => (location.hash.length > 1 ? location.hash.slice(1) : null));
  const heading = useRef<HTMLHeadingElement>(null);
  const created = frame.product === null;
  const status = frame.product?.status ?? "draft";

  useLeaveGuard(controller.dirty && saving === null && !frame.readOnly, setLeaving);

  // 进入这一步：带着锚点来的（上架检查的「去填」）把焦点带到那个字段，否则到标题
  const anchor = location.hash.slice(1);
  useEffect(() => {
    if (anchor !== "" && focusAnchor(anchor)) setHint(anchor);
    else heading.current?.focus();
  }, [slug, anchor]);

  const showProblems = (found: StepProblem[]): void => {
    setProblems(found);
    const first = found[0];
    if (first) requestAnimationFrame(() => focusAnchor(first.target));
  };

  const rejected = (err: unknown): void => {
    if (handleAuthFailure(err)) return;
    if (controller.handleRejection?.(err) === true) return;
    if (!(err instanceof ApiError)) return setNotice({ kind: "danger", text: saveFailureText(err, "保存", true) });
    switch (err.code) {
      case "VALIDATION_FAILED": {
        const placed = controller.placeServerIssues(serverIssues(err));
        if (placed.length > 0) return showProblems(placed);
        return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      }
      case "BAD_REQUEST":
        return setNotice({ kind: "danger", text: "提交的内容不符合要求，请检查后重试。" });
      case "MASTER_DATA_NOT_READY": {
        const reason = typeof err.details["reason"] === "string" ? err.details["reason"] : "";
        const placed = controller.placeServerIssues([{ path: reason === "PICKUP_PLACE_DISABLED" || reason === "PICKUP_PLACE_OTHER_CITY" ? "/poi_id" : "/city_id", reason: reason === "" ? "CITY_DISABLED" : reason, message: "", detail: {} }]);
        return placed.length > 0 ? showProblems(placed) : setNotice({ kind: "danger", text: "选的城市或接送点已经被平台停用，请换一个。" });
      }
      case "PUBLISH_CHECK_FAILED": {
        const items = Array.isArray(err.details["items"]) ? (err.details["items"] as PublishCheckItemBody[]) : [];
        const context = frame.checkContext;
        const reasons = context === null ? [] : items.filter((item) => item.required && !item.passed && !isUnavailable(item)).flatMap((item) => checkReasons(item, context).map((reason) => ({ text: `${checkItemName(item.key)}：${reason.text}`, target: CHECK_STEP[item.key as keyof typeof CHECK_STEP] === slug && reason.anchor ? reason.anchor : "" })));
        return setNotice({ kind: "danger", title: "没有保存。", text: "这个商品已上架，改成这样就不满足上架的条件了。请补齐后再保存；要大改，请先下架。", items: reasons });
      }
      case "VERSION_CONFLICT":
        return setConflict(true);
      case "CONCURRENT_UPDATE":
        return setNotice({ kind: "warning", text: "同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。" });
      case "FIELD_LOCKED": {
        const fields = Array.isArray(err.details["fields"]) ? (err.details["fields"] as unknown[]).map((field) => LOCKED_FIELD_NAMES[String(field)]).filter((name): name is string => name !== undefined) : [];
        return setNotice({ kind: "danger", text: `${fields.length > 0 ? fields.join("、") : "有些内容"}创建后不能修改。请刷新页面后重试。` });
      }
      default:
        if (err.status === 403) {
          setLocked("没有修改权限");
          return setNotice({ kind: "danger", text: PRODUCT_FORBIDDEN_TEXT });
        }
        if (err.status === 404) {
          setLocked("这个商品已经不存在");
          return setNotice({ kind: "danger", text: "找不到这个商品，它可能已被别人删除。", action: <Link className="link" to={PRODUCT_LIST_PATH}>回到商品列表</Link> });
        }
        return setNotice({ kind: "danger", text: saveFailureText(err, "保存", true) });
    }
  };

  /** 保存这一步。`then`："stay" 留在这一步；"next" 去下一步；其他是要去的地址（离开确认里的「保存并继续」）。 */
  const save = async (then: "stay" | "next" | string): Promise<void> => {
    if (saving !== null || conflict || locked !== null || (controller.blocked ?? null) !== null) return;
    setAttempted(true);
    setNotice(null);
    const found = controller.validate();
    if (found.length > 0) return showProblems(found);
    setProblems([]);
    const destination = (id: string): string | null => (then === "next" ? productPath(id, next.slug) : then === "stay" ? (created ? productPath(id, "basic") : null) : then);
    if (!controller.dirty && controller.pending !== true && frame.product !== null) {
      const to = destination(frame.product.id);
      if (to !== null) void navigate(to);
      return;
    }
    setSaving(then === "stay" ? "stay" : then === "next" ? "next" : "leave");
    try {
      const successText = controller.successText?.() ?? "已保存";
      const id = await controller.submit();
      toast(created ? "已创建商品，现在是草稿" : successText);
      setAttempted(false);
      const to = destination(id);
      if (to !== null) void navigate(to, created ? { replace: true, state: { created: true } } : {});
    } catch (err) {
      rejected(err);
    } finally {
      setSaving(null);
    }
  };

  const cancel = (): void => {
    if (controller.dirty) setLeaving(frame.listPath);
    else void navigate(frame.listPath, { state: frame.listState });
  };

  const busy = saving !== null;
  const disabled = conflict || locked !== null || (controller.blocked ?? null) !== null;
  const reason = conflict ? "请先载入最新内容" : (locked ?? controller.blocked ?? null);
  const saveLabel = status === "draft" ? "保存草稿" : "保存";
  const view: StepView = { busy, attempted, hint };

  return (
    <div className="step">
      {!hideTitle && (
        <h2 className="step__title" ref={heading} tabIndex={-1}>
          {title}
        </h2>
      )}
      <div role="alert" className="step__alerts">
        {problems.length > 0 && (
          <Alert kind="danger">
            <strong className="alert__title">{`有 ${problems.length} 处需要修改`}</strong>
            <span className="error-summary__list">
              {problems.map((problem, index) => (
                <button key={index} type="button" className="link error-summary__item" onClick={() => focusAnchor(problem.target)}>
                  {problem.text}
                </button>
              ))}
            </span>
          </Alert>
        )}
        {conflict && (
          <Alert kind="warning">
            <strong className="alert__title">{controller.keepsEditsOnReload ? "这个商品刚被别人修改过，你的修改还没有保存。" : "这个商品刚被别人修改过，你在这一步的修改还没有保存。"}</strong>
            <span>{controller.keepsEditsOnReload ? "点下面的按钮载入最新的内容，你没保存的修改会留着。" : "请先载入最新内容，再重新修改。载入后，你在这一步还没保存的修改会丢失。"}</span>
            <span className="alert__actions">
              <Button
                size="sm"
                onClick={() => {
                  frame.refresh();
                  controller.reload();
                  setConflict(false);
                  setProblems([]);
                  setAttempted(false);
                  setNotice({ kind: "info", text: controller.keepsEditsOnReload ? "已载入最新内容，你的修改还在，检查后再点保存。" : "已载入最新内容。" });
                  heading.current?.focus();
                }}
              >
                {controller.keepsEditsOnReload ? "载入最新内容，保留我的修改" : "载入最新内容"}
              </Button>
            </span>
          </Alert>
        )}
        {notice && notice.kind !== "info" && (
          <Alert kind={notice.kind}>
            {notice.title && <strong className="alert__title">{notice.title}</strong>}
            <span>{notice.text}</span>
            {notice.items && notice.items.length > 0 && (
              <span className="error-summary__list">
                {notice.items.map((item, index) =>
                  item.target !== "" ? (
                    <button key={index} type="button" className="link error-summary__item" onClick={() => focusAnchor(item.target)}>
                      {item.text}
                    </button>
                  ) : (
                    <span key={index}>{item.text}</span>
                  ),
                )}
              </span>
            )}
            {notice.action && <span className="alert__actions">{notice.action}</span>}
          </Alert>
        )}
      </div>
      <div role="status" className="step__alerts">
        {notice && notice.kind === "info" && <Alert kind="info">{notice.text}</Alert>}
      </div>
      {intro}
      {children(view)}
      {frame.readOnly ? (
        <div>
          <LinkButton to={frame.listPath} state={frame.listState}>
            回到列表
          </LinkButton>
        </div>
      ) : (
        <div className="form-bar step__bar">
          <span className="form-bar__note step__summary">
            {controller.summary !== undefined ? (
              controller.summary
            ) : controller.missing.count === 0 ? (
              "这一步已完成"
            ) : (
              <button
                type="button"
                className="link error-summary__item step__missing"
                onClick={() => {
                  const target = controller.missing.anchor;
                  if (target !== null && focusAnchor(target)) setHint(target);
                }}
              >
                <Icon name="alert-triangle" />
                {`这一步还差 ${controller.missing.count} 项`}
              </button>
            )}
            {controller.summary === undefined && controller.dirty ? " · 有未保存的修改" : ""}
            {status === "published" ? " · 已上架，保存后约 1 分钟生效" : ""}
            {reason !== null ? ` · ${reason}` : ""}
          </span>
          <Button variant="text" disabled={busy} onClick={cancel}>
            取消
          </Button>
          <Button variant="secondary" disabled={disabled || (busy && saving !== "stay")} loading={saving === "stay"} loadingText="保存中…" onClick={() => void save("stay")}>
            {saveLabel}
          </Button>
          <Button variant="primary" disabled={disabled || (busy && saving !== "next")} loading={saving === "next"} loadingText="保存中…" onClick={() => void save("next")}>
            {next.label}
          </Button>
        </div>
      )}
      <Dialog
        open={leaving !== null}
        title="这一步有未保存的修改"
        busy={saving === "leave"}
        onClose={() => setLeaving(null)}
        footer={
          <>
            <Button variant="text" data-autofocus disabled={busy} onClick={() => setLeaving(null)}>
              继续编辑
            </Button>
            <Button
              variant="secondary"
              className="button--danger-text"
              disabled={busy}
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                if (to !== null) void navigate(to, to === frame.listPath ? { state: frame.listState } : {});
              }}
            >
              不保存
            </Button>
            <Button
              variant="primary"
              loading={saving === "leave"}
              loadingText="保存中…"
              disabled={disabled}
              onClick={() => {
                const to = leaving;
                setLeaving(null);
                if (to !== null) void save(to);
              }}
            >
              保存并继续
            </Button>
          </>
        }
      >
        <p>要先保存吗？</p>
      </Dialog>
    </div>
  );
}
