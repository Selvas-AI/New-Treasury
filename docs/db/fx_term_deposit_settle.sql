-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 원장 — 정기예금 해지·재예치 + 운용자금 연동 (세션26차 12일차, Phase 2)
-- 설계: docs/기획/외화원장_계좌간거래_설계.md §3 Phase 2
--
-- 배경: 정기예금은 두 장부에 동시에 존재한다.
--   investments — 계약 조건(은행·금리·만기)과 만기 처리 여부의 정본
--   fx_lots     — 외화 원가(장부환율)·FIFO 순서·환전 가능 여부의 정본
--   그런데 서로 참조하는 컬럼이 없어 **따로 놀고 있었다**(실측: 메디아나 USD 정기예금
--   2026-03-17 건은 이미 해지됐는데 원장엔 흔적이 없다).
--
-- ⭐ 해지 = [원금 대체] + [이자 신규 로트] 를 한 트랜잭션으로.
--   원금은 계좌만 옮기는 것이므로 대체(transfer_fx_lots)를 그대로 재사용한다 —
--   평가 방식(carryover/revalue)도 법인 정책을 따른다.
--   ⚠ 이자는 **새로 생긴 외화**다. 원가승계 대상이 아니라 **해지일 환율의 신규 로트**로
--     넣어야 원가가 왜곡되지 않는다(이자를 원금 장부환율로 넣으면 원가가 희석된다).
--
-- 재예치는 to_account_type='term_deposit' 로 대체하면 그대로 성립한다(새 만기·금리).
--
-- 실행: Supabase SQL Editor. fx_lot_transfer.sql · fx_txn_type.sql 적용 후 실행할 것.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. 정기예금 해지/재예치 RPC ─────────────────────────────────────────────
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
  p_memo text default null, p_by text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_transfer jsonb; v_interest_lot uuid;
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

  -- 원금: 정기예금 → 지정 계좌유형으로 대체. 평가 방식·중도해지 검사는 대체 RPC 가 담당.
  v_transfer := transfer_fx_lots(
    p_company, p_currency, p_settle_date,
    'term_deposit', p_to_account_type, p_principal,
    p_maturity_date, coalesce(p_annual_interest_rate,0),
    p_transfer_rate, coalesce(p_allow_early,false), p_investment_id,
    coalesce(p_memo, '정기예금 해지'), p_by);

  -- 이자: 새로 생긴 외화 → 해지일 환율의 신규 로트. 계좌유형은 원금 행선지를 따르되
  -- 재예치(term_deposit)여도 이자는 보통 함께 묶이지 않으므로 수시입출로 받는다.
  if coalesce(p_interest,0) > 0 then
    v_interest_lot := gen_random_uuid();
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,investment_id,account_type,txn_type,
      annual_interest_rate,maturity_date,memo,created_by)
    values(v_interest_lot,p_company,p_currency,p_settle_date,p_interest,p_interest,
      p_interest_rate,'interest',null,p_investment_id,
      case when p_to_account_type = 'term_deposit' then 'demand_deposit' else p_to_account_type end,
      'interest',0,null,
      coalesce(p_memo,'') || ' · 정기예금 이자 수취',p_by);
  end if;

  return jsonb_build_object('transfer', v_transfer, 'interest_lot_id', v_interest_lot,
    'principal', p_principal, 'interest', coalesce(p_interest,0));
end $$;

revoke all on function public.settle_fx_term_deposit(text,text,date,numeric,text,numeric,numeric,date,numeric,numeric,boolean,uuid,text,text) from public, anon;
grant execute on function public.settle_fx_term_deposit(text,text,date,numeric,text,numeric,numeric,date,numeric,numeric,boolean,uuid,text,text) to authenticated;

-- ── 2. 기존 로트 ↔ 운용자금 수동 매핑 RPC ──────────────────────────────────
-- 이미 양쪽에 따로 들어가 있는 정기예금을 1회 연결한다(설계 §4 D).
-- 금액·만기가 맞는지는 화면에서 후보를 보여주고 사용자가 확인한다 — 여기서는 기록만.
create or replace function public.link_fx_lots_to_investment(
  p_lot_ids uuid[], p_investment_id uuid, p_by text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')) then
    raise exception '연결 권한이 없습니다';
  end if;

  update fx_lots set investment_id = p_investment_id where id = any(p_lot_ids);
  get diagnostics v_n = row_count;
  return jsonb_build_object('linked', v_n, 'investment_id', p_investment_id);
end $$;

revoke all on function public.link_fx_lots_to_investment(uuid[],uuid,text) from public, anon;
grant execute on function public.link_fx_lots_to_investment(uuid[],uuid,text) to authenticated;
