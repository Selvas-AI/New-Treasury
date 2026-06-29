-- 상품 적정성 검토 이력 테이블
-- 별지2 체크리스트 검토 결과, 판정, 후속조치 연결을 저장한다.
-- Supabase SQL Editor에서 실행 필요

create table if not exists public.policy_product_reviews (
  id                 uuid        primary key default gen_random_uuid(),
  company            text        not null,
  product_name       text        not null,
  checked_items      jsonb       not null default '[]'::jsonb,   -- 체크된 항목 id 배열
  verdict            text        not null check (verdict in ('적정', '조건부', '부적정')),
  condition_note     text        not null default '',             -- 조건부/부적정 사유
  reviewer           text        not null default '',
  reviewed_at        timestamptz not null default now(),
  linked_issue_key   text,                                       -- 등록된 이슈 key (부적정 시)
  linked_decision_id uuid,                                       -- 연결된 의결사항 id (적정/조건부 시)
  created_at         timestamptz not null default now()
);

-- 인덱스
create index if not exists policy_product_reviews_company_idx
  on public.policy_product_reviews (company, reviewed_at desc);

-- RLS
alter table public.policy_product_reviews enable row level security;

drop policy if exists "product_reviews_all" on public.policy_product_reviews;
create policy "product_reviews_all" on public.policy_product_reviews
  for all to anon, authenticated using (true) with check (true);
