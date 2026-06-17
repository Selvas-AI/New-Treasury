-- =============================================================
-- 자금일보 관련 Supabase DDL
-- 생성일: 2026-06-09
-- 반영 대상: Supabase > SQL Editor 에서 실행
-- =============================================================

-- -------------------------------------------------------------
-- 1. 자금일보 헤더 테이블  (먼저 생성 — daily FK 참조 대상)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company         text        NOT NULL,
  report_date     date        NOT NULL,
  status          text        NOT NULL DEFAULT 'draft',
    -- 'draft' | 'submitted' | 'approved' | 'rejected'
  fx_rates        jsonb,      -- 당일 적용 환율 스냅샷 {"USD":1529,"EUR":1775,...}
  note            text,       -- 일보 전체 비고

  submitted_by    text,
  submitted_at    timestamptz,
  approved_by     text,
  approved_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT daily_reports_company_date_unique UNIQUE (company, report_date),
  CONSTRAINT daily_reports_status_check
    CHECK (status IN ('draft','submitted','approved','rejected'))
);

COMMENT ON TABLE  daily_reports IS '자금일보 헤더 — 법인+날짜별 1건';
COMMENT ON COLUMN daily_reports.fx_rates IS '승인 시점 환율 스냅샷 (이력 보존용)';
COMMENT ON COLUMN daily_reports.status   IS 'draft→submitted→approved / rejected';


-- -------------------------------------------------------------
-- 1-1. daily 테이블 확정 플래그 컬럼 추가 (C안 — 임시/확정 구분)
--      daily_reports 생성 이후에 실행해야 FK 참조 가능
-- -------------------------------------------------------------
ALTER TABLE daily
  ADD COLUMN IF NOT EXISTS confirmed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_id  uuid    REFERENCES daily_reports(id) ON DELETE SET NULL;

-- confirmed = false : 임시 반영 (대시보드 즉시 표시, 공식 미확정)
-- confirmed = true  : 자금일보 승인 완료 → 공식 확정


-- -------------------------------------------------------------
-- 2. 결재선 설정 테이블 (법인별 결재 단계 관리)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_report_approval_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company         text        NOT NULL,
  step            int         NOT NULL,   -- 1: 팀장(default), 2,3...: 추가 결재자
  role_label      text        NOT NULL,   -- 표시 라벨 (예: '자금팀장', 'CFO')
  approver_code   text        NOT NULL,   -- access_codes.code 참조
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_config_company_step_unique UNIQUE (company, step)
);

COMMENT ON TABLE  daily_report_approval_config IS '법인별 자금일보 결재선 설정 (step=1이 Default 팀장)';
COMMENT ON COLUMN daily_report_approval_config.step IS '결재 순서 (1부터 시작, 낮을수록 먼저 결재)';


-- -------------------------------------------------------------
-- 3. 결재 이력 로그
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_report_approvals (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid        NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  step            int         NOT NULL,
  action          text        NOT NULL,
    -- 'submit' | 'approve' | 'reject' | 'withdraw'
  actor_code      text        NOT NULL,   -- 처리자 access_codes.code
  actor_label     text,                   -- 처리자 표시명
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT approval_action_check
    CHECK (action IN ('submit','approve','reject','withdraw'))
);

COMMENT ON TABLE daily_report_approvals IS '자금일보 결재 행위 이력 (상신/승인/반려/취소)';


-- -------------------------------------------------------------
-- 4. 입출금 라인 아이템
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_report_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid        NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  direction       text        NOT NULL,
    -- 'in' (입금) | 'out' (출금)
  category        text        NOT NULL,
    -- 입금: ar_collection | other_receivable | govt_fund |
    --       advance_in | invest_return | loan_drawdown | other_in
    -- 출금: ap_payment | advance_out | invest_execute |
    --       loan_repayment | other_out
  amount          numeric     NOT NULL DEFAULT 0,
  currency        text        NOT NULL DEFAULT 'KRW',
  amount_krw      numeric,    -- 원화 환산액 (외화인 경우 fx_rates 기준)
  memo            text,

  -- 연동 정보 (카테고리별 선택 사항)
  linked_type     text,       -- 'investment' | 'loan' | 'equity' | null
  linked_id       uuid,       -- 연동된 레코드의 PK

  sort_order      int         NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT item_direction_check
    CHECK (direction IN ('in','out')),
  CONSTRAINT item_category_check
    CHECK (category IN (
      'ar_collection','other_receivable','govt_fund',
      'advance_in','invest_return','loan_drawdown','other_in',
      'ap_payment','advance_out','invest_execute',
      'loan_repayment','other_out'
    ))
);

