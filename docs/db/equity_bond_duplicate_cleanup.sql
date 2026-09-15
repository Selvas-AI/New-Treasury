-- ============================================================================
-- 지분·국채 동일 기준일 중복 행 정리                              (2026-09-15)
--
--   증상: 같은 종목·같은 기준일 행이 2건씩 쌓여 그 날짜의 평가액이 배로 표시됨.
--   원인: 중복 검사가 클라이언트 스냅샷에만 있어(TOCTOU), 두 사용자·두 탭이
--         같은 날 동시에 시세를 갱신하면 둘 다 "없음"을 보고 둘 다 INSERT 한다.
--         DB 유니크 제약이 없어 막지 못했다.
--
--   [사용법]   아래 [실행] 블록을 전체 선택해 Supabase SQL Editor 에서 Run 한 번.
--              삭제·백업·재발방지 인덱스까지 끝나고 마지막에 결과표가 뜬다.
--              여러 번 실행해도 안전하다(이미 정리됐으면 0건으로 끝난다).
--   [되돌리기] 맨 아래 [복구] 절 참조. 지운 행은 backup 스키마에 그대로 남는다.
--   [진단]     무엇이 지워질지 미리 보고 싶을 때만. 실행에는 필요 없다.
-- ============================================================================


-- ###########################################################################
-- # [실행]  여기부터 결과표 select 까지 전체 선택 → Run
-- ###########################################################################

create schema if not exists backup;

do $$
declare
  v_eq int := 0; v_bond int := 0; v_eq_left int; v_bond_left int;
  v_idx_eq text := '생성됨'; v_idx_bond text := '생성됨';
