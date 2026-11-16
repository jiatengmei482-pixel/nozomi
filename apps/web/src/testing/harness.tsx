/**
 * 组件测试的公用工具。只被 *.test.tsx 引用，不进正式构建。
 * 接口用测试替身（替换全局 fetch），按「方法 + 路径」应答；真实后端由端到端测试覆盖。
 */
import assert from "node:assert/strict";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { sessionStore } from "../auth/session-store.ts";
import { ToastProvider } from "../components/Toast.tsx";
import type { Tenant } from "../api/types.ts";

export interface ApiCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: ApiCall) => Response | Promise<Response>;

const realFetch = globalThis.fetch;

/** 登录页打开时都会问一次哪些登录方式可用（ADR 0050）。测试没有专门登记时当作「邮件没配置，只有密码」，也不算进请求记录。 */
const LOGIN_METHODS_PATH = /^\/(platform|tenant)\/v1\/auth\/login-methods$/;
const onlyPassword = (): Response => new Response(JSON.stringify({ email_code: false, password: true }), { status: 200, headers: { "content-type": "application/json" } });

/** 测试没有换 fetch 时，登录页问可用方式也不出网。 */
const defaultFetch = ((input: RequestInfo | URL, init?: RequestInit) => (LOGIN_METHODS_PATH.test(String(input)) ? Promise.resolve(onlyPassword()) : realFetch(input, init))) as typeof fetch;
globalThis.fetch = defaultFetch;

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
    if (LOGIN_METHODS_PATH.test(call.path) && routes[`${call.method} ${call.path}`] === undefined) return onlyPassword();
    calls.push(call);
    const responder = routes[`${call.method} ${call.path}`];
    if (!responder) throw new Error(`测试没有登记接口：${call.method} ${call.path}`);
    return responder(call);
  }) as typeof fetch;
  return calls;
}

/** 同上，但由一个函数按「方法 + 路径（含查询串）」决定应答；返回 null 表示没有登记，测试失败。 */
export function stubApiWith(respond: (call: ApiCall & { url: URL }) => Response | Promise<Response> | null): ApiCall[] {
  const calls: ApiCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: ApiCall = {
      method: init?.method ?? "GET",
      path: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    if (LOGIN_METHODS_PATH.test(call.path)) return onlyPassword();
    calls.push(call);
    const response = respond({ ...call, url: new URL(call.path, "http://localhost") });
    if (response === null) throw new Error(`测试没有登记接口：${call.method} ${call.path}`);
    return response;
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
export function renderAt(initial: string | { pathname: string; search?: string; hash?: string; state?: unknown }, routes: ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          {routes}
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

export function currentLocation(): { path: string; state: unknown } | null {
  const probe = document.querySelector('[data-testid="location"]');
  if (!probe) return null;
  return { path: probe.textContent ?? "", state: JSON.parse(probe.getAttribute("data-state") ?? "null") };
}

const restorers: (() => void)[] = [];

/**
 * 假装是手机宽度（< 768px）：`matchMedia("(max-width: 767px)")` 和新预订页底部按钮条的 `(max-width: 768px)`（M9E-32）为真；每个元素都在屏幕下方 `top` 像素处；
 * 记下 `scrollIntoView` 滚到了哪些元素（返回的数组里是元素 id）。resetBrowser 时还原。
 */
export function narrowScreen(top = 2000): string[] {
  const scrolled: string[] = [];
  const original = { matchMedia: window.matchMedia, rect: Element.prototype.getBoundingClientRect, scroll: Element.prototype.scrollIntoView };
  window.matchMedia = ((query: string) => ({ matches: query.includes("max-width: 767px") || query.includes("max-width: 768px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  Element.prototype.getBoundingClientRect = function rect() {
    return { top, bottom: top + 40, left: 0, right: 320, width: 320, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView = function scroll(this: Element) {
    scrolled.push(this.id);
  };
  restorers.push(() => {
    window.matchMedia = original.matchMedia;
    Element.prototype.getBoundingClientRect = original.rect;
    Element.prototype.scrollIntoView = original.scroll;
  });
  return scrolled;
}

/**
 * 假装视口有 `width` 像素宽：`matchMedia` 按这个宽度回答 `(min-width: Npx)`、`(max-width: Npx)`（不问宽度的媒体查询都不满足）；`resize` 换宽度并通知监听者（同浏览器的 change 事件）。
 * resetBrowser 或 `restore` 时还原。
 */
export function viewportWidth(width: number): { resize(next: number): void; restore(): void } {
  const original = window.matchMedia;
  let current = width;
  const lists: { query: string; matches: boolean; listeners: Set<() => void> }[] = [];
  const answer = (query: string): boolean => {
    const min = /min-width:\s*(\d+)px/.exec(query)?.[1];
    const max = /max-width:\s*(\d+)px/.exec(query)?.[1];
    // 不问宽度的（暗色、减少动画等）一律不满足，同没有这些偏好的浏览器
    if (min === undefined && max === undefined) return false;
    return (min === undefined || current >= Number(min)) && (max === undefined || current <= Number(max));
  };
  window.matchMedia = ((query: string) => {
    const entry = { query, matches: answer(query), listeners: new Set<() => void>() };
    lists.push(entry);
    return {
      get matches() {
        return entry.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener),
      addListener: (listener: () => void) => entry.listeners.add(listener),
      removeListener: (listener: () => void) => entry.listeners.delete(listener),
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  const restore = (): void => {
    window.matchMedia = original;
  };
  restorers.push(restore);
  return {
    resize(next) {
      current = next;
      for (const entry of lists) {
        const matches = answer(entry.query);
        if (matches === entry.matches) continue;
        entry.matches = matches;
        for (const listener of [...entry.listeners]) listener();
      }
    },
    restore,
  };
}

/** 每个测试结束后调用：卸载组件，还原 fetch，还原 narrowScreen 换掉的东西，清空登录状态、主题和本地存储。 */
export function resetBrowser(): void {
  cleanup();
  while (restorers.length > 0) restorers.pop()?.();
  globalThis.fetch = defaultFetch;
  sessionStore.clear("tenant");
  sessionStore.clear("platform");
  localStorage.clear();
  sessionStorage.clear();
  delete (globalThis as { Stripe?: unknown }).Stripe;
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

/** 供应商主体里入驻、评分那些字段的默认值（M4-01）：测试只关心名称和状态时用它补齐。 */
export const TENANT_EXTRAS: Omit<Tenant, "id" | "name" | "status" | "created_at" | "updated_at"> = {
  suspended_from: null,
  suspension_reasons: [],
  suspended_at: null,
  observation_reasons: [],
  observation_since: null,
  signed_at: null,
  trial_started_at: null,
  activated_at: null,
  terminated_at: null,
  score: { score_centi: null, raw_score_centi: null, completed_orders: 0, no_shows: 0, score_on: null },
  is_test_tenant: false,
  version: 1,
};
