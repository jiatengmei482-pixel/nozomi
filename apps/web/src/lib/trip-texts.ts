/**
 * 官网行程报价页 `/book/trip`（M9T-09，ADR 0101 第十三节）的固定文案，按键取。
 * 写法同 `checkout-texts.ts`、`itinerary-texts.ts`：中文必填；日文、英文暂时留空，取不到时退回中文，以后补译只改这里。
 * ADR 0101 第十三节文案表里的键（`trip.` 前缀去掉）按表原文；表里没有的（校验、加载、出错等）是本页补的。`{名字}` 是占位，由 `tripCopy` 按参数替换。
 */
export type TripLang = "zh" | "ja" | "en";

export type TripTextKey =
  // ADR 0101 第十三节文案表
  | "title"
  | "day"
  | "addDay"
  | "addStop"
  | "quote"
  | "plan.one_car"
  | "plan.daily_best"
  | "recommended"
  | "unquoted"
  | "manual.title"
  | "manual.cta"
  | "book"
  | "bookManual"
  // 页面
  | "documentTitle"
  | "intro"
  | "stepsLabel"
  | "step1"
  | "step2"
  | "stepCurrent"
  | "stepDone"
  | "stepTodo"
  | "back"
  | "loadingPage"
  | "pageFailed"
  | "retry"
  | "notOpenTitle"
  | "notOpenText"
  | "citiesFailed"
  | "noCitiesTitle"
  | "noCitiesText"
  | "tripSection"
  | "date"
  | "dateAuto"
  | "time"
  | "timeHint"
  | "idle"
  | "idleHint"
  | "start"
  | "stop"
  | "end"
  | "stay"
  | "stayPlaceholder"
  | "stayNone"
  | "lodging"
  | "lodgingHint"
  | "removeDay"
  | "removeStop"
  | "maxDays"
  | "maxStops"
  | "dayRemoved"
  | "mapTitle"
  | "mapAlt"
  | "mapFigure"
  | "mapEmpty"
  | "mapAside"
  // 校验
  | "error.date"
  | "error.time"
  | "error.start"
  | "error.end"
  | "error.stopPlace"
  | "error.stay"
  | "error.firstDayIdle"
  | "error.lastDayIdle"
  | "error.tooManyPlaces"
  | "error.summary"
  | "error.invalid"
  // 报价
  | "creating"
  | "quoting"
  | "resultSection"
  | "total"
  | "vehicleGroup"
  | "expired"
  | "requote"
  | "degraded"
  | "unquotedTitle"
  | "unquotedDay"
  | "unquotedWhole"
  | "notQuoted"
  | "manual.hint"
  | "editTrip"
  | "dayList"
  | "announce.plans"
  | "announce.none"
  // 出错
  | "failure.tooComplex"
  | "failure.notFound"
  | "failure.rateLimited"
  | "failure.rateLimitedSeconds"
  | "failure.rateLimitedMinutes"
  | "failure.quote"
  | "failure.create"
  | "failure.read"
  | "action.create"
  | "action.quote"
  | "action.read"
  | "action.cities"
  // 报不出的原因（`unquoted[].reason`）；没列的原因码用 `reason.other`
  | "reason.NO_OFFER"
  | "reason.NO_PRODUCT"
  | "reason.OUT_OF_SERVICE_AREA"
  | "reason.ROUTE_UNAVAILABLE"
  | "reason.ONE_CAR_NOT_AVAILABLE"
  | "reason.CROSS_CITY_ONE_CAR"
  | "reason.WORK_HOURS_EXCEEDED"
  | "reason.WORK_HOURS_HARD_LIMIT"
  | "reason.SECOND_DRIVER_PRICE_UNAVAILABLE"
  | "reason.LODGING_PRICE_UNAVAILABLE"
  | "reason.IDLE_DAY_PRICE_UNAVAILABLE"
  | "reason.FEE_PRICE_UNAVAILABLE"
  | "reason.ITINERARY_TOO_LONG"
  | "reason.LEAD_TIME_TOO_SHORT"
  | "reason.SOLD_OUT"
  | "reason.CAPACITY_EXCEEDED"
  | "reason.SERVICE_TIME_PASSED"
  | "reason.OUTSIDE_SERVICE_TIME"
  | "reason.WAYPOINT_NOT_PRICED"
  | "reason.ADDON_NOT_OFFERED"
  | "reason.other";

