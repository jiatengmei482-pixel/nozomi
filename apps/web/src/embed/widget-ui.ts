/**
 * 嵌入组件的界面（M9E-03，ADR 0090 第四节）；构建入口是 widget.ts，产出 `/embed/widget-v1.js`。合作网站这样放：
 *
 *   <div id="nozomi-booking"></div>
 *   <script src="https://<主站>/embed/widget-v1.js" defer></script>
 *   <script>NozomiBooking.init({ key: "nze_…", root: "#nozomi-booking" })</script>
 *
 * - 只调 `/embed/v1`（配置、地址提示、建草稿），一律 `credentials: "omit"`；不询价、不下单、不显示价格。
 * - 界面画在 Shadow DOM 里，和合作网站的样式互不影响；不加载任何第三方资源。
 * - 点「查看价格」先建预订草稿，成功后整页跳到主站 `/book/new?draft=<编号>`；失败在组件里提示、不跳转。
 *   传了合格的 `bookingUrl`（M9E-16，ADR 0095）时改跳合作网站自己的预订页 `bookingUrl?nzdraft=<编号>`，建草稿时带 `delivery: "host_page"`。
 * - 取配置失败（未授权和连不上在浏览器里分不出）：只显示「暂时无法使用」和主站链接。
 */
import {
  FAILURE_TEXT_KEY,
  problemOfIssuePath,
  type InitOptions,
  MAX_WAYPOINTS,
  STAY_OPTIONS,
  TEXTS,
  type WidgetForm,
  type WidgetLang,
  type WidgetPoint,
  type WidgetService,
  type ResolvedTheme,
  type WidgetLayout,
  type WantedLayout,
  GUEST_LIMITS,
  layoutFor,
  resolveAutoBreakpoint,
  resolveLayout,
  draftFailureOf,
  draftOf,
  formProblems,
  formatDate,
  formatTime,
  guestsSummary,
  resolveLang,
  resolveServices,
  resolveTheme,
  tomorrow,
} from "./widget-core.ts";
import { icon } from "./widget-icons.ts";
import { bookingUrlOf, withDraft } from "./booking-protocol.ts";
import { tellDeveloper } from "./developer-notice.ts";
import { WIDGET_CSS, themeCss } from "./widget-style.ts";
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hasGoogleSource } from "../lib/google-attribution.ts";

interface Suggestion {
  source: "platform" | "google";
  id: string;
  name: string;
  address: string | null;
  location: { lat: number; lng: number } | null;
}

/** 选了谷歌候选、正在取坐标的那个地址框（M9E-08）：name 是选中的候选（重画时框里照样显示）；重画后 view.status 换成新的提示行 */
interface Locating {
  name: string;
  view: { status: HTMLElement };
}

/** 组件脚本固定的路径：只认从这个路径加载的 <script> */
export const WIDGET_SCRIPT_PATH = "/embed/widget-v1.js";

/**
 * 主站的 origin：取自加载本脚本的那个 <script> 的地址。宿主页可以用 `<img name="currentScript" src="https://别的网站/…">`
 * 把 `document.currentScript` 换成别的元素（DOM clobbering），所以要确认它真的是 <script>、路径真的是组件脚本；
 * 拿不到就是 null（不退回宿主页自己的地址——那不是主站）。
 */
export function scriptOriginOf(candidate: unknown): string | null {
  if (typeof HTMLScriptElement === "undefined" || !(candidate instanceof HTMLScriptElement)) return null;
  try {
    const url = new URL(candidate.src);
    return (url.protocol === "https:" || url.protocol === "http:") && url.pathname === WIDGET_SCRIPT_PATH ? url.origin : null;
  } catch {
    return null;
  }
}

export const SCRIPT_ORIGIN = typeof document === "undefined" ? null : scriptOriginOf(document.currentScript);

let uid = 0;
const nextId = (prefix: string): string => `nzb-${prefix}-${++uid}`;
const sessionToken = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 12)}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

/** 取位置最多等这么久（M9E-08 审查）：一直不回就按「取不到这个地点的位置」处理，不让「查看价格」一直停在「正在取位置…」；测试里调短 */
export const LOCATE_TIMEOUT = { ms: 10_000 };

