/**
 * 粘贴坐标（docs/design/pages/tenant-areas.md 7.4）：GeoJSON、WKT，或每行一对「纬度, 经度」。
 * 解析用 @nozomi/domain 的 parseShapeText（和后端同一份）；文件只在浏览器里读，不上传。
 */
import { AREA_LIMITS, type AreaPolygonKind, type ParsedShapes, ShapeParseError } from "@nozomi/domain";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { FieldErrors, RadioGroup } from "../../components/FormFields.tsx";
import { type PastedPolygon, parsePastedShapes } from "../../lib/area-editor.ts";
import { SHAPE_FORMAT_NAMES, parseFailureText } from "../../lib/area-messages.ts";
import { formatCount } from "../../lib/master-display.ts";

const PARSE_DELAY_MS = 300;
const KIND_OPTIONS: readonly { value: AreaPolygonKind; label: string }[] = [
  { value: "operate", label: "营运区" },
  { value: "forbid", label: "禁行区" },
];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface PasteRequest {
  kind: AreaPolygonKind;
  /** 替换哪一块（从坐标表的「粘贴坐标替换」进来）；不给就是添加 */
  replace?: { key: string; name: string };
}

type Outcome = { ok: true; parsed: ParsedShapes } | { ok: false; message: string };

function read(text: string, kind: AreaPolygonKind, replacing: boolean, existing: number): Outcome {
  let parsed: ParsedShapes;
  try {
    parsed = parsePastedShapes(text);
  } catch (err) {
    return { ok: false, message: err instanceof ShapeParseError ? parseFailureText(err.failure) : parseFailureText({ reason: "UNRECOGNIZED" }) };
  }
  const tooMany = parsed.polygons.findIndex((polygon) => polygon.outer.length > AREA_LIMITS.maxRingVertices);
  if (tooMany >= 0) return { ok: false, message: `第 ${tooMany + 1} 个多边形有 ${formatCount(parsed.polygons[tooMany]?.outer.length ?? 0)} 个点，一个多边形最多 ${formatCount(AREA_LIMITS.maxRingVertices)} 个点。请先把它简化，再粘贴。` };
  const holes = parsed.polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0);
  if (replacing) {
    if (parsed.polygons.length !== 1 || holes > 0) return { ok: false, message: `这里要的是一个多边形，这段内容里有 ${parsed.polygons.length + holes} 个。要一次加多块，请用工具条上的「粘贴坐标」。` };
    return { ok: true, parsed };
  }
  const polygons = parsed.polygons as readonly PastedPolygon[];
  if (polygons.some((polygon) => (polygon.kind ?? kind) === "forbid" && polygon.holes.length > 0)) return { ok: false, message: "禁行区不能带洞。请把它拆成几块不带洞的多边形，或改为「加为营运区」（洞会变成禁行区）。" };
  const adding = polygons.reduce((sum, polygon) => sum + 1 + ((polygon.kind ?? kind) === "operate" ? polygon.holes.length : 0), 0);
  if (existing + adding > AREA_LIMITS.maxPolygons) return { ok: false, message: `这段内容里有 ${adding} 个多边形，加上已有的 ${existing} 块会超过上限（最多 ${AREA_LIMITS.maxPolygons} 块）。` };
  return { ok: true, parsed };
}

function describe(parsed: ParsedShapes, kind: AreaPolygonKind, replacing: boolean): string {
  const points = parsed.polygons.reduce((sum, polygon) => sum + polygon.outer.length + polygon.holes.reduce((inner, hole) => inner + hole.length, 0), 0);
  const holes = parsed.polygons.reduce((sum, polygon) => sum + polygon.holes.length, 0);
  const copied = (parsed.polygons as readonly PastedPolygon[]).filter((polygon) => polygon.kind !== undefined);
  const forbidden = copied.filter((polygon) => polygon.kind === "forbid").length;
  return [
    `识别为 ${SHAPE_FORMAT_NAMES[parsed.format]}：${parsed.polygons.length} 个多边形，共 ${formatCount(points)} 个点。`,
    copied.length > 0 && !replacing ? `这是从这里复制出去的图形：${copied.length - forbidden} 块营运区、${forbidden} 块禁行区，类型和备注名会原样带回，不看上面选的「加为」。` : "",
    holes > 0 && kind === "operate" && !replacing ? `其中 ${holes} 个洞会加为禁行区。` : "",
    parsed.ignored > 0 ? `另有 ${parsed.ignored} 个不是多边形的要素，已忽略。` : "",
  ].join("");
}

