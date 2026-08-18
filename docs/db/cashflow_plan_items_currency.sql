-- ============================================================
-- cashflow_plan_items 통화 컬럼
-- 세션26차 (2026-08-14) — FX 리짐 운영 가정 자동 산출
-- 근거: docs/기획/FX리짐_정책이관_계획.md §9
--
-- 배경:
--   리짐 판정의 `월 외화 유입 가정`과 `향후 3개월 결제 버퍼`는 지금 정책회의가
--   손으로 넣는다. 주간예측(12주 롤링)에 이미 유입·유출 계획이 들어오는데,
--   **통화 구분이 없어**(전부 원화 전제) 외화 원금을 도출할 수 없었다.
--
--   currency 를 붙이면 "향후 12주 USD 유입 합계 ÷ 3 = 월 유입", "향후 13주 USD
--   유출 합계 = 3개월 결제 버퍼" 를 계산할 수 있다.
--
-- ⚠ 기본값 'KRW' — 기존 행은 전부 원화로 간주된다(현재 동작과 동일).
--   외화 항목은 **외화 원금**으로 저장한다(원화 환산액이 아니다).
--   주별 합계(cashflow_plan.inflow/outflow)는 원화 기준이라, 외화 항목은
--   집계 시점의 환율로 환산해 더한다(useCashflowPlan.sumBy).
-- ============================================================

alter table cashflow_plan_items
  add column if not exists currency text not null default 'KRW';

comment on column cashflow_plan_items.currency is
  '통화 코드 (KRW/USD/EUR/JPY/GBP). 외화는 원화 환산액이 아니라 외화 원금으로 저장';

-- 확인용
-- select currency, direction, count(*), sum(amount)
--   from cashflow_plan_items group by 1, 2 order by 1, 2;
