# UsersPage (사용자 관리)

**파일**: `src/pages/admin/UsersPage.tsx`  
**라우트**: `/admin/users`  
**권한**: master 전용 (비마스터 접근 시 /dashboard 리다이렉트)

---

## 사용자 테이블 (`access_codes`)

| 컬럼 | 설명 |
|------|------|
| id | UUID PK |
| access_code | 로그인 코드 (평문 저장) |
| role | master / ceo / company |
| company | company 역할만 법인명 |
| label | 표시 이름 |
| is_active | 활성/비활성 |

## 역할별 권한 차이

| 역할 | 열람 | 편집 | 법인 | 관리메뉴 |
|------|------|------|------|---------|
| master | 전체 3사 | ✅ | 선택 가능 | ✅ |
| ceo | 전체 3사 | ❌ | 선택 가능 | ❌ |
| company | 자사만 | ✅ (자사) | 고정 | ❌ |

## 사용자 추가/수정 폼

- 역할이 `company`인 경우만 소속 법인 선택 표시
- 접근 코드 6자 이상 검증
- is_active 체크박스

## 안전 장치

- 현재 로그인 계정 삭제 방지 (`id === user.sb_id` 비교)
- 삭제 시 confirm 팝업
- 비활성화: is_active = false → 해당 코드로 로그인 불가

## 변경 포인트

- **법인 추가**: `COMPANY_OPTIONS` 배열 + `Company` 타입 확장
- **역할 추가**: `ROLE_OPTIONS` 배열 + `UserRole` 타입 + 권한 로직 전반 수정
