# MoveGlobal 工厂接入 NOZOMI 预订组件：改动说明

- 读者：维护 MoveGlobal 工厂（`registry.moveglobal.io/admin`，Astro 生成静态站点，nginx 提供）的开发。
- 写法：照着改即可。我们看不到 moveglobal 仓库，文中的「站点设置」「首页模板」「/booking/ 页模板」等是按页面输出反推的叫法，**具体文件名、字段名请按你们的代码对上**。
- NOZOMI 侧依据：ADR 0090（`docs/adr/0090-embed-widget-booking-drafts.md`）、`apps/web/src/embed/widget-core.ts`、`apps/web/src/embed/widget-ui.ts`、`packages/domain/src/embed.ts`、`apps/api/src/routes/embed.ts`。
- 2026-11-14 更新：NOZOMI 组件新增 `layout`（卡片 / 横条）和 `theme` 两个可选的 init 参数（M9E-10，PR #233），本文补了第 2 节的「NOZOMI 组件外观」字段、3.2–3.5 的示例代码、3.6 两个参数的说明、第 5 节和第 7 节的对应检查；按钮文字现在是「查看价格」。
- 2026-11-14 再更新（M9E-14，PR #237）：外观规则改了——`layout` 新增 `"auto"`（按组件容器宽度自动选：≥ 900 px 横条、窄了卡片）；**`init` 传了 `layout` 以传的为准；没传就用 NOZOMI 运营后台这个嵌入码的「外观」（默认「自动」）；两边都没有用 `auto`**。所以工厂**建议不写 `layout`**。第 2、3.2、3.4、3.5、3.6、5、7、9 节已按新规则改；组件位置与尺寸建议见第 10 节。
- 本文不含任何账号、邮箱、密钥。`fleetToken`、`corporateId`、嵌入码一律写成占位。

## 1. 背景和目标

工厂生成的站点现在只能放 Good Journey（下称 GJ）的预订组件。NOZOMI 已经有自己的嵌入预订组件（区间 / 包车两个标签，客人填完条件后整页跳到 NOZOMI 主站报价、付款）。

目标：

1. 工厂后台每个站点可以选「预订组件来源」：GJ 或 NOZOMI。**默认仍是 GJ**。
2. 选 NOZOMI 的站点，页面上原来放 GJ 组件的位置换成 NOZOMI 组件，GJ 的脚本一行都不输出。
3. 没选 NOZOMI 的站点（包括 moveglobal、anshinride 和其他所有已有站点）**生成的 HTML 与改动前逐字相同**。
4. 第一个切换的站点是站点 73（`embed-demo.moveglobal.io`），用来在测试环境验收。

### 现状（我们从 embed-demo.moveglobal.io 首页只读看到的）

- `<head>` 里有一段内联脚本：

  ```html
  <script>window.initGJBookingForm=function(){window.GJBookingWidget.init({"fleetToken":…,"corporateId":…,"root":"gojo-widget-container","mode":"full","redirectUrl":"https://embed-demo.moveglobal.io/booking/","openInNewTab":false,"locale":"zh-CN","color":{…}});};</script>
  ```

- 紧接着：`<script defer src="https://widget.goodjourney.io/js/widget.js"></script>`。
- 正文里：`<div id="gojo-widget-container">`。
- 后台站点设置的「预订归属」现在只有两项：GJ 的 Fleet token、企业 ID。
- 响应头里没有内容安全策略（CSP）。

## 2. 后台改动：「预订归属」加两个必加字段、一个可选字段

| 字段（界面名） | 建议存储名（按你们的命名改） | 取值 | 规则 |
| --- | --- | --- | --- |
| 预订组件来源 | `bookingWidgetProvider` | `goodjourney` / `nozomi`，界面显示「Good Journey」/「NOZOMI」 | 单选，**默认 Good Journey** |
| NOZOMI 嵌入码 | `nozomiEmbedKey` | 字符串 | 选 NOZOMI 时必填；选 GJ 时不校验、不输出（可以留着值，方便来回切换） |
| NOZOMI 组件外观（可选，**建议不加**） | `nozomiWidgetLayout` | `follow` / `auto` / `card` / `bar`，界面显示「跟随 NOZOMI 后台」/「自动」/「卡片」/「横条」 | 单选，**默认「跟随 NOZOMI 后台」**（`init` 不写 `layout`）；选了另外三个才把对应值写进 init 的 `layout`（见 3.6）；只在选 NOZOMI 时输出，选 GJ 时不输出 |

「NOZOMI 组件外观」是可选的，**建议不加**：不加这个字段，工厂的 `init` 就**不写 `layout`**，组件用 NOZOMI 运营后台给这个嵌入码设的外观（默认「自动」：宽的容器显示横条、窄的容器和手机显示卡片），以后要换外观由 NOZOMI 运营在后台改，约 1 分钟生效，工厂不用重新发布。只有工厂想在自己后台按站点固定外观时才加这个字段；一旦写了 `layout`，就以工厂的值为准，NOZOMI 后台的设置对这个站点不起作用（3.6）。外观规则和放在页面哪里合适见 3.6、第 10 节。

### NOZOMI 嵌入码的格式校验

NOZOMI 的嵌入码格式（`packages/domain/src/embed.ts` 的 `EMBED_KEY_FORMAT`）：

```
^nze_[A-Za-z0-9_-]{32}$
```

即固定前缀 `nze_` 加 32 个 base64url 字符（大小写字母、数字、`-`、`_`），**总长 36 个字符**。后台保存时：

1. 先去掉首尾空白（复制时常带空格、换行）。
2. 不匹配上面的正则就拒绝保存，提示「NOZOMI 嵌入码格式不对：应以 nze_ 开头，共 36 个字符，请到 NOZOMI 运营后台复制」。
3. 正则只校验格式，不校验码是否存在、是否在用；码对不对以验收步骤为准（第 7 节）。

嵌入码在 NOZOMI 运营后台「嵌入组件」→ 打开对应嵌入码的详情页复制（详情页的「复制代码」里也有，就是 `key: "nze_…"` 那一段）。站点 73 用的是已经建好的嵌入码「MoveGlobal 演示站」，由 NOZOMI 侧提供，本文不写具体值。

> 嵌入码是**公开标识，不是密钥**：它本来就会写进合作网站的公开页面里，谁都看得到。真正限制「哪个网站能用」的是 NOZOMI 侧的域名白名单（第 6 节）。所以后台可以明文存储、明文显示，不需要按密钥处理；但也请不要把它当成可以随手改的值，改错了组件就显示「暂时无法使用」。

### GJ 两项

Fleet token、企业 ID 的字段和校验规则**不变**；选 NOZOMI 时也不要清空它们，回退时直接切回 GJ 就能用。

### 已有数据

已有站点的设置里没有这两个字段。**读取时一律按 GJ 处理**：

- `bookingWidgetProvider` 缺失、为空、或不是 `nozomi` → 当作 `goodjourney`；
- `nozomiWidgetLayout`（如果加了）缺失、为空、或不是 `auto` / `card` / `bar` → 当作 `follow`（不写 `layout`，跟随 NOZOMI 后台）；
- 不需要写迁移、不需要回填任何站点；
- 后台编辑页打开老站点时，「预订组件来源」显示为 Good Journey。

