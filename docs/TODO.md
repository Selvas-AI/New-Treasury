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

---

## 📄 자금일보 (DailyReportPage) — 신규 개발 (2026-06-09 기획 확정)

> 상세 기획: `docs/pages/DailyReportPage.md`  
> DB DDL: `docs/db/daily_report_tables.sql`  
> 데이터 반영 정책: **C안** (임시 즉시 반영, 승인 시 확정)  
> 결재선: 팀장 1단계 Default, 유연 추가/삭제 가능

- [x] **S1: DB + 라우트 + 페이지 골격** → **2026-06-10 완료**
- [x] **S2: 자금현황 요약 테이블** → **2026-06-10 완료**
- [x] **S3: 입금/출금 라인 아이템 입력** → **2026-06-10 완료**
- [x] **S4: 연동 팝업** → **2026-06-10 완료**
- [x] **S5: 검증 + 결재 워크플로우** → **2026-06-10 완료**
  - ValidationBar, 상신·승인·반려 버튼, 결재선 설정 모달 구현
- [x] **S6: 인쇄 출력** → **2026-06-11 완료**
  - [x] Print CSS (A4 가로, 자금현황 + 내역 + 결재란)
  - [x] `[🖨️ 인쇄]` 버튼 → `window.print()`

---

---

## 🔵 네비게이션 / UX 개선 (2026-06-10 세션7차 이후)

- [x] **Sidebar 5섹션 재편**: DASHBOARD / 자금입력 / 자금일보 / 이력관리 / 관리 → **2026-06-10 완료**
- [x] **일별 자금일보 목록 페이지** (`/daily-report-list`): 법인별·날짜별 작성현황 테이블, 상태 배지(미작성/작성 중/결재 중/승인) → **2026-06-10 완료**
- [x] **조직도 관리 페이지** (`/admin/org-chart`): 법인별 결재선 설정 UI (master 전용), 향후 조직도 시각화 예정 → **2026-06-10 완료**
- [x] **환율 현황 → 환율 이력** 레이블 변경 (Sidebar) → **2026-06-10 완료**
- [ ] **환율 이력 FxPage 기능 확장**: 날짜별 환율 표시 — daily 테이블 연동, 기간별 환율 추이 차트
- [ ] **인증 체계 공휴일 GAS 연동 세팅**: `HOLIDAY_API_KEY` 스크립트 속성 등록 필요 (GAS 에디터)

---

- [ ] **GAS 자동 시세 스케줄러 ON/OFF 토글**: 기존 HTML에서 `localStorage: auto_price_on`으로 관리하던 자동 시세 조회 ON/OFF 기능이 React 버전에 없음. `useStockTicker.ts`는 항상 폴링 활성화 상태.

- [x] **`calcKRW` 함수 중복 정의**: `format.ts`의 `calcKRW` 가 실사용처 없음(grep 확인). 완전 제거. 모든 소비처는 `useFx().toKRW()` 통일 사용 중. → **2026-06-05 완료**

---

## 🔵 자금일보 후속 개선 (2026-06-12 세션8차 이후)

- [x] **로그인 "처리 중..." 무한 행**: supabase-js Web Locks 데드락 → `noopLock` 주입 + `getUser()` 2차 호출 제거 → **2026-06-12 완료**
- [x] **자금일보 재진입 무한 로딩**: `useFx` 메모이즈 + `useRef` latest-value 패턴으로 렌더 루프 차단 → **2026-06-12 완료**
- [x] **CMS 대사 검증 모달 다중 PDF 지원**: 탭 UI + 크로스 PDF 금액 매칭 + 카드 클릭 시 페이지 점프 + 출처 기록 + 상태 localStorage 영속 → **2026-06-12 완료**
- [x] **자금현황 외화 입출금 native 표시**: FX 행 입금/출금 컬럼 원화환산 → 외화 원단위(`fmtFx`) 표시 → **2026-06-12 완료**
- [ ] **CMS 대사 완료 비율 요약**: 모달 상단에 "N/M 항목 대사 완료 (X%)" 프로그레스 바 표시

---

## 🟣 접근성 / 회사 관리 (2026-06-12 세션9차)

