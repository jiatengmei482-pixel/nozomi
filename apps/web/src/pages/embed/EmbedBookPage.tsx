/**
 * 嵌入预订页 `/embed/book`（M9E-16，ADR 0095 第四、六节）：在合作网站页面的 iframe 里打开（宿主页的 `NozomiBooking.mountBooking` 建的）。
 *
 * 第一期是占位页：读草稿、显示这次要订的内容，给「到主站继续预订」（新标签页）；完整的四步预订是第二期 M9E-17。
 * - 地址：`?draft=&key=&lang=&host=#ch=`（booking-protocol.ts 的 frameParamsOf）。`ch` 读出来就放在内存里，不依赖地址里的 # 一直在。
 * - 被嵌着（`window.top !== window`）：读完草稿后向宿主发 `ready`，之后内容高度一变就发 `resize`；读不到草稿发 `error`。
 *   消息一律 `window.parent.postMessage(msg, host)`——targetOrigin 是地址里的宿主 origin（服务端已核对在白名单、浏览器已核对确实是祖先），从不用 "*"；
 *   消息里只有步骤名、高度、错误代码，不带草稿内容和任何个人信息。
 * - 收宿主的消息：只认 `event.source === window.parent && event.origin === host`、频道号对得上的 viewport（只影响显示位置）。
 * - 去主站的链接一律新标签页（NewTabLink，noopener）：不在 iframe 里换到别的页面。
 * - 直接在地址栏打开（没被嵌）：不显示预订内容，只说「请在合作网站上预订」并给主站链接（ADR 0095 第五节第 3 小节表格最后一行）。
 */
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { type BookingDraft, getSiteBookingDraft } from "../../api/site.ts";
import { type BookingErrorCode, type FrameMessage, envelope, frameParamsOf, parseHostMessage } from "../../embed/booking-protocol.ts";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { useDocumentTitle } from "../../lib/use-document-title.ts";

type Lang = "zh" | "ja" | "en";
type Texts = Record<"title" | "loading" | "seller" | "placeholder" | "continue" | "expired" | "failed" | "topLevel" | "goToSite" | "transfer" | "charter" | "from" | "to" | "stops" | "when" | "guests" | "badAddress", string>;

export const EMBED_TEXTS: Readonly<Record<Lang, Texts>> = {
  zh: {
    title: "NOZOMI 用车预订",
    loading: "正在读取预订内容…",
    seller: "本预订由 NOZOMI 提供并收款。",
    placeholder: "在这里直接完成预订的功能正在接入。现在请到 NOZOMI 主站继续预订，已填的内容会带过去。",
    continue: "到主站继续预订",
    expired: "这次查询已过期，请在上方重新查询。",
    failed: "预订内容暂时读不出来，请稍后刷新，或到主站预订。",
    topLevel: "请在合作网站上预订，或到 NOZOMI 主站预订。",
    goToSite: "到 NOZOMI 主站预订",
    transfer: "区间接送",
    charter: "按时包车",
    from: "出发地",
    to: "目的地",
    stops: "经停点",
    when: "用车时间",
    guests: "人数和行李",
    badAddress: "预订页的地址不完整，请回到合作网站重新打开。",
  },
  ja: {
    title: "NOZOMI 配車予約",
    loading: "予約内容を読み込んでいます…",
    seller: "この予約は NOZOMI が提供し、代金を受け取ります。",
    placeholder: "このページで予約を完了する機能は準備中です。NOZOMI 本サイトで予約を続けてください（入力内容は引き継がれます）。",
    continue: "本サイトで予約を続ける",
    expired: "この検索の有効期限が切れました。上の「もう一度検索」からやり直してください。",
    failed: "予約内容を読み込めませんでした。しばらくしてから再読み込みするか、本サイトでご予約ください。",
    topLevel: "提携サイト、または NOZOMI 本サイトでご予約ください。",
    goToSite: "NOZOMI 本サイトで予約",
    transfer: "片道送迎",
    charter: "時間貸し",
    from: "出発地",
    to: "目的地",
    stops: "経由地",
    when: "乗車日時",
    guests: "人数と荷物",
    badAddress: "予約ページのアドレスが不完全です。提携サイトからもう一度開いてください。",
  },
  en: {
    title: "NOZOMI ride booking",
    loading: "Loading your booking…",
    seller: "This booking is provided and charged by NOZOMI.",
    placeholder: "Booking directly on this page is coming soon. Please continue on the NOZOMI site — what you entered is carried over.",
    continue: "Continue on our site",
    expired: "This search has expired. Please search again above.",
    failed: "We can't load your booking right now. Please refresh later or book on our site.",
    topLevel: "Please book on our partner's site or on the NOZOMI site.",
    goToSite: "Book on the NOZOMI site",
    transfer: "Point to Point",
    charter: "Hourly",
    from: "From",
    to: "To",
    stops: "Stops",
    when: "Pickup time",
    guests: "Passengers and luggage",
    badAddress: "This booking page address is incomplete. Please open it again from our partner's site.",
  },
};

const guestsText = (lang: Lang, draft: BookingDraft): string =>
  lang === "zh" ? `${draft.passengers} 位乘客 · ${draft.luggage} 件行李` : lang === "ja" ? `${draft.passengers}名 · 荷物${draft.luggage}個` : `${draft.passengers} passenger(s) · ${draft.luggage} bag(s)`;

/** 读草稿最多等这么久：再不回就当读不出（发 error LOAD_FAILED），宿主不至于一直等 ready；测试里调短 */
export const DRAFT_TIMEOUT = { ms: 10_000 };

