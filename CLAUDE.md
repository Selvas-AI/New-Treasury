# CLAUDE.md — Selvas Treasury (New-Treasury)
> 신규 세션 시작 시 이 파일을 먼저 읽어 컨텍스트를 복원하세요.
> 최종 업데이트: 2026-06-02

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
Tailwind CSS v4  (@tailwindcss/vite 플러그인, NOT postcss)
Recharts         (차트)
react-router-dom v7  (BrowserRouter, basename="/New-Treasury")
@supabase/supabase-js
zustand          (설치됨, 아직 미사용)
@tabler/icons-react (설치됨, 현재 이모지 사용 중)
```

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
│   ├── Sidebar.tsx         ← 접기/모바일 + 하단 실시간 환율
│   └── TopBar.tsx          ← 법인 선택 + 주가 티커 + 로그아웃
├── components/dashboard/
│   ├── KpiCard.tsx
│   ├── WaterfallCard.tsx   ← 자금흐름 수평바 + 도넛 차트
│   ├── IssueCard.tsx       ← 이슈 감지 카드
│   ├── CashflowChart.tsx   ← 기간별 Bar 차트 (Recharts)
│   └── EquityCard.tsx      ← 지분 목록 + 추이 Area 차트
├── components/equity/
│   ├── EquityHistoryPanel.tsx
│   ├── BondHistoryPanel.tsx
│   ├── NewEquityForm.tsx   ← 지분(상장/비상장) 신규 등록 폼
│   └── NewBondForm.tsx     ← 국채/채권 신규 등록 폼
├── hooks/
│   ├── useAuth.ts
│   ├── useDaily.ts
│   ├── useLoans.ts
│   ├── useInvestments.ts
│   ├── useEquities.ts
│   ├── useIssues.ts
│   ├── useFx.ts            ← GAS 환율 (Sidebar에서 자동 로드)
│   ├── useDashboard.ts     ← 대시보드 집계 훅
│   ├── useGas.ts           ← GAS 공통 fetch 헬퍼 (timeout/HTML감지)
│   ├── useStockTicker.ts   ← 3개 법인 주가 5분 폴링 (TopBar 티커)
│   └── useDashboardLayout.ts ← DnD 레이아웃 훅 (현재 미사용)
├── pages/
│   ├── DashboardPage.tsx   ← 통합 상황판 (이번 세션 레이아웃 재설계)
│   ├── EquityPage.tsx      ← 지분/장기투자 (이번 세션 신규 등록 기능 추가)
│   └── ...
└── types/index.ts
```

---

## 6. 환경변수 (.env.local — gitignore 대상, 직접 생성 필요)

```env
VITE_SUPABASE_URL=https://qobfmihxcclbzfaohnor.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_GAS_API_URL=https://script.google.com/macros/s/AKfycbwZ.../exec
```

---

## 7. 이번 세션(2026-06-01)에서 완료된 작업

### Task 1: 지분/장기투자 신규 종목 등록 폼
- `NewEquityForm.tsx` — KOSPI/KOSDAQ/비상장 신규 종목 등록
- `NewBondForm.tsx` — 국채/채권 신규 등록 (ISIN + 기준가 조회)
- `EquityPage.tsx` — 각 탭 상단에 신규 등록 버튼 연결

### Task 2: 통합 상황판 레이아웃 재설계
- **새 레이아웃** (`DashboardPage.tsx`):
  ```
  [KPI 3fr | KPI 3fr | KPI 2fr]   ← 좌 8fr
  [WaterfallCard        8fr    ]   우 3fr: IssueCard
  [CashflowChart | EquityCard  ]       → 운전자금 상세
                                       → 운용자금 상세
                                       → 차입금 상세
  ```
- 외부 그리드: `lg:grid-cols-[8fr_3fr]`
- KPI 비율: `style={{gridTemplateColumns:'3fr 3fr 2fr'}}`
- 하단 좌측: `grid-cols-2` (CashflowChart + EquityCard 나란히)
- DnD(`react-grid-layout`) 도입 시도 → **롤백** (필요시 재도입 검토)

### Task 3: GAS/시세 연동 기반 구현
- `useGas.ts` — timeout(8s) + HTML응답 감지 + abort 처리
- `useStockTicker.ts` — 5분 폴링, GAS 실패시 `price:0` mock 유지
- `TopBar.tsx` — 주가 티커 영역 추가 (GAS 미연결시 스켈레톤)
- `Sidebar.tsx` — 하단 실시간 환율 섹션 추가 (자동 로드)

---

## 8. 미완료 / 추후 작업

