-- 运营后台填写的第三方密钥（M4-09，ADR 0041；0052–0079 留给别的任务）：谷歌地图、Stripe 各一行。
-- sealed 是 AES-256-GCM 密文（SecretBox，用途 integration-secret，附加数据是这一行的 integration，搬到别的行解不开），库里没有原文；
-- hints 是每一项打码后的样子（`••••` + 末 4 位），页面和审计显示用，不用解密；version 每次填写 / 更换加一。
-- 清空 = 删掉这一行（回落到服务器配置文件）。平台表：平台读、写、删，租户角色没有任何权限。不含任何数据。
create table integration_secrets (
  integration text primary key,
  sealed text not null,
  hints jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null,
  updated_by uuid not null references platform_users (id),
  constraint integration_secrets_integration_check check (integration in ('google_maps', 'stripe')),
  constraint integration_secrets_sealed_format check (sealed ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  constraint integration_secrets_hints_object check (jsonb_typeof(hints) = 'object'),
  constraint integration_secrets_version_positive check (version > 0)
);

grant select, insert, update, delete on integration_secrets to nozomi_platform;
