-- 法律页面设置（M9E-24，ADR 0107）：特定商取引法表記、キャンセルポリシー、プライバシーポリシー三页里业主定稿留空（【 】）的几项，
-- 平台运营在后台「官网设置」里填。全站一份（只有一行，第一次保存时写入；不预置）。只加表，不含任何数据，不改已有表。
-- 没填为 null：页面显示「未設定」，/health 的 legal_pages 为 incomplete。
create table legal_page_settings (
  id boolean primary key default true,
  -- 販売事業者名（特定商取引法表記、プライバシーポリシー开头共用）
  seller text,
  -- 日本国内の連絡先（住所・電話番号，或「請求があった場合は遅滞なく開示します」）
  japan_contact text,
  -- 联系邮箱（特定商取引法表記、プライバシーポリシー「開示・訂正・削除」共用）
  email text,
  -- プライバシーポリシー第 4 条外部服务表里的三家：名称和所在国
  mail_provider text,
  mail_provider_country text,
  map_provider text,
  map_provider_country text,
  server_provider text,
  server_provider_country text,
  -- プライバシーポリシーの制定日
  published_on date,
  version integer not null,
  updated_at timestamptz not null,
  updated_by uuid not null references platform_users (id),
  constraint legal_page_settings_singleton check (id),
  constraint legal_page_settings_seller_check check (seller is null or char_length(seller) between 1 and 200),
  constraint legal_page_settings_japan_contact_check check (japan_contact is null or char_length(japan_contact) between 1 and 300),
  constraint legal_page_settings_email_check check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint legal_page_settings_provider_check check (
    (mail_provider is null or char_length(mail_provider) between 1 and 100)
    and (map_provider is null or char_length(map_provider) between 1 and 100)
    and (server_provider is null or char_length(server_provider) between 1 and 100)
    and (mail_provider_country is null or char_length(mail_provider_country) between 1 and 40)
    and (map_provider_country is null or char_length(map_provider_country) between 1 and 40)
    and (server_provider_country is null or char_length(server_provider_country) between 1 and 40)
  )
);

grant select, insert, update on legal_page_settings to nozomi_platform;
