# MoveGlobal 工厂接入 NOZOMI 预订组件：改动说明

- 读者：维护 MoveGlobal 工厂（`registry.moveglobal.io/admin`，Astro 生成静态站点，nginx 提供）的开发。
- 写法：照着改即可。我们看不到 moveglobal 仓库，文中的「站点设置」「首页模板」「/booking/ 页模板」等是按页面输出反推的叫法，**具体文件名、字段名请按你们的代码对上**。
- NOZOMI 侧依据：ADR 0090（`docs/adr/0090-embed-widget-booking-drafts.md`）、`apps/web/src/embed/widget-core.ts`、`packages/domain/src/embed.ts`、`apps/api/src/routes/embed.ts`。
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

## 2. 后台改动：「预订归属」加两个字段

| 字段（界面名） | 建议存储名（按你们的命名改） | 取值 | 规则 |
| --- | --- | --- | --- |
| 预订组件来源 | `bookingWidgetProvider` | `goodjourney` / `nozomi`，界面显示「Good Journey」/「NOZOMI」 | 单选，**默认 Good Journey** |
| NOZOMI 嵌入码 | `nozomiEmbedKey` | 字符串 | 选 NOZOMI 时必填；选 GJ 时不校验、不输出（可以留着值，方便来回切换） |

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
- 不需要写迁移、不需要回填任何站点；
- 后台编辑页打开老站点时，「预订组件来源」显示为 Good Journey。

建议把这条判断收在一个函数里（例如 `bookingWidgetProviderOf(site)`），后台显示和渲染都只调它，避免两处口径不一。

## 3. 渲染改动

### 3.1 选 GJ：输出和现在逐字相同

GJ 分支**原样保留现在的代码路径**，不调整空格、属性顺序、换行，也不要顺手「整理」。验证方式见第 5 节的快照测试。

GJ 模式完整示例（即现状；`fleetToken`、`corporateId`、`color` 为占位）：

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

NOZOMI 模式完整示例（站点 73，站点语言 zh-CN；嵌入码为占位）：

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
| 组件脚本 | `https://nozomi.moveglobal.io/embed/widget-v1.js`，带 `defer` | 必须从这个地址直接加载：组件只认路径为 `/embed/widget-v1.js` 的 `<script>` 元素，并把它的域名当作 NOZOMI 主站。**不要下载转存、改名、合并打包**。做错时有两种表现：① 改了文件名或合并进别的文件：组件不渲染，控制台报 `NozomiBooking：请直接从主站的 /embed/widget-v1.js 加载组件脚本（不要改名、转存或合并进别的文件）。`；② 转存到工厂站点自己的 `/embed/widget-v1.js`：组件把工厂站点当成主站，取配置失败，显示「暂时无法使用」，控制台报 `NozomiBooking：取不到组件配置。请确认本网站已加入嵌入码的白名单，嵌入码未停用。`（和白名单没加的表现一样，排查时先看脚本地址） |
| 初始化时机 | `DOMContentLoaded` 里调 `NozomiBooking.init` | `defer` 脚本在 `DOMContentLoaded` 之前执行完，此时 `NozomiBooking` 一定已定义。站点如果用了 Astro 的站内软跳转（`<ClientRouter />`），见 3.5 |
| `key` | 站点的 NOZOMI 嵌入码 | 必须转义后写入（见 3.3） |
| `root` | `"#nozomi-booking"` | 固定 |
| `lang` | 按站点语言映射：日语 → `"ja"`；中文简体或繁体（`zh`、`zh-CN`、`zh-TW`、`zh-HK`、`zh-Hans`、`zh-Hant` 等，即 `zh` 本身或以 `zh-`、`zh_` 开头；日语同理是 `ja`、`ja-JP` 等）→ `"zh"`；其他 → `"en"` | 组件只认 `zh` / `ja` / `en`；不认识的值会被忽略、改用 NOZOMI 后台给这个嵌入码设的默认语言，所以工厂一定要按表映射好再传 |
| `services` | `["transfer","charter"]` | 区间、包车两个标签，顺序即标签顺序 |
| `redirectUrl` | 站点首页 `https://<站点域名>/` | 付款完成后订单页「返回原网站」的链接。见下面「redirectUrl 的规则」和第 4 节 |

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

`redirectUrl` 由站点域名拼出来，也用同一个函数写入。`lang` 和 `services` 是固定值，直接写常量。

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
const nozomiInit = provider === "nozomi"
  ? `
  window.addEventListener("DOMContentLoaded", function () {
    NozomiBooking.init({ key: ${scriptLiteral(nozomiEmbedKeyOf(site))}, root: "#nozomi-booking", lang: "${nozomiLang}", services: ["transfer","charter"], redirectUrl: ${scriptLiteral(`https://${site.domain}/`)} });
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

**重复调用 init 是否安全**（按 NOZOMI 组件代码 `apps/web/src/embed/widget-ui.ts` 核过）：对同一个容器再调一次 `init`，组件复用容器上已有的 Shadow DOM，重新取一次配置，渲染前先清掉上一次的内容，最后只显示一份表单；组件不在 `window` / `document` 上挂监听。旧实例不会马上完全停下，但不会出错：

