-- ============================================================
-- fx_fifo_integrity_and_scope.sql  (2026-11-25 · FX 전수조사 묶음 B)
-- 근거: docs/기획/FX리짐_전수조사_권고안_2026-11-25.md  F-04 · F-10 · F-22
--
-- ▶ 한 번 실행으로 끝납니다. 마지막에 결과표(OK/확인필요)가 나옵니다.
--   여러 번 실행해도 안전합니다(멱등).
--
-- ── 무엇을 고치나 ───────────────────────────────────────────
-- [F-04] 소급 처분이 "그 날짜에는 아직 없던 로트"를 소진하던 문제
--   체결일·유출일·대체일을 과거로 넣으면 FIFO 가 처분일 **이후에** 들어온 로트까지
--   후보에 넣었다. → 로트마다 "장부에 생긴 날"(available_from)을 두고,
--   처분일 이전에 존재한 로트만 소진한다.
--   ⚠ acquired_date 로 거르면 안 된다. 계좌 대체(carryover) 로트는 FIFO 순서를 지키려고
--     **원본 취득일을 승계**하므로, 대체 전에는 없던 로트가 필터를 통과한다.
--     그래서 대체 로트의 available_from = 대체일(transfer_date) 이다.
--
-- [F-10] 체결·체결취소·전체원복 RPC 에 법인 범위 검사가 없던 문제
--   결재 권한만 있으면 **소속이 아닌 법인**의 지시도 체결·취소할 수 있었다
--   (SECURITY DEFINER 라 RLS 를 우회한다). 계좌 대체 RPC 와 같은 검사를 넣는다.
--   + 지금은 쓰지 않는 구 체결 RPC 2종(complete_fx_trade_with_fifo,
--     reverse_completed_fx_trade)이 같은 검사 없이 호출 가능한 채 남아 있어 실행 권한을 회수한다.
--     (함수는 지우지 않는다 — 되돌릴 수 있게)
--
-- [F-22] completed_at 의미 통일 — "마지막 체결일"(체결 취소 RPC 가 이미 쓰는 규칙)
--
-- ── 수정 기준 (⚠ 다음에 이 함수들을 고칠 때도 이 파일을 기준으로 할 것) ──
--   complete_fx_trade_fill      ← fx_outflow_account_and_reverse.sql (6인자)
--   consume_fx_lots_for_source  ← fx_outflow_account_and_reverse.sql (10인자)
--   transfer_fx_lots            ← fx_term_deposit_investment_link.sql
--   reverse_fx_trade_fill       ← fx_trade_fill_reverse_rpc.sql
--   reverse_fx_trade            ← fx_trade_partial_fill_migration.sql
--   본문은 위 최신본을 그대로 옮기고 **표시한 줄만** 바꿨다(-- ★ 로 표시).
--
-- ⚠ begin/commit 을 쓰지 않는다. SQL Editor 가 여러 문장을 한 요청으로 보내면 Postgres 가
--   하나의 암묵 트랜잭션으로 실행하므로, [0] 선행 조건 검사에서 예외가 나면 아무것도
--   적용되지 않는다.
-- ============================================================


-- ── [0] 선행 조건 검사 — 하나라도 없으면 여기서 멈춘다 ──────────
do $$
declare v_missing text := '';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fx_lots' and column_name='transfer_id') then
    v_missing := v_missing || E'\n  · fx_lots.transfer_id 없음 → docs/db/fx_lot_transfer.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fx_lot_consumptions' and column_name='txn_type') then
    v_missing := v_missing || E'\n  · fx_lot_consumptions.txn_type 없음 → docs/db/fx_txn_type.sql';
  end if;
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='fx_trade_fills') then
    v_missing := v_missing || E'\n  · fx_trade_fills 없음 → docs/db/fx_trade_partial_fill_migration.sql';
  end if;
  if not exists (select 1 from pg_proc where proname='fx_fifo_account_rank') then
    v_missing := v_missing || E'\n  · fx_fifo_account_rank() 없음 → docs/db/fx_fifo_account_priority.sql';
  end if;
  if not exists (select 1 from pg_proc p where p.proname='complete_fx_trade_fill' and p.pronargs=6) then
    v_missing := v_missing || E'\n  · complete_fx_trade_fill 6인자 없음 → docs/db/fx_outflow_account_and_reverse.sql';
  end if;
  if not exists (select 1 from pg_proc p where p.proname='consume_fx_lots_for_source' and p.pronargs=10) then
    v_missing := v_missing || E'\n  · consume_fx_lots_for_source 10인자 없음 → docs/db/fx_outflow_account_and_reverse.sql';
  end if;
  if v_missing <> '' then
    raise exception E'선행 마이그레이션이 적용되지 않아 중단합니다(아무것도 바뀌지 않았습니다):%', v_missing;
  end if;
