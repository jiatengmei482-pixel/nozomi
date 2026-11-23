-- 官网、嵌入页三份法律文案的待补项（M9E-24，ADR 0107）。全站一行（同 site_settings 的单行写法），只建表、不含任何数据。
-- 正文是业主确认的日文稿（docs/legal/），写在前端页面里；这里只存稿子里【 】的那几项（销售主体、日本联系方式、联系邮箱、
-- 邮件 / 地图底图 / 服务器服务商及所在国、公开日），键由 packages/domain/src/legal-pages.ts 的 LEGAL_FIELD_KEYS 定，值是文字或 null。
-- 都是要公开在网页上的公司信息，不是个人信息，明文存。超级管理员在运营后台改，带版本号，留审计。
create table site_legal_settings (
  id boolean primary key default true,
  fields jsonb not null,
  version integer not null,
  updated_at timestamptz not null,
  updated_by uuid not null references platform_users (id),
  constraint site_legal_settings_singleton check (id),
  constraint site_legal_settings_fields_check check (jsonb_typeof(fields) = 'object'),
  constraint site_legal_settings_version_check check (version >= 1)
);

grant select, insert, update on site_legal_settings to nozomi_platform;
