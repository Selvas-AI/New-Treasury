-- ═══════════════════════════════════════════════════════════════════════════
-- 메디아나 자금현황 기재일 +1 영업일 시프트 (2026-08-20 회의 결정)
--
-- 배경: 법인마다 자금현황 기재 시점이 달랐다.
--   셀바스에이아이·셀바스헬스케어 — D일 아침에 **전영업일 마감잔액**을 D일자로 기재
--     (시스템의 표준 모델: CLAUDE.md 자금일보 §0 — daily[D] = D-1영업일 마감)
--   메디아나                       — D일 마감액을 **D일자로** 기재(= 한 영업일 늦음)
--     → 당일 아침에 당일자 입력이 불가능했다.
--   내일부터 표준에 맞추기로 했고, **과거 데이터도 +1 영업일 밀어** 정합성을 맞춘다.
--
-- ⚠⚠ 반드시 읽을 것
--   1. `daily` 만 옮기면 **과거 자금일보가 전부 깨진다.**
--      자금일보는 daily[작성일](마감) 과 daily[전영업일](기초) 을 읽어
--      `입금 − 출금 − 잔액증감 = 0` 을 검증한다. 한쪽만 밀면 이미 승인된
--      과거 일보의 검증식이 어긋난다 → `daily_reports.report_date` 도 함께 민다.
--   2. **영업일 계산에 공휴일 테이블이 필요 없다.** `daily` 가 영업일마다 빠짐없이
--      존재하므로 그 날짜 시퀀스가 곧 영업일 달력이다. 대체공휴일도 자동으로 맞는다.
--      ⚠⚠ **`daily_reports` 를 자기 시퀀스로 밀면 안 된다.** 일보를 안 쓴 날이 비어 있어
--      영업일을 점프한다(실측: 2026-06-05 → 06-09, 6/08 일보 없음). 양쪽 모두
--      **daily 달력**으로 민다.
--   3. ⚠ **두 테이블의 날짜 컬럼 타입이 다르다.**
--        `public.daily.date`                = **text** (YYYY-MM-DD)
--        `public.daily_reports.report_date` = **date**
--      비교·대입에 명시적 캐스팅이 필요하다. 캐스팅 없이 조인하면
--      `operator does not exist: text = date` 오류가 난다.
--
--   4. UNIQUE(company, date) 충돌을 피하려고 **2단계**로 옮긴다
--      (한 번에 밀면 이동 도중 중복이 생겨 실패한다).
--   5. `fx_lots.source_id` · `fx_ledger_reconcile_ignored.daily_id` 는 daily 의 **id**
--      를 참조한다 — id 는 바뀌지 않으므로 영향 없다.
--
-- 실행 절차
--   ① §0 백업 → ② §1 DRY-RUN 으로 변경 예정 목록 확인 → ③ 마지막 행 새 날짜 확인
--   → ④ §2 트랜잭션 실행 → ⑤ §3 검증
--   문제가 생기면 §4 롤백 스크립트로 되돌린다(백업 테이블 필요).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. 백업 (필수) ─────────────────────────────────────────────────────────
-- ⚠ 이걸 먼저 하지 않으면 되돌릴 방법이 없다.
--
-- ⚠⚠ **backup 스키마에 만든다. public 에 만들지 말 것.**
--   Supabase 는 public 스키마를 PostgREST 로 자동 노출하고, 신규 테이블에
--   anon/authenticated 권한을 기본 부여한다(ALTER DEFAULT PRIVILEGES).
--   public.daily_backup_... 을 만들면 **RLS 없이 API 에 그대로 열려** 전 법인
--   자금 데이터가 anon 키로 조회 가능해진다.
--   backup 스키마는 PostgREST 노출 대상(Exposed schemas)이 아니라 안전하다.

create schema if not exists backup;
revoke all on schema backup from anon, authenticated;

drop table if exists backup.daily_20260820;
drop table if exists backup.daily_reports_20260820;

create table backup.daily_20260820 as
  select * from public.daily where company = '메디아나';
create table backup.daily_reports_20260820 as
  select * from public.daily_reports where company = '메디아나';

revoke all on backup.daily_20260820         from anon, authenticated;
revoke all on backup.daily_reports_20260820 from anon, authenticated;

-- 백업 건수 확인 — daily 87건 예상. 0 이 나오면 절대 다음 단계로 넘어가지 말 것.
select 'daily' as t, count(*) from backup.daily_20260820
union all
select 'daily_reports', count(*) from backup.daily_reports_20260820;


