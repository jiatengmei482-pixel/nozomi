/**
 * 嵌入组件的纯逻辑（M9E-03，ADR 0090 第四节）：init 参数、文案（中 / 日 / 英）、表单 → 预订草稿、失败时的说法。
 * 不依赖 DOM，单元测试直接测；widget.ts 只负责画界面和调接口。组件不询价、不下单、不显示价格。
 */

export type WidgetLang = "zh" | "ja" | "en";
export type WidgetService = "transfer" | "charter";
export const WIDGET_LANGS: readonly WidgetLang[] = ["zh", "ja", "en"];
export const WIDGET_SERVICES: readonly WidgetService[] = ["transfer", "charter"];
export const MAX_WAYPOINTS = 10;
export const STAY_OPTIONS: readonly number[] = Array.from({ length: 16 }, (_, index) => (index + 1) * 30);
/** 脚本 gzip 后的大小预算（字节） */
export const WIDGET_GZIP_BUDGET = 60 * 1024;

export interface InitOptions {
  key: string;
  root: string | Element;
  lang?: string;
  services?: readonly string[];
  redirectUrl?: string;
  /** 外观（M9E-10）：card（默认）/ bar，见 resolveLayout */
  layout?: string;
  /** 主题（M9E-10）：都可选，见 resolveTheme */
  theme?: WidgetTheme;
}

/** init 参数里合作网站给的 lang、services：不认识的忽略，忽略后为空用后台设的默认值 */
export function resolveLang(given: unknown, fallback: WidgetLang): WidgetLang {
  return WIDGET_LANGS.includes(given as WidgetLang) ? (given as WidgetLang) : fallback;
}

export function resolveServices(given: unknown, fallback: readonly WidgetService[]): WidgetService[] {
  if (!Array.isArray(given)) return [...fallback];
  const known = given.filter((value, index): value is WidgetService => WIDGET_SERVICES.includes(value as WidgetService) && given.indexOf(value) === index);
  return known.length > 0 ? known : [...fallback];
}

export interface WidgetPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface WidgetForm {
  tab: WidgetService;
  pickup: WidgetPoint | null;
  dropoff: WidgetPoint | null;
  waypoints: { point: WidgetPoint | null; stay: number | null }[];
  date: string;
  time: string;
  passengers: number;
  luggage: number;
}

export type FormProblem = "pickup" | "dropoff" | "date" | "time" | `waypoint-${number}` | `stay-${number}`;

/** 点「查看价格」前的检查（服务端会按同一套规则再查一次） */
export function formProblems(form: WidgetForm): FormProblem[] {
  const problems: FormProblem[] = [];
  const unnamed = (point: WidgetPoint | null): boolean => point === null || trimName(point.name) === "";
  if (unnamed(form.pickup)) problems.push("pickup");
  if (unnamed(form.dropoff)) problems.push("dropoff");
  if (form.tab === "charter")
    form.waypoints.forEach((stop, index) => {
      if (unnamed(stop.point)) problems.push(`waypoint-${index}`);
      if (stop.stay === null || !STAY_OPTIONS.includes(stop.stay)) problems.push(`stay-${index}`);
    });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) problems.push("date");
  if (!/^\d{2}:\d{2}$/.test(form.time)) problems.push("time");
  return problems;
}

/** 名称最多 200 个 UTF-16 单元（和主站询价同一种算法），按字截断，不切开 emoji */
export function trimName(name: string): string {
  let out = "";
  for (const char of name.trim()) {
    if (out.length + char.length > 200) break;
    out += char;
  }
  // 截断点落在空格上时结尾会留空格：主站要求名称首尾没有空格
  return out.trimEnd();
}
/** 坐标保留 7 位小数（约 1 厘米；主站只收这个精度） */
const coord = (value: number): number => Number(value.toFixed(7));
const point = (value: WidgetPoint): WidgetPoint => ({ name: trimName(value.name), lat: coord(value.lat), lng: coord(value.lng) });

