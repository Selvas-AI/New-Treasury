/**
 * fxPnl.ts — 외화 평가손익 · 손익분기 · 분할 실현 계산 (순수 함수)
 *
 * 세션22차 신규.
 *
 * ⭐ 이 모듈이 존재하는 이유 — 하나의 착시를 깨기 위해서다.
 *
 *   "평단 아래라 팔면 손실이 확정되니 안 판다"
 *
 *   외화예금·외화현금은 **화폐성 외화항목**이라 매 보고기간말 마감환율로 환산하고
 *   그 차이를 당기손익에 반영한다(K-IFRS 제1021호). 즉 **팔지 않아도 손실은 이미 인식**된다.
 *   파느냐 마느냐는 손실의 발생 여부가 아니라 **계정 구분(외환차손 vs 외화환산손실)과
 *   앞으로의 환율 노출**을 바꿀 뿐이다.
 *
 *   따라서 "팔면 손해"라는 감각은 매몰원가 편향이며,
 *   2026-07 에 매각을 미룬 심리("조금 더 오르면 팔자")와 뿌리가 같다.
 *   화면에서 **팔든 안 팔든 같은 손실이 있다**는 것을 나란히 보여 주는 것이 이 모듈의 목적이다.
 *
 * ⚠ 세무 처리(법인세법상 화폐성 외화자산·부채 평가방법 신고 여부에 따른 익금·손금 산입)는
 *   회사 신고 내용에 따라 달라진다. 회계팀·감사인 확인이 필요하며 이 모듈은 판단하지 않는다.
 */
import type { RegimeSeriesPoint } from './fxRegime'

// ── 1. 평가손익 ────────────────────────────────────────────────────────

export interface PnlSnapshot {
  /** 보유 외화 (외화 단위) */
  holdingFx:      number
  /** 평균 취득환율 */
  avgCostRate:    number
  /** 현재 환율 */
  currentRate:    number
  /** 현재 평가손익 (원화) — 팔지 않아도 이미 손익에 반영된 금액 */
  unrealizedKRW:  number
  /** 이번 권고대로 환전할 경우 실현되는 손익 */
  realizingKRW:   number
  /** 환전 후에도 남는 평가손익 */
  remainingKRW:   number
  /** 환전 대상 외화 */
  convertFx:      number
}

/**
 * @param convertFx 이번에 환전할 외화 수량 (0 이면 권고 없음)
 */
export function pnlSnapshot(
  holdingFx: number,
  avgCostRate: number,
  currentRate: number,
  convertFx: number,
): PnlSnapshot | null {
  if (!(avgCostRate > 0) || !(currentRate > 0) || holdingFx <= 0) return null
  const diff = currentRate - avgCostRate
  const conv = Math.max(0, Math.min(convertFx, holdingFx))
  return {
    holdingFx, avgCostRate, currentRate,
    unrealizedKRW: holdingFx * diff,
    realizingKRW:  conv * diff,
    remainingKRW:  (holdingFx - conv) * diff,
    convertFx:     conv,
  }
}

// ── 2. 손익분기 환율(BEP) 도달 가능성 ──────────────────────────────────

export interface BepStats {
  /** 손익분기 환율 = 평균 취득환율 */
  bep:            number
  currentRate:    number
  /** BEP 까지 필요한 상승률 (음수면 이미 상회) */
  needPct:        number
  /** 관측 구간 영업일 수 */
  sampleDays:     number
  /** 그중 BEP 이상이었던 날의 비율 (0~1) */
  pctDaysAbove:   number
  /** 마지막으로 BEP 이상이었던 날 (없으면 null) */
  lastAboveDate:  string | null
  /** 그날로부터 경과 영업일 */
  daysSinceAbove: number | null
  /** 관측 구간 최고/최저 */
  maxRate:        number
  minRate:        number
}