- [x] **Sidebar 메뉴 접근성 필터링**: `NavItem.slug` + `hasMenu(slug)` → 권한 없는 메뉴/빈 섹션 숨김 → **완료**
- [x] **PolicyPage 법인 접근 제한**: 단일 법인 계정이 타사 정보 조회하던 문제 → `accessibleCompanies` 필터 → **완료**
- [x] **역할 권한 툴팁**: UsersPage 역할 카드 hover 상세 권한 표시 → **완료**
- [x] **TopBar 주가 티커 오버플로**: 중앙 마퀴 이동, 우측 버튼 항상 표시 → **완료**
- [x] **Sidebar 섹션 상태 영속화**: 유저별 localStorage 저장/복원 → **완료**
- [x] **동적 회사 관리**: `companies` 테이블 + `useCompanies` 훅 + `/admin/companies` 페이지(사용자 관리와 분리), 전 페이지 하드코딩 제거 → **완료**
  - ⚠ Supabase에 `docs/db/companies.sql` 실행 필요 (미실행 시 3법인 폴백)
- [x] **무한 로딩/추가중 hang 수정**: 비동기 핸들러 try/catch/finally 적용 → **완료**
- [x] **회사 추가 hang 근본 원인**: companies RLS 정책이 `auth.users` 참조 → 403 → supabase-js wedge. 정책 단순화(anon+authenticated permissive) + 쓰기를 raw fetch REST 헬퍼(`restInsert/Update/Delete`)로 전환 → **완료**
- [x] **PolicyPage 동적 법인 미반영**: 하드코딩 3사(`COMPANIES`·`COMPANY_TAG`·`usePolicyDashboard`×3) → `useCompanies` + 배열 훅 `usePolicyDashboards`/`usePolicyParamsReadMap`로 전환. 신규 법인(크레도) 탭·요약·상세 탭 모두 반영 → **완료**
- [x] **지분 신규등록 "null value in column id" 오류**: `useEquities.save()` 신규 insert 시 id 미생성 → `generateUUID()` 추가 → **완료**
- [x] **지분 기준일 과거 종가 미조회**: `fetchStockByName`에 `basDt` 추가 + NewEquityForm이 과거 기준일이면 `fetchStockPrice(ticker, 기준일)`로 해당일 종가 조회 → **완료**
- [x] **[CRITICAL] 메뉴이동/로그인 무한로딩 근본 원인**: supabase-js 쓰기가 에러(400 id null·403 RLS)나면 클라이언트 전체가 wedge → 이후 모든 SELECT(loadProfile 포함) 멈춤 → 새로고침 전까지 지속. **모든 데이터 쓰기(useDaily·useLoans·useInvestments·useEquities)를 raw fetch REST 헬퍼로 전환** → 쓰기 에러가 클라이언트를 wedge시키지 않음. SELECT만 supabase-js 유지 → **완료**
- [⚠️ GAS 재배포 필요] **과거 종가 조회가 엉뚱한 주가 반환**: `Code.gs fetchViaPublicData`가 종목 필터로 `stckIscd`(미인식 파라미터) 사용 → data.go.kr이 basDt만 적용해 "그 날짜 첫 종목"을 반환(208370 4/13 종가 4,235원 대신 768원). `likeSrtnCd`로 수정 + `srtnCd` 정확 매칭 + 실시간은 네이버 우선 라우팅. **Code.gs 수정 완료 → GAS 에디터에서 새 버전 재배포 필요**

---

## 📊 통합상황판 시각화 개선 (2026-06-12)

