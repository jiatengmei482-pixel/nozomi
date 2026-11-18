# ADR 0103：AI 行程报价 P1b——行程订单「多张子订单、一次付款」（付款篇）

- 状态：**草案（待独立审查、待监工确认）**（2026-11-19，第二稿：按独立审查第一轮修改，见文末「修改记录」）。
- 工作项：**M9T-11**（本篇，只有文档和 roadmap）；实施任务见第十二节，审查通过、监工确认、业主定第十三节后再在 roadmap 登记。
- 起因：业主 2026-11-18（经监工在 #288 转达）决定 ①：多段方案先走 A「提交预订，客服确认」（ADR 0101 第十三节第 3 小节，M9T-10 已实施，#326 / #327），**同时开始写 P1b「一次付款多张子订单」的付款 ADR**；③：页面按钮和本篇由第二开发做。
- 依据（冲突时按这个顺序）：
  1. 业主《NOZOMI AI 行程报价 · 设计方案（草案 v1）》`docs/requirements/ai-trip-quote-design-2026-11-14.md`（下称「原文」）；
  2. ADR 0094（下称「设计篇」）第二节第 2 小节「和现有 `orders` 的关系」、第五节第 3 小节「锁价和有效期」、第五节第 4 小节「行程下单与一次付款」——本篇是它的**实施篇**，设计篇建议「P1b 开工前由后端另写一篇行程订单付款 ADR，财务口径一起审」；
  3. ADR 0101（P1 后端，已采纳）：行程单、方案、段、跨段费用的现有数据（迁移 `0600_trip_quote.sql`）、第十三节下单出口；
  4. 现有下单与付款：ADR 0026（下单与 Stripe 付款）、ADR 0029（取消、改单、事后加收、退款）、ADR 0040（供应商账单）、ADR 0046（官网 Stripe Elements）、ADR 0049（通知中心）。
- 编号：main 上最大是 0102（区域共用与重叠清理）；远端分支和在途 PR 没有占用 0103 的 ADR 文件，这里用 **0103**。数据库迁移在实施时取当时下一个空号（main 上最大 `0640_area_cleanup_backups.sql`，下文暂记 **0650**）。
- **硬约束（监工 2026-11-15，沿用 ADR 0101）**：只新增表、新增接口、新增模块；**不给现有表加列**、不改现有报价接口的入参与结果。**单段订单的行为一点不变**。
  - **本篇做不到「只加代码、不碰现有代码」**，明确写出来（设计篇第〇节第 4 条早已指出）：现有下单、付款回调、超时取消、取消、退款、异常队列、乘客资料保留都以「一单一笔 `order_payments`」为前提，子订单没有自己的下单付款，这些地方要加「属于行程就走行程分支」的判断。改动清单见第九节，列为待监工放行的 **B1**；判断一律以「`trip_order_items` 里有没有这张单」为准，普通订单走的代码路径不变，由现有测试一条不改全部通过来守。
  - **唯一碰现有表结构的是 B2**：放宽账单明细 `statement_lines` 的两条约束（种类、正负号）以接纳跨段费用行（第六节）。这是对「只新增、不改现有表」的**例外**（不加列，但改约束），必须监工书面放行。

---

## 〇、结论摘要

1. **P1b 要替代的是 A 的过渡做法**：多段方案（以及带跨段费用的单段方案，例如加了第二司机）从「提交预订，客服确认」改为**客人直接下单、一次付款**；只有一段且没有跨段费用的方案继续走 M9T-10 的桥接（普通报价 → `/book/new`），不动。
2. **子订单就是普通订单**：每一段一张 `orders` + `order_sales`，引用这一段自己的正式报价（`quotes`），派单、司机、改期、救援、售后、账单都走现有子订单流程；子订单可以属于不同供应商，租户隔离不变（设计篇第二节第 2 小节）。
3. **数据新增 7 张表**（第二节）：`trip_orders`、`trip_order_items`、`trip_order_fees`（租户表）、`trip_order_fee_sales`、`trip_payments`、`trip_refunds`、`trip_order_links`。比设计篇少了 `trip_quotes`、`trip_payment_allocations`、`trip_fee_settlements`（理由见第二节末表）。**不给现有表加列**；子订单的改期补差价、事后加收仍写现有 `order_payments`（新行，`kind = change / extra_charge`），不另造。
4. **下单在一个平台事务里建全部子订单**：先查幂等键，再逐段走正式询价写 `quotes`，总价与方案一致才进事务；事务里先插 `trip_orders` 占住幂等键，任何一段售罄、下架、报价过期都整单回滚，不会留下半张行程。全部子订单的加锁一律按 (租户, 商品, 服务日期, 订单) 的同一顺序（第三节第 4 小节）。
5. **一笔 Stripe PaymentIntent 付总额**（`setup_future_usage: off_session`、只收银行卡，同现有单段），3DS 由 Stripe.js 在客人页面完成；付款成功的回调在一个事务里逐张确认子订单。付款期限 30 分钟在行程订单上，超时由新的行程超时扫描整单取消；现有超时扫描跳过子订单。
6. **跨段费用（住宿、停驻、第二司机及其负数抵扣）挂到具体一张子订单**（规则见第五节第 1 条）：客人那边算进这张子订单分到的金额，供应商那边作为这张子订单的附属结算行。取消、退款、救援都跟着这张子订单走，不需要「行程级」的结算与退款口径。
7. **取消与退款按段**：整单取消 = 逐张子订单按各自的取消阶梯算；退款从同一笔 PaymentIntent 做部分退款，按子订单分别记账。单段取消要不要开放给客人自助，列为业主决定 Q1（推荐 P1b 只开放整单自助，单段由客服在运营后台操作）。
8. **工作量约 24–30 人日**（第十二节），比设计篇 P1b 估的 16–20 多出前端下单页、客人行程订单页、运营后台行程订单页、跨段费用结算、整单取消的续做与复核；拆 10 个 PR。

---

## 一、背景与范围

### 1. 现状（M9T-10 之后）

| 方案 | 现在怎么下单 | 依据 |
| --- | --- | --- |
| 只有一段、没有跨段费用 | 「预订这个方案」→ `POST /site/v1/trips/{id}/plans/{planId}/order-quote` 生成普通官网报价 → `/book/new` 第 3 步 → 现有下单付款 | `apps/api/src/services/trips.ts` `orderQuoteForPlan`；`apps/web/src/lib/trip-book.ts` `tripBookableSegment` |
| 多段；或单段但带跨段费用 | 「提交预订，客服确认」= 带 `trip_id` + `plan_kind` 的人工报价申请，客服人工跟进 | ADR 0101 第十三节第 2、3 小节；`apps/web/src/pages/book/trip/TripQuoteResult.tsx` `PlanManualBooking` |

业主 11-18 决定 ②：单日、单段方案的段价改为和官网普通报价同一比价口径（取中标的那家），由编排修改落实（另一位开发）。本篇沿用这个口径：`daily_best` 的每一段 = 中标价；**单日行程**（只出 `one_car`）的段 = 中标价，即决定 ② 之后单日 `one_car` 的租户就是中标那家（编排修改为 M9T-12）；**多日** `one_car` 的每一段 = 该租户该车型组自己的报价（ADR 0101 第七节第 2 条）。

**哪些方案会有跨段费用**：`one_car` 可能有住宿、住宿抵扣、停驻、第二司机、附加项去重；`daily_best` 每天不是同一辆车，不收住宿、停驻、附加项去重，**只可能有当天的第二司机**（工时按单日检查，ADR 0101 第三节第 6 小节、第四节第 3 条）；`return`（长途返程）P1 编排不产生（ADR 0101 第四节第 4 条，接入随 P1d）。

### 2. 本篇范围

