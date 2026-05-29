# Selvas Treasury — React 신규 구축 컨텍스트
> 작성 기준: 2026-05-29 | 기존 HTML 운영 병행 + React 신규 구축 세션
> 이 문서는 새로운 Claude 세션(PowerShell CLI 환경)에서 맥락을 이어받기 위한 핸드오버 문서입니다.
> 기존 HTML 시스템 전체 컨텍스트는 `SELVAS_TREASURY_CONTEXT.md` 를 함께 참조하세요.

---

## 1. 프로젝트 전환 배경

### 왜 React로 전환하는가
- 기존 `index.html` 단일 파일이 ~10,900줄까지 증가
- 전역 변수, DOM 직접 조작, 함수 간 암묵적 의존으로 유지보수 한계 도달
- Phase 2(자금정책 상황판), Phase 3(자금일보+결재), Phase 4(자금수지) 확장 대비
- 바이브코딩 환경에서 컴포넌트 단위 개발로 전환하여 개발 효율 향상

### 전환 전략 — 병렬 운영
- 기존 `treasury` (HTML) → `treasury.selvas.com` 에서 계속 운영 중
- 신규 `New-Treasury` (React) → 별도 URL에서 개발/검증 후 DNS 전환 예정
- **Supabase DB는 동일하게 공유** — 두 앱이 같은 테이블에 접근, 데이터 손실 없음

---

## 2. 개발 환경 정보

### 로컬 환경
- **OS**: Windows
- **Shell**: PowerShell (x86) — 관리자 권한으로 실행
- **작업 경로**: `D:\workspace\claude\New-Treasury`
- **Node.js**: v24.15.0
- **npm**: v11.12.1
- **pnpm**: v11.4.0 (패키지 매니저)
- **Git**: v2.54.0

### PowerShell 실행 정책
- `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` 이미 적용됨

### GitHub 저장소
- **조직**: `Selvas-AI` (회사 GitHub 조직)
- **레포**: `https://github.com/Selvas-AI/New-Treasury`
- **Visibility**: Private (허용된 멤버만 접근)
- **GitHub Pages**: Source = GitHub Actions, Visibility = Private

---

## 3. 기술 스택

```
프레임워크:     Vite 8.0.14 + React 19 + TypeScript
라우팅:         react-router-dom (적용 완료 — Step 8)
상태관리:       Zustand (설치됨, 아직 미적용)
DB 연동:        @supabase/supabase-js (Step 7 완료)
스타일:         Tailwind CSS v4 (@tailwindcss/vite 플러그인)
차트:           Recharts (설치됨, Step 10에서 적용)
아이콘:         @tabler/icons-react (설치됨, 아직 이모지 사용 중)
테스트:         Vitest + @testing-library/react + @testing-library/jest-dom
E2E:            @playwright/test (설치됨, 아직 미설정)
린트:           ESLint + typescript-eslint
CI/CD:          GitHub Actions → GitHub Pages 자동 배포
```

---

## 4. 현재 파일 구조 (Step 8 완료 기준)

```
D:\workspace\claude\New-Treasury\
├── .claude\
│   └── launch.json             ← Preview 도구용 dev server 설정 (port 5175)
├── .github\
│   └── workflows\
│       └── ci.yml              ← CI/CD 파이프라인
├── docs\
│   ├── SELVAS_TREASURY_CONTEXT.md        ← 기존 HTML 시스템 전체 컨텍스트
│   ├── SELVAS_TREASURY_REACT_CONTEXT.md  ← 이 문서
│   └── ROUTING_DEEPLINK_SPEC.md          ← 딥링크 라우팅 설계 명세
├── src\
│   ├── components\
│   │   ├── Layout.tsx          ← Sidebar + TopBar + Outlet (접기/모바일 지원)
│   │   ├── Sidebar.tsx         ← 다크 사이드바 (collapsed 모드 / master 관리 섹션)
│   │   └── TopBar.tsx          ← 법인 선택 + 사용자 정보 + 로그아웃 + 햄버거
│   ├── contexts\
│   │   └── auth.ts             ← AuthContext 객체 + AuthContextValue 인터페이스
│   ├── hooks\
│   │   └── useAuth.ts          ← useAuth() 훅
│   ├── lib\
│   │   ├── format.ts           ← 유틸 함수 (완료)
│   │   ├── format.test.ts      ← Vitest 테스트 9개
│   │   └── supabase.ts         ← Supabase 클라이언트 싱글톤
│   ├── pages\
│   │   ├── DashboardPage.tsx   ← 통합 상황판 (URL 파라미터로 법인 자동 전환)
│   │   ├── LoginPage.tsx       ← 로그인 폼
│   │   └── PlaceholderPage.tsx ← 미구현 페이지 공통 플레이스홀더
│   ├── test\
│   │   └── setup.ts
│   ├── types\
│   │   └── index.ts            ← TreasuryUser, UserRole, Company 타입
│   ├── App.tsx                 ← BrowserRouter + 전체 라우팅 선언
│   ├── index.css               ← @import "tailwindcss"
│   └── main.tsx
├── .env.local                  ← 환경변수 (gitignore)
├── eslint.config.js
├── vite.config.ts              ← port: 5175 고정
├── package.json
└── pnpm-lock.yaml
```

