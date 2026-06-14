/**
 * useHolidays — 앱 시작 시 GAS에서 공휴일 데이터를 자동 보완
 *
 * - 당해연도 + 내년도 2개 연도 fetch
 * - localStorage 캐시 히트 시 fetch 생략 (재로드 없음)
 * - GAS 미응답 시 bizDay.ts 하드코딩 fallback 그대로 유지
 */
import { useEffect } from 'react'
import { fetchAndCacheHolidays } from '../lib/bizDay'

export function useHolidays(): void {
  useEffect(() => {
    const year = new Date().getFullYear()
    void fetchAndCacheHolidays(year)
    void fetchAndCacheHolidays(year + 1)
  }, [])
}
