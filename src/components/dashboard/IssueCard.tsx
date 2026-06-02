import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { IssueItem } from '../../hooks/useDashboard'
import type { IssueStatus } from '../../types'

interface Props {
  issues: IssueItem[]
  activeKey: string | null           // 현재 하이라이트 대상 key
  onStatusChange: (key: string, id: string, status: IssueStatus) => void
  onHover: (key: string | null) => void
  onFocus: (key: string | null) => void
}

const STATUS_BADGE: Record<IssueStatus, string> = {
  open:   'bg-red-100 text-red-700',
  review: 'bg-yellow-100 text-yellow-700',
  done:   'bg-gray-100 text-gray-500',
}
const STATUS_LABEL: Record<IssueStatus, string> = {
  open: '미조치', review: '검토중', done: '완료',
}

/** issueKey → 바로가기 URL 생성 */
function buildLinkUrl(key: string, company: string | null): string | null {
  if (key === 'input_daily') return `/input/${company ?? ''}`
  if (key.startsWith('loan_')) {
    const id = key.replace('loan_', '')
    return `/loans/${company ?? ''}/${id}`
  }
  if (key.startsWith('equity_')) {
    const name = key.replace('equity_', '')
    return `/equity/${company ?? ''}/${encodeURIComponent(name)}`
  }
  return null
}

export default function IssueCard({ issues, activeKey, onStatusChange, onHover, onFocus }: Props) {
  const navigate = useNavigate()
  const { currentCompany } = useAuth()

  return (
    <div className="bg-white rounded-xl shadow flex flex-col lg:h-full">
      {/* 헤더 — 항상 상단 고정 */}
      <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-600">이슈 확인</h3>
        {issues.length > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {issues.length}
          </span>
        )}
      </div>

      {/* 바디 — 모바일: max-h-60 / PC: flex-1 min-h-0 */}
      <div className="overflow-y-auto px-5 py-3 space-y-2 pr-0.5
                      max-h-60 lg:flex-1 lg:min-h-0 lg:max-h-none">
        {issues.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">확인이 필요한 이슈가 없습니다 ✓</p>
        ) : (
          issues.map(issue => {
            const isActive = activeKey === issue.key
            const linkUrl  = buildLinkUrl(issue.key, currentCompany)

            return (
              <div
                key={issue.key}
                onMouseEnter={() => onHover(issue.key)}
                onMouseLeave={() => onHover(null)}
                onClick={() => onFocus(isActive ? null : issue.key)}
                className={`border rounded-lg p-3 cursor-pointer transition-all ${
                  isActive
                    ? 'border-blue-400 bg-blue-50 shadow-sm'
                    : 'border-gray-100 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{issue.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{issue.desc}</p>
                    {issue.commentCount > 0 && (
                      <p className="text-xs text-blue-500 mt-1">💬 코멘트 {issue.commentCount}개</p>
                    )}
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[issue.status]}`}>
                    {STATUS_LABEL[issue.status]}
                  </span>
                </div>

                {/* 상태 변경 + 바로가기 버튼 */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                    <button
                      key={s}
                      onClick={e => { e.stopPropagation(); onStatusChange(issue.key, issue.key, s) }}
                      disabled={issue.status === s}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        issue.status === s
                          ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-default'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                  {/* 바로가기 버튼 */}
                  {linkUrl && (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(linkUrl) }}
                      className="ml-auto text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-0.5 rounded transition-colors"
                      title="해당 페이지로 이동"
                    >
                      바로가기 →
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