---

## 5. 환경변수 (.env.local)

```env
VITE_SUPABASE_URL=https://qobfmihxcclbzfaohnor.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFvYmZtaWh4Y2NsYnpmYW9obm9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTQ1ODEsImV4cCI6MjA5MTczMDU4MX0.9Bh5drygpl-cNEsdXQM6dS9RYo8_mjy2bI4G7jUoN2I
VITE_GAS_API_URL=<기존 GAS Web App URL 입력 필요>
```

**주의**: `.env.local`은 `.gitignore`에 포함 → GitHub Secrets에 별도 등록 필요 (아직 미등록).

---

## 6. 완료된 단계

### Step 1~6 — 환경/초기화/패키지/Tailwind/Vitest/CI ✅
(상세 내용은 이전 버전 문서 또는 git log 참조)

### Step 7 — Supabase 연결 + 인증 레이어 ✅
- `src/lib/supabase.ts`: Supabase 클라이언트
- `src/types/index.ts`: TreasuryUser, UserRole, Company 타입
- `src/contexts/auth.ts`: AuthContext (컴포넌트 분리 — lint fast-refresh 규칙)
- `src/contexts/AuthContext.tsx`: AuthProvider (useMemo로 currentCompany 파생)
- `src/hooks/useAuth.ts`: useAuth() 훅
- `src/pages/LoginPage.tsx`: 로그인 폼 → access_codes 조회 → sessionStorage 저장

### Step 8 — React Router + 레이아웃 ✅
- `src/components/Sidebar.tsx`: 접기/펼치기(localStorage 유지), master 관리 섹션
- `src/components/TopBar.tsx`: 모바일 햄버거, 법인 선택, 사용자/로그아웃
- `src/components/Layout.tsx`: 모바일 오버레이 드로어 + PC 접기
- `src/App.tsx`: 전체 라우팅 (딥링크 파라미터 포함)
- `src/pages/DashboardPage.tsx`: URL `:company` 파라미터로 법인 자동 전환

---

## 7. 레이아웃 설계 결정사항

### 사이드바
- **PC**: `w-56` ↔ `w-14` 토글 (접기 버튼 `‹/›`)
- **접기 상태 유지**: `localStorage('sidebar_collapsed')` — 새로고침 후에도 복원
- **collapsed 모드**: 아이콘만 표시, hover 시 `title` 툴팁
- **모바일**: 기본 숨김(`-translate-x-full`), 햄버거 클릭 시 슬라이드인 드로어
- **모바일 오버레이**: 드로어 열릴 때 `bg-black/50` 오버레이, 클릭 시 닫힘
- **아이콘**: 현재 이모지 — 추후 Tabler Icons 교체 시 `Sidebar.tsx`만 수정

### TopBar
- 모바일(`md:hidden` 이하)에서만 햄버거 버튼 표시
- 사용자 이름: `sm:hidden` 이하에서 숨김 (role 뱃지만 표시)

---

## 8. 딥링크 라우팅 설계 (외부 연동 대응)

