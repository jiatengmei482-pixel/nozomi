-- 点对点线路价（M8-11，ADR 0073 第二部分）。只加一列和约束，不建表、不含任何数据。
--
-- price_rules.to_area_id：点对点价格规则的下车区域。为空 = 区域价（和以前一样）；填了 = 单向线路价，
-- 只管「上车点在 area_id、下车点在 to_area_id」的单。外键指向同一租户的区域（带 tenant_id，行级安全照旧）；
-- 区域被删除时线路价跟着删（同 area_id）。只有点对点能填（接送机有方向、包车有套餐时长），不能等于上车区域。
-- 「下车区域必须是这个商品选的区域」「同一线路 × 车型组 × 生效日期不能重叠」由应用在锁住商品之后检查（同 ADR 0018）。
--
-- 一口价的「含公里数 + 超出每公里」（includedKm、overKmPerKmMinor）在 params 里（结构见 @nozomi/domain 的 FixedPricing），不改表。
-- 已有的规则不受影响：新列全部为空。编号：main 上最大是 0260（M8-15），这里用 0270。

alter table price_rules add column to_area_id uuid;

alter table price_rules
  add constraint price_rules_to_area_fk foreign key (tenant_id, to_area_id) references areas (tenant_id, id) on delete cascade,
  add constraint price_rules_to_area_check check (
    to_area_id is null or (to_area_id <> area_id and direction is null and package_hours is null and pricing_model in ('fixed', 'mileage_time'))
  );

-- 删除区域、查「这个区域下的价格」时按下车区域找
create index price_rules_to_area_idx on price_rules (tenant_id, to_area_id) where to_area_id is not null;
