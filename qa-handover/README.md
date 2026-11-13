# 交接用的验收脚本（2026-11-13，换 Codespace 用）

这些是测试环境验收时用的辅助脚本，原本放在仓库外的 `~/nozomi-wt/m814acc`、`~/nozomi-wt/tools` 等目录。只在这个分支保存，不合并进 main。

- 口令、密码、TOTP 都从 `~/.ssh/nozomi/` 下的私密文件读取，脚本里没有任何密钥原文；会话令牌、订单链接（`.state.json`、`.orders`、`.driverlinks`）没有提交。
- 新 Codespace 里把 `acceptance/` 复制回 `~/nozomi-wt/m814acc/`、`tools/` 复制回 `~/nozomi-wt/tools/` 即可原样使用。
- 只用 QA 测试供应商和测试支付，绝不用 Tokyo-Taxi。
