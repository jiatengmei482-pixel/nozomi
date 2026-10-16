# ADR 0021：运营后台只读查看供应商的商品

- 状态：已采纳（2026-10-15，M1-12）
- 调整 ADR 0016 里「平台对商品只有『数已上架的有几个在用』、接口不返回任何商品内容」和「调度人平台读不到」两处：平台现在可以只读地看商品的全部内容（见「数据库权限」）。ADR 0016 其余内容不变。

## 背景

负责人反馈「供应商已经上架一个产品，运营后台还没有出现这个产品」：`/platform/v1` 此前没有任何商品接口。需求《平台运营端与渠道对接》的租户详情页要有「商品和价格概览」，并可以「以租户身份只读查看」。本任务先给运营人员一个只读的商品列表和详情；「以租户身份查看」整个租户后台（要留审计日志）是另一回事，不在这里做。

## 决定

### 接口：只读，两个

| 接口 | 内容 |
| --- | --- |
| `GET /platform/v1/products` | 所有供应商的商品，分页（`limit` / `cursor`，按更新时间从新到旧），带 `total`。筛选：`tenant_id`、`city_id`、`category`、`status`（`draft` / `published` / `unpublished` / `all`）、`q`（商品名或编号）、`brand_id`、`has_active_price` |
| `GET /platform/v1/products/{id}` | 一个商品：`tenant`、`product`、`service_rules`、`content`、`price_rules`、`adjust_rules`、`inventory`、`publish_check` |

- 列表项的字段和租户侧列表项相同（没有上架校验的概况 `check`——跨供应商逐个现算太贵），另带所属供应商 `tenant { id, name, status }`、`has_active_price`、`active_price_rule_count`。
- 「有没有可以卖的价格」和上架校验「价格规则」一项、租户的价格概况是同一个判断：启用、没过期（按商品所在城市当地的今天）、区域和车型组都是商品现在选着的。SQL 片段只有一份（`repos/prices.ts` 的 `activePriceRuleCountSql`），价格概况改为用它。`status=published&has_active_price=false` 就是「已上架却报不出价」。
- 详情的各部分**调用租户侧的同一组函数**（`detail`、`serviceRulesView`、`loadPricingContext`、`publishCheckOf`），用同一组序列化函数输出，所以和供应商自己看到的逐字段相同（集成测试逐部分比对）。租户编号来自「这个商品属于谁」，不来自请求参数。
- 平台可以看结算价（规则 4 只限制 `/tenant/v1`）。这里不算对外价、不取加价比例。
- 平台没有修改供应商商品的接口。
- 不写审计日志：和查看租户列表一样是平台员工的日常查询。「以租户身份查看」做的时候按需求文档记审计。

### 只读怎么保证

1. 两个接口在平台事务里以只读快照执行（`begin isolation level repeatable read read only`），任何写入数据库都会拒绝。
2. 平台角色对商品用到的租户表只有 SELECT（下一节）。
3. 集成测试：十个平台角色把列表、筛选、详情、首页都调一遍，前后商品相关的每张表和审计日志一行不差。

### 数据库权限

商品用到的租户表里，平台角色此前只差调度人 `product_dispatchers` 读不到（`products`、`product_vehicle_groups` 在 0013，`brands`、`areas`、`area_polygons`、`product_areas`、`price_rules`、`adjust_rules`、`inventory_days` 在 0016）。迁移 `0017` 给它加只读权限和一条写明 `to nozomi_platform` 的放行策略；不能写。理由：上架校验要数调度人（复用而不是另写一份就必须读得到），客服处理订单时也要看调度人的电话。结构测试的清单同步更新。

走的仍是 ADR 0010 的平台角色和行级安全策略，没有绕过。

### 权限：新操作 `product.read`

| 角色 | 有没有 | 理由 |
| --- | --- | --- |
| 超级管理员 | 有 | 全部操作 |
| 运营 | 有 | 租户管理、比价监控 |
| 招商 | 有 | 租户详情页的「商品和价格概览」 |
| 渠道经理 | 有 | 决定渠道卖哪些供应商、哪些城市和品类 |
| 客服 | 有 | 处理订单时查服务规则、免等、调度人 |
| 风控 | 有 | 菜单里有「价格异常」 |
| 只读 | 有 | 能看租户，商品是租户的一部分；里面只有结算价，没有加价比例（这是它没有 `quote.preview` 的原因） |
| 财务 | 没有 | 看账单和结算，不看商品配置 |
| 主数据运营 | 没有 | 停用主数据时只需要「几个已上架商品在用」，已经有了 |
| 技术 | 没有 | 连接器和日志 |

和租户侧一样叫 `product.read`（平台已有的操作也都是 `xxx.read`），没有 `product.manage`。

### 首页卡片

首页要的「已上架商品数」用列表取：`GET /platform/v1/products?status=published&limit=1` 的 `total`（「其中已经报不出价的」加 `has_active_price=false`）。
没有 `product.read` 的角色调不了这个接口，页面按 `GET /platform/v1/auth/me` 的 `permissions` 决定显不显示这张卡片。
本期不往 `GET /platform/v1/dashboard/summary` 里加商品一组：前端对这个接口的字段有逐层的契约测试（`apps/web/src/api/master.contract.test.ts`），
加字段要前后端同一个改动里一起改；以后首页需要更多商品统计时，由前端任务连同契约测试一起加。

## 本期不做

| 内容 | 去向 |
| --- | --- |
| 「以租户身份只读查看」整个租户后台（留审计日志） | 需要新任务 |
| 运营后台的商品页面 | 前端（本任务的前端部分） |
| 列表里每个商品的上架校验概况 | 需要时再做（要批量取数，不能逐个现算） |
| 价格日历、缺价组合的平台侧接口 | 需要时再加，同样复用租户侧的函数 |
