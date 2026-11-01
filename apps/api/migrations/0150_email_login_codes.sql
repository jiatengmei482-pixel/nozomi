-- 邮箱验证码登录（M4-06，ADR 0050；0131–0149 留给别的任务）：一个邮箱一行，发新码就是覆盖这一行，所以旧码自动作废。
-- 表里没有邮箱原文、没有账号编号：email_key、code_hash 都是 HMAC，密钥不在库里。不存在的邮箱同样有一行（code_hash 是随机值），校验路径和真实账号一样。
-- 登录前就要读写，所以和 login_throttles 一样只授权给 nozomi_preauth。不含任何数据。
create table email_login_codes (
  email_key text primary key,
  code_hash text not null,
  attempt_count integer not null default 0,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  constraint email_login_codes_attempts check (attempt_count between 0 and 5),
  constraint email_login_codes_email_key_hex check (email_key ~ '^[0-9a-f]{64}$'),
  constraint email_login_codes_code_hash_hex check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint email_login_codes_expiry check (expires_at > created_at)
);

create index email_login_codes_expires_idx on email_login_codes (expires_at);

grant select, insert, update, delete on email_login_codes to nozomi_preauth;
