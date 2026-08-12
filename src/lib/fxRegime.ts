/**
 * fxRegime.ts — 환율 국면 판정 엔진 (순수 함수, React 의존성 0)
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 2
 *
 * ⭐ 이 모듈은 실시간 판정과 백테스트가 **반드시 함께 사용**한다.
 *    시뮬레이터용 로직을 따로 만들면 "백테스트는 좋았는데 실전은 다르다"가 되고
 *    아무도 결과를 믿지 않게 된다. 어떤 경우에도 분기하지 말 것.
 *
 * ⚠ look-ahead 금지:
 *    모든 함수는 "배열의 마지막 원소가 판정 시점"이라고 가정한다.
 *    백테스트는 series.slice(0, i+1) 을 넘겨야 하며, 전체 배열을 넘기면 미래를 본다.
 *
 * ── 데이터 제약에 따른 지표 설계 변경 (중요) ──────────────────────────
 * 기획 근거 문서(Google Docs)는 ADX·ATR 을 요구하지만, 두 지표 모두 일중
 * 고가/저가(High/Low)가 필요하다. 우리 데이터 소스인 한국은행 ECOS 731Y001 은
 * **매매기준율 종가만** 제공하므로 계산이 불가능하다.
 * 고가/저가를 얻으려면 Yahoo 등 외부 소스를 추가해야 하는데, 이는 GAS 할당량
 * 사고(세션17차)의 재발 위험과 회계 기준(ECOS) 불일치를 동시에 불러온다.
 *
 * → 종가만으로 동일한 목적을 달성하는 확립된 대체 지표를 사용한다:
 *     ADX (추세 강도)  →  Efficiency Ratio (Kaufman, 0~100)
 *     ATR (변동성)     →  연환산 실현변동성 + 252일 Z-Score
 *   둘 다 종가 기반이며, "추세 강도"와 "변동성 레벨"이라는 원래 역할을 그대로 수행한다.
 */

// ══════════════════════════════════════════════════════════════════════
//  1. 기초 통계 유틸
// ══════════════════════════════════════════════════════════════════════

/** 단순이동평균 — 마지막 n개. 데이터 부족 시 null */
export function sma(values: number[], n: number): number | null {
  if (values.length < n || n <= 0) return null
  let s = 0
  for (let i = values.length - n; i < values.length; i++) s += values[i]
  return s / n
}

/** 표본표준편차 (n-1) — 마지막 n개 */
export function stdev(values: number[], n: number): number | null {
  if (values.length < n || n < 2) return null
  const win = values.slice(values.length - n)
  const mean = win.reduce((a, b) => a + b, 0) / n
  const varSum = win.reduce((a, b) => a + (b - mean) ** 2, 0)
  return Math.sqrt(varSum / (n - 1))
}

export interface Bollinger { mid: number; upper: number; lower: number; pctB: number }

/**
 * 볼린저 밴드 (SMA n ± k×σ)
 * pctB: 밴드 내 상대 위치 (0=하단, 0.5=중앙, 1=상단). 밴드 밖이면 0~1 벗어남.
 */
export function bollinger(values: number[], n = 20, k = 2): Bollinger | null {
  const mid = sma(values, n)
  const sd = stdev(values, n)
  if (mid == null || sd == null) return null
  const upper = mid + k * sd
  const lower = mid - k * sd
  const width = upper - lower
  const last = values[values.length - 1]
  return { mid, upper, lower, pctB: width === 0 ? 0.5 : (last - lower) / width }
}

/**
 * 지수이동평균 전 구간 반환 (마지막 원소가 최신 EMA)
 * 초기값은 첫 n개의 SMA — 첫 값을 그대로 쓰면 초반이 심하게 왜곡된다.
 */
export function emaSeries(values: number[], n: number): number[] {
  if (values.length < n || n <= 0) return []
  const k = 2 / (n + 1)
  const out: number[] = []
  let prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n
  out.push(prev)
  for (let i = n; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

/** EMA 최신값 */
export function ema(values: number[], n: number): number | null {
  const s = emaSeries(values, n)
  return s.length ? s[s.length - 1] : null
}

export interface Macd { macd: number; signal: number; histogram: number }

/** MACD (기본 12/26/9) */
export function macd(values: number[], fast = 12, slow = 26, signalN = 9): Macd | null {
  const fastS = emaSeries(values, fast)
  const slowS = emaSeries(values, slow)
  if (!fastS.length || !slowS.length) return null

  // 두 EMA는 시작 인덱스가 달라 뒤에서부터 길이를 맞춘다
  const len = Math.min(fastS.length, slowS.length)
  const diff: number[] = []
  for (let i = 0; i < len; i++) {
    diff.push(fastS[fastS.length - len + i] - slowS[slowS.length - len + i])
  }
  if (diff.length < signalN) return null

  const sigS = emaSeries(diff, signalN)
  if (!sigS.length) return null

  const m = diff[diff.length - 1]
  const sig = sigS[sigS.length - 1]
  return { macd: m, signal: sig, histogram: m - sig }
}

/**
 * Kaufman Efficiency Ratio × 100 — 추세 강도 (0~100), ADX 대체
 *
 * = |종가_t − 종가_{t−n}| / Σ|일별 변화| × 100
 *   100에 가까울수록 한 방향으로 곧게 이동(강한 추세),
 *   0에 가까울수록 같은 거리를 왕복(횡보).
 * ADX와 달리 종가만으로 계산되며, 방향이 아닌 강도만 측정한다는 성질은 동일하다.
 */
export function efficiencyRatio(values: number[], n = 20): number | null {
  if (values.length < n + 1) return null
  const win = values.slice(values.length - (n + 1))
  const direction = Math.abs(win[win.length - 1] - win[0])
  let volatility = 0
  for (let i = 1; i < win.length; i++) volatility += Math.abs(win[i] - win[i - 1])
  if (volatility === 0) return 0
  return (direction / volatility) * 100
}

/** 일별 로그수익률 */
export function logReturns(values: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0 && values[i] > 0) out.push(Math.log(values[i] / values[i - 1]))
  }
  return out
}

/** 연환산 실현변동성 — 최근 n일 로그수익률 표준편차 × √252 */
export function annualizedVol(values: number[], n = 20): number | null {
  const r = logReturns(values)
  const sd = stdev(r, n)
  return sd == null ? null : sd * Math.sqrt(252)
}

/**
 * 변동성 Z-Score — 최근 변동성이 과거 lookback 대비 어느 위치인가.
 * ATR 대체. > 1.5 면 통계적으로 유의한 고변동성 국면.
 */
