# Selvas Treasury — 딥링크 라우팅 설계 명세
> 작성 기준: 2026-05-29
> 목적: 외부 시스템(사내 포털, 메일 알림, 연동 서비스) 에서 특정 데이터 뷰로 직접 접근할 수 있는 URL 구조 정의

---

## 1. 설계 원칙

### 왜 딥링크가 필요한가
- GAS 메일 알림에서 "차입금 만기 D-30" 클릭 → 해당 차입건 바로 이동
- 사내 포털/Notion에서 "셀바스헬스케어 운용자금 현황" 링크 게시
- 향후 외부 서비스(ERP, 회계 시스템) API 연동 시 특정 뷰 임베드
- 모바일에서 즐겨찾기로 특정 법인 대시보드 직접 접근

### URL 파라미터 우선순위
```
1. URL 파라미터 (:company) — 외부 링크로 진입 시
2. AuthContext.currentCompany — 앱 내 탐색 시
3. 기본값 — '셀바스에이아이' (master/ceo) 또는 자사 법인 (company 역할)
```

### 권한 처리 원칙
| 역할 | :company 파라미터 | 동작 |
|------|-------------------|------|
| master | 유효한 법인명 | setCurrentCompany() 자동 호출 |
| ceo | 유효한 법인명 | setCurrentCompany() 자동 호출 |
| company | 모든 값 | 무시 — 자사 법인만 접근 |

---

## 2. 전체 URL 라우트 테이블

### 통합 상황판
| URL | 설명 |
|-----|------|
| `/dashboard` | 현재 선택 법인 대시보드 |
| `/dashboard/셀바스에이아이` | 셀바스에이아이 대시보드 직접 이동 |
| `/dashboard/셀바스헬스케어` | 셀바스헬스케어 대시보드 직접 이동 |
| `/dashboard/메디아나` | 메디아나 대시보드 직접 이동 |

### 운전자금
| URL | 설명 |
|-----|------|
| `/input` | 현재 법인 운전자금 입력 |
| `/input/:company` | 특정 법인 운전자금 |
| `/input/:company/2026-05-29` | 특정 법인 특정 날짜 운전자금 |

### 운용자금
| URL | 설명 |
|-----|------|
| `/invest` | 현재 법인 운용자금 목록 |
| `/invest/:company` | 특정 법인 운용자금 |
| `/invest/:company/:id` | 특정 운용자금 레코드 상세 (uuid) |

### 차입금
| URL | 설명 |
|-----|------|
| `/loans` | 현재 법인 차입금 목록 |
| `/loans/:company` | 특정 법인 차입금 |
| `/loans/:company/:id` | 특정 차입금 레코드 상세 (uuid) — 메일 알림 링크 활용 |

**메일 알림 활용 예시**:
```
GAS 메일 본문의 만기 알림 링크:
https://new-treasury.selvas.com/loans/셀바스에이아이/{uuid}
→ 해당 차입건 상세 패널 자동 오픈
```

### 지분/장기투자
| URL | 설명 |
|-----|------|
| `/equity` | 현재 법인 지분 목록 |
| `/equity/:company` | 특정 법인 지분 목록 |
| `/equity/:company/삼성전자` | 특정 종목 상세 + 히스토리 패널 오픈 |
| `/equity/:company/비상장종목명` | 비상장 포함 |

### 국채/채권
| URL | 설명 |
|-----|------|
| `/bonds` | 현재 법인 국채 목록 |
| `/bonds/:company` | 특정 법인 국채 |
| `/bonds/:company/KR1030023165` | 특정 ISIN 국채 상세 + 히스토리 패널 오픈 |

### 자금 변동 이력
| URL | 설명 |
|-----|------|
| `/history` | 현재 법인 이력 |
| `/history/:company` | 특정 법인 이력 |
| `/history/:company/2026-01-01/2026-03-31` | 날짜 범위 지정 이력 |

### 이슈 이력
| URL | 설명 |
|-----|------|
| `/issue-history` | 전체 이슈 목록 |
| `/issue-history/loan_{uuid}` | 특정 차입금 이슈 스레드 직접 이동 |
| `/issue-history/equity_{종목명}` | 특정 주가 이슈 스레드 |
| `/issue-history/input_daily` | 운전자금 미입력 이슈 |

### 환율
| URL | 설명 |
|-----|------|
| `/fx` | 전체 환율 현황 |
| `/fx/USD` | USD 환율 상세 |
| `/fx/EUR` | EUR 환율 상세 |

---

## 3. 컴포넌트 구현 가이드

### URL 파라미터 읽기 패턴
```typescript
import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { Company } from '../types'

const VALID_COMPANIES: Company[] = ['셀바스에이아이', '셀바스헬스케어', '메디아나']

export default function LoansPage() {
  const { company, id } = useParams<{ company?: string; id?: string }>()
  const { user, currentCompany, setCurrentCompany } = useAuth()

  // URL 파라미터로 법인 자동 전환 (master/ceo)
  useEffect(() => {
    if (!company || user?.role === 'company') return
    if (VALID_COMPANIES.includes(company as Company)) {
      setCurrentCompany(company as Company)
    }
  }, [company, user?.role, setCurrentCompany])

  // id 파라미터가 있으면 해당 레코드 패널 자동 오픈
  useEffect(() => {
    if (id) openDetailPanel(id)
  }, [id])

  // ...
}
```

### 딥링크 생성 헬퍼 (src/lib/deeplink.ts — Step 9 이후 추가 예정)
```typescript
export function loanDeepLink(company: Company, id: string): string {
  return `/loans/${encodeURIComponent(company)}/${id}`
}

export function equityDeepLink(company: Company, name: string): string {
  return `/equity/${encodeURIComponent(company)}/${encodeURIComponent(name)}`
}

export function bondDeepLink(company: Company, isin: string): string {
  return `/bonds/${encodeURIComponent(company)}/${isin}`
}

export function issueDeepLink(issueKey: string): string {
  return `/issue-history/${encodeURIComponent(issueKey)}`
}
```

### GAS 메일 알림에서 딥링크 활용
```javascript
// GAS_코드_v3.gs 수정 예정
const BASE_URL = 'https://new-treasury.selvas.com'  // DNS 전환 후

function buildLoanLink(company, loanId) {
  return `${BASE_URL}/loans/${encodeURIComponent(company)}/${loanId}`
}
```

---

## 4. URL 인코딩 주의사항

한글 법인명 및 종목명은 URL 인코딩이 필요합니다.

```
셀바스에이아이  → %EC%85%80%EB%B0%94%EC%8A%A4%EC%97%90%EC%9D%B4%EC%95%84%EC%9D%B4
삼성전자       → %EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90
```

- `react-router-dom`은 `useParams()`에서 자동 디코딩 처리
- `NavLink`/`Link`의 `to` 속성에는 `encodeURIComponent()` 적용 권장
- ISIN 코드(영문+숫자)는 인코딩 불필요

---

## 5. 향후 외부 연동 시나리오

| 시나리오 | URL 예시 |
|----------|---------|
| GAS 메일 → 차입금 만기 알림 | `/loans/셀바스에이아이/{uuid}` |
| GAS 메일 → 운전자금 미입력 알림 | `/input/메디아나/2026-05-29` |
| 사내 포털 → 법인별 대시보드 위젯 링크 | `/dashboard/셀바스헬스케어` |
| Notion → 특정 국채 시세 뷰 | `/bonds/셀바스에이아이/KR1030023165` |
| 모바일 홈 화면 바로가기 | `/dashboard/메디아나` |
| Phase 3 자금일보 → 차입금 이슈 링크 | `/issue-history/loan_{uuid}` |
