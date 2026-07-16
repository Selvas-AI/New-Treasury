# CLAUDE.md — Selvas Treasury (New-Treasury)
> 신규 세션 시작 시 이 파일을 먼저 읽어 컨텍스트를 복원하세요.
> 최종 업데이트: 2026-07-16 (세션19차 — 주간예측 항목별 입력+엑셀 임포트, 대시보드 자금흐름 팝업 SSOT 불일치 3건 수정, 자금정책 외화비중 카드 국채 중복합산 버그 수정)

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
| Dev 서버 | `pnpm dev` → `http://localhost:5175/` (LAN: `http://192.168.22.241:5175/`) — 커스텀 도메인 루트 서빙 대응으로 base '/'로 전환(2026-07-01) |
| 프로덕션 URL | `https://treasury.selvas.com/` (GitHub Pages 커스텀 도메인, `public/CNAME`) |
| 빌드 | `pnpm build` |
| LAN 접속 주소 | `http://192.168.22.241:5175/` (같은 사내망/192.168.22.x) — 포트 고정(strictPort) |
| LAN 설정 | `vite.config.ts` → `server: { port: 5175, host: true }` |
| Preview 도구 서버 이름 | `vite-dev` (`.claude/launch.json` 참조) |

---

## 3. 기술 스택

```
React 19.2.6 + TypeScript + Vite 8
Tailwind CSS v4       (@tailwindcss/vite 플러그인, NOT postcss)
Recharts              (차트)
react-router-dom v7   (BrowserRouter, basename="/" — 커스텀 도메인 루트)
@supabase/supabase-js
@tanstack/react-table (테이블 헤드리스 UI — NotionTable 내부 사용)
zustand               (설치됨, 아직 미사용)
@tabler/icons-react   (설치됨, 현재 이모지 사용 중)
```

> **`vite.config.ts`에 `resolve.dedupe: ['react','react-dom']` 필수** — pnpm 환경에서
> `@tanstack/react-table` 등 외부 라이브러리가 React를 중복 로딩하면 "Invalid hook call" 런타임 에러 발생.

---

## 4. 인증 체계

### Supabase Auth 기반 (세션6차 전환 완료)
- **로그인**: 이메일 + 비밀번호 (`supabase.auth.signInWithPassword`)
- **세션**: Supabase Auth JWT (localStorage 자동 관리, sessionStorage 불사용)
- **권한 프로필**: `treasury_users` 테이블 (email → 권한 로드)
- **최초 계정 설정**: Admin이 `treasury_users`에 이메일 사전 등록 → 사용자가 LoginPage "최초 계정 설정" 탭에서 비밀번호 설정

### 역할 계층 (master > admin > editor > viewer)
| 역할 | 설명 |
|------|------|
| `master` | 전체 권한 (사용자 관리 포함) |
| `admin` | 편집·결재·정책 (사용자 관리 제외) |
| `editor` | 데이터 입력·편집 |
| `viewer` | 읽기 전용 |
> `ceo` / `company` — 레거시 역할, 기존 코드 호환용 (신규 미사용)

### useAuth() 헬퍼
- `canEdit()` — 편집 가능 여부
- `canDelete()` — 삭제 가능 여부 (master 또는 can_delete=true)
- `canApprove()` — 결재 가능 여부
- `hasMenu(slug)` — 메뉴 접근 가능 여부
- `hasCompany(c)` — 법인 접근 가능 여부
- `hasCategory(dir, code)` — 자금일보 입금/출금 카테고리 접근 여부 (세션13차, `allowed_categories=null`=전체 허용)
- `canAction(section, action)` — 섹션별 조회/입력·수정/삭제 권한 (세션13차, `action_permissions=null`=역할 기본값)

### 사전 등록 DDL
`docs/db/treasury_users.sql` — Supabase SQL Editor에서 실행 필요
`docs/db/user_permissions_migration.sql` — 세분화 권한 컬럼(`allowed_categories`/`action_permissions`) 추가 (세션13차, **실행 필요**)

### SSO 추후 계획
- 셀바스에이아이: Azure AD (별도 테넌트)
- 메디아나: Azure AD (별도 테넌트)
- 셀바스헬스케어: Google Workspace (@selvashc.com)

---

## 5. 핵심 파일 구조

