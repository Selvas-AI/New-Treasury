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
--   2. **영업일 계산에 공휴일 테이블이 필요 없다.** 기존 행이 이미 영업일에만
--      존재하므로 "각 행의 날짜 → 다음 행의 날짜" 로 밀면 정확히 +1 영업일이다.
--      대체공휴일·임시공휴일도 자동으로 맞는다.
--   3. UNIQUE(company, date) 충돌을 피하려고 **2단계**로 옮긴다
--      (한 번에 밀면 이동 도중 중복이 생겨 실패한다).
--   4. `fx_lots.source_id` · `fx_ledger_reconcile_ignored.daily_id` 는 daily 의 **id**
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
-- ⚠ 여기서 `new_date is null` 인 행 = **가장 최신 행**. 다음 영업일을 알 수 없으므로
--   §2 에서 :p_last_new_date 로 직접 지정한다. 오늘이 2026-08-20(목, 영업일)이고
--   마지막 daily 가 2026-08-19 라면 → '2026-08-20'.
select id, date as old_date,
       lead(date) over (order by date) as new_date
  from public.daily
 where company = '메디아나'
 order by date desc
 limit 20;

select id, report_date as old_date,
       lead(report_date) over (order by report_date) as new_date
  from public.daily_reports
 where company = '메디아나'
 order by report_date desc
 limit 20;


-- ── 2. 실행 ────────────────────────────────────────────────────────────────
-- ⚠ 아래 블록 전체를 **한 트랜잭션**으로 실행한다. 중간에 실패하면 전부 롤백된다.
-- ⚠ :LAST_NEW_DATE 를 실제 값으로 바꿔서 실행할 것 (예: '2026-08-20').
begin;

-- 2-1. daily
create temp table _shift_daily on commit drop as
  select id,
         date as old_date,
         lead(date) over (order by date) as new_date
    from public.daily
   where company = '메디아나';

-- 최신 행에 새 날짜 지정 (다음 영업일)
update _shift_daily
   set new_date = date '2026-08-20'      -- ⚠ :LAST_NEW_DATE — 실행 전 확인
 where new_date is null;

-- 안전장치: 목표 날짜에 중복이 없어야 한다
do $$
declare v_dup int;
begin
  select count(*) into v_dup
    from (select new_date from _shift_daily group by new_date having count(*) > 1) x;
  if v_dup > 0 then raise exception 'daily 목표 날짜 중복 %건 — 중단', v_dup; end if;
end $$;

-- 1단계: 충돌 회피용 임시 이동 (UNIQUE(company,date) 위반 방지)
update public.daily d
   set date = m.old_date + interval '10000 day'
  from _shift_daily m
 where d.id = m.id;

-- 2단계: 목표 날짜로 확정
update public.daily d
   set date = m.new_date
  from _shift_daily m
 where d.id = m.id;

-- 2-2. daily_reports (자금일보) — daily 와 짝을 유지해야 검증식이 깨지지 않는다
create temp table _shift_reports on commit drop as
  select id,
         report_date as old_date,
         lead(report_date) over (order by report_date) as new_date
    from public.daily_reports
   where company = '메디아나';

update _shift_reports
   set new_date = date '2026-08-21'      -- ⚠ 자금일보 최신이 8/20 이면 다음 영업일
 where new_date is null;

do $$
declare v_dup int;
begin
  select count(*) into v_dup
    from (select new_date from _shift_reports group by new_date having count(*) > 1) x;
  if v_dup > 0 then raise exception 'daily_reports 목표 날짜 중복 %건 — 중단', v_dup; end if;
end $$;

update public.daily_reports r
   set report_date = m.old_date + interval '10000 day'
  from _shift_reports m
 where r.id = m.id;

update public.daily_reports r
   set report_date = m.new_date
  from _shift_reports m
 where r.id = m.id;

commit;


-- ── 3. 검증 ────────────────────────────────────────────────────────────────
-- 3-1. 건수가 그대로인가 (87건)
select count(*) from public.daily where company = '메디아나';

-- 3-2. 값이 한 칸씩 밀렸는가 — 백업의 D일 값이 현재 D+1영업일에 있어야 한다
select b.date as old_date, b.fx_usd as old_usd,
       d.date as new_date, d.fx_usd as new_usd
  from backup.daily_20260820 b
  join public.daily d on d.id = b.id
 order by b.date desc
 limit 10;

-- 3-3. 미래 날짜로 잘못 밀린 행이 없는가 (10000일 임시 오프셋 잔존 확인)
select count(*) from public.daily
 where company = '메디아나' and date > current_date + 10;

-- 3-4. 다른 법인은 건드리지 않았는가
select company, max(date) from public.daily group by company order by company;


-- ── 4. 롤백 (문제 발생 시에만) ─────────────────────────────────────────────
-- ⚠ 백업 테이블이 있어야 한다. 실행 전 반드시 §3 으로 상태를 확인할 것.
-- begin;
-- update public.daily d set date = b.date + interval '10000 day'
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
