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

迁移不创建任何账号和租户，也不创建数据库的登录账号。第一个平台超级管理员用 `pnpm admin:create` 创建。
迁移也不写任何城市、机场、车型：机场用 `pnpm masterdata:import-airports` 从 OurAirports（公有领域）导入，城市用 `pnpm masterdata:import-cities` 从 GeoNames（CC BY 4.0，须注明来源）导入，机场的中文名、日文名用 `pnpm masterdata:import-airport-names` 从 GeoNames 导入，其余由平台在后台录入。
| `0045_site_order_links.sql` | 官网的订单查看链接（M3-05，ADR 0032）：`site_order_links`（订单、令牌的 SHA-256、下单发的还是找回发的、有效期）。平台表：平台读、追加，租户角色没有任何权限。不含任何数据（0034–0044 未使用：任务指定从 0045 起） |
| `0046_site_lookup_failures.sql` | 官网找回订单的失败记录（M3-05，ADR 0032）：`site_lookup_failures`（订单号的 SHA-256、失败时间），每个订单号滚动 24 小时失败满 100 次后连对上的也挡。平台表：平台读、追加、删过期行，租户角色没有任何权限。不含任何数据 |