建议把这两条判断各收在一个函数里（例如 `bookingWidgetProviderOf(site)`、`nozomiLayoutOf(site)`），后台显示和渲染都只调它们，避免两处口径不一。

## 3. 渲染改动

### 3.1 选 GJ：输出和现在逐字相同

GJ 分支**原样保留现在的代码路径**，不调整空格、属性顺序、换行，也不要顺手「整理」。验证方式见第 5 节的快照测试。

GJ 模式完整示例（即现状；`fleetToken`、`corporateId`、`color` 为占位）。NOZOMI 组件的 `layout`、`theme` 和「NOZOMI 组件外观」字段**与 GJ 模式无关**：GJ 模式不读这个字段、不输出任何 NOZOMI 代码，下面这段和改动前完全一样：

```html
<!-- <head> 内 -->
<script>window.initGJBookingForm=function(){window.GJBookingWidget.init({"fleetToken":"<GJ_FLEET_TOKEN>","corporateId":"<GJ_CORPORATE_ID>","root":"gojo-widget-container","mode":"full","redirectUrl":"https://embed-demo.moveglobal.io/booking/","openInNewTab":false,"locale":"zh-CN","color":{…}});};</script>
<script defer src="https://widget.goodjourney.io/js/widget.js"></script>

<!-- 正文，原来放组件的位置 -->
<div id="gojo-widget-container"></div>
```

### 3.2 选 NOZOMI：在原来组件的位置输出完整代码

- `<head>` 里**不输出** `initGJBookingForm` 那段内联脚本，**不输出** GJ 的 `widget.js`。
- 正文里原来 `<div id="gojo-widget-container">` 的位置，换成下面整段（容器、组件脚本、初始化脚本三样都在这里，不放进 `<head>`）。

NOZOMI 模式完整示例（站点 73，站点语言 zh-CN，外观不写、跟随 NOZOMI 后台；嵌入码为占位）：

```html
<div id="nozomi-booking"></div>
<script src="https://nozomi.moveglobal.io/embed/widget-v1.js" defer></script>
<script>
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.init({ key: "nze_…", root: "#nozomi-booking", lang: "zh", services: ["transfer","charter"], redirectUrl: "https://embed-demo.moveglobal.io/" });
  });
</script>
```

各项要求和原因：

| 项 | 写法 | 说明 |
| --- | --- | --- |
| 容器 | `<div id="nozomi-booking"></div>` | `root` 用选择器 `"#nozomi-booking"` 指向它；找不到容器时组件只在控制台报错、不渲染 |
| 组件脚本 | `https://nozomi.moveglobal.io/embed/widget-v1.js`，带 `defer` | 必须从这个地址直接加载：组件只认路径为 `/embed/widget-v1.js` 的 `<script>` 元素，并把它的域名当作 NOZOMI 主站。**不要下载转存、改名、合并打包**。做错时有两种表现：① 改了文件名或合并进别的文件：组件不渲染，控制台报 `NozomiBooking：请直接从主站的 /embed/widget-v1.js 加载组件脚本（不要改名、转存或合并进别的文件）。`；② 转存到工厂站点自己的 `/embed/widget-v1.js`：组件把工厂站点当成主站，取配置失败，显示「暂时无法使用」，控制台报 `NozomiBooking：主站拒绝了取配置的请求（浏览器读不到具体原因）。请依次检查：① 嵌入码是否已在 NOZOMI 运营后台停用；② 嵌入码是否填错；③ 本网站的域名是否在这个嵌入码的白名单里；④ 组件脚本是否直接从主站加载。NOZOMI 运维可在主站日志 embed.gate_refused 查到是哪一种。`（和白名单没加的表现一样，排查时先看脚本地址） |
| 初始化时机 | `DOMContentLoaded` 里调 `NozomiBooking.init` | `defer` 脚本在 `DOMContentLoaded` 之前执行完，此时 `NozomiBooking` 一定已定义。站点如果用了 Astro 的站内软跳转（`<ClientRouter />`），见 3.5 |
| `key` | 站点的 NOZOMI 嵌入码 | 必须转义后写入（见 3.3） |
| `root` | `"#nozomi-booking"` | 固定 |
| `lang` | 按站点语言映射：日语 → `"ja"`；中文简体或繁体（`zh`、`zh-CN`、`zh-TW`、`zh-HK`、`zh-Hans`、`zh-Hant` 等，即 `zh` 本身或以 `zh-`、`zh_` 开头；日语同理是 `ja`、`ja-JP` 等）→ `"zh"`；其他 → `"en"` | 组件只认 `zh` / `ja` / `en`；不认识的值会被忽略、改用 NOZOMI 后台给这个嵌入码设的默认语言，所以工厂一定要按表映射好再传 |
| `services` | `["transfer","charter"]` | 区间、包车两个标签，顺序即标签顺序 |
| `redirectUrl` | 站点首页 `https://<站点域名>/` | 付款完成后订单页「返回原网站」的链接。见下面「redirectUrl 的规则」和第 4 节 |
| `layout` | **默认不写**。加了「NOZOMI 组件外观」字段且选的不是「跟随 NOZOMI 后台」时，才写 `"auto"` / `"card"` / `"bar"` | 组件外观，见 3.6。不写时组件用 NOZOMI 运营后台这个嵌入码的「外观」（默认「自动」）；写了就以写的为准，NOZOMI 后台的设置对这个站点不起作用 |
| `theme` | **不传** | 只预留了接口，这次不用，见 3.6 |

`redirectUrl` 的规则（NOZOMI 服务端校验，`packages/domain/src/embed.ts` 的 `embedReturnUrl`）：

- 只收 `https://`（NOZOMI 测试环境另外收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`，方便本机调试；正式环境不收。工厂站点都是 https 域名，不受影响）；不能带用户名密码；≤ 2,000 字符。
- 它的 origin（协议 + 域名 + 端口）必须**完全等于**嵌入码白名单里的某一项，并且等于访客当时打开的页面的 origin。
- 不合格时**不报错**，只是这张单的订单页不显示「返回原网站」。所以「站点域名」要用站点对外实际访问的那个域名（和白名单里登记的一致）；如果站点同时能用 `www.` 和不带 `www.` 访问，两个都要进白名单，否则从另一个域名进来的客人付款后没有返回链接。

### 3.3 嵌入码要转义后再写进脚本

嵌入码的正则只允许 `[A-Za-z0-9_-]`，后台校验通过的值本身不会出问题；但渲染层**不要依赖后台校验**（老数据、直接改库、以后放宽规则都可能绕过），写进 `<script>` 前一律按 JS 字符串字面量转义，并防住 `</script>`：

```ts
/** 把值安全地写进内联 <script>：JSON 字符串字面量，再把 < > & 和 U+2028/2029 转成 \uXXXX */
function scriptLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
```

`redirectUrl` 由站点域名拼出来，也用同一个函数写入。`lang`、`layout`（输出时）由映射函数得出（只可能是几个固定值之一），`services` 是固定值，直接写常量。

**选了 NOZOMI 但嵌入码为空或格式不对时：让这个站点的构建直接失败**，报错写明站点和字段，不要静默按 GJ 输出、也不要输出一个坏掉的组件（`JSON.stringify(undefined)` 返回 `undefined`，接着 `.replace` 会抛一个看不出原因的 TypeError）。按嵌入码格式（第 2 节）在渲染前检查：

```ts
const NOZOMI_EMBED_KEY_FORMAT = /^nze_[A-Za-z0-9_-]{32}$/;