export function PasteDialog({ request, existingCount, onClose, onSubmit }: { request: PasteRequest; existingCount: number; onClose(): void; onSubmit(kind: AreaPolygonKind, parsed: ParsedShapes, replaceKey?: string): void }) {
  const id = useId();
  const [kind, setKind] = useState<AreaPolygonKind>(request.kind);
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const replacing = request.replace !== undefined;

  // 停止输入 300ms 后解析
  useEffect(() => {
    if (text.trim() === "") {
      setOutcome(null);
      return;
    }
    const timer = setTimeout(() => setOutcome(read(text, kind, replacing, existingCount)), PARSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, kind, replacing, existingCount]);

  const submit = (): void => {
    setAttempted(true);
    const result = text.trim() === "" ? ({ ok: false, message: parseFailureText({ reason: "EMPTY" }) } as const) : read(text, kind, replacing, existingCount);
    setOutcome(result);
    if (!result.ok) {
      area.current?.focus();
      return;
    }
    onSubmit(kind, result.parsed, request.replace?.key);
  };

  const errors = [...(outcome && !outcome.ok && (attempted || text.trim() !== "") ? [outcome.message] : []), ...(fileError !== null ? [fileError] : [])];
  return (
    <Dialog
      open
      size="form"
      title={request.replace ? `粘贴坐标替换「${request.replace.name}」` : "粘贴坐标"}
      dismissOnBackdrop={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit}>
            {replacing ? "替换" : "添加到地图"}
          </Button>
        </>
      }
    >
      {!replacing && (
        <RadioGroup<AreaPolygonKind>
          legend="加为"
          name="paste-kind"
          options={KIND_OPTIONS}
          value={kind}
          onChange={setKind}
        />
      )}
      <div className="field">
        <label className="field__label" htmlFor={id}>
          内容
          <span className="field__required" aria-hidden="true">
            {" "}
            *
          </span>
        </label>
        <textarea
          ref={area}
          id={id}
          className="input textarea paste__text"
          rows={8}
          spellCheck={false}
          data-autofocus
          aria-invalid={errors.length > 0 || undefined}
          aria-describedby={`${id}-help ${id}-result`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFileError(null);
          }}
        />
        <div>
          <Button size="sm" onClick={() => file.current?.click()}>
            从文件读取…
          </Button>
          <input
            ref={file}
            className="visually-hidden"
            type="file"
            tabIndex={-1}
            aria-label="选择坐标文件"
            accept=".geojson,.json,.wkt,.txt"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (!chosen) return;
              if (chosen.size > MAX_FILE_BYTES) return setFileError("文件超过 2 MB，读不了。");
              void chosen.text().then(
                (content) => {
                  setFileError(null);
                  setText(content);
                },
                () => setFileError("这个文件读不出文字内容。"),
              );
            }}
          />
        </div>
        <FieldErrors id={`${id}-error`} errors={errors} />
        <p className="field__hint" id={`${id}-help`}>
          支持三种写法：GeoJSON（Polygon、MultiPolygon、Feature、FeatureCollection）；WKT（POLYGON、MULTIPOLYGON）；或每行一对「纬度, 经度」。GeoJSON 和 WKT 按它们的标准是经度在前，照原样粘贴就行。
        </p>
        <p className="field__hint field__hint--info" id={`${id}-result`} role="status">
          {outcome?.ok ? describe(outcome.parsed, kind, replacing) : ""}
        </p>
      </div>
    </Dialog>
  );
}
