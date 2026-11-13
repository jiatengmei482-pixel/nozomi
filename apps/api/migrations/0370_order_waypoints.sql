-- M9W-01：包车订单的经停点（ADR 0088 第 2 节）。只加结构，不含任何数据。
--
-- orders.waypoints：下单时从报价快照的 snapshot.request.waypoints 抄过来，按顺序 [{ name, lat, lng, stay_minutes }]；
-- 没有经停点的单（包括以前所有的单）为 null，不回填。
-- 供应商订单详情、司机端、官网、运营都从这一列读（报价快照所在的 quotes、order_sales 只授权给平台账号，租户读不到；改授权会把对外价暴露给租户）。
-- 下单后谁都不能改：加进供应商不能改的列（orders_tenant_columns），另加一个触发器挡住平台账号（改经停点 = 取消重下）。
-- 编号：main 上最大是 0360，这里用 0370。

alter table orders add column waypoints jsonb;
alter table orders add constraint orders_waypoints_shape check (waypoints is null or (jsonb_typeof(waypoints) = 'array' and jsonb_array_length(waypoints) between 1 and 10));

-- 新列和行程的其他列一样，供应商改不了（列表照抄 0200，末尾加 waypoints）
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at,
                   passenger_anonymized_at, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx, waypoints
  on orders
  for each statement execute function reject_tenant_column_update();

create function orders_waypoints_immutable() returns trigger
  language plpgsql
  as $$
begin
  if new.waypoints is distinct from old.waypoints then
    raise exception '订单的经停点下单后不能改（要改请取消重下）' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger orders_waypoints_immutable
  before update of waypoints on orders
  for each row execute function orders_waypoints_immutable();
