-- M9P-01：救援差价的基准（ADR 0093 第二节「已下的单改期、救援」做法 B）。只加两列，不回填已有的行，不含任何数据。
--
-- 包车加价算法改了（经停不再被上下车加价抵消、下车点行程加价）之后，部署前下的单救援时，救援供应商按新算法报价、原结算价却是旧算法算的，
-- 算法多出来的加价会整笔算进原供应商的救援差价。触发救援时把基准算好存下：
--   基准 = 原结算价 + max(0, 原订单的商品按当前规则重算的加价合计 − 订单上的加价合计)；救援差价 = max(0, 救援结算价 − 基准)。
-- deduction_base_minor：基准（原结算币种的最小单位）；为空 = 这一列之前的救援，按原结算价。
-- deduction_base：怎么算出来的（surcharge_before / surcharge_after / fallback_reason），供应商有异议或对账时看。
-- 授权不变（order_rescues 整表已授权给 nozomi_platform 读、增、改，迁移 0035）。
alter table order_rescues
  add column deduction_base_minor bigint,
  add column deduction_base jsonb,
  add constraint order_rescues_deduction_base_check check (
    (deduction_base_minor is null and deduction_base is null)
    or (deduction_base_minor is not null and deduction_base is not null and deduction_base_minor >= original_settlement_minor)
  );
