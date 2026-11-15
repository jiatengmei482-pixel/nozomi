import assert from "node:assert/strict";
import { test } from "node:test";
import type { LatLng } from "./geo.ts";
import { ITINERARY_MAP_RULES, ITINERARY_STOP_COLORS, displayStopNumber, isItineraryPointList, itineraryMapQuery, itineraryMarkers, itineraryPointsKey, legStopNumbers, markerIconUrl, stopNumbers } from "./itinerary-map.ts";
import { STATIC_MAP_PALETTES, STATIC_MAP_RULES, type StaticMapSize, decodePolyline, encodePolyline } from "./static-map.ts";

const SIZE: StaticMapSize = { theme: "light", width: 320, height: 200, scale: 2 };
const SITE = "https://book.example.test/";

/** 新宿附近往西排开的 n 个点 */
function line(n: number): LatLng[] {
  return Array.from({ length: n }, (_, i) => ({ lat: Number((35.6896 - i * 0.01).toFixed(4)), lng: Number((139.7006 - i * 0.02).toFixed(4)) }));
}

test("编号：上车 = 1，经停依次，下车 = 最后；0、1、10 个经停", () => {
  assert.deepEqual(
    stopNumbers(["新宿", "新宿"]).map((s) => [s.number, s.kind, s.stopSeq]),
    [
      [1, "pickup", null],
      [2, "dropoff", null],
    ],
  );
  assert.deepEqual(
    stopNumbers(["新宿", "河口湖", "新宿"]).map((s) => [s.number, s.kind, s.stopSeq, s.point]),
    [
      [1, "pickup", null, "新宿"],
      [2, "stop", 1, "河口湖"],
      [3, "dropoff", null, "新宿"],
    ],
  );
  const ten = stopNumbers(["上车", ...Array.from({ length: 10 }, (_, i) => `经停${i + 1}`), "下车"]);
  assert.equal(ten.length, 12);
  assert.deepEqual(ten.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(ten[0], { number: 1, kind: "pickup", stopSeq: null, point: "上车" });
  assert.deepEqual(ten[10], { number: 11, kind: "stop", stopSeq: 10, point: "经停10" });
  assert.deepEqual(ten[11], { number: 12, kind: "dropoff", stopSeq: null, point: "下车" });
  // 每个经停的显示编号 = stopSeq + 1（和 displayStopNumber 一致）
  for (const stop of ten.filter((s) => s.kind === "stop")) assert.equal(stop.number, displayStopNumber(stop.stopSeq as number));
});

test("编号：没有下车点（旧订单）时最后一个仍是经停", () => {
  assert.deepEqual(
    stopNumbers(["上车", "A", "B"], { hasDropoff: false }).map((s) => [s.number, s.kind, s.stopSeq]),
    [
      [1, "pickup", null],
      [2, "stop", 1],
      [3, "stop", 2],
    ],
  );
});

test("编号换算：经停序号 + 1；第 N 段是 N → N + 1；非法输入报错", () => {
  assert.equal(displayStopNumber(1), 2);
  assert.equal(displayStopNumber(10), 11);
  assert.deepEqual(legStopNumbers(1), [1, 2]);
  assert.deepEqual(legStopNumbers(11), [11, 12]);
  assert.throws(() => displayStopNumber(0), RangeError);
  assert.throws(() => displayStopNumber(1.5), RangeError);
  assert.throws(() => legStopNumbers(0), RangeError);
});

test("缓存键：每个点按 routeCacheKey 的规则取整到 3 位小数、有序；顺序不同键不同；点数 2–12", () => {
  const key = itineraryPointsKey([
    { lat: 35.68954, lng: 139.70056 },
    { lat: 35.4986, lng: 138.7686 },
    { lat: 35.68954, lng: 139.70056 },
  ]);
  assert.equal(key.key, "i1:35.690,139.701>35.499,138.769>35.690,139.701");
  assert.deepEqual(key.points[1], { lat: 35.499, lng: 138.769 });
  assert.equal(key.samePoint, false);
  // 139.7675 不因二进制误差被舍掉（同 routeCacheKey）
  assert.equal(itineraryPointsKey([{ lat: 35, lng: 139.7675 }, { lat: 36, lng: 139 }]).key, "i1:35.000,139.768>36.000,139.000");
  const [a, b, c] = line(3) as [LatLng, LatLng, LatLng];
  assert.notEqual(itineraryPointsKey([a, b, c]).key, itineraryPointsKey([a, c, b]).key);
  assert.equal(itineraryPointsKey([a, { lat: a.lat + 0.0001, lng: a.lng }]).samePoint, true);
  assert.throws(() => itineraryPointsKey([a]), RangeError);
  assert.throws(() => itineraryPointsKey(line(13)), RangeError);
  assert.throws(() => itineraryPointsKey([a, { lat: 91, lng: 0 }]), RangeError);
  assert.equal(isItineraryPointList(line(12)), true);
  assert.equal(isItineraryPointList(line(13)), false);
});

test("标记：1–9 用谷歌内置的单字符 label，上车、下车品牌色默认大小，经停中号浅一档", () => {
  const markers = itineraryMarkers(line(5), "light", SITE);
  assert.equal(markers.length, 5);
  assert.equal(markers[0], `color:0x${STATIC_MAP_PALETTES.light.route}|label:1|35.68960,139.70060`);
  assert.equal(markers[1], `size:mid|color:0x${ITINERARY_STOP_COLORS.light}|label:2|35.67960,139.68060`);
  assert.equal(markers[4], `color:0x${STATIC_MAP_PALETTES.light.route}|label:5|35.64960,139.62060`);
  const dark = itineraryMarkers(line(3), "dark", SITE);
  assert.match(dark[0] as string, new RegExp(`^color:0x${STATIC_MAP_PALETTES.dark.route}\\|label:1\\|`));
  assert.match(dark[1] as string, new RegExp(`^size:mid\\|color:0x${ITINERARY_STOP_COLORS.dark}\\|label:2\\|`));
});

test("标记：10–12 用本站公开路径上的自定义图标，最多 3 种（谷歌限 5 种）；1–9 都不用图标", () => {
  const markers = itineraryMarkers(line(12), "light", SITE);
  assert.equal(markers.length, 12);
  for (let n = 1; n <= 9; n++) {
    assert.match(markers[n - 1] as string, new RegExp(`\\|label:${n}\\|`));
    assert.doesNotMatch(markers[n - 1] as string, /icon:/);
  }
  assert.equal(markers[9], "anchor:center|icon:https://book.example.test/map-markers/10.png|35.59960,139.52060");
  assert.equal(markers[10], "anchor:center|icon:https://book.example.test/map-markers/11.png|35.58960,139.50060");
  assert.equal(markers[11], "anchor:center|icon:https://book.example.test/map-markers/12.png|35.57960,139.48060");
  const icons = new Set(markers.flatMap((m) => /icon:([^|]+)/.exec(m)?.[1] ?? []));
  assert.equal(icons.size, 3);
  assert.ok(icons.size <= 5);
  assert.equal(markerIconUrl("https://a.test", 10), "https://a.test/map-markers/10.png");
  assert.equal(ITINERARY_MAP_RULES.firstIconNumber, 10);
});

test("查询参数：逐段折线拼成一条品牌色路线，标记按编号，不含密钥", () => {
  const points = line(3);
  const legs = [encodePolyline([points[0] as LatLng, { lat: 35.685, lng: 139.69 }, points[1] as LatLng]), encodePolyline([points[1] as LatLng, points[2] as LatLng])];
  const query = itineraryMapQuery(legs, points, SIZE, SITE);
  assert.ok(query !== null);
  const params = new URLSearchParams(query);
  assert.equal(params.get("size"), "320x200");
  assert.equal(params.get("scale"), "2");
  assert.equal(params.has("key"), false);
  const path = params.get("path") as string;
  assert.match(path, new RegExp(`^color:0x${STATIC_MAP_PALETTES.light.route}ff\\|weight:5\\|enc:`));
  // 两段拼起来：接缝处的点只留一个
  assert.deepEqual(decodePolyline(path.split("enc:")[1] as string), [points[0], { lat: 35.685, lng: 139.69 }, points[1], points[2]]);
  assert.deepEqual(
    params.getAll("markers").map((m) => /label:(\d+)/.exec(m)?.[1]),
    ["1", "2", "3"],
  );
});

test("查询参数：一条整条路线的折线也能画；折线看不懂、点数或尺寸不对为 null", () => {
  const points = line(3);
  assert.ok(itineraryMapQuery([encodePolyline(points)], points, SIZE, SITE) !== null);
  assert.equal(itineraryMapQuery([], points, SIZE, SITE), null);
  assert.equal(itineraryMapQuery(["abc def"], points, SIZE, SITE), null);
  assert.equal(itineraryMapQuery([encodePolyline(points)], line(1), SIZE, SITE), null);
  assert.equal(itineraryMapQuery([encodePolyline(points)], line(13), SIZE, SITE), null);
  assert.equal(itineraryMapQuery([encodePolyline(points)], points, { ...SIZE, width: 100 }, SITE), null);
});

test("查询参数：网址太长时逐段抽稀，每段的头尾和标记点位不动", () => {
  const points = line(12);
  // 每段 1,500 个点的折线：不抽稀一定超过 15,000 个字符
  const legs = points.slice(1).map((to, i) => {
    const from = points[i] as LatLng;
    return encodePolyline(Array.from({ length: 1_500 }, (_, k) => ({ lat: from.lat + ((to.lat - from.lat) * k) / 1_499 + (k === 0 || k === 1_499 ? 0 : k % 2 === 0 ? 0.0003 : -0.0003), lng: from.lng + ((to.lng - from.lng) * k) / 1_499 })));
  });
  const query = itineraryMapQuery(legs, points, SIZE, SITE);
  assert.ok(query !== null);
  assert.ok(query.length <= STATIC_MAP_RULES.maxQueryLength);
  const params = new URLSearchParams(query);
  const path = decodePolyline((params.get("path") as string).split("enc:")[1] as string) as LatLng[];
  // 每段的头尾（= 行程点，折线精度 5 位）都还在路线上
  for (const point of points) assert.ok(path.some((p) => Math.abs(p.lat - point.lat) < 1e-5 && Math.abs(p.lng - point.lng) < 1e-5), `路线经过 ${point.lat},${point.lng}`);
  const markers = params.getAll("markers");
  assert.equal(markers.length, 12);
  assert.ok((markers[0] as string).endsWith("|35.68960,139.70060"));
  assert.ok((markers[11] as string).endsWith("|35.57960,139.48060"));
});
