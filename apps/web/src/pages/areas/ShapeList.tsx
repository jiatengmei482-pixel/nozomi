/**
 * 图形列表与坐标表（docs/design/02-components.md 第 23 节、tenant-areas.md 第 5、8 节）：
 * 不靠地图也能完成全部操作——逐点输入、加点、删点、改圆心和半径、改名、删除、复制和粘贴坐标。
 */
import { AREA_LIMITS, AREA_POLYGON_KIND_NAMES, type AreaPolygonKind, type AreaShapeWarning, type Position } from "@nozomi/domain";
import { type Dispatch, useEffect, useId, useRef, useState } from "react";
import { Alert } from "../../components/Alert.tsx";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { Dropdown } from "../../components/Dropdown.tsx";
import { FieldErrors } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { TextField } from "../../components/TextField.tsx";
import { useToast } from "../../components/Toast.tsx";
import { useCopyText } from "../../lib/use-copy-text.tsx";
import { type EditorAction, type EditorShape, type EditorState, kmTextToMeters, metersToKmText, shapeName, shapeProblems, shapeRing, shapesToGeoJson, validShapeAt } from "../../lib/area-editor.ts";
import { areaProblemText, shapeProblemText, warningText } from "../../lib/area-messages.ts";
import { formatCoordinate } from "../../lib/master-display.ts";

const NUMBER = /^-?\d+(\.\d+)?$/;
const EMPTY_POINT: Position = [Number.NaN, Number.NaN];
const METERS_PER_DEGREE = 111_320;
const MOVE_LIMIT_M = 100_000;
const MOVE_RANGE_TEXT = `请填 -${MOVE_LIMIT_M} 到 ${MOVE_LIMIT_M} 之间的整数（米）`;

/** 「向北 / 向东多少米」的一格：留空是 0；不是这个范围里的整数返回 null。 */
function readMeters(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return /^-?\d+$/.test(trimmed) && Math.abs(Number(trimmed)) <= MOVE_LIMIT_M ? Number(trimmed) : null;
}

/** 坐标表里的一格：正在输入时显示用户打的字，别处改了（拖点、撤销）就跟着变。 */
function NumberCell({ label, value, invalid, readOnly, onChange, onBegin }: { label: string; value: number; invalid: boolean; readOnly: boolean; onChange(value: number): void; onBegin(): void }) {
  const shown = Number.isFinite(value) ? formatCoordinate(value) : "";
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);
  return (
    <input
      className="input input--mono coords__input"
      type="text"
      inputMode="text"
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid || undefined}
      readOnly={readOnly}
      value={text}
      onFocus={() => {
        editing.current = true;
        // 在这一格里的修改合起来算一步撤销（没改就不算）
        if (!readOnly) onBegin();
      }}
      onChange={(event) => {
        setText(event.target.value);
        const trimmed = event.target.value.trim();
        onChange(NUMBER.test(trimmed) ? Number(trimmed) : Number.NaN);
      }}
      onBlur={() => {
        editing.current = false;
        setText(Number.isFinite(value) ? formatCoordinate(value) : text.trim());
      }}
    />
  );
}

function summary(shape: EditorShape): string {
  return shape.circle ? `圆 · 半径 ${metersToKmText(shape.circle.radiusM)} 公里` : `多边形 · ${shape.ring.length} 个点`;
}

export interface ShapeListProps {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  readOnly: boolean;
  busy: boolean;
  /** 提交过一次以后才把「至少要有一块营运区」这类整体的问题显示出来 */
  attempted: boolean;
  cityName: string;
  warnings: ReadonlyMap<string, AreaShapeWarning[]>;
  /** 后端保存时按图形报回来的问题（按图形的 key） */
  serverProblems: Readonly<Record<string, string[]>>;
  /** 整个区域层面的问题（没有营运区、超过上限） */
  areaProblems: readonly { reason: string }[];
  onPaste(kind: AreaPolygonKind, replaceKey?: string): void;
}