/**
 * 손익분기 환율에 대한 **사실**을 산출한다. 예측이 아니다.
 *
 * "언젠가 오르겠지"라는 막연한 기대를 "최근 3년 중 38% 의 날이 그 수준 이상이었다"는
 * 관측 사실로 바꾸는 것이 목적이다. 회복 가능성이 낮다면 그 또한 의사결정에 필요한 정보다.
 */
export function bepStats(
  series: RegimeSeriesPoint[],
  bep: number,
  lookbackDays = 750,
): BepStats | null {
  if (!(bep > 0) || series.length === 0) return null
  const win = series.slice(Math.max(0, series.length - lookbackDays))
  const cur = series[series.length - 1].rate
  const above = win.filter(p => p.rate >= bep)

  let lastAboveDate: string | null = null
  let daysSinceAbove: number | null = null
  for (let i = win.length - 1; i >= 0; i--) {
    if (win[i].rate >= bep) {
      lastAboveDate = win[i].date
      daysSinceAbove = win.length - 1 - i
      break
    }
  }

  return {
    bep, currentRate: cur,
    needPct: (bep - cur) / cur,
    sampleDays: win.length,
    pctDaysAbove: win.length ? above.length / win.length : 0,
    lastAboveDate, daysSinceAbove,
    maxRate: Math.max(...win.map(p => p.rate)),
    minRate: Math.min(...win.map(p => p.rate)),
  }
}

// ── 3. 분할 실현 계획 ──────────────────────────────────────────────────

export interface LossBudget {
  /** 분기 실현 한도 (원, 양수). 0 = 미설정 */
  quarterCapKRW:     number
  /** 이번 분기 이미 실현한 손실 (원, 양수) */
  usedKRW:           number
  /** 남은 한도 */
  remainingKRW:      number
  /** 이번 권고가 한도를 넘는가 */
  exceedsCap:        boolean
  /** 한도 내에서 환전 가능한 외화 수량 */
  allowedFx:         number
  /** 권고 수량 (한도 적용 전) */
  requestedFx:       number
  /** 현재 보유 물량 전부를 이 한도로 처리하는 데 필요한 분기 수 */
  quartersToClear:   number | null
}

/**
 * 손실 실현을 분기 한도로 나눠 집행하기 위한 계산.
 *
 * 배경: 회사는 FIFO 를 쓰므로 지금 팔면 **가장 비싼 옛 물량부터** 나간다.
 *   손실이 앞쪽에 집중되므로, 한 분기에 몰아 인식하지 않도록 상한을 둔다.
 *   ⚠ 이는 손실을 줄이는 장치가 아니라 **인식 시점을 분산**하는 장치다.
 *      총 손실 금액 자체는 달라지지 않는다.
 */
export function lossBudget(
  quarterCapKRW: number,
  usedKRW: number,
  requestedFx: number,
  holdingFx: number,
  avgCostRate: number,
  currentRate: number,
): LossBudget {
  const lossPerFx = Math.max(0, avgCostRate - currentRate)   // 외화 1단위당 실현 손실
  const remaining = Math.max(0, quarterCapKRW - Math.max(0, usedKRW))

  // 한도 미설정이거나 손실 구간이 아니면 제약 없음
  if (quarterCapKRW <= 0 || lossPerFx === 0) {
    return {
      quarterCapKRW, usedKRW, remainingKRW: remaining,
      exceedsCap: false, allowedFx: requestedFx, requestedFx,
      quartersToClear: null,
    }
  }

  const allowedFx = Math.min(requestedFx, remaining / lossPerFx)
  const totalLoss = holdingFx * lossPerFx
  return {
    quarterCapKRW, usedKRW, remainingKRW: remaining,
    exceedsCap: requestedFx > allowedFx + 1e-6,
    allowedFx, requestedFx,
    quartersToClear: quarterCapKRW > 0 ? Math.ceil(totalLoss / quarterCapKRW) : null,
  }
}