export function volZScore(values: number[], volN = 20, lookback = 252): number | null {
  const r = logReturns(values)
  if (r.length < volN + lookback) return null

  // 롤링 변동성 시계열을 만들고, 그 분포에서 최신값의 Z를 구한다.
  //
  // ⚠ 누적합(prefix sum)으로 계산한다. 예전 구현은 매 시점마다 r.slice(0,i) 로
  //   배열을 복사해 stdev 를 다시 돌렸는데, 이는 O(n²) 복사라 백테스트에서 치명적이다
  //   (1,129일 × 226회 리밸런싱 × 6회 재계산 ≈ 수억 회 원소 복사).
  //   결과값은 기존과 동일하다.
  const n = r.length
  const ps  = new Float64Array(n + 1)
  const ps2 = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    ps[i + 1]  = ps[i]  + r[i]
    ps2[i + 1] = ps2[i] + r[i] * r[i]
  }
  const vols: number[] = []
  for (let end = volN; end <= n; end++) {
    const s  = ps[end]  - ps[end - volN]
    const s2 = ps2[end] - ps2[end - volN]
    const varr = (s2 - (s * s) / volN) / (volN - 1)
    vols.push(Math.sqrt(Math.max(0, varr)) * Math.sqrt(252))
  }
  if (vols.length < lookback) return null

  const win = vols.slice(vols.length - lookback)
  const mean = win.reduce((a, b) => a + b, 0) / win.length
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / (win.length - 1))
  if (sd === 0) return 0
  return (vols[vols.length - 1] - mean) / sd
}

/**
 * 1차원 스칼라 칼만 필터 (랜덤워크 모델)
 *
 * 근거 문서는 pykalman 을 전제하지만, 관측·상태가 모두 1차원이면 행렬 연산이
 * 필요 없어 아래 4줄로 끝난다. Python 백엔드를 세울 이유가 없다.
 *
 *   predict: x⁻ = x,  P⁻ = P + Q
 *   update:  K  = P⁻ / (P⁻ + R)
 *            x  = x⁻ + K(z − x⁻)
 *            P  = (1 − K)P⁻
 *
 * ⚠ q/r 는 **가격 수준에 종속된 분산 값**이라 그대로 옮겨 쓰면 안 된다.
 *   근거 문서 예시값(q=0.5, r=10)은 정상상태 이득 K≈0.20 → 약 4영업일 지연을 만든다.
 *   원/달러 1,400원대에서 일변동이 5~10원(분산 25~100)인데 q=0.5는 "환율이 거의
 *   안 움직인다"고 가정하는 셈이라 필터가 지나치게 뻣뻣해진다.
 *   (실측 2026-08-11: 종가 1,420.1 vs 평활 1,434.9 — 14.8원 지연.
 *    하락 국면에서 14.8원 늦게 반응하는 것은 매각 시기를 놓치는 실패 모드 그 자체다.)
 *   → 기본값을 q=2, r=10 (K≈0.36, 약 1.8영업일 지연)으로 조정.
 *   최종 값은 Phase 4 백테스트로 교정할 것 (DEFAULT_PROTOCOL 에서 주입 가능).
 *
 * @param q 전이(프로세스) 노이즈 — 클수록 관측을 빨리 따라감
 * @param r 관측 노이즈 — 클수록 강하게 평활
 */
export function kalmanSmooth(values: number[], q = 2, r = 10): number[] {
  if (!values.length) return []
  let x = values[0]
  let p = 1
  const out: number[] = []
  for (const z of values) {
    const pPred = p + q
    const k = pPred / (pPred + r)
    x = x + k * (z - x)
    p = (1 - k) * pPred
    out.push(x)
  }
  return out
}

// ══════════════════════════════════════════════════════════════════════
//  2. 국면 분류
// ══════════════════════════════════════════════════════════════════════

/** 추세 국면 ①~⑤ */
export type TrendCode = '1' | '2' | '3' | '4' | '5'
/** 변동성 레벨 */
export type VolCode = 'A' | 'B'
/** 결합 국면 코드 (예: '2-B') */
export type RegimeCode = `${TrendCode}-${VolCode}`

export const TREND_LABEL: Record<TrendCode, string> = {
  '1': '강한 상승',
  '2': '온건 상승',
  '3': '횡보',
  '4': '온건 하락',
  '5': '강한 하락',
}
export const VOL_LABEL: Record<VolCode, string> = {
  A: '고변동성',
  B: '저변동성',
}

export function regimeLabel(code: RegimeCode): string {
  const [t, v] = code.split('-') as [TrendCode, VolCode]
  return `${TREND_LABEL[t]} / ${VOL_LABEL[v]}`
}

/** 국면 판정 임계값 — 전부 정책 파라미터로 노출 가능 */
export interface RegimeThresholds {
  /** 강한 추세로 보는 Efficiency Ratio 하한 (ADX>30 대응) */
  strongTrendER: number
  /** 추세 존재로 보는 ER 하한 (ADX>20 대응). 미만이면 횡보 */
  weakTrendER: number
  /**
   * 추세로 인정할 최소 순변동폭 (20일간, 종가 대비 비율).
   *
   * ⚠ 이 게이트가 없으면 위험하다. ER 은 **스케일 불변**이라, 환율이 거의
   *   움직이지 않아도 미세한 단조 드리프트만 있으면 ER=100(완벽한 추세)이 나온다.
   *   실제로 사인파(횡보) 검증에서 '온건 상승'으로 오분류되는 것을 확인했다.
   *   → "얼마나 곧게 갔나(ER)" 와 "실제로 얼마나 갔나(순변동폭)" 를 모두 요구한다.
   *
   * 값 근거: 원/달러 일변동 σ ≈ 0.45% → 20영업일 랜덤워크 σ ≈ 0.45%×√20 ≈ 2%.
   *   즉 20일간 2% 미만의 이동은 방향이 있어 보여도 무작위 변동과 통계적으로 구분되지 않는다.
   *   보수적으로 1σ의 약 3/4 지점인 1.5% 를 채택.
   *   (초기값 0.5% 는 노이즈 한복판이라, ±0.57% 진폭의 순수 진동을 '온건 상승'으로 오분류했다.)
   */
  minTrendMovePct: number
  /** 고변동성으로 보는 변동성 Z-Score 하한 */
  highVolZ: number
}