| 项 | P1b | 去向 / 理由 |
| --- | --- | --- |
| 多段方案、带跨段费用的单段方案直接下单、一次付款 | ✅ | 替代 A 的过渡做法 |
| 只有一段且没有跨段费用的方案 | ❌ 不变 | 继续走 M9T-10 桥接，已上线、零新增付款代码 |
| 行程订单的付款、超时、回调、争议、取消到账 | ✅ | 第四节 |
| 整单取消、按段退款、跨段费用退款 | ✅ | 第五节 |
| 供应商派单、结算、跨段费用归属 | ✅ | 第六节 |
| 客人行程订单页、确认邮件、凭订单号找回 | ✅ | 第七节 |
| 运营后台行程订单页、订单列表标识、异常队列 | ✅ | 第八节 |
| 嵌入（embed）版、`/sales/v1` 渠道接口的行程下单 | ❌ | 和 ADR 0101 第十三节第 1 小节一致，先只做官网；渠道接口另议 |
| 新干线方案（P1c）、跨城市一车到底（P1d） | ❌ | 它们的方案下单时复用本篇；`rail_reference` 段不下单 |
| 行程级「改期」（整体挪日期） | ❌ | 客人要改整趟行程 = 整单取消后重新报价；子订单的单段改单见第五节第 5 条 |

---

## 二、数据模型（迁移 0650，只新增）

行程订单跨供应商，是**平台表**（不带 `tenant_id`，供应商读不到，同 `order_sales`、`quotes`）；挂在子订单上的跨段费用要让这一家供应商看到结算价，是**租户表**（带 `tenant_id`、行级安全），对外价单独放平台表——照抄 `orders`（租户表）/ `order_sales`（平台表）的拆法，供应商永远看不到对外价（ADR 0026 第四轮决策）。

| 表 | 归属 | 主要列 | 说明 |
| --- | --- | --- | --- |
| `trip_orders` 行程订单 | 平台 | `id`（uuid）、`order_no`（`NT` + 日期 8 位 + 随机 8 位，字母表同 `orderNumber`，`packages/domain/src/orders.ts:174`；唯一）、`channel_id`、`api_client_id`、`idempotency_key`、`request_hash`（`unique (channel_id, idempotency_key)`）、`trip_id`、`plan_id`、`plan_kind`、`plan_snapshot`（下单时方案的结构快照，见下）、`currency`、`sell_minor`（客人付的总额）、`status`（`pending_payment / confirmed / cancelled`）、`cancel_requested_at` / `cancel_request`（整单取消的续做标记与参数，第五节第 6 小节）、`payment_due_at`、`is_acceptance`、`confirmed_at`、`cancelled_at`、`cancel_reason`、`created_at`、`updated_at`、`version` | `trip_id` / `plan_id` **不加外键**：行程单 30 天后由 M9T-05 清理，行程订单要随订单的保留期留着（同 `manual_quote_trip_links`，ADR 0101 第十三节第 2 小节）。「部分取消」「已完成」不另存状态，由子订单推出来（第七节） |
| `trip_order_items` 子订单归属 | 平台 | `order_id`（主键，外键 → `order_sales (order_id)`，同 `site_order_links`）、`trip_order_id`（外键）、`seq`、`day_index`、`segment_type`、`segment_sell_minor`（= 这张子订单 `order_sales.sell_minor`）、`fees_sell_minor`（挂在它上面的跨段费用对外价合计，可为负）、`allocated_minor`（= 前两项之和，客人为这张子订单付的钱，`> 0`） | **「这张单属不属于行程」的唯一判断依据**（第九节所有分支都查它）。`unique (trip_order_id, seq)`。**不存供应商**：救援换供应商时订单号不变、`order_sales` 移到新供应商（`services/rescues.ts:739` `moveSaleToTenant`），所以「现在是哪一家」一律以 `order_sales.supplier_tenant_id` 为准 |
| `trip_order_fees` 跨段费用（供应商侧） | **租户** | `tenant_id`、`id`、`order_id`（挂靠的子订单，`(tenant_id, order_id)` 外键 → `orders`）、`trip_order_id`、`fee_type`（`lodging / lodging_offset / idle / second_driver / bundle_discount`，同 `trip_fees`）、`night_index`、`day_index`、`label`、`settlement_minor`（可为负）、`settlement_currency`、`calc`（算式快照，抄自 `trip_fees.calc`）、`status`（`active / cancelled / transferred`）、`cancel_fee_bp`、`cancel_tenant_share_minor`、`transferred_to`（救援后转到的新行）、`created_at`、`updated_at` | 供应商在自己的子订单详情里看到「司机住宿 第 1 晚 ¥15,000」这类行（第六节）。行级安全、授权照抄 `order_extra_charges`（`0031_cancel_change_extra_charges.sql:139` 起），登记 `rls.itest.ts`、`schema-structure.itest.ts` |
| `trip_order_fee_sales` 跨段费用（对外价） | 平台 | `fee_id`（主键）、`tenant_id`（`(tenant_id, fee_id)` 外键）、`sell_minor`（可为负）、`markup_bp`、`fx` | 对外价按 ADR 0101 第四节第 6 条算好，下单时从方案快照抄 |
| `trip_payments` 行程付款 | 平台 | `id`、`trip_order_id`（唯一：一张行程订单只有一笔下单付款）、`provider`、`intent_id`（唯一）、`customer_id`、`payment_method_id`、`amount_minor`、`currency`、`status`（`creating / requires_payment / processing / succeeded / canceled`）、`last_error`、`refunded_minor`、`disputed`、`paid_after_cancel`、`save_consent_at`、`succeeded_at`、`created_at`、`updated_at` | 列和约束照抄 `order_payments`（`0024_orders.sql:148-185`，含 `intent_id` 与状态的约束）。只有下单这一笔；子订单的改期补差价、事后加收仍是 `order_payments` 的新行（见下） |
| `trip_refunds` 行程退款 | 平台 | 照抄 `order_refunds`（`0031…sql:263-301`、`0032_money_guards.sql`、`0090_order_center_tickets.sql:238-239` 的 `ticket_id` 与 `purpose`）：`id`、`trip_payment_id`、`order_id`（**必填**：每一笔都记在某张子订单名下）、`supplier_tenant_id`、`purpose`、`change_id`、`ticket_id`、`amount_minor`、`currency`、`provider_refund_id`（唯一）、`status`、`attempts`、`next_attempt_at`（租约也用它，同现有）、`last_error`、`retry_of`、`superseded_at`、`succeeded_at`、`failed_at`、`created_at`、`updated_at` | 现有 `order_refunds.payment_id` 必填且外键只认 `order_payments`（`0031…sql:268`），行程付款的退款只能另落一张表 |
| `trip_order_links` 客人访问凭据 | 平台 | 照抄 `site_order_links`（`0045_site_order_links.sql`）：`id`、`trip_order_id`、`token_hash`（唯一）、`issued_via`（`order / lookup`）、`created_at`、`expires_at` | 客人行程订单页凭它访问（第七节） |

**金额不变量**：`Σ trip_order_items.allocated_minor = trip_orders.sell_minor = trip_payments.amount_minor`，且等于方案的 `trip_plans.sell_minor`。下单事务提交前校验（不等即回滚、记错误日志），确认付款时再核对一次（对不上不确认、进异常队列），集成测试覆盖。

**`plan_snapshot`**：方案的天、段（段型、日期、开始时刻、车型组、对外价、对应子订单编号）、跨段费用（类型、晚次、对外价、挂靠子订单）、提示码。**不放坐标、地址、地名和任何联系信息**——这些只在子订单里，由现有乘客资料保留与脱敏管（`repos/passenger-retention.ts`）；快照因此不需要单独的清理任务。

**子订单的改期补差价、事后加收**：照旧在 `order_payments` 写 `kind = change / extra_charge` 的新行（各自一笔离线扣款、各自的 `intent_id`），唯一的区别是保存的支付方式从 `trip_payments` 取（第五节第 5 条）。这样 `order_payments` 的约束（`order_payments_order_key` 只限制 `kind = 'order'` 每单一行，`0031…sql:244`）不受影响，补收和加收的退款、异常、账单全部沿用现有代码。

**和设计篇第二节第 1 小节的差异**：

