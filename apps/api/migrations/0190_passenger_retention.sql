-- 乘客信息的自动脱敏（M4-21，ADR 0055；需求《平台运营端》「个人信息保护」：订单完成 180 天后自动脱敏）。只改结构和权限，不含任何数据，不动已有的行。

-- 这一行什么时候脱敏的；为空 = 还没有。占位文字和判断规则在代码里（@nozomi/domain 的 privacy.ts、repos/passenger-retention.ts）
alter table orders add column passenger_anonymized_at timestamptz;

-- 定时任务跨租户找「可能到期」的单（不以 tenant_id 开头的例外：定时任务不分租户）。用车时间不晚于结束时间，所以先按它筛
create index orders_retention_idx on orders (service_at) where passenger_anonymized_at is null and status in ('completed', 'no_show', 'cancelled', 'rescued');

-- 脱敏标记只有平台能写
drop trigger orders_tenant_columns on orders;
create trigger orders_tenant_columns
  before update of tenant_id, id, order_no, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                   service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                   passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at,
                   confirmed_at, cancelled_at, cancel_reason, created_at, dispatch_due_at, dispatch_overdue_at, departure_overdue_at, guest_landed_at,
                   cancel_policy, cancel_fee_bp, cancel_tenant_share_minor, cancel_note, rescued_at, arrival_overdue_at, driver_missing_reported_at,
                   passenger_anonymized_at
  on orders
  for each statement execute function reject_tenant_column_update();

-- 联系记录、工单对话、内部备注原先只追加。脱敏要清掉手写内容里的联系方式：平台角色可以 update，但触发器只放行手写的那一列，而且只有这张单已经标了脱敏才行，业务代码误改会被拒绝
-- （项目不用列级授权，限制列都用触发器，和 reject_tenant_column_update 一样）
create function reject_text_update_before_anonymized() returns trigger
  language plpgsql
  as $$
declare
  anonymized boolean;
  text_column constant text := case tg_table_name when 'order_contacts' then 'note' else 'body' end;
begin
  if (to_jsonb(new) - text_column) is distinct from (to_jsonb(old) - text_column) then
    raise exception '% 只能改手写内容这一列', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'order_contacts' then
    select bool_or(o.passenger_anonymized_at is not null) into anonymized from orders o where o.id = new.order_id;
  else
    select bool_or(o.passenger_anonymized_at is not null) into anonymized from tickets t join orders o on o.id = t.order_id where t.id = new.ticket_id;
  end if;
  if anonymized is not true then
    raise exception '% 只追加：只有已脱敏的订单才能清除手写内容', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create policy order_contacts_platform_anonymize on order_contacts for update to nozomi_platform using (true) with check (true);
grant update on order_contacts to nozomi_platform;
grant update on ticket_messages to nozomi_platform;
grant update on ticket_notes to nozomi_platform;

create trigger order_contacts_anonymize_only before update on order_contacts for each row execute function reject_text_update_before_anonymized();
create trigger ticket_messages_anonymize_only before update on ticket_messages for each row execute function reject_text_update_before_anonymized();
create trigger ticket_notes_anonymize_only before update on ticket_notes for each row execute function reject_text_update_before_anonymized();
