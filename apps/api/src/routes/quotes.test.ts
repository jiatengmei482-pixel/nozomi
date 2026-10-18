import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, platformRoleCan } from "@nozomi/domain";
import { AppError } from "../errors.ts";
import { assertChannelPreviewAllowed } from "./quotes.ts";

test("按渠道试算另要 channel.read：没有就是 403（required = channel.read）；不选渠道不看这一项", () => {
  for (const { key } of PLATFORM_ROLES) {
    assert.doesNotThrow(() => assertChannelPreviewAllowed(key, null), key);
    if (platformRoleCan(key, "channel.read")) assert.doesNotThrow(() => assertChannelPreviewAllowed(key, "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff"), key);
    else {
      assert.throws(
        () => assertChannelPreviewAllowed(key, "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff"),
        (err: unknown) => err instanceof AppError && err.statusCode === 403 && err.details["required"] === "channel.read",
        key,
      );
    }
  }
  // 至少有一个角色走到了「没有 channel.read」那一支（主数据运营）
  assert.ok(PLATFORM_ROLES.some(({ key }) => !platformRoleCan(key, "channel.read")));
});
