-- ============================================================
-- company_menus.sql (2026-08-28)
-- 목적: 법인별 메뉴 구성 — 법인 자금 사정상 쓰지 않는 메뉴를 사이드바에서 숨긴다.
--
-- ⚠ 권한이 아니라 **표시 필터**다. 사용자 권한(treasury_users.menus)과는 축이 다르다:
--     treasury_users.menus = "이 사람이 볼 수 있는가"
--     companies.menus      = "이 법인에서 쓰는 메뉴인가"
--   둘 다 통과해야 사이드바에 나타난다(AND).
--
-- null = 전체 메뉴 표시 (기존 동작 그대로). 미실행 상태에서도 앱은 정상 동작하며
--        회사 관리의 '메뉴 구성' 저장만 실패한다.
--
-- 값 예시: ["dashboard","daily","input","invest","history","fx","policy"]
--   슬러그는 src/lib/navTree.ts 의 ASSIGNABLE_SLUGS 와 동일하다.
--   관리 섹션(admin)은 법인과 무관하므로 이 목록의 대상이 아니다.
-- ============================================================

alter table public.companies
  add column if not exists menus jsonb;

comment on column public.companies.menus is
  '법인별 표시 메뉴 슬러그 배열. null = 전체 표시. 권한이 아니라 노이즈 제거용 표시 필터.';

-- 확인
-- select name, menus from public.companies order by sort_order;