| 设计篇 | 本篇 | 原因 |
| --- | --- | --- |
| `trip_quotes`（行程报价编号） | 不建 | 客人在行程页看的是方案（`trip_plans`，有 `expires_at`）；下单时逐段写正式 `quotes`（第三节），行程订单记 `plan_id` 和快照就够了，多一层编号没有用处 |
| `trip_payment_allocations`（付款分摊） | 并进 `trip_order_items.allocated_minor`；已退金额从 `trip_refunds` 按子订单汇总 | 分摊在下单时就定了、之后不变；「已退」照现有 `refundedByPayment` 的做法从退款记录汇总（`repos/refunds.ts:95`），不在两处各存一份 |
| `trip_payments.kind`（`order / change / extra_charge`） | 只有下单一笔；补收、加收写 `order_payments` | 补收、加收本来就是对某一张子订单的；写进现有表，退款、异常、账单都不用改 |
| `trip_fees` 记在行程层、`trip_fee_settlements` 单独结算 | 每笔跨段费用挂到一张子订单（`trip_order_fees` + `trip_order_fee_sales`） | 子订单取消、救援换供应商、出账时费用跟着走，不需要行程级的结算与退款口径（第五节第 1 条、第六节） |
| `trip_segments.quote_id` / `order_id`（P1b 给 0600 的表加列） | 不加 | 段与子订单的对应关系在 `trip_order_items`（`seq`）和 `plan_snapshot` 里；行程单 30 天会被清理，不该让订单依赖它 |

授权：平台表只授权 `nozomi_platform`；`trip_order_fees` 授权 `nozomi_app`（只读，行级安全按 `tenant_id`）和 `nozomi_platform`（读写）。外键：`trip_order_items → trip_orders`、`trip_payments → trip_orders`、`trip_refunds → trip_payments`、`trip_order_links → trip_orders`、`trip_order_fee_sales → trip_order_fees` 都**不级联删除**（订单数据不随意删）。没有演示数据。

---

## 三、下单流程

### 1. 接口

- **`POST /site/v1/trips/{id}/plans/{planId}/orders`**（官网渠道，`Idempotency-Key` 必填，新限频键 `site_trip_order`：每 IP 每 10 分钟 10 次，窗口和次数同 `site_order`，`services/rate-limit.ts:22`）。请求体：
  - 一份乘客与联系信息（`passenger`、`sign_name`、`passenger_name`、`passenger_phone`、`messaging`、`notes`、`save_payment_method`），全部子订单共用，字段和 `POST /site/v1/orders` 一致（`apps/api/src/routes/site.ts:867`）；
  - `segments: [{ seq, flight_no, flight_kind, pickup_address, dropoff_address, waypoint_names }]`：每段自己的航班（接机 / 送机段）和地址文字，校验沿用 `orderDetailsIssues`（`services/orders.ts` 第 1 步）。
- 应答 201：行程订单视图（第七节）+ `payment`（`client_secret` 等，同单段的 `paymentJson`）+ `link`（`trip_order_links` 凭据）。同一个幂等键再来一次：同一张行程订单，`idempotent-replayed: true`。
- **`GET /site/v1/trip-order/payment`**（凭行程订单凭据）：还没建付款就建、建了就取，用于刷新页面后继续付款（同 `GET /site/v1/order/payment`）。

### 2. 步骤

0. **先查幂等键**：按 `(channel_id, idempotency_key)` 查 `trip_orders`：有 → 请求摘要相同就直接返回那张（重放，不再询价），不同 422 `IDEMPOTENCY_KEY_REUSED`。
1. **校验方案**：行程单存在、本渠道、未过 `readable_until`、验收会话一致（同 `orderQuoteForPlan`）；方案 `quoted` 且 `expires_at` 未到；方案不是「只有一段且没有跨段费用」（那种 409 `TRIP_PLAN_USE_SINGLE_BOOKING`，前端走 M9T-10 桥接）；`rail_reference` / `idle_day` 段不建子订单。
2. **逐段正式询价（事务外）**：对每一个要建子订单的段，用这一段的报价条件走一次正式询价，写 `quote_logs` 和 `quotes`（30 分钟有效）：
   - `daily_best` 段：同 `orderQuoteForPlan` 的做法（`siteQuotes`，取这一车型组的中标那张）——和业主决定 ② 同一口径；
   - `one_car` 段：同一次比价结果里**这个方案的租户 × 车型组**那一张（ADR 0101 第七节第 2 条的口径），新写 `tripSegmentQuote`，把那个候选写成一行 `quotes`（`winner_tenant_id` = 方案的租户）。**审查重点**：这时 `quotes.snapshot.winner` 的含义是「成交的那一家」而不一定是比价最低的那家；比价全量仍在 `quote_logs`，订单中心照常可看。
   - 调用量与时长：14 天行程最多约 30 段，远低于 ADR 0101 的段报价预算（120 次 / 编排）；超过 40 段 409 `TRIP_TOO_LARGE_FOR_ONLINE`，提示走客服确认。逐段询价**限并发 4**（同一请求内），观察目标：2–4 段 P95 ≤ 3 秒，30 段 P95 ≤ 10 秒；超出时前端显示「正在为每一天确认价格」进度，上线后按日志调。
3. **价格一致性校验**：
   - 每段正式报价的对外价 = 方案里这一段的对外价；
   - 跨段费用：方案报价时每笔费用的 `rule_version` 与现在 `trip_rule_configs.version` 一致（规则改过就当价格变了）；费用的对外价按第 2 步拿到的段报价的 `markup_bp`、`fx` 重算，等于方案里的值；
   - 合计 = `trip_plans.sell_minor`。
   - 任何一项对不上：409 `TRIP_PRICE_CHANGED`（带新旧总价，同 M9T-10），前端提示重新报价、客人看到新旧对比后再确认（设计篇第五节第 3 小节）。这次写下的 `quotes` 不下单，30 分钟后自然过期。
4. **一个平台事务里建单**：
   - **先插 `trip_orders`**（`pending_payment`）：`unique (channel_id, idempotency_key)` 占住这个键。两个同键请求并发时，后到的撞唯一约束 → 回滚，事务外按键读回先到的那张，摘要相同返回重放、不同 422（和 `placeOrder` 处理同键并发的思路一致，`services/orders.ts:226-243`）；先到的那张若最终回滚了，后到的读不到，按普通失败返回、客人重试。
   - 按 **(租户, 商品, 服务日期, 段序号) 排序**后逐段调抽出来的 `placeOrderInTx(db, principal, input, hash, acceptance, { payment: "none" })`（第九节第 1 条）：校验报价、商品与供应商状态、试运营每日上限、加急名额、库存预占、建 `orders` / `order_sales`、标记 `quote_logs.ordered`。排序是为了让两张行程订单争同一批锁（`trial-daily-limit`、加急名额、库存行）时加锁顺序一致，不互相死锁。
   - **统一加锁顺序（所有碰多张子订单的路径都守）**：先锁 `trip_orders` 行，再按 **(创建时的供应商, 商品, 服务日期, 订单编号)** 逐张锁子订单（`findOrderForPlatform(…, { lock: true })`）、库存行，最后锁付款记录。确认付款（`confirmOrderInTx` 里的 `sellHeldInventory`）、行程超时扫描、整单取消都按这个顺序遍历子订单，排序键从 `orders`（创建时那一行）取，和建单时 `holdInventory` 的顺序一致。单张订单的现有路径只锁一张单，与此不冲突。
   - 子订单的幂等键 = `trip:{trip_order_id}:{seq}`（`order_sales_idempotency_key` 按渠道唯一，`0024_orders.sql:139`；不会和客人自己的键撞），`payment_due_at` = 行程订单的付款期限。
   - 写 `trip_order_items`、`trip_order_fees` / `trip_order_fee_sales`（挂靠规则第五节第 1 条）、`trip_payments`（`creating`）、`trip_order_links`。
   - 校验金额不变量（第二节）。
   - 任何一段失败（报价过期、售罄、下架、供应商暂停、名额用完）→ **整个事务回滚**，409 带失败的段 `seq` 和原因码（沿用 `SOLD_OUT`、`QUOTE_NO_LONGER_AVAILABLE`、`QUOTE_EXPIRED`），前端提示「第 N 天的车已经订不到了，请重新报价」。不存在「部分子订单建好了」的状态。
