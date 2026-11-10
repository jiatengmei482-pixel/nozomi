import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREA_OVERLAP_MIN_M2, type OverlapAreaInput, areasCanCompete, findAreaOverlaps, findPricingOutsideOperating } from "./area-overlap.ts";
import { type Position, circleToRing } from "./areas.ts";

/** 射线法：点在不在一圈点里（测试自己的，不依赖被测代码）。 */
function pointInRing(point: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i] as Position;
    const [xj, yj] = ring[j] as Position;
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 经纬度上的矩形（不闭合，逆时针）。 */
function rect(minLng: number, minLat: number, maxLng: number, maxLat: number): Position[] {
  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
  ];
}

function area(id: string, operate: Position[][], forbid: Position[][] = [], extra: Partial<OverlapAreaInput> = {}): OverlapAreaInput {
  return { id, bizType: "general", active: true, polygons: [...operate.map((ring) => ({ kind: "operate" as const, ring })), ...forbid.map((ring) => ({ kind: "forbid" as const, ring }))], ...extra };
}

/** 一度见方在赤道附近约 111.32 公里 × 111.32 公里。 */
const DEG2 = 111_320 * 111_320;

function piecesArea(rings: readonly Position[][]): number {
  // 梯形的面积（平面，平方度）
  return rings.reduce((sum, ring) => {
    let twice = 0;
    ring.forEach((point, i) => {
      const next = ring[(i + 1) % ring.length] as Position;
      twice += point[0] * next[1] - next[0] * point[1];
    });
    return sum + Math.abs(twice) / 2;
  }, 0);
}

describe("findAreaOverlaps：两个区域的重叠", () => {
  it("两个矩形部分重叠：报一对，面积是公共部分的面积，重叠的形状正好盖住公共部分", () => {
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.02, 0.02)]), area("b", [rect(0.01, 0.01, 0.03, 0.03)])]);
    assert.equal(result.pairs.length, 1);
    const pair = result.pairs[0];
    assert.equal(pair?.a, "a");
    assert.equal(pair?.b, "b");
    const expected = 0.01 * 0.01 * DEG2;
    assert.ok(Math.abs((pair?.areaM2 ?? 0) - expected) / expected < 0.001, `面积 ${pair?.areaM2}，应为约 ${expected}`);
    assert.ok(Math.abs(piecesArea(result.pieces.map((piece) => piece.ring)) - 0.0001) < 1e-9);
    for (const piece of result.pieces) assert.deepEqual(piece.areaIds, ["a", "b"]);
    assert.deepEqual(result.byArea.get("a"), ["b"]);
    assert.deepEqual(result.byArea.get("b"), ["a"]);
  });

  it("不相干、只是边挨着边：都不算重叠", () => {
    assert.equal(findAreaOverlaps([area("a", [rect(0, 0, 1, 1)]), area("b", [rect(2, 0, 3, 1)])]).pairs.length, 0);
    const touching = findAreaOverlaps([area("a", [rect(0, 0, 1, 1)]), area("b", [rect(1, 0, 2, 1)])]);
    assert.equal(touching.pairs.length, 0);
    assert.equal(touching.pieces.length, 0);
  });

  it("一个整个在另一个里面：重叠面积是小的那个", () => {
    const result = findAreaOverlaps([area("big", [rect(0, 0, 0.1, 0.1)]), area("small", [rect(0.02, 0.02, 0.04, 0.04)])]);
    assert.equal(result.pairs.length, 1);
    const expected = 0.02 * 0.02 * DEG2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001);
  });

  it("凹多边形（U 形）和横条：公共部分是两块，中间的缺口不算", () => {
    const u: Position[] = [
      [0, 0],
      [0.03, 0],
      [0.03, 0.03],
      [0.02, 0.03],
      [0.02, 0.01],
      [0.01, 0.01],
      [0.01, 0.03],
      [0, 0.03],
    ];
    const bar = rect(-0.01, 0.015, 0.04, 0.025);
    const result = findAreaOverlaps([area("u", [u]), area("bar", [bar])]);
    assert.equal(result.pairs.length, 1);
    const expected = 2 * 0.01 * 0.01 * DEG2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001, `面积 ${result.pairs[0]?.areaM2}`);
    // 缺口的中点不在任何一块重叠里
    assert.ok(!result.pieces.some((piece) => pointInRing([0.015, 0.02], piece.ring)));
    assert.ok(result.pieces.some((piece) => pointInRing([0.005, 0.02], piece.ring)));
  });

  it("交叉的两个斜放的多边形（边在中间相交）：面积和解析值一致", () => {
    // 两个菱形，中心相距半个对角线
    const diamond = (cx: number): Position[] => [
      [cx, -0.01],
      [cx + 0.01, 0],
      [cx, 0.01],
      [cx - 0.01, 0],
    ];
    const result = findAreaOverlaps([area("a", [diamond(0)]), area("b", [diamond(0.01)])]);
    // 公共部分是一个对角线长 0.01 和 0.01 的小菱形：面积 0.01 × 0.01 / 2
    const expected = (0.01 * 0.01 * DEG2) / 2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001, `面积 ${result.pairs[0]?.areaM2}`);
  });

  it("圆按 64 边形算：两个同样大小、圆心相距一个半径的圆，重叠面积约为解析值", () => {
    const r = 1_000;
    const a = circleToRing({ lat: 0, lng: 0 }, r);
    const b = circleToRing({ lat: 0, lng: r / 111_195 }, r);
    const result = findAreaOverlaps([area("a", [a]), area("b", [b])]);
    // 两圆相交（圆心距 d = r）的公共面积 = 2r²·acos(1/2) − (r/2)·√(4r²−r²)
    const expected = 2 * r * r * Math.acos(0.5) - (r / 2) * Math.sqrt(3 * r * r);
    const got = result.pairs[0]?.areaM2 ?? 0;
    assert.ok(Math.abs(got - expected) / expected < 0.01, `面积 ${got}，解析值 ${expected}`);
  });
});

