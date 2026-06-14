-- ============================================================
-- companies 테이블 DDL
-- Selvas Treasury — 법인 마스터 (동적 회사 관리)
-- 실행: Supabase SQL Editor
-- ============================================================

-- 1. 테이블 생성
create table if not exists companies (
  id         bigint generated always as identity primary key,
  name       text    not null unique,        -- '셀바스에이아이'
  short_name text,                           -- 약칭: 'AI', 'HC', 'MED'
  active     boolean not null default true,  -- 비활성화 시 UI에서 숨김
  sort_order int     not null default 0,     -- 정렬 순서 (낮을수록 먼저)
  created_at timestamptz not null default now()
);

-- 2. 기존 3개 법인 시드 데이터
insert into companies (name, short_name, sort_order) values
  ('셀바스에이아이', 'AI',  10),
  ('셀바스헬스케어', 'HC',  20),
  ('메디아나',       'MED', 30)
on conflict (name) do nothing;

-- 3. RLS 활성화
alter table companies enable row level security;

-- 기존 정책 삭제 후 재생성 (idempotent)
drop policy if exists "companies_read"         on companies;
drop policy if exists "companies_master_write" on companies;
drop policy if exists "companies_all"          on companies;

-- ⚠️ 이 앱은 anon 키로 동작하며(레거시 접근코드 사용자는 실제 auth.users 가 아님),
--    master 권한 체크는 클라이언트(라우트 가드 + UI)에서 수행한다.
--    다른 테이블(treasury_users 등)과 동일하게 anon + authenticated 양쪽에 전체 권한 부여.
--    (RLS 정책에서 auth.users 를 참조하면 authenticated 역할이 읽기 권한이 없어
--     'permission denied for table users' 403 발생 → 정책에서 auth.users 직접 참조 금지)
create policy "companies_all" on companies
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 4. 인덱스
create index if not exists companies_sort_idx on companies(sort_order, active);