end $$;


-- ── [1] F-04 · 로트가 장부에 생긴 날 ─────────────────────────
alter table public.fx_lots add column if not exists available_from date;

comment on column public.fx_lots.available_from is
  '이 로트가 장부에 생긴 날 — FIFO 소진은 처분일 이전에 존재한 로트만 대상. '
  '대체 로트는 transfer_date(원본 취득일을 승계하므로 acquired_date 와 다름), 그 외는 acquired_date';

-- backfill: 대체 로트 → 대체일, 나머지 → 취득일
update public.fx_lots l set available_from = t.transfer_date
  from public.fx_lot_transfers t
 where l.transfer_id = t.id and l.available_from is null;
update public.fx_lots set available_from = acquired_date where available_from is null;

alter table public.fx_lots alter column available_from set not null;

-- 생성·수정 경로가 여러 곳(클라이언트 유입 등록·CSV·자금일보 반영·이자 로트·로트 편집 RPC)이라
-- 빠뜨려도 안전하도록 트리거로 기본값을 채운다. 대체 RPC 만은 아래에서 명시적으로 대체일을 넣는다.
create or replace function public.fx_lots_set_available_from()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.available_from := coalesce(new.available_from, new.acquired_date);
  elsif tg_op = 'UPDATE' and new.acquired_date is distinct from old.acquired_date
        and new.transfer_id is null and old.available_from = old.acquired_date then
    -- 대체가 아닌 로트의 취득일을 고치면(로트 편집) 생성일도 따라간다
    new.available_from := new.acquired_date;
  end if;
  return new;
end $$;

drop trigger if exists trg_fx_lots_available_from on public.fx_lots;
create trigger trg_fx_lots_available_from
  before insert or update of acquired_date on public.fx_lots
  for each row execute function public.fx_lots_set_available_from();


