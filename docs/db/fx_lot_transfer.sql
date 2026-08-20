-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 원장 — 계좌 간 대체 (세션26차 12일차, Phase 1)
-- 설계: docs/기획/외화원장_계좌간거래_설계.md
--
-- 배경: 원장이 아는 거래가 "외부 유입 / 외부 유출" 둘뿐이라, 총액이 변하지 않는
--   **내부 이동**(보통예금↔MMDA 계좌대체, 정기예금 예치/해지/재예치)을 표현할 방법이
--   전혀 없었다. 로트를 `수정`해 계좌유형만 바꾸면 일부 금액만 옮길 수 없고 이력도
--   남지 않아 과거 사실이 왜곡된다.
--
-- ⭐ 대체 = 원자적 [FIFO 소진 + 신규 로트 생성] 쌍. 총 외화 잔액은 변하지 않는다.
--
-- 평가 방식(법인별 정책 — policy_params.fx_transfer_valuation):
--   carryover (기본) — 장부환율·취득일을 **소진된 로트별로 1:1 승계**. 실현손익 0.
--                      FIFO 순서가 보존된다. 회계 원칙에 부합.
--   revalue          — 대체환율로 **1건의 신규 로트**. 실현손익 발생, 취득일 = 대체일.
--                      사실상 매각+재매입이라 원가 이력이 리셋된다.
--   ⚠ 각 대체 건에 그때 적용한 방식을 fx_lot_transfers.valuation_method 로 **기록**한다.
--     정책이 나중에 바뀌어도 과거 이력의 해석이 흔들리면 안 되기 때문.
--
-- 실행: Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. source_type 확장 ─────────────────────────────────────────────────────
-- transfer   : 계좌 간 대체로 생긴 로트/소진
-- interest   : 이자 수취(정기예금 등) — 원금과 구분해야 원가가 왜곡되지 않는다
-- investment : 운용자금(investments) 연동으로 생긴 로트 (Phase 2 예약)
alter table public.fx_lots drop constraint if exists fx_lots_source_type_check;
alter table public.fx_lots add constraint fx_lots_source_type_check
  check (source_type in ('opening','daily_report_item','manual','adjustment',
                         'transfer','interest','investment'));

-- ⚠ fx_lots 에는 unique (company, currency, source_type, source_id) 가 걸려 있다.
--   carryover 는 한 대체에서 **여러 로트**를 만들므로 source_id 에 대체 id 를 넣으면
--   충돌한다. 링크는 별도 컬럼으로 두고 source_id 는 NULL 로 남긴다
--   (Postgres 는 unique 에서 NULL 을 서로 다른 값으로 취급한다).
alter table public.fx_lots add column if not exists transfer_id uuid;
alter table public.fx_lots add column if not exists investment_id uuid;
create index if not exists fx_lots_transfer_id_idx on public.fx_lots(transfer_id);

-- ── 2. 대체 이벤트 헤더 ─────────────────────────────────────────────────────
create table if not exists public.fx_lot_transfers (
  id                   uuid primary key default gen_random_uuid(),
  company              text not null,
  currency             text not null,
  transfer_date        date not null,
  from_account_type    text not null check (from_account_type in ('demand_deposit','mmda','term_deposit')),
  to_account_type      text not null check (to_account_type   in ('demand_deposit','mmda','term_deposit')),
  amount               numeric not null check (amount > 0),
  valuation_method     text not null check (valuation_method in ('carryover','revalue')),
  transfer_rate        numeric,          -- revalue 일 때만 사용
  realized_pnl         numeric not null default 0,
  maturity_date        date,             -- to_account_type='term_deposit' 일 때
  annual_interest_rate numeric not null default 0,
  early_withdrawal     boolean not null default false,
  investment_id        uuid,             -- Phase 2 운용자금 연동
  memo                 text,
  created_by           text,
  created_at           timestamptz not null default now()
);
create index if not exists fx_lot_transfers_scope_idx
  on public.fx_lot_transfers(company, currency, transfer_date desc);

alter table public.fx_lot_transfers enable row level security;
drop policy if exists fx_lot_transfers_select on public.fx_lot_transfers;
create policy fx_lot_transfers_select on public.fx_lot_transfers for select
  to authenticated using (true);
-- 쓰기는 RPC(security definer)만 — 직접 insert/update 는 열지 않는다.

