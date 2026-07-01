-- 비밀번호 정책 컬럼 추가 (세션18차)
-- master가 사용자 비밀번호를 초기화(임시 비밀번호 selvas11@)하면 true로 설정 →
-- 해당 계정은 다음 로그인 시 새 비밀번호를 설정하기 전까지 다른 화면 접근 불가
-- (클라이언트 Layout.tsx의 ForcePasswordChangeGate가 게이트 역할)

ALTER TABLE treasury_users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 참고: docs/db/rls_enable_all.sql 로 이미 treasury_users에 anon+authenticated
-- permissive UPDATE 정책이 적용돼 있다면 이 컬럼에 대해 별도 정책 추가는 불필요.
-- (본인 비밀번호 변경 시 클라이언트가 email 매치 조건으로 이 컬럼만 false로 갱신)
