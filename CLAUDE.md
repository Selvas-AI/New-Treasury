# CLAUDE.md — Selvas Treasury (New-Treasury)
> 신규 세션 시작 시 이 파일을 먼저 읽어 컨텍스트를 복원하세요.
> 최종 업데이트: 2026-06-05 (세션3차 — 버그수정 + 기능고도화)

---

## 1. 프로젝트 한 줄 요약

셀바스에이아이 · 셀바스헬스케어 · 메디아나 3개 법인의 **통합 자금 모니터링 시스템** (React + Supabase 기반, 기존 HTML ~10,900줄 → React 마이그레이션 진행 중).

---

## 2. 개발 환경

| 항목 | 값 |
|------|-----|
| OS | Windows 11 / PowerShell |
| 작업 경로 | `D:\workspace\claude\New-Treasury` |
| Node.js | v24.15.0 |
| 패키지 매니저 | pnpm v11.4.0 |
| Dev 서버 | `pnpm dev` → `http://localhost:5175/New-Treasury` |
| 빌드 | `pnpm build` |
| Preview 도구 서버 이름 | `vite-dev` (`.claude/launch.json` 참조) |

---

## 3. 기술 스택

```
React 19.2.6 + TypeScript + Vite 8
Tailwind CSS v4       (@tailwindcss/vite 플러그인, NOT postcss)
Recharts              (차트)
react-router-dom v7   (BrowserRouter, basename="/New-Treasury")
@supabase/supabase-js
@tanstack/react-table (테이블 헤드리스 UI — NotionTable 내부 사용)
zustand               (설치됨, 아직 미사용)
@tabler/icons-react   (설치됨, 현재 이모지 사용 중)
```

> **`vite.config.ts`에 `resolve.dedupe: ['react','react-dom']` 필수** — pnpm 환경에서
> `@tanstack/react-table` 등 외부 라이브러리가 React를 중복 로딩하면 "Invalid hook call" 런타임 에러 발생.

---

## 4. 인증 체계

- Supabase `access_codes` 테이블에서 접근 코드 조회
- 로그인 후 `sessionStorage['treasury_user']`에 TreasuryUser 저장
- 권한: `master` (전체 편집) | `ceo` (전체 열람만) | `company` (자사만)
- `useAuth()` 훅으로 전역 접근

---

## 5. 핵심 파일 구조

```
src/
├── components/
│   ├── Layout.tsx          ← Sidebar + TopBar + Outlet
│   ├── Sidebar.tsx         ← 접기/이슈배지/환율팝업/얇은스크롤바
│   ├── TopBar.tsx          ← 법인선택 + 주가티커 + 반응형 아이콘버튼
│   └── common/
│       └── NotionTable.tsx ← 공통 노션형 테이블 (컬럼 토글·정렬·Supabase 저장)
├── components/dashboard/
│   ├── KpiCard.tsx         ← onClick prop으로 팝업 연결
│   ├── WaterfallCard.tsx   ← FlowItemKey: operating/invest/fx/loan/net/unavailable/available/asset
│   ├── AssetCompositionCard.tsx ← 도넛차트 + onItemClick 팝업 연결
│   ├── FlowDetailDrawer.tsx ← 자금흐름 항목 클릭 상세 팝업 (8개 키 지원)
│   ├── IssueDrawer.tsx     ← 이슈 목록 팝업 (중앙 배치)
│   ├── CashflowChart.tsx   ← 7/14/30/90일 주기, 디폴트 7일
│   └── EquityCard.tsx      ← 7/14/30/90일 주기, 디폴트 7일
├── components/equity/
│   ├── EquityHistoryPanel.tsx
│   ├── BondHistoryPanel.tsx ← 조회버튼 툴팁(T+1) + 로딩표시 개선
│   ├── NewEquityForm.tsx   ← 종목명 onBlur → GAS 이름검색 → 티커/시장/주가 자동입력 + 후보드롭다운
│   └── NewBondForm.tsx     ← 채권명 onBlur → GAS 이름검색 → ISIN/기준가 자동입력 + 후보드롭다운
├── components/policy/              ← 자금정책 관리 전용 컴포넌트
│   ├── FxPolicyTab.tsx     ← FX Target Band / 변동폭계산 / 적정한도 (실데이터 연동, 0~100% 게이지)
│   ├── FvplRiskTab.tsx     ← 국채 Duration + 금리시나리오 (변동성 리스크)
│   ├── BankLimitsTab.tsx   ← 거래 금융기관 마스터 + 기관별 한도·비중 관리
│   ├── CashflowForecastTab.tsx ← 12주 롤링 포캐스트 (주별 유입/유출 계획)
│   └── PolicyCTab.tsx      ← 만기래더링 차트 + 상품적정성 체크리스트
├── hooks/
│   ├── useAuth.ts
│   ├── useDaily.ts
│   ├── useLoans.ts
│   ├── useInvestments.ts
│   ├── useEquities.ts
│   ├── useIssues.ts
│   ├── useFx.ts            ← GAS 환율 (Sidebar에서 자동 로드)
│   ├── useDashboard.ts     ← 대시보드 집계 훅
│   ├── useGas.ts           ← GAS fetch 헬퍼 (timeout 30s, 타임아웃 시 1회 재시도)
│   ├── useStockTicker.ts   ← 3개 법인 주가 5분 폴링 (TopBar 티커)
│   ├── useTableSettings.ts ← NotionTable 뷰 설정 Supabase read/upsert
│   ├── useDashboardLayout.ts ← DnD 레이아웃 훅 (현재 미사용)
│   ├── usePolicyMeetings.ts  ← 정책회의 CRUD
│   ├── usePolicyDecisions.ts ← 의결사항 CRUD + 상태변경
│   ├── usePolicyParams.ts    ← 정책 파라미터 get/upsert (company별)
│   ├── usePolicyThreads.ts   ← 후속조치 스레드 (issue_comments 재활용)
│   ├── usePolicyDashboard.ts ← 법인별 실데이터 직접 패치 (auth 독립)
│   ├── usePolicyBankLimits.ts ← 거래 금융기관 마스터 CRUD
│   └── useCashflowPlan.ts    ← 12주 롤링 포캐스트 upsert
├── pages/
│   ├── DashboardPage.tsx   ← 통합 상황판 (단일 컬럼, 팝업 기반 상세)
│   ├── EquityPage.tsx      ← 지분/장기투자 (각 탭 신규등록 폼 포함)
│   ├── FxPage.tsx          ← 환율 현황만 (FX 정책탭 → PolicyPage 이관)
│   ├── InvestPage.tsx      ← 운용자금 (FVPL 탭 → PolicyPage 이관)
│   ├── PolicyPage.tsx      ← 자금정책 통합 허브 (3탭: 회의·의결/FX/FVPL) ★대폭 확장
│   └── ...
└── types/index.ts
```

