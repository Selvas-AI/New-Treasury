# Sidebar

**파일**: `src/components/Sidebar.tsx`  
**역할**: 다크 사이드바 네비게이션 — 섹션별 트리 접기/펴기, PC 접기, 모바일 드로어  
**최종 업데이트**: 2026-06-09

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `collapsed` | `boolean` | 사이드바 접힌 상태 (Layout에서 관리, w-14) |
| `onCollapse` | `() => void` | 접기 버튼 클릭 콜백 |
| `onNavClick` | `() => void` | 메뉴 클릭 시 콜백 (모바일 드로어 닫기용) |

---

## 메뉴 구성 — 섹션 그룹 트리 구조

`NAV_GROUPS` 배열로 섹션 단위 그룹화. 각 섹션 헤더 클릭으로 접기/펴기.

```
DASHBOARD
  ⊞  통합 상황판   /dashboard
  📋  자금정책      /policy

자금입력
  ✏️  운전자금       /input
  📈  운용자금       /invest
  🏦  차입금         /loans
  💹  지분/장기투자  /equity

이력관리
  📂  자금 변동 이력 /history
  🔔  이슈 이력      /issue-history   ← 미조치 건수 빨간 뱃지
  💱  환율 현황      /fx

관리 (master 역할만 표시)
  🔑  코드 변경      /admin/mycode
  👥  사용자 관리    /admin/users
  🗄️  데이터 관리    /admin/data
```

---

## 섹션 접기/펴기 동작

```typescript
// openSections: Record<string, boolean>
// 초기값: 현재 경로가 속한 섹션만 열림, 나머지 닫힘
const getDefaultOpen = () => {
  const path = location.pathname
  NAV_GROUPS.forEach(g => {
    openMap[g.section] = g.items.some(i => path.startsWith(i.to))
  })
}

toggleSection(section) // 클릭 시 해당 섹션 open 토글
```

- 섹션 헤더 우측 `›` 화살표 — 열리면 `rotate-90` 애니메이션
- 현재 경로가 속한 섹션 헤더: `text-blue-400` 강조
- 항목 영역: `max-h` + `opacity` transition으로 슬라이드 애니메이션
- **사이드바 collapsed(w-14) 상태**: 섹션 토글 무시, 모든 아이콘 항상 표시

---

## collapsed 모드 (w-14)

- 아이콘만 표시, 섹션 헤더는 구분선(`border-t`)으로 대체
- `title` 속성으로 마우스 호버 시 메뉴명 툴팁
- 이슈 뱃지: 아이콘 우상단 `absolute -top-1.5 -right-1.5` 오버레이
- aside에 `overflow: visible` 적용 (뱃지/팝업이 사이드바 밖으로 나올 수 있도록)
- 환율 버튼(💱) 클릭 → 사이드바 우측으로 환율 팝업 슬라이드

---

## 활성 메뉴 스타일

```typescript
// NavLink isActive 시
'bg-blue-600 text-white'
// 비활성 시
'hover:bg-gray-700 hover:text-white'
```

---

## 하단 환율 패널

- **펼친 상태**: 5개 통화(USD/EUR/JPY/GBP/CNY) 실시간 환율 표시
  - 마운트 3초 후 GAS 자동 조회 (`window.setTimeout`)
  - 로딩 중: 스켈레톤 shimmer
  - 조회 실패: `↺ 재시도` 버튼
- **collapsed 상태**: 💱 버튼 → `slideInLeft` 애니메이션 팝업 (외부 클릭 닫기)

---

## 메뉴 추가 방법

```typescript
// NAV_GROUPS 배열에 섹션/항목 추가
const NAV_GROUPS: NavGroup[] = [
  {
    section: '섹션명',
    items: [
      { to: '/new-route', label: '메뉴명', icon: '🆕' },
    ],
  },
]
// + App.tsx에 라우트 추가
```

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-06-01 | 초기 구현 (단일 NAV_ITEMS 플랫 리스트) |
| 2026-06-04 | 접힌 상태 이슈 뱃지, 환율 팝업, 얇은 스크롤바 추가 |
| 2026-06-09 | NAV_GROUPS 섹션 구조로 전환, 트리 접기/펴기 구현, "자금정책 관리" → "자금정책" 레이블 변경 |
