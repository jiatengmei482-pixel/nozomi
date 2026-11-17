-- M9E-28：接机免费等待按航班定（ADR 0097，监工替业主 2026-11-15 确认）。只加结构，不含任何数据。
--
-- orders.flight_kind：客人填航班号时选的国际 / 国内航班（international / domestic）；没选、渠道没给、不是接机的单为 null。
-- orders.free_wait_basis：下单时（或派单前改航班时）锁定免费等待的依据 { flight_kind, base, floor_minutes }：
--   按哪种航班取的下限（null = 航班类型未确认，按国内线 60）、商品自己设的值、取的下限。最终分钟数仍在 free_wait_minutes。
--   只有按航班定免费等待的接机单有；以前的单、不是接机的单为 null，不回填（Q4：已有订单不回头改）。
-- 供应商订单详情、司机页、运营订单详情从这两列读。供应商不能改（加进 orders_tenant_columns）；平台在派单前改航班时重新锁定。
-- 编号：main 上最大是 0460，0470 由 M9E-26（#249）使用，这里用 0480。

alter table orders add column flight_kind text;
alter table orders add constraint orders_flight_kind_check check (flight_kind is null or flight_kind in ('international', 'domestic'));
alter table orders add column free_wait_basis jsonb;
alter table orders add constraint orders_free_wait_basis_shape check (free_wait_basis is null or jsonb_typeof(free_wait_basis) = 'object');

-- 新列和行程的其他列一样，供应商改不了（列表照抄 0370，末尾加 flight_kind、free_wait_basis）
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at,
                   passenger_anonymized_at, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx, waypoints, flight_kind, free_wait_basis
  on orders
  for each statement execute function reject_tenant_column_update();