> **`Code.gs`** (프로젝트 루트): GAS Web App 스크립트. 주가·채권·환율·이름검색 라우팅 포함.
> 수정 후 **반드시 GAS 에디터에서 새 버전으로 재배포** 필요.

---

## 6. 환경변수 (.env.local — gitignore 대상, 직접 생성 필요)

```env
VITE_SUPABASE_URL=https://qobfmihxcclbzfaohnor.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_GAS_API_URL=https://script.google.com/macros/s/AKfycbwZ.../exec
```

---

## 7. 세션별 완료 작업 이력

### 2026-06-01 세션

#### Task 1: 지분/장기투자 신규 종목 등록 폼
- `NewEquityForm.tsx` — KOSPI/KOSDAQ/비상장 신규 종목 등록
- `NewBondForm.tsx` — 국채/채권 신규 등록 (ISIN + 기준가 조회)
- `EquityPage.tsx` — 각 탭 상단에 신규 등록 버튼 연결

#### Task 2: 통합 상황판 레이아웃 재설계 (8fr+3fr 2컬럼)
- DnD(`react-grid-layout`) 도입 시도 → **롤백** (필요시 재도입 검토)

#### Task 3: GAS/시세 연동 기반 구현
- `useGas.ts` — timeout(8s) + HTML응답 감지 + abort 처리
- `useStockTicker.ts` — 5분 폴링, GAS 실패시 `price:0` mock 유지
- `TopBar.tsx` — 주가 티커 영역 추가 (GAS 미연결시 스켈레톤)
- `Sidebar.tsx` — 하단 실시간 환율 섹션 추가 (자동 로드)

---

### 2026-06-04 세션 (Updateplan_260604 기반 대시보드 재설계)

#### Task 1: KPI 카드 전체 너비 이동
- KPI 3개 카드를 `8fr` 좌측 그리드 내부 → **전체 너비(full-width)** 로 이동
- 불가용 자산 카드 우측이 페이지 끝에 닿도록 구현
- `DashboardPage.tsx` 수정

#### Task 2: 이슈 전광판 ticker (헤더 인라인 A안)
- 헤더에 이슈 ticker 추가: TREASURY Dashboard ↔ 날짜/새로고침 사이
- 우→좌 CSS 애니메이션 (`issue-scroll` @keyframes, `src/index.css`)
- ticker 클릭 시 `IssueDrawer` 팝업 열기
- 이슈 없으면 빈 `flex-1` div로 날짜 오른쪽 정렬 유지

#### Task 3: WaterfallCard / AssetCompositionCard 분리
- 기존 `WaterfallCard` (자금흐름 + 도넛 차트 통합) → 두 카드로 분리
  - `WaterfallCard.tsx`: 자금흐름 바 차트 (클릭 핸들러 추가)
  - `AssetCompositionCard.tsx`: 도넛 차트 + 범례 + 원화/외화 비율 (신규)
- 레이아웃: `sm:grid-cols-[3fr_1fr]` 나란히 배치

#### Task 4: FlowDetailDrawer — 자금흐름 항목 클릭 상세 팝업
- `FlowDetailDrawer.tsx` (신규): 자금흐름 항목 클릭 시 플로팅 패널 표시
- 항목별 상세: 운전자금·운용자금·차입금·외화·순현금·불가용
- 불가용 상세: 지분(비상장·매각제한) 종목별 + 운용/국채 불가용 개별 목록 + 수익률
- 기존 우측 패널 상세 카드(운전/운용/차입) → 팝업으로 전환

#### Task 5: IssueDrawer — 이슈 목록 팝업
- `IssueDrawer.tsx` (신규): 이슈 확인 팝업 패널
- 헤더 ticker 클릭 → `IssueDrawer` 열기
- 이슈 상태 변경(미조치/검토중/완료), 바로가기 링크, 전체 이력 이동 지원
- 기존 우측 패널 `IssueCard` 고정 카드 제거

#### Task 6: 레이아웃 단순화
- 기존 `lg:grid-cols-[8fr_3fr]` 2컬럼 그리드 → **단일 컬럼** 구조로 변경
- 우측 패널(이슈확인·운전자금·운용자금·차입금 상세) 완전 제거
- 상세 정보는 모두 팝업 드로어로 전환

---

### 2026-06-04 세션 2차 (UI 개선)

