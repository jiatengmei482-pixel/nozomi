-- 包车区域加价（M8-15，ADR 0073 第三部分）。只改约束，不建表、不含任何数据。
--
-- 价格规则多一种价格方式 charter_area_surcharge（参数 pickupSurchargeMinor、dropoffSurchargeMinor，结构见 @nozomi/domain 的 Pricing）：
-- area_id 是加价区域（本租户的报价区域，外键照旧指向同一租户的 areas），和包车套餐一样按套餐时长分，所以 package_hours 必填。
-- 已有的规则不受影响：三种原有价格方式的含义、约束都不变。
-- 编号：main 上最大是 0240；0250 由 M8-10 占用，这里用 0260。

alter table price_rules drop constraint price_rules_model_check;
alter table price_rules add constraint price_rules_model_check check (pricing_model in ('fixed', 'mileage_time', 'charter_package', 'charter_area_surcharge'));

alter table price_rules drop constraint price_rules_package_matches_model;
alter table price_rules add constraint price_rules_package_matches_model check ((pricing_model in ('charter_package', 'charter_area_surcharge')) = (package_hours is not null));
