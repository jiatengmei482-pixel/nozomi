# ADR 0005：配置与密钥

- 状态：已采纳（2026-10-07）
- 由 ADR 0041 补充（2026-10-26，M4-09）：谷歌地图、Stripe 的密钥也可以由超级管理员在运营后台填写（加密存库，后台的优先）；生效的值仍只经 `packages/config` 选出。其余配置和密钥不变。

## 决定

- 所有配置和密钥只来自环境变量，由 `packages/config` 在启动时一次性校验，出错立即退出并列出全部问题。
- 密钥存放位置只有 4 处：本地 `.env`、claude.ai/code 云端环境变量、GitHub Actions Secrets、Render 环境变量（见 docs/secrets.md）。
- 非正式环境禁止使用 Stripe 正式密钥；正式环境必须使用正式密钥。
- 对外只暴露脱敏的配置状态（`integrationStatus`），用于健康检查和后台的集成状态页。
