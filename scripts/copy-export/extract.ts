/**
 * 固定文案清单（M11-02）的抽取：用 TypeScript 编译器把一个源文件解析成语法树，找出界面上会给人看的固定文字。
 *
 * 抽什么：
 * - JSX 里的文字（同一个元素里相邻的文字和 `{变量}` 合成一条，变量写成 `{名字}`，复杂表达式写成 `{…}`）；
 * - JSX 属性里的文字：含中日韩文字的一律算；`aria-label`、`title`、`placeholder`、`alt`、`label` 等给人看的属性，含任何字母也算；
 * - 代码里含中日韩文字的字符串和模板字符串（`${x}` 写成 `{x}`）；
 * - 文案 key 表里的条目（见下面「key 表的约定」），标成「已走 key」。
 *
 * 不抽：注释；`console.*`、`*.log.*`、`logger.*` 的参数；`new Error(...)` 等开发者看的异常；`RegExp`、断言；数据库查询（`*.query(...)`、`sql\`…\``）；
 * 类型里的字符串；对象的属性名；`===` / `!==` 比较的另一边（是在比数据，不是给人看）；`ja`、`en`、`ko` 等其他语言的译文。
 *
 * key 表的约定（以后的 i18n 公用模块照这个写就能自动认出来）：
 * 1. 文件名以 `-copy.ts` / `-texts.ts` 结尾，或放在 `i18n/` 目录下：文件里所有顶层 `const X = { ... }` 都是 key 表；
 * 2. 别的文件里名字以 `_COPY` / `_TEXTS` 结尾的顶层常量也是 key 表；
 * 3. 表里按语言分的（属性名是 `zh`、`ja`、`en`…），只取 `zh`；值是字符串、模板字符串或只返回字符串的箭头函数；
 * 4. 表的属性名全都带点（如 `tenant.charterAirport.title`）= 全局 key，原样用；否则 key = 文件名（去掉 `-copy` / `-texts`）+ 常量名 + 属性路径。
 */
import ts from "typescript";

export type EntryKind = "jsx-text" | "jsx-attr" | "string" | "template" | "key-table";

export interface RawEntry {
  text: string;
  line: number;
  kind: EntryKind;
  /** 给业主看的类型：标题、按钮、说明、提示… */
  role: string;
  /** 附近的代码线索：属性名、变量名、调用的函数、所在的 JSX 标签 */
  context: string;
  /** 只有 key 表的条目有 */
  key: string | null;
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER = /\p{L}/u;

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}

/** 不是中文的语言：这些属性下面是译文，不进中文清单 */
const OTHER_LANGS = new Set(["ja", "en", "ko", "ja-JP", "en-US", "en-GB", "ko-KR", "zh-TW", "zh-HK", "zh-Hant", "zhTW", "zhHant", "zh_TW"]);
const ZH_LANGS = new Set(["zh", "zh-CN", "zhCN", "zh_CN", "zh-Hans"]);
const LANG_CONST = /^(ZH|JA|EN|KO)(_[A-Z]+)?$/;

/** 给人看的 JSX 属性：值里只有拉丁字母（如「WhatsApp」）也算文案 */
const USER_FACING_ATTRS = new Set(["aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder", "title", "placeholder", "alt", "label", "description", "hint", "help", "message", "caption", "heading", "summary", "text", "emptyText", "lead", "legend", "confirmLabel", "cancelLabel", "submitLabel", "actionLabel"]);

/** 抽到这些调用里面的字符串不算文案 */
function isExcludedCall(node: ts.CallExpression | ts.NewExpression): boolean {
  const callee = node.expression;
  if (ts.isNewExpression(node)) return ts.isIdentifier(callee) && /^(Error|TypeError|RangeError|SyntaxError|AssertionError|RegExp)$/.test(callee.text);
  if (ts.isIdentifier(callee)) return /^(assert|RegExp|require|describe|test|it)$/.test(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    const target = callee.expression.getText();
    if (/(^|\.)(console|log|logger)$/i.test(target)) return true;
    if (/^assert$/.test(target)) return true;
    if (/^(query|startsWith|endsWith|includes|indexOf|lastIndexOf|match|matchAll|search|test|has)$/.test(callee.name.text)) return true;
  }
  return false;
}

function propName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return null;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

