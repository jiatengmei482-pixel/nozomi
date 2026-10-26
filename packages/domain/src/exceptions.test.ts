import { test } from "node:test";
import assert from "node:assert/strict";
import { EXCEPTION_DUE_MINUTES, EXCEPTION_HANDLING, EXCEPTION_TYPES, EXCEPTION_TYPE_NAMES, exceptionActionRefusal, exceptionDueAt, exceptionOverdue, fulfilmentUnfinishedAt } from "./exceptions.ts";

test("异常类型与需求表一致（另加救援中），每种都有名称、处理方式、时限", () => {
  assert.deepEqual(EXCEPTION_TYPES.map((type) => EXCEPTION_TYPE_NAMES[type]), ["超时未派车", "司机未出发", "司机未到达", "状态推送失败", "no-show 待审核", "附加费用待审核", "履约未结束", "支付异常", "救援中"]);
  for (const type of EXCEPTION_TYPES) assert.ok(EXCEPTION_HANDLING[type].length > 0, type);
  assert.deepEqual(EXCEPTION_DUE_MINUTES, {
    dispatch_overdue: 0,
    departure_overdue: 15,
    arrival_overdue: 5,
    push_failed: 120,
    no_show_review: 1440,
    extra_charge_review: 1440,
    fulfilment_unfinished: 1440,
    payment_issue: 1440,
    rescue: 0,
  });
});

test("时限从发现时起算；过了时限（严格晚于）才算超时", () => {
  const opened = new Date("2026-10-26T00:00:00Z");
  const due = exceptionDueAt("departure_overdue", opened);
  assert.equal(due.toISOString(), "2026-10-26T00:15:00.000Z");
  assert.equal(exceptionOverdue(due, due), false);
  assert.equal(exceptionOverdue(due, new Date(due.getTime() + 1)), true);
  assert.equal(exceptionDueAt("dispatch_overdue", opened).getTime(), opened.getTime());
});

test("履约未结束：服务结束后 24 小时", () => {
  assert.equal(fulfilmentUnfinishedAt(new Date("2026-10-20T10:00:00Z")).toISOString(), "2026-10-21T10:00:00.000Z");
});

test("已关闭的异常不能再认领或关闭", () => {
  assert.equal(exceptionActionRefusal("closed"), "EXCEPTION_CLOSED");
  assert.equal(exceptionActionRefusal("open"), null);
  assert.equal(exceptionActionRefusal("claimed"), null);
});
