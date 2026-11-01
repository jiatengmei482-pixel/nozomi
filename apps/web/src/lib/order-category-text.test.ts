import assert from "node:assert/strict";
import { test } from "node:test";
import { orderCategoryText } from "./dispatch-display.ts";

test("订单品类一行：点对点不重复；接送机带方向；包车带小时数", () => {
  assert.equal(orderCategoryText({ category: "point_to_point", direction: null, package_hours: null } as never), "点对点");
  assert.equal(orderCategoryText({ category: "airport_transfer", direction: "pickup", package_hours: null } as never), "接送机 · 接机");
  assert.equal(orderCategoryText({ category: "charter", direction: null, package_hours: 8 } as never), "包车 · 8 小时");
});