export const DEFAULT_THRESHOLDS: RegimeThresholds = {
  strongTrendER:   45,
  weakTrendER:     25,
  minTrendMovePct: 0.015,   // 20일간 1.5% 미만 이동이면 방향과 무관하게 횡보 (≈ 20일 랜덤워크 1σ의 3/4)
  highVolZ:        1.0,
}

export interface RegimeIndicators {
  close:      number
  smoothed:   number
  sma20:      number | null
  bbUpper:    number | null
  bbLower:    number | null
  pctB:       number | null
  ema20:      number | null
  ema60:      number | null
  macdHist:   number | null
  trendER:    number | null
  /** 최근 20일 순변동폭 (부호 있음, 종가 대비 비율). 추세 크기 게이트용 */
  netMovePct: number | null
  annualVol:  number | null
  volZ:       number | null
}

/**
 * 지표 일괄 계산.
 * @param closes 종가 배열 (오름차순, 마지막이 판정 시점)
 */
export function computeIndicators(
  closes: number[],
  kalmanQ = 2,
  kalmanR = 10,
): RegimeIndicators | null {
  if (closes.length < 2) return null

  // ⚠ 평활가와 원시 종가를 용도별로 나눠 쓴다 — 섞으면 지표가 조용히 틀린다.
  //
  //   추세 지표(EMA·MACD·ER·순변동) → **평활가**
  //     일시적 스파이크로 국면이 흔들리는 것(웝소)을 막는 게 목적.
  //
  //   변동성·밴드 지표(볼린저·실현변동성·Z-Score) → **원시 종가**
  //     칼만 평활은 정의상 분산을 제거하므로, 평활가로 변동성을 재면 언제나 과소평가된다.
  //     (실측 2026-08-11: 평활가 기준 연환산 변동성 1.11% — 원/달러 실제는 통상 6~10%.
  //      그 결과 변동성 Z-Score 가 항상 음수로 나와 고/저변동성 축이 무력화됐다.)
  //
  // 화면에는 원시 종가(close)를 항상 병기한다 — 평활가만 보여주면
  // 실무자가 "내가 아는 환율과 다르다"며 신뢰를 잃는다.
  const smooth = kalmanSmooth(closes, kalmanQ, kalmanR)
  const bb = bollinger(closes, 20, 2)
  const m = macd(smooth)

  const last = smooth[smooth.length - 1]
  const netMovePct =
    smooth.length >= 21 && last !== 0
      ? (last - smooth[smooth.length - 21]) / Math.abs(last)
      : null

  return {
    close:     closes[closes.length - 1],
    smoothed:  smooth[smooth.length - 1],
    sma20:     bb?.mid ?? null,
    bbUpper:   bb?.upper ?? null,
    bbLower:   bb?.lower ?? null,
    pctB:      bb?.pctB ?? null,
    ema20:     ema(smooth, 20),
    ema60:     ema(smooth, 60),
    macdHist:  m?.histogram ?? null,
    trendER:   efficiencyRatio(smooth, 20),
    netMovePct,
    // 변동성은 반드시 원시 종가 기준 (위 주석 참조)
    annualVol: annualizedVol(closes, 20),
    volZ:      volZScore(closes, 20, 252),
  }
}

/** 지표 → 국면 코드 (히스테리시스 미적용 원시 판정) */
export function classifyRegime(
  ind: RegimeIndicators,
  th: RegimeThresholds = DEFAULT_THRESHOLDS,
): RegimeCode {
  const er = ind.trendER ?? 0
  const up =
    ind.ema20 != null && ind.ema60 != null
      ? ind.ema20 > ind.ema60
      : (ind.macdHist ?? 0) > 0
  const macdAgrees = ind.macdHist == null ? true : (up ? ind.macdHist > 0 : ind.macdHist < 0)

  // 크기 게이트: 실제 이동폭이 미미하면 ER 이 아무리 높아도 횡보로 본다.
  // netMovePct 를 못 구할 만큼 데이터가 짧으면 게이트를 통과시킨다(보수적 판단은 ER 이 담당).
  const moved =
    ind.netMovePct == null || Math.abs(ind.netMovePct) >= th.minTrendMovePct

  let trend: TrendCode
  if (er < th.weakTrendER || !moved) {
    trend = '3'                                   // 횡보
  } else if (er >= th.strongTrendER && macdAgrees) {
    trend = up ? '1' : '5'                        // 강한 추세 (EMA + MACD 동의)
  } else {
    trend = up ? '2' : '4'                        // 온건 추세
  }

  // volZ 계산에는 272일치가 필요하다. 데이터가 모자라면 null 이 오는데,
  // 이때 임의로 고변동성이라 단정하면 위험하므로 보수적으로 저변동성 처리한다.
  const vol: VolCode = (ind.volZ ?? 0) >= th.highVolZ ? 'A' : 'B'

  return `${trend}-${vol}`
}

/**
 * 히스테리시스 적용 — confirmDays 연속 동일 판정일 때만 국면 전환을 확정.
 *
 * ⭐ 이 규칙 하나가 웝소(whipsaw)로 인한 무의미한 매매 지시 남발을 막는다.
 *    근거 문서가 MSM 을 도입하는 주된 이유도 결국 이 문제이며,
 *    ER + 칼만 + 히스테리시스 조합으로 실질 목적은 달성된다.
 *
 * @param rawCodes 과거~현재 순서의 원시 판정 배열
 * @returns 확정 국면과 현재 판정이 며칠째 유지됐는지
 */
export function confirmRegime(
  rawCodes: RegimeCode[],
  confirmDays = 2,
): { code: RegimeCode; confirmedDays: number } {
  if (!rawCodes.length) return { code: '3-B', confirmedDays: 0 }

  const last = rawCodes[rawCodes.length - 1]
  let streak = 1
  for (let i = rawCodes.length - 2; i >= 0 && rawCodes[i] === last; i--) streak++

  if (streak >= confirmDays) return { code: last, confirmedDays: streak }

  // 아직 확정 전 — 직전에 확정돼 있던 국면을 유지한다
  for (let i = rawCodes.length - 1 - streak; i >= 0; i--) {
    const cand = rawCodes[i]
    let s = 1
    let j = i - 1
    while (j >= 0 && rawCodes[j] === cand) { s++; j-- }
    if (s >= confirmDays) return { code: cand, confirmedDays: streak }
    i = j + 1
  }
  return { code: last, confirmedDays: streak }
}

