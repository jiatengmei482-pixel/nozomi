/**
 * 邮件的 HTML 版（M6-06，ADR 0067）：把纯文字正文排成一封带品牌页眉的 HTML 邮件。纯函数，发信时由 apps/api/src/integrations/smtp.ts 调用，
 * 纯文字版照旧一起发（multipart/alternative）。
 *
 * - **文字一字不改**：只加品牌页眉「NOZOMI」，不加任何新文案；网址按钮的文字就是网址本身。
 * - **先转义再排版**：正文里有客人填写的内容，所有文字都经 `escapeHtml`；链接只认 http / https，其他协议原样当文字。
 * - 邮件客户端不认 CSS 变量和外部资源：颜色写死十六进制（取自 docs/design/tokens.css，单元测试逐个比对令牌），只用系统字体，表格布局 + 内联样式。
 */

/** 亮色主题用到的令牌（docs/design/tokens.css 的 `:root`）。 */
export const MAIL_LIGHT_COLORS = {
  "color-bg-page": "#F4F5F7",
  "color-bg-surface": "#FFFFFF",
  "color-bg-subtle": "#ECEEF2",
  "color-border-default": "#D6DAE1",
  "color-text-primary": "#1A1F29",
  "color-text-link": "#2A45B0",
  "color-primary": "#2A45B0",
  "color-on-primary": "#FFFFFF",
  "color-brand": "#1B2A5C",
  "color-on-brand": "#FFFFFF",
} as const;

/** 暗色主题用到的令牌（docs/design/tokens.css 的 `@media (prefers-color-scheme: dark)`）。 */
export const MAIL_DARK_COLORS = {
  "color-bg-page": "#0F1217",
  "color-bg-surface": "#171B22",
  "color-bg-subtle": "#1E232C",
  "color-border-default": "#2D3440",
  "color-text-primary": "#E6E9EE",
  "color-text-link": "#A9BBFF",
  "color-primary": "#4466E0",
  "color-on-primary": "#FFFFFF",
  "color-brand": "#141C3D",
  "color-on-brand": "#FFFFFF",
} as const satisfies Record<keyof typeof MAIL_LIGHT_COLORS, string>;

const L = MAIL_LIGHT_COLORS;
const D = MAIL_DARK_COLORS;

/** 系统字体栈：令牌 font-family-sans 与 font-family-sans-ja 合并（中文、日文都有合适的字体）。写在 style 属性里，所以名字用单引号。 */
const FONT_SANS = "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans GB', 'Yu Gothic UI', 'Yu Gothic', Meiryo, 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Noto Sans SC', 'Noto Sans JP', sans-serif";
/** 令牌 font-family-mono。 */
const FONT_MONO = "ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, 'Liberation Mono', Menlo, monospace";

/** 品牌字标（ADR 0066：文字，不用图片）。 */
export const MAIL_BRAND_WORDMARK = "NOZOMI";

/** 单独一行、只有 4–8 位数字：验证码。 */
const CODE_LINE = /^\d{4,8}$/;
/** 行内网址的候选：http(s):// 后面跟网址里能出现的英文字符；中文标点（「。」「）」等）天然不在里面。 */
const INLINE_URL = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
/** 网址末尾常跟着的英文标点，不算网址的一部分。 */
const TRAILING_PUNCTUATION = /[.,;:!?'")\]]+$/;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);
}

/** 只认 http / https 的绝对网址；其他协议（javascript:、data:、file: 等）和看不懂的一律不是链接。 */
function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value) || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** 一行文字：转义，行内的 http(s) 网址变成可点的链接，其余原样。 */
function inlineHtml(line: string): string {
  let out = "";
  let at = 0;
  for (const match of line.matchAll(INLINE_URL)) {
    const start = match.index;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    out += escapeHtml(line.slice(at, start));
    if (isHttpUrl(url)) {
      out += `<a href="${escapeHtml(url)}" style="color:${L["color-text-link"]};text-decoration:underline;word-break:break-all;" class="nz-link">${escapeHtml(url)}</a>`;
    } else {
      out += escapeHtml(url);
    }
    at = start + url.length;
  }
  return out + escapeHtml(line.slice(at));
}

type Block = { kind: "text"; lines: string[] } | { kind: "url"; url: string } | { kind: "code"; code: string };

