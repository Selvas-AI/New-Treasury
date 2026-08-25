-- ============================================================
-- access_codes_retire.sql
-- 목적: 레거시 접근코드 로그인 폐기 (2026-08-26, 사용자 확인 — 9건 모두 미사용)
--
-- 배경: access_codes 는 평문 코드를 anon 으로 대조하는 로그인 경로였다.
--   · 테이블이 anon 으로 읽혀서, 코드만 읽으면 누구나 master 로 로그인 가능했다
--   · Supabase Auth 를 거치지 않아 DB 입장에선 계속 anon
--     → 이 경로가 살아 있는 한 RLS 를 authenticated 전용으로 조일 수 없다
--   클라이언트 코드(loginWithCode / LoginPage 접근코드 탭 / 코드 변경 페이지)는
--   같은 날 제거됐다. 이 스크립트는 DB 쪽을 닫는다.
--
-- ⚠ 실행 순서: docs/db/rls_enable_safe.sql 을 **먼저** 실행할 것.
--   그 스크립트가 정책 없는 테이블에 allow_all_* 를 붙이므로,
--   access_codes 에도 붙는다 → 여기서 그 정책을 걷어낸다.
--
-- ⚠ 테이블은 DROP 하지 않는다. 감사·이력 보존용으로 남기고 접근만 차단한다.
--   (2026-06-25 데이터 삭제 사고 이후 규칙)
-- ============================================================


-- ============================================================
-- [1단계] 현황 확인 (읽기 전용) — 활성 코드가 9건인지 본다
-- ============================================================
/*
select user_name, role, company, is_active, created_at::date, deleted_at
from public.access_codes
order by created_at;
*/


-- ============================================================
-- [2단계] 전량 비활성화 (데이터는 보존)
-- ============================================================
update public.access_codes
   set is_active  = false,
       deleted_at = coalesce(deleted_at, now()),
       updated_at = now()
 where is_active is true;
-- 영향 행 수가 [1단계]의 활성 건수와 같아야 한다.


-- ============================================================
-- [3단계] anon 접근 차단
--   RLS 를 켜고 허용 정책을 모두 제거하면 → anon/authenticated 둘 다 접근 불가.
--   service_role(대시보드·Edge Function)은 RLS 를 우회하므로 필요 시 조회 가능.
-- ============================================================
alter table public.access_codes enable row level security;

drop policy if exists allow_all_access_codes on public.access_codes;

-- 혹시 다른 이름으로 남아 있는 정책까지 모두 제거
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'access_codes'
  loop
    execute format('drop policy %I on public.access_codes;', r.policyname);
    raise notice '삭제한 정책: %', r.policyname;
  end loop;
end $$;


-- ============================================================
-- [4단계] 검증 — 아래가 모두 기대값이어야 한다
-- ============================================================
-- (a) 활성 코드 0건
/*
select count(*) as active_codes from public.access_codes where is_active is true;
*/

-- (b) RLS 켜짐 + 정책 0건  → anon 으로는 한 행도 못 읽는다
/*
select c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p
          where p.schemaname='public' and p.tablename='access_codes') as policy_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname='access_codes';
*/

-- (c) 앱에서 확인: 로그아웃 → 로그인 화면에 '접근 코드' 탭이 없어야 하고,
--     이메일+비밀번호 로그인은 그대로 동작해야 한다.