#### Task 1: 대시보드 KPI·자산구성 카드 클릭 팝업 연결
- `FlowItemKey`에 `'available'`(가용자금 합계), `'asset'`(자산구성) 추가 (`WaterfallCard.tsx`)
- `KpiCard.tsx` — `onClick` prop 추가, 클릭 시 `cursor-pointer` + `hover:shadow-md`
- 가용자금 합계 → `AvailableDetail` (운전자금 세부 + 가용운용목록)
- 순현금 포지션 → `NetDetail` (기존)
- 불가용 자산 → `UnavailableDetail` (기존)
- `AssetCompositionCard.tsx` — `onItemClick` prop 추가, 카드 클릭 → `'asset'` 키 전달
- `AssetDetail` 컴포넌트 — 구성비율%, 원화/외화 금액 상세
- 팝업 위치: 모두 **화면 정중앙** (`fixed left-1/2 top-1/2 -translate-x/y-1/2`)
- IssueDrawer도 동일 중앙 배치로 통일

#### Task 2: 팝업 깜빡임(flash) 수정
- 기존 `fadeInScale` keyframe이 `translate(-50%, -50%)` 포함 → Tailwind transform CSS 변수와 충돌해 초기 위치 불일치 flash 발생
- **수정**: keyframe을 `opacity + scale` 만으로 변경, `translate` 제거
  ```css
  @keyframes fadeInScale {
    from { opacity: 0; scale: 0.95; }
    to   { opacity: 1; scale: 1;    }
  }
  ```
- `style={{ animation: 'fadeInScale 0.18s ease-out both' }}` + Tailwind translate 조합으로 깜빡임 없음

#### Task 3: 지분/장기투자 그래프 주기 변경
- `EquityCard.tsx`: 14일/30일/90일 → **7일/14일/30일/90일**, 디폴트 `7`일
- `CashflowChart.tsx`: 7일/30일/90일/1년 → **7일/14일/30일/90일**, 디폴트 유지(`7`)

#### Task 4: EquityPage 신규등록 버튼 추가
- 지분 탭: `NewEquityForm` (KOSPI/KOSDAQ 자동) 상단 배치
- 국채/채권 탭: `NewBondForm` 상단 배치
- 비상장/기타 탭: `NewEquityForm fixedMarket="비상장"` 상단 배치
- `NewEquityForm` / `NewBondForm`은 자체 토글 버튼+인라인 폼 내장 컴포넌트

#### Task 5: Sidebar 반응형 개선
- **사이드바 접힌 상태 이슈 배지**: `absolute -top-1.5 -right-1.5` 아이콘 우상단 오버레이 배치
  - aside에 `overflow: collapsed ? 'visible' : 'hidden'` 조건부 적용
- **접힌 상태 환율 팝업**: 💱 버튼 클릭 시 `fxPopupOpen` 상태 → 사이드바 우측으로 `slideInLeft` 애니메이션 팝업
  - 외부 클릭 감지(`mousedown` 이벤트) 자동 닫기
- **스크롤바 개선**: nav에 `.sidebar-scroll` 클래스 + CSS 3px 얇은 스크롤바 (`#374151` 색상)
  ```css
  .sidebar-scroll::-webkit-scrollbar { width: 3px; }
  .sidebar-scroll::-webkit-scrollbar-thumb { background: #374151; border-radius: 999px; }
  ```

#### Task 6: TopBar 반응형 개선
- 소형 화면에서 기능 버튼 잘림 → **아이콘+툴팁** 형태로 전환
- `IconBtn` 컴포넌트 신규: `icon`, `label`, `onClick` 받아 아이콘 표시 + `group-hover` 툴팁 표시
- **breakpoint 전략**:
  - `xl` 이상: 주가 티커 풀텍스트, 환율/테마/코드관리 텍스트 버튼
  - `lg` 이상: 날짜·갱신시각 텍스트, 라이트/다크 토글 pill
  - `sm~lg`: 모든 버튼 아이콘(`💱` `☀️/🌙` `⚙` `⎋`) + hover 툴팁
  - 주가 `▲▼` 화살표만 표시 (title 툴팁에 상세 수치)

---

### 2026-06-04 세션 3차 (GAS 연동 + 검색 개선)

#### Task 1: 종목명/채권명으로 GAS 검색 연동
- **`useGas.ts`** — `fetchStockByName(name)`, `fetchBondByName(bondName)` 신규 추가
  - `?name=종목명` → KRX finder → 주가 조회 → `{ticker, name, market, price, date, candidates[]}`
  - `?type=bond&bondName=채권명` → KRX finder → 기준가 조회 → `{isinCd, name, price, date, candidates[]}`
- **`NewEquityForm.tsx`** — 종목명 `onBlur` → `fetchStockByName` → 티커/시장/주가/날짜 자동입력
  - 동명 종목 복수 결과 시 **후보 드롭다운** 표시 (선택 시 주가 재조회)
  - 티커 직접 입력 후 `onBlur` → 주가만 재조회 (fallback)
- **`NewBondForm.tsx`** — 채권명 `onBlur` → `fetchBondByName` → ISIN/기준가/날짜 자동입력
  - ISIN 직접 입력 후 `onBlur` → 기준가만 재조회 (fallback)

#### Task 2: Code.gs 종목명/채권명 검색 함수 추가
- `doGet()` 라우팅에 `name`, `bondName` 파라미터 처리 추가
- `getStockPriceByCode_(code6)` — 기존 1~3순위 주가 조회 헬퍼 (내부 재사용)
- `getBondPriceByIsin_(isinCd)` — 기존 채권 조회 헬퍼 (내부 재사용)
- `searchStockByName_(name)` — KRX finder_stkisu → 주가 조회 → candidates 포함 응답
- `searchBondByName_(bondName)` — KRX finder_bondisu → 기준가 조회 → candidates 포함 응답
- `testStockNameSearch()`, `testBondNameSearch()` — GAS 에디터 직접 테스트 함수
- **⚠️ GAS 재배포 필요** (`docs/GAS_NAME_SEARCH_PATCH.md` 참조)

