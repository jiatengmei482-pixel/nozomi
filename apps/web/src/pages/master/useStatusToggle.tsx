/**
 * 停用（要确认）和启用（不用确认）：列表行、编辑页标题行、编辑页里的下级小表格共用
 * （docs/design/pages/master-data.md 2.5、2.6）。
 */
import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type MasterKind, type MasterKinds, disableMaster, enableMaster } from "../../api/master.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { useToast } from "../../components/Toast.tsx";
import { displayName, shortName } from "../../lib/master-display.ts";
import { FORBIDDEN_TEXT, failureReason, isForbidden } from "./shared.tsx";

type RecordOf<K extends MasterKind> = MasterKinds[K]["record"];

export interface ToggleNotice {
  text: string;
  link?: { label: string; to: string };
}

export interface StatusToggleOptions<K extends MasterKind> {
  kind: K;
  /** 「停用{对象}「…」？」里的对象名 */
  objectName(row: RecordOf<K>): string;
  /** 「供应商的选项里不再出现{这个城市}」 */
  objectPhrase(row: RecordOf<K>): string;
  onChanged(row: RecordOf<K>): void;
  inUse?(row: RecordOf<K>, activeCount: number): ToggleNotice;
  notReady?(row: RecordOf<K>, reason: string): ToggleNotice | null;
}

interface DisableState<T> {
  row: T;
  phase: "confirm" | "working" | "rejected" | "failed" | "forbidden";
  notice?: ToggleNotice;
  failure?: string;
}

export interface StatusToggle<K extends MasterKind> {
  requestDisable(row: RecordOf<K>): void;
  enable(row: RecordOf<K>): Promise<void>;
  /** 正在启用的那一条的编号 */
  enablingId: string | null;
  /** 停用确认对话框：放在页面里任意位置 */
  dialog: ReactNode;
  /** 启用没成功时的提示条（最近一次操作的）：放在表格或表单上方 */
  notice: ReactNode;
}

export function useStatusToggle<K extends MasterKind>(options: StatusToggleOptions<K>): StatusToggle<K> {
  const { kind } = options;
  const { token, handleAuthFailure } = usePortalSession();
  const toast = useToast();
  const [disabling, setDisabling] = useState<DisableState<RecordOf<K>> | null>(null);
  const [enablingId, setEnablingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToggleNotice | null>(null);

  const confirmDisable = async (): Promise<void> => {
    if (!disabling) return;
    const { row } = disabling;
    setDisabling({ row, phase: "working" });
    try {
      const result = await disableMaster(kind, token, row.id);
      setDisabling(null);
      options.onChanged(result);
      toast(`已停用「${shortName(displayName(row.name).text)}」`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "MASTER_DATA_IN_USE") {
        const count = Number(err.details["active_count"] ?? 0);
        setDisabling({ row, phase: "rejected", notice: options.inUse?.(row, count) ?? { text: `还有 ${count} 个启用中的下级在用它，请先停用它们。` } });
      } else if (isForbidden(err)) {
        setDisabling({ row, phase: "forbidden" });
      } else {
        setDisabling({ row, phase: "failed", failure: failureReason(err, "停用") });
      }
    }
  };

  const enable = async (row: RecordOf<K>): Promise<void> => {
    if (enablingId !== null) return;
    setEnablingId(row.id);
    setNotice(null);
    try {
      const result = await enableMaster(kind, token, row.id);
      options.onChanged(result);
      toast(`已启用「${shortName(displayName(row.name).text)}」`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      if (err instanceof ApiError && err.code === "MASTER_DATA_NOT_READY") {
        setNotice(options.notReady?.(row, String(err.details["reason"] ?? "")) ?? { text: `「${row.code} ${displayName(row.name).text}」现在还不能启用。` });
      } else if (isForbidden(err)) {
        setNotice({ text: FORBIDDEN_TEXT });
      } else {
        setNotice({ text: `启用「${displayName(row.name).text}」没有成功。${failureReason(err, "启用")}` });
      }
    } finally {
      setEnablingId(null);
    }
  };

  const working = disabling?.phase === "working";
  const closed = disabling?.phase === "rejected" || disabling?.phase === "forbidden";
  const dialog = (
    <Dialog
      open={disabling !== null}
      title={disabling ? `停用${options.objectName(disabling.row)}「${displayName(disabling.row.name).text}」？` : ""}
      {...(disabling ? { subtitle: disabling.row.code } : {})}
      busy={working}
      onClose={() => setDisabling(null)}
      footer={
        closed ? (
          <Button variant="secondary" data-autofocus onClick={() => setDisabling(null)}>
            知道了
          </Button>
        ) : (
          <>
            <Button variant="secondary" data-autofocus disabled={working} onClick={() => setDisabling(null)}>
              取消
            </Button>
            <Button variant="danger" loading={working} loadingText="停用中…" onClick={() => void confirmDisable()}>
              停用
            </Button>
          </>
        )
      }
    >
      <div role="alert">
        {disabling?.phase === "rejected" && disabling.notice && (
          <Alert kind="danger">
            <strong className="alert__title">现在不能停用。</strong>
            <span>{disabling.notice.text}</span>
            {disabling.notice.link && (
              <span className="alert__actions">
                <Link className="link" to={disabling.notice.link.to}>
                  {disabling.notice.link.label}
                </Link>
              </span>
            )}
          </Alert>
        )}
        {disabling?.phase === "failed" && <Alert kind="danger">{`停用没有成功。${disabling.failure ?? ""}`}</Alert>}
        {disabling?.phase === "forbidden" && <Alert kind="danger">{FORBIDDEN_TEXT}</Alert>}
      </div>
      {disabling && disabling.phase !== "rejected" && <p>{`停用后，供应商的选项里不再出现${options.objectPhrase(disabling.row)}；已经引用它的内容仍然查得到。之后可以重新启用。`}</p>}
    </Dialog>
  );

  const noticeNode = (
    <div role="alert">
      {notice && (
        <Alert kind="danger">
          <span>{notice.text}</span>
          <span className="alert__actions">
            {notice.link && (
              <Link className="link" to={notice.link.to}>
                {notice.link.label}
              </Link>
            )}
            <Button variant="text" size="sm" onClick={() => setNotice(null)}>
              知道了
            </Button>
          </span>
        </Alert>
      )}
    </div>
  );

  return { requestDisable: (row) => setDisabling({ row, phase: "confirm" }), enable, enablingId, dialog, notice: noticeNode };
}
