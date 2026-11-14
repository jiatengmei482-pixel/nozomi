/**
 * `NozomiBooking.mountBooking`（M9E-16，ADR 0095 第三节第 2 小节、第六节）：在合作网站自己的预订页（如 `/booking/`）里挂整个预订流程。
 *
 *   <div id="nozomi-booking-flow"></div>
 *   <script src="https://<主站>/embed/widget-v1.js" defer></script>
 *   <script>NozomiBooking.mountBooking({ key: "nze_…", root: "#nozomi-booking-flow", onEvent: function (e) { … } })</script>
 *
 * - 地址带 `?nzdraft=<草稿号>`（组件 `init({ bookingUrl })` 跳过来的）：草稿号存进本标签页 sessionStorage `nozomi.host-draft`（只存草稿号和时间，2 小时），
 *   再从地址栏去掉；在容器里建 iframe 打开主站 `/embed/book`。刷新时地址上没有 nzdraft，就从这个存储里取。
 * - 不带（存储里也没有）：在容器里画查价表单（= init，bookingUrl 是本页），客人点「查看价格」后整页跳回本页带 nzdraft。
 * - 15 秒没收到 iframe 的 ready（被 frame-ancestors 拒绝时浏览器不告诉父页面，只能靠超时）：拿掉 iframe，显示一句话和「到主站继续预订」（新标签页）。
 * - 收到 completed、草稿过期（error DRAFT_NOT_FOUND）时删掉存储里的草稿号；草稿过期还在 iframe 上方给「重新查询」，点了换回查价表单。
 * - postMessage：只认 `event.source === iframe.contentWindow && event.origin === 主站 origin`、频道号对得上的；发出时 targetOrigin 写主站 origin，从不用 "*"。
 *   收到的字段按白名单取值（booking-protocol.ts），step、completed、error 交给 onEvent，并在容器上派发 `nozomi:booking` 事件。
 * - iframe 不加 sandbox（会传给 Stripe 的付款表单和 3D 验证框架）；allow="payment"；referrerpolicy="no-referrer"；初始高度 720px，按 resize 调整。
 */
import { tellDeveloper } from "./developer-notice.ts";
import { forgetHostDraft, readHostDraft, writeHostDraft } from "./host-draft-store.ts";
import {
  type BookingEvent,
  type FrameMessage,
  embedFrameUrl,
  envelope,
  hostDraftRecord,
  hostEventOf,
  isDraftId,
  parseFrameMessage,
  readHostDraftRecord,
  withoutDraft,
} from "./booking-protocol.ts";
import { type InitOptions, type WidgetLang, WIDGET_LANGS, resolveLang } from "./widget-core.ts";
import { SCRIPT_ORIGIN, WIDGET_SCRIPT_PATH, initFrom, unmountWidget } from "./widget-ui.ts";
import { WIDGET_CSS } from "./widget-style.ts";

export interface MountBookingOptions extends Omit<InitOptions, "bookingUrl"> {
  /** 收到 iframe 的 step、completed、error 时调用 */
  onEvent?: (event: BookingEvent) => void;
  /** iframe 的无障碍标题；不传按语言用默认值 */
  title?: string;
}

/** 没收到 ready 最多等这么久就显示后备；测试里调短 */
export const READY_TIMEOUT = { ms: 15_000 };
const INITIAL_HEIGHT = 720;
/** 3D 验证弹窗打开时 iframe 至少这么高（Stripe：3DS2 的弹窗最小 400px 高） */
const MODAL_MIN_HEIGHT = 480;

type Texts = Record<"title" | "failed" | "goToSite" | "expired" | "restart", string>;
export const BOOKING_TEXTS: Readonly<Record<WidgetLang, Texts>> = {
  zh: { title: "NOZOMI 用车预订", failed: "预订页暂时打不开。请刷新，或到主站继续预订。", goToSite: "到主站继续预订", expired: "这次查询已过期。", restart: "重新查询" },
  ja: { title: "NOZOMI 配車予約", failed: "予約ページを表示できません。再読み込みするか、本サイトで予約を続けてください。", goToSite: "本サイトで予約を続ける", expired: "この検索の有効期限が切れました。", restart: "もう一度検索" },
  en: { title: "NOZOMI ride booking", failed: "The booking page can't be shown right now. Please refresh, or continue on our site.", goToSite: "Continue on our site", expired: "This search has expired.", restart: "Search again" },
};

