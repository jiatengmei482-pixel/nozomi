/**
 * M6-08 整站美化遗留项的端到端检查：真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL。
 * - 日期框里浏览器自带的日历小按钮获得焦点时，整个输入框有 2px 聚焦环（亮色、暗色）。
 * 截图只在设置了 E2E_SCREENSHOT_DIR 时保存。
 */
import { type Page, expect, test } from "@playwright/test";
import { expectAccessible } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, snapshot } from "./support.ts";

/** 从日期框开始按 Tab，直到焦点落在它内部的日历小按钮上（宿主 :focus-within 但不是 :focus）；最多按 6 次。 */
async function tabToCalendarButton(page: Page, label: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.focus();
  for (let index = 0; index < 6; index += 1) {
    const state = await input.evaluate((node) => ({ within: node.matches(":focus-within"), self: node.matches(":focus") }));
    if (state.within && !state.self) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`没有按到「${label}」里的日历小按钮`);
}

test("日期框：焦点在日历小按钮上时整个输入框有 2px 聚焦环（亮色、暗色）；1280 / 390 / 320 不横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/platform/uncovered-demands");
    await expect(page.getByRole("heading", { level: 1, name: "未覆盖需求" })).toBeVisible();
    await tabToCalendarButton(page, "从");
    const input = page.getByLabel("从", { exact: true });
    const ring = await input.evaluate((node) => {
      const style = getComputedStyle(node);
      const probe = document.createElement("span");
      probe.style.color = "var(--color-border-focus)";
      document.body.append(probe);
      const focusColor = getComputedStyle(probe).color;
      probe.remove();
      return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor, focusColor };
    });
    expect(ring.style, `${scheme}：聚焦环是实线`).toBe("solid");
    expect(ring.width, `${scheme}：聚焦环 2px`).toBe("2px");
    expect(ring.color, `${scheme}：聚焦环用 border-focus`).toBe(ring.focusColor);
    await snapshot(page, `m608-date-focus-${scheme}`);
    await expectAccessible(page, `未覆盖需求（日期框聚焦，${scheme}）`);
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/platform/uncovered-demands");
    await expect(page.getByRole("heading", { level: 1, name: "未覆盖需求" })).toBeVisible();
    await expectNoHorizontalOverflow(page, `未覆盖需求 ${width}px`);
  }
});
