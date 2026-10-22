-- ════════════════════════════════════════════════════════════════════
--  국채 중복 집계 진단 — 읽기 전용
--  2026-10-22 · 자금흐름 분석의 가용 국채가 통합상황판·자금일보보다 1건 많게 집계됨
--
--  ▶ 사용법: Supabase SQL Editor 에 **전체 붙여넣고 Run 한 번**. 결과 표 하나만 나온다.
--  ▶ 데이터를 바꾸지 않는다(SELECT 전용). 그대로 캡처해 공유하면 된다.
--
--  배경: 메디아나 기준 세 화면 잔액이 달랐다.
--      통합상황판 가용   888.6억  (국채 55.7억 1건)
--      자금일보 총합계   908.6억  (국채 55.7억 1건 + 불가용 20.0억)
--      자금흐름 분석     962.5억  (국채 109.6억 = 55.7 + 53.9  ← 1건 더 잡힘)
--    중복 53.9억을 빼면 세 화면이 정확히 일치한다(888.6 / 908.6 / 908.6).
--
--  갈리는 지점은 두 가지 중 하나다. 이 조회가 어느 쪽인지 알려준다.
--    (A) 같은 종목이 **키가 다른 두 행**으로 등록됨
--        → getLatestBonds 는 bond_ticker ?? bond_name ?? bank 로 묶으므로 따로 센다
--    (B) **매도·만기된 국채(active=false)** 가 자금흐름 분석에서만 살아남음
--        → 자금일보·통합상황판은 active 를 보지만, 자금흐름 분석의 국채 경로는 안 본다
-- ════════════════════════════════════════════════════════════════════

with b as (
  select *,
         coalesce(bond_ticker, bond_name, bank) as dedup_key,
         coalesce(price_date, start_date)       as as_of
  from public.investments
  where company = '메디아나' and product = '국채'
),
latest as (                       -- 묶음(키)별 최신 1행 = 화면이 쓰는 값
  select distinct on (dedup_key) *
  from b order by dedup_key, as_of desc nulls last, id
),
agg as (
  select count(*) as 키수,
         sum(case when active is not false then 1 else 0 end) as 활성키수,
         sum(coalesce(bond_qty,0) * coalesce(bond_price,0) / 10) as 전체평가액,
         sum(case when active is not false
                  then coalesce(bond_qty,0) * coalesce(bond_price,0) / 10 else 0 end) as 활성평가액
  from latest
)
select * from (
  -- ① 묶음(키)별 현황 — 여기서 2줄 이상이면 그만큼 합산되고 있다는 뜻
  select 1 as 순, '① 국채 묶음' as 구분,
         coalesce(l.bond_ticker,'(티커없음)') as 티커,
         coalesce(l.bond_name, l.bank, '-')   as 종목명,
         to_char(coalesce(l.bond_qty,0) * coalesce(l.bond_price,0) / 10, 'FM999,999,999,999') as 평가액,
         l.as_of::text || ' / ' ||
           case when l.active is false
                then '매도·만기(active=false' || coalesce(', 종료일 ' || l.closed_date::text, ', 종료일 없음') || ')'
                else '보유중' end as 기준일_상태,
         (select count(*) from b where b.dedup_key = l.dedup_key)::text || '행' as 이력행수
  from latest l
  union all
  -- ② 판정
  select 2, '② 판정', '', '',
         to_char(전체평가액,'FM999,999,999,999'),
         '묶음 ' || 키수 || '개 중 보유중 ' || 활성키수 || '개 · 보유중 평가액 ' ||
           to_char(활성평가액,'FM999,999,999,999') || '원',
         case
           when 키수 <= 1 then '중복 없음 — 다른 원인을 찾아야 함'
           when 활성키수 < 키수 then '(B) 매도·만기된 국채가 자금흐름 분석에만 남아 중복 — 코드 수정으로 해결'
           else '(A) 같은 종목이 키가 다른 두 행으로 등록됨 — 데이터 정리 필요'
         end
  from agg
) x order by 순, 평가액 desc;
