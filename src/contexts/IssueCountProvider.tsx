import { useState, type ReactNode } from 'react'
import { IssueCountContext } from './issueCount'

export default function IssueCountProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(0)
  return (
    <IssueCountContext.Provider value={{ openCount, setOpenCount }}>
      {children}
    </IssueCountContext.Provider>
  )
}
