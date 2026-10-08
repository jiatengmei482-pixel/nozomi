/**
 * 自测（docs/design/pages/tenant-areas.md 第 9 节）：一个位置在营运区、禁行区，还是都不在。
 * 图形没有未保存的修改时问接口；有修改（或还没保存过）时用 @nozomi/domain 的同一个函数按画面上的图形算。
 */
import type { PointLocation } from "@nozomi/domain";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ApiError, NetworkError } from "../../api/client.ts";
import { checkAreaPoint } from "../../api/areas.ts";
import { usePortalSession } from "../../auth/PortalSession.tsx";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { CoordinateInput, type CoordinateValue, coordinateIssue } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { StatusBadge } from "../../components/StatusBadge.tsx";
import { type EditorShape, hasBlockingProblems, locateInEditor, shapeName } from "../../lib/area-editor.ts";

export interface ProbeResult {
  point: { lat: number; lng: number };
  location: PointLocation;
  /** 按画面上还没保存的图形判断的 */
  local: boolean;
}

export interface SelfTestProps {
  shapes: readonly EditorShape[];
  /** 已保存的区域的编号；新增页是 null */
  areaId: string | null;
  /** 图形和已保存的不一样（或还没保存过）：按画面上的图形判断 */
  shapesDirty: boolean;
  disabledArea: boolean;
  /** 地图可用时才有「在地图上点」 */
  mapAvailable: boolean;
  picking: boolean;
  onTogglePick(): void;
  /** 从地图上点来的位置：填进输入框并立即检查 */
  picked: { lat: number; lng: number; at: number } | null;
  result: ProbeResult | null;
  onResult(result: ProbeResult | null): void;
  onSelectShape(key: string): void;
}

const FIXED_NOTE = "这里只判断这个区域的范围。实际能不能报价，还要看商品、价格规则和服务时间。";

export function SelfTest({ shapes, areaId, shapesDirty, disabledArea, mapAvailable, picking, onTogglePick, picked, result, onResult, onSelectShape }: SelfTestProps) {
  const { token, handleAuthFailure } = usePortalSession();
  const [value, setValue] = useState<CoordinateValue>({ lat: "", lng: "" });
  const [attempted, setAttempted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [blocked, setBlocked] = useState(false);

  // 图形改过以后，已有的结果作废（不自动重查，免得拖点时闪个不停）
  const fingerprint = JSON.stringify(shapes.map((shape) => [shape.kind, shape.ring, shape.circle]));
  useEffect(() => {
    if (result !== null) {
      onResult(null);
      setStale(true);
    }
    setBlocked(false);
    // 只在图形变化时作废
    // （result 变化不触发）
  }, [fingerprint]);

  const check = async (point: { lat: number; lng: number }): Promise<void> => {
    setFailure(null);
    setStale(false);
    if (hasBlockingProblems(shapes)) {
      setBlocked(true);
      onResult(null);
      return;
    }
    setBlocked(false);
    if (areaId === null || shapesDirty) {
      onResult({ point, location: locateInEditor(shapes, point), local: true });
      return;
    }
    setChecking(true);
    try {
      const answer = await checkAreaPoint(token, areaId, point);
      const keyOf = (id: string): string => shapes.find((shape) => shape.id === id)?.key ?? id;
      onResult({ point, local: false, location: { result: answer.result, operatePolygonIds: answer.operate_polygon_ids.map(keyOf), forbidPolygonIds: answer.forbid_polygon_ids.map(keyOf) } });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      onResult(null);
      if (err instanceof ApiError && err.status === 404) setFailure("找不到这个区域，它可能已被删除。");
      else setFailure(err instanceof NetworkError ? "没有检查成功。请检查网络后重试。" : "没有检查成功。请稍后再试。");
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (picked === null) return;
    setValue({ lat: picked.lat.toFixed(6), lng: picked.lng.toFixed(6) });
    void check({ lat: picked.lat, lng: picked.lng });
  }, [picked?.at]);

  const latError = attempted ? coordinateIssue("lat", value.lat) : null;
  const lngError = attempted ? coordinateIssue("lng", value.lng) : null;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setAttempted(true);
    if (coordinateIssue("lat", value.lat) !== null || coordinateIssue("lng", value.lng) !== null) return;
    void check({ lat: Number(value.lat), lng: Number(value.lng) });
  };

  const names = (keys: readonly string[]): ReactNode => {
    const found = keys.map((key) => shapes.find((shape) => shape.key === key)).filter((shape): shape is EditorShape => shape !== undefined);
    return (
      <>
        {found.slice(0, 3).map((shape, index) => (
          <span key={shape.key}>
            {index > 0 ? "、" : ""}「
            <button type="button" className="link probe__shape" onClick={() => onSelectShape(shape.key)}>
              {shapeName(shape)}
            </button>
            」
          </span>
        ))}
        {found.length > 3 ? `等 ${found.length} 块` : ""}
      </>
    );
  };

  const location = result?.location ?? null;
  return (
    <form className="form" noValidate onSubmit={submit}>
      <p className="field__hint">输入一个坐标，或在地图上点一个位置，看它会不会被报价。</p>
      <CoordinateInput legend="自测的位置" value={value} errors={{ lat: latError, lng: lngError }} onChange={setValue} />
      <div className="form__actions">
        <Button type="submit" loading={checking} loadingText="检查中…">
          检查
        </Button>
        {mapAvailable && (
          <Button aria-pressed={picking} onClick={onTogglePick}>
            在地图上点
          </Button>
        )}
      </div>
      <div role="alert">{failure !== null && <Alert kind="danger">{failure}</Alert>}</div>
      <div className="probe" role="status">
        {blocked && (
          <p className="field__hint field__hint--warning">
            <Icon name="alert-triangle" />
            <span>有图形还需要修改（边交叉了等），修好以后再自测。</span>
          </p>
        )}
        {stale && !blocked && location === null && <p className="field__hint">图形改过了，请重新检查。</p>}
        {location !== null && (
          <>
            <StatusBadge {...(location.result === "operate" ? { tone: "success", label: "在营运区内" } : location.result === "forbid" ? { tone: "danger", label: "在禁行区内" } : { tone: "neutral", label: "不在营运区内" })} />
            {result?.local && <p className="field__hint">按画面上还没保存的图形判断。</p>}
            <p className="probe__sentence">
              {location.result === "operate" && <>这个位置可以报价。它在{names(location.operatePolygonIds)}里。</>}
              {location.result === "forbid" && (
                <>
                  这个位置不报价。它在{names(location.forbidPolygonIds)}里。
                  {location.operatePolygonIds.length > 0 && <>它同时也在{names(location.operatePolygonIds)}里，但禁行区优先。</>}
                </>
              )}
              {location.result === "outside" && "这个位置不报价。它不在任何一块营运区里。"}
            </p>
            <p className="field__hint">{`${disabledArea ? "这个区域已停用，启用后才会用于报价。" : ""}${FIXED_NOTE}`}</p>
          </>
        )}
      </div>
    </form>
  );
}