```
src/
├── components/
│   ├── Layout.tsx          ← Sidebar + TopBar + Outlet
│   ├── Sidebar.tsx         ← 섹션 트리 접기/펴기 + 접기/이슈배지/환율팝업/얇은스크롤바
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
  - `normBank()` — 은행명 정규화·합산: `국민은행(231)-2` → `국민은행` (은행 키워드까지 추출), `기업은행(007)` → `기업은행` (괄호 suffix 제거). **신규 페이지에서도 반드시 이 함수 재사용** (`import { normBank } from '../../components/policy/BankLimitsTab'`)
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

---

### 2026-06-09 세션 (버그수정 + UI 개선)

#### Bug Fix — 데이터 정확성
- **레이스 컨디션 (`bonds.length=0`)**: `fetchIdRef` 패턴 → `useInvestments/useEquities/useDaily/useLoans` 4개 훅 적용. `setLoading(false)`를 stale-check 이전으로 이동 (무한 로딩 방지)
- **`null value in column "id"` insert 오류**: `crypto.randomUUID()` 클라이언트 생성으로 해결
- **외화 운용자금 KRW 미환산**: `useDashboard`에서 `toKRWAmt(amount, currency)` 헬퍼 추가, `useEffect(() => fx.fetchRates())` 자체 호출. USD/EUR 정기예금 91.7억원 누락 수정 (메디아나 기준)

#### BondHistoryPanel / EquityHistoryPanel 개선
- **히스토리 패널 prefill**: 패널 열 때 최신 레코드 → 좌수·취득가액·가용여부 자동입력 (기준가·주가는 비워둠)
- **천단위 구분 `,`**: `fmtInt/fmtDecimal` 헬퍼로 모든 숫자 입력 필드 적용
- **기준일 날짜별 시세조회**: `basDt = form.priceDate` 전달, 조회 후 priceDate 덮어쓰기 제거
- **동일 기준일 중복 저장 방지**: `existingByDate` upsert — 같은 날짜 기존 레코드 발견 시 update 분기
- **취득가액 팝업 범위 제한**: `isNewInsert && hasAcqMismatch` 조건 (단순 날짜 추가 시 팝업 미표시)

#### 기관한도 (BankLimitsTab) 개선
- **normBank() 강화**: `국민은행(231)-2` → `국민은행` (은행 키워드까지 추출, 계좌번호·suffix 제거)
- **은행 전용 필터**: 은행 키워드 없는 기관(증권사·보험사 등) 제외
- **totalAmt 은행만 집계**: `bankInvests.filter(i => normBank(i.bank).includes('은행'))`
- **usePolicyDashboard `investByBank`**: normBank + 은행 필터 동일 적용 → 회의·의결 탭 운용자금 집중도 카드 정합

#### EquityPage 취득가액 일괄 입력 (B안)
- **"💰 취득가액 미입력 N건"** 배너 버튼 (취득가액 미입력 지분·비상장 종목 있을 때만 표시)
- 클릭 시 팝업: 미입력 종목만 표시 (종목명/시장/현재가/주수 + 취득가액 입력 필드)
- 천단위 자동 포맷, "일괄 저장 (N건)" 버튼 → `eq.updateAcquisitionCost(name, cost)` 종목 전체 이력 반영
- 저장 성공 시 팝업 자동 닫힘, 배너 사라짐

#### Sidebar 섹션 트리 구조 (NAV_GROUPS)
- 플랫 리스트 `NAV_ITEMS` → 섹션 그룹 `NAV_GROUPS`로 전환
- 섹션 헤더 클릭으로 접기/펴기 (`openSections` state, `max-h` transition)
- 현재 경로가 속한 섹션 자동 열림 (`getDefaultOpen`)
- 섹션 구성:
  - **DASHBOARD**: 통합 상황판, 자금정책
  - **자금입력**: 운전자금, 운용자금, 차입금, 지분/장기투자
  - **이력관리**: 자금 변동 이력, 이슈 이력, 환율 현황
  - **관리** (master 전용): 코드 변경, 사용자 관리, 데이터 관리
- "자금정책 관리" → "자금정책" 레이블 변경
- collapsed(w-14) 상태: 섹션 토글 비활성화, 아이콘 전체 상시 표시

---

### 2026-06-09 세션 2차 (자금일보 기획 + UI 개선)

#### EquityCard 인터랙티브 개선
- **종목 클릭 → 차트 전환**: 리스트 행 클릭 시 해당 종목의 평가 추이 차트로 전환
- **Ctrl+클릭 복수 선택**: `selected: Set<string>` 상태, Ctrl/⌘ 누르면 토글 다중 선택, 차트는 선택 항목 합산 추이 표시
- **고정 카드 크기**: 리스트 영역 `h-44` 고정 높이 + `overflow-y-auto`, 선택 여부 관계없이 항상 전체 종목 표시
- **select 드롭다운 제거**: 클릭 인터랙션으로 대체, `✕ 전체` 버튼은 헤더로 이동
- **지분/국채 구분선**: `── 국채/채권 ──` 인라인 구분선으로 시각 분리
- `Ctrl+클릭으로 복수 선택` 힌트 문구 (전체 보기 + 2개 이상 종목 시 표시)

#### Sidebar 브랜딩 개선
- `Selvas Treasury` → `SELVAS TREASURY` (대문자, `tracking-widest`)
- 클릭 시 `/dashboard`(통합 상황판) 이동 + hover 시 `text-blue-300` 색상 변화

#### 자금일보 (DailyReportPage) 기획 확정
- **데이터 반영 정책**: C안 확정 — 입력 즉시 임시 반영, 승인 시 `confirmed=true` 확정
- **결재선**: 팀장 1단계 Default, `daily_report_approval_config` 테이블로 유연 추가/삭제
- **입금 7종**: 매출채권 회수, 미수금 회수, 국책자금 회수, 선수금, 투자금 회수(연동), 차입금 실행(연동), 기타(스레드)
- **출금 5종**: 미지급금, 선급금, 투자집행(연동), 차입금 상환(연동), 기타(스레드)
- **검증 공식**: `입금합계 - 출금합계 - (당일잔액 - 전일잔액) = 0` → 통과 시 상신 버튼 활성
- **산출 문서**: `docs/pages/DailyReportPage.md`, `docs/db/daily_report_tables.sql`
- **S1 개발 시작 예정** (DB DDL → 라우트 → 페이지 골격)

---

### 2026-06-10 세션 (자금일보 S1~S3 구현 + 날짜 모델 재정립)

#### 자금일보 날짜 모델 확정 (⭐ docs/pages/DailyReportPage.md §0)
- **핵심 전제**: `daily[D]` = 담당자가 D일 아침 입력 = **전일(D-1영업일) 마감잔액**
- `selectedDate`(작성일, picker, 기본=오늘) / `reportDate = prevBizDay(selectedDate)`(보고대상일=라벨)
- **현금**: 마감 = `daily[selectedDate]`(오늘 입력), 기초 = `daily[prevBizDay(selectedDate)]`(직전영업일 입력)
- **지분/국채**: 거래일(종가) 기준 — 마감 = `reportDate` 종가, 기초 = 그 이전 영업일 종가
- 라벨(기초·마감) 모두 `reportDate`. 리포트 키 = `selectedDate`
- `useDailyReportSummary`: `prevBizDayStr()` 헬퍼로 영업일 stepping (주말 skip)

#### 자금현황 ↔ 입출금 연동 (S2)
- `liveItemSums`(itemHook.items 실시간 집계) → `byAccount`/`byEquityName`/`byBondLabel`
- 입금/출금 항목 저장 시 자금현황 입금액·출금액 컬럼 즉시 반영
- 지분·국채 평가손익 **자동 기재**: 전일 변동분 → `@auto:`/`@auto:bond:` memo, in=이익/out=손실
  - 기존 잘못 저장된 항목 direction/category 자동 교정 로직 포함

#### BusinessDatePicker (커스텀 영업일 캘린더)
- 일~토 배열, 주말(토·일) 비활성, 작성일 상한 = 오늘(`snapToBizDay(today)`)
- 녹색 dot = 해당 작성일의 보고대상일(`prevBizDay`)에 운전자금 데이터 존재
- 전/다음 영업일 네비 버튼 (주말 자동 skip)

#### 컬럼 헤더
- "마감잔액"(전일 제거), Δ 컬럼 → "Δ 차액 / (마감−기초)" 중앙 2줄
- 지분 행 종목명 열 `whitespace-nowrap` (배지 줄바꿈 방지)

---

### 2026-06-10 세션 2차 (자금일보 S4~S5 + Supabase Auth + 공휴일)

#### Supabase Auth 전환 (세션6차 확정)
- 이메일+비밀번호 로그인 (`supabase.auth.signInWithPassword`) 전환
- `LoginPage.tsx` 재설계: 2×2 그리드 탭 (이메일 로그인 / 접근 코드 / 최초 설정 / 비밀번호 찾기), `max-w-md` 카드
- Supabase RLS: `anon` + `authenticated` 역할 양쪽에 동일 정책 부여 (DROP+recreate)
- `legacyRef` 패턴으로 기존 접근코드 방식과 dual-auth 호환

#### 공휴일 처리 (bizDay.ts)
- `src/lib/bizDay.ts` 전면 재작성: 2025~2028년 공휴일 하드코딩 + GAS 프록시 + localStorage 캐싱
- `fetchAndCacheHolidays(year)` — GAS `?type=holidays&year=YYYY`, 캐시키 `treasury_holidays_{YEAR}`
- `useHolidays()` 훅 신규 → `App.tsx`에서 현재+내년 자동 사전 로드
- `format.ts`에서 구 `isBusinessDay(Date)` 제거, `bizDay.ts`로 일원화
- `Code.gs`: `fetchKoreanHolidays_(e)` 추가, `HOLIDAY_API_KEY` 스크립트 속성 필요

#### 자금일보 S4 연동 팝업
- `invest_return` → 운용자금/지분 목록 팝업, `loan_drawdown` → 차입금 신규 팝업
- `invest_execute` → 운용자금 신규, `loan_repayment` → 상환 팝업
- 날짜 모델 확정: `selectedDate`(작성일) / `reportDate=prevBizDay(selectedDate)`(보고대상일)
- `BusinessDatePicker` 커스텀 영업일 캘린더 (주말 비활성, 녹색 dot = 데이터 존재)

#### 자금일보 S5 검증 + 결재 워크플로우
- `validation useMemo` 추출: 입금합계 - 출금합계 - 잔액증감 = 0 검증
- 상신/승인/반려 버튼 활성화, 결재선 설정 모달 (master 전용)
- `approveReport(step, comment)` / `rejectReport(comment)` 연결
- 3개 모달: 승인 확인, 반려 사유 입력, 결재선 설정(법인별 step/직책/코드 추가·삭제)

---

### 2026-06-10 세션 3차 (네비게이션 재편 + 신규 페이지)

#### Sidebar 5섹션 재편
- 기존: DASHBOARD(상황판·일보·정책) + 자금입력 + 이력관리 + 관리
- 변경: **DASHBOARD**(상황판·정책) / **자금입력**(운전·운용·지분·차입) / **자금일보**(작성·목록) / **이력관리**(변동·이슈·환율이력) / **관리**(코드·사용자·데이터·조직도)
- 환율 현황 → **환율 이력** 레이블 변경

#### 일별 자금일보 목록 (`DailyReportListPage.tsx`)
- 라우트: `/daily-report-list/:company?`
- 영업일 역산 목록 (최근 30/60/90영업일), 날짜×법인 현황 표시
- 상태 배지: 미작성 / 작성 중 / 결재 중 / 승인 완료 / 반려
- 클릭 시 해당 날짜 자금일보 바로 열기 / 미작성일 → 작성 진입

#### 조직도 관리 (`OrgChartPage.tsx`)
- 라우트: `/admin/org-chart` (master 전용)
- 법인별 결재선(step/직책/결재자코드) CRUD
- `useApprovalConfig`(`useDailyReport.ts`) 재사용
- 향후 조직 계층 시각화 예정 (Azure AD / Google Workspace SSO 연동)

---

### 2026-06-12 세션 (로그인 데드락 + 자금일보 안정화 + CMS 다중 PDF)

#### Bug Fix 1: 로그인 "처리 중..." 무한 행 — 영구 차단 ⭐[CRITICAL]
- **원인**: supabase-js v2가 모든 auth 작업을 `navigator.locks` exclusive 락으로 감쌈 → 이전 탭/새로고침 중 락 점유 상태가 남으면 이후 `signInWithPassword` 무한 대기
- **진단**: `await navigator.locks.query()` → held에 `lock:sb-...-auth-token` 존재 확인
- **해결**: `src/lib/supabase.ts` — `createClient` `auth.lock`에 no-op 함수 주입으로 Web Locks 완전 우회
  ```typescript
  async function noopLock<R>(_n: string, _t: number, fn: () => Promise<R>): Promise<R> { return fn() }
  createClient(url, key, { auth: { lock: noopLock, persistSession: true, ... } })
  ```
- `AuthContext.tsx` — `login()` 에서 `signInWithPassword` 응답의 `data.user` 직접 사용, 불필요한 `getUser()` 2차 네트워크 호출 제거
- 로그인 화면 flash 방지: 기존 세션 있을 때 profile 로드 완료까지 `loading=true` 유지, 5초 hard timeout 추가

#### Bug Fix 2: 자금일보 무한 로딩 — 렌더 루프 2단계 근본 차단 ⭐[CRITICAL]
- **1단계** (`useFx.ts`): `toKRW` → `useCallback([rates])`, 반환 객체 → `useMemo([rates,...,toKRW])` 메모이즈로 참조 안정화
- **2단계** (`DailyReportPage.tsx`): 지분·국채 평가손익 자동기재 effects 의존성 재설계
  - `summary.equityGroups`, `summary.investGroups` 배열을 deps에서 완전 제거
  - **`useRef` latest-value 패턴** 적용: 배열은 ref에 저장, effect 내부에서 `.current`로 읽음
  - deps는 안정적인 primitive만 유지: `[dr.report?.id, resolvedCompany, selectedDate, summary.loading]`
  - 배열 참조가 렌더마다 교체되어도 effect 재실행 없음 → 무한 루프 완전 차단
- `useFx` 단독 수정으로 충분하지 않은 이유: `useDailyReportSummary`의 `investGroups/equityGroups`가 `toKRW`를 dep으로 가진 `useMemo`를 통해 파생되므로, deps 배열 자체도 안정화 필요

#### CmsVerificationModal 전면 재설계 (다중 PDF + 페이지 점프)
- **Props 변경**: 단일 `cmsVerifyUrl: string` → `pdfs: PdfSource[]`, `initialIndex?: number`
- **다중 PDF 탭**: 업로드된 모든 PDF를 탭으로 표시, 스캔본은 `⚠` 표시
- **크로스 PDF 금액 매칭**: 마운트 시 모든 PDF에서 금액 추출 → `allHits: Hit[]` (pdfIndex, fileName, page 포함)
  ```typescript
  type Hit = { amount: number; pdfIndex: number; fileName: string; page: number }
  ```
- **카드 클릭 → PDF 점프**: 매칭된 PDF 탭 자동 전환 + 해당 페이지로 스크롤 + 추출 목록 항목 노란 강조
  - 불안정한 캔버스 하이라이트 완전 제거 (pdfjs span 분리 문제로 신뢰도 낮음)
  - 텍스트는 드래그 선택 가능(`cursor: text`)
- **자동 매칭 결과 표시**: `🟢 CMS_A.pdf p.2 에서 일치 · 클릭해 이동` 형태
- **대사 완료 출처 기록**: `VState.source`에 확인 PDF 파일명 저장 → 접힌 카드에 `📎 출처: CMS_A.pdf` 표시
- **상태 영속**: localStorage `cms_verify_{company}_{reportDate}` — 창 닫아도 대사 상태 유지
- **카드 접기/펴기**: 대사 완료 카드 `vs.collapsed` 토글
- `DailyReportPage.tsx` 연동: `cmsVerifyUrl` 단일 URL → `cmsVerifyPdfs` 배열 + `cmsInitialIdx` 상태로 전환

#### FX 외화 입출금 native 표시
- `ItemSums.byAccount` 타입 확장: `{ inKrw, outKrw, inRaw, outRaw }` (외화 원단위 별도 추적)
- `useDailyReportSummary.ts` + `DailyReportPage.tsx` liveItemSums: inRaw/outRaw 집계 추가
- `ReportSummaryTable.tsx` `FxRow`: 입금/출금 컬럼 → `fmtFx(inRaw, code)` 표시 (원화환산 컬럼 제거)
- 효과: `전일잔액(USD) + 입금(USD) − 출금(USD) = 마감잔액(USD)` 단순 계산 일치

---

### 2026-06-12 세션 9차 (접근성 점검 + TopBar 티커 + 동적 회사 관리)

#### 접근성 전수 점검 (메뉴·법인 권한)
- **Sidebar 메뉴 필터링**: `NavItem.slug` 추가 → `hasMenu(slug)` 로 항목 필터, 빈 섹션 전체 숨김
- **PolicyPage 법인 제한**: `accessibleCompanies = COMPANIES.filter(hasCompany)` → 단일 법인 계정은 탭/요약이 본인 법인만 표시, 타사 정보 차단
- **UsersPage 역할 툴팁**: master/admin/editor/viewer 카드 hover 시 상세 권한 목록 표시

#### TopBar 주가 티커 오버플로 수정
- 우측 `shrink-0` 컨테이너 안 티커 → **중앙 `flex-1` 마퀴**(`stock-ticker-track`, 4x 콘텐츠 `-25%` 루프, hover 일시정지)로 이동
- 좌우 페이드 그라디언트, 로그아웃·코드관리 등 우측 버튼 항상 표시 보장
- `index.css` `@keyframes stock-ticker-scroll` 추가

#### Sidebar 섹션 상태 영속화
- 유저별 `localStorage` 키 `sidebar_sections_{sb_id}` 에 접기/펴기 상태 저장·복원
- 복원 시 현재 경로가 속한 섹션은 강제 열기

#### 동적 회사 관리 (master 전용) ⭐
- **`Company` 타입**: 하드코딩 union → `string` (DB-driven)
- **`companies` 테이블** 신규 (`docs/db/companies.sql`): name/short_name/active/sort_order, RLS(전체 읽기·master 쓰기)
- **`useCompanies()` 훅** (`src/hooks/useCompanies.ts`): 모듈 캐시 + `invalidateCompanies()` + 비훅 헬퍼 `getCompanyNames()`. 테이블 미생성 시 3법인 FALLBACK
- **`CompaniesPage.tsx`** (`/admin/companies`): 법인 추가/비활성화/삭제, Sidebar "🏢 회사 관리" 메뉴 분리 (사용자 관리와 별도 페이지)
- **전 페이지 하드코딩 제거**: Dashboard/Input/Invest/Loans/Equity/History/DailyReport(List)/DataPage/OrgChart 의 `VALID_COMPANIES`/`COMPANIES` → `getCompanyNames()`·`useCompanies().names`
  - master/admin은 `hasCompanyCheck`(빈 companies=전체)로 신규 법인 자동 접근, editor/viewer는 사용자 관리에서 법인 지정
- **[CRITICAL] hang 수정**: `fetchWithTimeout` 12s abort 시 supabase 호출이 reject → `load()`/회사추가 핸들러에 **try/catch/finally** 필수 (없으면 `setLoading(false)` 미실행 → 무한 로딩/"추가 중" 멈춤). companies 테이블 미생성이 직접 원인이었음

---

### 2026-06-16 세션 12차 (FX 정책 UX 개선 + 운용 외화 합산 + Dashboard 탭 Pending)

#### FxPolicyTab 인터랙티브 UX 개선 ⭐
- **한도 A 산출 근거 항상 표시**: 실효한도 카드 내 2단계 공식 인라인 노출
  - `허용손실 = (영업이익+이자수익) × 위험포션`
  - `한도A = 허용손실 ÷ 최대변동폭`
  - 슬라이더 움직임 시 실시간 업데이트
- **신뢰도 버튼 즉각 반응 (`localConfLevel`)**: 클릭 즉시 z값·maxRateChange·한도A·실효한도 전체 재계산. Supabase 저장은 비동기 후행. 90/95/99% 비교 미니바 추가
- **Target Band 편집 폼에서 제거**: `fx_target_min`/`fx_target_max` 수동 입력 제거 → `🎯 자동설정` 버튼 전용 (거버넌스 유지). bandWidth 클램프 `(2,10)%p → (1,5)%p`
- **통화 비중 입력 즉시 반응 (`localWeights`)**: controlled input에서 async save 후 값 리셋 버그 수정. `onChange` 로컬, `onBlur` Supabase 저장 패턴

#### totalFund 가용 자금 합계로 재정의
- **기존**: `operatingCash + investCash` (운용자금 전체 포함 = 과대 산정)
- **변경**: `operatingCash + investAvailCash + bondAvailCash + equityAvailCash` (가용 항목만 합산)
- `useEquities` 훅 추가 연동, `equities.latest.filter(e => e.available === '가용').reduce(...)` 패턴
- 카드 라벨: "전체 자금 총액" → "가용 자금 합계"

#### 운용자금 외화 합산 (`investFxNative`) ⭐
- **기존**: FX 외화 = 운전자금 `daily.fx_*` 만 집계 (운용자금 외화 누락)
- **변경**: `getLatestInvestments(invest.data)` 에서 `currency != 'KRW'` + `available = '가용'` + `product != '국채'` 필터 → 통화별 합산 `investFxNative: Partial<Record<FxCode, number>>`
- 운전·운용 FX KRW 각각 계산 (`operatingFxKrwByCode`, `investFxKrwByCode`) → 합산 `fxKrwByCode`
- `currentFxKrw`: `latestDaily?.fx_krw` → `totalIndividualFxKrw` (통화별 합산)
- 바 차트: split bar (진한색=운전, 연한색 opacity-40=운용), 통화별 운전/운용 금액 분리 표시

#### Dashboard 탭 네비게이션 (Pending)
- **설계**: TopBar 하단 전체 너비 탭 바 — DASHBOARD 카테고리(통합 상황판·자금일보·자금정책) 페이지에만 표시
- **보류 사유**: 사용자 "일단 Pending"
- **설계 문서**: `docs/pending/DashboardTabNav.md` 작성 완료

---

### 2026-06-15 세션 11차 (모바일 최적화 + 팝업 금액 대사 수정)

#### 모바일 UI 최적화
- **좌우 스크롤 차단**: `Layout.tsx` main에 `overflow-x-hidden` 추가
- **CashflowChart 모바일 렌더링 수정**: `h-full` 단독 → `h-72 md:h-full` (모바일 0px → 차트 미표시 해결)
- **터치 영역 확대**: 범례 버튼 `py-0.5` → `py-1`
- **Ctrl+클릭 힌트**: CashflowChart, EquityCard — 모바일(`hidden md:block`)에서 숨김
- **팝업 모바일 전체 너비**: FlowDetailDrawer, IssueDrawer `w-80` → `w-[calc(100vw-2rem)] max-w-sm max-h-[80vh]`

#### FlowDetailDrawer 팝업 국채 금액 대사 수정 ⭐
- **원인**: KPI는 `calcBondValue(bondQty, bondPrice)`(시가) 사용, 팝업은 `i.amount`(취득원금) 사용 → 불일치
- **AvailableDetail 수정**:
  - 국채 금액 → `calcBondValue` 우선, fallback `i.amount`
  - 국채 표시명 → `i.bondName ?? i.bank`
  - 필터 `!== '불가용'` → `=== '가용'` (KPI와 동일)
- **UnavailableDetail 수정**: 국채(불가용)도 `calcBondValue` 적용
- **영향**: 팝업 표시값만 수정, KPI(`useDashboard.ts`) 계산 로직 변경 없음

---

### 2026-06-16 세션 13차 (자금일보 항목 추가 + 세분화 권한 + 자동 로그아웃 원천 차단)

#### 자금일보 입출금 항목 추가
- 입금: `interest_income`(이자수익) 추가
- 출금: `trade_ap_payment`(외상매입금 지급), `interest_expense`(이자비용), `enote_payment`(전자어음결제) 추가
- `ItemsSection.tsx` IN/OUT_CATEGORIES — **UsersPage 카테고리 권한 탭의 IN/OUT_CAT_LABELS와 반드시 동기화** 유지

#### 사용자 관리 — 법인 필터 칩 + 검색/역할/상태 콤보
- `UsersPage.tsx` — 법인 필터 칩(각 칩에 인원 카운트), 이름·이메일·코드 검색, 역할/상태 드롭다운, `filteredRows` useMemo

#### 사용자별 세분화 권한 (메뉴·카테고리·작업) ⭐
- **DB**: `treasury_users` 에 `allowed_categories jsonb` / `action_permissions jsonb` 추가 (`docs/db/user_permissions_migration.sql` — **Supabase SQL Editor 실행 필요**). 둘 다 `NULL`=역할 기본값 → 기존 동작 100% 유지
- **types**: `SectionKey`/`ActionKey`/`SectionPermission`/`CategoryPermissions`, `TreasuryUser`에 두 필드 추가
- **auth.ts**: `ACTION_DEFAULTS`(역할별 섹션 기본 작업권한), `AuthContextValue`에 `hasCategory(dir, code)`/`canAction(section, action)` 추가
- **AuthContext**: 두 헬퍼 구현 — `null`이면 역할 기본값 fallback, master는 항상 true
- **UsersPage 폼**: 3탭 권한 편집 UI
  - 탭1 메뉴 접근 (기존 `menus` 재배치)
  - 탭2 카테고리 권한 (입금/출금 항목별 허용, 미설정 시 전체 허용)
  - 탭3 작업 권한 매트릭스 (섹션 × 조회/입력·수정/삭제 체크박스, `disabled` 셀=해당없음)
  - 목록에 `메뉴↑`/`카테고리↑`/`작업권한↑` 배지 추가
- **소비처**: `ItemsSection`(드롭다운 `hasCategory` 필터), `Input/Invest/Loans/EquityPage`(`canAction('섹션','write')` 2차 게이트)
- **접근 제어**: UsersPage 자체는 여전히 master 전용 (`Navigate` 가드 + `hasMenu('admin')`), TopBar '코드 관리'도 master 전용

#### [CRITICAL] 자동 로그아웃 원천 차단 (멀티탭·다중사용자 환경) ⭐
```
증상: 로그인 후 일정 시간(주로 1시간)·탭 복귀 시 "튕기듯" 로그아웃 반복.
       퍼블리싱 사이트에서 여러 탭/동시접속 시 빈발.

