/**
 * balanceSheet — 자금 잔액 구성의 **유일한 정본**
 *
 * ⭐ 왜 이 파일이 생겼나 (2026-10-22 실사고)
 *   통합 상황판 888.6억 / 자금일보 908.6억 / 자금흐름 분석 962.5억 — 같은 법인·같은 날의
 *   잔액이 세 화면에서 전부 달랐다. 원인은 **세 화면이 각자 더하고 있었다**는 것이다.
 *   같은 유형의 사고가 이번이 세 번째다(세션19차 외화비중 6.2% vs 27.9%,
 *   세션26차 국채 자동갱신, 이번 국채 중복).
 *
 *   그래서 "무엇을 가용으로 보고, 국채를 어떻게 세고, 언제 열려 있다고 볼지"를
 *   **여기 한 곳**에 모았다. 화면은 이 함수가 돌려준 값을 **표시만** 한다.
 *
 * ⛔ 금지
 *   · 화면·훅에서 잔액을 다시 합산하지 말 것. 필요한 구성값이 없으면 여기에 추가한다.
 *   · 국채를 `product === '국채'` 로 직접 비교하지 말 것 — isBondRecord 를 쓴다.
 *   · 보유 판정을 화면마다 다르게 두지 말 것 — OpenRule 로만 구분한다.
 *
 * ⚠ 세 화면의 "보유 판정"은 목적이 달라 **일부러** 다르게 둔다. 다른 것은 판정 규칙뿐이고,
 *   구성·합산 산식은 하나다.
 *     active-now     통합 상황판 — 지금 살아 있는 건 (현재 시점)
 *     point-in-time  자금일보   — 그 날짜에 열려 있던 건 (closed_date 기준, 보수적)
 *     analysis       자금흐름 분석 — 과거 재구성용. closed_date 가 없던 시기를 만기로 추정
 */
import { investValueKRW, isOpenOn, type ToKRWFn } from './treasuryCalc'
import { getLatestBonds } from '../hooks/useInvestments'
import type { InvestmentRecord } from '../types'

export type OpenRule = 'active-now' | 'point-in-time' | 'analysis'

/**
 * 국채 판정 — 문자열 비교 하나에 의존하지 않는다.
 *
 * ⚠ `product === '국채'` 만 보면 공백·표기 변형 한 번으로 국채가 일반 운용자금 쪽으로
 *   새어 들어가고, 그러면 기준일별 이력 행이 **전부 그대로 합산**된다(중복 집계).
 *   채권 식별자가 있으면 국채로 본다.
 */
export function isBondRecord(rec: Partial<InvestmentRecord>): boolean {
  if ((rec.product ?? '').trim() === '국채') return true
  return Boolean(rec.bondTicker || rec.bondQty)
}

/**
 * 과거 시점 개시 여부 — 분석 전용(`analysis`).
 *
 * `closed_date` 는 세션19차에 신설돼 그 이전 종료분은 전부 null 이다. 그래서 과거 구간을
 * 재구성할 때 "닫혔지만 종료일이 없는" 건을 전부 제외하면 그 시점 잔액이 통째로 빈다
 * (2026-09-09 셀바스헬스케어 — 가용 운용자금 46.5억이 0 으로 표시됨).
 * 정기예금·MMF 는 대개 만기에 끝나므로 만기일을 종료일로 **추정**한다.
 */
export interface OpenOnResult { open: boolean; inferred: boolean }

export function wasOpenOnAnalysis(
  rec: { start?: string | null; maturity?: string | null; active?: boolean | null; closed_date?: string | null },
  date: string,
): OpenOnResult {
  if (rec.start && rec.start > date) return { open: false, inferred: false }
  if (rec.closed_date) return { open: rec.closed_date > date, inferred: false }
  if (rec.active !== false) return { open: true, inferred: false }
  if (rec.maturity) return { open: rec.maturity > date, inferred: rec.maturity > date }
  return { open: false, inferred: false }
}

/** 비국채 보유 판정 */
export function isHeldOn(rec: InvestmentRecord, date: string, rule: OpenRule): boolean {
  if (rule === 'active-now')    return rec.active !== false
  if (rule === 'point-in-time') return isOpenOn(rec, date)
  return wasOpenOnAnalysis(rec, date).open
}

/**
 * 국채 보유 판정 — **규칙과 무관하게 동일**하다.
 *
 * ⚠ 국채에 만기 추정을 적용하면 안 된다. 국고채 만기는 수십 년 뒤라, 중도 매도한
 *   국채가 "만기까지 보유 중"으로 되살아난다. 종료일이 있으면 그 날짜로, 없으면
 *   active 플래그를 그대로 믿는다(통합 상황판·자금일보와 같은 기준).
 */
export function isBondHeldOn(
  rec: { active?: boolean | null; closed_date?: string | null },
  date: string,
): boolean {
  if (rec.closed_date) return rec.closed_date > date
  return rec.active !== false
}

export interface FundBalance {
  operatingKrw:     number
  /** 가용 운용자금 (국채 제외) */
  investAvailKrw:   number
  /** 가용 국채 */
  bondAvailKrw:     number
  /** 불가용 운용자금 (국채 제외) */
  investLockedKrw:  number
  /** 불가용 국채 */
  bondLockedKrw:    number

