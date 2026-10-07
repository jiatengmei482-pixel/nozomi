import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type GeoJsonPolygon,
  haversineMeters,
  isValidLatLng,
  pointInArea,
  pointInPolygon,
  validatePolygon,
} from "./geo.ts";

// 单位正方形（lng 0–10, lat 0–10），中间挖一个 4–6 的洞
const squareWithHole: GeoJsonPolygon = {
  type: "Polygon",
  coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ],
};

test("同一点距离为 0，经度 1 度在赤道约 111.2 km", () => {
  assert.equal(haversineMeters({ lat: 35, lng: 139 }, { lat: 35, lng: 139 }), 0);
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  assert.ok(Math.abs(d - 111_195) < 50, `实际 ${d}`);
});

test("距离对称", () => {
  const a = { lat: 35.55, lng: 139.78 };
  const b = { lat: 35.77, lng: 140.39 };
  assert.equal(haversineMeters(a, b), haversineMeters(b, a));
});

test("无效坐标被拒绝", () => {
  assert.equal(isValidLatLng({ lat: 91, lng: 0 }), false);
  assert.equal(isValidLatLng({ lat: 0, lng: Number.NaN }), false);
  assert.throws(() => haversineMeters({ lat: 0, lng: 200 }, { lat: 0, lng: 0 }), RangeError);
});

test("多边形：内部、外部、洞内、边界", () => {
  assert.equal(pointInPolygon({ lat: 2, lng: 2 }, squareWithHole), true);
  assert.equal(pointInPolygon({ lat: 12, lng: 2 }, squareWithHole), false);
  assert.equal(pointInPolygon({ lat: 5, lng: 5 }, squareWithHole), false, "洞内不算");
  assert.equal(pointInPolygon({ lat: 0, lng: 5 }, squareWithHole), true, "外边界上算在内");
  assert.equal(pointInPolygon({ lat: 4, lng: 5 }, squareWithHole), true, "洞的边界上仍属区域");
});

test("MultiPolygon：任一多边形包含即可", () => {
  const multi = {
    type: "MultiPolygon" as const,
    coordinates: [
      [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] as [number, number][][],
      [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]] as [number, number][][],
    ],
  };
  assert.equal(pointInPolygon({ lat: 5.5, lng: 5.5 }, multi), true);
  assert.equal(pointInPolygon({ lat: 3, lng: 3 }, multi), false);
});

test("圆形区域按半径判断", () => {
  const area = { kind: "circle" as const, center: { lat: 35.68, lng: 139.76 }, radiusMeters: 5_000 };
  assert.equal(pointInArea({ lat: 35.69, lng: 139.77 }, area), true);
  assert.equal(pointInArea({ lat: 35.9, lng: 139.76 }, area), false);
});

test("多边形校验能指出未闭合和点数不足", () => {
  assert.deepEqual(validatePolygon(squareWithHole), []);
  const open: GeoJsonPolygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] };
  assert.ok(validatePolygon(open).some((i) => i.includes("首尾点不一致")));
  const tiny: GeoJsonPolygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] };
  assert.ok(validatePolygon(tiny).some((i) => i.includes("至少需要 4 个点")));
});