[원인 1] onAuthStateChange 가 TOKEN_REFRESHED(access token 1시간 TTL 자동갱신,
  탭 복귀 시에도 발생) 마다 loadProfile() 재조회 → fetchWithTimeout 5s/withTimeout 6s
  내 순간 네트워크 지연·실패 시 catch → setUser(null) → Layout 의 !user 가드가
  즉시 /login 으로 보냄. 세션(refresh token)은 멀쩡한데 코드가 자발적 로그아웃.
  해결: onAuthStateChange 이벤트별 분기 + 세션 유효 시 절대 setUser(null) 금지.
    - SIGNED_OUT: clearProfileCache + setUser(null) (진짜 로그아웃만)
    - TOKEN_REFRESHED: no-op (user 유지, 새 토큰은 SDK가 localStorage 자동반영)
    - SIGNED_IN/USER_UPDATED: userRef.current 있으면 skip(깜빡임·법인초기화 방지),
      없을 때만 백그라운드 프로필 로드 — 실패/null 이어도 setUser(null) 안 함
    - userRef(useRef) + useEffect 로 최신 user 동기화

[원인 2] lock: noopLock(Web Locks 완전 우회, 세션12차 로그인 데드락 대응) →
  멀티탭에서 각 탭이 독립적으로 토큰 갱신 → refresh token 회전(rotation) 경쟁 →
  invalid_grant → 전 탭 동시 SIGNED_OUT.
  해결: safeLock 도입 (src/lib/supabase.ts).
    - navigator.locks.request 로 크로스탭 토큰 갱신 직렬화 → 회전 경쟁 차단
    - 획득 대기 AbortController 4s 타임아웃 → 경합/wedge 시 degrade(직접 실행)
      → 과거 로그인 데드락 재발 방지
    - acquireTimeout===0 은 ifAvailable, 그 외 signal 대기
    - fn 내부 에러는 재실행 안 함(acquired 플래그로 중복 실행 방지)