-- ── 3. 대체 실행 RPC ────────────────────────────────────────────────────────
create or replace function public.transfer_fx_lots(
  p_company text, p_currency text, p_transfer_date date,
  p_from_account_type text, p_to_account_type text, p_amount numeric,
  p_maturity_date date default null, p_annual_interest_rate numeric default 0,
  p_transfer_rate numeric default null, p_allow_early boolean default false,
  p_investment_id uuid default null, p_memo text default null, p_by text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_method text; v_transfer_id uuid; v_lot fx_lots%rowtype;
  v_need numeric; v_take numeric; v_pnl numeric := 0; v_new_lots int := 0;
  v_rate numeric; v_disposal numeric;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  -- 대체는 새로운 매각 의사결정이 아니라 이미 일어난 계좌 이동의 기록이므로
  -- consume_fx_lots_for_source 와 같은 실무 편집 등급(editor 이상)으로 둔다.
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

  -- 평가 방식은 법인 정책에서 읽는다. 미설정이면 원가승계(현행 회계 원칙).
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

  -- ── 출금 계좌유형에서만 FIFO 소진 ──────────────────────────────────────
  -- ⚠ 계좌유형을 이미 하나로 고정했으므로 fx_fifo_account_rank 는 적용하지 않는다
  --   (유형 간 우선순위 정책은 "어느 계좌에서 뺄지"를 정하는 것이고, 여기서는
  --    사용자가 이미 명시했다). 유형 안에서는 항상 취득일 순.
  -- 정기예금 중도해지는 실무에 존재하므로 p_allow_early 로 명시 허용한다.
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

    if v_method = 'carryover' then
      v_disposal := v_lot.acq_rate;              -- 환전이 아니므로 손익 0
    else
      v_disposal := p_transfer_rate;
    end if;

    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,v_lot.id,p_transfer_date,v_take,
      v_lot.acq_rate,v_disposal,(v_disposal-v_lot.acq_rate)*v_take,'FIFO',
      'transfer',v_transfer_id,
      format('계좌 대체 %s → %s (%s)',p_from_account_type,p_to_account_type,v_method),p_by);

    update fx_lots set remaining_amount = remaining_amount - v_take where id = v_lot.id;
    v_pnl  := v_pnl + (v_disposal - v_lot.acq_rate) * v_take;
    v_need := v_need - v_take;

    -- carryover: 소진한 로트마다 1:1 신규 로트(장부환율·취득일 승계)
    if v_method = 'carryover' then
      insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
        acq_rate,source_type,source_id,transfer_id,investment_id,account_type,
        annual_interest_rate,maturity_date,memo,created_by)
      values(gen_random_uuid(),p_company,p_currency,v_lot.acquired_date,v_take,v_take,
        v_lot.acq_rate,'transfer',null,v_transfer_id,p_investment_id,p_to_account_type,
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

  -- revalue: 환율이 하나로 통일되므로 신규 로트는 1건. 취득일 = 대체일(새 취득).
  if v_method = 'revalue' then
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,transfer_id,investment_id,account_type,
      annual_interest_rate,maturity_date,memo,created_by)
    values(gen_random_uuid(),p_company,p_currency,p_transfer_date,p_amount,p_amount,
      p_transfer_rate,'transfer',null,v_transfer_id,p_investment_id,p_to_account_type,
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

-- ── 4. 대체 원복 RPC ────────────────────────────────────────────────────────
-- 대체로 생긴 로트가 이미 일부라도 소진됐으면 거부한다 — 되돌리면 그 소진 이력이
-- 가리키는 로트가 사라져 원장이 깨진다.
create or replace function public.reverse_fx_lot_transfer(p_transfer_id uuid, p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_t fx_lot_transfers%rowtype; v_row fx_lot_consumptions%rowtype; v_used numeric;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')) then
    raise exception '계좌 대체 취소 권한이 없습니다';
  end if;

  select * into v_t from fx_lot_transfers where id=p_transfer_id for update;
  if not found then raise exception '대체 이력을 찾을 수 없습니다'; end if;

  select coalesce(sum(original_amount - remaining_amount),0) into v_used
    from fx_lots where transfer_id = p_transfer_id;
  if v_used > 0.000001 then
    raise exception '이 대체로 생긴 로트가 이미 % 소진됐습니다 — 해당 처분을 먼저 취소하세요', v_used;
  end if;

  delete from fx_lots where transfer_id = p_transfer_id;

  for v_row in select * from fx_lot_consumptions
    where source_type='transfer' and source_id=p_transfer_id for update
  loop
    update fx_lots set remaining_amount = remaining_amount + v_row.amount where id = v_row.lot_id;
  end loop;
  delete from fx_lot_consumptions where source_type='transfer' and source_id=p_transfer_id;
  delete from fx_lot_transfers where id = p_transfer_id;

  return jsonb_build_object('transfer_id',p_transfer_id,'reversed',true);
end $$;

revoke all on function public.reverse_fx_lot_transfer(uuid,text) from public, anon;
grant execute on function public.reverse_fx_lot_transfer(uuid,text) to authenticated;
