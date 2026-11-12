import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineMeters } from "./geo.ts";
import { BY_POINTS_RULES, classifyPointsTrip, pointToPointCityOf, recognizeAirport, serviceCityOf } from "./points-trip.ts";

/** 纬度方向每米多少度（和 `haversineMeters` 同一个地球半径） */
const DEG_PER_METER = 180 / (Math.PI * 6_371_008.8);
const NARITA = { id: "narita", lat: 35.7686, lng: 140.3887 };
const HANEDA = { id: "haneda", lat: 35.5494, lng: 139.7798 };
const AIRPORTS = [NARITA, HANEDA];
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671, kind: null };
/** 机场正北 `meters` 米的点 */
const northOf = (airport: { lat: number; lng: number }, meters: number, kind: "airport" | "other" | null = null) => ({ lat: airport.lat + meters * DEG_PER_METER, lng: airport.lng, kind });

test("3 公里边界：2999 米认成机场，3001 米不认；正好 3 公里也认", () => {
  assert.ok(Math.abs(haversineMeters(NARITA, northOf(NARITA, 2_999)) - 2_999) < 0.01, "测试用的点离机场正好这么远");
  assert.equal(recognizeAirport(northOf(NARITA, 2_999), AIRPORTS)?.airport.id, "narita");
  assert.deepEqual(recognizeAirport(northOf(NARITA, 2_999), AIRPORTS), { airport: NARITA, meters: 2_999, matchedBy: "distance" });
  assert.equal(recognizeAirport(northOf(NARITA, 3_001), AIRPORTS), null);
  assert.equal(recognizeAirport(northOf(NARITA, 2_999.999), AIRPORTS)?.matchedBy, "distance");
  assert.equal(BY_POINTS_RULES.airportRadiusMeters, 3_000);
});

test("地址搜索说是机场：3 公里以外、10 公里以内也认（matchedBy kind）；超过 10 公里、或类型是其他 / 没有类型都不认", () => {
  assert.deepEqual(recognizeAirport(northOf(NARITA, 6_000, "airport"), AIRPORTS), { airport: NARITA, meters: 6_000, matchedBy: "kind" });
  assert.equal(recognizeAirport(northOf(NARITA, 10_001, "airport"), AIRPORTS), null);
  assert.equal(recognizeAirport(northOf(NARITA, 6_000, "other"), AIRPORTS), null);
  assert.equal(recognizeAirport(northOf(NARITA, 6_000, null), AIRPORTS), null);
  assert.equal(recognizeAirport(northOf(NARITA, 1_000, "other"), AIRPORTS)?.matchedBy, "distance", "类型是其他也不挡 3 公里的规则");
});

test("取最近的机场：两个机场都在范围里时取近的；距离一样按编号", () => {
  const a = { id: "a", lat: 35, lng: 139 };
  const b = { id: "b", lat: 35 + 2_000 * DEG_PER_METER, lng: 139 };
  const nearB = { lat: 35 + 1_500 * DEG_PER_METER, lng: 139, kind: null };
  assert.equal(recognizeAirport(nearB, [a, b])?.airport.id, "b");
  assert.equal(recognizeAirport(nearB, [b, a])?.airport.id, "b");
  const middle = { lat: 35 + 1_000 * DEG_PER_METER, lng: 139, kind: null };
  const tie = recognizeAirport(middle, [b, a]);
  assert.ok(tie !== null && Math.abs(haversineMeters(middle, a) - haversineMeters(middle, b)) < 1e-6 ? tie.airport.id === "a" : true);
  const twins = [{ id: "z", lat: 35, lng: 139 }, { id: "y", lat: 35, lng: 139 }];
  assert.equal(recognizeAirport({ lat: 35, lng: 139.001, kind: null }, twins)?.airport.id, "y", "距离完全一样按编号");
  assert.equal(recognizeAirport(TOKYO_STATION, []), null, "没有候选机场");
});

test("不在候选里的机场不认（调用方只给渠道授权范围里的）：同一个点，候选里没有成田就是普通地址", () => {
  assert.equal(recognizeAirport(northOf(NARITA, 100), [HANEDA]), null);
  const trip = classifyPointsTrip(northOf(NARITA, 100), TOKYO_STATION, [HANEDA]);
  assert.equal(trip.trip.tripType, "point_to_point");
});

