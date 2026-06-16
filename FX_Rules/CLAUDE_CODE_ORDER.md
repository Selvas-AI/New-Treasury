# Claude Code 작업 오더 — 환 리스크 정책 페이지 통합

> 이 파일을 Claude Code 세션 시작 시 첨부하고 아래 프롬프트를 입력하세요.
> 함께 첨부할 파일: `docs/SELVAS_TREASURY_REACT_CONTEXT.md`, `fx-hedge-policy-v2.html`

---

## 📋 작업 오더 프롬프트 (복사해서 사용)

```
이 프로젝트는 Selvas AI Group의 Treasury 시스템 (New-Treasury) 입니다.
docs/SELVAS_TREASURY_REACT_CONTEXT.md 와 FX_HEDGE_POLICY_INTEGRATION_SPEC.md 를 먼저 읽어주세요.

오늘 작업 목표: "환 리스크 정책" 신규 페이지를 Treasury 시스템에 추가합니다.
UI/UX 레퍼런스는 fx-hedge-policy-v2.html 파일입니다 (브라우저에서 열어 확인 가능).

작업 전 먼저 다음을 파악해 주세요:
1. 현재 프로젝트에서 "총자금"을 어떻게 계산하고 있는지 (어떤 파일, 어떤 함수인지)
2. ECOS API 환율 데이터를 어떻게 가져오고 있는지 (기존 hook이나 함수 위치)
3. 외화 잔액(USD/EUR/JPY)을 Supabase에서 어떻게 조회하는지
4. 현재 라우터 설정 파일 위치
5. 현재 사이드바 메뉴 컴포넌트 위치

위 5가지를 확인한 뒤, FX_HEDGE_POLICY_INTEGRATION_SPEC.md의 Phase 1부터 순서대로 진행해 주세요.
각 Phase 완료 시 결과를 알려주고 다음 진행 여부를 확인해 주세요.
```

---

## ⚠️ 작업 시작 전 체크리스트

Claude Code에 아래 파일들이 있는지 확인:

- [ ] `docs/SELVAS_TREASURY_REACT_CONTEXT.md` — 기존 컨텍스트 핸드오버
- [ ] `docs/FX_HEDGE_POLICY_INTEGRATION_SPEC.md` — 이번 작업 명세서 (이 파일)
- [ ] `docs/fx-hedge-policy-v2.html` — UI 레퍼런스 (브라우저에서 미리 확인)

---

## 🔑 핵심 로직 요약 (Claude Code가 놓치면 안 되는 것)

### 이중 안전장치 공식
```typescript
// 한도 A: 리스크 기반 (기존 로직)
const limitA = (opProfit + intIncome) * riskAppetite / maxVolatility;

// 한도 B: 자금 규모 기반 (신규 추가)
const limitB = totalFund * maxFxRatio;

// 실효 한도
const effectiveLimit = Math.min(limitA, limitB);
```

### 슬라이더 fill 동기화 (반드시 구현)
```typescript
// CSS에 --fill 변수를 동기화해야 슬라이더 채움 막대가 정확히 표시됨
function syncSliderFill(el: HTMLInputElement) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

// Tailwind로 구현 시: 인라인 스타일로 width를 직접 제어하는 커스텀 슬라이더 컴포넌트 필요
```

### 신뢰도 z값 테이블
```typescript
const Z_TABLE = { 90: 1.282, 95: 1.645, 99: 2.326 } as const;
type ConfidenceLevel = keyof typeof Z_TABLE;
```

---

## 📐 슬라이더 범위 (기존 코드의 버그 수정 반영)

| 슬라이더 | min | max | step | 기본값 |
|---|---|---|---|---|
| 위험포션 | 10% | 100% | 5% | 50% |
| 최대 외화 보유 허용 비율 | 5% | 50% | 5% | 30% |

> 기존 v1에서 max=60%였던 것을 50%로 수정 (60%는 과도한 수준)

---

## 🗄️ Supabase 신규 테이블

```sql
-- Claude Code에서 Supabase MCP로 직접 실행 또는 마이그레이션 파일 생성
CREATE TABLE IF NOT EXISTS fx_policy_params (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT 'selvas_group',
  op_profit BIGINT NOT NULL,
  int_income BIGINT NOT NULL,
  risk_appetite DECIMAL(4,3) NOT NULL,
  max_fx_ratio DECIMAL(4,3) NOT NULL,
  confidence_level INTEGER NOT NULL DEFAULT 95,
  target_weight_usd DECIMAL(4,3) DEFAULT 0.8,
  target_weight_eur DECIMAL(4,3) DEFAULT 0.18,
  target_weight_jpy DECIMAL(4,3) DEFAULT 0.02,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);
```

---

## 🎨 디자인 원칙 (기존 사이트와 통일)

1. 기존 Treasury 사이트의 색상 토큰/Tailwind 설정을 그대로 사용
2. `fx-hedge-policy-v2.html`의 레이아웃 구조를 React 컴포넌트로 포팅
3. 기존 카드 컴포넌트, 배지 컴포넌트가 있다면 재사용
4. 없으면 html 파일 참고하여 새로 구현

---

## 📁 생성할 파일 목록

```
src/pages/FxPolicyPage.tsx
src/components/fx-policy/FxPolicySummaryBanner.tsx
src/components/fx-policy/LossToleranceCard.tsx
src/components/fx-policy/FundSizeCapCard.tsx
src/components/fx-policy/DualLimitVisualizer.tsx
src/components/fx-policy/CurrencyHoldingsCard.tsx
src/components/fx-policy/VolatilityCard.tsx
src/components/fx-policy/CompareTable.tsx
src/components/fx-policy/TradeRecommendCard.tsx
src/hooks/useFxHoldings.ts
src/hooks/useFxPolicyParams.ts
src/store/fxPolicyStore.ts
supabase/migrations/YYYYMMDD_create_fx_policy_params.sql
```

---

_이 파일은 2026-06-15에 claude.ai 대화에서 생성되었습니다._
