/**
 * 지분·국채 시세 자동 갱신 (앱 로그인 시 1회 / 일별 체크)
 *
 * 지분: 오늘 날짜 레코드가 없으면 GAS → 현재가 → equities INSERT
 * 국채: 전영업일 기준가가 없으면 GAS → T+1 기준가 → investments UPDATE
 *       ※ 국채 API는 T+1 제공이므로 오후 12시 이후에만 실행
 *
 * localStorage 키: treasury_auto_refresh_v1
 * {
 *   equity: { [company]: "YYYY-MM-DD" }   // 마지막 지분 갱신 날짜
 *   bond:   { [company]: "YYYY-MM-DD" }   // 마지막 국채 기준일 (전영업일)
 * }
 */

import { restSelect, restInsert, restUpdate } from './supabase'
import { fetchStockPrice, fetchBondPrice } from '../hooks/useGas'
import { calcBondValue, normDate, generateUUID } from './format'
import type { EquityRecord, InvestmentRecord } from '../types'

// ── 전영업일 계산 (주말 skip, 공휴일 무시 — 간이) ──
function prevBizDay(dateStr: string): string {
  const d = new Date(dateStr)
  do { d.setDate(d.getDate() - 1) } while (d.getDay() === 0 || d.getDay() === 6)
  return d.toISOString().slice(0, 10)
}

// ── localStorage 로그 ──
const STORAGE_KEY = 'treasury_auto_refresh_v1'

interface RefreshLog {
  equity: Record<string, string>  // company → date (today)
  bond:   Record<string, string>  // company → bizDate (prevBizDay)
}

function getLog(): RefreshLog {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      ?? { equity: {}, bond: {} }
  } catch {
    return { equity: {}, bond: {} }
  }
}

function saveLog(log: RefreshLog) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log))
}

export interface AutoRefreshResult {
  equityOk:   number
  equityFail: number
  equitySkip: number
  bondOk:     number
  bondFail:   number
  bondSkip:   number
}

/**
 * 모든 법인의 지분·국채 시세를 자동 갱신.
 * 이미 오늘 갱신된 법인은 건너뜀.
 * @param companies  갱신 대상 법인 목록
 * @param onProgress 진행 메시지 콜백 (UI 표시용, optional)
 */
export async function autoRefreshAllPrices(
  companies: string[],
  onProgress?: (msg: string) => void,
): Promise<AutoRefreshResult> {
  const today      = new Date().toISOString().slice(0, 10)
  const nowHour    = new Date().getHours()
  const prevBiz    = prevBizDay(today)
  const log        = getLog()
  const result: AutoRefreshResult = {
    equityOk: 0, equityFail: 0, equitySkip: 0,
    bondOk: 0,   bondFail: 0,   bondSkip: 0,
  }

  for (const company of companies) {
    // ── 지분 시세 갱신 ─────────────────────────────────────
    if (log.equity[company] !== today) {
      try {
        const { data: rows } = await restSelect<EquityRecord>('equities', {
          match: { company }, order: 'date.desc', limit: 2000,
        })
        const allRows = rows ?? []

        // 종목별 최신 레코드 (= 원본 데이터 기준)
        const latestMap = new Map<string, EquityRecord>()
        for (const r of allRows) {
          const cur = latestMap.get(r.name)
          if (!cur || r.date > cur.date) latestMap.set(r.name, r)
        }

        // 상장 종목만 (비상장은 ticker 없음, 가격 조회 불가)
        const targets = [...latestMap.values()].filter(
          e => e.ticker && e.market !== '비상장',
        )

        for (const eq of targets) {
          // 오늘 날짜 레코드 이미 있으면 skip
          if (allRows.some(r => r.name === eq.name && r.date === today)) {
            result.equitySkip++
            continue
          }
          try {
            onProgress?.(`${company} · ${eq.name} 시세 조회 중…`)
            const res = await fetchStockPrice(eq.ticker)
            const priceDate = normDate(res.date)
            // 응답 날짜 레코드 이미 있으면 skip (장이 열리지 않은 날)
            if (allRows.some(r => r.name === eq.name && r.date === priceDate)) {
              result.equitySkip++
              continue
            }
            await restInsert<EquityRecord>('equities', {
              id:               generateUUID(),
              company,
              name:             eq.name,
              ticker:           eq.ticker,
              market:           eq.market,
              purpose:          eq.purpose || '',
              available:        eq.available,
              shares:           eq.shares,
              price:            res.price,
              total_value:      (eq.shares ?? 0) * res.price,
              date:             priceDate,
              acquisition_cost: eq.acquisition_cost ?? 0,
            })
            result.equityOk++
          } catch {
            result.equityFail++
          }
        }
      } catch {
        // 법인 전체 조회 실패 → 다음 법인으로
      }
      log.equity[company] = today
      saveLog(log)
    }

    // ── 국채 기준가 갱신 (T+1, 오후 12시 이후) ─────────────
    if (nowHour >= 12 && log.bond[company] !== prevBiz) {
      try {
        const { data: bonds } = await restSelect<InvestmentRecord>('investments', {
          match: { company, product: '국채' }, order: 'start.asc', limit: 500,
        })
        const activeBonds = (bonds ?? []).filter(
          b => b.active !== false && b.bondTicker,
        )

        for (const bond of activeBonds) {
          // 이미 전영업일 기준가 저장돼 있으면 skip
          if (bond.priceDate === prevBiz || bond.priceDate === today) {
            result.bondSkip++
            continue
          }
          try {
            onProgress?.(`${company} · ${bond.bondName ?? bond.bank} 기준가 조회 중…`)
            const res = await fetchBondPrice(bond.bondTicker!)
            await restUpdate<Partial<InvestmentRecord>>(
              'investments',
              {
                bondPrice: res.price,
                priceDate: res.date,
                amount:    calcBondValue(bond.bondQty ?? 0, res.price),
              },
              { id: bond.id },
            )
            result.bondOk++
          } catch {
            result.bondFail++
          }
        }
      } catch {
        // 법인 전체 조회 실패 → 다음 법인으로
      }
      log.bond[company] = prevBiz
      saveLog(log)
    }
  }

  return result
}