// ══════════════════════════════════════════════════════════════════════
//  2.5 수준(Level) 축 — "지금이 비싼가 싼가"
//
//  설계 근거: docs/기획/환율국면_레벨축_설계.md
//
//  ⭐ 왜 필요한가:
//    기존 축은 추세(방향)와 변동성뿐이라 "높은 수준인가"를 판단할 수 없었다.
//    그 결과 상승장(=고가)에 목표 비중을 올려 **고가 매도를 억제**하고,
//    하락장(=저가)에 목표를 내려 **저가 매도를 강제**하는 역효과가 있었다.
//    2026-07 사고 검증: 1,531원(연중 최고)에서 기존 로직은 ①강한상승 → 목표 45%
//    → "보유 유지"를 권고한다. 이는 실무진이 실제로 한 행동과 같아 사고를 재현한다.
//    Level 축은 같은 시점을 "앵커 대비 크게 높음 → 대량 환전"으로 판정한다.
// ══════════════════════════════════════════════════════════════════════

/** 횡보(박스권) 구간 — 앵커 후보 */
export interface ConsolidationZone {
  from:     string
  to:       string
  /** 이 구간 평균 환율 = 앵커 후보값 */
  mean:     number
  min:      number
  max:      number
  /** (max−min)/mean — 좁을수록 횡보 */
  rangePct: number
  /** Efficiency Ratio 0~100 — 낮을수록 제자리 왕복 */
  er:       number
  /** 종합 점수 (낮을수록 좋은 앵커). rangePct%×1 + ER/10 */
  score:    number
}

export interface ConsolidationOptions {
  /** 후보 탐색 범위 (영업일). 기본 750 ≈ 3년 */
  lookbackDays?: number
  /** 박스 판정 창 (영업일) */
  windowDays?:   number
  /** 반환할 후보 수 */
  topN?:         number
}

/**
 * "가장 좌우로 횡보했던 구간" 탐색.
 *
 * 정의: 밴드 폭이 좁고(rangePct) 시작점으로 되돌아온(er 낮음) 창.
 * `efficiencyRatio()` 를 그대로 재사용한다 — 순이동/총이동 비율이라
 * 정확히 "제자리 왕복 정도"를 재는 지표다. 신규 지표 개발 불필요.
 *
 * ⚠ 이 함수의 결과를 **자동으로 앵커에 적용하지 말 것.**
 *   데이터가 하루 늘 때마다 최적 구간이 바뀌면 앵커가 점프하고,
 *   목표 비중이 점프해 불필요한 매매가 발생한다.
 *   후보만 제시하고, 담당자가 선택해 policy_params 에 고정한다.
 */
export function findConsolidationZones(
  series: RegimeSeriesPoint[],
  opts: ConsolidationOptions = {},
): ConsolidationZone[] {
  const { lookbackDays = 750, windowDays = 60, topN = 3 } = opts
  if (series.length < windowDays + 1) return []

  const start = Math.max(0, series.length - lookbackDays)
  const cands: ConsolidationZone[] = []

  for (let i = start; i + windowDays <= series.length; i++) {
    const w = series.slice(i, i + windowDays)
    const vals = w.map(p => p.rate)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    if (mean <= 0) continue
    const er = efficiencyRatio(vals, vals.length - 1)
    if (er == null) continue
    const rangePct = (max - min) / mean
    cands.push({
      from: w[0].date, to: w[w.length - 1].date,
      mean, min, max, rangePct, er,
      // 종합 점수 — 폭(%)과 횡보의 질(ER)을 함께 본다.
      // ER 10점차 ≈ 폭 1%p 로 환산(er/10).
      score: rangePct * 100 + er / 10,
    })
  }

  // ⚠ 폭만으로 정렬하면 안 된다.
  //   실측(2026-08-11): 폭 2.80%/ER 15.5 인 후보(1,330.5)를 2순위로 올렸는데,
  //   백테스트에서 실현환율 프리미엄이 +19.9원으로 3개 중 최악이었다
  //   (폭 2.90%/ER 0.2 인 1,453.3 은 +46.8원). 폭이 좁아도 그 안에서 방향성이 있으면
  //   "합의된 가격대"가 아니라 완만한 추세 구간이라 앵커로 부적합하다.
  //   → 폭과 ER 을 함께 보는 종합 점수로 정렬한다.
  cands.sort((a, b) => a.score - b.score)

  // 겹침 제거 — 인접 창은 점수가 비슷해 상위권을 독점하므로 비최대 억제
  const picked: ConsolidationZone[] = []
  for (const c of cands) {
    if (picked.some(p => !(c.to < p.from || c.from > p.to))) continue
    picked.push(c)
    if (picked.length >= topN) break
  }
  return picked
}

/** 수준 등급 */
export type LevelGrade = 'VH' | 'H' | 'N' | 'L' | 'VL'

export const LEVEL_LABEL: Record<LevelGrade, string> = {
  VH: '매우 높음',
  H:  '높음',
  N:  '중립',
  L:  '낮음',
  VL: '매우 낮음',
}

/** 앵커 대비 편차(비율) 경계 */
export interface LevelThresholds {
  vh: number   // dev ≥ vh  → VH
  h:  number   // dev ≥ h   → H
  l:  number   // dev ≤ l   → L
  vl: number   // dev ≤ vl  → VL
}

/** 원/달러 연변동성 약 6% 기준으로 잡은 초기값 — 백테스트로 교정할 것 */
export const DEFAULT_LEVEL_THRESHOLDS: LevelThresholds = {
  vh:  0.08,
  h:   0.03,
  l:  -0.03,
  vl: -0.08,
}

/** 현재가와 앵커로 수준 등급 산출 */
export function classifyLevel(
  rate: number,
  anchor: number,
  th: LevelThresholds = DEFAULT_LEVEL_THRESHOLDS,
): { dev: number; grade: LevelGrade } {
  if (!(anchor > 0)) return { dev: 0, grade: 'N' }
  const dev = (rate - anchor) / anchor
  let grade: LevelGrade = 'N'
  if (dev >= th.vh)      grade = 'VH'
  else if (dev >= th.h)  grade = 'H'
  else if (dev <= th.vl) grade = 'VL'
  else if (dev <= th.l)  grade = 'L'
  return { dev, grade }
}

/** 추세 방향 그룹 — Level×Trend 매트릭스의 열 */
export type TrendGroup = 'up' | 'side' | 'down'

export function trendGroupOf(code: RegimeCode): TrendGroup {
  const t = code.charAt(0) as TrendCode
  if (t === '1' || t === '2') return 'up'
  if (t === '3') return 'side'
  return 'down'
}

