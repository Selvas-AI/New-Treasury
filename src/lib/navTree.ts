/**
 * 네비게이션 트리 SSOT (세션26차 13일차)
 *
 * ⭐ 왜 별도 모듈인가: 과거엔 사이드바 메뉴(`NAV_GROUPS`)는 `Sidebar.tsx` 안에,
 *   권한 부여 목록(`MENU_SLUGS`)은 `UsersPage.tsx` 안에 **따로** 정의돼 있었다.
 *   그래서 두 목록이 실제로 어긋났다(2026-08-20 리포트):
 *     · `audit-log`(변경 이력 로그) — 사이드바엔 있는데 권한 목록·역할 기본값 **양쪽에 없어
 *       master 외에는 아무도 볼 수 없었다.** 부여할 방법 자체가 없던 상태.
 *     · 라벨 5건 불일치 — 특히 `환율 국면`은 7일차에 `FX 리짐 전략`으로 개명했는데
 *       권한 화면만 옛 이름으로 남아, 관리자가 체크한 것과 사용자가 보는 메뉴 이름이 달랐다.
 *     · 섹션 계층이 평면 칩으로 뭉개져 "무엇을 열어준 것인지" 확인이 불가능했다.
 *
 *   이제 사이드바와 권한 화면이 **이 파일 하나**를 읽는다. 메뉴를 추가·개명하면
 *   권한 화면이 자동으로 따라온다 — 다시 어긋날 수 없다(CLAUDE.md §1-A 4번).
 *
 * ⚠ `slug` 는 `treasury_users.menus` 에 저장되는 **DB 값**이다. 라벨은 자유롭게 바꿔도
 *   되지만 slug 를 바꾸면 기존 사용자 권한이 끊긴다 — 반드시 마이그레이션과 함께.
 */

export interface NavItem {
  to: string
  label: string
  icon: string
  /** hasMenu() 체크용 메뉴 슬러그 = treasury_users.menus 의 값 */
  slug: string
  /**
   * 이 화면의 작업 권한(조회/입력·수정/삭제) 섹션 키 = `action_permissions` 의 키.
   * 없으면 조회 전용 화면이라 작업 권한 대상이 아니다(대시보드·환율 현황·리짐·감사로그).
   *
   * ⚠ menu slug 와 1:1 이 아니다 — `자금 변동 이력`(history)과 `이슈 이력`(issue_history)은
   *   **menu slug 는 공유하지만 작업 권한은 따로**다. 그래서 권한 트리는 메뉴 체크는 slug
   *   단위로 묶되, 작업 권한은 **항목 단위**로 그린다.
   */
  section?: SectionKey
  /** 이 화면에서 추가로 갈라지는 작업 권한 (예: 자금일보 작성 화면의 상신·결재) */
  extraSections?: { key: SectionKey; label: string }[]
  /** 자금일보 입출금 카테고리 권한(allowed_categories)이 걸리는 화면 */
  hasCategories?: boolean
}

import type { SectionKey } from '../types'

export interface NavGroup {
  /** 섹션 헤더 (사이드바 collapsed 시 구분선으로만 표시) */
  section: string
  items: NavItem[]
  /**
   * master 전용 섹션 — 권한 부여 대상이 아니다.
   * 관리 메뉴(코드/회사/사용자/데이터/조직도)는 **설계상 master 전용**이다.
   * `admin` 역할은 "업무 관리자"이지 시스템 관리자가 아니다(2026-08-20 사용자 확인).
   * 권한 트리에는 표시하되 체크박스를 주지 않는다 — 사이드바와 같은 그림이어야
   * "왜 여긴 체크가 없지?"라는 의문이 생기지 않는다.
   */
  masterOnly?: boolean
}

