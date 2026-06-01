# DashboardPage (통합 상황판)

**파일**: `src/pages/DashboardPage.tsx`  
**라우트**: `/dashboard`, `/dashboard/:company`  
**역할**: 전체 자금 현황 한눈에 보기

---

## 레이아웃 구조

```
[KPI 카드 3개: 가용자금합계 / 순현금포지션 / 불가용자산]

┌─────────────────────────────┐ ┌──────────────────┐
│  [자금흐름 WaterfallCard]   │ │  [운전자금 상세]  │
│  [이슈 확인 IssueCard]      │ │  [운용자금 상세]  │
│  [현금흐름 추이 차트]       │ │  [차입금 상세]   │
│  [지분/장기투자 EquityCard] │ │                  │
└─────────────────────────────┘ └──────────────────┘
     lg:col-span-2 (2/3)              1/3
```

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

## 딥링크

```
/dashboard/셀바스헬스케어
→ URL 진입 시 currentCompany 자동 전환 (master/ceo만)
```

## 이슈 상태 변경

`handleStatusChange` 함수: 상태 변경 시 `issues.addComment()` 호출 → DB에 코멘트로 기록

## 변경 포인트

- **레이아웃 변경**: JSX 그리드 클래스 수정 (`lg:grid-cols-3` 등)
- **KPI 카드 추가**: 카드 행에 `<KpiCard>` 추가
- **우측 패널 항목 추가**: 우측 `div` 내 새 섹션 추가
- **이슈 감지 조건**: `useDashboard.ts` 수정