export function ShapeList({ state, dispatch, readOnly, busy, attempted, cityName, warnings, serverProblems, areaProblems, onPaste }: ShapeListProps) {
  const toast = useToast();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<{ key: string; text: string } | null>(null);
  const baseId = useId();
  const [moving, setMoving] = useState<{ key: string; name: string; north: string; east: string } | null>(null);
  const moveBy = moving ? { north: readMeters(moving.north), east: readMeters(moving.east) } : null;
  const applyMove = (): void => {
    const shape = moving ? state.shapes.find((entry) => entry.key === moving.key) : undefined;
    if (!moving || !shape || !moveBy || moveBy.north === null || moveBy.east === null) return;
    // 一米在南北方向上是固定的度数；东西方向随纬度变，按这块图形所在的纬度换算
    const ring = shapeRing(shape);
    const latitude = shape.circle ? shape.circle.lat : ring.reduce((sum, point) => sum + point[1], 0) / Math.max(1, ring.length);
    const dLat = moveBy.north / METERS_PER_DEGREE;
    const dLng = moveBy.east / (METERS_PER_DEGREE * Math.max(0.01, Math.cos((latitude * Math.PI) / 180)));
    dispatch({ type: "translate", key: shape.key, dLat, dLng });
    setMoving(null);
  };
  const begin = (): void => dispatch({ type: "beginGesture" });
  const full = state.shapes.length >= AREA_LIMITS.maxPolygons;

  // 选中哪一块（在地图上点、刚加进来），哪一块的坐标表就展开
  useEffect(() => {
    if (state.selected !== null) setExpanded((current) => (current.has(state.selected as string) ? current : new Set([...current, state.selected as string])));
  }, [state.selected]);

  const copier = useCopyText();
  const copy = (shape: EditorShape): void => copier.copy(shapesToGeoJson([shape]));

  const group = (kind: AreaPolygonKind) => {
    const shapes = state.shapes.filter((shape) => shape.kind === kind);
    const kindName = `${AREA_POLYGON_KIND_NAMES[kind]}区`;
    const missing = kind === "operate" && attempted ? areaProblems.filter((problem) => problem.reason === "NO_OPERATE_POLYGON") : [];
    return (
      <section className="shape-group" key={kind} data-field={kind === "operate" ? "polygons" : undefined}>
        <div className="shape-group__header">
          <h3 className="shape-group__title">{`${kindName}（${shapes.length}）`}</h3>
          {!readOnly && (
            <Dropdown buttonClassName="button button--secondary button--sm" buttonContent={`添加${kindName}`} align="end">
              <button type="button" role="menuitem" className="menu-item" disabled={full || busy} onClick={() => dispatch({ type: "addPolygon", kind, ring: [EMPTY_POINT, EMPTY_POINT, EMPTY_POINT] })}>
                <span className="menu-item__text">逐点输入坐标</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={full || busy} onClick={() => dispatch({ type: "addCircle", kind, circle: { lat: Number.NaN, lng: Number.NaN, radiusM: 0 } })}>
                <span className="menu-item__text">输入圆心和半径</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={full || busy} onClick={() => onPaste(kind)}>
                <span className="menu-item__text">粘贴坐标（WKT / GeoJSON）</span>
              </button>
            </Dropdown>
          )}
        </div>
        <FieldErrors id={`${baseId}-${kind}-missing`} errors={missing.map((problem) => areaProblemText(problem.reason) ?? "")} />
        {shapes.length === 0 && missing.length === 0 && <p className="field__hint">{kind === "operate" ? "还没有营运区。在地图上画一块，或点「添加营运区」。" : "没有禁行区。需要排除某块地方时再加。"}</p>}
        <ul className="shape-list">
          {shapes.map((shape) => {
            const name = shapeName(shape);
            const open = expanded.has(shape.key);
            const problems = [...shapeProblems(shape).map(shapeProblemText), ...(serverProblems[shape.key] ?? [])];
            const notes = (warnings.get(shape.key) ?? []).map((warning) => warningText(warning, cityName, "forbid" in warning ? shapeName(validShapeAt(state.shapes, warning.forbid) ?? shape) : ""));
            const invalidPoint = shapeProblems(shape).find((problem) => problem.reason === "INVALID_COORDINATE");
            const panelId = `${baseId}-${shape.key}`;
            return (
              <li key={shape.key} className={state.selected === shape.key ? "shape shape--selected" : "shape"} data-shape={shape.key}>
                <div className="shape__header">
                  <button
                    type="button"
                    className="shape__toggle"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => {
                      setExpanded(open ? new Set([...expanded].filter((key) => key !== shape.key)) : new Set([...expanded, shape.key]));
                      dispatch({ type: "select", key: shape.key });
                    }}
                  >
                    <Icon name={open ? "chevron-down" : "chevron-right"} />
                    <span className="shape__name">{name}</span>
                    <span className="shape__summary">{summary(shape)}</span>
                  </button>
                  {problems.length > 0 && <span className="shape__flag shape__flag--danger">{`有 ${problems.length} 处需要修改`}</span>}
                  {problems.length === 0 && notes.length > 0 && <span className="shape__flag shape__flag--warning">有提醒</span>}
                  <Dropdown buttonClassName="icon-button" buttonContent={<Icon name="more" />} label={`${name} 的更多操作`} align="end">
                    {!readOnly && (
                      <button type="button" role="menuitem" className="menu-item" onClick={() => setRenaming({ key: shape.key, text: shape.label })}>
                        <span className="menu-item__text">改备注名</span>
                      </button>
                    )}
                    <button type="button" role="menuitem" className="menu-item" onClick={() => copy(shape)}>
                      <span className="menu-item__text">复制坐标（GeoJSON）</span>
                    </button>
                    {!readOnly && (
                      <>
                        <button type="button" role="menuitem" className="menu-item" onClick={() => onPaste(shape.kind, shape.key)}>
                          <span className="menu-item__text">粘贴坐标替换</span>
                        </button>
                        {shape.circle && (
                          <button type="button" role="menuitem" className="menu-item" onClick={() => dispatch({ type: "convertCircle", key: shape.key })}>
                            <span className="menu-item__text">转成多边形</span>
                          </button>
                        )}
                        <button type="button" role="menuitem" className="menu-item" onClick={() => dispatch({ type: "setKind", key: shape.key, kind: shape.kind === "operate" ? "forbid" : "operate" })}>
                          <span className="menu-item__text">{shape.kind === "operate" ? "改成禁行区" : "改成营运区"}</span>
                        </button>
                        <button type="button" role="menuitem" className="menu-item" onClick={() => setMoving({ key: shape.key, name, north: "", east: "" })}>
                          <span className="menu-item__text">整体移动…</span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item menu-item--danger"
                          onClick={() => {
                            dispatch({ type: "remove", key: shape.key });
                            toast(`已删除${name}`, { label: "恢复", onAction: () => dispatch({ type: "undo" }) });
                          }}
                        >
                          <span className="menu-item__text">删除这一块</span>
                        </button>
                      </>
                    )}
                  </Dropdown>
                </div>
                {open && (
                  <div className="shape__body" id={panelId}>
                    {shape.circle ? (
                      <div className="coords coords--circle">
                        <label className="coords__label">
                          圆心纬度
                          <NumberCell onBegin={begin} label={`${name} 圆心纬度`} value={shape.circle.lat} invalid={invalidPoint !== undefined} readOnly={readOnly || busy} onChange={(lat) => dispatch({ type: "setCircle", key: shape.key, circle: { ...(shape.circle as NonNullable<EditorShape["circle"]>), lat }, live: true })} />
                        </label>
                        <label className="coords__label">
                          圆心经度
                          <NumberCell onBegin={begin} label={`${name} 圆心经度`} value={shape.circle.lng} invalid={invalidPoint !== undefined} readOnly={readOnly || busy} onChange={(lng) => dispatch({ type: "setCircle", key: shape.key, circle: { ...(shape.circle as NonNullable<EditorShape["circle"]>), lng }, live: true })} />
                        </label>
                        <RadiusCell onBegin={begin} name={name} radiusM={shape.circle.radiusM} readOnly={readOnly || busy} onChange={(radiusM) => dispatch({ type: "setCircle", key: shape.key, circle: { ...(shape.circle as NonNullable<EditorShape["circle"]>), radiusM }, live: true })} />
                        {!readOnly && <p className="field__hint">在「更多」里可以转成多边形：转了以后可以逐点修改，但不能再按圆心和半径来改。</p>}
                      </div>
                    ) : (
                      <table className="coords">
                        <thead>
                          <tr>
                            <th scope="col">#</th>
                            <th scope="col">纬度</th>
                            <th scope="col">经度</th>
                            {!readOnly && <th scope="col"><span className="visually-hidden">操作</span></th>}
                          </tr>
                        </thead>
                        <tbody>
                          {shape.ring.map((point, index) => {
                            const bad = invalidPoint !== undefined && "point" in invalidPoint && invalidPoint.point === index + 1;
                            return (
                              <tr key={index}>
                                <th scope="row">{index + 1}</th>
                                <td>
                                  <NumberCell onBegin={begin} label={`${name} 第 ${index + 1} 个点的纬度`} value={point[1]} invalid={bad} readOnly={readOnly || busy} onChange={(lat) => dispatch({ type: "movePoint", key: shape.key, index, position: [point[0], lat], live: true })} />
                                </td>
                                <td>
                                  <NumberCell onBegin={begin} label={`${name} 第 ${index + 1} 个点的经度`} value={point[0]} invalid={bad} readOnly={readOnly || busy} onChange={(lng) => dispatch({ type: "movePoint", key: shape.key, index, position: [lng, point[1]], live: true })} />
                                </td>
                                {!readOnly && (
                                  <td className="coords__actions">
                                    <button type="button" className="icon-button" aria-label={`在 ${name} 第 ${index + 1} 个点后面加一个点`} disabled={busy || shape.ring.length >= AREA_LIMITS.maxRingVertices} onClick={() => dispatch({ type: "insertPoint", key: shape.key, after: index, position: EMPTY_POINT })}>
                                      <Icon name="plus" />
                                    </button>
                                    <button type="button" className="icon-button" aria-label={`删除 ${name} 第 ${index + 1} 个点`} title={shape.ring.length <= AREA_LIMITS.minRingVertices ? `至少保留 ${AREA_LIMITS.minRingVertices} 个点` : undefined} disabled={busy || shape.ring.length <= AREA_LIMITS.minRingVertices} onClick={() => dispatch({ type: "removePoint", key: shape.key, index })}>
                                      <Icon name="x" />
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <FieldErrors id={`${panelId}-problems`} errors={problems} />
                    {notes.map((note) => (
                      <p key={note} className="field__hint field__hint--warning">
                        <Icon name="alert-triangle" />
                        <span>{note}</span>
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  const overLimit = areaProblems.filter((problem) => problem.reason !== "NO_OPERATE_POLYGON");
  return (
    <>
      {overLimit.length > 0 && <Alert kind="danger">{overLimit.map((problem) => areaProblemText(problem.reason, problem as Record<string, unknown>)).join(" ")}</Alert>}
      {full && !readOnly && <p className="field__hint">{`一个区域最多 ${AREA_LIMITS.maxPolygons} 块图形`}</p>}
      {group("operate")}
      {group("forbid")}
      {copier.dialog}
      <Dialog
        open={moving !== null}
        title={moving ? `整体移动「${moving.name}」` : ""}
        onClose={() => setMoving(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoving(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={moveBy === null || moveBy.north === null || moveBy.east === null || (moveBy.north === 0 && moveBy.east === 0)} onClick={applyMove}>
              移动
            </Button>
          </>
        }
      >
        <div className="form">
          <TextField label="向北移动（米）" inputMode="numeric" autoComplete="off" data-autofocus value={moving?.north ?? ""} hint="往南移填负数，例如 -200。不动就留空。" errors={moving && readMeters(moving.north) === null ? [MOVE_RANGE_TEXT] : []} onChange={(event) => setMoving(moving ? { ...moving, north: event.target.value } : null)} />
          <TextField label="向东移动（米）" inputMode="numeric" autoComplete="off" value={moving?.east ?? ""} hint="往西移填负数。" errors={moving && readMeters(moving.east) === null ? [MOVE_RANGE_TEXT] : []} onChange={(event) => setMoving(moving ? { ...moving, east: event.target.value } : null)} />
        </div>
      </Dialog>
      <Dialog
        open={renaming !== null}
        title="改备注名"
        onClose={() => setRenaming(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={(renaming?.text.trim().length ?? 0) > AREA_LIMITS.maxLabelLength}
              onClick={() => {
                if (renaming) dispatch({ type: "setLabel", key: renaming.key, label: renaming.text.trim() });
                setRenaming(null);
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <TextField
          label="备注名（选填）"
          autoComplete="off"
          data-autofocus
          value={renaming?.text ?? ""}
          hint="例如「皇居周边」。会接在自动编号后面显示。"
          errors={(renaming?.text.trim().length ?? 0) > AREA_LIMITS.maxLabelLength ? [`备注名最多 ${AREA_LIMITS.maxLabelLength} 个字`] : []}
          onChange={(event) => setRenaming(renaming ? { ...renaming, text: event.target.value } : null)}
        />
      </Dialog>
    </>
  );
}

function RadiusCell({ name, radiusM, readOnly, onChange, onBegin }: { name: string; radiusM: number; readOnly: boolean; onChange(radiusM: number): void; onBegin(): void }) {
  const shown = radiusM > 0 ? metersToKmText(radiusM) : "";
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);
  return (
    <label className="coords__label">
      半径（公里）
      <input
        className="input coords__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${name} 半径（公里）`}
        readOnly={readOnly}
        value={text}
        onFocus={() => {
          editing.current = true;
          // 在这一格里的修改合起来算一步撤销（没改就不算）
          if (!readOnly) onBegin();
        }}
        onChange={(event) => {
          setText(event.target.value);
          onChange(kmTextToMeters(event.target.value) ?? 0);
        }}
        onBlur={() => {
          editing.current = false;
        }}
      />
    </label>
  );
}