function nozomiEmbedKeyOf(site: Site): string {
  const key = typeof site.nozomiEmbedKey === "string" ? site.nozomiEmbedKey.trim() : "";
  if (!NOZOMI_EMBED_KEY_FORMAT.test(key)) {
    throw new Error(
      `站点 ${site.id}（${site.domain}）：预订组件来源是 NOZOMI，但「NOZOMI 嵌入码」（nozomiEmbedKey）${key === "" ? "为空" : "格式不对"}。` +
        "请在工厂后台「预订归属」填入 NOZOMI 运营后台「嵌入组件」详情页里的嵌入码，或把预订组件来源切回 Good Journey。",
    );
  }
  return key;
}
```

报错里不要带嵌入码的值本身（格式不对的值可能是误粘的别的东西）。如果你们是一次构建所有站点，最好让这个错误只让这一个站点发布失败、在后台发布结果里显示出来，不连累其他站点。

### 3.4 Astro 里的写法提示

Astro 默认会处理、打包并上提 `<script>`，这会破坏「原样输出、留在原位置」的要求。NOZOMI 这一段请用 `is:inline` 原样输出，整段 init 代码在 frontmatter 里拼成字符串后用 `set:html` 写入：

```astro
---
// 文件名、字段名按你们的代码对上
const provider = bookingWidgetProviderOf(site); // 缺失一律 "goodjourney"
const nozomiLang = /^ja(?:[-_]|$)/i.test(site.locale ?? "") ? "ja" : /^zh(?:[-_]|$)/i.test(site.locale ?? "") ? "zh" : "en";
const nozomiLayout = nozomiLayoutOf(site); // null（跟随 NOZOMI 后台，不写 layout）| "auto" | "card" | "bar"；没加「NOZOMI 组件外观」字段时一律 null
const nozomiInit = provider === "nozomi"
  ? `
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.init({ key: ${scriptLiteral(nozomiEmbedKeyOf(site))}, root: "#nozomi-booking", lang: "${nozomiLang}", services: ["transfer","charter"], redirectUrl: ${scriptLiteral(`https://${site.domain}/`)}${nozomiLayout === null ? "" : `, layout: "${nozomiLayout}"`} });
  });
`
  : "";
---
{provider === "nozomi" ? (
  <>
    <div id="nozomi-booking"></div>
    <script is:inline src="https://nozomi.moveglobal.io/embed/widget-v1.js" defer></script>
    <script is:inline set:html={nozomiInit}></script>
  </>
) : (
  <div id="gojo-widget-container"></div>
)}
```

GJ 分支里的 `<div id="gojo-widget-container"></div>` 代表**你们模板里现在那段 GJ 容器的原文**：把原来的静态标记原封不动搬进这个分支，**保持静态写法**——不要改成字符串拼接、`set:html` 或别的生成方式，也不要顺手调整空白和属性。`<head>` 里 GJ 那两行同样只包一层 `provider !== "nozomi"` 的条件，条件内部一字不改。

包进条件表达式后，Astro 输出的空白有可能和原来有细微差别，第 5 节的快照会抓到。若快照因此不一致：**优先保住 GJ 分支的原样静态写法**，只调整条件的包法（例如把条件写在原标记同一行，或把 NOZOMI 那段单独做成组件、条件只包住它），直到差异为零；**不要通过改 GJ 标记或更新快照来让测试通过**。

- `nozomiLayoutOf(site)` 只返回 `null`、`"auto"`、`"card"`、`"bar"`：字段值严格等于 `auto` / `card` / `bar` 才返回对应值，其余（缺失、空值、`follow`、别的值）一律 `null`，这时 `init` 里不出现 `layout`。
- 映射正则让 `ja`、`ja-JP`、`ja_JP` 都算日语，`zh`、`zh-CN`、`zh-TW`、`zh-Hant`、`zh_CN` 都算中文，其余（含空值）算英语；按你们 `locale` 字段的实际取值核一遍，表驱动的单元测试见第 5 节。
- 组件脚本地址 `https://nozomi.moveglobal.io` 建议做成工厂里的一个常量（不做成每站点设置）。它现在是 NOZOMI 的**测试环境**；以后接正式环境时由 NOZOMI 侧通知，换常量 + 各站点换正式环境的嵌入码。

### 3.5 站内软跳转（`<ClientRouter />`，旧名 View Transitions）

先在你们的代码里搜一下 `ClientRouter`、`ViewTransitions`。**没用的话这一节不用管。**

用了的话：站内点链接跳到首页或 `/booking/` 时，浏览器不会重新加载页面，`DOMContentLoaded` 不会再触发，3.2 那段 init 不会执行，组件不出现。两种处理办法，二选一：

1. **推荐：这两页不走软跳转。** 指向首页和 `/booking/` 的站内链接加 `data-astro-reload`（或对 NOZOMI 模式的站点整体不启用 `<ClientRouter />`）。3.2 那段代码保持不变，快照也不变。
2. **改初始化脚本**，同时处理首次加载和软跳转（`astro:page-load` 在首次加载和每次软跳转后都会触发）。软跳转时组件脚本可能还没加载完（`window.NozomiBooking` 还没定义），所以也在组件脚本的 `load` 事件里再试一次；`data-nozomi-init` 保证只初始化一次。下面是**输出结果**的样子（站点 73）：

   ```html
   <script>
     (function () {
       function start() {
         var el = document.getElementById("nozomi-booking");
         if (!el || !window.NozomiBooking || el.getAttribute("data-nozomi-init") === "1") return;
         el.setAttribute("data-nozomi-init", "1");
         NozomiBooking.init({ key: "nze_…", root: "#nozomi-booking", lang: "zh", services: ["transfer","charter"], redirectUrl: "https://embed-demo.moveglobal.io/" });
       }
       document.addEventListener("astro:page-load", start);
       var widgetScript = document.querySelector('script[src="https://nozomi.moveglobal.io/embed/widget-v1.js"]');
       if (widgetScript) widgetScript.addEventListener("load", start);
       if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", start); else start();
     })();
   </script>
   ```

   示例里的嵌入码 `"nze_…"` 和 `redirectUrl` 只是为了好读写成了字面值。实际生成时和 3.4 一样：在 frontmatter 里用 `scriptLiteral(nozomiEmbedKeyOf(site))`、`scriptLiteral(`https://${site.domain}/`)` 拼出整段代码，再用 `<script is:inline set:html={…}></script>` 输出，**不要把嵌入码直接写进模板**。

   软跳转时组件脚本是否按顺序加载、内联脚本是否重新执行，和你们的 Astro 版本及配置有关，请在站点上实测（从别的页面软跳转到首页、`/booking/`，再从首页软跳转到 `/booking/`，组件都要出现且只出现一份）。NOZOMI 模式的快照按改后的代码更新。

