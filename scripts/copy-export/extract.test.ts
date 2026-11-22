import { test } from "node:test";
import assert from "node:assert/strict";
import { extractCopy, hasCjk, headerLabel, isKeyTableFile, isKeyTableName } from "./extract.ts";

const texts = (source: string, fileName = "apps/web/src/pages/x/Page.tsx") => extractCopy(source, { fileName }).map((entry) => entry.text);

test("JSX 文字：同一元素里相邻的文字和变量合成一条，换行缩进合成空格，子元素把它断开", () => {
  const source = `export function P({ count, order }: { count: number; order: { no: string } }) {
  return (
    <section>
      <h1>订单详情</h1>
      <p>
        共 {count} 条，订单号 {order.no}，
        状态{format(count)}
      </p>
      <p>请点<strong>保存</strong>后继续</p>
      <span>{"直接写的字符串"}</span>
      <i>{count}</i>
      <b>NOZOMI</b>
    </section>
  );
}`;
  const entries = extractCopy(source, { fileName: "apps/web/src/pages/x/Page.tsx" });
  const byText = new Map(entries.map((entry) => [entry.text, entry]));
  assert.deepEqual(
    entries.map((entry) => entry.text),
    ["订单详情", "共 {count} 条，订单号 {no}， 状态{…}", "请点", "保存", "后继续", "直接写的字符串", "NOZOMI"],
  );
  assert.equal(byText.get("订单详情")?.role, "标题");
  assert.equal(byText.get("订单详情")?.kind, "jsx-text");
  assert.equal(byText.get("订单详情")?.line, 4);
  assert.equal(byText.get("共 {count} 条，订单号 {no}， 状态{…}")?.line, 6);
  assert.equal(byText.get("保存")?.context, "<strong>");
});

test("JSX 属性：含中文的都算；aria-label、placeholder 等给人看的属性只有英文也算；className 等不算", () => {
  const source = `const a = <input aria-label="出发地" placeholder="WhatsApp" className="field wide" title={"提示文字"} data-x="内部" />;
const b = <Button label={busy ? "保存中…" : "保存"} variant="primary" />;`;
  const entries = extractCopy(source, { fileName: "apps/web/src/components/A.tsx" });
  assert.deepEqual(
    entries.map((entry) => [entry.text, entry.kind, entry.context, entry.role]),
    [
      ["出发地", "jsx-attr", "aria-label", "读屏说明"],
      ["WhatsApp", "jsx-attr", "placeholder", "输入框占位"],
      ["提示文字", "jsx-attr", "title", "标题"],
      ["内部", "jsx-attr", "data-x", "文字"],
      ["保存中…", "string", "label", "名称"],
      ["保存", "string", "label", "名称"],
    ],
  );
});

test("模板字符串：${变量} 写成 {变量}，a.b.c 写成 {c}，复杂的写成 {…}；里面嵌的模板另算一条", () => {
  const source = "const n = 3;\nconst msg = `还差 ${n} 项，订单 ${order.no}，${items.map((i) => `第 ${i} 项`).join()}`;\nconst plain = `English only ${n}`;";
  assert.deepEqual(texts(source, "apps/web/src/lib/a.ts"), ["还差 {n} 项，订单 {no}，{…}", "第 {i} 项"]);
});

test("不抽：注释、日志、开发者异常、类型、属性名、比较、其他语言、数据库查询、字符串匹配", () => {
  const source = `// 注释里的中文
/** 文档注释里的中文 */
type Kind = "接机" | "送机";
interface Props { label: "标签" }
console.log("调试输出");
ctx.log.info({ msg: "日志" });
request.log.warn("日志二");
throw new Error("开发者看的异常");
assert.equal(x, "断言");
const table = { "属性名中文": 1, ok: "要抽的" };
if (value === "比较用") run();
const langs = { zh: "中文版", ja: "日本語版", en: "English" };
await db.query(\`select 1 -- 查询里的中文\`);
const q = sql\`update t set name = '中文'\`;
if (name.endsWith("区")) skip();
`;
  assert.deepEqual(texts(source, "apps/api/src/services/a.ts"), ["要抽的", "中文版"]);
});

test("错误提示：new AppError(...) 里的说明算，类型标成错误提示", () => {
  const source = `throw new AppError(409, "MAIL_NOT_CONFIGURED", "邮件发送还没有配置");`;
  const [entry] = extractCopy(source, { fileName: "apps/api/src/services/a.ts" });
  assert.equal(entry?.text, "邮件发送还没有配置");
  assert.equal(entry?.role, "错误提示");
  assert.equal(entry?.context, 'AppError("MAIL_NOT_CONFIGURED")');
});