// ══════════════════════════════════════════════════════════════════════
//  3. 정책 프로토콜 → 목표 보유 비율
// ══════════════════════════════════════════════════════════════════════

/**
 * 국면별 목표 외화 보유 비율 (0~1).
 *
 * ⚠ **메디아나는 외화 순수입(수출) 구조**다. 실측 근거(2026-04-14~08-07):
 *     · 운전자금 USD 6,810,645 → 9,230,660 (+2.42M)
 *     · 운용 외화 정기예금 1M → 6M (+5.0M)
 *     · 같은 기간 USD 매도 완료 4.0M
 *     → 4M 을 팔고도 보유가 7.4M 늘었으므로 기간 유입 ≈ 11.4M (월 약 3.0M).
 *     · fx_trade_history 12건이 전부 sell — **매수 이력 0건**.
 *
 *   따라서 근거 문서의 수출기업 전제가 그대로 적용된다.
 *   (과거 주석에 "외화 순지출 구조"라 적혀 있었으나 이는 근거 없는 오판이었다.
 *    '결제 예정액이 있다' = '순지출' 이 아니다.)
 *
 * ⚠ **범위 주의: 위 구조는 메디아나에만 확인됐다.**
 *   셀바스에이아이·셀바스헬스케어의 외화 수급 구조는 미확인이므로 3사 공통으로 일반화하지 말 것.
 *   법인 확대 시 각 법인의 매매 이력·잔고 추이로 먼저 검증할 것.
 *
 * ⚠ 더 중요한 구조적 한계:
 *   순수입 기업의 실제 의사결정은 "정적 자금 풀의 목표 비중"이 아니라
 *   **"매달 유입되는 외화를 언제 환전할 것인가(타이밍)"** 다.
 *   아래 목표 비율은 비중 관리용 근사이며, 상승 국면에서 비중을 늘리라는 신호는
 *   이 회사에서 '매수'가 아니라 '환전 지연(Lagging)'으로 해석해야 한다.
 *   비중 리밸런싱 모델로 백테스트하면 실제로는 하지 않을 매수 거래가 생성되어
 *   결과가 왜곡된다(fxBacktest.ts 상단 경고 참조).
 */
export type RegimeTargets = Record<RegimeCode, number>

export const DEFAULT_TARGETS: RegimeTargets = {
  '1-A': 0.45, '1-B': 0.42,   // 강한 상승 — 보유 유지(매도 지연)
  '2-A': 0.38, '2-B': 0.35,   // 온건 상승 — 점진 축소
  '3-A': 0.32, '3-B': 0.30,   // 횡보 — 정책 중립값
  '4-A': 0.25, '4-B': 0.22,   // 온건 하락 — 축소 개시
  '5-A': 0.18, '5-B': 0.12,   // 강한 하락 — 즉시 최대 매도 (A는 패닉셀 방지로 분할)
}

/**
 * ⭐ Level × Trend 목표 매트릭스 — 현행 기본 로직.
 *
 * **Level 이 방향을, Trend 가 속도를 정한다.**
 *   · Level(수준)  = 팔 것인가 (앵커 대비 비싼가/싼가)
 *   · Trend(추세)  = 언제·얼마나 빨리 (같은 수준 안에서의 타이밍)
 *
 * 값은 "목표 외화 보유 비중"이므로 **낮을수록 많이 환전**한다는 뜻이다.
 * 가장 강한 매도 신호 = VH(매우 높음) × down(하락 전환) → 2026-07 사고 상황이 여기 해당.
 * 낮은 수준에서는 하락 추세여도 매도를 강제하지 않는다(기존 저가 매도 강제 제거).
 */
export type LevelTargets = Record<LevelGrade, Record<TrendGroup, number>>

/**
 * 기본 매트릭스. 운용 범위 **15% ~ 42%** (중립 30% 기준 ±).
 *
 * ⚠ 폭을 더 좁히면 효과가 급격히 사라진다 — 실측(2026-08-11, 앵커 1,378):
 *   | 범위 | 2025~ 프리미엄 | 2026-07 프리미엄 |
 *   | 10~45% | +21.2원 | +52.9원 |
 *   | 15~42% | +19.5원 | +48.6원 |  ← 채택 (폭 23%↓, 효과 손실 8%)
 *   | 18~39% | +16.9원 | +40.8원 |
 *   | 22~36% | +13.2원 |  +9.6원 |
 *   | 24~34% | +10.6원 | **−46.0원** |  ← 기간평균보다 나쁨
 *   | 26~33% |  +8.5원 | 거래 0건 |     ← 시스템이 아무것도 안 함
 *   좁으면 목표와 현재의 차이가 리밸런싱 밴드를 넘지 못해 고점에서 충분히 팔지 못하고,
 *   남은 물량을 나중에 더 싸게 팔게 된다.
 *
 * 참고: 2025년 백테스트에서 실제 사용된 목표는 15~30% 구간이었다.
 *   상·하 극단값은 이론적 경계일 뿐 상시 도달하지 않는다.
 */
export const DEFAULT_LEVEL_TARGETS: LevelTargets = {
  //        상승      횡보      하락
  VH: { up: 0.22, side: 0.18, down: 0.15 },   // 매우 높음 — 적극 실현 (하락 전환 시 최대)
  H:  { up: 0.26, side: 0.24, down: 0.20 },   // 높음 — 실현
  N:  { up: 0.30, side: 0.30, down: 0.30 },   // 중립 — 정기 환전 유지
  L:  { up: 0.36, side: 0.34, down: 0.32 },   // 낮음 — 환전 최소화
  VL: { up: 0.42, side: 0.40, down: 0.38 },   // 매우 낮음 — 보유 (필수분만)
}

export interface PolicyProtocol {
  /** @deprecated Level 축 도입 전의 국면 단독 매핑. useLevelAxis=false 일 때만 사용 */
  targets:      RegimeTargets
  thresholds:   RegimeThresholds
  confirmDays:  number
  kalmanQ:      number
  kalmanR:      number
  /** 목표와 현재의 차이가 이 값(비율 포인트) 미만이면 거래하지 않음 — 잦은 소액매매 방지 */
  rebalanceBandPct: number

