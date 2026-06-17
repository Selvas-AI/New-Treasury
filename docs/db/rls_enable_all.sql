-- ============================================================
-- rls_enable_all.sql
-- 목적: Supabase Security Advisor 'rls_disabled_in_public' 경고 해소
--   public 스키마의 모든 테이블에 RLS 활성화 + anon/authenticated 허용 정책 부여
-- 실행 위치: Supabase Dashboard → SQL Editor (1회)
--
-- ⚠ [중요] 보안 수준에 대한 정확한 이해
--   이 앱은 anon 키로 동작한다(레거시 접근코드 로그인, '최초 계정 설정' 사전조회 등).
--   따라서 정책을 permissive(USING true / WITH CHECK true)로 둔다.
--   → RLS는 켜지지만 anon 키 소유자는 여전히 접근 가능.
--   → 이 스크립트의 효과: ① Advisor 경고 해소 ② RLS 토대 마련(추후 정책 강화 가능)
--   → 실데이터를 외부(anon 키 노출)로부터 완전히 가리려면 별도 마이그레이션 필요:
--       · 레거시 access_codes 로그인 경로 폐기
--       · register 사전조회를 SECURITY DEFINER RPC로 이전
--       · 정책을 authenticated 전용으로 전환
--     (로드맵 — CLAUDE.md 참조)
--
-- 멱등(idempotent): 여러 번 실행해도 안전. 기존 정책은 보존되고 allow_all_* 만 재생성.
-- ============================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    -- 1) RLS 활성화 (이미 켜져 있어도 무해)
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);

    -- 2) 허용 정책 재생성 (anon + authenticated, 전체 작업)
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'allow_all_' || r.tablename, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);',
      'allow_all_' || r.tablename, r.tablename
    );
  END LOOP;
END $$;

-- 확인용 — RLS 비활성 테이블이 남아있는지 점검 (결과 0건이면 경고 해소 완료)
-- SELECT tablename FROM pg_tables t
--   WHERE schemaname = 'public'
--     AND NOT (SELECT relrowsecurity FROM pg_class WHERE oid = (quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass);
