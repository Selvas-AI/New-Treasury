-- 외화매매거래 부분 체결(Partial Fill) 지원
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경: 매각 지시(fx_trade_history 1행)는 지금 "전액 한 번에 체결"만 가능하다. 실무에서는
-- 지시가 하달된 뒤 최대 3영업일에 걸쳐 여러 번 나눠 체결될 수 있다. 이 마이그레이션은
-- 체결(fill) 단위 레이어를 하나 끼워 넣어, 체결마다 체결일·수량·체결환율과 그 체결이
-- 소진한 FIFO 로트(장부환율 포함)까지 남긴다.
--
-- 기존 docs/db/fx_fifo_trade_rpc.sql 의 complete_fx_trade_with_fifo/reverse_completed_fx_trade
-- 는 건드리지 않고 그대로 둔다(더 이상 앱 코드가 호출하지 않지만, additive-migration 관례상
-- 삭제하지 않는다).

-- ── 1. 체결(fill) 단위 이력 테이블 ──────────────────────────────────────────
-- daily_report_items/cashflow_plan_items 와 동일한 "부모 1건 : 자식 다건" 패턴.
create table if not exists public.fx_trade_fills (
  id uuid primary key,
  trade_id uuid not null references public.fx_trade_history(id) on delete cascade,
  company text not null,
  currency text not null,
  fill_date date not null,
  amount_fx numeric not null check (amount_fx > 0),
  completed_rate numeric not null check (completed_rate > 0),
  realized_pnl numeric not null default 0,
  completed_by text,
  created_at timestamptz not null default now()
);
create index if not exists fx_trade_fills_trade_idx on public.fx_trade_fills(trade_id);

alter table public.fx_trade_fills enable row level security;
drop policy if exists fx_trade_fills_select_authenticated on public.fx_trade_fills;
create policy fx_trade_fills_select_authenticated on public.fx_trade_fills for select to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (coalesce(array_length(u.companies,1),0)=0 or fx_trade_fills.company=any(u.companies)))
);
-- insert/delete 는 RPC(security definer)로만 수행 — 직접 쓰기 정책은 부여하지 않는다
-- (fx_lots 의 fx_lots_insert_authenticated 는 있지만 fx_lot_consumptions 는 RPC 전용인 것과 동일 원칙).

-- ── 2. 소진 이력을 체결 단위로 구분 ──────────────────────────────────────────
-- source_type/source_id 는 기존처럼 'fx_trade_history'/거래 id 를 유지한다
-- (거래 전체 취소 시 "이 거래의 모든 소진분"을 한 번에 조회하는 기존 쿼리와 호환하기 위함).
-- fill_id 는 그중 "어느 체결 건에 속하는 소진인지"를 추가로 구분한다.
alter table public.fx_lot_consumptions add column if not exists fill_id uuid references public.fx_trade_fills(id);

-- ── 3. 지시 전체 대비 누적 체결 수량 ─────────────────────────────────────────
-- 잔여 계산(amount_fx - filled_amount)과 상태 전이(부분체결/완료 판정)에 쓴다.
-- 기존에 이미 '완료' 상태인 행은 filled_amount=0 으로 남지만, '완료' 행에는 새 체결을
-- 등록할 수 없으므로(RPC 가 상태를 검증) 무해하다 — 별도 백필 불필요.
alter table public.fx_trade_history add column if not exists filled_amount numeric not null default 0;

