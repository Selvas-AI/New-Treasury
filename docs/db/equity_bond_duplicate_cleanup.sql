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
--   보존 규칙(우선순위 순):
--     ① 자금일보(daily_report_items.linked_id)가 참조하는 행 — 지우면 역추적이 끊긴다
--     ② 값이 유효한 행 (total_value>0 · price>0) — 시세 조회 실패분(0)은 무조건 버린다
--     ③ created_at 이 늦은 행 — 같은 날 두 번 조회됐다면 나중 것이 **종가**다
--     ④ 취득가액이 입력된 행  ⑤ 평가액이 큰 행  ⑥ id (결정적 tie-break)
--   ⚠ ②를 ③보다 앞에 둔 이유: 0원 행이 더 늦게 들어온 경우가 실제로 있다
--     (셀바스헬스케어 2026-07-01 → price 0 / 2,825). ③만 쓰면 0원을 남기게 된다.
--   ⚠ created_at 은 to_jsonb 로 읽는다 — investments 에 이 컬럼이 없어도 오류 없이
--     null(= nulls last)로 떨어져 기존 규칙으로 자연히 폴백한다.
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
               (coalesce(e.total_value,0) > 0 and coalesce(e.price,0) > 0) desc,
               (to_jsonb(e)->>'created_at')::timestamptz desc nulls last,
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
                 (coalesce(e.total_value,0) > 0 and coalesce(e.price,0) > 0) desc,
                 (to_jsonb(e)->>'created_at')::timestamptz desc nulls last,
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
               (coalesce(v.amount,0) > 0) desc,
               (to_jsonb(v)->>'created_at')::timestamptz desc nulls last,
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
                 (coalesce(v.amount,0) > 0) desc,
                 (to_jsonb(v)->>'created_at')::timestamptz desc nulls last,
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


-- ============================================================================
-- 1단계 추가 진단 (2026-09-15 · 1-A 결과에서 '서로다른평가액=2' 그룹이 발견되어 추가)
--   값이 동일한 중복은 어느 것을 지워도 같지만, 값이 다른 중복은 '무엇을 남길지'가
--   판단의 문제다. 특히 total_value=0 행(시세 조회 실패분)이 섞여 있다.
-- ============================================================================

-- 1-E. 값이 다른 그룹만 — 여기 나온 것만 사람이 판단하면 된다
select company, name, date,
       min(total_value) as 값1, max(total_value) as 값2,
       max(total_value) - min(total_value) as 차이,
       min(price) as 주가1, max(price) as 주가2,
       bool_or(coalesce(total_value,0) = 0) as 값0포함
from public.equities
group by company, name, date
having count(*) > 1 and count(distinct total_value) > 1
order by 값0포함 desc, 차이 desc;

-- 1-F. equities 에 삽입 순서를 알 수 있는 타임스탬프 컬럼이 있는가?
--      (있으면 '나중에 들어온 행 = 종가'를 남기는 것이 옳다. 없으면 판단 근거가 없다.)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'equities'
order by ordinal_position;

-- 1-G. audit_logs 로 삽입 시각을 역추적할 수 있는가?
--      (eq.save() 경로는 logAction 을 남기지만 autoRefreshPrices 의 restInsert 직접
--       호출은 남기지 않는다 — 일부만 추적될 수 있다.)
select count(*) as 중복행중_감사로그있음
from public.audit_logs a
where a.table_name = 'equities'
  and a.record_id in (
    select e.id from public.equities e
    join (select company, name, date from public.equities
          group by company, name, date having count(*) > 1) g
      on g.company = e.company and g.name = e.name and g.date = e.date
  );


-- ── 1-H. 값이 다른 그룹의 두 행을 나란히 — 육안 확인용 ───────────────────────
--   1-E 는 min/max 만 보여줘서 어느 행이 어느 값인지 알 수 없다. 실제 행을 편다.
with dup as (
  select e.*, count(*) over (partition by e.company, e.name, e.date) as c,
         count(distinct e.total_value) over (partition by e.company, e.name, e.date) as v
  from public.equities e
)
select company, name, date, id, shares, price, total_value, acquisition_cost, available
from dup
where c > 1 and v > 1
order by company, name, date desc, price;


-- ── 1-I. created_at 이 중복 판정에 쓸 만한가 (2단계 전 필수 확인) ─────────────
--   ① 중복 행에 created_at 이 비어 있지 않은가
--   ② 한 그룹의 두 행이 같은 시각이면 순서를 가릴 수 없다
with dup as (
  select e.*, count(*) over (partition by e.company, e.name, e.date) as c
  from public.equities e
)
select count(*)                                              as 중복행수,
       count(*) filter (where created_at is null)             as created_at_없음,
       count(distinct (company, name, date)) filter (where created_at is null) as 영향그룹,
       min(created_at)                                        as 가장이른기록,
       max(created_at)                                        as 가장늦은기록
from dup where c > 1;

-- 1-J. 2단계가 '무엇을 남기고 무엇을 지울지' 미리보기 (읽기 전용 — 삭제 아님)
--      값이 다른 그룹만 보여준다. 보존/삭제 행의 주가·시각을 나란히 확인할 것.
with ranked as (
  select e.*,
         count(*)                   over (partition by e.company, e.name, e.date) as c,
         count(distinct e.total_value) over (partition by e.company, e.name, e.date) as v,
         row_number() over (
           partition by e.company, e.name, e.date
           order by (exists (select 1 from public.daily_report_items i
                             where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
                    (coalesce(e.total_value,0) > 0 and coalesce(e.price,0) > 0) desc,
                    (to_jsonb(e)->>'created_at')::timestamptz desc nulls last,
                    (coalesce(e.acquisition_cost,0) > 0) desc,
                    coalesce(e.total_value,0) desc,
                    e.id
         ) as rn
  from public.equities e
)
select company, name, date,
       case when rn = 1 then '✅ 보존' else '🗑 삭제' end as 처리,
       price, total_value, created_at, acquisition_cost
from ranked
where c > 1 and v > 1
order by company, name, date desc, rn;
