# Selvas Treasury — 기능 구현 TODO

> 분석 기준: SELVAS_TREASURY_CONTEXT.md vs 실제 src/ 구현 (2026-06-04 최종)
> UI/UX 관련 항목 제외. 데이터·로직·기능 누락만 포함.

---

## 🔴 미구현 핵심 기능 (High Priority)

- [x] **외화 잔고 원화 환산 자동 계산 (InputPage)**: `calcFxKrw` useMemo + `fx.toKRW()` 조합으로 이미 구현됨. 저장 시 `fx_krw: calcFxKrw` 자동 반영. → **확인 완료 (2026-06-05)**

- [x] **운용자금 자동 시세 갱신 (EquityPage)**: `EquityPage` 헤더에 "전체 시세 갱신" / "전체 기준가 갱신" 버튼 추가. `bulkRefreshStocks()` — 상장 종목 전체 순차 `fetchStockPrice` → `eq.save()`. `bulkRefreshBonds()` — 국채 전체 순차 `fetchBondPrice` → `inv.save()`. 진행 카운터 (N/M), 실패 종목 오류 메시지 표시. → **2026-06-05 완료**

- [ ] **영업일 공휴일 데이터 다년도 부재**: `src/lib/format.ts`의 `isBusinessDay()`가 2026년 공휴일만 하드코딩(`KR_HOLIDAYS_2026`). 이슈 감지(`useDashboard.ts`)와 운전자금 미입력 알림이 2026년 이후 또는 2025년 이전 날짜에는 오작동함.

- [x] **채권 기준가 GAS 조회 연동 (BondHistoryPanel)**: ~~`BondHistoryPanel.tsx`에서 날짜 선택 후 GAS `getBondPrice?isin=...&basDt=...` 호출 → 기준가 자동 입력 기능이 미구현.~~ → **2026-06-04 완료**: 조회 버튼 연동, 타임아웃 30s, T+1 안내 표시

---

## 🟡 불완전한 기능 / 보완 필요 (Medium Priority)

- [x] **HistoryPage 운용자금 날짜별 계산 부정확**: 채권은 `priceDate || start`, 비채권은 `start || priceDate` 우선순위로 수정. `fromDb` 매퍼가 `start_date→start` 변환을 이미 처리하므로 legacy 필드 누락 문제 해소. → **2026-06-05 완료**

- [x] **이슈 openCount 중복 카운팅**: `issue_key`별 최신 상태 기준 집계로 수정. Map으로 key별 상태 덮어쓰기 후 `'done'` 아닌 키 수 카운트. → **2026-06-05 완료**

- [x] **차입금 만기 이슈 감지 범위**: `dday < 0`은 `<= 90` 조건에 이미 포함됨. 음수 시 `D--30` 출력 버그 → `만기경과 D+N` 형식으로 수정. → **2026-06-05 완료**

- [x] **운전자금 미입력 이슈 — 법인 전환 시 즉시 초기화 누락**: `useDaily`·`useLoans`·`useInvestments`·`useEquities`·`useIssues` 5개 훅의 fetch 시작 시 `setData([])` 추가. company 변경 → 즉시 data 초기화 → `db.loading=true` → 대시보드 로딩 스피너 표시, 이전 법인 이슈 미표시. → **2026-06-05 완료**

- [x] **FxPage 환율 자동 로드**: 마운트 시 1회 + `window.setInterval` 5분 폴링 추가. cancelled 플래그로 언마운트 시 정리. → **2026-06-05 완료**

- [x] **취득가액 일괄반영 모달 자동 표시**: `EquityHistoryPanel:96-100`, `BondHistoryPanel:101-106`에 이미 구현됨. `acquisition_cost > 0 && !editId` 조건 시 `confirm()` 다이얼로그 → `onBulkAcq` 호출. → **확인 완료 (2026-06-05)**

