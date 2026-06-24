-- rate_nego_logs: 운용자금·차입금 금리 네고/비딩 이력
-- 사용처: InvestPage, LoansPage (건별 네고 이력 아코디언)
-- 실행: Supabase SQL Editor

create table if not exists rate_nego_logs (
  id              uuid        primary key default gen_random_uuid(),
  company         text        not null,
  record_type     text        not null check (record_type in ('investment', 'loan')),
  record_id       uuid        not null,
  nego_date       date        not null,
  nego_type       text        not null check (nego_type in ('비딩', '금리네고', '재예치협의', '상환협의', '기타')),
  institution     text        not null,
  offered_rate    numeric(6,3),
  contact_person  text,
  outcome         text        not null default '진행중' check (outcome in ('진행중', '채택', '미채택', '보류')),
  notes           text,
  user_label      text,
  created_at      timestamptz default now()
);

-- 인덱스: record_type + record_id 조회 최적화
create index if not exists rate_nego_logs_record_idx
  on rate_nego_logs (company, record_type, record_id);

-- RLS: anon/authenticated 양쪽 permissive (기존 테이블 정책과 동일)
alter table rate_nego_logs enable row level security;

drop policy if exists "rate_nego_all" on rate_nego_logs;
create policy "rate_nego_all"
  on rate_nego_logs
  for all
  using (true)
  with check (true);
