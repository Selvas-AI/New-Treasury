-- ============================================================
-- rls_enable_safe.sql
-- 목적: Supabase Security Advisor 'rls_disabled_in_public' 경고 해소
--       ⚠ 기존에 제대로 잠가둔 테이블의 정책을 **약화시키지 않으면서**.
--
-- ⛔ docs/db/rls_enable_all.sql 은 실행하지 말 것 (2026-08-26 폐기).
--    그 스크립트는 public 의 **모든** 테이블에
--      CREATE POLICY allow_all_<t> FOR ALL TO anon, authenticated USING (true)
--    를 만든다. Postgres 는 permissive 정책을 OR 로 결합하므로,
--    fx_lots / fx_lot_consumptions / fx_trade_fills / fx_lot_transfers /
--    fx_regime_snapshot_history / fx_ledger_reconcile_ignored 처럼
--    **authenticated 전용으로 잠가둔 테이블이 anon 에게 열린다.**
--    (그 정책들은 세션23~26차에 추가됐고, rls_enable_all.sql 은 그 이전에 쓰였다)
--
-- 이 스크립트의 원칙:
--   · RLS 는 모든 테이블에 켠다.
--   · 허용 정책(allow_all_*)은 **정책이 하나도 없는 테이블에만** 만든다.
--     → 이미 정책이 있는 테이블은 그 정책이 그대로 적용된다(약화 없음).
--
-- ⚠ 보안 수준에 대한 정확한 이해 (rls_enable_all.sql 의 경고와 동일)
--   이 앱은 anon 키로 동작하고 그 키는 빌드된 JS 에 포함되어 공개된다.
--   allow_all_* 가 붙는 테이블은 RLS 를 켜도 **여전히 누구나 읽고 쓸 수 있다.**
--   이 스크립트의 효과는 ① Advisor 경고 해소 ② RLS 토대 마련 뿐이다.
--   실질 차단은 §3(로드맵)의 authenticated 전용 전환이 있어야 한다.
--
-- 멱등(idempotent): 여러 번 실행해도 안전.
-- 실행 위치: Supabase Dashboard → SQL Editor
-- ============================================================


-- ============================================================
-- [1단계] 먼저 이것만 실행해 현황을 확인한다 (읽기 전용)
-- ============================================================
-- RLS 꺼진 테이블 / 정책 개수를 함께 본다.
--   rls_enabled=false            → Advisor 가 경고하는 대상
--   policy_count=0 & rls=true    → 아무도 접근 못 하는 상태(앱이 깨진다)
--   policy_count>0 & rls=false   → 정책이 있는데 적용이 안 되고 있는 상태
/*
select
  c.relname                                   as table_name,
  c.relrowsecurity                            as rls_enabled,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, policy_count, c.relname;
*/


-- ============================================================
-- [2단계] 확인 후 실행 — RLS 활성화 (+ 무정책 테이블에만 허용 정책)
-- ============================================================
do $$
declare
  r         record;
  n_pol     int;
  enabled   text[] := '{}';
  granted   text[] := '{}';
  untouched text[] := '{}';
begin
  for r in
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname
  loop
    select count(*) into n_pol
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = r.relname;

    -- 1) RLS 활성화 (이미 켜져 있으면 무해)
    if not r.relrowsecurity then
      execute format('alter table public.%I enable row level security;', r.relname);
      enabled := enabled || r.relname;
    end if;

    -- 2) 정책이 하나도 없는 테이블만 허용 정책 부여.
    --    ⚠ 정책이 이미 있는 테이블은 절대 건드리지 않는다 — 그게 이 스크립트의 존재 이유다.
    if n_pol = 0 then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
        'allow_all_' || r.relname, r.relname
      );
      granted := granted || r.relname;
    else
      untouched := untouched || r.relname;
    end if;
  end loop;

  raise notice 'RLS 신규 활성화 (%): %',   coalesce(array_length(enabled, 1), 0),   enabled;
  raise notice '허용 정책 부여 (%): %',    coalesce(array_length(granted, 1), 0),   granted;
  raise notice '기존 정책 유지 (%): %',    coalesce(array_length(untouched, 1), 0), untouched;
end $$;


-- ============================================================
-- [3단계] 검증 — 아래 두 쿼리가 모두 0건이어야 한다
-- ============================================================
-- (a) RLS 꺼진 테이블이 남아있는가
/*
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
*/

-- (b) authenticated 전용으로 잠가둔 테이블에 allow_all 이 잘못 붙지 않았는가
--     (rls_enable_all.sql 을 이미 실행했다면 여기서 잡힌다 → 해당 정책을 DROP 할 것)
/*
select tablename, policyname, roles
from pg_policies
where schemaname = 'public'
  and policyname like 'allow\_all\_%'
  and tablename in (
    'fx_lots', 'fx_lot_consumptions', 'fx_trade_fills', 'fx_lot_transfers',
    'fx_regime_snapshot_history', 'fx_ledger_reconcile_ignored'
  );
-- 잡히면:  drop policy allow_all_fx_lots on public.fx_lots;   (테이블별로)
*/