**重复调用 init 是否安全**（按 NOZOMI 组件代码 `apps/web/src/embed/widget-ui.ts` 核过，M9E-10 后）：对同一个容器再调一次 `init`，组件先停掉这个容器上的旧实例——解除它挂在 `document` 上的「点外面关闭人数弹层」监听和量容器宽度的 `ResizeObserver`（老浏览器上是 `window` 的 `resize` 监听），旧实例的取配置请求晚回来也不再画——再复用已有的 Shadow DOM，重新取一次配置，渲染前先清掉上一次的内容，最后只显示一份表单，监听不会越积越多。剩下几点不会出错：

- 组件有短定时器：地址提示停顿 300 毫秒后才查候选（防抖）；选中候选后取位置最多等 10 秒。旧实例里已经开始的定时器照常到点。
- 旧实例已经发出的地址提示（候选列表）请求照常跑完，结果写进已经被清掉的旧内容，不影响新表单。
- 但新旧实例共用同一个 Shadow DOM，`destroy()` 目前不会拦住所有异步回调：旧实例里正在取的位置晚回来，或旧实例正卡在「正在取位置…」的提交醒来，会按**旧表单**的状态去改**新表单**——按钮的可用状态和文字、交换按钮是否可用，旧表单校验不过时还会把错误提示写进新表单、把焦点移到新表单的某个字段。不会报错、不会重复提交，客人再动一下表单状态就会刷新，但客人会看到莫名的提示或焦点跳动。NOZOMI 侧会在 M9E-11 修好（旧实例的这些回调先看是否已停用）。
- 例外：如果客人在旧实例上已经点了「查看价格」、正在等结果，成功后照样会整页跳到 NOZOMI 主站（这正是客人要的）。
- 不支持 `adoptedStyleSheets` 的老浏览器上，每调一次 `init` 容器里多一个 `<style>`，只是重复的样式。

代价是每调一次多一个取配置请求，客人已经填了一半的内容会被清掉。所以仍建议像上面那样用 `data-nozomi-init` 防重。**工厂侧请保证：客人还在填表（页面没离开）时，不要对同一个容器再调一次 `init`**——例如不要在定时器、滚动、窗口大小变化或站点自己的「语言切换」里重新 init；要换参数就整页重新加载。

### 3.6 外观 `layout` 和主题 `theme`（M9E-10 新增的两个可选参数）

两个参数都只影响组件长什么样，不改接口、提交和跳转；不传时组件和以前一样能用。参数规则以 NOZOMI 组件代码为准（`apps/web/src/embed/widget-core.ts` 的 `resolveLayout`、`layoutFor`、`resolveTheme`，`widget-ui.ts` 的 `watchSize`）。

#### `layout`：自动 / 卡片 / 横条（M9E-14 起）

| 取值 | 样子 | 适合放在 |
| --- | --- | --- |
| `"auto"`（NOZOMI 后台默认） | 按组件容器宽度自动选：容器 **≥ 900 px 横条，< 900 px 卡片**，宽度变了随时换 | 哪里都行：整宽的位置自动是横条，侧栏和手机自动是卡片 |
| `"card"` | 竖向卡片，最宽 600 px、在容器里居中，外面一圈半透明浅灰底 | **首屏侧栏**（首屏左文案、右组件那种），或**手机**页面 |
| `"bar"` | 横向搜索条，一行排开出发地、目的地、日期时间、人数行李和按钮 | **首屏底部整宽**（首屏大图下沿、横跨整个内容区的一条） |

- **看的是组件容器**（`#nozomi-booking` 那个元素）的宽度，**不是浏览器窗口**，按容器内容宽度算（不含容器自己的左右内边距）；量不到宽度（容器宽 0，例如还藏着）按卡片。转屏、拖窗口时实时切换，只换样式、不重画，客人已经填的内容不丢。
- `"auto"` 的门槛 900 px 可用 `init` 的 `autoBreakpoint` 改（768–4000 的数字；写错或超出范围按 900），工厂一般不用传。
- `"bar"` 容器窄于 768 px 时自动变卡片（手机上不用另外处理）；**把 `bar` 放进窄的侧栏里永远只会显示卡片**。
- **不认识的值当没传**：大小写不对（`"Bar"`）、拼错、空串、不是字符串，都按「没传」处理，用 NOZOMI 后台的外观，不报错。
- 已知问题（NOZOMI 侧后续任务 M9E-11，工厂不用处理）：横条在容器 900–1023 px 宽时中、日文的地址占位提示会截掉一截；手机卡片里的人数行李弹层在个别情况下可能被裁掉。

#### 工厂后台和 NOZOMI 运营后台都能设外观，以哪边为准

NOZOMI 运营后台的嵌入码有「外观：自动 / 卡片 / 横条」选项（默认「自动」），组件打开时从 NOZOMI 取配置（`/embed/v1/config`），配置里带着这个外观。规则（`apps/web/src/embed/widget-core.ts` 的 `resolveLayout`）：

1. **`init` 传了 `layout`（认识的值），以传的为准**——NOZOMI 后台的「外观」对这个站点不起作用；
2. **没传**，用 NOZOMI 运营后台这个嵌入码的「外观」；
3. 两边都没有，用 `"auto"`。

所以：

- **建议工厂不写 `layout`**（不加「NOZOMI 组件外观」字段，或选「跟随 NOZOMI 后台」）。想换外观时由 NOZOMI 运营在后台改，客人新打开或刷新的页面**最迟约 1 分钟**就是新外观，**工厂不用重新发布**（已经开着的页面要刷新才变）。
- 工厂选了「自动 / 卡片 / 横条」，就写进 `init`、以工厂为准；想换要改工厂后台、**重新发布站点**，只改 NOZOMI 运营后台的「外观」不会变。
- NOZOMI 运营后台「复制代码」生成的那段代码从 M9E-14 起也不再写 `layout`。

#### `theme`：只预留了接口，这次不传

`theme` 是一个对象，四项都可选：

| 项 | 写法 | 写错或不传时 |
| --- | --- | --- |
| `primary` 主色 | `#rgb` 或 `#rrggbb`（别的颜色写法如 `rgb()`、颜色名都不认） | 默认深蓝 `#1B2A5C` |
| `accent` 点缀色 | 同上 | 默认浅米色 `#F3E9D8` |
| `radius` 卡片圆角 | 0–32 的数字（px），也收 `"12"`、`"12px"`；输入框圆角取一半 | 默认 24 px |
| `fontFamily` 字体 | CSS 字体列表；不能含 `;` `{` `}` `<` `>` `\`，≤ 300 字符。组件不加载字体文件，只用页面已经加载的或系统里有的 | 默认系统字体 |

写错的那一项单独回到默认值，其他项照常生效，不报错。默认是中性配色（上表的默认值）。

**对比度不够时的兜底**（组件自己做，传什么颜色都不会让字看不清）：

- 主色、点缀色做底色时，上面的字在白色和深色（`#1A1F29`）里取对比度高的；高的那个也不到 4.5:1，就退到纯黑或纯白里高的那个（两者总有一个 ≥ 4.58:1，例如 `#777777` 用纯黑，4.69:1）。
- 主色在白底上当文字用（选中标签的字、链接、焦点环）不够 4.5:1 时，这些地方改用深色；主色当白底上的标记条（卡片选中标签的底条、横条选中标签的顶条）不够 3:1 时也改用深色（例如 `#FFCC00` 这种很亮的黄）。

