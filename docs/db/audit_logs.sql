-- audit_logs: 데이터 변경 이력 로그 (CREATE/UPDATE/DELETE/SETACTIVE)
-- Supabase SQL Editor에서 실행 필요

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  company     TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,  -- daily | investments | loans | equities
  action      TEXT        NOT NULL,  -- CREATE | UPDATE | DELETE | SETACTIVE
  record_id   TEXT,
  user_label  TEXT        NOT NULL,
  user_role   TEXT        NOT NULL,
  summary     TEXT        NOT NULL,
  before_data JSONB,
  after_data  JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company    ON audit_logs(company);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table      ON audit_logs(table_name);

-- RLS: anon+authenticated 양쪽 permissive (auth.users 참조 금지)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_all" ON audit_logs;
CREATE POLICY "audit_logs_all" ON audit_logs
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
