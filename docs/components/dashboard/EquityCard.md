# EquityCard

**파일**: `src/components/dashboard/EquityCard.tsx`  
**역할**: 지분/장기투자 종목별 평가금액·수익률 목록 + 전체 평가합계 추이 차트

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `equities` | `EquityWithReturn[]` | 종목별 최신 1건 + 수익률 계산값 |
| `historyOf` | `(name: string) => EquityRecord[]` | 종목별 전체 이력 반환 함수 |

## EquityWithReturn 타입

```typescript
interface EquityWithReturn extends EquityRecord {
  returnRate: number | null  // calcReturn(total_value, acquisition_cost)
}
```

## 구성 요소

```
[헤더]  지분/장기투자  1,351.2억원  [전체 종목 ▼]
─────────────────────────────────────
셀바스에이아이  KOSDAQ           538만원
셀바스헬스케어  KOSDAQ         327.9억원  +2.3%↑
메디아나        KOSDAQ         1,023.2억원
─────────────────────────────────────
[평가 추이]  14일  [30일]  90일
╭─────────────────────────────╮
│  AreaChart (핑크 그라디언트) │
╰─────────────────────────────╯
```

## 추이 차트 계산

- 필터 드롭다운 선택에 따라 표시 대상 변동
  - `전체 종목`: 모든 종목의 날짜별 `total_value` 합산
  - `특정 종목`: 해당 종목 이력만

## 변경 포인트

- **기간 탭 추가**: `PERIODS` 배열에 항목 추가
- **차트 색상**: `stroke="#ec4899"` (핑크) 수정
- **수익률 배지 색상**: `returnBadgeClass()` 함수 (format.ts)
- **국채 포함**: 현재 equities 테이블 데이터만 표시, 국채(investments) 추가 시 `useDashboard`에서 병합 필요
