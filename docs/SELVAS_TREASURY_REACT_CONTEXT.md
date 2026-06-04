# Selvas Treasury — React 신규 구축 컨텍스트
> 최종 업데이트: 2026-06-04 | **전체 Step 1~18 완료 + 대시보드 Updateplan_260604 반영**
> 이 문서는 새로운 Claude 세션(어떤 환경에서든)에서 맥락을 이어받기 위한 핸드오버 문서입니다.
> 기존 HTML 시스템 전체 컨텍스트는 `SELVAS_TREASURY_CONTEXT.md` 를 함께 참조하세요.

---

## 1. 프로젝트 전환 배경

### 왜 React로 전환하는가
- 기존 `index.html` 단일 파일이 ~10,900줄까지 증가
- 전역 변수, DOM 직접 조작, 함수 간 암묵적 의존으로 유지보수 한계 도달
- Phase 2(자금정책 상황판), Phase 3(자금일보+결재), Phase 4(자금수지) 확장 대비

### 전환 전략 — 병렬 운영
- 기존 `treasury` (HTML) → `treasury.selvas.com` 에서 계속 운영 중
- 신규 `New-Treasury` (React) → 별도 URL에서 개발/검증 후 DNS 전환 예정
- **Supabase DB는 동일하게 공유** — 두 앱이 같은 테이블에 접근, 데이터 손실 없음

---

## 2. 개발 환경 정보

### 환경 A — 회사 (Windows)
- **OS**: Windows
- **Shell**: PowerShell (x86) — 관리자 권한으로 실행
- **작업 경로**: `D:\workspace\claude\New-Treasury`
- **Node.js**: v24.15.0 / **pnpm**: v11.4.0 / **Git**: v2.54.0
- **PowerShell 실행 정책**: `Set-ExecutionPolicy RemoteSigned` 이미 적용됨

### 환경 B — 집 (Mac)
- **작업 경로**: `~/workspace/New-Treasury` (또는 원하는 위치)
- **필요 설치**: Node.js v22+, pnpm, Git
- **설정 방법**: 아래 섹션 15 참조

### GitHub 저장소 (공통)
- **레포**: `https://github.com/Selvas-AI/New-Treasury` (Private)
- **GitHub Pages**: Source = GitHub Actions, Visibility = Private
- **브랜치 전략**: `main` 단일 브랜치 (추후 필요 시 feature 브랜치 도입)

---

## 3. 기술 스택

```
프레임워크:     Vite 8.0.14 + React 19 + TypeScript
라우팅:         react-router-dom ✅ (Step 8 완료)
상태관리:       Zustand (설치됨, Step 10 이후 적용 예정)
DB 연동:        @supabase/supabase-js ✅ (Step 7 완료)
스타일:         Tailwind CSS v4 (@tailwindcss/vite 플러그인)
차트:           Recharts (설치됨, Step 10에서 적용)
아이콘:         @tabler/icons-react (설치됨, 현재 이모지 사용)
테스트:         Vitest + @testing-library/react (24 tests passing ✅)
E2E:            @playwright/test (설치됨, 미설정)
린트:           ESLint + typescript-eslint
CI/CD:          GitHub Actions → GitHub Pages 자동 배포
```

---

## 4. 현재 파일 구조 (Step 9 완료 기준)

```
D:\workspace\claude\New-Treasury\
├── .claude\
│   └── launch.json             ← Preview 도구용 dev server (port 5175)
├── .github\
│   └── workflows\
│       └── ci.yml              ← lint → test → build → deploy
├── docs\
│   ├── SELVAS_TREASURY_CONTEXT.md        ← 기존 HTML 시스템 컨텍스트
│   ├── SELVAS_TREASURY_REACT_CONTEXT.md  ← 이 문서
│   └── ROUTING_DEEPLINK_SPEC.md          ← 딥링크 라우팅 설계 명세
├── src\
│   ├── components\
│   │   ├── Layout.tsx          ← Sidebar + TopBar + Outlet
│   │   ├── Sidebar.tsx         ← 접기/펼치기, master 관리 섹션
│   │   └── TopBar.tsx          ← 모바일 햄버거, 법인 선택, 로그아웃
│   ├── contexts\
│   │   └── auth.ts             ← AuthContext + AuthContextValue
│   ├── hooks\
│   │   ├── useAuth.ts          ← 인증 훅
│   │   ├── useDaily.ts         ← 운전자금 CRUD ✅
│   │   ├── useLoans.ts         ← 차입금 CRUD ✅
│   │   ├── useInvestments.ts   ← 운용자금/국채 ✅
│   │   ├── useEquities.ts      ← 지분투자 ✅
│   │   ├── useIssues.ts        ← 이슈 코멘트 ✅
│   │   └── useFx.ts            ← 환율 GAS API ✅
│   ├── lib\
│   │   ├── format.ts           ← 유틸 함수 전체 ✅
│   │   ├── format.test.ts      ← Vitest 24개 ✅
│   │   └── supabase.ts         ← Supabase 클라이언트
│   ├── pages\
│   │   ├── DashboardPage.tsx   ← 임시 (Step 10에서 구현)
│   │   ├── LoginPage.tsx       ← 로그인 폼 ✅
│   │   └── PlaceholderPage.tsx ← 미구현 페이지 공통
│   ├── types\
│   │   └── index.ts            ← 전체 타입 정의 ✅
│   ├── App.tsx                 ← BrowserRouter + 딥링크 라우팅
│   ├── index.css
│   └── main.tsx
├── .env.local                  ← 환경변수 (gitignore)
├── eslint.config.js
├── vite.config.ts              ← port: 5175 고정
└── package.json
```