-- ── [2] 매각 체결 — F-04 시점 필터 · F-10 법인 범위 · F-22 completed_at ──
create or replace function public.complete_fx_trade_fill(
  p_trade_id uuid, p_fill_amount numeric, p_completed_rate numeric,
  p_fill_date date, p_completed_by text,
  p_account_type text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trade fx_trade_history%rowtype; v_lot fx_lots%rowtype; v_fill_id uuid;
  v_need numeric; v_take numeric; v_fill_pnl numeric := 0;
  v_new_filled numeric; v_new_rate numeric; v_new_pnl numeric; v_new_status text;
  v_last_date date;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if p_completed_rate <= 0 then raise exception '체결환율은 0보다 커야 합니다'; end if;
  if p_fill_amount <= 0 then raise exception '체결 수량은 0보다 커야 합니다'; end if;
  if p_account_type is not null
     and p_account_type not in ('demand_deposit','mmda','term_deposit') then
    raise exception '알 수 없는 계좌유형: %', p_account_type;
  end if;

  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found then raise exception '매각 지시를 찾을 수 없습니다'; end if;

  -- ★ F-10: 지시를 먼저 읽고 **그 법인**에 대한 권한을 본다
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (u.role in ('master','admin') or u.can_approve=true)
    and (coalesce(array_length(u.companies,1),0)=0 or v_trade.company=any(u.companies))) then
    raise exception '이 법인(%)의 체결 등록 권한이 없습니다', v_trade.company;
  end if;

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
      and (p_account_type is null or account_type = p_account_type)
      and (account_type <> 'term_deposit' or maturity_date <= p_fill_date)
      and available_from <= p_fill_date                                   -- ★ F-04
    order by case when p_account_type is null
                  then fx_fifo_account_rank(v_trade.company, account_type) else 0 end,
             acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,fill_id,txn_type,memo,created_by)
    values(gen_random_uuid(),v_trade.company,v_trade.currency,v_lot.id,p_fill_date,v_take,
      v_lot.acq_rate,p_completed_rate,(p_completed_rate-v_lot.acq_rate)*v_take,'FIFO',
      'fx_trade_history',v_trade.id,v_fill_id,'sale',
      case when p_account_type is null then '외화매매거래 부분 체결 FIFO 소진'
           else '외화매매거래 부분 체결 FIFO 소진 · 출금계좌 ' || p_account_type end,
      p_completed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_fill_pnl := v_fill_pnl+(p_completed_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then
    -- ★ F-04: 시점 조건 때문에 부족할 수 있음을 밝힌다
    raise exception 'FIFO 잔액 부족: % (계좌유형 %, 체결일 % 이전에 장부에 있던 로트만 소진합니다)',
      v_need, coalesce(p_account_type,'전체'), p_fill_date;
  end if;

  update fx_trade_fills set realized_pnl=round(v_fill_pnl) where id=v_fill_id;

  v_new_filled := v_trade.filled_amount + p_fill_amount;
  v_new_rate := (coalesce(v_trade.completed_rate,0)*v_trade.filled_amount + p_completed_rate*p_fill_amount) / v_new_filled;
  v_new_pnl := coalesce(v_trade.completed_pnl,0) + round(v_fill_pnl);
  v_new_status := case when v_new_filled >= v_trade.amount_fx - 0.000001 then '완료' else '부분체결' end;

  -- ★ F-22: completed_at = **마지막 체결일**(소급 체결이면 기존 체결보다 이를 수 있다)
  select max(fill_date) into v_last_date from fx_trade_fills where trade_id=v_trade.id;

  update fx_trade_history set filled_amount=v_new_filled, completed_rate=v_new_rate,
    completed_pnl=v_new_pnl, status=v_new_status,
    completed_at=(v_last_date::text||'T00:00:00.000Z')::timestamptz,
    completed_by=p_completed_by
  where id=p_trade_id;

  return jsonb_build_object('fill_id',v_fill_id,'status',v_new_status,
    'filled_amount',v_new_filled,'remaining',v_trade.amount_fx-v_new_filled,'fill_pnl',round(v_fill_pnl));
end $$;

revoke all on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text,text) from public, anon;
grant execute on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text,text) to authenticated;


