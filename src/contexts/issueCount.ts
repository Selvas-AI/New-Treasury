import { createContext, useContext } from 'react'

interface IssueCountContextValue {
  openCount: number
  setOpenCount: (n: number) => void
}

export const IssueCountContext = createContext<IssueCountContextValue>({
  openCount: 0,
  setOpenCount: () => {},
})

export function useIssueCount() {
  return useContext(IssueCountContext)
}
