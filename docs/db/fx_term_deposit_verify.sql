-- ═══════════════════════════════════════════════════════════════════════════
-- 외화 정기예금 연동 — 적용 상태 검증 (읽기 전용)               (2026-09-15)
--
--   전체 선택 → Run. 마지막 결과표의 '판정' 열만 보면 된다.
--   전부 OK 면 운용자금 연장·만기처리의 "외화거래명세에도 함께 반영"이 동작한다.
--
--   ⚠ 이 검증이 필요한 이유: plpgsql 함수는 **생성 시점에 본문의 컬럼 존재를
--     검사하지 않는다.** 선행 마이그레이션이 빠진 채로 함수를 만들어도 SQL Editor 는
--     "Success" 를 보여주고, 실제로 정기예금을 해지하는 순간에야 실패한다.
--     RPC 를 호출해 확인하지 말 것(개발 브라우저에 관리자 세션이 살아 있어 권한
--     검사를 통과한다 — 세션24차 §5.1). 아래처럼 카탈로그를 SELECT 로 확인한다.
-- ═══════════════════════════════════════════════════════════════════════════

with chk as (
  -- ① txn_type 컬럼 — fx_txn_type.sql 적용 여부. 없으면 해지·대체가 런타임에 실패한다.
  select 1 as 순서, 'fx_lots.txn_type 컬럼' as 점검,
         (select count(*) from information_schema.columns
          where table_schema='public' and table_name='fx_lots' and column_name='txn_type')::text as 실측,
         '1' as 기대, 'fx_txn_type.sql' as 관련파일
  union all
  select 2, 'fx_lot_consumptions.txn_type 컬럼',
         (select count(*) from information_schema.columns
          where table_schema='public' and table_name='fx_lot_consumptions' and column_name='txn_type')::text,
         '1', 'fx_txn_type.sql'
  union all
  -- ② 계좌 대체 인프라 — fx_lot_transfer.sql
  select 3, 'fx_lot_transfers 테이블',
         (select count(*) from information_schema.tables
          where table_schema='public' and table_name='fx_lot_transfers')::text,
         '1', 'fx_lot_transfer.sql'
  union all
  select 4, 'fx_lots.transfer_id 컬럼',
         (select count(*) from information_schema.columns
          where table_schema='public' and table_name='fx_lots' and column_name='transfer_id')::text,
         '1', 'fx_lot_transfer.sql'
  union all
  select 5, 'fx_lots.investment_id 컬럼',
         (select count(*) from information_schema.columns
          where table_schema='public' and table_name='fx_lots' and column_name='investment_id')::text,
         '1', 'fx_lot_transfer.sql'
  union all
  -- ③ settle_fx_term_deposit — 반드시 15인자 **1개만**.
  --    구 14인자 버전이 남아 있으면 호출이 모호해져 클라이언트가 어느 쪽으로 갈지 모른다.
  select 6, 'settle_fx_term_deposit 오버로드 수',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='settle_fx_term_deposit'),
         '1', 'fx_term_deposit_investment_link.sql (drop 후 재생성)'
  union all
  select 7, 'settle_fx_term_deposit 인자 수',
         coalesce((select string_agg(p.pronargs::text, ', ' order by p.pronargs)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='settle_fx_term_deposit'), '없음'),
         '15', 'fx_term_deposit_investment_link.sql'
  union all
  select 8, 'settle 에 p_interest_account_type 인자',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='settle_fx_term_deposit'
            and 'p_interest_account_type' = any(p.proargnames)),
         '1', 'fx_term_deposit_investment_link.sql'
  union all
  -- ④ transfer_fx_lots — 13인자 1개.
  select 9, 'transfer_fx_lots 인자 수',
         coalesce((select string_agg(p.pronargs::text, ', ' order by p.pronargs)
                   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                   where n.nspname='public' and p.proname='transfer_fx_lots'), '없음'),
         '13', 'fx_lot_transfer.sql / investment_link.sql'
  union all
  -- ⑤ 만기 도래분 우선 소진 — investment_link.sql 판본인지 (구판은 취득일 순뿐)
  select 10, '만기 도래분 우선 소진 반영',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='transfer_fx_lots'
            and p.prosrc like '%maturity_date <= p_transfer_date%then 0 else 1%'),
         '1', 'fx_term_deposit_investment_link.sql'
  union all
  -- ⑥ 재예치 자기 소진 방어 — 없으면 정기예금→정기예금 재예치가 방금 만든 로트를 다시 깬다
  select 11, '재예치 자기 소진 방어',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='transfer_fx_lots'
            and p.prosrc like '%transfer_id <> v_transfer_id%'),
         '1', 'fx_transfer_selfconsume_guard.sql (link 판본에 포함)'
  union all
  -- ⑦ FIFO 계좌유형 우선순위 헬퍼 (선택 — 없어도 취득일 FIFO 로 정상 동작)
  select 12, '[선택] fx_fifo_account_rank 헬퍼',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='fx_fifo_account_rank'),
         '1', 'fx_fifo_account_priority.sql (선택)'
)
select 점검,
       실측,
       기대,
       case when 실측 = 기대 then 'OK'
            when 순서 = 12   then '선택 - 없어도 동작'
            else '누락 → ' || 관련파일 end as 판정
from chk order by 순서;
