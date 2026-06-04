# FlowDetailDrawer

**파일**: `src/components/dashboard/FlowDetailDrawer.tsx`  
**신규 생성**: 2026-06-04

## 역할

`WaterfallCard`의 각 항목 클릭 시 나타나는 플로팅 상세 패널.  
기존 우측 패널 고정 카드(운전자금/운용자금/차입금 상세)를 팝업 방식으로 전환한 것.

## Props

```ts
interface Props {
  itemKey:       FlowItemKey | null   // 열릴 항목 키 (null이면 미표시)
  kpi:           KpiData
  latestDaily:   DailyRecord | null
  latestInvests: InvestmentRecord[]
  loans:         LoanRecord[]
  equities:      EquityItem[]         // equityReturns (returnRate 포함)
  company:       string               // 바로가기 링크용
  onClose:       () => void
}

type FlowItemKey = 'operating' | 'invest' | 'fx' | 'loan' | 'net' | 'unavailable'
```

## 항목별 상세 내용

| key | 제목 | 내용 |
|-----|------|------|
| `operating` | 운전자금 상세 | 보통예금/CMA · 국책자금 · 증권예수금 · 외화환산 + 합계 |
| `invest` | 운용자금 상세 | 상품별 금액 목록 |
| `fx` | 외화 상세 | USD/EUR/JPY/GBP/CNY 원화잔액 + 환산합계 |
| `loan` | 차입금 상세 | 대출건별 금리·만기·D-day + 합계 |
| `net` | 순현금 포지션 | 가용자금 − 차입금 계산 표시 |
| `unavailable` | 불가용 자산 | 지분(비상장·매각제한) 목록 + 운용/국채 불가용 + 합계 |

## 위치 및 애니메이션

```
fixed right-4 top-1/2 -translate-y-1/2  z-50
w-80  max-h-[70vh]
animate-[slideInRight_0.2s_ease-out]
```

배경 딤: `fixed inset-0 z-40 bg-black/10` — 클릭 시 닫힘

## 열기/닫기

```ts
// DashboardPage 상태
const [flowDetail, setFlowDetail] = useState<FlowItemKey | null>(null)

// WaterfallCard onItemClick
const handleFlowClick = (key: FlowItemKey) =>
  setFlowDetail(prev => prev === key ? null : key)  // 같은 항목 재클릭 시 토글
```