---

## 5. 환경변수 (.env.local)

```env
VITE_SUPABASE_URL=https://qobfmihxcclbzfaohnor.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvYmZtaWh4Y2NsYnpmYW9obm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQ1ODEsImV4cCI6MjA5MTczMDU4MX0.9Bh5drygpl-cNEsdXQM6dS9RYo8_mjy2bI4G7jUoN2I
VITE_GAS_API_URL=<GAS Web App URL 입력 필요>
```

**주의**: `.env.local`은 `.gitignore`에 포함 → **각 환경에서 직접 생성 필요**
CI 빌드용 GitHub Secrets 등록도 별도 필요 (섹션 12 참조)

---

## 6. 완료된 단계 요약

| Step | 내용 | 상태 |
|------|------|------|
| 1~3 | Node.js, pnpm, 패키지 설치 | ✅ |
| 4 | Tailwind + 폴더 구조 + 환경변수 | ✅ |
| 5 | Vitest 단위 테스트 (9→24개) | ✅ |
| 6 | GitHub Actions CI/CD | ✅ |
| 7 | Supabase 연결 + AuthContext 인증 레이어 | ✅ |
| 8 | React Router + Layout/Sidebar/TopBar | ✅ |
| 8+ | 사이드바 접기/모바일 대응 + 딥링크 라우팅 | ✅ |
| 9 | 데이터 훅 6종 + 유틸 함수 확장 | ✅ |
| 10 | 통합 상황판 (KPI/워터폴/이슈/차트/지분) | ✅ |
| 11 | 운전자금 입력 (fx 자동환산, upsert) | ✅ |
| 12 | 운용자금 (D-day, 만기 처리, 취득가액) | ✅ |
| 13 | 차입금 (D-day 배지, 상환 처리) | ✅ |
| 14 | 지분/장기투자 + 국채 (히스토리 패널, GAS 시세 조회) | ✅ |
| 15 | 자금 변동 이력 (표/차트 전환, 전일 대비) | ✅ |
| 16 | 이슈 이력 (코멘트 스레드 CRUD, 상태 필터) | ✅ |
| 17 | 환율 현황 (환산 계산기, 외화 잔고 비중) | ✅ |
| 18 | 관리 페이지 (코드변경/사용자/데이터 집계) | ✅ |
| UI+ | 대시보드 차트 버그 수정 + 레이아웃 재설계 | ✅ |
| UI++ | Updateplan_260604 대시보드 개편 (2026-06-04) | ✅ |

---

## 7. 레이아웃 설계 결정사항

### 사이드바
- **PC**: `w-56` ↔ `w-14` 토글, `localStorage('sidebar_collapsed')` 유지
- **모바일**: 슬라이드인 드로어 + 오버레이 배경
- **아이콘**: 현재 이모지 — 추후 Tabler Icons 교체 가능 (Sidebar.tsx만 수정)

### 반응형
- `md` (768px) 기준으로 PC/모바일 분기
- PC 전용 관리 시스템이지만 모바일도 기본 지원

---

## 8. 딥링크 라우팅 (외부 연동 대응)

> **전체 설계 명세**: `docs/ROUTING_DEEPLINK_SPEC.md` 참조

### URL 패턴 요약
```
/dashboard/:company?
/input/:company?/:date?
/invest/:company?/:id?
/loans/:company?/:id?
/equity/:company?/:name?
/bonds/:company?/:isin?
/history/:company?/:from?/:to?
/issue-history/:issueKey?
/fx/:currency?
```

---

