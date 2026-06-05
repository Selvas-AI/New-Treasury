# PolicyPage (자금정책 관리)

**파일**: `src/pages/PolicyPage.tsx`  
**라우트**: `/policy`  
**최종 업데이트**: 2026-06-05 (Phase 2 Step 3 완료)  
**권한**: master 전체 편집 / ceo·company 조회 + 메모 작성

---

## 개요

자금운용관리규정에 따른 **통합 정책 관리 허브**. 3개 법인의 실데이터와 정책 파라미터를 함께 표시하여 "의결 → 실행 → 모니터링" 흐름을 단일 페이지에서 지원한다.

---

## 정책 유형 탭 (상단 3개)

| 탭 | 설명 | 주요 컴포넌트 |
|----|------|------------|
| 📋 회의·의결 | 정책현황 4카드 + 회의/의결사항 목록 | 인라인 (PolicyPage 내부) |
| 💱 FX 정책 | FX Target Band, 변동폭 계산, 적정한도 | `FxPolicyTab` |
| 📈 FVPL 리스크 | 국채 Duration 입력 + 금리 시나리오 | `FvplRiskTab` |

> FX 정책·FVPL 탭은 **특정 법인 선택 필수**. "전체" 선택 시 안내 메시지 표시.

---

## 법인 탭 (공통)

`전체 | 셀바스에이아이(N) | 셀바스헬스케어(N) | 메디아나(N)`

- 법인 탭 전환 시 FX/FVPL 탭에서는 `setCurrentCompany()` 동시 호출 → 내부 훅 데이터 동기화
- 의결사항 목록: 선택 법인의 안건만 표시 (`policy_decisions.company` 필터)

---

## 데이터 소스

### 회의·의결 탭
| 테이블 | 훅 | 용도 |
|--------|-----|------|
| `policy_meetings` | `usePolicyMeetings` | 회의 목록 (필터 없음, 전체) |
| `policy_decisions` | `usePolicyDecisions(meetingId)` | 의결사항 (meeting_id 필터) |
| `issue_comments` | `usePolicyThreads(decisionIds)` | 후속조치 스레드 |

### 정책 현황 패널 (회의·의결 탭의 상단 4카드)
| 데이터 | 훅 | 용도 |
|--------|-----|------|
| `daily` 최신 1건 | `usePolicyDashboard(company)` | 운전자금 현황 |
| `investments` (active) | `usePolicyDashboard(company)` | 운용자금 현황 |
| `loans` (active) | `usePolicyDashboard(company)` | 차입금 현황 |
| `policy_params` | `usePolicyParams(company)` | 정책 파라미터 |

> `usePolicyDashboard`는 3개 법인 모두 unconditional로 로딩 (컴포넌트 마운트 시 9개 쿼리)

---

## 정책 현황 패널 (회의·의결 탭, 법인 선택 시)

4개 카드를 `sm:grid-cols-2 lg:grid-cols-4` 그리드로 표시.

### 💧 유동성 버킷
- **현재**: `daily.krw_demand + krw_govt + krw_mmda` (외화 제외 원화 현금성)
- **목표**: `policy_params.liquidity_fixed_cost_monthly × liquidity_min_months`
- **상태**: ok / warn(80% 미만) / over(기준 미달) / na(파라미터 미설정)
- **master 편집**: 월 고정비(억원), 최소 보유 개월, 비상 차입 라인

### 💱 외화 비중
- **현재**: `daily.fx_krw / (krw_demand+krw_govt+krw_mmda+fx_krw) × 100`
- **목표**: `policy_params.fx_target_min ~ fx_target_max`
- **편집**: FxPolicyTab(💱 FX 정책 탭)에서 수행

### 🏦 차입금
- **현재**: `loans.amount` 합계 / 총자금 × 100
- **목표**: `policy_params.loan_max_total_ratio`
- **master 편집**: 인라인 모달

### 📊 운용자금 집중도
- **규정**: 규정 §9 — 기관별 30% 이내
- **현재**: 금융기관별 예치 비율 프로그레스 바
- **상태**: over(30% 초과) / warn(27% 초과) / ok / na

