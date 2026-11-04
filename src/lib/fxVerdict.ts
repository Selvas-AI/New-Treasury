/**
 * fxVerdict.ts — 오늘의 결론 한 줄 (순수 함수)
 *
 * 세션22차 신규.
 *
 * ⭐ 왜 만드는가:
 *   기존 화면은 지표·국면·목표비중·손익·백테스트를 모두 펼쳐 놓았다.
 *   그 결과 "이 시스템이 얼마나 정교한가"는 보이지만 **"그래서 오늘 뭘 하나"**는 안 보인다.
 *   경영진도 실무자도 첫 화면에서 얻어야 하는 것은 단 하나 — **행동**이다.
 *
 * 설계 원칙:
 *   1. 결론이 먼저. 근거는 접어 둔다(요청 시에만 펼침).
 *   2. 행동은 동사로. "30% 유지" 가 아니라 "오늘은 아무것도 하지 않습니다".
 *   3. 근거는 **세 줄을 넘지 않는다.** 더 필요하면 다른 탭으로 보낸다.
 *   4. 단정하지 않되 흐리지도 않는다. 확률적 표현을 쓰되 결론은 분명히 한다.
 */
import type { FxRegimeSignal } from './fxRegime'

/** 오늘 취할 행동의 종류 */
export type ActionKind = 'sell' | 'sell_partial' | 'hold' | 'wait' | 'blocked'

export interface Verdict {
  kind: ActionKind
  /** 한 문장 결론 — 화면 최상단에 크게 */
  headline: string
  /** 구체적 실행 지시 (금액 등). 없으면 null */
  order: string | null
  /** 근거 3줄 이내 */
  reasons: string[]
  /** 이 판단의 확신도를 좌우하는 단서 (선택) */
  caveat: string | null
  /** 강조 색조 */
  tone: 'act' | 'hold' | 'warn'
  /** 이번 환전을 집행하면 남는 예상 외화 보유 비중 (0~1). 실제 환전이 없으면 null */
  expectedRatioAfter: number | null
  /** 현재 외화 보유 비중 (0~1) — expectedRatioAfter 와 나란히 비교 표시용 */
  currentRatio: number
  /**
   * 오늘 집행할 **바구니 기준 총액**(KRW, 양수). 조치가 없으면 null.
   * ⚠ 화면은 이 값을 통화별로 안분해 보여준다(allocateAcrossBasket).
   *   order 문자열에서 숫자를 다시 파싱하지 말 것.
   */
  orderKRW: number | null
}

export interface VerdictInput {
  signal: FxRegimeSignal
  currency: string
  /** 보유 외화 (외화 단위) */
  holdingFx: number
  /** 평균 취득환율 (0 = 미설정) */
  avgCostRate: number
  /** 분기 손실 한도 적용 후 실제 집행 가능 외화 (한도 미설정이면 요청량 그대로) */
  allowedFx: number
  /** 권고 외화 수량 (한도 적용 전) */
  requestedFx: number
  /** 손익분기 이상이었던 날의 비율 (0~1). null = 계산 불가 */
  pctDaysAboveBep: number | null

  /**
   * ⭐ 정책 밴드 상한 초과분 — 이 통화 몫 (KRW, 양수). 0 = 초과 없음.
   *
   * ⚠ 리짐 권고와 **성격이 다르다.** 리짐은 "지금이 팔 타이밍인가"(재량)이고,
   *   밴드 상한 복귀는 "의결된 한도를 지키고 있는가"(의무)다.
   *   과거엔 이 값을 verdict 가 몰라, 상한을 넘었는데도 리밸런싱 밴드(3%p) 안이면
   *   "오늘은 아무것도 하지 않습니다"라고 표시했다 — 바로 아래 '정책 상한 초과'
   *   경고와 정면으로 모순됐다(2026-11-02 사용자 리포트).
   */
  bandExcessKRW: number
  /** 밴드 상한 (%, 0~100). 문구 표기용. null = 밴드 미설정 */
  bandMaxPct: number | null
  /**
   * 판정 기준일이 오늘보다 며칠(영업일) 뒤처졌는지. null = 산출 불가.
   * ⚠ 환율 이력 백필이 끊긴 통화는 수년 전 데이터로 판정된다(EUR 2022-12-30 실사례).
   *   그 판정을 '실행 필요'로 단정하면 안 된다 — 보류하고 사실을 밝힌다.
   */
  asOfStaleDays: number | null
}

