# 开发流程与 6 个 AI 角色

## 角色

| 角色 | 文件 | 负责 | 不能做 |
| --- | --- | --- | --- |
| 产品 | `.claude/agents/product.md` | 把需求拆成任务，写验收标准，维护 roadmap | 写业务代码 |
| 美工 | `.claude/agents/designer.md` | 设计规范、页面布局、样式 | 改后端代码 |
| 后端 | `.claude/agents/backend.md` | 接口定义、数据库、业务逻辑、单元和集成测试 | 改前端、改验收结论 |
| 前端 | `.claude/agents/frontend.md` | 各个后台和官网页面 | 改后端、改设计规范 |
| 测试 | `.claude/agents/tester.md` | 补测试、找边界情况、报缺陷 | 改业务代码 |
| 验收 | `.claude/agents/acceptance.md` | 在测试环境逐条对照验收标准，写验收报告 | 改任何代码 |

写代码的角色不能验收自己的工作；测试和验收角色不能改业务代码。

## 一个任务从开始到验收

```mermaid
flowchart LR
  A[产品：写任务和验收标准] --> B[美工：页面规范<br>只限有界面的任务]
  A --> C[后端：接口 + 测试]
  B --> D[前端：页面 + 测试]
  C --> D
  C --> E[测试：补边界测试]
  D --> E
  E --> F[CI 全绿 → 开 PR]
  F --> G[验收：测试环境逐条验收]
  G -->|不通过| C
  G -->|通过| H[负责人合并]
```

## 完成的定义（Definition of Done）

- 验收标准逐条满足，每条都能指到测试或验收报告里的证据。
- 本机按下面「本机检查与 CI 的分工」跑完该跑的检查，CI 全绿（CI 跑全套，是唯一的「通过」标准）。
- 没有演示数据、没有密钥原文、没有注释掉的代码。
- 接口变化同步更新 OpenAPI 文档。
- roadmap 已更新，日志已追加。

## 本机检查与 CI 的分工（2026-11-10 起，从 M8-19 开始）

两个角色同时在本机共用一个数据库跑全套 `pnpm check`，一次要 1.5 小时左右。改为：

- **本机只跑和改动相关的**：类型检查（`pnpm typecheck`）、lint（如有），加上受影响模块的单元 / 组件测试和对应的集成测试、端到端测试（只跑相关文件，`node --test <文件>`、`pnpm --filter @nozomi/web exec playwright test <文件> --workers=1`）。改了共用模块（`packages/domain`、`packages/config`、`apps/api/src/app.ts`、数据库迁移、接口定义等）时，相关范围要放宽到所有引用它的测试。
- **全套交给 CI**：PR 的 CI（check、e2e、deploy-smoke）全绿才算通过，质量标准不降。CI 有失败一律先查原因；确认是和本改动无关的偶发失败，要在 roadmap 里有对应的去偶发任务，才可以重新触发。
- **必须在本机跑全套时**（例如改了测试基础设施、迁移框架），两个角色错开跑，不要同时跑；开始前先看有没有别的 `pnpm check` / `pnpm test:integration` 进程在跑。
- 交回报告写清本机跑了哪些测试、多少条，以及 PR 的 CI 结果。

## 在 claude.ai/code 里怎么开始一个会话

在 claude.ai/code 选择本仓库，发一句话即可，例如：

> 按 CLAUDE.md 和 docs/workflow.md，做 roadmap 里下一个未开始的任务。

需要指定角色时：

> 用 backend 角色做 M0-05，完成后用 tester 角色补测试，再用 acceptance 角色验收。
