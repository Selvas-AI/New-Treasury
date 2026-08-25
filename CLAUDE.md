# CLAUDE.md — Selvas Treasury (New-Treasury)
> 신규 세션 시작 시 이 파일을 먼저 읽어 컨텍스트를 복원하세요.
> 최종 업데이트: 2026-08-20 (세션26차 11~13일차 — FX 발의·집행 흐름 복구 · 외화 원장 재설계(계좌 대체/거래유형/정기예금) · 권한 트리 SSOT 통합)
>
> ⚠ **§1-A 연계성 우선 개발 규칙을 먼저 읽을 것.** 이 프로젝트에서 반복된 사고는 대부분
> "각 조각은 정상인데 흐름이 끊긴" 유형이었다.
> 최근 작업 상세: `docs/기획/인수인계_세션26_11-13일차.md`

---

## 1. 프로젝트 한 줄 요약

셀바스에이아이 · 셀바스헬스케어 · 메디아나 3개 법인의 **통합 자금 모니터링 시스템** (React + Supabase 기반, 기존 HTML ~10,900줄 → React 마이그레이션 진행 중).

---

## 1-A. ⛔ [MUST] 연계성 우선(Interconnection-First) 개발 규칙 ⭐⭐⭐

> **모든 신규 개발·수정에 예외 없이 선행 적용한다.** 코드를 한 줄이라도 고치기 전에 이 절차를 밟는다.

### 왜 이 규칙이 생겼나 (2026-08-20 사용자 지적)

이 시스템은 **기능이 아니라 업무 흐름**으로 이어져 있다. 발의 → 승인 → 체결 → 원장 →
대시보드 경보가 서로 다른 화면·훅·테이블에 흩어져 있고, 각 조각은 단독으로는 정상 동작한다.
그런데 **조각별로만 개발하면 흐름이 끊긴 것을 아무도 발견하지 못한다.** 실제로 세션26차에
연속으로 터진 사고들이 전부 이 유형이었다:

| 실사고 | 각 조각은 정상이었다 | 끊긴 연결 |
|---|---|---|
| 체결 등록 불가 (2026-08-20) | 발의 O · 딥링크 O · 체결 모달 O | 발의가 `trade_date`=**미래**(희망 집행일)로 저장되는데 목록 기본 필터가 `≤ 오늘` → 방금 만든 지시가 목록에 없음 |
| 실무자 발의 불가 (2026-08-20) | 초과 감지 O · 발의 UI O | 발의 UI가 **자금정책(권한 제한 메뉴)에만** 있어 실무 담당자에겐 경로 자체가 없음 |
| 상태 카드 판독 불가 (2026-08-20) | 집계 O · 표시 O | 라벨(`발의/승인/…`)과 값(`0/0/0/9/0`)이 분리돼 사람이 짝을 못 맞춤 |
| 외화비중 6.2% vs 27.9% (세션19차) | 두 화면 각각 계산 O | 같은 지표를 두 곳에서 재계산 → 값이 갈라짐 |
| 조치 카드 소실 (세션26차 9일차) | 라이브 판정 O | "지금 조치가 필요한가"만 보고 "이미 진행 중인 지시가 있는가"를 안 봄 |

### 착수 전 필수 체크리스트 (5문항 — 답을 못 하면 코딩 시작 금지)

1. **[진입] 이 기능에 도달하는 경로가 몇 개인가?** 각 경로의 **메뉴 권한**은?
   → 권한이 제한된 메뉴에만 진입점이 있으면 **실무자는 그 기능이 없는 것과 같다.**
2. **[연쇄] 이 데이터를 쓰는 다른 화면은?** 저장 후 그 화면들이 자동 갱신되는가?
   → 목록·요약·경보·원장 중 하나라도 손으로 새로고침해야 하면 미완성이다.
3. **[필터/기본값] 방금 만든 레코드가 기본 조회 조건에 걸려 안 보이지 않는가?**
   → 날짜 컬럼의 **의미**를 확인할 것(등록일인가 예정일인가). 이행해야 할 미완료 건은
      **조회 조건과 무관하게 항상 보여야 한다.**
4. **[SSOT] 내가 계산하려는 값을 이미 계산하는 훅/함수가 있는가?**
   → 있으면 **반드시 그것을 쓴다.** 화면에서 재계산 금지(값이 갈라진다).
5. **[상태 잔존] 조건이 바뀌어 UI가 사라질 때, 진행 중이던 작업은 어디서 보이는가?**
   → "지금 필요한가"와 "이미 진행 중인가"는 **다른 질문**이다. 둘 다 렌더 조건에 넣는다.

### 산출물 규칙

- 화면을 새로 만들거나 워크플로우를 건드리면 **아래 연계 지도를 함께 갱신**한다.
- 커밋 전 검증에 "**해당 흐름을 처음부터 끝까지 한 번 통과**"를 포함한다
  (예: 발의 → 목록에 보이는가 → 승인 → 체결 → 원장 잔액 → 대시보드 경보 해제).
  tsc/lint/test 통과는 화면이 이어져 있음을 **전혀** 보장하지 않는다.

### 💱 FX 워크플로우 연계 지도 (SSOT)

```
[감지]                        [발의]                    [실행·추적]              [파급]
정책 밴드 초과(checkFx)  ─┐   자금정책 › ④매각 집행 ─┐
리짐 권고(evaluateRegime)─┼─▶ FX 리짐 전략 상단     ─┼─▶ 외화거래명세          ─┬─▶ 대시보드 이슈 티커
실무 판단(재량)          ─┘   외화거래명세 › 발의카드 ┘   › 외화매도이력          │   (fx_band/fx_regime/fx_sell)
                                                          발의→승인→(부분)체결   ├─▶ 자금일보 배너
                                                              ↓ FIFO 소진        ├─▶ 자금정책 ①리짐 이행 현황
                                                          › 원장(fx_lots 잔액)   └─▶ 원장 잔액·환차손익
```

| 역할 | 유일한 정본 | 금지 |
|---|---|---|
| 외화비중·바구니 분자/분모 | `usePolicyDashboard` | 화면에서 재계산 |
| 리짐 판정 | `useFxRegime` → `evaluateRegime` | 화면에서 목표비중 재계산 |
| 밴드 초과분 산출 | `lib/fxBandExceed.ts` | σ×Z 한도 모델을 실무 화면에 복제 |
| 매각 지시 payload | `buildThresholdOrderPayload` / `registerRegimeOrder` | 화면마다 propose 인자 직접 조립 |
| **체결(집행)·취소** | **외화거래명세 › 외화매도이력 한 곳** | 다른 화면에 체결 모달 복제 |
| FIFO 소진 | 서버 RPC(`complete_fx_trade_fill` 등) / 미리보기는 `previewFifoConsumption` | 클라이언트에서 잔액 직접 수정 |
| 상태 라벨 | `lib/fxOrderType.ts` | 삼항 연산자로 즉석 분기 |

> **핵심 원칙: "발의는 여러 곳, 집행·추적은 한 곳."**
> 발의 진입점은 업무 성격(정책위원회/리짐권고/실무재량)만큼 있어도 되지만,
> 실행·이력·원장은 반드시 하나여야 한다.

### 🧭 메뉴를 바꾸면 반드시 함께 바뀌어야 하는 것 ⭐

> **메뉴 구성 변경(추가·삭제·개명·이동)은 사이드바만의 일이 아니다.**
> 사용자 관리의 **권한 트리**가 같은 목록을 그린다 — 둘이 어긋나면 관리자가 체크한 것과
> 사용자가 실제로 보는 메뉴가 달라지고, **그걸 확인할 방법이 없어진다.**

**실제로 그렇게 됐었다 (세션26차 13일차 발견):**
- `audit-log`(변경 이력 로그)를 사이드바에만 추가하고 권한 목록엔 안 넣어
  → **master 외에는 아무도 볼 수 없고, 부여할 방법 자체가 없던 상태**
- `환율 국면` → `FX 리짐 전략` 개명 시 사이드바만 고침 → 권한 화면은 옛 이름 그대로
- 라벨 5건 불일치 · 섹션 계층 소실

**그래서 `src/lib/navTree.ts` 하나만 고치면 되게 만들었다.**

| 메뉴 작업 | 고칠 곳 |
|---|---|
| 항목 추가·삭제·개명·순서 변경 | **`src/lib/navTree.ts` (NAV_GROUPS)** + `App.tsx` 라우트 |
| 작업 권한(조회/입력·수정/삭제)이 있는 화면 | 위 + `NavItem.section` 에 `SectionKey` 지정 + `ACTION_DEFAULTS`(auth.ts) |
| 역할별 기본 노출 여부 | `MENU_DEFAULTS`(auth.ts) — **넣지 않으면 아무도 못 본다** |

⛔ **금지**
- `Sidebar.tsx` 나 `UsersPage.tsx` **안에 메뉴 목록을 다시 정의하지 말 것.**
  (과거 `NAV_GROUPS`/`MENU_SLUGS` 이중 정의가 위 사고의 원인이다)
- 새 메뉴를 추가하고 `MENU_DEFAULTS` 를 손대지 않은 채 끝내지 말 것 —
  **의도적으로 opt-in 으로 둘 것이라면 그 사실을 navTree 주석에 남길 것**
  (`fx-regime`·`audit-log` 이 그 사례).
- `slug` 를 바꾸는 것은 **DB 값 변경**이다(`treasury_users.menus`).
  라벨은 자유롭게 바꿔도 되지만 slug 는 마이그레이션과 함께가 아니면 바꾸지 말 것 —
  기존 사용자 권한이 조용히 끊긴다.

✅ **확인 방법**: 메뉴를 바꾼 뒤 **사용자 관리 › 권한 트리를 열어 사이드바와 나란히 대조**한다.
트리가 사이드바와 같은 아이콘·라벨·순서로 보이면 정상이다.

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

> 환율 국면/FIFO 작업은 `docs/기획/환율국면_인수인계_세션24.md` → `환율국면_인수인계_세션25.md` 순으로 읽고,
> **FX 리짐 정책 이관(세션26차) 이후 작업은 `docs/기획/인수인계_세션26.md` §5(다음 작업)에서 시작할 것.**

### 2026-08-12 세션23차 A (환율 정책 프로토콜 정리)

- `ProtocolTab.tsx` — 최상단에 현재 활성 정책(`수준 × 추세` 또는 대조군)을 표시하고 현재 수준·국면·목표 잔존 비중의 적용 흐름을 한 문장으로 제공.
- 정책표를 `실제 정책: 환전 후 남길 외화 비중`으로 개명하고 “15% = 15%만 남기고 초과분 환전” 의미를 명시.
- 구 국면 단독 표를 `대조군: 수준 축 도입 전 로직`으로 개명하고 `규칙 검증 비교용 · 평상시 미사용` 배지 적용. 엔진·대조군 데이터는 유지.
- 기존 13개 설정을 `국면 판정 / 수준 판정 / 집행 규칙` 세 그룹으로 분리하고 각 그룹의 영향 범위를 설명.
- `기본값`을 `권장안`으로 정정하고, 정책표 15~42% 폭의 실측 선정 근거 및 폭 확대·축소 시 외화 노출/실현환율 trade-off를 화면에 명시. 각 설정 카드에 의미·권장 이유·값을 높이거나 낮출 때의 장단점을 초심자용 도움말로 추가.
- 정책표 자동 조정 게이지 추가: 최소·중립·최대 잔존 비중 세 값만 정하면 권장안의 셀별 상대 위치를 유지해 15개 목표를 자동 배분. 변경 시 권장안 대비 이익실현 강도, 반등 기회, 미환전 노출의 예상 장단점을 즉시 안내하며 개별 셀 미세조정도 유지.
- 저장하지 않은 초안 프로토콜을 기존 `evaluateRegime()`으로 계산해 목표 잔존 비중·권고 행동·예상 조정금액의 저장 전 미리보기 제공. DB 저장은 기존 사용자 클릭 흐름만 유지.
- 검증: TypeScript/build 성공, 엔진 50/50, lint 0 errors. A 변경 파일 자체 경고 없음.

---

### 2026-08-11 세션22차 (환율 국면 입력 수동화 + 백테스트 재설계)

- `src/lib/fxRegimeInputs.ts` — 법인·통화별 수동 입력 어댑터 추가. 가용자금/외화보유/월 유입/결제버퍼/정책밴드를 `localStorage`에 저장하며 `policy_params`와 분리. Treasury 연동 분기는 비활성 심으로 유지.
- `FxRegimePage.tsx` — `usePolicyDashboard` 기반 자금 입력을 제거하고 수동 입력 패널 및 `수동 입력 / Treasury 연동(준비 중)` 토글 적용. 메디아나만 월 3.0M·결제버퍼 2.5M 외화 기본값 사용.
- `fxBacktest.ts` — 고정 자금 리밸런싱/외화 매수 모델을 폐기하고 월 외화 순유입 환전 타이밍 모델로 교체. `evaluateRegime(series.slice(0, i+1), ...)` 단일 판정 경로 유지, 매수 생성 금지.
- `BacktestTab.tsx` — 즉시 전액 환전/전혀 환전 안 함 벤치마크, 가중평균 실현환율·기간 평균·미환전 잔량·최대 노출·비용 중심 UI로 변경하고 적색 모델 경고 제거.
- 검증: TypeScript 0 errors, lint 0 errors(기존 68 warnings), build 성공, 국면 엔진 25/25 유지, 합성 순유입 백테스트 불변식 통과.

---

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

#### Task 4: 차입금/운용자금 만기처리(상환) 로그에 금액 스냅샷 기록
사용자 리포트: 차입금 상환처리 후 변경 이력 로그가 "신한은행 한도대출 만기처리"처럼
금액 없이 동일 문구만 반복 표시돼, 어떤 건이 얼마를 상환한 것인지 알 수 없음.
- **원인**: `loans`/`investments` 테이블은 상환 시 새 row를 만들지 않고 기존 row의
  `active` 플래그만 바꿔 재사용. `useLoans.ts`/`useInvestments.ts`의 `setActive()`는
  CREATE/UPDATE/DELETE와 달리 summary에 금액을 넣지 않고 `logAction`에 before/after도
  전달하지 않았음(SETACTIVE 액션만 금액 정보 없이 로그됨).
- **해결**: summary 라벨에 금액(원/외화) 추가 + `logAction` 호출에 `before`(변경 전
  레코드)/`after`(active만 바뀐 레코드) 스냅샷 추가 → `audit_logs.before_data/after_data`에
  시점별 금액이 고정 기록되어 AuditLogPage "상세" 토글로 정확한 금액 확인 가능.

#### Task 5: 차입금/운용자금 상환 후 과거 이력 잔액이 소급 변경되던 근본 버그 수정 ⭐[CRITICAL]
```
증상: 2026-07-14에 차입금 10억을 상환처리하면, 대시보드 "현금흐름 추이" 차트의
  7/13 이전 날짜 잔액에도 이미 10억이 차감된 상태로 표시됨. 사용자 지적:
  "과거 이력은 그 시점 당시의 실제 잔액(상환 전 금액 포함)으로 고정되어야 한다."

원인: loans/investments 테이블은 상환·만기처리 시 새 row를 추가하지 않고 기존
  row의 active 플래그만 바꿔 재사용하는 구조라, "언제 닫혔는지" 기록이 전혀 없었음.
  게다가 대시보드가 쓰는 useLoans(true)/useInvestments(true)는 DB 조회 자체를
  active=true 로 필터링해 상환된 항목은 애초에 데이터에 포함되지도 않음.
  CashflowChart.tsx는 이 "현재 활성 상태"만 담긴 배열을 모든 과거 날짜에 동일하게
  적용해 합산하고 있었음 → 상환 즉시 전체 과거 이력에서 사라져 보임.

해결:
  1. loans/investments 에 closed_date 컬럼 추가 (docs/db/closed_date_migration.sql,
     ⚠ Supabase 실행 필요). setActive(false) 시 오늘 날짜 기록, 재활성화 시 NULL.
  2. DashboardPage.tsx — CashflowChart 전용 activeOnly=false 별도 훅 인스턴스
     (chartLoans/chartInvest) 추가, 상환/만기처리 항목도 포함한 전체 이력 전달.
     기존 db.loans/db.allInvestData(KPI용, activeOnly=true)는 그대로 유지.
  3. CashflowChart.tsx — 날짜별로 start_date<=d.date && (closed_date 없거나
     d.date 이후)인 항목만 point-in-time 필터링해 합산하도록 재작성.
     closed_date 없는 기존 데이터는 항상 "열려있음"으로 안전 폴백(마이그레이션
     실행 전에도 크래시 없이 기존 동작 유지).
  4. LoansPage.tsx/InvestPage.tsx — handleSetActive가 setActive() 에러를 무시하던
     버그도 함께 수정, 실패 시 toast 표시.

금지: closed_date 없이 "현재 active 배열을 모든 날짜에 동일 적용"하는 패턴으로
  되돌리지 말 것 — 상환/만기처리 즉시 과거 이력이 소급 변경되는 근본 원인.
검증: tsc/build/lint(0 errors) 통과. 마이그레이션 미실행 상태 브라우저 로드 확인 —
  콘솔 에러 없이 기존과 동일하게 정상 렌더(안전 폴백 확인).
```

#### Task 6: 현금흐름 추이 차트 운용(가용) 과대표시 회귀 수정 (Task 5의 후속 버그) ⭐
```
증상: Task 5(closed_date 마이그레이션) 배포 직후, 통합상황판 현금흐름 추이 차트의
  운용(가용)이 775.6억원으로 표시되나 실제(대시보드 KPI 기준)는 603.5억원 —
  메디아나 법인에서 사용자 리포트로 발견.

원인: Task 5의 wasOpenOn() 이 "closed_date 가 없으면 무조건 열려있다"로 판별했음.
  그런데 closed_date 는 이번에 신규 추가된 컬럼이라, 그 이전에 이미 상환·매도돼
  active=false 로 남아있는 레거시 건들도 당연히 closed_date=null → 전부 "아직
  열려있다"로 잘못 재분류되어 이미 닫힌 자금까지 중복 산입됨.
  (실측: 메디아나 비국채 투자 17건 중 3건이 active=false 인데 셋 다 closed_date=null)

해결: 판별 순서 변경 — closed_date 있으면 그 값으로 정확히 판별(기존 유지),
  없으면 "열려있다" 대신 현재 active 플래그를 그대로 사용(레거시 건은 기존
  activeOnly 동작과 동일하게 처리). active=true 인 건은 closed_date 무관 항상 열림.

금지: "closed_date 없음 = 열려있음"으로 판단하지 말 것 — 반드시 active 플래그를
  최종 폴백으로 사용해야 마이그레이션 이전 레거시 건이 과대 산정되지 않음.
검증: REST 직접 조회로 활성 14건 vs 전체 17건 합계 차이 확인, tsc/build/lint 통과.
```

#### Task 7: 정책 이행 통제(Policy Compliance Enforcement) Phase 1 ⭐ 신규 기능
사용자 사례: 정책회의에서 "외화 매도 후 비중 30%까지 관리(상한)"를 의결했으나
실무진이 "30%까지 보유해도 된다"로 오독해 고환율 구간에 매도를 놓친 사고 발생.
의결사항이 회의록 텍스트로만 존재해 시스템이 이행 여부를 감지할 방법이 없었음.

**설계**: `docs/기획/정책이행통제.md` 없음(채팅 리포트로만 전달) — 3단계 로드맵 중
Phase 1(즉시 적용) 구현 완료. Phase 2(fx_trade_history 자동 매칭)/Phase 3(소프트
블로킹+에스컬레이션)은 향후 세션에서 착수 예정.

**Phase 1 구현 내역**:
1. `docs/db/policy_decision_rules_migration.sql` ⭐ (**실행 필요**) — `policy_decisions`
   에 `linked_metric`(fx_ratio/loan_ratio/liquidity) + `target_operator`(lte/gte)
   + `target_value` 컬럼 추가. 셋 다 채워진 의결만 자동 위반 감지 대상.
2. `src/lib/policyChecks.ts` (신규) — `PolicyPage.tsx`에 갇혀있던
   `checkLiquidity/checkFx/checkLoan/checkConcentration`을 공용 모듈로 분리 +
   `checkDecisionRule()` 신규(의결 규칙 vs 현재 실측값 비교). 대시보드와 정책
   페이지가 동일 SSOT 기준을 공유하도록 통일.
3. `PolicyPage.tsx` — 의결사항 추가/수정 폼(3곳: 신규 2 + 수정 1)에 공용
   `DecisionRuleFields` 컴포넌트로 "정량 규칙(선택)" 입력 추가.
4. `usePolicyDecisions.ts` — `usePolicyDecisionsByCompany(company)` 신규.
   기존 `usePolicyDecisions(meetingId)`는 회의 단위라 "이 법인이 지금 이행해야
   할 의결 전체"를 못 가져옴 — company 기준 미완료 의결 조회용 별도 훅.
5. `DashboardPage.tsx` — 미이행 의결사항(정량 규칙 위반 또는 기한 초과)을 대시보드
   이슈 티커/IssueDrawer에 자동 병합. 이슈 key = `makeIssueKey('policy', decision.id)`
   — 기존 `issue_comments` 기반 미조치/검토중/완료 상태추적 인프라 그대로 재사용
   (`useIssues.ts`의 `makeIssueKey` 타입에 `'policy'` 추가).
