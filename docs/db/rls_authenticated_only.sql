-- ============================================================
-- rls_authenticated_only.sql
-- 목적: permissive 정책의 대상 역할을 anon → authenticated 로 전환
--       = "로그인한 사람만 데이터에 접근" (실질 차단)
--
-- ⚠⚠ 이 스크립트는 **운영에 즉시 반영된다.** 로컬 개발 서버와 운영 사이트가
--    같은 Supabase 인스턴스를 쓰므로, 로컬에서 먼저 시험해 볼 수 없다.
--    아래 순서를 반드시 지킬 것. [0]/[1] 선행 없이 [3]을 실행하지 말 것.
--
-- 선행 조건 (모두 충족돼야 함)
--   [0] docs/db/rls_enable_safe.sql 적용 완료          (allow_all_* 존재)
--   [1] docs/db/auth_registerable_rpc.sql 적용 완료    ('최초 계정 설정' RPC 이전)
--   [2] 접근코드 로그인 제거 배포 완료                  (anon 로그인 경로 없음)
--
-- 사용자 눈에 보이는 변화: **없다.** 로그인 방식(이메일+비밀번호)은 그대로다.
--   이미 로그인한 요청은 JWT 를 실어 authenticated 역할로 DB 에 도달한다.
-- ============================================================


-- ============================================================
-- [1단계] 파일럿 — 테이블 하나만 전환해 앱이 정상인지 확인
--   policy_params 를 고른 이유: 읽기 위주이고, 잘못돼도 자금 입력/일보 작성이
--   막히지 않아 되돌릴 여유가 있다.
-- ============================================================
drop policy if exists allow_all_policy_params on public.policy_params;
create policy allow_all_policy_params on public.policy_params
  for all to authenticated using (true) with check (true);

-- ▶ 여기서 멈추고 확인할 것:
--    · 로그인한 브라우저에서 자금정책 화면이 정상 표시되는가
--    · 로그아웃(또는 시크릿창)에서 REST 직접 조회 시 0건인가
--   문제가 있으면 아래 롤백을 즉시 실행:
/*
drop policy if exists allow_all_policy_params on public.policy_params;
create policy allow_all_policy_params on public.policy_params
  for all to anon, authenticated using (true) with check (true);
*/


-- ============================================================
-- [2단계] 전체 전환 — allow_all_* 를 모두 authenticated 전용으로 재생성
--   ⚠ allow_all_ 로 시작하는 정책만 건드린다. 손으로 만든 정책
--     (fx_lots_* 등 authenticated 전용)은 그대로 둔다.
-- ============================================================
/*
do $$
declare
  r       record;
  changed text[] := '{}';
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'allow\\_all\\_%'
      and 'anon' = any(roles)
  loop
    execute format('drop policy %I on public.%I;', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true);',
      r.policyname, r.tablename
    );
    changed := changed || r.tablename;
  end loop;
  raise notice 'authenticated 전용으로 전환 (%): %',
    coalesce(array_length(changed, 1), 0), changed;
end $$;
*/


-- ============================================================
-- [3단계] 검증
-- ============================================================
-- (a) anon 이 남아 있는 정책이 없어야 한다 (0건)
/*
select tablename, policyname, roles
from pg_policies
where schemaname = 'public' and 'anon' = any(roles)
order by tablename;
*/

-- (b) 앱에서: 로그인 상태 → 대시보드·자금일보·운용자금 정상
--             시크릿창(비로그인) → 로그인 화면만 보이고 데이터 조회 불가
-- (c) '최초 계정 설정' 탭이 여전히 동작하는지 (RPC 경유 — [1] 선행 필수)


-- ============================================================
-- [롤백] 전체 되돌리기 — 문제가 생기면 즉시 실행
-- ============================================================
/*
do $$
declare r record;
begin
  for r in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'allow\\_all\\_%'
      and not ('anon' = any(roles))
  loop
    execute format('drop policy %I on public.%I;', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (true) with check (true);',
      r.policyname, r.tablename
    );
  end loop;
end $$;
*/


-- ============================================================
-- 참고 — 이 전환으로도 남는 것
--   · fx_trade_history 는 allow_all 로 열려 있다(자식 fx_trade_fills 는 authenticated 전용).
--     전환 후엔 둘 다 authenticated 가 되지만, 법인 단위 격리는 여전히 없다
--     = 로그인한 사용자는 자기 법인이 아닌 데이터도 DB 레벨에선 읽을 수 있다.
--     (화면에서는 hasCompany() 로 가리지만 그건 클라이언트 통제다)
--   · 법인 단위 격리까지 하려면 정책에 treasury_users.companies 대조를 넣어야 한다 — 다음 과제.
-- ============================================================