- 组件有短定时器：地址提示停顿 300 毫秒后才查候选（防抖）；选中候选后取位置最多等 10 秒。旧实例里已经开始的定时器照常到点。
- 旧实例已经发出的请求会照常跑完，结果写进已经被清掉的旧内容，不影响新表单。
- 例外：如果客人在旧实例上已经点了「查询价格」、正在等结果，成功后照样会整页跳到 NOZOMI 主站（这正是客人要的）。
- 不支持 `adoptedStyleSheets` 的老浏览器上，每调一次 `init` 容器里多一个 `<style>`，只是重复的样式。

代价是每调一次多一个取配置请求，客人已经填了一半的内容会被清掉。所以仍建议像上面那样用 `data-nozomi-init` 防重。

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
   - 首页和 `/booking/` 都输出 3.2 那一整段，`redirectUrl` 都是首页；
   - 整个 HTML 里**没有** `initGJBookingForm`、`GJBookingWidget`、`widget.goodjourney.io`、`gojo-widget-container`；
   - `nozomi-booking` 容器、`widget-v1.js`（带 `defer`）各出现一次，`NozomiBooking.init` 出现一次；`DOMContentLoaded` 只在组件那段代码里数（站点主题等别处的脚本可能本来就有 `DOMContentLoaded`，按整页数会误报）。
3. **小单元测试**（建议）：
   - 语言映射表：`ja`、`ja-JP` → `ja`；`zh`、`zh-CN`、`zh-TW`、`zh-Hant` → `zh`；`en`、`ko`、`th`、空值 → `en`；
   - `scriptLiteral`：输入含 `</script>`、`"`、`\`、U+2028 时，输出里没有 `<`、没有未转义的引号，`JSON.parse` 回来等于原值；
   - 后台校验：`nze_` + 32 位合法、31 / 33 位拒、前缀错拒、含 `+` `/` `=` 拒、首尾空格去掉后通过；
   - `bookingWidgetProviderOf`：字段缺失、空串、未知值都返回 `goodjourney`；
   - 选了 NOZOMI 但嵌入码缺失、空串、只有空格、格式不对：构建（或渲染这个站点）失败，错误信息里有站点 ID / 域名和「NOZOMI 嵌入码」，不含嵌入码的值；同一批里的其他站点不受影响（如果按 3.3 做了按站点隔离）。

## 6. 前提（NOZOMI 侧先做，工厂侧上线前确认）

1. **白名单**：站点域名必须先加进这个嵌入码在 NOZOMI 运营后台的域名白名单。只写**协议 + 域名**（如 `https://embed-demo.moveglobal.io`），**不带路径、查询**（结尾一个 `/` 可有可无，会被规范化掉）；只收 `https://`（NOZOMI 测试环境另外收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`，用于本机调试，对工厂没有影响）；不支持通配符，`www.` 和不带 `www.` 算两个不同的网站。
   站点 73：经 NOZOMI 侧确认，2026-11-14 已在 NOZOMI 测试环境运营后台建好嵌入码「MoveGlobal 演示站」，白名单 `https://embed-demo.moveglobal.io`，默认语言 `ja`，默认标签区间 + 包车。嵌入码的值由 NOZOMI 侧另行提供，不写在本文里。工厂传了 `lang` 和 `services` 时以工厂传的为准：站点 73 的语言是 zh-CN，按 3.2 的映射传 `lang: "zh"`，所以组件显示**中文**，不是后台默认的日文。
2. **生效时间**：白名单改动、停用 / 启用嵌入码，NOZOMI 服务端立即生效；组件的配置应答在浏览器里缓存 60 秒，所以**最迟 60 秒**后所有访客都按新设置。
3. **内容安全策略**：现在页面没有 CSP，不需要改。以后如果给站点加 CSP，`script-src` 和 `connect-src` 都要放行 `https://nozomi.moveglobal.io`（组件脚本从这里加载，组件也向这里请求配置、地址提示、建预订草稿）；初始化那段内联脚本也要被 `script-src` 允许（nonce 或 hash，按你们加 CSP 的方式）。组件的样式在 Shadow DOM 里，不加载任何第三方字体、图片。
4. 组件不需要、也不会读写站点的 Cookie；请求一律不带凭据。

## 7. 验收步骤

在测试环境做，全部用 Stripe 测试卡，不产生真实扣款。

### 7.1 站点 73 切到 NOZOMI

