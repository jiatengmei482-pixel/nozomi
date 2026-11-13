-- M8-39：验收会话里提交的人工报价留资带「验收」标记（ADR 0078 补充「验收留资」，ADR 0076）。只加结构，不含任何数据。
--
-- manual_quote_requests.is_acceptance：只由服务端在带有效验收会话的官网提交时设为 true；建好之后谁都不能改（同 orders.is_acceptance）。
-- 已有的行全部是 false（不回填）：以前的留资一律按真实客人的算，人工关掉的那条不动。
-- 运营后台的列表默认不列验收留资；带筛选参数才看得到。

alter table manual_quote_requests add column is_acceptance boolean not null default false;

create function manual_quote_requests_acceptance_immutable() returns trigger
  language plpgsql
  as $$
begin
  if new.is_acceptance is distinct from old.is_acceptance then
    raise exception '人工报价申请的「验收留资」标记建好之后不能改' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger manual_quote_requests_acceptance_immutable
  before update of is_acceptance on manual_quote_requests
  for each row execute function manual_quote_requests_acceptance_immutable();
