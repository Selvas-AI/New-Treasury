-- ============================================================
-- auth_registerable_rpc.sql
-- 목적: '최초 계정 설정'의 이메일 사전조회를 anon SELECT → SECURITY DEFINER RPC 로 이전
--
-- 왜 필요한가:
--   AuthContext.register() 는 signUp 전에 "등록된 이메일인가"를 확인하려고
--   로그인 전 상태(anon)로 treasury_users 를 직접 읽는다.
--   이 경로 하나 때문에 treasury_users 정책을 authenticated 전용으로 조일 수 없다.
--   → 판정을 서버 함수 안으로 옮기고, 함수는 **불리언 하나만** 돌려준다.
--     (프로필 행·권한·이메일 목록은 밖으로 나가지 않는다)
--
-- ⚠ 이 스크립트는 **가산적(additive)** 이다 — 함수만 만든다.
--   기존 정책·데이터·동작을 전혀 바꾸지 않으므로 먼저 적용해도 안전하다.
--   정책을 authenticated 로 조이는 것은 별도 스크립트(다음 단계).
--
-- ⚠ 이메일 존재 여부 노출(enumeration)에 대해:
--   이 함수는 "등록된 이메일인가"를 그대로 알려준다 — 지금 화면이 이미
--   '등록되지 않은 이메일입니다' 라고 안내하고 있어 동작을 바꾸지 않았다.
--   더 조이려면 UI 문구를 뭉뚱그리고 함수도 항상 true 를 반환하게 해야 하는데,
--   그러면 사용자가 왜 가입이 안 되는지 알 수 없어진다. 사내 시스템이라 현행 유지.
--
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 멱등: create or replace — 여러 번 실행해도 안전.
-- ============================================================

create or replace function public.is_registerable_email(p_email text)
returns table (registerable boolean, reason text)
language plpgsql
security definer            -- 호출자(anon)가 아니라 함수 소유자 권한으로 실행 → RLS 우회
set search_path = public    -- search_path 하이재킹 방지 (security definer 필수 관례)
as $$
declare
  v_active boolean;
begin
  select u.is_active into v_active
  from public.treasury_users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_active is null then
    return query select false, 'not_registered'::text;
  elsif v_active is false then
    return query select false, 'inactive'::text;
  else
    return query select true, null::text;
  end if;
end $$;

-- 로그인 전에 호출되므로 anon 에게도 실행 권한이 필요하다.
grant execute on function public.is_registerable_email(text) to anon, authenticated;


-- ============================================================
-- 검증
-- ============================================================
-- (a) 등록된 이메일 → (true, null) / 미등록 → (false, 'not_registered')
/*
select * from public.is_registerable_email('jung8629@gmail.com');
select * from public.is_registerable_email('nobody@example.com');
*/

-- (b) 함수가 treasury_users 행을 밖으로 내보내지 않는지 (불리언 + 사유만)
--     → 반환 컬럼이 registerable, reason 두 개뿐이면 정상
