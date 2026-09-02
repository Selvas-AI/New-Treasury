-- ============================================================
-- rls_authenticated_only.sql  (2026-08-26 재작성 — v1 은 폐기)
-- 목적: anon 을 허용하는 모든 정책의 대상 역할을 authenticated 로 전환
--       = "로그인한 사람만 데이터에 접근" (실질 차단)
--
-- ⚠⚠ 운영에 즉시 반영된다. 로컬 개발 서버와 운영이 같은 Supabase 인스턴스라
--    로컬에서 먼저 시험해 볼 수 없다. [1단계] → 확인 → [2단계] 순서를 지킬 것.
--
-- ── v1 이 실패한 이유 (2026-08-26 실측) ──────────────────────
--   v1 은 이름이 allow_all_% 인 정책만 바꿨다. 그런데 실제 DB 에는
--   한 테이블에 정책이 여러 겹 쌓여 있었다. 예: policy_params
--       allow_all_policy_params → authenticated   (v1 이 바꾼 것)
--       allow_all_roles         → anon,...        (남아서 anon 을 그대로 통과시킴)
--   Postgres 는 permissive 정책을 **OR** 로 합치므로 하나만 남아도 무의미하다.
--   daily 는 정책이 7개(allow_all / daily_anon_select/update/delete/insert /
--   allow_all_daily / allow_all_roles)였다.
--
--   또 rate_nego_logs·issue_comments 의 정책은 대상이 **public** 이었다.
--   Postgres 의 public 은 anon 을 포함한 전원이라 `'anon' = any(roles)` 로는 안 잡힌다.
--
-- ── 그래서 이 버전은 ────────────────────────────────────────
--   ① 이름이 아니라 **역할 기준**으로 고른다 (roles 에 anon 또는 public 포함)
--   ② drop+create 가 아니라 **ALTER POLICY ... TO authenticated** 를 쓴다
--      → USING/WITH CHECK 조건식과 명령 종류(SELECT/INSERT/…)가 그대로 보존된다
--        (v1 은 재생성하면서 조건식을 using(true) 로 덮어써 오히려 느슨해질 수 있었다)
--   ③ 변경 전 역할을 rls_backup 스키마에 기록해 **정확한 롤백**을 보장한다
--      (public 스키마가 아니라 Security Advisor 대상도 아니고 PostgREST 에도 안 노출된다)
--
--   fx_* 계열(이미 authenticated 전용)은 조건에 안 걸려 자동으로 제외된다.
--
-- 선행 조건 (모두 충족됨 — 2026-08-26)
--   [0] rls_enable_safe.sql 적용 완료
--   [1] auth_registerable_rpc.sql 적용 완료 ('최초 계정 설정' RPC 이전)
--   [2] 접근코드 로그인 제거분 배포 완료 (anon 로그인 경로 없음)
--
-- 사용자 눈에 보이는 변화: **없다.** 로그인 방식은 그대로다.
--   로그인한 요청은 JWT 를 실어 authenticated 역할로 DB 에 도달한다.
-- ============================================================


-- ============================================================
-- [1단계] 파일럿 — policy_params 한 테이블만 완전히 닫는다
--   v1 파일럿이 놓친 allow_all_roles 까지 포함해 이 테이블의 anon/public 정책 전부.
-- ============================================================
create schema if not exists rls_backup;

create table if not exists rls_backup.policy_roles (
  tablename  text        not null,
  policyname text        not null,
  old_roles  text[]      not null,
  changed_at timestamptz not null default now(),
  primary key (tablename, policyname)
);

do $$
declare
  r       record;
  changed text[] := '{}';
begin
  for r in
    select tablename, policyname, roles
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'policy_params'
      and (roles && array['anon','public']::name[])
  loop
    insert into rls_backup.policy_roles (tablename, policyname, old_roles)
    values (r.tablename, r.policyname, r.roles::text[])
    on conflict (tablename, policyname) do nothing;

    execute format('alter policy %I on public.%I to authenticated;', r.policyname, r.tablename);
    changed := changed || r.policyname;
  end loop;

  raise notice '[파일럿] policy_params 전환 (%): %',
    coalesce(array_length(changed, 1), 0), changed;
