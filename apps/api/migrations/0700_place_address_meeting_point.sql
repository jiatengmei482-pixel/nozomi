-- 机场 / 航站楼的固定地址和集合地点说明（M12-06，业主 2026-11-25：每个机场预先填好固定地址、每个航站楼的集合地点说明）。
-- 只改结构，不含任何数据。编号：main 上最大是 0690（M9E-24），这里用 0700。
--
-- 1. places.address：原来只有地标（poi）能填（迁移 0007 的 places_address_only_for_poi），现在机场、航站楼也能填；
--    填了就不能只有空白。车站、出口仍然不能填。长度上限（300 字）在应用里校验（@nozomi/domain placeAddressIssue）。
-- 2. places.meeting_point：集合地点说明，多语言文字 {"zh": …, "ja": …, "en": …}，只有机场、航站楼能填（可空）。
--    至少一种语言；每种语言是去掉首尾空白后不为空的文字，最多 1000 字；不认识的语言键不收。
--    单航站楼的机场挂在机场上，多航站楼的机场挂在各航站楼上（这是录入约定，数据库不强制）。
-- 3. places.content_sources：地址、集合地点是哪次导入填的（航站楼核对表导入，ADR 0024 补充 M12-06b），
--    {"address": {"source", "ref", "value"}, "meeting_point": {...}}。用法和 name_sources（迁移 0022）相同：
--    以前导入填过、现在空了 → 平台在后台删掉了，再导入不补回去；现在的值和导入写的不一样 → 平台改过，不覆盖。
--    只在数据库和审计日志里，不出现在接口的应答里。
-- 授权不变（places 已授权给 nozomi_platform 读、增、改，nozomi_app 只读，迁移 0007）。

alter table places drop constraint places_address_only_for_poi;
alter table places add constraint places_address_by_type check (
  address is null or (type in ('poi', 'airport', 'terminal') and length(btrim(address)) > 0)
);

alter table places add column meeting_point jsonb;
alter table places add constraint places_meeting_point_check check (
  meeting_point is null or (
    type in ('airport', 'terminal')
    and jsonb_typeof(meeting_point) = 'object'
    and meeting_point <> '{}'::jsonb
    and meeting_point - array['zh', 'ja', 'en'] = '{}'::jsonb
    and (not meeting_point ? 'zh' or (jsonb_typeof(meeting_point -> 'zh') = 'string' and length(btrim(meeting_point ->> 'zh')) > 0 and char_length(meeting_point ->> 'zh') <= 1000))
    and (not meeting_point ? 'ja' or (jsonb_typeof(meeting_point -> 'ja') = 'string' and length(btrim(meeting_point ->> 'ja')) > 0 and char_length(meeting_point ->> 'ja') <= 1000))
    and (not meeting_point ? 'en' or (jsonb_typeof(meeting_point -> 'en') = 'string' and length(btrim(meeting_point ->> 'en')) > 0 and char_length(meeting_point ->> 'en') <= 1000))
  )
);

alter table places add column content_sources jsonb not null default '{}'::jsonb;
alter table places add constraint places_content_sources_is_object check (
  jsonb_typeof(content_sources) = 'object' and content_sources - array['address', 'meeting_point'] = '{}'::jsonb
);
