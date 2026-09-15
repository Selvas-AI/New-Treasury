-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 정기예금 — 운용자금 연장·만기처리에서 원장까지 한 번에 (2026-09-15)
--
-- 배경(사용자 리포트 2026-09-15):
--   "외화 정기예금 만기가 되어 운용자금에서 재예치로 처리하였는데, 외화(FX)관리의
--    정기예금 관리에서도 별도로 해지를 진행해야 합니다."
--   → 같은 사실을 두 장부에 손으로 두 번 넣고 있었다. 한쪽을 잊으면 두 장부가
--     조용히 벌어지고(정합성 경고로만 드러남), 만기 지난 정기예금이 원장에서 계속
--     잠겨 있어 **환전 가능액이 과소 계산**된다 → 리짐 권고액까지 어긋난다.
--
-- 이 스크립트는 그 연동에 필요한 서버 쪽 결함 두 가지를 고친다.
--   ① 이자를 정기예금에 **재예치**할 수 없었다 (항상 수시입출로만 들어갔다)
--   ② 중도해지 시 **만기 도래분이 뒤로 밀렸다** (취득일 순이라 미도래분을 먼저 깼다)
--
-- 실행: Supabase SQL Editor.
--   선행: fx_lot_transfer.sql → fx_txn_type.sql → fx_transfer_selfconsume_guard.sql
--         → fx_term_deposit_settle.sql → (이 파일)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. transfer_fx_lots — 만기 도래분 우선 소진 ─────────────────────────────
-- ⚠ 기존 판본은 `order by acquired_date` 뿐이었다. 만기 도래분만 대상일 때는
--   문제가 없지만(필터가 미도래분을 빼므로), **중도해지(p_allow_early)** 를 허용하는
--   순간 미도래분이 함께 후보가 되고 취득일이 앞서면 **그쪽이 먼저 깨진다.**
--   실측 예: 메디아나 USD — 2026-03-11 취득(만기 12-11) 1M / 2026-06-17 취득(만기 09-17) 5M.
--   만기된 5M 을 해지하면서 중도해지를 허용하면 03-11 건(미도래)이 먼저 소진됐다.
--   → 만기 도래분을 항상 앞세운다. 그 안에서는 종전대로 취득일 FIFO.
-- 나머지 로직·시그니처·권한은 fx_transfer_selfconsume_guard.sql 판본과 동일하다.
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
      -- 이번 대체가 만든 로트는 소진 대상에서 제외 (재예치 자기 소진 방지)
      and (transfer_id is null or transfer_id <> v_transfer_id)
      and (p_from_account_type <> 'term_deposit' or coalesce(p_allow_early,false)
           or (maturity_date is not null and maturity_date <= p_transfer_date))
    -- ⭐ 만기 도래분 우선 → 그 안에서 취득일 FIFO
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


-- ── 2. settle_fx_term_deposit — 이자 계좌유형 지정 ──────────────────────────
-- ⚠ 기존 판본은 재예치(to='term_deposit')일 때 이자를 **항상 보통예금**으로 넣었다.
--   그런데 실무의 재예치는 대부분 **이자를 원금에 더해 다시 묶는다**(복리 재예치).
--   그 경우 원장 정기예금 잔액이 이자만큼 운용자금보다 작아져 정합성 경고가 뜬다.
--   → p_interest_account_type 으로 이자 행선지를 명시할 수 있게 한다.
--     미지정(null)이면 기존 동작 그대로다 — 이미 호출 중인 화면은 영향받지 않는다.
--
-- ⚠ 인자를 추가하면 create or replace 가 아니라 **새 오버로드**가 생긴다
--   (구 14인자 버전이 남아 호출이 어느 쪽으로 갈지 모호해진다). 반드시 drop 후 재생성.
drop function if exists public.settle_fx_term_deposit(
  text,text,date,numeric,text,numeric,numeric,date,numeric,numeric,boolean,uuid,text,text);

