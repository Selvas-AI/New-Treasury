-- ============================================================
-- approval_resubmit_reset.sql  (2026-11-05)
-- 목적: 자금일보가 **반려 후 재상신되면 전원이 다시 승인**하도록 한다.
--
--   기존: 반려해도 승인 로그가 그대로 남아, 재상신하면 반려자만 다시 누르면 완료됐다.
--         → 먼저 승인한 사람은 **수정 전 내용에 승인**한 것이 되는데 도장은 수정본에 남는다.
--         병렬 결재에서 특히 두드러진다(A 승인 → B 반려 → 재상신 → B만 누르면 끝).
--   변경: "마지막 반려 **이후**에 찍힌 승인만 유효"로 판정한다.
--         ⭐ 승인 로그는 지우지 않는다 — 이력은 그대로 보존하고 판정만 바꾼다.
--
-- ⚠ 함께 고쳐야 하는 것: 결재 요청 메일의 중복 방지 키
--   approval_notifications 의 unique(report_id, step) 때문에, 재상신해도
--   **이미 메일을 받은 사람에게는 다시 가지 않는다.** 전원 재승인으로 바꾸면
--   전원이 다시 요청을 받아야 하므로 회차(round)를 키에 넣는다.
--   round = 그 일보의 submit 로그 수 (최초 상신 1, 재상신마다 +1).
--   ⭐ round 는 **함수가 DB 에서 직접 계산**한다 — GAS 는 호출 인자를 바꾸지 않아도 되고
--     재배포도 필요 없다.
--
-- ⚠ 판정 규칙은 클라이언트(src/lib/approvalFlow.ts 의 validApprovedSteps)와
--   **반드시 같아야 한다.** 한쪽만 고치면 "화면엔 승인 대기인데 메일은 안 오는"
--   (또는 그 반대) 상태가 된다.
--
-- 선행: approval_notification.sql, approval_parallel_stage.sql
-- 멱등: 여러 번 실행해도 안전하다.
-- ============================================================

-- ── [1] 알림 중복 방지 키에 회차 추가 ───────────────────────
alter table public.approval_notifications
  add column if not exists round int not null default 1;

comment on column public.approval_notifications.round is
  '상신 회차. 반려 후 재상신하면 증가해 같은 결재자에게 요청 메일이 다시 나간다';

do $$
begin
  -- 구 유니크(report_id, step) 제거 → (report_id, step, round)
  if exists (
    select 1 from pg_constraint
    where conname = 'approval_notifications_report_step_unique'
  ) then
    alter table public.approval_notifications
      drop constraint approval_notifications_report_step_unique;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'approval_notifications_report_step_round_unique'
  ) then
    alter table public.approval_notifications
      add constraint approval_notifications_report_step_round_unique
      unique (report_id, step, round);
  end if;
end $$;