/** 地址栏的 nzdraft 读出来就去掉（存进 sessionStorage）；没有就看存储。返回这次要用的草稿号 */
export function takeHostDraft(now: number = Date.now()): string | null {
  const raw = new URL(window.location.href).searchParams.get("nzdraft");
  if (raw !== null) {
    try {
      window.history.replaceState(window.history.state, "", withoutDraft(window.location.href));
    } catch {
      // 改不了地址也不影响这一次
    }
    if (isDraftId(raw)) {
      writeHostDraft(hostDraftRecord(raw, now));
      return raw;
    }
  }
  const stored = readHostDraftRecord(readHostDraft(), now);
  if (stored === "stale") {
    forgetHostDraft();
    return null;
  }
  return stored;
}

function channel(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

/** iframe 外面那一层的样式（Shadow DOM 里）：沿用组件的提示和链接样式，iframe 宽度跟容器、无边框 */
const FRAME_CSS = `${WIDGET_CSS}
.nzb-frame-host { display: block; }
.nzb-frame { display: block; width: 100%; border: 0; }
.nzb-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 12px; }
.nzb-notice .nzb-message { margin: 0; }
.nzb-notice[hidden] { display: none; }
.nzb-restart { all: initial; font: inherit; font-family: var(--nzb-font); font-size: 15px; font-weight: 600; color: var(--nzb-ink); text-decoration: underline; cursor: pointer; }
.nzb-restart:focus-visible, .nzb-link:focus-visible { outline: 3px solid var(--nzb-ink); outline-offset: 2px; border-radius: 4px; }
`;

class BookingMount {
  private readonly root: Element;
  private readonly base: string;
  private readonly origin: string;
  private readonly options: MountBookingOptions;
  private readonly lang: WidgetLang;
  private readonly cleanups: (() => void)[] = [];
  private part: HTMLElement | null = null;

  /** 整页跳转（测试里换成记录） */
  private readonly go: ((url: string) => void) | undefined;

  constructor(root: Element, base: string, options: MountBookingOptions, go?: (url: string) => void) {
    this.go = go;
    this.root = root;
    this.base = base;
    this.origin = new URL(base).origin;
    this.options = options;
    this.lang = resolveLang(options.lang, "ja");
  }

  private get t(): Texts {
    return BOOKING_TEXTS[this.lang];
  }

  start(): void {
    const draft = takeHostDraft();
    if (draft === null) this.renderForm();
    else this.renderFrame(draft);
  }

  /** 拆掉现在显示的部分（表单或 iframe）和挂在页面上的监听 */
  destroy(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    if (this.part !== null) {
      unmountWidget(this.part);
      this.part.remove();
      this.part = null;
    }
  }

  private renderForm(): void {
    this.destroy();
    const host = el("div", { "data-nozomi-booking": "form" });
    this.root.append(host);
    this.part = host;
    const { onEvent: _onEvent, title: _title, ...rest } = this.options;
    initFrom(this.base, { ...rest, root: host, bookingUrl: withoutDraft(window.location.href) }, this.go);
  }

  private emit(event: BookingEvent): void {
    const detail = { ...event };
    try {
      this.options.onEvent?.(detail);
    } catch {
      // 合作网站的回调出错不影响预订流程
    }
    this.root.dispatchEvent(new CustomEvent("nozomi:booking", { detail: { ...event } }));
  }

  private renderFrame(draft: string): void {
    this.destroy();
    const host = el("div", { "data-nozomi-booking": "frame" });
    this.root.append(host);
    this.part = host;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", {}, [FRAME_CSS]));
    const shell = el("div", { class: "nzb-shell nzb-frame-host" });
    shadow.append(shell);
    const notice = el("div", { class: "nzb-notice", role: "status" });
    notice.hidden = true;
    const ch = channel();
    const given = WIDGET_LANGS.includes(this.options.lang as WidgetLang) ? (this.options.lang as WidgetLang) : null;
    const iframe = el("iframe", {
      class: "nzb-frame",
      src: embedFrameUrl(this.base, { draft, key: this.options.key, host: window.location.origin, lang: given, ch }),
      title: typeof this.options.title === "string" && this.options.title.trim() !== "" ? this.options.title.trim() : this.t.title,
      allow: "payment",
      referrerpolicy: "no-referrer",
    });
    // 高度写在 iframe 的 height 属性上（不用脚本改样式；组件的样式表不给 iframe 设高度）
    iframe.setAttribute("height", String(INITIAL_HEIGHT));
    shell.append(notice, iframe);

    let ready = false;
    let height = INITIAL_HEIGHT;
    let modal = false;
    const post = (): void => iframe.contentWindow?.postMessage(envelope(ch, { type: "viewport", height: Math.max(1, Math.round(window.innerHeight)) }), this.origin);
    const timer = setTimeout(() => {
      if (ready) return;
      this.renderFailed(draft);
      tellDeveloper("预订页 15 秒内没有加载出来。请确认本网站已加入嵌入码的白名单、NOZOMI 运营已为这个嵌入码打开「允许整页嵌入」，并且本页没有再被别的网页嵌套。");
    }, READY_TIMEOUT.ms);
    this.cleanups.push(() => clearTimeout(timer));

    const handle = (message: FrameMessage): void => {
      switch (message.type) {
        case "ready":
          ready = true;
          clearTimeout(timer);
          post();
          return;
        case "resize":
          height = message.height;
          if (!modal) iframe.setAttribute("height", String(height));
          return;
        case "modal":
          modal = message.open;
          if (modal) {
            iframe.scrollIntoView({ block: "start" });
            iframe.setAttribute("height", String(Math.max(Math.round(window.innerHeight), MODAL_MIN_HEIGHT)));
          } else iframe.setAttribute("height", String(height));
          return;
        case "step":
          if (iframe.getBoundingClientRect().top < 0) iframe.scrollIntoView({ block: "start" });
          break;
        case "completed":
          forgetHostDraft();
          break;
        case "error":
          if (message.code === "DRAFT_NOT_FOUND") {
            forgetHostDraft();
            this.showRestart(notice);
          }
          break;
      }
      const event = hostEventOf(message);
      if (event !== null) this.emit(event);
    };
    const onMessage = (event: MessageEvent): void => {
      if (event.source === null || event.source !== iframe.contentWindow || event.origin !== this.origin) return;
      const message = parseFrameMessage(event.data, ch);
      if (message !== null) handle(message);
    };
    const onResize = (): void => {
      if (ready) post();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("resize", onResize);
    this.cleanups.push(() => window.removeEventListener("message", onMessage), () => window.removeEventListener("resize", onResize));
  }

  /** 草稿过期：iframe 上方「这次查询已过期。重新查询」，点了换回查价表单 */
  private showRestart(notice: HTMLElement): void {
    const button = el("button", { type: "button", class: "nzb-restart" }, [this.t.restart]);
    button.addEventListener("click", () => this.renderForm());
    notice.replaceChildren(el("p", { class: "nzb-message" }, [this.t.expired]), button);
    notice.hidden = false;
  }

  /** 嵌不进去：一句话 + 「到主站继续预订」（新标签页打开主站 /book/new?draft=） */
  private renderFailed(draft: string): void {
    this.destroy();
    const host = el("div", { "data-nozomi-booking": "fallback" });
    this.root.append(host);
    this.part = host;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", {}, [FRAME_CSS]));
    const link = el("a", { class: "nzb-link", href: `${this.base}/book/new?draft=${encodeURIComponent(draft)}`, target: "_blank", rel: "noopener noreferrer" }, [this.t.goToSite]);
    shadow.append(el("div", { class: "nzb-shell", "data-layout": "card" }, [el("div", { class: "nzb", role: "status" }, [el("p", { class: "nzb-message" }, [this.t.failed]), link])]));
  }
}

/** 每个容器上现在的那一个：同一个容器再调用时先拆掉旧的 iframe 和监听 */
const mounts = new WeakMap<Element, BookingMount>();

export function mountBooking(options: MountBookingOptions): void {
  mountBookingFrom(SCRIPT_ORIGIN, options);
}

/** mountBooking 的实际逻辑：主站地址拿不到（脚本不是从主站的组件路径加载的）就报错、不渲染。测试直接传主站地址和跳转函数 */
export function mountBookingFrom(base: string | null, options: MountBookingOptions, go?: (url: string) => void): void {
  if (base === null) {
    tellDeveloper(`请直接从主站的 ${WIDGET_SCRIPT_PATH} 加载组件脚本（不要改名、转存或合并进别的文件）。`);
    return;
  }
  if (typeof options !== "object" || options === null || typeof options.key !== "string") {
    tellDeveloper("mountBooking 需要 key（嵌入码）和 root（容器）。");
    return;
  }
  const root = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
  if (!(root instanceof Element)) {
    tellDeveloper("mountBooking 找不到 root 指定的容器。");
    return;
  }
  mounts.get(root)?.destroy();
  const mount = new BookingMount(root, base, options, go);
  mounts.set(root, mount);
  mount.start();
}