금지: onAuthStateChange 에서 프로필 재조회 실패를 이유로 setUser(null) 호출 금지.
       lock 을 다시 no-op 으로 되돌리지 말 것(멀티탭 동시 로그아웃 재발).
검증: preview_eval 로 navigator.locks.query() → held/pending 비어있고,
       새로고침 후 로그인 유지 + 대시보드 정상 렌더 확인.
```

---

### 2026-06-24 세션 15차 (법인 권한 누수 fix + P1~P3 UI개선 + 자금일보 FX 검증 통일)

#### 법인 권한 누수 4개소 수정 (30e0e0d)
- `AuthContext.tsx` — admin 역할도 `companies[]` 기반 `currentCompany` 결정 (기존: 무조건 '셀바스에이아이')
- `TopBar.tsx` — 법인 드롭다운 `allCompanyNames.filter(c => hasCompany(c))`
- `usePageCompany.ts` — URL param 법인도 `hasCompany()` 통과 검증
- `DailyReportListPage.tsx` / `DailyReportPage.tsx` — 법인 탭 목록도 hasCompany 필터

#### P1~P3 UI/UX 개선 (다수 커밋)
- B1 자동기재 effect — editor 이하 계정에서 `if (!canEdit()) return` 가드
- B2 FX 환율 연결 끊김 표시 (Sidebar)
- B3 순차 결재선 — `nextStep` 기반 `canApprove` 로직
- B4 백그라운드 탭 주가 폴링 억제 (`document.hidden` 체크)
- C2 DeltaCell ▲▼ 글리프 (색맹 접근성)
- C5 공통 토스트 인프라 (`ToastProvider`) + InputPage/LoansPage/EquityPage 적용
- D1 `src/lib/treasuryCalc.ts` SSOT 유틸 (opCashKRW/toKRWAmount/bondValueOf)
- D2 `src/hooks/usePageCompany.ts` 페이지 법인 해석 공통화 (9개 페이지 적용)
- D4 `src/lib/issueLink.ts` 이슈↔원천 역링크 (IssueHistoryPage/LoansPage/EquityPage)
- D5 FlowDetailDrawer SHORTCUTS 맵 + fx 딥링크 추가
- ReportSummaryTable: bondEvalIn/Out, equityEvalIn/Out 분리 (중복 평가손익 해소), 운용자금 in/out 방향 정정

#### [CRITICAL] 자금일보 검증 FX 환율 기준 통일 ⭐
```
증상: 입출금 항목 완성 후 "X억 차이 발생" — 실제 오류 없는 경우에도 통과 불가.
원인: 항목 amount_krw(항목 저장 시점 환율) vs daily.fx_krw(InputPage 저장 시점 환율)
      기준 날짜·환율이 다르면 FX 환율 변동분만큼 자동으로 차이 발생.
      예) USD +384K × (1,537 − 1,509) = 약 0.41억 불일치.
해결: DailyReportPage 검증 useMemo를 현재 시세 기준으로 통일.
  1. 항목 금액: amount_krw(저장값) → toKRW(amount, currency) 현재 시세 재계산
  2. 잔액증감: daily.fx_krw(저장값) → daily.fx_usd/eur/jpy/gbp/cny × 현재 시세 합산
  → 두 값 모두 동일 시점 환율 기준 → 환율 차이 제거.
금지: 검증에서 amount_krw(저장값)와 daily.fx_krw(저장값)를 혼용하지 말 것.
```

---

### 2026-06-17 세션 14차 (결재선 버그 원천해결 + 평가손익 유령항목 제거)

#### UserPicker 포털 + InvestPage 외화 합산 (연속 작업)
- **UserPicker 드롭다운 클리핑 해결**: `createPortal(document.body)` + `position:fixed` 로 overflow:hidden 조상 탈출. **리스트 컨테이너는 Tailwind 대신 인라인 스타일**(`style={{ maxHeight:220, overflowY:'auto' }}`)로 height/overflow 보장 (포털 렌더 시 Tailwind 클래스 불안정). 트리거 `getBoundingClientRect` 기준 위치 계산, 스크롤/리사이즈 재계산, 외부 클릭 감지(`userpicker-portal` 컨테이너 체크)
- **InvestPage KPI 외화 원화환산**: `useFx().toKRW()` 도입, `toKRWAmt(amount, currency)` 헬퍼로 USD/EUR 정기예금을 `totalAvail`/`totalUnavail` 합계에 원화환산 반영 (기존 외화 누락 수정). `useDashboard.ts` 와 동일 패턴

#### 결재선 설정(OrgChartPage) 안정화 ⭐
- **[CRITICAL] 탭 전환 후 빈 화면 — 자동 fetch 누락 원천 해결**
  ```
  증상: 회사 탭 전환 후 돌아오면 결재선이 비어 보이고, '추가' 하면
        기존 저장 데이터가 되살아남(유일 트리거가 upsert 내부 await fetch()).
  원인: key={activeCompany} 재마운트 모델에서 ApprovalConfigPanel /
        useApprovalConfig 어디에도 마운트 시 fetch() 호출이 없었음.
        → 재마운트 시 config=[] 인 채로 조회가 일어나지 않아 빈 화면.
  해결: useApprovalConfig 훅에 useEffect(() => void fetch(), [fetch]) 추가.
        company 변경/마운트 시 항상 자동 조회.
  ```
- **직전 디버그 변경 정리(같은 버그 우회 시도였음)**:
  - `setConfig([])` 제거 — 탭 전환마다 즉시 빈 배열 초기화가 "비어 보임"을 악화시킴
  - 결재선 fetch `restGet`(5s abort) → `supabase.from().select()` 복원 (콜드 연결 abort로 빈 상태 고정되는 문제 차단)
  - 디버그 `console.log` 제거
- **결재선 테이블에 '이름' 컬럼 추가**: 단계/직책/결재자코드/관리 → **단계/이름/직책/결재자코드/관리**. `treasury_users` 에서 `user_code→name` 매핑 조회해 표시 (미매핑 시 `—`)

#### 자금현황 소계 입출금 표시 정합성 수정 (ReportSummaryTable)
- **평가손익 evalIn/evalOut 혼용 → 중복 표시 해소**: `invest_eval_*` 는 국채·지분
  공용 카테고리라 `itemSums.evalIn/evalOut`(전체 합산)을 비예금성 소계·지분 소계에
  그대로 쓰면 같은 평가손익이 양쪽에 중복 노출됨(예: 지분 평가손실 44,492,890이
  비예금성 소계 출금액에도 표시). → `byBondLabel`(국채별)/`byEquityName`(지분별)에서
  섹션 전용 합계(`bondEvalIn/Out`, `equityEvalIn/Out`)를 따로 산출해 분리.
  ※ 표시 전용 — 마감잔액·Δ·총합계는 섹션별 잔액에서 독립 산출되어 금액 오염 없음.
- **운용자금 입/출금 방향 정정**: 운용자금 '잔액 관점'으로 통일 —
  신규집행(`invest_execute`=investIn)=입금↑, 회수/해지(`invest_return`=investOut)=출금↓.
  기존 예금성 행·운용자금 소계가 반대로 매핑돼 있던 것 수정.
  (재예치=출금+입금 병기 / 만기해지=운용 출금+대체계좌 입금 / 신규=보통예금 출금+운용 입금)

#### [CRITICAL] 평가변동 0 복귀 종목의 유령 평가손익 항목 제거 ⭐
```
증상: UltraSight Inc. 등 평가액 변동이 없는 종목이 전액(취득가)을
      '투자자산평가' 출금으로 계속 집계됨.