-- ── [3] 범용 유출(자금일보 반영·수동 유출) — F-04 시점 필터 ─────
create or replace function public.consume_fx_lots_for_source(
  p_company text, p_currency text, p_source_type text, p_source_id uuid,
  p_amount numeric, p_disposal_rate numeric, p_disposed_date date, p_disposed_by text,
  p_txn_type text default 'payment',
  p_account_type text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot fx_lots%rowtype; v_need numeric; v_take numeric; v_pnl numeric := 0; v_txn text;
  v_avail numeric;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '원장 반영 권한이 없습니다';
  end if;
  if p_disposal_rate <= 0 then raise exception '적용 환율은 0보다 커야 합니다'; end if;
  if p_amount <= 0 then raise exception '반영 금액은 0보다 커야 합니다'; end if;
  if p_account_type is not null
     and p_account_type not in ('demand_deposit','mmda','term_deposit') then
    raise exception '알 수 없는 계좌유형: %', p_account_type;
  end if;

  v_txn := coalesce(p_txn_type, 'payment');
  if v_txn not in ('sale','payment','adjustment') then v_txn := 'payment'; end if;

  if p_account_type is not null then
    select coalesce(sum(remaining_amount),0) into v_avail
      from fx_lots
     where company=p_company and currency=p_currency and account_type=p_account_type
       and remaining_amount > 0
       and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date)
       and available_from <= p_disposed_date;                            -- ★ F-04
    if v_avail < p_amount then
      raise exception '% 잔액 부족: 가능 % / 요청 % (계좌유형 지정 소진, % 이전에 장부에 있던 로트 기준)',
        p_account_type, v_avail, p_amount, p_disposed_date;
    end if;
  end if;

  v_need := p_amount;
  for v_lot in select * from fx_lots
    where company=p_company and currency=p_currency and remaining_amount>0
      and (p_account_type is null or account_type = p_account_type)
      and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date)
      and available_from <= p_disposed_date                               -- ★ F-04
    order by case when p_account_type is null
                  then fx_fifo_account_rank(p_company, account_type) else 0 end,
             acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,txn_type,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,v_lot.id,p_disposed_date,v_take,
      v_lot.acq_rate,p_disposal_rate,(p_disposal_rate-v_lot.acq_rate)*v_take,'FIFO',
      p_source_type,p_source_id,v_txn,
      case when p_account_type is null then '원장 유출 FIFO 소진'
           else '원장 유출 FIFO 소진 · 출금계좌 ' || p_account_type end,
      p_disposed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_pnl := v_pnl+(p_disposal_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then
    raise exception 'FIFO 잔액 부족: % (% 이전에 장부에 있던 로트만 소진합니다)', v_need, p_disposed_date;
  end if;
  return jsonb_build_object('source_id',p_source_id,'realized_pnl',round(v_pnl),
    'consumed',p_amount,'txn_type',v_txn,'account_type',p_account_type);
end $$;

revoke all on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text,text) from public, anon;
grant execute on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text,text) to authenticated;


