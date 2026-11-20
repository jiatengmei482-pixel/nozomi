-- 运营后台填写 Claude 密钥（M9T-31，ADR 0104 第六节，AI 行程解析）：integration_secrets 多一项 anthropic（一个字段 api_key，加密放在 sealed，hints 只有打码后的样子）。
-- 只放宽 integration 的取值，结构不变。不含任何数据。
alter table integration_secrets drop constraint integration_secrets_integration_check;
alter table integration_secrets add constraint integration_secrets_integration_check check (integration in ('google_maps', 'stripe', 'email', 'anthropic'));
