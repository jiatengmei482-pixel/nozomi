/**
 * 给还没有所属城市的机场建议城市（M1-09 加的功能，M1-11 改了排序依据）。纯函数。
 *
 * 只按「离得最近」建议，对大机场常常不对：羽田最近的是川崎，成田 80 公里内最近的是千叶，仁川最近的是仁川市——
 * 而它们服务的是东京、首尔。所以改成两步：
 *
 * 1. 数据源说了这个机场属于哪个城市（OurAirports 的 municipality，如羽田是 Tokyo）：
 *    同一个国家、150 公里以内、任何一种语言的名称和它对得上的城市排第一。
 * 2. 其余的候选是 80 公里以内的城市，按「人口 ÷ 距离的平方」从大到小排——大城市优先，但太远的大城市压不过近处的中等城市。
 *    距离不足 10 公里的按 10 公里算，免得机场恰好坐落在某个小城市里时那个小城市压过它真正服务的大城市。
 *
 * 仍然只是建议，要人确认。
 */
import { type LatLng, haversineMeters, isValidLatLng } from "./geo.ts";
import { CITY_SUGGESTION_LIMIT, CITY_SUGGESTION_MAX_KM, type LocalizedText } from "./master-data.ts";

/** 按名称对上的城市可以比一般候选远一些（公里）：名称已经是很强的依据，但同名的城市隔得太远多半不是同一个。 */
export const MUNICIPALITY_MATCH_MAX_KM = 150;
/** 距离不足这么多公里的按这么多算 */
export const CITY_SUGGESTION_MIN_KM = 10;
/** 不知道人口的城市（手工录入的）按这个数算：等于城市导入的默认人口门槛，即「平台认为值得建的城市」的下限 */
export const UNKNOWN_CITY_POPULATION = 300_000;

export type CitySuggestionReason = "municipality_match" | "nearest";

export interface CitySuggestionCandidate extends LatLng {
  name: LocalizedText;
  population: number | null;
}

export interface RankedCity<T> {
  item: T;
  meters: number;
  reason: CitySuggestionReason;
}

const NAME_SUFFIX = /[\s-]*(city|shi|si|gun)$/;

/**
 * 把地名变成用来比较的写法：去掉变音符号（Ōsaka → osaka）、大小写、空格和连字符，以及结尾的 City / -shi / -si / -gun。
 * 对不上任何字母数字和文字时返回空串。
 */
export function placeNameKey(text: string): string {
  const plain = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
  const stripped = plain.replace(NAME_SUFFIX, "");
  return (stripped === "" ? plain : stripped).replace(/[^\p{L}\p{N}]/gu, "");
}

/** 数据源的城市名一栏有时写了几个（`Tokyo / Narita`、`Seoul (Gangseo-gu)`）：拆开，每一个都算。 */
function municipalityKeys(municipality: string | null): Set<string> {
  const keys = new Set<string>();
  for (const part of (municipality ?? "").split(/[/,;()]/)) {
    const key = placeNameKey(part);
    if (key !== "") keys.add(key);
  }
  return keys;
}

/**
 * 给一个机场排出建议的城市，最多 `limit` 个，第一个就是首选。候选应当已经限定为同一个国家、启用中的城市。
 * 排序完全由输入决定：分数相同的近的在前，再相同的保持候选原来的先后。
 */
export function rankCitySuggestions<T extends CitySuggestionCandidate>(
  origin: LatLng & { municipality: string | null },
  candidates: readonly T[],
  limit: number = CITY_SUGGESTION_LIMIT,
): RankedCity<T>[] {
  if (!isValidLatLng(origin) || limit <= 0) return [];
  const measured = candidates.filter(isValidLatLng).map((item, index) => {
    const meters = haversineMeters(origin, item);
    const km = Math.max(meters / 1000, CITY_SUGGESTION_MIN_KM);
    const population = item.population ?? UNKNOWN_CITY_POPULATION;
    return { item, index, meters, population, score: population / (km * km) };
  });
  const keys = municipalityKeys(origin.municipality);
  const matched = measured
    .filter((entry) => entry.meters <= MUNICIPALITY_MATCH_MAX_KM * 1000 && Object.values(entry.item.name).some((name) => keys.has(placeNameKey(name))))
    .sort((x, y) => y.population - x.population || x.meters - y.meters || x.index - y.index)[0];
  const nearby = measured
    .filter((entry) => entry !== matched && entry.meters <= CITY_SUGGESTION_MAX_KM * 1000)
    .sort((x, y) => y.score - x.score || x.meters - y.meters || x.index - y.index);
  const ranked: RankedCity<T>[] = [];
  if (matched) ranked.push({ item: matched.item, meters: matched.meters, reason: "municipality_match" });
  for (const entry of nearby) ranked.push({ item: entry.item, meters: entry.meters, reason: "nearest" });
  return ranked.slice(0, limit);
}