-- ── [4] 계좌 대체 — F-04 시점 필터 + 새 로트의 생성일 = 대체일 ──────
create or replace function public.transfer_fx_lots(
  p_company text, p_currency text, p_transfer_date date,
  p_from_account_type text, p_to_account_type text, p_amount numeric,
  p_maturity_date date default null, p_annual_interest_rate numeric default 0,
  p_transfer_rate numeric default null, p_allow_early boolean default false,
  p_investment_id uuid default null, p_memo text default null, p_by text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_method text; v_transfer_id uuid; v_lot fx_lots%rowtype;
  v_need numeric; v_take numeric; v_pnl numeric := 0; v_new_lots int := 0; v_disposal numeric;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '계좌 대체 권한이 없습니다';
  end if;
  if p_amount <= 0 then raise exception '대체 금액은 0보다 커야 합니다'; end if;
  if p_to_account_type = 'term_deposit' and p_maturity_date is null then
    raise exception '정기예금으로 대체하려면 만기일이 필요합니다';
  end if;
  if p_to_account_type = 'term_deposit' and p_maturity_date < p_transfer_date then
    raise exception '만기일이 대체일보다 빠릅니다';
  end if;

  select coalesce(nullif(trim(coalesce(param_text,'')), ''), 'carryover') into v_method
    from policy_params where company=p_company and param_key='fx_transfer_valuation';
  v_method := coalesce(v_method, 'carryover');
  if v_method not in ('carryover','revalue') then v_method := 'carryover'; end if;
  if v_method = 'revalue' and coalesce(p_transfer_rate,0) <= 0 then
    raise exception '재평가 방식에서는 대체환율이 필요합니다';
  end if;

  v_transfer_id := gen_random_uuid();
  insert into fx_lot_transfers(id,company,currency,transfer_date,from_account_type,
    to_account_type,amount,valuation_method,transfer_rate,maturity_date,
    annual_interest_rate,early_withdrawal,investment_id,memo,created_by)
  values(v_transfer_id,p_company,p_currency,p_transfer_date,p_from_account_type,
    p_to_account_type,p_amount,v_method,p_transfer_rate,p_maturity_date,
    coalesce(p_annual_interest_rate,0),coalesce(p_allow_early,false),p_investment_id,p_memo,p_by);

  v_need := p_amount;
  for v_lot in select * from fx_lots
    where company=p_company and currency=p_currency and account_type=p_from_account_type
      and remaining_amount > 0
      and (transfer_id is null or transfer_id <> v_transfer_id)
      and (p_from_account_type <> 'term_deposit' or coalesce(p_allow_early,false)
           or (maturity_date is not null and maturity_date <= p_transfer_date))
      and available_from <= p_transfer_date                               -- ★ F-04
    order by (case when p_from_account_type = 'term_deposit'
                    and maturity_date is not null and maturity_date <= p_transfer_date
                   then 0 else 1 end),
             acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0;
    v_take := least(v_need, v_lot.remaining_amount);
    v_disposal := case when v_method = 'carryover' then v_lot.acq_rate else p_transfer_rate end;

    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,txn_type,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,v_lot.id,p_transfer_date,v_take,
      v_lot.acq_rate,v_disposal,(v_disposal-v_lot.acq_rate)*v_take,'FIFO',
      'transfer',v_transfer_id,'transfer',
      format('계좌 대체 %s → %s (%s)',p_from_account_type,p_to_account_type,v_method),p_by);

    update fx_lots set remaining_amount = remaining_amount - v_take where id = v_lot.id;
    v_pnl  := v_pnl + (v_disposal - v_lot.acq_rate) * v_take;
    v_need := v_need - v_take;

    if v_method = 'carryover' then
      insert into fx_lots(id,company,currency,acquired_date,available_from,original_amount,remaining_amount,
        acq_rate,source_type,source_id,transfer_id,investment_id,account_type,txn_type,
        annual_interest_rate,maturity_date,memo,created_by)
      values(gen_random_uuid(),p_company,p_currency,v_lot.acquired_date,
        p_transfer_date,                                                  -- ★ F-04 생성일 = 대체일
        v_take,v_take,
        v_lot.acq_rate,'transfer',null,v_transfer_id,p_investment_id,p_to_account_type,'transfer',
        case when p_to_account_type='demand_deposit' then 0 else coalesce(p_annual_interest_rate,0) end,
        case when p_to_account_type='term_deposit' then p_maturity_date else null end,
        coalesce(p_memo,'') || format(' · 대체 승계(원 로트 %s)',v_lot.acquired_date),p_by);
      v_new_lots := v_new_lots + 1;
    end if;
  end loop;

  if v_need > 0.000001 then
    raise exception '% 잔액 부족: % 부족합니다 (정기예금 만기 전 금액과 % 이후에 생긴 로트는 제외됩니다)',
      p_from_account_type, v_need, p_transfer_date;
  end if;

  if v_method = 'revalue' then
    insert into fx_lots(id,company,currency,acquired_date,available_from,original_amount,remaining_amount,
      acq_rate,source_type,source_id,transfer_id,investment_id,account_type,txn_type,
      annual_interest_rate,maturity_date,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,p_transfer_date,
      p_transfer_date,                                                    -- ★ F-04
      p_amount,p_amount,
      p_transfer_rate,'transfer',null,v_transfer_id,p_investment_id,p_to_account_type,'transfer',
      case when p_to_account_type='demand_deposit' then 0 else coalesce(p_annual_interest_rate,0) end,
      case when p_to_account_type='term_deposit' then p_maturity_date else null end,
      coalesce(p_memo,'') || ' · 대체 재평가',p_by);
    v_new_lots := 1;
  end if;

  update fx_lot_transfers set realized_pnl = round(v_pnl) where id = v_transfer_id;

  return jsonb_build_object('transfer_id',v_transfer_id,'method',v_method,
    'new_lots',v_new_lots,'realized_pnl',round(v_pnl));
end $$;

revoke all on function public.transfer_fx_lots(text,text,date,text,text,numeric,date,numeric,numeric,boolean,uuid,text,text) from public, anon;
grant execute on function public.transfer_fx_lots(text,text,date,text,text,numeric,date,numeric,numeric,boolean,uuid,text,text) to authenticated;


