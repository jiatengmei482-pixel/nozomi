import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, UNRESTRICTED_SCOPE, platformRoleCan, resolvePlatformGrant } from "@nozomi/domain";
import { AppError } from "../errors.ts";
import { assertChannelPreviewAllowed } from "./quotes.ts";

const CHANNEL = "c1c1c1c1-aaaa-4bbb-8ccc-ddddeeeeffff";

test("按渠道试算另要 channel.read：没有就是 403（required = channel.read）；不选渠道不看这一项", () => {
  for (const { key } of PLATFORM_ROLES) {
    const grant = resolvePlatformGrant({ key, builtin: true, grants: null, scope: UNRESTRICTED_SCOPE });
    assert.doesNotThrow(() => assertChannelPreviewAllowed(grant, null), key);
    if (platformRoleCan(key, "channel.read")) assert.doesNotThrow(() => assertChannelPreviewAllowed(grant, CHANNEL), key);
    else {
      assert.throws(
        () => assertChannelPreviewAllowed(grant, CHANNEL),
        (err: unknown) => err instanceof AppError && err.statusCode === 403 && err.details["required"] === "channel.read",
        key,
      );
    }
  }
  // 至少有一个角色走到了「没有 channel.read」那一支（主数据运营）
  assert.ok(PLATFORM_ROLES.some(({ key }) => !platformRoleCan(key, "channel.read")));
});

test("自建角色限定了渠道范围：范围外的渠道当作不存在（404），范围内的照常", () => {
  const grant = resolvePlatformGrant({ key: "custom_0000000000000001", builtin: false, grants: ["quote_preview:view", "channels:view"], scope: { cityIds: null, channelIds: [CHANNEL] } });
  assert.doesNotThrow(() => assertChannelPreviewAllowed(grant, CHANNEL));
  assert.throws(() => assertChannelPreviewAllowed(grant, "d1d1d1d1-aaaa-4bbb-8ccc-ddddeeeeffff"), (err: unknown) => err instanceof AppError && err.statusCode === 404);
  assert.doesNotThrow(() => assertChannelPreviewAllowed(grant, null));
});
