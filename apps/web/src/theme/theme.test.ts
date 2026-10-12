import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { THEME_OPTIONS, THEME_STORAGE_KEY, applyThemeChoice, readThemeChoice, saveThemeChoice } from "./theme.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

test("没存过或存了别的值时跟随系统", () => {
  assert.equal(readThemeChoice(fakeStorage()), "system");
  assert.equal(readThemeChoice(fakeStorage({ [THEME_STORAGE_KEY]: "blue" })), "system");
  assert.equal(readThemeChoice(null), "system");
  assert.equal(readThemeChoice(fakeStorage({ [THEME_STORAGE_KEY]: "dark" })), "dark");
  assert.equal(readThemeChoice(fakeStorage({ [THEME_STORAGE_KEY]: "light" })), "light");
});

test("手动选择会保存；改回跟随系统时删掉保存的值", () => {
  const storage = fakeStorage();
  saveThemeChoice(storage, "dark");
  assert.equal(storage.data.get(THEME_STORAGE_KEY), "dark");
  saveThemeChoice(storage, "system");
  assert.equal(storage.data.has(THEME_STORAGE_KEY), false);
});

test("存储不可用时不报错", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(readThemeChoice(broken), "system");
  saveThemeChoice(broken, "dark");
  saveThemeChoice(null, "dark");
});

test("只改 <html> 的 data-theme：跟随系统 = 不设", () => {
  const root = { dataset: {} as DOMStringMap };
  applyThemeChoice(root, "dark");
  assert.equal(root.dataset["theme"], "dark");
  applyThemeChoice(root, "light");
  assert.equal(root.dataset["theme"], "light");
  applyThemeChoice(root, "system");
  assert.equal("theme" in root.dataset, false);
});

test("三个选项：跟随系统、亮色、暗色", () => {
  assert.deepEqual(THEME_OPTIONS.map((option) => option.label), ["跟随系统", "亮色", "暗色"]);
});

test("index.html 的内联脚本用同一个存储键，并且写在样式和应用脚本之前", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`localStorage.getItem("${THEME_STORAGE_KEY}")`));
  assert.ok(html.indexOf("localStorage.getItem") < html.indexOf('type="module"'));
  assert.match(html, /<html lang="zh-Hans">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/);
  assert.match(html, /<meta name="referrer" content="no-referrer" \/>/);
});
