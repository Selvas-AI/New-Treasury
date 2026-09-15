-- ============================================================================
-- 지분·국채 동일 기준일 중복 행 진단 · 정리
--   증상: 같은 종목·같은 기준일 행이 누적 저장되어 그 날짜의 평가액이 배로 표시됨
--         (대시보드 '지분/장기투자 평가 추이' 차트는 날짜별로 행을 전부 합산한다 —
--          EquityCard.tsx dateMap.set(h.date, 기존 + h.total_value))
--   ⚠ KPI·자금일보는 getLatestEquities/getLatestBonds 가 종목별 1건만 쓰므로 영향 없음.
--     부풀려지는 곳은 '날짜별로 합산하는' 추이 차트·자금흐름 분석이다.
--
--   반드시 1단계 → (결과 검토·승인) → 2단계 → 3단계 순서로 실행할 것.
--   ⚠ Supabase SQL Editor 는 여러 문장을 한 번에 실행하면 **마지막 문장의 결과만** 보여준다.
--     1-A ~ 1-D 는 블록 단위로 하나씩 선택해 실행할 것(전체 실행하면 1-D 만 보인다).
--   1단계는 읽기 전용이다.
-- ============================================================================


-- ── 1단계 ▸ 진단 (읽기 전용 — 먼저 이것만 실행해 결과를 확인할 것) ───────────

-- 1-0. 타입 확인 — equities.id / investments.id 는 text, daily_report_items.linked_id 는
--      uuid 라 그대로 비교하면 42883(operator does not exist: uuid = text)이 난다.
--      아래 1-C·1-D 와 2단계는 양쪽을 ::text 로 맞춰 비교한다.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (   (table_name = 'equities'           and column_name = 'id')
       or (table_name = 'investments'        and column_name = 'id')
       or (table_name = 'daily_report_items' and column_name = 'linked_id'))
order by table_name;

-- 1-A. 지분 중복 요약: 어떤 종목의 어느 날짜가 몇 건씩 쌓였나
select company, name, date, count(*) as 건수,
       count(distinct total_value) as 서로다른평가액,
       min(total_value) as 최소평가액, max(total_value) as 최대평가액
from public.equities
group by company, name, date
having count(*) > 1
order by company, name, date desc;

-- 1-B. 국채 중복 요약
select company, bond_ticker, bond_name, start_date, count(*) as 건수,
       count(distinct amount) as 서로다른평가액,
       min(amount) as 최소, max(amount) as 최대
from public.investments
where product = '국채'
group by company, bond_ticker, bond_name, start_date
having count(*) > 1
order by company, bond_name, start_date desc;

-- 1-C. ⚠ 안전 점검 — 삭제 후보 중 자금일보 항목이 참조하는 행이 있는가?
--      (daily_report_items.linked_id 로 연결된 행을 지우면 일보의 역추적이 끊긴다.
--       2단계는 이런 행을 '남기는 쪽'으로 우선 선택하지만, 한 그룹에서 2건 이상이
--       참조되면 아래에 나온다 — 그 그룹은 손대지 말고 사람이 판단할 것.)
with dup as (
  select id, company, name, date,
         count(*) over (partition by company, name, date) as c
  from public.equities
)
select d.company, d.name, d.date, d.id, i.id as 참조한_일보항목
from dup d
join public.daily_report_items i
  on i.linked_id::text = d.id::text and i.linked_type = 'equity'
where d.c > 1
order by d.company, d.name, d.date desc;