begin
  -------------------------------------------------------------------------
  -- 0. 백업 (지운 행을 그대로 보관 — 되돌릴 수 있다)
  -------------------------------------------------------------------------
  create table if not exists backup.equities_dup_20260915    (like public.equities);
  create table if not exists backup.investments_dup_20260915 (like public.investments);
  create table if not exists backup.cleanup_summary_20260915 (
    ran_at timestamptz, 항목 text, 값 text);

  -------------------------------------------------------------------------
  -- 1. 지분(equities) 중복 삭제
  --    보존 우선순위:
  --      1) 자금일보(daily_report_items.linked_id)가 참조하는 행 — 지우면 역추적이 끊긴다
  --      2) 값이 유효한 행 (total_value>0 · price>0) — 시세 조회 실패분(0)은 버린다
  --      3) created_at 이 늦은 행 — 같은 날 두 번 조회됐다면 나중 것이 "종가"다
  --      4) 취득가액 입력분   5) 평가액 큰 행   6) id (결정적 tie-break)
  --    주의: 2)가 3)보다 앞인 이유 — 0원 행이 더 늦게 들어온 사례가 실재한다
  --          (셀바스헬스케어 2026-07-01 price 0 / 2,825). 3)만 쓰면 0원을 남긴다.
  -------------------------------------------------------------------------
  with ranked as (
    select e.id, row_number() over (
      partition by e.company, e.name, e.date
      order by (exists (select 1 from public.daily_report_items i
                        where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
               (coalesce(e.total_value,0) > 0 and coalesce(e.price,0) > 0) desc,
               (to_jsonb(e)->>'created_at')::timestamptz desc nulls last,
               (coalesce(e.acquisition_cost,0) > 0) desc,
               coalesce(e.total_value,0) desc,
               e.id) as rn
    from public.equities e)
  insert into backup.equities_dup_20260915
  select e.* from public.equities e
  join ranked r on r.id = e.id and r.rn > 1
  where not exists (select 1 from backup.equities_dup_20260915 b where b.id = e.id);

  delete from public.equities e using backup.equities_dup_20260915 b where b.id = e.id;
  get diagnostics v_eq = row_count;

  -------------------------------------------------------------------------
  -- 2. 국채(investments, product='국채') 중복 삭제
  --    주의: 지분과 달리 "금액이 완전히 같은" 중복만 지운다.
  --          금액이 다르면 같은 채권을 나눠 보유한 별개 건일 수 있어 사람이 판단해야
  --          한다. 금액이 같은 중복은 자동 갱신 경합으로 생긴 것이 확실하다.
  -------------------------------------------------------------------------
  with grp as (
    select v.company, coalesce(v.bond_ticker, v.bond_name) as k, v.start_date
    from public.investments v where v.product = '국채'
    group by 1,2,3 having count(*) > 1 and count(distinct v.amount) = 1
  ), ranked as (
    select v.id, row_number() over (
      partition by v.company, coalesce(v.bond_ticker, v.bond_name), v.start_date
      order by (exists (select 1 from public.daily_report_items i
                        where i.linked_id::text = v.id::text and i.linked_type = 'investment')) desc,
               (to_jsonb(v)->>'created_at')::timestamptz desc nulls last,
               (coalesce(v.acquisition_cost,0) > 0) desc,
               v.id) as rn
    from public.investments v
    join grp g on g.company = v.company
              and g.k = coalesce(v.bond_ticker, v.bond_name)
              and g.start_date = v.start_date
    where v.product = '국채')
  insert into backup.investments_dup_20260915
  select v.* from public.investments v
  join ranked r on r.id = v.id and r.rn > 1
  where not exists (select 1 from backup.investments_dup_20260915 b where b.id = v.id);

  delete from public.investments v using backup.investments_dup_20260915 b where b.id = v.id;
  get diagnostics v_bond = row_count;

  -------------------------------------------------------------------------
  -- 3. 재발 방지 — 근본 차단은 여기다.
  --    클라이언트 검사만으로는 동시 실행 경합을 막을 수 없다(DB 제약만이 막는다).
  -------------------------------------------------------------------------
  begin
    create unique index if not exists equities_company_name_date_uniq
      on public.equities (company, name, date);
  exception when others then v_idx_eq := '실패 - ' || sqlerrm;
  end;

  select count(*) into v_bond_left from (
    select 1 from public.investments where product = '국채'
    group by company, coalesce(bond_ticker, bond_name), start_date having count(*) > 1) t;

  -- 비국채(정기예금 등)는 같은 은행·같은 날 복수 계약이 정상이므로 국채에만 건다.
  if v_bond_left = 0 then
    begin
      create unique index if not exists investments_bond_company_ticker_date_uniq
        on public.investments (company, coalesce(bond_ticker, bond_name), start_date)
        where product = '국채';
    exception when others then v_idx_bond := '실패 - ' || sqlerrm;
    end;
  else
    v_idx_bond := '보류 - 금액이 다른 국채 중복 ' || v_bond_left || '그룹이 남아 사람 확인 필요';
  end if;

  -------------------------------------------------------------------------
  -- 4. 결과 기록
  -------------------------------------------------------------------------
  select count(*) into v_eq_left from (
    select 1 from public.equities group by company, name, date having count(*) > 1) t;

  delete from backup.cleanup_summary_20260915;
  insert into backup.cleanup_summary_20260915 (ran_at, 항목, 값) values
    (now(), '1. 지분 삭제',            v_eq   || ' 건'),
    (now(), '2. 국채 삭제',            v_bond || ' 건 (금액 동일 중복만)'),
    (now(), '3. 지분 남은 중복',       v_eq_left   || ' 그룹'),
    (now(), '4. 국채 남은 중복',       v_bond_left || ' 그룹 (금액이 달라 보류)'),
    (now(), '5. 지분 재발방지 인덱스', v_idx_eq),
    (now(), '6. 국채 재발방지 인덱스', v_idx_bond),
    (now(), '7. 백업 위치',            'backup.equities_dup_20260915 / backup.investments_dup_20260915');
end $$;

-- 결과표 (Supabase 는 마지막 문장의 결과만 보여주므로 이 select 가 끝에 있어야 한다)
select 항목, 값 from backup.cleanup_summary_20260915 order by 항목;


-- ###########################################################################
-- # [복구] 잘못됐을 때 되돌리기 — 지운 행을 그대로 복원한다
-- #        주의: 복원하면 중복이 되살아나 유니크 인덱스와 충돌한다. 인덱스 먼저 제거.
-- ###########################################################################
-- drop index if exists public.equities_company_name_date_uniq;
-- drop index if exists public.investments_bond_company_ticker_date_uniq;
-- insert into public.equities    select * from backup.equities_dup_20260915;
-- insert into public.investments select * from backup.investments_dup_20260915;


-- ###########################################################################
-- # [진단] 실행에는 필요 없다. 무엇이 지워질지 미리 보고 싶을 때만.
-- ###########################################################################

-- (가) 중복 그룹 목록
-- select company, name, date, count(*) 건수, count(distinct total_value) 서로다른값
-- from public.equities group by 1,2,3 having count(*) > 1 order by 3 desc;

-- (나) 무엇을 남기고 지울지 미리보기 — [실행]과 동일한 규칙
-- with ranked as (
--   select e.*, count(*) over (partition by e.company, e.name, e.date) c,
--     row_number() over (partition by e.company, e.name, e.date
--       order by (exists (select 1 from public.daily_report_items i
--                         where i.linked_id::text = e.id::text and i.linked_type = 'equity')) desc,
--                (coalesce(e.total_value,0) > 0 and coalesce(e.price,0) > 0) desc,
--                (to_jsonb(e)->>'created_at')::timestamptz desc nulls last,
--                (coalesce(e.acquisition_cost,0) > 0) desc,
--                coalesce(e.total_value,0) desc, e.id) rn
--   from public.equities e)
-- select company, name, date,
--        case when rn = 1 then '보존' else '삭제' end 처리,
--        price, total_value, created_at
-- from ranked where c > 1 order by company, name, date desc, rn;

-- (다) 자금일보가 참조하는 행이 한 그룹에 2건 이상인가 (있으면 사람이 판단)
-- select d.company, d.name, d.date, count(*) 참조건수
-- from (select e.*, count(*) over (partition by e.company, e.name, e.date) c
--       from public.equities e) d
-- join public.daily_report_items i
--   on i.linked_id::text = d.id::text and i.linked_type = 'equity'
-- where d.c > 1 group by 1,2,3 having count(*) > 1;
