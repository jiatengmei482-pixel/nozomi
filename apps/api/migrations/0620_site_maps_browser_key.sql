-- 官网选点地图改用谷歌地图（M10-01 第 2 处，业主 2026-11-18 选 A）：官网设置加浏览器用的谷歌地图密钥。只加列，不含任何数据。
-- 这把密钥只给浏览器加载 Maps JavaScript API，在谷歌后台限定网址和 API，本来就会出现在网页里，不是机密，所以明文存（服务器用的密钥仍在 integration_secrets 加密存）。
-- 没填为空：官网不加载谷歌地图，选点照旧。
alter table site_settings add column maps_browser_key text;
alter table site_settings add constraint site_settings_maps_browser_key_check check (maps_browser_key is null or maps_browser_key ~ '^AIza[0-9A-Za-z_-]{35}$');