/** 表单 → 预订条件 v1（ADR 0090 第二节第 2 小节）。调用前先确认 `formProblems` 为空 */
export function draftOf(form: WidgetForm, lang: WidgetLang): Record<string, unknown> {
  const charter = form.tab === "charter";
  return {
    v: 1,
    tab: form.tab,
    service_local: `${form.date}T${form.time}`,
    pickup: point(form.pickup as WidgetPoint),
    dropoff: point(form.dropoff as WidgetPoint),
    waypoints: charter ? form.waypoints.map((stop) => ({ ...point(stop.point as WidgetPoint), stay_minutes: stop.stay as number })) : [],
    // 包车不填经停点时，到主站预订页选包车时长（城市能订哪几档只有主站知道）
    package_hours: null,
    passengers: form.passengers,
    luggage: form.luggage,
    lang,
  };
}

/** 服务端 400 里的问题路径（`/draft/pickup/name`、`/draft/waypoints/2/stay_minutes`…）→ 组件里对应的那一项；对不上为 null */
export function problemOfIssuePath(path: string): FormProblem | "passengers" | "luggage" | null {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts[0] !== "draft") return null;
  const [field, index, sub] = parts.slice(1);
  if (field === "pickup" || field === "dropoff" || field === "passengers" || field === "luggage") return field;
  if (field === "service_local") return "date";
  if (field === "waypoints" && index !== undefined && /^\d+$/.test(index)) return sub === "stay_minutes" ? `stay-${Number(index)}` : `waypoint-${Number(index)}`;
  return null;
}

/** 建草稿失败时组件里显示哪一句（ADR 0090 第四节）。`status` 为 null 是读不出的失败（网络错误或被拒的 403） */
export type DraftFailure = "invalid" | "too_fast" | "busy" | "unreachable";
export function draftFailureOf(status: number | null, code: string | null): DraftFailure {
  if (status === 400) return "invalid";
  if (status === 429) return code === "EMBED_DRAFT_LIMIT" ? "busy" : "too_fast";
  return "unreachable";
}

