-- ============================================================
-- fx_trade_history.order_type CHECK 제약에 'regime' 추가
-- 세션26차 (2026-08-18) — FX 리짐 모델 정책 이관 Phase 4 누락분 긴급 수정
--
-- [사고 경위]
-- Phase 4 에서 실무 화면(/fx-regime) 환전 판단 탭에 "이 권고로 매각 지시 등록"
-- 버튼을 추가하며 order_type='regime' 값을 코드에 넣었지만, 원 제약을 만든
-- fx_sell_order_deadline_migration.sql(세션20차)의 CHECK 를 확장하는 DDL을
-- 함께 작성하지 않았다. 그 결과 실제 매각 지시 등록 버튼을 누르면 100% 실패했다.
--   "new row for relation \"fx_trade_history\" violates check constraint
--    \"fx_trade_history_order_type_check\""
-- 2026-08-18 실화면 검증(등록 시도)에서 발견. 등록 시도 자체는 DB에 반영되지
-- 않았으므로(제약 위반으로 INSERT 자체가 거부됨) 별도 정리가 필요한 데이터는 없다.
--
-- order_type 값 3종:
--   threshold     보유비중 초과로 인한 매각
--   discretionary 정책회의 재량 매각
--   regime        FX 리짐 권고를 실무가 지시로 등록 (세션26차 Phase 4)
-- ============================================================

ALTER TABLE fx_trade_history DROP CONSTRAINT IF EXISTS fx_trade_history_order_type_check;

ALTER TABLE fx_trade_history ADD CONSTRAINT fx_trade_history_order_type_check
  CHECK (order_type IS NULL OR order_type IN ('threshold', 'discretionary', 'regime'));

COMMENT ON COLUMN fx_trade_history.order_type IS
  'threshold=보유비중 초과 매각, discretionary=정책회의 재량 매각, regime=리짐 권고 매각(세션26차)';

-- 확인용
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--  where conrelid = 'fx_trade_history'::regclass and conname like '%order_type%';
