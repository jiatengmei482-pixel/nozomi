/**
 * 手机触屏上的新预订页（M8-37，业主 2026-11-12：移动设备优先保证操作流程）：
 * 地址、日期、时间都是「点一下 → 全屏选择页 → 选好回到页面」，不在页面上弹候选列表（手机键盘、吸顶条、地图都可能盖住它）。
 * 只看「手指操作 + 手机宽度」：电脑、鼠标操作的窄窗口照旧在页面上选。
 */
import { useEffect, useId, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { FullScreenSheet } from "../../../components/FullScreenSheet.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TextField } from "../../../components/TextField.tsx";

export const FULL_SCREEN_PICKER_QUERY = "(pointer: coarse) and (max-width: 767.98px)";

function matches(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(FULL_SCREEN_PICKER_QUERY).matches;
}

/** 是不是要用全屏选择页；横竖屏切换、接上鼠标时跟着变。 */
export function useFullScreenPickers(): boolean {
  const [on, setOn] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(FULL_SCREEN_PICKER_QUERY);
    const change = (): void => setOn(media.matches);
    change();
    media.addEventListener?.("change", change);
    return () => media.removeEventListener?.("change", change);
  }, []);
  return on;
}

export interface PickerTriggerProps {
  label: string;
  /** 已选的值；空的时候显示 `placeholder` */
  text: string;
  placeholder: string;
  describedBy?: string;
  onOpen(): void;
}

/** 页面上代替输入框的那一格：看起来像输入框，点一下打开全屏选择页。名称是「标签 + 当前值」。 */
export function PickerTrigger({ label, text, placeholder, describedBy, onOpen }: PickerTriggerProps) {
  const labelId = useId();
  const textId = useId();
  return (
    <>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <button type="button" className={text === "" ? "input input--lg picker-trigger picker-trigger--empty" : "input input--lg picker-trigger"} aria-haspopup="dialog" aria-labelledby={`${labelId} ${textId}`} aria-describedby={describedBy} onClick={onOpen}>
        <span id={textId} className="picker-trigger__text">
          {text === "" ? placeholder : text}
        </span>
        <Icon name="chevron-down" className="picker-trigger__icon" />
      </button>
    </>
  );
}

export interface PickerTextFieldProps {
  label: string;
  type: "date" | "time";
  value: string;
  errors: readonly string[];
  hint?: string;
  onValue(value: string): void;
}

/**
 * 日期、时间：电脑上是现在的输入框；手机触屏上点一下打开全屏选择页（里面是手机自带的日期 / 时间选择），「确定」后回到页面，「取消」不改。
 */
export function PickerTextField({ label, type, value, errors, hint, onValue }: PickerTextFieldProps) {
  const fullScreen = useFullScreenPickers();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const errorId = useId();
  const hintId = useId();
  if (!fullScreen) return <TextField label={label} size="lg" type={type} required value={value} errors={errors} {...(hint !== undefined ? { hint } : {})} onChange={(event) => onValue(event.target.value)} />;
  const describedBy = [errors.length > 0 ? errorId : null, hint !== undefined ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <PickerTrigger
        label={label}
        text={value}
        placeholder={type === "date" ? "点按选择日期" : "点按选择时间"}
        {...(describedBy !== "" ? { describedBy } : {})}
        onOpen={() => {
          setDraft(value);
          setOpen(true);
        }}
      />
      {errors.length > 0 && (
        <ul className="field__errors" id={errorId}>
          {errors.map((message) => (
            <li key={message} className="field__error">
              <Icon name="alert-triangle" className="field__error-icon" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      )}
      {hint !== undefined && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      <FullScreenSheet
        open={open}
        title={label}
        onClose={() => setOpen(false)}
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={draft === ""}
            onClick={() => {
              onValue(draft);
              setOpen(false);
            }}
          >
            确定
          </Button>
        }
      >
        <TextField label={label} size="lg" type={type} value={draft} data-autofocus {...(hint !== undefined ? { hint } : {})} onChange={(event) => setDraft(event.target.value)} />
      </FullScreenSheet>
    </div>
  );
}