6. `DailyReportPage.tsx` — `PendingDecisionsBanner` 신규. 자금일보 작성 화면(실무진이
   매일 반드시 거치는 화면) 상단에 해당 법인 미완료 의결사항을 항상 노출.

검증(마이그레이션 실행 후 최종 확인 완료): 브라우저에서 메디아나 법인에 정량 규칙
(FX비중 ≤20%, 실제 28.4%)을 가진 테스트 의결사항을 실제 등록 → ①대시보드 이슈
티커에 "⚠ 의결 미이행: {제목}" 자동 노출 ②IssueDrawer 상세에 "정책 위반 — FX 비중
현재 28.4 (목표: 20 이하)" 정확히 표시 ③자금일보 작성 화면 상단 배너에도 동일 건
노출 — 3곳 모두 정상 확인 후 테스트 데이터 삭제(사용자 승인 하에 진행). 부가로
발견된 버그 하나 수정: 의결사항 신규 등록 시 기한(due_date)을 비워두면 Postgres
date 컬럼에 빈 문자열이 전달되어 저장이 실패하던 문제 — null로 보정.

#### Task 8: 정책 이행 통제 Phase 2 — 정량 규칙 이행률 실시간 표시 + 완료 제안
Phase 1(정량 규칙 등록 + 대시보드/자금일보 자동 노출)에 이어, 의결사항 카드에서
정량 규칙의 실제 이행 현황을 바로 확인하고 목표 달성 시 1클릭으로 완료 처리.

**설계 노트** — 애초 3단계 로드맵의 "fx_trade_history 완료 처리와 자동 매칭"을
그대로 구현하지 않은 이유: `fx_trade_history`의 "완료" 처리는 매매 워크플로우
기록일 뿐, 실제 보유잔액은 별도로 운전자금(`daily.fx_*`)/운용자금(`investments`)
입력에서 갱신된다 — 두 이벤트가 항상 동시에 일어난다는 보장이 없어 트레이드 완료
시점에 검사하면 오탐(아직 잔액 미반영)이 날 수 있음. 대신 항상 최신 실측값
(`policyChecks` SSOT)으로 이행률을 계산해 "제안"하고, 최종 완료는 담당자가
1클릭으로 승인하는 방식을 택함 — 더 정직하고 항상 정확함.

- `PolicyPage.tsx` — `DecisionRuleProgress` 신규 컴포넌트.
  `decision.linked_metric/target_operator/target_value`가 있으면 `checkDecisionRule()`
  로 실측값 대비 달성/미달성 표시(초록=달성, 빨강=미달성). FX비중 초과(lte 위반)
  케이스는 "약 N억원 추가 매도 시 목표 달성" 참고치 표시(`totalFundAvail × target%`
  로 역산한 목표 보유액과 현재 `fxTotalHoldings`의 차). 달성 + 미완료 + 편집권한
  있음 → "✓ 목표 달성 — 완료 처리" 버튼 → 기존 `handleStatusChange(d,'completed')`
  재사용(신규 API 없음). 기존 키워드 매칭 `DecisionPolicyPanel`은 `linked_metric`
  있는 의결에서는 중복 방지를 위해 렌더 생략.

검증: 메디아나 법인에 "FX비중 35% 이하"(달성 케이스, 실제 28.4%) 테스트 의결 등록
→ 초록 패널+완료 버튼 노출 → 클릭 → 상태 실제 '완료' 전환 + 버튼 소멸까지
end-to-end 확인 후 테스트 데이터 삭제(사용자 승인). tsc/build/lint(0 errors) 통과.

#### Task 9: 정책 이행 통제 Phase 3 — 외화 매각 지시(Sell Order) 3영업일 이행 강제 ⭐
사용자 사례: 정책회의에서 "환율 고점 판단 → 일부 환차익 실현" 재량 매각을 결정해도,
또는 보유비중 초과로 매각이 필요해도, "언제까지 실행해야 하는지"가 시스템에 없어
실무진이 판단으로 미루는 사고가 반복됨. 두 케이스 원칙은 동일: **등록일로부터
3영업일 내, 환율과 무관하게 실행**.
- **재사용 설계**: 별도 테이블 신설 대신 이미 있던 `fx_trade_history`의 "매도
  발의→승인→완료" 워크플로우 위에 이행 기한 추적을 얹음.
- `src/lib/bizDay.ts` — `addBizDays(date,n)`/`bizDaysBetween(date1,date2)` 신규.
- `docs/db/fx_sell_order_deadline_migration.sql` ⭐ (**실행 필요**) —
  `fx_trade_history`에 `due_date`(매각 실행 기한) + `order_type`
  ('threshold'=한도초과 매각 | 'discretionary'=재량 매각) 컬럼 추가.
- `FxPolicyTab.tsx`:
  - 기존 "매도 발의"(한도초과 시) 제출 시 `due_date`/`order_type='threshold'`
    자동 설정. 희망 집행일 기본값도 +3 **영업일**로 수정(기존엔 +3 달력일).
  - 신규 "🟡 재량 매각 지시 등록" 버튼 — 한도초과 여부 무관 항상 노출, 통화
    선택 가능한 발의 모달(`order_type='discretionary'`).
  - "🔴 외화 매각 지시 이행 관리" 섹션 — 미완료 매각 지시 D-day 강조 목록 +
    "매각 완료" 1클릭 처리.
  - **버그 수정**: `propose()` 실패 시 조용히 모달이 닫히던 기존 버그 —
    에러를 확인해 toast 표시 + 모달 유지하도록 수정.
- 대시보드/자금일보 자동 노출(Phase1과 동일 패턴): `makeIssueKey`에 `'fx_sell'`
  타입 추가, `issueLink.ts`에 `fx_sell_{id}` → `/fx-trade-history/{company}`
  매핑, `DashboardPage.tsx`/`DailyReportPage.tsx`(`PendingSellOrdersBanner`)에
  기한 임박·초과 매각 지시 노출.

검증(마이그레이션 실행 후 최종 확인 완료): 메디아나 법인에 재량 매각 지시
실제 등록(USD 1,000,000) → "🔴 외화 매각 지시 이행 관리" 목록에 D-3 뱃지와 함께
정상 노출 → "매각 완료" 클릭 → DB 직접 조회로 completed_rate/completed_pnl/
completed_at 정상 기록 확인. 이 과정에서 추가 버그 발견·수정: complete() 호출 후
화면 목록이 갱신되지 않던 문제 — onQuickComplete에 tradeHist.load() 재호출 추가
(커밋 60cccac). 테스트 데이터는 삭제(사용자 승인). tsc/build/lint(0 errors) 통과.

#### 커밋 이력 (이번 세션)
```
74afb25 feat: 주간예측 카테고리별 입출금 상세 입력 + 엑셀 임포트
b4911ed fix: 대시보드 자금흐름 팝업이 요약 수치와 불일치하던 3건 수정
b58a3a4 fix: 자금정책 페이지 외화비중 카드가 FX정책 탭과 다른 값 표시하던 버그 수정
c4f2f48 fix: 차입금/운용자금 만기처리(상환) 로그에 금액 스냅샷 기록
744f311 fix: 차입금/운용자금 상환 후 과거 이력 잔액이 소급 변경되던 근본 버그 수정
a0f135f fix: 현금흐름 추이 차트 운용(가용) 과대표시 회귀 수정 (closed_date 마이그레이션 후속)
297f35e feat: 정책 이행 통제(Policy Compliance Enforcement) Phase 1
362fb64 fix: 의결사항 신규 등록 시 기한 미입력이면 저장 실패하던 버그 수정
38faac3 feat: 정책 이행 통제 Phase 2 — 정량 규칙 이행률 실시간 표시 + 완료 제안
3b7d8dd feat: 정책 이행 통제 Phase 3 — 외화 매각 지시(Sell Order) 3영업일 이행 강제
60cccac fix: 매각 완료 처리 후 화면 목록이 갱신 안 되던 버그 수정
```

---

### 2026-08-05 세션 20차 (투자 집행 연동 수정 + 자산 구분 라우팅)

#### [CRITICAL] restInsert 직접 호출 시 컬럼명 매핑 누락 ⭐
```
증상: 자금일보 출금 > "투자 집행 연동" 저장 시
      Error: Could not find the 'start' column of 'investments' in the schema cache

원인: investments 의 실제 DB 컬럼은 start_date. useInvestments 의 toDb() 가
  start → start_date 매핑을 담당하는데, InvestExecutePopup 만 이를 거치지 않고
  restInsert('investments', { start }) 를 직접 호출.
  (InvestPage/NewBondForm/BondHistoryPanel 은 inv.save() 경유라 정상)

해결: toDb 를 `export { toDb as investToDb }` 로 공개하고 팝업이 경유하도록 변경.
금지: investments 에 restInsert/restUpdate 를 직접 호출하지 말 것.
      반드시 investToDb() 를 거칠 것 (camelCase→snake_case: start→start_date,
      bondName→bond_name, bondQty→bond_qty, bondPrice→bond_price, bondTicker→bond_ticker).
```

#### [BUG] 연동 팝업의 linked_type/linked_id 가 조용히 유실되던 문제
- 4개 연동 팝업(InvestExecute/InvestReturn/LoanDrawdown/LoanRepayment)은 모두
  `onSaved(amount, currency, memo, linkedType, linkedId)` 로 원천 레코드 id 를 넘기고
  `useDailyReportItems.addItem` 도 두 컬럼을 지원하는데, **`ItemsSection` 의
  `handleLinkedSaved` 가 앞 3개 인자만 선언**하고 호출부도 `(amt, cur, memo) => ...`
  로 잘라 전달해 DB 에 항상 null 로 저장되고 있었음 → 일보 항목 ↔ 자산 레코드
  역추적 불가. 시그니처·호출부·`onAdd` prop 타입에 관통시켜 수정.
- ⚠ TypeScript 는 "인자를 덜 받는 함수"를 허용하므로 이런 유실은 타입 에러가
  나지 않는다. 콜백 인자 추가 시 **호출부의 화살표 함수도 함께 확인할 것.**

#### [개선] 투자 집행 연동에 자산 구분 선택 추가
기존엔 운용자금(investments)으로만 저장돼 타사 RCPS 같은 지분성 투자를 넣을 곳이
없었음. 팝업 상단에 4택 추가 + 각각 올바른 테이블/메뉴로 라우팅:
| 자산 구분 | 저장 테이블 | 메뉴 |
|---|---|---|
| 운용자금 | `investments` (정기예금·MMF·RP 등) | 운용자금 |
| 국채·채권 | `investments` (`product='국채'` + `bond_*`) | 지분/장기투자 > 채권 |
| 상장주식 | `equities` (`market`=KOSPI/KOSDAQ) | 지분/장기투자 > 지분 |
| 비상장주식 | `equities` (`market='비상장'`) | 지분/장기투자 > 비상장 |
- 출금액 자동계산: 지분=`주식수×취득단가`, 국채=`calcBondValue(좌수, 기준가)`.
  수수료로 실지급액이 다르면 override 가능 — 이때 `total_value`(평가액)와
  `acquisition_cost`(취득원가)를 분리 기록하고 차액을 경고 표시.
- 가용여부 기본값: 비상장=불가용, 그 외=가용.

#### [BUG] 렌더 중 컴포넌트 정의 → 입력 포커스 유실
```
초안에서 Row/NumInput 을 컴포넌트 함수 *내부*에 정의 → 매 렌더마다 새로운
컴포넌트 타입이 생성되어 input 이 remount 되고 한 글자 입력마다 포커스가 풀림.
eslint react-hooks 가 "Cannot create components during render" 로 23건 검출.
해결: 모듈 레벨로 호이스팅.
금지: JSX 로 사용하는 헬퍼 컴포넌트를 렌더 함수 안에 정의하지 말 것.
```

#### 기타
- `eslint.config.js` — `sites-mockup/**` 를 lint 대상에서 제외
  (UI/UX 참조용 별도 vinext 프로젝트 + 자체 빌드산출이 lint 에 잡혀 무관한 에러 발생)
- UI/UX 개편 기획서 작성: `C:\Users\attemptgt\.claude\plans\synchronous-humming-cray.md`
  (목업 컨셉 채택 + 단계별 로드맵 + 메뉴별 개선 스펙. 구현은 미착수)

#### 커밋
```
baf8ef9 fix: 투자 집행 연동 저장 실패 수정 + 자산 구분(운용/국채/상장/비상장) 선택 추가
```

---

## 8. 미완료 / 추후 작업

### ECOS_API_KEY 로테이션 — 사용자가 리스크 감내하기로 결정, 더 이상 거론 금지 (2026-08-19)
```
배경(세션20차): "🔄 ECOS 자동" 버튼 클릭 시 ECOS 서버 네트워크 예외로 실패했는데,
그 에러 메시지에 실제 ECOS_API_KEY 값이 포함된 요청 URL이 그대로 노출되어
브라우저 화면(및 사용자가 Claude에 공유한 스크린샷)에 노출됨.
코드는 수정 완료(Code.gs — fetchEcosRates_/calcFxStdDevFromEcos_ 에서 키 마스킹,
커밋 b072ba1).

2026-08-19 사용자 결정: 키 로테이션(폐기·재발급)은 진행하지 않기로 함 — 리스크를
직접 감내하겠다고 명시. 향후 세션에서 이 항목을 다시 권고/거론하지 말 것.
```

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
- **`docs/db/cashflow_plan_items_currency.sql`** ⭐ — `cashflow_plan_items.currency` 컬럼 (세션26차, 주간예측 통화 대응 + 리짐 운영 가정 자동 산출). **실행 완료** (2026-08-18 사용자 확인, 주간예측 항목 추가/삭제 실화면 검증 완료).
- **`docs/db/policy_decision_regime_metric.sql`** ⭐ — `policy_decisions.linked_metric` CHECK 제약에 `fx_regime_gap` 추가 (세션26차 Phase 4). **실행 완료** (2026-08-18 사용자 확인).
- **`docs/db/fx_trade_history_regime_order_type.sql`** ⭐⭐ — `fx_trade_history.order_type` CHECK 제약에 `regime` 추가 (세션26차 Phase 4 **누락분**, 2026-08-18 실화면 검증에서 발견). **실행 완료** (2026-08-18 사용자 확인).
- **`docs/db/policy_params_override_audit.sql`** ⭐ — `policy_params.overridden_by/at/note` (세션26차 Phase 2, 정책 정정 감사 추적). **실행 완료** (2026-08-18 사용자 확인).
- **`docs/db/fx_rate_history.sql`** ⭐ — 일별 환율 이력 테이블 (세션21차 환율 국면 판정·동적 헷지 시뮬레이터 Phase 1). **실행 필요**. 미실행 시 백필/조회가 테이블 부재로 실패(앱 크래시는 없음). ⚠ `Code.gs` 재배포(`?type=fxhistory` 신규 라우트 + `fetchEcosRates_` 날짜 반환 변경)도 함께 필요.
- **`docs/db/closed_date_migration.sql`** ⭐⭐ — `loans`/`investments.closed_date` 컬럼 (세션19차 상환 후 과거 이력 소급변경 버그 fix). **실행 완료** (세션19차 중 사용자 확인).
- **`docs/db/policy_decision_rules_migration.sql`** ⭐ — `policy_decisions.linked_metric`/`target_operator`/`target_value` 컬럼 (세션19차 정책 이행 통제 Phase 1). **실행 완료** (세션19차 중 사용자 확인, 대시보드/자금일보 자동 노출까지 end-to-end 검증 완료).
- **`docs/db/fx_sell_order_deadline_migration.sql`** ⭐ — `fx_trade_history.due_date`/`order_type` 컬럼 (세션19차 정책 이행 통제 Phase 3, 외화 매각 지시). **실행 완료** (세션19차 중 사용자 확인, 재량 매각 지시 등록→완료 처리까지 end-to-end 검증 완료).
- **`docs/db/fx_trade_partial_fill_migration.sql`** ⭐⭐ — `fx_trade_fills` 테이블 + `fx_lot_consumptions.fill_id`/`fx_trade_history.filled_amount` 컬럼 + RPC `complete_fx_trade_fill`/`reverse_fx_trade` (세션26차 3일차, 외화매매거래 부분 체결). **실행 완료** (2026-08-19 사용자 확인, 브라우저 실화면 검증도 완료).
- **`docs/db/fx_trade_fill_reverse_rpc.sql`** ⭐ — RPC `reverse_fx_trade_fill` (세션26차 4일차, 개별 체결 1건만 취소). **실행 완료** (2026-08-19 사용자 확인, 브라우저 실화면에서 "이 체결만 취소" 버튼 정상 노출까지 스크린샷 확인).
- **`docs/db/fx_lots_daily_report_source.sql`** ⭐ — `fx_lots_insert_authenticated` 정책에 `'daily_report_item'` 추가 + 신규 RPC `consume_fx_lots_for_source` (세션26차 6일차, 자금일보 ↔ 외화 원장 자동 반영). **실행 필요**. 미실행 시 원장 ①탭 "자금일보 미반영 증감" 패널의 "원장 반영" 버튼이 유입은 RLS 거부, 유출은 함수 없음 오류를 반환.
- **`docs/db/fx_ledger_reconcile_ignore.sql`** ⭐ — `fx_ledger_reconcile_ignored` 테이블(세션26차 6일차 후속, 개시일 이전 미반영 항목 "무시" 처리). **실행 필요**. 미실행 시 "무시" 버튼이 테이블 없음 오류를 반환(원장 반영/타임라인 표시 자체는 영향 없음).
- **`docs/db/fx_transfer_selfconsume_guard.sql`** ⭐⭐ — 계좌 대체 자기 소진 방어 hotfix
  (세션26차 12일차 후속). **실행 필요.** `fx_txn_type.sql` 이후 실행.
  ⚠ 재예치(정기예금→정기예금)처럼 출금·입금 계좌유형이 같으면 FIFO 루프가 **자기가 방금 만든
  로트를 다시 소진**할 수 있었다(plpgsql 커서 가시성은 "절대 안 보인다"를 보장하지 않는다).
  소진 대상 WHERE 에 `transfer_id <> v_transfer_id` 를 추가해 구조적으로 차단.
- **`docs/db/fx_term_deposit_settle.sql`** ⭐⭐ — 정기예금 해지·재예치 + 운용자금 연동
  (세션26차 12일차 Phase 2). **실행 필요.** `fx_lot_transfer.sql`·`fx_txn_type.sql` 적용 후 실행할 것.
  미실행 시 데이터 등록 탭의 "정기예금 관리" 해지·연결이 함수 없음 오류를 반환한다.
- **`docs/db/fx_txn_type.sql`** ⭐⭐ — 거래 유형(`txn_type`) 도입 (세션26차 12일차 Phase 3).
  **실행 필요 — 다음 세션 최우선.** 미실행 시 수동 유출 등록·자금일보 반영이 `p_txn_type` 을
  넘기는데 서버는 8인자 버전이라 **시그니처 불일치로 실패**한다(다른 기능은 영향 없음).
  ⚠ `fx_lot_transfer.sql` 적용 후에 실행할 것(transfer_fx_lots 를 재정의한다).
- **`docs/db/fx_lot_transfer.sql`** ⭐⭐ — 계좌 간 대체 (세션26차 12일차). `fx_lot_transfers` 테이블 +
  `transfer_fx_lots`/`reverse_fx_lot_transfer` RPC + `fx_lots.transfer_id`/`investment_id` 컬럼 +
  `source_type` CHECK 확장. **실행 완료** (2026-08-20 사용자 확인).
- **`docs/db/fx_fifo_account_priority.sql`** ⭐⭐ — FIFO 계좌유형 소진 우선순위 (세션26차 11일차).
  헬퍼 `fx_fifo_account_rank()` 신규 + `complete_fx_trade_fill`/`consume_fx_lots_for_source`
  재정의(order by 한 줄만 변경). **실행 완료** (2026-08-20 사용자 확인).
  ⚠ 원가흐름 가정 변경이지만 `fx_fifo_account_priority` 파라미터가 **미설정이면 기존과
  동일하게 취득일 순으로 소진**한다 — 실제로 순서가 바뀌려면 자금정책 › FX 정책 ›
  ② 정책 기준에서 법인별로 우선순위를 의결 저장해야 한다.
- **`docs/db/fx_regime_snapshot_history.sql`** ⭐ — `fx_regime_snapshot_history` append-only 이력 테이블(세션26차 7일차, 조치 카드 일자별 조회). **실행 필요**. 미실행 시 이력 기록이 조용히 스킵되고(recordHistory insert 실패, 판정 자체엔 영향 없음) "조치 이력 조회" 카드가 항상 "기록된 이력이 없습니다"로 표시됨.

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
/fx-ledger/:company?[?tab=ledger|orders|lots|pnl]  ← 외화 원장 (재고 FIFO + 매각 지시 워크플로우 통합, 세션26차 4~5일차)
/fx-trade-history/:company?  ← 구 경로, /fx-ledger?tab=orders 로 리다이렉트만 함
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