/** 超时用 AbortController + setTimeout（和 api/client.ts 的 send 一样）：Safari 15 / iOS 15 等老浏览器没有 AbortSignal.timeout（#220 复审） */
async function getJson(url: string, timeoutMs?: number): Promise<{ status: number | null; body: any }> {
  const abort = typeof AbortController === "undefined" || timeoutMs === undefined ? null : new AbortController();
  const timer = abort === null ? null : setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors", ...(abort === null ? {} : { signal: abort.signal }) });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

class Widget {
  private readonly shadow: ShadowRoot;
  private readonly base: string;
  private readonly options: InitOptions;
  private lang: WidgetLang = "ja";
  private services: WidgetService[] = ["transfer", "charter"];
  private form: WidgetForm;
  private busy = false;
  /**
   * 正在取坐标的地址框（M9E-08），键是地址框：出发地 / 目的地用名字，经停点用那一行的对象（删掉别的行、重画都不会认错）。
   * 客人在框里打字或选了别的候选就换掉 / 删掉这一项，旧的坐标回来时认出不是自己、不写回。
   */
  private readonly locating = new Map<unknown, Locating>();
  /** 取坐标失败的地址框：提示「取不到这个地点的位置，请重新选一个」 */
  private readonly lostPlaces = new Set<unknown>();
  /** 点了「查看价格」、在等取坐标（按钮显示「正在取位置…」） */
  private waiting = false;
  /** 提交在等取坐标时：正在取坐标的记录一有变化（取完、被换掉 / 删掉、切标签、删经停点）就叫醒它重新看 */
  private wake: (() => void) | null = null;
  private readonly go: (url: string) => void;
  /**
   * 外观（M9E-10、M9E-14）：wanted 是要的（init 传的 > 嵌入码后台设的 > auto，取到配置后才定，见 start），
   * layout 是按容器宽度实际用的（见 watchSize），width 是最近一次量到的容器宽度；主题在 init 时定
   */
  private readonly theme: ResolvedTheme;
  private wanted: WantedLayout;
  private readonly autoBreakpoint: number;
  private layout: WidgetLayout = "card";
  private width = 0;
  private root: HTMLElement | null = null;
  /** 底部隐私提示的 id（地址框的 aria-describedby） */
  private noteId = "";
  /** 人数行李弹层开着时：点到组件外面就关上 */
  private closeGuests: (() => void) | null = null;
  /** 挂在组件外面的监听（document、window、ResizeObserver），destroy 时解除 */
  private readonly cleanups: (() => void)[] = [];
  private destroyed = false;
  /** 草稿建好后跳去的合作网站预订页（M9E-16）；没传或不合格为 null（跳主站） */
  private readonly bookingTarget: URL | null;

  constructor(host: Element, base: string, options: InitOptions, go: (url: string) => void = (url) => window.location.assign(url)) {
    this.go = go;
    this.base = base;
    this.options = options;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.form = { tab: "transfer", pickup: null, dropoff: null, waypoints: [], date: tomorrow(new Date()), time: "10:00", passengers: 2, luggage: 1 };
    this.theme = resolveTheme(options.theme);
    this.wanted = resolveLayout(options.layout);
    this.autoBreakpoint = resolveAutoBreakpoint(options.autoBreakpoint);
    this.bookingTarget = options.bookingUrl === undefined || typeof location === "undefined" ? null : bookingUrlOf(options.bookingUrl, location.origin);
    if (options.bookingUrl !== undefined && this.bookingTarget === null) tellDeveloper("bookingUrl 不合格（要用 https、和当前页同一个域名和端口），已按没传处理：草稿建好后跳到主站。");
    this.applyStyles();
    this.watchSize(host);
    if (typeof document !== "undefined") {
      const outside = (event: Event): void => {
        if (this.closeGuests !== null && !event.composedPath().includes(host)) this.closeGuests();
      };
      document.addEventListener("pointerdown", outside);
      this.cleanups.push(() => document.removeEventListener("pointerdown", outside));
    }
  }

  /** 同一个容器上再 init 一次时，旧的那个先停掉：解除页面上的监听和 ResizeObserver，取配置晚回来也不再画（M9E-10 审查） */
  destroy(): void {
    this.destroyed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private get t() {
    return TEXTS[this.lang];
  }

  private url(path: string, params: Record<string, string> = {}): string {
    const url = new URL(path, this.base);
    url.searchParams.set("key", this.options.key);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url.href;
  }

  /** 样式表 = 固定的 WIDGET_CSS + 按 init 的 theme 生成的那几个 CSS 变量（themeCss，M9E-10） */
  private applyStyles(): void {
    const css = WIDGET_CSS + themeCss(this.theme);
    if ("adoptedStyleSheets" in this.shadow && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        this.shadow.adoptedStyleSheets = [sheet];
        return;
      } catch {
        // 退回 <style>
      }
    }
    this.shadow.append(el("style", {}, [css]));
  }

  private clear(): void {
    for (const node of [...this.shadow.childNodes]) if (!(node instanceof HTMLStyleElement)) node.remove();
  }

  async start(): Promise<void> {
    const config = await getJson(this.url("/embed/v1/config"));
    if (this.destroyed) return;
    if (config.status !== 200 || config.body === null) {
      this.lang = resolveLang(this.options.lang, "ja");
      this.renderUnavailable();
      tellDeveloper("取不到组件配置。请确认本网站已加入嵌入码的白名单，嵌入码未停用。");
      return;
    }
    this.lang = resolveLang(this.options.lang, config.body.lang);
    this.services = resolveServices(this.options.services, config.body.services);
    this.form.tab = this.services[0] ?? "transfer";
    // 取到配置之前表单还没画（只有样式表），所以第一次画出来就是最终的外观，不会先卡片再变横条
    this.wanted = resolveLayout(this.options.layout, config.body.layout);
    this.layout = layoutFor(this.wanted, this.width, this.autoBreakpoint);
    this.render();
  }

  private renderUnavailable(): void {
    this.clear();
    const link = el("a", { href: `${this.base}/book/new`, class: "nzb-link", rel: "noopener" }, [this.t.goToSite]);
    this.shadow.append(this.frame({ role: "status" }, [el("p", { class: "nzb-message" }, [this.t.unavailable]), link]));
  }

  /** 最外层（M9E-10）：.nzb-shell（卡片外面那层半透明浅灰底）里放 .nzb；外观写在 data-layout 上（主题在样式表里，见 applyStyles） */
  private frame(attrs: Record<string, string>, children: Node[]): HTMLElement {
    const root = el("div", { class: "nzb", ...attrs }, children);
    const shell = el("div", { class: "nzb-shell", "data-layout": this.layout }, [root]);
    this.root = shell;
    return shell;
  }

  /**
   * 按组件容器（宿主给的那个元素）的宽度定外观，不按视口（M9E-10、M9E-14，规则见 layoutFor）。
   * 两种外观是同一套 DOM，换外观只改 data-layout、不重画：已填的内容、焦点、打开的候选都不动。
   */
  private watchSize(host: Element): void {
    const apply = (width: number): void => {
      this.width = width;
      this.layout = layoutFor(this.wanted, width, this.autoBreakpoint);
      this.root?.setAttribute("data-layout", this.layout);
    };
    apply(host.getBoundingClientRect().width);
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver((entries) => apply(entries[entries.length - 1]?.contentRect.width ?? 0));
      observer.observe(host);
      this.cleanups.push(() => observer.disconnect());
    } else if (typeof window !== "undefined") {
      const resize = (): void => apply(host.getBoundingClientRect().width);
      window.addEventListener("resize", resize);
      this.cleanups.push(() => window.removeEventListener("resize", resize));
    }
  }

  /** 改正在取坐标的记录（job 为 null 是删掉），并叫醒在等的提交；返回删之前有没有这一项 */
  private setLocating(slot: unknown, job: Locating | null): boolean {
    const had = this.locating.has(slot);
    if (job === null) this.locating.delete(slot);
    else this.locating.set(slot, job);
    this.changed();
    return had;
  }

  private changed(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
    this.markReady();
  }

  /** 填好了（能提交）时按钮带 data-ready：横条里的圆形搜索按钮未填好是灰色、填好变主色（M9E-10） */
  private markReady(): void {
    const ready = formProblems(this.form).length === 0 && this.blockingLocates() === 0;
    this.shadow.querySelector(".nzb-primary")?.setAttribute("data-ready", String(ready));
    // 出发地、目的地正在取位置时不能交换（坐标回来要写回原来那一边），按钮标成不可用（M9E-10 审查）
    const swap = this.shadow.querySelector(".nzb-swap");
    if (this.locating.has("pickup") || this.locating.has("dropoff")) swap?.setAttribute("aria-disabled", "true");
    else swap?.removeAttribute("aria-disabled");
  }

  /** 提交按钮上的字：按钮里固定有一个放字的 span（横条里只显示放大镜，字给读屏） */
  private submitLabel(text: string): void {
    const label = this.shadow.querySelector(".nzb-primary .nzb-submit-text");
    if (label !== null) label.textContent = text;
  }

  /** 提交要等的取坐标：出发地、目的地，包车时再加现有的经停点（切到「区间」后不等经停点） */
  private blockingLocates(): number {
    return [...this.locating.keys()].filter((slot) => typeof slot === "string" || (this.form.tab === "charter" && this.form.waypoints.includes(slot as WidgetForm["waypoints"][number]))).length;
  }

  /**
   * 两种外观共用一套 DOM（M9E-10），只是样式不同。DOM 顺序就是键盘顺序：日期时间、上车地、交换、下车地、人数行李、（包车）经停点、提交；
   * 横条里提交按钮用网格放在第一行最右。隐私提示只在底部一行，地址框用 aria-describedby 关联。
   */
  private render(focus?: string): void {
    this.changed();
    this.clear();
    const t = this.t;
    const head: Node[] = [];
    if (this.services.length > 1) {
      const tabs = el("div", { class: "nzb-tabs", role: "tablist", "aria-label": t.tabs });
      for (const service of this.services) {
        const tab = el("button", { type: "button", role: "tab", class: "nzb-tab", "aria-selected": String(this.form.tab === service), "data-tab": service }, [
          el("span", { class: "nzb-tab-title" }, [t[service]]),
          el("span", { class: "nzb-tab-sub" }, [t[service === "transfer" ? "transferSub" : "charterSub"]]),
        ]);
        tab.addEventListener("click", () => {
          this.form.tab = service;
          this.render(`tab-${service}`);
        });
        tab.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          const index = this.services.indexOf(service);
          const next = this.services[(index + (event.key === "ArrowRight" ? 1 : this.services.length - 1)) % this.services.length] as WidgetService;
          this.form.tab = next;
          this.render(`tab-${next}`);
        });
        tabs.append(tab);
      }
      head.push(tabs);
    }
    this.noteId = nextId("note");
    const formEl = el("form", { class: "nzb-form", novalidate: "", "data-tab": this.form.tab });
    const charter = this.form.tab === "charter";
    formEl.append(this.when());
    formEl.append(this.placeField(charter ? t.pickup : t.from, "pickup", "pickup", this.form.pickup, (value) => (this.form.pickup = value)));
    const swap = el("button", { type: "button", class: "nzb-swap", "aria-label": t.swap, "data-action": "swap", "data-focus": "swap" }, [icon("swap", "nzb-swap-icon")]);
    swap.addEventListener("click", () => this.swap());
    formEl.append(swap);
    formEl.append(this.placeField(charter ? t.dropoff : t.to, "dropoff", "dropoff", this.form.dropoff, (value) => (this.form.dropoff = value)));
    formEl.append(this.guests());
    if (charter) {
      const extra = el("div", { class: "nzb-extra" });
      this.form.waypoints.forEach((stop, index) => extra.append(this.waypointRow(index, stop)));
      const line = el("div", { class: "nzb-extra-line" });
      if (this.form.waypoints.length < MAX_WAYPOINTS) {
        const add = el("button", { type: "button", class: "nzb-add", "data-action": "add-waypoint", "data-focus": "add-waypoint" }, [icon("plus", "nzb-add-icon"), t.addWaypoint]);
        add.addEventListener("click", () => {
          this.form.waypoints.push({ point: null, stay: null });
          this.render(`waypoint-${this.form.waypoints.length - 1}`);
        });
        line.append(add);
      }
      if (this.form.waypoints.length === 0) line.append(el("p", { class: "nzb-hint" }, [t.packageNote]));
      extra.append(line);
      formEl.append(extra);
    }
    const message = el("p", { class: "nzb-error", role: "alert", "data-role": "message" });
    formEl.append(message);
    const submit = el("button", { type: "submit", class: "nzb-primary" }, [icon("search", "nzb-search-icon"), el("span", { class: "nzb-submit-text" }, [this.waiting ? t.locating : this.busy ? t.submitting : t.submit])]);
    if (this.busy) submit.setAttribute("aria-disabled", "true");
    formEl.append(submit);
    formEl.append(el("p", { id: this.noteId, class: "nzb-hint nzb-note" }, [t.placeOnly]));
    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(message);
    });
    // 客人改了被标出错的那一项，就去掉标记（M9E-07）：读屏不再把改好的那项读成「无效」；同时更新横条按钮的「填好了」状态（M9E-10）
    const clearInvalid = (event: Event): void => {
      (event.target as Element).removeAttribute("aria-invalid");
      this.markReady();
    };
    formEl.addEventListener("input", clearInvalid);
    formEl.addEventListener("change", clearInvalid);
    this.shadow.append(this.frame({ lang: this.lang === "zh" ? "zh-CN" : this.lang, "data-view": "form" }, [...head, formEl]));
    this.markReady();
    if (focus !== undefined) (this.shadow.querySelector(`[data-focus="${focus}"]`) as HTMLElement | null ?? this.shadow.querySelector(`[data-tab="${focus.replace("tab-", "")}"]`) as HTMLElement | null)?.focus();
  }

  /** 交换起点和终点（M9E-10）。有一边正在取坐标时不换（坐标回来会写回原来那一边），按钮这时标成不可用（见 markReady） */
  private swap(): void {
    if (this.locating.has("pickup") || this.locating.has("dropoff")) return;
    [this.form.pickup, this.form.dropoff] = [this.form.dropoff, this.form.pickup];
    const lostPickup = this.lostPlaces.delete("pickup");
    if (this.lostPlaces.delete("dropoff")) this.lostPlaces.add("pickup");
    if (lostPickup) this.lostPlaces.add("dropoff");
    this.render("swap");
  }

  /**
   * 日期和时间合成一个控件（M9E-10）：外面一个框、一个小标题，里面是原生的日期、时间输入框（键盘、读屏、手机都按系统的来），
   * 显示的文字按组件的语言格式化（formatDate / formatTime），不按访客浏览器的语言；两个输入框各有自己的 label（不显示）。
   * 用键盘编辑时（:focus-visible）原生输入框显示出来，看得到在改哪一段；失焦后回到格式化的文字。
   */
  private when(): HTMLElement {
    const t = this.t;
    // 原生输入框叠在显示的文字上、平时透明：点哪里都打开系统的选择器，键盘、读屏、手机照常；看到的是按组件语言格式化的文字
    const part = (label: string, name: "date" | "time"): HTMLElement => {
      const id = nextId(name);
      const shown = el("span", { class: "nzb-shown", "aria-hidden": "true" });
      // 清空了某一段（值变成 ""）时显示「请选择日期 / 时间」，不留一块空白
      const show = (value: string): void => {
        shown.textContent = value === "" ? (name === "date" ? t.pickDate : t.pickTime) : (name === "date" ? formatDate : formatTime)(this.lang, value);
        shown.toggleAttribute("data-empty", value === "");
      };
      show(this.form[name]);
      const input = el("input", { id, type: name, name, value: this.form[name], class: "nzb-bare", "data-focus": name });
      input.addEventListener("input", () => {
        this.form[name] = input.value;
        show(input.value);
      });
      return el("span", { class: `nzb-part nzb-${name}` }, [el("label", { for: id, class: "nzb-visually-hidden" }, [label]), shown, input]);
    };
    // fieldset + legend：读屏进到日期、时间时先读小标题（M9E-10 审查）
    return el("fieldset", { class: "nzb-field nzb-when" }, [
      el("legend", { class: "nzb-label" }, [t.when]),
      el("div", { class: "nzb-box nzb-when-box" }, [icon("calendar"), part(t.date, "date"), el("span", { class: "nzb-sep", "aria-hidden": "true" }), part(t.time, "time")]),
    ]);
  }

  /**
   * 人数和行李（M9E-10）：主站选车那一步改不了人数行李（只在第一步），所以首屏保留，做成紧凑的加减器——
   * 一个按钮显示摘要，点开是两个加减器。按钮带 aria-expanded / aria-controls；弹层里 Esc 或「完成」关上并回到按钮，焦点离开或点到外面也关上；数字变化由 aria-live 读出。
   */
  private guests(): HTMLElement {
    const t = this.t;
    const id = nextId("guests");
    const labelId = `${id}-label`;
    const summaryId = `${id}-summary`;
    const summary = el("span", { id: summaryId, class: "nzb-trigger-text" }, [guestsSummary(this.lang, this.form.passengers, this.form.luggage)]);
    // 横条里地方小，显示短的摘要（读屏仍读长的那句，见 aria-labelledby）
    const short = el("span", { class: "nzb-trigger-short", "aria-hidden": "true" }, [guestsSummary(this.lang, this.form.passengers, this.form.luggage, true)]);
    const trigger = el("button", { type: "button", id, class: "nzb-box nzb-trigger", "aria-expanded": "false", "aria-controls": `${id}-pop`, "aria-labelledby": `${labelId} ${summaryId}`, "data-focus": "passengers", "data-action": "guests" }, [icon("user"), summary, short, icon("chevron", "nzb-chevron")]);
    const pop = el("div", { id: `${id}-pop`, class: "nzb-pop", role: "group", "aria-labelledby": labelId, hidden: "" });
    const field = el("div", { class: "nzb-field nzb-guests" }, [el("span", { id: labelId, class: "nzb-label" }, [t.guests]), trigger, pop]);
    const open = (show: boolean, refocus = false): void => {
      pop.hidden = !show;
      trigger.setAttribute("aria-expanded", String(show));
      if (show) (pop.querySelector("[data-step]:not([aria-disabled])") as HTMLElement | null)?.focus();
      if (refocus) trigger.focus();
      this.closeGuests = show ? () => open(false) : null;
    };
    const stepper = (kind: "passengers" | "luggage", less: string, more: string): HTMLElement => {
      const limits = GUEST_LIMITS[kind];
      const rowLabel = el("span", { id: `${id}-${kind}`, class: "nzb-step-label" }, [t[kind]]);
      const output = el("output", { class: "nzb-step-value", "aria-live": "polite", "data-value": kind }, [String(this.form[kind])]);
      const button = (sign: -1 | 1, name: string): HTMLButtonElement => {
        const node = el("button", { type: "button", class: "nzb-step", "aria-label": name, "data-step": `${kind}${sign > 0 ? "+" : "-"}` }, [icon(sign > 0 ? "plus" : "minus", "nzb-step-icon")]);
        node.addEventListener("click", () => {
          const next = this.form[kind] + sign;
          if (next < limits.min || next > limits.max) return;
          this.form[kind] = next;
          sync();
        });
        return node;
      };
      const minus = button(-1, less);
      const plus = button(1, more);
      // 到头的按钮用 aria-disabled（不用 disabled：按钮变成不可用时焦点会丢）
      const sync = (): void => {
        output.textContent = String(this.form[kind]);
        summary.textContent = guestsSummary(this.lang, this.form.passengers, this.form.luggage);
        short.textContent = guestsSummary(this.lang, this.form.passengers, this.form.luggage, true);
        const ends: [HTMLButtonElement, boolean][] = [[minus, this.form[kind] <= limits.min], [plus, this.form[kind] >= limits.max]];
        for (const [node, off] of ends) {
          if (off) node.setAttribute("aria-disabled", "true");
          else node.removeAttribute("aria-disabled");
        }
      };
      sync();
      return el("div", { class: "nzb-step-row", role: "group", "aria-labelledby": rowLabel.id }, [rowLabel, el("div", { class: "nzb-stepper" }, [minus, output, plus])]);
    };
    const done = el("button", { type: "button", class: "nzb-done" }, [t.done]);
    done.addEventListener("click", () => open(false, true));
    pop.append(stepper("passengers", t.decPassengers, t.incPassengers), stepper("luggage", t.decLuggage, t.incLuggage), done);
    trigger.addEventListener("click", () => open(trigger.getAttribute("aria-expanded") !== "true"));
    pop.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      open(false, true);
    });
    field.addEventListener("focusout", (event) => {
      if (!pop.hidden && !field.contains(event.relatedTarget as Node | null)) open(false);
    });
    return field;
  }

  private waypointRow(index: number, stop: WidgetForm["waypoints"][number]): HTMLElement {
    const t = this.t;
    const wrap = el("fieldset", { class: "nzb-waypoint" }, [el("legend", { class: "nzb-label" }, [`${t.waypoint} ${index + 1}`])]);
    wrap.append(this.placeField(`${t.waypoint} ${index + 1}`, `waypoint-${index}`, stop, stop.point, (value) => (stop.point = value), true));
    const id = nextId("stay");
    const select = el("select", { id, class: "nzb-box nzb-select", "data-focus": `stay-${index}` });
    select.append(el("option", { value: "" }, [t.pickStay]));
    for (const minutes of STAY_OPTIONS) select.append(el("option", { value: String(minutes), ...(stop.stay === minutes ? { selected: "" } : {}) }, [`${minutes} ${t.minutes}`]));
    select.addEventListener("change", () => (stop.stay = select.value === "" ? null : Number(select.value)));
    wrap.append(el("div", { class: "nzb-field nzb-stay" }, [el("label", { for: id, class: "nzb-visually-hidden" }, [`${t.waypoint} ${index + 1} ${t.stay}`]), el("div", { class: "nzb-control" }, [select, icon("chevron", "nzb-chevron")])]));
    const remove = el("button", { type: "button", class: "nzb-remove", "aria-label": `${t.removeWaypoint} ${index + 1}` }, [icon("close", "nzb-remove-icon")]);
    remove.addEventListener("click", () => {
      this.lostPlaces.delete(stop);
      this.form.waypoints.splice(index, 1);
      this.setLocating(stop, null);
      this.render("add-waypoint");
    });
    wrap.append(remove);
    return wrap;
  }

  /** 地址框：输入至少 2 个字、停顿 300 毫秒后经主站查候选；选中谷歌的候选后再取坐标（slot 见 locating） */
  private placeField(label: string, name: string, slot: unknown, value: WidgetPoint | null, set: (value: WidgetPoint | null) => void, hideLabel = false): HTMLElement {
    const t = this.t;
    const id = nextId(name);
    const pending = this.locating.get(slot);
    const listId = `${id}-list`;
    // 隐私提示只在表单底部写一次（M9E-10），每个地址框用 aria-describedby 关联它
    const input = el("input", { id, type: "text", class: "nzb-box nzb-place-input", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, "aria-describedby": this.noteId, autocomplete: "off", placeholder: t.placeholder, "data-focus": name, value: value?.name ?? pending?.name ?? "" });
    const list = el("ul", { id: listId, role: "listbox", class: "nzb-list", "aria-label": `${label}${t.suggestions}` });
    // 谷歌署名（M9E-06）：在候选列表（listbox）外面、同一个弹出面板里，固定在面板底部（滚动的是候选列表），候选多了也不会被滚出可视区
    const attribution = el("p", { class: "nzb-google", ...GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hidden: "" }, [GOOGLE_MAPS_ATTRIBUTION]);
    const panel = el("div", { class: "nzb-panel", hidden: "" }, [list, attribution]);
    const status = el("p", { class: "nzb-hint nzb-status", "aria-live": "polite" });
    if (pending !== undefined) {
      pending.view.status = status;
      status.textContent = t.locating;
    } else if (this.lostPlaces.has(slot)) status.textContent = t.locateFailed;
    let session = sessionToken();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let round = 0;
    const close = (): void => {
      panel.hidden = true;
      input.setAttribute("aria-expanded", "false");
    };
    // 谷歌候选没有坐标，选中后再取（M9E-08）：取的期间点「查看价格」会先等它；期间客人又打字或选了别的，旧的坐标回来不写回
    const choose = (item: Suggestion): void => {
      close();
      input.value = item.name;
      this.lostPlaces.delete(slot);
      const used = session;
      session = sessionToken();
      if (item.location !== null) {
        status.textContent = "";
        set({ name: item.name, lat: item.location.lat, lng: item.location.lng });
        this.setLocating(slot, null);
        return;
      }
      set(null);
      status.textContent = t.locating;
      const job: Locating = { name: item.name, view: { status } };
      void getJson(this.url("/embed/v1/places/details", { id: item.id, session: used }), LOCATE_TIMEOUT.ms).then((details) => {
        if (this.locating.get(slot) !== job) return;
        const location: { lat: number; lng: number } | null = details.status === 200 ? (details.body?.place?.location ?? null) : null;
        if (location === null) {
          this.lostPlaces.add(slot);
          job.view.status.textContent = t.locateFailed;
        } else {
          job.view.status.textContent = "";
          set({ name: item.name, lat: location.lat, lng: location.lng });
        }
        this.setLocating(slot, null);
      });
      this.setLocating(slot, job);
    };
    const search = async (query: string): Promise<void> => {
      const mine = ++round;
      status.textContent = t.searching;
      const found = await getJson(this.url("/embed/v1/places/autocomplete", { q: query, session }));
      if (mine !== round) return;
      const items: Suggestion[] = found.status === 200 && Array.isArray(found.body?.items) ? found.body.items : [];
      list.replaceChildren();
      status.textContent = items.length === 0 ? t.noMatch : "";
      items.forEach((item, index) => {
        const option = el("li", { role: "option", id: `${listId}-${index}`, class: "nzb-option", tabindex: "-1", "aria-selected": "false" }, [el("span", { class: "nzb-option-name" }, [item.name]), ...(item.address ? [el("span", { class: "nzb-option-address" }, [item.address])] : [])]);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => choose(item));
        option.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            choose(item);
          } else if (event.key === "ArrowDown") (option.nextElementSibling as HTMLElement | null)?.focus();
          else if (event.key === "ArrowUp") (option.previousElementSibling as HTMLElement | null ?? input).focus();
          else if (event.key === "Escape") {
            close();
            input.focus();
          }
        });
        list.append(option);
      });
      // 候选来自谷歌、又没有显示谷歌地图时，按谷歌地图平台的署名要求标明「Google Maps」（文字署名；不翻译、不改写）；和主站同一份写法（lib/google-attribution.ts，M9E-06）
      attribution.hidden = !hasGoogleSource(items);
      panel.hidden = items.length === 0;
      input.setAttribute("aria-expanded", String(items.length > 0));
    };
    input.addEventListener("input", () => {
      set(null);
      if (this.setLocating(slot, null)) status.textContent = "";
      if (this.lostPlaces.delete(slot)) status.textContent = "";
      if (timer !== null) clearTimeout(timer);
      const query = input.value.trim();
      if ([...query].length < 2) {
        close();
        return;
      }
      timer = setTimeout(() => void search(query), 300);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && !panel.hidden) {
        event.preventDefault();
        (list.querySelector('[role="option"]') as HTMLElement | null)?.focus();
      } else if (event.key === "Escape") close();
    });
    const field = el("div", { class: "nzb-field nzb-place", "data-field": name }, [
      el("label", { for: id, class: hideLabel ? "nzb-label nzb-visually-hidden" : "nzb-label" }, [label]),
      el("div", { class: "nzb-control" }, [icon("dot", name === "dropoff" ? "nzb-dot nzb-dot-end" : "nzb-dot"), input, panel]),
      status,
    ]);
    // 候选面板浮在下面的控件上（M9E-10），焦点离开这个地址框就收起
    field.addEventListener("focusout", (event) => {
      if (!field.contains(event.relatedTarget as Node | null)) close();
    });
    return field;
  }

  private async submit(message: HTMLElement): Promise<void> {
    if (this.busy) return;
    const t = this.t;
    // 还在取坐标（M9E-08）：按钮显示「正在取位置…」、不重复提交，等取完再接着查；记录一有变化就重新看，
    // 被换掉 / 删掉的旧请求、切到「区间」后的经停点不再挡着（取位置本身有超时，见 LOCATE_TIMEOUT）
    if (this.blockingLocates() > 0) {
      this.busy = this.waiting = true;
      this.shadow.querySelector(".nzb-primary")?.setAttribute("aria-disabled", "true");
      this.submitLabel(t.locating);
      while (this.blockingLocates() > 0) await new Promise<void>((resolve) => (this.wake = resolve));
      this.busy = this.waiting = false;
      this.shadow.querySelector(".nzb-primary")?.removeAttribute("aria-disabled");
      this.submitLabel(t.submit);
      message = this.shadow.querySelector<HTMLElement>('[data-role="message"]') ?? message;
    }
    const problems = formProblems(this.form);
    if (problems.length > 0) {
      const first = problems[0] as string;
      message.textContent = first.startsWith("stay") ? t.pickStay : first === "date" ? t.pickDate : first === "time" ? t.pickTime : this.lostPlaces.has(first.startsWith("waypoint-") ? this.form.waypoints[Number(first.slice(9))] : first) ? t.locateFailed : t.pickPlace;
      (this.shadow.querySelector(`[data-focus="${first}"]`) as HTMLElement | null)?.focus();
      return;
    }
    this.busy = true;
    message.textContent = "";
    // 上一次 400 标的那一项：这次以服务端新的结论为准
    for (const marked of this.shadow.querySelectorAll("[aria-invalid]")) marked.removeAttribute("aria-invalid");
    const submit = this.shadow.querySelector(".nzb-primary");
    if (submit !== null) {
      this.submitLabel(t.submitting);
      submit.setAttribute("aria-disabled", "true");
    }
    let status: number | null = null;
    let body: any = null;
    try {
      const res = await fetch(this.url("/embed/v1/booking-drafts"), {
        method: "POST",
        credentials: "omit",
        mode: "cors",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          draft: draftOf(this.form, this.lang),
          ...(typeof this.options.redirectUrl === "string" ? { return_url: this.options.redirectUrl } : {}),
          ...(this.bookingTarget === null ? {} : { delivery: "host_page" }),
        }),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = null;
    }
    // 跳到脚本所在的主站（不用应答里的 url：主站地址以加载脚本的那个为准）；传了合格的 bookingUrl 就跳合作网站自己的预订页
    if (status === 201 && typeof body?.id === "string") {
      this.go(this.bookingTarget === null ? `${this.base}/book/new?draft=${encodeURIComponent(body.id)}` : withDraft(this.bookingTarget, body.id));
      return;
    }
    this.busy = false;
    if (submit !== null) {
      this.submitLabel(t.submit);
      submit.removeAttribute("aria-disabled");
    }
    message.textContent = t[FAILURE_TEXT_KEY[draftFailureOf(status, typeof body?.error?.code === "string" ? body.error.code : null)]];
    // 400：标出服务端说的那一项，焦点移过去（ADR 0090 第四节）
    if (status === 400) {
      const issues: { path?: unknown }[] = Array.isArray(body?.error?.details?.issues) ? body.error.details.issues : [];
      const problem = issues.map((issue) => (typeof issue.path === "string" ? problemOfIssuePath(issue.path) : null)).find((found) => found !== null) ?? null;
      // 人数、行李在同一个按钮里（M9E-10）
      const target = problem === null ? null : (this.shadow.querySelector(`[data-focus="${problem === "luggage" ? "passengers" : problem}"]`) as HTMLElement | null);
      if (target !== null) {
        target.setAttribute("aria-invalid", "true");
        target.focus();
      }
    }
  }

}

