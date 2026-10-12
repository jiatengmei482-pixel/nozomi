import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { assertAbsent, assertFocused, resetBrowser } from "../testing/harness.tsx";
import { ThemeSwitcher } from "./ThemeSwitcher.tsx";
import { THEME_STORAGE_KEY } from "./theme.ts";

afterEach(resetBrowser);

test("主题切换：三个选项，默认跟随系统；选暗色后 <html data-theme=dark> 并保存，选回跟随系统则去掉", async () => {
  const user = userEvent.setup();
  render(<ThemeSwitcher />);
  const button = screen.getByRole("button", { name: "切换主题" });
  await user.click(button);
  const options = within(screen.getByRole("menu")).getAllByRole("menuitemradio");
  assert.deepEqual(options.map((option) => option.textContent), ["跟随系统", "亮色", "暗色"]);
  assert.deepEqual(options.map((option) => option.getAttribute("aria-checked")), ["true", "false", "false"]);
  assertFocused(options[0] ?? null);

  await user.click(screen.getByRole("menuitemradio", { name: "暗色" }));
  assert.equal(document.documentElement.dataset["theme"], "dark");
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), "dark");
  assertAbsent(screen.queryByRole("menu"));
  assertFocused(button);

  await user.keyboard("{Enter}");
  assertFocused(screen.getByRole("menuitemradio", { name: "暗色" }));
  await user.keyboard("{ArrowUp}{Enter}");
  assert.equal(document.documentElement.dataset["theme"], "light");
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), "light");

  await user.click(button);
  await user.click(screen.getByRole("menuitemradio", { name: "跟随系统" }));
  assert.equal("theme" in document.documentElement.dataset, false);
  assert.equal(localStorage.getItem(THEME_STORAGE_KEY), null);
});

test("主题切换：打开时读出上次保存的选择；点菜单外面关闭", async () => {
  localStorage.setItem(THEME_STORAGE_KEY, "light");
  const user = userEvent.setup();
  render(
    <div>
      <ThemeSwitcher />
      <p>别处</p>
    </div>,
  );
  await user.click(screen.getByRole("button", { name: "切换主题" }));
  assert.equal(screen.getByRole("menuitemradio", { name: "亮色" }).getAttribute("aria-checked"), "true");
  await user.click(screen.getByText("别处"));
  assertAbsent(screen.queryByRole("menu"));
});
