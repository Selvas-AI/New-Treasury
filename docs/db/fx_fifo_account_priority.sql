-- ═══════════════════════════════════════════════════════════════════════════
-- FIFO 계좌유형 우선순위 (세션26차 11일차)
--
-- 배경: FIFO 는 지금까지 취득일 순으로만 소진했다(계좌유형 무시). 그런데 실무에서는
--   같은 날 들어온 외화라도 "보통예금 먼저 빼고 MMDA 는 이자 때문에 남긴다" 같은
--   운용 판단이 존재한다(2026-08-20 사용자 요청).
--
-- ⚠⚠ 이건 표시 설정이 아니라 **원가흐름 가정의 변경**이다.
--   로트마다 취득환율이 다르므로 소진 순서가 바뀌면 **확정 환차손익이 달라진다.**
--   그래서 다음 두 가지를 강제한다:
--     1. 값은 policy_params(법인 단위)에만 둔다 → 정책회의가 정하고 사유가 남는다.
--        체결 단위 임의 선택은 지원하지 않는다(담당자가 매번 유리한 로트를 고르는
--        cherry-picking 을 막기 위함).
--     2. 기본값은 **미설정 = 현행 동작**(순수 취득일 FIFO). 값을 넣지 않은 법인은
--        동작이 전혀 바뀌지 않는다.
--
-- 파라미터: policy_params.param_key = 'fx_fifo_account_priority'
--           param_text = 'demand_deposit,mmda'  (쉼표 구분, 앞에 올수록 먼저 소진)
--           목록에 없는 유형은 항상 뒤로 밀린다. 빈 값/NULL = 현행(취득일만).
-- ⚠ 정기예금(term_deposit)의 만기 전 제외는 우선순위와 무관하게 그대로 유지된다.
--
-- ⚠ 클라이언트 미리보기(src/lib/fxLots.ts previewFifoConsumption)도 **같은 값**을
--   읽어 같은 순서로 정렬해야 한다. 한쪽만 바꾸면 미리보기와 실제 소진이 갈라진다.
--
-- 실행: Supabase SQL Editor. 기존 RPC 를 같은 시그니처로 재정의(create or replace)한다.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. 우선순위 조회 헬퍼 ────────────────────────────────────────────────────
-- 반환: 계좌유형 → 정렬 순번(작을수록 먼저). 목록에 없으면 999.
create or replace function public.fx_fifo_account_rank(p_company text, p_account_type text)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(
    (select idx from (
       select trim(t) as t, row_number() over () as idx
       from unnest(string_to_array(
         (select nullif(trim(coalesce(param_text,'')), '')
            from policy_params
           where company = p_company and param_key = 'fx_fifo_account_priority'),
         ',')) as t
     ) ranked where ranked.t = p_account_type),
    999);
$$;

revoke all on function public.fx_fifo_account_rank(text,text) from public, anon;
grant execute on function public.fx_fifo_account_rank(text,text) to authenticated;

-- ── 1. 매각 체결 FIFO 소진 (fx_trade_partial_fill_migration.sql 의 함수 재정의) ──
-- 변경점은 for 루프의 order by 한 줄뿐이다. 나머지 로직·권한·예외는 원본 그대로.
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

-- ── 2. 범용 FIFO 소진 (fx_lots_daily_report_source.sql 의 함수 재정의) ────────
create or replace function public.consume_fx_lots_for_source(
  p_company text, p_currency text, p_source_type text, p_source_id uuid,
  p_amount numeric, p_disposal_rate numeric, p_disposed_date date, p_disposed_by text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lot fx_lots%rowtype; v_need numeric; v_take numeric; v_pnl numeric := 0;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '원장 반영 권한이 없습니다';
  end if;
  if p_disposal_rate <= 0 then raise exception '적용 환율은 0보다 커야 합니다'; end if;
  if p_amount <= 0 then raise exception '반영 금액은 0보다 커야 합니다'; end if;

  v_need := p_amount;
  for v_lot in select * from fx_lots
    where company=p_company and currency=p_currency and remaining_amount>0
      and (account_type <> 'term_deposit' or maturity_date <= p_disposed_date)
    order by fx_fifo_account_rank(p_company, account_type), acquired_date, created_at, id
    for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,v_lot.id,p_disposed_date,v_take,
      v_lot.acq_rate,p_disposal_rate,(p_disposal_rate-v_lot.acq_rate)*v_take,'FIFO',
      p_source_type,p_source_id,'자금일보 연동 자동 FIFO 소진',p_disposed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_pnl := v_pnl+(p_disposal_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then raise exception 'FIFO 잔액 부족: %', v_need; end if;
  return jsonb_build_object('source_id',p_source_id,'realized_pnl',round(v_pnl),'consumed',p_amount);
end $$;

-- 권한 재부여 (create or replace 는 기존 권한을 유지하지만 명시해 둔다)
revoke all on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) from public, anon;
grant execute on function public.complete_fx_trade_fill(uuid,numeric,numeric,date,text) to authenticated;
revoke all on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text) from public, anon;
grant execute on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text) to authenticated;
