# DashboardPage (TREASURY Dashboard)

**파일**: `src/pages/DashboardPage.tsx`  
**라우트**: `/dashboard`, `/dashboard/:company`  
**역할**: 전체 자금 현황 한눈에 보기  
**최종 업데이트**: 2026-06-04 (Updateplan_260604 반영)

---

## 레이아웃 구조 (현재 구현 기준)

```
┌─────────────────────────────────────────────────────────────────────┐
│  TREASURY Dashboard   [⚠ 이슈 전광판 ticker →→→]   [날짜 기준] [새로고침]  │
├─────────────────────────────────────────────────────────────────────┤
│  [KPI: 가용자금 합계]   [KPI: 순현금 포지션]   [KPI: 불가용 자산]   │  ← full width
├──────────────────────────────────────┬──────────────────────────────┤
│  자금 흐름 (WaterfallCard)           │  자산 구성 (AssetCompositionCard) │
│  · 각 항목 클릭 → FlowDetailDrawer  │  · 도넛 차트 + 범례              │
│  · 운전/운용/외화/차입/순현금/불가용 │  · 원화/외화 비율 바             │
├──────────────────────────────────────┴──────────────────────────────┤
│  [현금흐름 추이 CashflowChart]     │  [지분/장기투자 EquityCard]      │
└─────────────────────────────────────────────────────────────────────┘

  팝업 레이어 (fixed, z-50):
  · 이슈 ticker 클릭 → IssueDrawer  (우측 중앙 플로팅 패널)
  · 자금흐름 항목 클릭 → FlowDetailDrawer (우측 중앙 플로팅 패널)
```

---

## §1. 헤더 레이아웃

```tsx
<div className="flex items-center gap-3 h-8">
  <h2>TREASURY Dashboard</h2>           {/* 고정 */}

  {/* 이슈 전광판: 이슈가 있을 때만 표시, 클릭 시 IssueDrawer 열기 */}
  <div className="flex-1 overflow-hidden relative cursor-pointer"
       onClick={() => setIssueOpen(prev => !prev)}>
    <div className="issue-ticker-track">   {/* 우→좌 CSS 애니메이션 */}
      {issues.map(issue => <span>⚠ {issue.title}</span>)}
    </div>
  </div>

  {/* 이슈 없으면 flex-1 빈 div로 날짜를 오른쪽에 밀기 */}
  <div className="flex items-center gap-2 shrink-0 ml-auto">
    <span>[날짜] 기준</span>
    <button>새로고침</button>
  </div>
</div>
```

**이슈 ticker CSS** (`src/index.css`):
```css
@keyframes issue-scroll {
  0%   { transform: translateX(100%); }
  100% { transform: translateX(-100%); }
}
.issue-ticker-track { animation: issue-scroll 18s linear infinite; }
.issue-ticker-track:hover { animation-play-state: paused; }
```

---

## §2. KPI 행 — 전체 너비 (full-width)

```tsx
{/* ⚠ KPI는 메인 그리드 외부에 배치 → 불가용자산 우측이 페이지 끝에 닿음 */}
<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
  <KpiCard label="가용자금 합계" />
  <KpiCard label="순현금 포지션" />
  <KpiCard label="불가용 자산" />
</div>
```

> **이전 구현 차이점**: KPI 카드가 이전에는 `8fr` 좌측 열 안에 있었으나,
> 현재는 메인 그리드 바깥에 배치해 전체 너비로 확장됨.

---

## §3. 자금흐름 + 자산구성 (분리 카드)

```tsx
<div className="grid grid-cols-1 sm:grid-cols-[3fr_1fr] gap-4">
  <WaterfallCard
    kpi={...}
    onItemClick={handleFlowClick}   {/* 항목 클릭 시 FlowDetailDrawer 열기 */}
    activeItem={flowDetail}          {/* 현재 활성 항목 하이라이트 */}
  />
  <AssetCompositionCard kpi={...} fxKrw={...} />
</div>
```

### WaterfallCard 클릭 항목 키 (`FlowItemKey`)
| key | 표시 내용 | 드로어 상세 |
|-----|---------|-----------|
| `operating` | 운전자금 | 보통예금/CMA·국책·MMDA·외화 분해 |
| `invest` | 가용 운용 | 운용자금 상품별 목록 |
| `fx` | 외화(환산) | USD/EUR/JPY/GBP/CNY 잔액 |
| `loan` | 차입금 | 대출 건별 만기·금리·D-day |
| `net` | 순현금 | 가용자금 − 차입금 계산 표시 |
| `unavailable` | 불가용 | 지분(비상장·매각제한) + 운용/국채 불가용 목록 |

---

## §4. 팝업 드로어 (Floating Overlay)

### FlowDetailDrawer
- **파일**: `src/components/dashboard/FlowDetailDrawer.tsx`
- **위치**: `fixed right-4 top-1/2 -translate-y-1/2 z-50 w-80 max-h-[70vh]`
- **열기**: WaterfallCard 항목 클릭 → `setFlowDetail(key)`
- **닫기**: ✕ 버튼 | 배경 딤 클릭 | 같은 항목 재클릭
- **Props**: `itemKey, kpi, latestDaily, latestInvests, loans, equities, company, onClose`

