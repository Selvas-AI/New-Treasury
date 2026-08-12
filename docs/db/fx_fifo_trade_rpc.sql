-- 환전 완료 ↔ FIFO 소진 원자적 처리
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다.
-- 보안: Supabase Auth authenticated 세션만 실행 가능. anon/레거시 접근코드는 불가.

create or replace function public.complete_fx_trade_with_fifo(
  p_trade_id uuid, p_completed_rate numeric, p_completed_by text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_trade fx_trade_history%rowtype; v_lot fx_lots%rowtype;
  v_need numeric; v_take numeric; v_pnl numeric := 0;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_approve=true)) then
    raise exception '환전 완료 권한이 없습니다';
  end if;
  if p_completed_rate <= 0 then raise exception '체결환율은 0보다 커야 합니다'; end if;
  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found then raise exception '환전 이력을 찾을 수 없습니다'; end if;
  if v_trade.direction <> 'sell' then raise exception '매도 거래만 FIFO 소진할 수 있습니다'; end if;
  if v_trade.status = '완료' then raise exception '이미 완료된 거래입니다'; end if;
  v_need := v_trade.amount_fx;
  for v_lot in select * from fx_lots
    where company=v_trade.company and currency=v_trade.currency and remaining_amount>0
      -- ⚠ 화이트리스트('demand_deposit'만 허용)로 쓰면 mmda 처럼 새 유형이 추가될 때
      --    maturity_date 가 null 이라 조건이 NULL → 조용히 FIFO 후보에서 빠진다.
      --    잠기는 유형(term_deposit)만 명시해 뒤집는다.
      and (account_type <> 'term_deposit' or maturity_date <= v_trade.trade_date)
    order by acquired_date, created_at, id for update
  loop
    exit when v_need <= 0; v_take := least(v_need, v_lot.remaining_amount);
    insert into fx_lot_consumptions(id,company,currency,lot_id,disposed_date,amount,acq_rate,
      disposal_rate,realized_pnl,method,source_type,source_id,memo,created_by)
    values(gen_random_uuid(),v_trade.company,v_trade.currency,v_lot.id,v_trade.trade_date,v_take,
      v_lot.acq_rate,p_completed_rate,(p_completed_rate-v_lot.acq_rate)*v_take,'FIFO',
      'fx_trade_history',v_trade.id,'환전 완료 자동 FIFO 소진',p_completed_by);
    update fx_lots set remaining_amount=remaining_amount-v_take where id=v_lot.id;
    v_pnl := v_pnl+(p_completed_rate-v_lot.acq_rate)*v_take; v_need := v_need-v_take;
  end loop;
  if v_need > 0.000001 then raise exception 'FIFO 잔액 부족: %', v_need; end if;
  update fx_trade_history set status='완료', completed_rate=p_completed_rate,
    completed_pnl=round(v_pnl), completed_at=now(), completed_by=p_completed_by where id=p_trade_id;
  return jsonb_build_object('trade_id',p_trade_id,'realized_pnl',round(v_pnl));
end $$;

create or replace function public.reverse_completed_fx_trade(p_trade_id uuid,p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_trade fx_trade_history%rowtype; v_row fx_lot_consumptions%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_approve=true)) then
    raise exception '완료 거래 원복 권한이 없습니다';
  end if;
  select * into v_trade from fx_trade_history where id=p_trade_id for update;
  if not found or v_trade.status <> '완료' then raise exception '완료 거래가 아닙니다'; end if;
  for v_row in select * from fx_lot_consumptions
    where source_type='fx_trade_history' and source_id=p_trade_id for update
  loop update fx_lots set remaining_amount=remaining_amount+v_row.amount where id=v_row.lot_id; end loop;
  delete from fx_lot_consumptions where source_type='fx_trade_history' and source_id=p_trade_id;
  update fx_trade_history set status='취소',completed_rate=null,completed_pnl=null,
    completed_at=null,completed_by=null,memo=concat(coalesce(memo,''),' · FIFO 원복: ',p_reversed_by)
  where id=p_trade_id;
  return jsonb_build_object('trade_id',p_trade_id,'reversed',true);
end $$;

revoke all on function public.complete_fx_trade_with_fifo(uuid,numeric,text) from public, anon;
revoke all on function public.reverse_completed_fx_trade(uuid,text) from public, anon;
grant execute on function public.complete_fx_trade_with_fifo(uuid,numeric,text) to authenticated;
grant execute on function public.reverse_completed_fx_trade(uuid,text) to authenticated;

-- 원장 RLS: 로그인 사용자에게 허용 법인 조회, 편집 역할에게 개시 로트 등록만 허용.
drop policy if exists fx_lots_select_authenticated on public.fx_lots;
create policy fx_lots_select_authenticated on public.fx_lots for select to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (coalesce(array_length(u.companies,1),0)=0 or fx_lots.company=any(u.companies)))
);
drop policy if exists fx_lots_insert_authenticated on public.fx_lots;
create policy fx_lots_insert_authenticated on public.fx_lots for insert to authenticated with check (
  source_type in ('opening','manual','adjustment') and
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or fx_lots.company=any(u.companies)))
);
drop policy if exists fx_consumptions_select_authenticated on public.fx_lot_consumptions;
create policy fx_consumptions_select_authenticated on public.fx_lot_consumptions for select to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (coalesce(array_length(u.companies,1),0)=0 or fx_lot_consumptions.company=any(u.companies)))
);