**工厂这次不要传 `theme`**：「组件跟随主站配色」（读站点自己的颜色）以后由 NOZOMI 侧再做，到时候另行通知工厂要不要传、怎么传。现在先用默认的中性配色，3.2–3.5 的示例都不带 `theme`。

#### 测试站现状

- 截至 2026-11-14 10:29 UTC，带 `layout` / `theme` 的新版组件已部署到 NOZOMI 测试环境：`https://nozomi.moveglobal.io/embed/widget-v1.js`（45,207 字节），响应头 `Cache-Control: public, max-age=300`，所以已经放了代码的客户站点**最多 5 分钟**就拿到新版，不用重新发布。
- 脚本地址、接口、`init` 原有参数都没变，已经放好的代码不用改。
- 演示站 `embed-demo.moveglobal.io` 的代码里没写 `layout`。M9E-14（PR #237）部署前组件不看 NOZOMI 后台、一律显示卡片；部署后按 NOZOMI 运营后台这个嵌入码的「外观」显示（2026-11-14 实测是「横条」：容器 ≥ 768 px 横条、更窄卡片；改成「自动」后是 ≥ 900 px 横条）。工厂不用为此改代码或重新发布。
- 按钮文字现在是「查看价格」（日语「料金を見る」，英语「See prices」），以前叫「查询价格」。

## 4. `/booking/` 页

**现状**：GJ 模式下，组件的 `redirectUrl` 是 `https://<站点域名>/booking/`，客人在首页填完后跳到 `/booking/`，由 GJ 在那一页继续预订流程。

**NOZOMI 模式下的建议**：

1. `/booking/` 页**放同一个 NOZOMI 组件**（3.2 那一整段，参数完全相同），同样不输出任何 GJ 脚本。
2. `redirectUrl` 仍填**首页** `https://<站点域名>/`，不填 `/booking/`。

**为什么**：

- NOZOMI 组件提交后整页跳到 NOZOMI 主站（`/book/new?draft=…`）报价、填乘客信息、付款，**不会再回到 `/booking/` 继续流程**；`/booking/` 在 NOZOMI 模式下不再是流程中的一步。
- 但站内导航、旧链接、搜索引擎收录、客人收藏都可能直接打开 `/booking/`。如果这一页留着 GJ 组件，同一个站点会出现两套预订入口、两种价格；如果删掉，旧链接变 404。放同一个 NOZOMI 组件，打开哪一页都能正常下单。
- `redirectUrl` 是**付款完成后**订单页「返回原网站」的去处。此时预订已经完成，回到 `/booking/` 会看到一张新的空白预订表单，容易让客人以为没订上或再订一次；回首页更自然，而且首页一定存在。NOZOMI 只校验 origin，`/` 和 `/booking/` 都能通过，选首页纯粹是体验上的选择。

**怎么改**：

- `/booking/` 页的模板里，组件输出处加和首页同样的 `provider` 分支，NOZOMI 分支复用首页同一个组件 / 片段（建议把 3.2 那段做成一个共用组件，例如 `NozomiBookingWidget.astro`，首页和 `/booking/` 都引用它，参数从站点设置来，不在页面上写死）。
- `/booking/` 页 `<head>` 里如有 GJ 脚本，同样只在 GJ 模式输出。
- GJ 模式下 `/booking/` 的输出不变（同样纳入第 5 节的快照）。

## 5. 快照测试要求

1. **已有站点逐字不变**：moveglobal、anshinride 以及其他所有已有站点，改动前后生成的全部 HTML（至少首页和 `/booking/`）**逐字节相同**。做法建议：
   - 在改动前的提交上对所有已有站点跑一次生成，把输出存成快照（或直接提交为测试夹具）；
   - 改动后再生成，逐文件比对（`diff -r` 或测试框架的快照断言），**任何差异都算失败**，包括空白和属性顺序。
   - 这些站点的设置里都没有新字段，正好覆盖「缺字段按 GJ 处理」。
2. **另加 NOZOMI 模式快照**：用一个测试用站点设置（`bookingWidgetProvider: "nozomi"`、嵌入码用格式合法的假值，例如 `nze_` 加 32 个 `A`，**不要用真实嵌入码**），断言：
   - 首页和 `/booking/` 都输出 3.2 那一整段，`redirectUrl` 都是首页，**`init` 里没有 `layout`**；如果加了「NOZOMI 组件外观」字段，再用 `nozomiWidgetLayout: "bar"` 的测试站点做一份，`layout` 是 `"bar"`，`follow` 或缺字段的站点没有 `layout`；
   - 不出现 `theme`；
   - 整个 HTML 里**没有** `initGJBookingForm`、`GJBookingWidget`、`widget.goodjourney.io`、`gojo-widget-container`；
   - `nozomi-booking` 容器、`widget-v1.js`（带 `defer`）各出现一次，`NozomiBooking.init` 出现一次；`DOMContentLoaded` 只在组件那段代码里数（站点主题等别处的脚本可能本来就有 `DOMContentLoaded`，按整页数会误报）。
3. **小单元测试**（建议）：
   - 语言映射表：`ja`、`ja-JP` → `ja`；`zh`、`zh-CN`、`zh-TW`、`zh-Hant` → `zh`；`en`、`ko`、`th`、空值 → `en`；
   - `scriptLiteral`：输入含 `</script>`、`"`、`\`、U+2028 时，输出里没有 `<`、没有未转义的引号，`JSON.parse` 回来等于原值；
   - 后台校验：`nze_` + 32 位合法、31 / 33 位拒、前缀错拒、含 `+` `/` `=` 拒、首尾空格去掉后通过；
   - `bookingWidgetProviderOf`：字段缺失、空串、未知值都返回 `goodjourney`；
   - `nozomiLayoutOf`（如果加了这个字段）：`bar` → `bar`；`card`、缺失、空串、`Bar`、未知值 → `card`；后台保存只收这两个值；
   - 选了 NOZOMI 但嵌入码缺失、空串、只有空格、格式不对：构建（或渲染这个站点）失败，错误信息里有站点 ID / 域名和「NOZOMI 嵌入码」，不含嵌入码的值；同一批里的其他站点不受影响（如果按 3.3 做了按站点隔离）。

## 6. 前提（NOZOMI 侧先做，工厂侧上线前确认）

1. **白名单**：站点域名必须先加进这个嵌入码在 NOZOMI 运营后台的域名白名单。只写**协议 + 域名**（如 `https://embed-demo.moveglobal.io`），**不带路径、查询**（结尾一个 `/` 可有可无，会被规范化掉）；只收 `https://`（NOZOMI 测试环境另外收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`，用于本机调试，对工厂没有影响）；不支持通配符，`www.` 和不带 `www.` 算两个不同的网站。
   站点 73：经 NOZOMI 侧确认，2026-11-14 已在 NOZOMI 测试环境运营后台建好嵌入码「MoveGlobal 演示站」，白名单 `https://embed-demo.moveglobal.io`，默认语言 `ja`，默认标签区间 + 包车。嵌入码的值由 NOZOMI 侧另行提供，不写在本文里。工厂传了 `lang` 和 `services` 时以工厂传的为准：站点 73 的语言是 zh-CN，按 3.2 的映射传 `lang: "zh"`，所以组件显示**中文**，不是后台默认的日文。
