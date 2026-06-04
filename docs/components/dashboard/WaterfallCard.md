# WaterfallCard

**파일**: `src/components/dashboard/WaterfallCard.tsx`  
**역할**: 자금 흐름 수평 바 차트 (클릭 가능) — 자산 구성 도넛은 `AssetCompositionCard`로 분리됨  
**업데이트**: 2026-06-04 (도넛 분리 + 클릭 핸들러 추가)

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `kpi` | `KpiData` | useDashboard에서 계산된 KPI 집계 값 |
| `fxKrw` | `number` | latestDaily.fx_krw (외화환산 바 표시용) |
| `prevOperatingCash` | `number \| null` | 전일 운전자금 (전일 대비 화살표 표시) |
| `onItemClick` | `(key: FlowItemKey) => void` | 항목 클릭 콜백 (FlowDetailDrawer 열기) |
| `activeItem` | `FlowItemKey \| null` | 현재 활성(하이라이트) 항목 키 |

```ts
type FlowItemKey = 'operating' | 'invest' | 'fx' | 'loan' | 'net' | 'unavailable'
```

---

## KpiData 구조

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

---

## 시각 구성

```
자금 흐름                              가용 합계 − 차입 = 순현금
─────────────────────────────────────────────────────────────
● 운전자금 [가용]  ██████████  67.5억 ─    ›  ← 클릭 가능
● 가용 운용 [가용]  ░          0원         ›
  ~ 외화(환산) [FX] ░          2.4억        ›  (들여쓰기)
──────────────────────────────────────────────────
  가용자산 소계                67.5억
● 차입금 [차입]   ████████  148.0억 -148억  ›
● 순현금          ██████    -80.5억          ›
● 불가용 [불가]   ████████ 1222.9억          ›
```

각 행에 `›` 아이콘이 표시되며, 클릭 시 `onItemClick(key)` 호출.

---

## 클릭 인터랙션

- `onItemClick` 전달 시 각 행이 `cursor-pointer`로 활성화
- `activeItem === key`인 행은 `bg-blue-50 ring-1 ring-blue-200` 하이라이트
- 클릭 토글: 같은 항목 재클릭 시 `setFlowDetail(null)` → 드로어 닫힘

---

## 변경 포인트

- **도넛/자산구성 관련**: `AssetCompositionCard`에서 관리 (이 컴포넌트에 없음)
- **항목 추가**: `FlowItemKey` 타입 확장 후 JSX에 `BarRow` 추가
- **클릭 비활성화**: `onItemClick` prop을 전달하지 않으면 클릭 UI 없이 표시 전용