  // ── Level 축 ────────────────────────────────────────────────────────
  /**
   * true 이고 anchorRate 가 있으면 Level×Trend 매트릭스를 쓴다.
   * false 면 구 국면 단독 매핑(targets)으로 동작 — **백테스트 A/B 비교용으로 반드시 유지할 것.**
   * (7월 사고 재현 검증: 구 로직이 1,531원에서 '보유'를 권고하는지 확인해야 한다)
   */
  useLevelAxis:    boolean
  /** 기준 수준. 담당자가 findConsolidationZones 후보 중 선택해 고정한다. null=미설정 */
  anchorRate:      number | null
  levelThresholds: LevelThresholds
  levelTargets:    LevelTargets
  /**
   * 시간 기반 강제 환전 (영업일). 미환전 잔량이 이 기간 이상 방치되면
   * Level 이 낮아도 중립 수준까지는 환전한다.
   * ⚠ 이 장치가 없으면 "싸니까 안 판다"가 무한정 지속된다 —
   *   그게 2026-07 에 실무진이 한 판단이기도 하다. 0=비활성
   */
  forceConvertDays: number
}

/** 모든 국면 코드 (편집 UI·저장 순회용) */
export const ALL_REGIME_CODES: RegimeCode[] = [
  '1-A', '1-B', '2-A', '2-B', '3-A', '3-B', '4-A', '4-B', '5-A', '5-B',
]

/** policy_params 키 이름 — 국면별 목표 비율 */
export function targetParamKey(code: RegimeCode): string {
  return `fx_regime_target_${code.replace('-', '').toLowerCase()}`   // '2-B' → fx_regime_target_2b
}

/** policy_params 키 이름 — 국면 판정·리밸런싱 파라미터 */
export const PROTOCOL_PARAM_KEYS = {
  strongTrendER:    'fx_regime_strong_er',
  weakTrendER:      'fx_regime_weak_er',
  minTrendMovePct:  'fx_regime_min_move_pct',   // % 단위로 저장 (1.5 = 1.5%)
  highVolZ:         'fx_regime_high_vol_z',
  confirmDays:      'fx_regime_confirm_days',
  kalmanQ:          'fx_regime_kalman_q',
  kalmanR:          'fx_regime_kalman_r',
  rebalanceBandPct: 'fx_regime_rebalance_band', // % 단위로 저장 (3 = 3%p)
  // ── Level 축 ──
  useLevelAxis:     'fx_level_use',             // 1=사용 0=미사용
  anchorRate:       'fx_level_anchor_krw',      // 앵커 환율 (원)
  anchorSetAt:      'fx_level_anchor_set_at',   // 설정일 — param_text 에 저장(노후화 경보용)
  levelWindowDays:  'fx_level_window_days',     // 박스 판정 창
  levelLookbackDays:'fx_level_lookback_days',   // 후보 탐색 범위
  levelVhPct:       'fx_level_vh_pct',          // % 단위 (8 = +8%)
  levelHPct:        'fx_level_h_pct',
  levelLPct:        'fx_level_l_pct',           // % 단위 (-3 = −3%)
  levelVlPct:       'fx_level_vl_pct',
  forceConvertDays: 'fx_force_convert_days',
} as const

export const ALL_LEVEL_GRADES: LevelGrade[] = ['VH', 'H', 'N', 'L', 'VL']
export const ALL_TREND_GROUPS: TrendGroup[] = ['up', 'side', 'down']

/** policy_params 키 이름 — Level×Trend 목표 비율 (예: fx_level_target_vh_down) */
export function levelTargetParamKey(grade: LevelGrade, group: TrendGroup): string {
  return `fx_level_target_${grade.toLowerCase()}_${group}`
}

/**
 * policy_params 값에서 프로토콜을 조립한다. 값이 없으면 코드 기본값을 쓴다.
 *
 * ⚠ 비율은 DB 에 **% 단위**로 저장한다(0.03 이 아니라 3).
 *   기존 fx_target_min/max 가 % 로 저장돼 있어 관리 화면에서 단위가 섞이면 사고가 난다.
 *
 * @param get policy_params 조회 함수 (usePolicyParams().get)
 */
export function protocolFromParams(get: (key: string) => number | null): PolicyProtocol {
  const pick = (key: string, fallback: number) => {
    const v = get(key)
    return v == null || !Number.isFinite(v) ? fallback : v
  }

  const targets = { ...DEFAULT_TARGETS }
  for (const code of ALL_REGIME_CODES) {
    const v = get(targetParamKey(code))
    if (v != null && Number.isFinite(v)) targets[code] = v / 100
  }

  const levelTargets: LevelTargets = {
    VH: { ...DEFAULT_LEVEL_TARGETS.VH }, H: { ...DEFAULT_LEVEL_TARGETS.H },
    N:  { ...DEFAULT_LEVEL_TARGETS.N },  L: { ...DEFAULT_LEVEL_TARGETS.L },
    VL: { ...DEFAULT_LEVEL_TARGETS.VL },
  }
  for (const g of ALL_LEVEL_GRADES) {
    for (const tg of ALL_TREND_GROUPS) {
      const v = get(levelTargetParamKey(g, tg))
      if (v != null && Number.isFinite(v)) levelTargets[g][tg] = v / 100
    }
  }

  const anchor = get(PROTOCOL_PARAM_KEYS.anchorRate)

  return {
    targets,
    // 앵커가 없으면 Level 축을 켤 수 없다 — 기준점 없이 '높다/낮다'를 말할 수 없기 때문.
    useLevelAxis: anchor != null && anchor > 0 && pick(PROTOCOL_PARAM_KEYS.useLevelAxis, 1) !== 0,
    anchorRate:   anchor != null && anchor > 0 ? anchor : null,
    levelThresholds: {
      vh: pick(PROTOCOL_PARAM_KEYS.levelVhPct, DEFAULT_LEVEL_THRESHOLDS.vh * 100) / 100,
      h:  pick(PROTOCOL_PARAM_KEYS.levelHPct,  DEFAULT_LEVEL_THRESHOLDS.h  * 100) / 100,
      l:  pick(PROTOCOL_PARAM_KEYS.levelLPct,  DEFAULT_LEVEL_THRESHOLDS.l  * 100) / 100,
      vl: pick(PROTOCOL_PARAM_KEYS.levelVlPct, DEFAULT_LEVEL_THRESHOLDS.vl * 100) / 100,
    },
    levelTargets,
    forceConvertDays: pick(PROTOCOL_PARAM_KEYS.forceConvertDays, DEFAULT_PROTOCOL.forceConvertDays),
    thresholds: {
      strongTrendER:   pick(PROTOCOL_PARAM_KEYS.strongTrendER,   DEFAULT_THRESHOLDS.strongTrendER),
      weakTrendER:     pick(PROTOCOL_PARAM_KEYS.weakTrendER,     DEFAULT_THRESHOLDS.weakTrendER),
      minTrendMovePct: pick(PROTOCOL_PARAM_KEYS.minTrendMovePct, DEFAULT_THRESHOLDS.minTrendMovePct * 100) / 100,
      highVolZ:        pick(PROTOCOL_PARAM_KEYS.highVolZ,        DEFAULT_THRESHOLDS.highVolZ),
    },
    confirmDays:      pick(PROTOCOL_PARAM_KEYS.confirmDays, DEFAULT_PROTOCOL.confirmDays),
    kalmanQ:          pick(PROTOCOL_PARAM_KEYS.kalmanQ,     DEFAULT_PROTOCOL.kalmanQ),
    kalmanR:          pick(PROTOCOL_PARAM_KEYS.kalmanR,     DEFAULT_PROTOCOL.kalmanR),
    rebalanceBandPct: pick(PROTOCOL_PARAM_KEYS.rebalanceBandPct, DEFAULT_PROTOCOL.rebalanceBandPct * 100) / 100,
  }
}

