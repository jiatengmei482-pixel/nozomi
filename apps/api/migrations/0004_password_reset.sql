-- M0-06：密码重置令牌（ADR 0008「密码找回」）。
-- 管理员给已激活的账号发一次性重置令牌，本人凭它设置新密码。发出令牌不改变现有密码。
-- 和邀请令牌一样：原文只在发出时返回一次，库里只存 SHA-256，有有效期，用过即作废。

alter table platform_users
  add column reset_token_hash text,
  add column reset_expires_at timestamptz,
  add constraint platform_users_reset_complete check ((reset_token_hash is null) = (reset_expires_at is null)),
  -- 只有设过密码的账号才谈得上重置；没激活的账号走重新邀请
  add constraint platform_users_reset_needs_password check (reset_token_hash is null or password_hash is not null);

create unique index platform_users_reset_token_key on platform_users (reset_token_hash)
  where reset_token_hash is not null;

alter table tenant_users
  add column reset_token_hash text,
  add column reset_expires_at timestamptz,
  add constraint tenant_users_reset_complete check ((reset_token_hash is null) = (reset_expires_at is null)),
  add constraint tenant_users_reset_needs_password check (reset_token_hash is null or password_hash is not null);

-- 租户用户的重置令牌里带着租户编号，所以按（租户，令牌哈希）查找，索引以 tenant_id 开头，不需要跨租户查询。
create unique index tenant_users_reset_token_key on tenant_users (tenant_id, reset_token_hash)
  where reset_token_hash is not null;