test("key 表文件：全局 key（属性名都带点）原样用，标成 key-table；表外的字符串仍算写死", () => {
  const source = `export const CHARTER_AIRPORT_COPY = {
  "charter.scenario.airportStart": "{airport}接机 + {hours} 小时包车",
  "tenant.charterAirport.title": "机场套餐",
} as const;
export function fallback() { return "表外的文字"; }`;
  const entries = extractCopy(source, { fileName: "apps/web/src/lib/charter-airport-copy.ts" });
  assert.deepEqual(
    entries.map((entry) => [entry.key, entry.text, entry.kind]),
    [
      ["charter.scenario.airportStart", "{airport}接机 + {hours} 小时包车", "key-table"],
      ["tenant.charterAirport.title", "机场套餐", "key-table"],
      [null, "表外的文字", "string"],
    ],
  );
});

test("key 表文件：按语言分的表只取中文；ZH 常量不进 key；key = 文件名 + 属性名", () => {
  const source = `const ZH: Readonly<Record<K, string>> = {
  tripTitle: "行程",
  payDueNote: "请在 30 分钟内完成付款",
};
export const CHECKOUT_TEXTS = { zh: ZH, ja: {}, en: {} };`;
  const entries = extractCopy(source, { fileName: "apps/web/src/lib/checkout-texts.ts" });
  assert.deepEqual(
    entries.map((entry) => [entry.key, entry.text]),
    [
      ["checkout.tripTitle", "行程"],
      ["checkout.payDueNote", "请在 30 分钟内完成付款"],
    ],
  );
});

test("别的文件里 *_TEXTS 常量也是 key 表：zh 子树、箭头函数的返回值；ja / en 译文不收；key 带常量名", () => {
  const source = `export const VEHICLE_LABEL_TEXTS = {
  zh: { similar: "同级车型", maxPassengers: "最多乘客" },
  ja: { similar: "同クラス車種", maxPassengers: "最大乗車人数" },
};
export const FREE_WAIT_TEXTS = {
  minutes: (n: number) => \`免费等待 \${n} 分钟\`,
  unlimited: (flag: boolean) => (flag ? "不限" : "无"),
};
const OTHER = { title: "普通对象，写死" };`;
  const entries = extractCopy(source, { fileName: "packages/domain/src/vehicle-label.ts" });
  assert.deepEqual(
    entries.map((entry) => [entry.key, entry.text]),
    [
      ["vehicle-label.similar", "同级车型"],
      ["vehicle-label.maxPassengers", "最多乘客"],
      ["vehicle-label.freeWait.minutes", "免费等待 {n} 分钟"],
      ["vehicle-label.freeWait.unlimited.1", "不限"],
      ["vehicle-label.freeWait.unlimited.2", "无"],
      [null, "普通对象，写死"],
    ],
  );
});

test("key 表的约定：文件名、常量名", () => {
  assert.equal(isKeyTableFile("apps/web/src/lib/checkout-texts.ts"), true);
  assert.equal(isKeyTableFile("apps/web/src/lib/charter-airport-copy.ts"), true);
  assert.equal(isKeyTableFile("apps/web/src/i18n/zh.ts"), true);
  assert.equal(isKeyTableFile("apps/web/src/lib/use-copy-text.tsx"), false);
  assert.equal(isKeyTableName("EMBED_TEXTS"), true);
  assert.equal(isKeyTableName("TAB_COPY"), true);
  assert.equal(isKeyTableName("TEXTS"), false);
});

test("文件开头注释的第一句当页面名；没有中文注释的为 null", () => {
  assert.equal(headerLabel("/**\n * 运营后台「供应商」：列表、新建、详情。\n */\nexport {};"), "运营后台「供应商」");
  assert.equal(headerLabel("/** 官网行程报价页 `/book/trip`（M9T-09）的固定文案 */"), "官网行程报价页 /book/trip");
  assert.equal(headerLabel("import x from 'y';"), null);
  assert.equal(headerLabel("/** English only */"), null);
});

test("中日韩文字的判断", () => {
  assert.equal(hasCjk("保存"), true);
  assert.equal(hasCjk("ターミナル"), true);
  assert.equal(hasCjk("Save · 1"), false);
});