- [x] **가용 지분 별도 집계**: 가용 지분(상장)이 어디에도 집계 안 되던 문제 → `KpiData.equityAvail` 추가(가용자금·순현금 **미포함**). 자금흐름 카드 "참고 — 순현금 미포함" 섹션에 '지분(가용)' 라인 + 자산구성 도넛/범례에 별도 항목 + FlowDetailDrawer 'equity_avail' 상세 → **완료**
- [x] **현금흐름 추이 운용 가용/불가용 2색 스택**: `CashflowChart` 운용자금 막대를 가용(emerald-500)+불가용(emerald-300) 2색 스택으로 분리, 툴팁도 분리 표기 → **완료**
- [x] **현금흐름 범례 클릭 토글**: 정적 범례 → 클릭 버튼(단독 보기), Ctrl/⌘+클릭(다중 선택), 빈 선택 시 전체 표시 복귀, '전체' 리셋 버튼 → **완료**
- [x] **운용 가용/불가용 독립 토글**: 범례를 `운전자금 | 운용(가용) | 운용(불가용) | 차입금` 4개 항목으로 분리 → 운용(불가용)만 Ctrl+클릭으로 제외 가능. 툴팁 '선택 합계'는 표시 중인 시리즈만 합산 → **완료**

---

## 🌐 LAN 접속 + 무한로딩 근본 해결 (2026-06-12)

- [x] **LAN 접속 안 됨 원인분석·조치**: 서버는 0.0.0.0:5175 정상 리스닝, 로컬에서 192.168.22.241:5175 HTTP 200 확인. 원인 = ① 포트 5176 안내(실제 5175) ② 상대방이 다른 망(PC는 이더넷 192.168.22.x + Wi-Fi 172.30.x 동시 연결) ③ 방화벽 Node 규칙이 Domain 프로필 only. 조치: `vite.config.ts strictPort:true`(포트 고정), CLAUDE.md 포트/방화벽 안내 정정. **방화벽 전프로필 허용은 관리자 PS 1회 실행 필요**: `New-NetFirewallRule -DisplayName "Vite Dev 5175" -Direction Inbound -Protocol TCP -LocalPort 5175 -Action Allow -Profile Any`
- [x] **[CRITICAL] 메뉴이동/로그인 무한로딩 전면 근본 해결**: 원인 = supabase-js 쓰기 오류 시 공유 클라이언트 wedge → 이후 모든 SELECT(loadProfile 포함) 영구 멈춤. 조치 2갈래:
  - **Prong 1 (안전망)**: 주요 읽기 훅(useDaily/useLoans/useInvestments/useEquities/useIssues/usePolicyParams·Meetings·Decisions·Threads/useDailyReport·Items)에 `withTimeout(13s)` + try/catch/finally → `loading` 영구 미해제 차단(무한 스피너 제거)
  - **Prong 2 (근본)**: 앱 내 **모든 supabase-js 쓰기를 raw fetch REST 헬퍼로 전환**(useIssues·정책 3훅·daily_report 2훅·팝업 4종·AuthContext treasury_users 동기화·DailyReportPage 중복삭제) → 쓰기 오류가 클라이언트를 wedge시키지 않음. SELECT만 supabase.from() 유지 → **완료**
- [ ] **CMS 잔고 합계 자동 검증**: PDF 추출 금액 합산 vs 자금현황 합계 비교 → 일치 시 "합계 자동 검증 ✅" 표시
- [ ] **자금일보 목록 → 날짜 클릭 바로 열기**: `DailyReportListPage` 날짜 행 클릭 시 해당일 자금일보로 즉시 이동 (현재 동작 검증 필요)

---

## 🎨 다크모드 B안 + UX 개선 (2026-06-15)

- [x] **다크모드 B안 (블루-다크 팔레트) 전면 적용**: `gray-*` → `slate-*` (파란 틴트), body bg `#0f172a`, text `#f1f5f9`. `dark:text-gray-300` → `dark:text-slate-100` (45개 파일 일괄). NotionTable 헤더 `dark:text-sky-300`. EquityHistoryPanel/BondHistoryPanel form dark: 보완 → **완료**
- [x] **Watchdog 오탐 수정**: 8s 무상호작용→무조건 발동 → 15s + DOM 콘텐츠 체크(main 100자+ & 스피너 없음일 때 발동 안 함) → **완료**
- [x] **ESLint CI 에러 10건 수정**: DataPage/UsersPage conditional hooks, PolicyCTab no-unused-expressions, exhaustive-deps 누락 × 4건, eslint.config.js React Compiler 규칙 off → **완료**
- [x] **가용자금 합계 범위 확장**: `availableCash = 운전 + 가용운용 + 가용국채 + 가용지분` (기존 지분 가용분 미합산 수정). KpiCard 부제목·FlowDetailDrawer 팝업 업데이트 → **완료**