원인: 지분/국채 평가손익 자동기재 effect(DailyReportPage)가 '현재 평가변동이
      있는' 종목만 candidates로 필터 → 변동이 0으로 돌아간 종목은 candidates에서
      빠짐. 그러나 정리 로직은 동일 memo 중복 제거만 할 뿐, 더 이상 후보가
      아닌 과거 @auto 항목을 삭제하지 않음. 게다가 if(!candidates.length) return
      조기 반환으로 변동이 모두 0이면 정리 자체가 미실행.
      → 과거(prev 평가액=0/누락 시점)에 생성된 @auto:UltraSight Inc.
        = 1,378,000,000 항목이 데이터 정상화 후에도 유령으로 잔존.
해결(지분·국채 effect 양쪽):
  - 조기 반환 조건을 (후보 없음 && 일보 없음) 으로 완화 — 일보가 있으면
    후보가 없어도 stale 정리를 위해 진행. 신규 일보 생성은 후보 있을 때만.
  - 현재 유효 후보(@auto 키 집합)에 없는 자동항목을 삭제하는 로직 추가.
    지분 effect는 @auto:bond:% 를 건너뛰고(국채 전담), 국채 effect는
    @auto:bond:{label} 자기 키만 정리.
  - 정리는 해당 일보를 다시 열 때 자동 실행됨.
금지: candidates 필터만 보고 insert/update만 하지 말 것 — 후보에서 빠진
      과거 @auto 항목의 회수(삭제) 경로를 항상 함께 둘 것.
```

---

### 2026-06-15 세션 10차 (다크모드 B안 팔레트 + 로그인 hang 근본 해결)

#### 다크모드 B안 (블루-다크 재무 팔레트) 전면 적용 ⭐
- **배경**: `gray-*` → `slate-*` (파란 틴트, 재무 앱 분위기)
  - body dark background: `#111827` → `#0f172a` (`src/index.css`)
  - `dark:bg-gray-950/900/800/700` → `dark:bg-slate-950/900/800/700`
- **텍스트 대폭 밝아짐** (WCAG 대비 향상):
  - `dark:text-gray-300` → `dark:text-slate-100` (primary 텍스트, `#d1d5db` → `#f1f5f9`)
  - `dark:text-gray-400` → `dark:text-slate-300` (secondary 텍스트)
  - `dark:body color`: `#f9fafb` → `#f1f5f9`
- **테이블 헤더 blue accent**: `NotionTable.tsx` th `dark:text-slate-300` → `dark:text-sky-300`
- **보더**: `dark:border/divide-gray-700/600` → `dark:border/divide-slate-700/600`
- **누락 dark: 수정**: `tabular-nums text-gray-600` → `dark:text-slate-100` (EquityHistoryPanel, BondHistoryPanel, DataPage), Sidebar 환율 섹션, DataPage 섹션 헤더
- 영향 파일: 45개 tsx/ts + index.css (PowerShell 일괄 치환)

#### 다크모드 누락 패널 수정
- `EquityHistoryPanel.tsx`, `BondHistoryPanel.tsx` — form/input/select/label 전체 `dark:` 추가
- `NewEquityForm.tsx`, `NewBondForm.tsx` — 후보 드롭다운, 재조회 버튼 `dark:` 추가

#### TopBar `?` 도움말 툴팁 클리핑 수정
- 커스텀 `<span>` 툴팁 (overflow:hidden 헤더 안에서 잘림) → `title="도움말"` native 속성으로 교체

#### 로그인/네비 "로딩 중..." 영구 hang 근본 해결 (D안)
- **D안 3겹 방어**:
  1. `fetchWithTimeout` 5s — 네트워크 레이어
  2. `withTimeout(6s)` — `loadProfile()` 포함 모든 supabase Promise 감싸기 (wedge 상태 차단)
  3. `resetSupabaseClient()` — 타임아웃/오류 감지 시 클라이언트 재생성 후 1회 재시도
  4. `hardTimeout(8s)` — AuthContext loading 안전장치
  5. Global Watchdog (Layout.tsx) — 15s 후 DOM 체크(`main` 콘텐츠 100자 이상 + 스피너 없음) → 정상이면 발동 안 함, stuck이면 카운트다운 오버레이 → 자동 새로고침
     - **오탐 수정 (세션10차)**: 기존 "8s 무상호작용→무조건 발동"에서 DOM 콘텐츠 체크 추가. 사용자가 페이지를 가만히 보기만 해도 발동되는 오탐 차단
- **핵심 수정**: `supabase.ts` — `export let supabase = makeClient()` + `resetSupabaseClient()` 함수
- **ES 모듈 live binding** — 재생성 즉시 모든 import 위치가 새 클라이언트 참조

#### Watchdog 오탐 수정 (A안)
- **원인**: "8s 무상호작용 → 무조건 오버레이" 로직이 정상 로딩 페이지에서도 발동 (사용자가 가만히 보기만 해도 트리거)
- **수정** (`Layout.tsx`): 타이머 8s → **15s**, 타이머 후 DOM 체크 추가
  - `main` 콘텐츠 100자 이상 + 스피너(`animate-spin`) 없음 + `불러오는 중` 텍스트 없음 → 발동 안 함
  - stuck 상태(빈 화면 / 스피너 지속) 일 때만 카운트다운 오버레이 표시

#### ESLint 에러 10건 수정 (CI 통과)
- `DataPage.tsx` / `UsersPage.tsx` — 훅보다 앞에 `early return` 배치 → 훅 이후로 이동 (Rules of Hooks)
- `PolicyCTab.tsx` — 삼항 표현식 statement → `if/else` (`no-unused-expressions`)
- `CashflowForecastTab.tsx` — `useMemo` deps `[plan.data]` → `[plan]`
- `DailyReportPage.tsx` — `useMemo` missing `summary` dep × 2 → `eslint-disable` 추가
- `DailyReportPage.tsx` — `ref.current` 렌더 중 갱신 → `react-hooks/refs` disable 추가
- `useTableSettings.ts` — `useEffect` missing `user` dep → `eslint-disable` 추가
- `eslint.config.js` — react-hooks v7 React Compiler 규칙 비활성화
  - `immutability` / `refs` / `purity` / `error-boundaries` → `'off'` (이 프로젝트는 React Compiler 미사용)
  - `rules-of-hooks` / `exhaustive-deps` 핵심 규칙은 유지

#### 가용자금 합계 계산 범위 확장
- **변경**: `availableCash = 운전자금 + 가용운용자금 + 가용국채 + 가용 지분/장기투자`
  - 기존: 지분 가용분이 어디에도 합산 안 됨 → 수정: `equityAvail` 포함
- `useDashboard.ts` — `availableCash` 계산식에 `equityAvail` 추가
- `DashboardPage.tsx` — KpiCard 부제목: `가용지분 X` 항목 추가 (>0일 때만 표시)
- `FlowDetailDrawer.tsx` — `AvailableDetail` 팝업에 **가용 지분/장기투자** 섹션 추가 (종목별 평가액 목록)

---

### 2026-06-25 세션 16-2차 (대시보드 초기 0원 근본 해결)