### 전체 탭 — 3사 현황 요약 테이블
| 항목 | 셀바스에이아이 | 셀바스헬스케어 | 메디아나 |
|------|---|---|---|
| 💧 운전자금(원화) | 실데이터 + ✓/✕ | | |
| 💱 외화 비중 | 실데이터 + Band ✓/✕ | | |
| 📊 운용자금(가용) | 실데이터 | | |
| 🏦 차입금 | 실데이터 + 한도 ✓/✕ | | |

---

## 의결사항 카드 (회의·의결 탭)

```
[법인배지] [상태배지] [D-day]
안건명
결정내용 (회색 박스)

📊 관련 정책 지표 (키워드 매칭 자동 표시)
  FX 관련 안건    → Target Band + 현재 외화비중
  유동성 관련     → 최소 유동성 한도 + 현재 현금성
  FVPL/채권 관련  → 국채 보유액 + 건수
  차입 관련       → 총 차입금 + 차입 한도

담당: OOO  기한: YYYY-MM-DD
[💬 후속조치 (N)] ▼
  → 스레드 목록 + 메모 입력
```

**키워드 매칭 패턴**:
- FX: `/fx|외화|환율|헤지|헷지|band/i`
- 유동성: `/유동성|현금|버킷|cash/i`
- FVPL: `/fvpl|채권|duration|금리/i`
- 차입: `/차입|대출|loan/i`

---

## 상태 체계

### DecisionStatus
| 값 | 표시 | 색상 |
|---|---|---|
| `pending` | 대기 | gray |
| `in_progress` | 진행중 | blue |
| `completed` | 완료 | green |

### 카드 상태 배지
| 상태 | 배지 | 의미 |
|------|------|------|
| `ok` | ✓ 정상 | 정책 충족 |
| `warn` | ⚠ 경고 | 임박 / 경계 |
| `over` | ✕ 초과 | 정책 이탈 |
| `na` | 미설정 | 파라미터 없음 |

---

## 신규 policy_params 키 (2026-06-05 추가)

| 키 | 설명 | 단위 | 편집 위치 |
|----|------|------|----------|
| `liquidity_fixed_cost_monthly` | 월 고정비 | 원 | 유동성 버킷 카드 |
| `liquidity_min_months` | 최소 보유 기간 | 개월 | 유동성 버킷 카드 |
| `liquidity_credit_line` | 비상 차입 라인 | 원 | 유동성 버킷 카드 |
| `loan_max_total_ratio` | 차입금 최대 비율 | % | 차입금 카드 |

기존 FX 파라미터 (`fx_target_min/max`, `fx_risk_portion`, `fx_std_*`, `fx_weight_*`, `fx_operating_profit`, `fx_interest_income`, `fx_total_fund`) 및 FVPL 파라미터 (`fvpl_duration_{id}`) 는 각 탭에서 편집.

---

## 컴포넌트 구조

```
PolicyPage
├── FxPolicyTab          ← src/components/policy/FxPolicyTab.tsx
│   (usePolicyParams + useDaily + useFx 내부 사용)
├── FvplRiskTab          ← src/components/policy/FvplRiskTab.tsx
│   (props: bonds, params, isMaster, userLabel)
└── 인라인 컴포넌트들
    ├── LiquidityCard
    ├── FxStatusCard
    ├── LoanStatusCard
    ├── InvestConcentrationCard
    ├── AllCompanySummary
    └── DecisionPolicyPanel
```

---

## 변경 포인트

- **새 정책 유형 탭 추가**: `PolicyTab` 타입에 `'decisions' | 'fx' | 'fvpl'` 항목 추가
- **FxPolicyTab 사용 법인 변경**: `companyTab as Company` 전달, 탭 전환 시 `setCurrentCompany` 호출
- **유동성 한도 파라미터 추가**: `policy_params` 테이블에 신규 키 3개 추가
- **차입한도 파라미터 추가**: `loan_max_total_ratio` 키 추가

---

## 관련 문서

- `docs/supabase_policy_tables.sql` — 테이블 생성 SQL
- `docs/hooks/README.md` — usePolicyMeetings / usePolicyDecisions / usePolicyThreads / usePolicyDashboard / usePolicyParams
- `src/components/policy/FxPolicyTab.tsx` — FX 정책 탭 (FxPage에서 이관)
- `src/components/policy/FvplRiskTab.tsx` — FVPL 리스크 탭 (InvestPage에서 이관)
