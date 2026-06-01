# IssueHistoryPage (이슈 이력)

**파일**: `src/pages/IssueHistoryPage.tsx`  
**라우트**: `/issue-history`, `/issue-history/:issueKey`  
**데이터**: `issue_comments` 테이블  
**권한**: master·company 편집 / ceo 읽기 전용

---

## 이슈 키 구조

| 유형 | issueKey 형식 | 생성 주체 |
|------|--------------|---------|
| 차입금 만기 | `loan_{uuid}` | useDashboard 자동 감지 |
| 주가 미갱신 | `equity_{종목명}` | useDashboard 자동 감지 |
| 운전자금 미입력 | `input_daily` | useDashboard 자동 감지 |
| 수동 이슈 | 임의 문자열 | 직접 생성 (미구현) |

## 그룹화 및 정렬

```typescript
groupByKey(comments)
// 1. issue_key 기준으로 코멘트 묶기
// 2. 각 그룹의 마지막 코멘트 status = 그룹 status
// 3. 정렬: open → review → done, 각 그룹 내 최신순
```

## 상태 필터 탭

| 탭 | 설명 |
|----|------|
| 전체 | 모든 이슈 |
| 미조치 | status = open |
| 검토중 | status = review |
| 완료 | status = done |

## 코멘트 스레드 패널

- 아코디언 펼치기/접기
- 상태 변경 버튼: 현재 상태가 아닌 것만 클릭 가능 → 새 코멘트로 기록
- 코멘트 추가: textarea + "코멘트 추가" 버튼
- 인라인 수정: body + status 동시 수정
- 삭제: confirm 후 제거

## 딥링크

```
/issue-history/loan_{uuid}
→ 해당 이슈 패널 자동 오픈 (paramKey → openKey)
```

## 변경 포인트

- **이슈 키 형식 변경**: `makeIssueKey()` 함수 (format.ts) + 기존 DB 마이그레이션 필요
- **상태 추가**: `IssueStatus` 타입 + `STATUS_LABEL/COLOR` 객체 확장
- **수동 이슈 생성**: "이슈 등록" 버튼 + addComment 폼 추가
