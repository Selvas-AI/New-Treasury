-- FX 리짐 판정 이력에 "왜 그 목표가 나왔는지" 기록 (2026-10-02)
-- 사용자가 Supabase SQL Editor에서 검토 후 직접 실행한다. 에이전트는 프로덕션 DB에 실행하지 않는다.
--
-- 배경(2026-10-01 사용자 질문): 조치 이력에 목표 26.7% → 28.3% → 25% 처럼 값만 남아 있어
--   "왜 바뀌었는지"를 화면에서 알 수 없었다. 엔진은 이미 근거를 모두 산출하고
--   (fxRegime.ts evaluateRegime → regime / level / decision.rawTargetRatio / clampedBy)
--   실시간 조치 카드에는 표시하는데, 이력 테이블에만 빠져 있었다.
--
-- ⚠ 가산적(additive) 마이그레이션이다. 기존 행은 전부 NULL 로 남고 화면에 '—' 로 표시된다.
--   과거로 소급 복원은 불가능하다 — 그 시점의 총자금·보유액 스냅샷이 남아 있지 않다.
-- ⚠ 이 스크립트를 실행하지 않아도 앱은 그대로 동작한다(PostgREST 가 모르는 컬럼은
--   insert payload 에서 거부하므로, 클라이언트는 컬럼 부재 시 근거 없이 1회 재시도한다).

alter table public.fx_regime_snapshot_history
  add column if not exists regime_code    text,     -- 국면 코드 (예: '5-B')
  add column if not exists level_grade    text,     -- 수준 등급 (VH/H/N/L/VL). 앵커 미설정이면 NULL
  add column if not exists trend_group    text,     -- 추세 그룹 (up/side/down)
  add column if not exists raw_target_pct numeric,  -- 제약 적용 전 매트릭스 원안 (%)
  add column if not exists clamped_by     text;     -- none|buffer|policy_band|exposure_cap|time_force

comment on column public.fx_regime_snapshot_history.raw_target_pct is
  '5x3 매트릭스 원안. target_pct 와 다르면 clamped_by 가 그 이유다(정책 밴드·결제 버퍼 등).';

-- 확인
select count(*) as 전체,
       count(regime_code) as 근거기록분,
       min(snapshot_date) as 최초, max(snapshot_date) as 최근
  from public.fx_regime_snapshot_history;