/** 表达式在文案里的占位：变量 → {名字}，`a.b.c` → {c}，其他 → {…} */
function placeholder(expression: ts.Expression): string {
  const inner = unwrap(expression);
  if (ts.isIdentifier(inner)) return `{${inner.text}}`;
  if (ts.isPropertyAccessExpression(inner)) return `{${inner.name.text}}`;
  if (ts.isStringLiteralLike(inner)) return inner.text;
  return "{…}";
}

function templateText(node: ts.TemplateExpression): string {
  let text = node.head.text;
  for (const span of node.templateSpans) text += placeholder(span.expression) + span.literal.text;
  return text;
}

function templateHasCjk(node: ts.TemplateExpression): boolean {
  return hasCjk(node.head.text) || node.templateSpans.some((span) => hasCjk(span.literal.text));
}

/** JSX 里的一段文字：换行和缩进合成一个空格 */
function jsxTextValue(raw: string): string {
  return raw.replace(/\s*[\r\n]+\s*/g, " ");
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): string {
  if (ts.isJsxFragment(node)) return "<>";
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return tag.getText();
}

function roleForTag(tag: string): string {
  if (/^h[1-6]$/.test(tag) || /(Title|Header|Heading)$/.test(tag)) return "标题";
  if (/^button$/i.test(tag) || /Button$/.test(tag)) return "按钮";
  if (/^(a|Link|NavLink)$/.test(tag) || /Link$/.test(tag)) return "链接";
  if (/^(label|legend)$/.test(tag)) return "表单标签";
  if (/^th$/.test(tag)) return "表头";
  if (/^option$/.test(tag)) return "选项";
  if (/Alert|Notice|Toast/.test(tag)) return "提示";
  return "正文";
}

function roleForName(name: string): string {
  if (/^aria-/.test(name)) return "读屏说明";
  if (name === "placeholder") return "输入框占位";
  if (name === "alt") return "图片说明";
  if (/^(subject)$/.test(name)) return "邮件主题";
  if (/^(body|html)$/.test(name)) return "邮件正文";
  if (/title|heading|caption|legend/i.test(name)) return "标题";
  if (/(confirm|cancel|submit|action|button)(Label|Text)?$/i.test(name)) return "按钮";
  if (/label|name$/i.test(name)) return "名称";
  if (/hint|help|description|lead|summary|note|intro/i.test(name)) return "说明";
  if (/error|message|warning|reason|fail|invalid|required/i.test(name)) return "提示";
  if (/empty/i.test(name)) return "空状态";
  return "文字";
}

/** 往上找最近的代码线索 */
function contextOf(node: ts.Node): { context: string; role: string } {
  let current: ts.Node = node;
  let parent = node.parent;
  while (parent !== undefined) {
    if (ts.isJsxAttribute(parent)) {
      const name = parent.name.getText();
      return { context: name, role: roleForName(name) };
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === current) {
      const name = propName(parent.name) ?? parent.name.getText();
      return { context: name, role: roleForName(name) };
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      const name = parent.name.getText();
      return { context: name, role: roleForName(name) };
    }
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.includes(current as ts.Expression)) {
      const callee = parent.expression.getText();
      const literalArgs = (parent.arguments ?? []).filter((arg): arg is ts.StringLiteral => ts.isStringLiteral(arg) && !hasCjk(arg.text) && arg.text.length <= 40).map((arg) => JSON.stringify(arg.text));
      const context = literalArgs.length > 0 ? `${callee}(${literalArgs.slice(0, 2).join(", ")})` : `${callee}()`;
      if (/AppError|Failed|Conflict|notFound|invalid|reject|issue|Error$/i.test(callee)) return { context, role: "错误提示" };
      if (/^set[A-Z]\w*(Error|Errors|Problem)$/.test(callee)) return { context, role: "提示" };
      if (/toast|notify|announce/i.test(callee)) return { context, role: "提示" };
      if (/DocumentTitle/.test(callee)) return { context, role: "浏览器标题" };
      const index = (parent.arguments ?? []).indexOf(current as ts.Expression);
      if (callee === "zhEmail") return { context, role: index === 2 ? "邮件主题" : index === 3 ? "邮件正文" : "邮件" };
      return { context, role: "文字" };
    }
    if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) {
      const fn = ts.findAncestor(parent, (n) => ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && ts.isVariableDeclaration(n.parent)));
      if (fn !== undefined) {
        const name = ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) ? fn.name?.getText() : (fn.parent as ts.VariableDeclaration).name.getText();
        if (name !== undefined) return { context: `${name}()`, role: roleForName(name) };
      }
      return { context: "", role: "文字" };
    }
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxFragment(parent)) {
      const tag = tagName(parent);
      return { context: `<${tag}>`, role: roleForTag(tag) };
    }
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) return { context: "", role: "文字" };
    current = parent;
    parent = parent.parent;
  }
  return { context: "", role: "文字" };
}

