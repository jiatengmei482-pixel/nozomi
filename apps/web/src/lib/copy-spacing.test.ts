/**
 * 文案的空格（M4-10）：中文和英文、数字之间隔一个空格（「按 JP 的必交清单」「NZ 开头的 18 位」，和 04-data-display.md 的「数字、单位隔一个空格」同一个口径）。
 * 扫前端源码里写死的文字（去掉注释，不含测试）；拼出来的文字（`${code}` 旁边的中文）由各页面的测试核对。
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

/** 去掉注释（换成空格，保留行号）；`//` 前面是冒号的（网址）不算注释。 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

/** 中文紧挨着英文字母或数字（`\n` 这类转义不算）。 */
const TIGHT = /[一-鿿][A-Za-z0-9]|(?<!\\)[A-Za-z0-9][一-鿿]/;

test("前端写死的文字里，中文和英文、数字之间都有空格", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, "扫到了源码");
  const tight = files.flatMap((file) =>
    withoutComments(readFileSync(file, "utf8"))
      .split("\n")
      .flatMap((line, index) => (TIGHT.test(line) ? [`${file.slice(SRC.length)}:${index + 1}  ${line.trim()}`] : [])),
  );
  assert.deepEqual(tight, []);
});

test("检查本身：认得出少空格的写法，注释和转义不算", () => {
  assert.ok(TIGHT.test("按JP的必交清单"));
  assert.ok(TIGHT.test("这3项"));
  assert.ok(!TIGHT.test("按 JP 的必交清单"));
  assert.ok(!TIGHT.test("\\n怎么配置"));
  assert.ok(!TIGHT.test(withoutComments("const a = 1; // 按JP的清单")));
  assert.ok(!TIGHT.test(withoutComments("/** 这3项 */")));
});