-- ── [5] 체결 1건 취소 — F-10 법인 범위 ──────────────────────
create or replace function public.reverse_fx_trade_fill(p_fill_id uuid, p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fill fx_trade_fills%rowtype; v_trade fx_trade_history%rowtype; v_row fx_lot_consumptions%rowtype;
  v_new_filled numeric; v_new_rate numeric; v_new_pnl numeric; v_new_status text;
  v_last_fill fx_trade_fills%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;

  select * into v_fill from fx_trade_fills where id=p_fill_id for update;
  if not found then raise exception '체결 내역을 찾을 수 없습니다'; end if;

  select * into v_trade from fx_trade_history where id=v_fill.trade_id for update;
  if not found or v_trade.status not in ('부분체결','완료') then
    raise exception '부분체결 또는 완료 상태의 지시만 개별 체결을 취소할 수 있습니다';
  end if;

  -- ★ F-10: 지시의 법인에 대한 권한
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (u.role in ('master','admin') or u.can_approve=true)
    and (coalesce(array_length(u.companies,1),0)=0 or v_trade.company=any(u.companies))) then
    raise exception '이 법인(%)의 체결 취소 권한이 없습니다', v_trade.company;
  end if;

  for v_row in select * from fx_lot_consumptions where fill_id=p_fill_id for update
  loop update fx_lots set remaining_amount=remaining_amount+v_row.amount where id=v_row.lot_id; end loop;
  delete from fx_lot_consumptions where fill_id=p_fill_id;
  delete from fx_trade_fills where id=p_fill_id;

  select coalesce(sum(amount_fx),0), coalesce(sum(realized_pnl),0)
    into v_new_filled, v_new_pnl
    from fx_trade_fills where trade_id=v_trade.id;

  if v_new_filled > 0 then
    select coalesce(sum(amount_fx*completed_rate)/sum(amount_fx),0) into v_new_rate
      from fx_trade_fills where trade_id=v_trade.id;
    select * into v_last_fill from fx_trade_fills where trade_id=v_trade.id
      order by fill_date desc, created_at desc limit 1;
    v_new_status := case when v_new_filled >= v_trade.amount_fx - 0.000001 then '완료' else '부분체결' end;
    update fx_trade_history set filled_amount=v_new_filled, completed_rate=v_new_rate,
      completed_pnl=round(v_new_pnl), status=v_new_status,
      completed_at=(v_last_fill.fill_date::text||'T00:00:00.000Z')::timestamptz,
      completed_by=v_last_fill.completed_by,
      memo=concat(coalesce(v_trade.memo,''),' · 체결 1건 취소: ',p_reversed_by)
    where id=v_trade.id;
  else
    v_new_status := case when v_trade.approved_by is not null then '승인' else '발의' end;
    update fx_trade_history set filled_amount=0, completed_rate=null, completed_pnl=null,
      status=v_new_status, completed_at=null, completed_by=null,
      memo=concat(coalesce(v_trade.memo,''),' · 체결 1건 취소: ',p_reversed_by)
    where id=v_trade.id;
  end if;

  return jsonb_build_object('trade_id',v_trade.id,'fill_id',p_fill_id,'status',v_new_status,'filled_amount',v_new_filled);
end $$;

revoke all on function public.reverse_fx_trade_fill(uuid,text) from public, anon;
grant execute on function public.reverse_fx_trade_fill(uuid,text) to authenticated;


-- ── [6] 지시 전체 원복 — F-10 법인 범위 ─────────────────────
create or replace function public.reverse_fx_trade(p_trade_id uuid, p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_trade fx_trade_history%rowtype; v_row fx_lot_consumptions%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found or v_trade.status not in ('완료','부분체결') then
    raise exception '완료 또는 부분체결 상태만 원복할 수 있습니다';
  end if;

  -- ★ F-10: 지시의 법인에 대한 권한
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (u.role in ('master','admin') or u.can_approve=true)
    and (coalesce(array_length(u.companies,1),0)=0 or v_trade.company=any(u.companies))) then
    raise exception '이 법인(%)의 거래 원복 권한이 없습니다', v_trade.company;
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

revoke all on function public.reverse_fx_trade(uuid,text) from public, anon;
grant execute on function public.reverse_fx_trade(uuid,text) to authenticated;


