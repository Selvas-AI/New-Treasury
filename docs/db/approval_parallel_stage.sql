-- ============================================================
-- approval_parallel_stage.sql  (2026-11-05)
-- 목적: 자금일보 결재를 **병렬(동시) 결재**까지 지원하도록 확장한다.
--
--   현재: step 1 → 2 → 3 순차. 앞 단계가 끝나야 다음 사람이 누를 수 있다.
--   변경: step 은 '결재자 슬롯'으로 두고, 진행 차수를 뜻하는 stage 를 추가한다.
--         같은 stage 끼리는 병렬, stage 가 다르면 순차.
--
--   예) 중간결재자 3명 동시 → 최종 1명
--       step 1,2,3 → stage 1   /   step 4 → stage 2
--
-- ⭐ 하위 호환: stage 가 NULL 이면 step 을 그대로 쓴다
--    = 차수가 전부 달라짐 = **지금과 똑같은 순차 결재**.
--    기존 법인 설정은 손대지 않아도 동작이 바뀌지 않는다.
--
-- ⚠ 판정 규칙은 클라이언트(src/lib/approvalFlow.ts)와 **반드시 같아야 한다.**
--    여기(메일 수신자)와 화면(버튼 노출)이 갈라지면
--    "버튼은 안 보이는데 메일은 오는" 상태가 된다. 한쪽만 고치지 말 것.
--
-- 선행: docs/db/approval_notification.sql 이 적용돼 있어야 한다(토큰·발송이력).
-- 멱등: 여러 번 실행해도 안전하다.
-- ============================================================

-- ── [1] 차수 컬럼 ───────────────────────────────────────────
alter table public.daily_report_approval_config
  add column if not exists stage int;

comment on column public.daily_report_approval_config.stage is
  '진행 차수. 같은 차수끼리 병렬 승인, 차수가 다르면 순차. NULL = step 을 차수로 사용(기존 순차 동작)';

-- 차수는 1 이상만. (NULL 허용 — 기존 행과 "순차로 두겠다"는 의사표시)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_report_approval_config_stage_positive'
  ) then
    alter table public.daily_report_approval_config
      add constraint daily_report_approval_config_stage_positive
      check (stage is null or stage >= 1);
  end if;
end $$;

-- ── [2] 알림 대상 조회 — 차수 전원에게 동시 발송 ─────────────
-- 기존: 미승인 중 가장 낮은 step 1건만(limit 1) → 병렬에서 한 명에게만 메일이 갔다.
-- 변경: 미승인 슬롯이 남아 있는 **가장 낮은 차수**를 찾아, 그 차수에서
--       아직 승인하지 않은 결재자 **전원**을 돌려준다.
--
-- 중복 발송은 기존 unique(report_id, step) 가 그대로 막는다 —
-- 병렬이어도 슬롯(step)별로 1통씩이므로 키 설계를 바꿀 필요가 없다.
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
    select r.id, r.company, r.report_date, r.submitted_by, r.submitted_at
    from public.daily_reports r
    where public.check_notify_token(p_token)
      and r.status = 'submitted'
      and (p_report_id is null or r.id = p_report_id)
  ),
  -- 각 일보의 '지금 차수' = 미승인 슬롯이 남은 가장 낮은 coalesce(stage, step)
  cur as (
    select t.id,
           min(coalesce(c.stage, c.step)) as stage
    from target t
    join public.daily_report_approval_config c
      on c.company = t.company and c.is_active
    where not exists (
      select 1 from public.daily_report_approvals a
      where a.report_id = t.id and a.action = 'approve' and a.step = c.step
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
  -- 그 차수에서 아직 승인하지 않은 결재자 전원
  join public.daily_report_approval_config c
    on c.company = t.company
   and c.is_active
   and coalesce(c.stage, c.step) = cur.stage
   and not exists (
     select 1 from public.daily_report_approvals a
     where a.report_id = t.id and a.action = 'approve' and a.step = c.step
   )
  -- 결재자 코드 매칭은 화면(sameCode)과 같은 기준 — 공백·대소문자 무시
  join public.treasury_users u
    on lower(btrim(u.user_code)) = lower(btrim(c.approver_code))
   and u.is_active
   and coalesce(u.email, '') <> ''
  left join public.treasury_users su
    on lower(btrim(su.user_code)) = lower(btrim(coalesce(t.submitted_by, '')))
  where not exists (
    select 1 from public.approval_notifications n
    where n.report_id = t.id and n.step = c.step
  )
  order by t.submitted_at nulls last, c.step
$$;

grant execute on function public.approval_notifications_pending(text, uuid) to anon, authenticated;

-- ── [3] 적용 확인 (읽기 전용) ───────────────────────────────
select
  company,
  count(*)                                          as 결재자수,
  count(distinct coalesce(stage, step))             as 차수,
  case when count(*) = count(distinct coalesce(stage, step))
       then '순차' else '병렬 포함' end             as 결재방식,
  string_agg(step || '단계=' || coalesce(stage, step) || '차(' || role_label || ')', ', ' order by step) as 구성
from public.daily_report_approval_config
where is_active
group by company
order by company;