> **전체 설계 명세는 `docs/ROUTING_DEEPLINK_SPEC.md` 참조**

### 설계 원칙
외부 시스템(사내 포털, 메일 알림, 다른 서비스)이 특정 법인·종목·차입건의 URL을 직접 링크할 수 있도록 **모든 데이터 페이지가 딥링크를 지원**합니다.

### URL 패턴 (파라미터는 모두 선택적)
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

### 법인 파라미터 동작 규칙
- `master`/`ceo` 역할: URL 파라미터 `:company` 유효 시 → `setCurrentCompany()` 자동 호출
- `company` 역할: URL 파라미터 무시 (자사 법인만 접근 가능)
- 유효하지 않은 법인명: 무시 (현재 선택 법인 유지)

---

## 9. 다음 진행할 단계

### Step 9 — 데이터 훅 (useSupabase)
```
src/hooks/
├── useDaily.ts       — 운전자금 조회/저장 (daily 테이블)
├── useInvestments.ts — 운용자금/국채 조회 (investments 테이블)
├── useLoans.ts       — 차입금 조회 (loans 테이블)
├── useEquities.ts    — 지분투자 조회 (equities 테이블)
├── useIssues.ts      — 이슈 코멘트 조회/저장 (issue_comments 테이블)
└── useFx.ts          — 환율 조회 (GAS API)
```

각 훅의 공통 패턴:
```typescript
function useLoans() {
  const { currentCompany, user } = useAuth()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // currentCompany 변경 시 재조회
    // company 역할: eq('company', user.company)
    // master/ceo: 전체 or currentCompany 기준
  }, [currentCompany])

  return { data, loading, refetch }
}
```

### Step 10 — 통합 상황판 페이지
- 워터폴 자금흐름 (운전자금 + 운용자금 - 차입금)
- KPI 카드 (가용자금 합계, 순현금 포지션, 불가용 자산)
- 이슈 확인 카드 (3종 자동 감지)
- 현금흐름 추이 차트 (Recharts — 7/30/90/365일)
- 지분/장기투자 카드 (수익률 배지 + 스파크라인)

### Step 11~18 — 나머지 페이지 순차 구축
```
Step 11: 운전자금 입력
Step 12: 운용자금
Step 13: 차입금
Step 14: 지분/장기투자 + 국채 (히스토리 패널 포함)
Step 15: 자금 변동 이력
Step 16: 이슈 이력
Step 17: 환율 현황
Step 18: 관리 페이지 (코드변경/사용자/데이터)
```

---

## 10. 기존 HTML에서 React로 이식할 핵심 로직

### 유틸 함수 (format.ts에 이미 이식됨)
- `fmtKRW` ✅
- `normDate` ✅
- `calcReturn` ✅
- `isBusinessDay` ✅

### 아직 이식 안 된 유틸 함수 (Step 9 전에 추가)
```typescript
// src/lib/format.ts 에 추가
calcKRW(amount, currency, fxRates)   // 외화 → 원화 환산
getLatestBonds(investments)          // 국채 종목별 최신 1건
getLatestInvestments(investments)    // 비국채 + 국채 최신 1건
makeIssueKey(type, id)               // 이슈 식별자 생성

// src/lib/constants.ts 로 분리
FX_CODES                             // ['USD', 'EUR', 'JPY', 'GBP', 'CNY']
KR_HOLIDAYS_2026                     // 공휴일 배열
```

---

## 11. CI/CD 관련 주의사항

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

## 12. 다음 세션 시작 체크리스트

```powershell
cd D:\workspace\claude\New-Treasury
git pull
pnpm dev
# → http://localhost:5175/New-Treasury/

pnpm vitest run
# → 9 passed 확인 후 Step 9 시작
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
| 6 | Preview 빈 화면 | dev server 포트 불일치(5173 vs 5175) | `vite.config.ts`에 `server: { port: 5175 }` 고정 |
| 7 | ESLint `set-state-in-effect` | useEffect 안에서 setState 호출 | useMemo로 currentCompany 파생 |
| 8 | ESLint `only-export-components` | AuthContext + useAuth 같은 파일 | auth.ts / AuthContext.tsx / hooks/useAuth.ts 3파일 분리 |
