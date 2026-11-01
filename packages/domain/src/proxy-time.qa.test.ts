/**
 * M4-18 测试角色补充：代传发生时间的毫秒边界（fulfilment.test.ts 只到秒）和写入时间的不变式。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyEffectiveOccurredAt, proxyFulfilmentTimeIssue } from "./fulfilment.ts";

const HOUR = 3_600_000;
const now = new Date("2026-11-10T12:00:00.000Z");

test("7 天和用车前 24 小时的毫秒边界：正好那一刻合规，早 1 毫秒不合规", () => {
  const sevenDays = now.getTime() - 7 * 24 * HOUR;
  const serviceLong = new Date(sevenDays);
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(sevenDays), previousAt: null, serviceAt: serviceLong, now }), null);
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(sevenDays - 1), previousAt: null, serviceAt: serviceLong, now }), "TOO_OLD");
  const serviceAt = new Date(now.getTime() + HOUR);
  const earliest = serviceAt.getTime() - 24 * HOUR;
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(earliest), previousAt: null, serviceAt, now }), null);
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(earliest - 1), previousAt: null, serviceAt, now }), "TOO_EARLY");
});

test("同一分钟的边界：上一个节点带毫秒，这一分钟第一毫秒合规，再早 1 毫秒不合规；写入的时间是上一个节点", () => {
  const previousAt = new Date("2026-11-10T09:00:59.999Z");
  const start = new Date("2026-11-10T09:00:00.000Z");
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: start, previousAt, serviceAt: now, now }), null);
  assert.equal(proxyFulfilmentTimeIssue({ occurredAt: new Date(start.getTime() - 1), previousAt, serviceAt: now, now }), "BEFORE_PREVIOUS");
  assert.deepEqual(proxyEffectiveOccurredAt(start, previousAt), previousAt);
});

test("不变式：合规的发生时间，写入后不早于上一个节点、不晚于现在", () => {
  const serviceAt = new Date(now.getTime() - 2 * HOUR);
  let checked = 0;
  for (let step = 0; step < 2_000; step += 1) {
    const previousAt = new Date(now.getTime() - ((step * 7_919) % (3 * HOUR)));
    const occurredAt = new Date(now.getTime() - ((step * 104_729) % (4 * HOUR)));
    if (proxyFulfilmentTimeIssue({ occurredAt, previousAt, serviceAt, now }) !== null) continue;
    checked += 1;
    const written = proxyEffectiveOccurredAt(occurredAt, previousAt).getTime();
    assert.ok(written >= previousAt.getTime() && written <= now.getTime(), `${occurredAt.toISOString()} ${previousAt.toISOString()}`);
  }
  assert.ok(checked > 100, `合规的样本太少：${checked}`);
});
