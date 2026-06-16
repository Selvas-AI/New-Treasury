# 환 리스크 정책 페이지 — Treasury 통합 개발 명세서

> 작성일: 2026-06-15  
> 대상 프로젝트: New-Treasury (Vite 8 + React 19 + TypeScript, Tailwind CSS v4, Supabase, Zustand)  
> 목적: 기존 엑셀 기반 외화보유비중 산출 로직을 개선하여 Treasury 시스템 신규 페이지로 통합

---

## 0. 이 문서를 읽기 전에

이 명세서는 Claude Code에서 바로 작업 오더로 사용할 수 있도록 작성되었습니다.  
`docs/SELVAS_TREASURY_REACT_CONTEXT.md` (기존 컨텍스트 핸드오버 파일)와 함께 참조하세요.

---

## 1. 신규 페이지 개요

| 항목 | 내용 |
|---|---|
| 페이지 경로 | `/fx-policy` |
| 컴포넌트 위치 | `src/pages/FxPolicyPage.tsx` |
| 사이드바 메뉴 | 자금관리 → 환 리스크 정책 |
| 권한 | 재무팀 이상 (기존 auth 구조 그대로 적용) |

---

## 2. 개선된 핵심 로직 — 이중 안전장치 (기존 대비 변경점)

### 2-1. 기존 로직의 문제
```
적정 외화보유한도 = 허용손실 ÷ 최대환율변동폭
```
→ 자금이 적은 회사(100억 미만)에서 보유 불가능한 규모의 한도가 산출되는 문제 발생

### 2-2. 개선된 이중 안전장치 로직
```typescript
// 한도 A: 리스크 허용 기반 (기존 공식)
const limitA = maxLoss / maxVolatility;
// maxLoss = (영업이익 + 이자수익) × 위험포션
// maxVolatility = 가중표준편차 × z값(신뢰도)

// 한도 B: 자금 규모 기반 (신규)
const limitB = totalFund × maxFxRatio;
// totalFund = 회사 총자금 (Supabase에서 실시간 조회)
// maxFxRatio = 최대 외화 보유 허용 비율 (경영진 설정값, 기본 30%)

// 실효 한도 = 두 값 중 작은 것
const effectiveLimit = Math.min(limitA, limitB);
```

### 2-3. 환율 변동폭 계산 (기존 유지 + 신뢰도 선택 추가)
```typescript
// 가중 표준편차 (통화별 보유비율로 가중)
const weightedSd = SD_USD × w_usd + SD_EUR × w_eur + SD_JPY × w_jpy;

// 신뢰도별 z값 (기존 고정 95% → 선택 가능으로 변경)
const Z_TABLE = { 90: 1.282, 95: 1.645, 99: 2.326 };

// 최대 환율 변동폭
const maxVolatility = weightedSd × Z_TABLE[selectedConfidence];
```

---

## 3. 데이터 소스 연동 명세

### 3-1. Supabase 연동 — 회사 총자금 및 외화 보유현황

**필요한 쿼리 (기존 테이블 구조 확인 후 적용)**

```typescript
// 회사 총자금 — 기존 대시보드에서 사용 중인 총자금 집계 쿼리 재사용
// (기존 코드에서 총자금을 어떻게 가져오는지 확인하여 동일 방식 사용)

// 외화 보유현황 — 통화별 잔액
const { data: fxHoldings } = await supabase
  .from('운용자금')  // ← 기존 테이블명으로 교체 필요
  .select('통화, 잔액_외화, 잔액_원화, 적용환율')
  .in('통화', ['USD', 'EUR', 'JPY'])
  .order('통화');

// 집계 방식: 기존 대시보드의 외화 집계 로직과 동일하게 맞출 것
```

> ⚠️ **개발 시 확인 필요**: 기존 코드에서 외화 잔액을 어떤 테이블/뷰에서 가져오는지 확인하고, 동일 소스를 사용할 것. 이중 집계 방지.

### 3-2. ECOS API 연동 — 환율 표준편차 (기존 로직 재사용)

**기존 구현 재사용 원칙**
- 현재 사이트에서 ECOS API로 지난 1년 환율 데이터를 가져오는 코드가 이미 있음
- 해당 로직을 **그대로 재사용**하되, 반환값에서 통화별 표준편차만 추출

```typescript
// 기존 ECOS 데이터 fetch 함수가 있다면 그것을 import하여 사용
// 없다면 아래 구조로 신규 구현

interface EcosFxData {
  date: string;
  usd: number;
  eur: number;
  jpy: number; // 100엔 기준
}

// 표준편차 계산 (일별 변동율 기준)
function calcDailyReturnStd(prices: number[]): number {
  const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;
  return Math.sqrt(variance);
}

// 연환산 (일별 → 연간): 영업일 기준 252일 승수 적용
// 현재 엑셀 로직은 이미 연간 기준이므로 raw 표준편차 사용 (252 승수 확인 필요)
```

