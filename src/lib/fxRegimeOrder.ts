/**
 * fxRegimeOrder — 바구니 리짐 권고 → 통화별 매각 지시 payload (2026-11-25 전수조사 F-01)
 *
 * ⭐ 리짐 매각 지시 payload 의 **유일한 조립 지점**이다. 화면에서 propose 인자를 만들지 말 것.
 *
 * 배경: 조치 카드는 "바구니를 목표 비중까지 내리는 총액"과 그 **통화별 배분**을 보여준다.
 *   과거 등록 경로는 그 총액을 **현재 탭 통화 하나로** 등록해(EUR 탭이면 USD 수량이 EUR 로)
 *   배분표와 맞지 않았다. 이제 배분표 그대로 통화별로 등록한다(결정 D1 기본값).
 *
 * 각 행의 환율 = 배분표가 쓴 환율(보유 원화 ÷ 보유 외화 = 시장환율)이다.
 *   그래야 통화별 원화 합계가 조치 카드 총액과 일치한다.
 */
import { addBizDays } from './bizDay'
import type { FxAllocationRow } from './fxBandExceed'
import type { FxCode } from './treasuryCalc'

export interface RegimeOrderCurrencyInfo {
  /** FIFO 잔존 장부환율 — 없으면 예상 손익을 남기지 않는다 */
  bookRate: number | null
  /** 지금 환전 가능한 수량(정기예금 만기 전 제외). 로트가 없으면 null = 제한 없음 */
  availableFx: number | null
}

export interface RegimeOrderPayload {
  company: string
  trade_date: string
  currency: FxCode
  direction: 'sell'
  amount_fx: number
  acq_rate: number | null
  trade_rate: number
  fx_pnl: number | null
  amount_krw: number
  memo: string
  created_by: string
  due_date: string
  order_type: 'regime'
}

export interface RegimeOrderShortfall {
  code: FxCode
  /** 배분 몫(외화) */
  wantFx: number
  /** 실제 등록 수량(외화) */
  gotFx: number
  reason: string
}

/** JPY 는 0자리, 그 외 2자리 — **내림**(재고를 넘겨 등록하지 않게) */
function floorFx(v: number, code: string): number {
  const f = code === 'JPY' ? 1 : 100
  return Math.floor(v * f + 1e-9) / f
}

export function buildRegimeOrderPayloads(input: {
  company: string
  allocation: FxAllocationRow[]
  info: Partial<Record<string, RegimeOrderCurrencyInfo>>
  /** 메모에 남길 판정 요약 */
  summary: { leadCode: string; regimeCode: string; levelLabel: string | null;
             targetRatio: number; currentRatio: number; asOf: string }
  createdBy: string
  today: string
  /** 같은 권고에서 나온 지시를 묶는 ID — 나중에 한 건으로 추적할 수 있게 */
  groupId: string
}): { payloads: RegimeOrderPayload[]; shortfalls: RegimeOrderShortfall[]; totalKRW: number } {
  const payloads: RegimeOrderPayload[] = []
  const shortfalls: RegimeOrderShortfall[] = []
  const due = addBizDays(input.today, 3)
  const s = input.summary
  const memoBase = `리짐 바구니 권고 [basket:${input.groupId.slice(0, 8)}] · 대표 ${s.leadCode}`
    + ` · 국면 ${s.regimeCode}${s.levelLabel ? ` · 수준 ${s.levelLabel}` : ''}`
    + ` · 목표 ${(s.targetRatio * 100).toFixed(1)}% / 현재 ${(s.currentRatio * 100).toFixed(1)}%`
    + ` (판정일 ${s.asOf})`

  for (const row of input.allocation) {
    if (row.krwAmount <= 0) continue
    const code = row.code
    if (row.nativeAmount == null || row.nativeAmount <= 0) {
      shortfalls.push({ code, wantFx: 0, gotFx: 0, reason: '환율을 알 수 없어 등록하지 않습니다' })
      continue
    }
    const rate = row.krwAmount / row.nativeAmount
    const info = input.info[code]
    const want = floorFx(row.nativeAmount, code)
    const cap = info?.availableFx
    const amount = cap != null ? Math.min(want, floorFx(Math.max(0, cap), code)) : want
    if (amount < want) {
      shortfalls.push({ code, wantFx: want, gotFx: amount,
        reason: '환전 가능 재고 부족(정기예금 만기 전 금액 제외) — 다른 통화로 넘기지 않습니다' })
    }
    if (amount <= 0) continue
    const book = info?.bookRate != null && info.bookRate > 0 ? info.bookRate : null
    payloads.push({
      company: input.company,
      trade_date: input.today,
      currency: code,
      direction: 'sell',
      amount_fx: amount,
      acq_rate: book,
      trade_rate: rate,
      fx_pnl: book != null ? Math.round((rate - book) * amount) : null,
      amount_krw: Math.round(rate * amount),
      memo: `${memoBase} · ${code} 몫 ${row.sharePct.toFixed(1)}%`,
      created_by: input.createdBy,
      due_date: due,
      order_type: 'regime',
    })
  }
  return { payloads, shortfalls, totalKRW: payloads.reduce((t, p) => t + p.amount_krw, 0) }
}