### 2026-08-12 세션23차 — FIFO 장부 정상화 경로 시각화
- `fxBacktest.ts`: 시작 재고를 개시 FIFO 로트, 이후 순유입을 유입일 시장환율의 신규 로트로 추적하고 환전 시 오래된 로트부터 소진하도록 확장. 판정은 기존 `evaluateRegime()` 및 `series.slice(0, i+1)` 계약을 유지.
- `BacktestTab.tsx`: 시장환율 vs 잔존 FIFO 장부환율, 누적 실현손익 vs 남은 평가손익 vs 총손익 그래프 추가. 장부 정상화와 미래 이익은 조건부이며 보장되지 않음을 명시.
- 검증: 변경 파일 TypeScript 0 errors, ESLint 0 errors, Vite production build 성공. 이후 `npx tsx` 실행 권한을 확보해 환율 엔진 50/50도 확인함.

### 2026-08-12 세션23차 — FIFO 시뮬레이션·원장 기반·Treasury 조회 연동
- 미래 환율 가정(유지/상승/하락/최근 1년 반복)과 6~36개월 기간을 선택하는 FIFO 경로 시뮬레이션 추가. 개시 재고 소진·장부환율 정상화·총손익 BEP 날짜를 조건부 결과로 표시.
- `fxLots.ts` 순수함수와 단위 테스트 3건 추가. FIFO는 취득일/ID 순으로 소진하며 원본 불변.
- `/fx-ledger` 외화 FIFO 원장 페이지와 개시 로트 등록 UI 추가. 등록은 사용자 버튼 클릭 때만 수행.
- `docs/db/fx_lot_ledger.sql` 추가. 프로덕션 DB에는 직접 적용하지 않았음.
- 환율 국면의 Treasury 입력 모드 활성화: `totalFundAvail`, 통화별 운전·운용잔액, `fx_target_min/max`, FIFO 잔존 장부환율을 조회 연동. 운영 가정은 수동값 병행.
- 검증: TypeScript 0 errors, 변경 파일 ESLint 0 errors, Vitest 3/3, Vite build 성공, 환율 엔진 50/50.
- 후속 단위 수정: Treasury 운전자금 `daily.fx_{통화}` 운영값을 외화 원금으로 직접 사용하던 오류를 수정.
  통화별 원화 환산 잔액을 최신 환율로 역산한 뒤, 외화 원금으로 저장된 운용자금만 더한다. 기본 입력 소스도 Treasury 연동으로 변경했다.

### 2026-08-12 세션23차 — 실제 재고·매각 CSV 이관 및 FIFO 거래 연결
- `fxCsvImport.ts`: 재고/매각 CSV 파싱·검증·0원 제외·실현손익 계산과 테스트 추가.
- 외화 FIFO 원장에 CSV 미리보기/중복검사/사용자 확정 일괄 등록, 보유 로트·매각 이력·손익 요약 탭 추가.
- 2026년 과거 매각은 완료 실적으로만 복원하고 2026-08-11 개시 재고를 다시 차감하지 않음.
- 규칙 검증에 동일 통화·기간의 실제 매각 가중평균환율과 확정손익 비교 추가.
- `fx_fifo_trade_rpc.sql`: 인증·권한 확인 후 환전 완료+FIFO 소진 및 완료 취소+원복을 원자적으로 처리. anon 실행권한 금지.
- 검증: TypeScript/변경 파일 ESLint 0 errors, CSV/FIFO 테스트 5/5, Vite build 성공, 엔진 50/50.
- 후속 UI 수정: 브라우저 기본 file input이 클릭되지 않는 문제를 숨김 input+명시적 `CSV 파일 선택` 버튼 방식으로 교체.
  개시 로트 수정/삭제와 과거 CSV 매각 수정/삭제 UI 추가. 소진 로트는 RPC가 수정·삭제를 거부한다.
  `docs/db/fx_ledger_edit_rpc.sql`은 authenticated 권한 사용자만 허용하고 삭제는 master/admin/can_delete로 제한한다.
- FIFO 계좌 유형 확장: `demand_deposit`/`term_deposit`, 연이율, 만기일을 원장·CSV·수동 입력에 구조화. 정기예금은 만기 전 환전 가능액과 FIFO 소진 후보에서 제외하고 만기일부터 소진 가능하다.
- 예상 정기예금 이자는 원금 환차손익에 섞지 않고 별도 표시. 실제 이자 입금 시 신규 로트로 등록하는 원칙을 적용했다.
- 재고/매각 CSV 표준 양식 다운로드 버튼과 엄격한 정기예금 만기 검증 추가. 기존 DB에는 `fx_lot_account_type_migration.sql`, 최신 편집/거래 RPC를 사용자가 순서대로 적용해야 한다.
- 외화 정책 비중의 모수를 전사 포트폴리오 바구니로 통일: 모든 통화의 운전·운용 외화(가용/잠금 포함) 원화환산 합계 ÷ 전사 총자금. `daily.fx_usd` 등을 원화로 오인해 재환산하던 환전 판단 단위 오류 수정.
- 환전 판단 입력에 전사 바구니와 통화별 원금/환산액/구성비를 표시하고, 통화 탭은 바구니 전체의 초과분 중 해당 통화의 현재 환전 가능 재고까지만 집행하도록 변경.
- 정책밴드 상한과 중복되는 `최대 미환전 노출 한도`를 실시간 입력·판정에서 제거. 고정 한도 엔진 필드는 레거시 검증 호환만 유지하고 null로 전달한다.
- `FxPolicyTab`, `PolicyPage`, `policyChecks`도 동일한 전사 FX 분자·분모를 사용하도록 수정. 가용자금 구성비 화면은 운영 유동성 지표로 별도 유지한다.

### 2026-08-12 세션24차 — 실데이터 대조로 발견한 FIFO 원장 결함 3건 수정 ⭐

인수인계 상세: `docs/기획/환율국면_인수인계_세션24.md` §8.3

#### [CRITICAL] 만기 전 정기예금 USD 6,000,000이 "즉시 환전 가능"으로 집계되던 문제
```
증상: /fx-ledger 의 "현재 환전 가능액"이 실제보다 600만 달러(약 85억원) 많게 표시.
      그만큼 환전 권고액도 부풀려짐.
원인: 초기 CSV 이관이 account_type 컬럼 도입 **이전**에 실행돼,
      계좌유형·이자율·만기가 memo 텍스트로만 남고 컬럼은 전부 기본값
      (demand_deposit / 0 / null)으로 저장됨. 60건 중 term_deposit 0건.
해결: /fx-ledger 에 「계좌유형 교정」 버튼 추가. CSV 를 기준으로 계좌유형·이자율·만기만
      되돌린다(금액·환율 불변). 계획 미리보기 → 사용자 승인 후에만 RPC 실행.
      memo 의 import-key 로 매칭하므로 원본 CSV 만 있으면 복구된다.
```

#### [CRITICAL] 화이트리스트 방식이 만든 "조용한 잠금"
```
증상: 새 계좌유형이 추가되면 경고 없이 FIFO 후보에서 빠져 환전 가능액이 과소 계산됨.
원인: isLotAvailable / FIFO RPC 가 account_type='demand_deposit' 를 **화이트리스트**로 사용.
      새 유형은 maturity_date 가 null 이라 `maturity_date <= 거래일` 이 NULL 로 평가 →
      조건 불성립 → 말없이 잠김.
해결: 잠기는 유형(term_deposit)만 명시하는 **블랙리스트로 반전**.
      src/lib/fxLots.ts 의 LOCKED_ACCOUNT_TYPES 로 SSOT 화. SQL 제약·RPC 도 동일 수정.
금지: `accountType === 'demand_deposit'` 형태의 가용성 판정을 되살리지 말 것.
```

#### [BUG] 스키마에 없던 세 번째 계좌유형 `mmda`
실제 개시재고 CSV 구성 — `demand_deposit` 14건 / **`mmda` 6건(USD 5,347,168.58)** / `term_deposit` 2건.
파서가 `mmda` 를 거부해 **같은 CSV 를 다시 올릴 수 없는 상태**였다.
MMDA는 수시입출식이라 **환전 가능성은 보통예금과 동일**, 이자율만 붙고 만기는 없다.
스키마·파서·입력 UI·FIFO 전부에 3종 반영. 입력폼은 유형에 따라 노출 필드가 바뀐다
(보통예금 = 없음 / MMDA = 이자율 / 정기예금 = 이자율+만기일).

#### [BUG] CSV 재업로드 시 60건 중복 삽입 위험
```
원인: memo 에 저장된 import-key 는 5필드인데 inventoryKey 가 7필드로 확장되면서
      기존 키와 절대 일치하지 않게 됨 → 중복 감지 실패 → 전량 재삽입.
해결: 중복 판정 전용 inventoryMatchKey(5필드) 신설.
      ⚠ 이자율·만기는 **교정 대상**이므로 판정 키에 넣으면 안 된다.
```

#### [UX 결함] window.confirm 이 차단되면 조용히 아무 일도 안 일어남 ⭐
```
증상: 「교정 대상 확인」을 눌러도 버튼만 깜빡이고 아무 반응이 없다.
원인: 크롬은 같은 페이지에서 대화상자가 반복되면 "추가 대화상자 표시 안 함"으로 차단한다.
      그러면 window.confirm() 이 **즉시 false 를 반환**하고,
      취소 분기에는 아무 메시지도 없어 "먹통"으로 보인다.
      (사용자가 로트 수정 등으로 confirm 을 여러 번 띄운 뒤 발생)
해결: 데이터를 바꾸는 조작은 window.confirm 대신 **화면 안 미리보기 패널**로 승인받는다.
      교정 대상 표(취득일/통화/금액/현재→교정후/만기)를 띄우고
      「이 N건 교정 실행」 버튼을 눌러야 저장된다.
금지: 되돌릴 수 없거나 다건을 한꺼번에 바꾸는 조작에 window.confirm 만 쓰지 말 것.
      차단 시 사용자가 원인을 알 수 없고, 취소와 차단을 구분할 방법도 없다.
```

#### 기타
- 교정 버튼을 **CSV 선택 시에만** 노출했더니 사용자가 찾지 못했다 → 항상 노출로 변경.
  memo 의 `import-key` 에 계좌유형·만기가 들어 있어 **CSV 없이도 교정 가능**하다
  (연이율만 CSV 필요). `intentFromMemo()` 로 복원한다.
- `format.test.ts` 선재 실패 수정 — `2026-05-25`를 평일로 가정했으나 부처님오신날(5/24 일)의
  **대체공휴일**이었다. `bizDay.ts` 데이터가 옳고 테스트가 틀렸다. 평일 케이스를 `2026-05-18`로
  옮기고 대체공휴일 케이스를 오히려 테스트로 추가.
- ⛔ **RPC 호출로 SQL 적용 여부를 확인하지 말 것.** 개발 브라우저에 실제 관리자 세션이
  살아 있어 권한 검사를 통과한다. 적용 여부는 SELECT 로만 확인하거나 사용자에게 물을 것.
  (세션24차 실사고 직전 — 인수인계 문서 §5.1)
- 검증: tsc 0 errors · lint 0 errors · 엔진 50/50 · **Vitest 226 → 235** · build 성공
- 후속 안전성 정리: CSV 등록은 이미 화면에 검증 결과와 명시적 `검토한 ... 등록` 버튼이 있어
  차단 가능한 `window.confirm`을 제거했다. 로트/과거 매각 삭제는 화면 내 삭제 대상 패널과
  `삭제 실행/취소` 2단계로 교체했다. MMDA가 보유 로트 표에서 보통예금으로 표시되던 문제와
  MMDA 연이율이 숨겨지던 문제, 정기예금 만기 검증 실패 후 저장 버튼이 멈추는 문제도 수정했다.
- 경영진 설명자료 개편: `docs/presentation/fx-regime-executive-briefing.html`을 8장 전체화면
  슬라이드형으로 신규 작성. 전사 FX 바구니→국면·수준→환전 가능 재고→FIFO→경영진 의사결정
  흐름으로 단순화하고 MMDA·정기예금 만기 잠금·손익 분리 등 최신 구조를 반영했다.
  기존 `fx-regime-briefing.html`은 새 자료로 자동 이동한다.
- 경영진 설명자료 메커니즘 보강: `docs/presentation/fx-regime-mechanism-briefing.html`을 13장으로 작성.
  원시 종가→칼만 평활→ER20·순변동폭→변동성 Z→히스테리시스→앵커 수준→5×3 목표비중
  →회사 제약→환전액→FIFO 집행까지 실제 엔진의 인과관계를 설명하고, 기존 설명자료 주소를
  이 보강본으로 연결했다. 1600×900 렌더링에서 13장 및 가로 오버플로 없음 확인.
- 발표자 대본 추가: `docs/presentation/fx-regime-mechanism-speaker-script.md`에 13장별 한 줄 핵심,
  그대로 읽는 대본, 초등학생 수준의 비유, 다음 장 연결 문장과 예상 질문 답변을 작성했다.
- 설명자료 타이포그래피 최종 정리: 13장 전체의 제목을 의미 단위로 고정하고 조사·어절 중간
  줄바꿈을 방지했다. 1장 제목 고아 단어, 3장 프로세스 카드, 5장 수식 계층, 6장 카드 대비,
  10장 본문 대비, 12장 단계명/보조문구, 13장 결론 문장을 재배치했다. 1600×900 재렌더링에서
  13장 전체 및 가로 오버플로 없음 확인.
- 민감 메뉴 기본 비공개 전환: `환율 국면(fx-regime)`과 `외화 FIFO 원장(fx-ledger)`에 독립
  메뉴 슬러그를 부여하고 역할 기본 메뉴에서 제외했다. 사용자 관리의 메뉴 접근 탭에서 명시적으로
  허용한 계정(및 최고관리자)만 사이드바와 직접 URL 라우트에 접근한다. 환율 국면의 DEV 전용
  게이트는 제거해 권한 승인 사용자에게 프로덕션에서도 노출되도록 했다.
- 환율 국면 자금 입력 개선: 수동 입력에 `Treasury 주요 금액 불러오기`를 추가해 총자금·전사
  외화 바구니·선택 통화 보유액·FIFO 평균 장부환율만 로컬 수동값으로 복사한다. 월 유입·결제
  버퍼·손실 한도·정책밴드는 보존한다. Treasury 연동에서도 정책밴드 상·하한을 독립 수동값으로
  편집할 수 있게 해 Treasury 정책 파라미터의 고정값 연동을 제거했다.
- 환율 국면 공통 자금·정책 입력 카드를 기본 접힘으로 바꾸고, 접힌 상태에는 총자금·전사
  외화비중·정책밴드 요약만 표시한다. 시뮬레이션의 `수준(Level) 축 도입 효과` 대조표는 개발
  검증용 중복 계산이라 제거했으며, 검증 근거는 엔진 테스트와 정책 프로토콜에 유지한다.
- FIFO 시뮬레이션 설명을 `현재 시작 재고와 동일한 월 유입을 과거 실제 환율에 적용한 가정`으로
  명시했다. 누적 실현손익·남은 재고 평가손익·두 값을 합한 총손익의 의미와 실제 과거 실적 및
  미래 수익 보장이 아니라는 점을 차트 제목과 안내문에 함께 표시했다.
- 정책 프로토콜의 계산 기준·집행 규칙 13개에 조정 게이지와 권장값 위치 표시를 추가하고 전체
  카드를 접고 펼 수 있게 했다. 기존 물음표 설명은 권장 근거와 상향·하향 변경의 장단점을 유지한다.
- 정책표의 세 값 자동 조정에 상단 정책밴드 적용 버튼을 추가했다. 밴드 미설정 시 15%·30%·42%
  권장 구조를 기본으로 보여주며, 적용 시 하한·상한을 최소·최대로 고정하고 중립은 권장 상대
  위치(15/27)로 산출한다. 적용 뒤 중립값은 정책회의 의결에 따라 별도로 조정할 수 있다.

**⚠ 적용 필요 SQL (사용자 실행)**: `docs/db/fx_lot_mmda_migration.sql` 신규 +
`fx_ledger_edit_rpc.sql` · `fx_fifo_trade_rpc.sql` 재실행

---

### 2026-08-14 세션26차 (FX 리짐 모델 정책 채택 → 자금정책 이관 Phase 1)

2026-08-14 정책회의에서 **FX 리짐 모델을 FX 정책 모델로 채택**. 전체 이관 계획은
`docs/기획/FX리짐_정책이관_계획.md` 참조 (Phase 1~4). 이번 세션은 Phase 1 완료.

#### 결정된 구조 — 대체가 아니라 계층
```
한도(밴드)는 리스크 모델(σ×Z)이, 시점과 금액은 리짐이 정한다.
/fx-regime  = 실무 일상 화면(매일)     — 정책값은 읽기 전용
/policy › FX = 정책 기준 + 모니터링    — 여기서만 정책값 편집
```
기존 손실허용 한도 모델은 폐기하지 않고 **한도 계산기**로 존치(Phase 3에서 서브탭 분리).

#### ⭐ 소유권 원칙 — 가정은 정책, 사실은 실무
사용자 결정: **실무자가 독단으로 바꾸는 일은 없어야 한다.**
| 소유 | 항목 |
|---|---|
| `policy` | 정책 밴드, 앵커·수준임계·5×3 목표표·국면판정 등 프로토콜, **월 외화 유입 가정**, **결제 버퍼**, 분기 손실실현 한도 |
| `ops` | 이번 분기 기실현 손실, 매각 체결환율, FIFO 로트 등록 |
| `treasury` | 총자금, 전사 바구니, 통화별 보유액, FIFO 장부환율, ECOS 환율 이력 |

월 유입·결제 버퍼가 정책 소유인 이유: 버퍼 하한을 통해 **권고 환전액을 직접 움직인다**.
버퍼를 250만→500만불로 올리면 하한이 올라가 "환전 불필요"가 나온다. 실무가 만지면 안 되는 레버.

#### [CRITICAL] 실무 입력이 localStorage 에만 있어 정책회의가 정정할 수 없었다 ⭐
```
증상: 정책회의가 리짐 화면의 운영 가정(월유입·결제버퍼·손실한도·정책밴드)을
      볼 수도 고칠 수도 없었다. 담당자 PC마다 값이 달라도 아무도 몰랐다.
원인: fxRegimeInputs.ts 가 `fx_regime_inputs_{법인}_{통화}` 키로 localStorage 에만 저장.
      서버에 값이 없으니 정정 대상 자체가 존재하지 않았다. (충돌 문제가 아니라 저장 위치 문제)
해결: 전부 policy_params(법인 단위)로 이관 + 소유권을 코드에 고정(FIELD_OWNER).
      신규 키 — fx_ops_monthly_inflow_{cur} / fx_ops_payable_{cur} /
                fx_ops_loss_cap / fx_ops_loss_used
      정책 밴드는 기존 fx_target_min/max 를 그대로 공유(드디어 연결됨).
금지: localStorage 로 되돌리지 말 것.
```

#### [CRITICAL] 정책 밴드 단위 불일치 — %(20) vs 0~1(0.20)
`fx_target_min/max` 는 DB 에 **%** 로, 리짐 엔진은 **0~1** 로 쓴다.
변환은 `fxRegimeInputs.pctToRatio` **한 곳에만** 둔다. 두 군데서 나누면 20% 가 2000% 로 들어간다.

#### [CRITICAL] 수동 입력 모드가 잠금 우회 경로였다
```
증상 가능성: 정책 필드를 잠가도 `수동 입력` 토글로 총자금·보유액까지 임의값으로 바꾼 뒤
      그 결과로 권고를 받을 수 있었다.
해결: InputSource 를 'manual'|'treasury' → **'live'|'simulation'** 으로 재정의.
      live = Treasury 실데이터 + 정책 파라미터 (권고가 나오는 유일한 경로, 기본값)
      simulation = 저장 안 함(새로고침 시 소멸) + 헤더/패널 경고 배너 + 되돌리기 버튼
      updateInputs 는 simulation 이 아니면 **아무 일도 하지 않는다**(어댑터 레벨 차단).
금지: live 모드에서 편집 가능한 입력을 다시 만들지 말 것.
```

#### 변경 파일
- `src/lib/fxRegimeInputs.ts` — 전면 재작성. `FIELD_OWNER`/`ownerOf()`/`FX_OPS_PARAM_KEYS`
  공개, `useFxTreasuryInputs(source, company, currency, treasuryValues, **params**)` 로 시그니처 변경.
  ⚠ usePolicyParams 의 get/set 은 메모이즈되어 있지 않아 매 렌더 새 참조 → deps 에 넣으면
  렌더 루프. ref + primitive deps 패턴으로 회피(CLAUDE.md §10).
- `src/pages/FxRegimePage.tsx` — 필드별 소유 배지(🔒정책/🏦조회/✏️실무), live 모드 잠금,
  시뮬레이션 배너, `자금정책 관리에서 변경 →` 링크, 밴드 미설정 경고.
  실무 입력(기실현 손실)만 onBlur 서버 저장(`saveOpsInput`).
- `src/components/policy/FxRegimeOpsCard.tsx` (신규) — 정책회의 전용 편집 카드.
  통화별 월유입/결제버퍼 + 밴드 상·하한 + 분기 손실한도, 변경분만 일괄 저장.
  공통 `NumInput` 재사용(미설정 null 구분용 `ParamInput` 래퍼).
