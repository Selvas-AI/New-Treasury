-- ============================================================
-- rls_diagnose.sql  (2026-09-02)
-- 목적: "new row violates row-level security policy for table \"daily\"" 원인 확인
--       — 읽기 전용. 아무 것도 바꾸지 않는다.
--
-- 배경: 2026-08-26 rls_authenticated_only.sql 로 anon 을 전부 차단했다.
--   그 뒤 운전자금 입력에서 위 오류가 실사용자에게 보고됐다(2026-09-02).
--   원인 후보는 둘뿐이다:
--     (A) 요청이 anon 으로 도달했다  → 클라이언트 세션 문제
--         (수정 완료: src/lib/supabase.ts 의 anon 키 폴백 제거)
--     (B) authenticated 에 INSERT 를 허용하는 정책이 없다 → 아래 [2] 가 0건
--   [2] 가 1건 이상이면 (A) 가 원인이다.
-- ============================================================

-- [1] daily 테이블의 전체 정책 — 명령/역할/permissive 여부
select policyname, cmd, permissive, roles, qual as using_expr, with_check
from pg_policies
where schemaname = 'public' and tablename = 'daily'
order by cmd, policyname;

-- [2] authenticated 가 INSERT 할 수 있는 permissive 정책 (1건 이상이어야 정상)
select count(*) as insert_policies_for_authenticated
from pg_policies
where schemaname = 'public' and tablename = 'daily'
  and permissive = 'PERMISSIVE'
  and cmd in ('INSERT', 'ALL')
  and roles && array['authenticated','public']::name[];

-- [3] anon/public 이 아직 남아 있는 정책 (전환이 끝났다면 0건)
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and (roles && array['anon','public']::name[])
order by tablename, policyname;

-- [4] RESTRICTIVE 정책 — 있으면 AND 로 결합돼 단독으로 INSERT 를 막을 수 있다
select tablename, policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public' and permissive = 'RESTRICTIVE'
order by tablename, policyname;

-- ▶ 판정
--   [2] >= 1 이고 [4] 에 daily 관련 항목이 없다 → 서버는 정상. 원인은 (A) 클라이언트 세션.
--   [2]  = 0                                   → 원인은 (B). rls_authenticated_only.sql 의
--                                                [롤백] 을 실행해 되돌린 뒤 재적용할 것.