export const DEFAULT_PROTOCOL: PolicyProtocol = {
  targets:    DEFAULT_TARGETS,
  thresholds: DEFAULT_THRESHOLDS,
  confirmDays: 2,
  // 원/달러 가격대 기준으로 교정한 값 — kalmanSmooth 주석 참조. Phase 4 백테스트로 재교정 예정.
  kalmanQ:    2,
  kalmanR:    10,
  rebalanceBandPct: 0.03,
  // 앵커는 담당자가 고정하기 전까지 없다 → 기본 상태에서는 구 국면 매핑으로 동작한다.
  useLevelAxis:    false,
  anchorRate:      null,
  levelThresholds: DEFAULT_LEVEL_THRESHOLDS,
  levelTargets:    DEFAULT_LEVEL_TARGETS,
  forceConvertDays: 90,
}

/** 목표 비율을 제약 조건으로 클램프할 때 필요한 회사 상황 */
export interface TreasuryContext {
  /** 가용 자금 총액 (원화 환산) */
  totalFundKRW: number
  /** 현재 외화 보유액 (원화 환산) */
  fxHoldingKRW: number
  /**
   * 향후 N개월 외화 결제 예정액 (원화 환산).
   * 이만큼은 국면과 무관하게 반드시 보유해야 한다 —
   * 없으면 결제일에 고가로 되사야 하고, 그게 정확히 우리가 피하려는 손실이다.
   */
  fxPayableKRW: number
  /** 정책 밴드 상한 (policy_params.fx_target_max, 0~1). null=제약 없음 */
  policyMaxRatio: number | null
  /** 정책 밴드 하한 (policy_params.fx_target_min, 0~1). null=제약 없음 */
  policyMinRatio: number | null

  // ── 안전장치 (Level 축 도입과 함께 신설) ──────────────────────────
  /**
   * 최대 미환전 노출 한도 (원화 환산). 넘으면 Level 과 무관하게 환전한다.
   * ⚠ 순수입 구조라 재고가 자동으로 쌓인다 — 상한이 없으면 노출이 단조 증가한다.
   */
  maxExposureKRW?: number | null
  /** 마지막 환전 이후 경과 영업일. forceConvertDays 와 함께 시간 기반 강제 환전에 쓰인다 */
  daysSinceLastConvert?: number | null
  /**
   * 평균 취득환율 (원/외화). 매도 시 실현손익 산출용.
   * 1단계는 수동 입력, 추후 FIFO 원장 연동(docs/기획/외화원장_FIFO_가중평균.md).
   */
  avgAcquisitionRate?: number | null
}

export type ClampReason = 'none' | 'buffer' | 'policy_band' | 'exposure_cap' | 'time_force'

export const CLAMP_LABEL: Record<ClampReason, string> = {
  none:         '제약 없음',
  buffer:       '결제 버퍼 하한',
  policy_band:  '정책 밴드',
  exposure_cap: '최대 노출 한도 초과',
  time_force:   '장기 미환전 — 시간 기반 강제 환전',
}

export interface AppliedTarget {
  rawTarget:     number
  appliedTarget: number
  clampedBy:     ClampReason
  bufferFloor:   number
}

export interface ConstraintOptions {
  /** 시간 기반 강제 환전 기준일. 0=비활성 */
  forceConvertDays?: number
  /** 강제 환전 시 끌어내릴 목표(중립 수준). 기본 0.3 */
  neutralTarget?:    number
}

/**
 * 국면 원안 → 실제 적용 목표 비율.
 *
 * 우선순위: 결제 버퍼(하한) > 정책 밴드 > 국면 원안
 * ⭐ 알고리즘 제안이 정책 밴드를 넘어설 수 없다. 충돌 시 정책이 이긴다.
 *   화면에서 clampedBy 를 반드시 표기해 "왜 제안과 다른가"를 설명할 것.
 */
export function applyConstraints(
  rawTarget: number,
  ctx: TreasuryContext,
  opts: ConstraintOptions = {},
): AppliedTarget {
  const bufferFloor =
    ctx.totalFundKRW > 0 ? Math.min(1, ctx.fxPayableKRW / ctx.totalFundKRW) : 0

  let applied = rawTarget
  let clampedBy: ClampReason = 'none'

  if (ctx.policyMaxRatio != null && applied > ctx.policyMaxRatio) {
    applied = ctx.policyMaxRatio
    clampedBy = 'policy_band'
  }
  if (ctx.policyMinRatio != null && applied < ctx.policyMinRatio) {
    applied = ctx.policyMinRatio
    clampedBy = 'policy_band'
  }

  // ── 안전장치 ①: 최대 노출 한도 ─────────────────────────────────
  // Level 이 "싸니까 보유"라 해도 노출이 한도를 넘으면 환전한다.
  if (ctx.maxExposureKRW != null && ctx.maxExposureKRW > 0 && ctx.totalFundKRW > 0) {
    const cap = ctx.maxExposureKRW / ctx.totalFundKRW
    if (applied > cap) {
      applied = cap
      clampedBy = 'exposure_cap'
    }
  }

  // ── 안전장치 ②: 시간 기반 강제 환전 ────────────────────────────
  // "싸니까 안 판다"가 무한정 지속되는 것을 막는다.
  // (그 판단이 바로 2026-07 에 매각 시기를 놓친 경위였다)
  const fcd = opts.forceConvertDays ?? 0
  if (fcd > 0 && (ctx.daysSinceLastConvert ?? 0) >= fcd) {
    const neutral = opts.neutralTarget ?? 0.3
    if (applied > neutral) {
      applied = neutral
      clampedBy = 'time_force'
    }
  }

  // ── 결제 버퍼가 최종 하한 — 다른 모든 제약보다 우선 (실제 지급 의무) ──
  if (applied < bufferFloor) {
    applied = bufferFloor
    clampedBy = 'buffer'
  }

  return { rawTarget, appliedTarget: Math.max(0, Math.min(1, applied)), clampedBy, bufferFloor }
}