-- 1-D. 총 삭제 예정 건수 (지분)
select count(*) as 삭제예정_지분건수 from (
  select id, row_number() over (
    partition by company, name, date
    order by (exists (select 1 from public.daily_report_items i
                      where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
             (coalesce(acquisition_cost,0) > 0) desc,
             coalesce(total_value,0) desc,
             id
  ) as rn
  from public.equities e
) t where rn > 1;


-- ── 2단계 ▸ 삭제 (1단계 결과를 승인한 뒤에만 실행) ───────────────────────────
--   보존 규칙(우선순위 순): ① 자금일보가 참조하는 행 ② 취득가액이 입력된 행
--                          ③ 평가액이 큰 행 ④ id (결정적 tie-break)
--   → 그룹당 정확히 1건만 남고 나머지가 삭제된다.
--   ⚠ 실행 전 백업을 먼저 만든다(아래 create table 이 그 백업이다).

do $$
declare v_eq int; v_bond int;
begin
  -- 백업 (되돌릴 수 있게)
  create table if not exists backup.equities_dup_20260915 as
    select * from public.equities where false;
  create table if not exists backup.investments_dup_20260915 as
    select * from public.investments where false;

  -- 지분
  with ranked as (
    select e.id, row_number() over (
      partition by e.company, e.name, e.date
      order by (exists (select 1 from public.daily_report_items i
                        where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
               (coalesce(e.acquisition_cost,0) > 0) desc,
               coalesce(e.total_value,0) desc,
               e.id
    ) as rn
    from public.equities e
  ), doomed as (select id from ranked where rn > 1)
  , saved as (
    insert into backup.equities_dup_20260915
    select * from public.equities where id in (select id from doomed)
    returning 1
  )
  select count(*) into v_eq from saved;

  delete from public.equities where id in (
    select id from (
      select e.id, row_number() over (
        partition by e.company, e.name, e.date
        order by (exists (select 1 from public.daily_report_items i
                          where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
                 (coalesce(e.acquisition_cost,0) > 0) desc,
                 coalesce(e.total_value,0) desc,
                 e.id
      ) as rn from public.equities e
    ) t where rn > 1
  );

  -- 국채
  with ranked as (
    select v.id, row_number() over (
      partition by v.company, coalesce(v.bond_ticker, v.bond_name), v.start_date
      order by (exists (select 1 from public.daily_report_items i
                        where i.linked_id::text = v.id::text and i.linked_type = 'investment')) desc,
               (coalesce(v.acquisition_cost,0) > 0) desc,
               coalesce(v.amount,0) desc,
               v.id
    ) as rn
    from public.investments v where v.product = '국채'
  ), doomed as (select id from ranked where rn > 1)
  , saved as (
    insert into backup.investments_dup_20260915
    select * from public.investments where id in (select id from doomed)
    returning 1
  )
  select count(*) into v_bond from saved;

  delete from public.investments where id in (
    select id from (
      select v.id, row_number() over (
        partition by v.company, coalesce(v.bond_ticker, v.bond_name), v.start_date
        order by (exists (select 1 from public.daily_report_items i
                          where i.linked_id::text = v.id::text and i.linked_type = 'investment')) desc,
                 (coalesce(v.acquisition_cost,0) > 0) desc,
                 coalesce(v.amount,0) desc,
                 v.id
      ) as rn from public.investments v where v.product = '국채'
    ) t where rn > 1
  );

  raise notice '삭제 — 지분 % 건 / 국채 % 건 (백업: backup.equities_dup_20260915, backup.investments_dup_20260915)', v_eq, v_bond;
end $$;


-- ── 3단계 ▸ 재발 방지 제약 (2단계로 중복이 0이 된 뒤에만 성공한다) ───────────
--   ⚠ 이것이 근본 차단이다. 클라이언트 중복검사는 조회 시점 스냅샷이라
--     두 탭·두 사람이 동시에 갱신하면 둘 다 '없음'을 보고 둘 다 INSERT 한다(TOCTOU).
--     DB 제약만이 그 경합을 막는다.

create unique index if not exists equities_company_name_date_uniq
  on public.equities (company, name, date);

-- 국채만 부분 유니크 — 비국채(정기예금 등)는 같은 은행·같은 날 복수 계약이 정상이다.
create unique index if not exists investments_bond_company_ticker_date_uniq
  on public.investments (company, coalesce(bond_ticker, bond_name), start_date)
  where product = '국채';


-- ── 검증 ────────────────────────────────────────────────────────────────────
select 'equities' as 테이블, count(*) as 남은중복 from (
  select 1 from public.equities group by company, name, date having count(*) > 1) t
union all
select 'investments(국채)', count(*) from (
  select 1 from public.investments where product='국채'
  group by company, coalesce(bond_ticker,bond_name), start_date having count(*) > 1) t;
