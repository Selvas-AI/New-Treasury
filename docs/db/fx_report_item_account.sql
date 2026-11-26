-- ============================================================
-- fx_report_item_account.sql  (2026-11-26)
-- 자금일보 외화 항목에 **계좌구분(보통예금 / MMDA)** — 원장에 계좌별로 반영
--
-- ▶ 한 번 실행으로 끝납니다. 마지막에 결과표가 나옵니다. 여러 번 실행해도 안전합니다.
--   기존 데이터는 바꾸지 않습니다(컬럼 추가 + 함수 교체만).
--
-- ── 왜 필요한가 (실무 요청) ─────────────────────────────────
--   외화예금을 계좌유형별로 나눠 장부환율을 관리하고 싶다. 원장(fx_lots.account_type)과
--   출금 소진 RPC(p_account_type)는 이미 계좌유형을 지원하는데, 자금일보 항목 반영
--   (sync_report_item_ledger)만 계좌를 넘기지 않았다:
--     · 입금 → 항상 보통예금 로트
--     · 출금 → 계좌 지정 없이 우선순위 FIFO(보통예금·MMDA 가 섞여 빠짐)
--
-- ── 규칙 (기획 docs/기획/자금일보_외화_계좌구분_장부환율_구현기획_2026-11-26.md, Q1~Q3 = A) ──
--   · 입금 → 선택한 계좌유형의 로트. 장부환율 = 입력 환율.
--   · 출금 → **선택한 계좌유형의 로트만** FIFO 소진. 장부환율은 원장 로트가 정한다(입력 안 받음).
--            입력 환율 = 적용환율(결제일 환율) → 환차손익 = 금액 × (적용환율 − 로트 장부환율).
--   · 계좌유형 미지정(기존 항목) → 지금과 똑같다(입금 보통예금 · 출금 우선순위 FIFO). 기존 반영은 건드리지 않는다.
--   · 선택한 계좌 잔액이 부족하면 오류로 알리고 아무것도 바꾸지 않는다(계좌 대체 기록 안내).
--
-- 선행: fx_report_item_ledger.sql, fx_fifo_integrity_and_scope.sql (available_from)
-- ⚠ begin/commit 을 쓰지 않는다 — [0] 에서 멈추면 아무것도 바뀌지 않는다.
-- ============================================================

-- ── [0] 선행 조건 ───────────────────────────────────────────
do $$
declare v_missing text := '';
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='daily_report_items' and column_name='fx_rate') then
    v_missing := v_missing || E'\n  · daily_report_items.fx_rate → docs/db/fx_report_item_ledger.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='fx_lots' and column_name='available_from') then
    v_missing := v_missing || E'\n  · fx_lots.available_from → docs/db/fx_fifo_integrity_and_scope.sql';
  end if;
  if not exists (select 1 from pg_proc where proname='consume_fx_lots_for_source' and pronargs=10) then
    v_missing := v_missing || E'\n  · consume_fx_lots_for_source 10인자 → docs/db/fx_outflow_account_and_reverse.sql';
  end if;
  if v_missing <> '' then
    raise exception E'선행 마이그레이션이 적용되지 않아 중단합니다(아무것도 바뀌지 않았습니다):%', v_missing;
  end if;
end $$;

-- ── [1] 항목에 외화 계좌유형 ─────────────────────────────────
alter table public.daily_report_items add column if not exists fx_account_type text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='daily_report_items_fx_account_type_check') then
    alter table public.daily_report_items
      add constraint daily_report_items_fx_account_type_check
      check (fx_account_type is null or fx_account_type in ('demand_deposit','mmda'));
  end if;
end $$;
comment on column public.daily_report_items.fx_account_type is
  '외화 항목의 원장 계좌유형(demand_deposit=보통예금, mmda=MMDA). 입금은 이 계좌 로트로, 출금은 이 계좌 로트에서만 FIFO 소진. null=기존 방식';