-- ── [2] 회차 계산 헬퍼 ──────────────────────────────────────
-- 최초 상신 = 1. 반려 후 재상신할 때마다 submit 로그가 하나 더 쌓여 증가한다.
create or replace function public.approval_round(p_report_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(1, count(*)::int)
  from public.daily_report_approvals
  where report_id = p_report_id and action = 'submit'
$$;

-- ── [3] 알림 대상 조회 — 반려 이후 승인만 유효 + 회차별 발송 ──
create or replace function public.approval_notifications_pending(
  p_token     text,
  p_report_id uuid default null
)
returns table (
  report_id      uuid,
  company        text,
  report_date    date,
  step           int,
  role_label     text,
  approver_code  text,
  approver_name  text,
  approver_email text,
  submitted_by   text,
  submitter_name text,
  submitted_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  with target as (
    select r.id, r.company, r.report_date, r.submitted_by, r.submitted_at,
           public.approval_round(r.id) as round,
           -- 마지막 반려 시각. 이보다 **뒤에** 찍힌 승인만 유효하다.
           (select max(a.created_at) from public.daily_report_approvals a
             where a.report_id = r.id and a.action = 'reject') as reject_at
    from public.daily_reports r
    where public.check_notify_token(p_token)
      and r.status = 'submitted'
      and (p_report_id is null or r.id = p_report_id)
  ),
  -- 각 일보의 '지금 차수' = 유효 승인이 없는 슬롯이 남은 가장 낮은 coalesce(stage, step)
  cur as (
    select t.id, min(coalesce(c.stage, c.step)) as stage
    from target t
    join public.daily_report_approval_config c
      on c.company = t.company and c.is_active
    where not exists (
      select 1 from public.daily_report_approvals a
      where a.report_id = t.id and a.action = 'approve' and a.step = c.step
        and (t.reject_at is null or a.created_at > t.reject_at)
    )
    group by t.id
  )
  select
    t.id, t.company, t.report_date,
    c.step, c.role_label, c.approver_code,
    u.name, u.email,
    t.submitted_by, su.name, t.submitted_at
  from target t
  join cur on cur.id = t.id
  -- 그 차수에서 아직 (유효하게) 승인하지 않은 결재자 전원
  join public.daily_report_approval_config c
    on c.company = t.company
   and c.is_active
   and coalesce(c.stage, c.step) = cur.stage
   and not exists (
     select 1 from public.daily_report_approvals a
     where a.report_id = t.id and a.action = 'approve' and a.step = c.step
       and (t.reject_at is null or a.created_at > t.reject_at)
   )
  -- 결재자 코드 매칭은 화면(sameCode)과 같은 기준 — 공백·대소문자 무시
  join public.treasury_users u
    on lower(btrim(u.user_code)) = lower(btrim(c.approver_code))
   and u.is_active
   and coalesce(u.email, '') <> ''
  left join public.treasury_users su
    on lower(btrim(su.user_code)) = lower(btrim(coalesce(t.submitted_by, '')))
  -- 이번 회차에 아직 안 보낸 건만
  where not exists (
    select 1 from public.approval_notifications n
    where n.report_id = t.id and n.step = c.step and n.round = t.round
  )
  order by t.submitted_at nulls last, c.step
$$;

-- ── [4] 발송 기록 — 회차를 함수가 직접 계산(GAS 인자 불변) ───
create or replace function public.record_approval_notification(
  p_token      text,
  p_report_id  uuid,
  p_step       int,
  p_recipients text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
begin
  if not public.check_notify_token(p_token) then
    raise exception 'unauthorized';
  end if;

  insert into public.approval_notifications (report_id, step, recipients, round)
  values (p_report_id, p_step, p_recipients, public.approval_round(p_report_id))
  on conflict (report_id, step, round) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end
$$;

grant execute on function public.approval_round(uuid)                                to anon, authenticated;
grant execute on function public.approval_notifications_pending(text, uuid)          to anon, authenticated;
grant execute on function public.record_approval_notification(text, uuid, int, text) to anon, authenticated;

-- ── [5] 적용 확인 (읽기 전용) ───────────────────────────────
-- 반려 이력이 있는 일보의 '유효 승인' 현황. 반려 전 승인은 무효로 집계된다.
select
  r.company,
  r.report_date,
  r.status,
  public.approval_round(r.id)                                          as 상신회차,
  count(*) filter (where a.action = 'approve')                         as 승인로그,
  count(*) filter (
    where a.action = 'approve'
      and a.created_at > coalesce(
        (select max(x.created_at) from public.daily_report_approvals x
          where x.report_id = r.id and x.action = 'reject'), '-infinity')
  )                                                                    as 유효승인,
  count(*) filter (where a.action = 'reject')                          as 반려횟수
from public.daily_reports r
join public.daily_report_approvals a on a.report_id = r.id
group by r.id, r.company, r.report_date, r.status
having count(*) filter (where a.action = 'reject') > 0
order by r.report_date desc
limit 20;
