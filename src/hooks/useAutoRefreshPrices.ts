/**
 * 앱 로그인 시 지분·국채 시세 자동 갱신 훅
 * Layout.tsx에서 1회 호출 — 컴포넌트 마운트 후 백그라운드 실행
 */
import { useEffect, useRef, useState } from 'react'
import { useAuth } from './useAuth'
import { useCompanies } from './useCompanies'
import { autoRefreshAllPrices, type AutoRefreshResult } from '../lib/autoRefreshPrices'

export type RefreshStatus = 'idle' | 'running' | 'done' | 'error'

export function useAutoRefreshPrices() {
  const { user } = useAuth()
  const { names: companyNames } = useCompanies()
  const runningRef = useRef(false)
  const [status, setStatus]       = useState<RefreshStatus>('idle')
  const [result, setResult]       = useState<AutoRefreshResult | null>(null)
  const [progress, setProgress]   = useState<string | null>(null)

  useEffect(() => {
    // 로그인 안 됐거나, 레거시 접근코드 세션이거나, 이미 실행 중이면 skip
    if (!user?.email || !companyNames.length || runningRef.current) return

    runningRef.current = true
    setStatus('running')

    void autoRefreshAllPrices(companyNames, (msg) => setProgress(msg))
      .then(r => {
        setResult(r)
        setStatus('done')
        setProgress(null)
      })
      .catch(() => {
        setStatus('error')
        setProgress(null)
      })
      .finally(() => {
        runningRef.current = false
      })
  }, [user?.email, companyNames.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  return { status, result, progress }
}