/** 默认日期：明天（合作网站访客本机的日期；主站会按城市当地时间再核） */
export function tomorrow(now: Date): string {
  const next = new Date(now.getTime() + 86_400_000);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

type Texts = Record<
  | "transferSub" | "charterSub" | "when" | "placeholder" | "swap" | "guests" | "decPassengers" | "incPassengers" | "decLuggage" | "incLuggage" | "done"
  | "transfer" | "charter" | "from" | "to" | "pickup" | "dropoff" | "waypoint" | "stay" | "addWaypoint" | "removeWaypoint" | "date" | "time" | "passengers" | "luggage"
  | "submit" | "submitting" | "placeOnly" | "pickPlace" | "pickStay" | "pickDate" | "pickTime" | "noMatch" | "searching" | "locating" | "locateFailed" | "unavailable" | "goToSite"
  | "invalid" | "tooFast" | "busy" | "unreachable" | "packageNote" | "minutes" | "tabs" | "suggestions",
  string
>;

export const TEXTS: Readonly<Record<WidgetLang, Texts>> = {
  zh: {
    transfer: "区间接送", charter: "按时包车", transferSub: "预约接送", charterSub: "专属司机", when: "用车日期和时间", from: "出发地", to: "目的地", pickup: "上车地点", dropoff: "下车地点", waypoint: "经停点", stay: "停留时长", addWaypoint: "添加经停点", removeWaypoint: "删除经停点",
    date: "日期", time: "时间", passengers: "乘客", luggage: "行李", submit: "查看价格", submitting: "正在跳转…", placeOnly: "只填地点，不要填姓名、电话。",
    pickPlace: "请从候选里选一个地点", pickStay: "请选择停留时长", pickDate: "请选择日期", pickTime: "请选择时间", noMatch: "没有找到，换个说法试试", searching: "正在查找…", locating: "正在取位置…", locateFailed: "取不到这个地点的位置，请重新选一个",
    unavailable: "预订组件暂时无法使用。请稍后刷新，或直接到主站预订。", goToSite: "到主站预订",
    invalid: "有几项填得不对，请检查后再试。", tooFast: "操作太频繁，请稍等一分钟再试。", busy: "暂时无法查询，请稍后再试或直接到主站预订。", unreachable: "暂时连不上，请稍后再试或直接到主站预订。",
    packageNote: "不填经停点时，到预订页选包车时长。", minutes: "分钟", tabs: "用车类型", suggestions: "的候选",
    placeholder: "地址、机场、酒店等", swap: "交换起点和终点", guests: "人数和行李", decPassengers: "减少乘客", incPassengers: "增加乘客", decLuggage: "减少行李", incLuggage: "增加行李", done: "完成",
  },
  ja: {
    transfer: "片道送迎", charter: "時間貸し", transferSub: "送迎を予約", charterSub: "専用チャーターを確認", when: "乗車日時", from: "出発地", to: "目的地", pickup: "乗車地", dropoff: "降車地", waypoint: "経由地", stay: "滞在時間", addWaypoint: "経由地を追加", removeWaypoint: "経由地を削除",
    date: "日付", time: "時刻", passengers: "人数", luggage: "荷物", submit: "料金を見る", submitting: "移動しています…", placeOnly: "場所のみ入力してください（氏名・電話番号は不要です）。",
    pickPlace: "候補から場所を選んでください", pickStay: "滞在時間を選んでください", pickDate: "日付を選んでください", pickTime: "時刻を選んでください", noMatch: "見つかりませんでした。別の言葉でお試しください", searching: "検索しています…", locating: "位置を確認しています…", locateFailed: "この場所の位置を取得できませんでした。もう一度選んでください",
    unavailable: "予約フォームは現在ご利用いただけません。しばらくしてから再読み込みするか、本サイトでご予約ください。", goToSite: "本サイトで予約",
    invalid: "入力内容に誤りがあります。ご確認ください。", tooFast: "操作が多すぎます。1 分ほどおいてからお試しください。", busy: "ただいま混み合っています。しばらくしてからお試しいただくか、本サイトでご予約ください。", unreachable: "接続できませんでした。しばらくしてからお試しいただくか、本サイトでご予約ください。",
    packageNote: "経由地がない場合、貸切時間は予約ページで選びます。", minutes: "分", tabs: "ご利用の種類", suggestions: "の候補",
    placeholder: "住所・空港・ホテルなど", swap: "出発地と目的地を入れ替える", guests: "人数と荷物", decPassengers: "人数を減らす", incPassengers: "人数を増やす", decLuggage: "荷物を減らす", incLuggage: "荷物を増やす", done: "完了",
  },
  en: {
    transfer: "Point to Point", charter: "Hourly", transferSub: "Book a transfer", charterSub: "Hire a driver", when: "Pickup date & time", from: "From", to: "To", pickup: "Pick-up", dropoff: "Drop-off", waypoint: "Stop", stay: "Stay", addWaypoint: "Add a stop", removeWaypoint: "Remove stop",
    date: "Date", time: "Time", passengers: "Passengers", luggage: "Luggage", submit: "See prices", submitting: "Redirecting…", placeOnly: "Enter a place only — no names or phone numbers.",
    pickPlace: "Choose a place from the list", pickStay: "Choose how long you stay", pickDate: "Choose a date", pickTime: "Choose a time", noMatch: "No matches. Try other words", searching: "Searching…", locating: "Finding the location…", locateFailed: "Couldn't get this place's location. Please choose again",
    unavailable: "The booking form is unavailable right now. Please refresh later or book on our site.", goToSite: "Book on our site",
    invalid: "Some fields are not right. Please check and try again.", tooFast: "Too many attempts. Please wait a minute and try again.", busy: "We can't search right now. Please try again later or book on our site.", unreachable: "Can't connect right now. Please try again later or book on our site.",
    packageNote: "Without stops, you choose the charter hours on the booking page.", minutes: "min", tabs: "Service", suggestions: " suggestions",
    placeholder: "Address, airport, hotel, etc.", swap: "Swap start and end", guests: "Passengers and luggage", decPassengers: "Fewer passengers", incPassengers: "More passengers", decLuggage: "Less luggage", incLuggage: "More luggage", done: "Done",
  },
};

export const FAILURE_TEXT_KEY: Readonly<Record<DraftFailure, keyof Texts>> = { invalid: "invalid", too_fast: "tooFast", busy: "busy", unreachable: "unreachable" };

/** 人数、行李加减器的范围（和原来的下拉一样：乘客 1–20、行李 0–20） */
export const GUEST_LIMITS = { passengers: { min: 1, max: 20 }, luggage: { min: 0, max: 20 } } as const;

/** 人数行李按钮上的摘要；short 是横条里用的短写法 */
export function guestsSummary(lang: WidgetLang, passengers: number, luggage: number, short = false): string {
  if (short) return lang === "en" ? `${passengers} pax · ${luggage} ${luggage === 1 ? "bag" : "bags"}` : lang === "ja" ? `${passengers}名 · ${luggage}個` : `${passengers} 人 · ${luggage} 件`;
  if (lang === "zh") return `${passengers} 位乘客 · ${luggage} 件行李`;
  if (lang === "ja") return `${passengers}名 · 荷物${luggage}個`;
  return `${passengers} ${passengers === 1 ? "passenger" : "passengers"} · ${luggage} ${luggage === 1 ? "bag" : "bags"}`;
}

/**
 * 两种外观（M9E-10）：card 竖向卡片（默认）、bar 横向搜索条。init 的 layout 不认识就用 card。
 * bar 只在组件容器（不是视口：宿主容器多宽不一定）不窄于 768 px 时用，窄了自动改成 card；量不到宽度（0）也按 card。
 */
export type WidgetLayout = "card" | "bar";
export const WIDGET_LAYOUTS: readonly WidgetLayout[] = ["card", "bar"];
export const BAR_MIN_WIDTH = 768;
export function resolveLayout(given: unknown): WidgetLayout {
  return WIDGET_LAYOUTS.includes(given as WidgetLayout) ? (given as WidgetLayout) : "card";
}
export function layoutFor(wanted: WidgetLayout, width: number): WidgetLayout {
  return wanted === "bar" && width >= BAR_MIN_WIDTH ? "bar" : "card";
}

/** init 的 theme 参数（M9E-10）：先只留接口，做成 CSS 变量；颜色写 #rgb / #rrggbb。跟随宿主网站的颜色以后再做 */
export interface WidgetTheme {
  primary?: string;
  accent?: string;
  radius?: number | string;
  fontFamily?: string;
}
export const RADIUS_MAX = 32;

/** 颜色只认 #rgb / #rrggbb（换成 #RRGGBB），别的写法为 null */
export function hexOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  const short = /^#([0-9A-F])([0-9A-F])([0-9A-F])$/.exec(text);
  if (short) return `#${short.slice(1).map((c) => c + c).join("")}`;
  return /^#[0-9A-F]{6}$/.test(text) ? text : null;
}

