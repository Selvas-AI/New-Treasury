/**
 * useAutoPrice
 *
 * EquityPage 마운트 시 상장 주식 + 채권의 최신 시세를 GAS에서 자동 조회하여 DB에 upsert.
 *
 * 동작 조건:
 *  - isEditable(master/company) 유저만 DB write 수행
 *  - 상장 주식: 최신 date < 오늘인 종목만 조회
 *  - 채권: 최신 priceDate < 어제인 종목만 조회 (T+1 제공)
 *  - 페이지 마운트 1회만 실행 (컴퍼니 전환 시 재실행)
 */

import { useState, useEffect, useRef } from 'react'
import { fetchStockPrice, fetchBondPrice } from './useGas'
import { calcBondValue } from '../lib/format'
import type { EquityRecord, InvestmentRecord } from '../types'

type SaveEquity = (r: Omit<EquityRecord, 'id'> & { id?: string }) => Promise<string | null>
type SaveBond   = (r: Omit<InvestmentRecord, 'id'> & { id?: string }) => Promise<string | null>

export interface AutoPriceStatus {
  /** 현재 갱신 중 여부 */
  refreshing: boolean
  /** 완료된 종목 수 */
  done: number
  /** 전체 갱신 대상 종목 수 */
  total: number
  /** 실패 종목명 목록 */
  errors: string[]
}

interface Options {
  stocks:     EquityRecord[]        // getLatestEquities 결과
  bonds:      InvestmentRecord[]    // getLatestBonds 결과
  company:    string | null
  isEditable: boolean
  onSaveEquity: SaveEquity
  onSaveBond:   SaveBond
}

const today     = new Date().toISOString().slice(0, 10)
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()

export function useAutoPrice({
  stocks, bonds, company, isEditable, onSaveEquity, onSaveBond,
}: Options): AutoPriceStatus {
  const [status, setStatus] = useState<AutoPriceStatus>({
    refreshing: false, done: 0, total: 0, errors: [],
  })

  // company 변경 시 재실행을 위한 트리거
  const ranForCompany = useRef<string | null>(null)

  useEffect(() => {
    // 데이터 로드 전 / 편집 불가 유저 / 동일 company 중복 실행 방지
    if (!isEditable) return
    if (!company) return
    if (ranForCompany.current === company) return
    if (!stocks.length && !bonds.length) return

    // 갱신 대상 필터
    const stockTargets = stocks.filter(s =>
      s.market !== '비상장' && s.ticker && s.date < today
    )
    const bondTargets = bonds.filter(b =>
      b.bondTicker && (!b.priceDate || b.priceDate < yesterday)
    )

    const total = stockTargets.length + bondTargets.length
    if (total === 0) return   // 모두 최신 상태 → 스킵

    ranForCompany.current = company

    async function run() {
      setStatus({ refreshing: true, done: 0, total, errors: [] })
      const errors: string[] = []
      let done = 0

      // ── 상장 주식 순차 조회 ──────────────────────────────
      for (const s of stockTargets) {
        try {
          const res = await fetchStockPrice(s.ticker)
          await onSaveEquity({
            id:               s.id,
            company:          s.company,
            name:             s.name,
            ticker:           s.ticker,
            market:           s.market,
            purpose:          s.purpose,
            available:        s.available,
            shares:           s.shares,
            price:            res.price,
            total_value:      s.shares * res.price,
            date:             res.date,
            acquisition_cost: s.acquisition_cost,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn(`[AutoPrice] ${s.name} 조회 실패:`, msg)
          errors.push(s.name)
        }
        done++
        setStatus(prev => ({ ...prev, done, errors: [...errors] }))
      }

      // ── 채권 순차 조회 ───────────────────────────────────
      for (const b of bondTargets) {
        try {
          const res = await fetchBondPrice(b.bondTicker!)
          const newAmt = calcBondValue(b.bondQty ?? 0, res.price)
          await onSaveBond({
            ...b,
            id:         b.id,
            bondPrice:  res.price,
            priceDate:  res.date,
            amount:     newAmt,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          const label = b.bondName ?? b.bank
          console.warn(`[AutoPrice] ${label} 채권 조회 실패:`, msg)
          errors.push(label)
        }
        done++
        setStatus(prev => ({ ...prev, done, errors: [...errors] }))
      }

      setStatus({ refreshing: false, done, total, errors })
    }

    void run()
  // stocks.length / bonds.length 변화로 재실행 (초기 로드 감지)
  }, [company, isEditable, stocks.length, bonds.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return status
}
