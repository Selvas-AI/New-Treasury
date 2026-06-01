# LoansPage (차입금)

**파일**: `src/pages/LoansPage.tsx`  
**라우트**: `/loans`, `/loans/:company`, `/loans/:company/:id`  
**데이터**: `loans` 테이블  
**권한**: master·company 편집 / ceo 읽기 전용

---

## KPI 카드

| 카드 | 설명 |
|------|------|
| 차입금 합계 | active 차입금 총합 + 건수 |
| 만기 D-90 이하 | D-30 이하 있으면 빨간 강조 |
| 상환 완료 | inactive 건수 |

## 탭 구성

| 탭 | 필터 |
|----|------|
| 차입 중 | `active = true` |
| 상환 완료 | `active = false` |

## D-day 배지

| 조건 | 스타일 |
|------|--------|
| `dday < 0` | 회색 "만기경과" |
| `dday <= 7` | 빨강 굵게 animate-pulse |
| `dday <= 30` | 빨강 |
| `dday <= 90` | 주황 |
| 그 외 | 회색 |

## 행 배경색

- D-7 이하: `bg-red-50`
- D-30 이하: `bg-amber-50/50`

## 합계 행

차입 중 탭 하단에 차입금 합계 `<tfoot>` 표시

## 딥링크 활용 예시

```
GAS 메일 알림 링크:
https://new-treasury.selvas.com/loans/셀바스에이아이/{uuid}
→ 해당 차입건 수정 모드 자동 오픈
```

## 변경 포인트

- **차입 유형 추가**: `LOAN_TYPES` 배열에 항목 추가
- **D-day 임계값**: `DdayBadge` 컴포넌트 내 조건 수정
- **이슈 감지 연동**: `useDashboard.ts`의 `dday <= 90` 조건과 동기화 필요
