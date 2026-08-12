-- 외화 FIFO 로트 원장 — Supabase SQL Editor에서 사용자가 직접 실행
-- 애플리케이션/에이전트가 프로덕션 DB에 직접 실행하지 않는다.
create table if not exists public.fx_lots (
  id uuid primary key,
  company text not null,
  currency text not null,
  acquired_date date not null,
  original_amount numeric not null check (original_amount > 0),
  remaining_amount numeric not null check (remaining_amount >= 0 and remaining_amount <= original_amount),
  acq_rate numeric not null check (acq_rate > 0),
  account_type text not null default 'demand_deposit' check (account_type in ('demand_deposit','term_deposit')),
  annual_interest_rate numeric not null default 0 check (annual_interest_rate >= 0),
  maturity_date date,
  source_type text not null check (source_type in ('opening','daily_report_item','manual','adjustment')),
  source_id uuid,
  memo text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (company, currency, source_type, source_id)
  ,check (account_type = 'demand_deposit' or (maturity_date is not null and maturity_date >= acquired_date))
);
create index if not exists fx_lots_fifo_idx on public.fx_lots(company, currency, acquired_date, created_at);

create table if not exists public.fx_lot_consumptions (
  id uuid primary key,
  company text not null,
  currency text not null,
  lot_id uuid not null references public.fx_lots(id),
  disposed_date date not null,
  amount numeric not null check (amount > 0),
  acq_rate numeric not null check (acq_rate > 0),
  disposal_rate numeric not null check (disposal_rate > 0),
  realized_pnl numeric not null,
  method text not null check (method in ('FIFO','WAVG')),
  source_type text,
  source_id uuid,
  memo text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists fx_consumptions_lookup_idx on public.fx_lot_consumptions(company, currency, disposed_date);

alter table public.fx_lots enable row level security;
alter table public.fx_lot_consumptions enable row level security;
-- 실제 역할 정책은 기존 Treasury 테이블 정책과 동일한 방식으로 관리자 검토 후 추가한다.
