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

迁移不创建任何账号和租户，也不创建数据库的登录账号。第一个平台超级管理员用 `pnpm admin:create` 创建。
迁移也不写任何城市、机场、车型：机场用 `pnpm masterdata:import-airports` 从 OurAirports（公有领域）导入，城市用 `pnpm masterdata:import-cities` 从 GeoNames（CC BY 4.0，须注明来源）导入，其余由平台在后台录入。
