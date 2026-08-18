-- ============================================================
-- policy_decisions.linked_metric 에 리짐 목표 지표 추가
-- 세션26차 (2026-08-14) — FX 리짐 모델 정책 이관 Phase 4
-- 근거: docs/기획/FX리짐_정책이관_계획.md §6
--
-- 배경:
--   기존 fx_ratio 는 "정책 밴드 안에 있는가"만 본다. 리짐 채택 후에는
--   "오늘 국면이 지시한 목표 잔존비중까지 줄였는가"라는 별도의 이행 의무가 생겼다.
--   밴드 안에 있어도 리짐 목표를 초과 보유할 수 있으므로 다른 지표로 둔다.
--
--   fx_regime_gap = (현재 외화비중 %) − (리짐 적용 목표 잔존비중 %)  … 단위 %p
--   예) "리짐 목표 대비 초과 보유를 1%p 이내로 유지" → operator=lte, value=1
--
-- ⚠ 판정은 실무 화면(/fx-regime)이 남긴 스냅샷(policy_params 의 fx_regime_snap_*)을
--   읽는다. 대시보드에서 환율 이력 1,000여 건을 매번 돌릴 수 없기 때문이다.
--   스냅샷이 없으면(아직 한 번도 판정 안 함) 위반 없음으로 처리한다 — 오탐 방지.
--
-- 기존 CHECK 제약을 교체해야 하므로 DROP 후 재생성한다.
-- 기존 3개 값(fx_ratio/loan_ratio/liquidity)은 그대로 유효하다.
-- ============================================================

ALTER TABLE policy_decisions DROP CONSTRAINT IF EXISTS policy_decisions_linked_metric_check;

ALTER TABLE policy_decisions ADD CONSTRAINT policy_decisions_linked_metric_check
  CHECK (linked_metric IS NULL OR linked_metric IN
    ('fx_ratio', 'loan_ratio', 'liquidity', 'fx_regime_gap'));

COMMENT ON COLUMN policy_decisions.linked_metric IS
  '이 의결이 통제하는 실시간 지표 (fx_ratio/loan_ratio/liquidity/fx_regime_gap, null=일반 의결)';

-- 확인용
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'policy_decisions'::regclass and conname like '%linked_metric%';
