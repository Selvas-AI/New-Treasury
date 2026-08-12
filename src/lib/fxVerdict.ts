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
}

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
  } = input

  const rate = signal.indicators.close
  const d = signal.decision
  const levelLabel = signal.level?.label ?? null
  const dev = signal.level?.dev ?? null
  const trendLabel = signal.regime.label.split(' / ')[0]

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
    const execFx = cappedByBudget ? allowedFx : requestedFx
    const execKRW = execFx * rate

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

    if (execFx <= 0) {
      return {
        kind: 'blocked',
        headline: '팔아야 할 구간이지만, 이번 분기 손실 한도가 모두 소진됐습니다.',
        order: '이번 분기 추가 환전 불가 — 한도 조정은 회의체 승인이 필요합니다.',
        reasons,
        caveat: '한도를 늘리지 않으면 다음 분기까지 환율 변동 위험을 그대로 안고 갑니다.',
        tone: 'warn',
      }
    }

    return {
      kind: cappedByBudget ? 'sell_partial' : 'sell',
      headline: cappedByBudget
        ? '지금은 파는 구간입니다. 다만 분기 손실 한도까지만 집행합니다.'
        : '지금은 파는 구간입니다.',
      order: `${currency} ${num(execFx)} 환전 (약 ${eok(execKRW)})` +
             (cappedByBudget ? ` — 권고 ${num(requestedFx)} 중 한도 내 집행분` : ''),
      reasons: pnlNote ? [...reasons, pnlNote] : reasons,
      caveat: cappedByBudget
        ? `나머지 ${currency} ${num(requestedFx - execFx)} 는 다음 분기로 이월됩니다.`
        : null,
      tone: 'act',
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
    return {
      kind: 'wait',
      headline: '지금은 파는 구간이 아닙니다. 환전을 미룹니다.',
      order: '이번 유입분은 환전하지 않고 보유합니다.',
      reasons, caveat, tone: 'hold',
    }
  }

  // ── 조치 불필요 ───────────────────────────────────────────
  reasons.push(
    `목표 **${(d.appliedTargetRatio * 100).toFixed(0)}%** 와 현재 ` +
    `**${(d.currentRatio * 100).toFixed(0)}%** 의 차이가 작아, 거래 비용을 쓸 만큼이 아닙니다.`,
  )
  return {
    kind: 'hold',
    headline: '오늘은 아무것도 하지 않습니다.',
    order: `현 보유 ${currency} ${num(holdingFx)} 를 그대로 유지합니다.`,
    reasons,
    caveat: '국면이 바뀌면 이 화면의 결론도 바뀝니다. 매일 한 번만 확인하시면 됩니다.',
    tone: 'hold',
  }
}