-- ── 1. DRY-RUN — 무엇이 어떻게 바뀌는지 먼저 눈으로 확인 ───────────────────
-- ⚠ 영업일 달력은 **daily 하나**를 쓴다. daily_reports 는 일보를 안 쓴 날이 비어 있어
--   자기 시퀀스로 밀면 영업일을 점프한다(실측: 2026-06-05 → 06-09, 6/08 일보 없음).
--
-- ⚠ 이 쿼리는 §2 와 **완전히 같은 계산**을 한다(달력 마지막 칸 채우기 포함).
--   따라서 여기 나오는 new_date 가 곧 최종 결과다 — NULL 이 하나도 없어야 정상이다.
--   (처음엔 달력 채우기를 빼고 보여줘서 NULL 이 3건 나왔다. daily 마지막(8/19)뿐 아니라
--    **report[8/19] 도 후속이 없어** NULL 이 됐는데, §2 는 달력을 먼저 채우므로
--    실제로는 8/20 으로 정상 매핑된다. DRY-RUN 이 §2 와 달라 혼동을 줬다.)
with base as (
  select date::date as d,                                   -- daily.date 는 text
         lead(date::date) over (order by date::date) as next_d
    from public.daily where company = '메디아나'
),
bizcal as (
  -- 달력 마지막(daily 최신)의 다음 영업일을 채운다 — §2 와 동일
  select d, coalesce(next_d, date '2026-08-20') as next_d from base   -- ⚠ 실행 전 확인
)
select 'daily' as tbl, d.date::date as old_date, c.next_d as new_date
  from public.daily d join bizcal c on c.d = d.date::date
 where d.company = '메디아나'
union all
select 'daily_reports', r.report_date,
       coalesce(c.next_d, date '2026-08-21')                -- ⚠ 달력에 없는 초안(8/20)
  from public.daily_reports r left join bizcal c on c.d = r.report_date
 where r.company = '메디아나'
 order by 1, 2 desc;

-- 확인 포인트
--   ① new_date 에 NULL 이 하나도 없어야 한다
--   ② daily         마지막: 2026-08-19 → 2026-08-20
--   ③ daily_reports 마지막: 2026-08-20 → 2026-08-21, 그 앞 2026-08-19 → 2026-08-20
--   ④ daily_reports 2026-06-05 → **2026-06-08** (자기 시퀀스였다면 06-09 로 튀었을 자리)

-- 목표 날짜 중복 검사 — 둘 다 0 이어야 한다
with base as (
  select date::date as d, lead(date::date) over (order by date::date) as next_d
    from public.daily where company = '메디아나'
), bizcal as (
  select d, coalesce(next_d, date '2026-08-20') as next_d from base
), tgt as (
  select 'daily' as tbl, c.next_d as new_date
    from public.daily d join bizcal c on c.d = d.date::date
   where d.company = '메디아나'
  union all
  select 'daily_reports', coalesce(c.next_d, date '2026-08-21')
    from public.daily_reports r left join bizcal c on c.d = r.report_date
   where r.company = '메디아나'
)
select tbl, count(*) - count(distinct new_date) as duplicated
  from tgt group by tbl;

-- daily 달력에 없는 report_date 건수 — **1** (오늘 작성 중인 초안)이어야 한다
select count(*) as reports_not_in_daily_calendar
  from public.daily_reports r
 where r.company = '메디아나'
   and r.report_date not in (select date::date from public.daily where company = '메디아나');


-- ── 2. 실행 ────────────────────────────────────────────────────────────────
-- ⚠⚠ **반드시 아래 DO 블록 하나로 실행한다. begin;/commit; 다중 문장으로 쪼개지 말 것.**
--   Supabase SQL Editor 는 커넥션 풀러를 통해 문장을 실행해서, `begin;` ~ `commit;` 을
--   써도 문장이 서로 다른 세션으로 갈 수 있다. 그러면 **temp table 이 다음 문장에서
--   보이지 않는다**(실측 2026-08-20: `relation "_bizcal" does not exist`).
--   더 나쁜 건 **원자성이 보장되지 않는다**는 점이다 — 중간에 끊기면 daily 만 밀리고
--   daily_reports 는 그대로 남는 반쪽 상태가 된다.
--   DO 블록은 **한 문장 = 한 트랜잭션**이라 이 문제가 없다.
--
-- ⚠ 영업일 달력은 `daily` 하나로 통일한다. daily_reports 는 일보를 안 쓴 날이 비어 있어
--   자기 시퀀스로 밀면 영업일을 점프한다(실측: 2026-06-05 → 06-09, 6/08 일보 없음).

do $$
declare
  v_last_biz    date := date '2026-08-20';   -- ⚠ daily 최신의 다음 영업일
  v_draft_next  date := date '2026-08-21';   -- ⚠ 달력에 없는 초안(오늘자)의 다음 영업일
  v_miss int; v_dup int; v_unmatched int;
