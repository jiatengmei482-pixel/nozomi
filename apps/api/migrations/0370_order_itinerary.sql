-- M9-02：统一订单格式（需求 03 第 2.2 节、ADR 0087 第三节第 3 小节）。只加可空列，不回填已有的行，不含任何数据。
--
-- orders.itinerary：订单行程 v1（方式、地点列表、停留、计划时间、各段、合计、套餐、预计超出的数量）。**没有金额**。
--   只在官网新建订单的同一事务里由服务端写入；M9-02 之前的订单、/sales/v1 渠道订单为 null。供应商可以看（/tenant/v1、Webhook）。
-- orders.entry_source：订单从哪个入口来（book / route_template / embed）；只是记录，不改渠道、不改加价。
--   只给官网订单应答和运营后台，/tenant/v1 和供应商 Webhook 不给（接口层逐个字段列出，集成测试扫键）。建好之后谁都不能改。
-- 模型线路编号、嵌入码编号、来源域名三列随各自的表在 M9-03c、M9-04 的迁移里加（那时连外键一起建）；询价时保存的行程表在 M9-03。

alter table orders add column itinerary jsonb;
alter table orders add constraint orders_itinerary_object check (itinerary is null or (jsonb_typeof(itinerary) = 'object' and itinerary->>'version' = '1'));

alter table orders add column entry_source text;
alter table orders add constraint orders_entry_source_check check (entry_source is null or entry_source in ('book', 'route_template', 'embed'));

create function orders_entry_source_immutable() returns trigger
  language plpgsql
  as $$
begin
  if new.entry_source is distinct from old.entry_source then
    raise exception '订单的来源建好之后不能改' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger orders_entry_source_immutable
  before update of entry_source on orders
  for each row execute function orders_entry_source_immutable();

-- 两个新列和行程、乘客列一样，供应商改不了（行程只有平台能改：以后改期平移计划时间，ADR 0087 第三节第 3 小节）
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at,
                   passenger_anonymized_at, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx,
                   itinerary, entry_source
  on orders
  for each statement execute function reject_tenant_column_update();
