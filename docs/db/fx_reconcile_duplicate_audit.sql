-- ============================================================
-- fx_reconcile_duplicate_audit.sql  (2026-11-25 · FX 전수조사 묶음 D · F-03)
-- ▶ 읽기 전용 점검입니다. 아무것도 바꾸지 않습니다.
--
-- 배경
--   "자금일보 미반영 증감" 패널이 운전자금 잔액(daily.fx_*)을 원장 **전체**(정기예금 포함)와
--   비교해, 정기예금 만기·예치를 가짜 미반영으로 띄웠다. 그때 "반영"을 눌렀다면
--     · 만기(정기예금 → 보통예금) : 같은 외화가 **유입 로트로 한 번 더** 생겼다(재고 과대)
--     · 예치(보통예금 → 정기예금) : 로트가 **실제로 소진**됐다(재고 과소)
--   코드는 고쳤지만(이제 운전 계좌유형 순증감만 비교) 과거에 눌러 생긴 기록은 남아 있다.
--
-- 이 쿼리는 "정기예금 대체가 있었던 날과 같은 거래일에 자금일보 반영(daily_report_item)이 있는 건"을
-- 찾는다. **의심 목록**일 뿐 확정이 아니다 — 같은 날 실제 입출금이 따로 있었을 수 있다.
-- 결과가 있으면 담당자에게 보여 주고 판단을 받으세요. 자동으로 고치지 않습니다.
-- ============================================================

select '유입 로트(만기 이중 계상 의심)' as 구분,
       l.company as 법인, l.currency as 통화, l.acquired_date as 거래일,
       l.original_amount as 금액, l.remaining_amount as 잔액, l.id::text as 원장_id,
       string_agg(t.from_account_type || '→' || t.to_account_type || ' ' || t.amount, ', ') as 같은날_대체
  from public.fx_lots l
  join public.fx_lot_transfers t
    on t.company = l.company and t.currency = l.currency and t.transfer_date = l.acquired_date
   and (t.from_account_type = 'term_deposit' or t.to_account_type = 'term_deposit')
 where l.source_type = 'daily_report_item'
 group by l.company, l.currency, l.acquired_date, l.original_amount, l.remaining_amount, l.id
union all
select '유출 소진(예치 이중 소진 의심)',
       c.company, c.currency, c.disposed_date,
       sum(c.amount), null, c.source_id::text,
       string_agg(distinct t.from_account_type || '→' || t.to_account_type || ' ' || t.amount, ', ')
  from public.fx_lot_consumptions c
  join public.fx_lot_transfers t
    on t.company = c.company and t.currency = c.currency and t.transfer_date = c.disposed_date
   and (t.from_account_type = 'term_deposit' or t.to_account_type = 'term_deposit')
 where c.source_type = 'daily_report_item'
 group by c.company, c.currency, c.disposed_date, c.source_id
order by 4 desc;
