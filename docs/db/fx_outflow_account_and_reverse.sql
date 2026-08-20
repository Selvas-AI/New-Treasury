-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 유출 — 출금 계좌 지정 + 수동 유출 정정 (세션26차 14일차)
--
-- 【배경 1】 회사 업무 규칙상 **외화결제대금(물대)은 보통예금에서만** 인출된다.
--   그런데 FIFO 가 계좌유형과 무관하게 취득일 순으로만 소진해서, 실제 인출 계좌와
--   장부상 소진 계좌가 어긋났다(2026-08-21 리포트).
--
--   실무 규칙(회사 제공 표):
--     보통예금 출금 — 외화물대 지급 / 달러매각 / 정기예금 가입 / MMDA 대체
--     MMDA     출금 — 달러매각 / 정기예금 대체
--     정기예금 출금 — 재예치 인출 / 만기 후 매각
--   즉 **거래 유형마다 나가는 계좌가 다르다.** 법인 단위 단일 우선순위로는 표현이 안 된다.
--
--   ⭐ 해결: 유출 시 **출금 계좌유형을 지정**할 수 있게 한다.
--     ⚠ 이건 로트를 고르는 게 아니라 **은행에서 실제로 어느 계좌에서 나갔는지**를
--       기록하는 것이다 — 선택이 아니라 사실이다. 계좌 안에서는 여전히 취득일 FIFO 를
--       강제하므로 유리한 로트만 골라 쓰는 cherry-picking 은 여전히 불가능하다.
--     미지정(null)이면 기존대로 정책 우선순위(fx_fifo_account_priority)를 따른다.
--
-- 【배경 2】 데이터 등록 › 외화 유출로 잘못 입력한 건을 **되돌릴 방법이 없었다**
--   (실측: 2026-08-06 대외 지급 -24,227.1 오입력). 매각 체결은 reverse_fx_trade_fill,
--   계좌 대체는 reverse_fx_lot_transfer 가 있는데 수동 유출만 경로가 없었다.
--
-- 실행: Supabase SQL Editor. 기존 마이그레이션 전부 적용된 뒤 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 범용 소진 RPC — 출금 계좌유형 지정 추가 ─────────────────────────────
-- ⚠ 인자 추가는 오버로드를 만든다. 구 9인자 버전을 먼저 지운다.
drop function if exists public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text);

create or replace function public.consume_fx_lots_for_source(
  p_company text, p_currency text, p_source_type text, p_source_id uuid,
  p_amount numeric, p_disposal_rate numeric, p_disposed_date date, p_disposed_by text,
  p_txn_type text default 'payment',
  p_account_type text default null      -- ⭐ 지정 시 그 계좌유형에서만 소진
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

  -- 계좌유형을 지정했으면 그 계좌의 환전 가능 잔액을 먼저 확인해 친절한 오류를 낸다
  if p_account_type is not null then
    select coalesce(sum(remaining_amount),0) into v_avail
      from fx_lots
     where company=p_company and currency=p_currency and account_type=p_account_type
       and remaining_amount > 0
       and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date);
    if v_avail < p_amount then
      raise exception '% 잔액 부족: 가능 % / 요청 % (계좌유형 지정 소진)',
        p_account_type, v_avail, p_amount;
    end if;
  end if;

  v_need := p_amount;
  for v_lot in select * from fx_lots
    where company=p_company and currency=p_currency and remaining_amount>0
      and (p_account_type is null or account_type = p_account_type)
      and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date)
    -- 계좌유형을 지정했으면 유형 간 우선순위는 의미가 없다(이미 하나로 고정).
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
  if v_need > 0.000001 then raise exception 'FIFO 잔액 부족: %', v_need; end if;
  return jsonb_build_object('source_id',p_source_id,'realized_pnl',round(v_pnl),
    'consumed',p_amount,'txn_type',v_txn,'account_type',p_account_type);
end $$;

revoke all on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text,text) from public, anon;
grant execute on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text,text,text) to authenticated;


-- ── 2. 매각 체결 RPC — 출금 계좌유형 지정 추가 ─────────────────────────────
-- 달러 매각은 보통예금·MMDA 어느 쪽에서도 나갈 수 있다(회사 규칙 표).
drop function if exists public.complete_fx_trade_fill(uuid,numeric,numeric,date,text);

create or replace function public.complete_fx_trade_fill(
  p_trade_id uuid, p_fill_amount numeric, p_completed_rate numeric,
  p_fill_date date, p_completed_by text,
  p_account_type text default null      -- ⭐ 지정 시 그 계좌유형에서만 소진
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
  if p_account_type is not null
     and p_account_type not in ('demand_deposit','mmda','term_deposit') then
    raise exception '알 수 없는 계좌유형: %', p_account_type;
  end if;

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
      and (p_account_type is null or account_type = p_account_type)
      and (account_type <> 'term_deposit' or maturity_date <= p_fill_date)
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
    raise exception 'FIFO 잔액 부족: % (계좌유형 %)', v_need, coalesce(p_account_type,'전체');
  end if;

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

revoke all on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text,text) from public, anon;
grant execute on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text,text) to authenticated;


-- ── 3. 수동 유출 / 자금일보 유출 정정 RPC ──────────────────────────────────
-- 매각 체결은 reverse_fx_trade_fill, 계좌 대체는 reverse_fx_lot_transfer 가 있는데
-- **수동 유출만 되돌릴 경로가 없었다**(실측: 2026-08-06 오입력 -24,227.1).
--
-- ⚠ source_type 을 'manual' / 'daily_report_item' 로 제한한다.
--   매각 체결(fx_trade_history)은 fx_trade_fills·fx_trade_history 상태까지 함께
--   되돌려야 하므로 전용 RPC 를 써야 한다 — 여기로 우회하면 거래 상태가 어긋난다.
create or replace function public.reverse_fx_consumption_by_source(
  p_company text, p_currency text, p_source_type text, p_source_id uuid, p_by text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row fx_lot_consumptions%rowtype; v_n int := 0; v_amt numeric := 0;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '유출 취소 권한이 없습니다';
  end if;
  if p_source_type not in ('manual','daily_report_item') then
    raise exception '이 함수로는 수동 유출/자금일보 유출만 되돌릴 수 있습니다 (요청: %). '
      '매각 체결은 reverse_fx_trade_fill 을 쓰세요', p_source_type;
  end if;

  for v_row in select * from fx_lot_consumptions
    where company=p_company and currency=p_currency
      and source_type=p_source_type and source_id=p_source_id
    for update
  loop
    update fx_lots set remaining_amount = remaining_amount + v_row.amount
     where id = v_row.lot_id;
    v_n := v_n + 1; v_amt := v_amt + v_row.amount;
  end loop;

  if v_n = 0 then raise exception '되돌릴 소진 내역이 없습니다'; end if;

  delete from fx_lot_consumptions
   where company=p_company and currency=p_currency
     and source_type=p_source_type and source_id=p_source_id;

  return jsonb_build_object('reversed_rows', v_n, 'restored_amount', v_amt);
end $$;

revoke all on function public.reverse_fx_consumption_by_source(text,text,text,uuid,text) from public, anon;
grant execute on function public.reverse_fx_consumption_by_source(text,text,text,uuid,text) to authenticated;
