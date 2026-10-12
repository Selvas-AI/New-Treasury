-- ════════════════════════════════════════════════════════════════════
--  외화 매도건 장부환율 대조 — 읽기 전용 진단
--  2026-10-12 · 메디아나 USD 2,000,000 매도(10/02 발의) 회계 장부 1,426.34 대조
--
--  ▶ 사용법: Supabase SQL Editor 에 **전체 붙여넣고 Run 한 번**. 결과 표 하나만 나온다.
--  ▶ 데이터를 바꾸지 않는다(SELECT 전용). 그대로 캡처해 공유하면 된다.
--
--  배경: 시스템 가중평균 1,424.2393 vs 회계 1,426.34 → 2.10원(420만원) 차이.
--    역산 결과 저가 소액 로트 약 252,868 USD 구간만 어긋나고 나머지는 정확히 일치한다.
--    이 로트들이 **어디서 생긴 것인지**(계좌 대체 / 정기예금 이자 / 자금일보 반영 /
--    개시재고)에 따라 원인과 조치가 갈린다.
-- ════════════════════════════════════════════════════════════════════

with t as (          -- 대상 거래 — 조건을 바꾸면 다른 건도 같은 방식으로 볼 수 있다
  select * from public.fx_trade_history
  where company = '메디아나' and currency = 'USD'
    and direction = 'sell' and amount_fx = 2000000
  order by trade_date desc limit 1
),
c as (               -- 이 거래가 실제로 소진한 로트
  select c.amount, c.acq_rate, c.disposal_rate, c.disposed_date,
         l.acquired_date, l.account_type, l.source_type as lot_source,
         l.transfer_id, l.investment_id, l.txn_type, l.memo,
         tf.valuation_method, tf.transfer_date, tf.from_account_type, tf.to_account_type
  from public.fx_lot_consumptions c
  join public.fx_lots l on l.id = c.lot_id
  left join public.fx_lot_transfers tf on tf.id = l.transfer_id
  where c.source_type = 'fx_trade_history'
    and c.source_id = (select id from t)
),
agg as (select sum(amount) amt, sum(amount * acq_rate) / nullif(sum(amount),0) wavg from c),
pol as (select param_text, param_value from public.policy_params
        where company = '메디아나' and param_key = 'fx_transfer_valuation')
select * from (
  -- ① 로트별 상세 (장부환율 낮은 순 = 의심 구간이 위로)
  select 1 as 순, '① 소진 로트' as 구분,
         to_char(c.acq_rate,'FM9,999.00') as 장부환율,
         to_char(c.amount,'FM9,999,999.00') as 소진수량,
         c.acquired_date::text || ' / ' || c.account_type as 취득일_계좌,
         case
           when c.transfer_id is not null then
             '계좌 대체(' || coalesce(c.valuation_method,'?') ||
             case when c.valuation_method = 'carryover' then ' ← 원가승계: 회계(재평가)와 어긋나는 원인' else '' end || ')'
           when c.txn_type = 'interest' or c.lot_source = 'interest' then '정기예금 이자'
           when c.lot_source = 'daily_report_item' then '자금일보 반영(입력 환율 확인 필요)'
           when c.lot_source = 'opening' then '개시재고 CSV'
           when c.lot_source = 'manual' then '수동 유입(입력 환율 확인 필요)'
           else coalesce(c.lot_source,'?')
         end as 출처_판정
  from c
  union all
  -- ② 합계 · 회계 대조
  select 2, '② 합계', to_char(wavg,'FM9,999.0000'), to_char(amt,'FM9,999,999.00'),
         '회계 1,426.34 와 차이 ' || to_char(1426.34 - wavg,'FM9,990.0000') || '원',
         '금액 영향 ' || to_char((1426.34 - wavg) * amt,'FM9,999,999,999') || '원'
  from agg
  union all
  -- ③ 현재 평가정책
  select 3, '③ 평가정책',
         coalesce((select param_text from pol), '(미설정)'),
         '', 
         case when coalesce((select param_text from pol),'carryover') = 'revalue'
              then '재평가 — 회계 기준과 일치' else '원가승계 — 회계(재평가)와 불일치' end,
         '자금정책 › FX 정책 › ② 정책 기준 › 외화 원장 회계정책 에서 변경'
  union all
  -- ④ 읽는 법
  select 4, '④ 판정 기준', '', '', '',
         '①에 "계좌 대체(carryover)" 가 있으면 그것이 원인. 없으면 이자·자금일보·개시재고의 적용 환율 문제.'
) x order by 순, 장부환율;
