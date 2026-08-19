-- 자금일보(운전자금 외화 잔액) ↔ 외화 원장 자동 반영
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경: fx_lots.source_type CHECK 제약에는 이미 'daily_report_item' 이 들어 있었지만
-- (docs/db/fx_lot_ledger.sql), INSERT RLS 정책과 실제로 그 값을 쓰는 코드가 없었다.
-- 이 마이그레이션은 운전자금(daily) 잔액의 전일 대비 증감분을 원장에 반영할 수 있게 한다.
-- 증가분(유입)은 일반 insert(정책만 확장), 감소분(유출)은 기존 매각 FIFO 소진과 동일한
-- 원자적 로직이 필요해 새 RPC를 추가한다. 기존 fx_trade_history 전용 RPC
-- (complete_fx_trade_with_fifo/complete_fx_trade_fill 등)는 손대지 않는다(additive 관례).

-- ── 1. 유입(증가분) — INSERT 정책에 'daily_report_item' 추가 ────────────────────
drop policy if exists fx_lots_insert_authenticated on public.fx_lots;
create policy fx_lots_insert_authenticated on public.fx_lots for insert to authenticated with check (
  source_type in ('opening','manual','adjustment','daily_report_item') and
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or fx_lots.company=any(u.companies)))
);

-- ── 2. 유출(감소분) — 범용 FIFO 소진 RPC ─────────────────────────────────────
-- complete_fx_trade_with_fifo(fx_fifo_trade_rpc.sql) 와 동일한 FIFO 로직이지만
-- source_type/source_id 를 인자로 받아 fx_trade_history 이외의 소스(자금일보 등)에도
-- 쓸 수 있게 범용화했다. 권한은 매각 결정(master/admin/can_approve)보다 낮은
-- 실무 편집 등급(editor 이상)으로 — 이건 "이미 일어난 잔액 변동을 장부에 반영"하는
-- 기록 행위이지 새로운 매각 의사결정이 아니기 때문이다(fx_lots_insert_authenticated 와 동일 등급).
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
    order by acquired_date, created_at, id for update
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

revoke all on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text) from public, anon;
grant execute on function public.consume_fx_lots_for_source(text,text,text,uuid,numeric,numeric,date,text) to authenticated;
