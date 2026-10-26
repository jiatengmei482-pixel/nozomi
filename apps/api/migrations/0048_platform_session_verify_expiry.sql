-- 平台会话触发器补一条（M4-05，ADR 0030「登录的先后顺序」，纵深防御）：已经过期的待验证会话不能被「验证」复活成正常会话。
-- 0040 的触发器只看「待验证 → 已验证一次」和「不超过建会话起 8 小时」；应用代码的 update 本来带着 `expires_at > 现在`，
-- 这里让数据库也拒绝：验证的时间（mfa_verified_at）必须落在这个待验证会话的有效期里（建会话之后、过期之前）。
-- 和记下的验证时间比、不和数据库的 now() 比：会话的建立、过期、验证时间都由服务进程的时钟写入（ADR 0008），
-- 数据库和服务进程的时钟有几秒偏差时用 now() 会误拒刚好在过期前完成的验证（集成测试的时钟也是固定在过去的）。
-- 局限：应用代码把验证时间写成过去的某一刻仍能骗过这一条（见 ADR 0030「已知限制」）。不改任何数据。
create or replace function platform_sessions_verify_only() returns trigger
  language plpgsql as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.created_at <> old.created_at then
    raise exception '会话的编号、账号、建立时间不能改' using errcode = 'P0001';
  end if;
  if old.mfa_verified_at is not null or new.mfa_verified_at is null then
    raise exception '会话只能从「待验证」改成「已完成两步验证」一次' using errcode = 'P0001';
  end if;
  if new.mfa_verified_at < old.created_at or new.mfa_verified_at >= old.expires_at then
    raise exception '待验证的会话已经过期（或验证时间不在它的有效期里），不能再完成两步验证' using errcode = 'P0001';
  end if;
  if new.expires_at > old.created_at + interval '8 hours' then
    raise exception '会话最长 8 小时' using errcode = 'P0001';
  end if;
  return new;
end
$$;
