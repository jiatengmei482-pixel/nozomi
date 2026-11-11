# 数据库迁移

数据库结构只通过这里的迁移文件改变（规则见 `docs/adr/0006-migrations.md`）。

- 文件名：`NNNN_snake_case.sql`，4 位编号从 `0001` 开始递增，例如 `0001_tenants.sql`。
- 只写结构（表、索引、约束、策略），**不写任何预置业务数据**。唯一的例外是系统定义的常量清单（如角色清单），必须在迁移里注明它来自需求文档的哪一节。
- 文件名的扩展名必须是小写的 `.sql`；写成 `.SQL` 会报错（不会被悄悄跳过）。
- 每个文件在一个事务里执行，失败整体回滚。文件里不能写 `begin` / `commit` / `rollback` 等事务控制语句，执行器会在执行前检查并报 `MIGRATION_TRANSACTION_CONTROL`。需要局部回滚用 `savepoint`。
- 可以用 `set local`（如 `set local search_path`），它只在本迁移的事务内生效，不影响迁移记录的写入。
- 已经执行过的迁移文件不能修改、删除或改编号（执行器会比对校验和并报错）；要改结构就新增一个迁移。
- 新迁移的编号必须大于已执行的最大编号。
- 租户表必须带 `tenant_id` 并作为复合索引第一列（ADR 0003），并且开启行级安全、建策略、按最小权限授权给应用角色 `nozomi_app`——具体步骤见 ADR 0009「以后新增租户表时要做的事」。漏了的话 `rls.itest.ts` 会失败。
- **新表默认谁都读不了，要在同一个迁移里写明给哪个角色什么权限**（ADR 0010「以后新增表时要做的事」）。服务进程用的应用账号自己没有任何表权限，只能切换到三个权限角色：
  - `nozomi_app`（租户事务）：租户表。策略写明 `to nozomi_app`。
  - `nozomi_platform`（平台事务）：平台表；平台也要访问的租户表另加一条写明 `to nozomi_platform` 的策略。只给用得到的权限，一般不给 `delete` / `truncate`。
  - 全平台共用、租户也要看的平台表（主数据）：另外只给 `nozomi_app` `select`（ADR 0012）。
  - `nozomi_preauth`（登录前事务）：原则上不给任何新表的权限。
  - 不要 `grant … to public`，不要把权限直接给应用账号（迁移里不出现它的名字，更不出现密码）。
  - 然后把新表登记到 `apps/api/src/schema-structure.itest.ts` 的 `ROLE_GRANTS`（以及 `PLATFORM_TABLES` / `CROSS_TENANT_POLICIES`）。不登记、或登记的和库里的不一致，测试会失败。
- 迁移用迁移账号（`DATABASE_MIGRATION_URL`，表的所有者）执行，不用服务进程的应用账号。
- 审计日志表 `audit_logs` 只能追加：有触发器拦截修改、删除和清空，迁移里也不要去改它已有的行。

执行：`pnpm db:migrate`（可以反复运行，已执行的会跳过）。应用账号由 `pnpm db:provision` 创建（同样可以反复运行），和迁移谁先谁后都可以。

## 现有迁移

