-- 包车三层区域的数据结构（M9P-05，ADR 0093 第一、五、六节）。只做加法：放宽约束、加价格方式、加列；不改、不删任何已有的行，不含任何数据。
-- 编号：main 上最大是 0430；0440 由 M9E-16（PR #242）占用，这里用 0450。
--
-- 1. 新价格方式 charter_itinerary_surcharge（②行程加价，params = { surchargeMinor }，结构见 @nozomi/domain 的 Pricing）：
--    area_id 是行程区域；只看经停点（和下车点行程加价），不参与上下车点匹配。
-- 2. 套餐时长：包车套餐（charter_package）仍必填；②行程加价、③上下车加价（charter_area_surcharge）可空——空 = 这个车型组的所有套餐
--    （引擎同一区域 × 车型组先找套餐对得上的行、再找套餐为空的行）；接送机、点对点仍为空。
-- 3. price_rules.area_id 对包车套餐可空：空 = 整个商品的套餐价（「车型组 × 套餐」一次填）。其他价格方式仍必填。
--    外键 (tenant_id, area_id) 在 area_id 为空时不检查（MATCH SIMPLE），不用改。
-- 4. products.charter_layout：空 = 旧表（③行里的途经加价、按服务区域的套餐价）；'three_layer' = 新表（②行程加价、整商品套餐价）。
--    只由迁移脚本（apps/api/src/db/charter-three-layer-cli.ts，经部署流水线的 migrate 容器、表的所有者执行）写；
--    租户角色、平台角色都不能改（触发器兜底，服务层的 PUT 本来就没有这个字段）。只有包车商品能设。

alter table price_rules drop constraint price_rules_model_check;
alter table price_rules add constraint price_rules_model_check check (pricing_model in ('fixed', 'mileage_time', 'charter_package', 'charter_area_surcharge', 'charter_itinerary_surcharge'));

alter table price_rules drop constraint price_rules_package_matches_model;
alter table price_rules add constraint price_rules_package_matches_model check (
  case pricing_model
    when 'charter_package' then package_hours is not null
    when 'charter_area_surcharge' then true
    when 'charter_itinerary_surcharge' then true
    else package_hours is null
  end
);

alter table price_rules alter column area_id drop not null;
alter table price_rules add constraint price_rules_area_required check (area_id is not null or pricing_model = 'charter_package');

alter table products add column charter_layout text;
alter table products add constraint products_charter_layout_check check (charter_layout is null or (charter_layout = 'three_layer' and category = 'charter'));

-- 数据库兜底：只有迁移脚本（表的所有者）能写这一列；租户角色、平台角色写入或改动都拒绝
create function products_charter_layout_owner_only() returns trigger
  language plpgsql
  as $$
begin
  if current_user in ('nozomi_app', 'nozomi_platform')
     and (case when tg_op = 'INSERT' then new.charter_layout is not null else new.charter_layout is distinct from old.charter_layout end) then
    raise exception '商品的三层区域标志（charter_layout）只能由迁移脚本写' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger products_charter_layout_owner_only
  before insert or update of charter_layout on products
  for each row execute function products_charter_layout_owner_only();
