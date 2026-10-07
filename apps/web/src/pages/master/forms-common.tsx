/** 四个表单共用的校验和小部件。 */
import { type LocalizedText, hasVisibleText } from "@nozomi/domain";
import type { ReactNode } from "react";
import type { Point } from "../../api/master.ts";
import { Button } from "../../components/Button.tsx";
import { type CoordinateValue, FieldErrors as FieldErrorList, coordinateIssue } from "../../components/FormFields.tsx";
import { Icon } from "../../components/Icon.tsx";
import { INPUT_LANGUAGES, formatCoordinate } from "../../lib/master-display.ts";
import type { FieldErrors } from "./MasterForm.tsx";

export const NAME_MAX_LENGTH = 200;

/** 多语言字段：至少一种（`required` 时），每种不超过上限。 */
export function localizedErrors(field: string, label: string, value: LocalizedText, maxLength: number, required: boolean): FieldErrors {
  const errors: FieldErrors = {};
  if (required && !INPUT_LANGUAGES.some(({ key }) => hasVisibleText(value[key] ?? ""))) errors[field] = ["至少填一种语言"];
  for (const { key, label: language } of INPUT_LANGUAGES) {
    if ([...(value[key] ?? "").trim()].length > maxLength) errors[`${field}.${key}`] = [`${language}${label}最多 ${maxLength} 个字`];
  }
  return errors;
}

/** 把「字段.语言」的错误整理成多语言输入组要的样子。 */
export function languageErrors(errors: (field: string) => string[], field: string): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {};
  for (const { key } of INPUT_LANGUAGES) {
    const message = errors(`${field}.${key}`)[0];
    if (message !== undefined) result[key] = message;
  }
  return result;
}

export function coordinateErrors(field: string, value: CoordinateValue): FieldErrors {
  const errors: FieldErrors = {};
  const lat = coordinateIssue("lat", value.lat);
  const lng = coordinateIssue("lng", value.lng);
  if (lat !== null) errors[`${field}.lat`] = [lat];
  if (lng !== null) errors[`${field}.lng`] = [lng];
  return errors;
}

export function toCoordinateValue(point: Point): CoordinateValue {
  return { lat: formatCoordinate(point.lat), lng: formatCoordinate(point.lng) };
}

export function toPoint(value: CoordinateValue): Point {
  return { lat: Number(Number(value.lat).toFixed(6)), lng: Number(Number(value.lng).toFixed(6)) };
}

/** 坐标按 6 位小数的写法比较。 */
export function samePoint(value: CoordinateValue, point: Point): boolean {
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat.toFixed(6) === formatCoordinate(point.lat) && lng.toFixed(6) === formatCoordinate(point.lng);
}

/** 后端校验说明里的位置 → 字段名：按表里的顺序取第一个匹配的。 */
export function pathMapper(table: readonly [RegExp, string | ((match: RegExpExecArray) => string)][]): (path: string) => string | null {
  return (path) => {
    for (const [pattern, field] of table) {
      const match = pattern.exec(path);
      if (match) return typeof field === "string" ? field : field(match);
    }
    return null;
  };
}

export const COMMON_PATHS: readonly [RegExp, string | ((match: RegExpExecArray) => string)][] = [
  [/^\/code$/, "code"],
  [/^\/name\/(zh|ja|en|ko)$/, (match) => `name.${match[1]}`],
  [/^\/name$/, "name"],
];

export interface RowsProps {
  legend: string;
  /** 「添加{对象}」「删除第 N 个{对象}」 */
  itemName: string;
  count: number;
  max: number;
  /** 至少保留几行 */
  min?: number;
  pair?: boolean;
  renderRow(index: number): ReactNode;
  rowErrors(index: number): string[];
  errors: string[];
  hint?: string;
  required?: boolean;
  readOnly?: boolean;
  busy?: boolean;
  onAdd(): void;
  onRemove(index: number): void;
}

/** 可增减的行（docs/design/02-components.md 第 17 节）。 */
export function Rows({ legend, itemName, count, max, min = 0, pair = false, renderRow, rowErrors, errors, hint, required, readOnly, busy, onAdd, onRemove }: RowsProps) {
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">
        {legend}
        {required && !readOnly && (
          <span className="field__required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </legend>
      <div className="rows">
        {count === 0 && readOnly && <p className="field__static">—</p>}
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="rows__item">
            <div className={pair ? "rows__row rows__row--pair" : "rows__row"}>
              {renderRow(index)}
              {!readOnly && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`删除第 ${index + 1} 个${itemName}`}
                  title={count <= min ? "至少保留一个" : undefined}
                  disabled={busy || count <= min}
                  onClick={(event) => {
                    const fieldset = event.currentTarget.closest("fieldset");
                    onRemove(index);
                    requestAnimationFrame(() => {
                      const rows = fieldset?.querySelectorAll<HTMLElement>(".rows__row");
                      (rows?.[index]?.querySelector<HTMLElement>("input") ?? fieldset?.querySelector<HTMLElement>(".rows__footer button"))?.focus();
                    });
                  }}
                >
                  <Icon name="x" />
                </button>
              )}
            </div>
            <FieldErrorList id={`row-error-${legend}-${index}`} errors={rowErrors(index)} />
          </div>
        ))}
        {!readOnly && (
          <div className="rows__footer">
            <Button
              size="sm"
              disabled={busy || count >= max}
              onClick={(event) => {
                const fieldset = event.currentTarget.closest("fieldset");
                onAdd();
                requestAnimationFrame(() => fieldset?.querySelectorAll<HTMLElement>(".rows__row")[count]?.querySelector<HTMLElement>("input")?.focus());
              }}
            >
              <Icon name="plus" />
              {`添加${itemName}`}
            </Button>
            {count >= max && <span className="field__hint">{`最多 ${max} 个`}</span>}
          </div>
        )}
      </div>
      <FieldErrorList id={`rows-error-${legend}`} errors={errors} />
      {hint && <p className="field__hint">{hint}</p>}
    </fieldset>
  );
}
