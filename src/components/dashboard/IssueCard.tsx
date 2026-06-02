import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import type { IssueItem } from '../../hooks/useDashboard'
import type { IssueStatus } from '../../types'

interface Props {
  issues: IssueItem[]
  activeKey: string | null
  onStatusChange: (key: string, id: string, status: IssueStatus) => void
  onHover: (key: string | null) => void
  onFocus: (key: string | null) => void
}

const STATUS_BADGE: Record<IssueStatus, string> = {
  open:   'bg-red-50 text-red-600 ring-1 ring-red-200',
  review: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200',
  done:   'bg-gray-100 text-gray-400',
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

export default function IssueCard({ issues, activeKey, onStatusChange, onHover, onFocus }: Props) {
  const navigate = useNavigate()
  const { currentCompany } = useAuth()

  return (
    <div className="bg-white rounded-xl shadow flex flex-col lg:h-full">

      {/* 헤더 */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-gray-100">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">이슈 확인</h3>
        {issues.length > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
            {issues.length}
          </span>
        )}
      </div>

      {/* 바디 — custom-scrollbar 적용 */}
      <div className="custom-scrollbar overflow-y-auto px-3 py-2 space-y-1.5
                      max-h-60 lg:flex-1 lg:min-h-0 lg:max-h-none">
        {issues.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-5">확인이 필요한 이슈가 없습니다 ✓</p>
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
                className={`rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
                  isActive
                    ? 'bg-blue-50 ring-1 ring-blue-300'
                    : 'hover:bg-gray-50 ring-1 ring-gray-100'
                }`}
              >
                {/* 제목 + 뱃지 */}
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-gray-800 leading-snug flex-1 min-w-0 truncate">
                    {issue.title}
                  </p>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium leading-none ${STATUS_BADGE[issue.status]}`}>
                    {STATUS_LABEL[issue.status]}
                  </span>
                </div>

                {/* 설명 */}
                <p className="text-[11px] text-gray-400 line-clamp-1 leading-snug">{issue.desc}</p>

                {issue.commentCount > 0 && (
                  <p className="text-[10px] text-blue-400 mt-0.5">💬 {issue.commentCount}개</p>
                )}

                {/* 상태 버튼 + 바로가기 */}
                <div className="flex items-center gap-1 mt-2">
                  {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                    <button
                      key={s}
                      onClick={e => { e.stopPropagation(); onStatusChange(issue.key, issue.key, s) }}
                      disabled={issue.status === s}
                      className={`text-[10px] px-2 py-1 rounded-md transition-colors ${
                        issue.status === s
                          ? 'bg-gray-100 text-gray-400 cursor-default'
                          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                      }`}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                  {linkUrl && (
                    <button
                      onClick={e => { e.stopPropagation(); navigate(linkUrl) }}
                      className="ml-auto text-[10px] text-blue-500 hover:text-blue-700 font-medium transition-colors"
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
