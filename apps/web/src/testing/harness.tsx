/**
 * 组件测试的公用工具。只被 *.test.tsx 引用，不进正式构建。
 * 接口用测试替身（替换全局 fetch），按「方法 + 路径」应答；真实后端由端到端测试覆盖。
 */
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { sessionStore } from "../auth/session-store.ts";

export interface ApiCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: ApiCall) => Response | Promise<Response>;

const realFetch = globalThis.fetch;

/** 替换全局 fetch。没有登记的接口一律让测试失败，避免悄悄打到别处。 */
export function stubApi(routes: Record<string, Responder>): ApiCall[] {
  const calls: ApiCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: ApiCall = {
      method: init?.method ?? "GET",
      path: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const responder = routes[`${call.method} ${call.path}`];
    if (!responder) throw new Error(`测试没有登记接口：${call.method} ${call.path}`);
    return responder(call);
  }) as typeof fetch;
  return calls;
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function apiError(status: number, code: string, message: string, details: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json(status, { error: { code, message, details } }, headers);
}

/** 一个由测试决定何时完成的应答，用来观察「提交中」的界面。 */
export function deferred(): { promise: Promise<Response>; resolve(response: Response): void } {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}`}
    </output>
  );
}

/**
 * 在内存路由里渲染。`routes` 之外的任何地址都会渲染一个探针，
 * 测试用 `currentLocation()` 读出「页面跳到了哪里、带了什么 state」。
 */
export function renderAt(initial: string | { pathname: string; hash?: string; state?: unknown }, routes: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        {routes}
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

export function currentLocation(): { path: string; state: unknown } | null {
  const probe = document.querySelector('[data-testid="location"]');
  if (!probe) return null;
  return { path: probe.textContent ?? "", state: JSON.parse(probe.getAttribute("data-state") ?? "null") };
}

/** 每个测试结束后调用：卸载组件，还原 fetch，清空登录状态、主题和本地存储。 */
export function resetBrowser(): void {
  cleanup();
  globalThis.fetch = realFetch;
  sessionStore.clear("tenant");
  sessionStore.clear("platform");
  localStorage.clear();
  sessionStorage.clear();
  delete document.documentElement.dataset["theme"];
}

export const FAR_FUTURE = "2999-01-01T00:00:00.000Z";

export function signIn(portal: "tenant" | "platform", accessToken = "test-token"): void {
  sessionStore.set(portal, { accessToken, expiresAt: FAR_FUTURE });
}

/**
 * 断言焦点在某个元素上 / 某个元素不存在。不直接把 DOM 节点交给 assert.equal：
 * 断言失败时它会试图把整棵 React 树打印出来，测试进程会卡死而不是报错。
 */
export function assertFocused(element: Element | null): void {
  const describe = (node: Element | null): string => (node ? `<${node.tagName.toLowerCase()}> ${node.getAttribute("aria-label") ?? node.textContent ?? ""}` : "（无）");
  assert.ok(element !== null && document.activeElement === element, `焦点应在 ${describe(element)}，实际在 ${describe(document.activeElement)}`);
}

export function assertAbsent(element: Element | null): void {
  assert.ok(element === null, `不应该出现：${element?.textContent ?? ""}`);
}
