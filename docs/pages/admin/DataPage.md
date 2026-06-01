# DataPage (데이터 관리)

**파일**: `src/pages/admin/DataPage.tsx`  
**라우트**: `/admin/data`  
**권한**: master 전용

---

## 기능

### 1. 테이블별 레코드 현황
3법인 × 5테이블 레코드 수 집계표:

| 테이블 | 설명 |
|--------|------|
| `daily` | 운전자금 일별 입력 |
| `investments` | 운용자금 + 국채 |
| `loans` | 차입금 |
| `equities` | 지분투자 날짜별 이력 |
| `issue_comments` | 이슈 코멘트 |

→ Supabase `count: 'exact'` 쿼리로 실시간 집계

### 2. 데이터 정리

```
테이블 선택 (daily / equities) + 법인 선택 + 날짜 입력
→ 해당 날짜 이전 데이터 일괄 삭제
→ confirm("복구 불가능") 팝업
```

**현재 지원 테이블**: `daily`, `equities` (날짜 컬럼 있는 테이블)  
→ 다른 테이블 추가 시 `TABLE_DEFS` 필터 수정

### 3. 외부 링크
- Supabase 대시보드
- GitHub 레포지토리

## 주의사항

- 데이터 정리는 **복구 불가능** — 실행 전 반드시 confirm
- `issue_comments`는 `created_at` (ISO) 기준, 다른 테이블은 `date` 기준
- `loans`, `investments`는 만기/시작일 혼재로 정리 대상에서 제외

## 변경 포인트

- **정리 가능 테이블 추가**: `TABLE_DEFS` 필터 조건 수정 + `dateCol` 매핑 추가
- **법인 추가**: `COMPANIES` 배열 수정
