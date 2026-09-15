-- ═══════════════════════════════════════════════════════════════════════════
-- 사용자 권한 적용 상태 확인 (읽기 전용)                          (2026-09-15)
--
--   "사용자 관리에서 권한을 줬는데 화면에 반영이 안 된다" 를 진단한다.
--   원인은 두 층 중 하나다 — 저장이 안 됐거나(DB), 화면이 안 읽거나(코드).
--   이 스크립트는 **DB 층**만 본다. 코드 층은 2026-09-15 수정 완료
--   (fx 화면 4곳이 레거시 can_delete 를 보고 있어 권한 트리 설정이 무시됐다).
--
--   전체 선택 → Run. 결과가 2개 표로 나온다.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── ① 세분화 권한 컬럼이 있는가 (user_permissions_migration.sql 적용 여부) ──
--    없으면 사용자 관리의 권한 트리 저장이 실패한다(master 화면에 오류가 뜬다).
select 'action_permissions 컬럼' as 점검,
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='treasury_users'
          and column_name='action_permissions')::text as 실측,
       '1' as 기대
union all
select 'allowed_categories 컬럼',
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='treasury_users'
          and column_name='allowed_categories')::text,
       '1'
union all
select 'can_delete 컬럼(레거시 전역 삭제)',
       (select count(*) from information_schema.columns
        where table_schema='public' and table_name='treasury_users'
          and column_name='can_delete')::text,
       '1';


-- ── ② 실제 사용자별 삭제 권한 현황 ─────────────────────────────────────────
--    '외화거래명세 삭제' 열이 최종 판정이다. 코드의 canAction('fx_trade','delete')
--    과 같은 규칙으로 계산한다:
--      master 면 항상 허용 / action_permissions 에 명시돼 있으면 그 값 /
--      아니면 레거시 can_delete 를 하한으로 본다.
--    ⚠ 역할 기본값(ACTION_DEFAULTS)의 fx_trade.delete 는 master 외 전부 false 다.
--      즉 권한 트리에서 체크하거나 can_delete 를 켜야만 삭제가 보인다.
select
  name                                            as 이름,
  email                                           as 이메일,
  role                                            as 역할,
  can_delete                                      as "레거시 can_delete",
  (action_permissions is not null)                as "권한트리 사용",
  action_permissions -> 'fx_trade'                as "fx_trade 권한",
  case
    when role = 'master' then '허용 (master)'
    when (action_permissions -> 'fx_trade' ->> 'delete')::boolean then '허용 (권한트리)'
    when can_delete then '허용 (레거시 can_delete)'
    else '차단'
  end                                             as "외화거래명세 삭제"
from public.treasury_users
where is_active = true
order by
  case when role='master' then 0 when role='admin' then 1
       when role='editor' then 2 else 3 end,
  name;
