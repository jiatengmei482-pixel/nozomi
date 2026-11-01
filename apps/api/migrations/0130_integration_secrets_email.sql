-- 运营后台填写邮件发送（M4-14，ADR 0048；0121–0129 留给别的任务）：integration_secrets 多一项 email（通用 SMTP，七项整组加密放在 sealed，hints 只有密码打码后的样子）。
-- 只放宽 integration 的取值，结构不变。不含任何数据。
alter table integration_secrets drop constraint integration_secrets_integration_check;
alter table integration_secrets add constraint integration_secrets_integration_check check (integration in ('google_maps', 'stripe', 'email'));
