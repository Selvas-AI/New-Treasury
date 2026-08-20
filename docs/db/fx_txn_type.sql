-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 원장 — 거래 유형(txn_type) 도입 (세션26차 12일차, Phase 3)
-- 설계: docs/기획/외화원장_계좌간거래_설계.md §2-2
--
-- 배경: 지금까지 `source_type` 하나가 "어느 화면에서 만들었나"와 "무슨 거래인가"를
--   겸했다. 그래서 **매입대금 결제(대외 지급)가 매각과 똑같이 기록**되어 환차손익
--   요약의 "매각 실적"이 부풀려졌다. 둘을 분리한다.
--
--   유출: sale(원화 환전) / payment(대외 외화 지급) / transfer(내부 대체)
--   유입: opening(개시) / acquisition(외화 수취) / interest(이자) / transfer(내부 대체)
--
-- ⚠ 실현손익은 sale·payment 에서만 "환차손익"으로 의미가 있다.
--   transfer 는 원가승계면 0, 재평가면 발생하지만 **매각 실적이 아니다** — 요약에서 분리.
--
-- 실행: Supabase SQL Editor. docs/db/fx_lot_transfer.sql 적용 후에 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 컬럼 추가 ────────────────────────────────────────────────────────────
alter table public.fx_lot_consumptions add column if not exists txn_type text;
alter table public.fx_lots             add column if not exists txn_type text;

-- ── 2. 기존 행 backfill ─────────────────────────────────────────────────────
-- 유출: 매각 워크플로우를 거친 것만 sale. 자금일보·수동 유출은 대외 지급으로 본다
--       (실제로 환전이었다면 사용자가 나중에 유형을 고칠 수 있게 화면에서 지원한다).
update public.fx_lot_consumptions set txn_type =
  case when source_type = 'fx_trade_history' then 'sale'
       when source_type = 'transfer'         then 'transfer'
       else 'payment' end
where txn_type is null;

update public.fx_lots set txn_type =
  case when source_type = 'opening'  then 'opening'
       when source_type = 'transfer' then 'transfer'
       when source_type = 'interest' then 'interest'
       else 'acquisition' end
where txn_type is null;

alter table public.fx_lot_consumptions drop constraint if exists fx_lot_consumptions_txn_type_check;
alter table public.fx_lot_consumptions add constraint fx_lot_consumptions_txn_type_check
  check (txn_type is null or txn_type in ('sale','payment','transfer','adjustment'));

alter table public.fx_lots drop constraint if exists fx_lots_txn_type_check;
alter table public.fx_lots add constraint fx_lots_txn_type_check
  check (txn_type is null or txn_type in ('opening','acquisition','interest','transfer','adjustment'));

create index if not exists fx_lot_consumptions_txn_type_idx
  on public.fx_lot_consumptions(company, currency, txn_type);

-- ── 3. 범용 소진 RPC — txn_type 인자 추가 ──────────────────────────────────
-- ⚠ 인자를 추가하면 create or replace 가 아니라 **새 오버로드**가 생긴다.
--   구 8인자 버전을 먼저 지워야 호출부가 어느 쪽으로 갈지 모호해지지 않는다.
drop function if exists public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text);

create or replace function public.consume_fx_lots_for_source(
  p_company text, p_currency text, p_source_type text, p_source_id uuid,
  p_amount numeric, p_disposal_rate numeric, p_disposed_date date, p_disposed_by text,
  p_txn_type text default 'payment'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot fx_lots%rowtype; v_need numeric; v_take numeric; v_pnl numeric := 0; v_txn text;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '원장 반영 권한이 없습니다';
  end if;
  if p_disposal_rate <= 0 then raise exception '적용 환율은 0보다 커야 합니다'; end if;
  if p_amount <= 0 then raise exception '반영 금액은 0보다 커야 합니다'; end if;

  v_txn := coalesce(p_txn_type, 'payment');
  if v_txn not in ('sale','payment','adjustment') then v_txn := 'payment'; end if;

  v_need := p_amount;
  for v_lot in select * from fx_lots
    where company=p_company and currency=p_currency and remaining_amount>0
      and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date)
    order by fx_fifo_account_rank(p_company, account_type), acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,txn_type,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,v_lot.id,p_disposed_date,v_take,
      v_lot.acq_rate,p_disposal_rate,(p_disposal_rate-v_lot.acq_rate)*v_take,'FIFO',
      p_source_type,p_source_id,v_txn,'원장 유출 FIFO 소진',p_disposed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_pnl := v_pnl+(p_disposal_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then raise exception 'FIFO 잔액 부족: %', v_need; end if;
  return jsonb_build_object('source_id',p_source_id,'realized_pnl',round(v_pnl),
    'consumed',p_amount,'txn_type',v_txn);
end $$;

revoke all on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text) from public, anon;
grant execute on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text) to authenticated;

-- ── 4. 매각 체결 RPC — 소진에 txn_type='sale' 기록 ─────────────────────────
-- 시그니처 변경 없음(체결은 항상 sale). 이전 정의(fx_fifo_account_priority.sql)에서
-- consumption insert 에 txn_type 만 추가한 판본이다.
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
    order by fx_fifo_account_rank(v_trade.company, account_type), acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,fill_id,txn_type,memo,created_by)
    values(gen_random_uuid(),v_trade.company,v_trade.currency,v_lot.id,p_fill_date,v_take,
      v_lot.acq_rate,p_completed_rate,(p_completed_rate-v_lot.acq_rate)*v_take,'FIFO',
      'fx_trade_history',v_trade.id,v_fill_id,'sale','외화매매거래 부분 체결 FIFO 소진',p_completed_by);
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

revoke all on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) from public, anon;
grant execute on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) to authenticated;

-- ── 5. 대체 RPC — 소진·신규 로트에 txn_type='transfer' 기록 ────────────────
-- fx_lot_transfer.sql 의 transfer_fx_lots 에서 insert 두 곳에 txn_type 만 추가.
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
      and (p_from_account_type <> 'term_deposit' or coalesce(p_allow_early,false)
           or (maturity_date is not null and maturity_date <= p_transfer_date))
    order by acquired_date, created_at, id for update
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
      insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
        acq_rate,source_type,source_id,transfer_id,investment_id,account_type,txn_type,
        annual_interest_rate,maturity_date,memo,created_by)
      values(gen_random_uuid(),p_company,p_currency,v_lot.acquired_date,v_take,v_take,
        v_lot.acq_rate,'transfer',null,v_transfer_id,p_investment_id,p_to_account_type,'transfer',
        case when p_to_account_type='demand_deposit' then 0 else coalesce(p_annual_interest_rate,0) end,
        case when p_to_account_type='term_deposit' then p_maturity_date else null end,
        coalesce(p_memo,'') || format(' · 대체 승계(원 로트 %s)',v_lot.acquired_date),p_by);
      v_new_lots := v_new_lots + 1;
    end if;
  end loop;

  if v_need > 0.000001 then
    raise exception '% 잔액 부족: % 부족합니다 (정기예금 만기 전 금액은 제외됩니다)',
      p_from_account_type, v_need;
  end if;

  if v_method = 'revalue' then
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,transfer_id,investment_id,account_type,txn_type,
      annual_interest_rate,maturity_date,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,p_transfer_date,p_amount,p_amount,
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