describe("findAreaOverlaps：禁行区、停用、业务类型", () => {
  it("区域甲的禁行区正好盖住和乙的公共部分：不算重叠", () => {
    const a = area("a", [rect(0, 0, 0.02, 0.02)], [rect(0.01, 0.01, 0.02, 0.02)]);
    const b = area("b", [rect(0.01, 0.01, 0.03, 0.03)]);
    const result = findAreaOverlaps([a, b]);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.pieces.length, 0);
  });

  it("禁行区只盖住公共部分的一半：剩下一半算重叠", () => {
    const a = area("a", [rect(0, 0, 0.02, 0.02)], [rect(0.01, 0.01, 0.015, 0.02)]);
    const b = area("b", [rect(0.01, 0.01, 0.03, 0.03)]);
    const result = findAreaOverlaps([a, b]);
    const expected = 0.005 * 0.01 * DEG2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001);
    assert.ok(!result.pieces.some((piece) => pointInRing([0.012, 0.015], piece.ring)));
    assert.ok(result.pieces.some((piece) => pointInRing([0.018, 0.015], piece.ring)));
  });

  it("一个区域自己的禁行区压在别的区域的禁行区上、和别的区域的营运区不相干：不算重叠", () => {
    const a = area("a", [rect(0, 0, 0.01, 0.01)], [rect(0.005, 0, 0.02, 0.01)]);
    const b = area("b", [rect(0.02, 0, 0.03, 0.01)], [rect(0.01, 0, 0.025, 0.01)]);
    assert.equal(findAreaOverlaps([a, b]).pairs.length, 0);
  });

  it("同一个区域的两块营运区互相重叠：不是区域之间的重叠", () => {
    assert.equal(findAreaOverlaps([area("a", [rect(0, 0, 0.02, 0.02), rect(0.01, 0.01, 0.03, 0.03)])]).pairs.length, 0);
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.02, 0.02), rect(0.01, 0.01, 0.03, 0.03)]), area("b", [rect(0.015, 0.015, 0.016, 0.016)])]);
    assert.equal(result.pairs.length, 1);
    const expected = 0.001 * 0.001 * DEG2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001, "公共部分不因 a 的两块营运区叠着而算两遍");
  });

  it("停用的区域不参与", () => {
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.02, 0.02)]), area("b", [rect(0.01, 0.01, 0.03, 0.03)], [], { active: false })]);
    assert.equal(result.pairs.length, 0);
  });

  it("业务类型：相同或其中一个是通用才算；接送机和包车不算", () => {
    assert.ok(areasCanCompete("general", "charter"));
    assert.ok(areasCanCompete("charter", "charter"));
    assert.ok(!areasCanCompete("airport_transfer", "charter"));
    const a = area("a", [rect(0, 0, 0.02, 0.02)], [], { bizType: "airport_transfer" });
    const b = area("b", [rect(0.01, 0.01, 0.03, 0.03)], [], { bizType: "charter" });
    assert.equal(findAreaOverlaps([a, b]).pairs.length, 0);
    const c = area("c", [rect(0.005, 0.005, 0.025, 0.025)]);
    const result = findAreaOverlaps([a, b, c]);
    assert.deepEqual(result.pairs.map((pair) => `${pair.a}-${pair.b}`), ["a-c", "b-c"]);
    assert.deepEqual(result.byArea.get("c"), ["a", "b"]);
    // a 和 b 都在、c 也在的那一块：三个都标上（a、b 各自和 c 重叠）
    assert.ok(result.pieces.some((piece) => piece.areaIds.length === 3));
  });

  it("三个区域叠在一起：三对都报，按输入顺序", () => {
    const result = findAreaOverlaps([area("x", [rect(0, 0, 0.02, 0.02)]), area("y", [rect(0.01, 0, 0.03, 0.02)]), area("z", [rect(0.005, 0.005, 0.025, 0.015)])]);
    assert.deepEqual(result.pairs.map((pair) => `${pair.a}-${pair.b}`), ["x-y", "x-z", "y-z"]);
  });
});