/** 一段（空行之间）拆成连续的文字行、单独一行的网址、单独一行的验证码。 */
function paragraphBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (isHttpUrl(trimmed)) blocks.push({ kind: "url", url: trimmed });
    else if (CODE_LINE.test(trimmed)) blocks.push({ kind: "code", code: trimmed });
    else {
      const last = blocks.at(-1);
      if (last?.kind === "text") last.lines.push(line);
      else blocks.push({ kind: "text", lines: [line] });
    }
  }
  return blocks;
}

function paragraphs(text: string): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      if (current.length > 0) groups.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

const P_STYLE = `margin:0 0 16px 0;font-size:16px;line-height:1.7;color:${L["color-text-primary"]};`;

function blockHtml(block: Block): string {
  switch (block.kind) {
    case "text":
      return `<p class="nz-text" style="${P_STYLE}">${block.lines.map(inlineHtml).join("<br>")}</p>`;
    case "url": {
      const href = escapeHtml(block.url);
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;border-collapse:separate;max-width:100%;"><tr>`
        + `<td class="nz-button" bgcolor="${L["color-primary"]}" style="background-color:${L["color-primary"]};border-radius:8px;">`
        + `<a class="nz-button-link" href="${href}" style="display:inline-block;padding:12px 20px;font-family:${FONT_SANS};font-size:15px;line-height:1.4;font-weight:600;color:${L["color-on-primary"]};text-decoration:none;word-break:break-all;border-radius:8px;">${href}</a>`
        + `</td></tr></table>`;
    }
    case "code":
      return `<p class="nz-code" style="margin:4px 0 20px 0;padding:12px 20px;display:inline-block;font-family:${FONT_MONO};font-size:32px;line-height:1.25;font-weight:700;letter-spacing:0.3em;color:${L["color-text-primary"]};background-color:${L["color-bg-subtle"]};border-radius:8px;">${escapeHtml(block.code)}</p>`;
  }
}

/** 暗色：支持 prefers-color-scheme 的客户端（Apple Mail、iOS 等）换成暗色令牌；不支持的显示亮色，或由客户端自己反色。 */
const DARK_CSS = `@media (prefers-color-scheme: dark) {
  .nz-page { background-color:${D["color-bg-page"]} !important; }
  .nz-card { background-color:${D["color-bg-surface"]} !important; border-color:${D["color-border-default"]} !important; }
  .nz-brand { background-color:${D["color-brand"]} !important; }
  .nz-wordmark { color:${D["color-on-brand"]} !important; }
  .nz-text, .nz-code { color:${D["color-text-primary"]} !important; }
  .nz-code { background-color:${D["color-bg-subtle"]} !important; }
  .nz-link { color:${D["color-text-link"]} !important; }
  .nz-button { background-color:${D["color-primary"]} !important; }
  .nz-button-link { color:${D["color-on-primary"]} !important; }
}
@media (max-width: 620px) {
  .nz-outer { padding:0 !important; }
  .nz-body { padding:24px 20px 8px 20px !important; }
  .nz-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
}`;

/** 纯文字正文 → 带品牌页眉的 HTML 邮件。正文为空时只有页眉。 */
export function renderMailHtml(input: { subject: string; text: string }): string {
  const body = paragraphs(input.text).flatMap(paragraphBlocks).map(blockHtml).join("\n");
  return `<!DOCTYPE html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.subject)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
${DARK_CSS}
</style>
</head>
<body class="nz-page" style="margin:0;padding:0;background-color:${L["color-bg-page"]};font-family:${FONT_SANS};-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nz-page" bgcolor="${L["color-bg-page"]}" style="background-color:${L["color-bg-page"]};">
<tr><td class="nz-outer" align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="nz-card" bgcolor="${L["color-bg-surface"]}" style="width:100%;max-width:600px;background-color:${L["color-bg-surface"]};border:1px solid ${L["color-border-default"]};border-radius:10px;border-collapse:separate;overflow:hidden;">
<tr><td class="nz-brand" bgcolor="${L["color-brand"]}" style="background-color:${L["color-brand"]};padding:20px 32px;border-radius:10px 10px 0 0;">
<span class="nz-wordmark" style="font-family:${FONT_SANS};font-size:20px;line-height:1.25;font-weight:700;letter-spacing:0.14em;color:${L["color-on-brand"]};">${MAIL_BRAND_WORDMARK}</span>
</td></tr>
<tr><td class="nz-body" style="padding:32px 32px 16px 32px;font-family:${FONT_SANS};font-size:16px;line-height:1.7;color:${L["color-text-primary"]};">
${body}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}