-- ── [2] 동기화 RPC — 계좌유형 반영 ───────────────────────────
create or replace function public.sync_report_item_ledger(
  p_item_id uuid,
  p_txn_date date,
  p_by text default null,
  p_remove boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_item daily_report_items%rowtype; v_report daily_reports%rowtype;
  v_lot fx_lots%rowtype; v_row fx_lot_consumptions%rowtype;
  v_company text; v_reversed int := 0; v_new uuid;
  v_acct text; v_acct_label text; v_avail numeric;
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;

  select * into v_item from daily_report_items where id = p_item_id;
  if found then
    select * into v_report from daily_reports where id = v_item.report_id;
    v_company := v_report.company;
  else
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

  -- ── 반영 대상인가 (fx_report_item_ledger.sql 과 동일) ──
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

  v_acct := v_item.fx_account_type;   -- ★ null = 기존 방식
  v_acct_label := case v_acct when 'mmda' then 'MMDA' when 'demand_deposit' then '보통예금' else null end;

  if v_item.direction = 'in' then
    v_new := gen_random_uuid();
    insert into fx_lots(id,company,currency,acquired_date,original_amount,remaining_amount,
      acq_rate,source_type,source_id,account_type,txn_type,annual_interest_rate,maturity_date,memo,created_by)
    values(v_new, v_company, v_item.currency, p_txn_date, v_item.amount, v_item.amount,
      v_item.fx_rate, 'report_item', v_item.id,
      coalesce(v_acct, 'demand_deposit'),                                  -- ★ 계좌유형
      case when v_item.category = 'interest_income' then 'interest' else 'acquisition' end,
      0, null,
      format('자금일보 %s · %s', v_report.report_date, coalesce(nullif(v_item.memo,''), v_item.category)),
      p_by);
    return jsonb_build_object('applied', true, 'reversed', v_reversed, 'direction', 'in',
      'lot_id', v_new, 'account_type', coalesce(v_acct, 'demand_deposit'));
  end if;

  -- 출금: 계좌유형을 골랐으면 그 계좌 로트만 소진한다. 부족하면 알아들을 수 있는 말로 멈춘다
  --   (consume 의 같은 검사보다 먼저 — 계좌 대체 기록 누락이 가장 흔한 원인이다).
  if v_acct is not null then
    select coalesce(sum(remaining_amount),0) into v_avail
      from fx_lots
     where company=v_company and currency=v_item.currency and account_type=v_acct
       and remaining_amount > 0 and available_from <= p_txn_date;
    if v_avail < v_item.amount then
      raise exception '% % 원장 잔액이 부족합니다(가능 % / 출금 %, 거래일 % 기준). 은행에서 계좌를 옮겼다면 외화거래명세 › 계좌 대체를 먼저 기록하세요',
        v_item.currency, v_acct_label, v_avail, v_item.amount, p_txn_date;
    end if;
  end if;

  perform consume_fx_lots_for_source(
    p_company => v_company, p_currency => v_item.currency,
    p_source_type => 'report_item', p_source_id => v_item.id,
    p_amount => v_item.amount, p_disposal_rate => v_item.fx_rate,
    p_disposed_date => p_txn_date, p_disposed_by => p_by,
    p_txn_type => 'payment', p_account_type => v_acct);                   -- ★ 계좌유형
  return jsonb_build_object('applied', true, 'reversed', v_reversed, 'direction', 'out', 'account_type', v_acct);
end $$;

revoke all on function public.sync_report_item_ledger(uuid,date,text,boolean) from public, anon;
grant execute on function public.sync_report_item_ledger(uuid,date,text,boolean) to authenticated;

-- ── [3] 결과표 ─────────────────────────────────────────────
select 항목, 결과 from (
  select 1 as 순서, '자금일보 항목 외화 계좌유형 컬럼'::text as 항목,
    case when exists(select 1 from information_schema.columns
      where table_name='daily_report_items' and column_name='fx_account_type') then 'OK' else '확인필요' end as 결과
  union all
  select 2, '계좌유형 값 제한(보통예금·MMDA)',
    case when exists(select 1 from pg_constraint where conname='daily_report_items_fx_account_type_check')
      then 'OK' else '확인필요' end
  union all
  select 3, '동기화 RPC 계좌유형 반영',
    case when exists(select 1 from pg_proc where proname='sync_report_item_ledger'
      and prosrc like '%fx_account_type%') then 'OK' else '확인필요' end
  union all
  select 4, '기존 반영 항목(계좌 미지정, 기존 방식 유지)',
    (select count(*)::text || '건' from daily_report_items where fx_rate is not null and fx_account_type is null)
) r order by 순서;
