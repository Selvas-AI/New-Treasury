import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { IssueItem } from '../../hooks/useDashboard'
import type { IssueStatus } from '../../types'

interface Props {
  open:           boolean
  issues:         IssueItem[]
  activeKey:      string | null
  onStatusChange: (key: string, id: string, status: IssueStatus) => void
  onHover:        (key: string | null) => void
  onFocus:        (key: string | null) => void
  onClose:        () => void
}

const STATUS_BADGE: Record<IssueStatus, string> = {
  open:   'bg-red-50 text-red-600 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-400 dark:ring-red-800',
  review: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:ring-amber-800',
  done:   'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
}
const STATUS_LABEL: Record<IssueStatus, string> = {
  open: '미조치', review: '검토중', done: '완료',
}

function buildLinkUrl(key: string, company: string | null): string | null {
  if (key === 'input_daily') return `/input/${company ?? ''}`
  if (key.startsWith('loan_')) return `/loans/${company ?? ''}/${key.replace('loan_', '')}`
  if (key.startsWith('equity_')) return `/equity/${company ?? ''}/${encodeURIComponent(key.replace('equity_', ''))}`
  return null
}

export default function IssueDrawer({ open, issues, activeKey, onStatusChange, onHover, onFocus, onClose }: Props) {
  const navigate = useNavigate()
  const { currentCompany } = useAuth()

  if (!open) return null

  return (
    <>
      {/* 딤 배경 */}
      <div className="fixed inset-0 z-40 bg-black/10 dark:bg-black/30" onClick={onClose} />

      {/* 드로어 패널 */}
      <div style={{ animation: 'fadeInScale 0.18s ease-out both' }} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 max-h-[70vh] bg-white dark:bg-gray-800 rounded-xl shadow-xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700">

        {/* 헤더 */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">이슈 확인</h3>
            {issues.length > 0 && (
              <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                {issues.filter(i => i.status !== 'done').length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={e => { e.stopPropagation(); navigate('/issue-history'); onClose() }}
              className="text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/30"
            >
              전체 →
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 바디 */}
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1.5 py-8 px-4">
            <span className="text-2xl">✅</span>
            <p className="text-xs text-gray-400 dark:text-gray-500">확인이 필요한 이슈가 없습니다</p>
          </div>
        ) : (
          <div className="custom-scrollbar overflow-y-auto flex-1 min-h-0 px-3 py-2 space-y-1.5">
            {issues.map(issue => {
              const isActive = activeKey === issue.key
              const linkUrl  = buildLinkUrl(issue.key, currentCompany)
              return (
                <div
                  key={issue.key}
                  onMouseEnter={() => onHover(issue.key)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onFocus(isActive ? null : issue.key)}
                  className={`rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-300 dark:ring-blue-700'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 ring-1 ring-gray-100 dark:ring-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-100 leading-snug flex-1 min-w-0 truncate">
                      {issue.title}
                    </p>
                    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium leading-none ${STATUS_BADGE[issue.status]}`}>
                      {STATUS_LABEL[issue.status]}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 line-clamp-2 leading-snug">{issue.desc}</p>
                  {issue.commentCount > 0 && (
                    <p className="text-[10px] text-blue-400 dark:text-blue-500 mt-0.5">💬 {issue.commentCount}개</p>
                  )}
                  <div className="flex items-center gap-1 mt-2">
                    {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                      <button
                        key={s}
                        onClick={e => { e.stopPropagation(); onStatusChange(issue.key, issue.key, s) }}
                        disabled={issue.status === s}
                        className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                          issue.status === s
                            ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-default'
                            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200'
                        }`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                    {linkUrl && (
                      <button
                        onClick={e => { e.stopPropagation(); navigate(linkUrl); onClose() }}
                        className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 font-medium transition-colors"
                      >
                        바로가기 →
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
