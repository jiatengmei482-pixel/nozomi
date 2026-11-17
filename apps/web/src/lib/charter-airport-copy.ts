/**
 * 包车机场开始 / 机场结束套餐的固定文案（M9P-22，ADR 0098 第三节第 5 小节）。按 M11-01：新文案只做中文、走 i18n key；
 * M11-01 的公用 i18n 模块还没合并（#258），先在这里放一份只含中文的同名 key 表，M11 时并入公用模块（key 不变）。
 */
import type { SitePriceBreakdownItem } from "../api/site.ts";

export const CHARTER_AIRPORT_COPY = {
  "charter.scenario.airportStart": "{airport}接机 + {hours} 小时包车",
  "charter.scenario.airportEnd": "{hours} 小时包车 + {airport}送机",
  "book.charter.quickAirportStart": "机场接机开始",
  "book.charter.quickAirportEnd": "机场送机结束",
  "book.charter.pickTerminal": "选择航站楼",
  "book.charter.quickExit": "改填其他地点",
  "book.notes.flightHint": "如需司机知道航班号，请填在这里",
  "book.charter.airportTimingHint": "包车从预约的上车时间开始计时，没有免费等待。建议把上车时间定在航班落地后 60–90 分钟（国内航班约 60 分钟，国际航班约 90 分钟，留出入境和取行李的时间）；航班可能延误时请再多留一些，或下单前联系客服",
  "order.charterScenario.airportStart": "{airport}接机",
  "order.charterScenario.airportEnd": "{airport}送机",
  "order.charterScenario.own": "单独定价，已含{end}加价",
  "order.charterScenario.inherit": "继承普通套餐价",
  "order.charterScenario.line": "机场套餐：{what}（{how}）",
  "order.charterScenario.endPickup": "上车",
  "order.charterScenario.endDropoff": "下车",
  "order.charterScenario.included": "含在机场套餐里，不另加",
  // 供应商 / 运营后台：商品页「机场套餐」绑定（ADR 0098 第三节第 2、8 小节）
  "tenant.charterAirport.title": "机场套餐",
  "tenant.charterAirport.lead": "上车点在这里绑定的机场区域里 = 机场接机开始，下车点在里面 = 机场送机结束；价格页第四张表「机场套餐价」可以按机场单独定价。机场区域只用来判断上下车点在不在机场，要整块落在本商品的服务区域或上下车加价区域里。",
  "tenant.charterAirport.leadPlatform": "上车点在这些机场区域里 = 机场接机开始，下车点在里面 = 机场送机结束；机场套餐价见价格页第四张表。",
  "tenant.charterAirport.notMigrated": "迁移三层区域后可用",
  "tenant.charterAirport.group.airportStart": "机场开始（机场接机开始）",
  "tenant.charterAirport.group.airportEnd": "机场结束（机场送机结束）",
  "tenant.charterAirport.scenario": "场景",
  "tenant.charterAirport.status": "状态",
  "tenant.charterAirport.scenario.airportStart": "机场开始",
  "tenant.charterAirport.scenario.airportEnd": "机场结束",
  "tenant.charterAirport.airport": "机场",
  "tenant.charterAirport.area": "机场区域",
  "tenant.charterAirport.shortName": "中文简称（选填）",
  "tenant.charterAirport.shortNameHint": "前台名称里的机场名，如「成田机场」；不填用主数据的中文名，最多 {max} 字",
  "tenant.charterAirport.pickAirport": "选择机场",
  "tenant.charterAirport.pickArea": "选择机场区域",
  "tenant.charterAirport.disabledOption": "{name}（已停用）",
  "tenant.charterAirport.add": "添加机场",
  "tenant.charterAirport.remove": "删除",
  "tenant.charterAirport.removeLabel": "删除{group}第 {index} 个机场",
  "tenant.charterAirport.rowLabel": "{group}第 {index} 个机场的{field}",
  "tenant.charterAirport.save": "保存机场套餐",
  "tenant.charterAirport.saved": "机场套餐已保存",
  "tenant.charterAirport.unsaved": "机场套餐有未保存的修改",
  "tenant.charterAirport.empty": "还没有绑定机场",
  "tenant.charterAirport.ineffective": "机场区域或机场已停用，报价时这条不生效",
  "tenant.charterAirport.loadFailed": "机场套餐没有加载出来",
  "tenant.charterAirport.retry": "重试",
  "tenant.charterAirport.reload": "重新读取",
  "tenant.charterAirport.required.airport": "请选择机场",
  "tenant.charterAirport.required.area": "请选择机场区域",
  "tenant.charterAirport.shortNameTooLong": "中文简称最多 {max} 字",
  "tenant.charterAirport.tooMany": "一个场景最多绑 {max} 个机场",
  "tenant.charterAirport.duplicateAirport": "同一场景里这个机场绑了两次",
  "tenant.charterAirport.duplicateArea": "同一场景里一个机场区域只能绑一个机场",
  "tenant.charterAirport.notSaved": "没有保存。",
  "tenant.charterAirport.fixBelow": "有 {count} 处要改，见下面标红的地方。",
  "tenant.charterAirport.versionConflict": "别人刚改过这个商品，请点「重新读取」后再保存。",
  "tenant.charterAirport.pricesExist": "解绑的机场还有机场套餐价，请先在价格页删掉这些机场的机场套餐价，再解绑。",
  "tenant.charterAirport.layoutNotMigrated": "这个商品还没有迁移到三层区域，不能设机场套餐。",
  "tenant.charterAirport.platformEmpty": "没有绑定机场",
  // 价格页第四张表「机场套餐价」（ADR 0098 第三节第 3、8 小节）
  "tenant.charterAirport.prices.title": "机场套餐价",
  "tenant.charterAirport.prices.lead": "按场景 × 机场 × 车型组填，列是套餐时长。填了的格是单独价：替换普通套餐价，免掉这一端的上 / 下车加价；空格 = 继承（普通套餐价 + 这一端的加价），灰字是继承后的价。单独价高于继承价的格标黄。含公里、超公里、超时单价不填 = 同普通套餐。",
  "tenant.charterAirport.prices.import": "也可以用价格表导入：「机场场景」一列填「机场开始 / 机场结束」的行就是机场套餐价。",
  "tenant.charterAirport.prices.noBindings": "还没有绑定机场。先在「① 基础信息」的「机场套餐」里绑定机场，再回来填机场套餐价。",
  "tenant.charterAirport.prices.noPackages": "还没有套餐时长：先在上面「套餐价」里加套餐。",
  "tenant.charterAirport.prices.loadFailed": "机场套餐价要用的机场绑定没有加载出来",
  "tenant.charterAirport.prices.groupHeader": "车型组",
  "tenant.charterAirport.prices.hoursHeader": "{hours} 小时（{currency}）",
  "tenant.charterAirport.prices.rowLabel": "{title} · {scenario} · {airport} · {group} · {hours} 小时",
  "tenant.charterAirport.prices.groupRow": "{scenario} · {airport}（机场区域：{area}）",
  "tenant.charterAirport.prices.cellLabel": "{scenario} · {airport} · {group} · {hours} 小时 的单独价",
  "tenant.charterAirport.prices.unitLabel": "{scenario} · {airport} · {group} · {hours} 小时 的{field}",
  "tenant.charterAirport.prices.inherit": "继承：{parts}",
  "tenant.charterAirport.prices.inheritTotal": "继承 {amount}",
  "tenant.charterAirport.prices.part.normal": "普通 {amount}",
  "tenant.charterAirport.prices.part.pickup": "上车加价 {amount}",
  "tenant.charterAirport.prices.part.dropoff": "下车加价 {amount}",
  "tenant.charterAirport.prices.inheritUnknown": "继承：{reason}",
  "tenant.charterAirport.prices.reason.noNormal": "这个时长没有普通套餐价，空着报不出",
  "tenant.charterAirport.prices.reason.noLocation": "机场位置或区域图形没有取到，算不出继承价",
  "tenant.charterAirport.prices.reason.noSurcharge": "这一端没有能用的上 / 下车加价，空着报不出",
  "tenant.charterAirport.prices.higher": "高于继承价 {amount}",
  "tenant.charterAirport.prices.units": "单价",
  "tenant.charterAirport.prices.unitsOpen": "展开单价：{label}",
  "tenant.charterAirport.prices.unitsHint": "不填 = 同普通套餐",
  "tenant.charterAirport.prices.field.price": "单独价",
  "tenant.charterAirport.prices.field.km": "含公里",
  "tenant.charterAirport.prices.field.overKm": "超公里每公里",
  "tenant.charterAirport.prices.field.overtime": "超时每小时",
  "tenant.charterAirport.prices.priceRequired": "填了单价就要填单独价（单价只在单独定价时有用）",
  "tenant.charterAirport.prices.kmInvalid": "含公里请填 1–{max} 的整数",
  "tenant.charterAirport.prices.otherSegments": "另有 {count} 段其他日期的价格，用价格表导入导出修改",
  "tenant.charterAirport.prices.unsaved": "改过，未保存",
  "tenant.charterAirport.prices.deleted": "将删除，改回继承",
  "tenant.charterAirport.prices.enabled": "启用",
  "tenant.charterAirport.prices.disabled": "已停用",
  "tenant.charterAirport.prices.upcoming": "{date} 起生效",
  "tenant.charterAirport.prices.expired": "已过期",
  "tenant.charterAirport.prices.expiring": "{date} 到期",
  "tenant.charterAirport.prices.overlap": "和这一格别的日期的价格重叠",
  "tenant.charterAirport.prices.ineffective": "绑定已停用，报价时不生效",
} as const;

export type CharterAirportCopyKey = keyof typeof CHARTER_AIRPORT_COPY;

/** 按 key 取文案，`{name}` 换成给的值 */
export function charterAirportText(key: CharterAirportCopyKey, vars: Readonly<Record<string, string | number>> = {}): string {
  return CHARTER_AIRPORT_COPY[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

type Scenario = NonNullable<SitePriceBreakdownItem["scenario"]>;

/** 套餐行的场景名：「成田机场接机 + 5 小时包车」「5 小时包车 + 羽田机场送机」（官网明细、司机页共用） */
export function scenarioPackageLabel(scenario: Pick<Scenario, "kind" | "airport_name">, hours: number): string {
  return charterAirportText(scenario.kind === "airport_start" ? "charter.scenario.airportStart" : "charter.scenario.airportEnd", { airport: scenario.airport_name, hours });
}

/** 这一份报价匹配到的机场场景（套餐那一项带的）；没有为 null */
export function quoteScenario(quote: { price_breakdown?: readonly SitePriceBreakdownItem[] }): Scenario | null {
  return quote.price_breakdown?.find((item) => item.kind === "base")?.scenario ?? null;
}
