-- M3-07：加价规则 / 渠道定价参数生效前的毛利试算（ADR 0033）。
-- 复核记录加一列：发起时按当时的数据算的试算结果（对外价、结算价、毛利的改前 / 改后 / 差额，中标换人数……），审核人在批准前看。
-- 只有改定价参数、加价规则的复核有；其余类别为空。只加列，授权不变（平台角色本来就能读、增、改 approvals）。不含任何数据。
alter table approvals add column impact jsonb;
alter table approvals add constraint approvals_impact_object check (impact is null or jsonb_typeof(impact) = 'object');