## 9. 데이터 훅 API 레퍼런스

### useDaily
```typescript
const { data, loading, error, refetch, upsert, remove } = useDaily()
// upsert(record)  — date+company 기준 upsert
// remove(id)      — 삭제
```

### useLoans
```typescript
const { data, loading, save, remove, setActive } = useLoans(activeOnly?)
// save(record)          — insert or update
// setActive(id, bool)   — 활성/만기 처리
```

### useInvestments
```typescript
const { data, bonds, nonBonds, save, remove, setActive, updateAcquisitionCost } = useInvestments(activeOnly?)
// bonds      — product='국채' 필터
// nonBonds   — 비국채
// updateAcquisitionCost(ids[], cost)  — 일괄 취득가액 반영
```

### useEquities
```typescript
const { data, latest, historyOf, save, remove, updateAcquisitionCost } = useEquities()
// latest          — 종목별 최신 1건
// historyOf(name) — 특정 종목 전체 이력
// updateAcquisitionCost(name, cost)  — 동일 종목 전체 이력 일괄 반영
```

### useIssues
```typescript
const { data, threadOf, openCount, addComment, updateStatus, updateComment, remove } = useIssues()
// threadOf(issueKey)           — 특정 이슈 코멘트 스레드
// openCount                    — 미완료 이슈 수 (배지용)
// updateStatus(id, status)     — 상태 변경 (open/review/done)
```

### useFx
```typescript
const { rates, loading, fetchRates, toKRW } = useFx()
// fetchRates()           — GAS API 환율 조회
// toKRW(amount, 'USD')   — 외화 → 원화 환산
```

---

## 10. format.ts 유틸 함수 전체 목록

```typescript
// 포맷
fmtKRW(n)                        // 억/만 단위 (예: 1.5억원)
fmtNumber(n, digits?)            // 3자리 콤마
fmtDateShort(d)                  // YYYY-MM-DD → M월 D일
fmtReturn(ret)                   // +2.30% / -1.50%

// 날짜
normDate(d)                      // YYYYMMDD → YYYY-MM-DD
calcDday(maturity)               // 만기까지 D-day

// 수익률
calcReturn(evalAmt, acqCost)     // 수익률(%) — 취득가 0이면 null
returnBadgeClass(ret)            // Tailwind 색상 클래스 (상승=빨강, 하락=파랑)

// 환율
calcKRW(amount, code, rates)     // 외화 → 원화

// 영업일
isBusinessDay(date?)             // 주말+2026공휴일 제외

// 국채
calcBondValue(qty, price)        // 좌수 × (기준가÷10)

// 이슈
makeIssueKey(type, id?)          // loan_{uuid} | equity_{name} | input_daily
```

---

## 11. 다음 진행할 작업 (선택적)

### 전체 18 Step 완료 — 남은 선택 작업

| 항목 | 설명 | 우선순위 |
|------|------|---------|
| GitHub Secrets 등록 | CI 빌드용 환경변수 3개 | 높음 |
| GAS URL 설정 | `.env.local`의 `VITE_GAS_API_URL` 입력 | 높음 |
| DNS 전환 | 검증 완료 후 `treasury.selvas.com` → React 앱 | 중간 |
| UI 폴리싱 | 대시보드 카드 재배치, Tabler Icons 교체 | 낮음 |
| E2E 테스트 | Playwright 설정 | 낮음 |
| Phase 2 | 자금정책 준수 상황판 | 계획 |

### 아키텍처 검증 (2026-06-01 확인 완료)
```
기존 HTML (treasury.selvas.com) ──write──▶ Supabase DB ◀──read── React (New-Treasury)
```
- **병렬 구조 정상 동작**: HTML 사이트에서 입력한 데이터가 React 앱에서 즉시 조회됨
- 셀바스에이아이: 운전자금 35건, 지분 102건 등 실데이터 확인
- 두 앱이 완전히 동일한 테이블을 공유 (데이터 손실 없음)

---

## 12. CI/CD 관련 주의사항

### GitHub Secrets 등록 필요 (아직 미완료)
`Selvas-AI/New-Treasury` → Settings → Secrets and variables → Actions:

| Secret 이름 | 값 |
|-------------|---|
| `VITE_SUPABASE_URL` | `https://qobfmihxcclbzfaohnor.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` (전체 키) |
| `VITE_GAS_API_URL` | GAS Web App URL |

`ci.yml` Build 단계에 env 블록 추가 필요:
```yaml
      - name: Build
        run: pnpm build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_GAS_API_URL: ${{ secrets.VITE_GAS_API_URL }}
```

---

