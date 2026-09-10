/**
 * 정기예금 연장(rollover) 계산 (2026-09-09)
 *
 * ⭐ 연장을 "기존 레코드 수정"으로 처리하면 개시일·만기일이 덮어써져 **과거가 지워진다.**
 *   지금 DB 만 보면 "그 예금은 8/21에 시작했다"가 되어, 6월 잔액을 재구성할 때
 *   통째로 사라진다(2026-09-09 셀바스헬스케어 외화 정기예금 실사례).
 *
 *   → 기존 건을 **종료**하고 새 건을 **생성**한다. 종료된 건은 closed_date 로 그 시점까지
 *     살아 있고, 새 건은 개시일부터 잡힌다. 과거가 구조적으로 보존돼 복원이 필요 없다.
 *
 * 이 파일은 DB 를 모르는 순수 계산만 담는다 — 그래야 테스트로 검증할 수 있다.
 */
import type { InvestmentRecord } from '../types'

export interface RolloverOptions {
  /** 기존 건의 종료일 = 새 건의 개시일. 보통 기존 만기일. */
  closeDate: string
  newMaturity: string
  newAmount: number
  newRate: number
}

export interface RolloverPlan {
  /** 기존 건 — 이 날짜로 종료 처리한다 */
  closeId: string
  closeDate: string
  /** 새로 만들 건 */
  next: InvestmentRecord
}

/**
 * 연장 계획을 만든다. 잘못된 입력이면 사유 문자열을 돌려준다(예외를 던지지 않는다).
 *
 * ⚠ 개시일 = 종료일로 맞춘다. 하루라도 벌어지면 그 사이 잔액이 비고,
 *   겹치면 이중 계상된다. 연속성이 이 기능의 핵심이다.
 */
export function planRollover(
  record: InvestmentRecord,
  opts: RolloverOptions,
  newId: string,
): RolloverPlan | { error: string } {
  if (!opts.closeDate)   return { error: '종료일을 입력하세요.' }
  if (!opts.newMaturity) return { error: '새 만기일을 입력하세요.' }
  if (opts.newMaturity <= opts.closeDate) {
    return { error: '새 만기일은 개시일보다 뒤여야 합니다.' }
  }
  if (!(opts.newAmount > 0)) return { error: '연장 금액은 0보다 커야 합니다.' }
  if (record.product === '국채') {
    return { error: '국채는 연장 대상이 아닙니다.' }
  }
  if (record.start && opts.closeDate < record.start) {
    return { error: '종료일은 기존 개시일보다 앞설 수 없습니다.' }
  }

  return {
    closeId: record.id,
    closeDate: opts.closeDate,
    next: {
      ...record,
      id: newId,
      amount: opts.newAmount,
      rate: opts.newRate,
      // 새 건의 개시일 = 기존 건의 종료일 (연속)
      start: opts.closeDate,
      maturity: opts.newMaturity,
      active: true,
      closed_date: null,
    },
  }
}

export function isRolloverError(
  r: RolloverPlan | { error: string },
): r is { error: string } {
  return 'error' in r
}

/** 연장으로 늘어난 금액 = 이자 재예치분 */
export function rolloverInterest(record: InvestmentRecord, newAmount: number): number {
  return newAmount - (record.amount ?? 0)
}
