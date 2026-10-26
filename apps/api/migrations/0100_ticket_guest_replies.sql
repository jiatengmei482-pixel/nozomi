-- 工单给客人的回复（M4-03，ADR 0034 补充）：官网订单页、渠道看得到平台写给客人的话。
-- 放在平台表 ticket_notes 里、用 to_guest 标出：供应商（租户角色）对这张表没有任何权限，看不到平台对客人说了什么（可能涉及赔付金额）；
-- 内部备注仍是 to_guest = false，客人和渠道看不到。只加列，授权不变，不含任何数据。
alter table ticket_notes add column to_guest boolean not null default false;
