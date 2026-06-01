import { useState, useEffect } from 'react'
import { fetchStockPrice } from './useGas'
import type { StockPriceResult } from './useGas'

export interface TickerItem extends StockPriceResult {
  shortName: string
}

const STOCKS = [
  { code: '108860', shortName: '셀바스AI'  },
  { code: '208370', shortName: '셀바스HC'  },
  { code: '041920', shortName: '메디아나'  },
]

const MOCK: TickerItem[] = STOCKS.map(s => ({
  code: s.code, shortName: s.shortName,
  price: 0, date: '', change: 0, changePct: 0,
}))

const POLL_MS = 5 * 60 * 1000  // 5분

export function useStockTicker() {
  const [tickers, setTickers] = useState<TickerItem[]>(MOCK)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [lastAt,  setLastAt]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.allSettled(
          STOCKS.map(s => fetchStockPrice(s.code))
        )
        if (cancelled) return

        const next: TickerItem[] = results.map((r, i) =>
          r.status === 'fulfilled'
            ? { ...r.value, shortName: STOCKS[i].shortName }
            : { ...MOCK[i] }
        )
        setTickers(next)
        setLastAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))

        if (results.every(r => r.status === 'rejected')) {
          setError('GAS 연결 필요')
        }
      } catch {
        if (!cancelled) setError('주가 조회 실패')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    const timer = window.setInterval(() => void run(), POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  return { tickers, loading, error, lastAt }
}