| 文件 | 内容 |
| --- | --- |
| `0001_platform_accounts.sql` | 平台角色清单、平台员工账号、平台会话、登录限速计数 |
| `0002_tenants.sql` | 应用角色 `nozomi_app`、租户角色清单、租户、租户用户、租户会话，以及它们的行级安全策略 |
| `0003_audit_logs.sql` | 审计日志（只能追加）及其行级安全策略 |
| `0004_password_reset.sql` | 平台员工和租户用户的密码重置令牌（只存哈希和有效期） |
| `0005_database_roles.sql` | 平台角色 `nozomi_platform`、登录前角色 `nozomi_preauth` 及其授权和策略；登录前定位租户用户的两个函数（不改表结构） |
| `0006_must_change_password.sql` | 平台员工和租户用户的「必须先修改密码」标记（非空，默认 false）；只加列，授权不变 |
| `0007_master_data.sql` | 平台主数据：城市、地点（机场 / 车站 / 地标 / 航站楼 / 出口）、车型组、附加服务。平台可读写、租户只读、谁都不能删（ADR 0012）。不含任何数据 |
| `0008_master_data_list_indexes.sql` | 地点表的列表 / 统计索引（类型 × 状态、国家）。只加索引 |
| `0009_master_data_code_order.sql` | 四张主数据表按编码排序用的索引（逐字节比较）。只加索引 |
| `0010_city_import_source.sql` | 城市表加「来源」字段（从 GeoNames 导入的城市用，ADR 0014）和两个索引。不含任何数据 |
| `0011_areas.sql` | 区域（供应商的营运区和禁行区）：`areas`、`area_polygons`，第一批带 `tenant_id` 的业务表；外加创建类接口的幂等键 `idempotency_keys`。三张都开行级安全、只授权给租户角色（ADR 0015）。不含任何数据 |
| `0012_city_suggestion_hints.sql` | 给机场建议城市用的两项数据源信息：`places.municipality`（OurAirports 的所属城市名）、`cities.population`（GeoNames 的人口）。只加列，由导入命令填（ADR 0014「M1-11 的修订」） |
| `0013_products.sql` | 子品牌和商品：`brands`、`products`（服务规则、商品详情是它的 jsonb 列）、`product_areas`、`product_vehicle_groups`、`product_dispatchers`，商品编号的序列 `product_code_seq`。五张表都带 `tenant_id`、开行级安全、授权给租户角色；平台角色只能读 `products` 和 `product_vehicle_groups`（停用主数据前数已上架的商品用）（ADR 0016）。不含任何数据 |
| `0014_price_rules.sql` | 价格规则 `price_rules`、调价规则 `adjust_rules`（租户表，带 `tenant_id`、行级安全、只授权给租户角色）；节假日日历 `holidays`（平台主数据，平台可写、租户只读）；子品牌加取整单位 `brands.rounding_unit`（ADR 0018）。不含任何数据 |
| `0015_inventory.sql` | 库存：`products.inventory_mode`（不限量 / 限量）和每日库存 `inventory_days`（租户表：可售总数、已预占、已售，检查约束保证不超卖；带 `tenant_id`、行级安全、只授权给租户角色）（ADR 0019）。不含任何数据 |
| `0016_quote_platform_read.sql` | 报价引擎：平台角色对报价用到的租户表（`brands`、`areas`、`area_polygons`、`product_areas`、`price_rules`、`adjust_rules`、`inventory_days`）只读——比价要把所有供应商的商品放在一起算（ADR 0020）。只调整权限和行级安全策略，不建表、不含任何数据 |
| `0017_product_dispatchers_platform_read.sql` | 运营后台查看供应商的商品：平台角色对调度人 `product_dispatchers` 只读（商品用到的其余租户表在 0013、0016 已经可读），平台由此能只读看到商品的全部内容和上架校验（ADR 0021）。只调整权限和行级安全策略，不建表、不含任何数据 |
| `0018_fx_rates.sql` | 汇率中心：拉取记录 `fx_fetches`（每次拉取的结果、原因、挂起待确认的那批）和汇率 `fx_rates`（1 USD = rate 单位该币种，`numeric` 存十进制原值，保留全部历史）。两张平台表：平台可写（拉取记录可改状态、汇率只追加），租户只读汇率（ADR 0022）。不含任何数据 |
| `0019_channels.sql` | 渠道、授权范围、加价规则、敏感操作双人复核（M2-04，ADR 0023）；全是平台表，租户角色没有任何权限，不含任何数据 |
| `0020_sales_quotes.sql` | 渠道的 API 客户端与密钥（只存哈希）、正式询价的报价快照 `quotes`、询价日志、`/sales/v1` 的限流计数（M2-04）；全是平台表 |
| `0021_api_client_retired_secrets.sql` | API 客户端每一代旧密钥各自保留 24 小时宽限（M2-04 测试发现的缺陷）；只有哈希，没有原文 |
| `0022_place_name_sources.sql` | 地点表加 `name_sources`：每种语言的名称是哪次导入填的（数据源、编号、当时的文字），机场的中文名、日文名从 GeoNames 导入时用来认出「平台改过 / 删掉了」（ADR 0024）。只加列，不含任何数据。0019、0020 由 M2-04 使用 |
| `0023_fx_locks.sql` | 汇率人工锁定：`fx_locks`（按币种锁「1 USD = rate」，`numeric` 存十进制原值；到期时间必填、最长 72 小时；发起人、批准人、解锁或取代的复核；同一币种最多一条生效中的）。平台表：平台可写（只增改、不删），租户没有任何权限（ADR 0025）。不含任何数据 |
| `0024_orders.sql` | 下单与付款（ADR 0026）：订单 `orders` 和状态流水 `order_events`（租户表：带 `tenant_id`、行级安全，租户只读，平台读写）；订单的销售端一侧 `order_sales`（渠道、对外价、加价比例、汇率快照、幂等键）、收款 `order_payments`（Stripe 的付款 / 客户 / 支付方式编号和状态）、支付通知 `payment_events`（事件编号唯一，只处理一次）三张平台表，租户角色没有任何权限；平台角色对 `inventory_days` 加「改」（预占、扣减、释放）、对 `quote_logs` 加「改」（已下单），语句级触发器只许平台改这几列。不含任何数据 |
| `0025_fleet.sql` | 司机 `drivers`、车辆 `vehicles`（M3-02，ADR 0027）：租户表，带 `tenant_id`、行级安全；不删除（停用）；同一个供应商里电话、车牌唯一；非营业牌照的车不能设为可用（检查约束）。平台角色只读。不含任何数据 |
| `0026_dispatch.sql` | 派车和履约（ADR 0027）：订单加四个状态（司机已出发、已到达、客人未出现待审核、客人未出现）和派车、履约、落地时间的列；租户角色对订单加「改」，语句级触发器只许改派车和履约的列，行级触发器只许在履约的范围里改状态；状态流水加 `detail` 和三种操作者；派车记录 `order_assignments`、司机链接 `driver_links`（只存令牌的哈希）、照片 `order_files`（存在库里，≤ 5 MB）、联系记录 `order_contacts`、定位 `order_locations`、no-show 申请 `order_no_show_claims`（租户表，只追加；平台只读）。已有订单的派车截止时间按规则补算。不含任何数据 |
| `0027_tenant_webhooks.sql` | 推送给供应商（ADR 0027）：订阅 `tenant_webhooks`（一个供应商一个地址；签名密钥是 AES-256-GCM 密文）、投递 `webhook_deliveries`（不存请求体）、每次尝试 `webhook_attempts`（只存大小和指纹）。租户表；平台角色读订阅、读写投递（推送任务、运营后台重推）。不含任何数据 |
| `0028_webhook_lease.sql` | 推送的租约（M3-02，ADR 0027）：投递加租约令牌 `lease_token`（推送任务租下时写入，记结果时核对，租约被接手的一方记不上结果）；每条投递的尝试编号唯一。不含任何数据 |
| `0031_cancel_change_extra_charges.sql` | 取消、改单、事后加收（M3-03，ADR 0029；0029、0030 留给别的任务）：平台统一取消政策 `cancellation_policies`（按版本追加，租户只读）；订单加下单时适用的取消阶梯、取消的扣款比例和供应商应得；改单 `order_changes`（租户表）和改期的对外价 `order_change_sales`（平台表）；事后加收 `order_extra_charges`（租户表，供应商只能提交和撤回，触发器把关）；收款一单可以多笔（改期补差价、加收）；退款 `order_refunds`（平台表）；凭证照片可以由供应商后台上传。不含任何数据 |
| `0032_money_guards.sql` | 钱的几道把关（M3-03，ADR 0029「补充：钱的口径与审核时机」）：退款加作废时间 `superseded_at`（只有失败的能作废——取消时的退款已经包含了它）；加收的异议期固定 48 小时、待审核和有异议的必须有转人工的原因、批准只能在异议期结束之后、撤回只能在异议期内。不含任何数据 |
| `0033_tenant_onboarding.sql` | 供应商入驻（ADR 0028）：`tenants` 加七种状态、暂停原因和之前的状态、观察原因、各阶段时间、最新评分、每日检查做到哪天、版本（原有的 `active` 保留为正式，`suspended` 补上「暂停之前是正式、人工暂停」）；新增九张租户表——企业信息 `tenant_profiles`、文件 `tenant_files`（`bytea`）、资质 `tenant_documents`、合同版本 `tenant_contracts`、状态记录 `tenant_status_events`、评分输入 `tenant_performance_events` 和 `order_reviews`、每日评分 `tenant_score_daily`、提醒 `tenant_notices`；都带 `tenant_id`、行级安全，租户只能读（企业信息能写、文件和资质能追加），审核结论、合同、状态只有平台能写。不含任何业务数据（0029 未使用：入驻开发时为 M3-02 预留的编号） |
| `0035_rescue_penalties.sql` | 救援改派与违约金（M3-04，ADR 0031；0033、0034 留给别的任务）：订单加「已转给救援供应商」状态（原供应商的那一行，救援供应商另起一行、同一个订单编号；「现在的」行和订单号只看没转出的）和司机未到的提醒列；进入救援时作废司机链接；平台可以改订单销售端一侧的「现在的供应商」；救援 `order_rescues`、救援单的平台一侧 `order_rescue_quotes`（平台表）；救援单 `order_rescue_offers`、供应商应扣款项 `tenant_deductions`（租户表，供应商只读）。不含任何数据 |
| `0045_site_order_links.sql` | 官网的订单查看链接（M3-05，ADR 0032）：`site_order_links`（订单、令牌的 SHA-256、下单发的还是找回发的、有效期）。平台表：平台读、追加，租户角色没有任何权限。不含任何数据（0034–0044 未使用：任务指定从 0045 起） |
| `0046_site_lookup_failures.sql` | 官网找回订单的失败记录（M3-05，ADR 0032）：`site_lookup_failures`（订单号的 SHA-256、失败时间），每个订单号滚动 24 小时失败满 100 次后连对上的也挡。平台表：平台读、追加、删过期行，租户角色没有任何权限。不含任何数据 |
| `0047_platform_security.sql` | 平台账号安全（ADR 0030）：角色表加「内置 / 自建」、自建角色的勾选、数据范围（城市、渠道）、IP 白名单、版本，内置角色由触发器保护为只读；平台员工加两步验证的密钥（加密）、防重放的时间窗、待确认的新密钥、IP 白名单；会话加「两步验证完成的时间和方式」（触发器只放行「待验证 → 已验证」且不超过 8 小时）；新表 `platform_recovery_codes`（只存哈希）。（开发时编号 0040，合并时排到 0045、0046 之后。）不写任何账号、角色、名单 |
| `0048_platform_session_verify_expiry.sql` | 平台会话触发器（ADR 0030）补一条：两步验证完成的时间必须在待验证会话的有效期里——已经过期的待验证会话不能被「验证」复活。不改任何数据 |
| `0050_approval_pricing_impact.sql` | 加价规则 / 定价参数生效前的毛利试算（M3-07，ADR 0033；0034–0049 留给别的任务）：复核记录加 `impact`（发起时保存的试算结果，审核人批准前看）。只加列，授权不变。不含任何数据 |
| `0051_pricing_impact_inputs.sql` | 毛利试算取数（M3-07，ADR 0033「性能」）：报价、订单的渠道索引加上编号（`quotes (channel_id, created_at desc, id desc)`、`order_sales (channel_id, created_at desc, order_id desc)`），替换原来只有（渠道、时间）的两个；`quotes` 加生成列 `impact_inputs`（数据库从快照算出试算要的那几项，约 0.5 KB）。只改结构，授权不变，不含任何数据 |
| `0070_billing.sql` | 供应商应付账单与付款批次（M5-01，ADR 0040；0050–0069 留给别的分支）：付款批次 `payout_batches`（平台表，一个付款日一个批次）；账单 `statements`（同一供应商、同一期、同一币种只有一张有效的）、明细 `statement_lines`（一笔应付同一时刻只挂在一张有效的账单上；平台只能改作废时间）、经过 `statement_events`（只追加），三张租户表，供应商只读。不含任何数据 |
| `0080_integration_secrets.sql` | 运营后台填写的第三方密钥（M4-09，ADR 0041；0052–0079 留给别的任务）：`integration_secrets`（谷歌地图、Stripe 各一行；`sealed` 是 AES-256-GCM 密文、`hints` 是打码后的末 4 位、版本、谁什么时候改的；清空 = 删行）。平台表：平台读、写、删，租户角色没有任何权限。不含任何数据 |
| `0090_order_center_tickets.sql` | 订单中心、异常队列、工单与赔付表（M4-02，ADR 0034；开发时编号 0060，合并时排到 main 上已有的迁移之后）：平台表 `compensation_tables`（赔付表按版本追加）、`order_exceptions`（异常队列）、`ticket_notes`（内部备注）、`ticket_compensations`（客人那边的赔付金额）；租户表 `tickets`、`ticket_messages`（供应商只读）；`order_refunds` 加赔付用途和 `ticket_id`；`tenant_deductions` 加赔付、报销两种（来源是工单）；`order_no_show_claims` 加审核结论（平台只改这三列）；履约失败加 `no_show_rejected`，平台可删履约事件（申诉撤销）。不含任何数据 |
| `0100_ticket_guest_replies.sql` | 工单给客人的回复（M4-03，ADR 0034 补充）：内部备注表 `ticket_notes` 加 `to_guest`——平台写给客人的话存在这张平台表里，官网订单页和渠道看得到，供应商看不到；原有的备注都是内部的。只加列，授权不变，不含任何数据 |
| `0110_route_estimates.sql` | 路线预估（M2-02，ADR 0042；0091–0109 留给别的任务，0100 是 M4-03 的）：路线缓存 `route_estimates`（取整后的起终点一行，成功的有里程和时长、保留 7 天，没有路线 / 坐标无效只有原因、保留 1 天）、每日调用计数 `route_api_usage`（东京时间的日期一行：调用、失败、被每日上限挡下的次数，最近一次成功和失败）；询价日志加 `route`（这次的路线或降级原因）。平台表，租户角色没有任何权限。不含任何数据 |
| `0120_place_api_usage.sql` | 官网的地址搜索和坐标反查（M3-12，ADR 0044；0111–0119 留给别的任务）：每日调用计数 `place_api_usage`（东京时间的日期一行：搜索和反查合计的调用、失败、被每日上限挡下的次数，最近一次成功和失败）。和路线预估的计数分开。谷歌返回的名称、地址不存库。平台表，租户角色没有任何权限。不含任何数据 |
| `0130_integration_secrets_email.sql` | 运营后台填写邮件发送（M4-14，ADR 0048；0121–0129 留给别的任务）：`integration_secrets` 的 `integration` 多一个取值 `email`，结构不变。不含任何数据 |
| `0140_notification_center.sql` | 通知中心（M4-08，ADR 0049；0131–0139 留给别的任务）：发件箱 `notification_events`（租户角色只能追加自己的，读不了；平台读写）、发送记录 `notifications`（没有主题和正文；供应商只读得到发给自己的；平台读写）、免打扰 `tenant_notification_settings`（租户读写，平台只读）；`site_order_links.issued_via` 多一个取值 `email`。不含任何数据：模板是代码常量 |
| `0150_email_login_codes.sql` | 邮箱验证码登录（M4-06，ADR 0050；0131–0149 留给别的任务）：`email_login_codes` 一个邮箱一行（只有 HMAC，没有邮箱和验证码原文），只授权给 `nozomi_preauth`（登录前就要读写，和 `login_throttles` 同理）。不含任何数据 |

