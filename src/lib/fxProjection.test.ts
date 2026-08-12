import { describe, expect, it } from 'vitest'
import { buildProjectionSeries } from './fxProjection'

const history = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
  rate: 1400 + i,
}))

describe('fxProjection', () => {
  it('평탄 시나리오는 마지막 환율을 유지하고 과거를 변경하지 않는다', () => {
    const result = buildProjectionSeries(history, 1, 'flat')
    expect(result.slice(0, history.length)).toEqual(history)
    expect(result.at(-1)?.rate).toBe(history.at(-1)?.rate)
    expect(result.length).toBe(history.length + 20)
  })
})