- `src/components/policy/FxPolicyTab.tsx` — 위 카드 마운트(요약 배너 직후).

#### 검증
tsc 0 errors · 변경 파일 lint 0 errors/0 warnings · Vitest 235/235 · 국면 엔진 50/50.
⚠ `pnpm build` 는 이 PC 환경에서 `fs.copyFileSync` 가 EPERM 으로 막혀 public 자산 복사
단계에서 실패한다(754 모듈 번들링 자체는 성공, `cp` 는 정상 동작 — 코드 문제 아님).

### 2026-08-14 세션26차 Phase 2 (정책 화면 정식 신설 + 판정 SSOT 통합)

#### ⭐ useFxRegime — 판정 경로 단일화
`src/hooks/useFxRegime.ts` 신규. 환율 이력 → 프로토콜 조립 → TreasuryContext 구성 →
`evaluateRegime` 까지 **전 경로를 한 훅에** 모았다. 실무 화면(/fx-regime)과 정책 화면이
같은 숫자를 봐야 하는데, 계산이 두 곳에 복제되면 반드시 갈라진다(세션19차 6.2% vs 27.9% 사고).
```
useFxRegime(company, currency, source='live', autoSync=false)
  → { params, policyData, fxLots, hist, inputs, series, protocol, ctx, signal,
      latestRate, fxPayableFx, fxPayableKRW, availableFx, validPolicyBand, basket }
```
⚠ `autoSync` 는 **실무 화면만 true**. 정책 화면까지 켜면 같은 ECOS/GAS 호출이 중복된다
(세션17차 UrlFetch 할당량 폭발 재발 위험).
금지: 화면에서 목표비중을 다시 계산하지 말 것 — 판정은 `evaluateRegime` 한 경로뿐이다.

#### FX 정책 탭 3서브탭 재편
| 서브탭 | 내용 | 편집 |
|---|---|---|
| `① 🧭 리짐 이행 현황` | 국면·수준·목표 게이지(밴드 오버레이), 권고액, 환전 가능 재고 vs 권고액, 손실한도 소진율, 미완료 매각 지시 D-day | 읽기 |
| `② 🎯 정책 기준` | `FxRegimeOpsCard`(밴드·운영가정) + `ProtocolTab`(앵커·수준임계·5×3 목표표) | **유일한 편집 지점** |
| `③ 📐 한도 · 집행` | 기존 σ×Z 한도 모델 + 매각 지시 워크플로우 (그대로) | 기존과 동일 |

- 리짐 서브탭은 **활성일 때만 마운트**한다 — 환율 이력·FIFO 로트·법인 실데이터 조회가
  딸려 있어 보이지도 않는 탭에서 미리 돌리면 낭비다. (조건부 렌더로 훅 실행 자체를 막음)
- `ProtocolTab` 은 실무 화면(`FxRegimePage`)에서 **제거**했다. 탭이 4개 → 3개
  (`현재 국면 / 환전 판단 / 규칙 검증`). 실무 화면에 정책 편집 UI를 되살리지 말 것.
- 모니터링 카드는 **재고 부족과 실무 미이행을 구분**한다. 정기예금 만기 전 금액 때문에
  권고액을 다 집행할 수 없는 경우를 "미이행"으로 읽으면 담당자에게 부당하다.

#### override 감사 추적
`docs/db/policy_params_override_audit.sql` ⭐ (**실행 필요**) —
`policy_params` 에 `overridden_by` / `overridden_at` / `override_note` 추가(전부 nullable).
`usePolicyParams.set(key, value, text, updatedBy, audit?)` 5번째 인자로 사유를 넘긴다.
⚠ 컬럼이 없는 환경에서는 PostgREST 가 스키마 오류를 반환하므로 **감사 필드를 빼고 1회 재시도**한다
— 사유 기록보다 의결값 반영이 우선이기 때문. 미적용 상태에서도 저장은 정상 동작하고 사유만 남지 않는다.
소유권은 코드(`FIELD_OWNER`)에 고정이라 `value_source` 컬럼은 두지 않았고, 정정 해제 기능도 없다.

#### 검증
tsc 0 errors · 신규 파일 lint 0 errors/0 warnings(전체 src 0 errors) · Vitest 235/235 · 엔진 50/50.

### 2026-08-14 세션26차 Phase 3 (한도 계산기 분리 + 자동저장 제거)

#### FX 정책 서브탭 4개로 확정
`① 🧭 리짐 이행 현황 / ② 🎯 정책 기준 / ③ 📐 한도 계산기 / ④ 🧾 매각 집행`
계산기(참고안 생성)와 집행(실제 돈이 나가는 워크플로우)을 나눴다 — 한 화면에 있으면
계산 결과가 곧 확정인 것처럼 읽힌다.

#### [CRITICAL] Target Band 자동저장 제거 ⭐
```
기존: 🎯 자동설정 버튼 → window.confirm 한 번 → fx_target_min/max 즉시 저장.
문제: 리짐 채택 후 밴드는 리짐 목표비중을 가두는 **제약**이 됐다. 계산기가 단독으로
      확정하면 정책회의를 거치지 않고 판정 결과가 바뀐다.
변경: 3단계로 분리.
      📐 권고 밴드 계산 (계산만) → 📥 정책 기준으로 불러오기 (②탭 초안으로 인계)
      → ②탭에서 사유와 함께 의결 저장 (여기서만 DB 반영)
금지: 계산기에서 params.set('fx_target_min'|'fx_target_max', ...) 을 직접 호출하지 말 것.
```

#### 초안 인계는 effect+setState 가 아니라 useMemo 병합으로
```
부모 FxPolicyTab 이 bandDraft state 를 들고, 자식 FxRegimeOpsCard 가
effectiveDraft = { ...(incomingBand ?? {}), ...userDraft } 로 병합한다(사용자 편집 우선).
effect 로 setDraft 하면 ① 캐스케이드 렌더 ② 사용자가 값을 지워도 계산기 값이 되살아남.
부모 초안은 저장 성공·되돌리기 때만 비운다 — 서브탭을 오가도 초안이 살아남게.
⚠ onConsumeBand 는 useCallback 필수(자식 deps 에 들어감).
```

#### 검증
tsc 0 errors · 신규/변경 파일 lint 0 errors·0 warnings(전체 src 0 errors, 69 warnings=기존 수준)
· Vitest 235/235 · 엔진 50/50.

### 2026-08-14 세션26차 Phase 4 (리짐 이행 통제 — 스냅샷·미이행 감지·집행 경로)

#### ⭐ 판정 스냅샷 — 대시보드에서 엔진을 돌리지 않기 위한 장치
```
문제 ① 대시보드·자금일보는 전 사용자가 여는 화면인데, 리짐 판정에는 환율 이력
        1,000여 건 + FIFO 로트 조회가 필요하다. 매번 돌릴 수 없다.
문제 ② "권고가 언제 처음 났는지" 기록이 없어 미이행 경과일을 셀 수 없었다
        (매각 지시로 등록되기 전까지 권고는 어디에도 저장되지 않음).
해결  src/lib/fxRegimeSnapshot.ts — 실무 화면이 판정할 때 결과 요약만 policy_params 에
      남기고, 다른 화면은 그 숫자만 읽는다.
      키: fx_regime_snap_{target|current|suggest|since|asof}_{cur}
      since 규칙: 조치 불필요→권고=오늘로 설정 / 권고 지속=유지(경과일 증가) /
                  권고→조치 불필요=삭제. 변경 없으면 아무것도 쓰지 않는다.
금지: 시뮬레이션 모드에서 스냅샷을 쓰지 말 것 — 가정값이 전사 경보로 번진다.
      (FxRegimePage 의 sync effect 는 inputSource==='live' 를 먼저 확인한다)
검증: 단위 테스트 6건 (fxRegimeSnapshot.test.ts) — since 전이 규칙 전부 커버.
```

#### checkFx(밴드 준수) vs checkFxRegimeTarget(목표 이행) — 다른 위반이다
`checkFx` 는 정책 밴드 안에 있는지, `checkFxRegimeTarget` 은 오늘 국면이 지시한
목표까지 줄였는지를 본다. **밴드 안에 있어도 리짐 목표를 초과 보유할 수 있다.**
의결 규칙에도 `linked_metric: 'fx_regime_gap'`(목표 대비 초과 보유 %p)을 추가했다.
통화가 여럿이면 가장 큰 초과 폭으로 판정하고, 스냅샷이 없으면 위반 없음으로 본다(오탐 방지).
**DDL**: `docs/db/policy_decision_regime_metric.sql` ⭐ (CHECK 제약 교체, **실행 필요**)

#### 미이행 노출 — 1영업일 유예
대시보드 이슈 티커(`fx_regime_{법인}_{통화}`)와 자금일보 `PendingRegimeBanner`.
당일 발생한 권고까지 경보로 올리면 노이즈라 **1영업일 지난 것만** 노출한다.
`makeIssueKey` 에 `'fx_regime'`, `issueLink` 에 `/fx-regime/{법인}` 매핑 추가.

#### order_type='regime' + 권고 → 매각 지시 등록
- `src/lib/fxOrderType.ts` — 라벨 SSOT. 기존엔 대시보드·자금일보가 삼항 연산자로
  두 종류만 구분해, 새 유형이 "한도초과 매각"으로 잘못 표시될 상태였다.
- 실무 화면 `환전 판단` 탭에 `이 권고로 매각 지시 등록` — 기존 발의→승인→완료
  워크플로우에 그대로 태운다(기한 +3영업일, 환율 무관 실행).
  ⚠ 승인은 **화면 안 미리보기 패널**로 받는다. `window.confirm` 은 크롬이 반복
  대화상자를 차단하면 즉시 false 를 반환해 "눌러도 아무 일 없는" 상태가 된다(세션24차 실사고).
  live 모드 + 편집 권한일 때만 노출한다.

#### 검증
tsc 0 errors · 전체 src lint 0 errors(69 warnings=기존 수준) · Vitest **241/241**(신규 6건)
· 엔진 50/50.

### 2026-08-14 세션26차 — 브라우저 실동작 검증 (playwright)

메디아나 법인·master 계정으로 `/policy` › FX 정책 4개 서브탭을 실제로 열어 확인했다.
(읽기 전용 확인 — 저장 버튼은 누르지 않음. `/fx-regime` 은 스냅샷 **쓰기**가 발생하므로
사용자 승인 전까지 열지 않았다.)

| 서브탭 | 결과 |
|---|---|
| ① 리짐 이행 현황 | 정상 — 국면 5-B(강한 하락·저변동성) · 수준 중립 · 목표 25.0% vs 현재 29.5% · 권고 매도 41.5억(USD 2,933,716) · 환전 가능 재고 USD 8,088,438(보유 14,088,438 중 정기예금 제외) |
| ② 정책 기준 | 정상 — 운영 가정 표 + 밴드 25/30 + ProtocolTab(수준×추세 매트릭스) |
| ③ 한도 계산기 | 정상 — `📐 권고 밴드 계산` 버튼, 실효한도 275.6억 |
| ④ 매각 집행 | 정상 — 매각 지시 관리 + 통화별 상한 표(EUR 초과 → 매도 발의) |

실측이 Phase 4 설계를 그대로 확인해줬다: **현재 29.5% 는 정책 밴드(25~30%) 안이지만
리짐 목표 25.0% 는 초과**한다 — `checkFx`(밴드)와 `checkFxRegimeTarget`(목표)을 분리한 이유.

#### [BUG] 검증에서 발견해 고친 것 2건
```
① 폴백값이 통화를 가리지 않고 적용됐다
   defaultsFor(company) 가 메디아나면 **모든 통화**에 월 300만·버퍼 250만을 적용했다.
   실측된 건 USD 수급뿐이라 EUR·JPY·GBP 의 버퍼 하한이 근거 없이 올라간다(= 환전을 덜 함).
   → regimeOpsFallback(company, currency) 로 USD 에만 적용.
② 화면(0)과 엔진(300만)이 달랐다
   정책 기준 탭은 params.get() 을 직접 읽어 미설정이면 0 으로 보였는데, 판정에는 폴백이
   들어간다. 회의체가 실제 적용값을 알 수 없다.
   → placeholder 에 "3,000,000 (기본값 적용 중)" 으로 노출 + 안내문 추가.
```

#### [CRITICAL] 국채 자동 시세갱신 — 3중 결함, 되살리면 이력이 파괴될 뻔했다 ⭐
```
증상: 앱 로드 때마다 법인 수만큼 400.
  GET /rest/v1/investments?...&product=eq.국채&order=start.asc → 400

결함 ① 컬럼명   : 실제 컬럼은 start_date 인데 order=start → PostgREST 400.
       그 400 이 catch{} 에 삼켜져 **국채 갱신이 죽은 줄도 몰랐다**(수년치 무동작).
결함 ② 매핑 누락 : restSelect 는 **DB 행(snake_case)** 을 그대로 준다. 코드가
       b.bondTicker/b.priceDate/b.bondQty 로 읽어 전부 undefined → 필터 전량 탈락.
       restUpdate 에도 camelCase(bondPrice/priceDate)를 그대로 보내 없는 컬럼 400.
결함 ③ ⚠⚠ 이력 파괴 : 조회된 **모든 행**을 돌며 같은 최신 기준가로 UPDATE 했다.
       국채는 기준일마다 새 행이 쌓이는 구조다(실측: 메디아나 KR103502GF39 72건).
       ①②만 고쳐 되살렸다면 **72건 전부가 같은 날짜·같은 가격으로 뭉개져**
       일별 기준가 이력이 소멸했을 것이다. 400 으로 죽어 있던 게 사고를 막아준 셈.

해결: order→start_date / investFromDb·investToDb 매핑 관통 /
      **getLatestBonds() 로 종목별 최신 1건만** 보고, 그 기준일 행이 없으면
      **새 행 INSERT**(지분 갱신과 동일 패턴). catch 에 console.warn 추가.
금지: 국채를 기존 행 UPDATE 로 갱신하지 말 것 — 날짜별 이력 테이블이다.
검증: 수정 후 실제 앱 로드에서 메디아나 2026-08-13 기준가 6910 행 1건 INSERT 성공
      (72→73건, 종목별 1건만). 콘솔 400 도 사라짐.
```

### 2026-08-14 세션26차 — /fx-regime 실화면 검증 (쓰기 포함, 사용자 승인)

| 확인 항목 | 결과 |
|---|---|
| 판정 스냅샷 기록 | POST policy_params 13건 — 법인·통화별 4~5키, 폭주 없음 |
| 정책 소유 필드 잠금 | 숫자 입력 10개 중 **9개 비활성** (열린 1개 = 실무 입력 `이번 분기 실현 손실`) |
| 매각 지시 등록 | 버튼 → 확인 패널(USD 2,933,715 · 매도 1,415 · 장부 1,481.949 · 예상 환차손 −2.0억 · 리짐 권고 매각 · 기한 +3영업일) → **취소로 종료(제출 안 함)** |
| 시뮬레이션 모드 | `🧪 실제 권고가 아닙니다` 배너 정상 |
| 런타임 오류 | 없음 |

### 2026-08-14 세션26차 — 주간예측 통화 대응 + 운영 가정 자동 산출

계획서 §9 미결이던 "월 유입·결제 버퍼 자동 산출" 완료.
`cashflow_plan_items` 에 **통화 컬럼이 없어**(전부 원화 전제) 외화 원금을 도출할 수 없던 것이 원인이었다.

- **DDL** `docs/db/cashflow_plan_items_currency.sql` ⭐ (**실행 필요**) —
  `currency text not null default 'KRW'`. 기존 행은 전부 원화로 간주(현재 동작 동일).
- `WeekCashflowModal` — 통화 선택 추가. ⚠ **원화만 억원 단위 입력**(×1e8),
  외화는 **원금 그대로** 저장한다. 외화를 억원 배율로 저장하면 결제 버퍼가 1억배 틀어진다.
- `useCashflowPlan.sumBy` — 주별 합계(cashflow_plan.inflow/outflow)는 원화 기준이라
  외화 항목은 `useFx().toKRW` 로 환산해 더한다.
- `src/lib/cashflowFxDerive.ts` (신규, 테스트 6건) —
  `월 유입 = 향후 12주 유입 ÷ 3` / `결제 버퍼 = 13주 이내 유출 합계`.
  정책 기준 탭의 `📥 주간예측에서 산출` 버튼이 **초안만 채운다**(한도 계산기와 같은 원칙).
  계획이 0건인 통화는 건드리지 않는다 — 0 으로 덮으면 기존 의결값이 날아간다.

#### [BUG] 로컬 자정 Date + toISOString = 하루 밀림 ⭐
```
addWeeks 를 new Date('2026-08-10T00:00:00') 로 만들면 **로컬 자정**이라
toISOString() 이 KST(+9) 기준 전날(2026-08-09)을 반환한다.
→ 기준 주 자체가 "과거"로 걸러져 유입이 통째로 빠졌다(테스트가 잡아냄).
해결: Date.UTC 로 계산.
⚠ 단, get12Weeks/getMonday 는 **이미** 이 시프트를 가진 채 week_start 를 저장해 왔다.
  저장·조회가 같은 함수라 자체적으로는 일관되므로 "고치면" 오히려 어긋난다.
  → 산출 기준 주는 반드시 get12Weeks()[0] 을 그대로 쓸 것.
```

### 2026-08-18 세션26차 2일차 — 남은 작업 실화면 검증 중 CRITICAL 버그 3건 발견·수정

사용자 승인 하에 §5 남은 작업(경보 실동작·주간예측 산출·매각 지시 제출)을 실제로 진행하며 발견.

#### [CRITICAL] ① 판정 스냅샷 since 리셋 — 미이행 경과일이 매번 오늘로 초기화되던 버그
```
증상: /fx-regime 재방문 시마다 since(권고 최초 발생일)가 오늘 날짜로 리셋됨.
      메디아나 USD since 2026-08-14 → 8/18 재방문 시 8/18 로 되돌아감(실사고, 실데이터 확인).
원인: usePolicyDashboard 의 loading 초기값이 false 다. 마운트 첫 렌더는 fetch effect가
      아직 시작되기도 전이라 loading=false·raw=EMPTY(totalFundKRW=0 등)인데,
      hist(환율 이력)가 먼저 준비되면 이 첫 렌더에서 signal 이 나온다.
      → ctx 가 0 기반이라 "가짜 조치 불필요"(suggest=0) 신호가 먼저 기록되어 since 삭제
      → 뒤이어 진짜 신호가 오면 prevSuggest=0 으로 보여 since 가 오늘로 재설정.
      단순 !loading 체크로는 "로딩 시작 전"과 "로딩 완료 후"를 구분 못해 1차 수정도 재발.
해결: policyData/fxLots/hist 의 loading 이 **한 번이라도 true 였다가 false 로 돌아온** 상태를
      법인·통화 스코프별로 추적하는 ref 가드(sawTreasuryLoadingRef)를 추가.
      "로딩을 실제로 거쳤다"는 사실이 확인된 뒤에만 스냅샷을 쓴다.
      (src/pages/FxRegimePage.tsx — treasuryReady 계산부 참조)
데이터 복구: 메디아나 fx_regime_snap_since_usd 를 사고 이전 확인값 2026-08-14 로 REST PATCH 복구.
검증: 재검증 결과 이후 재방문에서도 since 유지, 대시보드 티커 "리짐 권고 미이행 1영업일차: USD"·
      자금일보 배너 정상 노출 확인(1영업일=8/17 광복절 대체공휴일 반영, 계산 정상).
금지: 훅의 loading 초기값을 신뢰해 "지금 로딩 중이 아니다 = 데이터가 준비됐다"로 판단하지 말 것.
      마운트 직후 첫 렌더는 항상 의심할 것.
```

#### [CRITICAL] ② DailyReportPage 전체 크래시 — fmtKRW 미import
```
증상: /daily-report/{법인}/{날짜} 접속 시 완전 백지 화면. 콘솔:
      ReferenceError: fmtKRW is not defined (PendingRegimeBanner 컴포넌트)
원인: Phase 4 에서 PendingRegimeBanner 를 추가하며 fmtKRW 사용 코드만 넣고
      import { fmtKRW } from '../lib/format' 를 빠뜨렸다. React 에러 바운더리가 없어
      배너 하나의 런타임 에러가 자금일보 작성 화면 전체를 백지로 만들었다.
      ⚠ 이 세션 내내 여러 차례 tsc --noEmit 을 돌렸는데도 잡히지 않았다 — 원인 미상
      (파일 상태 불일치 가능성). 실브라우저 구동 없이는 발견 못 했을 결함.
해결: import 추가 한 줄. 재검증 결과 정상 렌더 + 배너 정상 노출.
교훈: tsc/lint 통과가 "화면이 뜬다"를 보장하지 않는다. 신규 컴포넌트를 추가한 화면은
      반드시 실브라우저로 최소 1회 열어볼 것 — 이번 세션 초반 검증에서도 이 화면은
      URL 직접 접근을 시도하지 않고 넘어갔던 사각지대였다.
```