#### [CRITICAL] 첫 로드 시 데이터 0원 — supabase-js SELECT가 토큰 갱신 락 뒤에서 대기 ⭐
```
증상: 로그인 후 대시보드 첫 오픈 시 모든 KPI/자금흐름 0원. 새로고침(F5) 하거나
       다른 법인 선택 후 돌아오면 정상 표시. (Supabase Auth 이메일 로그인 계정에서만)

오진 주의: "company 해석 타이밍" 으로 보고 usePageCompany().company 를
  useDashboard 에 전달하는 fix(커밋 b1b305d)를 먼저 했으나 효과 없음.
  company 는 fallback 으로 항상 즉시 '셀바스에이아이' 로 해석됨 → 원인 아님.

진단(재현):
  - 레거시(접근코드) 세션을 sessionStorage 에 주입하면 첫 로드에 정상(77.9억).
    레거시는 supabase.auth 를 전혀 호출하지 않음 → auth 와의 경합이 원인임을 확정.
  - anon REST 직접 쿼리는 200·데이터 정상 → 데이터/쿼리 문제 아님.

원인: Supabase Auth 경로는 첫 로드 시 autoRefreshToken 이 토큰 갱신을 트리거.
  fetchWithTimeout 은 /auth/v1/ 요청에 타임아웃을 적용하지 않음(의도적 — 갱신 abort 시
  SIGNED_OUT 유발 방지). 그 사이 supabase-js .from().select() 가 내부 _getAccessToken()
  단계에서 갱신 락(safeLock) 뒤에 대기 → 호출부 withTimeout(6s) 초과 → catch →
  data 는 setData([]) 인 채 굳음 + 재시도 경로 없음.
  F5/법인전환 시엔 토큰이 이미 신선해 갱신이 안 일어나 select 즉시 성공.

해결: 데이터 읽기 훅을 supabase.from().select() → restSelect() (PostgREST 직접 호출)로 전환.
  - src/lib/supabase.ts: restSelect(table, { match, order, limit }) 신규.
    restHeaders()로 localStorage 토큰을 즉시 사용 → 갱신 락과 무관. fetchWithTimeout(5s) 내장.
  - 전환 대상: useDaily / useEquities / useInvestments / useLoans / useIssues.
  - 쓰기는 이미 REST 헬퍼(restInsert/Update/Delete/Upsert) 사용 중 → 읽기까지 통일.

금지: "읽기(SELECT)는 supabase.from().select() 사용 — wedge 유발 안 함" 이라는 과거 주석은
  토큰 갱신 락 경합 케이스를 누락한 것. 신규 데이터 목록 조회는 restSelect 사용 권장.
  company 미해석으로 오진하지 말 것 — 레거시 세션 주입으로 auth 경합 여부부터 가를 것.
```

---

### 2026-07-16 세션 19차 (주간예측 항목별 입력+엑셀 임포트 + 대시보드/정책 SSOT 불일치 3건 수정)

#### Task 1: 주간예측(CashflowForecastTab) 항목별 입력 + 엑셀 임포트/템플릿
- **`docs/db/cashflow_plan_items.sql`** (신규) — 12주 롤링 포캐스트를 주 단위 합계(`cashflow_plan`)가 아닌
  카테고리별 항목 단위(`cashflow_plan_items`)로 세분화 입력할 수 있도록 하는 마이그레이션.
  **⚠ 미실행 상태 — Supabase SQL Editor에서 반드시 실행 필요** (미실행 시 "+ 추가" 클릭하면
  `Could not find the table 'public.cashflow_plan_items'` 에러, 앱은 크래시 없이 안내만 표시).
- `src/hooks/useCashflowPlan.ts` — REST 헬퍼 기반으로 재작성. `items`/`addItem`/`updateItem`/
  `removeItem`/`bulkSyncFromImport` 추가.
- `src/lib/dailyReportCategories.ts` (신규) — 기존 `ItemsSection.tsx`(컴포넌트 파일)에서
  `IN_CATEGORIES`/`OUT_CATEGORIES`/`CategoryDef`를 독립 모듈로 추출.
  **이유**: 컴포넌트 파일이 컴포넌트+상수를 동시에 export하면 `react-refresh/only-export-components`
  ESLint 에러 발생 (Fast Refresh 제약) → 상수 전용 모듈 분리로 해결.
  `ItemsSection.tsx`/`CashflowForecastTab.tsx`/`WeekCashflowModal.tsx` 모두 여기서 import.
- `src/lib/cashflowExcel.ts` (신규) — `downloadCashflowTemplate()`(엑셀 템플릿 다운로드),
  `parseCashflowExcel()`(업로드 파싱 + 법인/주차/카테고리/금액 검증, 행별 오류 메시지 반환).
  `xlsx`(SheetJS) 의존성 추가.
- `src/components/policy/WeekCashflowModal.tsx` (신규) — 특정 주×방향(입금/출금) 클릭 시
  카테고리+금액+메모 단위 CRUD 모달. 평가손익(`invest_eval_*`)은 자금일보 자동생성 전용이라
  계획 입력 대상에서 제외.
- `src/components/policy/CashflowForecastTab.tsx` — 주별 셀 클릭 → `WeekCashflowModal` 오픈,
  엑셀 임포트/템플릿 다운로드 버튼 추가.
  **버그 수정**: `isPast` 판정이 `row.week(월요일) < today` 로 계산되어 "이번 주"가 월요일이
  아닌 모든 요일에 과거로 오판되어 입력 폼이 숨겨짐 → `isWeekPast(weekStart, today)` 헬퍼로
  주의 **일요일(종료일)** 을 기준으로 비교하도록 수정.

#### Task 2: 대시보드 자금흐름 팝업 3건 — SSOT 불일치 수정 (`FlowDetailDrawer.tsx`)
사용자 리포트: "운용자금 상세" 팝업이 대시보드 메인 화면과 다른 금액을 보여줘 혼동됨.
- **가용운용 팝업에 불가용 항목 혼입**: `InvestDetail` 호출부에 `available === '가용'` 필터
  누락 → 가용+불가용이 섞여 표시됨. 호출부 필터 추가 + footer 합계를 `kpi.investCash`
  (대시보드가 쓰는 것과 동일 SSOT 값)로 고정해 구조적으로 항상 일치하도록 함.
- **가용운용 외화 미표시**: `InvestDetail`이 외화 항목을 `toKRWAmt`로 환산하지 않고 원 통화
  그대로 노출 → `AvailableDetail`과 동일한 통화 배지(`{inv.currency}`) 패턴 적용.
- **외화(환산) 총액 불일치**: `FxDetail`이 운전자금 외화(`daily.fx_*`)만 표시하고 운용자금
  외화는 누락 → 대시보드의 "외화(환산)"(운전+운용 합산)보다 항상 작게 표시됨.
  `latestInvests`를 받아 운용자금 가용 외화(통화별)를 합산, "운전 X + 운용 Y" 형태로 병기.
  합계도 대시보드와 동일한 `(daily.fx_krw ?? 0) + kpi.investFxKrw` 공식으로 통일.
- 검증(브라우저, 셀바스헬스케어 계정): 운용자금 상세 합계(가용) 30.0억원 = 대시보드
  가용 운용 30.0억원 일치 / 외화 상세 합계 41.8억원 = 대시보드 외화(환산) 41.8억원 일치.

#### Task 3: 자금정책 "외화 비중" 카드 — FX정책 탭과 수치 불일치 수정 (`usePolicyDashboard.ts`)
사용자 리포트: 회의·의결 탭 외화비중 카드가 6.2%, FX정책 탭은 27.9% — 서로 다르게 표시됨.
- **원인**: `computePolicyData()`가 국채(bonds)를 `product === '국채'` 필터만 적용해 합산.
  국채는 기준가 갱신 시마다 날짜별 이력 row가 쌓이고 전부 `active=true`로 남는데,
  종목(bondTicker/bondName)별 최신 1건만 남겨야 할 것을 dedup 없이 전부 합산 →
  가용 자금 합계(분모)가 실제보다 수배(4076억 vs 911억) 부풀려짐 → 외화비중이 실제보다
  훨씬 낮게 계산됨. `FxPolicyTab.tsx`는 이미 `getLatestBonds()`로 dedup 하고 있어 정상.
- **해결**: `usePolicyDashboard.ts`에서 `useInvestments.ts`의 `getLatestBonds()` 재사용 —
  `investData.filter(i => i.product === '국채')` → `getLatestBonds(investData)`로 교체.
- 검증(브라우저, 메디아나 법인): 회의·의결 탭 27.9%/254.4억원, FX정책 탭 27.9%/253.8억원,
  가용 자금 합계 양쪽 모두 911.2억원 — 완전 일치 (기존 6.2%/4076.7억원에서 정상화).

#### 커밋 이력 (이번 세션)
```
74afb25 feat: 주간예측 카테고리별 입출금 상세 입력 + 엑셀 임포트
b4911ed fix: 대시보드 자금흐름 팝업이 요약 수치와 불일치하던 3건 수정
b58a3a4 fix: 자금정책 페이지 외화비중 카드가 FX정책 탭과 다른 값 표시하던 버그 수정
```

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
| 공휴일 조회 | `?type=holidays&year=YYYY` | ✅ 운영 중 (스크립트속성 HOLIDAY_API_KEY 필요) |

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

### DB 마이그레이션 미적용 (실행 필요)
- **`docs/db/rls_enable_all.sql`** ⭐ — Supabase Security Advisor `rls_disabled_in_public` 경고 해소. 전 public 테이블 RLS 활성화 + anon/authenticated permissive 정책. **반드시 SQL Editor 실행**. ⚠ permissive라 anon 키 노출 시 데이터 접근은 여전히 가능 → 완전 차단은 authenticated 전용 전환(로드맵) 필요.
- **`docs/db/daily_report_tables.sql` §8-1** — category CHECK 제약에 신규 항목(`interest_income`/`trade_ap_payment`/`interest_expense`/`enote_payment`) 추가. **미실행 시 해당 입출금 항목 저장이 제약 위반으로 실패**.
- **`docs/db/user_permissions_migration.sql`** — `treasury_users.allowed_categories` / `action_permissions` 컬럼 (세션13차 세분화 권한). 미실행 시 카테고리/작업 권한 탭 저장이 컬럼 부재로 실패. 읽기는 `null` fallback이라 앱은 정상.
- **`docs/db/fx_trade_history.sql`** — 외화매매거래 이력 (이전 세션)
- **`docs/db/user_password_policy.sql`** ⭐ — `treasury_users.must_change_password` 컬럼 (세션18차 비밀번호 정책). **실행 필요**. 미실행 시 마스터의 "비번초기화" 버튼은 Auth 비밀번호는 바꾸지만 강제변경 플래그 갱신이 실패(컬럼 없음) — Edge Function은 500 반환.
- **`docs/db/cashflow_plan_items.sql`** ⭐ — `cashflow_plan_items` 테이블 (세션19차 주간예측 항목별 입력). **실행 필요**. 미실행 시 주간예측 탭 "+ 추가"가 `Could not find the table 'public.cashflow_plan_items'` 에러로 실패 (앱 크래시는 없음, 안내 메시지만 표시).

