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
}): FlowBridge {
  const { from, to, opening, closing, items, investById } = params

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

  // 경계를 넘은 것만 순증감에 반영한다.
  // internal(운전↔운용)은 합계가 변하지 않고, excluded(평가손익)는 현금이 아니다.
  // unknown 은 경계 판정을 못 했으므로 설명에 넣지 않는다 — 넣으면 틀린 값을 확정해 버린다.
  const explained =
    groups.operating.net + groups.financing.net + groups.external.net

  const observed = closing.total - opening.total
  const unexplained = observed - explained

  const denom = Math.abs(explained) + Math.abs(unexplained)
  const coverage = denom === 0 ? 1 : Math.abs(explained) / denom

  return {
    from, to, opening, closing,
    observed, explained, unexplained,
    fxEffect: null,
    groups,
    categories: [...catMap.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    coverage,
  }
}

/**
 * 통화별 환율효과가 표시 대상인지 — 원화 환산 1천만원 미만은 무시한다
 * (2026-09-08 사용자 기준). Phase 2 에서 쓴다.
 */
export const FX_EFFECT_THRESHOLD_KRW = 10_000_000

export function isMaterialFxEffect(effectKrw: number): boolean {
  return Math.abs(effectKrw) >= FX_EFFECT_THRESHOLD_KRW
}