/** WCAG 2.x 相对亮度（和 docs/design/contrast-check.mjs 同一算法），参数是 #RRGGBB */
export function luminance(hex: string): number {
  return luminanceOf([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]);
}
function luminanceOf(channels: readonly [number, number, number]): number {
  const [r, g, b] = channels.map((value) => value / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/** 三种字色的相对亮度：白、深色（tokens.css --color-text-primary，即 widget-style.ts 的 --nzb-dark）、纯黑 */
const TONE_LUMINANCE = { light: 1, dark: luminanceOf([26, 31, 41]), black: 0 } as const;
/** 和白色的对比度（白色相对亮度为 1） */
export const contrastWithWhite = (hex: string): number => 1.05 / (luminance(hex) + 0.05);

/** 主色、点缀色上的字用白色（light）还是深色（dark，tokens.css --color-text-primary） */
export type TextTone = keyof typeof TONE_LUMINANCE;
/**
 * 底色上的字：白和深色里取对比度高的；高的那个也不到 4.5:1 时，退到纯黑或纯白里高的那个
 * （任何底色和纯黑、纯白之中至少一个能到 4.58:1，例如 #777777：白 4.48、深色 3.67、纯黑 4.69）。
 */
export function toneOn(hex: string): TextTone {
  const background = luminance(hex);
  const best = (tones: TextTone[]): TextTone => tones.reduce((a, b) => (ratio(background, TONE_LUMINANCE[b]) > ratio(background, TONE_LUMINANCE[a]) ? b : a));
  const pick = best(["light", "dark"]);
  return ratio(background, TONE_LUMINANCE[pick]) >= 4.5 ? pick : best(["light", "black"]);
}
/** 某个底色上用 toneOn 挑出来的字的对比度（测试和说明用） */
export const toneContrast = (hex: string): number => ratio(luminance(hex), TONE_LUMINANCE[toneOn(hex)]);

/** 合作网站给了、而且写对了的项；没给或写错的为 null，用样式表里的默认值（深蓝主色、浅米色点缀、圆角 24 px、系统字体，见 widget-style.ts） */
export interface ResolvedTheme {
  /** inkOnWhite：主色在白底上当文字够 4.5:1；markOnWhite：主色当白底上的标记条（选中标签的底条、顶条）够 3:1，不够时改用深色 */
  primary: { color: string; text: TextTone; inkOnWhite: boolean; markOnWhite: boolean } | null;
  accent: { color: string; text: TextTone } | null;
  radius: number | null;
  fontFamily: string | null;
}

/**
 * theme 的取值（M9E-10）。对比度兜底：主色、点缀色上的字按 toneOn 挑（白、深色里取高的，都不到 4.5:1 退到纯黑 / 纯白）；
 * 白底上要拿主色当文字（选中的标签字、链接、焦点环）时，主色和白底不够 4.5:1 就改用深色（inkOnWhite 为 false）；
 * 主色当白底上的标记条（选中标签的条）不够 3:1 时也改用深色（markOnWhite 为 false）。
 * radius 是卡片圆角（px，0–32），输入框取一半；fontFamily 不能含 ; { } < > \。
 */
export function resolveTheme(given: unknown): ResolvedTheme {
  const theme = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
  const primary = hexOf(theme["primary"]);
  const accent = hexOf(theme["accent"]);
  const rawRadius = theme["radius"];
  const radius = typeof rawRadius === "number" ? rawRadius : typeof rawRadius === "string" && /^\d+(\.\d+)?(px)?$/.test(rawRadius.trim()) ? Number.parseFloat(rawRadius) : Number.NaN;
  const font = theme["fontFamily"];
  return {
    primary: primary === null ? null : { color: primary, text: toneOn(primary), inkOnWhite: contrastWithWhite(primary) >= 4.5, markOnWhite: contrastWithWhite(primary) >= 3 },
    accent: accent === null ? null : { color: accent, text: toneOn(accent) },
    radius: Number.isFinite(radius) && radius >= 0 && radius <= RADIUS_MAX ? Math.round(radius) : null,
    fontFamily: typeof font === "string" && font.trim() !== "" && font.length <= 300 && !/[;{}<>\\]/.test(font) ? font.trim() : null,
  };
}

/**
 * 日期、时间按组件自己的语言显示（M9E-10），不按访客浏览器的语言：zh 11月15日周日 / 09:05，ja 11月15日(日) / 09:05，en Sun, Nov 15 / 9:05 AM（不是今年的日期加年份）。
 * 原生输入框只负责输入（键盘、读屏、手机的选择器都按系统的来）；写法不对（含 2 月 30 日这种不存在的日期）就原样显示。
 */
const LOCALES: Readonly<Record<WidgetLang, string>> = { zh: "zh-CN", ja: "ja-JP", en: "en-US" };
export function formatDate(lang: WidgetLang, value: string, now: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return value;
  // 今年的日期不写年份（框里放得下星期）；跨年的写上年份
  return new Intl.DateTimeFormat(LOCALES[lang], { ...(year === now.getFullYear() ? {} : { year: "numeric" }), month: "short", day: "numeric", weekday: "short" }).format(date);
}
export function formatTime(lang: WidgetLang, value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return value;
  return new Intl.DateTimeFormat(LOCALES[lang], { hour: lang === "en" ? "numeric" : "2-digit", minute: "2-digit", hourCycle: lang === "en" ? "h12" : "h23" }).format(new Date(2000, 0, 1, Number(match[1]), Number(match[2])));
}