### ⚠️ 비밀번호 찾기/초기화 — 배포 전 필수 수동 작업 3건 (세션18차)
```
구현 완료(코드): ResetPasswordPage(/reset-password) + ChangePasswordForm 공용 컴포넌트 +
  ForcePasswordChangeGate(Layout에서 user.must_change_password=true 시 강제 표시) +
  AuthContext.recoveryMode/updatePassword + UsersPage "🔑 비번초기화" 버튼(master 전용,
  supabase.functions.invoke('admin-reset-password') 호출).

아래 3가지는 코드만으로 완결 불가 — Claude가 Supabase 대시보드/CLI 접근 권한이 없어
사용자가 직접 수행해야 함:

1. DB 마이그레이션: docs/db/user_password_policy.sql 을 Supabase SQL Editor에서 실행.

2. Edge Function 배포 (관리자 "비번초기화" 버튼이 동작하려면 필수):
     supabase functions deploy admin-reset-password
     supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<프로젝트 service_role 키>
   (SUPABASE_URL/SUPABASE_ANON_KEY는 Edge Function 런타임에 기본 주입됨)
   service_role 키는 Supabase 대시보드 Project Settings → API 에서 확인. 이 키는
   절대 클라이언트 번들에 넣지 말 것 — Edge Function 시크릿에만 저장.

3. Redirect URL 허용목록 등록 (비밀번호 찾기 이메일 링크가 동작하려면 필수):
   Supabase 대시보드 → Authentication → URL Configuration → Redirect URLs 에 추가:
     http://localhost:5175/reset-password
     https://treasury.selvas.com/reset-password
   ⚠ 미등록 시 Supabase가 resetPasswordForEmail의 redirectTo를 무시하고 Site URL(origin)
   로 잘라버려 /reset-password 에 도달하지 못함 — "비밀번호 찾기 메뉴가 무용지물"이었던
   2026-07-01 실사용 버그의 원인. (부가로 index.html의 404-fallback 복원 스크립트가
   해시(#access_token=...)를 보존하도록도 수정함 — GitHub Pages 배포본에서 recovery
   토큰이 유실되는 것 방지.)
```

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

### [CRITICAL] ⛔ Supabase 프로덕션 데이터 직접 조작 절대 금지 ⭐⭐⭐

```
2026-06-25 실제 발생한 사고:
  셀바스헬스케어 equities 테이블에서 company 태그 오류로 보이는 KOSDAQ 종목 106건을
  Claude가 사용자 최종 확인 없이 REST API DELETE로 직접 삭제.
  → 셀바스헬스케어의 정상 보유 메디아나(1,083,591주, 취득가 70억)와
    자기주식(22,985주) 이력 49건 × 2종목 = 98건이 함께 소멸.
  → 2026-04-14~06-25 일별 시세 이력 전부 손실, 수작업 복구 필요.

금지 원칙 (절대 예외 없음):
  1. 프로덕션 DB(Supabase)에 Claude가 직접 DELETE/UPDATE/INSERT 실행 금지.
     단순 데이터 확인(SELECT/GET)은 허용.
  2. "오류 데이터 같다"는 Claude의 판단만으로 삭제 진행 금지.
     반드시 사용자에게 삭제 대상 목록을 제시하고 명시적 승인을 받을 것.
  3. 삭제 전 반드시 복구 계획 확인:
     - Supabase PITR 활성화 여부
     - audit_logs before_data 저장 여부
     - 데이터 백업 여부
     복구 불가능한 경우 "삭제 불가, 수동 확인 필요" 안내 후 중단.
  4. 데이터 오류 의심 시 처리 절차:
     ① SELECT로 오류 의심 데이터 목록 조회 → 사용자에게 보고
     ② 사용자가 내용 검토 후 삭제 여부 결정
     ③ 사용자 승인 후 Claude가 실행 (또는 사용자가 직접 Supabase 대시보드에서 처리)
  5. 이 규칙은 "실수 수정" "데이터 정리" "오류 조치" 어떤 명목으로도 우회 불가.

위반 시 영향: 복구 불가 데이터 손실 → 수십~수백 건 수작업 재입력 필요.
```

### [CRITICAL] GAS UrlFetch 일일 할당량 폭발 → 전 시세/환율 조회 불가 ⭐ (세션17차)
```
증상(2026-07-01 실장애): 실시간 환율·주가 티커 전부 조회 안 됨. Sidebar "환율 연결 끊김",
      상단 티커 "시세 연결 끊김". FxPage에 GAS 응답 그대로 노출:
      { "success":false, "error":"Exception: 하루에 urlfetch 서비스를 너무 많이 호출했습니다." }
      → GAS 무료계정 UrlFetchApp 일일 할당량(2만회) 소진. 태평양 자정(≈KST 16~17시) 리셋.
      네트워크 로그에 동일 GAS 요청 수백 건 ERR_ABORTED/ERR_FAILED (호출 빈도만 증가).

원인:
  1) [근본] useFx()가 11곳+ 에서 각각 독립 GAS ?type=fx 호출 — 공유 캐시·중복제거 없음.
     자금정책 페이지(PolicyKpiTab + usePolicyDashboard가 법인별 useFx 인스턴스 생성) 진입 시
     동시 다발 호출. + 5분 폴링(FxPage/StockTicker) + Tier1 자동갱신(4법인×종목/국채) 중첩.
  2) [증폭] 할당량 초과 시 GAS 응답이 ~12s로 느려짐 → TIMEOUT(당시 30s) 근처 → 1회 재시도로 배가.
  3) 날짜/기준일 미갱신·"2026-06-30 기준" 표시는 모두 이 장애의 *증상* (별도 버그 아님).

해결(3겹):
  ① 공유 FX 캐시 + in-flight 중복제거 (src/hooks/useFx.ts) — 모듈레벨 sharedRates/sharedAt/
     inflight + listeners. TTL 4분 내 재사용(네트워크 0), 동시 요청은 단일 프로미스 공유.
     → 11+ 인스턴스가 4분당 GAS 1건으로 수렴. ⚠ toKRW/반환객체 메모이즈 유지(무한루프 회귀 방지).
  ② 클라이언트 서킷브레이커 (src/hooks/useGas.ts) — 응답 success:false && error가 quota 문구면
     gasBlockedUntil = now + 10분 설정(localStorage 'treasury_gas_blocked_until' 영속, 리로드에도 유지).
     차단 중 gasGetOnce는 fetch 전 즉시 throw → 폭주·추가 소모 차단. 10분 쿨다운 후 1회 프로브로 자가복구.
     export isGasBlocked()/gasBlockedRemainingMs().
  ③ 재시도 억제 — TIMEOUT_MS 30s→20s. Tier1 자동갱신은 isGasBlocked() 시 break + 오늘분 미마킹
     (할당량 리셋 후 다음 마운트에서 재시도되도록).

검증: 서킷브레이커 활성 상태에서 정책 페이지 이동 → 신규 GAS 요청 0건(performance API resource 카운트).
금지: useFx를 인스턴스별 독립 호출로 되돌리지 말 것(공유 캐시 필수). 서킷브레이커 제거 금지.
근본대책(추후): GAS 계정을 Workspace로 전환(할당량 10만회) 또는 환율은 별도 무료 API 직접 호출 검토.
```

### [CRITICAL] supabase-js Web Locks 데드락 → 로그인 '처리 중...' 무한 행
```
증상: 로그인 버튼 클릭 시 "처리 중..." 에서 영구 멈춤 (Chrome·미리보기 동일)
      캐시 삭제하면 일시 해결되나 재발. signInWithPassword 가 반환 안 함.
원인: supabase-js v2 는 모든 auth 작업(signIn/getSession/토큰갱신)을
      navigator.locks 의 exclusive 락 `lock:sb-{ref}-auth-token` 으로 감싼다.
      락 보유자가 한 번 멈추면(탭전환·새로고침 중 갱신 중단 등) 락이 영구 점유 →
      이후 모든 auth 호출이 같은 락을 무한 대기.
진단: preview_eval 로 `await navigator.locks.query()` → held 에
      `lock:sb-..-auth-token` 이 남아 있으면 확정.
해결: createClient 의 auth.lock 을 no-op 으로 교체 (src/lib/supabase.ts).
      단일 탭 앱이라 크로스탭 락 조정 불필요 → 데드락 원천 차단.
      async function noopLock(_n,_t,fn){ return fn() }
      createClient(url,key,{ auth:{ lock:noopLock, persistSession:true,
        autoRefreshToken:true, detectSessionInUrl:true }, global:{fetch:fetchWithTimeout} })
금지: getUser() 등 signIn 직후 불필요한 2차 네트워크 호출 추가 — hang 위험 가중.
      signInWithPassword 응답의 data.user 를 그대로 사용할 것.
```

