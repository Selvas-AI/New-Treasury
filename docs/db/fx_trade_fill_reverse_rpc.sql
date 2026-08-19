-- 외화매매거래 개별 체결(fill) 1건만 취소(원복)
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경: docs/db/fx_trade_partial_fill_migration.sql 의 reverse_fx_trade() 는 매각 지시
-- 전체(모든 체결)를 한 번에 원복한다. 실무에서는 "3차 체결만 오기재했다"처럼 특정 체결
-- 1건만 되돌리고 나머지 체결은 유지해야 하는 경우가 있다 — 그때마다 지시 전체를 취소하고
-- 처음부터 다시 체결 등록하는 건 과도하다.
--
-- 이 함수는 fx_trade_fills 1행 + 그 fill_id 로 연결된 fx_lot_consumptions 만 되돌리고,
-- 남은 체결들로 fx_trade_history 의 누적값(filled_amount/completed_rate/completed_pnl)을
-- 다시 계산한다. 남은 체결이 하나도 없으면 승인 이전 상태(승인됐으면 '승인', 아니면 '발의')로
-- 되돌린다.

create or replace function public.reverse_fx_trade_fill(p_fill_id uuid, p_reversed_by text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fill fx_trade_fills%rowtype; v_trade fx_trade_history%rowtype; v_row fx_lot_consumptions%rowtype;
  v_new_filled numeric; v_new_rate numeric; v_new_pnl numeric; v_new_status text;
  v_last_fill fx_trade_fills%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_approve=true)) then
    raise exception '체결 취소 권한이 없습니다';
  end if;

  select * into v_fill from fx_trade_fills where id=p_fill_id for update;
  if not found then raise exception '체결 내역을 찾을 수 없습니다'; end if;

  select * into v_trade from fx_trade_history where id=v_fill.trade_id for update;
  if not found or v_trade.status not in ('부분체결','완료') then
    raise exception '부분체결 또는 완료 상태의 지시만 개별 체결을 취소할 수 있습니다';
  end if;

  -- 이 체결이 소진한 로트 복원
  for v_row in select * from fx_lot_consumptions where fill_id=p_fill_id for update
  loop update fx_lots set remaining_amount=remaining_amount+v_row.amount where id=v_row.lot_id; end loop;
  delete from fx_lot_consumptions where fill_id=p_fill_id;
  delete from fx_trade_fills where id=p_fill_id;

  -- 남은 체결들로 지시 누적값 재계산
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
    -- 남은 체결이 없으면 체결 이전 상태로 복귀
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
