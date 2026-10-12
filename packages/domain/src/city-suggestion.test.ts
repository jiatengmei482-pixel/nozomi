import { test } from "node:test";
import assert from "node:assert/strict";
import { CITY_SUGGESTION_MIN_KM, MUNICIPALITY_MATCH_MAX_KM, UNKNOWN_CITY_POPULATION, placeNameKey, rankCitySuggestions } from "./city-suggestion.ts";
import { CITY_SUGGESTION_LIMIT, CITY_SUGGESTION_MAX_KM } from "./master-data.ts";

// 坐标和人口取自 GeoNames（2026-10-08 的 cities15000.txt），机场取自 OurAirports
const city = (id: string, lat: number, lng: number, population: number | null, name: Record<string, string> = { en: id }) => ({ id, lat, lng, population, name });
const TOKYO = city("tokyo", 35.6895, 139.69171, 9_733_276, { en: "Tokyo", ja: "東京" });
const KAWASAKI = city("kawasaki", 35.52056, 139.71722, 1_538_262, { en: "Kawasaki", ja: "川崎市" });
const YOKOHAMA = city("yokohama", 35.43333, 139.65, 3_777_491, { en: "Yokohama" });
const CHIBA = city("chiba", 35.6, 140.11667, 979_768, { en: "Chiba" });
const KASHIWA = city("kashiwa", 35.86224, 139.97732, 433_436, { en: "Kashiwa" });
const OSAKA = city("osaka", 34.69379, 135.50107, 2_753_862, { en: "Osaka", ja: "大阪市" });
const SAKAI = city("sakai", 34.58216, 135.46653, 826_161, { en: "Sakai" });
const WAKAYAMA = city("wakayama", 34.23333, 135.16667, 356_729, { en: "Wakayama" });
const NAGOYA = city("nagoya", 35.18147, 136.90641, 2_332_176, { en: "Nagoya" });
const YOKKAICHI = city("yokkaichi", 34.96667, 136.61667, 305_424, { en: "Yokkaichi" });
const KANTO = [KAWASAKI, CHIBA, KASHIWA, YOKOHAMA, TOKYO, OSAKA];
const HND = { lat: 35.549678, lng: 139.786958 };
const NRT = { lat: 35.76858, lng: 140.388714 };
const KIX = { lat: 34.42729, lng: 135.244 };
const NGO = { lat: 34.85839, lng: 136.8049 };

const ids = (ranked: { item: { id: string }; reason: string }[]): string[] => ranked.map((entry) => `${entry.item.id}:${entry.reason}`);

test("地名的比较写法：不分大小写、变音符号、空格和连字符，去掉结尾的 City / -shi / -si / -gun", () => {
  assert.equal(placeNameKey("Ōsaka"), "osaka");
  assert.equal(placeNameKey("  TOKYO "), "tokyo");
  assert.equal(placeNameKey("Jeju City"), "jeju");
  assert.equal(placeNameKey("Nara-shi"), "nara");
  assert.equal(placeNameKey("Goyang-si"), "goyang");
  assert.equal(placeNameKey("Yeongam-gun"), "yeongam");
  assert.equal(placeNameKey("Kitakyūshū"), placeNameKey("Kita-Kyushu"));
  assert.equal(placeNameKey("東京"), "東京");
  assert.equal(placeNameKey("City"), "city", "整个名字就是后缀时不去掉");
  assert.equal(placeNameKey(" - "), "");
  assert.notEqual(placeNameKey("Sakai"), placeNameKey("Sakaide"));
});

test("数据源说了机场属于哪个城市：名称对上的排第一，哪怕它不是最近的；其余按人口和距离", () => {
  // 羽田：最近的是川崎（7 公里），数据源说它属于 Tokyo
  const haneda = rankCitySuggestions({ ...HND, municipality: "Tokyo" }, KANTO);
  assert.deepEqual(ids(haneda), ["tokyo:municipality_match", "kawasaki:nearest", "yokohama:nearest"]);
  assert.ok(haneda[0] && haneda[0].meters > 16_000 && haneda[0].meters < 19_000, "距离仍是到城市中心的实际距离");
  // 任何一种语言的名称对上都算；写法的差别不影响
  assert.equal(ids(rankCitySuggestions({ ...HND, municipality: "東京" }, KANTO))[0], "tokyo:municipality_match");
  assert.equal(ids(rankCitySuggestions({ ...HND, municipality: " tōkyō city " }, [{ ...TOKYO, name: { en: "Tōkyō" } }, KAWASAKI]))[0], "tokyo:municipality_match");
  // 一栏里写了几个：拆开，每一个都算
  assert.equal(ids(rankCitySuggestions({ ...NRT, municipality: "Narita / Tokyo" }, KANTO))[0], "tokyo:municipality_match");
  assert.equal(ids(rankCitySuggestions({ ...HND, municipality: "Tokyo (Ota)" }, KANTO))[0], "tokyo:municipality_match");
  // 对上的城市不重复出现在后面
  assert.equal(haneda.filter((entry) => entry.item.id === "tokyo").length, 1);
});