### IssueDrawer
- **파일**: `src/components/dashboard/IssueDrawer.tsx`
- **위치**: `fixed right-4 top-1/2 -translate-y-1/2 z-50 w-80 max-h-[70vh]`
- **열기**: 헤더 이슈 ticker 클릭 → `setIssueOpen(true)`
- **닫기**: ✕ 버튼 | 배경 딤 클릭 | ticker 재클릭
- **기능**: 이슈 상태 변경(미조치/검토중/완료), 바로가기 링크, 전체 이력 이동
- **주의**: 기존 `IssueCard`(우측 패널 고정 카드)는 삭제됨 — 팝업 방식으로 전환

---

## §5. 반응형 규칙

| 브레이크포인트 | 레이아웃 |
|---------------|---------|
| 모바일 `< sm` | 모든 카드 단일 열 수직 스택 |
| `sm` (640px~) | KPI 3열, WaterfallCard+AssetCompositionCard 나란히 (3fr:1fr) |
| `md` (768px~) | CashflowChart + EquityCard 나란히 (2열) |
| `lg` (1024px~) | 레이아웃 변화 없음 (단일 컬럼 유지) |

> **이전 구현 차이점**: 이전에는 `lg:grid-cols-[8fr_3fr]` 2컬럼 그리드였으나,
> 현재는 단일 컬럼(스택) 구조로 단순화됨. 우측 패널은 제거되고 팝업으로 전환.

---

## §6. 상태 관리 (DashboardPage 내부)

```ts
const [flowDetail, setFlowDetail] = useState<FlowItemKey | null>(null) // FlowDetailDrawer 열린 항목
const [issueOpen,  setIssueOpen]  = useState(false)                     // IssueDrawer 열림 여부
const [hoverKey,   setHoverKey]   = useState<string | null>(null)       // EquityCard hover
const [fixedKey,   setFixedKey]   = useState<string | null>(null)       // EquityCard 고정 선택
```

---

## §7. 데이터 소스

모든 데이터는 `useDashboard()` 훅에서 계산:

| 속성 | 설명 |
|------|------|
| `kpi` | 가용자금/순현금/불가용 집계 |
| `latestDaily` | 당일 운전자금 최신 레코드 |
| `allDailyData` | 전체 운전자금 이력 (CashflowChart용) |
| `latestInvests` | 최신 운용자금 목록 |
| `allInvestData` | 전체 운용자금 데이터 |
| `loans` | active 포함 전체 차입금 |
| `detectedIssues` | 자동 감지된 이슈 목록 |
| `equityReturns` | 지분 최신 시세 + 수익률 (`returnRate` 포함) |
| `equityHistoryOf` | 종목별 이력 함수 (스파크라인용) |
| `latestBonds` | 국채 최신 시세 |
| `bondHistoryOf` | 국채 ISIN별 평가금액 이력 |
| `prevOperatingCash` | 전일 운전자금 (전일 대비 표시용) |

---

## §8. 컴포넌트 목록

| 컴포넌트 | 파일 | 역할 |
|---------|------|------|
| `KpiCard` | `dashboard/KpiCard.tsx` | 요약 수치 카드 |
| `WaterfallCard` | `dashboard/WaterfallCard.tsx` | 자금흐름 가로 바 차트, 클릭 가능 |
| `AssetCompositionCard` | `dashboard/AssetCompositionCard.tsx` | 자산구성 도넛 + 범례 (**신규**) |
| `FlowDetailDrawer` | `dashboard/FlowDetailDrawer.tsx` | 자금흐름 항목 상세 팝업 (**신규**) |
| `IssueDrawer` | `dashboard/IssueDrawer.tsx` | 이슈 목록 팝업 (**신규**) |
| `CashflowChart` | `dashboard/CashflowChart.tsx` | 기간별 자금 추이 바 차트 |
| `EquityCard` | `dashboard/EquityCard.tsx` | 지분/장기투자 + 스파크라인 |
| ~~`IssueCard`~~ | ~~`dashboard/IssueCard.tsx`~~ | ~~우측 패널 이슈 목록~~ → **IssueDrawer로 전환** |

---

## §9. 이슈 상태 변경

`handleStatusChange` 함수: 상태 변경 시 `issues.addComment()` 호출 → DB에 코멘트로 기록  
IssueDrawer, FlowDetailDrawer 모두 동일한 핸들러 사용.

---

## §10. 변경 시 주의사항

- **헤더 ticker**: 이슈 있을 때만 표시됨 — 이슈 없을 경우 `flex-1` 빈 div가 날짜를 오른쪽에 밀어냄
- **FlowDetailDrawer 불가용 상세**: `equityReturns` (returnRate 포함) 전달 필수
- **IssueCard 파일**: 파일 자체는 남아있으나 DashboardPage에서 미사용 — 추후 정리 예정
- **배경 딤 z-index**: `z-40` (배경) / `z-50` (드로어 패널) — TopBar(z-10)와 충돌 없음
