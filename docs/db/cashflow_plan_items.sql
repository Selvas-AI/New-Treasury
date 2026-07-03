-- 12주 롤링 포캐스트 — 항목별 상세 (세션19차)
-- 기존 cashflow_plan(주당 유입/유출 합계 1행)은 그대로 유지하고,
-- 카테고리·메모 단위 상세 내역을 담는 테이블을 추가한다.
-- cashflow_plan.inflow/outflow는 이 테이블의 합계를 클라이언트에서 계산해 upsert로 동기화한다
-- (기존 요약 테이블·KPI 로직 무변경으로 재사용하기 위함).

create table if not exists cashflow_plan_items (
  id          uuid primary key default gen_random_uuid(),
  company     text not null,
  week_start  date not null,               -- 해당 주 월요일 기준 (cashflow_plan.week_start와 동일 키)
  direction   text not null check (direction in ('in', 'out')),
  category    text not null,               -- 자금일보 카테고리 코드 재사용 (예: ar_collection, other_in 등)
  amount      numeric not null default 0,
  memo        text default '',
  created_by  text default '',
  created_at  timestamptz default now()
);

create index if not exists idx_cashflow_plan_items_week
  on cashflow_plan_items (company, week_start, direction);

alter table cashflow_plan_items disable row level security;