type Load = { kind: "loading" } | { kind: "ready"; draft: BookingDraft } | { kind: "error"; code: BookingErrorCode };

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

export function EmbedBookPage() {
  // 地址只在进来时读一次：ch 放在内存里，之后地址里的 # 没了也不影响
  const [params] = useState(() => frameParamsOf(window.location.search, window.location.hash));
  const [parent] = useState(() => EMBED_FRAME.parent());
  const inFrame = parent !== null;
  const [load, setLoad] = useState<Load>(() => (params.draft === null ? { kind: "error", code: "DRAFT_NOT_FOUND" } : { kind: "loading" }));
  const lang: Lang = params.lang ?? (load.kind === "ready" ? load.draft.lang : "ja");
  const t = EMBED_TEXTS[lang];
  useDocumentTitle(t.title);
  const mainRef = useRef<HTMLElement | null>(null);
  // 宿主窗口的可视高度（viewport 消息）：第三期摆放 3D 验证弹窗用（M9E-19）；现在只记在页面上
  const [hostViewport, setHostViewport] = useState<number | null>(null);
  const { host, ch, draft } = params;
  const canTalk = parent !== null && host !== null;

  const send = (message: FrameMessage): void => {
    if (parent === null || host === null) return;
    parent.postMessage(envelope(ch ?? "", message), host);
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  // 读草稿：被嵌着才读（顶层打开不显示预订内容）
  useEffect(() => {
    if (!inFrame || draft === null) return;
    let alive = true;
    const timer = setTimeout(() => alive && setLoad({ kind: "error", code: "LOAD_FAILED" }), DRAFT_TIMEOUT.ms);
    getSiteBookingDraft(draft).then(
      (found) => alive && setLoad({ kind: "ready", draft: found.draft }),
      (err: unknown) => alive && setLoad({ kind: "error", code: err instanceof ApiError && err.status === 404 ? "DRAFT_NOT_FOUND" : "LOAD_FAILED" }),
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [inFrame, draft]);

  // 草稿有了结论就告诉宿主：先 ready（宿主据此取消 15 秒的后备；语言此时已跟着草稿定下来），读不出再发 error。各只发一次
  const announced = useRef(false);
  useEffect(() => {
    if (load.kind === "loading" || announced.current) return;
    announced.current = true;
    send({ type: "ready", lang });
    if (load.kind === "error") send({ type: "error", code: load.code });
  });

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
      sendRef.current({ type: "resize", height });
    };
    const observer = new ResizeObserver(() => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [canTalk]);

  // 宿主发来的可视高度：只认父窗口、宿主 origin、同一个频道；只用来摆放弹窗，不改任何预订内容
  useEffect(() => {
    if (!canTalk) return;
    const onMessage = (event: MessageEvent): void => {
      if (parent === null || event.source !== parent || event.origin !== host) return;
      const message = parseHostMessage(event.data, ch ?? "");
      if (message !== null) setHostViewport(message.height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [parent, host, ch]);

  const siteLink = `/book/new${draft === null ? "" : `?draft=${encodeURIComponent(draft)}`}`;

  if (!inFrame) {
    return (
      <main className="embed-book" ref={mainRef}>
        <section className="site-section" role="status">
          <p>{t.topLevel}</p>
          <p>
            <a href={siteLink}>{t.goToSite}</a>
          </p>
        </section>
      </main>
    );
  }
  if (host === null) {
    return (
      <main className="embed-book" ref={mainRef}>
        <section className="site-section" role="alert">
          <p>{t.badAddress}</p>
        </section>
      </main>
    );
  }
  return (
    <main className="embed-book" ref={mainRef} lang={lang === "zh" ? "zh-CN" : lang} data-host-viewport={hostViewport ?? undefined}>
      <h1 className="embed-book__title">{t.title}</h1>
      <p className="site-muted">{t.seller}</p>
      {load.kind === "loading" && (
        <p role="status" aria-busy="true">
          {t.loading}
        </p>
      )}
      {load.kind === "error" && (
        <section className="site-section" role="alert">
          <p>{load.code === "DRAFT_NOT_FOUND" ? t.expired : t.failed}</p>
          {load.code !== "DRAFT_NOT_FOUND" && (
            <p>
              <NewTabLink to={siteLink}>{t.goToSite}</NewTabLink>
            </p>
          )}
        </section>
      )}
      {load.kind === "ready" && (
        <section className="site-section" aria-label={load.draft.tab === "charter" ? t.charter : t.transfer}>
          <h2 className="site-section__title">{load.draft.tab === "charter" ? t.charter : t.transfer}</h2>
          <dl className="embed-book__facts">
            <dt>{t.when}</dt>
            <dd>{load.draft.service_local.replace("T", " ")}</dd>
            <dt>{t.from}</dt>
            <dd className="site-break">{load.draft.pickup.name}</dd>
            {load.draft.waypoints.length > 0 && (
              <>
                <dt>{t.stops}</dt>
                <dd className="site-break">{load.draft.waypoints.map((stop) => stop.name).join(" → ")}</dd>
              </>
            )}
            <dt>{t.to}</dt>
            <dd className="site-break">{load.draft.dropoff.name}</dd>
            <dt>{t.guests}</dt>
            <dd>{guestsText(lang, load.draft)}</dd>
          </dl>
          <p className="site-muted">{t.placeholder}</p>
          <p>
            <NewTabLink to={siteLink} className="button button--primary">
              {t.continue}
            </NewTabLink>
          </p>
        </section>
      )}
    </main>
  );
}
