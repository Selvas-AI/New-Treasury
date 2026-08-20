-- ═══════════════════════════════════════════════════════════════════════════
-- 계좌 대체 — 자기 소진(self-consume) 방어 (세션26차 12일차 후속 hotfix)
--
-- ⚠⚠ 발견된 결함: **재예치**(from=term_deposit, to=term_deposit)처럼 출금·입금 계좌유형이
--   같으면, FIFO 루프가 도는 중에 **자기가 방금 만든 신규 로트를 다시 소진 대상으로 잡을 수
--   있다.** plpgsql 의 `FOR ... IN SELECT` 는 커서로 도는데, 같은 트랜잭션에서 insert 한 행이
--   실행 계획에 따라 커서에 보일 수 있기 때문이다(READ COMMITTED 스냅샷 규칙만으로는
--   "절대 안 보인다"가 보장되지 않는다).
--
--   그러면 원금이 계속 되돌아 소진되며 로트가 무한 증식하거나, 최소한 대체 금액이
--   중복 처리된다. 보통예금↔MMDA 처럼 유형이 다르면 애초에 걸리지 않지만,
--   **재예치는 Phase 2 정기예금 해지의 정상 경로**라 반드시 막아야 한다.
--
-- 해결: 소진 대상 WHERE 에 `transfer_id is distinct from v_transfer_id` 를 추가한다.
--   이번 대체가 만든 로트는 transfer_id 가 채워져 있으므로 스냅샷 가시성과 무관하게
--   구조적으로 제외된다.
--
-- 나머지 로직·시그니처·권한은 fx_txn_type.sql 판본과 동일하다(해당 한 줄만 추가).
-- 실행: Supabase SQL Editor. fx_txn_type.sql 적용 후에 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

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
      -- ⭐ 이번 대체가 만든 로트는 소진 대상에서 제외 (재예치 자기 소진 방지)
      and (transfer_id is null or transfer_id <> v_transfer_id)
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