#### [CRITICAL] ③ order_type='regime' 을 저장하는 DDL을 누락 — 매각 지시 등록 100% 실패
```
증상: /fx-regime 환전 판단 탭에서 "이 권고로 매각 지시 등록" 실제 제출 시:
      "new row for relation \"fx_trade_history\" violates check constraint
       \"fx_trade_history_order_type_check\""
원인: order_type CHECK 제약(세션20차, threshold/discretionary 만 허용)을
      Phase 4 구현 때 확장하지 않고 코드에서만 'regime' 값을 내보냈다.
해결: docs/db/fx_trade_history_regime_order_type.sql 신규 작성.
      ⚠⚠ 아직 미실행 — **다음 세션 최우선 확인 사항**. INSERT 자체가 거부되므로
      정리해야 할 이상 데이터는 없다(제출 실패, DB 반영 없음).
```

#### [해결] cashflow_plan_items RLS 쓰기 차단 — 재확인 결과 정상 (2026-08-18)
```
2026-08-18 세션26차 2일차 당시 주간예측 항목 추가(POST) 시 401
"new row violates row-level security policy for table \"cashflow_plan_items\""
관측됨 — 원인 불명으로 사용자 확인 대기 상태로 남겨뒀었다.

이후 사용자가 Supabase 대시보드 Table Editor에서 직접 확인: cashflow_plan_items
테이블 뱃지가 "RLS disabled" + "UNRESTRICTED"로, 원 DDL(docs/db/cashflow_plan_items.sql
의 disable row level security)대로 정상 상태였다. 로컬 dev 서버(pnpm dev)에서 주간예측
탭 "+ 추가"로 실제 항목 추가 → 저장 성공, 이후 삭제도 성공 확인. 401의 원인은 RLS가
아니었던 것으로 결론(일시적 문제였거나 그 사이 이미 정리됐을 가능성 — 재현 안 됨).
```

#### 남은 것
- FX 리짐 이관 Phase 1~4 + 후속 3건 + CRITICAL 버그 3건 + cashflow_plan_items RLS 건 모두 해결 완료.
- ⚠ **`docs/db/fx_trade_history_regime_order_type.sql`, `cashflow_plan_items_currency.sql`,
  `policy_decision_regime_metric.sql`, `policy_params_override_audit.sql` — 2026-08-18 사용자가 전부 실행 완료.**
- 법인별 운영 가정(월 유입/결제 버퍼) 실제 값 입력 — 재무팀 의사결정 필요, 에이전트가 대신할 수 없음.
- 기타 미적용 마이그레이션 다수 — 전부 사용자 전용 작업(대시보드/CLI 접근 필요). (ECOS_API_KEY 로테이션은 §8 참조 — 사용자가 리스크 감내 결정, 더 이상 권고하지 않음)

---

### 2026-08-18 세션26차 3일차 — FX 메뉴 정합성 정리 + 외화매매거래 부분 체결(Partial Fill)

#### FX 메뉴 3건 정리
1. **"환율 현황"의 "환전이력" 탭 제거** — `FxTradeHistoryPage`(외화매매거래)와 완전 중복이었음.
   `FxPage.tsx` 는 순수 환율 시세 화면으로 단순화, 상단에 "외화매매거래"/"자금정책 관리"
   링크만 안내. **버그**: 이 링크를 `window.location.pathname = ...` 하드 리로드로 구현했다가
   앱 전체가 새로고침되며 기본 법인(셀바스에이아이) 대시보드로 튕기는 문제 발견 → `useNavigate()`
   SPA 네비게이션으로 교체.
2. **`FxPolicyTab.tsx`(③④ 탭)를 SSOT(`usePolicyDashboard`)로 교체** — `useDaily`/`useInvestments`/
   `useEquities` 직접 재계산을 제거하고 `useFxRegime.ts`가 이미 쓰는 것과 동일한
   `policyData.fxPolicyDenominator`/`fxByCurrency`/`fxPortfolioHoldings`/`fxRatio` 를 그대로 사용.
   운전/운용 분리 막대그래프 표시용 native 분리 계산만 로컬에 남기고, **합계·비중은 절대
   재계산하지 않는다**(세션19차 6.2%/27.9% 사고 재발 방지).
3. **완료 처리 모달 공유 + 정확도 수정** — `src/components/fx/CompleteTradeModal.tsx` 신규.
   `FxTradeHistoryPage`(실제 체결환율 입력 모달)와 `FxPolicyTab`(과거엔 클릭 즉시 **현재
   시장환율**로 완료 처리하던 정확도 문제)이 이제 같은 컴포넌트를 쓴다.

#### 삭제 기능 추가
`/fx-trade-history` + `FxPolicyTab`(④ 매각 집행)에 매각 지시 삭제 버튼 추가('발의'/'취소' 상태만,
`canDelete()` 권한). `window.confirm` 대신 화면 안 확인 패널(세션24차 크롬 대화상자 차단 사고
재발 방지 원칙).

#### ⭐ 외화매매거래 부분 체결(Partial Fill) 신규 기능
사용자 요구: 매각 지시가 하달된 뒤 최대 3영업일에 걸쳐 여러 번 나눠 체결될 수 있고,
체결마다 어느 FIFO 로트에서 얼마씩(장부환율 포함) 가져왔는지 남아야 한다.

- **`docs/db/fx_trade_partial_fill_migration.sql`** ⭐⭐ (**실행 완료** — 2026-08-19 사용자 확인) — 신규 테이블
  `fx_trade_fills`(체결 단위 이력, trade_id FK — daily_report_items 와 동일한 부모1:자식다건
  패턴), `fx_lot_consumptions.fill_id` 컬럼 추가(어느 체결이 이 로트를 소진했는지 구분),
  `fx_trade_history.filled_amount` 컬럼 추가(잔여 계산용). 신규 RPC `complete_fx_trade_fill`
  (부분 체결 1건 등록 — FIFO 소진 후 가중평균 completed_rate/누적 completed_pnl 갱신,
  전량 소진 시에만 status='완료', 아니면 '부분체결')과 `reverse_fx_trade`(지시 전체 원복 —
  모든 체결·소진 이력을 되돌리고 '취소'로 리셋). 기존 `complete_fx_trade_with_fifo`/
  `reverse_completed_fx_trade`(세션 이전)는 건드리지 않고 그대로 둔다(미사용 상태로 방치,
  additive-migration 관례).
- `useFxTradeHistory.ts`: `complete()` → **`fillTrade(id, amount, rate, fillDate, by)`**로 교체
  (기본 수량=잔여 전체로 채우면 기존과 동일하게 1회 완료 동작). `cancel()` 은 '완료'뿐 아니라
  '부분체결' 상태도 `reverse_fx_trade` 로 원복하도록 확장. 신규 `fetchTradeDetail(tradeId)` —
  펼쳐보기 클릭 시에만 체결 목록 + 로트별 소진 상세를 조회(목록 화면 성능에 영향 없음).
- `CompleteTradeModal.tsx`: 체결 수량(기본값=잔여, 초과 불가)·체결일 입력 필드 추가.
  PnL 미리보기를 **입력한 체결 수량 기준**으로 계산하도록 수정(과거엔 지시 전체 수량
  기준이라 부분 체결 시 손익이 부풀려지는 버그였을 것).
- `FxTradeHistoryPage.tsx`: `'부분체결'` 상태 추가, 행 펼쳐보기(▸)로 체결별
  `체결일·수량·체결환율·손익` + 그 아래 소진된 로트 목록(장부환율→처분환율)까지 표시.
- **V1 범위 밖**: 개별 체결 1건만 취소/수정하는 기능(전체 취소만 지원),
  `FxLedgerPage.tsx`의 "완료된 외화 매각" 탭은 아직 `status==='완료'`만 필터링해
  '부분체결' 중간 상태 거래가 안 보임 — 후속 과제.

검증: tsc -b 0 errors, lint 0 errors(68 warnings=기존 수준), vitest 247/247, build 성공.
마이그레이션은 2026-08-19 사용자가 Supabase SQL Editor에서 실행 완료. 이후 사용자가 개발
서버로 이 세션 변경사항을 직접 확인 완료.

---

### 2026-08-19 세션26차 4일차 — FIFO 로트 취소 세분화 (부분체결 V1 범위 밖 항목 후속 구현)

3일차에서 "V1 범위 밖"으로 미룬 두 항목을 구현.

- **`docs/db/fx_trade_fill_reverse_rpc.sql`** ⭐ (**신규, 실행 필요**) — `reverse_fx_trade_fill(p_fill_id, p_reversed_by)`.
  체결(fill) 1건만 골라 그 fill_id 로 연결된 `fx_lot_consumptions`만 복원·삭제하고, 남은
  체결들로 `fx_trade_history`(filled_amount/completed_rate/completed_pnl)를 재계산한다.
  남은 체결이 0건이면 `approved_by` 유무로 '승인'/'발의'로 복귀. 기존 `reverse_fx_trade`(지시
  전체 원복)는 그대로 두고 손대지 않음 — additive-migration 관례 유지.
  권한 검사(master/admin/can_approve)는 `complete_fx_trade_fill`과 동일.
- `useFxTradeHistory.ts` — `reverseFill(fillId, reversedBy)` 신규 (restRpc 호출만, 로딩은
  호출부 책임).
- `FxTradeHistoryPage.tsx` — 체결 내역 펼쳐보기(`FillDetailRows`)의 각 체결 카드에
  "이 체결만 취소" 버튼 추가(승인 권한 + `fx_trade` 쓰기 권한 게이트). 클릭 시 화면 안
  확인 패널(세션24차 원칙 — `window.confirm` 미사용, 크롬 반복 대화상자 차단 시 조용히
  아무 일도 안 일어나는 사고 재발 방지)에서 체결 상세(체결일·수량·환율·손익)를 보여주고
  실행 시에만 반영. 취소 성공 시 `FillDetailRows`를 강제 재조회(`refreshKey`)하고 상위
  목록(`doFetch`)도 갱신해 지시 행의 상태·잔여 수량이 즉시 맞춰지도록 함.
- `FxLedgerPage.tsx` — "완료된 외화 매각" 탭이 `status==='완료'`만 걸러 '부분체결' 중간
  상태 거래를 누락하던 결함 수정. `상태` 컬럼(부분체결 배지) + `체결 수량`/`지시 수량` 분리
  컬럼 추가 — 지시 수량 전체가 아니라 실제 체결된 수량만큼만 매각으로 집계되게 함.

검증: tsc -b 0 errors, 변경 파일 lint 0 errors, vitest 247/247 유지.
`docs/db/fx_trade_fill_reverse_rpc.sql` 은 2026-08-19 사용자가 Supabase에 실행 완료.
브라우저 실화면 검증(체결 취소 → 로트 복원 → 지시 상태 재계산)은 사용자가 스크린샷으로
확인 완료(1차 체결 30,000 USD "이 체결만 취소" 버튼 정상 노출까지 확인).

---

### 2026-08-19 세션26차 5일차 — 외화 FIFO 원장 ↔ 외화매매거래 통폐합 ⭐

사용자 요구: 두 메뉴가 데이터상으로는 이미 연결(체결 등록 시 서버 RPC가 FIFO 로트를 실제
소진)돼 있는데도 화면이 완전히 분리돼 있어 "재고 확인 → 매각 체결 → 잔액 재확인"에 페이지를
오가야 했고, FIFO 원장의 "매각 이력" 탭은 체결 단위 상세를 보여주지 못해 정보가 두 군데서
다르게 표시됨. "계정잔액명세처럼 유입·유출·잔액이 자동 연동되는 통합 원장"을 요청.

**사용자 확인 사항(구현 전 승인)**: 메뉴 통합 시 접근권한은 기존 외화 FIFO 원장의
opt-in(민감) 등급이 아니라 **기존 외화매매거래 수준(역할 기본값 노출)**으로 적용하기로 결정
— 운영 편의 우선, 실재고·장부환율 정보가 기본적으로 더 많은 계정에 노출됨을 인지하고 승인.

#### 목표 구조 — 메뉴 1개(`/fx-ledger`, "외화 원장") + 탭 4개
| 탭 | 내용 |
|---|---|
| ① 📒 원장 | 유입(로트 취득)+유출(체결)을 날짜순으로 합쳐 **잔액이 누적 계산되는 단일 타임라인**. 유출 행 펼치면 소진 로트 상세. |
| ② 📝 매각 지시 관리 | 발의→승인→(부분)체결→완료/취소 워크플로우(옛 FxTradeHistoryPage 이관). 법인/기간/통화/상태 자유 필터 유지(감사용). |
| ③ ⚙️ 로트 설정 | 개시 로트 등록·CSV 임포트·계좌유형 교정·개시 이전 CSV 이관 과거 매각 실적 수정/삭제. |
| ④ 📊 환차손익 요약 | 누적 실현손익 + 미실현손익. |

①원장 탭이 옛 "보유 로트"+"매각 이력" 두 탭을 대체(둘 다 같은 잔액 정보의 부분집합이었음).

#### 데이터 연동 — 신규 `fetchFillsByCurrency(company, currency)`
`useFxTradeHistory.ts`에 추가. `fx_trade_fills`/`fx_lot_consumptions` 둘 다 `company`/
`currency` 컬럼을 직접 갖고 있어(스키마 확인) `fx_trade_history` 조인 없이 법인+통화 단위
전체 체결 내역을 바로 조회. 기존 `fetchTradeDetail(tradeId)`(거래 1건 단위)와 별도.

원장 탭 타임라인: `ledger.lots`(유입)+`fills`(유출)를 날짜 오름차순 병합 → 누적합으로 잔액
계산 → 최신순으로 뒤집어 표시. **안전장치**: 병합 계산의 최종 잔액과 `ledger.totalAmount`
(로트 remaining_amount 합)가 불일치하면 "⚠ 잔액 불일치 감지" 경고 배지 표시 — 이 앱은 과거
SSOT 불일치로 인한 실사고가 여러 번 있었으므로(세션19차 6.2%/27.9% 등) 저비용 방어 장치로 추가.

**공유 리프레시**: 페이지 셸에 `refreshAll()`을 두고 모든 쓰기 동작 성공 후 호출 —
`ledger.refetch()` + fills 재조회(refreshKey 증가) + `trades.load()`. 매각 지시 관리 탭에서
체결을 등록하면 원장 탭 잔액이 탭 전환만으로 즉시 최신 상태로 보임(수동 새로고침 불필요).

#### 발견해 함께 고친 버그 — 통화 스코프 누락
`useFxTradeHistory(company)`(A패턴)로 로드되는 `trades.data`는 **통화 필터가 없어** 옛
FxLedgerPage의 "매각 이력"/"환차손익 요약" 탭이 선택한 통화와 무관하게 전체 통화가 섞여
표시되고 있었다(보유 로트 탭만 `useFxLots(company,currency)`로 통화 스코프가 걸려 있어 탭
간 불일치). 환차손익 요약 탭 계산에 `row.currency === currency` 필터를 추가해 수정.

#### 변경 파일
- `src/hooks/useFxTradeHistory.ts` — `fetchFillsByCurrency` 추가.
- `src/components/fx/FillConsumptionDetail.tsx` (신규) — 체결 카드+소진 로트 상세 렌더링을
  프레젠테이션 컴포넌트로 추출(`FillConsumptionCard`). 원장 탭·매각지시관리 탭이 공유.
- `src/components/fx/FxLedgerTab.tsx` (신규) — ① 원장 탭. 타임라인 병합·잔액 계산·펼치기·
  로트 수정/삭제(옛 FxLedgerPage의 editingLot/pendingDelete 로직 이관)·이행 대기 매각 지시
  배너.
- `src/components/fx/FxOrdersTab.tsx` (신규) — ② 매각 지시 관리 탭. 옛 FxTradeHistoryPage.tsx
  거의 그대로 이식, 성공 콜백에 `onChanged()`(=`refreshAll`) 추가.
- `src/components/fx/FxLotAdminTab.tsx` (신규) — ③ 로트 설정 탭. 옛 FxLedgerPage 상단부(CSV
  임포트·계좌유형 교정·개시 로트 등록) + 개시 이전 CSV 이관 과거 매각 실적 수정/삭제 이관.
- `src/pages/FxLedgerPage.tsx` (재작성, 셸 역할) — company/currency/activeTab(`?tab=` 쿼리
  파라미터로 초기값만 읽음, 이후는 로컬 state) 상태, 3개 데이터 훅, 상단 통계·통화탭·탭바,
  `refreshAll()`, 4개 탭 컴포넌트에 props 전달.
- `src/pages/FxTradeHistoryPage.tsx` — 삭제(내용은 `FxOrdersTab.tsx`로 이관).
- `src/App.tsx` — `/fx-trade-history`(구 경로) → `FxTradeHistoryRedirect`(신규, `useParams`로
  company 읽어 `/fx-ledger${company}?tab=orders`로 `<Navigate replace>`) 로 교체. `/fx-ledger`
  라우트는 유지.
- `src/components/Sidebar.tsx` — `외화매매거래` NavItem 삭제, `외화 FIFO 원장` → `외화 원장`.
- `src/contexts/auth.ts` — `MENU_DEFAULTS.admin/editor/viewer`에 `'fx-ledger'` 추가(기존
  opt-in 전용 → 역할 기본값 노출로 격상, 사용자 확인 반영).
- `src/pages/admin/UsersPage.tsx` — `MENU_SLUGS`의 `fx-ledger` 라벨을 `외화 원장`으로 변경.
- `src/lib/issueLink.ts` — `fx_sell_` 매핑을 `/fx-trade-history/${c}` → `/fx-ledger/${c}?tab=orders`.
- `src/pages/FxPage.tsx` — "외화매매거래" 링크를 `/fx-ledger?tab=orders`로 변경.

**건드리지 않음**: `src/components/policy/FxPolicyTab.tsx`(자체 `useFxTradeHistory`+
`CompleteTradeModal`로 정책 이행 모니터링 미니 패널을 구성 — 훅 API 확장만 있어 영향 없음),
DB 스키마(신규 마이그레이션 불필요 — 클라이언트 통합 + 메뉴 기본값 변경뿐).

검증: tsc -b 0 errors, eslint 0 errors(전체 src), vitest 247/247. 브라우저 실화면 검증(원장
탭 잔액 표시, 매각 지시 관리→체결 등록→원장 탭 즉시 반영, 옛 `/fx-trade-history` 리다이렉트,
사용자 관리 화면에서 "외화 원장" 메뉴 기본 체크 상태)은 다음 세션 확인 사항.

---

### 2026-08-19 세션26차 6일차 — 자금일보 ↔ 외화 원장 자동 반영

전날 통폐합한 원장에서 "유입/유출이 어느 입력 메뉴와 연동되는지" 사용자 질문 → 조사 결과
**매각(유출)은 이미 자동 연동돼 있었다**(FX 정책 탭·FX 리짐 전략의 매각 지시도 전부 같은
`fx_trade_history`/`fx_trade_fills`에 쓰기 때문에 체결되면 원장에 바로 보임 — 이번 세션
작업 범위 아님). 빠져 있던 건 **운전자금(자금일보) 잔액 증감 → 원장 유입/유출 로트** 연결
뿐이었다. 사용자 제안대로 "자금일보에 이미 있는 전일 대비 차액을 원장이 읽어와 사용자는
실제 적용 환율만 입력"하는 흐름으로 구현.

#### 설계 — 존재기반 dedup 대신 금액 재계산 비교
`fx_lots.source_type` CHECK 제약에는 이미 `'daily_report_item'`이 있었지만(애초에 이 연동을
염두에 두고 설계됐던 흔적) 실제로 쓰는 코드가 없었고, INSERT RLS 정책에도 빠져 있었다.
지분·국채 평가손익 자동기재(세션10차)가 쓰는 `@auto:` memo 마커 + 후보목록 대조 방식은
세션14차에 "평가변동 0 복귀 시 유령 항목 잔존" 실사고를 낸 전례가 있어, 여기서는 그보다
단순한 방식을 썼다 — **미반영액을 매번 다시 계산**:
```
미반영액 = |오늘잔액 − 전일잔액| − (source_type='daily_report_item' 로 이미 반영된 금액)
```
`daily` 값이 나중에 수정돼도 미반영액이 자동으로 재조정되어 별도 stale-cleanup 코드가
필요 없다. `fx_lots(company,currency,source_type,source_id)` unique 제약이 같은 날짜를
두 번 반영하는 실수도 DB 레벨에서 막아준다.

#### 변경 파일
- **`docs/db/fx_lots_daily_report_source.sql`** ⭐ (신규, **실행 필요**) — `fx_lots_insert_authenticated`
  정책에 `'daily_report_item'` 추가(유입=일반 insert, 기존 role/company 체크 재사용) +
  신규 RPC `consume_fx_lots_for_source(company,currency,source_type,source_id,amount,
  disposal_rate,disposed_date,disposed_by)` — `complete_fx_trade_with_fifo`와 동일한 FIFO
  소진 로직을 `source_type`/`source_id` 인자로 범용화(유출용). 기존 매각 전용 RPC 3종은
  손대지 않음(additive 관례). 권한은 매각 결정(master/admin/can_approve)보다 낮은 실무
  편집 등급(editor 이상)으로 — "이미 일어난 잔액 변동의 기록"이지 새 매각 의사결정이 아님.
