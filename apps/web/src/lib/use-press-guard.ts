import { useEffect, useRef } from "react";

/**
 * 「失去焦点时校验」和「点提交按钮」撞在一起的问题：
 * 用户填完一个字段直接去点提交按钮，按下的瞬间字段失去焦点、出错文字冒出来把按钮往下推，
 * 松开时指针已经不在按钮上，这次点击就丢了。
 *
 * 做法：指针按在提交按钮上的这段时间里，失去焦点不触发校验（提交本身会校验全部字段）。
 * 用法：提交按钮加 `onPointerDown={guard.onPointerDown}`，字段的 onBlur 里先问 `guard.isPressing()`。
 */
export function usePressGuard(): { onPointerDown(): void; isPressing(): boolean } {
  const pressing = useRef(false);
  useEffect(() => {
    const release = (): void => {
      pressing.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);
  return {
    onPointerDown: () => {
      pressing.current = true;
    },
    isPressing: () => pressing.current,
  };
}
