# 데이터 훅 레퍼런스

`src/hooks/` 폴더의 커스텀 훅 전체 목록

---

## 인증

### useAuth
```typescript
import { useAuth } from '../hooks/useAuth'

const { user, currentCompany, login, logout, setCurrentCompany } = useAuth()
```
| 반환값 | 타입 | 설명 |
|--------|------|------|
| `user` | `TreasuryUser \| null` | 로그인 사용자 정보 |
| `currentCompany` | `Company \| null` | 현재 선택 법인 |
| `login(code)` | `Promise<string\|null>` | 로그인, 에러 메시지 반환 |
| `logout()` | `void` | 세션 초기화 |
| `setCurrentCompany(c)` | `void` | 법인 전환 |

---

## 데이터 훅 공통 패턴

모든 데이터 훅은 `currentCompany` 또는 `user.company` 기준으로 자동 필터링됩니다.

```typescript
const fetchCompany = user?.role === 'company' ? user.company : currentCompany
// → company 역할은 항상 자사 법인만 조회
```

---

## useDaily
```typescript
const { data, loading, error, refetch, upsert, remove } = useDaily()
```
- `data`: DailyRecord[] — 날짜 내림차순
- `upsert(record)` — 같은 날짜+법인 레코드 덮어쓰기
- `remove(id)`

---

## useLoans
```typescript
const { data, loading, save, remove, setActive } = useLoans(activeOnly?)
```
- `data`: LoanRecord[] — 만기일 오름차순
- `save(record)` — id 있으면 update, 없으면 insert
- `setActive(id, bool)` — 상환 처리 / 복원

---

## useInvestments
```typescript
const { data, bonds, nonBonds, save, remove, setActive, updateAcquisitionCost } = useInvestments(activeOnly?)
```
- `bonds` — product='국채' 필터
- `nonBonds` — 비국채 필터
- `updateAcquisitionCost(ids[], cost)` — 여러 레코드 일괄 취득가액 반영

---

## useEquities
```typescript
const { data, latest, historyOf, save, remove, updateAcquisitionCost } = useEquities()
```
- `latest` — 종목별 최신 날짜 1건 (getLatestEquities)
- `historyOf(name)` — 특정 종목 전체 이력, 날짜 내림차순
- `updateAcquisitionCost(name, cost)` — 동일 종목명 전체 이력 일괄 반영

---

## useIssues
```typescript
const { data, threadOf, openCount, addComment, updateStatus, updateComment, remove } = useIssues()
```
- `threadOf(issueKey)` — 특정 키의 코멘트 스레드 (날짜 오름차순)
- `openCount` — status !== 'done' 건수 (배지용)
- `updateStatus(id, status)` — 상태만 변경
- `updateComment(id, body, status)` — 본문 + 상태 동시 수정

---

## useFx
```typescript
const { rates, loading, error, fetchRates, toKRW } = useFx()
```
- `rates` — FxRate[] (GAS API 결과)
- `fetchRates()` — 환율 수동 조회
- `toKRW(amount, code)` — 외화 → 원화 환산

---

## useDashboard
```typescript
const db = useDashboard()
```
| 속성 | 타입 | 설명 |
|------|------|------|
| `loading` | boolean | 전체 로딩 상태 |
| `kpi` | KpiData | 자금 집계 |
| `waterfall` | WaterfallItem[] | 자금흐름 항목 |
| `latestDaily` | DailyRecord\|null | 최신 운전자금 1건 |
| `allDailyData` | DailyRecord[] | 전체 운전자금 이력 (차트용) |
| `latestInvests` | InvestmentRecord[] | 운용자금 최신 집계 |
| `allInvestData` | InvestmentRecord[] | 전체 운용자금 데이터 |
| `loans` | LoanRecord[] | active 차입금 |
| `detectedIssues` | IssueItem[] | 자동 감지 이슈 |
| `equityReturns` | EquityWithReturn[] | 지분 최신 + 수익률 |
| `equityHistoryOf` | Function | 종목별 이력 반환 |
| `issues` | useIssues 반환값 | 이슈 CRUD |
| `refetchAll` | Function | 전체 데이터 재조회 |

---

## useGas
```typescript
import { fetchStockPrice, fetchBondPrice } from '../hooks/useGas'

const result = await fetchStockPrice('005930')
// → { code, price, date }

const bond = await fetchBondPrice('KR1030023165', '20260529')
// → { isin, price, date }
// basDt 생략 시 최근 유효 데이터
```
