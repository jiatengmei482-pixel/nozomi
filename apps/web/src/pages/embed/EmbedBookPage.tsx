/**
 * 嵌入预订页 `/embed/book`（M9E-16 占位页；M9E-17 起是完整的四步，ADR 0095 第四、八、九节）：在合作网站页面的 iframe 里打开
 * （宿主页的 `NozomiBooking.mountBooking` 建的）。和宿主说话的部分在 EmbedFrame.tsx。
 *
 * - 先看本标签页有没有这个草稿下过、还待付款的单（`nozomi.embed-order`，宿主页刷新后续接）：有就进订单页；已付款、已取消、读不到的立即删掉，照常预订。
 * - 读草稿时带上 iframe 地址里的 `key`、`host`：服务端回答草稿上记的嵌入码、宿主和这次对不对得上（`source_matches`）；
 *   对不上时照常预填和报价，但询价不带 `draft_id`，来源按主站记。
 * - 读到草稿后发 `ready`，然后就是 `/book/new` 的四步（同一份组件，`BookingShell` 换外壳）：一直单栏、不用 Leaflet（不提供地图选点，
 *   静态路线图失败时只留时长和公里数）、换步发 `step`、下单后进 iframe 里的订单页（令牌放 history.state 和 `nozomi.embed-order`，不进地址、不发给宿主）。
 *   读不到草稿发 `ready` 再发 `error`。
 * - 页面顶部写明卖方「本预订由 NOZOMI 提供并收款」（Q14）。去主站的链接一律新标签页。
 * - 直接在地址栏打开（没被嵌）：不显示预订内容，只说「请在合作网站上预订」并给主站链接（ADR 0095 第五节第 3 小节表格最后一行）。
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../../api/client.ts";
import { type BookingDraft, getSiteBookingDraft, getSiteOrder } from "../../api/site.ts";
import { NewTabLink } from "../../components/NewTabLink.tsx";
import { type BookingErrorCode, type BookingStep, EMBED_BOOK_ORDER_PATH } from "../../embed/booking-protocol.ts";
import { embedOrderFor, forgetEmbedOrder, rememberEmbedOrder } from "../../embed/embed-order-store.ts";
import type { BookStep } from "../../lib/book-new.ts";
import { useDocumentTitle } from "../../lib/use-document-title.ts";
import { BookNewPage } from "../book/new/BookNewPage.tsx";
import { type BookingShell, BookingShellContext } from "../book/new/booking-shell.tsx";
import { embedSearch, useEmbedFrame } from "./EmbedFrame.tsx";

/** 读草稿（含先看有没有待续接的单）最多等这么久：再不回就当读不出（发 error LOAD_FAILED），宿主不至于一直等 ready；测试里调短 */
export const DRAFT_TIMEOUT = { ms: 10_000 };

type Load = { kind: "loading" } | { kind: "ready"; draft: BookingDraft; sourceMatches: boolean } | { kind: "error"; code: BookingErrorCode };

const STEP_NAMES: Readonly<Record<BookStep, BookingStep>> = { 1: "trip", 2: "vehicle", 3: "passenger", 4: "review" };

/** 嵌入页顶部：标题和卖方（Q14） */
export function EmbedHeader({ children }: { children?: ReactNode }) {
  const { t } = useEmbedFrame();
  return (
    <header className="embed-book__head">
      <h1 className="embed-book__title">{t.title}</h1>
      <p className="embed-book__seller">{t.seller}</p>
      {children}
    </header>
  );
}

/** 没被嵌、地址不完整：两种都不显示预订内容 */
export function EmbedRefusal() {
  const { inFrame, params, t } = useEmbedFrame();
  const siteLink = `/book/new${params.draft === null ? "" : `?draft=${encodeURIComponent(params.draft)}`}`;
  if (!inFrame) {
    return (
      <section className="embed-book__section" role="status">
        <p>{t.topLevel}</p>
        <p>
          <a className="link" href={siteLink}>
            {t.goToSite}
          </a>
        </p>
      </section>
    );
  }
  return (
    <section className="embed-book__section" role="alert">
      <p>{t.badAddress}</p>
    </section>
  );
}