1. 工厂后台站点 73 →「预订归属」→ 预订组件来源选 NOZOMI，填入「MoveGlobal 演示站」的嵌入码，保存，**重新发布站点**。
2. 打开 `https://embed-demo.moveglobal.io/`，查看页面源代码：有 3.2 那一段，`lang` 与站点语言对应，没有任何 GJ 的脚本和容器。`/booking/` 同样。
3. **区间**：在组件里选「区间」，填出发地、目的地（从候选里选）、日期、时间、人数、行李，点「查询价格」→ 整页跳到 `https://nozomi.moveglobal.io/book/new?draft=…`，条件已预填并自动报价 → 选车、填乘客信息 → 用测试卡 `4242 4242 4242 4242`（有效期填任意将来日期，安全码任意 3 位）付款 → 订单页出现「返回原网站」，点它回到 `https://embed-demo.moveglobal.io/`（首页，不是 `/booking/`）。
4. **包车**：同上，选「包车」，可加经停点和停留时长（不加经停点时在主站预订页选包车时长），走完同样流程，同样回到演示站首页。
5. NOZOMI 侧核对：两张单在 NOZOMI 运营后台的订单来源显示「嵌入组件 · embed-demo.moveglobal.io（MoveGlobal 演示站）」。

### 7.2 不在白名单的网站被拒

1. 把 3.2 那一段（填同一个嵌入码）存成本地 HTML 文件直接用浏览器打开（`file://`，浏览器发的 `Origin` 是 `null`），或放到另一个不在白名单里的网站上。
2. 组件位置只显示「预订组件暂时无法使用。请稍后刷新，或直接到主站预订。」（按 `lang` 显示对应语言）和一个「到主站预订」链接，**不出现表单**；浏览器控制台有一行 `NozomiBooking：取不到组件配置。请确认本网站已加入嵌入码的白名单，嵌入码未停用。`
3. 因为没有表单、无法提交，不会建预订草稿，也不会产生任何订单数据；NOZOMI 服务端对这类请求一律 403，不建任何数据。

### 7.3 已有站点不受影响

1. 第 5 节快照测试全部通过（moveglobal、anshinride 及其他站点改前改后逐字相同）。
2. 发布后打开 moveglobal、anshinride 线上首页和 `/booking/`，页面源代码与改动前保存的一份逐字比对相同，GJ 组件照常显示、能走到 GJ 的预订流程。

## 8. 风险和回退

- **回退**：工厂后台把站点的「预订组件来源」切回 Good Journey，**重新发布**。GJ 的两项设置一直保留着，切回即恢复原样；NOZOMI 嵌入码可以留在设置里不删。
- **页面是静态生成的**：改任何设置（切换来源、改嵌入码、改站点语言或域名）都**要重新发布站点才生效**；只保存不发布，线上页面不变。如果 nginx 或前面的 CDN 缓存了 HTML，发布后按你们现有的方式清缓存。
- **紧急止血（NOZOMI 侧）**：如果 NOZOMI 组件出问题而工厂暂时没法重新发布，NOZOMI 可以在运营后台停用这个嵌入码，60 秒内所有页面上的组件变为「暂时无法使用」并给出主站链接——这只是止血，真正的回退仍是切回 GJ 并重新发布。
- **嵌入码填错或白名单漏了域名**：组件显示「暂时无法使用」，不影响页面其他部分。按 7.2 的控制台提示排查；白名单改完最迟 60 秒生效，不需要重新发布站点。
- **跳到 NOZOMI 后的语言**：组件有中 / 日 / 英，跳到的 NOZOMI 主站预订页目前只有中文，日语、英语站点的客人会在跳转后看到中文。这是 NOZOMI 侧的已知限制（ADR 0090 第八节 Q8），不需要工厂处理。
- **环境**：组件地址现在指向 NOZOMI 测试环境，只能用 Stripe 测试卡下单。正式上线前不要把真实客流的站点切到 NOZOMI。

## 9. 联系与分工

| 事项 | NOZOMI 侧 | 工厂侧 |
| --- | --- | --- |
| 嵌入码 | 在运营后台建嵌入码、设默认语言和标签、维护域名白名单、需要时停用 / 换码，把嵌入码交给工厂侧（不经公开渠道） | 在站点设置里填嵌入码 |
| 组件本身 | `widget-v1.js` 的功能、样式、兼容性、多语言文案；`/embed/v1` 接口、限速、白名单校验 | — |
| 预订、付款、订单 | 主站报价、下单、Stripe 收款、订单页「返回原网站」 | — |
| 后台 | — | 「预订归属」加两个字段、格式校验、缺字段按 GJ |
| 渲染 | — | GJ 分支逐字不变；NOZOMI 分支按第 3、4 节输出，转义；首页和 `/booking/` |
| 测试 | 组件和接口自己的单元、集成、端到端测试 | 第 5 节的快照和单元测试 |
| 发布 | — | 重新发布站点 73；以后其他站点切换由工厂侧按站点发布 |
| 验收 | 提供嵌入码、确认白名单，核对订单来源（7.1 第 5 步） | 按第 7 节走一遍，结果反馈给 NOZOMI 侧 |
| 内容安全策略 | 告知需要放行的域名 | 将来加 CSP 时放行（第 6 节第 3 条） |

组件显示异常、白名单、嵌入码的问题找 NOZOMI 侧；站点生成、发布、后台字段的问题由工厂侧处理。双方通过 NOZOMI 仓库的 issue 或既有沟通渠道联系，嵌入码不要贴在公开 issue 里（虽然它不是密钥，也没必要扩散）。