end $$;

-- ▶ 여기서 멈추고 확인:
--    · 로그인한 브라우저에서 자금정책 화면이 정상인가
--    · (에이전트가 밖에서) anon 조회 시 0건인가
--   문제가 있으면 맨 아래 [롤백] 을 실행.


-- ============================================================
-- [2단계] 전체 전환 — 파일럿이 확인된 뒤 주석을 풀어 실행
--   public 스키마의 모든 테이블에서 anon/public 을 허용하는 정책을 전부 전환.
-- ============================================================
/*
do $$
declare
  r       record;
  changed text[] := '{}';
begin
  for r in
    select tablename, policyname, roles
    from pg_policies
    where schemaname = 'public'
      and (roles && array['anon','public']::name[])
    order by tablename, policyname
  loop
    insert into rls_backup.policy_roles (tablename, policyname, old_roles)
    values (r.tablename, r.policyname, r.roles::text[])
    on conflict (tablename, policyname) do nothing;

    execute format('alter policy %I on public.%I to authenticated;', r.policyname, r.tablename);
    changed := changed || (r.tablename || '.' || r.policyname);
  end loop;

  raise notice 'authenticated 전용으로 전환 (%건): %',
    coalesce(array_length(changed, 1), 0), changed;
end $$;
*/


-- ============================================================
-- [3단계] 검증
-- ============================================================
-- (a) anon/public 을 허용하는 정책이 남아 있는가 → 0건이어야 한다
/*
select tablename, policyname, roles
from pg_policies
where schemaname = 'public'
  and (roles && array['anon','public']::name[])
order by tablename;
*/

-- (b) 백업에 기록된 변경 내역 (롤백 대상)
/*
select tablename, policyname, old_roles, changed_at
from rls_backup.policy_roles order by tablename, policyname;
*/

-- (c) 앱에서: 로그인 상태 → 대시보드·자금일보·운용자금·자금정책 정상
--             시크릿창(비로그인) → 로그인 화면만, 데이터 조회 불가
--             '최초 계정 설정' 탭 정상 (RPC 경유)


-- ============================================================
-- [롤백] 백업에 기록된 정책의 역할을 원래대로 되돌린다
--   ⚠ 백업에 있는 것만 되돌리므로, 원래부터 authenticated 전용이던
--     fx_* 정책은 절대 열리지 않는다.
-- ============================================================
/*
do $$
declare
  r         record;
  role_list text;
begin
  for r in select tablename, policyname, old_roles from rls_backup.policy_roles loop
    -- public 은 의사역할(pseudo-role)이라 따옴표를 씌우면 안 된다
    select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
      into role_list
    from unnest(r.old_roles) as x;

    execute format('alter policy %I on public.%I to %s;', r.policyname, r.tablename, role_list);
  end loop;
  raise notice '롤백 완료 — 되돌린 정책 수: %', (select count(*) from rls_backup.policy_roles);
end $$;
-- 롤백 후 기록 비우기 (재시도 전에 실행)
-- truncate rls_backup.policy_roles;
*/


-- ============================================================
-- 참고 — 이 전환으로도 남는 것 (다음 과제)
--   · 법인 단위 격리 없음 — 로그인한 사용자는 DB 레벨에선 타 법인 데이터도 읽을 수 있다.
--     화면에서 hasCompany() 로 가리지만 그건 클라이언트 통제다.
--     정책에 treasury_users.companies 대조를 넣어야 한다.
--   · 정책이 한 테이블에 여러 겹 쌓여 있다(daily 7개 등). 동작에는 문제없지만
--     감사·유지보수 관점에서 중복 정리가 필요하다. 정리는 전환 안정화 후 별도로.
-- ============================================================