export interface ExtractOptions {
  /** 文件名（只用来定 key 的前缀和判断是不是 key 表文件），如 `apps/web/src/lib/checkout-texts.ts` */
  fileName: string;
}

export function isKeyTableFile(fileName: string): boolean {
  return /-(copy|texts)\.tsx?$/.test(fileName) || /(^|\/)i18n\//.test(fileName);
}

export function isKeyTableName(name: string): boolean {
  return /_(COPY|TEXTS)$/.test(name);
}

function fileNamespace(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  return base.replace(/\.tsx?$/, "").replace(/-(copy|texts)$/, "");
}

const squash = (name: string): string => name.replace(/[^a-z0-9]/gi, "").toLowerCase();

/** `CHARTER_OVERAGE_TEXTS` → `charterOverage` */
function constNamespace(name: string): string {
  const stripped = name.replace(/_(COPY|TEXTS)$/, "");
  if (stripped !== stripped.toUpperCase()) return stripped;
  return stripped.toLowerCase().replace(/_([a-z0-9])/g, (_whole, ch: string) => ch.toUpperCase());
}

interface TableItem {
  path: string[];
  node: ts.StringLiteralLike | ts.TemplateExpression;
}

function collectTable(object: ts.ObjectLiteralExpression, path: string[], items: TableItem[], claimed: Set<ts.Node>): void {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propName(property.name);
    if (name === null || OTHER_LANGS.has(name)) continue;
    const next = ZH_LANGS.has(name) ? path : [...path, name];
    const value = unwrap(property.initializer);
    if (ts.isObjectLiteralExpression(value)) {
      collectTable(value, next, items, claimed);
      continue;
    }
    const literals = tableLiterals(value);
    literals.forEach((node, index) => {
      items.push({ path: literals.length > 1 ? [...next, String(index + 1)] : next, node });
      claimed.add(node);
    });
  }
}

/** 表里一个值对应的字符串：字符串本身，或只返回字符串的箭头函数（三目运算两边都算） */
function tableLiterals(value: ts.Expression): Array<ts.StringLiteralLike | ts.TemplateExpression> {
  const inner = unwrap(value);
  if (ts.isStringLiteralLike(inner) || ts.isTemplateExpression(inner)) return [inner];
  if (ts.isConditionalExpression(inner)) return [...tableLiterals(inner.whenTrue), ...tableLiterals(inner.whenFalse)];
  if (ts.isArrowFunction(inner) && !ts.isBlock(inner.body)) return tableLiterals(inner.body);
  return [];
}

/** 行号从 1 起；JSX 文字从第一个不是空白的字算 */
function lineOf(source: ts.SourceFile, node: ts.Node): number {
  const start = node.getStart(source);
  const offset = ts.isJsxText(node) ? node.text.length - node.text.trimStart().length : 0;
  return source.getLineAndCharacterOfPosition(start + offset).line + 1;
}

function isPropertyNamePosition(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isComputedPropertyName(parent)) return true;
  return false;
}

function isComparisonOperand(node: ts.Node): boolean {
  const parent = node.parent;
  if (parent === undefined || !ts.isBinaryExpression(parent)) return false;
  const op = parent.operatorToken.kind;
  return op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken;
}