### GAS 스크립트 측 작업 필요 (React 코드 아님)
| 기능 | GAS action | 상태 |
|------|-----------|------|
| 주가 조회 | `getStockPrice&code=108860` | GAS URL 소유 확인됨 — `.env.local` 설정 필요 |
| 채권 시세 | `getBondPrice&isin=...` | GAS URL 소유 확인됨 — 구현 여부 확인 필요 |
| 환율 조회 | `getExchangeRates` | GAS URL 소유 확인됨 — 구현 여부 확인 필요 |

GAS 응답 형식:
```json
// 주가: { "code":"108860", "price":10310, "date":"2026-06-01", "change":-780, "changePct":-7.03 }
// 채권: { "isin":"KR103...", "price":9850.5, "date":"2026-06-01" }
// 환율: { "USD":1506.83, "EUR":1755.94, "JPY":9.46, "GBP":2026.60, "CNY":222.49 }
```

### 미구현 기능
- `useDashboardLayout.ts` — 생성됐으나 현재 미사용 (DnD 롤백)
- Zustand 전역 상태 — 설치만 됨
- Tabler Icons — 설치만 됨 (현재 이모지 사용)
- E2E 테스트 (Playwright)

---

## 9. ⚠️ 중요 시행착오 & 금지사항

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

---

## 10. Supabase 핵심 테이블

| 테이블 | 설명 |
|--------|------|
| `daily` | 운전자금 일별 잔고 (krw_demand/govt/mmda + fx 5종) |
| `investments` | 운용자금 + 국채 (product 필드로 구분, 국채는 bondTicker/bondQty/bondPrice) |
| `loans` | 차입금 (active로 상환 처리) |
| `equities` | 지분투자 날짜별 시세 (같은 종목 날짜별 row 누적) |
| `issue_comments` | 이슈 스레드 (issue_key: `loan_{uuid}` / `equity_{종목명}` / `input_daily`) |
| `access_codes` | 사용자 인증 코드 |

**국채 평가금액**: `bondQty × (bondPrice ÷ 10)` (`calcBondValue` 함수 사용)

---

## 11. 라우팅 구조

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

## 12. 주요 유틸 함수 (src/lib/format.ts)

| 함수 | 설명 |
|------|------|
| `fmtKRW(n)` | 억·만 단위 자동 변환 (1억 이상: "X억원") |
| `calcDday(maturity)` | 오늘~만기까지 일수 |
| `calcReturn(val, cost)` | 수익률 계산 (null if cost=0) |
| `calcBondValue(qty, price)` | 채권 평가금액 |
| `normDate(str)` | YYYYMMDD → YYYY-MM-DD |

---

## 13. 개발 및 문서화 규칙 (Documentation Rule)

코드 수정 또는 기능 추가 시 **작업 완료 직전** 반드시 아래 규칙을 따른다.

1. **관련 docs 갱신**: 수정된 기능에 해당하는 `docs/` 내 MD 파일(`SELVAS_TREASURY_CONTEXT.md`, 컴포넌트별 문서 등)을 최신 상태로 업데이트한다.
2. **변경 이력 기록**: 새롭게 파악된 이슈나 중요한 구조적 변경사항은 `docs/CHANGELOG.md` 또는 적절한 신규 문서를 생성해 기록한다.
3. **TODO 체크**: `docs/TODO.md`에 있는 항목을 완료했다면 해당 체크박스를 `[x]`로 업데이트한다.

---

## 14. 개발 시 체크리스트

새 세션에서 작업 시작 전:
- [ ] `pnpm dev` 로 개발 서버 기동 확인 (port 5175)
- [ ] `.env.local` 존재 확인 (없으면 섹션 6 참조해서 생성)
- [ ] `sessionStorage['treasury_user']` 에 master 세션 주입 or 로그인
- [ ] `pnpm build` 로 빌드 에러 없는지 확인 후 코드 작업 시작

---

## 15. 참고 문서 (docs/ 폴더)

| 문서 | 내용 |
|------|------|
| `docs/SELVAS_TREASURY_CONTEXT.md` | 레거시 HTML 시스템 전체 컨텍스트 + DB 스키마 + GAS 구조 |
| `docs/SELVAS_TREASURY_REACT_CONTEXT.md` | React 신규 구축 Step별 완료 현황 |
| `docs/ROUTING_DEEPLINK_SPEC.md` | 딥링크 URL 명세 |
| `docs/hooks/README.md` | 모든 커스텀 훅 API 레퍼런스 |
| `docs/INDEX.md` | 문서 전체 인덱스 |
| `docs/TODO.md` | 기능 구현 TODO (우선순위별 체크리스트) |
