/**
 * 자금흐름 브릿지 — 기초 → 기말 증감의 분해 (2026-09-08, Phase 1)
 *
 * 분석 대상은 **가용운전 + 가용운용** 두 가지로 국한한다(2026-09-08 사용자 결정).
 * 지분·국채는 범위 밖이며, 그쪽으로 나가고 들어온 돈은 '범위 밖 자산' 유출입으로 잡는다.
 *
 * ⭐ 경계(boundary) 개념이 이 모듈의 핵심이다.
 *   대상을 둘로 좁히는 순간 **운전 ↔ 운용 이동은 순증감이 0** 이 된다.
 *   보통예금 10억으로 정기예금을 들면 운전이 10억 줄고 운용이 10억 늘어 합계는 그대로다.
 *   이것을 '투자 유출'로 세면 실제로 줄지 않은 자금이 줄어든 것처럼 보인다.
 *   → 항목을 **경계를 넘었는가**로 분류한다:
 *       외부유입 / 외부유출 = 경계를 넘어 들어오거나 나간 것 (순증감에 반영)
 *       내부이동            = 운전 ↔ 운용 (합계 불변, 별도 표시)
 *
 * ⚠ SSOT — 잔액·가용 판정은 여기서 새로 만들지 않는다. `treasuryCalc` 의
 *   opCashKRW / wasOpenOn / investValueKRW 를 그대로 쓴다. 대시보드와 같은 숫자가 나와야 한다.
 *
 * ⚠ 맞지 않는 차액은 숨기지 않는다. 좌변(관측된 잔액 증감)과 우변(항목 합계)의 차이는
 *   `unexplained` 로 그대로 남긴다 — 그 숫자가 곧 "어느 날 일보가 비었는지"를 알려준다.
 */
import { opCashKRW, investValueKRW, isOpenOn, type ToKRWFn } from './treasuryCalc'
import { getLatestBonds } from '../hooks/useInvestments'
import type { DailyRecord, InvestmentRecord } from '../types'

// ── 항목 분류 ────────────────────────────────────────────────
export type FlowGroup =
  | 'operating'   // 영업활동 — 매출채권 회수, 미지급금 지급 등
  | 'financing'   // 재무활동 — 차입 실행·상환
  | 'external'    // 범위 밖 자산 — 지분·국채 취득/처분 (경계를 넘는 투자)
  | 'internal'    // 내부이동 — 운전 ↔ 운용 (합계 불변)
  | 'excluded'    // 분해 대상 아님 — 평가손익 자동기재(현금 이동 없음)
  | 'unknown'     // 연동 정보가 없어 경계 판정 불가

export const FLOW_GROUP_LABEL: Record<FlowGroup, string> = {
  operating: '영업활동',
  financing: '재무활동',
  external:  '범위 밖 자산',
  internal:  '내부이동',
  excluded:  '분해 제외',
  unknown:   '분류 불가',
}

/** 이 카테고리는 항상 이 그룹 — 연동 정보와 무관하게 확정되는 것들 */
const FIXED_GROUP: Record<string, FlowGroup> = {
  ar_collection:    'operating',
  other_receivable: 'operating',
  govt_fund:        'operating',
  advance_in:       'operating',
  interest_income:  'operating',
  other_in:         'operating',
  ap_payment:       'operating',
  trade_ap_payment: 'operating',
  advance_out:      'operating',
  interest_expense: 'operating',
  enote_payment:    'operating',
  other_out:        'operating',
  loan_drawdown:    'financing',
  loan_repayment:   'financing',
  // 지분·국채 평가손익 자동기재 — 현금이 움직이지 않는다. 게다가 대상은 범위 밖이다.
  invest_eval_in:   'excluded',
  invest_eval_out:  'excluded',
}

export interface FlowItemInput {
  id: string
  date: string          // 귀속일 (보고대상일)
  direction: 'in' | 'out'
  category: string
  amountKrw: number     // 원화 환산액 (현재 시세 기준으로 호출부가 환산)
  currency: string
  memo?: string | null
  linkedType?: string | null   // 'investment' | 'loan' | 'equity' | null
  linkedId?: string | null
}