export function EmbedBookPage() {
  const frame = useEmbedFrame();
  const { params, inFrame, t, send, announce } = frame;
  const { draft, key, host } = params;
  useDocumentTitle(t.title);
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>(() => (draft === null ? { kind: "error", code: "DRAFT_NOT_FOUND" } : { kind: "loading" }));

  // 先看有没有待付款的单可以续接，再读草稿：被嵌着才读（顶层打开不显示预订内容）
  useEffect(() => {
    if (!inFrame || host === null || draft === null) return;
    let alive = true;
    const timer = setTimeout(() => alive && setLoad({ kind: "error", code: "LOAD_FAILED" }), DRAFT_TIMEOUT.ms);
    const run = async (): Promise<void> => {
      const held = embedOrderFor(draft);
      if (held !== null) {
        const pending = await getSiteOrder(held).then(
          (envelope) => envelope.order.status === "pending_payment",
          () => false,
        );
        if (!alive) return;
        if (pending) {
          void navigate({ pathname: EMBED_BOOK_ORDER_PATH, search: embedSearch(window.location.search) }, { replace: true, state: { orderToken: held } });
          return;
        }
        // 已付款、已取消或读不到：立即删掉，照常预订（共用电脑上下一个人不会看到上一张单）
        forgetEmbedOrder();
      }
      try {
        const found = await getSiteBookingDraft(draft, key === null ? undefined : { key, host });
        if (alive) setLoad({ kind: "ready", draft: found.draft, sourceMatches: found.source_matches === true });
      } catch (err) {
        if (alive) setLoad({ kind: "error", code: err instanceof ApiError && err.status === 404 ? "DRAFT_NOT_FOUND" : "LOAD_FAILED" });
      }
    };
    void run().finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [inFrame, host, draft, key]);

  // 草稿有了结论就告诉宿主：先 ready（宿主据此取消 15 秒的后备；语言此时已跟着草稿定下来），读不出再发 error。各只发一次
  // 四步等 ready 发出去以后再挂：它一挂上就发 step，宿主要先收到 ready
  const reported = useRef(false);
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (load.kind === "loading" || reported.current || !inFrame || host === null) return;
    reported.current = true;
    announce(load.kind === "ready" ? load.draft.lang : null);
    if (load.kind === "error") send({ type: "error", code: load.code });
    else setLive(true);
  });

  const lastStep = useRef<BookingStep | null>(null);
  const shell = useMemo<BookingShell | null>(() => {
    if (load.kind !== "ready" || !live || draft === null) return null;
    const { draft: saved, sourceMatches } = load;
    const step = (name: BookingStep): void => {
      if (lastStep.current === name) return;
      lastStep.current = name;
      send({ type: "step", step: name });
    };
    return {
      title: t.title,
      frame: (body) => <div lang="zh-CN">{body}</div>,
      narrow: true,
      tiles: () => null,
      // 草稿已经在上面读过了：直接交给四步，不再读第二次
      readDraft: () => Promise.resolve({ draft: saved, sourceMatches }),
      placed: (created, go) => {
        // 到付款这一步的 step 由订单页读到「待付款」时发
        rememberEmbedOrder(draft, created.link.token);
        void go({ pathname: EMBED_BOOK_ORDER_PATH, search: embedSearch(window.location.search) }, { state: { orderToken: created.link.token, placed: true } });
      },
      stepShown: (number) => step(STEP_NAMES[number]),
    };
  }, [load, live, draft, send, t.title]);

  if (!inFrame || host === null) return <EmbedRefusal />;
  const siteLink = `/book/new${draft === null ? "" : `?draft=${encodeURIComponent(draft)}`}`;
  return (
    <>
      <EmbedHeader />
      {load.kind === "loading" && (
        <p role="status" aria-busy="true">
          {t.loading}
        </p>
      )}
      {load.kind === "error" && (
        <section className="embed-book__section" role="alert">
          <p>{load.code === "DRAFT_NOT_FOUND" ? t.expired : t.failed}</p>
          {load.code !== "DRAFT_NOT_FOUND" && (
            <p>
              <NewTabLink to={siteLink}>{t.goToSite}</NewTabLink>
            </p>
          )}
        </section>
      )}
      {shell !== null && (
        <BookingShellContext.Provider value={shell}>
          <BookNewPage />
        </BookingShellContext.Provider>
      )}
    </>
  );
}
