/**
 * 嵌入组件的界面（M9E-03，ADR 0090 第四节）；构建入口是 widget.ts，产出 `/embed/widget-v1.js`。合作网站这样放：
 *
 *   <div id="nozomi-booking"></div>
 *   <script src="https://<主站>/embed/widget-v1.js" defer></script>
 *   <script>NozomiBooking.init({ key: "nze_…", root: "#nozomi-booking" })</script>
 *
 * - 只调 `/embed/v1`（配置、地址提示、建草稿），一律 `credentials: "omit"`；不询价、不下单、不显示价格。
 * - 界面画在 Shadow DOM 里，和合作网站的样式互不影响；不加载任何第三方资源。
 * - 点「查询价格」先建预订草稿，成功后整页跳到主站 `/book/new?draft=<编号>`；失败在组件里提示、不跳转。
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
  draftFailureOf,
  draftOf,
  formProblems,
  resolveLang,
  resolveServices,
  tomorrow,
} from "./widget-core.ts";
import { tellDeveloper } from "./developer-notice.ts";
import { WIDGET_CSS } from "./widget-style.ts";
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
  done: Promise<void>;
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

const SCRIPT_ORIGIN = typeof document === "undefined" ? null : scriptOriginOf(document.currentScript);

let uid = 0;
const nextId = (prefix: string): string => `nzb-${prefix}-${++uid}`;
const sessionToken = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 12)}`);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  for (const child of children) node.append(child);
  return node;
}

async function getJson(url: string): Promise<{ status: number | null; body: any }> {
  try {
    const res = await fetch(url, { credentials: "omit", mode: "cors" });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: null, body: null };
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
  /** 点了「查询价格」、在等取坐标（按钮显示「正在取位置…」） */
  private waiting = false;
  private readonly go: (url: string) => void;

  constructor(host: Element, base: string, options: InitOptions, go: (url: string) => void = (url) => window.location.assign(url)) {
    this.go = go;
    this.base = base;
    this.options = options;
    this.shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.form = { tab: "transfer", pickup: null, dropoff: null, waypoints: [], date: tomorrow(new Date()), time: "10:00", passengers: 2, luggage: 1 };
    this.applyStyles();
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

  private applyStyles(): void {
    if ("adoptedStyleSheets" in this.shadow && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(WIDGET_CSS);
        this.shadow.adoptedStyleSheets = [sheet];
        return;
      } catch {
        // 退回 <style>
      }
    }
    this.shadow.append(el("style", {}, [WIDGET_CSS]));
  }

  private clear(): void {
    for (const node of [...this.shadow.childNodes]) if (!(node instanceof HTMLStyleElement)) node.remove();
  }

  async start(): Promise<void> {
    const config = await getJson(this.url("/embed/v1/config"));
    if (config.status !== 200 || config.body === null) {
      this.lang = resolveLang(this.options.lang, "ja");
      this.renderUnavailable();
      tellDeveloper("取不到组件配置。请确认本网站已加入嵌入码的白名单，嵌入码未停用。");
      return;
    }
    this.lang = resolveLang(this.options.lang, config.body.lang);
    this.services = resolveServices(this.options.services, config.body.services);
    this.form.tab = this.services[0] ?? "transfer";
    this.render();
  }

  private renderUnavailable(): void {
    this.clear();
    const link = el("a", { href: `${this.base}/book/new`, class: "nzb-link", rel: "noopener" }, [this.t.goToSite]);
    this.shadow.append(el("div", { class: "nzb", role: "status" }, [el("p", { class: "nzb-message" }, [this.t.unavailable]), link]));
  }

  private render(focus?: string): void {
    this.clear();
    const t = this.t;
    const root = el("div", { class: "nzb", lang: this.lang === "zh" ? "zh-CN" : this.lang });
    if (this.services.length > 1) {
      const tabs = el("div", { class: "nzb-tabs", role: "tablist", "aria-label": t.tabs });
      for (const service of this.services) {
        const tab = el("button", { type: "button", role: "tab", class: "nzb-tab", "aria-selected": String(this.form.tab === service), "data-tab": service }, [t[service]]);
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
      root.append(tabs);
    }
    const formEl = el("form", { class: "nzb-form", novalidate: "" });
    const charter = this.form.tab === "charter";
    formEl.append(this.placeField(charter ? t.pickup : t.from, "pickup", "pickup", this.form.pickup, (value) => (this.form.pickup = value)));
    if (charter) {
      this.form.waypoints.forEach((stop, index) => formEl.append(this.waypointRow(index, stop)));
      if (this.form.waypoints.length < MAX_WAYPOINTS) {
        const add = el("button", { type: "button", class: "nzb-secondary", "data-action": "add-waypoint", "data-focus": "add-waypoint" }, [t.addWaypoint]);
        add.addEventListener("click", () => {
          this.form.waypoints.push({ point: null, stay: null });
          this.render(`waypoint-${this.form.waypoints.length - 1}`);
        });
        formEl.append(add);
      }
      if (this.form.waypoints.length === 0) formEl.append(el("p", { class: "nzb-hint" }, [t.packageNote]));
    }
    formEl.append(this.placeField(charter ? t.dropoff : t.to, "dropoff", "dropoff", this.form.dropoff, (value) => (this.form.dropoff = value)));
    const row = el("div", { class: "nzb-row" });
    row.append(this.input(t.date, "date", "date", this.form.date, (value) => (this.form.date = value)));
    row.append(this.input(t.time, "time", "time", this.form.time, (value) => (this.form.time = value)));
    formEl.append(row);
    const counts = el("div", { class: "nzb-row" });
    counts.append(this.count(t.passengers, "passengers", 1, 60, this.form.passengers, (value) => (this.form.passengers = value)));
    counts.append(this.count(t.luggage, "luggage", 0, 60, this.form.luggage, (value) => (this.form.luggage = value)));
    formEl.append(counts);
    const message = el("p", { class: "nzb-error", role: "alert", "data-role": "message" });
    formEl.append(message);
    const submit = el("button", { type: "submit", class: "nzb-primary" }, [this.waiting ? t.locating : this.busy ? t.submitting : t.submit]);
    if (this.busy) submit.setAttribute("aria-disabled", "true");
    formEl.append(submit);
    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(message);
    });
    root.append(formEl);
    this.shadow.append(root);
    if (focus !== undefined) (this.shadow.querySelector(`[data-focus="${focus}"]`) as HTMLElement | null ?? this.shadow.querySelector(`[data-tab="${focus.replace("tab-", "")}"]`) as HTMLElement | null)?.focus();
  }

  private input(label: string, name: string, type: string, value: string, set: (value: string) => void): HTMLElement {
    const id = nextId(name);
    const input = el("input", { id, type, name, value, class: "nzb-input", "data-focus": name });
    input.addEventListener("input", () => set(input.value));
    return el("div", { class: "nzb-field" }, [el("label", { for: id, class: "nzb-label" }, [label]), input]);
  }

  private count(label: string, name: string, min: number, max: number, value: number, set: (value: number) => void): HTMLElement {
    const id = nextId(name);
    const select = el("select", { id, name, class: "nzb-input", "data-focus": name });
    for (let n = min; n <= Math.min(max, 20); n += 1) select.append(el("option", { value: String(n), ...(n === value ? { selected: "" } : {}) }, [String(n)]));
    select.addEventListener("change", () => set(Number(select.value)));
    return el("div", { class: "nzb-field" }, [el("label", { for: id, class: "nzb-label" }, [label]), select]);
  }

  private waypointRow(index: number, stop: WidgetForm["waypoints"][number]): HTMLElement {
    const t = this.t;
    const wrap = el("fieldset", { class: "nzb-waypoint" }, [el("legend", { class: "nzb-label" }, [`${t.waypoint} ${index + 1}`])]);
    wrap.append(this.placeField(`${t.waypoint} ${index + 1}`, `waypoint-${index}`, stop, stop.point, (value) => (stop.point = value), true));
    const id = nextId("stay");
    const select = el("select", { id, class: "nzb-input", "data-focus": `stay-${index}` });
    select.append(el("option", { value: "" }, [t.pickStay]));
    for (const minutes of STAY_OPTIONS) select.append(el("option", { value: String(minutes), ...(stop.stay === minutes ? { selected: "" } : {}) }, [`${minutes} ${t.minutes}`]));
    select.addEventListener("change", () => (stop.stay = select.value === "" ? null : Number(select.value)));
    wrap.append(el("div", { class: "nzb-field" }, [el("label", { for: id, class: "nzb-label" }, [`${t.waypoint} ${index + 1} ${t.stay}`]), select]));
    const remove = el("button", { type: "button", class: "nzb-secondary", "aria-label": `${t.removeWaypoint} ${index + 1}` }, [t.removeWaypoint]);
    remove.addEventListener("click", () => {
      this.locating.delete(stop);
      this.lostPlaces.delete(stop);
      this.form.waypoints.splice(index, 1);
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
    const hintId = `${id}-hint`;
    const input = el("input", { id, type: "text", class: "nzb-input", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", "aria-controls": listId, "aria-describedby": hintId, autocomplete: "off", "data-focus": name, value: value?.name ?? pending?.name ?? "" });
    const list = el("ul", { id: listId, role: "listbox", class: "nzb-list", "aria-label": `${label}${t.suggestions}` });
    // 谷歌署名（M9E-06）：在候选列表（listbox）外面、同一个弹出面板里，固定在面板底部（滚动的是候选列表），候选多了也不会被滚出可视区
    const attribution = el("p", { class: "nzb-google", ...GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hidden: "" }, [GOOGLE_MAPS_ATTRIBUTION]);
    const panel = el("div", { class: "nzb-panel", hidden: "" }, [list, attribution]);
    const status = el("p", { class: "nzb-hint", "aria-live": "polite" });
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
    // 谷歌候选没有坐标，选中后再取（M9E-08）：取的期间点「查询价格」会先等它；期间客人又打字或选了别的，旧的坐标回来不写回
    const choose = (item: Suggestion): void => {
      close();
      input.value = item.name;
      this.lostPlaces.delete(slot);
      const used = session;
      session = sessionToken();
      if (item.location !== null) {
        this.locating.delete(slot);
        status.textContent = "";
        set({ name: item.name, lat: item.location.lat, lng: item.location.lng });
        return;
      }
      set(null);
      status.textContent = t.locating;
      const job: Locating = { name: item.name, view: { status }, done: Promise.resolve() };
      job.done = getJson(this.url("/embed/v1/places/details", { id: item.id, session: used })).then((details) => {
        if (this.locating.get(slot) !== job) return;
        this.locating.delete(slot);
        const location: { lat: number; lng: number } | null = details.status === 200 ? (details.body?.place?.location ?? null) : null;
        if (location === null) {
          this.lostPlaces.add(slot);
          job.view.status.textContent = t.locateFailed;
          return;
        }
        job.view.status.textContent = "";
        set({ name: item.name, lat: location.lat, lng: location.lng });
      });
      this.locating.set(slot, job);
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
      if (this.locating.delete(slot)) status.textContent = "";
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
      input,
      el("p", { id: hintId, class: "nzb-hint" }, [t.placeOnly]),
      panel,
      status,
    ]);
    return field;
  }

  private async submit(message: HTMLElement): Promise<void> {
    if (this.busy) return;
    const t = this.t;
    // 还在取坐标（M9E-08）：按钮显示「正在取位置…」、不重复提交，等取完（期间又选了别的就再等那一次）再接着查
    if (this.locating.size > 0) {
      this.busy = this.waiting = true;
      this.shadow.querySelector(".nzb-primary")?.setAttribute("aria-disabled", "true");
      this.shadow.querySelector(".nzb-primary")?.replaceChildren(t.locating);
      while (this.locating.size > 0) await Promise.all([...this.locating.values()].map((job) => job.done));
      this.busy = this.waiting = false;
      this.shadow.querySelector(".nzb-primary")?.removeAttribute("aria-disabled");
      this.shadow.querySelector(".nzb-primary")?.replaceChildren(t.submit);
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
    const submit = this.shadow.querySelector(".nzb-primary");
    if (submit !== null) {
      submit.textContent = t.submitting;
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
        body: JSON.stringify({ draft: draftOf(this.form, this.lang), ...(typeof this.options.redirectUrl === "string" ? { return_url: this.options.redirectUrl } : {}) }),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = null;
    }
    // 跳到脚本所在的主站（不用应答里的 url：主站地址以加载脚本的那个为准）
    if (status === 201 && typeof body?.id === "string") {
      this.go(`${this.base}/book/new?draft=${encodeURIComponent(body.id)}`);
      return;
    }
    this.busy = false;
    if (submit !== null) {
      submit.textContent = t.submit;
      submit.removeAttribute("aria-disabled");
    }
    message.textContent = t[FAILURE_TEXT_KEY[draftFailureOf(status, typeof body?.error?.code === "string" ? body.error.code : null)]];
    // 400：标出服务端说的那一项，焦点移过去（ADR 0090 第四节）
    if (status === 400) {
      const issues: { path?: unknown }[] = Array.isArray(body?.error?.details?.issues) ? body.error.details.issues : [];
      const problem = issues.map((issue) => (typeof issue.path === "string" ? problemOfIssuePath(issue.path) : null)).find((found) => found !== null) ?? null;
      const target = problem === null ? null : (this.shadow.querySelector(`[data-focus="${problem}"]`) as HTMLElement | null);
      if (target !== null) {
        target.setAttribute("aria-invalid", "true");
        target.focus();
      }
    }
  }

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
  void new Widget(host, base, options, go).start();
}

/** 测试用：指定主站地址（正式环境取自脚本地址） */
export function initWithBase(base: string, options: InitOptions, go?: (url: string) => void): Promise<void> {
  const host = typeof options.root === "string" ? document.querySelector(options.root) : options.root;
  if (!(host instanceof Element)) return Promise.resolve();
  return new Widget(host, base, options, go).start();
}

