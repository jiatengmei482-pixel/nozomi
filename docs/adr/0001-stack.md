# ADR 0001：技术栈

- 状态：已采纳（2026-10-07）

## 决定

- 语言：TypeScript（严格模式），前后端同一种语言，类型在 `packages/` 里共享。
- 运行时：Node.js 24。只用「可擦除」的 TypeScript 语法（不用 enum、namespace、参数属性），让 Node 直接运行 `.ts` 文件，后端不需要编译步骤。
- 包管理：pnpm workspace。`packages/*` 放共享逻辑，`apps/*` 放可部署的应用。
- 后端：Fastify + PostgreSQL 16。
- 前端：React + Vite。
- 测试：Node 内置 `node:test`（零依赖），端到端用 Playwright。
- CI：GitHub Actions；部署：Render。

## 理由

- 单一语言降低多个 AI 角色之间的交接成本；共享类型保证前后端接口一致。
- 少依赖、少构建步骤，出问题时更容易定位。
- Render 同时提供 Web 服务和 PostgreSQL，适合当前规模，以后可迁到其他云。