2. **生效时间**：白名单改动、停用 / 启用嵌入码、改「外观」，NOZOMI 服务端立即生效；组件的配置应答在浏览器里缓存 60 秒，所以**最迟 60 秒**后所有访客都按新设置。
3. **内容安全策略**：现在页面没有 CSP，不需要改。以后如果给站点加 CSP，`script-src` 和 `connect-src` 都要放行 `https://nozomi.moveglobal.io`（组件脚本从这里加载，组件也向这里请求配置、地址提示、建预订草稿）；初始化那段内联脚本也要被 `script-src` 允许（nonce 或 hash，按你们加 CSP 的方式）。组件的样式在 Shadow DOM 里，不加载任何第三方字体、图片。
4. 组件不需要、也不会读写站点的 Cookie；请求一律不带凭据。

## 7. 验收步骤

在测试环境做，全部用 Stripe 测试卡，不产生真实扣款。

### 7.1 站点 73 切到 NOZOMI

1. 工厂后台站点 73 →「预订归属」→ 预订组件来源选 NOZOMI，填入「MoveGlobal 演示站」的嵌入码，保存，**重新发布站点**。
2. 打开 `https://embed-demo.moveglobal.io/`，查看页面源代码：有 3.2 那一段，`lang` 与站点语言对应，没有 `layout`（加了「NOZOMI 组件外观」字段且选的不是「跟随 NOZOMI 后台」时，`layout` 与它对应），没有 `theme`，没有任何 GJ 的脚本和容器。`/booking/` 同样。
3. **区间**：在组件里选「区间」，填出发地、目的地（从候选里选）、日期、时间、人数、行李，点「查看价格」→ 整页跳到 `https://nozomi.moveglobal.io/book/new?draft=…`，条件已预填并自动报价 → 选车、填乘客信息 → 用测试卡 `4242 4242 4242 4242`（有效期填任意将来日期，安全码任意 3 位）付款 → 订单页出现「返回原网站」，点它回到 `https://embed-demo.moveglobal.io/`（首页，不是 `/booking/`）。
4. **包车**：同上，选「包车」，可加经停点和停留时长（不加经停点时在主站预订页选包车时长），走完同样流程，同样回到演示站首页。
5. NOZOMI 侧核对：两张单在 NOZOMI 运营后台的订单来源显示「嵌入组件 · embed-demo.moveglobal.io（MoveGlobal 演示站）」。
6. **外观**：`init` 没写 `layout` 时，外观跟 NOZOMI 运营后台走。请 NOZOMI 侧把这个嵌入码的「外观」设成「自动」：电脑上组件容器 ≥ 900 px 显示横条；把浏览器窗口拉窄（容器 < 900 px）或用手机打开显示卡片，来回拉窄拉宽已填的内容不丢。再请 NOZOMI 侧改成「卡片」，约 1 分钟后刷新页面显示卡片，工厂**不用**重新发布。加了「NOZOMI 组件外观」字段时另验一次：选「横条」重新发布，显示横条（容器 < 768 px 变卡片），这时 NOZOMI 后台怎么改都不影响这个站点（3.6）。

### 7.2 不在白名单的网站被拒

1. 把 3.2 那一段（填同一个嵌入码）存成本地 HTML 文件直接用浏览器打开（`file://`，浏览器发的 `Origin` 是 `null`），或放到另一个不在白名单里的网站上。
2. 组件位置只显示「预订组件暂时无法使用。请稍后刷新，或直接到主站预订。」（按 `lang` 显示对应语言）和一个「到主站预订」链接，**不出现表单**；浏览器控制台有一行 `NozomiBooking：主站拒绝了取配置的请求（浏览器读不到具体原因）。请依次检查：① 嵌入码是否已在 NOZOMI 运营后台停用；② 嵌入码是否填错；③ 本网站的域名是否在这个嵌入码的白名单里；④ 组件脚本是否直接从主站加载。NOZOMI 运维可在主站日志 embed.gate_refused 查到是哪一种。`
3. 因为没有表单、无法提交，不会建预订草稿，也不会产生任何订单数据；NOZOMI 服务端对这类请求一律 403，不建任何数据。
4. 嵌入码停用、填错、白名单漏了域名，三种在浏览器里看到的完全一样（NOZOMI 服务端的应答故意不区分，浏览器也读不到被拒的应答）。要知道是哪一种，把出问题的页面地址和时间发给 NOZOMI 侧，NOZOMI 运维按日志 `embed.gate_refused` 的 `reason` 回复（`key_disabled` 停用、`key_unknown` 嵌入码不存在或填错、`origin_not_allowed` 域名不在白名单）。组件被拒后会再发一个不带 `Origin` 的探测请求，所以同一时间一般有两行：看第一行；嵌入码有效时第二行总是 `origin_not_allowed`、`origin: null`，那是探测，不代表域名配错。

### 7.2a NOZOMI 主站慢或连不上时（M9E-22）

组件打开时先向 NOZOMI 取配置。取配置 **8 秒**没回、网络出错或 NOZOMI 返回 5xx 时，组件**照样显示表单**，不再一直空白：外观按 `init` 的 `layout`（没写按「自动」）、语言按 `init` 的 `lang`（没写用日文）、标签按 `init` 的 `services`（没写区间和包车都显示）。所以工厂按 3.2 在 `init` 里写了 `lang`、`services` 的站点，这时看到的和平时一样。客人点「查看价格」时 NOZOMI 照常核对嵌入码和白名单。

- 表单显示后配置才回来：正常就只按 NOZOMI 后台的「外观」换外观（`init` 没写 `layout` 时），语言和标签不变；已填的内容、光标都不动。
- 配置回来是被拒（例如这时嵌入码已停用）：和打开时被拒一样，整个组件换成「暂时无法使用」和「到主站预订」链接，不再显示表单。
- 表单已显示、提交时被拒（例如客人填表期间嵌入码被停用）：表单下方提示「这个网站暂时不能直接预订，请到主站预订。」和「到主站预订」链接；真连不上时提示「暂时连不上…」，也给链接。都不跳转。
- 极少数情况下（第一个请求偶然断网、紧接着又通了）正常的站点也可能显示一次「暂时无法使用」，刷新即恢复。
- 控制台另有一句 `NozomiBooking：取组件配置超时或出错，先按 init 的参数显示表单。`（只在这种情况下出现）。

### 7.3 已有站点不受影响

1. 第 5 节快照测试全部通过（moveglobal、anshinride 及其他站点改前改后逐字相同）。
2. 发布后打开 moveglobal、anshinride 线上首页和 `/booking/`，页面源代码与改动前保存的一份逐字比对相同，GJ 组件照常显示、能走到 GJ 的预订流程。

## 8. 风险和回退