---

## 📐 FX 정책 탭 UX 개선 (2026-06-16)

- [x] **한도 A 산출 근거 인라인 표시**: 실효한도 카드 내에 `허용손실 = (영업이익+이자수익) × 위험포션` → `한도A = 허용손실 ÷ 최대변동폭` 2단계 공식 항상 노출. 슬라이더 변경 시 실시간 업데이트 → **2026-06-16 완료**
- [x] **신뢰도 버튼 인터랙티브**: `localConfLevel` 상태 추가 — 클릭 즉시 z값·maxRateChange·한도A·실효한도 재계산(Supabase 저장은 비동기 후행). 3수준(90/95/99%) 비교 미니바 표시 → **2026-06-16 완료**
- [x] **Target Band 입력 제거 (자동계산 전용)**: 파라미터 편집 폼에서 `fx_target_min`/`fx_target_max` 입력 필드 제거. 값은 `🎯 자동설정` 버튼으로만 설정 가능 (거버넌스 유지). bandWidth 클램프 `(2,10)→(1,5)%p → **2026-06-16 완료**
- [x] **통화 비중 입력 즉시 반응**: `localWeights` 상태 추가 — `onChange` 로컬 업데이트, `onBlur` 시 Supabase 저장. 기존 controlled input이 async save 후 값 리셋되는 버그 수정 → **2026-06-16 완료**
- [x] **가용 자금 합계로 totalFund 재정의**: `운전자금 + 가용 운용자금 + 가용 국채 + 가용 지분` (기존 "전체 자금 총액" → 전액 포함이라 과대 산정). `useEquities` 추가 연동. 카드 라벨 변경 → **2026-06-16 완료**
- [x] **운용자금 외화 합산**: FX 외화 계산이 운전자금 외화만 포함하던 문제 → 가용 운용자금 중 외화(`currency != 'KRW'`, `available='가용'`) 도 합산. `investFxNative` 계산 추가. 바 차트 split(운전=진한/운용=연한), 통화별 운전+운용 분리 표시 → **2026-06-16 완료**

### Pending 기능

- [ ] **Dashboard 탭 네비게이션**: TopBar 하단 전체 너비 탭 바 (통합 상황판/자금일보/자금정책). DASHBOARD 카테고리 페이지에만 표시. 상세 설계: `docs/pending/DashboardTabNav.md`

---

## 📊 자금일보 누적 현황/통계 분석 (2026-06-24 기획 확정)

> 원천: `daily_report_items`(15개 카테고리 × direction in/out) + `daily_reports`(report_date, company, status)  
> 결합: `daily`(잔액 추이), `cashflow_plan`(예실 비교), `investments/loans`(연동 건별)  
> 라우트 예정: `/cashflow-analytics/:company?`  
> 상세 기획: `docs/pages/CashflowAnalyticsPage.md` (작성 예정)

### P1 — 핵심 집계 뷰 (자금일보 데이터 최소 2개월 누적 후 의미있음)

- [ ] **`useCashflowAnalytics` 훅 신규**: 법인 + 기간 + 상태(approved/all) 파라미터 → `daily_report_items JOIN daily_reports` GROUP BY 집계. 반환: `byCategory`, `byPeriod`, `totals`(총입금/총출금/순유입). Supabase `.gte/.lte(report_date)` 필터.
- [ ] **기간별 현황 탭**: KPI 4개(총입금/총출금/순유입/기말잔액) + 월별 Recharts 막대+꺾은선 복합 차트(입금=green, 출금=red, 순유입=blue 꺾은선). 기간 선택 1M/3M/6M/YTD/1Y/직접 선택. 승인 완료만/전체 토글.
- [ ] **카테고리별 분석 탭**: 입금 항목별 + 출금 항목별 가로 비율 바 차트(각 카테고리 금액·비율). 카테고리 클릭 → 해당 카테고리의 기간별 추이 꺾은선 드릴다운. CF 성격 배지: 영업활동(blue)/투자활동(green)/재무활동(purple)/평가손익(amber).

### P2 — 심화 분석

- [ ] **현금흐름표 탭 (직접법)**: 카테고리 → 영업/투자/재무 CF 섹션 매핑. 당월/전월/YTD 3열 비교 테이블. 순 현금흐름 합계행. CF 섹션 매핑:
  - 영업: ar_collection, other_receivable, govt_fund, advance_in/out, ap_payment, trade_ap_payment, interest_income, interest_expense, enote_payment, other_in/out
  - 투자: invest_return, invest_execute
  - 재무: loan_drawdown, loan_repayment
- [ ] **예실 비교 탭**: `cashflow_plan`(주별 예측 유입/유출) × `daily_report_items` 실적 집계 JOIN → 주별 달성률 테이블. 달성률 75% 미만 ⚠ 경고 강조.
- [ ] **3사 법인 비교 뷰**: 동일 카테고리+기간을 3사 병렬 비교 (CEO 보고용). 법인 선택 멀티체크 또는 "전체 법인" 모드.

### P3 — 부가 기능

- [ ] **이상값 감지**: 최근 3개월 이동평균 대비 ±30% 초과 카테고리 자동 표시 → 대시보드 이슈 배지 연동 검토.
- [ ] **CSV 내보내기**: 선택 기간 × 카테고리 필터 적용 후 CSV 다운로드. 승인 완료 건만/전체 선택 옵션. SheetJS(xlsx) 활용.
- [ ] **Sidebar 메뉴 추가**: 자금일보 섹션에 "📊 현황 분석" 항목 추가. slug: `cashflow-analytics`, 접근 권한: viewer 이상.

---

## 🏦 금리 네고/비딩 이력 (2026-06-24 구현 완료)

- [x] **`rate_nego_logs` 테이블**: `docs/db/rate_nego_logs.sql` DDL 작성. company/record_type/record_id/nego_type/outcome/offered_rate/contact_person/notes 컬럼. RLS permissive. → **2026-06-24 완료**
  - ⚠ Supabase SQL Editor 실행 필요 (미실행 시 네고 이력 저장 불가)
- [x] **`useNegoLogs` 훅**: 법인+레코드유형 수준 전체 fetch, `byRecord: Map<string, NegoLog[]>` O(1) 조회. add/update/remove CRUD. → **2026-06-24 완료**
- [x] **`NegoLogPanel` 컴포넌트**: 아코디언 인라인 패널. 타임라인 이력 표시, 비딩 비교 카드(≥2건 offered_rate 시), 인라인 추가/편집 폼. 결과 배지(진행중/채택/미채택/보류), 유형 배지(비딩/금리네고/재예치협의/상환협의/기타). → **2026-06-24 완료**
- [x] **InvestPage 연동**: 운용자금 PC 테이블 + 모바일 카드에 React.Fragment 아코디언 추가. 네고 건수 배지, colSpan=10 확장 행. → **2026-06-24 완료**
- [x] **LoansPage 연동**: 차입금 PC 테이블 + 모바일 카드 동일 패턴. colSpan=9. → **2026-06-24 완료**

---

## 💱 FX 신뢰도 의결 UX (2026-06-24 구현 완료)

- [x] **의결 기준 고정 + 시뮬레이션 분리**: `fx_confidence_level_decided`/`fx_conf_decided_date`/`fx_conf_decided_meeting` 3개 `policy_params` 키 추가(DB 마이그레이션 불필요 — key-value upsert). → **2026-06-24 완료**
- [x] **미의결 배지**: `decidedLevel === null` → `⬜ 미의결 — 정책회의 의결 필요` 회색 배지 표시. → **2026-06-24 완료**
- [x] **의결 확정 UI (master)**: "🔒 현재 선택(N%)을 의결 기준으로 확정" 버튼 → 회의명 입력 폼 → 저장 시 `fx_confidence_level`(실제 계산 기준)도 동시 업데이트. → **2026-06-24 완료**
- [x] **시뮬레이션 모드 배너**: 의결 기준과 다른 신뢰도 선택 시 amber "🧪 시뮬레이션 중 (의결: N%, 시뮬: M%, Δ +X%p)" 배너 표시. → **2026-06-24 완료**
