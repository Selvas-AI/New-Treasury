-- ============================================================
-- fx_report_item_ledger.sql  (2026-11-25)
-- 자금일보 외화 입·출금 항목 → 외화거래명세(원장) **항목 단위 자동 반영**
--
-- ▶ 한 번 실행으로 끝납니다. 마지막에 결과표가 나옵니다. 여러 번 실행해도 안전합니다.
--
-- ── 왜 필요한가 (실무 리포트) ───────────────────────────────
--   같은 외화 거래를 두 번 입력하고 있었다 — 자금일보에 한 번, 외화거래명세에 환율과 함께 또 한 번.
--   기존 "자금일보 미반영 증감" 패널은 **일자별 잔액 차이**를 불러와 환율 하나만 받으므로
--     · 같은 날 출금이 여러 건이고 장부환율이 서로 달라도 한 환율로 합쳐졌고
--     · 잔액 차이라 실제 입력한 항목 금액과 달라 보였다(EUR 85,996 vs 입력 87,823).
--   → 자금일보 항목에 환율을 함께 입력하면, **그 항목 그대로** 원장에 반영한다.
--
-- ── 규칙 ────────────────────────────────────────────────────
--   · 유입 항목 → 새 로트(보통예금). 장부환율 = 입력한 환율.
--   · 유출 항목 → FIFO 소진(대외 지급). 처분환율 = 입력한 환율.
--   · 원장 날짜 = **거래일**(자금일보 보고대상일 = 작성일의 전영업일). 화면이 계산해 넘긴다
--     (공휴일 달력이 클라이언트에만 있다). 서버는 작성일 이전 14일 이내인지만 확인한다.
--   · 항목을 고치거나 지우면 **이전 반영을 되돌리고 다시 반영**한다(동기화).
--     ⚠ 이미 일부가 처분된 유입 로트는 되돌릴 수 없다 — 오류로 알리고 아무것도 바꾸지 않는다.
--   · 반영하지 않는 항목: 원화 · 투자자산평가(평가손익은 현금이 아님) ·
--     투자 집행/투자금 회수(외화 정기예금 가입·해지는 운용자금 처리 때 원장에 이미 반영된다).
--   · 원장 쪽 구분: source_type = 'report_item', source_id = 자금일보 항목 id.
--     기존 일자별 반영('daily_report_item', source_id = daily 행 id)과 섞이지 않는다.
--     "자금일보 미반영 증감" 패널은 이 반영분을 거래일로 차감하므로 이중 반영되지 않는다.
--
-- 선행: fx_outflow_account_and_reverse.sql (consume_fx_lots_for_source 10인자), fx_txn_type.sql
-- ⚠ begin/commit 을 쓰지 않는다 — 한 요청의 암묵 트랜잭션이라 [0] 에서 멈추면 아무것도 바뀌지 않는다.
-- ============================================================

-- ── [0] 선행 조건 ───────────────────────────────────────────
do $$
declare v_missing text := '';
begin
  if not exists (select 1 from pg_proc where proname='consume_fx_lots_for_source' and pronargs=10) then
    v_missing := v_missing || E'\n  · consume_fx_lots_for_source 10인자 → docs/db/fx_outflow_account_and_reverse.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fx_lots' and column_name='txn_type') then
    v_missing := v_missing || E'\n  · fx_lots.txn_type → docs/db/fx_txn_type.sql';
  end if;
  if v_missing <> '' then
    raise exception E'선행 마이그레이션이 적용되지 않아 중단합니다(아무것도 바뀌지 않았습니다):%', v_missing;
  end if;
end $$;

-- ── [1] 항목에 환율 ─────────────────────────────────────────
alter table public.daily_report_items add column if not exists fx_rate numeric;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='daily_report_items_fx_rate_positive') then
    alter table public.daily_report_items
      add constraint daily_report_items_fx_rate_positive check (fx_rate is null or fx_rate > 0);
  end if;
end $$;
comment on column public.daily_report_items.fx_rate is
  '외화 항목의 적용 환율(원/1외화). 있으면 외화거래명세 원장에 항목 단위로 반영된다(sync_report_item_ledger)';

-- ── [2] 원장 로트 출처에 'report_item' 추가 ─────────────────
alter table public.fx_lots drop constraint if exists fx_lots_source_type_check;
alter table public.fx_lots add constraint fx_lots_source_type_check
  check (source_type in ('opening','daily_report_item','manual','adjustment',
                         'transfer','interest','investment','report_item'));