  /** 운전 + 가용운용 + 가용국채 — 통합 상황판의 '가용자금'(지분 제외) */
  availableKrw:     number
  /** 불가용 운용 + 불가용 국채 */
  lockedKrw:        number
  /** 운전 + 운용 전체 — 자금일보의 '자금 총합계', 자금 변동 이력의 총액 */
  totalKrw:         number

  /** 집계에 쓰인 국채 묶음 수 — 2 이상인데 종목이 하나면 중복 신호다 */
  bondGroupCount:   number
}

export interface FundBalanceInput {
  investments:  InvestmentRecord[]
  operatingKrw: number
  /** 기준일 (YYYY-MM-DD) */
  date:         string
  rule:         OpenRule
  toKRW:        ToKRWFn
}

/**
 * 그 시점의 자금 잔액 구성.
 *
 * ⚠ 국채는 기준일마다 **새 행이 쌓인다**(시세 이력). 종목별 최신 1건만 세지 않으면
 *   잔액이 행 수만큼 부풀어 오른다 — getLatestBonds 를 반드시 거친다.
 */
export function fundBalanceOf(input: FundBalanceInput): FundBalance {
  const { investments, operatingKrw, date, rule, toKRW } = input

  const bondRows = investments.filter(i =>
    isBondRecord(i)
    && isBondHeldOn(i, date)
    && (i.priceDate || i.start || '') !== ''
    && (i.priceDate || i.start || '') <= date)
  const bonds = getLatestBonds(bondRows.map(b =>
    // getLatestBonds 는 product==='국채' 만 본다 — 표기 변형 행도 함께 묶이도록 정규화
    b.product?.trim() === '국채' ? b : { ...b, product: '국채' }))

  const nonBonds = investments.filter(i => !isBondRecord(i) && isHeldOn(i, date, rule))

  const sum = (arr: InvestmentRecord[]) =>
    arr.reduce((s, i) => s + investValueKRW(i, toKRW), 0)
  const avail  = (arr: InvestmentRecord[]) => arr.filter(i => i.available === '가용')
  const locked = (arr: InvestmentRecord[]) => arr.filter(i => i.available !== '가용')

  const investAvailKrw  = sum(avail(nonBonds))
  const investLockedKrw = sum(locked(nonBonds))
  const bondAvailKrw    = sum(avail(bonds))
  const bondLockedKrw   = sum(locked(bonds))

  const availableKrw = operatingKrw + investAvailKrw + bondAvailKrw
  const lockedKrw    = investLockedKrw + bondLockedKrw

  return {
    operatingKrw, investAvailKrw, bondAvailKrw, investLockedKrw, bondLockedKrw,
    availableKrw, lockedKrw, totalKrw: availableKrw + lockedKrw,
    bondGroupCount: bonds.length,
  }
}

// ── 교차검증 ────────────────────────────────────────────────────────
/**
 * 같은 날짜를 **서로 다른 경로**로 계산해 맞는지 본다.
 *
 * 경로가 같은 함수를 쓰면 당연히 같으므로, 비교 대상은 **판정 규칙과 입력 레코드**다.
 *   · analysis     — 감사 로그로 복원한 레코드 (자금흐름 분석이 쓰는 값)
 *   · pointInTime  — 현재 레코드 + closed_date 판정 (자금일보가 쓰는 기준)
 *   · activeNow    — 현재 살아 있는 건만 (통합 상황판 기준. 기말이 최신일 때만 유효)
 *
 * ⚠ 틀렸다는 사실을 사람이 눈으로 찾게 두지 말 것 — 이번 사고를 팀장이 육안으로 발견했다.
 */
export interface BalanceCrossCheck {
  analysis:    FundBalance
  pointInTime: FundBalance
  activeNow:   FundBalance | null
  /** 가장 큰 불일치 금액(원). 0 이면 모든 경로가 일치 */
  maxDiffKrw:  number
  /** 허용 오차(원) 초과 여부 */
  mismatch:    boolean
}

/** 반올림·환율 소수점 차이를 흡수할 허용 오차 */
export const CROSSCHECK_TOLERANCE_KRW = 10_000

export function crossCheckBalance(params: {
  restoredInvestments: InvestmentRecord[]
  currentInvestments:  InvestmentRecord[]
  operatingKrw: number
  date: string
  toKRW: ToKRWFn
  /** 기말이 최신 영업일일 때만 activeNow 비교가 의미 있다 */
  compareActiveNow: boolean
}): BalanceCrossCheck {
  const { restoredInvestments, currentInvestments, operatingKrw, date, toKRW } = params
  const analysis    = fundBalanceOf({ investments: restoredInvestments, operatingKrw, date, rule: 'analysis',      toKRW })
  const pointInTime = fundBalanceOf({ investments: currentInvestments,  operatingKrw, date, rule: 'point-in-time', toKRW })
  const activeNow   = params.compareActiveNow
    ? fundBalanceOf({ investments: currentInvestments, operatingKrw, date, rule: 'active-now', toKRW })
    : null

  const totals = [analysis.totalKrw, pointInTime.totalKrw, ...(activeNow ? [activeNow.totalKrw] : [])]
  const maxDiffKrw = Math.max(...totals) - Math.min(...totals)
  return { analysis, pointInTime, activeNow, maxDiffKrw, mismatch: maxDiffKrw > CROSSCHECK_TOLERANCE_KRW }
}
