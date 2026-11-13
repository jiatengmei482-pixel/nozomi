/**
 * 手机触屏上的新预订页（M8-37，业主 2026-11-12：移动设备优先保证操作流程）：
 * 地址、日期、时间都是「点一下 → 全屏选择页 → 选好回到页面」，不在页面上弹候选列表（手机键盘、吸顶条、地图都可能盖住它）。
 * 只看「手指操作 + 手机尺寸」（竖屏宽度 < 768，或屏幕短边 < 600 的横屏手机）：电脑、鼠标操作的窄窗口照旧在页面上选。
 */
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { FullScreenSheet } from "../../../components/FullScreenSheet.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { TextField } from "../../../components/TextField.tsx";

export const FULL_SCREEN_PICKER_QUERY = "(pointer: coarse) and (max-width: 767.98px)";
const COARSE = "(pointer: coarse)";

function query(text: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(text).matches;
}

/**
 * 竖屏手机：触屏且宽度 < 768。横屏手机（宽约 844、高约 390，键盘一弹几乎没有可见区域）也要全屏（M8-37 审查）：
 * 看屏幕本身的短边（screen 不随键盘变），不看视口高度——安卓上键盘会把视口压矮，按视口判断会在打字时来回切换。
 */
function matches(): boolean {
  if (query(FULL_SCREEN_PICKER_QUERY)) return true;
  return query(COARSE) && typeof screen !== "undefined" && Math.min(screen.width, screen.height) < 600;
}

/** 是不是要用全屏选择页；横竖屏切换、接上鼠标时跟着变。 */
export function useFullScreenPickers(): boolean {
  const [on, setOn] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const lists = [window.matchMedia(FULL_SCREEN_PICKER_QUERY), window.matchMedia(COARSE)];
    const change = (): void => setOn(matches());
    change();
    for (const media of lists) media.addEventListener?.("change", change);
    return () => {
      for (const media of lists) media.removeEventListener?.("change", change);
    };
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
  /** 选择页关闭后焦点回到这一格 */
  buttonRef?: RefObject<HTMLButtonElement | null>;
  /** 长的值折行显示全（地址，M8-37b）；不给时单行省略（日期、时间） */
  wrap?: boolean;
}

/** 页面上代替输入框的那一格：看起来像输入框，点一下打开全屏选择页。名称是「标签 + 当前值」。 */
export function PickerTrigger({ label, text, placeholder, describedBy, onOpen, buttonRef, wrap = false }: PickerTriggerProps) {
  const labelId = useId();
  const textId = useId();
  const className = ["input input--lg picker-trigger", text === "" ? "picker-trigger--empty" : null, wrap ? "picker-trigger--wrap" : null].filter(Boolean).join(" ");
  return (
    <>
      <span className="field__label" id={labelId}>
        {label}
      </span>
      <button ref={buttonRef} type="button" className={className} aria-haspopup="dialog" aria-labelledby={`${labelId} ${textId}`} aria-describedby={describedBy} onClick={onOpen}>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 选择页开着时转屏 / 接上鼠标、换成页面上的输入框：关掉选择页，草稿作废，转回来也不会自己弹出（M8-37 审查）
  useEffect(() => setOpen(false), [fullScreen]);
  if (!fullScreen) return <TextField label={label} size="lg" type={type} required value={value} errors={errors} {...(hint !== undefined ? { hint } : {})} onChange={(event) => onValue(event.target.value)} />;
  const describedBy = [errors.length > 0 ? errorId : null, hint !== undefined ? hintId : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <PickerTrigger
        label={label}
        text={value}
        placeholder={type === "date" ? "点按选择日期" : "点按选择时间"}
        {...(describedBy !== "" ? { describedBy } : {})}
        buttonRef={triggerRef}
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
        returnFocusRef={triggerRef}
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