5. **建付款（事务外）**：`ensureTripPayment` 在 Stripe 建一个 Customer 和**一笔** PaymentIntent：金额 = 总额，`setup_future_usage: "off_session"`、`allowed_payment_method_types: ["card"]`（同 `integrations/stripe.ts:230-250`），元数据 `trip_order_id`、`trip_order_no`，幂等键 `nozomi-trip-{trip_order_id}-payment`。`PaymentProvider` 加新方法 `createTripPayment`（只加不改，现有 `createOrderPayment` 不动），列为 B3。建付款失败：行程订单保持待付，客人可经 `GET /site/v1/trip-order/payment` 重试，直到付款期限（同 `ensurePayment` 的处理，`services/orders.ts:374-415`）。

### 3. 有效期与幂等

- **30 分钟两段时钟**：客人在方案页看的价到 `trip_plans.expires_at`（方案里最早到期的段报价）；提交下单时逐段写正式 `quotes`，新的 30 分钟从提交那一刻起算；付款期限 = 行程订单建好 + 30 分钟（`paymentDeadline`，`packages/domain/src/orders.ts:113`），和单段一致。
- 方案过期再提交：409 `TRIP_PLAN_EXPIRED`，前端「重新报价」（同 M9T-10）。
- 幂等：键在行程订单上；网络断了重发同一个键，拿到同一张行程订单和同一笔付款（Stripe 侧也用以行程订单编号为准的幂等键）。

---

## 四、付款与失败

| 情况 | 处理 |
| --- | --- |
| 付款成功（`payment_intent.succeeded`） | 回调先按 `intent_id` 查 `order_payments`，查不到再查 `trip_payments`（`services/payment-webhooks.ts:88-93` 加一个分支）。命中行程付款：一个事务里按第三节第 4 小节的统一顺序加锁（`trip_orders` → 子订单 → `trip_payments`）；核对金额币种与金额不变量（对不上不确认、记日志、进异常队列，同 `confirmPaidOrder` 的 `mismatch`）；然后对每张子订单调抽出来的 `confirmOrderInTx`（转已确认、库存预占转已售、订单事件、给供应商推 `order.confirmed`，第九节第 2 条），行程订单转 `confirmed`，排一封行程确认邮件（第七节） |
| 付款失败（卡被拒、3DS 没通过） | `payment_intent.payment_failed`：记 `last_error`，状态保持 `requires_payment`；客人在页面换卡重付，直到付款期限（同单段） |
| 3DS 验证 | 客人页面上由 Stripe.js `confirmPayment` 完成（ADR 0046），服务端不感知；验证中是 `requires_action`，按 `requires_payment` 对待 |
| 处理中（`processing`） | 等回调；超时扫描遇到 `processing` 本轮不取消（同 `order-jobs.ts:160`） |
| 超时 | 新的行程超时扫描（每分钟，和 `OrderJobs` 同一个调度器）：`trip_orders` 待付且 `payment_due_at` 已到 → 先在 Stripe 取消付款；取消时发现已经付了 → 走确认；否则一个事务里按统一顺序对每张子订单调现有 `cancelPendingOrder(…, "PAYMENT_TIMEOUT")`，行程订单转 `cancelled`。**现有超时扫描 `listOverduePendingOrders`（`repos/orders.ts:658`）加 `not exists trip_order_items` 跳过子订单**——不然它会因为子订单查不到 `order_payments` 而逐张取消（`services/order-jobs.ts:143-145`） |
| 付款被取消（`payment_intent.canceled`） | 同超时：整单取消 |
| 取消之后钱到了 | `trip_payments.paid_after_cancel = true`，进异常队列，一条列出全部子订单，财务全额退款（同单段口径） |
| 退款回写（`charge.refunded`） | 现在按付款记录记已退金额（`services/payment-webhooks.ts` 文件头第 13 行、`syncPaymentRefunded`）；行程付款同样回写 `trip_payments.refunded_minor`。**在 Stripe 后台直接退的款**（不是平台发起、找不到 `trip_refunds`）无法归到某张子订单：`charge.refunded` 的已退合计大于 `trip_refunds` 已成功合计时，进异常队列「行程付款有未归属的退款」，由财务在运营后台把差额登记到具体子订单（补一行 `trip_refunds`，`status = succeeded`，标注手工登记） |
| 争议（`charge.dispute.*`） | `trip_payments.disputed`，异常队列一条（`repos/exceptions.ts:59` 再扫 `trip_payments`），列出全部子订单 |
| 子订单单独「继续付款」 | `orderPaymentForChannel`（`services/orders.ts:463`）遇到子订单返回 409 `PAY_VIA_TRIP_ORDER`（带行程订单号），不进 `ensurePayment`——否则 `payment as OrderPayment`（`:376`）会因为查不到付款记录抛错 |

**不会出现「部分子订单建好了没付款」或「付了一半」**：建单是一个事务；付款是一笔；确认是一个事务。设计篇第五节第 4 小节列的备选（每段各一笔、第一笔在线其余离线扣）不采用：客人账单多笔扣款、日本发卡行普遍要求 3DS 导致离线扣款失败、不符合「一次付款」原意。

---

## 五、取消与退款

### 1. 跨段费用挂到哪张子订单

ADR 0101 第四节已经规定每笔费用的「所属那一天、那个商品」，挂靠照此：

| 费用 | 挂到 |
| --- | --- |
| 住宿第 N 晚（`lodging`）及其③抵扣（`lodging_offset`） | 第 N+1 天这辆车的子订单（规则本来就用第 N+1 天的商品，ADR 0101 第四节第 1 条；`calc.productId` 记着） |
| 第二司机（`second_driver`） | 费用记在哪一天，就挂那一天这辆车的子订单（工时超限当天，或休息不足的次日，ADR 0101 第四节第 3 条） |
| 多日停驻（`idle`） | 空闲日之后第一个用车日这辆车的子订单 |
| 附加项去重（`bundle_discount`，负数） | 它抵扣的那一段的子订单 |
| 长途返程（`return`） | P1 编排不产生（ADR 0101 第四节第 4 条）。P1d 接入时挂最后一个用车日这辆车的子订单，届时在本表补记 |

同一天这辆车有多段时挂当天第一段。

**住宿抵扣跨两天**：`lodging_offset` 抵的是第 N 天的③下车加价和第 N+1 天的③上车加价，却整笔挂在第 N+1 天。单独取消第 N 天时，第 N+1 天上的住宿和抵扣**不动**（车仍要在当地过夜后接第 N+1 天，或改为回基地——那是重算，P1b 不做）；客人因此多付或少付的部分由客服在工单里按赔付处理。这正是 Q1 推荐「单段取消只由客服操作」的理由之一。负数费用和它对应的正数费用挂同一张子订单。方案里出现本表没有挂靠规则的费用类型时，下单 409 `TRIP_PLAN_NOT_ORDERABLE`（转「提交预订，客服确认」），不猜。下单时校验每张子订单 `allocated_minor > 0`（负数抵扣不可能大于段价加正数费用；万一出现视为数据错，409 `TRIP_PRICE_CHANGED`）。

### 2. 待付款时

- 只能**整单取消**（客人在行程订单页，或运营后台）：先在 Stripe 取消付款，再逐张 `cancelPendingOrder`，同一事务（同超时）。
- **单段取消一律拒绝**：`services/cancellations.ts:211-216` 遇到待付款、查不到 `order_payments` 的单会直接取消那一张——子订单必须在这里拦下，返回 409 `TRIP_ORDER_PENDING`（「请取消整个行程订单或付款后再取消某一段」），否则行程那笔付款仍按全额收，会多收钱（设计篇已指出）。加集成测试：待付行程里取消一段被拒、付款金额不变。

### 3. 已付款时

