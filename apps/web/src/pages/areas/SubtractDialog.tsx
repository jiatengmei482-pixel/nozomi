/**
 * 「从本区域减去另一个区域」（M9P-13，规格第四节第 3 小节）：选本供应商的另一个区域，先看会切掉多少、换成几块，确认后把结果换到编辑器的图形里。
 * 不直接保存：用户照常点「保存」（保存时照常校验）；不满意可以撤销。算法在 @nozomi/domain 的 `subtractAreaRange`。
 */
import { useMemo, useState } from "react";
import type { AreaMapItem } from "../../api/area-map.ts";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { type EditorShape, type EditorSubtraction, subtractFromEditor } from "../../lib/area-editor.ts";
import { subtractFailureText, subtractPreviewText } from "../../lib/area-layers.ts";
import { areaRing } from "../../lib/area-overview.ts";
import { displayName } from "../../lib/master-display.ts";
import { roleName, roleOf } from "../../lib/area-roles.ts";

export interface SubtractDialogProps {
  open: boolean;
  /** 本供应商别的区域（带图形）；`null` = 还没取到 */
  others: readonly AreaMapItem[] | null;
  loadFailed: boolean;
  shapes: readonly EditorShape[];
  onClose(): void;
  onApply(result: Extract<EditorSubtraction, { ok: true }>, otherName: string): void;
}

export function SubtractDialog({ open, others, loadFailed, shapes, onClose, onApply }: SubtractDialogProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const other = others?.find((item) => item.id === picked) ?? null;
  const result = useMemo(() => (other === null ? null : subtractFromEditor(shapes, other.polygons.map((polygon) => ({ kind: polygon.kind, ring: areaRing(polygon.geometry) })))), [other, shapes]);
  const close = (): void => {
    setPicked(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      size="form"
      title="从本区域减去另一个区域"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={result === null || !result.ok}
            onClick={() => {
              if (result === null || !result.ok || other === null) return;
              onApply(result, displayName(other.name).text);
              setPicked(null);
            }}
          >
            减去
          </Button>
        </>
      }
    >
      <p>选一个和本区域重叠的区域，把重叠的部分从本区域的营运区里切掉（那个区域的禁行区不算它的范围）。本区域的禁行区、没碰到的图形不变。</p>
      <Combobox
        label="要减去的区域"
        options={(others ?? []).map((item) => ({ value: item.id, label: displayName(item.name).text, detail: roleName(roleOf(item)), keywords: Object.values(item.name).join(" ") }))}
        value={picked}
        placeholder="输入区域名称查找"
        emptyText="还没有别的区域"
        loading={others === null && !loadFailed}
        loadFailed={others === null && loadFailed}
        onChange={setPicked}
      />
      <div role="status" data-subtract-preview="">
        {result !== null &&
          (result.ok ? (
            <Alert kind="info">
              <span>{subtractPreviewText(result)}</span>
            </Alert>
          ) : (
            <Alert kind="warning">
              <span>{subtractFailureText(result.reason)}</span>
            </Alert>
          ))}
      </div>
    </Dialog>
  );
}