迁移不创建任何账号和租户，也不创建数据库的登录账号。第一个平台超级管理员用 `pnpm admin:create` 创建。
迁移也不写任何城市、机场、车型：机场用 `pnpm masterdata:import-airports` 从 OurAirports（公有领域）导入，城市用 `pnpm masterdata:import-cities` 从 GeoNames（CC BY 4.0，须注明来源）导入，机场的中文名、日文名用 `pnpm masterdata:import-airport-names` 从 GeoNames 导入，其余由平台在后台录入。
| `0170_proxy_fulfilment_scoring.sql` | 代传履约的修复（M4-18，ADR 0052）：`orders.completed_recorded_at`（加收窗口、投诉时限的起点）；供应商、司机回传时能写派车和到达这两类评分事件 |
| `0190_passenger_retention.sql` | 乘客信息自动脱敏（M4-21，ADR 0055）：`orders.passenger_anonymized_at` 和到期扫描的索引；联系记录、工单对话、内部备注、状态流水、客人评价给平台角色开放修改，触发器限定只能改手写的那一列、只有已脱敏的单才能改；复核的内容同样限定；已脱敏的单不能改回乘客、不能清标记。不含任何数据 |
| `0200_passenger_encryption.sql` | 乘客信息加密存储（M4-22，ADR 0057）：`orders` 的密文和三个盲索引列，改单、推送、通知的密文列；三个盲索引索引；明文被改而密文没跟着改时让密文作废的触发器（脱敏的行也一律清）；供应商改不了这些新列。只加不改，不含数据，回填由 `pnpm passenger:backfill` 或后台任务做 |
| `0210_driver_link_email.sql` | 司机链接自动发邮件（M4-27，ADR 0058）：司机邮箱（选填）；供应商的发送方式（默认自动）；司机链接分调度员的和邮件的，吊销原因加 `email_changed`；发送请求表 `driver_link_emails`；发送记录加接收方 `driver`，供应商能读发给司机的状态 |
| `0225_driver_link_lifecycle.sql` | 司机链接跟着订单走（M4-29 同一个文件）：平台角色能改 `expires_at`（改期生效时重算），吊销原因加 `cancelled`，之前已取消的单链接作废 |
| `0226_driver_link_email_fixes.sql` | 司机链接邮件的修补（M4-27，ADR 0058）：吊销原因加 `send_failed`；发送请求加 `closed_code` / `closed_at`（没有发送记录就结束了），平台角色只能改这两列 |
| `0160_bank_transfer_files.sql` | 供应商收款账户（账号只存密文和末 4 位，内容不可变）、银行转账文件和文件条目（一张账单同时只在一个未作废的文件里）、账单加银行流水号（M5-02，ADR 0051；0140、0150 被 M4-08、M4-06 占用）。不含任何数据 |
| `0230_change_approval.sql` | 客户改单要供应商确认（M4-29，ADR 0060）：改单新增状态「调整中」，唯一约束和期限索引跟上；加最早用车时间、调整中和代处理的记录列；异常队列加 `change_unconfirmed`；供应商后台待办 `order_todos`（租户表，租户只读）。不含任何数据 |
| `0231_view_link_requests.sql` | 官网订单链接发到下单邮箱（M4-30，ADR 0061）：运营核实后重发的记录 `view_link_requests`（平台表）；发到新邮箱的等审核期间加密存着，有结论后清空。不含任何数据 |
| `0235_passenger_email_changes.sql` | 运营代改乘客邮箱要双人复核（M4-31，ADR 0065）：代改邮箱的记录 `passenger_email_changes`（平台表）；新邮箱和发起时的邮箱等审核期间加密存着，有结论后清空。编号空出 0232–0234 给并行的任务。不含任何数据 |
| `0240_tenant_profile_changes.sql` | 供应商名称和企业信息的维护（M4-34，ADR 0071）：平台角色对 `tenant_profiles` 多了 `insert`、`update`（平台改企业信息）；新表 `tenant_profile_changes`（供应商改对外显示名称、法定名称、登记号的申请，租户表、行级安全，供应商只读；内容不可变、状态机、已生效必须有已批准的复核，触发器兜底）。编号空出 0236–0239 给并行的任务。不含任何数据 |
| `0250_static_map_images.sql` | 官网路线小地图（M8-10，ADR 0072；0240 是 M4-34 的）：谷歌静态地图的图片缓存 `static_map_images`（一条路线 × 主题 × 尺寸 × 倍率一行，最大 1 MB，保留 1 天，写入时顺手删过期的）、每日调用计数 `static_map_api_usage`（东京时间的日期一行：调用、失败、被每日上限挡下的次数，最近一次成功和失败），和路线预估的计数分开。平台表，租户角色没有任何权限。不含任何数据 |
| `0260_charter_area_surcharge.sql` | 包车区域加价（M8-15，ADR 0073 第三部分）：价格规则多一种价格方式 `charter_area_surcharge`（上车加价、下车加价，按套餐时长分，`package_hours` 必填），只改 `price_rules` 的两条检查约束。0250 由 M8-10 占用。不含任何数据 |
| `0270_p2p_route_prices.sql` | 点对点线路价（M8-11，ADR 0073 第二部分）：`price_rules` 加可空的下车区域 `to_area_id`（外键到同一租户的区域，删区域时跟着删；只能用在点对点、不能等于上车区域，检查约束兜底）和它的部分索引。一口价的含公里数在 `params` 里，不改表。不含任何数据 |
| `0280_manual_quote_requests.sql` | 人工报价申请和官网设置（M8-21，ADR 0076）：`manual_quote_requests`（客人留的邮箱 / WhatsApp 和两端地点只在密文 `contact_enc` 里，另有盲索引和去重键；明文只有用车类型、城市、时间、人数等不指向个人的部分；到期清除后密文、盲索引清空）、`manual_quote_request_events`（跟进记录，只追加，备注加密）、`site_settings`（全站一行，客服 WhatsApp 号码，第一次保存时写入）。三张平台表，只授权 `nozomi_platform`（不给删除），租户角色没有任何权限。不含任何数据 |
| `0290_area_roles_uncovered_demands.sql` | 运营区域与报价区域分开、未覆盖需求（M8-20，ADR 0075；0280 由 M8-21 占用）：`areas.role`（`operating` / `pricing` / `both`，已有的行由加列时的默认值填成 `both`，随即去掉默认值）和启用中运营范围的部分索引；平台表 `uncovered_demands`（一个价都报不出的询价：坐标 4 位小数、无客人个人信息，按指纹 + 东京日期去重）、`uncovered_demand_limits`（新增行的限流计数，键只有哈希）、`uncovered_demand_drops`（每天被限掉的条数），三张只授权给平台角色。不含任何数据 |
| `0300_test_tenant.sql` | 测试环境专用的 QA 测试供应商（M8-16，ADR 0077；0290 留给 M8-20）：`tenants` 加 `is_test_tenant`（默认 false）；检查约束保证测试供应商只能是申请中、审核中、已签约、已清退（不能上架、不参与比价）；部分唯一索引保证全平台最多一家。不含任何数据：这一行只由 `pnpm qa:tenant-ensure` 显式建出 |
| `0310_qa_acceptance_channel.sql` | 测试环境的验收通道（M8-26，ADR 0078）：商品多一个状态 `qa_listed`（验收可售），触发器保证只有 QA 测试供应商的商品能处在它（还有这种商品的测试供应商不能摘掉测试标记）；`orders.is_acceptance`（默认 false，建好后谁都不能改）、`quotes.is_acceptance`、`quote_logs.is_acceptance`；平台表 `qa_acceptance_sessions`（只存会话编号的 SHA-256）、`notification_suppressions`（验收单被压下的邮件的主题和正文，只给平台角色）。不含任何数据 |
| `0320_site_page_width.sql` | 官网页面宽度（M8-28，ADR 0079）：`site_settings` 加 `page_width`（`standard` / `wide` / `full`，列默认 `standard`，带检查约束）。只加列，不含任何数据 |
| `0330_distance_prices.sql` | 计程价（M8-30，ADR 0080）：租户表 `distance_prices`（商品 × 车型组的起步价、每公里单价，结算价整数；生效日期、启停；外键到同一租户的商品，删商品跟着删），行级安全只放行当前租户，平台角色只读（比价用）。不含任何数据 |