- **回退**：工厂后台把站点的「预订组件来源」切回 Good Journey，**重新发布**。GJ 的两项设置一直保留着，切回即恢复原样；NOZOMI 嵌入码可以留在设置里不删。
- **页面是静态生成的**：改任何设置（切换来源、改嵌入码、改站点语言或域名）都**要重新发布站点才生效**；只保存不发布，线上页面不变。如果 nginx 或前面的 CDN 缓存了 HTML，发布后按你们现有的方式清缓存。
- **紧急止血（NOZOMI 侧）**：如果 NOZOMI 组件出问题而工厂暂时没法重新发布，NOZOMI 可以在运营后台停用这个嵌入码，60 秒内所有页面上的组件变为「暂时无法使用」并给出主站链接——这只是止血，真正的回退仍是切回 GJ 并重新发布。
- **嵌入码填错、已停用或白名单漏了域名**：组件显示「暂时无法使用」，不影响页面其他部分。按 7.2 的控制台提示排查，分不清时找 NOZOMI 侧查日志（7.2 第 4 步）；白名单改完最迟 60 秒生效，不需要重新发布站点。
- **跳到 NOZOMI 后的语言**：组件有中 / 日 / 英，跳到的 NOZOMI 主站预订页目前只有中文，日语、英语站点的客人会在跳转后看到中文。这是 NOZOMI 侧的已知限制（ADR 0090 第八节 Q8），不需要工厂处理。
- **环境**：组件地址现在指向 NOZOMI 测试环境，只能用 Stripe 测试卡下单。正式上线前不要把真实客流的站点切到 NOZOMI。

## 9. 联系与分工

| 事项 | NOZOMI 侧 | 工厂侧 |
| --- | --- | --- |
| 嵌入码 | 在运营后台建嵌入码、设默认语言和标签、维护域名白名单、需要时停用 / 换码，把嵌入码交给工厂侧（不经公开渠道） | 在站点设置里填嵌入码 |
| 组件本身 | `widget-v1.js` 的功能、样式、兼容性、多语言文案、自动 / 卡片 / 横条三种外观和主题的对比度兜底；`/embed/v1` 接口、限速、白名单校验；以后的「跟随主站配色」 | 默认不写 `layout`；加了「NOZOMI 组件外观」字段且没选「跟随 NOZOMI 后台」时才输出；这次不传 `theme` |
| 预订、付款、订单 | 主站报价、下单、Stripe 收款、订单页「返回原网站」 | — |
| 后台 | 运营后台嵌入码的「外观」（自动 / 卡片 / 横条，默认自动）：工厂 `init` 没写 `layout` 时组件按它显示，改了约 1 分钟生效（3.6） | 「预订归属」加两个字段、格式校验、缺字段按 GJ；可选加「NOZOMI 组件外观」（默认「跟随 NOZOMI 后台」，建议不加） |
| 渲染 | — | GJ 分支逐字不变；NOZOMI 分支按第 3、4 节输出，转义；首页和 `/booking/` |
| 测试 | 组件和接口自己的单元、集成、端到端测试 | 第 5 节的快照和单元测试 |
| 发布 | — | 重新发布站点 73；以后其他站点切换由工厂侧按站点发布 |
| 验收 | 提供嵌入码、确认白名单，核对订单来源（7.1 第 5 步） | 按第 7 节走一遍，结果反馈给 NOZOMI 侧 |
| 内容安全策略 | 告知需要放行的域名 | 将来加 CSP 时放行（第 6 节第 3 条） |

组件显示异常、白名单、嵌入码的问题找 NOZOMI 侧；站点生成、发布、后台字段的问题由工厂侧处理。双方通过 NOZOMI 仓库的 issue 或既有沟通渠道联系，嵌入码不要贴在公开 issue 里（虽然它不是密钥，也没必要扩散）。

## 10. 组件外观（自动）与位置、尺寸建议（M9E-14，2026-11-14）

### 10.1 外观怎么定：自动、阈值、优先级

业主的要求是「像 Good Journey 的组件一样，不用选外观，按屏幕自动适配」。组件现在这样定外观（以 NOZOMI 组件代码为准：`apps/web/src/embed/widget-core.ts` 的 `resolveLayout`、`layoutFor`，`widget-ui.ts` 的 `start`、`watchSize`）：

| 顺序 | 来源 | 说明 |
| --- | --- | --- |
| 1 | 工厂页面 `NozomiBooking.init` 传的 `layout` | `"auto"` / `"card"` / `"bar"`。**传了就以它为准**；写错的值当没传 |
| 2 | NOZOMI 运营后台这个嵌入码的「外观」 | 自动 / 卡片 / 横条，组件取配置（`/embed/v1/config`）时一起拿到；**默认「自动」** |
| 3 | 两边都没有 | `auto` |

- **`auto`（自动）**：按**组件容器**（`root` 指的那个元素，不是浏览器窗口）的宽度：容器 **≥ 900 px 显示横条，< 900 px 显示卡片**；窗口拉宽拉窄、手机横竖屏切换时随时换。需要别的门槛时在 init 里加 `autoBreakpoint`（768–4000 的数字，默认 900；写错或超出范围按 900）。
- **`bar`**：容器 ≥ 768 px 横条，窄了自动变卡片。**`card`**：一直是卡片。
- 换外观时已填的地点、日期、人数和光标位置都保留，不闪（组件拿到配置后才画表单，第一次画出来就是最终外观）。例外：取配置 8 秒没回或出错时先按 `init` 的参数画表单，配置晚回来时可能从卡片换成横条一次（不重画、已填的不丢，见 7.2a）。

**对工厂的建议：`init` 里不写 `layout`**，外观交给组件自动选；某个站点确实要固定外观，再由 NOZOMI 运营在后台改这个嵌入码的「外观」——不用工厂重新发布。只有工厂想在自己后台控制外观时才在 `init` 里写 `layout`，写了就以工厂为准，NOZOMI 后台的设置对这个站点不起作用。

**生效时间**：NOZOMI 运营在后台保存外观后，服务端立刻返回新值；组件的配置应答在访客浏览器里最多缓存 60 秒，所以**新打开或刷新的页面最迟约 1 分钟**就是新外观，已经开着的页面要刷新才变。工厂站点不用重新发布。（组件脚本本身缓存 5 分钟，只影响 NOZOMI 发布新版组件后多久到访客那里。）

### 10.2 位置与尺寸建议

以下数字是在演示站首页的离线副本上用 Playwright 量出来的（Chromium，窗口 1440 / 1280 / 1024 / 768 / 390，外观 auto，中文），截图见 NOZOMI 仓库 `docs/acceptance/M9E-14-shots/`（文件名是「位置-窗口宽度-实际外观」）。**这些只是建议，最终由工厂决定**；组件内部在 Shadow DOM 里，下面的 CSS 只管宿主的容器。

组件本身的尺寸（实测）：

