-- 代传履约的修复（M4-18，ADR 0052）。只改结构和权限，不含任何数据；已有订单不回填。
-- 1. 系统记录「已完成」的时间：事后加收窗口、客人投诉时限从它起算。代传的完成时间是运营回填的，从它起算会让供应商和客人丢权利。旧行为空，按 completed_at 算。
alter table orders add column completed_recorded_at timestamptz;

-- 2. 评分的派车、到达事件由供应商和司机的回传写入，它们走租户事务（ADR 0028 的写入口一直没人调）。
-- 只放开这两类：投诉、履约失败仍然只有平台能写。
create policy tenant_performance_events_tenant_insert on tenant_performance_events for insert to nozomi_app
  with check (tenant_id = app_tenant_id() and kind in ('dispatch', 'arrival'));
grant insert on tenant_performance_events to nozomi_app;
