-- ══ 외화매매거래 이력 테이블 ════════════════════════════════════════
-- Supabase SQL Editor에서 실행
-- 2026-06-16 신규

CREATE TABLE IF NOT EXISTS fx_trade_history (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  company         TEXT        NOT NULL,
  trade_date      DATE        NOT NULL,
  currency        TEXT        NOT NULL,                    -- USD/EUR/JPY/GBP/CNY
  direction       TEXT        NOT NULL DEFAULT 'sell',     -- sell / buy
  amount_fx       NUMERIC     NOT NULL,                    -- 외화 금액
  acq_rate        NUMERIC,                                 -- 취득 환율 (원/외화)
  trade_rate      NUMERIC,                                 -- 매도(예정) 환율
  fx_pnl          NUMERIC,                                 -- 예상 환차손익 (app 계산)
  amount_krw      NUMERIC,                                 -- 원화 환산 (trade_rate × amount_fx)
  status          TEXT        NOT NULL DEFAULT '발의',     -- 발의/승인/완료/취소
  memo            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  -- 승인
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  -- 완료 (실제 체결)
  completed_rate  NUMERIC,                                 -- 실제 체결 환율
  completed_pnl   NUMERIC,                                 -- 실제 환차손익
  completed_at    TIMESTAMPTZ,
  completed_by    TEXT
);

-- RLS
ALTER TABLE fx_trade_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_trade_history_all" ON fx_trade_history
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