export function extractCopy(sourceText: string, options: ExtractOptions): RawEntry[] {
  const isTsx = options.fileName.endsWith(".tsx");
  const source = ts.createSourceFile(options.fileName, sourceText, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const entries: RawEntry[] = [];
  const claimed = new Set<ts.Node>();

  // 第一遍：key 表
  const tableFile = isKeyTableFile(options.fileName);
  const ns = fileNamespace(options.fileName);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const name = declaration.name.text;
      if (!tableFile && !isKeyTableName(name)) continue;
      const value = unwrap(declaration.initializer);
      if (!ts.isObjectLiteralExpression(value)) continue;
      const items: TableItem[] = [];
      collectTable(value, [], items, claimed);
      if (items.length === 0) continue;
      const global = items.every((item) => (item.path[0] ?? "").includes("."));
      const prefix = [ns];
      if (!LANG_CONST.test(name) && squash(constNamespace(name)) !== squash(ns)) prefix.push(constNamespace(name));
      for (const item of items) {
        const key = global ? item.path.join(".") : [...prefix, ...item.path].join(".");
        const text = ts.isTemplateExpression(item.node) ? templateText(item.node) : item.node.text;
        const last = item.path.filter((segment) => !/^\d+$/.test(segment)).pop() ?? name;
        entries.push({ text, line: lineOf(source, item.node), kind: "key-table", role: roleForName(last.split(".").pop() ?? last), context: name, key });
      }
    }
  }
  // 同一个文件里 key 撞了：后面的加 ~2、~3
  const seenKeys = new Map<string, number>();
  for (const entry of entries) {
    if (entry.key === null) continue;
    const count = (seenKeys.get(entry.key) ?? 0) + 1;
    seenKeys.set(entry.key, count);
    if (count > 1) entry.key = `${entry.key}~${count}`;
  }

  const push = (node: ts.Node, text: string, kind: EntryKind, override?: { role: string; context: string }): void => {
    const { context, role } = override ?? contextOf(node);
    entries.push({ text, line: lineOf(source, node), kind, role, context: context.replace(/\s+/g, "").slice(0, 80), key: null });
  };

  const visitJsxChildren = (element: ts.JsxElement | ts.JsxFragment): void => {
    const tag = tagName(element);
    let run: { start: ts.Node; text: string; letters: boolean } | null = null;
    const flush = (): void => {
      if (run !== null && run.letters) {
        const text = run.text.replace(/\s+/g, " ").trim();
        if (text !== "") push(run.start, text, "jsx-text", { context: `<${tag}>`, role: roleForTag(tag) });
      }
      run = null;
    };
    const append = (node: ts.Node, text: string, literal: boolean): void => {
      if (run === null) run = { start: node, text: "", letters: false };
      run.text += text;
      if (literal && LETTER.test(text)) run.letters = true;
    };
    for (const child of element.children) {
      if (ts.isJsxText(child)) {
        if (child.containsOnlyTriviaWhiteSpaces) continue;
        append(child, jsxTextValue(child.text), true);
      } else if (ts.isJsxExpression(child)) {
        if (child.expression === undefined) continue;
        const inner = unwrap(child.expression);
        if (ts.isStringLiteralLike(inner)) {
          claimed.add(inner);
          append(child, inner.text, true);
        } else {
          append(child, placeholder(inner), false);
          visit(child.expression);
        }
      } else {
        flush();
        visit(child);
      }
    }
    flush();
  };

  const visit = (node: ts.Node): void => {
    if (claimed.has(node)) return;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) return;
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && isExcludedCall(node)) return;
    if (ts.isTaggedTemplateExpression(node) && /(^|\.)sql$/i.test(node.tag.getText())) return;
    if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      if (name !== null && OTHER_LANGS.has(name)) return;
      visit(node.initializer);
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      if (ts.isJsxElement(node)) visit(node.openingElement);
      visitJsxChildren(node);
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const init = node.initializer;
      if (init === undefined) return;
      const value = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression !== undefined && ts.isStringLiteralLike(unwrap(init.expression)) ? (unwrap(init.expression) as ts.StringLiteralLike) : null;
      if (value !== null) {
        if (hasCjk(value.text) || (USER_FACING_ATTRS.has(name) && LETTER.test(value.text))) push(value, value.text, "jsx-attr", { context: name, role: roleForName(name) });
        return;
      }
      ts.forEachChild(init, visit);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (hasCjk(node.text) && !isPropertyNamePosition(node) && !isComparisonOperand(node)) push(node, node.text, "string");
      return;
    }
    if (ts.isTemplateExpression(node)) {
      if (templateHasCjk(node) && !isComparisonOperand(node)) push(node, templateText(node), "template");
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return entries.sort((a, b) => a.line - b.line);
}

/** 文件开头注释的第一句（到第一个「（」「：」「。」「，」为止），给业主看的页面 / 模块名 */
export function headerLabel(sourceText: string): string | null {
  const match = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(sourceText);
  if (match === null) return null;
  const firstLine = (match[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .find((line) => line !== "");
  if (firstLine === undefined) return null;
  const clause = firstLine.split(/[（(：:。，,；;]/)[0]?.replace(/`/g, "").trim() ?? "";
  if (clause === "" || !hasCjk(clause)) return null;
  return clause.length > 30 ? `${clause.slice(0, 30)}…` : clause;
}
