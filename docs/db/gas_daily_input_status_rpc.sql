-- ============================================================
-- gas_daily_input_status_rpc.sql  (2026-09-08)
-- 목적: GAS 자동 알림이 RLS 뒤의 daily 를 안전하게 조회하게 한다.
--
-- 배경 — 두 가지 문제가 겹쳐 있었다 (2026-09-08 실행 로그로 확인)
--   ① GAS 스크립트 속성 SUPABASE_KEY 가 옛 키 → HTTP 401 "Invalid API key"
--      → 조회 실패로 return → **운전자금 미입력 알림이 언제부턴가 전혀 발송되지 않고 있다.**
--   ② 그렇다고 최신 anon 키로 바꾸면 2026-08-26 RLS 전환 때문에 200 [] 가 돌아온다
--      → "전 법인 미입력"으로 오판 → **매 영업일 전 법인에 오탐 메일**. 침묵보다 나쁘다.
--
-- 조치: 필요한 정보(그날 입력된 법인명)만 돌려주는 SECURITY DEFINER 함수를 두고
--   anon 키로 호출하게 한다. service_role 키를 GAS 에 두지 않아도 되고,
--   테이블 전체가 열리지도 않는다(이미 쓰는 is_registerable_email 과 같은 패턴).
-- ============================================================

create or replace function public.daily_input_companies(p_date text)
returns table (company text)
language sql
security definer
set search_path = public
as $$
  -- daily.date 는 text(YYYY-MM-DD) 컬럼이다 (date 타입 아님 — 캐스팅하지 말 것)
  select distinct d.company
  from public.daily d
  where d.date = p_date
$$;

-- 로그인 전(GAS) 호출이므로 anon 에도 실행 권한을 준다.
grant execute on function public.daily_input_companies(text) to anon, authenticated;

-- 확인 (오늘 입력된 법인 목록이 나와야 한다)
-- select * from public.daily_input_companies(to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD'));
