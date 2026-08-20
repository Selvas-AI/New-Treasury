# Selvas Treasury — 문서 인덱스

> 최종 업데이트: 2026-06-15

---

## 최상위 문서

| 문서 | 설명 |
|------|------|
| [SELVAS_TREASURY_CONTEXT.md](./SELVAS_TREASURY_CONTEXT.md) | 기존 HTML 시스템 전체 컨텍스트 (DB 스키마, GAS, 버그이력) |
| [SELVAS_TREASURY_REACT_CONTEXT.md](./SELVAS_TREASURY_REACT_CONTEXT.md) | React 신규 구축 컨텍스트 (환경, 완료 단계, 다음 작업) |
| [ROUTING_DEEPLINK_SPEC.md](./ROUTING_DEEPLINK_SPEC.md) | 딥링크 URL 전체 명세 + 외부 연동 시나리오 |

---

## 레이아웃 컴포넌트

| 문서 | 파일 | 설명 |
|------|------|------|
| [Layout.md](./components/layout/Layout.md) | `src/components/Layout.tsx` | 전체 앱 레이아웃 틀 |
| [Sidebar.md](./components/layout/Sidebar.md) | `src/components/Sidebar.tsx` | 다크 사이드바 (접기/모바일) |
| [TopBar.md](./components/layout/TopBar.md) | `src/components/TopBar.tsx` | 법인 선택 + 사용자 정보 |

---

## 대시보드 컴포넌트

| 문서 | 파일 | 설명 |
|------|------|------|
| [KpiCard.md](./components/dashboard/KpiCard.md) | `src/components/dashboard/KpiCard.tsx` | KPI 수치 카드 |
| [WaterfallCard.md](./components/dashboard/WaterfallCard.md) | `src/components/dashboard/WaterfallCard.tsx` | 자금흐름 수평 바 (클릭 가능) |
| [AssetCompositionCard.md](./components/dashboard/AssetCompositionCard.md) | `src/components/dashboard/AssetCompositionCard.tsx` | 자산구성 도넛 차트 (**신규**) |
| [FlowDetailDrawer.md](./components/dashboard/FlowDetailDrawer.md) | `src/components/dashboard/FlowDetailDrawer.tsx` | 자금흐름 항목 상세 팝업 (**신규**) |
| [IssueDrawer.md](./components/dashboard/IssueDrawer.md) | `src/components/dashboard/IssueDrawer.tsx` | 이슈 목록 팝업 (**신규**) |
| [IssueCard.md](./components/dashboard/IssueCard.md) | `src/components/dashboard/IssueCard.tsx` | ~~우측 패널 이슈 카드~~ (미사용, IssueDrawer로 전환) |
| [CashflowChart.md](./components/dashboard/CashflowChart.md) | `src/components/dashboard/CashflowChart.tsx` | 기간별 Bar 차트 |
| [EquityCard.md](./components/dashboard/EquityCard.md) | `src/components/dashboard/EquityCard.tsx` | 지분 목록 + 추이 차트 |

---

## 지분/채권 패널 컴포넌트

| 문서 | 파일 | 설명 |
|------|------|------|
| [EquityHistoryPanel.md](./components/equity/EquityHistoryPanel.md) | `src/components/equity/EquityHistoryPanel.tsx` | 주식/비상장 이력 패널 |
| [BondHistoryPanel.md](./components/equity/BondHistoryPanel.md) | `src/components/equity/BondHistoryPanel.tsx` | 국채/채권 이력 패널 |
| [NewEquityForm.md](./components/equity/NewEquityForm.md) | `src/components/equity/NewEquityForm.tsx` | 지분(상장/비상장) 신규 등록 폼 |
| [NewBondForm.md](./components/equity/NewBondForm.md) | `src/components/equity/NewBondForm.tsx` | 국채/채권 신규 등록 폼 |

---

## 페이지

| 문서 | 라우트 | 데이터 테이블 |
|------|--------|-------------|
| [DashboardPage.md](./pages/DashboardPage.md) | `/dashboard` | daily + investments + loans + equities |
| [DailyReportPage.md](./pages/DailyReportPage.md) | `/daily-report` | daily_reports + items + approvals (**S1 개발 예정**) |
| [InputPage.md](./pages/InputPage.md) | `/input` | `daily` |
| [InvestPage.md](./pages/InvestPage.md) | `/invest` | `investments` (비국채, FVPL 탭 제거) |
| [LoansPage.md](./pages/LoansPage.md) | `/loans` | `loans` |
| [EquityPage.md](./pages/EquityPage.md) | `/equity`, `/bonds` | `equities` + `investments`(국채) |
| [HistoryPage.md](./pages/HistoryPage.md) | `/history` | daily + investments + loans |
| [IssueHistoryPage.md](./pages/IssueHistoryPage.md) | `/issue-history` | `issue_comments` |
| [FxPage.md](./pages/FxPage.md) | `/fx` | GAS API + `daily` (FX 정책탭 제거) |
| [PolicyPage.md](./pages/PolicyPage.md) | `/policy` | **통합**: meetings + decisions + daily + investments + loans + policy_params |
| [MyCodePage.md](./pages/admin/MyCodePage.md) | `/admin/mycode` | `access_codes` |
| [UsersPage.md](./pages/admin/UsersPage.md) | `/admin/users` | `access_codes` |
| [DataPage.md](./pages/admin/DataPage.md) | `/admin/data` | 전체 테이블 집계 |

---

## Pending 기능 설계 문서

| 문서 | 상태 | 설명 |
|------|------|------|
| [pending/DashboardTabNav.md](./pending/DashboardTabNav.md) | ⏸ Pending | Dashboard 카테고리 탭 네비게이션 (TopBar 하단 전체 너비 탭 바) |

