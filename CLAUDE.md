# NOZOMI 用车平台 · 开发规则

每个开发会话（包括每个 AI 角色）开始工作前都必须读完本文件。

## 这是什么

多租户的用车报价与服务平台：接送机、点对点、包车。供应商是租户，自己配置区域、商品、价格；平台负责比价、收款、派单、售后、结算，并通过 API 卖给官网和 OTA。

- 需求的唯一来源：`docs/requirements/01-tenant-and-quote-engine.md`、`docs/requirements/02-platform-operations.md`。两份文档末尾的「第 N 轮决策」优先于正文；冲突时以轮次大的为准。
- 技术决策：`docs/adr/`。改变已有决策要新增一篇 ADR，不能直接推翻。
- 进度：`docs/progress/roadmap.json`，自动生成进度页。
- 账号与密钥：`docs/secrets.md`。

## 与项目负责人沟通

- 负责人用简体中文沟通，不看代码。汇报写结果，不写过程：完成了什么、怎么验证的、需要他做什么。
- 需要他决定的业务问题，一次问清楚，给出推荐选项。
- 密钥只能由他本人填进各平台的设置页面，永远不要让他把密钥发在聊天里。

## 不可违反的规则

1. **没有演示数据**。不写任何预置的租户、订单、价格、用户。数据库只通过迁移创建结构，主数据（城市、机场、车型）从注明来源的公开数据导入。测试数据只在测试代码里构造，测试结束即清理。
2. **租户隔离**。所有租户表带 `tenant_id`；所有租户接口的 `tenant_id` 只能来自登录令牌，不能来自请求参数。每个新增的租户接口都必须有「租户 A 读不到、改不了租户 B」的集成测试。
3. **钱**。金额用最小货币单位整数，百分比用基点整数，统一四舍五入（`packages/domain/src/money.ts`）。禁止在业务代码里直接用浮点数算钱。
4. **租户看不到对外价和加价比例**。`/tenant/v1` 的任何返回都不能包含这两项。
5. **密钥**。只通过 `packages/config` 读取，代码、测试、日志、提交记录里不能出现密钥原文。
6. **每个改动都有测试**。纯逻辑写单元测试；接口写集成测试（连真实 PostgreSQL）；关键用户流程写端到端测试。CI 不绿不能合并。
7. **不写一次性代码**。不留注释掉的代码、调试输出、TODO 不跟任务编号的代码。临时方案必须在 roadmap 里有对应任务。

## 技术栈（见 ADR 0001）

- Node.js 24 + TypeScript（严格模式，只用可擦除语法，Node 直接运行 .ts），pnpm workspace。
- `packages/domain`：纯业务逻辑，不依赖数据库和网络。
- `packages/config`：配置与密钥。
- `apps/api`：后端（Fastify + PostgreSQL），M0-05 创建。
- `apps/web`：前端（React + Vite），M0-07 创建。
- 测试：Node 内置 `node:test`；端到端用 Playwright。
- 部署：负责人自有的 VPS（测试环境、正式环境，Docker Compose，见 ADR 0007），GitHub Actions 做 CI 和部署。

## 常用命令

```bash
pnpm install
docker compose up -d   # 本地数据库
pnpm db:provision      # 创建 / 校正应用用的数据库账号（首次和换密码后运行一次）
pnpm db:migrate        # 执行数据库迁移，可重复运行
pnpm dev               # 启动后端，http://localhost:8080/health
pnpm web:dev           # 启动前端开发服务器（会把接口请求转给本地后端）
pnpm web:build         # 构建前端到 apps/web/dist
pnpm admin:create --email <邮箱> --name <姓名>   # 创建平台超级管理员；密码按提示输入，不接受命令行参数
pnpm admin:reset-password --email <邮箱>         # 给超级管理员重设密码
pnpm masterdata:import-airports --country JP,KR  # 从 OurAirports（公有领域）导入机场，可重复运行；--all-countries / --file <csv> / --dry-run
pnpm check             # 类型检查 + 单元测试 + 集成测试 + 进度文件校验，提交前必须通过（需要本地数据库在运行）
pnpm test              # 只跑单元测试（不需要数据库）
pnpm test:integration  # 只跑集成测试（连真实 PostgreSQL）
pnpm test:e2e          # 端到端测试（Playwright）；第一次先运行 pnpm --filter @nozomi/web exec playwright install --with-deps chromium
pnpm config:check      # 看当前环境哪些账号已配置
pnpm progress:build    # 本地生成进度页到 site/index.html
```

## 一个任务的完整流程

见 `docs/workflow.md`。要点：

1. 从 `docs/progress/roadmap.json` 取一个「未开始」任务，改为「开发中」。
2. 新建分支 `<任务编号>-<简短英文名>`，如 `m0-05-api-skeleton`。
3. 按角色分工完成，`pnpm check` 通过。
4. 更新 roadmap：状态改为「待验收」，`evidence` 写 PR 链接和测试数量；在 `log` 末尾追加一条中文日志。
5. 开 PR，描述用中文写清「做了什么、怎么验证、负责人需要做什么」。
6. 验收角色验收通过后，状态改为「已验收」。

## 提交规范

- 提交信息：`<任务编号>: <中文说明>`，如 `M0-05: 新增 /health 接口`。
- 一个 PR 只做一个任务。