> ⚠️ **개발 시 확인 필요**: 기존 ECOS fetch 코드가 일별 변동율 기준인지, 원자료 환율 기준인지 확인 후 표준편차 계산 방식 통일.

### 3-3. 정책 파라미터 저장 — Supabase

정책 파라미터는 DB에 저장하여 이력 관리:

```sql
-- 신규 테이블 생성
CREATE TABLE fx_policy_params (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'selvas_group',  -- 향후 다중 회사 확장 대비
  op_profit BIGINT NOT NULL,           -- 사업계획 영업이익
  int_income BIGINT NOT NULL,          -- 예상 이자수익
  risk_appetite DECIMAL(4,3) NOT NULL, -- 위험포션 (0.0 ~ 1.0)
  max_fx_ratio DECIMAL(4,3) NOT NULL,  -- 최대 외화보유 허용 비율 (0.0 ~ 1.0)
  confidence_level INTEGER NOT NULL DEFAULT 95, -- 신뢰도 (90/95/99)
  target_weight_usd DECIMAL(4,3),      -- USD 목표 보유 비중
  target_weight_eur DECIMAL(4,3),      -- EUR 목표 보유 비중
  target_weight_jpy DECIMAL(4,3),      -- JPY 목표 보유 비중
  created_by TEXT,                     -- 설정자
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true       -- 현재 적용 중인 정책
);

-- 최신 활성 정책 조회 뷰
CREATE VIEW fx_policy_current AS
SELECT * FROM fx_policy_params
WHERE is_active = true
ORDER BY created_at DESC
LIMIT 1;
```

---

## 4. 컴포넌트 구조

```
src/
├── pages/
│   └── FxPolicyPage.tsx              # 메인 페이지
├── components/
│   └── fx-policy/
│       ├── FxPolicySummaryBanner.tsx  # 상단 요약 4개 지표
│       ├── LossToleranceCard.tsx      # 손실 허용 기준 카드 (좌)
│       ├── FundSizeCapCard.tsx        # 자금 규모 안전장치 카드 (우)
│       ├── CurrencyHoldingsCard.tsx   # 통화별 현황 카드 (좌)
│       ├── VolatilityCard.tsx         # 환율 변동폭 설정 카드 (우)
│       ├── CompareTable.tsx           # TO-BE vs AS-IS 비교 테이블
│       ├── TradeRecommendCard.tsx     # 환전 추천 카드
│       └── DualLimitVisualizer.tsx    # 이중 안전장치 시각화 (핵심 UI)
├── hooks/
│   ├── useFxHoldings.ts              # Supabase 외화 보유현황
│   ├── useTotalFund.ts               # Supabase 총자금 (기존 훅 재사용)
│   ├── useEcosVolatility.ts          # ECOS API 표준편차 (기존 로직 재사용)
│   └── useFxPolicyParams.ts          # 정책 파라미터 CRUD
└── store/
    └── fxPolicyStore.ts              # Zustand 상태 (계산 파라미터)
```

---

## 5. Zustand 스토어 구조

```typescript
// src/store/fxPolicyStore.ts

interface FxPolicyState {
  // 입력 파라미터
  opProfit: number;           // 사업계획 영업이익
  intIncome: number;          // 예상 이자수익
  riskAppetite: number;       // 위험포션 (0~1)
  maxFxRatio: number;         // 최대 외화보유 허용 비율 (0~1)
  confidenceLevel: 90 | 95 | 99;
  targetWeights: { usd: number; eur: number; jpy: number };

  // 계산 결과 (derived, computed on change)
  limitA: number;             // 리스크 기반 한도
  limitB: number;             // 자금 규모 기반 한도
  effectiveLimit: number;     // 실효 한도 = MIN(A, B)
  maxVolatility: number;      // 최대 환율 변동폭

  // 액션
  setParam: (key: string, value: number | string) => void;
  setTargetWeight: (currency: 'usd' | 'eur' | 'jpy', value: number) => void;
  recalculate: () => void;
  savePolicy: () => Promise<void>;
}
```

---

## 6. UI/UX 핵심 구현 포인트

### 6-1. 슬라이더 버그 수정 (위험포션 / 최대외화보유비율)

**문제**: 슬라이더 게이지 위치와 % 표시값이 불일치  
**원인**: CSS `background` 그라디언트로 fill을 표현하지 않고 있어서 thumb 위치만 이동하고 채워진 느낌이 없음  
**해결**: 슬라이더 값 변경 시 CSS custom property로 fill 비율을 동기화

