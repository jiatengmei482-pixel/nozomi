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

/** 像日期的写法（time-input.ts 的 tidyDate 认的那些，加上月份和月/日/年）：`2026-10-08`、`2026/10/8`、`2026.10`、`2026年10月`、`20261008`、`10/08/2026`。 */
const DATE_LIKE = [/\d{4}\s*[-/.年]\s*\d{1,2}/, /(?<!\d)(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?!\d)/, /(?<!\d)\d{1,2}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{4}(?!\d)/];

/**
 * 从 `from` 起读一个属性值或表达式，返回它的原文：引号（单、双、反引号）读到配对的引号；`{…}` 读到配对的花括号；
 * 其余（对象属性 `placeholder: …`）读到同一层的 `,`、`}`、`)`、`;`。字符串、反引号里的 `${…}` 里的括号不算层数。
 */
function readValue(text: string, from: number): string {
  const wrapped = /["'`{]/.test(text[from] ?? "");
  const stack: string[] = [];
  for (let i = from; i < text.length; i += 1) {
    const char = text[i]!;
    const top = stack[stack.length - 1];
    if (top === '"' || top === "'" || top === "`") {
      if (char === "\\") i += 1;
      else if (char === top) stack.pop();
      else if (top === "`" && char === "$" && text[i + 1] === "{") {
        stack.push("{");
        i += 1;
      }
    } else if (char === '"' || char === "'" || char === "`" || char === "{" || char === "(" || char === "[") stack.push(char);
    else if (char === "}" || char === ")" || char === "]") {
      if (stack.length === 0) return text.slice(from, i);
      stack.pop();
    } else if (stack.length === 0 && (char === "," || char === ";" || char === "\n")) return text.slice(from, i);
    if (wrapped && stack.length === 0) return text.slice(from, i + 1);
  }
  return text.slice(from);
}

/**
 * 这一段源码里有没有用具体日期（或月份）做占位：`placeholder="…"`、`placeholder={…}`、`placeholder: …`，按值整体读（可以跨行）。
 * 按行扫时把整份源码的行数组传进来（和 `Array.prototype.some` 的回调同一个签名）：从这一行开始读，跨到后面的行。
 */
function hasDatePlaceholder(line: string, index?: number, lines?: readonly string[]): boolean {
  const text = lines !== undefined && index !== undefined ? lines.slice(index).join("\n") : line;
  const firstLineEnd = lines !== undefined && index !== undefined ? line.length : text.length;
  const key = /placeholder\s*[=:]\s*/g;
  for (let match = key.exec(text); match !== null && match.index < firstLineEnd; match = key.exec(text)) {
    const value = readValue(text, match.index + match[0].length);
    if (DATE_LIKE.some((pattern) => pattern.test(value))) return true;
  }
  return false;
}

test("前端没有用具体日期（或月份）做占位文字的输入框", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, "扫到了源码");
  const found = files.flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, index, lines) => (hasDatePlaceholder(line, index, lines) ? [`${file.slice(SRC.length)}:${index + 1}  ${line.trim()}`] : [])),
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
