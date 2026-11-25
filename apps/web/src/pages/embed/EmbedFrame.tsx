/**
 * 嵌入页文档的公共一层（M9E-16 起；M9E-17 抽出来给预订页、订单页共用，ADR 0095 第六节）：读地址、判断是不是被嵌着、和宿主说话。
 *
 * - 地址：`?draft=&key=&lang=&host=#ch=`（booking-protocol.ts 的 frameParamsOf）。只在文档加载时读一次：`ch` 放在内存里，
 *   之后换步、进订单页时地址里的 # 没了也不影响。
 * - 发给宿主：一律 `window.parent.postMessage(msg, host)`——targetOrigin 是地址里的宿主 origin（服务端已核对在白名单、浏览器已核对确实是祖先），
 *   从不用 "*"。消息里只有步骤名、高度、订单号、错误代码，不带草稿内容、令牌和任何个人信息。`host` 写法不对时一条都不发。
 * - `ready` 整个文档只发一次（页面准备好时调 `announce`），之后换页面不再发；内容高度一变就发 `resize`（同一帧只发一次）。
 * - 收宿主的消息：只认 `event.source === window.parent && event.origin === host`、频道号对得上的 viewport（只影响显示位置）。
 *   viewport 的 height、top（M9E-32，ADR 0100）放进 `viewport`（可订阅），手机底部按钮条订阅它来停在宿主屏幕的下沿；滚动时频繁更新也不让整页重新渲染。
 */
import { guestUiLanguage } from "@nozomi/domain/guest-ui-language";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type FrameMessage, type FrameParams, envelope, frameParamsOf, parseHostMessage } from "../../embed/booking-protocol.ts";
import { type HostViewportSource, createHostViewportStore } from "../../embed/frame-bar.ts";
import { EMBED_TEXTS, type EmbedLang, type EmbedTexts } from "./embed-texts.ts";

/** 嵌着这个页面的父窗口；顶层打开为 null。测试里换成替身 */
export const EMBED_FRAME = {
  parent(): Window | null {
    try {
      return window.top !== window.self ? window.parent : null;
    } catch {
      // 读 window.top 被拦（极少数浏览器）也说明在别人的框架里
      return window.parent;
    }
  },
};

export interface EmbedFrameValue {
  params: FrameParams;
  /** 被嵌着（顶层打开为 false：不显示预订内容） */
  inFrame: boolean;
  /** 实际显示的语言（客人界面语言开关之后，M11 之前总是 zh） */
  lang: EmbedLang;
  t: EmbedTexts;
  send(message: FrameMessage): void;
  /** 页面准备好了：发 `ready`（整个文档只发一次）；地址没带 lang 时语言跟草稿，再经客人界面语言开关 */
  announce(lang: EmbedLang | null): void;
  /** 宿主最近一次发来的可视高度和 iframe 上沿位置（没收到为 null；旧版组件脚本不带 top） */
  viewport: HostViewportSource;
}

const EmbedFrameContext = createContext<EmbedFrameValue | null>(null);

export function useEmbedFrame(): EmbedFrameValue {
  const value = useContext(EmbedFrameContext);
  if (value === null) throw new Error("useEmbedFrame 要在 EmbedFrame 里用");
  return value;
}

export function EmbedFrame({ children }: { children: ReactNode }) {
  const [params] = useState(() => frameParamsOf(window.location.search, window.location.hash));
  const [parent] = useState(() => EMBED_FRAME.parent());
  const [draftLang, setDraftLang] = useState<EmbedLang | null>(null);
  const [hostViewport, setHostViewport] = useState<number | null>(null);
  const [viewport] = useState(createHostViewportStore);
  const announced = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const { host, ch } = params;
  const canTalk = parent !== null && host !== null;
  // 地址里的 lang 照常读、照常校验，再经客人界面语言开关（M12-01，业主 2026-11-25：M11 之前一律中文）
  const lang: EmbedLang = guestUiLanguage(params.lang ?? draftLang ?? "ja");

  const send = useCallback(
    (message: FrameMessage): void => {
      if (parent === null || host === null) return;
      parent.postMessage(envelope(ch ?? "", message), host);
    },
    [parent, host, ch],
  );

  const announce = useCallback(
    (given: EmbedLang | null): void => {
      if (announced.current) return;
      announced.current = true;
      if (given !== null) setDraftLang(given);
      // ready 里的 lang 是实际显示的语言（M12-01 起 M11 之前总是 zh），不是地址里传进来的
      send({ type: "ready", lang: guestUiLanguage(params.lang ?? given ?? "ja") });
    },
    [send, params.lang],
  );

  // 高度：内容一变就发 resize（同一帧只发一次）
  useEffect(() => {
    const node = mainRef.current;
    if (!canTalk || node === null || typeof ResizeObserver !== "function") return;
    let frame = 0;
    let last = 0;
    const measure = (): void => {
      frame = 0;
      // 量内容本身的底边（不用 scrollHeight：内容比 iframe 矮时它等于 iframe 的高度，iframe 就缩不回来）
      const height = Math.ceil(node.getBoundingClientRect().bottom + window.scrollY);
      if (height === last) return;
      last = height;
      send({ type: "resize", height });
    };
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [canTalk, send]);

  // 宿主发来的可视高度：只认父窗口、宿主 origin、同一个频道；只用来摆放弹窗（第三期 M9E-19）和手机底部按钮条（M9E-32），不改任何预订内容
  useEffect(() => {
    if (!canTalk) return;
    const onMessage = (event: MessageEvent): void => {
      if (parent === null || event.source !== parent || event.origin !== host) return;
      const message = parseHostMessage(event.data, ch ?? "");
      if (message === null) return;
      setHostViewport(message.height);
      viewport.set({ height: message.height, top: message.top ?? null });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [canTalk, parent, host, ch, viewport]);

  const value = useMemo<EmbedFrameValue>(() => ({ params, inFrame: parent !== null, lang, t: EMBED_TEXTS[lang], send, announce, viewport }), [params, parent, lang, send, announce, viewport]);
  return (
    <EmbedFrameContext.Provider value={value}>
      <main className="embed-book" ref={mainRef} lang={lang === "zh" ? "zh-CN" : lang} data-host-viewport={hostViewport ?? undefined}>
        {children}
      </main>
    </EmbedFrameContext.Provider>
  );
}

/**
 * 嵌入页里站内地址的查询串：保留 draft、key、lang、host（Caddy 靠 key、host 做 frame-check，丢了整页重新加载就嵌不进去），去掉步骤号；
 * 银行回跳带回来的频道号 `ch` 和 Stripe 加的 `payment_intent*`、`redirect_status`（里面有 client_secret）也去掉（M9E-19）。
 */
export function embedSearch(search: string): string {
  const query = new URLSearchParams(search);
  for (const name of ["step", "ch", "payment_intent", "payment_intent_client_secret", "redirect_status"]) query.delete(name);
  const text = query.toString();
  return text === "" ? "" : `?${text}`;
}

/** 嵌入订单页地址的 # 部分：频道号放这里（不发给服务器、不进 Referer），iframe 刷新后 `frameParamsOf` 照样读得到（M9E-19） */
export function embedHash(ch: string | null): string {
  return ch === null ? "" : `#ch=${encodeURIComponent(ch)}`;
}
