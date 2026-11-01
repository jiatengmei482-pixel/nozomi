-- 乘客信息加密存储（M4-22，ADR 0057）。只加列、索引、触发器，明文列一个字都不动；代码退回旧版本时这些都不影响它。
-- 不含任何数据：旧数据由后台任务回填（pnpm passenger:backfill）。

-- 乘客三项的密文和盲索引（带密钥的 HMAC，算不算得出取决于主密钥，库里只有结果）
alter table orders
  add column passenger_enc text,
  add column passenger_email_bidx text,
  add column passenger_phone_bidx text,
  add column passenger_name_bidx text;

-- 副本：含乘客的改单前后值、推送内容；给客人的通知的收件地址
alter table order_changes add column values_enc text;
alter table webhook_deliveries add column event_data_enc text;
alter table notifications add column recipient_enc text;

-- 运营跨供应商按邮箱、电话、姓名精确筛选（ADR 0009 的例外：盲索引的值本身已经按租户隔离，以 tenant_id 开头没有用）
create index orders_passenger_email_bidx_idx on orders (passenger_email_bidx) where passenger_email_bidx is not null;
create index orders_passenger_phone_bidx_idx on orders (passenger_phone_bidx) where passenger_phone_bidx is not null;
create index orders_passenger_name_bidx_idx on orders (passenger_name_bidx) where passenger_name_bidx is not null;

-- 密文和明文不能各说各的。明文被改而密文没跟着改（退回旧版本的代码、手工改库），这一行的密文和盲索引作废，回填任务重新加密；读取先看明文。
-- 脱敏过的行任何时候都没有密文和盲索引，数据库保证。第 6 步（清明文）时连同这些触发器一起去掉。
create function orders_passenger_cipher_sync() returns trigger
  language plpgsql
  as $$
begin
  if new.passenger_anonymized_at is not null
     or (new.passenger is distinct from old.passenger and new.passenger_enc is not distinct from old.passenger_enc) then
    new.passenger_enc := null;
    new.passenger_email_bidx := null;
    new.passenger_phone_bidx := null;
    new.passenger_name_bidx := null;
  end if;
  return new;
end
$$;
create trigger orders_passenger_cipher_sync
  before update of passenger, passenger_anonymized_at, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx on orders
  for each row execute function orders_passenger_cipher_sync();

create function order_changes_cipher_sync() returns trigger
  language plpgsql
  as $$
begin
  if (new.before is distinct from old.before or new.after is distinct from old.after) and new.values_enc is not distinct from old.values_enc then
    new.values_enc := null;
  end if;
  return new;
end
$$;
create trigger order_changes_cipher_sync before update of before, after, values_enc on order_changes for each row execute function order_changes_cipher_sync();

create function webhook_deliveries_cipher_sync() returns trigger
  language plpgsql
  as $$
begin
  if new.event_data is distinct from old.event_data and new.event_data_enc is not distinct from old.event_data_enc then
    new.event_data_enc := null;
  end if;
  return new;
end
$$;
create trigger webhook_deliveries_cipher_sync before update of event_data, event_data_enc on webhook_deliveries for each row execute function webhook_deliveries_cipher_sync();

create function notifications_cipher_sync() returns trigger
  language plpgsql
  as $$
begin
  if new.recipient is distinct from old.recipient and new.recipient_enc is not distinct from old.recipient_enc then
    new.recipient_enc := null;
  end if;
  return new;
end
$$;
create trigger notifications_cipher_sync before update of recipient, recipient_enc on notifications for each row execute function notifications_cipher_sync();

-- 新列和乘客列一样，供应商改不了
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at,
                   passenger_anonymized_at, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx
  on orders
  for each statement execute function reject_tenant_column_update();
