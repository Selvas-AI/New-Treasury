-- 자금일보 ↔ 외화 원장 자동 반영 대상 "무시" 처리
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경: 원장 개시 로트(source_type='opening')는 개시일(예: 2026-08-11) 기준으로 그 이전
-- 모든 이력을 이미 흡수한 잔고다. 그런데 자금일보 미반영 증감 조회(useFxLedgerReconciliation)
-- 는 daily 테이블 전 기간을 훑어 개시일 이전 날짜의 잔액 증감까지 "미반영"으로 잘못 표시한다.
-- 조회 시작일 필터로 대부분 걸러지지만, 경계 근처 날짜는 사용자가 직접 판단해서 목록에서
-- 빼야 할 수 있다 — 그 "빼기"를 이 테이블이 기록한다. fx_lots/fx_lot_consumptions 는
-- 전혀 건드리지 않는다(실제로 원장에 반영하는 게 아니라 "이 날짜는 이미 개시 잔고에
-- 포함돼 있으니 목록에서 그만 보여달라"는 표시일 뿐).

create table if not exists public.fx_ledger_reconcile_ignored (
  id uuid primary key,
  company text not null,
  currency text not null,
  daily_id uuid not null,
  direction text not null check (direction in ('in','out')),
  amount numeric not null,
  reason text,
  ignored_by text,
  ignored_at timestamptz not null default now(),
  unique (company, currency, daily_id)
);

alter table public.fx_ledger_reconcile_ignored enable row level security;

drop policy if exists fx_ledger_reconcile_ignored_select on public.fx_ledger_reconcile_ignored;
create policy fx_ledger_reconcile_ignored_select on public.fx_ledger_reconcile_ignored for select to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (coalesce(array_length(u.companies,1),0)=0 or fx_ledger_reconcile_ignored.company=any(u.companies)))
);
drop policy if exists fx_ledger_reconcile_ignored_insert on public.fx_ledger_reconcile_ignored;
create policy fx_ledger_reconcile_ignored_insert on public.fx_ledger_reconcile_ignored for insert to authenticated with check (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or fx_ledger_reconcile_ignored.company=any(u.companies)))
);
drop policy if exists fx_ledger_reconcile_ignored_delete on public.fx_ledger_reconcile_ignored;
create policy fx_ledger_reconcile_ignored_delete on public.fx_ledger_reconcile_ignored for delete to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or fx_ledger_reconcile_ignored.company=any(u.companies)))
);