```typescript
// 슬라이더 fill 동기화 함수
function syncSliderFill(input: HTMLInputElement) {
  const min = parseFloat(input.min);
  const max = parseFloat(input.max);
  const val = parseFloat(input.value);
  const pct = ((val - min) / (max - min)) * 100;
  input.style.setProperty('--fill-pct', `${pct}%`);
}

// CSS
input[type="range"] {
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--fill-pct, 50%),
    var(--border) var(--fill-pct, 50%),
    var(--border) 100%
  );
}
```

### 6-2. 위험포션 슬라이더 범위 조정
- 현재: min=10, max=100, step=5
- 권장: min=10, max=100, step=5 (유지), **초기값 50% → fill이 정확히 중앙에 위치하도록 CSS 수정**

### 6-3. 최대 외화 보유 허용 비율 슬라이더 범위
- 현재: min=5, max=60, step=5
- 권장: min=5, max=50, step=5 (60% 상한은 과도하므로 50%로 조정)
- **라벨 위치**: 5% / 15% / 25% / 35% / 50% 로 균등 배치

### 6-4. 이중 한도 시각화 (DualLimitVisualizer)
```
[ 한도 A: 리스크 기반 ] vs [ 한도 B: 자금 규모 기반 ] → [ ✓ 실효 한도 (MIN) ]
```
- 더 작은 값의 박스를 초록색으로 자동 하이라이트
- 값이 바뀔 때마다 애니메이션으로 전환
- 아래 설명문이 자동으로 업데이트 (어떤 한도가 왜 선택됐는지)

---

## 7. 디자인 토큰 (기존 Treasury 스타일 시스템과 통일)

> ⚠️ 기존 Treasury 사이트의 색상/타이포그래피 토큰을 확인하여 이 페이지에 동일하게 적용할 것.  
> 아래는 프로토타입에서 사용한 기본값이며, 기존 디자인 시스템으로 교체 필요.

| 토큰 | 프로토타입 값 | 대체 |
|---|---|---|
| Accent | `#2563EB` | 기존 primary color |
| Success | `#059669` | 기존 success color |
| Warning | `#D97706` | 기존 warning color |
| Danger | `#DC2626` | 기존 danger color |
| Surface | `#FFFFFF` | 기존 card background |
| Border | `#E2E6EE` | 기존 border |

---

## 8. 개발 순서 (권장)

```
Phase 1 — 데이터 연동 (1~2일)
  1-1. 기존 총자금 집계 로직 파악 → useTotalFund 훅 재사용 or 래핑
  1-2. 기존 ECOS API 훅 파악 → useEcosVolatility로 표준편차 추출
  1-3. 외화 보유현황 Supabase 쿼리 → useFxHoldings 훅
  1-4. fx_policy_params 테이블 생성 → useFxPolicyParams 훅

Phase 2 — 계산 로직 구현 (0.5일)
  2-1. fxPolicyStore.ts — Zustand 스토어 + 이중 안전장치 계산식

Phase 3 — UI 구현 (2~3일)
  3-1. FxPolicySummaryBanner (요약 배너)
  3-2. LossToleranceCard (손실 허용 기준 — 슬라이더 fix 포함)
  3-3. FundSizeCapCard (자금 규모 안전장치 — DualLimitVisualizer 포함)
  3-4. CurrencyHoldingsCard (통화별 현황 — Supabase 연동)
  3-5. VolatilityCard (신뢰도 선택 + 변동폭 표시)
  3-6. CompareTable + TradeRecommendCard

Phase 4 — 정책 저장 & 이력 (0.5일)
  4-1. 파라미터 저장 버튼 → Supabase insert
  4-2. 이력 타임라인 (최근 5건)
```

---

## 9. 주의사항 및 확인 필요 항목

| # | 항목 | 확인 방법 |
|---|---|---|
| 1 | 총자금 집계 기준 | 기존 대시보드 코드에서 총자금 표시하는 컴포넌트 찾아서 동일 소스 사용 |
| 2 | ECOS API 표준편차 계산 | 기존 ECOS fetch 코드 확인 — 일별 변동율 기반인지 원자료 기반인지 |
| 3 | 외화 잔액 테이블명 | Supabase 콘솔에서 외화 관련 테이블 확인 |
| 4 | 디자인 시스템 토큰 | 기존 Tailwind config 또는 globals.css에서 CSS 변수 확인 |
| 5 | 라우터 등록 | 기존 라우팅 파일 (App.tsx 또는 router 설정)에 `/fx-policy` 추가 |
| 6 | 사이드바 메뉴 등록 | 기존 사이드바 컴포넌트에 '환 리스크 정책' 메뉴 항목 추가 |

---

## 10. 프로토타입 파일

`fx-hedge-policy.html` — 계산 로직, UI/UX 레이아웃 완성본  
이 파일을 브라우저에서 열어서 디자인 확인 후 React로 포팅할 것.
