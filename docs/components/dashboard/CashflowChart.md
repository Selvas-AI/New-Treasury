# CashflowChart

**파일**: `src/components/dashboard/CashflowChart.tsx`  
**역할**: 날짜별 운전자금·운용자금·차입금을 기간별 Bar 차트로 표시

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `dailyRecords` | `DailyRecord[]` | **전체** 운전자금 이력 (1건만 넘기면 차트 미표시) |
| `investments` | `InvestmentRecord[]` | 전체 운용자금 데이터 |
| `loans` | `LoanRecord[]` | active 차입금 목록 |

## 데이터 계산 방식

```
운전자금 = krw_demand + krw_govt + krw_mmda + fx_krw  (해당 날짜 daily 레코드)
운용자금 = getLatestInvestments(investments ≤ 해당날짜)  (날짜별 최신 집계)
차입금   = loans.reduce(amount)  (active 차입금 합계, 날짜 무관 고정값)
```

## 기간 탭

| 탭 | 기간 | 표시 막대 수 (영업일 기준 ~) |
|----|------|--------------------------|
| 7일 | 7일 | ~5개 |
| 30일 | 30일 | ~22개 |
| 90일 | 90일 | ~65개 |
| 1년 | 365일 | ~260개 |

## 차트 색상

| 데이터키 | 색상 | 설명 |
|---------|------|------|
| `opM` | `#3b82f6` (파랑) | 운전자금 |
| `invM` | `#10b981` (초록) | 운용자금 |
| `loanM` | `#f87171` (빨강) | 차입금 |

## Y축 단위

- 만원 단위로 변환 후 차트 표시 (`÷ 10,000`)
- 툴팁은 다시 원화로 역변환 (`× 10,000`)

## 주의사항

- `dailyRecords`에 **반드시 전체 이력** 전달 필요  
  → `DashboardPage`에서 `db.allDailyData` 사용 (버그 수정 완료)
- 데이터 2건 미만 시 "데이터 부족" 안내 표시

## 변경 포인트

- **차트 종류 변경**: `BarChart` → `AreaChart` (import + JSX 교체)
- **색상 변경**: `Bar fill` 속성 수정
- **기간 탭 추가**: `PERIODS` 배열에 항목 추가
