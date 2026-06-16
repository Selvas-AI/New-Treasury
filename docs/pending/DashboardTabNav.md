# [Pending] Dashboard 탭 네비게이션

> 상태: **Pending** — 2026-06-16 사용자 결정으로 보류  
> 구현 검토 시 이 문서를 기반으로 진행

---

## 배경 및 목적

현재 Sidebar의 **DASHBOARD** 섹션에는 3개 메뉴가 존재:
- 통합 상황판 (`/dashboard`)
- 자금일보 (`/daily-report`)
- 자금정책 (`/policy`)

이 3개 메뉴는 성격상 "대시보드 카테고리"로 묶여 있지만, Sidebar에 나열된 형태라 전환이 직관적이지 않다. 탭 형태로 빠르게 전환할 수 있으면 UX가 개선된다.

---

## 확정 디자인: TopBar 하단 전체 너비 탭 바

### 레이아웃 구조

```
┌──────────────────────────────────────────────────────────────┐
│  TopBar (법인선택 + 주가티커 + 기능버튼)                         │
├──────────────────────────────────────────────────────────────┤
│  [통합 상황판]  [자금일보]  [자금정책]   ← 대시보드 탭 바 (조건부) │
├────────────┬─────────────────────────────────────────────────┤
│  Sidebar   │  Page Content (Outlet)                          │
│            │                                                 │
└────────────┴─────────────────────────────────────────────────┘
```

- 탭 바는 **TopBar 바로 아래, Sidebar와 콘텐츠 영역 위**에 전체 너비로 삽입
- 현재 페이지가 DASHBOARD 카테고리(`/dashboard`, `/daily-report`, `/policy`) 중 하나일 때만 표시
- 다른 페이지(운전자금, 차입금 등)에서는 탭 바 비표시

### 탭 구성

| 탭 라벨 | 경로 | 비고 |
|---------|------|------|
| 📊 통합 상황판 | `/dashboard/:company?` | |
| 📋 자금일보 | `/daily-report/:company?` | 작성·목록은 내부 서브탭 |
| 📑 자금정책 | `/policy/:company?` | |

### 자금일보 서브탭 처리

자금일보 탭 선택 시 내부에서 `작성 / 목록` 서브탭 전환:
```
[자금일보 탭 선택됨]
  ├── 서브탭: [작성]  [목록]
  └── 현재: DailyReportPage 또는 DailyReportListPage
```

---

## 구현 계획

### 1. 탭 바 컴포넌트 (`DashboardTabBar.tsx`)

```tsx
// src/components/layout/DashboardTabBar.tsx
const DASHBOARD_TABS = [
  { label: '📊 통합 상황판', base: '/dashboard' },
  { label: '📋 자금일보',    base: '/daily-report' },
  { label: '📑 자금정책',    base: '/policy' },
]

export function DashboardTabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { currentCompany } = useAuth()
  const company = currentCompany ?? ''

  // DASHBOARD 카테고리 페이지에만 표시
  const isDashboardPage = DASHBOARD_TABS.some(t => location.pathname.includes(t.base.split('/')[1]))
  if (!isDashboardPage) return null

  return (
    <div className="flex border-b border-slate-700 bg-slate-900 px-4 shrink-0">
      {DASHBOARD_TABS.map(tab => {
        const active = location.pathname.startsWith(tab.base)
        return (
          <button
            key={tab.base}
            onClick={() => navigate(`${tab.base}/${company}`)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active
                ? 'border-blue-400 text-blue-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

### 2. Layout.tsx 삽입 위치

```tsx
// src/components/Layout.tsx
<div className="flex flex-col h-screen overflow-hidden">
  <TopBar />
  <DashboardTabBar />   {/* ← 여기 삽입 */}
  <div className="flex flex-1 min-h-0">
    <Sidebar />
    <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
      <Outlet />
    </main>
  </div>
</div>
```

### 3. Sidebar 처리

DASHBOARD 섹션의 3개 항목(통합 상황판·자금일보·자금정책)을 탭 바로 이전 후 Sidebar에서 제거 또는 유지:

**옵션 A (권장)**: Sidebar에서 DASHBOARD 섹션 전체 제거, 탭 바만 사용  
**옵션 B**: Sidebar에 유지하되 탭 바도 추가 (두 방법 모두 동작)

---

## 주의사항

- `currentCompany`가 탭 이동 시 유지되어야 함 (경로에 company 파라미터 포함)
- 자금일보 탭 내부의 작성/목록 라우트(`/daily-report` vs `/daily-report-list`)는 내부 서브탭으로 처리
- 모바일에서는 탭 라벨을 이모지만 표시하거나 스크롤 가능하도록 `overflow-x-auto` 적용
- `hasMenu(slug)` 권한 체크 적용 (접근 권한 없는 탭 숨김)

---

## 관련 파일

- `src/components/Layout.tsx` — 탭 바 삽입 위치
- `src/components/Sidebar.tsx` — DASHBOARD 섹션 제거 여부
- `src/components/layout/DashboardTabBar.tsx` — 신규 생성 필요
- `src/hooks/useAuth.ts` — `hasMenu(slug)` 권한 체크

---

_작성일: 2026-06-16_
