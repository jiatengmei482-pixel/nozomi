-- 取消、改单、事后加收的钱再加几道数据库把关（M3-03 测试发现的缺陷，ADR 0029「补充：钱的口径与审核时机」）。不含任何数据。

-- ---- 退款：失败的那一笔被取消时的退款包含进去了（作废），不能再重试 ----

-- 取消时「实际付了的」不扣失败的退款（ADR 0029）：取消的那一笔退款已经把它包含进去，这一笔就作废，记下时间。只有失败的能作废
alter table order_refunds
  add column superseded_at timestamptz,
  add constraint order_refunds_superseded check (superseded_at is null or status = 'failed');

-- ---- 事后加收：异议期固定 48 小时（@nozomi/domain 的 EXTRA_CHARGE_RULES.disputeHours）、转人工要有原因、异议期内不批准也不撤回 ----

alter table order_extra_charges
  add constraint order_extra_charges_window_length check (dispute_until = submitted_at + interval '48 hours'),
  -- 待审核、有异议的必须写明为什么转人工；有异议的原因里一定有 DISPUTED，且记了异议时间
  add constraint order_extra_charges_review_reason check (
    (status not in ('review', 'disputed') or cardinality(review_reasons) > 0)
    and (status <> 'disputed' or (disputed_at is not null and 'DISPUTED' = any (review_reasons)))
  ),
  -- 平台批准（记了通过的金额）只能在异议期结束之后（ADR：异议期内平台也不能先批准）
  add constraint order_extra_charges_approve_after_window check (approved_minor is null or (decided_at is not null and decided_at >= dispute_until)),
  -- 供应商只能撤回异议期内的（截止那一刻起不行）
  add constraint order_extra_charges_withdraw_in_window check (withdrawn_at is null or withdrawn_at < dispute_until);
