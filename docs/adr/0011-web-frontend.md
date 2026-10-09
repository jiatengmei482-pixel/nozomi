# ADR 0011：前端骨架、令牌存放、前端测试

- 状态：已采纳（2026-10-07，M0-07）

## 决定

### 一个前端应用，两个后台

- `apps/web`（包名 `@nozomi/web`）：React 19 + Vite + TypeScript，路由用 react-router。严格模式和「只用可擦除语法」与后端相同（`apps/web/tsconfig.json` 继承根配置，只加了 DOM 类型和 JSX）。
- 供应商后台在根路径下（`/login`、`/`），运营后台在 `/platform` 下（`/platform/login`、`/platform`）。两边是同一批页面组件，区别集中在 `src/lib/portal.ts` 一张表里。
- **不引入 UI 组件库和 CSS 框架**。组件按 `docs/design/02-components.md` 自己实现，用到哪个做哪个；样式是普通 CSS 文件，只引用设计令牌。
- 设计令牌只有一份：`apps/web/src/styles/tokens.css` 只有一行 `@import` 指向 `docs/design/tokens.css`，由 Vite 在构建时并入。`styles.test.ts` 检查样式里没有写死的颜色、字号、层级，媒体查询只用令牌里的断点。

### 同源部署，前端只用相对路径

- 正式环境里前端静态文件和 API 在同一个域名下，反向代理把 `/health`、`/platform/v1/*`、`/tenant/v1/*`、`/sales/v1/*`、`/webhooks/*` 转给 API，其余路径交给前端（找不到文件时回退到 `index.html`）。所以前端一律用相对路径调 API，后端不需要 CORS。
- 这张前缀表写在 `apps/web/src/lib/api-prefixes.ts`，开发服务器和端到端测试的 Vite 代理用的是同一张表；测试保证前端路由不落在这些前缀下、`openapi.yaml` 里的每个路径都在表内。**部署用的反向代理配置要与它保持一致。**

### 访问令牌放在内存 + sessionStorage

后端发的是 Bearer 令牌，没有 Cookie 会话（ADR 0008），前端必须自己保存它。

- 放在内存和 `sessionStorage` 里：关掉标签页即失效，刷新页面不用重新登录。**不放 `localStorage`**。
- 只存令牌和过期时间；账号资料每次从 `auth/me` 取，不落在浏览器里。
- 两个后台各用一个键（`nozomi.session.tenant`、`nozomi.session.platform`），互不覆盖，退出一边不影响另一边。
- 任何接口返回 401，或本地记录的过期时间已到：清掉令牌，带着「登录已过期」回登录页，登录后回到原来的页面（回跳地址只接受本后台内的站内路径）。
- 退出登录时通知后端作废会话；即使这次请求没发出去，本地令牌也照样清掉。

取舍：

- 页面里的脚本读得到 `sessionStorage`，所以一旦出现 XSS，令牌可以被偷走。`localStorage` 同样如此，而且令牌会留到 8 小时过期为止、所有标签页共享；`sessionStorage` 把暴露面缩小到「这个标签页还开着的时候」。真正防 XSS 偷令牌要靠 HttpOnly Cookie，那需要后端改成 Cookie 会话并处理 CSRF，属于改变 ADR 0008 的决定，这里不做。
- 现阶段的防线：不引入第三方脚本、不加载外部资源、不用 `dangerouslySetInnerHTML`；全站 `<meta name="referrer" content="no-referrer">`。上线前应由反向代理加 Content-Security-Policy 响应头（`index.html` 里有一段设置主题的内联脚本，CSP 要给它哈希或把它挪成外部文件）。
- 代价：新开一个标签页要重新登录；手机浏览器回收后台标签页后也要重新登录。会话本来就只有 8 小时，可以接受。

### 邀请和重置链接：令牌放在 `#` 后面

- 链接格式：`/accept-invite#token=…`、`/reset-password#token=…`，运营后台是 `/platform/accept-invite#token=…`、`/platform/reset-password#token=…`。
- `#` 后面的内容浏览器不会发给服务器：令牌不进反向代理的访问日志，也不会随 Referer 带出去。
- 后端目前只返回令牌，不生成链接；以后做「复制邀请链接」的页面时按这个格式拼。

### 接口类型：手写 + 对账测试

- 请求和响应的类型手写在 `apps/web/src/api/types.ts`，角色、操作等枚举直接用 `@nozomi/domain` 的定义。
- `apps/web/src/api/contract.test.ts` 读 `apps/api/openapi.yaml` 逐项核对：用到的路径和方法、各 schema 的字段名与必填、响应引用的 schema、枚举值、前端依赖的错误码。后端改了接口，前端的测试会失败。
- 没有用代码生成器：现成的生成器依赖多，而且对本项目用的 TypeScript 版本没有声明支持；目前只用到 6 个接口，手写加对账更轻。接口多起来以后可以新增 ADR 换成生成。

### 密码规则只有一份

- 前端直接引用 `@nozomi/domain` 的 `checkPasswordStrength` 和 `PASSWORD_ISSUE_MESSAGES` 做即时提示，文案与后端逐字相同。后端仍是最终把关，后端拒绝时把它返回的说明显示在输入框下。

### 前端测试

- 纯逻辑：`*.test.ts`，Node 内置 `node:test`，和后端的单元测试一起跑。
- 组件：`*.test.tsx`，仍然是 `node:test`。Node 不认识 JSX，`apps/web/test/register.mjs` 用仓库已有的 TypeScript 在加载时转换 `.tsx`，并注册 happy-dom 作为浏览器环境；配合 @testing-library/react。接口用测试替身（替换 `fetch`）。`pnpm test` 一条命令跑完两类。
- 端到端：Playwright（Chromium），针对真实运行的 API 和真实 PostgreSQL，不 mock 接口。`apps/web/e2e/global-setup.ts` 新建临时 schema → 迁移 → 用 `admin:create` 命令行建平台管理员 → 起 API（18080）和构建好的前端（14173）；结束后停进程、删 schema。包含 360 / 400 / 1280 三个宽度下各页面各状态的横向溢出断言、亮暗两套主题、axe 无障碍检查、纯键盘登录。
- `pnpm check` 不包含端到端测试（它需要下载浏览器并占用端口）；CI 有单独的 `e2e` 任务，必须通过。

## 理由

- 两个后台放在一个应用里：页面、组件、登录逻辑完全相同，分成两个应用只会多一套构建和部署。以后要给运营后台单独加访问限制（IP 白名单、公司统一登录），按 `/platform` 这个路径前缀在反向代理上做即可。
- 组件测试不用 Vitest / Jest：项目规定测试用 `node:test`（ADR 0001），加一个 30 行的加载脚本就能跑 React 组件，不必再引入一套测试框架。
- happy-dom 而不是 jsdom：依赖更少、启动更快；它没有的能力（真实布局、`<dialog>` 的模态行为、媒体查询）本来就该由端到端测试覆盖。

## 已知限制

- 后端没有「只核对令牌、不设置密码」的接口，所以设置密码页进来时不知道是哪个邮箱、令牌是否有效：不能显示账号邮箱，「密码不能包含邮箱名」只能由后端在提交时把关，链接失效也要到提交时才知道。
- 后端的错误应答里没有请求编号，出错提示里暂时没有「编号：…」这一行。
- 登录状态不跨标签页同步：在另一个标签页退出后，这个标签页要到下一次请求返回 401 才会回到登录页。