- `src/hooks/useFxLots.ts` — `reconcileDailyInflow`/`reconcileDailyOutflow` 추가.
- `src/hooks/useFxLedgerReconciliation.ts` (신규) — 선택된 법인+통화의 최근 60영업일
  `daily` 잔액을 오름차순 정렬해 전일 대비 델타 계산 → `fx_lots`/`fx_lot_consumptions`를
  `source_type='daily_report_item'` + `source_id=in.(...)`(PostgREST in 필터, `useFxHistory.ts`
  에 선례 있는 `restSelect`의 `filters` 옵션 재사용)로 조회해 이미 반영된 금액 차감 →
  미반영 목록 반환.
- `src/components/fx/FxLedgerTab.tsx` — "자금일보 미반영 증감" 패널 추가. 행마다 방향
  배지·금액·환율 입력·"원장 반영" 버튼. 반영 성공 시 훅 재조회 + 상위 `onChanged()`(=`refreshAll`).
- `src/pages/FxLedgerPage.tsx` — `FxLedgerTab`에 `company`·`onReconcileInflow`/`onReconcileOutflow`
  props 전달(내부에서 `ledger.reconcileDailyInflow/Outflow` 호출).
- `src/pages/DailyReportPage.tsx` — 기존 `PendingRegimeBanner`/`PendingSellOrdersBanner`와
  같은 패턴으로 `PendingLedgerReconcileBanner` 추가 — 자금일보 작성 화면에서도 미반영
  건수를 인지하고 "외화 원장에서 반영 →" 링크(`/fx-ledger?tab=ledger`)로 이동할 수 있게.
  통화 5종을 고정 배열로 순회하며 `useFxLedgerReconciliation`을 5번 호출(배열이 상수라
  매 렌더 훅 호출 순서가 항상 동일 — `eslint-disable-next-line react-hooks/rules-of-hooks`
  로 명시).

**건드리지 않음**: FX 정책 탭/FX 리짐 전략의 매각 지시 흐름(이미 원장과 연결돼 있었음),
기존 `complete_fx_trade_with_fifo`/`complete_fx_trade_fill` 등 매각 전용 RPC, `daily_report_items`
스키마.

검증: tsc -b 0 errors, eslint 0 errors(전체 src), vitest 247/247. 브라우저 실화면 검증(자금일보
잔액을 이틀 다르게 입력 → 원장에 미반영 행 노출 → 환율 입력 후 반영 → 유입 로트 생성/유출
FIFO 소진 확인, `daily` 값 재수정 시 미반영액 재계산 확인)은 다음 세션 확인 사항.

#### 후속 수정 — 개시일 이전 이력 오탐 (사용자 실사용 중 발견)

배포 직후 사용자가 실제 화면에서 발견: 개시 로트(source_type='opening')는 개시일(예:
2026-08-11) 기준으로 그 이전 이력을 이미 흡수한 잔고인데, "자금일보 미반영 증감" 조회가
`daily` 테이블 전 기간(최대 500행)을 훑다 보니 **개시일 이전 날짜의 잔액 증감까지
"미반영"으로 잘못 잡아냈다**(2026-01-08 ~ 2026-08-04 구간이 전부 목록에 뜸). 두 가지로 수정:

1. **조회 시작일 필터** — `useFxLedgerReconciliation(company, currency, fromDate)`에 세 번째
   인자 추가. 델타 계산 자체는 여전히 전 기간에서 하되(경계일의 델타가 정확하려면 그 전날
   값이 필요), **표시만** `fromDate` 이후로 거른다. `FxLedgerTab.tsx`가 조회 시작일 입력
   필드를 갖고 기본값은 "이번 달 1일"(`new Date().toISOString().slice(0,8)+'01'`) — 특정
   달을 하드코딩하지 않고 오늘 날짜 기준으로 자연스럽게 정해진다.
2. **개별 "무시" 처리** — 경계 근처 날짜는 사용자가 직접 판단해야 할 수 있어, 목록의 각
   행에 "무시" 버튼 추가(2단계 인라인 확인 — 이 앱의 window.confirm 회피 원칙). 신규 테이블
   `fx_ledger_reconcile_ignored`(`docs/db/fx_ledger_reconcile_ignore.sql`, **실행 필요**)에
   `(company, currency, daily_id)` 를 기록 — **fx_lots/fx_lot_consumptions 는 전혀 건드리지
   않는 표시 전용 배제**다("원장에 반영"이 아니라 "이미 개시 잔고에 포함돼 있으니 목록에서
   그만 보여달라"는 표시). `useFxLedgerReconciliation`이 이 테이블도 조회해 무시된 daily_id
   를 결과에서 제외한다.

검증: tsc -b 0 errors, eslint 0 errors, vitest 247/247 유지.

---

### 2026-08-19 세션26차 7일차 — 조치 이력 조회 + FX 메뉴 전면 개편 ⭐

#### Part 1: FX 리짐 조치 카드 일자별 조회
사용자 리포트: 외화 매각으로 리짐 조치가 "조치 불필요"로 바뀌면 그 이전 상황(목표비중·
현재비중·권고액·발생일)이 사라져 과거 의사결정을 추적할 수 없음. 원인: `fx_regime_snap_*`
(policy_params, 세션26차 Phase4)는 판정할 때마다 같은 행을 **덮어쓴다**.

- `src/lib/fxRegimeSnapshot.ts` — `syncRegimeSnapshot`에 선택적 `recordHistory` 콜백 인자
  추가. 값이 실제로 바뀔 때만(=기존에 이미 하던 "변경 감지" 그 지점) 호출된다. 함수 자체는
  여전히 DB 를 모르는 순수 로직 유지(테스트는 DI 목으로 그대로 통과, 파라미터 미전달 시
  기존 동작과 100% 동일).
- **`docs/db/fx_regime_snapshot_history.sql`** ⭐ (신규, **실행 필요**) — append-only 이력
  테이블 `fx_regime_snapshot_history`(update/delete 정책 없음). 이 기능 도입 이후 시점부터만
  쌓인다 — 과거로 소급 복원은 불가(환율 이력은 있어도 그 시점의 총자금·FX보유액 등은
  기록이 안 남아있어서).
- `src/hooks/useFxRegimeSnapshotHistory.ts` (신규) — 법인+통화 이력 조회 + `asOfDate(date)`
  (선택한 날짜 이하 가장 최근 스냅샷 탐색).
- `src/components/fxRegime/RegimeHistoryCard.tsx` (신규) — VerdictCard 바로 아래 접이식
  카드. 날짜 입력 + 최근 기록 칩(클릭 시 해당일 조회). 실시간 판정(VerdictCard)의 전체
  재현이 아니라 스냅샷에 저장된 4개 값만 보여주는 경량 조회임을 명확히 함.
- `src/pages/FxRegimePage.tsx` — `company`를 넘겨 실제 insert 수행하는 `recordRegimeHistory`
  콜백을 `syncRegimeSnapshot`에 주입, `RegimeHistoryCard` 마운트.

#### Part 2: FX 메뉴 전면 개편 — "발의는 여러 곳, 집행·추적은 한 곳"
사용자 리포트: FX 관련 화면이 4곳(환율현황·외화원장·FX리짐전략·FX정책)에 흩어져 있고,
그중 매각 지시 발의→체결 워크플로우가 **3곳에 중복 구현**(외화원장②/FX정책④/FX리짐②)돼
있어 "체결은 어디서 하지?" 혼란이 있었음. 성격이 다른 발의 트리거(정책위원회/리짐권고/
실무수동)까지 통합할 필요는 없지만, 실행·추적 UI는 하나로 모으기로 함.

- **사이드바 재편**(`src/components/Sidebar.tsx`) — 신규 섹션 `💱 외화(FX) 관리`
  (환율현황/외화원장/FX리짐전략/FX정책 기준 바로가기). FX 리짐 전략은 DASHBOARD에서,
  환율현황·외화원장은 이력관리에서 이동. 자금정책 페이지의 "6개 정책 영역" 탭 묶음
  자체는 유지 — FX 정책만 별도로 빼내지 않고 딥링크만 추가.
- **`src/pages/PolicyPage.tsx`** — `?tab=fx&company=법인명` 쿼리스트링으로 최초 렌더 시
  `policyTab`/`companyTab`을 바로 세팅(이후는 로컬 state, 기존 라우트 `:company` 파라미터는
  원래도 안 읽고 있었음 — 이번에 쿼리스트링 방식으로 새로 지원).
- **`src/components/policy/FxPolicyTab.tsx`** — `SellOrderList`에서 `CompleteTradeModal` 직접
  호출 제거. "체결 등록" 클릭 시 `/fx-ledger/{company}?tab=orders&currency={통화}`로 이동만
  (실행은 외화 원장에서). 발의(재량 매각 지시 등록)·삭제(FIFO 미소진 발의 건)는 그대로 유지 —
  체결/취소만 원장으로 넘김.
- **`src/components/fxRegime/DecisionTab.tsx`** — 원래도 자체 체결 UI는 없었음(발의만 하고
  "기존 워크플로우를 거친다"고 안내만 하던 상태). 등록 성공 메시지에 "외화 원장에서
  승인·체결 →" 링크(`/fx-ledger/{company}?tab=orders&currency={통화}`) 추가.
- **`src/pages/FxLedgerPage.tsx`** — `?currency=` 쿼리스트링도 초기 통화 탭에 반영(위 두
  링크가 필터까지 미리 맞춰서 랜딩하도록).
- **잠긴 필드 안내 링크 보강** — `FxRegimePage.tsx`의 "자금정책 관리에서 변경 →" 링크를
  `/policy/{company}` → `/policy?tab=fx&company={company}`로 교체(딥링크 대상이 새로 생겨서
  가능해짐 — 전에는 PolicyPage가 쿼리스트링을 안 읽어서 만들 수 없었음).

**건드리지 않음**: DB 스키마(신규 테이블 1개 제외 — 조치 이력용), 매각 지시 발의(propose)
경로 3곳 전부(정책위원회·리짐권고·실무수동은 여전히 각자 발의 가능 — 통합한 건 실행·추적
UI뿐).

검증: tsc -b 0 errors, eslint 0 errors, vitest 247/247 유지.

---

### 2026-08-19 세션26차 8일차 — FX 메뉴 후속 다듬기 + 외화거래명세 레이아웃 개편

세션26차 7일차 개편 직후 사용자 후속 피드백 4건.

#### 1) 사이드바 — FX 정책 기준 링크 제거, 순서·이름 정리
`외화(FX) 관리` 섹션에서 "FX 정책 기준" 항목 삭제(실무자가 필요한 발의 기능이 아래 2)로
이관됐으므로 불필요). 순서를 `FX 리짐 전략 → 외화거래명세 → 환율 현황`으로, "외화 원장"
라벨을 "외화거래명세"로 변경. `PolicyPage.tsx`의 `?tab=fx&company=` 딥링크 지원 자체는
남겨둠(FxRegimePage의 "자금정책 관리에서 변경 →" 잠긴 필드 안내 링크가 계속 사용).

#### 2) FX 리짐 전략 — 매각 지시 등록을 조치 카드 바로 아래로
"② 환전 판단" 탭 안에 있던 `RegisterOrderPanel`을 독립 파일
(`src/components/fxRegime/RegisterOrderPanel.tsx`)로 추출해 VerdictCard 바로 아래(화면
최상단, 탭과 무관하게 항상 보임)로 옮겼다. 분기 손실한도 계산(`lossBudget`)을
`decisionBudget` useMemo로 앞당겨 VerdictCard·RegisterOrderPanel·DecisionTab이 공유.
DecisionTab은 이제 분석(손익현황·손익분기·분할실현계획)만 하고 등록 버튼은 없다 —
"실제 매각 지시 등록은 화면 최상단 조치 카드에서" 안내만 남김.

#### 3) 외화거래명세(FxLedgerTab) 레이아웃 전면 개편
- **7:3 그리드**: 원장 표(왼쪽 7)와 "자금일보 미반영" 카드(오른쪽 3)를 한 행에 배치
  (`grid lg:grid-cols-[7fr_3fr]`). 미반영 카드 내부도 좁은 폭에 맞춰 세로 스택으로 재배치.
- **10행 스크롤**: 원장 표를 `max-h-[26rem] overflow-auto` 컨테이너에 넣고 헤더를
  `sticky top-0`으로 고정 — 대략 10행 보이고 나머지는 스크롤.
- **계좌유형 필터**: 전체/보통예금/MMDA/정기예금 탭 추가. FIFO 소진 자체는 서버가 이미
  취득일 순으로 정확히 처리하므로(계좌유형 무관, term_deposit만 만기 전 제외) 별도 재계산
  없이 **표시할 유입(로트) 행만 필터**한다 — 유출(체결) 행은 항상 전체 표시(하나의 체결이
  여러 유형의 로트를 동시에 소진할 수 있어서).
- **CSV 이관 흔적 숨김**: "내용" 열에 붙어 있던 원본 memo(`2026-08-11 개시재고 ·
  demand_deposit · import-key:...`) 표시를 제거 — 계좌유형·만기 라벨만 남김. 데이터
  자체(memo 컬럼)는 그대로 유지, 계좌유형 교정(로트 설정 탭)에는 계속 쓰인다.
  ⚠ **금지**: memo 컬럼 자체를 지우거나 비우지 말 것 — `intentFromMemo()`(계좌유형 교정)가
  이 텍스트에서 원래 계좌유형·만기를 복원한다.
- **금액 컬럼 재구성**: 기존 "금액"(부호 있는 단일 값) + "잔액"(누적 러닝밸런스) 두 컬럼을
  없애고, 유입(로트) 행에 **최초유입/처분금액/잔액** 3컬럼으로 교체(로트 자신의
  `originalAmount`/`originalAmount-remainingAmount`/`remainingAmount`, 전부 서버가 이미
  FIFO로 정확히 계산해 둔 값 — 클라이언트 재계산 없음). 유출(체결) 행은 처분금액에만
  `-금액` 표시, 나머지 두 칸은 `—`. 러닝밸런스 재구성 로직을 없앤 대신, 잔액 무결성 확인은
  `lots.reduce(remainingAmount 합) vs ledger.totalAmount` 직접 비교로 단순화(화면에는
  경고 배너로만 노출, 표에는 안 보이는 로트 필드를 그대로 신뢰).

#### 4) 탭 이름 변경
`매각 지시 관리` → `외화매도이력`, `로트 설정` → `데이터 등록`(TAB_LABEL만 변경, 내부
컴포넌트 파일명 `FxOrdersTab.tsx`/`FxLotAdminTab.tsx`는 유지). 연동된 다른 화면의 안내
문구(FxPolicyTab의 "체결 등록 →" 이동 버튼, FxLedgerTab의 "이행 대기" 배너 버튼, 펼쳐보기
안내문)도 새 이름에 맞춰 업데이트. "외화 원장" 명칭이 남아있던 사용자 관리 메뉴 라벨,
자금일보 미반영 배너, 환율 현황 페이지 링크도 "외화거래명세"로 통일.

검증: tsc -b 0 errors, eslint 0 errors, vitest 247/247 유지. DB 마이그레이션 불필요(전부
클라이언트 레이아웃/라우팅/네이밍 변경).

---

### 2026-08-20 세션26차 9일차 — 부분체결 도중 조치 카드 소실 버그 수정

사용자 리포트: 리짐이 매도를 권고해 지시를 발의한 뒤, 3영업일에 걸쳐 부분 체결하는
도중 잔여 초과분이 트리거 아래로 내려가면 라이브 판정이 "조치 불필요"로 바뀌면서
조치 카드(RegisterOrderPanel)가 사라져 **이미 발의된 지시의 진행 상황(예: 100만불 중
60만불 체결, 잔여 40만불)을 볼 곳이 없어짐**. 조치 카드가 "지금 신규 조치가 필요한가"
만 보고 "이미 진행 중인 지시가 있는가"는 전혀 보지 않던 게 원인.

- `src/components/fxRegime/PendingOrdersCard.tsx` (신규) — 이 통화에 걸린 미완료
  (발의/승인/부분체결) 리짐 매각 지시를 **라이브 판정 상태와 무관하게** 항상 보여준다.
  지시수량/체결완료/잔여 3칸 + D-day + 외화거래명세 딥링크. 실행(체결)은 여기서
  하지 않는다 — 조회 전용.
- `src/pages/FxRegimePage.tsx` — `actualTradeHistory.data`(이미 로드돼 있던 법인 전체
  거래이력)에서 `pendingRegimeOrders`(현재 통화 + order_type='regime' + 미완료 상태)를
  필터링. 조치 카드 자리에서 **이행 중인 지시가 있으면 `PendingOrdersCard`를, 없으면
  기존 `RegisterOrderPanel`(신규 발의)을 배타적으로** 보여준다 — 지시가 남아있는 동안
  중복 발의도 자연히 막힌다.

검증: tsc -b 0 errors, eslint 0 errors, vitest 247/247 유지. DB 마이그레이션 불필요.

---

### 2026-08-20 세션26차 10일차 — 데이터 등록 탭 용어·유출 입력 추가

사용자 리포트: "데이터 등록" 탭의 "기존 외화를 하나의 개시 로트로 등록" 문구가 실무
용어가 아니라 무슨 기능인지 알기 어려움. 실제로는 "언제 외화가 얼마 들어왔고 장부에
적용한 환율이 얼마인지" 기록하는 것뿐. 또한 유입만 수동 입력이 가능하고 유출(매각
워크플로우를 거치지 않는 외화 지급)은 수동으로 기록할 방법이 없었음.

- `src/hooks/useFxLots.ts` — `addManualOutflow` 추가. `consume_fx_lots_for_source`
  RPC(세션26차 6일차, 이미 적용됨)를 `source_type='manual'` + 매번 새로 생성한
  `source_id`로 호출 — 스키마 변경 불필요(기존 RPC가 source_type 을 검증하지 않고
  그대로 씀). `daily_report_item`과 달리 자연키가 없어 유니크 제약으로 중복을 막지
  못한다 — 화면에서 저장 확정 버튼을 한 번만 누르도록 안내.
- `src/components/fx/FxLotAdminTab.tsx` — 기존 "기존 외화를 하나의 개시 로트로 등록"을
  "🟢 외화 유입 등록"으로 개명(입력 컬럼·저장 로직은 그대로, 문구만 변경 — 사용자
  확인: "외화 유입은 현재의 입력컬럼을 그대로 두고 네이밍만 변경"). 옆에 "🔴 외화 유출
  등록" 카드를 새로 추가(처분일·외화금액·처분환율·메모, `addManualOutflow` 호출) —
  계좌유형은 입력받지 않는다(FIFO가 취득일 순으로 자동 소진하므로 유형 선택이 무의미).
  두 카드를 `md:grid-cols-2`로 나란히 배치. 저장 결과 메시지 표시 위치를 컴포넌트
  최상단 하나로 통일(기존엔 CSV 카드 안에만 있어 유입/유출 저장 후 메시지가 안 보이는
  위치 버그가 될 뻔함 — 패널을 닫으면서 동시에 조건부로 메시지를 가리는 실수를 구현 중
  발견해 배제).

검증: tsc -b 0 errors, eslint 0 errors, vitest(메인 src) 정상. `.claude/worktrees/agent-*`
안의 스테일 체크아웃 사본에서 날짜 의존 테스트가 깨지는 게 보이면 무시할 것 — 오늘
날짜가 바뀌며 그 오래된 사본의 `calcDday` 테스트가 실패하는 것뿐, 실제 프로젝트
소스(`src/`)와 무관하다.

---

### 2026-08-20 세션26차 11일차 — FX 발의·집행 흐름 단절 3건 수정 + 연계성 우선 규칙 도입 ⭐

사용자 지적: "서로 연관된 기능인데 각개전투 하듯 개발해서 생긴 문제" — 개별 조각은
전부 정상인데 **흐름이 끊겨** 실무에서 쓸 수 없는 상태가 반복됐다. 규칙을 §1-A로 문서화하고
(연계성 우선 개발 규칙 + FX 워크플로우 연계 지도), 그 관점으로 아래 3건을 함께 수정.

#### [CRITICAL] ① 발의한 매각 지시가 목록에 없어 체결 자체가 불가능
```
증상: 자금정책 › ④매각 집행에서 매도 발의 → "체결 등록 →" 클릭 → 외화매도이력으로
      이동하지만 그 지시가 목록에 없다. 조회 건수 9건 전부 '완료', 발의 0건.
원인: fx_trade_history.trade_date 는 **희망 집행일**이라 발의 시 기본값이 +3영업일(미래).
      그런데 외화매도이력 탭의 기본 필터가 `기간 종료 = 오늘` → 방금 만든 지시가
      100% 필터에서 탈락한다. 딥링크도 탭만 지정하고 지시를 지목하지 않았다.
해결:
  1. `pendingOrders` prop 신설 — 페이지의 A패턴 훅(기간·통화 필터 없음)에서 미완료
     (발의/승인/부분체결) 지시 전량을 받아 **조회 필터와 무관한 상단 고정 패널**로 표시.
     승인·체결 버튼도 여기 둔다. 이행해야 할 일은 조회 조건에 가려지면 안 된다.
  2. 기본 `기간 종료`를 `addBizDays(today, 10)` 으로 — 미래 집행 예정일 포함.
  3. 딥링크에 `&order={id}` 추가 → 해당 카드 하이라이트 + 체결 가능 상태면 모달 자동 오픈.
  4. 체결 모달 조회를 `hist.data ?? pendingSorted` 로 — 필터 밖 지시도 모달이 열리게.
금지: 미완료 워크플로우 항목을 날짜 범위 필터에만 의존해 노출하지 말 것.
```

