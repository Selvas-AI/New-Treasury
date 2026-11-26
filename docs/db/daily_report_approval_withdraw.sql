-- ============================================================
-- daily_report_approval_withdraw.sql  (2026-11-26)
-- 자금일보 **승인 취소** + 승인된 일보 **서버 수정 차단**
--
-- ▶ 한 번 실행으로 끝납니다. 마지막에 결과표가 나옵니다. 여러 번 실행해도 안전합니다.
--   기존 데이터는 바꾸지 않습니다(함수·트리거 추가/교체만).
--
-- ── 왜 필요한가 (실무 요청) ─────────────────────────────────
--   승인 완료 후 수정할 일이 생겨도 되돌릴 방법이 없었다. 또 "승인 후 수정 불가"는
--   **화면에서만** 막혀 있어, 화면 밖 경로(다른 탭의 자동기재·직접 API)로는 승인된 일보가
--   바뀔 수 있었다.
--
-- ── 규칙 (2026-11-26 사용자 결정 = 권장안) ───────────────────
--   · 승인 취소 권한: **최종 결재 차수의 결재자**(can_approve) 또는 master. 사유 필수.
--   · 취소하면 상태 = 'rejected'(반려와 같은 상태) · daily.confirmed = false ·
--     결재 로그에 action='withdraw' 를 남긴다(이전 승인 로그는 지우지 않는다).
--   · 재상신하면 **전원 재승인** — "마지막 반려 **또는 승인 취소** 이후의 승인만 유효"
--     (src/lib/approvalFlow.ts validApprovedSteps 와 같은 규칙). 결재 요청 메일도 다시 나간다.
--   · 승인된 일보(status='approved')는 서버에서 수정 차단:
--       daily_report_items  추가·수정·삭제 금지
--       daily_reports       수정·삭제 금지 (승인 취소 RPC 만 예외)
--     ⚠ daily(잔액) 테이블은 대상이 아니다 — 잔액 입력 화면·시세 갱신 등 다른 경로가 쓴다.
--
-- 선행: daily_report_tables.sql(action 'withdraw' 허용), approval_resubmit_reset.sql(approval_round)
-- ⚠ begin/commit 을 쓰지 않는다 — [0] 에서 멈추면 아무것도 바뀌지 않는다.
-- ============================================================

-- ── [0] 선행 조건 ───────────────────────────────────────────
do $$
declare v_missing text := '';
begin
  if not exists (select 1 from pg_proc where proname='approval_round') then
    v_missing := v_missing || E'\n  · approval_round() → docs/db/approval_resubmit_reset.sql';
  end if;
  if not exists (select 1 from pg_constraint where conname='approval_action_check'
                 and pg_get_constraintdef(oid) like '%withdraw%') then
    v_missing := v_missing || E'\n  · daily_report_approvals.action 에 withdraw 허용 → docs/db/daily_report_tables.sql';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='treasury_users' and column_name='can_approve') then
    v_missing := v_missing || E'\n  · treasury_users.can_approve';
  end if;
  if v_missing <> '' then
    raise exception E'선행 조건이 없어 중단합니다(아무것도 바뀌지 않았습니다):%', v_missing;
  end if;
end $$;

