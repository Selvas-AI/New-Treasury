-- 외화 FIFO 원장 계좌 유형/정기예금 만기 잠금 추가
-- 사용자가 Supabase SQL Editor에서 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
alter table public.fx_lots add column if not exists account_type text not null default 'demand_deposit';
alter table public.fx_lots add column if not exists annual_interest_rate numeric not null default 0;
alter table public.fx_lots add column if not exists maturity_date date;

alter table public.fx_lots drop constraint if exists fx_lots_account_type_check;
alter table public.fx_lots add constraint fx_lots_account_type_check
  check (account_type in ('demand_deposit','term_deposit'));
alter table public.fx_lots drop constraint if exists fx_lots_annual_interest_rate_check;
alter table public.fx_lots add constraint fx_lots_annual_interest_rate_check check (annual_interest_rate>=0);
alter table public.fx_lots drop constraint if exists fx_lots_term_maturity_check;
alter table public.fx_lots add constraint fx_lots_term_maturity_check
  check (account_type='demand_deposit' or (maturity_date is not null and maturity_date>=acquired_date));

-- 아래 두 파일의 최신 함수도 이어서 실행해야 한다.
-- 1) docs/db/fx_ledger_edit_rpc.sql
-- 2) docs/db/fx_fifo_trade_rpc.sql
-- complete_fx_trade_with_fifo는 거래일 현재 만기가 도래한 정기예금만 FIFO 후보로 선택한다.
