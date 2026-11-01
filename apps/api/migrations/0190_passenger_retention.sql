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

-- 已脱敏的单不能把乘客改回去，也不能清标记（脱敏不可逆，平台角色对 orders 本来就有 update）
create function reject_anonymized_passenger_change() returns trigger
  language plpgsql
  as $$
begin
  -- 只管应用用的权限角色（和 reject_tenant_column_update 一样按 current_user）：迁移账号是表的所有者，不走这条路
  if current_user not in ('nozomi_platform', 'nozomi_app') then
    return new;
  end if;
  if old.passenger_anonymized_at is not null and (new.passenger_anonymized_at is distinct from old.passenger_anonymized_at or new.passenger is distinct from old.passenger) then
    raise exception '已脱敏的订单不能改乘客信息和脱敏标记' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger orders_anonymized_locked before update of passenger, passenger_anonymized_at on orders for each row execute function reject_anonymized_passenger_change();

-- 联系记录、工单对话、内部备注、状态流水、客人评价原先只追加。脱敏要清掉手写内容里的联系方式：平台角色可以 update，但触发器只放行手写的那一列（触发器的参数），而且只有这张单已经标了脱敏才行，业务代码误改会被拒绝
-- （项目不用列级授权，限制列都用触发器，和 reject_tenant_column_update 一样）
create function reject_text_update_before_anonymized() returns trigger
  language plpgsql
  as $$
declare
  anonymized boolean;
  text_column constant text := tg_argv[0];
begin
  -- 只管应用用的权限角色（和 reject_tenant_column_update 一样按 current_user）：迁移账号是表的所有者，不走这条路
  if current_user not in ('nozomi_platform', 'nozomi_app') then
    return new;
  end if;
  if (to_jsonb(new) - text_column) is distinct from (to_jsonb(old) - text_column) then
    raise exception '% 只能改手写内容这一列', tg_table_name using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name in ('ticket_messages', 'ticket_notes') then
    select bool_or(o.passenger_anonymized_at is not null) into anonymized from tickets t join orders o on o.id = t.order_id where t.id = (to_jsonb(new) ->> 'ticket_id')::uuid;
  else
    select bool_or(o.passenger_anonymized_at is not null) into anonymized from orders o where o.id = (to_jsonb(new) ->> 'order_id')::uuid;
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
grant update on order_events to nozomi_platform;
grant update on order_reviews to nozomi_platform;

create trigger order_contacts_anonymize_only before update on order_contacts for each row execute function reject_text_update_before_anonymized('note');
create trigger ticket_messages_anonymize_only before update on ticket_messages for each row execute function reject_text_update_before_anonymized('body');
create trigger ticket_notes_anonymize_only before update on ticket_notes for each row execute function reject_text_update_before_anonymized('body');
create trigger order_events_anonymize_only before update on order_events for each row execute function reject_text_update_before_anonymized('detail');
create trigger order_reviews_anonymize_only before update on order_reviews for each row execute function reject_text_update_before_anonymized('comment');

-- 复核的备注和内容：发起后不能改（决定时写 decision_note 除外），只有对应的订单已脱敏才能清理
create function reject_approval_text_update() returns trigger
  language plpgsql
  as $$
declare
  anonymized boolean;
begin
  -- 只管应用用的权限角色（和 reject_tenant_column_update 一样按 current_user）：迁移账号是表的所有者，不走这条路
  if current_user not in ('nozomi_platform', 'nozomi_app') then
    return new;
  end if;
  if new.payload is not distinct from old.payload and new.before is not distinct from old.before and new.request_note is not distinct from old.request_note
     and (old.status = 'pending' or new.decision_note is not distinct from old.decision_note) then
    return new;
  end if;
  select bool_or(o.passenger_anonymized_at is not null) into anonymized from orders o
   where old.resource in ('order', 'ticket', 'rescue')
     and o.id = case old.resource
       when 'order' then old.resource_id::uuid
       when 'ticket' then (select t.order_id from tickets t where t.id = old.resource_id::uuid limit 1)
       else (select r.order_id from order_rescues r where r.id = old.resource_id::uuid limit 1) end;
  if anonymized is not true then
    raise exception '复核的内容发起后不能改：只有已脱敏的订单才能清除手写内容' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
create trigger approvals_text_anonymize_only before update on approvals for each row execute function reject_approval_text_update();
