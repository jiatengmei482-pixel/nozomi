/**
 * 日期输入框的占位文字（M4-12，02-components.md 第 27 节）：占位写格式「年-月-日」（月份写「年-月」），具体例子放在说明文字里——
 * 占位里放一个像真日期的例子，容易被看成已经填好的值，日子过了还会变成一个过去的日期。扫前端源码里写死的占位（不含测试）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "testing" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** 占位的值：`placeholder="…"`、`placeholder={…}`（到第一个 `}`）、`placeholder: "…"`。 */
const PLACEHOLDER = /placeholder\s*(?:=\s*(?:"[^"]*"|\{[^}]*\})|:\s*"[^"]*")/g;
/** 像日期（年-月，可带日）的数字。 */
const DATE_LIKE = /\d{4}\s*[-/.年]\s*\d{1,2}/;
const hasDatePlaceholder = (line: string): boolean => (line.match(PLACEHOLDER) ?? []).some((value) => DATE_LIKE.test(value));

test("前端没有用具体日期（或月份）做占位文字的输入框", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, "扫到了源码");
  const found = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index) => (hasDatePlaceholder(line) ? [`${file.slice(SRC.length)}:${index + 1}  ${line.trim()}`] : [])),
  );
  assert.deepEqual(found, []);
});

test("检查本身：认得出各种写法的日期占位，格式占位和时刻占位不算", () => {
  for (const line of ['placeholder="2026-10-08"', 'placeholder: "2026-01-01", tidy', 'placeholder={field === "to" ? "一直有效" : "2026-01-31"}', 'placeholder="2026-09" autoComplete', 'placeholder="2026/10/8"']) assert.ok(hasDatePlaceholder(line), line);
  for (const line of ['placeholder="年-月-日"', 'placeholder="年-月"', 'placeholder="08:00"', 'placeholder="+81 90 1234 5678"', 'placeholder={field === "to" ? "一直有效" : "年-月-日"}', 'hint="写成 2026-09 这样"']) assert.ok(!hasDatePlaceholder(line), line);
});

/**
 * M4-12 测试角色：上面的检查能被绕过（缺陷，交前端）。下面这些写法都把一个具体日期放进了占位，现在都扫不出来：
 * 单引号、对象里用反引号、`placeholder={…}` 里先出现 `${…}` 的 `}` 就截断了、占位换行写、紧凑写法 `20261008`（time-input.ts 认这种写法）、月/日/年。
 * 期望：都认得出来。实际：hasDatePlaceholder 全部返回 false，「前端没有用具体日期做占位」那条测试照样通过。
 * 用常量间接传进去（`placeholder={EXAMPLE_DATE}`）这种按行扫的检查认不出来，不算在这里。
 */
test("检查本身（M4-12 测试角色）：单引号、反引号、插值、紧凑和月/日/年写法的日期占位也认得出", () => {
  const bypasses = [
    "placeholder='2026-10-08'",
    "placeholder: '2026-10-08', tidy",
    "placeholder: `2026-10-08`, tidy",
    'placeholder={field === "to" ? `${until}` : "2026-01-31"}',
    'placeholder="20261008"',
    'placeholder="10/08/2026"',
  ];
  assert.deepEqual(bypasses.filter((line) => !hasDatePlaceholder(line)), []);
});

test("检查本身（M4-12 测试角色）：占位换行写（JSX 属性值跨行）时也认得出", () => {
  const source = ['<input', "  placeholder={", '    field === "to" ? "一直有效" : "2026-01-31"', "  }", "/>"];
  assert.ok(source.some(hasDatePlaceholder), "按行扫，跨行的占位整段漏掉");
});