describe("findAreaOverlaps：小细缝和边界情况", () => {
  it("公共部分不到 100 平方米：不提示", () => {
    // 5 米宽的细缝：约 5 m × 111 m = 556 m²；1/10 宽度的约 56 m²
    const thin = 0.000005;
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.001, 0.001)]), area("b", [rect(0.001 - thin, 0, 0.002, 0.001)])]);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.pieces.length, 0);
    assert.ok(AREA_OVERLAP_MIN_M2 === 100);
  });

  it("没有营运区、点不够的图形、只有一个区域：没有重叠", () => {
    assert.deepEqual(findAreaOverlaps([]).pairs, []);
    assert.deepEqual(findAreaOverlaps([area("a", [rect(0, 0, 1, 1)])]).pairs, []);
    assert.deepEqual(findAreaOverlaps([area("a", [], [rect(0, 0, 1, 1)]), area("b", [rect(0, 0, 1, 1)])]).pairs, []);
    assert.deepEqual(findAreaOverlaps([area("a", [[[0, 0], [1, 1]]]), area("b", [rect(0, 0, 1, 1)])]).pairs, []);
  });

  it("两个完全相同的区域：整个面积都是重叠", () => {
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.01, 0.01)]), area("b", [rect(0, 0, 0.01, 0.01)])]);
    const expected = 0.01 * 0.01 * DEG2;
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001);
  });

  it("高纬度：面积按纬度缩小", () => {
    const result = findAreaOverlaps([area("a", [rect(0, 60, 0.02, 60.02)]), area("b", [rect(0.01, 60.01, 0.03, 60.03)])]);
    const expected = 0.01 * 0.01 * DEG2 * Math.cos((60.015 * Math.PI) / 180);
    assert.ok(Math.abs((result.pairs[0]?.areaM2 ?? 0) - expected) / expected < 0.001);
  });

  it("相邻的梯形合成一块：两个矩形的重叠只有一块", () => {
    const result = findAreaOverlaps([area("a", [rect(0, 0, 0.02, 0.02)]), area("b", [rect(0.01, 0.01, 0.03, 0.03)])]);
    assert.equal(result.pieces.length, 1);
  });
});

describe("ADR 0075：重叠只在报价区域之间算", () => {
  it("运营区域和别的区域叠在一起不算重叠；报价区域、运营 + 报价之间照算；没给用途的按报价区域算", () => {
    const big = area("op", [rect(0, 0, 0.1, 0.1)], [], { role: "operating" });
    const p1 = area("p1", [rect(0.01, 0.01, 0.03, 0.03)], [], { role: "pricing" });
    const p2 = area("p2", [rect(0.02, 0.02, 0.04, 0.04)], [], { role: "both" });
    const old = area("old", [rect(0.035, 0.035, 0.05, 0.05)]);
    const result = findAreaOverlaps([big, p1, p2, old]);
    assert.deepEqual(result.pairs.map((pair) => [pair.a, pair.b]), [["p1", "p2"], ["p2", "old"]]);
    assert.ok(result.pieces.every((piece) => !piece.areaIds.includes("op")));
    assert.deepEqual(findAreaOverlaps([big, area("op2", [rect(0.05, 0.05, 0.2, 0.2)], [], { role: "operating" })]).pairs, []);
  });
});