- [x] **price_history 테이블 미활용**: 검토 결과 현 아키텍처에서 불필요 — `equities`(날짜별 시세 row 누적) + `investments`(priceDate별 국채 row)가 동일 역할 수행. supabase_schema.md 미등재로 현 Supabase에 미생성 상태. 이중 쓰기는 유지보수 부담만 증가. → **구현 불필요 확정 (2026-06-05)**

---

## 🟢 미구현 부가 기능 (Low Priority)

- [x] **관리 페이지 (AdminPage)**: 3개 페이지 모두 완전 구현 + Sidebar 연결 확인. `MyCodePage` (코드 변경·재로그인 유도), `UsersPage` (access_codes CRUD + 활성/비활성), `DataPage` (테이블 레코드 현황 + 날짜 이전 일괄 삭제). → **확인 완료 (2026-06-05)**

- [x] **자금정책 관리 페이지 (Phase 2 B안)**: → **2026-06-05 완료**
  - `policy_meetings`, `policy_decisions`, `policy_params` 테이블 생성
  - `PolicyPage.tsx` — 의결사항 + 후속조치 스레드
  - `FxPage` — FX 정책관리 탭 구현 (후에 PolicyPage로 이관)
  - `InvestPage` — FVPL 리스크 탭 구현 (후에 PolicyPage로 이관)

- [x] **자금정책 페이지 통합 (Phase 2 Step 3)**: → **2026-06-05 완료**
  - `usePolicyDashboard.ts` — auth 독립적 법인별 실데이터 훅 신규
  - `PolicyPage.tsx` — 3탭 구조(회의·의결/FX정책/FVPL리스크), 실데이터 연동, 3사 현황 요약
  - `src/components/policy/FxPolicyTab.tsx` — FxPage에서 이관
  - `src/components/policy/FvplRiskTab.tsx` — InvestPage에서 이관
  - `FxPage.tsx` — 환율 현황 단순화 (정책탭 제거)
  - `InvestPage.tsx` — 운용자금 단순화 (FVPL탭 제거)
  - 신규 `policy_params` 키: `liquidity_fixed_cost_monthly`, `liquidity_min_months`, `liquidity_credit_line`, `loan_max_total_ratio`

- [x] **자금정책 C안 확장**: `PolicyCTab.tsx` — 서브탭 2개. ① 만기 래더링(향후 13개월 운용자금+차입금 BarChart, 40% 집중 만기 경고) ② 상품 적정성 체크리스트 12항목(신용/안전성·유동성·수익성·한도·승인). PolicyPage "📊 C안" 6번째 탭 추가. → **2026-06-05 완료**
- [x] **거래 금융기관 한도 테이블**: `policy_bank_limits` DDL 작성(supabase_policy_tables.sql), `usePolicyBankLimits` 훅, `BankLimitsTab.tsx` 컴포넌트, PolicyPage "🏦 기관한도" 4번째 탭 추가. 규정 §9 기본 30%, master 커스텀 설정, 초과/주의 상태 표시. → **2026-06-05 완료**
- [x] **12주 롤링 포캐스트**: `cashflow_plan` DDL, `useCashflowPlan` 훅, `CashflowForecastTab.tsx`, PolicyPage "📅 주간예측" 5번째 탭. 기초잔고(현재 운전자금)→주별 유입/유출 입력→기말잔고 누적, 12주 합계, 잔고 마이너스 시 적색 경고. → **2026-06-05 완료**

- [ ] **GAS 자동 시세 스케줄러 ON/OFF 토글**: 기존 HTML에서 `localStorage: auto_price_on`으로 관리하던 자동 시세 조회 ON/OFF 기능이 React 버전에 없음. `useStockTicker.ts`는 항상 폴링 활성화 상태.

- [x] **`calcKRW` 함수 중복 정의**: `format.ts`의 `calcKRW` 가 실사용처 없음(grep 확인). 완전 제거. 모든 소비처는 `useFx().toKRW()` 통일 사용 중. → **2026-06-05 완료**
