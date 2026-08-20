/** 외화 로트와 FIFO 계산 — UI/DB에 의존하지 않는 순수 함수 */
export type FxCostMethod = 'FIFO' | 'WAVG'
/**
 * 계좌 유형
 *   demand_deposit — 보통예금. 즉시 환전 가능
 *   mmda           — 수시입출식 고금리 예금(Money Market Deposit Account).
 *                    **환전 가능성은 보통예금과 동일**하고 이자율만 붙는다. 만기 없음.
 *   term_deposit   — 정기예금. **만기일 전에는 환전 불가**
 */
export type FxAccountType = 'demand_deposit' | 'term_deposit' | 'mmda'

/** 만기 잠금이 걸리는 유형 — 여기 없는 유형은 즉시 환전 가능하다 */
export const LOCKED_ACCOUNT_TYPES: readonly FxAccountType[] = ['term_deposit']

export const ACCOUNT_TYPE_LABEL: Record<FxAccountType, string> = {
  demand_deposit: '보통예금',
  mmda:           'MMDA(수시입출)',
  term_deposit:   '정기예금',
}

export interface FxLot {
  id: string
  company: string
  currency: string
  acquiredDate: string
  originalAmount: number
  remainingAmount: number
  acqRate: number
  accountType: FxAccountType
  annualInterestRate: number
  maturityDate?: string | null
  sourceType: 'opening' | 'daily_report_item' | 'manual' | 'adjustment'
  sourceId?: string | null
  memo?: string | null
}

/**
 * 이 로트를 asOfDate 시점에 환전할 수 있는가.
 *
 * ⚠ 과거 구현은 `accountType === 'demand_deposit'` 를 화이트리스트로 썼다.
 *   그러면 mmda 처럼 새 유형이 추가될 때마다 **조용히 잠긴 것으로 취급**되어
 *   환전 가능액이 과소 계산된다. 잠기는 유형(term_deposit)만 명시하는 쪽으로 뒤집는다.
 */
export function isLotAvailable(lot: Pick<FxLot, 'accountType' | 'maturityDate'>, asOfDate: string): boolean {
  if (!LOCKED_ACCOUNT_TYPES.includes(lot.accountType)) return true
  return !!lot.maturityDate && lot.maturityDate <= asOfDate
}

export function availableAmount(lots: FxLot[], asOfDate: string): number {
  return lots.filter(lot => isLotAvailable(lot, asOfDate))
    .reduce((sum, lot) => sum + Math.max(0, lot.remainingAmount), 0)
}

/** 단리 기준 예상 이자. 이자 입금 전에는 FIFO 원금에 합치지 않는다. */
export function expectedTermInterestFx(lot: FxLot): number {
  if (lot.accountType !== 'term_deposit' || !lot.maturityDate || lot.annualInterestRate <= 0) return 0
  const start = Date.parse(`${lot.acquiredDate}T00:00:00Z`)
  const end = Date.parse(`${lot.maturityDate}T00:00:00Z`)
  const days = Math.max(0, (end - start) / 86_400_000)
  return lot.originalAmount * (lot.annualInterestRate / 100) * days / 365
}

export interface FxLotConsumptionPreview {
  lotId: string
  acquiredDate: string
  amount: number
  acqRate: number
  disposalRate: number
  realizedPnlKRW: number
}

export function remainingAmount(lots: Pick<FxLot, 'remainingAmount'>[]): number {
  return lots.reduce((sum, lot) => sum + Math.max(0, lot.remainingAmount), 0)
}

export function weightedBookRate(lots: Pick<FxLot, 'remainingAmount' | 'acqRate'>[]): number | null {
  const amount = remainingAmount(lots)
  if (amount <= 0) return null
  return lots.reduce((sum, lot) => sum + Math.max(0, lot.remainingAmount) * lot.acqRate, 0) / amount
}

export function unrealizedPnlKRW(
  lots: Pick<FxLot, 'remainingAmount' | 'acqRate'>[],
  marketRate: number,
): number {
  return lots.reduce(
    (sum, lot) => sum + Math.max(0, lot.remainingAmount) * (marketRate - lot.acqRate),
    0,
  )
}

/**
 * 계좌유형 소진 우선순위 파싱 (세션26차 11일차).
 *
 * `policy_params.fx_fifo_account_priority`(param_text, 예: `"demand_deposit,mmda"`)를
 * 순번 맵으로 바꾼다. 목록에 없는 유형은 999(항상 뒤). 빈 값이면 전부 999 →
 * **정렬에 영향이 없어 현행(순수 취득일 FIFO)과 동일**하다.
 *
 * ⚠ 서버 RPC(`fx_fifo_account_rank`, docs/db/fx_fifo_account_priority.sql)와 반드시
 *   같은 규칙이어야 한다 — 한쪽만 바꾸면 미리보기와 실제 소진 결과가 갈라진다.
 */
export function parseAccountPriority(text: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  if (!text) return out
  text.split(',').map(s => s.trim()).filter(Boolean)
    .forEach((t, i) => { if (!(t in out)) out[t] = i + 1 })
  return out
}

const rankOf = (priority: Record<string, number> | undefined, t: FxAccountType) =>
  priority?.[t] ?? 999

export function previewFifoConsumption(
  lots: FxLot[],
  requestedAmount: number,
  disposalRate: number,
  asOfDate = '9999-12-31',
  /** 계좌유형 소진 우선순위 (parseAccountPriority 결과). 없으면 취득일 순만 적용 */
  accountPriority?: Record<string, number>,
): FxLotConsumptionPreview[] {
  let remaining = Math.max(0, requestedAmount)
  const ordered = [...lots]
    .filter(lot => lot.remainingAmount > 0 && isLotAvailable(lot, asOfDate))
    .sort((a, b) =>
      rankOf(accountPriority, a.accountType) - rankOf(accountPriority, b.accountType)
      || a.acquiredDate.localeCompare(b.acquiredDate) || a.id.localeCompare(b.id))
  const rows: FxLotConsumptionPreview[] = []

  for (const lot of ordered) {
    if (remaining <= 1e-8) break
    const amount = Math.min(remaining, lot.remainingAmount)
    rows.push({
      lotId: lot.id,
      acquiredDate: lot.acquiredDate,
      amount,
      acqRate: lot.acqRate,
      disposalRate,
      realizedPnlKRW: amount * (disposalRate - lot.acqRate),
    })
    remaining -= amount
  }
  return rows
}

/** FIFO 소진 결과. 원본 로트는 변경하지 않는다. */
export function consumeFifoLots(lots: FxLot[], requestedAmount: number, disposalRate: number, asOfDate = '9999-12-31',
  accountPriority?: Record<string, number>) {
  const consumptions = previewFifoConsumption(lots, requestedAmount, disposalRate, asOfDate, accountPriority)
  const usedById = new Map(consumptions.map(row => [row.lotId, row.amount]))
  const nextLots = lots.map(lot => ({
    ...lot,
    remainingAmount: Math.max(0, lot.remainingAmount - (usedById.get(lot.id) ?? 0)),
  }))
  const consumedAmount = consumptions.reduce((sum, row) => sum + row.amount, 0)
  const realizedPnlKRW = consumptions.reduce((sum, row) => sum + row.realizedPnlKRW, 0)
  const consumedBookRate = consumedAmount > 0
    ? consumptions.reduce((sum, row) => sum + row.amount * row.acqRate, 0) / consumedAmount
    : null
  return { nextLots, consumptions, consumedAmount, realizedPnlKRW, consumedBookRate }
}
