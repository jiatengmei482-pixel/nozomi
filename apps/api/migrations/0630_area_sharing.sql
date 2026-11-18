-- 区域分类（ADR 0102，业主 2026-11-18）：平台共享（「·通用」，多家供应商可用）/ 供应商独立。只加列，不含任何数据。
-- 重叠检查只在同一分类里算；两类重叠时报价按「供应商独立优先」。已有区域都按供应商独立（默认值），共享的由清理脚本或平台运营标出。
alter table areas add column sharing text not null default 'own';
alter table areas add constraint areas_sharing_check check (sharing in ('shared', 'own'));