export const NAV_GROUPS: NavGroup[] = [
  {
    section: 'DASHBOARD',
    items: [
      { to: '/dashboard', label: '통합 상황판', icon: '⊞', slug: 'dashboard' },
      { to: '/policy',    label: '자금정책',    icon: '📋', slug: 'policy',    section: 'policy' },
    ],
  },
  {
    section: '자금입력',
    items: [
      { to: '/input',   label: '운전자금',     icon: '✏️', slug: 'input',  section: 'operating' },
      { to: '/invest',  label: '운용자금',      icon: '📈', slug: 'invest', section: 'invest' },
      { to: '/equity',  label: '지분/장기투자', icon: '💹', slug: 'equity', section: 'equity' },
      { to: '/loans',   label: '차입금',        icon: '🏦', slug: 'loans',  section: 'loans' },
    ],
  },
  {
    section: '자금일보',
    items: [
      { to: '/daily-report',      label: '자금일보 작성',     icon: '📄', slug: 'daily',
        section: 'daily_write', hasCategories: true,
        extraSections: [{ key: 'daily_submit', label: '상신·결재' }] },
      { to: '/daily-report-list', label: '일별 자금일보 목록', icon: '📅', slug: 'daily' },
    ],
  },
  // 세션26차 7일차 FX 메뉴 개편 — 환율현황·외화거래명세(구 외화원장, 구 이력관리)·
  // FX 리짐 전략(구 DASHBOARD)이 서로 다른 카테고리에 흩어져 있던 것을 하나로 묶었다.
  // FX 정책 기준은 별도 메뉴로 두지 않는다 — 실무자가 필요한 발의 기능은 FX 리짐
  // 전략의 조치 카드로 이관했고, 정책 편집은 자금정책 페이지 안에서 컨텍스트를
  // 유지하는 게 낫다(같은 8일차 후속 조정).
  {
    section: '💱 외화(FX) 관리',
    items: [
      // 기본 비공개 — 사용자 관리에서 별도 메뉴 권한을 받은 계정만 표시된다.
      { to: '/fx-regime', label: 'FX 리짐 전략', icon: '🧭', slug: 'fx-regime' },
      { to: '/fx-ledger', label: '외화거래명세', icon: '📚', slug: 'fx-ledger', section: 'fx_trade' },
      { to: '/fx',        label: '환율 현황',    icon: '💱', slug: 'fx'        },
    ],
  },
  {
    section: '이력관리',
    items: [
      { to: '/history',       label: '자금 변동 이력', icon: '📂', slug: 'history',   section: 'history' },
      { to: '/issue-history', label: '이슈 이력',      icon: '🔔', slug: 'history',   section: 'issue_history' },
      { to: '/audit-log',     label: '변경 이력 로그', icon: '🗒️', slug: 'audit-log' },
    ],
  },
  {
    section: '관리',
    masterOnly: true,
    items: [
      { to: '/admin/mycode',    label: '코드 변경',   icon: '🔑', slug: 'admin' },
      { to: '/admin/companies', label: '회사 관리',   icon: '🏢', slug: 'admin' },
      { to: '/admin/users',     label: '사용자 관리', icon: '👥', slug: 'admin' },
      { to: '/admin/data',      label: '데이터 관리', icon: '🗄️', slug: 'admin' },
      { to: '/admin/org-chart', label: '조직도 관리', icon: '🏬', slug: 'admin' },
    ],
  },
]

/** 사이드바 본문(관리 섹션 제외) — 관리 섹션은 master 전용이라 별도 렌더 경로를 쓴다 */
export const NAV_SECTIONS = NAV_GROUPS.filter(g => !g.masterOnly)
export const ADMIN_SECTION = NAV_GROUPS.find(g => g.masterOnly)!

/**
 * 권한 부여 대상 슬러그 (중복 제거, 트리 순서 유지).
 * masterOnly 섹션은 제외한다 — 부여할 수 없는 것을 목록에 두면 오해만 만든다.
 */
export const ASSIGNABLE_SLUGS: string[] = (() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of NAV_SECTIONS) {
    for (const i of g.items) {
      if (seen.has(i.slug)) continue
      seen.add(i.slug); out.push(i.slug)
    }
  }
  return out
})()

/**
 * 같은 slug 를 공유하는 항목들 — 체크 하나로 **함께** 열린다.
 * (예: `daily` → 자금일보 작성 + 일별 자금일보 목록 / `history` → 자금 변동 이력 + 이슈 이력)
 * 권한 화면에서 이걸 숨기면 "체크 하나가 화면 두 개를 여는" 것을 알 수 없다.
 */
export function itemsBySlug(slug: string): NavItem[] {
  return NAV_SECTIONS.flatMap(g => g.items).filter(i => i.slug === slug)
}