---

## GAS 스크립트

| 문서 | 설명 |
|------|------|
| [GAS_NAME_SEARCH_PATCH.md](./GAS_NAME_SEARCH_PATCH.md) | 종목명/채권명 이름 검색 GAS 패치 방법 (Code.gs 적용 가이드) |
| [GAS_ECOS_STDDEV.md](./GAS_ECOS_STDDEV.md) | ECOS API 연동 FX 표준편차 자동계산 (Code.gs v4, 주기D, GBP코드) |

---

## DB 스키마

| 문서 | 설명 |
|------|------|
| [supabase_schema.md](./supabase_schema.md) | 전체 테이블 스키마 DDL 및 설계 의도 |
| [supabase_policy_tables.sql](./supabase_policy_tables.sql) | Phase 2 자금정책 테이블 생성 SQL (policy_meetings/decisions/params) |
| [db/daily_report_tables.sql](./db/daily_report_tables.sql) | 자금일보 테이블 DDL (daily_reports + items + approvals + config) |

---

## 훅

| 문서 | 설명 |
|------|------|
| [hooks/README.md](./hooks/README.md) | 전체 커스텀 훅 API 레퍼런스 |
| [hooks/useStockTicker.md](./hooks/useStockTicker.md) | 3개 법인 주가 5분 폴링 훅 |
| (usePolicyMeetings) | 정책회의 CRUD — `src/hooks/usePolicyMeetings.ts` |
| (usePolicyDecisions) | 의결사항 CRUD + 상태변경 — `src/hooks/usePolicyDecisions.ts` |
| (usePolicyParams) | 정책 파라미터 get/upsert — `src/hooks/usePolicyParams.ts` |
| (usePolicyThreads) | 후속조치 스레드 — `src/hooks/usePolicyThreads.ts` |
| **(usePolicyDashboard)** | **법인별 실데이터 직접 패치 (auth 독립) — `src/hooks/usePolicyDashboard.ts`** |

---

## 주요 변경 포인트 빠른 참조

| 작업 | 수정 파일 |
|------|---------|
| 법인 추가 | `src/types/index.ts` + `TopBar.tsx` + `UsersPage.tsx` |
| 메뉴 항목 추가·개명·삭제 | **`src/lib/navTree.ts` (NAV_GROUPS — SSOT)** + `App.tsx` (라우트) + `MENU_DEFAULTS`(auth.ts) — ⚠ 사이드바와 **사용자 관리 권한 트리**가 같은 상수를 읽는다. 화면 안에 메뉴 목록을 다시 정의하지 말 것 (CLAUDE.md §1-A) |
| 메뉴 접근/작업 권한 UI | `src/components/admin/MenuPermissionTree.tsx` + `src/pages/admin/UsersPage.tsx` |
| 외화 원장(FIFO)·계좌 대체 | `src/pages/FxLedgerPage.tsx` + `src/components/fx/*` + `src/hooks/useFxLots.ts` |
| 외화 매각 지시 워크플로우 | `src/components/fx/FxOrdersTab.tsx` (발의는 여러 곳, **집행·추적은 여기 한 곳**) |
| 이슈 감지 조건 변경 | `src/hooks/useDashboard.ts` (detectedIssues useMemo) |
| 차트 색상/종류 변경 | 해당 컴포넌트 MD 문서의 "변경 포인트" 참조 |
| GAS API 변경 | `src/hooks/useGas.ts` + `.env.local` (VITE_GAS_API_URL) + `Code.gs` (재배포 필요) |
| 외화 종류 추가 | `src/types/index.ts` (FxCode) + `FxPage.tsx` + DB 컬럼 추가 |
| 상품유형/차입유형 추가 | `InvestPage.tsx` / `LoansPage.tsx` 각 Options 배열 |
| 정책 현황 카드 추가 | `src/pages/PolicyPage.tsx` (인라인 컴포넌트) + `usePolicyDashboard` |
| FX 정책 파라미터 편집 | `src/components/policy/FxPolicyTab.tsx` |
| FVPL Duration 편집 | `src/components/policy/FvplRiskTab.tsx` |
| 유동성/차입 한도 설정 | `PolicyPage.tsx` (LiquidityCard, LoanStatusCard) + `policy_params` 키 추가 |


---

## 세션26차 11~13일차 신규 문서 (2026-08-20)

| 문서 | 내용 |
|------|------|
| **`docs/기획/인수인계_세션26_11-13일차.md`** | **다음 세션이 먼저 읽을 인수인계** — 상태·금지사항·반복된 함정 |
| `docs/기획/외화원장_계좌간거래_설계.md` | 계좌 대체·정기예금 라이프사이클·거래 유형 설계 |

### 신규 SSOT 모듈

| 모듈 | 역할 | 금지 |
|------|------|------|
| `src/lib/navTree.ts` | 사이드바 = 권한 트리 메뉴 정의 | 화면 안에 메뉴 목록 재정의 |
| `src/lib/fxBandExceed.ts` | 정책 밴드 초과분 산출·발의 payload | σ×Z 한도 모델을 실무 화면에 복제 |
| `src/lib/fxTxnType.ts` | 거래 유형(sale/payment/transfer/interest) 라벨·손익 집계 | 화면마다 유형 분기 |
| `src/lib/fxOrderType.ts` | 매각 지시 발생 경로 라벨 | 삼항 연산자로 즉석 분기 |

### 세션26차 12일차 DB 마이그레이션 (전부 적용 완료)

`fx_fifo_account_priority.sql` → `fx_lot_transfer.sql` → `fx_txn_type.sql`
→ `fx_transfer_selfconsume_guard.sql` → `fx_term_deposit_settle.sql` (실행 순서)
