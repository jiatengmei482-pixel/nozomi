/** 嵌入预订页手机底部按钮条的摆放（M9E-32，ADR 0100 第三节）：露出来那一截的底边、条往上挪多少、宿主可视区的订阅。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHostViewportStore, frameBarShift, visibleBottom } from "./frame-bar.ts";

const base = { frameTop: 100, hostHeight: 800, frameHeight: 3000, slotTop: 2900, barHeight: 80 };

test("露出来那一截的底边 = min(内容高度, 宿主可视高度 − iframe 上沿)", () => {
  assert.equal(visibleBottom(base), 700, "iframe 上沿在屏幕上 100px 处：露出 700px");
  assert.equal(visibleBottom({ ...base, frameTop: -1200 }), 2000, "iframe 上半截滚出屏幕 1200px");
  assert.equal(visibleBottom({ ...base, frameTop: -2500 }), 3000, "滚到底：不超过内容高度");
  assert.equal(visibleBottom({ ...base, frameTop: 900 }), -100, "整个在屏幕下方");
});

test("条的下沿对齐露出来那一截的底边：宿主滚到顶部时条在屏幕最下面", () => {
  // 露到 700，条高 80：条的上沿该在 620，原位置 2900，往上挪 2280
  assert.equal(frameBarShift(base), -2280);
  const shift = frameBarShift(base);
  assert.equal(base.slotTop + shift + base.barHeight, 700, "条的下沿 = 露出来那一截的底边");
  // 宿主往下滚 1200px
  assert.equal(frameBarShift({ ...base, frameTop: -1100 }), -(2900 - (1900 - 80)));
});

test("不低于原位置：滚到最底下（或条本来就在屏幕里）时回到文档流里自己的位置", () => {
  assert.equal(frameBarShift({ ...base, frameTop: -2500 }), 0, "露出来的底边 = 内容末尾");
  assert.equal(frameBarShift({ ...base, frameTop: -2300 }), 0, "原位置已经整个在屏幕里");
  assert.equal(frameBarShift({ ...base, frameHeight: 600, slotTop: 400 }), 0, "内容比屏幕矮");
  assert.ok(Object.is(frameBarShift({ ...base, frameTop: -2220 }), 0), "正好对齐时是 0 不是 -0");
});

test("不高过 iframe 的上沿：iframe 只露出一点或整个在屏幕下方时，条停在 iframe 顶部", () => {
  assert.equal(frameBarShift({ ...base, frameTop: 760 }), -2900, "只露出 40px（比条矮）：条的上沿在 iframe 顶部");
  assert.equal(frameBarShift({ ...base, frameTop: 5000 }), -2900);
  assert.equal(frameBarShift({ ...base, slotTop: 0 }), 0, "条本来就在最上面");
});

test("取整：给样式用的是整数 px", () => {
  assert.equal(frameBarShift({ ...base, frameTop: 100.4, barHeight: 80.3 }), -2281);
  assert.ok(Number.isInteger(frameBarShift({ ...base, frameTop: 33.33, slotTop: 2899.7 })));
});

test("宿主可视区的订阅：变了才通知；退订后不再通知", () => {
  const store = createHostViewportStore();
  assert.equal(store.current(), null);
  let calls = 0;
  const stop = store.subscribe(() => {
    calls += 1;
  });
  store.set({ height: 800, top: 100 });
  assert.deepEqual(store.current(), { height: 800, top: 100 });
  store.set({ height: 800, top: 100 });
  assert.equal(calls, 1, "同样的值不重复通知");
  store.set({ height: 800, top: null });
  assert.equal(calls, 2, "旧版组件脚本不带 top 也算变了");
  stop();
  store.set({ height: 700, top: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(store.current(), { height: 700, top: 0 });
});
