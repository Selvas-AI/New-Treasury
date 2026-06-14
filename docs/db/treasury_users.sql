-- ============================================================
-- treasury_users — Supabase Auth 기반 사용자 권한 프로필
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 주의: Supabase Auth 활성화 후 실행 (auth.users 테이블 존재 필요)
-- ============================================================

CREATE TABLE IF NOT EXISTS treasury_users (
  -- Supabase auth.users.id 와 동일한 UUID 사용 (PK)
  id           uuid        PRIMARY KEY,
  email        text        UNIQUE NOT NULL,
  name         text        NOT NULL,

  -- 감사 추적용 단축 코드 (결재이력·스레드 author 식별자)
  -- 예: 'KIM01', 'LEE02' — 영문+숫자 3~8자 권장
  user_code    text        UNIQUE NOT NULL,

  -- 역할 계층: master > admin > editor > viewer
  role         text        NOT NULL DEFAULT 'viewer',
  CONSTRAINT user_role_check CHECK (role IN ('master','admin','editor','viewer')),

  -- 접근 허용 법인 (빈 배열 = 역할 기본값 적용)
  --   master/admin: 빈 배열이면 전체 법인 접근
  --   editor/viewer: 명시된 법인만 접근
  companies    text[]      NOT NULL DEFAULT '{}',

  -- 허용 메뉴 slug 목록 (NULL = 역할 기본값, '{}' = 전체 차단)
  -- slug 예: 'dashboard','daily','input','invest','loans','equity','history','fx','policy'
  menus        text[],

  -- 세분화 권한 플래그
  can_delete   bool        NOT NULL DEFAULT false,
  can_approve  bool        NOT NULL DEFAULT false,

  is_active    bool        NOT NULL DEFAULT true,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

COMMENT ON TABLE  treasury_users IS '통합 자금시스템 사용자 권한 프로필 (Supabase Auth 연동)';
COMMENT ON COLUMN treasury_users.id        IS 'auth.users.id 와 동일 — 별도 FK 제약 없이 앱 레벨에서 일치 보장';
COMMENT ON COLUMN treasury_users.user_code IS '감사 추적용 단축 식별코드 (결재이력·스레드 author)';
COMMENT ON COLUMN treasury_users.companies IS '빈 배열({}): master/admin은 전체접근, editor/viewer는 접근불가';
COMMENT ON COLUMN treasury_users.menus     IS 'NULL: 역할 기본 메뉴셋 적용, 빈 배열: 전체 메뉴 차단';

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS treasury_users_updated_at ON treasury_users;
CREATE TRIGGER treasury_users_updated_at
  BEFORE UPDATE ON treasury_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 역할별 기본 메뉴 주석 (앱 코드의 MENU_DEFAULTS 와 동기화)
-- master  : 전체 (관리 메뉴 포함)
-- admin   : dashboard, daily, input, invest, loans, equity, history, fx, policy (관리 제외)
-- editor  : dashboard, daily, input, invest, loans, equity, history, fx
-- viewer  : dashboard, invest, loans, equity, history, fx

-- ============================================================
-- 초기 마스터 계정 삽입 예시 (실제 auth.users 생성 후 실행)
-- auth.users 의 UUID 를 복사해서 id 에 입력
-- ============================================================
-- INSERT INTO treasury_users (id, email, name, user_code, role, companies, can_delete, can_approve)
-- VALUES (
--   'auth-user-uuid-here',
--   'admin@selvas.com',
--   '시스템 관리자',
--   'MASTER01',
--   'master',
--   '{}',
--   true,
--   true
-- );