- **整单取消**：逐张子订单走现有取消服务，各自按**自己的**取消阶梯（每张子订单下单时各自锁定 `cancel_policy`，服务日期不同，落在的档位自然不同，这就是「按段退款」）。
- **单段取消**：谁能发起是业主决定 **Q1**（推荐 P1b 客人自助只开放整单，单段由客服在运营后台操作——避免客人取消某一天后，别的天的住宿、停驻、一车到底前提变化而没人核对）。
- **供应商原因的取消、救援失败**：按子订单走现有流程（`FREE_CANCEL_REASONS` 全额退这张子订单）；挂靠的跨段费用是否也全额退列为业主决定 **Q9**（推荐全退，和段价一致）。
- **金额怎么算**（对一张子订单）：
  - 段：沿用 `cancellationAmounts({ sellMinor: segment_sell_minor, settlementMinor: orders.settlement_minor, feeBp })`，结果写回订单现有的 `cancel_fee_bp`、`cancel_tenant_share_minor`（含义不变：只是这一段）。
  - 挂靠的跨段费用：**按同一个 `feeBp`** 逐笔算客人扣款和供应商应得，写 `trip_order_fees.cancel_fee_bp`、`cancel_tenant_share_minor`、`status = cancelled`。口径是业主决定 **Q2**（推荐「随所挂子订单同档」）。
  - 退给客人 = 这张子订单还没退的钱（`allocated_minor` + 补收 − 已退）− 段扣款 − 费用扣款。
  - `quoteCancellation`（`services/cancellations.ts:87-100`）对子订单把 `paidMinor` 换成第 4 条的口径、把费用部分加进去；普通订单代码路径不变。
- **不重算其余段的跨段费用**：单段取消后，别的天的住宿、停驻按原样保留；需要减免时客服在工单里按现有「赔付」退（`services/tickets.ts`，退款落 `trip_refunds`，`purpose = compensation`）。

### 4. 退款怎么落、怎么发

- **可退的钱**：`refundableCharges`（`services/order-money.ts:29`）对子订单返回两类来源：
  - 「行程付款分到这张单的那部分」：可退 = `allocated_minor` − 这张单在 `trip_refunds` 里已退和正在退的；
  - 这张单自己的 `order_payments` 补收行（`kind = change`），同现在。
  
  `refundableCharges` 现在返回 `{ payment: OrderPayment; availableMinor }[]`，要改为带来源的联合类型（`{ source: "order_payment", payment } | { source: "trip_payment", tripPayment, orderId }`）——**类型变了，调用方要跟着改**（`scheduleRefund`、`netPaidMinor`、手动重试 `order-money.ts:141-145`、取消、工单），普通订单只会出现第一种来源，结果不变（第九节对照测试）。`allocateRefund` 的拆法（从最近收的那一笔开始退）不变，落表时按来源分别写 `trip_refunds` 或 `order_refunds`。
- **发退款**：新 `processTripRefund`，照抄 `processRefund` 的租约、重试（1 / 5 / 30 / 120 / 360 分钟，5 次后失败等财务）、作废逻辑（`services/order-money.ts` 文件头注释）；**手动重试**照抄 `order-money.ts:141-145` 的核对（`refundRetryRefusal`：已作废的不重试、重试后客人留下的不少于应留下的），其中「这笔付款还能退多少」换成这张子订单在行程付款上的可退额。Stripe 对**同一笔** PaymentIntent 做部分退款，幂等键 = 退款记录编号。`PaymentProvider.refundPayment` **接口不改**（`integrations/payments.ts:95-102`）：`intentId` 传行程付款的，`orderId` / `orderNo` 传子订单的，`refundId` 传 `trip_refunds.id`；所以 Stripe 元数据里是子订单号和退款记录编号（`integrations/stripe.ts:301`），**不带行程订单号**，按退款记录编号可查到行程订单。每张子订单的退款合计不超过它的 `allocated_minor`，所以全部子订单的退款合计不会超过这笔付款。
- **退款回调**：按 Stripe 退款编号先查 `order_refunds`（`findRefundByProviderId`，`repos/refunds.ts:85`），查不到再查 `trip_refunds`。
- 定时任务 `processDueRefunds` 旁边加 `processDueTripRefunds`。

### 5. 子订单的改单与事后加收

- **改单（改时间、改点）**：子订单客人自助改单是否开放是业主决定 **Q5**（推荐 P1b 关闭客人自助，走客服在运营后台用现有改单——改时间可能让工时、住宿前提变化，要人核对）。改单补差价：现有 `order-changes.ts` 用保存的支付方式离线扣（`:520` `savedPaymentMethod(findOrderPayment(...))`），对子订单改为取 `trip_payments` 的 `customer_id` / `payment_method_id`；补收写 `order_payments` 的 `change` 行（现有表、新行）。退差价走第 4 条。
- **事后加收**（超时、超公里、停车费等）：供应商照旧对自己的子订单报，`extra-charges.ts:227` 同样改为对子订单取 `trip_payments` 的支付方式；扣款记 `order_payments` 的 `extra_charge` 行。

---

### 6. 整单取消怎么保证做完

现有取消服务一次只取消一张单，每张自己开事务、在事务外调 Stripe（`services/cancellations.ts:205` 起 `cancelOrder`），整单取消不可能放进一个事务。做法：

1. **预检（一个只读事务）**：按统一顺序算每张子订单的取消预览（`quoteCancellation` + 第 3 条的费用部分）；任何一张状态不能取消（已出发、已完成等）→ 整单取消拒绝，409 `TRIP_ORDER_NOT_CANCELLABLE`，列出是哪一段、什么状态，引导客人联系客服做单段处理。客人自助（`GUEST_REQUEST`、不免取消费）时退款 = 按阶梯算的退款，不会触发复核。
2. **需要复核时整单一起复核**：运营代取消且免收取消费、选免费原因，使任何一张子订单 `cancellationNeedsReview` 为真（`packages/domain/src/cancellation.ts:229`，阈值 0）→ 不取消任何一张，建**一条**整单取消的复核申请（新的复核种类 `trip_order.cancel`，列出每段金额）；批准后再执行第 3 步，子订单的取消带着这条批准，不再逐张触发复核。
3. **记下要做、逐张执行、可续做**：在 `trip_orders` 写 `cancel_requested_at` 和参数（原因、是否免费、复核编号），提交；然后按统一顺序逐张调现有取消服务。每张都是幂等的（已取消返回 `replayed`，`cancellations.ts:210`）。中途进程退出或某张失败（例如 Stripe 暂时不可用），由行程定时任务找 `cancel_requested_at` 不为空、仍有子订单未取消的行程订单，按同样参数续做，直到全部取消后行程订单转 `cancelled`。
4. **显示**：续做期间客人和运营看到「取消处理中」，每段显示已取消 / 处理中 / 待复核；全部完成后发一封取消确认邮件（挂第一张子订单，同第七节）。

## 六、供应商侧

- **派单**：每张子订单独立派单、指派司机、出发 / 到达、客人未出现、完成，完全走现有流程；`order.confirmed` 推送仍按子订单（第四节）。
- **一车到底的提示**：`one_car` 方案的子订单全是同一家供应商。供应商订单详情加一块只读信息「同一行程（`NT…`）的其他子订单：`NZ…` 第 2 天、`NZ…` 第 3 天；客人选的是同一辆车跑完全程」——**只列这一家自己的子订单**，不透露别家。P1b 不在派单时强制同车同司机（现有派单没有这种约束），由提示 + 运营巡检保证；要强制另开任务。
- **跨段费用**：供应商在子订单详情看到挂在上面的 `trip_order_fees`（类型、晚次、结算价、算式说明），租户接口只读，只有结算价。
- **结算**：子订单本身照现有账单（`repos/billing.ts:159` `listBillableItems` 按 `orders.settlement_minor` / `cancel_tenant_share_minor` 出 `order` / `cancellation` 行）。跨段费用作为新的出账来源：`active` 且所挂子订单已到终态 → 出 `settlement_minor`；`cancelled` → 出 `cancel_tenant_share_minor`（为 0 不出）；来源键 `trip_fee:{id}`，`listBillableItems` 与 `listTenantsWithBillableItems`（`:259`）都加这一来源。现有表有两条约束挡住它：`statement_lines_kind_check`（`0070_billing.sql:146`）不认新种类；`statement_lines_sign`（`:147-150`）要求 `order` 等种类金额 `> 0`——而 `lodging_offset`、`bundle_discount` 是负数，所以「套用现有种类 `order`」也行不通。列为 **B2**：放宽两条约束，加种类 `trip_fee`、其金额 `<> 0`（正负都可）。这是对「只新增、不改现有表」的例外，必须监工放行。**未放行时**：负数费用不单独出账，而是和挂在同一张子订单上的正数费用先轧差，按子订单出一行 `order` 种类、来源键 `trip_fees:{order_id}`、金额为正的净额（`detail` 列出明细）；轧差后不为正（只剩负数抵扣）时不出账、在供应商的子订单详情里说明——这种退路账单可读性差，不推荐。
- **救援换供应商**：子订单转救援供应商时（ADR 0031：订单号不变，救援供应商名下另起一行 `orders`，`order_sales` 移过去），挂靠的跨段费用跟着转：原行 `status = transferred`、`transferred_to` 指向救援供应商名下的新行（同类型、**结算价照抄原金额**；客人那边不变）。原供应商没有履约，原行不出账。救援供应商对这笔费用的要价若高于原金额，差额并入这张子订单的救援差价（`rescueDifference`，`packages/domain/src/rescue.ts:226`，由原供应商承担），运营在救援派单时录入；是否这样做列为业主决定 **Q8**。