-- ── [1] 승인 취소 RPC ───────────────────────────────────────
create or replace function public.withdraw_daily_report_approval(
  p_report_id uuid,
  p_comment text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_report daily_reports%rowtype;
  v_user treasury_users%rowtype;
  v_step int;
  v_final_stage int;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception '인증된 사용자만 실행할 수 있습니다'; end if;
  if coalesce(btrim(p_comment), '') = '' then raise exception '승인 취소 사유를 입력하세요'; end if;

  select * into v_user from treasury_users where id = auth.uid() and is_active;
  if not found then raise exception '사용자 정보를 찾을 수 없습니다'; end if;

  select * into v_report from daily_reports where id = p_report_id for update;
  if not found then raise exception '자금일보를 찾을 수 없습니다'; end if;
  if v_report.status <> 'approved' then
    raise exception '승인 완료된 자금일보만 취소할 수 있습니다(현재 상태: %)', v_report.status;
  end if;

  -- 권한: master, 또는 최종 결재 차수의 결재자(can_approve)
  select max(coalesce(stage, step)) into v_final_stage
    from daily_report_approval_config where company = v_report.company and is_active;
  select c.step into v_step
    from daily_report_approval_config c
   where c.company = v_report.company and c.is_active
     and coalesce(c.stage, c.step) = v_final_stage
     and lower(btrim(c.approver_code)) = lower(btrim(v_user.user_code))
   order by c.step limit 1;

  if v_user.role <> 'master' then
    if v_step is null then
      raise exception '승인 취소는 최종 결재자 또는 관리자만 할 수 있습니다';
    end if;
    if not coalesce(v_user.can_approve, false) then
      raise exception '계정에 결재 권한(can_approve)이 없습니다';
    end if;
  end if;

  -- 이 트랜잭션 안에서만 승인 일보 수정 차단을 연다([2] 트리거가 확인)
  perform set_config('app.daily_report_withdraw', 'on', true);

  update daily_reports
     set status = 'rejected', approved_by = null, approved_at = null, updated_at = v_now
   where id = p_report_id;

  insert into daily_report_approvals(id, report_id, step, action, actor_code, actor_label, comment, created_at)
  values (gen_random_uuid(), p_report_id, coalesce(v_step, 0), 'withdraw',
          v_user.user_code, v_user.name, btrim(p_comment), v_now);

  -- 공식 확정 해제 (승인 시 confirmed=true 로 바꾼 것을 되돌린다)
  update daily set confirmed = false where report_id = p_report_id;

  perform set_config('app.daily_report_withdraw', 'off', true);

  return jsonb_build_object('withdrawn', true, 'report_id', p_report_id, 'step', coalesce(v_step, 0));
end $$;

revoke all on function public.withdraw_daily_report_approval(uuid, text) from public, anon;
grant execute on function public.withdraw_daily_report_approval(uuid, text) to authenticated;

-- ── [2] 승인된 일보 수정 차단 ────────────────────────────────
-- 항목: 부모 일보가 승인 상태면 추가·수정·삭제 금지
create or replace function public.guard_approved_report_items()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select status into v_status from daily_reports
   where id = case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  if v_status = 'approved' then
    raise exception '승인 완료된 자금일보는 수정할 수 없습니다 — 최종 결재자에게 승인 취소를 요청하세요';
  end if;
  -- 승인된 일보로 항목을 옮기는 것도 막는다
  if tg_op = 'UPDATE' and new.report_id is distinct from old.report_id then
    select status into v_status from daily_reports where id = old.report_id;
    if v_status = 'approved' then
      raise exception '승인 완료된 자금일보의 항목은 옮길 수 없습니다';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_approved_report_items on public.daily_report_items;
create trigger trg_guard_approved_report_items
  before insert or update or delete on public.daily_report_items
  for each row execute function public.guard_approved_report_items();

-- 일보 본체: 승인 상태에서는 수정·삭제 금지 — 승인 취소 RPC 만 예외
create or replace function public.guard_approved_report()
returns trigger language plpgsql as $$
begin
  if old.status = 'approved'
     and coalesce(current_setting('app.daily_report_withdraw', true), '') <> 'on' then
    raise exception '승인 완료된 자금일보는 수정·삭제할 수 없습니다 — 승인 취소 후 진행하세요';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_approved_report on public.daily_reports;
create trigger trg_guard_approved_report
  before update or delete on public.daily_reports
  for each row execute function public.guard_approved_report();

-- ── [3] 결재 요청 메일 — "마지막 반려 또는 승인 취소 이후의 승인만 유효" ──
-- approval_resubmit_reset.sql 의 같은 함수에서 reject → reject·withdraw 만 바꾼다.
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
           -- 마지막 반려·승인 취소 시각. 이보다 **뒤에** 찍힌 승인만 유효하다.
           (select max(a.created_at) from public.daily_report_approvals a
             where a.report_id = r.id and a.action in ('reject', 'withdraw')) as reject_at
    from public.daily_reports r
    where public.check_notify_token(p_token)
      and r.status = 'submitted'
      and (p_report_id is null or r.id = p_report_id)
  ),
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
  join public.daily_report_approval_config c
    on c.company = t.company
   and c.is_active
   and coalesce(c.stage, c.step) = cur.stage
   and not exists (
     select 1 from public.daily_report_approvals a
     where a.report_id = t.id and a.action = 'approve' and a.step = c.step
       and (t.reject_at is null or a.created_at > t.reject_at)
   )
  join public.treasury_users u
    on lower(btrim(u.user_code)) = lower(btrim(c.approver_code))
   and u.is_active
   and coalesce(u.email, '') <> ''
  left join public.treasury_users su
    on lower(btrim(su.user_code)) = lower(btrim(coalesce(t.submitted_by, '')))
  where not exists (
    select 1 from public.approval_notifications n
    where n.report_id = t.id and n.step = c.step and n.round = t.round
  )
  order by t.submitted_at nulls last, c.step
$$;

grant execute on function public.approval_notifications_pending(text, uuid) to anon, authenticated;

-- ── [4] 결과표 ─────────────────────────────────────────────
select 항목, 결과 from (
  select 1 as 순서, '승인 취소 RPC'::text as 항목,
    case when exists(select 1 from pg_proc where proname='withdraw_daily_report_approval') then 'OK' else '확인필요' end as 결과
  union all
  select 2, '승인 일보 항목 수정 차단 트리거',
    case when exists(select 1 from pg_trigger where tgname='trg_guard_approved_report_items') then 'OK' else '확인필요' end
  union all
  select 3, '승인 일보 본체 수정·삭제 차단 트리거',
    case when exists(select 1 from pg_trigger where tgname='trg_guard_approved_report') then 'OK' else '확인필요' end
  union all
  select 4, '결재 메일: 승인 취소 이후 승인만 유효',
    case when exists(select 1 from pg_proc where proname='approval_notifications_pending'
      and prosrc like '%withdraw%') then 'OK' else '확인필요' end
  union all
  select 5, '현재 승인 완료 일보 수(차단 대상)',
    (select count(*)::text || '건' from daily_reports where status = 'approved')
) r order by 순서;