const ZH: Readonly<Record<TripTextKey, string>> = {
  title: "多日行程报价",
  day: "第 {n} 天",
  addDay: "加一天",
  addStop: "加一个地点",
  quote: "查看报价",
  "plan.one_car": "同一辆车跑完全程",
  "plan.daily_best": "每天选最划算的车",
  recommended: "推荐",
  unquoted: "这个方案暂时报不出：{reason}",
  "manual.title": "这个行程需要客服人工报价",
  "manual.cta": "转人工报价",
  book: "预订这个方案",
  bookManual: "提交预订，客服确认",

  documentTitle: "多日行程报价 · NOZOMI 用车",
  intro: "按天填写每天的用车时间和要去的地点，我们按整个行程给出报价",
  stepsLabel: "行程报价步骤",
  step1: "填写行程",
  step2: "报价结果",
  stepCurrent: "第 {n} 步：{name}（当前）",
  stepDone: "第 {n} 步：{name}（已完成，回到这一步）",
  stepTodo: "第 {n} 步：{name}",
  back: "上一步",
  loadingPage: "正在打开行程报价页",
  pageFailed: "页面没有打开",
  retry: "重试",
  notOpenTitle: "暂未开放预订",
  notOpenText: "官网的在线预订还没有开放，请稍后再来。",
  citiesFailed: "城市列表没有读出来",
  noCitiesTitle: "暂时没有可预订的城市",
  noCitiesText: "现在还没有可以在线预订用车的城市，请稍后再来。",
  tripSection: "你的行程",
  date: "日期（当地）",
  dateAuto: "日期：{date}（接着前一天）",
  time: "第 {n} 天 上车时间（当地）",
  timeHint: "当天第一个地点的出发时间；之后各点的时间按路线自动推算",
  idle: "这天不用车",
  idleHint: "车和司机留在当地，第二天接着用",
  start: "第 {n} 天 上车地点",
  stop: "第 {n} 天 第 {m} 个地点",
  end: "第 {n} 天 最后下车地点",
  stay: "第 {n} 天 第 {m} 个地点 停留时长",
  stayPlaceholder: "请选择停留时长",
  stayNone: "不停留（只路过）",
  lodging: "当晚为司机安排住宿",
  lodgingHint: "您为司机提供当晚住宿时勾选，这一晚不收司机住宿费",
  removeDay: "删除第 {n} 天",
  removeStop: "删除第 {n} 天 第 {m} 个地点",
  maxDays: "最多 {max} 天，更长的行程请联系客服",
  maxStops: "每天最多加 {max} 个中间地点，更多请联系客服",
  dayRemoved: "已删除第 {n} 天",
  mapTitle: "行程地图",
  mapAlt: "第 {n} 天路线图：{chain}",
  mapFigure: "第 {n} 天路线图",
  mapEmpty: "选好地点后在这里显示每天的路线",
  mapAside: "每天的路线",

  "error.date": "请选择日期",
  "error.time": "请填写上车时间",
  "error.start": "请选择上车地点",
  "error.end": "请选择最后下车地点",
  "error.stopPlace": "请选择这个地点",
  "error.stay": "请选择停留时长",
  "error.firstDayIdle": "第一天要用车",
  "error.lastDayIdle": "最后一天要用车",
  "error.tooManyPlaces": "整个行程最多 {max} 个不同的地点，请减少一些地点，或联系客服",
  "error.summary": "行程还有没填好的地方，请按提示修改",
  "error.invalid": "行程里有填写不对的地方，请检查日期、时间和地点",

  creating: "正在保存行程",
  quoting: "正在按整个行程报价，地点多时要多等一会儿",
  resultSection: "报价结果",
  total: "合计",
  vehicleGroup: "车型：{name}",
  expired: "报价已过有效期，请重新报价",
  requote: "重新报价",
  degraded: "行程较长，后面几天按整天用车报价，没有再拆开比较",
  unquotedTitle: "报不出的方案",
  unquotedDay: "{plan}（第 {n} 天）：",
  unquotedWhole: "{plan}：",
  notQuoted: "这个行程还没有报价",
  "manual.hint": "客服会按您填的行程人工报价",
  editTrip: "修改行程",
  dayList: "每天的行程",
  "announce.plans": "报价已出来，共 {n} 个方案",
  "announce.none": "这次没有报出方案",

  "failure.tooComplex": "这个行程太复杂，暂时没法在线报价。",
  "failure.notFound": "这个行程已过期或不存在，请重新填写。",
  "failure.rateLimited": "操作太频繁了，请稍后再试。",
  "failure.rateLimitedSeconds": "操作太频繁了，请 {n} 秒后再试。",
  "failure.rateLimitedMinutes": "操作太频繁了，请 {n} 分钟后再试。",
  "failure.quote": "报价没有查出来",
  "failure.create": "行程没有保存",
  "failure.read": "行程没有读出来",
  "action.create": "保存行程",
  "action.quote": "报价",
  "action.read": "读取行程",
  "action.cities": "读取城市",

  // 原因前面已经写了「方案（第 N 天）：」或「方案：」（整个方案），这里的说法不再说「这一天」，两种都读得通
  "reason.NO_OFFER": "没有可用的车",
  "reason.NO_PRODUCT": "这里暂时没有在线报价",
  "reason.OUT_OF_SERVICE_AREA": "有地点不在服务范围内",
  "reason.ROUTE_UNAVAILABLE": "路线暂时算不出来",
  "reason.ONE_CAR_NOT_AVAILABLE": "没有一辆车能跑完全部日子",
  "reason.CROSS_CITY_ONE_CAR": "行程跨了城市，暂时不能同一辆车跑完",
  "reason.WORK_HOURS_EXCEEDED": "用车时间太长，司机工作时间不够",
  "reason.WORK_HOURS_HARD_LIMIT": "用车时间太长，请拆成两天或减少地点",
  "reason.SECOND_DRIVER_PRICE_UNAVAILABLE": "需要第二位司机，暂时报不出价",
  "reason.LODGING_PRICE_UNAVAILABLE": "司机住宿费暂时报不出",
  "reason.IDLE_DAY_PRICE_UNAVAILABLE": "不用车那天的停驻费暂时报不出",
  "reason.FEE_PRICE_UNAVAILABLE": "部分费用暂时报不出",
  "reason.ITINERARY_TOO_LONG": "行程太长",
  "reason.LEAD_TIME_TOO_SHORT": "离用车时间太近，来不及安排",
  "reason.SOLD_OUT": "车已经订满",
  "reason.CAPACITY_EXCEEDED": "人数或行李超出了可选车型能坐、能装的范围",
  "reason.SERVICE_TIME_PASSED": "用车时间已经过了",
  "reason.OUTSIDE_SERVICE_TIME": "用车时间不在服务时间内",
  "reason.WAYPOINT_NOT_PRICED": "途经的地点暂时报不出价",
  "reason.ADDON_NOT_OFFERED": "所选的附加服务暂时不能提供",
  "reason.other": "暂时没有合适的车",
};

export const TRIP_TEXTS: Readonly<Record<TripLang, Partial<Record<TripTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

export function tripCopy(key: TripTextKey, params: Readonly<Record<string, string | number>> = {}, lang: TripLang = "zh"): string {
  const template = TRIP_TEXTS[lang][key] || ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/** 报不出的原因码 → 文案键；没列的原因用 `reason.other`（服务端可能带回引擎的其他原因码） */
export function tripReasonKey(reason: string): TripTextKey {
  const key = `reason.${reason}`;
  return Object.hasOwn(ZH, key) ? (key as TripTextKey) : "reason.other";
}