#### Task 3: GAS 타임아웃 문제 진단 및 해결
- **원인**: GAS 콜드 스타트(인스턴스 재초기화) + 공공데이터포털 채권 API 응답 지연 → 기존 10초 초과
- **해결**:
  - `useGas.ts`: `TIMEOUT_MS` 10s → **30s**, 타임아웃 시 **1회 자동 재시도** 추가
  - `Code.gs`: 내부 `TIMEOUT_MS` 10s → **25s**
  - 조회 중 안내 메시지: "시세 조회 중… (최대 30초)" 표시
  - `BondHistoryPanel` 조회 버튼 툴팁: "전 영업일 기준가 조회 (공공데이터 T+1)"
- **채권 시세 특성**: 공공데이터포털 T+1 제공 → 항상 전 영업일 기준가 반환 (정상)
  - 예: 2026-06-04 조회 → `date: "2026-06-02"` 반환 ✅

---

---

### 2026-06-05 세션 (Phase 2 — 자금정책 관리)

#### Task 1: 자금정책 Supabase 테이블 3개 신규
- `policy_meetings` — 회의 정보 (정책회의/운영회의, 개최일)
- `policy_decisions` — 의결사항 (법인별, 안건/결정/담당/기한/상태)
- `policy_params` — 정책 파라미터 (법인+키 조합 unique, FX 표준편차 등)
- SQL: `docs/supabase_policy_tables.sql`

#### Task 2: PolicyPage.tsx 신규 (`/policy/:company?`)
- master: 회의 등록 + 법인별 안건 추가 + 상태 변경
- 모든 계정: 조회 + 후속조치 스레드 (`issue_comments` 재활용, `issue_key = policy_{id}`)
- 법인 탭: 셀바스에이아이 / 셀바스헬스케어 / 메디아나 (D-day, 상태 배지)
- Sidebar: 📋 자금정책 관리 메뉴 추가

#### Task 3: FxPage — FX 정책관리 탭
- **Target Band 게이지**: 현재 외화비중 vs 목표 구간
- **최대환율변동폭 계산 테이블**: 통화별 표준편차×가중치 합산 × Z₉₅(1.645) 자동계산
- **🔄 자동계산(ECOS) 버튼**: GAS → ECOS API → 연환산 표준편차 → policy_params 저장
- **적정 외화보유한도**: (영업이익+이자수익)×위험포션 ÷ 최대환율변동폭
- **AS-IS vs TO-BE**: 통화별 현재/목표 비교

#### Task 4: InvestPage — FVPL 리스크 탭
- 국채 최신 1건만 (`getLatestBonds()` 적용)
- Duration 입력 → policy_params 저장
- 금리 시나리오 테이블 (-100bp ~ +100bp), ΔPrice ≈ -Duration × ΔYield

#### Task 5: 훅 4개 신규
`usePolicyMeetings` / `usePolicyDecisions` / `usePolicyParams` / `usePolicyThreads`

#### Task 6: GAS Code.gs v4 — ECOS 표준편차 자동계산
- `?type=fxstddev` 라우팅 추가
- **핵심 수정사항**:
  - ECOS 주기코드: `DD` → **`D`** (명세서 확인: 일별=D)
  - GBP 코드: `0000004`(독일마르크 오류) → **`0000012`** (영국파운드)
  - 연환산: 일별 표준편차 × √252
