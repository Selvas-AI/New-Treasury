-- ============================================================
-- policy_params 정정 감사 추적 컬럼
-- 세션26차 (2026-08-14) — FX 리짐 모델 정책 이관 Phase 2
-- 근거: docs/기획/FX리짐_정책이관_계획.md §5
--
-- 배경:
--   FX 리짐의 정책 소유 값(밴드·월유입·결제버퍼·손실한도·프로토콜)은
--   정책회의만 변경할 수 있다. 그 변경이 "누가 언제 왜" 이뤄졌는지 남겨야
--   회의록과 대조할 수 있다. updated_by/updated_at 만으로는 사유가 없다.
--
-- ⚠ 소유권(누가 바꿀 수 있는가)은 **코드에 고정**되어 있다
--   (src/lib/fxRegimeInputs.ts 의 FIELD_OWNER).
--   그래서 value_source 같은 컬럼은 두지 않는다 — 아래 3개는 감사 추적 전용이다.
--   정정 해제 기능도 없다. 정책 소유 필드는 항상 정책 소유다.
--
-- 안전성: 전부 nullable 추가라 기존 행·기존 코드에 영향이 없다.
--   미적용 상태에서도 앱은 정상 동작한다(usePolicyParams 가 컬럼 부재를 감지해
--   감사 필드 없이 재시도한다). 다만 사유는 기록되지 않는다.
-- ============================================================

alter table policy_params
  add column if not exists overridden_by  text,
  add column if not exists overridden_at  timestamptz,
  add column if not exists override_note  text;

comment on column policy_params.overridden_by is '정책회의 정정 수행자 (표시명)';
comment on column policy_params.overridden_at is '정책회의 정정 시각';
comment on column policy_params.override_note is '정정 사유 — 회의록 대조용';

-- 확인용
-- select param_key, param_value, updated_by, overridden_by, overridden_at, override_note
--   from policy_params
--  where company = '메디아나' and param_key like 'fx_%'
--  order by overridden_at desc nulls last;
