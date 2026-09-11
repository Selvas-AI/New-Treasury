import { describe, it, expect } from 'vitest'
import { defaultAccountTypeFor, ACCOUNT_LABELS } from './accountLabels'

describe('defaultAccountTypeFor — 통화로 계좌구분 추론', () => {
  it('원화는 보통예금/CMA 로 본다', () => {
    expect(defaultAccountTypeFor('KRW')).toBe('krw_demand')
    expect(defaultAccountTypeFor('')).toBe('krw_demand')
    expect(defaultAccountTypeFor(null)).toBe('krw_demand')
  })

  it('외화는 해당 통화 행으로 간다', () => {
    expect(defaultAccountTypeFor('USD')).toBe('fx_usd')
    expect(defaultAccountTypeFor('JPY')).toBe('fx_jpy')
    expect(defaultAccountTypeFor('cny')).toBe('fx_cny')
  })

  // 자금현황에 없는 통화로 떨어지면 그 행이 아예 안 보여 더 혼란스럽다.
  it('알 수 없는 통화는 보통예금으로 폴백한다', () => {
    expect(defaultAccountTypeFor('CHF')).toBe('krw_demand')
  })

  it('추론 결과는 항상 표시 가능한 계좌구분이다', () => {
    for (const cur of ['KRW', 'USD', 'EUR', 'JPY', 'GBP', 'CNY', 'XXX']) {
      expect(ACCOUNT_LABELS[defaultAccountTypeFor(cur)]).toBeTruthy()
    }
  })
})