/** 每个容器上现在的那个组件：同一个容器再 init 时先停掉旧的（M9E-10 审查） */
const mounted = new WeakMap<Element, Widget>();
/** 停掉某个容器上的组件（M9E-16：mountBooking 拆掉查价表单换成 iframe、重复调用时用） */
export function unmountWidget(host: Element): void {
  mounted.get(host)?.destroy();
  mounted.delete(host);
}
function mount(host: Element, base: string, options: InitOptions, go?: (url: string) => void): Widget {
  mounted.get(host)?.destroy();
  const widget = new Widget(host, base, options, go);
  mounted.set(host, widget);
  return widget;
}

export function init(options: InitOptions): void {
  initFrom(SCRIPT_ORIGIN, options);
}

/** init 的实际逻辑：主站地址拿不到（脚本不是从主站的组件路径加载的）就报错、不渲染 */
export function initFrom(base: string | null, options: InitOptions, go?: (url: string) => void): void {
  if (base === null) {
    tellDeveloper(`请直接从主站的 ${WIDGET_SCRIPT_PATH} 加载组件脚本（不要改名、转存或合并进别的文件）。`);
    return;
  }
  if (typeof options !== "object" || options === null || typeof options.key !== "string") {
    tellDeveloper("init 需要 key（嵌入码）和 root（容器）。");
    return;
  }
  const host = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
  if (!(host instanceof Element)) {
    tellDeveloper("init 找不到 root 指定的容器。");
    return;
  }
  void mount(host, base, options, go).start();
}

/** 测试用：指定主站地址（正式环境取自脚本地址） */
export function initWithBase(base: string, options: InitOptions, go?: (url: string) => void): Promise<void> {
  const host = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
  if (!(host instanceof Element)) return Promise.resolve();
  return mount(host, base, options, go).start();
}