test("名称对上的城市可以比 80 公里远，但超过 150 公里不算；同名的取人口多的，再取近的", () => {
  const far = city("far", HND.lat + 1.2, HND.lng, 5_000_000, { en: "Tokyo" });
  const tooFar = city("too-far", HND.lat + 1.5, HND.lng, 5_000_000, { en: "Tokyo" });
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, [far, KAWASAKI])), ["far:municipality_match", "kawasaki:nearest"]);
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, [tooFar, KAWASAKI])), ["kawasaki:nearest"]);
  assert.equal(MUNICIPALITY_MATCH_MAX_KM, 150);
  const small = city("small", 35.55, 139.8, 20_000, { en: "Tokyo" });
  assert.equal(ids(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, [small, TOKYO]))[0], "tokyo:municipality_match");
  const twin = { ...TOKYO, id: "twin", lat: 36.2 };
  assert.equal(ids(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, [twin, TOKYO]))[0], "tokyo:municipality_match", "人口一样取近的");
});

test("数据源没说、或说的城市库里没有：80 公里以内按「人口 ÷ 距离平方」，大城市优先", () => {
  // 成田：数据源说 Narita（库里没有这个城市）。最近的是千叶，但它服务的是东京
  assert.deepEqual(ids(rankCitySuggestions({ ...NRT, municipality: "Narita" }, KANTO)), ["tokyo:nearest", "chiba:nearest", "yokohama:nearest"]);
  assert.deepEqual(ids(rankCitySuggestions({ ...NRT, municipality: null }, KANTO)), ["tokyo:nearest", "chiba:nearest", "yokohama:nearest"]);
  // 中部机场：数据源说 Tokoname。最近的是四日市，建议名古屋
  assert.equal(ids(rankCitySuggestions({ ...NGO, municipality: "Tokoname" }, [YOKKAICHI, NAGOYA]))[0], "nagoya:nearest");
  // 关西机场不靠名称也是大阪排第一
  assert.equal(ids(rankCitySuggestions({ ...KIX, municipality: null }, [WAKAYAMA, SAKAI, OSAKA]))[0], "osaka:nearest");
  // 80 公里以外的不算，再大也不算
  assert.deepEqual(rankCitySuggestions({ ...NGO, municipality: null }, [TOKYO, OSAKA]), []);
  assert.equal(CITY_SUGGESTION_MAX_KM, 80);
});

test("边界：不足 10 公里按 10 公里算；不知道人口的按 30 万算；分数相同近的在前；最多 3 个；坐标不合法的忽略", () => {
  // 机场就在一个 40 万人的小城市里（1 公里），15 公里外有 200 万人的大城市：大城市在前
  const town = city("town", HND.lat + 0.009, HND.lng, 400_000);
  const metro = city("metro", HND.lat + 0.135, HND.lng, 2_000_000);
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: null }, [town, metro])), ["metro:nearest", "town:nearest"]);
  assert.equal(CITY_SUGGESTION_MIN_KM, 10);
  // 手工录入的城市没有人口：按 30 万算，所以同样距离时排在 50 万的后面、20 万的前面
  const manual = city("manual", HND.lat + 0.3, HND.lng, null);
  const bigger = city("bigger", HND.lat - 0.3, HND.lng, 500_000);
  const smaller = city("smaller", HND.lat, HND.lng + 0.37, 200_000);
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: null }, [smaller, manual, bigger])).map((entry) => entry.split(":")[0]), ["bigger", "manual", "smaller"]);
  assert.equal(UNKNOWN_CITY_POPULATION, 300_000);
  // 人口相同：近的在前；完全相同保持原来的先后
  const near = city("near", HND.lat + 0.2, HND.lng, 500_000);
  const same = { ...near, id: "same" };
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: null }, [bigger, near, same])).map((entry) => entry.split(":")[0]), ["near", "same", "bigger"]);
  assert.equal(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, KANTO).length, CITY_SUGGESTION_LIMIT);
  assert.equal(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, KANTO, 10).length, 5);
  assert.deepEqual(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, KANTO, 0), []);
  assert.deepEqual(rankCitySuggestions({ ...HND, municipality: "Tokyo" }, []), []);
  assert.deepEqual(rankCitySuggestions({ lat: 200, lng: 0, municipality: "Tokyo" }, KANTO), []);
  assert.deepEqual(ids(rankCitySuggestions({ ...HND, municipality: "Broken" }, [city("broken", 95, 139, 9_000_000, { en: "Broken" }), KAWASAKI])), ["kawasaki:nearest"]);
});