---

## 七、通知与客人行程订单页

- **客人确认邮件**：行程付款成功后发**一封**「行程订单已确认」（新事件 `trip_order.confirmed`，列出每天每段、总额、行程订单页链接）。`notification_events` 要求非平台事件带 `tenant_id` 和订单（`0140_notification_center.sql` 的 `staff_scope` 约束与订单外键），这封挂在**第一张子订单**上，不改表。子订单各自的客人 `order.confirmed` 邮件对行程子订单不发（`notification-jobs.ts` 展开收件人时按 `trip_order_items` 跳过客人这一路，供应商这一路照发）。派车、行前提醒、司机信息等后续客人通知按子订单照常发，模板里加一行「所属行程 NT…」。是否这样做是业主决定 **Q7**。
- **客人行程订单页** `/book/trip-order`（凭 `trip_order_links` 凭据，`GET /site/v1/trip-order`）：行程订单号、状态（由子订单推：全部已确认 = 已确认；部分取消 = 部分取消；全部完成 = 已完成）、付款状态与金额、每天每段一张卡片（日期、段型、时间、点、这一段含挂靠费用的金额、子订单状态、「查看这一段」链接到现有子订单页）、跨段费用明细、退款记录。待付款时显示付款表单（同 `/book/new` 的 Stripe Elements）；整单取消按钮（先预览每段的取消费，`GET /site/v1/trip-order/cancel-fee`）。
- **子订单页**：现有官网订单页（`GET /site/v1/order`）。下单时给每张子订单也发一条 `site_order_links`（现有表、新行），客人从行程页点进去；子订单页显示「所属行程 NT…」，付款、取消按钮按第四、五节改成跳回行程页。
- **凭订单号找回**：`POST /site/v1/trip-orders/lookup`（行程订单号 + 邮箱，后台发信，应答一律 202，同 `/site/v1/orders/lookup`，`routes/site.ts:900`）；用子订单号找回照旧发子订单链接。
- 文案先只有中文（业主 2026-11-15：翻译放到 M11），对客文案列表随页面 PR 写进本篇补记。

## 八、运营后台

- **平台订单列表**：子订单在付款列显示「随行程 NT… 付款」和行程付款状态（`repos/orders.ts:770` 批量读 `order_payments` 的地方对子订单改读 `trip_payments`），并带「行程」标记，可按行程订单号搜。
- **行程订单详情页**（新）：子订单列表（各自供应商、状态、金额、链接到现有订单详情）、行程付款（Stripe 编号、状态、争议、取消后到账）、退款记录（`trip_refunds`，失败的可手动重试，权限同现有 `payment.manage`）、跨段费用（挂靠、状态、结算）、操作：整单取消、单段取消（按 Q1）。
- **订单详情**（`services/order-queries.ts:324`）：子订单显示「随行程订单 NT… 付款」和分到的金额、挂靠的跨段费用。
- **异常队列**：行程付款的争议、取消后到账各一条，列出全部子订单（第四节）。
- **人工报价**：A 过渡期提交的「提交预订，客服确认」申请照常由客服跟进；P1b 上线后新申请会减少，不做迁移。

---

## 九、对现有单段流程的影响

**原则**：普通订单（`trip_order_items` 里没有）走的每一条代码路径**行为**与现在一致（第 8 条的类型改动除外，结果不变）；所有新分支都以「这张单属于行程」为条件。由三件事守住：① 现有订单、付款、取消、退款、异常、保留、账单的单元和集成测试**一条不改**全部通过；② 新增对照测试：一批普通订单经改造后的 `refundableCharges`、`netPaidMinor`、订单视图、平台列表付款列，结果与改造前快照一致；③ 包车、询价、itinerary golden 0 条变化。

要改的现有代码（**B1，待监工放行**；设计篇第五节第 4 小节已列，这里按 main `6c960cbb` 重新核对行号，第二稿按审查补了 5a、13a 和第 8 条的类型改动）：

| # | 位置 | 改法 | 普通订单 |
| --- | --- | --- | --- |
| 1 | `services/orders.ts:223` `placeOrder` | 事务内部分抽成 `placeOrderInTx(…, { payment: "own" \| "none" })`；`placeOrder` = `withPlatformTx` + `placeOrderInTx(…, "own")`（含 `:365` `insertOrderPayment`） | 不变（纯抽函数） |
| 2 | `services/orders.ts:543` `confirmPaidOrder` | 「确认订单」部分抽成 `confirmOrderInTx`（状态、库存、事件、推送、通知）；付款记录部分各走各的 | 不变（纯抽函数） |
| 3 | `services/orders.ts:463` `orderPaymentForChannel` | 子订单 409 `PAY_VIA_TRIP_ORDER` | 不变 |
| 4 | `services/orders.ts:475` `getSalesOrderView`（`:482` 读付款） | 子订单付款字段由行程付款给，加 `trip_order` | 不变 |
| 5 | `services/payment-webhooks.ts:88-93` | 查不到 `order_payments` 再查 `trip_payments`；退款回调同理 | 不变（先查的仍是原表） |
| 6 | `repos/orders.ts:658` `listOverduePendingOrders` | 加 `not exists trip_order_items` | 不变（普通订单没有那一行） |
| 7 | `services/cancellations.ts:87-100` `quoteCancellation`、`:211-216` 待付取消、`:251` | 子订单：待付拒绝单段；已付按第五节第 3 条加费用部分 | 不变 |
| 8 | `services/order-money.ts:29-37` `refundableCharges` / `netPaidMinor`、`:41` `scheduleRefund`、`:141-145` 手动重试核对 | 返回类型改为带来源的联合类型（调用方跟着改）；来源加「行程付款分摊」，落 `trip_refunds` | 行为不变（只有第一种来源）；**类型和调用方代码有改动** |
| 9 | `services/tickets.ts:566` | 经第 8 条，自动适配 | 不变 |
| 10 | `services/order-changes.ts:520`、`services/extra-charges.ts:227` | 子订单的保存支付方式取 `trip_payments` | 不变 |
| 11 | `services/order-queries.ts:324`、`repos/orders.ts:770` | 子订单显示随行程付款 | 不变 |
| 12 | `repos/exceptions.ts:59`、`:62` | 再扫 `trip_payments` | 不变（多出的是新来源） |
| 13 | `repos/passenger-retention.ts:41`、`:48`、`:50-51` | 子订单所属行程付款未结、有争议、退款未完成时不脱敏 | 不变 |
| 13a | `repos/passenger-retention.ts:226`（脱敏时改写 `order_payments.last_error`） | 行程订单的**全部**子订单都脱敏后，同样改写 `trip_payments.last_error` 和 `trip_refunds.last_error`（Stripe 的错误信息可能带持卡人信息） | 不变 |
| 5a | `services/payment-webhooks.ts`（`charge.refunded`） | 行程付款回写 `trip_payments.refunded_minor`；未归属退款进异常队列（第四节） | 不变 |
| 14 | `services/notification-jobs.ts`（收件人展开） | 行程子订单不发客人 `order.confirmed` | 不变 |
| 15 | `repos/billing.ts` 出账来源 | 加跨段费用来源（B2） | 不变（多出的是新来源） |

