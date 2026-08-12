/**
 * fxChartNarrative.ts — 환율 차트 자동 해석 (순수 함수)
 *
 * 세션22차 신규.
 *
 * 왜 필요한가:
 *   SMA20·볼린저 밴드·칼만 평활은 외환 실무자가 아니면 읽을 수 없다.
 *   경영진 보고 자리에서 "이 그림이 무슨 뜻이냐"는 질문에 매번 사람이 설명해야 한다면
 *   그 화면은 실패한 화면이다. 지표값을 **초등학생도 이해할 수 있는 문장**으로 바꾼다.
 *
 * 원칙:
 *   1. 전문용어를 쓰면 반드시 그 자리에서 풀어 쓴다.
 *   2. 비유는 일상에서 가져온다(자동차 내비게이션, 고무줄, 저울 등).
 *   3. 숫자는 반올림해서 읽기 쉽게. 소수점 둘째 자리 이상은 쓰지 않는다.
 *   4. 단정하지 않는다 — "~로 보입니다", "~인 편입니다". 예측이 아니라 관찰이다.
 */
import type { RegimeIndicators, RegimeCode, LevelGrade, TrendCode } from './fxRegime'

export interface NarrativeSection {
  icon:  string
  title: string
  /** 문단 배열 */
  body:  string[]
  /** 강조 색조 (선택) */
  tone?: 'up' | 'down' | 'neutral'
}

export interface NarrativeInput {
  indicators: RegimeIndicators
  regimeCode: RegimeCode
  /** 차트에 그려진 구간의 종가 배열 (백분위 계산용) */
  windowCloses: number[]
  /** 수준 축 (앵커 미설정이면 null) */
  level: { anchorRate: number; dev: number; grade: LevelGrade } | null
  currency: string
}