### [CRITICAL] 훅 반환 객체·함수 미메모이즈 → 무한 렌더 루프 (자금일보 무한 로딩)
```
증상: 자금일보 작성 페이지 재진입 시 "일보 데이터 불러오는 중…" 영구 멈춤 + 콘솔 에러 다수
원인: useFx() 가 매 렌더마다 새 객체 { rates, ..., toKRW } 와 새 toKRW 함수를 반환.
      → useDailyReportSummary 의 toKRW(useCallback dep [fx])·investGroups/equityGroups
        (useMemo dep [toKRW]) 가 매 렌더 새 참조 생성
      → 이 배열을 deps로 가진 자동기재 useEffect 가 매 렌더 실행 + setState
      → "Maximum update depth exceeded" → React 가 커밋 중단, 스피너 상태로 프리즈
진단: REST 쿼리는 정상(200, 빠름)인데 스피너만 멈춤 + 콘솔 에러 누적이면 렌더 루프 의심.

해결 1 — 훅 메모이즈 (useFx.ts):
      toKRW → useCallback([rates]), 반환객체 → useMemo([rates,...,toKRW]).
      커스텀 훅이 반환하는 객체·콜백은 반드시 useMemo/useCallback 으로 메모이즈.

해결 2 — useRef latest-value 패턴 (DailyReportPage.tsx):
      파생 배열(equityGroups, investGroups)이 deps에 있는 effect는 배열 교체 시마다 재실행.
      → useRef 로 최신값만 보관하고 effect 내부에서 .current 로 읽어 deps에서 제거.
      const equityGroupsLatest = useRef(summary.equityGroups)
      equityGroupsLatest.current = summary.equityGroups   // 렌더마다 갱신, effect 재실행 없음
      // effect deps: [dr.report?.id, resolvedCompany, selectedDate, summary.loading]
      → 배열 참조가 매 렌더 교체되어도 effect 비실행 → 루프 근본 차단.
      useFx 메모이즈만으로 부족할 수 있음 — 두 해결책을 함께 적용해야 완전히 차단됨.

원칙: 여러 컴포넌트가 구독하는 훅의 반환값은 참조 안정성 필수.
      useMemo/useEffect deps에 들어가는 함수·배열·객체는 반드시 안정화.
      deps에서 제거하면 stale closure가 되는 값은 useRef latest-value 패턴 사용.
```

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

### [CRITICAL] RLS 정책에서 auth.users 참조 → 'permission denied for table users' 403
```
증상: companies 등 신규 테이블 INSERT/UPDATE 시 403 "permission denied for table users".
      UI는 "추가 중..." 에서 멈춘 것처럼 보임(이전 시도의 stale 렌더 상태와 겹치면 영구 멈춤).
원인: RLS 정책에서 master 체크용으로 auth.users 를 서브쿼리 참조
      (select email from auth.users where id = auth.uid()) →
      authenticated 역할은 auth.users 에 SELECT 권한이 없어 정책 평가 자체가 실패.
진단: preview_eval 로 supabase.from('테이블').insert(...) 직접 호출 →
      { status: 403, error: 'permission denied for table users' } 확인.
해결: ① 정책에서 auth.users 직접 참조 금지. 이메일 클레임이 필요하면 auth.jwt() ->> 'email' 사용.
      ② 본 앱은 anon 키로 동작(레거시 접근코드 사용자는 실제 auth.users 아님)하고
         master 체크는 클라이언트(라우트 가드+UI)에서 수행 → 다른 테이블처럼
         anon+authenticated 양쪽에 permissive 정책(using/​with check true) 부여가 정석.
         (docs/db/companies.sql 의 companies_all 정책 참조)
방어: 클라이언트 비동기 핸들러는 try/catch/finally 로 감싸 버튼이 영구 멈추지 않게 한다.
근본조치: 쓰기(INSERT/UPDATE/DELETE)는 supabase-js 대신 raw fetch 기반 REST 헬퍼 사용.
      → src/lib/supabase.ts 의 restInsert/restUpdate/restDelete (fetchWithTimeout 12s 내장,
        PostgREST 직접 호출, supabase-js 재시도/토큰갱신 wedge 자체가 발생 안 함).
      관리자 쓰기(CompaniesPage·UsersPage)에 적용 완료. 읽기(SELECT)는 supabase.from() 유지.
      ⚠ supabase-js 의 .insert()/.update()/.delete() 는 한번 403 받으면 wedge 되어
        같은 클라이언트의 이후 SELECT 까지 멈출 수 있으므로, RLS 의존 쓰기는 REST 헬퍼 권장.
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
| `treasury_users` | 사용자 프로필·권한 (email/role/companies/menus/can_delete/can_approve + `allowed_categories`/`action_permissions` jsonb — 세션13차 세분화 권한, null=역할 기본값) |
| `access_codes` | 사용자 인증 코드 (레거시) |
| `policy_meetings` | 자금운용위원회 회의 (정책회의/운영회의) |
| `policy_decisions` | 의결사항 (법인별, CASCADE DELETE from meetings) |
| `policy_params` | 정책 파라미터 Key-Value (company+param_key unique) |
| `policy_bank_limits` | **거래 금융기관 마스터** + 한도 설정 (company+bank_name unique) |
| `cashflow_plan` | 12주 롤링 포캐스트 (company+week_start unique) |
| `companies` | **법인 마스터** (name unique, short_name/active/sort_order) — 동적 회사 관리. `docs/db/companies.sql` |
| `user_table_views` | NotionTable 컬럼 토글·정렬 설정 (sb_id+table_id unique) |
| `daily_reports` | 자금일보 헤더 (company+date unique, status: draft/submitted/approved) |
| `daily_report_items` | 입출금 라인 아이템 (direction: in/out, category, amount, linked_type/id) |
| `daily_report_threads` | 기타 항목 사유 스레드 (item_id FK) |
| `daily_report_approvals` | 결재 행위 로그 (submit/approve/reject/withdraw) |
| `daily_report_approval_config` | 법인별 결재선 설정 (company+step unique, 팀장=step1 Default) |

> **Supabase 신규 DDL 실행 필요**: `docs/supabase_policy_tables.sql`  
> **자금일보 DDL**: `docs/db/daily_report_tables.sql` (S1 착수 전 실행)
> (`policy_bank_limits`, `cashflow_plan` 테이블 포함)

**국채 평가금액**: `bondQty × (bondPrice ÷ 10)` (`calcBondValue` 함수 사용)

---

## 12. 라우팅 구조

```
/dashboard/:company?
/daily-report/:company?/:date?  ← 자금일보 (S1 개발 예정)
/input/:company?/:date?
/invest/:company?/:id?
/loans/:company?/:id?
/equity/:company?/:name?    ← 지분 탭
/bonds/:company?/:isin?     ← 채권 탭 (같은 EquityPage)
/history/:company?/:from?/:to?
/issue-history/:issueKey?
/fx/:currency?
/admin/mycode | /admin/companies | /admin/users | /admin/data | /admin/org-chart
```

basename: `/` (커스텀 도메인 `treasury.selvas.com` 루트 서빙 — 2026-07-01 전환. 과거 `/New-Treasury`)

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

## 15. LAN 테스트 접속 가이드

### 설정 현황
- `vite.config.ts`: `server: { port: 5175, host: true }` — 모든 네트워크 인터페이스 바인딩
- 개발 PC IP: `192.168.22.241` (사내망)

### 접속 방법
1. 개발 PC에서 `pnpm dev` 실행
2. 다른 PC(**같은 사내망 192.168.22.x**)에서 브라우저 열기
3. 주소창에 입력:
   ```
   http://192.168.22.241:5175/
   ```
   > 포트 고정(`strictPort: true`) — 5175 점유 시 자동 변경 없이 실패하므로 링크가 항상 5175로 일정
   > ⚠ base가 루트(`/`)로 전환됨(2026-07-01). 과거의 `/New-Treasury/` 경로는 더 이상 사용 안 함. 상대방은 반드시 **192.168.22.x 대역**에 있어야 함
   > (개발 PC는 이더넷 192.168.22.241 / Wi-Fi 172.30.0.154 두 망에 동시 연결 — 상대 망에 맞는 IP 사용)

### 방화벽 차단 시 포트 허용 (관리자 PowerShell — 최초 1회)
```powershell
New-NetFirewallRule -DisplayName "Vite Dev 5175" -Direction Inbound -Protocol TCP -LocalPort 5175 -Action Allow -Profile Any
```
> Node 기본 인바운드 규칙은 Domain 프로필에만 있어, 비도메인망(Wi-Fi 172.30.x 등) 접속 시 차단됨 → 위 규칙으로 전 프로필 허용

### 주의사항
- Supabase는 브라우저→클라우드 직접 연결 → 접속 PC에 관계없이 **동일 DB** 사용 (실데이터 공유)
- 개발 서버는 인증 없이 소스맵 접근 가능 → **사내 LAN에서만** 사용 권장
- 외부망 접근이 필요하면 `ngrok http 5175` 으로 임시 터널 생성 가능 (세션마다 주소 변경)

---

## 17. 개발 시 체크리스트

새 세션에서 작업 시작 전:
- [ ] `pnpm dev` 로 개발 서버 기동 확인 (port 5175)
- [ ] `.env.local` 존재 확인 (없으면 섹션 6 참조해서 생성)
- [ ] `sessionStorage['treasury_user']` 에 master 세션 주입 or 로그인
- [ ] `pnpm build` 로 빌드 에러 없는지 확인 후 코드 작업 시작

---

## 18. 참고 문서 (docs/ 폴더)

| 문서 | 내용 |
|------|------|
| `docs/SELVAS_TREASURY_CONTEXT.md` | 레거시 HTML 시스템 전체 컨텍스트 + DB 스키마 + GAS 구조 |
| `docs/SELVAS_TREASURY_REACT_CONTEXT.md` | React 신규 구축 Step별 완료 현황 |
| `docs/ROUTING_DEEPLINK_SPEC.md` | 딥링크 URL 명세 |
| `docs/hooks/README.md` | 모든 커스텀 훅 API 레퍼런스 |
| `docs/INDEX.md` | 문서 전체 인덱스 |
| `docs/TODO.md` | 기능 구현 TODO (우선순위별 체크리스트) |
