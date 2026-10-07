# NOZOMI 用车平台

多租户的用车报价与服务平台：接送机、点对点、包车。供应商作为租户配置区域、商品和价格；平台负责比价、收款、派单、售后和结算，并通过 API 对接官网和 OTA。

## 现在做到哪了

看开发进度页（GitHub Pages，每次 main 更新自动刷新）。数据来源是 [`docs/progress/roadmap.json`](docs/progress/roadmap.json)。

## 第一次使用这个仓库（负责人要做的事）

1. **开启进度页**：仓库 → Settings → Pages → Build and deployment → Source 选「GitHub Actions」。之后进度页网址会出现在 Actions 的「Progress page」运行结果里。
2. **填写账号**：按 [`docs/secrets.md`](docs/secrets.md) 在各平台的设置页面填写，不要发在聊天里。
3. **开始开发**：在 [claude.ai/code](https://claude.ai/code) 选择本仓库，发：
   > 按 CLAUDE.md 和 docs/workflow.md，做 roadmap 里下一个未开始的任务。

## 开发者

```bash
pnpm install
pnpm check            # 类型检查 + 测试 + 进度文件校验
pnpm config:check     # 当前环境哪些账号已配置（只显示脱敏信息）
pnpm progress:build   # 生成进度页到 site/index.html
docker compose up -d  # 本地数据库
```

规则见 [`CLAUDE.md`](CLAUDE.md)，流程见 [`docs/workflow.md`](docs/workflow.md)，技术决策见 [`docs/adr/`](docs/adr/)。