#### [CRITICAL] ② 실무 담당자에게 매도 발의 경로가 없었다
```
증상: 외화 비중이 정책 상한을 초과해도 실무 담당자는 발의할 수 없다.
원인: 초과분 매도 발의 UI가 **자금정책 페이지에만** 존재. 자금정책은 권한 제한 메뉴라
      실무자에겐 기능 자체가 없는 것과 같았다.
해결(3곳 동시 — 감지·발의·인지가 전부 이어져야 의미가 있다):
  - `src/lib/fxBandExceed.ts` (신규) — `computeFxBandExceed`(밴드 상한 대비 초과분, 통화별
    구성비 안분) + `buildThresholdOrderPayload`(발의 payload 조립 SSOT).
    ⚠ σ×Z 실효한도가 아니라 **의결된 정책 밴드(fx_target_max)** 를 상한으로 쓴다 —
      "한도는 리스크 모델이 만들고 시점·금액은 리짐이 정한다"는 세션26차 구조상,
      시스템에 박힌 제약은 밴드이고 σ×Z는 그 밴드를 만드는 계산기일 뿐이다.
      실무 화면이 계산기를 재구현하면 두 화면이 다른 상한을 말하게 된다(세션19차 사고 유형).
  - `FxBandExceedCard`(표시 전용) + `FxBandExceedPanel`(자급자족 컨테이너) 분리 —
    리짐 화면은 이미 policyData/params 를 들고 있어 카드에 직접 주입(중복 조회 방지),
    외화거래명세는 컨테이너를 조건부 마운트(활성 탭에서만 조회).
  - 노출: FX 리짐 전략 상단 + 외화거래명세 › 외화매도이력 상단 + **대시보드 이슈 티커**
    (`makeIssueKey('fx_band', 법인)`, `issueLink` → `/fx-ledger?tab=orders`).
    → 자금정책 권한이 없어도 대시보드에서 인지하고 클릭 한 번으로 발의 화면에 도달한다.
  - 발의는 기존 워크플로우 그대로(order_type='threshold', due_date=+3영업일) — 실행·추적은
    여전히 외화거래명세 한 곳.
```

#### ③ 상태별 건수 카드 판독성 + 체결 모달 FIFO 미리보기
- `발의/승인/부분체결/완료/취소` 라벨 한 줄 + `0/0/0/9/0` 값 한 줄 → **라벨·값 세로 짝** 배치
  (숫자 위, 상태 배지 아래). 0건은 회색 처리해 실제 존재하는 상태만 눈에 띄게.
- `CompleteTradeModal` — 저장 전 **FIFO 소진 예정 표**(취득일·계좌유형·소진액·장부환율·실현손익)
  추가. `previewFifoConsumption`(서버 RPC와 같은 규칙의 순수함수) 사용. 환전 가능 재고가
  부족하면(정기예금 만기 전 등) 경고. 손익도 지시의 `acq_rate` 대신 **FIFO 로트 기준**으로
  계산(로트가 없는 법인·통화만 기존 폴백).
  → "FIFO 연동으로 기존 외화가 처분됐는지 기록되는 UI가 없다"는 리포트에 대한 답.

#### ④ 매각 지시 직접 등록(소급 가능) + 승인·취소 확인 패널
```
증상: 2026-08-14 정책회의에서 "USD 300만불 매각" 의결 → 8/18~8/20 하루 100만불씩 분할
      집행 중인데, 이 300만불을 지시 1건으로 등록할 방법이 없었다.
원인: 발의 경로가 전부 **자동 계산 금액 고정**이었다.
      한도초과 발의=초과 안분액 / 리짐 발의=판정 금액 / 재량 발의=자금정책 권한 필요.
      회의체가 정한 총량을 그대로 넣을 입력이 없고, 지시일도 항상 오늘 기준이라
      이미 집행이 시작된 건을 소급 등록할 수 없었다.
      (게다가 옛 "환전이력" 직접 입력 폼은 3일차에 제거돼 useFxTradeHistory.add() 는
       호출부가 0개인 死코드가 됐다 — 그래서 8/19 매각분을 넣을 곳이 사라졌던 것)
해결: components/fx/FxOrderProposeModal.tsx — 통화·수량·**지시일(과거 허용)**·이행 기한·
      발생 경로·매도 예정 환율·메모를 직접 입력. FIFO 재고(환전 가능액·장부환율·예상 손익)를
      같이 보여주고 재고 부족은 경고만 한다(회의체 결정이 재고보다 앞설 수 있으므로 차단 X).
      외화매도이력 탭 우상단 "➕ 매각 지시 등록".
```
- **승인 흐름 정비**: `window.confirm` 제거(세션24차 금지 규칙 위반 상태였음) → 화면 안 확인
  패널. 버튼을 `승인만` / `승인 후 체결 등록` 둘로 나눠, 승인권자와 담당자가 같은 사람인
  법인에서 화면을 다시 찾아가지 않게 했다.
- **취소 확인 패널**: 체결이 0건이면 "FIFO 원장에 영향 없음"을, 있으면 "체결 N이 함께
  원복됨"을 명시. 옛 방식으로 기록된 완료 이력(체결 0건)을 안심하고 정리할 수 있다.
#### ⑤ 원장 탭을 재고 명세형으로 전환 + FIFO 계좌유형 우선순위 ⭐
```
증상 1: 같은 처분이 표에 두 번 나온다 — 로트 행의 `처분금액`(생애 누적)과 별도 유출 행.
원인:   한 표에 **축이 다른 두 모델**을 섞었다. 로트 행 = 재고 명세(로트 기준),
        유출 행 = 거래 타임라인(날짜 기준). 그래서 유출 행의 잔액은 늘 '—'였고,
        계좌유형 필터도 계속 어긋났다.
증상 2: 자금일보 반영·수동 유출이 원장에서 **통째로 안 보인다**(잔액만 조용히 줄어듦).
원인:   타임라인의 유출 행을 `fx_trade_fills` 기준으로 만들었는데,
        consume_fx_lots_for_source 는 fill 없이 consumption 만 남긴다 → fill_id=null 로
        그룹핑에서 탈락. 매각 체결이 아닌 모든 소진이 화면에서 사라졌다.
해결:   원장 = **재고 명세**(로트 1건 = 1행)로 통일. 유출 행 제거.
        상태(잔존/소진 중/소진 완료) + 처분금액 클릭 → 처분 내역 펼침
        (처분일·경로·금액·처분환율·실현손익). 소진 내역(fx_lot_consumptions)을
        `consumptionsByLotId` 로 직접 읽으므로 fill 유무와 무관하게 전부 표시된다.
        날짜순 처분 조회는 **외화매도이력 탭**이 정본 — 원장은 재고, 매도이력은 거래.
금지:   원장에 날짜순 유출 행을 다시 섞지 말 것(중복 표시 + 축 혼재의 원인).
```
- **FIFO 계좌유형 우선순위** (`docs/db/fx_fifo_account_priority.sql` ⭐ **실행 필요**) —
  `policy_params.fx_fifo_account_priority`(param_text, 예 `demand_deposit,mmda`)로
  "보통예금 먼저 / MMDA 먼저"를 정한다. 각 유형 안에서는 여전히 취득일 순(FIFO).
  ⚠⚠ **표시 설정이 아니라 원가흐름 가정의 변경**이다 — 로트마다 취득환율이 달라
  순서가 바뀌면 확정 환차손익이 달라진다. 그래서:
  - 값은 **정책회의만**(자금정책 › FX 정책 › ② 정책 기준 › `FxFifoPriorityCard`) 편집.
    체결 단위 임의 선택은 **지원하지 않는다** — 담당자가 매번 유리한 로트를 고르는
    cherry-picking 을 구조적으로 차단.
  - **기본값 미설정 = 현행 동작**(순수 취득일 FIFO). 값 없는 법인은 아무것도 안 바뀐다.
  - 정기예금 만기 전 제외는 우선순위와 무관하게 유지.
  - 서버 헬퍼 `fx_fifo_account_rank()` 와 클라이언트 `parseAccountPriority()` 는
    **같은 규칙**이어야 한다 — 한쪽만 바꾸면 체결 모달 미리보기와 실제 소진이 갈라진다.
    (테스트 6건: `src/lib/fxLots.test.ts` — 우선순위별 실현손익이 달라지는 것까지 검증)
- **[표시 오류] 원장 계좌유형 필터에서 유출(체결) 행이 세 유형 모두에 표시되던 문제** —
  "한 체결이 여러 유형의 로트를 동시에 소진할 수 있다"는 이유로 유출은 필터를 적용하지
  않았는데, 그러면 **한 푼도 빠지지 않은 유형(예: 정기예금)에도 매각 체결 행이 뜬다.**
  소진 내역(`fx_lot_consumptions.lot_id`)에 어느 로트에서 얼마가 빠졌는지 이미 기록돼
  있으므로, 로트의 `account_type` 으로 매칭해 **그 유형 몫 금액만** 표시하도록 수정.
  전액이 아닌 부분만 보일 때는 `(이 유형 소진분)` 표시 + 툴팁으로 전체 체결액을 안내.
  ⚠ 체결 등록 시 계좌를 고르는 것이 아니다 — FIFO 가 자동으로 정하고 서버가 기록한다.
    이건 순수 표시 버그였다. (이후 ⑤에서 원장 자체를 재고 명세형으로 바꾸며 유출 행이
    사라져 이 필터 문제는 구조적으로 해소됐다.)
- **용어 정정**: 외화매도이력 표 첫 컬럼 `집행일` → **`매도발의일(집행일)`**, 필터도
  `기간 시작/종료` → `발의일 시작/종료`. `trade_date` 는 지시를 등록한 날이고 실제 체결일은
  체결(fill)마다 따로 있어 행을 펼쳐야 보인다 — "집행일"이라고만 쓰면 체결일로 오독된다.
- **[연결 누락] 리짐 화면 이행 중 지시 카드가 `order_type==='regime'` 만 보고 있었다** —
  실무에서 진행 중인 매각은 대부분 의결(discretionary)·한도초과(threshold)라, 세션26차
  9일차에 고쳤다는 "조치 카드 소실" 문제가 그 경로에서 그대로 재현되고 있었다.
  발생 경로와 무관하게 미완료 매도 지시를 전부 표시하도록 수정(§1-A 5번 항목 사례).

검증: tsc -b 0 errors · eslint 0 errors(전체 src). DB 마이그레이션 불필요(전부 클라이언트).
실화면 검증(발의 → 목록 노출 → 승인 → 체결 → 원장 잔액 → 대시보드 경보)은 사용자 확인 예정.

---

### 2026-08-20 세션26차 12일차 — 외화 원장 계좌 간 대체 (Phase 1) ⭐

설계: `docs/기획/외화원장_계좌간거래_설계.md`

#### 배경 — 원장이 "외부 유입/유출"만 알고 있었다
```
외화가 나가는 케이스가 "원화로 매각" 하나만 구현돼 있었다. 실제로는
매입대금 결제 / 보통예금↔MMDA 계좌대체 / 정기예금 예치·해지·재예치 / 이자 수취가
있는데, 그중 **총액이 변하지 않는 내부 이동**은 표현할 방법이 아예 없었다
(source_type CHECK 에 transfer 없음). 로트를 `수정`해 계좌유형만 바꾸면
일부 금액만 옮길 수 없고 이력도 안 남아 과거 사실이 왜곡된다.

실측으로 확인된 단절: investments 의 외화 정기예금 3건과 원장의 term_deposit 로트가
금액·만기는 일치하지만 **서로 참조하는 컬럼이 없다.** 그중 2026-03-17 건은 이미
해지(active=false)됐는데 원장엔 흔적이 없다 — 두 장부가 우연히 맞아 보일 뿐이었다.
```

#### ⭐ 대체 = 원자적 [FIFO 소진 + 신규 로트 생성] 쌍
`docs/db/fx_lot_transfer.sql` ⭐⭐ (**실행 필요**) — `fx_lot_transfers` 테이블 +
`transfer_fx_lots` / `reverse_fx_lot_transfer` RPC. `source_type` CHECK 에
`transfer`/`interest`/`investment` 추가.

금지: 계좌 대체를 **유출 등록 + 유입 등록 두 번으로 처리하지 말 것** — 잔액이 잠깐
어긋나고 실현손익이 두 번 잡힌다. 반드시 서버 단일 트랜잭션(RPC)을 쓴다.

⚠ `fx_lots` 의 `unique (company,currency,source_type,source_id)` 때문에 원가승계로
여러 로트를 만들 때 `source_id` 에 대체 id 를 넣으면 충돌한다 → 링크는 **별도 컬럼
`transfer_id`** 로 두고 `source_id` 는 NULL(Postgres 는 unique 에서 NULL 을 서로 다르게 봄).

#### 평가 방식은 법인별 정책 (사용자 결정 2026-08-20 — "회사마다 다를 것 같다")
`policy_params.fx_transfer_valuation` (`carryover` 기본 | `revalue`).
자금정책 › FX 정책 › ② 정책 기준의 `외화 원장 회계정책` 카드에서 편집(FIFO 우선순위와 같은 카드).

| | carryover (기본) | revalue |
|---|---|---|
| 신규 로트 | 소진 로트마다 **1:1** | **1건** (환율이 하나로 통일) |
| 장부환율·취득일 | 원본 승계 → FIFO 순서 보존 | 대체환율 / 대체일 |
| 실현손익 | **0** | (대체환율 − 장부환율) × 금액 |

⚠ 각 대체 건에 **그때 적용한 방식을 기록**한다(`fx_lot_transfers.valuation_method`) —
정책이 나중에 바뀌어도 과거 이력의 해석이 흔들리면 안 된다.

#### UI
외화거래명세 › 데이터 등록 탭에 `🔄 계좌 간 대체` 카드(`FxTransferCard`).
대체일·출금/입금 계좌유형·금액·만기·연이율·(재평가면)대체환율·중도해지 허용.
저장 전 **원가승계 미리보기**(어느 로트가 어떤 장부환율로 넘어가는지 + 예상 손익)를 보여준다.
정기예금 중도해지는 실무에 존재하므로 체크박스로 명시 허용(기본은 만기 도래분만).

#### Phase 3 — 거래 유형(txn_type) 도입
`docs/db/fx_txn_type.sql` ⭐⭐ (**실행 필요**) — `source_type`(어디서 만들었나)과
`txn_type`(무슨 거래인가)을 분리. 매입대금 결제가 매각과 똑같이 기록돼 **환차손익 요약의
매각 실적이 부풀려지던** 문제를 해소한다.
- 유출 `sale`(환전)/`payment`(대외 지급)/`transfer` · 유입 `opening`/`acquisition`/`interest`/`transfer`
- backfill: `fx_trade_history`→sale, `transfer`→transfer, 나머지 유출→payment
- ⚠ `consume_fx_lots_for_source` 에 인자를 추가하면 `create or replace` 가 아니라 **새 오버로드**가
  생긴다 → 구 8인자 버전을 **drop 후 재생성**한다(SQL 안에 포함). 미실행 상태에서 클라이언트가
  `p_txn_type` 을 넘기면 시그니처 불일치로 실패하므로 **실행 전에는 유출 등록을 쓰지 말 것.**
- SSOT `src/lib/fxTxnType.ts`(`summarizeRealizedPnl` 포함) · 유출 등록 폼 유형 선택 ·
  환차손익 요약 유형별 3줄 · 원장 처분 내역 유형 배지

#### 원장 정렬·필터
7개 컬럼 헤더 클릭 정렬(↕/▲/▼) + 상태 필터(잔존/소진 중/소진 완료) + 잔액 하한 + 건수 표시.

#### Phase 2 — 정기예금 해지·재예치 + 운용자금 연동
`docs/db/fx_term_deposit_settle.sql` ⭐⭐ (**실행 필요**) — `settle_fx_term_deposit` /
`link_fx_lots_to_investment` RPC.
```
배경: 정기예금은 두 장부에 동시에 존재한다.
  investments = 계약 조건(은행·금리·만기)·만기 처리 여부의 정본
  fx_lots     = 외화 원가(장부환율)·FIFO 순서·환전 가능 여부의 정본
서로 참조하는 컬럼이 없어 따로 놀았다(메디아나 USD 2026-03-17 건은 이미 해지됐는데
원장엔 흔적이 없었다).
```
- **해지 = [원금 대체 + 이자 신규 로트] 한 트랜잭션.** 원금은 `transfer_fx_lots` 를 그대로
  재사용하므로 평가 방식(carryover/revalue)도 법인 정책을 따른다.
  ⚠ **이자는 새로 생긴 외화다** — 원가승계 대상이 아니라 **해지일 환율의 신규 로트**
  (`txn_type='interest'`)여야 한다. 원금 장부환율로 넣으면 원가가 희석된다.
- **재예치**는 `to_account_type='term_deposit'` 대체로 그대로 성립(새 만기·금리, 원가 승계).
- **중도해지**는 `p_allow_early` 로 명시 허용(기본은 만기 도래분만).
- UI `FxTermDepositCard`(데이터 등록 탭): 정기예금 로트 목록 + 만기 강조 +
  **정합성 점검**(원장 term_deposit 합계 vs 운용자금 활성 합계 불일치 경고) +
  미연결 로트 1회 수동 매핑(설계 §4 D).
- ⚠ **운용자금(`investments`) 쪽 만기처리는 이 카드에서 하지 않는다** — 자체 감사 로그가 있는
  별도 도메인이라 원장 반영 후 안내만 하고 실제 처리는 운용자금 화면에서 한다(설계 §4 C 반자동).

#### [실사용 리포트] 대체한 로트가 "안 보인다" — 취득일 승계의 부작용
```
증상: 보통예금 → MMDA 로 1,000 대체 후 MMDA 탭에서 새 로트를 찾지 못함.
원인: 버그가 아니라 **원가승계 설계의 가시성 문제**다. 대체 로트는 FIFO 순서 보존을 위해
      **원본의 취득일을 승계**하므로, 오늘 대체해도 원장 표(유입일 내림차순)에서
      원본 취득일 위치에 끼어 들어간다. 게다가 다른 로트와 생김새가 같아 구분도 안 된다.
해결: ① 원장 표 계좌 열에 `대체`/`이자` 배지(툴팁으로 취득일 승계 설명)
      ② 대체 카드에 **대체 이력 목록**(이벤트 단위: 대체일·이동·금액·방식·실현손익)
      ③ 이력에서 **원복(취소)** 가능 — reverseTransfer 를 구현만 해두고 UI 에 노출하지
         않았던 것도 함께 해소. 생긴 로트가 이미 소진됐으면 서버가 거부한다.
금지: 가시성을 위해 대체 로트의 취득일을 대체일로 바꾸지 말 것 — FIFO 순서가 깨지고
      원가승계의 의미가 사라진다(그건 재평가 방식이다).
```

#### 남은 것
- 실화면 검증(정기예금 해지·재예치 → 이자 로트 확인)
- 기존 정기예금 2건의 운용자금 매핑(화면에서 1회 수행)

> **인수인계**: `docs/기획/인수인계_세션26_11-13일차.md` — 다음 세션(다른 LLM 포함)은 이것부터 읽을 것.

검증: tsc -b 0 errors · eslint 0 errors · vitest 253/253.
⚠ `npx vitest run`(전체)·`npx vitest run src/lib` 둘 다 `.claude/worktrees/agent-*` 의 스테일
사본을 함께 잡아 날짜 의존 테스트가 깨진다 — 실제 소스와 무관하다.
**검증은 `npx vitest run --dir src`** 로 할 것(worktree 제외, 61 tests).

---

### 2026-08-20 세션26차 13일차 — 메뉴 접근 권한 트리 (사이드바 SSOT 통합) ⭐

사용자 리포트: "권한 화면이 텍스트 칩이라 **실제 사이드바와 차이가 있고 계층이 안 보여서,
체크해도 원하는 메뉴가 반영됐는지 확인할 수가 없다**."

#### [CRITICAL] 두 목록이 실제로 어긋나 있었다 — SSOT 위반의 전형
```
원인: 사이드바 메뉴(NAV_GROUPS)는 Sidebar.tsx 안에, 권한 부여 목록(MENU_SLUGS)은
      UsersPage.tsx 안에 **따로** 정의돼 있었다(§1-A 4번 위반).

실제 드리프트:
  ① audit-log(변경 이력 로그) — 사이드바엔 있는데 권한 목록·역할 기본값 **양쪽에 없어
     master 외에는 아무도 볼 수 없었다.** 부여할 방법 자체가 없던 상태.
  ② 라벨 5건 불일치 — 특히 `환율 국면`은 7일차에 `FX 리짐 전략`으로 개명했는데 권한
     화면만 옛 이름. 관리자가 체크한 것과 사용자가 보는 메뉴 이름이 달랐다.
  ③ daily / history 슬러그를 2개 화면이 공유하는데 UI 엔 한 줄로만 보여, 체크 하나가
     화면 두 개를 여는 것을 알 수 없었다.
  ④ 섹션 계층이 평면 칩으로 뭉개짐.

해결: src/lib/navTree.ts 로 **네비게이션 트리를 SSOT 화**. Sidebar 와 UsersPage 가 같은
      상수를 읽는다 → 메뉴를 추가·개명하면 권한 화면이 자동으로 따라온다.
금지: 메뉴 목록을 화면 안에 다시 정의하지 말 것.
```

