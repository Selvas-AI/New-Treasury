-- ============================================================
-- approval_notification.sql  (2026-09-08)
-- 목적: 자금일보가 상신되거나 한 단계가 승인되면 **다음 차례 결재자**에게
--       즉시 메일이 가도록, GAS 가 필요한 정보만 안전하게 읽어가게 한다.
--
-- 설계
--   · 발송 주체는 GAS(MailApp) — 이미 운전자금 미입력 알림에서 쓰는 검증된 경로.
--   · GAS 는 anon 키 + **토큰**으로 아래 RPC 만 호출한다. 테이블은 계속 잠긴 채다.
--     (service_role 키를 GAS 에 두지 않는다 — gas_daily_input_status_rpc.sql 과 같은 원칙)
--   · 중복 발송은 approval_notifications 의 unique(report_id, step) 로 DB 가 막는다.
--     같은 단계에 두 번 보내지 않으므로, 화면 트리거와 주기 스윕을 동시에 켜도 안전하다.
--
-- ⚠ 순서: 이 파일을 실행한 뒤 [4] 에서 출력되는 토큰을 GAS 스크립트 속성
--         NOTIFY_TOKEN 에 넣어야 동작한다.
-- ============================================================

-- ── [1] 발송 이력 (중복 방지 겸용) ──────────────────────────
create table if not exists public.approval_notifications (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.daily_reports(id) on delete cascade,
  step       int  not null,
  recipients text not null,
  sent_at    timestamptz not null default now(),
  constraint approval_notifications_report_step_unique unique (report_id, step)
);
comment on table public.approval_notifications is
  '자금일보 결재 요청 메일 발송 이력 — (report_id, step) 유니크로 중복 발송을 DB가 막는다';

-- 정책을 만들지 않는다 = anon/authenticated 직접 접근 불가.
-- 기록은 아래 SECURITY DEFINER 함수로만 이뤄진다.
alter table public.approval_notifications enable row level security;

-- ── [2] GAS 전용 토큰 보관함 ────────────────────────────────
-- 알림 대상에는 결재자의 이메일이 들어간다. anon 키는 공개값이므로
-- 토큰 없이 호출하면 아무것도 돌려주지 않는다.
create table if not exists public.app_secrets (
  name  text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;   -- 정책 없음 = 누구도 못 읽는다

insert into public.app_secrets (name, value)
values ('gas_notify_token', encode(gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;

create or replace function public.check_notify_token(p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.app_secrets
    where name = 'gas_notify_token' and value = p_token
  )
$$;

-- ── [3] 알림 대상 조회 ──────────────────────────────────────
-- 상신됐지만 아직 승인되지 않은 단계 중 **가장 낮은 단계**(= 지금 차례)를 찾아
-- 그 결재자의 이메일을 돌려준다. 이미 발송한 (report, step) 은 제외한다.
--   p_report_id 를 주면 그 일보만(= 화면에서 상신·승인 직후 즉시 발송)
--   생략하면 전체 미발송 건(= 주기 스윕으로 놓친 건 보완)
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
  select
    r.id, r.company, r.report_date,
    cfg.step, cfg.role_label, cfg.approver_code,
    u.name, u.email,
    r.submitted_by, su.name, r.submitted_at
  from public.daily_reports r
  -- 지금 차례인 단계 = 승인 로그가 없는 가장 낮은 단계
  join lateral (
    select c.step, c.role_label, c.approver_code
    from public.daily_report_approval_config c
    where c.company = r.company
      and c.is_active
      and not exists (
        select 1 from public.daily_report_approvals a
        where a.report_id = r.id and a.action = 'approve' and a.step = c.step
      )
    order by c.step
    limit 1
  ) cfg on true
  -- 결재자 코드 매칭은 화면(sameCode)과 같은 기준 — 공백·대소문자 무시
  join public.treasury_users u
    on lower(btrim(u.user_code)) = lower(btrim(cfg.approver_code))
   and u.is_active
   and coalesce(u.email, '') <> ''
  left join public.treasury_users su
    on lower(btrim(su.user_code)) = lower(btrim(coalesce(r.submitted_by, '')))
  where public.check_notify_token(p_token)
    and r.status = 'submitted'
    and (p_report_id is null or r.id = p_report_id)
    and not exists (
      select 1 from public.approval_notifications n
      where n.report_id = r.id and n.step = cfg.step
    )
  order by r.submitted_at nulls last
$$;

-- ── [4] 발송 기록 ───────────────────────────────────────────
-- 이미 있으면 false 를 돌려준다 → GAS 는 보내지 않고 건너뛴다.
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

  insert into public.approval_notifications (report_id, step, recipients)
  values (p_report_id, p_step, p_recipients)
  on conflict (report_id, step) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end
$$;

-- GAS 는 로그인 세션이 없으므로 anon 실행을 허용한다.
-- 토큰이 없으면 pending 은 0건, record 는 예외이므로 데이터는 새지 않는다.
grant execute on function public.check_notify_token(text)                              to anon, authenticated;
grant execute on function public.approval_notifications_pending(text, uuid)            to anon, authenticated;
grant execute on function public.record_approval_notification(text, uuid, int, text)   to anon, authenticated;

-- ── [5] 실행 후 이 토큰을 GAS 스크립트 속성 NOTIFY_TOKEN 에 붙여넣을 것 ──
select value as "GAS 스크립트 속성 NOTIFY_TOKEN 에 넣을 값"
from public.app_secrets where name = 'gas_notify_token';

-- ── 확인용 (토큰을 넣어 실행하면 지금 알림 대상이 보인다) ──
-- select * from public.approval_notifications_pending('여기에_토큰');
