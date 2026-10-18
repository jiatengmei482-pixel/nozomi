-- M2-04（测试发现的缺陷）：宽限期内连续轮换，每一代旧密钥都各自从被轮换掉的时刻起保留 24 小时（ADR 0023「API 客户端与访问令牌」）。
-- 原来只有一组 previous_secret_hash / previous_valid_until，再轮换一次就把还在宽限期里的那一把顶掉了。
-- 改为一个数组：[{ "generation": 代次, "hash": SHA-256, "valid_until": 时刻 }]，最多保留 5 代（业务层裁剪），过期的在下一次轮换时清掉。
-- 只有密钥的哈希，没有原文。

alter table channel_api_clients add column retired_secrets jsonb not null default '[]'::jsonb;

update channel_api_clients
   set retired_secrets = jsonb_build_array(jsonb_build_object('generation', secret_generation - 1, 'hash', previous_secret_hash, 'valid_until', to_jsonb(previous_valid_until)))
 where previous_secret_hash is not null;

alter table channel_api_clients drop constraint channel_api_clients_previous;
alter table channel_api_clients drop column previous_secret_hash;
alter table channel_api_clients drop column previous_valid_until;
alter table channel_api_clients add constraint channel_api_clients_retired_secrets check (jsonb_typeof(retired_secrets) = 'array' and jsonb_array_length(retired_secrets) <= 5);
