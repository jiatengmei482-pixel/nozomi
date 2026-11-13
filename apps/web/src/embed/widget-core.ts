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

/** 点「查询价格」前的检查（服务端会按同一套规则再查一次） */
export function formProblems(form: WidgetForm): FormProblem[] {
  const problems: FormProblem[] = [];
  if (form.pickup === null) problems.push("pickup");
  if (form.dropoff === null) problems.push("dropoff");
  if (form.tab === "charter")
    form.waypoints.forEach((stop, index) => {
      if (stop.point === null) problems.push(`waypoint-${index}`);
      if (stop.stay === null || !STAY_OPTIONS.includes(stop.stay)) problems.push(`stay-${index}`);
    });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) problems.push("date");
  if (!/^\d{2}:\d{2}$/.test(form.time)) problems.push("time");
  return problems;
}

const trimName = (name: string): string => [...name.trim()].slice(0, 200).join("");
const point = (value: WidgetPoint): WidgetPoint => ({ name: trimName(value.name), lat: value.lat, lng: value.lng });

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
  | "transfer" | "charter" | "from" | "to" | "pickup" | "dropoff" | "waypoint" | "stay" | "addWaypoint" | "removeWaypoint" | "date" | "time" | "passengers" | "luggage"
  | "submit" | "submitting" | "placeOnly" | "pickPlace" | "pickStay" | "pickDate" | "pickTime" | "noMatch" | "searching" | "unavailable" | "goToSite"
  | "invalid" | "tooFast" | "busy" | "unreachable" | "packageNote" | "minutes" | "tabs" | "suggestions",
  string
>;

export const TEXTS: Readonly<Record<WidgetLang, Texts>> = {
  zh: {
    transfer: "区间", charter: "包车", from: "出发地", to: "目的地", pickup: "上车地点", dropoff: "下车地点", waypoint: "经停点", stay: "停留时长", addWaypoint: "添加经停点", removeWaypoint: "删除经停点",
    date: "日期", time: "时间", passengers: "乘客", luggage: "行李", submit: "查询价格", submitting: "正在跳转…", placeOnly: "只填地点，不要填姓名、电话。",
    pickPlace: "请从候选里选一个地点", pickStay: "请选择停留时长", pickDate: "请选择日期", pickTime: "请选择时间", noMatch: "没有找到，换个说法试试", searching: "正在查找…",
    unavailable: "预订组件暂时无法使用。请稍后刷新，或直接到主站预订。", goToSite: "到主站预订",
    invalid: "有几项填得不对，请检查后再试。", tooFast: "操作太频繁，请稍等一分钟再试。", busy: "暂时无法查询，请稍后再试或直接到主站预订。", unreachable: "暂时连不上，请稍后再试或直接到主站预订。",
    packageNote: "不填经停点时，到预订页选包车时长。", minutes: "分钟", tabs: "用车类型", suggestions: "的候选",
  },
  ja: {
    transfer: "区間", charter: "貸切", from: "出発地", to: "目的地", pickup: "乗車地", dropoff: "降車地", waypoint: "経由地", stay: "滞在時間", addWaypoint: "経由地を追加", removeWaypoint: "経由地を削除",
    date: "日付", time: "時刻", passengers: "人数", luggage: "荷物", submit: "料金を調べる", submitting: "移動しています…", placeOnly: "場所のみ入力してください（氏名・電話番号は不要です）。",
    pickPlace: "候補から場所を選んでください", pickStay: "滞在時間を選んでください", pickDate: "日付を選んでください", pickTime: "時刻を選んでください", noMatch: "見つかりませんでした。別の言葉でお試しください", searching: "検索しています…",
    unavailable: "予約フォームは現在ご利用いただけません。しばらくしてから再読み込みするか、本サイトでご予約ください。", goToSite: "本サイトで予約",
    invalid: "入力内容に誤りがあります。ご確認ください。", tooFast: "操作が多すぎます。1 分ほどおいてからお試しください。", busy: "ただいま混み合っています。しばらくしてからお試しいただくか、本サイトでご予約ください。", unreachable: "接続できませんでした。しばらくしてからお試しいただくか、本サイトでご予約ください。",
    packageNote: "経由地がない場合、貸切時間は予約ページで選びます。", minutes: "分", tabs: "ご利用の種類", suggestions: "の候補",
  },
  en: {
    transfer: "Transfer", charter: "Charter", from: "From", to: "To", pickup: "Pick-up", dropoff: "Drop-off", waypoint: "Stop", stay: "Stay", addWaypoint: "Add a stop", removeWaypoint: "Remove stop",
    date: "Date", time: "Time", passengers: "Passengers", luggage: "Luggage", submit: "See prices", submitting: "Redirecting…", placeOnly: "Enter a place only — no names or phone numbers.",
    pickPlace: "Choose a place from the list", pickStay: "Choose how long you stay", pickDate: "Choose a date", pickTime: "Choose a time", noMatch: "No matches. Try other words", searching: "Searching…",
    unavailable: "The booking form is unavailable right now. Please refresh later or book on our site.", goToSite: "Book on our site",
    invalid: "Some fields are not right. Please check and try again.", tooFast: "Too many attempts. Please wait a minute and try again.", busy: "We can't search right now. Please try again later or book on our site.", unreachable: "Can't connect right now. Please try again later or book on our site.",
    packageNote: "Without stops, you choose the charter hours on the booking page.", minutes: "min", tabs: "Service", suggestions: " suggestions",
  },
};

export const FAILURE_TEXT_KEY: Readonly<Record<DraftFailure, keyof Texts>> = { invalid: "invalid", too_fast: "tooFast", busy: "busy", unreachable: "unreachable" };
