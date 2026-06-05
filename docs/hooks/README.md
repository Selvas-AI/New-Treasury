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
import { fetchStockPrice, fetchBondPrice, fetchFxStdDev } from '../hooks/useGas'

const result = await fetchStockPrice('005930')
// → { code, price, date }

const bond = await fetchBondPrice('KR1030023165', '20260529')
// → { isin, price, date }

const stddev = await fetchFxStdDev(12)
// → { period, dataCount, stddev: { USD, EUR, JPY, GBP }, source }
// GAS → ECOS API 경유, 1년치 일별환율 표준편차 연환산(×√252)
// GAS 스크립트 속성에 ECOS_API_KEY 필요
```

---

## 자금정책 훅 (Phase 2 신규)

### usePolicyMeetings
```typescript
import { usePolicyMeetings } from '../hooks/usePolicyMeetings'
const { data, loading, addMeeting, removeMeeting } = usePolicyMeetings()
// data: PolicyMeeting[] (최신순 정렬)
```

### usePolicyDecisions
```typescript
import { usePolicyDecisions } from '../hooks/usePolicyDecisions'
const { data, addDecision, updateDecision, updateStatus, removeDecision } = usePolicyDecisions(meetingId)
// meetingId null이면 data=[]
// updateStatus(id, 'pending'|'in_progress'|'completed')
```

### usePolicyParams
```typescript
import { usePolicyParams } from '../hooks/usePolicyParams'
const params = usePolicyParams(company)  // company: Company | null
params.get('fx_risk_portion')            // → number | null
params.getText('some_key')              // → string | null
await params.set('fx_risk_portion', 0.5, null, userLabel)
// upsert: company + param_key 조합 unique
```

**주요 policy_params 키 (메디아나 FX 기준):**
| key | 설명 | 기본값 |
|---|---|---|
| `fx_risk_portion` | 위험포션 (0~1) | 0.5 |
| `fx_target_min` | Target Band 하한 (%) | 20 |
| `fx_target_max` | Target Band 상한 (%) | 25 |
| `fx_operating_profit` | 사업계획 영업이익 (원) | 4,300,000,000 |
| `fx_interest_income` | 예상 이자수익 (원) | 2,300,000,000 |
| `fx_total_fund` | 전체 자금 총액 (원) | 90,000,000,000 |
| `fx_std_usd` | USD 연간 표준편차 | 0.082458 |
| `fx_std_eur` | EUR 연간 표준편차 | 0.114437 |
| `fx_std_jpy` | JPY 연간 표준편차 | 0.108875 |
| `fx_std_gbp` | GBP 연간 표준편차 | 0.130257 |
| `fx_weight_usd` | USD 보유비율 가중치 | 0.80 |
| `fx_weight_eur` | EUR 보유비율 가중치 | 0.18 |
| `fx_weight_jpy` | JPY 보유비율 가중치 | 0.02 |
| `fx_weight_gbp` | GBP 보유비율 가중치 | 0.00 |
| `fvpl_duration_{investId}` | 국채 FVPL Duration (년) | 수동 입력 |

### usePolicyThreads
```typescript
import { usePolicyThreads } from '../hooks/usePolicyThreads'
const { threadOf, addMemo, removeMemo } = usePolicyThreads(decisionIds)
// issue_key = 'policy_{decisionId}' 로 issue_comments 재활용
threadOf(decisionId)  // → IssueComment[]
await addMemo(decisionId, '내용', userLabel, company)
```

### usePolicyDashboard (2026-06-05 신규)
```typescript
import { usePolicyDashboard } from '../hooks/usePolicyDashboard'
const data = usePolicyDashboard(company)  // company: Company | null
```

**반환값 (PolicyRealData):**

| 속성 | 타입 | 설명 |
|------|------|------|
| `latestDaily` | `DailyRecord \| null` | 운전자금 최신 1건 |
| `operatingCash` | `number` | krw_demand+krw_govt+krw_mmda (외화 제외) |
| `operatingCashWithFx` | `number` | operatingCash + fx_krw |
| `fxKrw` | `number` | 외화 원화환산 합계 |
| `investments` | `InvestmentRecord[]` | 비국채 active 운용자금 |
| `investAvail` | `number` | 가용 운용자금 합계 |
| `investUnavail` | `number` | 불가용 운용자금 합계 |
| `investByBank` | `{bank, amount}[]` | 금융기관별 집계 (내림차순) |
| `bonds` | `InvestmentRecord[]` | 국채 active |
| `bondAvail` | `number` | 가용 국채 평가금액 |
| `loans` | `LoanRecord[]` | active 차입금 |
| `totalLoan` | `number` | 차입금 합계 |
| `loanByBank` | `{bank, amount}[]` | 금융기관별 차입 집계 |
| `totalFundEstimate` | `number` | 총 자금 추정 (운전+운용+국채) |
| `loading` | `boolean` | 로딩 상태 |

**특징**: `useAuth().currentCompany`와 **독립적**으로 동작. 전달된 `company` prop 기준으로 Supabase 직접 조회. PolicyPage에서 3개 법인 동시에 호출 가능.

**새로 추가된 policy_params 키 (유동성·차입금):**
| key | 설명 | 단위 | 편집 위치 |
|---|---|---|---|
| `liquidity_fixed_cost_monthly` | 월 고정비 | 원 | PolicyPage 유동성 카드 |
| `liquidity_min_months` | 최소 보유 기간 | 개월 | PolicyPage 유동성 카드 |
| `liquidity_credit_line` | 비상 차입 라인 | 원 | PolicyPage 유동성 카드 |
| `loan_max_total_ratio` | 차입금 최대 비율 | % | PolicyPage 차입금 카드 |