-- ── 4. 체결 등록 RPC ────────────────────────────────────────────────────────
create or replace function public.complete_fx_trade_fill(
  p_trade_id uuid, p_fill_amount numeric, p_completed_rate numeric,
  p_fill_date date, p_completed_by text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trade fx_trade_history%rowtype; v_lot fx_lots%rowtype; v_fill_id uuid;
  v_need numeric; v_take numeric; v_fill_pnl numeric := 0;
  v_new_filled numeric; v_new_rate numeric; v_new_pnl numeric; v_new_status text;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_approve=true)) then
    raise exception '체결 등록 권한이 없습니다';
  end if;
  if p_completed_rate <= 0 then raise exception '체결환율은 0보다 커야 합니다'; end if;
  if p_fill_amount <= 0 then raise exception '체결 수량은 0보다 커야 합니다'; end if;

  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found then raise exception '매각 지시를 찾을 수 없습니다'; end if;
  if v_trade.direction <> 'sell' then raise exception '매도 거래만 체결 등록할 수 있습니다'; end if;
  if v_trade.status not in ('발의','승인','부분체결') then
    raise exception '발의/승인/부분체결 상태만 체결 등록할 수 있습니다 (현재: %)', v_trade.status;
  end if;
  if p_fill_amount > v_trade.amount_fx - v_trade.filled_amount + 0.000001 then
    raise exception '체결 수량(%)이 잔여 수량(%)을 초과합니다', p_fill_amount, v_trade.amount_fx - v_trade.filled_amount;
  end if;

  v_fill_id := gen_random_uuid();
  insert into fx_trade_fills(id,trade_id,company,currency,fill_date,amount_fx,completed_rate,completed_by)
  values(v_fill_id,v_trade.id,v_trade.company,v_trade.currency,p_fill_date,p_fill_amount,p_completed_rate,p_completed_by);

  v_need := p_fill_amount;
  for v_lot in select * from fx_lots
    where company=v_trade.company and currency=v_trade.currency and remaining_amount>0
      and (account_type <> 'term_deposit' or maturity_date <= p_fill_date)
    order by acquired_date, created_at, id for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,fill_id,memo,created_by)
    values(gen_random_uuid(),v_trade.company,v_trade.currency,v_lot.id,p_fill_date,v_take,
      v_lot.acq_rate,p_completed_rate,(p_completed_rate-v_lot.acq_rate)*v_take,'FIFO',
      'fx_trade_history',v_trade.id,v_fill_id,'외화매매거래 부분 체결 FIFO 소진',p_completed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_fill_pnl := v_fill_pnl+(p_completed_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then raise exception 'FIFO 잔액 부족: %', v_need; end if;

  update fx_trade_fills set realized_pnl=round(v_fill_pnl) where id=v_fill_id;

  v_new_filled := v_trade.filled_amount + p_fill_amount;
  v_new_rate := (coalesce(v_trade.completed_rate,0)*v_trade.filled_amount + p_completed_rate*p_fill_amount) / v_new_filled;
  v_new_pnl := coalesce(v_trade.completed_pnl,0) + round(v_fill_pnl);
  v_new_status := case when v_new_filled >= v_trade.amount_fx - 0.000001 then '완료' else '부분체결' end;

  update fx_trade_history set filled_amount=v_new_filled, completed_rate=v_new_rate,
    completed_pnl=v_new_pnl, status=v_new_status, completed_at=now(), completed_by=p_completed_by
  where id=p_trade_id;

  return jsonb_build_object('fill_id',v_fill_id,'status',v_new_status,
    'filled_amount',v_new_filled,'remaining',v_trade.amount_fx-v_new_filled,'fill_pnl',round(v_fill_pnl));
end $$;

-- ── 5. 전체 취소(원복) RPC ───────────────────────────────────────────────────
-- 개별 체결 1건만 되돌리는 기능은 V1 범위 밖 — 지시 전체를 원복한다.
create or replace function public.reverse_fx_trade(p_trade_id uuid, p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_trade fx_trade_history%rowtype; v_row fx_lot_consumptions%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_approve=true)) then
    raise exception '거래 원복 권한이 없습니다';
  end if;
  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found or v_trade.status not in ('완료','부분체결') then
    raise exception '완료 또는 부분체결 상태만 원복할 수 있습니다';
  end if;
  for v_row in select * from fx_lot_consumptions
    where source_type='fx_trade_history' and source_id=p_trade_id for update
  loop update fx_lots set remaining_amount=remaining_amount+v_row.amount where id=v_row.lot_id; end loop;
  delete from fx_lot_consumptions where source_type='fx_trade_history' and source_id=p_trade_id;
  delete from fx_trade_fills where trade_id=p_trade_id;
  update fx_trade_history set filled_amount=0,status='취소',completed_rate=null,completed_pnl=null,
    completed_at=null,completed_by=null,memo=concat(coalesce(memo,''),' · 전체 원복: ',p_reversed_by)
  where id=p_trade_id;
  return jsonb_build_object('trade_id',p_trade_id,'reversed',true);
end $$;

revoke all on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) from public, anon;
revoke all on function public.reverse_fx_trade(uuid,text) from public, anon;
grant execute on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) to authenticated;
grant execute on function public.reverse_fx_trade(uuid,text) to authenticated;