-- ── [7] F-10 · 쓰지 않는 구 체결 RPC 의 실행 권한 회수 ───────────
-- 함수는 남겨 둔다(되돌릴 수 있게). 다시 필요하면 grant execute ... to authenticated.
do $$
begin
  if exists (select 1 from pg_proc where proname='complete_fx_trade_with_fifo') then
    execute 'revoke execute on function public.complete_fx_trade_with_fifo(uuid,numeric,text) from authenticated, public, anon';
  end if;
  if exists (select 1 from pg_proc where proname='reverse_completed_fx_trade') then
    execute 'revoke execute on function public.reverse_completed_fx_trade(uuid,text) from authenticated, public, anon';
  end if;
end $$;


-- ── [8] 결과표 (읽기 전용) — 이 표 하나만 보시면 됩니다 ───────────
select 항목, 결과, 비고 from (
  select 1 as 순서, 'available_from 컬럼'::text as 항목,
    case when exists(select 1 from information_schema.columns
      where table_name='fx_lots' and column_name='available_from' and is_nullable='NO')
      then 'OK' else '확인필요' end as 결과,
    '로트가 장부에 생긴 날'::text as 비고
  union all
  select 2, '대체 로트 생성일 = 대체일',
    case when not exists(select 1 from fx_lots l join fx_lot_transfers t on t.id=l.transfer_id
                          where l.available_from <> t.transfer_date)
      then 'OK' else '확인필요' end,
    'carryover 로트는 취득일을 승계하지만 생성일은 대체일'
  union all
  select 3, '자동 채움 트리거',
    case when exists(select 1 from pg_trigger where tgname='trg_fx_lots_available_from')
      then 'OK' else '확인필요' end, ''
  union all
  select 4, '체결 RPC 시점 필터·법인 범위',
    case when exists(select 1 from pg_proc where proname='complete_fx_trade_fill' and pronargs=6
                      and prosrc like '%available_from <= p_fill_date%'
                      and prosrc like '%v_trade.company=any(u.companies)%')
      then 'OK' else '확인필요' end, 'complete_fx_trade_fill'
  union all
  select 5, '유출 RPC 시점 필터',
    case when exists(select 1 from pg_proc where proname='consume_fx_lots_for_source' and pronargs=10
                      and prosrc like '%available_from <= p_disposed_date%')
      then 'OK' else '확인필요' end, 'consume_fx_lots_for_source'
  union all
  select 6, '대체 RPC 시점 필터',
    case when exists(select 1 from pg_proc where proname='transfer_fx_lots'
                      and prosrc like '%available_from <= p_transfer_date%')
      then 'OK' else '확인필요' end, 'transfer_fx_lots'
  union all
  select 7, '체결취소·전체원복 법인 범위',
    case when (select count(*) from pg_proc where proname in ('reverse_fx_trade_fill','reverse_fx_trade')
                and prosrc like '%v_trade.company=any(u.companies)%') = 2
      then 'OK' else '확인필요' end, 'reverse_fx_trade_fill · reverse_fx_trade'
  union all
  select 8, '구 체결 RPC 실행 권한 회수',
    case when not exists(select 1 from pg_proc p where p.proname in ('complete_fx_trade_with_fifo','reverse_completed_fx_trade')
                          and has_function_privilege('authenticated', p.oid, 'execute'))
      then 'OK' else '확인필요' end, '함수는 남김(되돌리기 가능)'
  union all
  -- 과거에 이미 생긴 시점 위반 — **자동으로 고치지 않는다**. 건수가 0이 아니면 담당자에게 알려 주세요.
  select 9, '과거 시점 위반 소진 건수',
    (select count(*)::text from fx_lot_consumptions c join fx_lots l on l.id=c.lot_id
      where l.available_from > c.disposed_date),
    '0 이 아니면 아래 [참고] 쿼리로 목록 확인 — 자동 정정하지 않음'
) r order by 순서;

-- [참고] 과거 시점 위반 목록 (9번이 0이 아닐 때만, 따로 실행)
-- select c.company, c.currency, c.disposed_date, c.amount, l.available_from,
--        c.source_type, c.txn_type, c.memo
--   from fx_lot_consumptions c join fx_lots l on l.id = c.lot_id
--  where l.available_from > c.disposed_date
--  order by c.disposed_date desc;
