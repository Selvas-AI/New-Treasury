-- FX 리짐 판정 스냅샷 이력 (조치 카드 일자별 조회)
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경: fx_regime_snap_*(policy_params, 세션26차 Phase 4)는 판정할 때마다 같은 행을
-- 덮어쓴다. 그래서 외화를 매각해 "조치 불필요"로 돌아가는 순간 그 이전(무엇을 근거로
-- 매도를 결정했는지: 목표비중·현재비중·권고액·발생일)이 사라져 과거 의사결정을
-- 추적할 수 없었다. 이 테이블은 값이 바뀔 때마다(=fxRegimeSnapshot.ts 의
-- syncRegimeSnapshot 이 실제로 policy_params 를 쓸 때만) 한 줄씩 추가한다 — 이
-- 시점부터 쌓이는 이력만 볼 수 있고, 과거로 소급 복원은 불가능하다(설계상 한계,
-- CLAUDE.md 세션26차 7일차 참조).

create table if not exists public.fx_regime_snapshot_history (
  id uuid primary key,
  company text not null,
  currency text not null,
  snapshot_date date not null,      -- 판정 기준일(asOf)
  target_pct numeric,
  current_pct numeric,
  suggest_krw numeric not null default 0,
  since_date date,
  captured_by text,
  captured_at timestamptz not null default now()
);
create index if not exists fx_regime_snapshot_history_lookup
  on public.fx_regime_snapshot_history(company, currency, snapshot_date desc, captured_at desc);

alter table public.fx_regime_snapshot_history enable row level security;

drop policy if exists fx_regime_snapshot_history_select on public.fx_regime_snapshot_history;
create policy fx_regime_snapshot_history_select on public.fx_regime_snapshot_history for select to authenticated using (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and (coalesce(array_length(u.companies,1),0)=0 or fx_regime_snapshot_history.company=any(u.companies)))
);
drop policy if exists fx_regime_snapshot_history_insert on public.fx_regime_snapshot_history;
create policy fx_regime_snapshot_history_insert on public.fx_regime_snapshot_history for insert to authenticated with check (
  exists(select 1 from treasury_users u where u.id=auth.uid() and u.is_active=true
    and u.role in ('master','admin','editor')
    and (coalesce(array_length(u.companies,1),0)=0 or fx_regime_snapshot_history.company=any(u.companies)))
);
-- update/delete 정책 없음 — 이력은 불변(append-only)이다.
