import { describe, it, expect } from 'vitest'
import {
  readAnchor, anchorParamKey, anchorSetAtParamKey, protocolFromParams,
  PROTOCOL_PARAM_KEYS,
} from './fxRegime'

/**
 * 2026-11-04 발견 — 앵커(`fx_level_anchor_krw`)가 **법인당 하나**였다.
 * 그 탓에 USD 앵커(약 1,378원)에 EUR 환율(1,487원)을 비교해 "+7.9% 고평가 → 매우 높음"
 * 으로 판정했다. 통화마다 환율 수준 자체가 달라 같은 앵커로는 비교가 성립하지 않는다.
 *
 * 원칙: 앵커는 통화별. 미설정 통화는 **수준 축을 끄고 추세만** 본다
 *       — 틀린 기준으로 '매우 높음'을 말하느니 판단을 보류하는 편이 안전하다.
 */
function store(rows: Record<string, number>) {
  return (k: string) => (k in rows ? rows[k] : null)
}

describe('anchorParamKey', () => {
  it('통화별 키를 만든다', () => {
    expect(anchorParamKey('USD')).toBe('fx_level_anchor_krw_usd')
    expect(anchorParamKey('EUR')).toBe('fx_level_anchor_krw_eur')
    expect(anchorSetAtParamKey('JPY')).toBe('fx_level_anchor_set_at_jpy')
  })
})

describe('readAnchor — 통화별 앵커, USD 만 구 키 승계', () => {
  it('통화별 키가 있으면 그 값을 쓴다', () => {
    const get = store({ [anchorParamKey('EUR')]: 1450 })
    expect(readAnchor(get, 'EUR')).toBe(1450)
  })

  it('USD 는 구 키를 폴백으로 승계한다 — 기존 설정이 끊기지 않게', () => {
    const get = store({ [PROTOCOL_PARAM_KEYS.anchorRate]: 1378 })
    expect(readAnchor(get, 'USD')).toBe(1378)
  })

  it('[회귀] USD 외 통화는 구 키를 빌려 쓰지 않는다', () => {
    const get = store({ [PROTOCOL_PARAM_KEYS.anchorRate]: 1378 })
    expect(readAnchor(get, 'EUR')).toBeNull()
    expect(readAnchor(get, 'JPY')).toBeNull()
  })

  it('통화별 키가 구 키보다 우선한다', () => {
    const get = store({ [PROTOCOL_PARAM_KEYS.anchorRate]: 1378, [anchorParamKey('USD')]: 1400 })
    expect(readAnchor(get, 'USD')).toBe(1400)
  })

  it('0 이하 값은 미설정으로 본다', () => {
    expect(readAnchor(store({ [anchorParamKey('EUR')]: 0 }), 'EUR')).toBeNull()
  })
})

describe('protocolFromParams — 앵커가 없으면 수준 축이 꺼진다', () => {
  const legacyOnly = store({ [PROTOCOL_PARAM_KEYS.anchorRate]: 1378 })

  it('USD 는 수준 축이 켜진다', () => {
    const p = protocolFromParams(legacyOnly, 'USD')
    expect(p.anchorRate).toBe(1378)
    expect(p.useLevelAxis).toBe(true)
  })

  it('[회귀] EUR 은 앵커가 없어 추세만으로 판정한다', () => {
    const p = protocolFromParams(legacyOnly, 'EUR')
    expect(p.anchorRate).toBeNull()
    expect(p.useLevelAxis).toBe(false)
  })

  it('통화를 넘기지 않으면 수준 축을 켜지 않는다 — 틀린 기준 사용 방지', () => {
    const p = protocolFromParams(legacyOnly)
    expect(p.anchorRate).toBeNull()
    expect(p.useLevelAxis).toBe(false)
  })
})
