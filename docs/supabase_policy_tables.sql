-- Phase 2: 자금정책 관리 테이블
-- Supabase SQL Editor에서 순서대로 실행

-- 1. 정책회의
create table if not exists policy_meetings (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  meeting_type text not null check (meeting_type in ('정책회의', '운영회의')),
  held_at      date not null,
  created_by   text default '',
  created_at   timestamptz default now()
);

-- 2. 의결사항 (법인별)
create table if not exists policy_decisions (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid references policy_meetings(id) on delete cascade,
  company     text not null,   -- 셀바스에이아이 | 셀바스헬스케어 | 메디아나
  title       text not null,
  decision    text not null,
  owner       text default '',
  due_date    date,
  status      text default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  created_at  timestamptz default now()
);

-- 3. 정책 파라미터 (법인 + 키 조합 unique)
create table if not exists policy_params (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  param_key   text not null,
  param_value numeric,
  param_text  text,
  updated_by  text default '',
  updated_at  timestamptz default now(),
  unique(company, param_key)
);

-- 4. 거래 금융기관 한도 (규정 §9: 기관별 30% 이내)
create table if not exists policy_bank_limits (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  bank_name   text not null,      -- 금융기관명 (investments.bank 와 매핑)
  bank_type   text default '은행' check (bank_type in ('은행', '증권사', '보험', '기타')),
  limit_pct   numeric default 30, -- 한도 비율 (%, 규정 §9 기본값 30)
  limit_amt   numeric,            -- 한도 금액 (원, 직접 지정 시 우선 적용)
  note        text default '',
  updated_by  text default '',
  updated_at  timestamptz default now(),
  unique(company, bank_name)
);
alter table policy_bank_limits disable row level security;

-- 5. 12주 롤링 포캐스트 (운영회의용 주별 자금수지 계획)
create table if not exists cashflow_plan (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  week_start  date not null,        -- 해당 주 월요일 기준
  inflow      numeric default 0,    -- 예상 유입 (원)
  outflow     numeric default 0,    -- 예상 유출 (원)
  memo        text default '',
  created_by  text default '',
  updated_at  timestamptz default now(),
  unique(company, week_start)
);
alter table cashflow_plan disable row level security;

-- RLS (Row Level Security) — 기존 테이블과 동일하게 비활성화 또는 정책 적용
alter table policy_meetings disable row level security;
alter table policy_decisions disable row level security;
alter table policy_params    disable row level security;

-- 샘플 데이터: 2026년 1차 정책회의
insert into policy_meetings (title, meeting_type, held_at, created_by)
values ('2026년 1차 정책회의', '정책회의', '2026-01-30', 'master');

-- 샘플 의결사항 (meeting_id는 위에서 생성된 uuid로 교체 필요)
-- insert into policy_decisions (meeting_id, company, title, decision, owner, due_date, status)
-- values
--   ('<meeting_id>', '셀바스에이아이', '차입금 리파이낸싱 구조 결정',
--    'C안(단계적 혼합) 승인 — 3월만기 20억, 6월만기 50억 내부자금 우선 대응 후 단계적 실행',
--    '그룹 CFO / 재무팀', '2026-02-28', 'in_progress'),
--   ('<meeting_id>', '메디아나', 'FX Target Band 설정',
--    '20~25% 확정 — 초과분 월 분할환전 원칙 수립',
--    '메디아나 CFO', '2026-02-28', 'in_progress'),
--   ('<meeting_id>', '메디아나', '국채 FVPL 리스크 관리 전략',
--    '2안(부분헤지) — 50% 헤지 포지션 구축 권고. 국채선물/IRS 활용 검토.',
--    '메디아나 CFO', '2026-03-31', 'pending'),
--   ('<meeting_id>', '셀바스헬스케어', '메디아나 지분 108만주 매각',
--    '블록딜+VWAP 방식 — 가격 하한 15,000원 준수 조건. Week1~2 준비, Week3 투자자 마케팅.',
--    '헬스케어 CFO', '2026-02-28', 'in_progress');

-- 샘플 정책 파라미터 (메디아나 FX 기준 — 엑셀 모델 기반)
insert into policy_params (company, param_key, param_value, updated_by)
values
  -- 기본 정책 파라미터
  ('메디아나', 'fx_risk_portion',     0.5,           'master'),
  ('메디아나', 'fx_target_min',       20,            'master'),
  ('메디아나', 'fx_target_max',       25,            'master'),
  ('메디아나', 'fx_operating_profit', 4300000000,    'master'),
  ('메디아나', 'fx_interest_income',  2300000000,    'master'),
  ('메디아나', 'fx_total_fund',       90000000000,   'master'),
  -- 통화별 연간 수익률 표준편차 (1년 일별 데이터 기준, 2025-02~2026-02)
  ('메디아나', 'fx_std_usd',          0.082458,      'master'),
  ('메디아나', 'fx_std_eur',          0.114437,      'master'),
  ('메디아나', 'fx_std_jpy',          0.108875,      'master'),
  ('메디아나', 'fx_std_gbp',          0.130257,      'master'),
  -- 보유 비율 (가중치, AS-IS 외화 분포 기준)
  ('메디아나', 'fx_weight_usd',       0.80,          'master'),
  ('메디아나', 'fx_weight_eur',       0.18,          'master'),
  ('메디아나', 'fx_weight_jpy',       0.02,          'master'),
  ('메디아나', 'fx_weight_gbp',       0.00,          'master')
on conflict (company, param_key) do nothing;
