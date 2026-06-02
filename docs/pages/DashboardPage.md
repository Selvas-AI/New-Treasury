# DashboardPage (통합 상황판)

**파일**: `src/pages/DashboardPage.tsx`  
**라우트**: `/dashboard`, `/dashboard/:company`  
**역할**: 전체 자금 현황 한눈에 보기

---

## 레이아웃 명세 (Layout Specification)

### ⚠️ 핵심 규칙 — 반드시 준수

> 대시보드 관련 컴포넌트(`DashboardPage.tsx` 및 하위 카드 컴포넌트)를 수정할 때는
> 이 섹션에 명시된 **반응형 그리드 규칙**과 **카드 내부 스크롤 규칙**을 반드시 준수해야 한다.
> **어떤 해상도에서도 UI가 깨지거나, 카드가 콘텐츠 양에 따라 비정상적으로 길어지는 코드를 작성해서는 안 된다.**

---

### 1. 최상위 컨테이너 (Unified Dashboard Container)

대시보드 전체는 **하나의 아웃라인 박스** 안에 포함된 CSS Grid 구조로 구성된다.

```
┌─────────────────────────────────────────────────────────────────┐
│  Unified Dashboard Container  (border, rounded, bg-white 등)   │
│                                                                  │
│  ┌── 좌측 메인 영역 (8fr) ───────┐  ┌── 우측 패널 (3fr) ──────┐ │
│  │  KPI 행 (3fr / 3fr / 2fr)    │  │  운전자금 상세 (scroll)  │ │
│  │  WaterfallCard               │  │  ─────────────────────  │ │
│  │  IssueCard                   │  │  운용자금 상세 (scroll)  │ │
│  │  CashflowChart  │ EquityCard │  │  ─────────────────────  │ │
│  └───────────────────────────────┘  │  차입금 상세   (scroll) │ │
│                                      └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- 최상위 컨테이너는 `border border-gray-200 rounded-xl` 등으로 묶어 시각적 단일 단위임을 표현한다.
- 내부 그리드는 해상도별 반응형 규칙(§2)에 따라 열 수가 바뀐다.

---

### 2. 반응형 그리드 규칙 (Responsive Grid)

#### 해상도별 레이아웃

| 브레이크포인트 | 조건 | 레이아웃 |
|---------------|------|---------|
| **모바일** (`< md`, `< 768px`) | 1열 수직 스택 | 모든 카드가 위→아래로 순서대로 배치 |
| **태블릿** (`md`, `768px~`) | 2열 전환 시작 | KPI 3개 → `grid-cols-3` / 우측 상세 패널 → 본문 아래 배치 |
| **PC** (`lg`, `1024px~`) | 2열 메인 그리드 | 좌측 메인 `8fr` + 우측 패널 `3fr` 분리 |
| **와이드** (`xl`, `1280px~`) | 비율 유지 | lg와 동일, 여백만 확대 |

#### 모바일(1열) 수직 스택 순서

콘텐츠 중요도 순으로 아래와 같이 쌓인다:

```
1. KPI 카드 3개 (grid-cols-1 → grid-cols-3)
2. WaterfallCard (자금흐름)
3. IssueCard (이슈 확인)
4. CashflowChart (현금흐름 추이)
5. EquityCard (지분/장기투자)
6. 운전자금 상세
7. 운용자금 상세
8. 차입금 상세
```

#### 구현 패턴 (Tailwind)

```tsx
{/* 최상위 2열 그리드 — 모바일: 1열, PC: 8fr+3fr */}
<div className="grid grid-cols-1 lg:grid-cols-[8fr_3fr] gap-4">

  {/* 좌측 메인 */}
  <div className="space-y-4">
    {/* KPI — 모바일: 1열, 태블릿: 3열 */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <KpiCard ... />
      <KpiCard ... />
      <KpiCard ... />
    </div>

    <WaterfallCard ... />
    <IssueCard ... />

    {/* 하단 2분할 — 모바일: 1열, 태블릿: 2열 */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CashflowChart ... />
      <EquityCard ... />
    </div>
  </div>

  {/* 우측 상세 패널 — 모바일에서는 좌측 아래 이어서 표시 */}
  <div className="flex flex-col gap-3 lg:h-[calc(100vh-8rem)]">
    {/* 상세 카드 3개 — §3 내부 스크롤 규칙 적용 */}
  </div>

</div>
```

> **`lg:h-[calc(100vh-8rem)]`**: PC에서 우측 패널 전체 높이를 뷰포트 기준으로 고정해
> 세 상세 카드가 균등 분할되도록 한다. 모바일에서는 높이 제한 없이 자연스럽게 쌓인다.

---

### 3. 🔒 카드 내부 스크롤 규칙 (Content Overflow Control)

**적용 대상**: 우측 패널의 세 상세 카드
- 운전자금 상세 (`WorkingCapitalDetail`)
- 운용자금 상세 (`InvestmentDetail`)
- 차입금 상세 (`LoanDetail`)

**규칙**:

```
카드의 최대 높이(max-height 또는 부모 flex 할당 높이)는 고정되어야 한다.
콘텐츠가 카드 높이를 초과할 경우,
  ✅ 카드 외부(레이아웃 전체) 크기는 유지 — 늘어나지 않음
  ✅ 카드 내부 콘텐츠 영역에 세로 스크롤바 생성 (overflow-y: auto)
  ❌ 카드 height가 콘텐츠 양에 따라 동적으로 증가하는 것 금지
  ❌ 전체 페이지 스크롤을 유발하는 것 금지 (PC 기준)
```

**모바일 예외**: 모바일(1열) 환경에서는 카드 높이를 `max-h-64` 등으로 제한하되,
페이지 전체 스크롤은 허용한다(뷰포트 고정 불필요).

**구현 패턴**:

```tsx
{/* ── PC: 우측 패널 전체를 뷰포트 높이에 고정 ── */}
<div className="flex flex-col gap-3
                lg:h-[calc(100vh-8rem)] lg:sticky lg:top-4">

  {/* 운전자금 상세 */}
  <div className="flex-1 min-h-0                  {/* PC: flex 균등 분할 */}
                  max-h-64 lg:max-h-none           {/* 모바일: 최대 높이 제한 */}
                  border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">
      운전자금 상세
    </h3>
    <div className="flex-1 overflow-y-auto min-h-0">  {/* ← 내부 스크롤 */}
      {/* 콘텐츠 */}
    </div>
  </div>

  {/* 운용자금 상세 — 동일 패턴 */}
  <div className="flex-1 min-h-0 max-h-64 lg:max-h-none border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">운용자금 상세</h3>
    <div className="flex-1 overflow-y-auto min-h-0">
      {/* 콘텐츠 */}
    </div>
  </div>

  {/* 차입금 상세 — 동일 패턴 */}
  <div className="flex-1 min-h-0 max-h-64 lg:max-h-none border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">차입금 상세</h3>
    <div className="flex-1 overflow-y-auto min-h-0">
      {/* 콘텐츠 */}
    </div>
  </div>

</div>
```

**핵심 Tailwind 클래스 조합**:

| 클래스 | 적용 환경 | 역할 |
|--------|----------|------|
| `flex flex-col gap-3` | 공통 | 세로 flex 컨테이너 |
| `lg:h-[calc(100vh-8rem)]` | PC | 패널 전체 높이를 뷰포트에 고정 |
| `lg:sticky lg:top-4` | PC | 스크롤 시 패널 고정(선택적 적용) |
| `flex-1 min-h-0` | PC (카드) | 균등 높이 분배 + overflow 허용 |
| `max-h-64 lg:max-h-none` | 모바일(카드) | 모바일 최대 높이 제한 / PC 해제 |
| `shrink-0` | 공통 (헤더) | 헤더가 압축되지 않도록 고정 |
| `overflow-y-auto min-h-0` | 공통 (바디) | 콘텐츠 초과 시 내부 스크롤 |

> **`min-h-0` 필수**: Flexbox 자식의 기본 `min-height`는 `auto`이므로,
> 명시하지 않으면 `flex-1`이 있어도 콘텐츠 크기만큼 늘어난다.

---

## 레이아웃 구조 (현재 구현 기준)

```
[KPI 카드 3개: 가용자금합계 / 순현금포지션 / 불가용자산]

┌─────────────────────────────┐ ┌──────────────────┐
│  [자금흐름 WaterfallCard]   │ │  [운전자금 상세]  │
│  [이슈 확인 IssueCard]      │ │  [운용자금 상세]  │
│  [현금흐름 추이 차트]       │ │  [차입금 상세]   │
│  [지분/장기투자 EquityCard] │ │                  │
└─────────────────────────────┘ └──────────────────┘
     lg:col-span-2 (8fr)              3fr
```

---

## 데이터 소스

모든 데이터는 `useDashboard()` 훅에서 계산:

| 속성 | 설명 |
|------|------|
| `kpi` | 가용자금/순현금/불가용 집계 |
| `waterfall` | 자금흐름 항목 배열 |
| `allDailyData` | 전체 운전자금 이력 (차트용) |
| `allInvestData` | 전체 운용자금 데이터 |
| `loans` | active 차입금 목록 |
| `detectedIssues` | 자동 감지된 이슈 |
| `equityReturns` | 지분 최신 + 수익률 |
| `equityHistoryOf` | 종목별 이력 함수 |

---

## 딥링크

```
/dashboard/셀바스헬스케어
→ URL 진입 시 currentCompany 자동 전환 (master/ceo만)
```

---

## 이슈 상태 변경

`handleStatusChange` 함수: 상태 변경 시 `issues.addComment()` 호출 → DB에 코멘트로 기록

---

## 변경 포인트

- **레이아웃 변경**: 반드시 이 문서 §3 고정 높이 규칙 준수 후 JSX 수정
- **KPI 카드 추가**: KPI 행에 `<KpiCard>` 추가 (비율 조정 필요 시 `grid-cols` 수정)
- **우측 패널 항목 추가**: `flex-1 min-h-0` 패턴 유지하며 새 섹션 추가
- **이슈 감지 조건**: `useDashboard.ts` 수정
