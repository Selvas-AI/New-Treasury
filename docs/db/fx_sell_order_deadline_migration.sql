-- fx_sell_order_deadline_migration.sql
-- 세션20차 — 정책 이행 통제 Phase 3: 외화 매각 지시(Sell Order) 이행 기한 관리
--
-- 배경: 정책회의에서 외화 매각을 결정해도(재량 매각) 또는 보유비중 초과로 매각이
-- 필요해도(한도초과 매각), "언제까지 실행해야 하는지"가 시스템에 없어 실무진이
-- 판단으로 미루는 사고가 발생. 두 경우 모두 "등록일로부터 3영업일 내, 환율과
-- 무관하게 실행"이 원칙 — 이를 fx_trade_history의 매도 발의(propose) 건에
-- 기한(due_date)과 유형(order_type)으로 못박아 대시보드/자금일보에서 추적한다.
--
-- due_date   : 매각 실행 기한 (발의일 + 3영업일, 클라이언트에서 계산해 저장)
-- order_type : 'threshold'(보유비중 초과로 인한 매각) | 'discretionary'(정책회의 재량 매각)

ALTER TABLE fx_trade_history ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE fx_trade_history ADD COLUMN IF NOT EXISTS order_type text
  CHECK (order_type IS NULL OR order_type IN ('threshold', 'discretionary'));

COMMENT ON COLUMN fx_trade_history.due_date   IS '매각 실행 기한(발의일+3영업일). 환율 무관 실행 강제 — 정책 이행 통제';
COMMENT ON COLUMN fx_trade_history.order_type IS 'threshold=보유비중 초과 매각, discretionary=정책회의 재량 매각(환차익실현 등)';
