import type { IssueItem } from '../../hooks/useDashboard'
import type { IssueStatus } from '../../types'

interface Props {
  issues: IssueItem[]
  onStatusChange: (key: string, id: string, status: IssueStatus) => void
}

const STATUS_BADGE: Record<IssueStatus, string> = {
  open:   'bg-red-100 text-red-700',
  review: 'bg-yellow-100 text-yellow-700',
  done:   'bg-gray-100 text-gray-500',
}

const STATUS_LABEL: Record<IssueStatus, string> = {
  open:   '미조치',
  review: '검토중',
  done:   '완료',
}

export default function IssueCard({ issues, onStatusChange }: Props) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-600">이슈 확인</h3>
        {issues.length > 0 && (
          <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
            {issues.length}
          </span>
        )}
      </div>

      {issues.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">확인이 필요한 이슈가 없습니다 ✓</p>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => (
            <div key={issue.key} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{issue.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{issue.desc}</p>
                  {issue.commentCount > 0 && (
                    <p className="text-xs text-blue-500 mt-1">💬 코멘트 {issue.commentCount}개</p>
                  )}
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[issue.status]}`}>
                  {STATUS_LABEL[issue.status]}
                </span>
              </div>
              {/* 상태 변경 버튼 */}
              <div className="flex gap-1.5 mt-2">
                {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                  <button
                    key={s}
                    onClick={() => onStatusChange(issue.key, issue.key, s)}
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
