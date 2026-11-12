# 改进方案：测试环境的只读核对和 PR 版本预览（不在这次顺手改）

- 状态：方案，待业主决定是否立项（建议登记为单独任务）
- 2026-11-12：A 已立项为 M8-34，业主要求**不用 SSH**，改为「GitHub Actions + 只读平台账号」调用只读接口（ADR 0086，下面 A 里「用 ssh-setup 和部署钥匙」的写法作废）；B、C 仍是方案
- 提出：2026-11-11，接手 M8-30（PR #152）时
- 关联：M8-20、M8-30 的「回放最近 30 天询价」；`docs/deploy.md`；`.github/workflows/deploy.yml`

## 现状和问题

1. **只读核对只能上服务器跑**。`pnpm areas:role-preview`（回放最近 30 天询价，确认原来报得出的价 0 处变化）要用服务的应用账号连测试环境数据库，现在只能登录服务器执行。M8-20 是协调者登录服务器跑的，`docs/deploy.md` 没有写这一步。业主规定：没有文档的手动上服务器一律不做，所以 M8-30 合并后没法跑这个命令。
2. **PR 分支不能先上测试环境**。`deploy.yml` 只部署 main（自动部署只认 main 的 push 触发、成功的 CI；手动触发也只能选 main）。验收只能先合并再在测试环境验，不通过就 revert。
3. **main 的 CI 偶发失败就不部署**。#151 合并后的 CI 因为 `route-estimates.qa.itest.ts:346` 偶发失败，部署被跳过，测试环境停在旧版本，没人发现。

## 建议

### A. 新增「测试环境只读核对」手动工作流（建议先做）

- 新建 `.github/workflows/staging-readonly-check.yml`，只有 `workflow_dispatch`，环境固定 `staging`，用现有的 `ssh-setup` 和部署钥匙。
- 只允许跑白名单里的只读命令，下拉选择，不接受任意命令：
  - `areas:role-preview --days <1–90> --json`
  - `packages/config/src/cli.ts`（看哪些密钥已配置，只显示打码片段）
- 在服务器上执行 `/opt/nozomi/staging/current/bin/compose.sh exec -T api node … --json`，把输出作为 Actions 产物保存（不含客人信息，命令本身已保证）。
- `role-preview` 退出码 2（有变化）时工作流标红。
- 在 `docs/deploy.md` 加一节「在测试环境跑只读核对」，以后验收按文档点按钮，不用登录服务器。
- 测试：照现有 `deploy-script.test.ts` 的做法，给工作流加静态检查（只有 dispatch、白名单、环境只能是 staging）。

### B. PR 版本预览（可选，风险更高，建议 A 做完再评估）

- 方案一：`deploy.yml` 的手动触发加一个「PR 编号」输入，只允许部署到 staging、只允许本仓库分支、要求该 PR 的 CI 全绿。代价是测试环境会被 PR 版本覆盖，下一次 main 部署才恢复；数据库迁移只增不减，旧版本仍能跑，但 PR 里的迁移会先上测试库。
- 方案二：同一台服务器起第二套隔离的预览栈（独立数据库、独立子域名）。干净但要多一份资源和证书，由业主决定。

### C. main 部署被跳过时要有提醒

- `deploy.yml` 的 plan 在「main 的 CI 失败」时目前不运行；建议加一个监听 main 上 CI 失败的通知（例如在进度页或 roadmap 生成时标红「测试环境不是最新的 main」），避免测试环境悄悄落后。

## 需要业主决定

1. 是否立项 A（建议做，改动小、只读）。
2. B 选方案一、方案二，还是暂不做。
3. C 是否要做，提醒发到哪里（进度页即可，或邮件）。