/**
 * 투자 항목(invest_execute / invest_return)의 경계 판정.
 *
 * 운용자금(국채 제외)으로 들어가거나 나온 것 = 내부이동
 * 지분·비상장·국채 = 범위 밖 자산
 * 연동 정보가 없으면 판정 불가 — 추측하지 않는다.
 *
 * ⚠ linked_type/linked_id 는 2026-08-05 이전 자금일보에서 조용히 유실됐다(세션20차).
 *   그 시기 항목은 unknown 으로 남고 화면이 그 사실을 그대로 표시한다.
 */
export function classifyInvestItem(
  item: FlowItemInput,
  investById: Map<string, InvestmentRecord>,
): FlowGroup {
  if (item.linkedType === 'equity') return 'external'
  if (item.linkedType === 'investment' && item.linkedId) {
    const inv = investById.get(item.linkedId)
    if (!inv) return 'unknown'
    return inv.product === '국채' ? 'external' : 'internal'
  }
  return 'unknown'
}

export function classifyItem(
  item: FlowItemInput,
  investById: Map<string, InvestmentRecord>,
): FlowGroup {
  const fixed = FIXED_GROUP[item.category]
  if (fixed) return fixed
  if (item.category === 'invest_execute' || item.category === 'invest_return') {
    return classifyInvestItem(item, investById)
  }
  return 'unknown'
}

// ── 잔액(좌변) ───────────────────────────────────────────────
export interface ScopeBalance {
  operatingKrw: number   // 가용운전 = daily 원화 3계정 + 외화 환산
  investKrw:    number   // 가용운용 = 국채 제외, 가용, 그 시점에 열려 있던 건
  total:        number
}

/**
 * 특정 시점의 대상 잔액.
 * ⚠ investments 는 "오늘 활성" 목록을 과거 날짜에 그대로 적용하면 안 된다
 *   — isOpenOn() 으로 개시일·해지일을 모두 보고 판정한다(세션19차 소급변경 버그).
 * ⚠ 운전자금은 opCashKRW 가 **저장된 fx_krw**(그날 환율로 환산된 값)를 쓴다.
 *   과거 시점 분석에는 이게 맞다 — 오늘 환율을 과거 잔액에 적용하면 안 된다.
 */
export function scopeBalanceOn(
  daily: DailyRecord | null,
  invests: InvestmentRecord[],
  date: string,
  toKRW: ToKRWFn,
): ScopeBalance {
  const operatingKrw = daily ? opCashKRW(daily) : 0
  const investKrw = invests
    .filter(i => i.product !== '국채')
    .filter(i => i.available === '가용')
    .filter(i => isOpenOn(i, date))
    .reduce((s, i) => s + investValueKRW(i, toKRW), 0)
  return { operatingKrw, investKrw, total: operatingKrw + investKrw }
}

// ── 브릿지 ───────────────────────────────────────────────────
export interface CategoryFlow {
  category: string
  group:    FlowGroup
  inKrw:    number
  outKrw:   number
  net:      number
  count:    number
}

export interface FlowBridge {
  from: string
  to:   string
  opening: ScopeBalance
  closing: ScopeBalance
  /** 관측된 증감 (좌변) */
  observed: number
  /** 경계를 넘은 순증감 (우변 합계, 내부이동 제외) */
  explained: number
  /** 좌변 − 우변. 일보 미작성·입력 누락이 여기 모인다. */
  unexplained: number
  /** 환율효과 — Phase 2 에서 채운다. 지금은 미설명 차액에 포함돼 있다. */
  fxEffect: number | null
  /**
   * 레인별 분해 — 총 증감 = 운전 증감 + 운용 증감 (잔액에서 오는 항등식).
   *   운전 = 자금일보 항목으로 설명 (없으면 미설명으로 남는다)
   *   운용 = 운용자금 레코드(개시·해지)로 설명 — 자금일보와 무관하게 항상 잡힌다
   * ⚠ 두 레인은 서로 상쇄하지 않는다. 보통예금으로 정기예금을 들면
   *   운전 레인에 내부이동 유출, 운용 레인에 개시 유입으로 각각 잡히고 합이 0이 된다.
   */
  lanes: {
    opDelta: number
    opExplained: number
    opUnexplained: number
    investDelta: number
    investExplained: number
    investAdjust: number
    /** 국채 평가 — 시가 변동이라 현금이 움직인 게 아니다 */
    bondDelta: number
    /** 불가용 운용자금 증감 */
    lockedDelta: number
  }
  /** 총액 기준 잔액 (운전 + 운용 전체) — 자금 변동 이력과 같은 정의 */
  openingFull: number
  closingFull: number
  openingBreakdown: InvestBreakdown
  closingBreakdown: InvestBreakdown
  groups: Record<FlowGroup, { inKrw: number; outKrw: number; net: number; count: number }>
  categories: CategoryFlow[]
  /** 설명률 = |explained| / (|explained| + |unexplained|) */
  coverage: number
}