COMMENT ON TABLE  daily_report_items IS '자금일보 입출금 라인 아이템';
COMMENT ON COLUMN daily_report_items.linked_type IS '연동 대상 테이블 구분';
COMMENT ON COLUMN daily_report_items.linked_id   IS '연동 대상 레코드 PK (투자/차입금 회수·집행 시 사용)';


-- -------------------------------------------------------------
-- 5. 기타 항목 스레드 (other_in / other_out 사유 기록)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_report_threads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid        NOT NULL REFERENCES daily_report_items(id) ON DELETE CASCADE,
  author_code     text        NOT NULL,
  author_label    text,
  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE daily_report_threads IS '기타 입출금 항목 사유 스레드 (로그 형태 누적)';


-- -------------------------------------------------------------
-- 6. RLS (Row Level Security)
--    ⚠ 2026-06-17: 이 테이블들은 RLS가 꺼져 있어 Supabase Security Advisor
--      'rls_disabled_in_public' 경고 대상이었음.
--    → 일괄 활성화는 docs/db/rls_enable_all.sql 실행으로 처리 (전 테이블 대상)
--    아래는 개별 활성화 참고용 (rls_enable_all.sql 실행 시 불필요):
-- ALTER TABLE daily_reports                ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_report_items           ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_report_threads         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_report_approvals       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE daily_report_approval_config ENABLE ROW LEVEL SECURITY;


-- -------------------------------------------------------------
-- 7. updated_at 자동 갱신 트리거 (선택)
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_reports_updated_at       ON daily_reports;
DROP TRIGGER IF EXISTS trg_daily_report_items_updated_at  ON daily_report_items;

CREATE TRIGGER trg_daily_reports_updated_at
  BEFORE UPDATE ON daily_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_daily_report_items_updated_at
  BEFORE UPDATE ON daily_report_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- -------------------------------------------------------------
-- 8-1. category CHECK constraint 업데이트
--      투자자산평가 항목 추가 (2026-06-09)
--      이자수익/외상매입금/이자비용/전자어음결제 추가 (2026-06-16, 세션13차)
--      Supabase SQL Editor에서 실행 필요
--      ⚠ ItemsSection.tsx 의 IN_CATEGORIES/OUT_CATEGORIES 와 반드시 동기화
-- -------------------------------------------------------------
ALTER TABLE daily_report_items
  DROP CONSTRAINT IF EXISTS item_category_check;

ALTER TABLE daily_report_items
  ADD CONSTRAINT item_category_check
    CHECK (category IN (
      -- 입금
      'ar_collection','other_receivable','govt_fund',
      'advance_in','invest_return','loan_drawdown',
      'interest_income','invest_eval_in','other_in',
      -- 출금
      'ap_payment','trade_ap_payment','advance_out','invest_execute',
      'loan_repayment','interest_expense','enote_payment',
      'invest_eval_out','other_out'
    ));


-- -------------------------------------------------------------
-- 8-3. account_type 컬럼 추가 (2026-06-09)
--      입출금 항목의 계좌 구분 (보통예금/CMA, 국책자금, USD 등)
-- -------------------------------------------------------------
ALTER TABLE daily_report_items
  ADD COLUMN IF NOT EXISTS account_type text;
  -- krw_demand | krw_govt | krw_mmda | fx_usd | fx_eur | fx_jpy | fx_gbp | fx_cny | null(미지정)

-- -------------------------------------------------------------
-- 8. 기본 결재선 데이터 삽입 (법인별 팀장 step=1 — 코드는 실제값으로 교체)
-- -------------------------------------------------------------
-- INSERT INTO daily_report_approval_config (company, step, role_label, approver_code)
-- VALUES
--   ('셀바스에이아이',  1, '자금팀장', 'TEAMLEAD_SAI'),
--   ('셀바스헬스케어', 1, '자금팀장', 'TEAMLEAD_SHC'),
--   ('메디아나',       1, '자금팀장', 'TEAMLEAD_MED')
-- ON CONFLICT (company, step) DO NOTHING;
