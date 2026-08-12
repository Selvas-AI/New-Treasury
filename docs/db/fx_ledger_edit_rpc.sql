-- 외화 원장 개시 로트 수정·삭제
-- 소진 이력이 있는 로트는 변경 금지. Supabase Auth 사용자만 허용.
drop function if exists public.update_unconsumed_fx_lot(uuid,date,numeric,numeric,text);
create or replace function public.update_unconsumed_fx_lot(
  p_lot_id uuid,p_acquired_date date,p_amount numeric,p_acq_rate numeric,
  p_account_type text,p_annual_interest_rate numeric,p_maturity_date date,p_memo text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lot fx_lots%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true and role in ('master','admin','editor')) then raise exception '수정 권한이 없습니다'; end if;
  if p_amount<=0 or p_acq_rate<=0 then raise exception '금액과 장부환율은 0보다 커야 합니다'; end if;
  -- mmda(수시입출식 고금리 예금) 추가. 환전 가능성은 보통예금과 동일하고 만기는 없다.
  if p_account_type not in ('demand_deposit','term_deposit','mmda') then raise exception '계좌 유형이 올바르지 않습니다'; end if;
  if p_annual_interest_rate<0 then raise exception '연이율은 0 이상이어야 합니다'; end if;
  if p_account_type='term_deposit' and (p_maturity_date is null or p_maturity_date<p_acquired_date) then raise exception '정기예금 만기일을 확인하세요'; end if;
  select * into v_lot from fx_lots where id=p_lot_id for update;
  if not found then raise exception '로트를 찾을 수 없습니다'; end if;
  if exists(select 1 from fx_lot_consumptions where lot_id=p_lot_id) then raise exception '소진 이력이 있는 로트는 수정할 수 없습니다'; end if;
  update fx_lots set acquired_date=p_acquired_date,original_amount=p_amount,
    remaining_amount=p_amount,acq_rate=p_acq_rate,account_type=p_account_type,
    annual_interest_rate=p_annual_interest_rate,maturity_date=case when p_account_type='term_deposit' then p_maturity_date else null end,
    memo=p_memo where id=p_lot_id;
  return jsonb_build_object('lot_id',p_lot_id,'updated',true);
end $$;

create or replace function public.delete_unconsumed_fx_lot(p_lot_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lot fx_lots%rowtype;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if not exists(select 1 from treasury_users where id=auth.uid() and is_active=true
    and (role in ('master','admin') or can_delete=true)) then raise exception '삭제 권한이 없습니다'; end if;
  select * into v_lot from fx_lots where id=p_lot_id for update;
  if not found then raise exception '로트를 찾을 수 없습니다'; end if;
  if exists(select 1 from fx_lot_consumptions where lot_id=p_lot_id) then raise exception '소진 이력이 있는 로트는 삭제할 수 없습니다'; end if;
  delete from fx_lots where id=p_lot_id;
  return jsonb_build_object('lot_id',p_lot_id,'deleted',true);
end $$;

revoke all on function public.update_unconsumed_fx_lot(uuid,date,numeric,numeric,text,numeric,date,text) from public,anon;
revoke all on function public.delete_unconsumed_fx_lot(uuid) from public,anon;
grant execute on function public.update_unconsumed_fx_lot(uuid,date,numeric,numeric,text,numeric,date,text) to authenticated;
grant execute on function public.delete_unconsumed_fx_lot(uuid) to authenticated;