const EMPTY_GROUP = () => ({ inKrw: 0, outKrw: 0, net: 0, count: 0 })

export function buildBridge(params: {
  from: string
  to: string
  opening: ScopeBalance
  closing: ScopeBalance
  items: FlowItemInput[]
  investById: Map<string, InvestmentRecord>
  /** 운용자금 레코드에서 도출한 순증감(개시−해지). investDeltas().net */
  investFlowNet?: number
  /** 총액 기준 구성 — 국채·불가용까지 포함해야 자금 변동 이력과 맞는다 */
  openingBreakdown: InvestBreakdown
  closingBreakdown: InvestBreakdown
}): FlowBridge {
  const {
    from, to, opening, closing, items, investById, investFlowNet = 0,
    openingBreakdown, closingBreakdown,
  } = params

  const groups: FlowBridge['groups'] = {
    operating: EMPTY_GROUP(), financing: EMPTY_GROUP(), external: EMPTY_GROUP(),
    internal:  EMPTY_GROUP(), excluded:  EMPTY_GROUP(), unknown:  EMPTY_GROUP(),
  }
  const catMap = new Map<string, CategoryFlow>()

  for (const it of items) {
    const group = classifyItem(it, investById)
    const amt = Math.abs(it.amountKrw)
    const g = groups[group]
    if (it.direction === 'in') g.inKrw += amt
    else g.outKrw += amt
    g.net = g.inKrw - g.outKrw
    g.count += 1

    const key = `${group}:${it.category}`
    const cur = catMap.get(key) ?? { category: it.category, group, inKrw: 0, outKrw: 0, net: 0, count: 0 }
    if (it.direction === 'in') cur.inKrw += amt
    else cur.outKrw += amt
    cur.net = cur.inKrw - cur.outKrw
    cur.count += 1
    catMap.set(key, cur)
  }

  // ── 레인별 분해 ────────────────────────────────────────────
  // 운전 레인: 자금일보 항목으로 설명한다. 운용으로 나간 내부이동도 운전 입장에선 실제 유출이다.
  const opDelta = closing.operatingKrw - opening.operatingKrw
  const opExplained =
    groups.operating.net + groups.financing.net + groups.external.net + groups.internal.net
  const opUnexplained = opDelta - opExplained

  // 운용 레인: 레코드(개시·해지)로 설명한다. 자금일보를 거치지 않고 등록돼도 잡힌다.
  const investDelta = closingBreakdown.availKrw - openingBreakdown.availKrw
  const investAdjust = investDelta - investFlowNet

  // 국채 평가·불가용 증감은 잔액에서 그대로 관측된다 — 원인이 분명하므로 설명된 것으로 본다.
  const bondDelta   = closingBreakdown.bondKrw   - openingBreakdown.bondKrw
  const lockedDelta = closingBreakdown.lockedKrw - openingBreakdown.lockedKrw

  // ⭐ 총액 기준 — 자금 변동 이력과 같은 정의여야 사용자가 두 화면을 대조할 수 있다.
  const openingFull = opening.operatingKrw + openingBreakdown.allKrw
  const closingFull = closing.operatingKrw + closingBreakdown.allKrw

  const observed = closingFull - openingFull
  const explained = opExplained + investFlowNet + bondDelta + lockedDelta
  const unexplained = opUnexplained + investAdjust

  const denom = Math.abs(explained) + Math.abs(unexplained)
  const coverage = denom === 0 ? 1 : Math.abs(explained) / denom

  return {
    from, to, opening, closing,
    observed, explained, unexplained,
    fxEffect: null,
    lanes: {
      opDelta, opExplained, opUnexplained,
      investDelta, investExplained: investFlowNet, investAdjust,
      bondDelta, lockedDelta,
    },
    openingFull, closingFull, openingBreakdown, closingBreakdown,
    groups,
    categories: [...catMap.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    coverage,
  }
}

// ── 범위에서 뺀 금액 (표시 전용) ─────────────────────────────
/**
 * 자금 변동 이력(HistoryPage)의 '운용자금'은 국채·불가용까지 전부 더한 값이다.
 * 이 화면은 대상을 가용운용으로 좁혔으므로 두 숫자가 다를 수밖에 없다.
 * 그 차이를 화면에 밝혀 "누락된 것 아닌가" 하는 의심을 없앤다.
 */
export interface ExcludedBalance { bondKrw: number; lockedKrw: number; total: number }

export function excludedBalanceOn(
  invests: InvestmentRecord[],
  date: string,
  toKRW: ToKRWFn,
): ExcludedBalance {
  const open = invests.filter(i => isOpenOn(i, date))
  // ⚠ 국채는 기준일마다 새 행이 쌓인다(시세 이력). 종목별 최신 1건만 세지 않으면
  //   보유액이 수 배로 부풀려진다(세션19차 6.2% vs 27.9% 사고와 같은 유형).
  const bondKrw = getLatestBonds(open)
    .reduce((s, i) => s + investValueKRW(i, toKRW), 0)
  const lockedKrw = open
    .filter(i => i.product !== '국채' && i.available !== '가용')
    .reduce((s, i) => s + investValueKRW(i, toKRW), 0)
  return { bondKrw, lockedKrw, total: bondKrw + lockedKrw }
}

// ── 운용자금 레코드에서 도출한 증감 ──────────────────────────
/**
 * ⭐ 운용자금 증감을 자금일보 항목만으로 설명하려 하면 안 된다.
 *   운용자금은 자금일보 연동 팝업이 아니라 **운용자금 메뉴에서 직접 등록**되는 경우가
 *   훨씬 많다. 그러면 잔액은 늘었는데 그것을 설명할 항목이 없어 전부 '미설명'으로 빠진다
 *   (세션27차에 자금일보 자금현황에서 똑같은 문제를 겪었다 — 그때의 결론도
 *    "행의 입출금액을 linked_id 로만 채우지 말고 레코드에서 도출하라" 였다).
 *
 * 그래서 기간 중 **개시·해지된 건을 레코드에서 직접 뽑아** 보여준다.
 * 자금의 출처(운전에서 왔는지, 국채 만기에서 왔는지)까지는 레코드만으로 알 수 없으므로
 * 단정하지 않고, "어떤 건이 새로 생겼고 어떤 건이 닫혔는지"를 그대로 나열한다.
 */
export interface InvestDelta {
  id: string
  label: string       // 은행 · 상품
  date: string
  amountKrw: number
  kind: 'opened' | 'closed'
}

export function investDeltas(
  invests: InvestmentRecord[],
  from: string,
  to: string,
  toKRW: ToKRWFn,
): { opened: InvestDelta[]; closed: InvestDelta[]; openedKrw: number; closedKrw: number; net: number } {
  const inScope = (i: InvestmentRecord) => i.product !== '국채' && i.available === '가용'
  const label = (i: InvestmentRecord) => `${i.bank || '-'} · ${i.product || '-'}`

  const opened = invests
    .filter(i => inScope(i) && i.start && i.start > from && i.start <= to)
    .map(i => ({ id: i.id, label: label(i), date: i.start, amountKrw: investValueKRW(i, toKRW), kind: 'opened' as const }))

  const closed = invests
    .filter(i => inScope(i) && i.closed_date && i.closed_date > from && i.closed_date <= to)
    .map(i => ({ id: i.id, label: label(i), date: i.closed_date as string, amountKrw: investValueKRW(i, toKRW), kind: 'closed' as const }))

  const openedKrw = opened.reduce((s, d) => s + d.amountKrw, 0)
  const closedKrw = closed.reduce((s, d) => s + d.amountKrw, 0)
  return { opened, closed, openedKrw, closedKrw, net: openedKrw - closedKrw }
}

/**
 * 그 시점의 운용자금 구성 — 가용 / 국채 / 불가용으로 나눠 돌려준다.
 *
 * ⭐ 잔액의 정본은 **자금 변동 이력과 같은 총액**이다(2026-09-08 사용자 결정).
 *   분석 대상을 좁혀 놓고 잔액까지 좁히면 다른 화면과 숫자가 갈라져 아무도 못 믿는다.
 *   총액으로 시계열을 만들고, 그 증감을 자금일보·운용자금 개시/해지로 **설명**한다.
 *
 * ⚠ 8월에 해지한 예금도 6월에는 존재했다 — 과거 잔액에는 반드시 포함돼야 한다.
 *   그래서 현재 active 플래그가 아니라 isOpenOn(개시일·해지일)으로 판정한다.
 */
export interface InvestBreakdown {
  availKrw:  number   // 가용 운용자금 (국채 제외)
  bondKrw:   number   // 국채 (종목별 최신 기준가)
  lockedKrw: number   // 불가용 운용자금 (국채 제외)
  allKrw:    number   // 셋의 합 = 자금 변동 이력의 '운용자금'
}

export function investBreakdownOn(
  invests: InvestmentRecord[],
  date: string,
  toKRW: ToKRWFn,
): InvestBreakdown {
  // 국채는 기준일마다 행이 쌓이므로 그 시점까지의 행 중 종목별 최신 1건만 센다
  const bondsUpTo = invests.filter(i =>
    i.product === '국채' && (i.priceDate || i.start || '') !== '' && (i.priceDate || i.start || '') <= date)
  const bondKrw = getLatestBonds(bondsUpTo)
    .reduce((sum, i) => sum + investValueKRW(i, toKRW), 0)

  const nonBond = invests.filter(i => i.product !== '국채' && isOpenOn(i, date))
  const availKrw  = nonBond.filter(i => i.available === '가용')
    .reduce((sum, i) => sum + investValueKRW(i, toKRW), 0)
  const lockedKrw = nonBond.filter(i => i.available !== '가용')
    .reduce((sum, i) => sum + investValueKRW(i, toKRW), 0)

  return { availKrw, bondKrw, lockedKrw, allKrw: availKrw + bondKrw + lockedKrw }
}

/**
 * 그 시점의 **운용자금 전체** 원화액 — 국채·불가용까지 포함.
 * 자금 변동 이력(HistoryPage) 의 '운용자금' 열과 같은 정의라 그 화면과 직접 대조된다.
 *
 * ⚠ 국채는 기준일마다 새 행이 쌓이므로 종목별 최신 1건만 센다(getLatestBonds).
 * ⚠ 비국채는 isOpenOn 으로 그 시점 개시·해지를 판정한다.
 *   자금 변동 이력은 과거 날짜에도 **현재 active 플래그**를 적용하므로,
 *   나중에 해지된 건이 있으면 그 화면이 과거를 과소 표시한다(이쪽이 맞다).
 */
export function totalInvestKRWOn(
  invests: InvestmentRecord[],
  date: string,
  toKRW: ToKRWFn,
): number {
  return investBreakdownOn(invests, date, toKRW).allKrw
}

// ── 일자별 증감 원장 (레코드 기반) ──────────────────────────
/**
 * ⭐ 자금일보 항목이 아니라 **운전자금·운용자금 입력 이력 자체**로 증감을 맞춘다
 *   (2026-09-08 사용자 지적). 잔액 데이터가 곧 입력 이력이므로 이 방식은
 *   좌변·우변이 구조적으로 항상 일치한다 — 미설명 차액이 생길 수 없다.
 *
 *   운전 증감 = daily[d] − daily[직전 영업일]      (운전자금 입력 이력)
 *   운용 증감 = 그날 개시된 건 − 그날 해지된 건    (운용자금 입력 이력)
 *              + 기타 조정(금액 수정 등 레코드로 설명되지 않는 나머지)
 *
 *   자금일보 항목은 여기에 **덧붙는 설명**이지 잔액의 근거가 아니다.
 */
export interface DailyLedgerRow {
  date: string
  opCash: number
  opDelta: number
  investKrw: number
  investDelta: number
  total: number
  totalDelta: number
  opened: InvestDelta[]
  closed: InvestDelta[]
  /** 운용 증감 중 개시·해지로 설명되지 않는 나머지 (금액 수정·가용 전환 등) */
  investAdjust: number
  /** 그날 자금일보 항목 수 — 운전 증감의 설명 여부 판단용 */
  itemCount: number
  itemNetKrw: number
  /** 운용자금 구성 (가용/국채/불가용) */
  breakdown: InvestBreakdown
  /** 국채 증감 — 시가 변동이라 현금 흐름이 아니다 */
  bondDelta: number
  /** 불가용 증감 */
  lockedDelta: number
  /** 운전 + 운용 전체 = 자금 변동 이력의 총액 (이 화면 잔액의 정본) */
  allTotal: number
  /** 총액 증감 — 이 화면이 설명해야 할 값 */
  allDelta: number
}

export function buildDailyLedger(params: {
  dailies: DailyRecord[]              // 기간 내, 날짜 오름차순
  openingDaily: DailyRecord | null    // from 직전 영업일
  invests: InvestmentRecord[]
  toKRW: ToKRWFn
  itemsByDate: Map<string, { count: number; net: number }>
}): DailyLedgerRow[] {
  const { dailies, openingDaily, invests, toKRW, itemsByDate } = params
  if (!dailies.length) return []

  const seq = openingDaily ? [openingDaily, ...dailies] : dailies
  const rows: DailyLedgerRow[] = []

  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1]
    const cur  = seq[i]
    const prevBal = scopeBalanceOn(prev, invests, prev.date, toKRW)
    const curBal  = scopeBalanceOn(cur,  invests, cur.date,  toKRW)

    // 그날 개시·해지된 in-scope 운용 건
    const day = investDeltas(invests, prev.date, cur.date, toKRW)
    const investDelta = curBal.investKrw - prevBal.investKrw

    const it = itemsByDate.get(cur.date) ?? { count: 0, net: 0 }
    const bdPrev = investBreakdownOn(invests, prev.date, toKRW)
    const bdCur  = investBreakdownOn(invests, cur.date,  toKRW)
    const allTotalPrev = prevBal.operatingKrw + bdPrev.allKrw
    const allTotalCur  = curBal.operatingKrw  + bdCur.allKrw

    rows.push({
      date: cur.date,
      opCash: curBal.operatingKrw,
      opDelta: curBal.operatingKrw - prevBal.operatingKrw,
      investKrw: curBal.investKrw,
      investDelta,
      total: curBal.total,
      totalDelta: curBal.total - prevBal.total,
      opened: day.opened,
      closed: day.closed,
      investAdjust: investDelta - day.net,
      itemCount: it.count,
      itemNetKrw: it.net,
      breakdown: bdCur,
      bondDelta:   bdCur.bondKrw   - bdPrev.bondKrw,
      lockedDelta: bdCur.lockedKrw - bdPrev.lockedKrw,
      allTotal: allTotalCur,
      allDelta: allTotalCur - allTotalPrev,
    })
  }
  return rows
}

/**
 * 통화별 환율효과가 표시 대상인지 — 원화 환산 1천만원 미만은 무시한다
 * (2026-09-08 사용자 기준). Phase 2 에서 쓴다.
 */
export const FX_EFFECT_THRESHOLD_KRW = 10_000_000

export function isMaterialFxEffect(effectKrw: number): boolean {
  return Math.abs(effectKrw) >= FX_EFFECT_THRESHOLD_KRW
}
