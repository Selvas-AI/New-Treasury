-- ══════════════════════════════════════════════════════════════════════
--  fx_rate_history — 일별 환율 이력 (환율 국면 판정 · 동적 헷지 시뮬레이터)
--
--  세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 1
--
--  왜 필요한가:
--    기존 useFx()는 GAS에서 "당일 스냅샷"만 받아 4분 캐시할 뿐, 과거 환율을
--    한 건도 보관하지 않는다. SMA/볼린저/EMA/MACD/ADX/ATR/칼만 필터는 전부
--    일별 종가 시계열이 전제이므로, 이 테이블 없이는 국면 판정이 불가능하다.
--
--  특징:
--    - 법인 무관 전사 공용 (환율은 회사별로 다르지 않다) → company 컬럼 없음
--    - unique(currency, rate_date) → 재수집/백필이 upsert로 멱등하게 동작
--    - source 로 출처 구분 (ecos = 한국은행 공식, 회계 기준과 일치)
--
--  ⚠ JPY 단위 주의:
--    ECOS 731Y001 의 JPY 는 "원/100엔" 기준이다. 이 테이블에는 ECOS 원값을
--    그대로 저장하고(=100엔당 원), 소비하는 쪽에서 단위를 해석한다.
--    unit_basis 컬럼에 그 기준을 명시해 두어 나중에 혼동하지 않도록 한다.
-- ══════════════════════════════════════════════════════════════════════

create table if not exists public.fx_rate_history (
  id          uuid primary key default gen_random_uuid(),
  currency    text        not null,                    -- USD | EUR | JPY | GBP | CNY
  rate_date   date        not null,                    -- 고시일 (영업일)
  rate        numeric     not null check (rate > 0),   -- unit_basis 단위당 원화
  unit_basis  integer     not null default 1,          -- 1 = 1외화당, 100 = 100외화당(JPY)
  source      text        not null default 'ecos',
  created_at  timestamptz not null default now(),
  unique (currency, rate_date)
);

-- 국면 판정은 "특정 통화의 최근 N일"을 역순으로 읽는 패턴이 지배적
create index if not exists fx_rate_history_currency_date_idx
  on public.fx_rate_history (currency, rate_date desc);

-- ── RLS ──────────────────────────────────────────────────────────────
-- 기존 테이블과 동일한 permissive 정책 (anon + authenticated 양쪽).
-- ⚠ RLS 정책에서 auth.users 를 참조하지 말 것 — 'permission denied for table users' 403 발생.
alter table public.fx_rate_history enable row level security;

drop policy if exists fx_rate_history_all on public.fx_rate_history;
create policy fx_rate_history_all
  on public.fx_rate_history
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ── 확인용 ───────────────────────────────────────────────────────────
-- select currency, count(*), min(rate_date), max(rate_date)
--   from public.fx_rate_history group by currency order by currency;
