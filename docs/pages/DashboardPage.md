# DashboardPage (통합 상황판)

**파일**: `src/pages/DashboardPage.tsx`  
**라우트**: `/dashboard`, `/dashboard/:company`  
**역할**: 전체 자금 현황 한눈에 보기

---

## 레이아웃 명세 (Layout Specification)

### ⚠️ 핵심 규칙 — 반드시 준수

> 대시보드 관련 컴포넌트(`DashboardPage.tsx` 및 하위 카드 컴포넌트)를 수정할 때는
> 이 섹션에 명시된 **고정 높이 및 내부 스크롤 규칙**을 반드시 준수해야 한다.
> **카드가 콘텐츠 양에 따라 불규칙하게 높이가 늘어나는 코드를 작성해서는 안 된다.**

---

### 1. 최상위 컨테이너 (Unified Dashboard Container)

대시보드 전체는 **하나의 큰 아웃라인 박스** 안에 포함된 CSS Grid 구조로 구성된다.

```
┌─────────────────────────────────────────────────────────────────┐
│  Unified Dashboard Container  (border, rounded, bg-white 등)   │
│                                                                  │
│  ┌── 좌측 메인 영역 (8fr) ───────┐  ┌── 우측 패널 (3fr) ──────┐ │
│  │  KPI 행 (3fr / 3fr / 2fr)    │  │  운전자금 상세           │ │
│  │  WaterfallCard               │  │  ─────────────────────  │ │
│  │  IssueCard                   │  │  운용자금 상세           │ │
│  │  CashflowChart  │ EquityCard │  │  ─────────────────────  │ │
│  └───────────────────────────────┘  │  차입금 상세            │ │
│                                      └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

- 최상위 컨테이너는 `border border-gray-200 rounded-xl` 등으로 묶어 시각적 단일 단위임을 표현한다.
- 내부는 `grid grid-cols-[8fr_3fr]`(lg 이상) 2열 구조로 분리한다.

---

### 2. 그리드 셀 비율

| 영역 | 그리드 할당 | 비고 |
|------|------------|------|
| 좌측 메인 전체 | `8fr` | KPI + 차트 + 지분 카드 포함 |
| 우측 상세 패널 | `3fr` | 운전자금·운용자금·차입금 상세 |
| KPI 행 (좌측 내부) | `3fr / 3fr / 2fr` | 가용자금 / 순현금 / 불가용자산 |
| 하단 좌측 (좌측 내부) | `grid-cols-2` | CashflowChart + EquityCard 나란히 |

연관성 있는 정보(운전자금·운용자금·차입금 상세)는 우측 패널 안에서 **동일한 비율의 고정 높이 셀**로 배치해 시각적 균형을 유지한다.

---

### 3. 🔒 고정 높이 + 내부 스크롤 규칙 (Fixed Height / Internal Scroll)

**적용 대상**: 우측 패널의 세 상세 카드
- 운전자금 상세 (`WorkingCapitalDetail`)
- 운용자금 상세 (`InvestmentDetail`)
- 차입금 상세 (`LoanDetail`)

**규칙**:

```
카드 높이는 고정(h-* 또는 flex 비율)되어야 한다.
콘텐츠가 카드 높이를 초과할 경우,
  ✅ 카드 외부 크기는 유지 (늘어나지 않음)
  ✅ 카드 내부 콘텐츠 영역에 세로 스크롤바 생성 (overflow-y: auto)
  ❌ 카드 height가 콘텐츠 양에 따라 동적으로 증가하는 것 금지
```

**구현 패턴**:

```tsx
{/* 우측 패널 — 세 카드가 동일 높이로 균등 분할 */}
<div className="flex flex-col h-full gap-3">

  {/* 운전자금 상세 */}
  <div className="flex-1 min-h-0 border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">운전자금 상세</h3>
    <div className="flex-1 overflow-y-auto">   {/* ← 내부 스크롤 */}
      {/* 콘텐츠 */}
    </div>
  </div>

  {/* 운용자금 상세 — 동일 패턴 */}
  <div className="flex-1 min-h-0 border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">운용자금 상세</h3>
    <div className="flex-1 overflow-y-auto">
      {/* 콘텐츠 */}
    </div>
  </div>

  {/* 차입금 상세 — 동일 패턴 */}
  <div className="flex-1 min-h-0 border rounded-lg flex flex-col">
    <h3 className="shrink-0 px-3 py-2 text-xs font-semibold border-b">차입금 상세</h3>
    <div className="flex-1 overflow-y-auto">
      {/* 콘텐츠 */}
    </div>
  </div>

</div>
```

**핵심 Tailwind 클래스 조합**:

| 클래스 | 역할 |
|--------|------|
| `flex flex-col h-full` | 부모 높이를 채우는 세로 flex 컨테이너 |
| `flex-1 min-h-0` | 균등 높이 분배 + 최소 높이 0 설정(overflow 허용) |
| `shrink-0` | 헤더/푸터가 압축되지 않도록 고정 |
| `overflow-y-auto` | 콘텐츠 초과 시 세로 스크롤 생성 |

> **`min-h-0` 필수**: Flexbox에서 자식의 기본 `min-height`는 `auto`(콘텐츠 크기)이므로
> `min-h-0`을 지정하지 않으면 `flex-1`이 있어도 카드가 콘텐츠 크기로 늘어난다.

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
