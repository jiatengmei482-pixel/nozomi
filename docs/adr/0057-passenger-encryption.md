# ADR 0057：乘客信息加密存储（双写、回填、读密文，明文留到后续一步）

- 状态：已采纳（2026-11-01，M4-22）
- 实现 ADR 0055 决定三的第 1～5、7 步，第 6 步（清空明文）不在这一轮。修订 ADR 0055 决定三的三处，见「和 ADR 0055 不同的地方」。
- 负责人不参与中间过程，取舍都按「安全、保守、可回退」选。

## 决定

### 密钥

- 不新增要负责人填的密钥。沿用 `DATA_ENCRYPTION_KEY`（ADR 0027，只经 `packages/config` 读取），按用途用 HKDF 派生：加密用 `passenger-data`，盲索引用 `passenger-index`，互不相通，也和收款账号、Webhook 密钥等不相通。
- 按租户隔离，做法和收款账号一致：密文的附加数据带租户和记录编号（搬到别的行、别的租户解不开）；盲索引的 HMAC 输入带租户编号（同一个邮箱在两个租户的索引值不同）。
- 主密钥没配置（只可能是 local / ci，production 配置校验已经拦下）：启动记一条错误日志；下单、改乘客信息返回 503 `PASSENGER_ENCRYPTION_NOT_CONFIGURED`，不写入新的乘客信息；已有订单继续能读（读明文）。

### 存什么

| 表 | 新增列 | 内容 |
| --- | --- | --- |
| `orders` | `passenger_enc`、`passenger_email_bidx`、`passenger_phone_bidx`、`passenger_name_bidx` | 乘客三项的密文；带密钥的 HMAC-SHA256 盲索引 |
| `order_changes` | `values_enc` | 含乘客的改单前后值的密文 |
| `webhook_deliveries` | `event_data_enc` | 含乘客的推送内容的密文 |
| `notifications` | `recipient_enc` | 给客人的通知的收件地址密文 |

### 三个开关

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `PASSENGER_READ_SOURCE` | `ciphertext` | 改成 `plaintext` 重启，就退回读明文（第一道回退） |
| `PASSENGER_BACKFILL_ENABLED` | `true` | 后台回填任务 |
| `PASSENGER_PLAINTEXT_WRITE` | `true` | 第 6 步的开关：`false` 时明文列只写占位。本轮保持 `true` |

实现细节、测试和演练记录随代码补充。