**为什么不用设计篇的统一读口径 `orderPaymentView`**：设计篇第五节第 4 小节第 6 条建议所有读付款的地方改调一个 `orderPaymentView(db, orderId)`。核对现状后，这些位置里有 6 处是 SQL 里的 `exists` / 批量查询（超时扫描、平台列表、异常队列、乘客资料保留的三个条件），没法换成逐单调用的函数；把服务层的几处换成统一函数、SQL 处另加条件，等于两套口径。所以本篇改为**逐处加分支**，服务层共用一个小函数 `tripChildPayment(db, orderId)`（返回行程付款、分到的金额、已退），SQL 处加 `exists trip_order_items` / `union` 条件；每一处都在上表列明、各有测试。

**开关**：`TRIP_ORDER_ENABLED`（渠道设置或环境变量，默认关）。关着时 `POST …/orders` 返回 404，页面继续显示 A 的「提交预订，客服确认」。打开前已建的行程订单不受开关影响（付款、取消、退款照常处理）。

---

## 十、迁移与回滚

- **迁移 0650**：`create table` / `create index` / 授权 / 行级安全，不给任何现有表加列。**例外（B2，须监工放行）**：放宽 `statement_lines` 的 `statement_lines_kind_check` 和 `statement_lines_sign` 两条约束（加 `trip_fee` 种类，其金额 `<> 0`）；只放宽、不收紧，老数据全部满足。B2 未放行时迁移里没有这一段，出账用第六节的退路。
- **回滚**：
  1. 关开关 → 新的行程订单停了，页面回到 A；已有的行程订单照常处理到终态。
  2. 代码回退：因为现有表没变，回退到 P1b 之前的版本不会读坏任何数据；但**有未到终态的行程订单时不能回退**（回退后的代码会把子订单当成普通订单，超时扫描会逐张取消、退款找不到来源）。所以回退前先确认 `trip_orders` 里没有 `pending_payment` / `confirmed` 且子订单未完结的，运维手册写清这一步。
  3. 表不删：新表里是订单与付款记录，按订单的保留期留着。
- **B2 回退**：放宽的约束不收回（收回会让已出的 `trip_fee` 行违反约束）；代码回退后不会再出新的 `trip_fee` 行，已出的照常结清。

---

## 十一、测试计划与验收

**单元测试**（domain）：费用挂靠规则（四类、同天多段、负数同挂、`allocated_minor > 0`）；按段取消的金额拆分（段 + 费用同档、免费原因、救援中）；行程订单状态推导；订单号格式。

**集成测试**（api，`*.itest.ts`）：

1. 下单：两段 `daily_best`、三天 `one_car` 带住宿和第二司机；子订单、`order_sales`、`quotes`、费用、付款行齐全；不同供应商的子订单租户隔离（供应商 A 读不到 B 的子订单和费用）。
2. 价格变了（改段价、改规则版本）→ 409 且没有建任何单；方案过期 409；单段无费用方案 409 `TRIP_PLAN_USE_SINGLE_BOOKING`。
3. 第二段售罄 / 下架 / 供应商暂停 → 整单回滚（库存、加急名额、`quote_logs.ordered` 都恢复）。
4. 幂等：同键重放、同键不同内容 422、两个请求同时用同一个键只建一张；两张行程订单并发争同一库存不死锁（按排序加锁）。
4a. 金额不变量：构造分摊合计 ≠ 总额（含负数抵扣），建单回滚；确认付款时核对不过不确认。
4b. 加锁顺序：建单、确认、超时、整单取消并发跑在同一批子订单上，不死锁（断言都能完成）。
5. 回调：成功 → 全部子订单确认、一封客人行程确认邮件、每家供应商各自收到 `order.confirmed`；先失败后成功；金额不符不确认；取消后到账进异常队列；争议进异常队列。
6. 超时：行程超时扫描整单取消；现有超时扫描不碰子订单（构造子订单过期，断言 `OrderJobs` 不取消它）。
7. 取消：待付单段取消被拒且付款金额不变；整单取消（待付 / 已付）；已付整单取消每段按各自阶梯、费用同档；有一段不能取消时整单拒绝；运营免费取消时只建一条整单复核、批准后全部取消；中途失败后定时任务续做完成；部分退款合计不超过付款；退款失败重试、手动重试（含 `refundRetryRefusal` 核对）；退款回调按两表查找；`charge.refunded` 回写、Stripe 后台直接退款进异常队列。
8. 子订单继续付款 409；改单补差价、事后加收用行程付款的支付方式，记 `order_payments` 新行。
9. 乘客资料保留：行程付款有争议 / 退款未完成时子订单不脱敏；全部子订单脱敏后行程付款、退款的 `last_error` 被改写。
9a. 救援：子订单转救援供应商后，费用行转移、原行不出账，`order_sales.supplier_tenant_id` 为新供应商，行程订单页显示正常。
10. 对照：普通订单的下单、付款、超时、取消、退款、视图与改造前一致（第九节）。

**测试站验收**（QA 测试供应商、验收渠道 `is_acceptance`，ADR 0078；**只用 Stripe 测试模式，不做真实付款**）：

- 测试卡 `4242 4242 4242 4242`：两天行程（接机 + 包车、包车 + 送机）下单付款成功，客人一封确认邮件，两张子订单在供应商后台各自可见、可派单；
- 3DS 卡 `4000 0027 6000 3184`：验证通过后确认；验证失败停在待付，换 4242 重付成功；
- 拒付卡 `4000 0000 0000 0002`：提示失败、可重付；等 30 分钟超时后整单取消、库存释放；
- 已付后整单取消：Stripe 测试后台看到按段的部分退款，金额与取消预览一致；
- 争议卡 `4000 0000 0000 0259`：付款成功后自动产生争议，异常队列出现一条、列出全部子订单；
- 运营后台行程订单页、订单列表标识。

CI 全绿；独立审查；合并、部署后测试站验收通过才在官网把多段方案的按钮从 A 切到直接下单（开关）。

---

## 十二、拆分与工作量

每个任务一个 PR（分支 `m9t-*`，标题以 `[M9T]` 开头），各自独立审查、CI 全绿后合并。编号在本篇确认后登记 roadmap（M9T-12 已给单日 `one_car` 取中标价，实施任务暂记 M9T-13 起）。

| # | 内容 | 依赖 | 人日 |
| --- | --- | --- | --- |
| 1 | 本 ADR、roadmap（M9T-11） | — | 1 |
| 2 | 迁移 0650、repos、迁移 / 结构 / 行级安全测试 | 1 | 2 |
| 3 | 抽 `placeOrderInTx` / `confirmOrderInTx`（纯重构）+ 三处拦截（超时扫描跳过、待付单段取消拒绝、子订单继续付款 409）+ 对照测试 | 2 | 2.5–3 |
| 4 | `tripSegmentQuote`、`placeTripOrder`、`POST …/orders`、幂等先查与并发读回、价格一致性、金额不变量、加锁顺序、限并发询价、OpenAPI | 3 | 3.5–4.5 |
| 5 | `createTripPayment`、`ensureTripPayment`、回调分支、行程超时扫描、`GET /site/v1/trip-order/payment` | 4 | 2–3 |
| 6 | 取消与退款：可退来源（联合类型）、`trip_refunds` 发送与重试、手动重试核对、整单取消（预检、整单复核、续做）、单段取消、费用同档、`charge.refunded` 回写与未归属退款、改单补差价与事后加收的支付方式、工单赔付 | 5 | 4.5–5.5 |
| 7 | 跨段费用出账来源（B2 或退路）、供应商子订单详情的费用与同行程提示、救援时费用转移与差价 | 6 | 2–2.5 |
| 8 | 通知（行程确认 / 取消邮件、跳过子订单客人确认）、乘客资料保留（含 `last_error` 改写）、异常队列、平台列表与订单详情、行程订单详情接口 | 5 | 2.5–3 |
| 9 | 前端：`/book/trip` 多段方案下单（乘客信息 + 每段航班 / 地址 + 付款）、`/book/trip-order` 行程订单页（含取消处理中）、找回、运营后台行程订单页 | 5、8 | 4–5 |
| 10 | 测试站 Stripe 测试卡验收（第十一节）、打开开关 | 全部 | 1 |
| **合计** | | | **约 24–30 人日** |

