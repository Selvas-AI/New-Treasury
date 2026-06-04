# AssetCompositionCard

**파일**: `src/components/dashboard/AssetCompositionCard.tsx`  
**신규 생성**: 2026-06-04 (WaterfallCard에서 분리)

## 역할

자산 구성을 도넛 차트와 범례로 표시하는 독립 카드.  
기존 `WaterfallCard` 내부의 우측 도넛 섹션을 분리하여 별도 카드로 독립시킴.

## Props

```ts
interface Props {
  kpi:   KpiData   // useDashboard().kpi
  fxKrw: number   // latestDaily.fx_krw (외화환산 비율 계산용)
}
```

## 표시 내용

| 섹션 | 내용 |
|------|------|
| 도넛 차트 | 운전자금(파랑) / 가용운용(초록) / 불가용(주황) |
| 범례 | 각 항목명 + 비율(%) |
| 원화/외화 비율 바 | 외화 보유 시에만 표시 |

## 레이아웃 내 위치

`DashboardPage`의 자금흐름 행 우측에 `sm:grid-cols-[3fr_1fr]`로 배치:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-[3fr_1fr] gap-4">
  <WaterfallCard ... />
  <AssetCompositionCard kpi={...} fxKrw={...} />
</div>
```
