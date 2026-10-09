import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client.ts";
import { usePortalSession } from "../auth/PortalSession.tsx";

export type LoadState<T> =
  | { status: "loading"; data: T | null }
  | { status: "error"; data: T | null }
  | { status: "forbidden"; data: null }
  | { status: "not-found"; data: null }
  | { status: "ready"; data: T };

/**
 * 取一份数据并跟踪它的状态。失败先交给登录状态（401 回登录页，必须先改密码去改密页），
 * 其余分成：没有权限（403）、不存在（404）、出错（网络、服务器）。
 * `key` 变了就重新取；重新取的时候保留上一次的内容（列表翻页、改筛选时不清空）。
 * `fetcher` 为 null 表示现在不用取。
 */
export function useLoad<T>(key: string, fetcher: ((token: string) => Promise<T>) | null): { state: LoadState<T>; reload(): void; set(data: T): void } {
  const enabled = fetcher !== null;
  const { token, handleAuthFailure } = usePortalSession();
  const [state, setState] = useState<LoadState<T>>({ status: "loading", data: null });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ fetcher, handleAuthFailure });
  latest.current = { fetcher, handleAuthFailure };

  useEffect(() => {
    const run = latest.current.fetcher;
    if (run === null) return;
    let cancelled = false;
    setState((current) => ({ status: "loading", data: current.data }));
    run(token).then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      (err: unknown) => {
        if (cancelled || latest.current.handleAuthFailure(err)) return;
        if (err instanceof ApiError && err.status === 403) setState({ status: "forbidden", data: null });
        else if (err instanceof ApiError && (err.status === 404 || err.code === "VALIDATION_FAILED")) setState({ status: "not-found", data: null });
        else setState((current) => ({ status: "error", data: current.data }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, token, attempt, enabled]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const set = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { state, reload, set };
}
