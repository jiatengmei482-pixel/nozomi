-- 报价引擎（M2-01，ADR 0020）：比价要把所有供应商的商品放在一起算，所以平台账号要能读报价用到的租户表。
-- 只读，不能写：平台侧的试算接口（POST /platform/v1/quotes/preview）在平台事务里跨租户读取这些表。
-- 调度人（product_dispatchers）不给——报价用不到。只调整权限，不建表、不写任何数据。

grant select on brands, areas, area_polygons, product_areas, price_rules, adjust_rules, inventory_days to nozomi_platform;

create policy brands_platform_read on brands for select to nozomi_platform using (true);
create policy areas_platform_read on areas for select to nozomi_platform using (true);
create policy area_polygons_platform_read on area_polygons for select to nozomi_platform using (true);
create policy product_areas_platform_read on product_areas for select to nozomi_platform using (true);
create policy price_rules_platform_read on price_rules for select to nozomi_platform using (true);
create policy adjust_rules_platform_read on adjust_rules for select to nozomi_platform using (true);
create policy inventory_days_platform_read on inventory_days for select to nozomi_platform using (true);