| | 高度 | 宽度 |
| --- | --- | --- |
| 横条 | 167 px（上面的标签 55 px + 白色长条 112 px；包车加经停点时长条下面再展开） | 撑满容器。容器 900–1023 px 时中文、日文出发地 / 目的地的占位提示会被截掉一截（英文到 1200 px 才放得下），能输入、不影响使用（已登记 M9E-11）；想完全不截可以把 `autoBreakpoint` 设成 1024 |
| 卡片 | 约 570–607 px（随语言和宽度略有变化） | 最宽 600 px（容器更宽时居中）；**建议 380–420 px**：380 px 起三种语言的高度一样（570 px）、没有截字；360 px 日文、英文的标签副标题会多一行（588 px）；320 px 英文占位提示被截 |

#### 位置一：首屏底部整宽（横条压在首屏下沿）

auto 下宽屏自动是横条、窄屏是卡片。

- 容器：`max-width: 1280px`，左右内边距 32 px（窗口 < 1024 px 时 24 px，< 600 px 时 12 px）。窗口 1440 / 1280 时容器内容宽 1216 px，1024 时 960 px，都是横条；768 时 720 px 以下、390 时 366 px，是卡片。窗口宽度 ≥ 948 px（900 + 两边 24 px）才出现横条。
- 上移：横条的标签和白色长条上半截压在首屏上，**上移 112 px**（标签 55 px + 长条一半 56 px）；首屏内容的下内边距至少 152 px（上移 112 + 和首屏文字留 40 px），首屏文字不被盖住。实测 1440 宽时首屏最后一行文字到标签上沿 137 px。
- 变成卡片后（窗口 < 948 px，即容器 < 900 px；页面有竖向滚动条时门槛还会再大十几 px）卡片有 570 px 高，只压 64 px（< 600 px 时 48 px），首屏下内边距 96 px；卡片最宽 640 px 居中。

```css
/* 宿主写：<div class="nozomi-slot nozomi-slot--hero-bottom"><div id="nozomi-booking"></div></div>，放在首屏 section 后面 */
.nozomi-slot--hero-bottom {
  position: relative; z-index: 3;          /* 盖在首屏上面 */
  width: 100%; max-width: 1280px; box-sizing: border-box;
  margin: -112px auto 0; padding: 0 32px;  /* 上移 112 px = 标签 55 + 长条一半 56 */
}
.hero .hero-content { padding-bottom: 152px; }  /* 首屏下内边距 ≥ 上移 + 40 */
@media (max-width: 1023px) { .nozomi-slot--hero-bottom { padding: 0 24px; } }
@media (max-width: 947px) {                     /* 窗口 < 948 = 容器 < 900（900 + 两边 24），auto 变卡片 */
  .nozomi-slot--hero-bottom { margin-top: -64px; max-width: 640px; }
  .hero .hero-content { padding-bottom: 96px; }
}
@media (max-width: 599px) { .nozomi-slot--hero-bottom { margin-top: -48px; padding: 0 12px; } }

/* 另一种写法：不改外边距，用 transform 上移（不影响首屏高度，但下面要补回同样的空白） */
/* .nozomi-slot--hero-bottom { margin-top: 0; transform: translateY(-112px); margin-bottom: -112px; } */
```

截图：`bottom-1440-bar.jpg`、`bottom-1280-bar.jpg`、`bottom-1024-bar.jpg`、`bottom-768-card.jpg`、`bottom-390-card.jpg`。演示站现在的写法（`.quote-wrap` 上移 168 px、含一行引导语）在 auto 下的样子见 `demo-*.jpg`：1440 / 1280 / 1024 横条，768 / 390 卡片，也能用。

#### 位置二：首屏右侧（卡片）

容器窄（400 px），auto 下始终是卡片。

- 宽度：**400 px**（窗口 900–1023 px 时 360 px）；首屏文字列和卡片之间 **48 px**（窄屏 32 px），卡片和首屏文字纵向居中。
- 窗口 < 900 px 时改成一列：卡片放到首屏文字下面，最宽 600 px 居中，和文字间距 24 px（容器这时 600 px 以下，仍是卡片）。
- 演示站现在首屏文字在右半边，放这个位置要把文字移到左列。

```css
/* 宿主写：首屏内容 .hero-content 里放两列：<div class="hero-text">…</div><div class="nozomi-slot--hero-right"><div id="nozomi-booking"></div></div> */
.hero .hero-content.nozomi-hero-split {
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 400px);
  gap: 48px; align-items: center; padding-bottom: 64px;
}
.hero .hero-content.nozomi-hero-split > .hero-text { margin-left: 0; width: auto; }
.nozomi-slot--hero-right { width: 100%; }
@media (max-width: 1023px) { .hero .hero-content.nozomi-hero-split { grid-template-columns: minmax(0, 1fr) 360px; gap: 32px; } }
@media (max-width: 899px) {
  .hero .hero-content.nozomi-hero-split { grid-template-columns: 1fr; gap: 24px; }
  .nozomi-slot--hero-right { max-width: 600px; margin: 0 auto; }
}
```

截图：`right-1440-card.jpg`、`right-1280-card.jpg`、`right-1024-card.jpg`、`right-768-card.jpg`、`right-390-card.jpg`。

#### 位置三：首屏下方（不压首屏）

和位置一一样整宽，只是不上移：宽屏横条、窄屏卡片。

- 容器同位置一（`max-width: 1280px`、内边距 32 / 24 / 12 px），和首屏下沿间距 **40 px**（< 600 px 时 24 px）；首屏下内边距恢复正常（演示站用 64 px）。

```css
.nozomi-slot--below-hero { width: 100%; max-width: 1280px; box-sizing: border-box; margin: 40px auto 0; padding: 0 32px; }
@media (max-width: 1023px) { .nozomi-slot--below-hero { padding: 0 24px; } }
@media (max-width: 599px) { .nozomi-slot--below-hero { margin-top: 24px; padding: 0 12px; } }
```

截图：`below-1440-bar.jpg`、`below-1280-bar.jpg`、`below-1024-bar.jpg`、`below-768-card.jpg`、`below-390-card.jpg`。

#### 位置四：只在预订页

首页不放组件，只在 `/booking/` 放。建议放在页面标题下面整宽：宽屏横条、窄屏卡片；和标题区间距 32 px（< 600 px 时 16 px），下面留 64 px。

```css
.nozomi-slot--booking { width: 100%; max-width: 1280px; box-sizing: border-box; margin: 32px auto 64px; padding: 0 32px; }
@media (max-width: 1023px) { .nozomi-slot--booking { padding: 0 24px; } }
@media (max-width: 599px) { .nozomi-slot--booking { margin-top: 16px; padding: 0 12px; } }
```

截图：`booking-1440-bar.jpg`、`booking-1280-bar.jpg`、`booking-1024-bar.jpg`、`booking-768-card.jpg`、`booking-390-card.jpg`（标题区是为截图临时画的，不代表 `/booking/` 的实际样子）。

#### 共同注意

- 容器要有确定的宽度（块级元素、或 grid / flex 里给了列宽）。如果容器是「按内容收缩」的（`display: inline-block`、`float`、没给宽度的 flex 子项），组件量到的宽度会跟着自己变，横条 / 卡片可能来回换。
- 容器不要 `overflow: hidden`：人数行李的弹层、地址候选列表会往容器外面展开。
- 以上四种实测都没有横向滚动条（窗口 390 起；组件本身 320 px 起不横向滚动）。