- `MenuPermissionTree` — 사이드바와 **동일한 아이콘·라벨·순서**의 트리.
  섹션 3-state 체크(전체 ✓ / 부분 − / 없음) · slug 병기 · **같은 slug 항목은 묶어서
  "함께 열림" 표시**(③) · 전체선택/역할기본값/전체해제 버튼.
- **역할 기본값 미리보기** — 커스텀 미설정이어도 트리를 보여준다. 과거엔 "미선택 시 역할
  기본값 적용"이라는 문장만 있어 실제로 무엇이 열리는지 확인할 방법이 없었다.
- **관리 섹션은 `masterOnly`** — 표시하되 체크박스를 주지 않는다.
  ⚠ `admin` 역할은 "업무 관리자"이지 시스템 관리자가 아니다. **실질 관리자는 master**
  (2026-08-20 사용자 확인) — 관리 메뉴의 master 하드코딩은 결함이 아니라 설계다.
  사이드바와 같은 그림이어야 "왜 여긴 체크가 없지?"라는 의문이 안 생긴다.
- `audit-log` 는 부여 가능해졌지만 **역할 기본값에는 넣지 않았다**(fx-regime 과 동일한 opt-in) —
  감사 로그는 실질 관리자(master)가 보는 것이고, 필요한 계정에만 명시 부여한다.

⚠ `treasury_users.menus` 스키마·`hasMenu()` 로직·slug 값은 **그대로**다 — DB 마이그레이션
불필요하고 기존 사용자 권한도 유지된다.

#### 3탭 → 단일 트리 통합 (같은 날 후속)
사용자 제안: "트리로 펼치면 카테고리 권한은 없어도 되지 않나? 작업 권한도 메뉴 트리 안에
체크박스로 붙이면 되지 않나?"

**작업 권한 — 합쳤다.** `SectionKey` 10개 중 8개가 메뉴와 1:1 이다.
`operating`→운전자금 / `invest`·`loans`·`equity`·`policy` 그대로 / `fx_trade`→외화거래명세.
⚠ 나머지 2개가 주의점이다:
  · `history`(자금 변동 이력) / `issue_history`(이슈 이력) — **menu slug 는 공유하는데 작업
    권한은 따로**다 → 메뉴 체크는 slug 단위, 작업 권한은 **항목 단위**로 그린다.
  · `daily_write` / `daily_submit` — 한 화면 안에서 작성과 상신·결재가 갈린다 →
    `extraSections` 로 하위 행을 하나 더 둔다.
  · 조회 전용 화면(대시보드·환율 현황·리짐·감사로그)은 `section` 이 없어 "조회 전용"으로 표시.

**카테고리 권한 — 없앨 수 없다.** `allowed_categories` 는 메뉴가 아니라 **자금일보 안의
입출금 항목 종류**(매출채권 회수·미지급금 지급 등) 필터라 축이 다르다. 다만 별도 탭으로
떠 있을 이유는 없어 **자금일보 작성 행 아래 접이식**으로 넣었다.

- 결과: `메뉴 접근 / 카테고리 권한 / 작업 권한` 3탭 → **트리 하나**. 커스텀 토글 3개는
  상단 한 줄로(각각 `null`=역할 기본값이라는 의미가 있어 유지).
- 작업 권한 체크는 **메뉴 접근이 없으면 비활성** — 메뉴가 없으면 작업 권한은 적용되지 않는다.
- 조회를 끄면 입력·삭제도 함께 꺼지고, 입력·삭제를 켜면 조회가 자동으로 켜진다(모순 조합 방지).

검증: tsc -b 0 errors · eslint 0 errors · vitest 253/253.

---

### 2026-08-20 세션26차 13일차 — 메디아나 자금현황 기재일 +1 영업일 시프트 (완료) ⭐

법인마다 자금현황 기재 시점이 달랐다. 표준(D일 아침에 **전영업일 마감**을 D일자로)과 달리
메디아나만 **D일 마감을 D일자로** 기재해(한 영업일 늦음) 당일 아침 입력이 불가능했다.
회의로 표준 통일을 결정하고 **과거 데이터도 +1 영업일 시프트**했다.

- 스크립트: `docs/db/mediana_daily_shift_1bizday.sql` (**실행 완료** — 2026-08-20)
- 결과: `daily` 87건 `04-14~08-19` → `04-15~08-20` · `daily_reports` 53건 `06-04~08-20` → `06-05~08-21`
- 검증 완료: 값 이동 정확 · 광복절 연휴(8/14→8/18) 반영 · 다른 법인 무영향 · 중복 0 · 임시 오프셋 잔존 0
- 백업: `backup.daily_20260820` / `backup.daily_reports_20260820` (며칠 유지 후 정리)

#### 작업 중 잡은 결함 3건 — 전부 DRY-RUN 단계에서 발견
```
① daily_reports 를 자기 시퀀스로 밀면 영업일을 점프한다
   일보를 안 쓴 날이 비어 있다(실측: 2026-06-05 → 06-09, 6/08 일보 없음).
   그대로 실행했으면 그 뒤 일보가 전부 한 칸씩 더 밀렸을 것이다.
   → 영업일 달력은 **daily 하나로 통일**. daily 는 영업일마다 빠짐없이 존재하므로
     그 날짜 시퀀스가 곧 영업일 달력이다(공휴일 테이블 불필요, 대체공휴일 자동 반영).

② 두 테이블의 날짜 컬럼 **타입이 다르다**
   daily.date = text(YYYY-MM-DD) / daily_reports.report_date = date
   → 캐스팅 없이 조인하면 `operator does not exist: text = date`.
     daily 갱신은 to_char(...,'YYYY-MM-DD') 로 문자열 대입.

③ Supabase SQL Editor 에서 `begin;`~`commit;` 은 **원자성을 보장하지 않는다**
   커넥션 풀러를 통해 실행돼 문장이 서로 다른 세션으로 갈 수 있고, 그러면
   **temp table 이 다음 문장에서 사라진다**(`relation "_bizcal" does not exist`).
   중간에 끊기면 daily 만 밀리고 daily_reports 는 그대로인 반쪽 상태가 된다.
   → 다건 UPDATE 스크립트는 **단일 `do $$ ... $$;` 블록**으로 감쌀 것(한 문장 = 한 트랜잭션).
```

⚠ **`daily` 만 옮기면 안 된다** — 자금일보는 `daily[작성일]`(마감)과 `daily[전영업일]`(기초)을
읽어 `입금−출금−잔액증감=0` 을 검증한다. 한쪽만 밀면 이미 승인된 과거 일보가 전부 어긋난다.
반드시 `daily_reports.report_date` 와 **함께** 민다.

⚠ 오늘 작성 중이던 초안 1건(구 8/20)이 **8/21 로 이동**했다 — 내일 일보를 열면 그 초안이 보인다.

⚠ **`investments` 는 시프트하지 않았다.** `start_date`/`maturity` 는 잔액 기재일이 아니라
**계약일**이라 밀면 만기 판정·이자 계산·FIFO 정기예금 잠금이 어긋난다.
실제로 계약일 자체가 하루 늦게 입력돼 왔다면 별도 검토가 필요하다(사용자 확인 대기).

---

### 2026-08-20 세션26차 13일차 — 원장 ↔ 자금현황: 경고 대신 자동 매칭 ⭐

사용자 판단: "원천적으로 못 맞추는 차이를 굳이 띄워 언급하기보다, 오늘 실시간으로 넣은 걸
내일 자금일보 쓸 때 매칭하거나 자동 반영하는 게 낫지 않나?"

맞다. 원장은 **거래 기준**(체결 즉시), 자금현황은 **잔액 확정 기준**(익일 기재)이라
실시간 일치는 원리적으로 불가능하다. 조정표를 만들어 차이를 상시 노출하는 대신
**애초에 차이가 안 생기게** 했다.

#### [CRITICAL] 이중 차감 버그 — "미반영" 패널이 이미 반영된 거래를 또 빼려 했다
```
증상 가능성: 매각 체결로 원장에서 이미 100만불이 빠졌는데, 다음날 줄어든 잔액을
      자금현황에 입력하면 "100만 미반영"이 뜨고, [반영] 을 누르면 **원장에서 또 빠진다.**
원인: useFxLedgerReconciliation 이 "이미 반영된 금액"을 셀 때
      `source_type='daily_report_item'` **만** 봤다(그 패널이 만든 것만).
      매각 체결(fx_trade_history)·수동 유출(manual)·이자(interest)는 세지 않았다.
      메디아나 8/18·8/19 매각분이 실제로 이 상태였다(누르지 않아 사고는 없었음).
해결: 원장에 이미 있는 **그날 거래 전부**를 차감. 매칭 키가 두 종류다 —
      · daily_report_item : 이 패널이 만든 것이라 source_id = daily.id 로 정확히 매칭
      · 그 외             : **거래일(txnDate)** 로 매칭
      ⚠ daily[X] 는 **전영업일 마감**이므로 X 행의 델타는 **전영업일 거래**다
        (txnDate = rows[i-1].date). 이 키를 틀리면 하루씩 어긋난다.
      ⚠ 계좌 대체(transfer)는 차감하지 **않는다** — 같은 통화 내 이동이라 총 잔액이
        변하지 않고 daily 델타에도 안 나타난다. 차감하면 오히려 어긋난다.
      ⚠ 개시 로트(opening)도 제외 — 거래가 아니라 최초 재고 스냅샷이다.
      반영 시 원장 기록 날짜도 item.date → **item.txnDate** 로 수정(거래일 기준 유지).
결과: 정상 운영이면 미반영액이 0 이 되어 패널이 조용해진다. 남는 것은 **원장이 모르는 증감**뿐.
```

#### 자금일보 작성 화면에 그날 원장 거래 표시
`useFxLedgerDayActivity` + `LedgerDayActivityPanel` — 보고대상일에 원장에 기록된 거래를
접이식으로 보여준다. "어제 USD 가 왜 100만 줄었나"를 다른 화면에서 찾지 않아도 된다.

⚠ **외화 매각은 자금일보 입출금 항목이 필요 없다.** USD 감소와 KRW 증가가 상계되어
총 잔액이 거의 변하지 않는다(스프레드 제외). 항목이 필요한 것은 **대외 지급(payment)** 처럼
총자산이 실제로 줄어드는 거래다. 매각을 출금 항목으로 넣으면 검증식이 오히려 깨진다.

검증: tsc -b 0 errors · eslint 0 errors · vitest 253/253.

---

### 2026-08-21 세션26차 14일차 — 출금 계좌 지정 + 수동 유출 정정 ⭐

사용자 리포트 2건. `docs/db/fx_outflow_account_and_reverse.sql` ⭐⭐ (**실행 필요**)

#### ① FIFO 가 실제 인출 계좌를 무시했다
```
회사 업무 규칙(제공 표):
  보통예금 출금 — 외화물대 지급 / 달러매각 / 정기예금 가입 / MMDA 대체
  MMDA     출금 — 달러매각 / 정기예금 대체
  정기예금 출금 — 재예치 인출 / 만기 후 매각
→ **거래 유형마다 나가는 계좌가 다르다.** 특히 외화결제대금(물대)은 보통예금 전용.
  그런데 FIFO 는 계좌유형과 무관하게 취득일 순으로만 소진해서, 실제 인출 계좌와
  장부상 소진 계좌가 어긋났다.
  법인 단위 단일 우선순위(fx_fifo_account_priority)로는 표현이 안 된다.

해결: 유출 시 **출금 계좌유형을 지정**할 수 있게 했다(consume_fx_lots_for_source /
  complete_fx_trade_fill 에 p_account_type 추가, null 이면 기존 정책 우선순위).
  ⚠ 11일차에 "체결 단위 계좌 선택은 cherry-picking 위험"이라 반대했었는데, 그 판단은
    **매각 손익을 고르는 경우**에 한한 것이었다. 대외 지급의 출금 계좌는 **선택이 아니라
    사실**이다(은행에서 실제로 그 계좌에서 나갔다). 계좌 안에서는 여전히 취득일 FIFO 를
    강제하므로 로트 고르기는 불가능하다 — 사실은 정확히 기록하고 조작은 막는다.
  잔액 부족 시 계좌명과 함께 친절한 오류를 낸다(어느 계좌가 모자란지 알 수 있게).
```
- 기본값: 수동 유출 폼은 **보통예금**(회사 규칙상 물대가 기본), 체결 모달은 **자동(정책)**
- 체결 모달의 FIFO 미리보기도 선택 계좌로 좁혀 계산 — 서버와 같은 결과를 보여준다

#### ② 잘못 입력한 수동 유출을 되돌릴 수 없었다
```
실측: 2026-08-06 대외 지급 -24,227.1 오입력. 매각 체결은 reverse_fx_trade_fill,
계좌 대체는 reverse_fx_lot_transfer 가 있는데 **수동 유출만 경로가 없었다.**
해결: reverse_fx_consumption_by_source RPC 신규 + 원장 처분 내역에 "취소" 버튼.
⚠ source_type 을 'manual'/'daily_report_item' 으로 **제한**한다. 매각 체결은
  fx_trade_fills·fx_trade_history 상태까지 함께 되돌려야 해서 전용 RPC 를 써야 한다 —
  여기로 우회하면 거래 상태가 어긋난다. 서버가 막고, UI 도 그 두 유형에만 버튼을 준다.
```

검증: tsc -b 0 errors · eslint 0 errors · vitest --dir src 61/61.

---

### 2026-08-21 세션26차 14일차 — 자금정책 법인 선택 이중화 제거 + 알림 접기

사용자 리포트: "주의 필요 4건을 접고 펼 수 있게. 상단 회사 선택과 연동되게. 회사 목록은
선택하지 않아도 되게."

```
문제: 자금정책 페이지에 **법인 칩이 따로 있었다**(전체/셀바스에이아이/…). 상단 TopBar
      법인 선택과 이중이라 **어느 쪽이 적용된 건지 알 수 없었다.**
      게다가 "주의 필요" 알림이 건수만큼 늘어나 화면 위쪽을 다 먹고 아래가 밀렸다.
해결: · 법인 칩 **제거**(데스크톱·모바일 두 벌 다). companyTab 은 currentCompany 를 따른다.
      · 전 법인 요약(주의 필요 + 정책 적합성 매트릭스)은 '전체' 선택 없이 **항상 표시**.
        여러 법인 접근 계정에서만 의미가 있어 canSeeAll 로 가린다.
      · 주의 필요 다이제스트에 접기/펼치기(기본 펼침).
      · **주의 필요 알림은 선택 법인만** 표시(후속). 매트릭스는 전 법인 조망이 목적이지만
        알림은 "지금 내가 조치할 것"이라 다른 법인 경고가 섞이면 초점이 흐려진다.
        → AllCompanySummary 에 `digestCompanies`(알림용) / `companies`(매트릭스용) 분리.
      · 남은 "법인을 선택해주세요" 안내 문구를 **상단 법인 선택기**로 안내하도록 수정 —
        칩을 없앴는데 "위 칩에서 선택하세요"가 남아 있으면 막다른 길이 된다.
⚠ companyTab === 'all' 분기는 남겨뒀다. 동기화 effect 가 돌기 전 첫 렌더에서 잠깐
  'all' 일 수 있어 폴백이 필요하다(제거하면 그 순간 크래시).
```

검증: tsc -b 0 errors · eslint 0 errors · vitest --dir src 61/61.

---

### 2026-08-25 세션27차 — 자금일보 자금현황: 운용자금·차입금 point-in-time 재구성 ⭐

사용자 리포트: "운용자금 기업은행 중금채 30억 신규 등록했는데 자금일보에 반영이 안 된다."
조사해 보니 원인이 **세 겹**이었고, 셋 다 §1-A 유형(조각은 정상, 흐름이 끊김)이었다.

#### [CRITICAL] ① 운용자금·차입금 잔액에 기초/마감 구분이 없었다
```
증상: 운용자금을 신규 집행하거나 해지해도 자금현황 표의 Δ 가 0 이라 표에 아무 변화가 없다.
      과거 일보를 다시 열면 그때 없던 자금까지 들어가 있다(소급 변경).
원인: 훅이 investments/loans 를 active=true 로만 조회하고, 그 "현재 활성 잔액"을
      기초·마감 **양쪽에 그대로** 넣고 있었다. 국채·지분만 날짜별 이력이 있어
      point-in-time 이었고 예금성·MMF·RP·차입금은 아니었다.
      → 운전자금(daily)은 보고대상일 기준인데 운용자금은 현재 시점 기준이라
        같은 표 안에서 기준일이 섞여 있었다.
해결: closeDate(=보고대상일) / baseDate(=그 직전영업일) 기준으로 각각 재구성.
      lib/treasuryCalc 에 wasOpenOn·isOpenOn 을 SSOT 로 두고 CashflowChart 와 공유한다
      (세션19차 Task 5·6 에서 대시보드에만 적용했던 규칙을 자금일보까지 확장).
⚠ closed_date 없음 = 열려있음 으로 판단하지 말 것 — active 를 최종 폴백으로 쓴다
  (세션19차 Task 6 과대산정 회귀). 테스트: src/lib/treasuryCalc.test.ts 9건.
```

#### [CRITICAL] ② 입출금액이 `product === '정기예금'` 행에만 하드코딩돼 있었다
```
증상: 중금채·MMF·RP 행은 입금액·출금액 칸이 구조적으로 항상 0.
      반대로 정기예금 행에는 **지분(RCPS) 매입 9.99억까지** 붙어 있었다
      (실측: 유일한 invest_execute 항목이 linked_type='equity' 였다).
      차입금은 더 나빠서 단기·장기 두 행에 전액이 중복 표시됐다.
해결: 항목의 linked_id 로 원천 레코드를 찾아 그 행에 귀속한다.
      훅이 investLabelById / loanLabelById / equityNameById 를 내보내고
      liveItemSums 가 byInvestLabel · byLoanLabel · byEquityFlow 를 만든다.
      ⚠ 라벨 생성 규칙은 investGroups 의 label 과 **반드시 동일**해야 한다 —
        어긋나면 금액이 어느 행에도 안 붙고 조용히 사라진다.
      운용자금 소계(investIn/Out)에서 linked_type='equity' 는 제외 — 지분은 운용자금이 아니다.
```

#### [CRITICAL] ③ 훅이 investFromDb 를 거치지 않아 국채가 취득원금으로만 잡혔다
```
supabase.from('investments').select('*') 는 DB 행(snake_case)을 그대로 준다.
그걸 InvestmentRecord 로 캐스팅만 해서 bondQty/bondPrice/bondName/priceDate 가 전부
undefined 였다 → 국채가 시가평가 없이 amount(취득원금)로 잡히고, 행 이름도 채권명이 아니라
은행명으로 나오고, 그 탓에 byBondLabel(@auto:bond:{채권명}) 매칭도 실패해
평가손익 자동기재가 해당 행에 안 붙었다. (세션26차 autoRefreshPrices 와 동일 사고)
해결: investFromDb() 경유. 국채 평가액이 대시보드와 같은 시가 기준으로 통일된다.
```

#### ④ 연쇄 — 연동 팝업이 만든 자산이 표에 안 나타나던 문제
`ItemsSection` 의 연동 팝업이 운용자금·차입금·지분 레코드를 새로 만들어도
`useDailyReportSummary` 는 stale 이라 행도 귀속도 없었다(§1-A 2번).
`onSourceChanged` 콜백을 추가해 저장 직후 자금현황을 다시 읽는다.

#### 부수 효과 (의도된 것)
- 자금 총합계의 **마감 열이 보고대상일 기준**이 됐다 → 그 이후 신규 집행·해지가 있으면
  통합상황판(현재 시점)과 차이가 난다. 표 하단 안내 문구에 이 기준일 차이를 명시했다.
- 과거 일보를 다시 열면 그 시점 잔액으로 보인다(더 이상 소급 변경되지 않는다).
- 검증식(`입금−출금−잔액증감=0`)은 **운전자금(daily)만** 쓰므로 이 변경의 영향을 받지 않는다.

#### 운용자금 상품유형에 중금채 추가
드롭다운에서만 빠져 있었다(`DEPOSIT_PRODUCTS`·`DEPOSIT_ORDER` 에는 계속 있어 집계는 정상).
InvestPage 와 자금일보 투자 집행 연동 팝업 **두 진입 경로 모두**에 추가.

검증: tsc -b 0 errors · eslint 0 errors · vitest --dir src 70/70(신규 9건) · vite build 성공.

---

## 17. 개발 시 체크리스트

새 세션에서 작업 시작 전:
- [ ] **§1-A 연계성 우선 개발 규칙 5문항 체크리스트** 통과 (진입경로·연쇄·필터기본값·SSOT·상태잔존)
- [ ] **메뉴를 건드렸다면** — `src/lib/navTree.ts` 만 고쳤는지 확인하고, 사용자 관리 › 권한 트리를
      열어 사이드바와 대조할 것 (§1-A "메뉴를 바꾸면 반드시 함께 바뀌어야 하는 것")
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