-- ── [3] 동기화 RPC ──────────────────────────────────────────
create or replace function public.sync_report_item_ledger(
  p_item_id uuid,
  p_txn_date date,
  p_by text default null,
  p_remove boolean default false   -- true = 반영만 되돌린다(항목 삭제 직전 호출)
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item daily_report_items%rowtype; v_report daily_reports%rowtype;
  v_lot fx_lots%rowtype; v_row fx_lot_consumptions%rowtype;
  v_company text; v_reversed int := 0; v_new uuid;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;

  select * into v_item from daily_report_items where id = p_item_id;
  if found then
    select * into v_report from daily_reports where id = v_item.report_id;
    v_company := v_report.company;
  else
    -- 항목이 이미 없으면 원장 쪽에서 법인을 찾는다(되돌리기만 가능)
    select company into v_company from fx_lots where source_type='report_item' and source_id=p_item_id limit 1;
    if v_company is null then
      select company into v_company from fx_lot_consumptions where source_type='report_item' and source_id=p_item_id limit 1;
    end if;
    if v_company is null then return jsonb_build_object('applied', false, 'reason', '항목 없음'); end if;
  end if;

  if not exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or v_company=any(u.companies))) then
    raise exception '이 법인(%)의 원장 반영 권한이 없습니다', v_company;
  end if;

  -- ── 기존 반영 되돌리기 ──
  for v_lot in select * from fx_lots where source_type='report_item' and source_id=p_item_id for update
  loop
    if v_lot.remaining_amount < v_lot.original_amount - 0.000001 then
      raise exception '이 유입(%)은 이미 % 이 처분돼 자동으로 고칠 수 없습니다 — 외화거래명세에서 처분 내역을 먼저 정리하세요',
        v_lot.acquired_date, v_lot.original_amount - v_lot.remaining_amount;
    end if;
    delete from fx_lots where id = v_lot.id;
    v_reversed := v_reversed + 1;
  end loop;
  for v_row in select * from fx_lot_consumptions where source_type='report_item' and source_id=p_item_id for update
  loop
    update fx_lots set remaining_amount = remaining_amount + v_row.amount where id = v_row.lot_id;
    v_reversed := v_reversed + 1;
  end loop;
  delete from fx_lot_consumptions where source_type='report_item' and source_id=p_item_id;

  if p_remove or v_item.id is null then
    return jsonb_build_object('applied', false, 'reversed', v_reversed, 'reason', '반영 해제');
  end if;

  -- ── 반영 대상인가 ──
  if v_item.currency = 'KRW' then
    return jsonb_build_object('applied', false, 'reversed', v_reversed, 'reason', '원화 항목');
  end if;
  if v_item.category in ('invest_eval_in','invest_eval_out','invest_execute','invest_return') then
    return jsonb_build_object('applied', false, 'reversed', v_reversed, 'reason', '원장 반영 대상 아님');
  end if;
  if v_item.fx_rate is null or v_item.fx_rate <= 0 then
    return jsonb_build_object('applied', false, 'reversed', v_reversed, 'reason', '환율 미입력');
  end if;
  if v_item.amount is null or v_item.amount <= 0 then
    return jsonb_build_object('applied', false, 'reversed', v_reversed, 'reason', '금액 없음');
  end if;
  if p_txn_date is null or p_txn_date > v_report.report_date or p_txn_date < v_report.report_date - 14 then
    raise exception '거래일(%)이 자금일보 작성일(%) 기준 범위를 벗어났습니다', p_txn_date, v_report.report_date;
  end if;

  if v_item.direction = 'in' then
    v_new := gen_random_uuid();
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,account_type,txn_type,annual_interest_rate,maturity_date,memo,created_by)
    values(v_new, v_company, v_item.currency, p_txn_date, v_item.amount, v_item.amount,
      v_item.fx_rate, 'report_item', v_item.id, 'demand_deposit',
      case when v_item.category = 'interest_income' then 'interest' else 'acquisition' end,
      0, null,
      format('자금일보 %s · %s', v_report.report_date, coalesce(nullif(v_item.memo,''), v_item.category)),
      p_by);
    return jsonb_build_object('applied', true, 'reversed', v_reversed, 'direction', 'in', 'lot_id', v_new);
  end if;

  -- 유출: FIFO 소진(대외 지급). 잔액이 부족하면 예외 → 위 되돌리기까지 전부 취소된다.
  perform consume_fx_lots_for_source(
    p_company => v_company, p_currency => v_item.currency,
    p_source_type => 'report_item', p_source_id => v_item.id,
    p_amount => v_item.amount, p_disposal_rate => v_item.fx_rate,
    p_disposed_date => p_txn_date, p_disposed_by => p_by,
    p_txn_type => 'payment', p_account_type => null);
  return jsonb_build_object('applied', true, 'reversed', v_reversed, 'direction', 'out');
end $$;

revoke all on function public.sync_report_item_ledger(uuid,date,text,boolean) from public, anon;
grant execute on function public.sync_report_item_ledger(uuid,date,text,boolean) to authenticated;

-- ── [4] 결과표 ─────────────────────────────────────────────
select 항목, 결과 from (
  select 1 as 순서, '자금일보 항목 환율 컬럼'::text as 항목,
    case when exists(select 1 from information_schema.columns
      where table_name='daily_report_items' and column_name='fx_rate') then 'OK' else '확인필요' end as 결과
  union all
  select 2, '원장 출처 report_item 허용',
    case when exists(select 1 from pg_constraint where conname='fx_lots_source_type_check'
      and pg_get_constraintdef(oid) like '%report_item%') then 'OK' else '확인필요' end
  union all
  select 3, '동기화 RPC',
    case when exists(select 1 from pg_proc where proname='sync_report_item_ledger') then 'OK' else '확인필요' end
) r order by 순서;
