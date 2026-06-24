import { type ReactNode, useMemo } from 'react'
import { IssueCountContext } from './issueCount'
import { useIssues } from '../hooks/useIssues'

// useIssues().openCount 직접 구독 → 법인 전환 시 자동 갱신 (stale count 제거)
export default function IssueCountProvider({ children }: { children: ReactNode }) {
  const { openCount } = useIssues()
  const value = useMemo(() => ({ openCount, setOpenCount: (_n: number) => {} }), [openCount])
  return (
    <IssueCountContext.Provider value={value}>
      {children}
    </IssueCountContext.Provider>
  )
}