test("方向：出发地是机场 → 接机；目的地是机场 → 送机；两端都不是 → 点对点", () => {
  const pickup = classifyPointsTrip(northOf(NARITA, 500), TOKYO_STATION, AIRPORTS);
  assert.equal(pickup.trip.tripType, "pickup");
  assert.ok(pickup.trip.tripType === "pickup");
  assert.equal(pickup.trip.airport.airport.id, "narita");
  assert.deepEqual(pickup.trip.address, { lat: TOKYO_STATION.lat, lng: TOKYO_STATION.lng });
  assert.equal(pickup.dropoffAirport, null);

  const dropoff = classifyPointsTrip(TOKYO_STATION, northOf(HANEDA, 200), AIRPORTS);
  assert.ok(dropoff.trip.tripType === "dropoff");
  assert.equal(dropoff.trip.airport.airport.id, "haneda");
  assert.deepEqual(dropoff.trip.address, { lat: TOKYO_STATION.lat, lng: TOKYO_STATION.lng });
  assert.equal(dropoff.pickupAirport, null);

  const p2p = classifyPointsTrip(TOKYO_STATION, { lat: 35.69, lng: 139.7, kind: "other" }, AIRPORTS);
  assert.deepEqual(p2p.trip, { tripType: "point_to_point", pickup: { lat: 35.6812, lng: 139.7671 }, dropoff: { lat: 35.69, lng: 139.7 } });
});

test("两端都是机场：按出发地算接机，目的地那个机场当地址那一端；两端的识别结果都给出来", () => {
  const both = classifyPointsTrip(northOf(HANEDA, 100), northOf(NARITA, 100), AIRPORTS);
  assert.ok(both.trip.tripType === "pickup");
  assert.equal(both.trip.airport.airport.id, "haneda");
  assert.deepEqual(both.trip.address, { lat: NARITA.lat + 100 * DEG_PER_METER, lng: NARITA.lng });
  assert.equal(both.pickupAirport?.airport.id, "haneda");
  assert.equal(both.dropoffAirport?.airport.id, "narita");
});

test("坐标不合法抛 RangeError（接口层已校验，到这里说明是程序错误）", () => {
  assert.throws(() => recognizeAirport({ lat: 95, lng: 0, kind: null }, AIRPORTS), RangeError);
  assert.throws(() => serviceCityOf({ lat: 0, lng: 200 }, []), RangeError);
});

test("点对点的城市：出发地在城市范围（中心周围 80 公里）里的城市中最近的那个；都不在为 null", () => {
  const tokyo = { id: "tokyo", center: { lat: 35.6895, lng: 139.6917 } };
  const yokohama = { id: "yokohama", center: { lat: 35.4437, lng: 139.638 } };
  const osaka = { id: "osaka", center: { lat: 34.7, lng: 135.5 } };
  assert.equal(serviceCityOf({ lat: 35.68, lng: 139.76 }, [osaka, yokohama, tokyo])?.id, "tokyo");
  assert.equal(serviceCityOf({ lat: 35.46, lng: 139.62 }, [tokyo, yokohama])?.id, "yokohama");
  assert.equal(serviceCityOf({ lat: 35.68, lng: 139.76 }, [osaka]), null);
  assert.equal(serviceCityOf({ lat: 43.06, lng: 141.35 }, [tokyo, osaka]), null, "札幌不在东京、大阪的范围里");
  assert.equal(serviceCityOf({ lat: 35.68, lng: 139.76 }, []), null);
});

test("点对点往返对称（M8-35）：出发地在城市范围里照旧用出发地的城市；出发地哪里都不在、目的地在时用目的地的城市；两端都不在为 null", () => {
  const tokyo = { id: "tokyo", center: { lat: 35.6895, lng: 139.6917 } };
  const osaka = { id: "osaka", center: { lat: 34.7, lng: 135.5 } };
  const ginza = { lat: 35.6717, lng: 139.765 };
  // 轻井泽王子大饭店西馆：离东京中心约 146 公里，不在任何城市的 80 公里范围里
  const karuizawa = { lat: 36.3375, lng: 138.6262 };
  const sapporo = { lat: 43.06, lng: 141.35 };
  assert.equal(serviceCityOf(karuizawa, [tokyo, osaka]), null);
  assert.equal(pointToPointCityOf(ginza, karuizawa, [tokyo, osaka])?.id, "tokyo", "去程：按出发地（和以前一样）");
  assert.equal(pointToPointCityOf(karuizawa, ginza, [tokyo, osaka])?.id, "tokyo", "返程：出发地不在任何城市，按目的地");
  assert.equal(pointToPointCityOf(ginza, { lat: 34.69, lng: 135.5 }, [tokyo, osaka])?.id, "tokyo", "两端在不同城市：仍按出发地（不变）");
  assert.equal(pointToPointCityOf(karuizawa, sapporo, [tokyo, osaka]), null);
  assert.equal(pointToPointCityOf(karuizawa, ginza, []), null);
});
