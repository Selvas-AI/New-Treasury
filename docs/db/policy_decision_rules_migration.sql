-- policy_decision_rules_migration.sql
-- 세션20차 — 정책 이행 통제(Phase 1): 의결사항을 "정량 규칙"으로 구조화
--
-- 배경: 정책회의 의결사항(policy_decisions)이 지금까지 자유서술 텍스트(decision)로만
-- 저장되어, 시스템이 이행 여부를 자동으로 판단할 수 없었다. 예) "외화비중 30%까지
-- 관리" 라는 의결이 실무진에게 다르게 해석되어도 시스템이 이를 감지·경고하지 못함.
--
-- linked_metric  : 이 의결이 통제하려는 지표 ('fx_ratio' | 'loan_ratio' | 'liquidity' | null)
-- target_operator: 목표 조건 ('lte' = 이하로 유지 | 'gte' = 이상으로 유지)
-- target_value   : 목표값 (지표별 단위 — fx_ratio/loan_ratio는 %, liquidity는 원)
--
-- 세 컬럼이 모두 채워진 의결사항만 대시보드에서 실시간 위반 감지 대상이 된다.
-- (linked_metric = null 인 기존/일반 의결사항은 기존처럼 기한(due_date) 초과만 감지)

ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS linked_metric   text
  CHECK (linked_metric IS NULL OR linked_metric IN ('fx_ratio', 'loan_ratio', 'liquidity'));
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS target_operator text
  CHECK (target_operator IS NULL OR target_operator IN ('lte', 'gte'));
ALTER TABLE policy_decisions ADD COLUMN IF NOT EXISTS target_value    numeric;

COMMENT ON COLUMN policy_decisions.linked_metric   IS '이 의결이 통제하는 실시간 지표 (fx_ratio/loan_ratio/liquidity, null=일반 의결)';
COMMENT ON COLUMN policy_decisions.target_operator IS '목표 조건: lte=이 값 이하 유지, gte=이 값 이상 유지';
COMMENT ON COLUMN policy_decisions.target_value    IS '목표값 (fx_ratio/loan_ratio=%, liquidity=원)';
