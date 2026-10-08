/**
 * 区域的停用（要确认）、启用（不用确认）、删除（要确认，删了不能恢复）：列表行和编辑页标题行共用
 * （docs/design/pages/tenant-areas.md 10.3、10.4）。
 */
import { AREA_BIZ_TYPE_NAMES } from "@nozomi/domain";
import { type ReactNode, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type AreaSummary, deleteArea, setAreaStatus } from "../../api/areas.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { useToast } from "../../components/Toast.tsx";
import { NETWORK_FAILURE_TEXT } from "../../lib/failure.ts";
import { displayName, shortName } from "../../lib/master-display.ts";
import { NetworkError } from "../../api/client.ts";

export const AREA_FORBIDDEN_TEXT = "你没有权限修改区域。需要的话，请联系你们的管理员开通。";

interface Pending {
  area: AreaSummary;
  action: "disable" | "delete";
  phase: "confirm" | "working" | "rejected" | "failed";
  text?: string;
}

export interface AreaActions {
  requestDisable(area: AreaSummary): void;
  requestDelete(area: AreaSummary): void;
  enable(area: AreaSummary): Promise<void>;
  enablingId: string | null;
  dialog: ReactNode;
  /** 启用没成功、或要删的区域已经被别人删了时的页面级提示 */
  notice: ReactNode;
}

function failureReason(err: unknown, action: string): string {
  return err instanceof NetworkError ? NETWORK_FAILURE_TEXT : `系统暂时无法${action}，请稍后再试。`;
}

export function useAreaActions(options: { onChanged(area: AreaSummary): void; onDeleted(area: AreaSummary): void }): AreaActions {
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [enablingId, setEnablingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "danger" | "info"; text: string } | null>(null);

  const confirm = async (): Promise<void> => {
    if (!pending) return;
    const { area, action } = pending;
    const name = displayName(area.name).text;
    setPending({ area, action, phase: "working" });
    try {
      if (action === "disable") {
        const result = await setAreaStatus(token, area.id, "disable");
        setPending(null);
        options.onChanged(result);
        toast(`已停用「${shortName(name)}」`);
      } else {
        await deleteArea(token, area.id);
        setPending(null);
        options.onDeleted(area);
        toast(`已删除区域「${shortName(name)}」`);
      }
    } catch (err) {
      if (handleAuthFailure(err)) return;
      const verb = action === "disable" ? "停用" : "删除";
      if (err instanceof ApiError && err.status === 404 && action === "delete") {
        setPending(null);
        options.onDeleted(area);
        setNotice({ kind: "info", text: `「${name}」已经被别人删除了。` });
      } else if (err instanceof ApiError && err.code === "AREA_IN_USE") {
        const count = err.details["published_product_count"];
        const who = typeof count === "number" ? `有 ${count} 个已上架的商品在用这个区域。` : "有已上架的商品在用这个区域。";
        setPending({ area, action, phase: "rejected", text: `${who}请先把这些商品下架，或在商品里去掉这个区域${action === "delete" ? "，再回来删除" : ""}。` });
      } else if (err instanceof ApiError && err.status === 403) {
        setPending({ area, action, phase: "rejected", text: AREA_FORBIDDEN_TEXT });
      } else {
        setPending({ area, action, phase: "failed", text: `${verb}没有成功。${failureReason(err, verb)}` });
      }
    }
  };

  const enable = async (area: AreaSummary): Promise<void> => {
    if (enablingId !== null) return;
    const name = displayName(area.name).text;
    setEnablingId(area.id);
    setNotice(null);
    try {
      const result = await setAreaStatus(token, area.id, "enable");
      options.onChanged(result);
      toast(`已启用「${shortName(name)}」`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "MASTER_DATA_NOT_READY") {
        setNotice({ kind: "danger", text: `「${name}」所属的城市「${displayName(area.city.name).text}」已被平台停用，不能启用。` });
      } else if (err instanceof ApiError && err.status === 403) setNotice({ kind: "danger", text: AREA_FORBIDDEN_TEXT });
      else if (err instanceof ApiError && err.status === 404) setNotice({ kind: "danger", text: `找不到「${name}」，它可能已被删除。` });
      else setNotice({ kind: "danger", text: `启用「${name}」没有成功。${failureReason(err, "启用")}` });
    } finally {
      setEnablingId(null);
    }
  };

  const area = pending?.area ?? null;
  const name = area ? displayName(area.name).text : "";
  const working = pending?.phase === "working";
  const isDelete = pending?.action === "delete";
  const verb = isDelete ? "删除" : "停用";
  const dialog = (
    <Dialog
      open={pending !== null}
      title={`${verb}区域「${name}」？`}
      {...(area && isDelete ? { subtitle: `${displayName(area.city.name).text} · ${AREA_BIZ_TYPE_NAMES[area.biz_type]}` } : {})}
      busy={working}
      onClose={() => setPending(null)}
      footer={
        pending?.phase === "rejected" ? (
          <Button variant="secondary" data-autofocus onClick={() => setPending(null)}>
            知道了
          </Button>
        ) : (
          <>
            <Button variant="secondary" data-autofocus disabled={working} onClick={() => setPending(null)}>
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
      {pending && pending.phase !== "rejected" && area && (
        <p>
          {isDelete
            ? `删除后不能恢复。这个区域的 ${area.operate_polygon_count} 块营运区、${area.forbid_polygon_count} 块禁行区会一起删除。只是暂时不用的话，可以改为停用。`
            : "停用后，建商品时不能再选这个区域，报价时也不再使用它。区域和它的图形都保留，之后可以重新启用。"}
        </p>
      )}
    </Dialog>
  );

  const noticeNode = (
    <div role={notice?.kind === "info" ? "status" : "alert"}>
      {notice && (
        <Alert kind={notice.kind}>
          <span>{notice.text}</span>
          <span className="alert__actions">
            <Button variant="text" size="sm" onClick={() => setNotice(null)}>
              知道了
            </Button>
          </span>
        </Alert>
      )}
    </div>
  );

  return {
    requestDisable: (target) => setPending({ area: target, action: "disable", phase: "confirm" }),
    requestDelete: (target) => setPending({ area: target, action: "delete", phase: "confirm" }),
    enable,
    enablingId,
    dialog,
    notice: noticeNode,
  };
}

/** 「更多」菜单里的三项：停用 / 启用、删除。 */
export function AreaMoreItems({ area, actions }: { area: AreaSummary; actions: AreaActions }) {
  return (
    <>
      {area.status === "active" ? (
        <button type="button" role="menuitem" className="menu-item" onClick={() => actions.requestDisable(area)}>
          <span className="menu-item__text">停用</span>
        </button>
      ) : (
        <button type="button" role="menuitem" className="menu-item" onClick={() => void actions.enable(area)}>
          <span className="menu-item__text">启用</span>
        </button>
      )}
      <button type="button" role="menuitem" className="menu-item menu-item--danger" onClick={() => actions.requestDelete(area)}>
        <span className="menu-item__text">删除</span>
      </button>
    </>
  );
}
