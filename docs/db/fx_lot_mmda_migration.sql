-- 외화 FIFO 원장 — 계좌 유형에 MMDA 추가 + 만기 제약 수정
-- 사용자가 Supabase SQL Editor에서 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경 (2026-08-12 발견)
--   실제 개시재고 CSV(docs/기획/fx-inventory_tmp.csv)에는 계좌 유형이 3종이다.
--     demand_deposit 14건 / mmda 6건(USD 5,347,168.58) / term_deposit 2건(USD 6,000,000)
--   그런데 기존 스키마는 2종만 허용해 mmda 를 저장할 수 없었다.
--
-- MMDA(Money Market Deposit Account) 취급 원칙
--   · 수시입출식이므로 **환전 가능성은 보통예금과 동일**하다 → FIFO 후보에 즉시 포함
--   · 다만 이자율이 붙는다(실데이터 3%) → annual_interest_rate 를 보존한다
--   · 만기 개념이 없다 → maturity_date 는 null

alter table public.fx_lots drop constraint if exists fx_lots_account_type_check;
alter table public.fx_lots add constraint fx_lots_account_type_check
  check (account_type in ('demand_deposit','term_deposit','mmda'));

-- ⚠ 기존 제약은 `account_type='demand_deposit' or (maturity_date is not null ...)` 였다.
--   이대로면 **mmda 에도 만기일을 강제**해 저장이 불가능하다.
--   만기가 필요한 것은 term_deposit 뿐이므로 조건을 뒤집어 명시한다.
alter table public.fx_lots drop constraint if exists fx_lots_term_maturity_check;
alter table public.fx_lots add constraint fx_lots_term_maturity_check
  check (
    account_type <> 'term_deposit'
    or (maturity_date is not null and maturity_date >= acquired_date)
  );

-- 확인용 (실행 후)
-- select account_type, count(*), sum(original_amount)
--   from public.fx_lots group by account_type order by account_type;