## 13. 트러블슈팅 이력

| # | 오류 | 원인 | 해결 |
|---|------|------|------|
| 1 | `PSSecurityException` | PowerShell 스크립트 실행 차단 | `Set-ExecutionPolicy RemoteSigned` |
| 2 | CI `No event triggers in 'on'` | YAML `on` 예약어 | `"on":` 따옴표 추가 |
| 3 | CI `pnpm requires Node.js v22.13` | CI Node 버전 20 | `node-version: 22` |
| 4 | CI `isBusinessDay defined but never used` | ESLint unused-vars | `@typescript-eslint/no-unused-vars: warn` |
| 5 | CI `No overload matches this call` | `vite/defineConfig`에 test 타입 없음 | `vitest/config`의 `defineConfig` 사용 |
| 6 | Preview 빈 화면 | dev server 포트 불일치 (5173 vs 5175) | `vite.config.ts`에 `server: { port: 5175 }` 고정 |
| 7 | ESLint `set-state-in-effect` error | useEffect 내 async setState | `warn`으로 다운그레이드 (비동기 fetch 표준 패턴) |
| 8 | ESLint `only-export-components` | AuthContext + useAuth 같은 파일 | auth.ts / AuthContext.tsx / hooks/useAuth.ts 분리 |

---

## 13-1. 문서 구조 (2026-06-01 추가)

전체 컴포넌트·페이지·훅별 상세 문서가 `docs/` 폴더에 정리되어 있습니다.

```
docs/
├── INDEX.md                          ← 전체 문서 인덱스 (변경 포인트 빠른 참조)
├── SELVAS_TREASURY_CONTEXT.md        ← 기존 HTML 시스템
├── SELVAS_TREASURY_REACT_CONTEXT.md  ← 이 문서
├── ROUTING_DEEPLINK_SPEC.md          ← URL 딥링크 명세
├── components/
│   ├── dashboard/   ← KpiCard / WaterfallCard / IssueCard / CashflowChart / EquityCard
│   ├── equity/      ← EquityHistoryPanel / BondHistoryPanel
│   └── layout/      ← Layout / Sidebar / TopBar
├── pages/
│   ├── DashboardPage / InputPage / InvestPage / LoansPage
│   ├── EquityPage / HistoryPage / IssueHistoryPage / FxPage
│   └── admin/ (MyCodePage / UsersPage / DataPage)
└── hooks/
    └── README.md    ← 전체 훅 API 레퍼런스
```

> **빠른 참조**: `docs/INDEX.md`의 "주요 변경 포인트" 표 활용

---

## 14. 세션 시작 체크리스트 (공통)

```bash
# 1. 레포 최신화
cd <작업경로>/New-Treasury
git pull

# 2. 의존성 확인 (처음이거나 package.json 변경 시)
pnpm install

# 3. 테스트 상태 확인
pnpm vitest run
# → 24 passed ✅

# 4. 개발 서버 실행
pnpm dev
# → http://localhost:5175/New-Treasury/

# 5. 로그인 테스트 (브라우저)
# 잘못된 코드 입력 → "접근 코드가 올바르지 않습니다." 확인
# → Supabase 연결 정상 확인

# ※ 모든 페이지 구현 완료 상태 — UI 개선/버그 수정 위주로 진행
```

---

## 15. 멀티 환경 개발 가이드 (Windows ↔ Mac)

> 상세 방안은 별도 섹션에 정리됨 — 핵심만 요약

### 필수 원칙
1. **작업 전 반드시 `git pull`** — 마지막 환경의 커밋 동기화
2. **작업 후 반드시 `git push`** — 다음 환경에서 이어받기 위해
3. **`.env.local`은 각 환경에 별도 생성** — Git에 올라가지 않음

### Mac 초기 설정 (한 번만)
```bash
# 1. Homebrew로 Node.js 설치
brew install node@22
brew install pnpm

# 2. 레포 클론
git clone https://github.com/Selvas-AI/New-Treasury.git ~/workspace/New-Treasury
cd ~/workspace/New-Treasury

# 3. 의존성 설치
pnpm install

# 4. .env.local 생성
cat > .env.local << 'EOF'
VITE_SUPABASE_URL=https://qobfmihxcclbzfaohnor.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvYmZtaWh4Y2NsYnpmYW9obm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQ1ODEsImV4cCI6MjA5MTczMDU4MX0.9Bh5drygpl-cNEsdXQM6dS9RYo8_mjy2bI4G7jUoN2I
VITE_GAS_API_URL=<GAS URL>
EOF

# 5. 정상 확인
pnpm vitest run && pnpm dev
```