describe("findPricingOutsideOperating：报价区域超出运营区域的部分", () => {
  const op = area("op", [rect(0, 0, 0.02, 0.02)], [], { role: "operating" });

  it("报价区域一半在运营区域外：面积是外面那一半，形状正好盖住外面那一半", () => {
    const pricing = area("p", [rect(0.01, 0, 0.03, 0.02)], [], { role: "pricing" });
    const result = findPricingOutsideOperating([pricing], [op]);
    const expected = 0.01 * 0.02 * DEG2;
    const got = result.byArea.get("p") ?? 0;
    assert.ok(Math.abs(got - expected) / expected < 0.001, `面积 ${got}，应为约 ${expected}`);
    assert.ok(Math.abs(piecesArea(result.pieces.map((piece) => piece.ring)) - 0.0002) < 1e-9);
    for (const piece of result.pieces) {
      assert.deepEqual(piece.areaIds, ["p"]);
      for (const point of piece.ring) assert.ok(point[0] >= 0.02 - 1e-12);
    }
  });

  it("完全在运营区域里、运营 + 报价自己盖住自己、相加的几个运营区域合起来盖住：没有超出", () => {
    assert.equal(findPricingOutsideOperating([area("p", [rect(0.005, 0.005, 0.015, 0.015)])], [op]).byArea.size, 0);
    const both = area("b", [rect(1, 1, 1.1, 1.1)], [], { role: "both" });
    assert.equal(findPricingOutsideOperating([both], [both]).byArea.size, 0);
    const right = area("op2", [rect(0.02, 0, 0.04, 0.02)], [], { role: "operating" });
    assert.equal(findPricingOutsideOperating([area("p", [rect(0.01, 0.005, 0.03, 0.015)])], [op, right]).byArea.size, 0);
  });

  it("运营区域的禁行区里那一块算超出（禁行区只管它所在的区域）；报价区域自己的禁行区不算", () => {
    const holed = area("op", [rect(0, 0, 0.02, 0.02)], [rect(0.005, 0.005, 0.01, 0.01)], { role: "operating" });
    const result = findPricingOutsideOperating([area("p", [rect(0, 0, 0.02, 0.02)], [rect(0.012, 0.012, 0.018, 0.018)])], [holed]);
    const expected = 0.005 * 0.005 * DEG2;
    assert.ok(Math.abs((result.byArea.get("p") ?? 0) - expected) / expected < 0.001);
  });

  it("业务类型不相容的运营区域不算；停用的运营区域不算；停用的报价区域不看；不到 100 平方米的不提示", () => {
    const charterOp = area("op", [rect(0, 0, 0.02, 0.02)], [], { role: "operating", bizType: "charter" });
    const transfer = area("p", [rect(0.005, 0.005, 0.015, 0.015)], [], { role: "pricing", bizType: "airport_transfer" });
    assert.ok(findPricingOutsideOperating([transfer], [charterOp]).byArea.has("p"));
    assert.equal(findPricingOutsideOperating([transfer], [charterOp], () => true).byArea.size, 0);
    assert.ok(findPricingOutsideOperating([area("p", [rect(0.005, 0.005, 0.015, 0.015)])], [{ ...op, active: false }]).byArea.has("p"));
    assert.equal(findPricingOutsideOperating([{ ...area("p", [rect(1, 1, 2, 2)]), active: false }], [op]).byArea.size, 0);
    const sliver = 50 / 111_320 / 111_320 / 0.001;
    assert.equal(findPricingOutsideOperating([area("p", [rect(0.01, 0, 0.02 + sliver, 0.001)])], [op]).byArea.size, 0);
  });

  it("没有运营区域：整个报价区域都超出", () => {
    const result = findPricingOutsideOperating([area("p", [rect(0, 0, 0.01, 0.01)])], []);
    const expected = 0.01 * 0.01 * DEG2;
    assert.ok(Math.abs((result.byArea.get("p") ?? 0) - expected) / expected < 0.001);
  });
});
