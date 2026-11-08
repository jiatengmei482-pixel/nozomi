import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailCodeMail } from "./email-login.ts";
import { MAIL_BRAND_WORDMARK, MAIL_DARK_COLORS, MAIL_LIGHT_COLORS, renderMailHtml } from "./mail-html.ts";

const render = (text: string, subject = "主题"): string => renderMailHtml({ subject, text });

/** <body> 里的内容（不含 <head> 的标题和样式）。 */
const bodyOf = (html: string): string => html.slice(html.indexOf("<body"), html.indexOf("</body>"));

/** 去掉标签（行内的链接直接去掉，其余当空白）、还原实体、空白归一化：读者在 HTML 版里看到的文字。 */
function visibleText(html: string): string {
  return bodyOf(html)
    .replace(/<br>/g, "\n")
    .replace(/<a\b[^>]*>|<\/a>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
const normalized = (text: string): string => text.replace(/\s+/g, " ").trim();
const hrefs = (html: string): string[] => [...bodyOf(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1] as string);

test("转义：<script>、&、引号都转成实体，正文里写的标签不会变成 HTML", () => {
  const html = render(`客人备注：<script>alert("x")</script> & 'y' <img src=x onerror=alert(1)>`, `<b>主题</b> & "引号"`);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39; &lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("<title>&lt;b&gt;主题&lt;/b&gt; &amp; &quot;引号&quot;</title>"));
});

test("分段与换行：空行分段（多个空行、只有空格的行也算），段内换行是 <br>；\\r\\n 一样处理", () => {
  const html = render("第一段第一行\n第一段第二行\n\n\n第二段\r\n   \r\n第三段第一行\r\n第三段第二行");
  const paragraphs = [...bodyOf(html).matchAll(/<p class="nz-text"[^>]*>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(paragraphs, ["第一段第一行<br>第一段第二行", "第二段", "第三段第一行<br>第三段第二行"]);
});

test("单独一行的 http(s) 网址：做成按钮，href 和按钮文字都是网址原文；同一段前后的文字照常换行", () => {
  const url = "https://nozomi.example/orders/view?token=abc_DEF-123&lang=zh";
  const html = render(`查看和管理订单：\n${url}\n这个链接只属于您的这张订单。`);
  assert.deepEqual(hrefs(html), [url.replace("&", "&amp;")]);
  const button = bodyOf(html).match(/<td class="nz-button"[^>]*>(.*?)<\/td>/)?.[1] ?? "";
  assert.match(button, /^<a class="nz-button-link" href="https:\/\/nozomi\.example\/orders\/view\?token=abc_DEF-123&amp;lang=zh"[^>]*>https:\/\/nozomi\.example\/orders\/view\?token=abc_DEF-123&amp;lang=zh<\/a>$/);
  assert.match(button, new RegExp(`background-color:${MAIL_LIGHT_COLORS["color-primary"]}|color:${MAIL_LIGHT_COLORS["color-on-primary"]}`));
  assert.ok(bodyOf(html).includes(`<p class="nz-text" style="margin:0 0 16px 0;font-size:16px;line-height:1.7;color:${MAIL_LIGHT_COLORS["color-text-primary"]};">查看和管理订单：</p>`));
  assert.ok(bodyOf(html).includes(">这个链接只属于您的这张订单。</p>"));
  assert.ok(render(`  ${url}  `).includes('class="nz-button"'), "前后的空白不影响");
  assert.ok(render("HTTP://NOZOMI.EXAMPLE/A").includes('class="nz-button"'), "协议大小写都认");
});

test("行内网址：变成可点的链接，后面紧跟的中文、英文标点不算网址", () => {
  const html = render("请到 https://a.example/x?y=1。也可以看（https://b.example/z）或 http://c.example/w. 谢谢");
  assert.deepEqual(hrefs(html), ["https://a.example/x?y=1", "https://b.example/z", "http://c.example/w"]);
  assert.ok(bodyOf(html).includes(">https://a.example/x?y=1</a>。也可以看（"));
  assert.ok(bodyOf(html).includes(">http://c.example/w</a>. 谢谢"));
  assert.ok(!html.includes('class="nz-button"'), "行内的不是按钮");
});

test("只认 http / https：其他协议、没有主机的、带引号想跳出属性的，都原样当文字", () => {
  for (const text of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://files.example/a", "mailto:a@example.com", "vbscript:msgbox", "https://", "JAVASCRIPT:alert(1)", "前面 javascript:alert(1) 后面"]) {
    const html = render(text);
    assert.deepEqual(hrefs(html), [], text);
    assert.equal(visibleText(html), `${MAIL_BRAND_WORDMARK} ${normalized(text)}`, text);
  }
  const quoted = render(`https://a.example/"onmouseover="alert(1)`);
  assert.ok(!quoted.includes(`"onmouseover="`), "引号被转义，跳不出 href 属性");
  for (const href of hrefs(quoted)) assert.match(href, /^https?:\/\//);
});

test("验证码：单独一行 4–8 位数字用大号等宽字显示；3 位、9 位、夹在文字里的不算", () => {
  const mail = emailCodeMail("platform", "482913");
  const html = render(mail.text, mail.subject);
  const code = bodyOf(html).match(/<p class="nz-code" style="([^"]*)">(\d+)<\/p>/);
  assert.equal(code?.[2], "482913");
  assert.match(code?.[1] ?? "", /font-size:32px/);
  assert.match(code?.[1] ?? "", /font-family:ui-monospace/);
  assert.match(code?.[1] ?? "", /letter-spacing:0\.3em/);
  for (const text of ["1234", "12345678"]) assert.ok(render(text).includes('class="nz-code"'), text);
  for (const text of ["123", "123456789", "验证码 482913", "48 29 13", "４８２９１３"]) assert.ok(!render(text).includes('class="nz-code"'), text);
});

test("文字和纯文字版一致：HTML 去掉标签后，除了页眉的字标就是原文（空白归一化）", () => {
  const samples = [
    emailCodeMail("tenant", "004217").text,
    "王小明，您好：\n\n我们已收到您的付款，订单已确认。\n\n订单号：N-2026-0001\n用车时间：2026-11-20 09:30（当地时间）\n行程：成田机场 T1 → 东京站\n已付金额：¥12,800\n\n查看和管理订单：\nhttps://nozomi.example/o/view?t=abc&x=1\n这个链接只属于您的这张订单，请不要转发给别人。\n\nNOZOMI 用车",
    "客人写的：<b>请准备儿童座椅</b> & 'thanks' \"ok\" 见 https://evil.example/?a=<x> 和 javascript:void(0)",
    "  前导空格\n\t制表符\n末尾空格  ",
  ];
  for (const text of samples) assert.equal(visibleText(render(text)), `${MAIL_BRAND_WORDMARK} ${normalized(text)}`, text);
});

test("空正文：只有页眉，不报错", () => {
  for (const text of ["", "\n\n", "   "]) {
    const html = render(text);
    assert.equal(visibleText(html), MAIL_BRAND_WORDMARK);
    assert.ok(!html.includes('class="nz-text"'));
  }
});

test("整封邮件的结构：zh-Hans、亮暗两套、最宽 600px、表格布局、品牌页眉，不引用任何外部资源", () => {
  const html = render("正文");
  assert.match(html, /^<!DOCTYPE html>\n<html lang="zh-Hans">/);
  assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
  assert.ok(html.includes("@media (prefers-color-scheme: dark)"));
  assert.ok(html.includes("max-width:600px"));
  assert.ok(html.includes('role="presentation"'));
  assert.match(html, new RegExp(`class="nz-brand" bgcolor="${MAIL_LIGHT_COLORS["color-brand"]}"`));
  assert.match(html, /class="nz-wordmark"[^>]*>NOZOMI<\/span>/);
  for (const font of ["Hiragino Sans", "Yu Gothic", "Meiryo"]) assert.ok(html.includes(font), font);
  assert.ok(!/<img|<link|@import|url\(|src=|var\(--/.test(html), "没有图片、外部样式、外部字体和 CSS 变量");
  assert.ok(!/https?:\/\//.test(html), "正文没有网址时，整封邮件不含任何网址");
});

/** tokens.css 里某一段（亮色 :root、系统暗色）的颜色令牌。 */
function tokenSection(css: string, start: string, end: string): Map<string, string> {
  const from = css.indexOf(start);
  const to = css.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `tokens.css 里找不到 ${start}`);
  return new Map([...css.slice(from, to).matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)].map((m) => [m[1] as string, (m[2] as string).toUpperCase()]));
}

test("颜色取自设计令牌：邮件里写死的十六进制与 docs/design/tokens.css 逐个一致，且都出现在 HTML 里", () => {
  const css = readFileSync(new URL("../../../docs/design/tokens.css", import.meta.url), "utf8");
  const light = tokenSection(css, ":root {", "@media (prefers-color-scheme: dark)");
  const dark = tokenSection(css, "@media (prefers-color-scheme: dark)", ":root[data-theme=\"dark\"]");
  const html = render("正文\nhttps://a.example/\n123456");
  for (const [token, hex] of Object.entries(MAIL_LIGHT_COLORS)) {
    assert.equal(light.get(token), hex, `亮色 ${token}`);
    assert.ok(html.includes(hex), `亮色 ${token} 在 HTML 里`);
  }
  for (const [token, hex] of Object.entries(MAIL_DARK_COLORS)) {
    assert.equal(dark.get(token), hex, `暗色 ${token}`);
    assert.ok(html.includes(hex), `暗色 ${token} 在 HTML 里`);
  }
  const used = new Set([...html.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase()));
  const allowed = new Set([...Object.values(MAIL_LIGHT_COLORS), ...Object.values(MAIL_DARK_COLORS)]);
  for (const hex of used) assert.ok(allowed.has(hex as never), `${hex} 不是令牌里的颜色`);
});