// ══════════════════════════════════════════════════════════════════════
//  4. 최종 시그널
// ══════════════════════════════════════════════════════════════════════

export interface FxRegimeSignal {
  asOf:      string
  currency:  string
  indicators: RegimeIndicators
  regime: {
    code:          RegimeCode
    label:         string
    rawCode:       RegimeCode
    confirmedDays: number
  }
  /** 수준 축. 앵커 미설정이거나 Level 축 비활성이면 null */
  level: {
    anchorRate: number
    /** (현재가 − 앵커) / 앵커 */
    dev:        number
    grade:      LevelGrade
    label:      string
    trendGroup: TrendGroup
  } | null
  decision: {
    rawTargetRatio:     number
    appliedTargetRatio: number
    clampedBy:          ClampReason
    bufferFloorRatio:   number
    currentRatio:       number
    /** + = 매수 필요, − = 매도 필요 (원화 환산 금액) */
    suggestedTradeKRW:  number
    /** rebalanceBandPct 미만이면 false — 거래 불필요 */
    actionRequired:     boolean
    action:             string
    /**
     * 이 권고를 실행할 때 실현되는 환차손익 (원화). 매도일 때만 산출.
     * avgAcquisitionRate 미설정이면 null.
     * ⚠ 음수라도 차단하지 않는다 — 비중 상한 해소 등을 위해 손실 실현이 필요할 수 있다.
     *   다만 화면에 반드시 경고와 함께 금액을 표시할 것(사용자 결정 2026-08-11).
     */
    expectedRealizedPnlKRW: number | null
    /** 취득원가 이하 매도 여부 */
    belowCost:              boolean
  }
}

export interface RegimeSeriesPoint { date: string; rate: number }

/**
 * 종합 판정. 백테스트도 이 함수를 그대로 호출한다.
 *
 * @param series 오름차순 시계열. **마지막 원소가 판정 시점**이며,
 *               백테스트는 반드시 slice 로 잘라 넘겨야 한다(look-ahead 금지).
 */
export function evaluateRegime(
  series: RegimeSeriesPoint[],
  ctx: TreasuryContext,
  protocol: PolicyProtocol = DEFAULT_PROTOCOL,
  currency = 'USD',
): FxRegimeSignal | null {
  if (series.length < 30) return null   // 최소 표본 — 이하면 판정 자체가 무의미

  const closes = series.map(p => p.rate)
  const ind = computeIndicators(closes, protocol.kalmanQ, protocol.kalmanR)
  if (!ind) return null

  // 히스테리시스용 최근 원시 판정 이력.
  // 전 구간을 다시 계산하면 O(n²)이라, 확정에 필요한 최소 구간만 되짚는다.
  const need = Math.max(protocol.confirmDays * 3, 6)
  const rawCodes: RegimeCode[] = []
  for (let back = Math.min(need, series.length - 30); back >= 0; back--) {
    const sub = closes.slice(0, closes.length - back)
    const si = computeIndicators(sub, protocol.kalmanQ, protocol.kalmanR)
    if (si) rawCodes.push(classifyRegime(si, protocol.thresholds))
  }
  const rawCode = rawCodes.length ? rawCodes[rawCodes.length - 1] : classifyRegime(ind, protocol.thresholds)
  const { code, confirmedDays } = confirmRegime(rawCodes, protocol.confirmDays)

  // ── 수준(Level) 판정 → 목표 비율 ─────────────────────────────────
  // Level 이 방향을, Trend 가 속도를 정한다. 앵커가 없으면 구 국면 매핑으로 폴백.
  const trendGroup = trendGroupOf(code)
  let levelBlock: FxRegimeSignal['level'] = null
  let rawTarget: number

  if (protocol.useLevelAxis && protocol.anchorRate != null && protocol.anchorRate > 0) {
    const { dev, grade } = classifyLevel(ind.close, protocol.anchorRate, protocol.levelThresholds)
    levelBlock = {
      anchorRate: protocol.anchorRate,
      dev, grade, label: LEVEL_LABEL[grade], trendGroup,
    }
    rawTarget = protocol.levelTargets[grade][trendGroup]
  } else {
    rawTarget = protocol.targets[code] ?? 0.3
  }

  const applied = applyConstraints(rawTarget, ctx, {
    forceConvertDays: protocol.forceConvertDays,
    neutralTarget:    protocol.levelTargets.N[trendGroup],
  })

  const currentRatio = ctx.totalFundKRW > 0 ? ctx.fxHoldingKRW / ctx.totalFundKRW : 0
  const gap = applied.appliedTarget - currentRatio
  const actionRequired = Math.abs(gap) >= protocol.rebalanceBandPct
  const tradeKRW = gap * ctx.totalFundKRW

  // 매도 시 실현 환차손익 — 취득원가 이하라도 차단하지 않고 금액만 명시한다
  let expectedRealizedPnlKRW: number | null = null
  let belowCost = false
  const acq = ctx.avgAcquisitionRate
  if (actionRequired && tradeKRW < 0 && acq != null && acq > 0 && ind.close > 0) {
    const sellFx = -tradeKRW / ind.close
    expectedRealizedPnlKRW = sellFx * (ind.close - acq)
    belowCost = ind.close < acq
  }

  let action: string
  if (!actionRequired) action = '조치 불필요 — 리밸런싱 밴드 이내'
  else if (tradeKRW < 0) action = '외화 매도 권고'
  else action = '외화 보유 확대 권고 (순유입 구조에서는 환전 지연을 의미)'

  return {
    asOf:     series[series.length - 1].date,
    currency,
    indicators: ind,
    regime: { code, label: regimeLabel(code), rawCode, confirmedDays },
    level: levelBlock,
    decision: {
      rawTargetRatio:     applied.rawTarget,
      appliedTargetRatio: applied.appliedTarget,
      clampedBy:          applied.clampedBy,
      bufferFloorRatio:   applied.bufferFloor,
      currentRatio,
      suggestedTradeKRW:  tradeKRW,
      actionRequired,
      action,
      expectedRealizedPnlKRW,
      belowCost,
    },
  }
}