/** 이 영업일 수를 넘게 뒤처지면 리짐 판정을 신뢰하지 않는다 */
export const STALE_LIMIT_BIZDAYS = 10

const num = (v: number) => Math.round(v).toLocaleString()

/** 억원 단위 간결 표기 */
function eok(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e8) return `${(v / 1e8).toFixed(1)}억원`
  if (a >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만원`
  return `${Math.round(v).toLocaleString()}원`
}

export function buildVerdict(input: VerdictInput): Verdict {
  const {
    signal, currency, holdingFx, avgCostRate,
    allowedFx, requestedFx, pctDaysAboveBep,
    bandExcessKRW, bandMaxPct, asOfStaleDays,
  } = input

  const rate = signal.indicators.close
  const d = signal.decision
  const levelLabel = signal.level?.label ?? null
  const dev = signal.level?.dev ?? null
  const trendLabel = signal.regime.label.split(' / ')[0]

  // 밴드 상한 복귀 — 환율 타이밍과 무관한 **의무**
  const bandFx = rate > 0 ? bandExcessKRW / rate : 0
  const bandOver = bandExcessKRW > 0 && bandFx > 0
  // ⚠ 바구니 전체 결정이므로 **원화 총액**을 먼저 말한다. 통화별 수량은 카드의
  //   권장 배분표가 보여준다 — 지시 문구에 한 통화 수량만 쓰면 "그 통화만 팔라"로 읽힌다.
  const bandOrder = () =>
    `총 ${eok(bandExcessKRW)} 환전` +
    (bandMaxPct != null ? ` — 정책 상한 ${bandMaxPct.toFixed(0)}% 복귀분` : '')
  const bandReason = () =>
    `외화 보유가 **정책 상한${bandMaxPct != null ? ` ${bandMaxPct.toFixed(0)}%` : ''}을 ` +
    `${eok(bandExcessKRW)} 초과**했습니다. 상한 복귀는 환율과 무관한 이행 의무입니다.`

  // ── 환율 이력이 끊긴 통화 — 리짐 판정을 신뢰하지 않는다 ───────────
  // ⚠ 다만 **밴드 초과는 여전히 유효하다**(보유액·정책값만으로 산출되므로).
  //   그래서 "판정 보류"와 "상한 복귀 의무"를 함께 말한다.
  if (asOfStaleDays != null && asOfStaleDays > STALE_LIMIT_BIZDAYS) {
    const staleNote =
      `환율 이력이 **${signal.asOf}** 까지만 있어(약 ${asOfStaleDays}영업일 전) ` +
      `국면·수준 판정을 신뢰할 수 없습니다. 자금정책에서 ${currency} 환율 이력을 보강해야 합니다.`
    return {
      kind: bandOver ? 'sell' : 'blocked',
      headline: bandOver
        ? '환율 판정은 보류합니다. 다만 정책 상한 복귀분은 지금 집행합니다.'
        : '환율 이력이 오래돼 오늘 판정을 내릴 수 없습니다.',
      order: bandOver ? bandOrder() : '환율 이력 보강 전까지 이 통화는 리짐 판정 대상이 아닙니다.',
      reasons: bandOver ? [bandReason(), staleNote] : [staleNote],
      caveat: bandOver
        ? '상한 복귀분은 보유액·정책값만으로 산출되므로 환율 이력과 무관하게 유효합니다.'
        : '보유 비중이 정책 밴드 안에 있어 당장 이행할 의무는 없습니다.',
      tone: bandOver ? 'act' : 'warn',
      orderKRW: bandOver ? bandExcessKRW : null,
      expectedRatioAfter: null,
      currentRatio: d.currentRatio,
    }
  }

  // 근거는 항상 같은 순서로 만든다 — 수준 → 추세 → 제약
  const reasons: string[] = []
  if (levelLabel && dev != null) {
    reasons.push(
      `환율이 회사 기준(앵커 ${num(signal.level!.anchorRate)}원)보다 ` +
      `${Math.abs(dev * 100).toFixed(1)}% ${dev >= 0 ? '높아' : '낮아' } **${levelLabel}** 구간입니다.`,
    )
  } else {
    reasons.push('기준 환율(앵커)이 설정되지 않아 수준 판단 없이 추세만 보고 있습니다.')
  }
  reasons.push(`추세는 **${trendLabel}**이며 ${signal.regime.confirmedDays}일째 유지 중입니다.`)

  // ── 매도 권고 ─────────────────────────────────────────────
  if (d.actionRequired && d.suggestedTradeKRW < 0) {
    const cappedByBudget = allowedFx + 1e-6 < requestedFx
    // ⚠ 리짐 권고가 밴드 복귀분보다 적을 수 있다(리밸런싱 밴드 3%p 완충 때문).
    //   그때는 **의무가 더 크므로 의무를 따른다.** 리짐이 더 크면 밴드도 자동 충족된다.
    const regimeExecFx = cappedByBudget ? allowedFx : requestedFx
    const execFx = Math.max(regimeExecFx, bandOver ? bandFx : 0)
    const bandDrivesAmount = bandOver && bandFx > regimeExecFx + 1e-6
    // 손실 한도보다 의무가 크면 임의로 한도를 뚫지 않는다 — 한도는 회의체 의결 사항이다.
    const bandShortFx = bandOver ? Math.max(0, bandFx - allowedFx) : 0
    const execKRW = execFx * rate

    // suggestedTradeKRW = (목표비중 − 현재비중) × 총자금 이므로 역산하면 총자금을 구할 수 있다
    const ratioGap = d.appliedTargetRatio - d.currentRatio
    const totalFundKRW = Math.abs(ratioGap) > 1e-9 ? d.suggestedTradeKRW / ratioGap : 0
    const expectedRatioAfter = totalFundKRW > 0 ? Math.max(0, d.currentRatio - execKRW / totalFundKRW) : null

    // 실현손익
    let pnlNote: string | null = null
    if (avgCostRate > 0) {
      const pnl = execFx * (rate - avgCostRate)
      pnlNote = pnl < 0
        ? `이 환전으로 ${eok(Math.abs(pnl))}의 환차손이 확정되지만, ` +
          `**팔지 않아도 같은 금액이 이미 평가손실로 잡혀 있습니다.**`
        : `이 환전으로 ${eok(pnl)}의 환차익이 실현됩니다.`
    }

    reasons.push(
      `목표 보유 비중 **${(d.appliedTargetRatio * 100).toFixed(0)}%** 대비 ` +
      `현재 **${(d.currentRatio * 100).toFixed(0)}%** 로 초과 보유 상태입니다.`,
    )
    if (bandOver) reasons.push(bandReason())

    if (execFx <= 0) {
      return {
        kind: 'blocked',
        headline: '팔아야 할 구간이지만, 이번 분기 손실 한도가 모두 소진됐습니다.',
        order: '이번 분기 추가 환전 불가 — 한도 조정은 회의체 승인이 필요합니다.',
        reasons,
        caveat: bandOver
          ? `⚠ 정책 상한을 ${eok(bandExcessKRW)} 초과한 상태라 한도 소진과 무관하게 복귀 의무가 남습니다 — 회의체 한도 조정이 필요합니다.`
          : '한도를 늘리지 않으면 다음 분기까지 환율 변동 위험을 그대로 안고 갑니다.',
        tone: 'warn',
        orderKRW: null,
        expectedRatioAfter: null,
        currentRatio: d.currentRatio,
      }
    }

    const partial = cappedByBudget && !bandDrivesAmount
    return {
      kind: partial ? 'sell_partial' : 'sell',
      headline: bandDrivesAmount
        ? '정책 상한을 넘었습니다. 상한 복귀분을 환전합니다.'
        : partial
          ? '지금은 파는 구간입니다. 다만 분기 손실 한도까지만 집행합니다.'
          : '지금은 파는 구간입니다.',
      order: `총 ${eok(execKRW)} 환전` +
             (bandDrivesAmount
               ? (bandMaxPct != null ? ` — 정책 상한 ${bandMaxPct.toFixed(0)}% 복귀분` : ' — 정책 상한 복귀분')
               : partial ? ` — 권고 ${eok(requestedFx * rate)} 중 한도 내 집행분` : ''),
      reasons: pnlNote ? [...reasons, pnlNote] : reasons,
      caveat: bandShortFx > 0
        ? `⚠ 분기 손실 한도 때문에 상한 복귀에 ${eok(bandShortFx * rate)} 가 부족합니다 — 회의체 한도 조정이 필요합니다.`
        : partial
          ? `나머지 ${eok((requestedFx - execFx) * rate)} 는 다음 분기로 이월됩니다.`
          : null,
      tone: 'act',
      orderKRW: execKRW,
      expectedRatioAfter,
      currentRatio: d.currentRatio,
    }
  }

  // ── 매수(=환전 지연) 권고 ──────────────────────────────────
  if (d.actionRequired && d.suggestedTradeKRW > 0) {
    reasons.push(
      `목표 **${(d.appliedTargetRatio * 100).toFixed(0)}%** 보다 현재 보유가 ` +
      `**${(d.currentRatio * 100).toFixed(0)}%** 로 적어, 지금 파는 것은 손해입니다.`,
    )
    const caveat = pctDaysAboveBep != null && avgCostRate > 0
      ? `다만 최근 3년 중 평단(${num(avgCostRate)}원)을 넘긴 날은 ` +
        `${(pctDaysAboveBep * 100).toFixed(0)}% 뿐입니다. 무기한 기다리지 않도록 보유 한도를 함께 확인하세요.`
      : null
    // ⚠ 밴드 상한을 넘은 상태라면 "미룬다"가 될 수 없다 — 의무가 재량을 이긴다.
    if (bandOver) {
      return {
        kind: 'sell',
        headline: '파는 구간은 아니지만, 정책 상한을 넘어 복귀분은 집행합니다.',
        order: bandOrder(),
        reasons: [...reasons, bandReason()],
        caveat: '상한 복귀는 환율 판단과 무관한 이행 의무입니다. 그 이상은 팔지 않습니다.',
        tone: 'act',
        orderKRW: bandExcessKRW,
        expectedRatioAfter: null,
        currentRatio: d.currentRatio,
      }
    }
    return {
      kind: 'wait',
      headline: '지금은 파는 구간이 아닙니다. 환전을 미룹니다.',
      order: '이번 유입분은 환전하지 않고 보유합니다.',
      reasons, caveat, tone: 'hold',
      orderKRW: null,
      expectedRatioAfter: null,
      currentRatio: d.currentRatio,
    }
  }

  // ── 조치 불필요 ───────────────────────────────────────────
  reasons.push(
    `목표 **${(d.appliedTargetRatio * 100).toFixed(0)}%** 와 현재 ` +
    `**${(d.currentRatio * 100).toFixed(0)}%** 의 차이가 작아, 거래 비용을 쓸 만큼이 아닙니다.`,
  )

  // ⚠ [핵심] 리밸런싱 밴드(3%p)는 소액매매를 막는 장치이지 **정책 위반을 묵인하는 장치가 아니다.**
  //   과거엔 상한을 넘었는데도 여기로 떨어져 "오늘은 아무것도 하지 않습니다"가 표시됐다
  //   — 바로 아래 '정책 상한 초과' 경고와 모순(2026-11-02 USD 실사례, 5.3억 초과).
  if (bandOver) {
    return {
      kind: 'sell',
      headline: '정책 상한을 넘었습니다. 상한 복귀분을 환전합니다.',
      order: bandOrder(),
      reasons: [...reasons, bandReason()],
      caveat: '리밸런싱 밴드 이내라 추가 매도 권고는 없지만, 상한 복귀는 이행 의무입니다.',
      tone: 'act',
      orderKRW: bandExcessKRW,
      expectedRatioAfter: null,
      currentRatio: d.currentRatio,
    }
  }

  return {
    kind: 'hold',
    headline: '오늘은 아무것도 하지 않습니다.',
    order: `현 보유 ${currency} ${num(holdingFx)} 를 그대로 유지합니다.`,
    reasons,
    caveat: '국면이 바뀌면 이 화면의 결론도 바뀝니다. 매일 한 번만 확인하시면 됩니다.',
    tone: 'hold',
    orderKRW: null,
    expectedRatioAfter: null,
    currentRatio: d.currentRatio,
  }
}