create or replace function public.settle_fx_term_deposit(
  p_company text, p_currency text, p_settle_date date,
  p_principal numeric,                       -- 해지 원금(외화)
  p_to_account_type text,                    -- 원금 행선지: demand_deposit / mmda / term_deposit(재예치)
  p_interest numeric default 0,              -- 이자 수취액(외화). 0 이면 이자 로트 생성 안 함
  p_interest_rate numeric default null,      -- 이자 로트의 장부환율(해지일 환율). 이자>0 이면 필수
  p_maturity_date date default null,         -- 재예치일 때 새 만기
  p_annual_interest_rate numeric default 0,  -- 재예치/MMDA 연이율
  p_transfer_rate numeric default null,      -- 재평가 정책일 때만
  p_allow_early boolean default false,       -- 중도해지
  p_investment_id uuid default null,         -- 연결된 운용자금 레코드
  p_memo text default null, p_by text default null,
  p_interest_account_type text default null  -- 이자 행선지. null = 종전 동작
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_transfer jsonb; v_interest_lot uuid; v_int_acct text;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or p_company=any(u.companies))) then
    raise exception '정기예금 해지 권한이 없습니다';
  end if;
  if p_principal <= 0 then raise exception '해지 원금은 0보다 커야 합니다'; end if;
  if coalesce(p_interest,0) > 0 and coalesce(p_interest_rate,0) <= 0 then
    raise exception '이자를 등록하려면 해지일 환율이 필요합니다';
  end if;

  -- 이자 행선지: 명시값 → (재예치면 보통예금, 아니면 원금과 같은 곳)
  v_int_acct := coalesce(p_interest_account_type,
    case when p_to_account_type = 'term_deposit' then 'demand_deposit' else p_to_account_type end);
  if v_int_acct not in ('demand_deposit','mmda','term_deposit') then
    raise exception '이자 행선지 계좌유형이 올바르지 않습니다: %', v_int_acct;
  end if;
  -- 정기예금으로 들어가는 이자에 만기가 없으면 그 로트는 **영원히 잠긴다**
  -- (환전 가능 판정이 maturity_date <= 기준일 이라 null 은 통과하지 못한다).
  if coalesce(p_interest,0) > 0 and v_int_acct = 'term_deposit' and p_maturity_date is null then
    raise exception '이자를 정기예금으로 넣으려면 만기일이 필요합니다';
  end if;

  -- 원금: 정기예금 → 지정 계좌유형으로 대체. 평가 방식·중도해지 검사는 대체 RPC 가 담당.
  v_transfer := transfer_fx_lots(
    p_company, p_currency, p_settle_date,
    'term_deposit', p_to_account_type, p_principal,
    p_maturity_date, coalesce(p_annual_interest_rate,0),
    p_transfer_rate, coalesce(p_allow_early,false), p_investment_id,
    coalesce(p_memo, '정기예금 해지'), p_by);

  -- 이자: 새로 생긴 외화 → 해지일 환율의 신규 로트.
  -- ⚠ 원금 장부환율로 넣으면 원가가 희석된다. 반드시 해지일 환율이어야 한다.
  if coalesce(p_interest,0) > 0 then
    v_interest_lot := gen_random_uuid();
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,investment_id,account_type,txn_type,
      annual_interest_rate,maturity_date,memo,created_by)
    values(v_interest_lot,p_company,p_currency,p_settle_date,p_interest,p_interest,
      p_interest_rate,'interest',null,p_investment_id,v_int_acct,'interest',
      case when v_int_acct = 'demand_deposit' then 0 else coalesce(p_annual_interest_rate,0) end,
      case when v_int_acct = 'term_deposit'   then p_maturity_date else null end,
      coalesce(p_memo,'') || ' · 정기예금 이자 수취',p_by);
  end if;

  return jsonb_build_object('transfer', v_transfer, 'interest_lot_id', v_interest_lot,
    'interest_account_type', v_int_acct,
    'principal', p_principal, 'interest', coalesce(p_interest,0));
end $$;

revoke all on function public.settle_fx_term_deposit(text,text,date,numeric,text,numeric,numeric,date,numeric,numeric,boolean,uuid,text,text,text) from public, anon;
grant execute on function public.settle_fx_term_deposit(text,text,date,numeric,text,numeric,numeric,date,numeric,numeric,boolean,uuid,text,text,text) to authenticated;
