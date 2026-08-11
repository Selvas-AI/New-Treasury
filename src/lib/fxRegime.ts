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

export interface PolicyProtocol {
  targets:      RegimeTargets
  thresholds:   RegimeThresholds
  confirmDays:  number
  kalmanQ:      number
  kalmanR:      number
  /** 목표와 현재의 차이가 이 값(비율 포인트) 미만이면 거래하지 않음 — 잦은 소액매매 방지 */
  rebalanceBandPct: number
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
} as const

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

  return {
    targets,
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
}

export type ClampReason = 'none' | 'buffer' | 'policy_band'

export interface AppliedTarget {
  rawTarget:     number
  appliedTarget: number
  clampedBy:     ClampReason
  bufferFloor:   number
}

/**
 * 국면 원안 → 실제 적용 목표 비율.
 *
 * 우선순위: 결제 버퍼(하한) > 정책 밴드 > 국면 원안
 * ⭐ 알고리즘 제안이 정책 밴드를 넘어설 수 없다. 충돌 시 정책이 이긴다.
 *   화면에서 clampedBy 를 반드시 표기해 "왜 제안과 다른가"를 설명할 것.
 */
export function applyConstraints(rawTarget: number, ctx: TreasuryContext): AppliedTarget {
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
  // 결제 버퍼가 최종 하한 — 정책 밴드보다도 우선한다 (실제 지급 의무이므로)
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

  const rawTarget = protocol.targets[code] ?? 0.3
  const applied = applyConstraints(rawTarget, ctx)

  const currentRatio = ctx.totalFundKRW > 0 ? ctx.fxHoldingKRW / ctx.totalFundKRW : 0
  const gap = applied.appliedTarget - currentRatio
  const actionRequired = Math.abs(gap) >= protocol.rebalanceBandPct
  const tradeKRW = gap * ctx.totalFundKRW

  let action: string
  if (!actionRequired) action = '조치 불필요 — 리밸런싱 밴드 이내'
  else if (tradeKRW < 0) action = '외화 매도 권고'
  else action = '외화 매수/보유 확대 권고'

  return {
    asOf:     series[series.length - 1].date,
    currency,
    indicators: ind,
    regime: { code, label: regimeLabel(code), rawCode, confirmedDays },
    decision: {
      rawTargetRatio:     applied.rawTarget,
      appliedTargetRatio: applied.appliedTarget,
      clampedBy:          applied.clampedBy,
      bufferFloorRatio:   applied.bufferFloor,
      currentRatio,
      suggestedTradeKRW:  tradeKRW,
      actionRequired,
      action,
    },
  }
}