const won = (v: number) => `${Math.round(v).toLocaleString()}원`
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`

/** 배열에서 값의 백분위 (0~100) */
function percentileOf(arr: number[], v: number): number {
  if (!arr.length) return 50
  const below = arr.filter(x => x < v).length
  return (below / arr.length) * 100
}

// ── 부분 해석기 ────────────────────────────────────────────────────────

function trendPhrase(code: RegimeCode, er: number | null): string {
  const t = code.charAt(0) as TrendCode
  const dir =
    t === '1' ? '빠르게 오르는' :
    t === '2' ? '천천히 오르는' :
    t === '3' ? '뚜렷한 방향 없이 오르락내리락하는' :
    t === '4' ? '천천히 내리는' : '빠르게 내리는'
  if (t === '3') return `${dir} 중입니다`

  const e = er ?? 0
  const how =
    e >= 70 ? '한눈에 보일 만큼 곧게' :
    e >= 45 ? '비교적 꾸준히' :
    e >= 25 ? '느슨하게' : '갈지자로'
  return `${how} ${dir} 중입니다`
}

function volPhrase(volZ: number | null, annualVol: number | null): string {
  const z = volZ ?? 0
  const base = annualVol != null ? `(1년 기준 변동폭 약 ${pct1(annualVol)})` : ''
  if (z >= 1.5) return `요즘 유난히 심하게 출렁입니다 ${base}`
  if (z >= 1.0) return `평소보다 많이 흔들리는 편입니다 ${base}`
  if (z >= -0.5) return `평소와 비슷한 정도로 움직입니다 ${base}`
  return `요즘은 유난히 잠잠한 편입니다 ${base}`
}

function bandPhrase(pctB: number | null): string {
  if (pctB == null) return '띠 안에서의 위치를 계산할 자료가 아직 부족합니다.'
  if (pctB >= 1)   return '지금은 **띠 위쪽을 뚫고 나가** 있습니다. 평소 범위를 벗어날 만큼 비싸다는 뜻입니다.'
  if (pctB >= 0.8) return '지금은 **띠의 위쪽**에 있습니다. 평소보다 비싼 편입니다.'
  if (pctB >= 0.2) return '지금은 **띠 가운데**에 있습니다. 평범한 범위 안에서 움직이고 있습니다.'
  if (pctB >= 0)   return '지금은 **띠의 아래쪽**에 있습니다. 평소보다 싼 편입니다.'
  return '지금은 **띠 아래쪽을 뚫고 나가** 있습니다. 평소 범위를 벗어날 만큼 싸다는 뜻입니다.'
}

// ── 본체 ──────────────────────────────────────────────────────────────

export function buildChartNarrative(input: NarrativeInput): NarrativeSection[] {
  const { indicators: ind, regimeCode, windowCloses, level, currency } = input
  const out: NarrativeSection[] = []

  const t = regimeCode.charAt(0) as TrendCode
  const goingUp = t === '1' || t === '2'
  const goingDown = t === '4' || t === '5'
  const tone: NarrativeSection['tone'] = goingUp ? 'up' : goingDown ? 'down' : 'neutral'

  // ① 지금 어디쯤인가
  const pctl = percentileOf(windowCloses, ind.close)
  const lo = Math.min(...windowCloses)
  const hi = Math.max(...windowCloses)
  // ⚠ 최저/최고일 때 "0% 지점"이라고 쓰면 어색하다. 문장을 바꿔 준다.
  const posSentence =
    pctl <= 2  ? '오늘 값은 **이 기간 중 가장 낮은 수준**입니다.'
    : pctl >= 98 ? '오늘 값은 **이 기간 중 가장 높은 수준**입니다.'
    : `오늘 값은 그중 아래에서 약 **${Math.round(pctl)}% 지점**으로, **` +
      (pctl >= 80 ? '높은 편' : pctl >= 60 ? '조금 높은 편'
       : pctl >= 40 ? '중간쯤' : pctl >= 20 ? '조금 낮은 편' : '낮은 편') + '**입니다.'

  const body1 = [
    `오늘 1${currency}는 **${won(ind.close)}**입니다.`,
    `이 그래프에 그려진 기간에서 환율은 ${won(lo)} ~ ${won(hi)} 사이를 오갔습니다. ${posSentence}`,
  ]
  if (level) {
    const cmp = level.dev >= 0 ? '비싼' : '싼'
    body1.push(
      `회사가 기준으로 정한 ‘보통 환율’(앵커)은 **${won(level.anchorRate)}**입니다. ` +
      `오늘은 그보다 **${pct1(Math.abs(level.dev))} ${cmp}** 상태입니다.`,
    )
    // ⚠ "최근 구간에서는 최저인데 앵커 대비로는 비싸다" 같은 조합은 설명 없이 두면 모순으로 읽힌다.
    //   기준을 무엇으로 잡느냐에 따라 답이 달라진다는 점이 이 시스템의 핵심이므로 명시한다.
    const lowInWindow = pctl <= 25
    const highInWindow = pctl >= 75
    if (lowInWindow && level.dev > 0.005) {
      body1.push(
        '두 이야기가 어긋나 보일 수 있는데, **기준이 다르기 때문**입니다. ' +
        '최근 몇 달만 보면 낮은 편이지만, 회사가 정한 기준 환율과 견주면 아직 비싼 쪽입니다. ' +
        '이 시스템은 **최근 몇 달이 아니라 기준 환율을 잣대로** 판단합니다. ' +
        '최근 값만 보면 “요즘 중에서는 싸니까 팔지 말자”가 되어, 오래 오른 뒤에는 영영 못 파는 함정에 빠지기 때문입니다.',
      )
    } else if (highInWindow && level.dev < -0.005) {
      body1.push(
        '두 이야기가 어긋나 보일 수 있는데, **기준이 다르기 때문**입니다. ' +
        '최근 몇 달만 보면 높은 편이지만, 회사가 정한 기준 환율과 견주면 아직 싼 쪽입니다. ' +
        '이 시스템은 **기준 환율을 잣대로** 판단합니다.',
      )
    }
  }
  out.push({ icon: '📍', title: '지금 환율은 어디쯤인가요?', body: body1, tone })

  // ② 어느 쪽으로 가고 있나
  const body2 = [`환율은 지금 ${trendPhrase(regimeCode, ind.trendER)}.`]
  if (ind.netMovePct != null) {
    const m = ind.netMovePct
    const dirw = m >= 0 ? '올랐습니다' : '내렸습니다'
    body2.push(
      `최근 20영업일(약 한 달) 동안 **${pct1(Math.abs(m))}** ${dirw}. ` +
      `원/달러는 한 달에 2% 안팎 움직이는 것이 보통이라, ` +
      (Math.abs(m) >= 0.03 ? '**꽤 큰 움직임**입니다.' :
       Math.abs(m) >= 0.015 ? '평범한 수준의 움직임입니다.' :
       '거의 제자리라고 볼 수 있습니다.'),
    )
  }
  out.push({ icon: goingUp ? '📈' : goingDown ? '📉' : '➡️', title: '어느 쪽으로 가고 있나요?', body: body2, tone })

  // ③ 얼마나 출렁이나
  const body3 = [volPhrase(ind.volZ, ind.annualVol)]

  // ⚠ "한 달에 6% 내렸다"와 "잠잠하다"가 나란히 있으면 모순으로 읽힌다.
  //   실은 서로 다른 것을 재는 지표다 — 이 구분이 국면 판정의 핵심이므로 반드시 풀어 준다.
  const bigMove = Math.abs(ind.netMovePct ?? 0) >= 0.03
  const calm = (ind.volZ ?? 0) < 0.5
  const choppy = (ind.volZ ?? 0) >= 1.0
  if (bigMove && calm) {
    body3.push(
      '“많이 내렸는데 잠잠하다”는 말이 이상하게 들릴 수 있습니다. ' +
      '**두 가지는 다른 것을 잽니다.** 하나는 ‘얼마나 멀리 갔나’이고, 다른 하나는 ‘가는 동안 얼마나 흔들렸나’입니다.',
      '에스컬레이터를 떠올리시면 됩니다. 한 층을 내려가더라도 흔들림 없이 **미끄러지듯 꾸준히** 내려가는 상태입니다. ' +
      '방향이 분명하고 되돌림이 적다는 뜻이라, 오히려 **흐름을 믿을 만한** 상황입니다.',
    )
  } else if (!bigMove && choppy) {
    body3.push(
      '많이 움직이지는 않았는데 출렁임은 큽니다. 올랐다 내렸다를 반복해 **제자리로 돌아온** 상태입니다. ' +
      '방향을 믿기 어려운 구간이라, 큰 결정을 서두르지 않는 편이 좋습니다.',
    )
  }

  body3.push(
    '출렁임이 크면 하루 이틀 사이에도 값이 크게 바뀔 수 있어, ' +
    '한 번에 몰아서 환전하기보다 **나눠서 하는 편이 안전**합니다.',
  )
  out.push({ icon: '🌊', title: '얼마나 출렁이고 있나요?', body: body3 })

  // ④ 파란 띠(볼린저 밴드)
  const body4 = [
    '연한 파란 띠는 **환율이 보통 움직이는 범위**를 색칠한 것입니다. ' +
    '최근 20일 평균을 가운데 두고, 그동안 오르내린 폭만큼 위아래로 벌려 놓았습니다.',
    '고무줄처럼 생각하시면 됩니다 — 띠 안에 있으면 평범한 움직임이고, ' +
    '띠 밖으로 나가면 평소와 다른 일이 벌어지고 있다는 신호입니다.',
    bandPhrase(ind.pctB),
  ]
  if (ind.bbLower != null && ind.bbUpper != null) {
    body4.push(`오늘 기준 띠의 범위는 **${won(ind.bbLower)} ~ ${won(ind.bbUpper)}** 입니다.`)
  }
  out.push({ icon: '🎈', title: '파란 띠(볼린저 밴드)는 무엇인가요?', body: body4 })

  // ⑤ 선 세 개 읽는 법
  const gap = ind.close - ind.smoothed
  const gapWord = Math.abs(gap) < 1 ? '거의 같습니다'
    : gap > 0 ? `흐름선보다 **${won(Math.abs(gap))} 위**에 있습니다 (최근 며칠 되밀어 올렸다는 뜻)`
    : `흐름선보다 **${won(Math.abs(gap))} 아래**에 있습니다 (최근 며칠 밀렸다는 뜻)`
  out.push({
    icon: '〰️',
    title: '선 세 개는 각각 무엇인가요?',
    body: [
      '**회색 가는 선** — 한국은행이 매일 고시한 **실제 환율**입니다. 하루하루 오르내려 방향을 알아보기 어렵습니다.',
      '**파란 굵은 선** — 그 잔떨림을 걷어내고 **진짜 흐름만 남긴 선**입니다. ' +
      '자동차 내비게이션이 GPS 신호가 튀어도 위치를 도로 위로 바로잡아 주는 것과 같은 방식입니다. ' +
      '방향을 볼 때는 이 선을 보시면 됩니다.',
      `**주황 점선** — 최근 20일 환율의 **평균값**입니다. 오늘 환율이 이 선 위에 있으면 최근 한 달 평균보다 비싼 것입니다.`,
      `오늘 실제 환율은 ${gapWord}.`,
    ],
  })

  // ⑥ 그래서?
  const grade = level?.grade
  let conclusion: string
  if (!grade) {
    conclusion = '기준 환율(앵커)이 아직 정해지지 않아, 지금이 비싼지 싼지는 판단하지 않고 있습니다. ' +
      '정책 프로토콜 탭에서 앵커를 정하면 이 자리에 판단이 표시됩니다.'
  } else if ((grade === 'VH' || grade === 'H') && goingDown) {
    conclusion = '**비싼 편인데 방향이 아래로 꺾였습니다.** 이 시스템이 가장 강하게 ‘환전하라’고 보는 상황입니다. ' +
      '더 기다렸다가 값이 내려가면 그만큼 손해이기 때문입니다.'
  } else if (grade === 'VH' || grade === 'H') {
    conclusion = '**비싼 편이고 아직 오르는 중입니다.** 좋은 가격이지만 더 오를 수도 있어, ' +
      '한 번에 다 팔기보다 **나눠서 환전**하는 구간입니다.'
  } else if ((grade === 'VL' || grade === 'L') && goingUp) {
    conclusion = '**싼 편인데 방향이 위로 돌아섰습니다.** 서둘러 환전할 이유가 적어 ' +
      '**조금 더 지켜보는** 구간입니다.'
  } else if (grade === 'VL' || grade === 'L') {
    conclusion = '**싼 편이고 아직 내리는 중입니다.** 지금 팔면 손해가 커서 최소한만 환전합니다. ' +
      '다만 계속 미루면 외화가 쌓이므로, **보유 한도와 기한**을 함께 확인해야 합니다.'
  } else {
    conclusion = '**보통 수준입니다.** 특별히 서두르거나 미룰 이유가 없어, ' +
      '정해진 계획대로 꾸준히 환전하는 구간입니다.'
  }
  out.push({ icon: '💡', title: '그래서 무슨 뜻인가요?', body: [conclusion], tone })

  return out
}
