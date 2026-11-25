-- ============================================================
-- fx_jpy_unit_normalize.sql  (2026-11-25 · FX 전수조사 묶음 C · F-02)
-- 근거: docs/기획/FX리짐_전수조사_권고안_2026-11-25.md
--
-- ▶ 한 번 실행으로 끝납니다. 마지막에 결과표가 나옵니다. 여러 번 실행해도 안전합니다.
--
-- 배경
--   ECOS 는 JPY 를 "원/100엔"(≈950)으로 고시하고 DB(fx_rate_history)도 그대로 보존한다.
--   그런데 리짐 엔진이 이 원값을 그대로 써서, 장부(FIFO)·시장환율(원/1엔 ≈9.5)과
--   100배 어긋났다. 코드는 이제 엔진에 원/1엔으로 정규화한 값을 넣는다.
--
--   ⚠ 그래서 **이미 저장된 JPY 앵커**가 있으면 옛 단위(원/100엔)라 100으로 나눠야 한다.
--     그대로 두면 현재가(≈9.5)를 앵커(≈950) 대비 −99% 로 보고 "매우 낮음"으로 판정한다.
--
--   fx_rate_history 는 **바꾸지 않는다** — ECOS 원본 보존이 원칙이고, 재수집 시 다시 섞인다.
-- ============================================================

-- ── [1] JPY 앵커 단위 정리 — 100 이상인 값만(이미 정규화된 값은 건드리지 않음) ──
update public.policy_params
   set param_value = round((param_value / 100)::numeric, 3)
 where param_key = 'fx_level_anchor_krw_jpy'
   and param_value >= 100;

-- ── [2] 결과표 ─────────────────────────────────────────────
--   ① JPY 앵커 현황 (정상: 10 내외 또는 미설정)
--   ② 원/100엔으로 잘못 등록됐을 수 있는 JPY 매각 지시 — **수정하지 않는다. 목록만 확인**
--      (trade_rate 가 100 이상이면 옛 단위. 금액·손익이 100배로 기록됐을 수 있다)
select '① JPY 앵커' as 구분, company as 법인, param_value::text as 값,
       case when param_value < 100 then '정상(원/1엔)' else '확인필요' end as 상태
  from public.policy_params where param_key = 'fx_level_anchor_krw_jpy'
union all
select '② JPY 지시 단위 의심', company,
       trade_date || ' · ' || amount_fx || '엔 @' || trade_rate || ' · ' || status,
       '확인필요 — 담당자에게 알려 주세요(자동 수정 안 함)'
  from public.fx_trade_history
 where currency = 'JPY' and trade_rate >= 100
union all
select '— 확인 완료', '', '', '위 표에 ②가 없으면 정리할 것이 없습니다'
order by 1;
