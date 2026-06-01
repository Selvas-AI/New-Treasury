# WaterfallCard

**파일**: `src/components/dashboard/WaterfallCard.tsx`  
**역할**: 운전자금·운용자금·국채 수평 프로그레스 바 + 도넛 차트로 자금 구성 시각화

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `kpi` | `KpiData` | useDashboard에서 계산된 KPI 집계 값 |

## KpiData 구조 (src/hooks/useDashboard.ts)

```typescript
interface KpiData {
  availableCash:      number  // 가용자금 합계
  netCashPosition:    number  // 순현금 포지션
  unavailableAssets:  number  // 불가용 자산
  operatingCash:      number  // 운전자금 가용
  investCash:         number  // 운용자금 가용 (비국채)
  bondCash:           number  // 국채 가용
  totalLoan:          number  // 차입금 합계
}
```

## 시각 구성

```
[수평 바 영역]                    [도넛 차트]
● 운전자금 (가용)  ████████  56.5억    ╭──╮
● 운용자금 (가용)  ░         0원       │  │  ← 운전자금 100%
● 국채 (가용)      ░         0원       ╰──╯
──────────────────────────────
  가용자산 소계               56.5억
  차입금 (차감)              -148억
  순현금                     -91.5억
  불가용 자산               1,351억
```

## 변경 포인트

- **항목 추가**: `rows` 배열에 새 항목 추가 (label, value, color, pct)
- **도넛 색상**: `donutData` 배열의 `color` 필드 수정
- **차감 항목**: 차입금 외 추가 차감이 필요하면 요약 행 섹션 수정
- **레이아웃**: 도넛 숨기려면 `donutData.length > 0` 조건 제거