设计篇估 P1b 16–20 人日，主要是后端（对应本表 2–8 约 19.5–23.5，多出的是审查补出的整单取消续做与复核、未归属退款、救援费用转移）；本表另有前端与运营后台页面（第 9 项）和验收。

---

## 十三、待确认项

### 待监工确认（阻塞实施）

| # | 问题 | 推荐 | 未放行时 |
| --- | --- | --- | --- |
| B1 | 第九节 17 处现有代码改动（抽函数 + 按「属于行程」分支），普通订单行为不变 | 放行；这是「一次付款」不可避免的，设计篇已预告 | 无可行替代：子订单没有自己的付款记录，不改这些地方就会被逐张超时取消或多收钱 |
| B2 | 放宽 `statement_lines_kind_check` 和 `statement_lines_sign`：加种类 `trip_fee`、金额 `<> 0`（不加列，但**改现有表约束，是「只新增」的例外**） | 放行，账单上能看出是跨段费用，负数抵扣能如实出账 | 按子订单把正负费用轧差、净额为正时出一行 `order` 种类（第六节退路），不推荐 |
| B3 | `PaymentProvider` 加 `createTripPayment`（只加方法，`createOrderPayment` 不动） | 放行 | 复用 `createOrderPayment`，元数据里 `order_id` 写行程订单编号（Stripe 后台看起来会混淆，不推荐） |

### 待业主决定

| # | 问题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| Q1 | 已付款后单段取消谁能发起 | A 客人自助只能整单取消，单段由客服在运营后台操作；B 客人自助单段取消，挂靠费用随段同档退，不重算别的天；C 客人自助单段并自动重算其余跨段费用 | **A**：P1b 先保守，单段取消会影响别的天的住宿、停驻、一车到底前提，要人核对（例如住宿抵扣跨第 N、N+1 两天却挂在第 N+1 天，单独取消第 N 天时只能人工调整，第五节第 1 小节）；C 工作量大且规则复杂，不做 |
| Q2 | 取消时跨段费用怎么退 | A 随所挂子订单同一档（同比例扣）；B 行程开始后跨段费用一律不退；C 一律全退 | **A**：和段价同一套阶梯，客人好理解，供应商按同比例得到取消费 |
| Q3 | 多段方案价格变了（下单时总价与方案不一致） | A 一律让客人看新旧对比后再确认；B 差额在 X% 以内自动按新价下单 | **A**：同设计篇第五节第 3 小节、同 M9T-10 单段的 409 做法 |
| Q4 | 付款期限 | A 30 分钟，和单段一样；B 行程延长到 45 分钟 | **A**：库存预占时间不宜更长；正式报价在提交时才写，30 分钟从提交起算已经够付款 |
| Q5 | 子订单客人自助改单（改时间、改点） | A P1b 关闭，走客服；B 只开放改时间（同一天内） | **A**：改时间可能触发工时、住宿规则变化，P1b 不做自动重算 |
| Q6 | P1b 上线后 A 的过渡做法 | A 多段方案和带跨段费用的单段方案全部改为直接下单，「提交预订，客服确认」只留给报不出价的情况；B 两个按钮并存一段时间 | **A**：避免客人在两条路之间犹豫；已提交的人工申请照常跟进 |
| Q7 | 客人确认邮件 | A 一封行程确认 + 之后每段的派车、行前通知照常；B 每段各发一封确认 | **A**：「一次付款」对应「一次确认」 |
| Q8 | 救援换供应商时跨段费用怎么结 | A 救援供应商照原金额拿这笔费用，要价更高的差额并入救援差价由原供应商承担；B 救援供应商按自己的规则重算，差额平台承担 | **A**：和段价的救援差价口径一致，客人那边不变 |
| Q9 | 供应商原因取消（或救援失败）时，挂在那张子订单上的跨段费用 | A 随段全额退给客人；B 按客人取消的阶梯退 | **A**：不是客人的原因，客人不该承担 |

---

## 十四、风险

1. **改的是收钱的代码**：第九节 17 处。对策：抽函数和加分支分 PR（第 3 项是纯重构，单独审）；对照测试；开关默认关；测试站完整走一遍 Stripe 测试卡再开。
2. **一车到底不强制同车**：现有派单没有跨订单约束，供应商可能派了不同的车。对策：供应商侧提示（第六节）、运营巡检；投诉走现有工单。要强制另开任务。
3. **正式询价时价格漂移**：方案报价到下单之间供应商改价、汇率刷新，客人会更常遇到 409。对策：前端把「价格有变化」做成新旧对比一键确认；上线后看 409 比例。
4. **大行程的锁与时长**：14 天约 30 段在一个事务里逐段校验和预占。对策：按 (租户, 商品, 日期) 排序加锁；正式询价放在事务外；事务里只做数据库操作。上线后看下单 P95（现有要求 ≤ 800 ms 针对单段，行程下单另定观察值）。
5. **设计篇（ADR 0094）仍在审**：本篇只取第五节第 4 小节的结论并按现状细化；设计篇有改动时本篇跟着改。

---

## 修改记录

### 第二稿（2026-11-19，对应独立审查第一轮）

| 审查 | 处理 |
| --- | --- |
| 1 幂等先查 | 第三节第 2 小节第 0 步先查键；事务里先插 `trip_orders`，撞唯一约束读回返回重放 |
| 2 加锁顺序 | 第三节第 4 小节定统一顺序（`trip_orders` → 子订单按供应商 / 商品 / 日期 / 订单 → 付款），确认、超时、整单取消同序 |
| 3 B2 不完整 | 负数费用违反 `statement_lines_sign`，B2 改为放宽两条约束并写明是「只新增」的例外；退路改为按子订单轧差；第十节措辞同步 |
| 4 整单取消原子性 | 新增第五节第 6 小节：预检、整单一条复核、`cancel_requested_at` 续做、显示 |
| 5 住宿抵扣跨两天 | 第五节第 1 小节写明单取第 N 天时不动第 N+1 天的费用，作为 Q1 推荐理由 |
| 6 改动清单遗漏 | 说明不用 `orderPaymentView` 的理由；`refundableCharges` 类型改动如实列出；补 `order-money.ts:141-145`、`passenger-retention.ts:226`、`charge.refunded` 回写、Stripe 后台退款进异常队列；退款元数据与「接口不改」的矛盾改为如实写（元数据是子订单号和退款记录编号） |
| 7 救援 | `trip_order_items` 去掉供应商列，外键改指 `order_sales`，以 `order_sales.supplier_tenant_id` 为准；费用转移照抄原金额、差额并入救援差价（Q8） |
| 8 `return` | 挂靠表补一行：P1 不产生，P1d 挂最后用车日；未知类型 409 |
| 9 金额不变量 | 第二节写明，建单与确认时各校验一次，加测试 |
| 建议 | 询价限并发 4 与 P95 观察目标；限频改为同 `site_order` 的 10 分钟 10 次；争议用测试卡 `4000 0000 0000 0259`；第一节注明决定 ② 后单日 `one_car` 即中标那家；写明 `daily_best` 只可能有当天第二司机；工作量改 24–30 人日；加业主问题 Q8（救援时费用结算）、Q9（供应商原因取消时费用退款） |

### 第一稿（2026-11-19，M9T-11）

按业主 2026-11-18 决定 ①（经监工在 #288 转达）起草。相对设计篇第五节第 4 小节的变化：数据少 3 张表（`trip_quotes`、`trip_payment_allocations`、`trip_fee_settlements`），跨段费用挂到子订单、按子订单结算和退款；子订单的补收、加收仍写 `order_payments`；行号按 main `6c960cbb` 重新核对；新增开关、回滚前置条件、测试站 Stripe 测试卡验收清单、B1–B3 与 Q1–Q7。
