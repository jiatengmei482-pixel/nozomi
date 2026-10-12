/**
 * Toast（docs/design/02-components.md 第 8 节）：只用来确认「刚才的操作成功了」，出错不用它。
 * 容器是一个始终存在的 aria-live 区域，每条 Toast 自己是 role="status"（空着的容器不算一条状态）。
 * 整个应用只有一个容器，挂在路由外面，所以跳转前发出的 Toast 在跳转后的页面上照常显示。
 * 停留 4 秒，鼠标悬停或键盘聚焦时暂停；同时最多 3 条；同一句话再次触发只重置计时。
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";

const STAY_MS = 4_000;
const MAX_VISIBLE = 3;

interface ToastItem {
  id: number;
  text: string;
  /** 每次重新触发加一，用来重置计时 */
  round: number;
  action?: ToastAction;
}

/** Toast 上的一个动作（「撤销」）：点了执行并收起这条 Toast。 */
export interface ToastAction {
  label: string;
  onAction(): void;
}

type ShowToast = (text: string, action?: ToastAction) => void;
const ToastContext = createContext<ShowToast>(() => undefined);

/** 发一条 Toast。文案写「已 + 动作 + 对象」。 */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}

function ToastView({ item, onDone }: { item: ToastItem; onDone(): void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(onDone, STAY_MS);
    return () => clearTimeout(timer);
  }, [paused, item.round, onDone]);
  return (
    <div className="toast" role="status" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <Icon name="check" />
      <span className="toast__text">{item.text}</span>
      {item.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            item.action?.onAction();
            onDone();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="关闭提示" onClick={onDone}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const show = useCallback<ShowToast>((text, action) => {
    setItems((current) => {
      const existing = current.find((item) => item.text === text);
      if (existing) return current.map((item) => (item === existing ? { ...item, round: item.round + 1, ...(action ? { action } : {}) } : item));
      const id = nextId.current;
      nextId.current += 1;
      return [...current, { id, text, round: 0, ...(action ? { action } : {}) }].slice(-MAX_VISIBLE);
    });
  }, []);
  const remove = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const removers = useMemo(() => new Map<number, () => void>(), []);
  const removerFor = (id: number): (() => void) => {
    let remover = removers.get(id);
    if (!remover) {
      remover = () => {
        removers.delete(id);
        remove(id);
      };
      removers.set(id, remover);
    }
    return remover;
  };
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" aria-live="polite">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDone={removerFor(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
