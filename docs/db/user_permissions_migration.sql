-- 사용자 세분화 권한 컬럼 추가
-- treasury_users 테이블에 카테고리 권한 + 작업 권한 JSONB 컬럼 추가
-- NULL = 역할 기본값 적용 (기존 동작 유지, 기존 사용자 영향 없음)

ALTER TABLE treasury_users
  ADD COLUMN IF NOT EXISTS allowed_categories jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS action_permissions  jsonb DEFAULT NULL;

-- allowed_categories 구조 (예시):
-- { "in": ["ar_collection","other_receivable"], "out": null }
-- null 전체 또는 방향별 null = 해당 방향 전체 허용

-- action_permissions 구조 (예시):
-- {
--   "operating":    { "view": true, "write": true,  "delete": false },
--   "invest":       { "view": true, "write": false, "delete": false },
--   "loans":        { "view": true, "write": false, "delete": false },
--   "equity":       { "view": true, "write": true,  "delete": false },
--   "daily_write":  { "view": true, "write": true,  "delete": false },
--   "daily_submit": { "view": true, "write": true,  "delete": false },
--   "history":      { "view": true, "write": false, "delete": false },
--   "issue_history":{ "view": true, "write": false, "delete": false }
-- }