begin
  -- 2-0. 영업일 달력 — daily 의 날짜 시퀀스가 곧 영업일 목록이다.
  --      공휴일 테이블이 필요 없고 대체공휴일도 자동으로 맞는다.
  create temp table _bizcal as
    select date::date as d,
           lead(date::date) over (order by date::date) as next_d
      from public.daily
     where company = '메디아나';
  update _bizcal set next_d = v_last_biz where next_d is null;

  -- 2-1. daily  (date 컬럼은 **text**)
  create temp table _shift_daily as
    select d.id, d.date::date as old_date, c.next_d as new_date
      from public.daily d
      join _bizcal c on c.d = d.date::date
     where d.company = '메디아나';

  select count(*) into v_miss from public.daily
   where company = '메디아나' and id not in (select id from _shift_daily);
  if v_miss > 0 then raise exception 'daily %건이 달력에 매칭되지 않음 — 중단', v_miss; end if;

  select count(*) into v_dup
    from (select new_date from _shift_daily group by new_date having count(*) > 1) x;
  if v_dup > 0 then raise exception 'daily 목표 날짜 중복 %건 — 중단', v_dup; end if;

  -- 1단계: 충돌 회피용 임시 이동 (UNIQUE(company,date) 위반 방지)
  update public.daily d
     set date = to_char(m.old_date + interval '10000 day', 'YYYY-MM-DD')
    from _shift_daily m where d.id = m.id;
  -- 2단계: 목표 날짜로 확정
  update public.daily d
     set date = to_char(m.new_date, 'YYYY-MM-DD')
    from _shift_daily m where d.id = m.id;

  -- 2-2. daily_reports  (report_date 컬럼은 **date**) — daily 달력으로 민다
  create temp table _shift_reports as
    select r.id, r.report_date as old_date,
           coalesce(c.next_d, v_draft_next) as new_date
      from public.daily_reports r
      left join _bizcal c on c.d = r.report_date
     where r.company = '메디아나';

  select count(*) into v_unmatched
    from public.daily_reports r
    left join _bizcal c on c.d = r.report_date
   where r.company = '메디아나' and c.d is null;
  if v_unmatched > 1 then
    raise exception 'daily 달력에 없는 report_date %건 — 확인 필요(초안 1건만 예상)', v_unmatched;
  end if;

  select count(*) into v_dup
    from (select new_date from _shift_reports group by new_date having count(*) > 1) x;
  if v_dup > 0 then raise exception 'daily_reports 목표 날짜 중복 %건 — 중단', v_dup; end if;

  update public.daily_reports r set report_date = m.old_date + interval '10000 day'
    from _shift_reports m where r.id = m.id;
  update public.daily_reports r set report_date = m.new_date
    from _shift_reports m where r.id = m.id;

  drop table _bizcal;
  drop table _shift_daily;
  drop table _shift_reports;

  raise notice '시프트 완료 — §3 검증을 실행하세요';
end $$;


-- ── 3. 검증 ────────────────────────────────────────────────────────────────
-- 3-1. 건수가 그대로인가 (87건)
select count(*) from public.daily where company = '메디아나';

-- 3-2. 값이 한 칸씩 밀렸는가 — 백업의 D일 값이 현재 D+1영업일에 있어야 한다
select b.date as old_date, b.fx_usd as old_usd,
       d.date as new_date, d.fx_usd as new_usd
  from backup.daily_20260820 b
  join public.daily d on d.id = b.id
 order by b.date::date desc
 limit 10;

-- 3-3. 미래 날짜로 잘못 밀린 행이 없는가 (10000일 임시 오프셋 잔존 확인)
select count(*) from public.daily
 where company = '메디아나' and date::date > current_date + 10;
select count(*) from public.daily_reports
 where company = '메디아나' and report_date > current_date + 10;

-- 3-4. 다른 법인은 건드리지 않았는가
select company, max(date::date) as max_date from public.daily group by company order by company;


-- ── 4. 롤백 (문제 발생 시에만) ─────────────────────────────────────────────
-- ⚠ 백업 테이블이 있어야 한다. 실행 전 반드시 §3 으로 상태를 확인할 것.
-- begin;
-- update public.daily d
--    set date = to_char(b.date::date + interval '10000 day', 'YYYY-MM-DD')
--   from backup.daily_20260820 b where d.id = b.id;
-- update public.daily d set date = b.date
--   from backup.daily_20260820 b where d.id = b.id;
-- update public.daily_reports r set report_date = b.report_date + interval '10000 day'
--   from backup.daily_reports_20260820 b where r.id = b.id;
-- update public.daily_reports r set report_date = b.report_date
--   from backup.daily_reports_20260820 b where r.id = b.id;
-- commit;

-- ── 5. 정리 (검증 완료 후, 충분한 시간이 지난 뒤에) ────────────────────────
-- ⚠ 서두르지 말 것. 자금일보·대시보드를 며칠 써보고 이상이 없을 때 지운다.
-- drop table backup.daily_20260820;
-- drop table backup.daily_reports_20260820;