- 스크립트 속성 필요: `ECOS_API_KEY` (https://ecos.bok.or.kr/api/#/)

---

### 2026-06-05 세션 2차 (자금정책 통합 — Step 3 + Step 1,2)

#### 배경: 규정 기반 재분석
- `regulation_treasury/` 폴더의 3개 파일 분석:
  - `자금운용관리규정_260120.docx` — 정책회의/운영회의 상세안(별지1), 상품 적정성 체크리스트(별지2), 유동성 버킷, FX 헤지 비율, 거래 한도
  - `자금정책회의_2026년 1차회의.pptx` — 실제 의결 내용(셀바스AI 운전자금 전환, 메디아나 FX Band, 30년물 채권 FVPL)
  - `적정외화보유 비중 계산.xlsx` — ECOS 환율 데이터 기반 표준편차 계산 모델
- 현황 감사 결과: PolicyPage ↔ 실데이터 완전 단절, FxPage/InvestPage에 분산된 정책 파라미터

#### Step 3: PolicyPage 실데이터 연동 (기반 구축)

**신규 훅 `usePolicyDashboard.ts`**:
- `useAuth().currentCompany`와 독립적으로 법인별 실데이터 직접 패치
- 3개 법인 동시 호출 가능 (PolicyPage에서 unconditional 3회 호출)
- 반환: `operatingCash`, `fxKrw`, `investments`, `bonds`, `loans`, `investByBank`, `loanByBank`, `totalFundEstimate`

**PolicyPage.tsx 전면 재설계**:
1. **정책 유형 탭** 추가: `📋 회의·의결 | 💱 FX 정책 | 📈 FVPL 리스크`
2. **3사 정책 현황 요약 테이블** (전체 탭): 운전자금/외화비중/운용자금/차입금 비교
3. **법인별 4개 상태 카드** (특정 법인 탭):
   - 💧 유동성 버킷 — 현재 현금성 vs `liquidity_fixed_cost_monthly × min_months`
   - 💱 외화 비중 — 현재 비중 vs `fx_target_min~max` (게이지 + ✓/✕)
   - 🏦 차입금 — 현재 비율 vs `loan_max_total_ratio`
   - 📊 운용자금 집중도 — 기관별 30% 한도 (규정 §9)
4. **의결사항 카드 인라인 정책 지표** — 안건명 키워드 매칭으로 관련 파라미터 자동 표시
5. **신규 `policy_params` 키**: `liquidity_fixed_cost_monthly`, `liquidity_min_months`, `liquidity_credit_line`, `loan_max_total_ratio`

#### Step 1: FX 정책탭 → PolicyPage 이관
- `src/components/policy/FxPolicyTab.tsx` 신규 (FxPage에서 독립 컴포넌트로 분리)
  - Target Band 게이지, 변동폭 계산 테이블, ECOS 자동계산, 적정 외화보유한도, AS-IS vs TO-BE
- `FxPage.tsx` 단순화: 환율 현황만 유지, 상단에 "자금정책 관리" 링크 안내 추가
- 법인 전환 시 `setCurrentCompany()` 동기화로 내부 `useDaily()` 훅 정합성 유지

#### Step 2: FVPL 리스크탭 → PolicyPage 이관
- `src/components/policy/FvplRiskTab.tsx` 신규 (InvestPage에서 독립 컴포넌트로 분리)
  - props: `bonds, params, isMaster, userLabel` — 완전히 데이터 독립적
- `InvestPage.tsx` 단순화: 운용 중/만기종료 탭만 유지, 상단 "FVPL 리스크 안내" 배너 추가

---

### 2026-06-05 세션 3차 (버그수정 + 기능고도화)

#### Bug Fix — High/Medium Priority TODO 처리
- `useIssues.ts` — `openCount` 중복 카운팅 수정: `issue_key`별 최신 상태 Map 집계
- `useDashboard.ts` — 차입금 D- 음수 버그: `dday < 0` → `만기경과 D+N` 포맷
- `useDaily/useLoans/useInvestments/useEquities/useIssues` — fetch 시 `setData([])` 추가 (법인 전환 즉시 초기화)
- `HistoryPage.tsx` — 운용자금 날짜 필터: 국채 `priceDate` 우선, 비채권 `start` 우선
- `FxPage.tsx` — 환율 5분 폴링 추가 (`window.setInterval`)
- `format.ts` — 미사용 `calcKRW` 함수 제거 (모든 소비처 `useFx().toKRW()` 통일)

#### EquityPage — 전체 시세 일괄 갱신
- `bulkRefreshStocks()` — 상장 종목 전체 순차 `fetchStockPrice` → `eq.save()`
- `bulkRefreshBonds()` — 국채 전체 순차 `fetchBondPrice` → `inv.save()`
- 진행 카운터 (N/M), 실패 종목 오류 메시지 표시

#### IssueHistoryPage — UUID 노출 제거
- `keyLabel()` 함수 폐기 → `issueTypeBadge()` 컬러 뱃지로 교체
- `loan_7e0fc...` → `[차입금]` 뱃지 (타이틀 앞 삽입)

#### PolicyPage 전면 개선 (6탭 구조)
- **탭 구조**: `📋 회의·의결 | 💱 FX 정책 | 📈 변동성 리스크 | 🏦 기관한도 | 📅 주간예측 | 📊 만기래더링`
- FVPL 리스크 → **변동성 리스크** 네이밍 변경
- 세부 탭 전환 시 `currentCompany` 자동 연동, **전체 버튼 숨김**
- FxStatusCard → "FX 정책 →" 링크, InvestConcentrationCard → "기관한도 관리 →" 링크
- 의결사항 수정(모달)/삭제 버튼 추가 (`updateDecision`, `removeDecision`)
- 회의 수정(모달)/삭제 버튼 추가 (`updateMeeting`, `removeMeeting`)

#### 거래 금융기관 한도 (`policy_bank_limits`)
- Supabase DDL: `docs/supabase_policy_tables.sql` 추가
- `usePolicyBankLimits.ts` — CRUD 훅
- `BankLimitsTab.tsx` — 기관별 잔고·비중·한도 테이블, 마스터 등록 모달
  - `normBank()` — `기업은행(007)` → `기업은행` 괄호 suffix 정규화·합산
  - 마스터 등록 기관 vs 운용 기관 통합 표시 (미운용 기관 "미운용" 표시)
  - 미등록 기관 "미등록" 뱃지
- `policy_bank_limits`를 **거래 금융기관 마스터** 테이블로 격상
- `InvestPage.tsx` — 금융기관 입력 `<datalist>` 연동 (등록 기관 자동완성)

#### 12주 롤링 포캐스트
- Supabase DDL: `cashflow_plan` (company + week_start unique)
- `useCashflowPlan.ts` — 12주 배열 생성, upsert
- `CashflowForecastTab.tsx` — 주별 유입/유출 인라인 입력, 기말잔고 누적, 마이너스 적색 경고

#### 만기래더링 + 상품적정성 (`PolicyCTab.tsx`)
- `📊 만기래더링` 탭: 향후 13개월 운용자금+차입금 BarChart, 40% 집중 만기 경고
- `☑️ 상품 적정성`: 별지2 기반 12개 체크항목 (신용/안전성·유동성·수익성·한도·승인)
- **만기래더링 툴팁 개선**: 월별 만기일·기관명·금액 상세 목록, 만기일 오름차순 정렬

#### FxPolicyTab 전면 개선
- **전체 자금 총액 자동계산**: `useInvestments` 추가, `operatingCash + investCash` 실데이터 연동
- **현재 외화비중 분모 수정**: `operatingCash` → `totalFund` (51% 오류 → 정상 ~20% 수정)
- **게이지 0~100% 고정 스케일**: 눈금 0/25/50/75/100% 추가, Target Band 위치 안정화
- **Target Band 자동설정**: optimalFxRatio > 100% 시 차단 + 경고, 의결 전 미리보기
- **Target Band 비정상 경고**: 100% 초과 저장 시 빨간 배너 자동 표시
- **Z₉₅ 수정**: 1.645 → 1.6503 (엑셀 모델 `적정외화보유 비중 계산.xlsx` 검증)
- `파라미터 편집` 폼: `fx_total_fund` 제거 (자동계산), Target Band 편집 추가

---

## 8. 미완료 / 추후 작업

### GAS 스크립트 현황

| 기능 | GAS 파라미터 | 상태 |
|------|------------|------|
| 주가 조회 (ticker) | `?ticker=108860` | ✅ 운영 중 |
| 채권 기준가 조회 (ISIN) | `?type=bond&isinCd=KR...` | ✅ 운영 중 (T+1 지연) |
| 환율 조회 | `?type=fx` | ✅ 운영 중 |
| 종목명으로 주식 검색 | `?name=셀바스에이아이` | ✅ 운영 중 |
| 채권명으로 채권 검색 | `?type=bond&bondName=국고채` | ✅ 운영 중 (KRX IP 제한 시 ISIN 직접 입력 fallback) |
| FX 표준편차 자동계산 | `?type=fxstddev` | ✅ 운영 중 (ECOS API, 스크립트속성 ECOS_API_KEY 필요) |

**GAS 실제 응답 형식 (확인됨):**
```json
// 주가: { "success":true, "price":9870, "change":-10, "changeRate":-0.10, "date":"2026-06-04", "symbol":"108860", "source":"naver" }
// 채권: { "success":true, "price":7514, "rate":4.148, "date":"2026-06-02", "isinCd":"KR103502GF39", "name":"국고02625-5503(25-2)", "market":"일반채권", "source":"data.go.kr/bond" }
// 환율: { "success":true, "rates":{"USD":1529.37,"EUR":1775.03,"JPY":9.56,"GBP":2053.96,"CNY":2.253} }
// 이름검색(주식): { "success":true, "ticker":"108860", "name":"셀바스AI", "market":"KOSDAQ", "price":9870, ..., "candidates":[...] }
// 이름검색(채권): { "success":true, "isinCd":"KR...", "name":"국고채권명", "price":7514, ..., "candidates":[...] }
```

**국채 기준가 계산 공식**: `bondQty × (bondPrice ÷ 10)` = `calcBondValue()` 함수
- `bondPrice`는 액면 10,000원 기준 가격 (예: 7514 = 75.14%)
- 1좌 = 1,000원 면액 기준 → `7514 ÷ 10 = 751.4원/좌`

### 미구현 기능
- `useDashboardLayout.ts` — 생성됐으나 현재 미사용 (DnD 롤백)
- Zustand 전역 상태 — 설치만 됨
- Tabler Icons — 설치만 됨 (현재 이모지 사용)
- E2E 테스트 (Playwright)
- 채권명 KRX 검색 — GAS에서 IP 제한 시 "ISIN 직접 입력" fallback 동작
- **의결사항 ↔ 정책 파라미터 자동 매핑** — 현재 키워드 매칭으로 읽기 전용 표시, 저장 연결 미구현
- **영업일 공휴일 다년도** — `isBusinessDay()` 2026년만 하드코딩
- **GAS 자동 시세 스케줄러 ON/OFF** — `useStockTicker.ts` 항상 폴링 활성화

---

## 9. 🗂️ NotionTable 개발 표준 (신규 페이지 필수 적용)

새로운 데이터 목록 페이지·컴포넌트를 개발할 때는 raw `<table>` 대신 **반드시 `NotionTable`을 사용**한다.

### 적용 현황

| 페이지/컴포넌트 | tableId | 상태 |
|---|---|---|
| `LoansPage.tsx` (차입 중) | `loans_active` | ✅ 적용 완료 |
| `LoansPage.tsx` (상환 완료) | `loans_inactive` | ✅ 적용 완료 |
| `InvestPage.tsx` (운용 중) | `invest_active` | ✅ 적용 완료 |
| `InvestPage.tsx` (만기/종료) | `invest_inactive` | ✅ 적용 완료 |
| `HistoryPage.tsx` (표 뷰) | `history_table` | ✅ 적용 완료 |
| `EquityHistoryPanel.tsx` | `equity_history` | ✅ 적용 완료 |
| `BondHistoryPanel.tsx` | `bond_history` | ✅ 적용 완료 |

### 신규 페이지 적용 체크리스트

```tsx
// 1. import
import { NotionTable, type ColumnDef } from '../components/common/NotionTable'

// 2. 타입 정의된 컬럼 배열 작성
const columns: ColumnDef<MyRecord, unknown>[] = [
  { accessorKey: 'field',  header: '헤더명' },
  { accessorKey: 'amount', header: '금액',
    cell: ({ getValue }) => fmtKRW(getValue<number>()) },
  // computed 컬럼: accessorFn 사용
  { id: 'computed', header: '계산값',
    accessorFn: row => someCalc(row),
    cell: ({ getValue }) => <Badge>{getValue<number>()}</Badge> },
  // 정렬 불가 액션 컬럼
  { id: 'actions', header: '', enableSorting: false,
    cell: ({ row }) => <EditDeleteButtons rec={row.original} /> },
]

// 3. tableId 규칙: '{페이지명}_{탭명}' (소문자, 언더스코어)
//    예: 'loans_active', 'invest_inactive', 'history_table'
//    같은 컬럼 구조를 공유하는 패널은 하나의 ID 사용 가능
//    예: 'equity_history' (모든 종목 이력 패널 공유)

// 4. 렌더링
<NotionTable<MyRecord>
  tableId="page_tab"
  columns={columns}
  data={list}
  emptyText="데이터가 없습니다."
/>
```

### ColumnDef 패턴 레퍼런스

| 케이스 | 방법 |
|--------|------|
| DB 필드 직접 표시 | `accessorKey: 'field'` |
| 포맷팅 필요 (금액·날짜·%) | `accessorKey` + `cell: ({ getValue }) => ...` |
| 2개 이상 필드 조합 | `accessorFn: row => calc(row.a, row.b)` + `cell: ({ row }) => ...` |
| 정렬 기준과 표시값이 다름 | `accessorFn`으로 정렬 기준값 반환, `cell`로 별도 표시 |
| 액션 버튼 (수정·삭제) | `id: 'actions'`, `enableSorting: false`, `cell: ({ row }) => <Btns />` |

### tableId 네이밍 규칙

- 형식: `{페이지}_{구분}` (소문자, 언더스코어)
- 탭이 있는 페이지: `loans_active` / `loans_inactive` 처럼 탭별로 분리
- 동일 컬럼 구조를 공유하는 서브패널: 하나의 ID 공유 가능
- Supabase `user_table_views` 테이블에 `(sb_id, table_id)` Unique 저장됨

---

## 10. ⚠️ 중요 시행착오 & 금지사항 (구 §9)

### [CRITICAL] useRef + @types/node 타입 충돌 → React 19 앱 전체 크래시
```
증상: "An error occurred in the <TopBar> component" → root 빈 상태
원인: useRef<ReturnType<typeof setInterval>> 사용 시
      @types/node devDependency가 setInterval을 NodeJS.Timeout으로 추론
      → React 19 dev mode에서 런타임 크래시 발생
해결: window.setInterval / window.clearInterval 명시 사용
      useCallback + useRef 조합 대신 useEffect 내부 async function 패턴 사용
```

**올바른 폴링 훅 패턴:**
```typescript
useEffect(() => {
  let cancelled = false
  async function run() {
    // fetch + setState
    if (cancelled) return
  }
  void run()
  const timer = window.setInterval(() => void run(), INTERVAL)
  return () => { cancelled = true; window.clearInterval(timer) }
}, [])
```

### HMR 캐시 문제
- 빌드는 성공하는데 브라우저에서 에러가 지속될 때 → 반드시 dev 서버 재시작
- `preview_stop` → `preview_start` 후 재확인

### react-grid-layout + react-resizable CSS
- `react-resizable/css/styles.css` import 시 Vite 빌드 실패
- `isResizable={false}` 로 회피하거나 react-resizable을 직접 devDependency 추가 필요

### Tailwind v4 주의
- PostCSS 플러그인 방식 아님 → `@tailwindcss/vite` 플러그인 방식
- arbitrary values: `lg:grid-cols-[8fr_3fr]` 형태로 작성 가능

### DnD 라이브러리
- `react-grid-layout` 사용 시 각 카드가 `position:absolute` → 고정 rowHeight 필요
- Tailwind 클래스와 충돌 → 추후 도입 시 별도 레이아웃 래퍼 컴포넌트 필요

### [GAS] 콜드 스타트 타임아웃
```
증상: 국채 기준가 조회 버튼 클릭 시 "GAS 응답 시간 초과 (10s)" 에러
원인: GAS 인스턴스 미사용 후 재초기화(콜드 스타트) + 공공데이터포털 채권 API 지연
      → warm 상태: 3~5초, cold 상태: 15~20초 소요
해결: useGas.ts TIMEOUT_MS 10s → 30s, 타임아웃 시 1회 자동 재시도
     Code.gs 내부 TIMEOUT_MS 10s → 25s (GAS 재배포 필요)
```

### [GAS] curl 봇 감지
```
증상: curl -L 로 GAS 반복 호출 시 HTML "현재 파일을 열 수 없습니다" 반환
원인: Google이 curl User-Agent의 반복 호출을 봇으로 감지, 블로킹
영향: 브라우저(React 앱) 호출에는 영향 없음 — 테스트 방법 문제
해결: 브라우저 preview_eval 로 fetch 테스트, curl 테스트는 신뢰성 낮음
```

### [팝업] fadeInScale 애니메이션 + Tailwind translate 충돌
```
증상: 팝업이 화면 한쪽에 잠깐 나타났다가 중앙으로 이동하는 깜빡임
원인: @keyframes 내 translate(-50%,-50%) 가 Tailwind CSS 변수 기반 transform과 충돌
해결: keyframe에서 translate 완전 제거, opacity + scale 만 사용
     Tailwind -translate-x/y-1/2 가 위치를 담당, animation은 opacity+scale 전담
```

---

## 11. Supabase 핵심 테이블

| 테이블 | 설명 |
|--------|------|
| `daily` | 운전자금 일별 잔고 (krw_demand/govt/mmda + fx 5종) |
| `investments` | 운용자금 + 국채 (product 필드로 구분, 국채는 bondTicker/bondQty/bondPrice) |
| `loans` | 차입금 (active로 상환 처리) |
| `equities` | 지분투자 날짜별 시세 (같은 종목 날짜별 row 누적) |
| `issue_comments` | 이슈 스레드 (issue_key: `loan_{uuid}` / `equity_{종목명}` / `input_daily`) |
| `access_codes` | 사용자 인증 코드 |
| `policy_meetings` | 자금운용위원회 회의 (정책회의/운영회의) |
| `policy_decisions` | 의결사항 (법인별, CASCADE DELETE from meetings) |
| `policy_params` | 정책 파라미터 Key-Value (company+param_key unique) |
| `policy_bank_limits` | **거래 금융기관 마스터** + 한도 설정 (company+bank_name unique) |
| `cashflow_plan` | 12주 롤링 포캐스트 (company+week_start unique) |
| `user_table_views` | NotionTable 컬럼 토글·정렬 설정 (sb_id+table_id unique) |

> **Supabase 신규 DDL 실행 필요**: `docs/supabase_policy_tables.sql`
> (`policy_bank_limits`, `cashflow_plan` 테이블 포함)

**국채 평가금액**: `bondQty × (bondPrice ÷ 10)` (`calcBondValue` 함수 사용)

---

## 12. 라우팅 구조

```
/dashboard/:company?
/input/:company?/:date?
/invest/:company?/:id?
/loans/:company?/:id?
/equity/:company?/:name?    ← 지분 탭
/bonds/:company?/:isin?     ← 채권 탭 (같은 EquityPage)
/history/:company?/:from?/:to?
/issue-history/:issueKey?
/fx/:currency?
/admin/mycode | /admin/users | /admin/data
```

basename: `/New-Treasury`

---

## 13. 주요 유틸 함수 (src/lib/format.ts)

| 함수 | 설명 |
|------|------|
| `fmtKRW(n)` | 억·만 단위 자동 변환 (1억 이상: "X억원") |
| `calcDday(maturity)` | 오늘~만기까지 일수 |
| `calcReturn(val, cost)` | 수익률 계산 (null if cost=0) |
| `calcBondValue(qty, price)` | 채권 평가금액 |
| `normDate(str)` | YYYYMMDD → YYYY-MM-DD |

---

## 14. 개발 및 문서화 규칙 (Documentation Rule)

코드 수정 또는 기능 추가 시 **작업 완료 직전** 반드시 아래 규칙을 따른다.

1. **관련 docs 갱신**: 수정된 기능에 해당하는 `docs/` 내 MD 파일(`SELVAS_TREASURY_CONTEXT.md`, 컴포넌트별 문서 등)을 최신 상태로 업데이트한다.
2. **변경 이력 기록**: 새롭게 파악된 이슈나 중요한 구조적 변경사항은 `docs/CHANGELOG.md` 또는 적절한 신규 문서를 생성해 기록한다.
3. **TODO 체크**: `docs/TODO.md`에 있는 항목을 완료했다면 해당 체크박스를 `[x]`로 업데이트한다.

### 🔒 대시보드 컴포넌트 하네스 검증 규칙

`src/pages/DashboardPage.tsx` 및 하위 카드 컴포넌트를 수정할 때는 반드시
`docs/pages/DashboardPage.md`에 명시된 **"모바일/PC 반응형 그리드 규칙(§2)"** 과
**"카드 내부 스크롤 규칙(§3)"** 을 준수하여,
어떤 해상도에서도 UI가 깨지거나 카드가 비정상적으로 길어지지 않도록 구현해야 한다.

**반응형 그리드 체크리스트**:
- ✅ 모바일(`< lg`): 전체 1열 수직 스택, 카드 순서 논리적 배치
- ✅ PC(`lg` 이상): 좌측 메인 `8fr` + 우측 패널 `3fr` 2열 분리
- ✅ KPI 행: `grid-cols-1 sm:grid-cols-3` 반응형 적용
- ❌ 특정 해상도에서 카드가 겹치거나 넘치는 고정 픽셀 폭 사용 금지

**카드 높이·스크롤 체크리스트**:
- ✅ 우측 상세 카드 3개: `flex-1 min-h-0` (PC) + `max-h-64 lg:max-h-none` (모바일 제한)
- ✅ 카드 콘텐츠 영역: `overflow-y-auto min-h-0` 필수 적용
- ✅ 우측 패널 전체: `lg:h-[calc(100vh-8rem)]`으로 뷰포트에 고정
- ❌ 콘텐츠 양에 따라 카드 높이가 동적으로 늘어나는 코드 금지
- ❌ `min-h-0` 누락 시 overflow가 동작하지 않음 — 반드시 명시

---

## 15. 개발 시 체크리스트

새 세션에서 작업 시작 전:
- [ ] `pnpm dev` 로 개발 서버 기동 확인 (port 5175)
- [ ] `.env.local` 존재 확인 (없으면 섹션 6 참조해서 생성)
- [ ] `sessionStorage['treasury_user']` 에 master 세션 주입 or 로그인
- [ ] `pnpm build` 로 빌드 에러 없는지 확인 후 코드 작업 시작

---

## 16. 참고 문서 (docs/ 폴더)

| 문서 | 내용 |
|------|------|
| `docs/SELVAS_TREASURY_CONTEXT.md` | 레거시 HTML 시스템 전체 컨텍스트 + DB 스키마 + GAS 구조 |
| `docs/SELVAS_TREASURY_REACT_CONTEXT.md` | React 신규 구축 Step별 완료 현황 |
| `docs/ROUTING_DEEPLINK_SPEC.md` | 딥링크 URL 명세 |
| `docs/hooks/README.md` | 모든 커스텀 훅 API 레퍼런스 |
| `docs/INDEX.md` | 문서 전체 인덱스 |
| `docs/TODO.md` | 기능 구현 TODO (우선순위별 체크리스트) |
