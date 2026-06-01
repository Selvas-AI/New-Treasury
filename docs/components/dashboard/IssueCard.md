# IssueCard

**파일**: `src/components/dashboard/IssueCard.tsx`  
**역할**: 자동 감지된 이슈 목록 표시 + 상태 변경 버튼

---

## Props

| Prop | 타입 | 설명 |
|------|------|------|
| `issues` | `IssueItem[]` | 감지된 이슈 배열 |
| `onStatusChange` | `(key, id, status) => void` | 상태 변경 콜백 |

## IssueItem 구조

```typescript
interface IssueItem {
  key:          string       // 이슈 식별자 (loan_{uuid}, equity_{종목명}, input_daily)
  title:        string       // 이슈 제목
  desc:         string       // 이슈 설명
  status:       IssueStatus  // open | review | done
  commentCount: number       // 연결된 코멘트 수
}
```

## 이슈 자동 감지 로직 (useDashboard.ts)

| 이슈 종류 | 감지 조건 | issueKey |
|-----------|-----------|----------|
| 운전자금 미입력 | 오늘 daily 레코드 없음 + 영업일 | `input_daily` |
| 차입금 만기 | maturity까지 D-90 이하 + active | `loan_{uuid}` |
| 주가 미갱신 | 최신 date가 오늘 기준 -2일 이전 | `equity_{종목명}` |

## 상태 배지 색상

| status | 배지 |
|--------|------|
| `open` | 빨강 (미조치) |
| `review` | 노랑 (검토중) |
| `done` | 회색 (완료) → 이슈 카드에서 숨김 |

## 변경 포인트

- **감지 조건 변경**: `useDashboard.ts`의 `detectedIssues` useMemo 수정
- **D-90 임계값 변경**: `dday <= 90` 조건 수정
- **주가 미갱신 일수**: `threshold` 날짜 계산 변경 (`-2일` → 다른 값)
