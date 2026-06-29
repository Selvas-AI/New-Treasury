import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useIssues } from '../hooks/useIssues'
import { issueSourceUrl, issueSourceLabel } from '../lib/issueLink'
import type { IssueComment, IssueStatus } from '../types'


const STATUS_LABEL: Record<IssueStatus, string> = {
  open:   '미조치',
  review: '검토중',
  done:   '완료',
}

const ISSUE_TYPE: { test: (k: string) => boolean; label: string; cls: string }[] = [
  { test: k => k === 'input_daily',    label: '운전자금', cls: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400' },
  { test: k => k.startsWith('loan_'),  label: '차입금',   cls: 'bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400' },
  { test: k => k.startsWith('equity_'),label: '지분',     cls: 'bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400' },
  { test: k => k.startsWith('policy_'),         label: '정책',   cls: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400' },
  { test: k => k.startsWith('product_review_'), label: '적정성', cls: 'bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400' },
]
function issueTypeBadge(key: string) {
  const found = ISSUE_TYPE.find(t => t.test(key))
  if (!found) return null
  return { label: found.label, cls: found.cls }
}
const STATUS_COLOR: Record<IssueStatus, string> = {
  open:   'bg-red-100 text-red-700',
  review: 'bg-yellow-100 text-yellow-700',
  done:   'bg-gray-100 text-gray-500',
}

interface IssueGroup {
  key: string
  title: string
  desc: string
  latestStatus: IssueStatus
  comments: IssueComment[]
}

function groupByKey(comments: IssueComment[]): IssueGroup[] {
  const map = new Map<string, IssueComment[]>()
  for (const c of comments) {
    const arr = map.get(c.issue_key) ?? []
    arr.push(c)
    map.set(c.issue_key, arr)
  }
  return Array.from(map.entries())
    .map(([key, cmts]) => {
      const sorted = [...cmts].sort((a, b) => a.created_at.localeCompare(b.created_at))
      const last   = sorted[sorted.length - 1]
      return {
        key,
        title:        last.issue_title || key,
        desc:         last.issue_desc  || '',
        latestStatus: last.status,
        comments:     sorted,
      }
    })
    .sort((a, b) => {
      // 미완료 우선, 그 다음 최신순
      const order: Record<IssueStatus, number> = { open: 0, review: 1, done: 2 }
      const diff = order[a.latestStatus] - order[b.latestStatus]
      if (diff !== 0) return diff
      return (b.comments[b.comments.length - 1]?.created_at ?? '')
        .localeCompare(a.comments[a.comments.length - 1]?.created_at ?? '')
    })
}

export default function IssueHistoryPage() {
  const { issueKey: paramKey } = useParams<{ issueKey?: string }>()
  const { user, currentCompany } = useAuth()
  const issues = useIssues()

  const [filterStatus, setFilterStatus] = useState<IssueStatus | 'all'>('all')
  const [openKey,  setOpenKey]   = useState<string | null>(null)
  const [newBody,  setNewBody]   = useState('')
  const [editId,   setEditId]    = useState<string | null>(null)
  const [editBody, setEditBody]  = useState('')
  const [editStatus, setEditStatus] = useState<IssueStatus>('open')
  const [saving, setSaving] = useState(false)

  // 딥링크 진입 시 해당 이슈 자동 오픈
  useEffect(() => {
    if (paramKey) setOpenKey(decodeURIComponent(paramKey))
  }, [paramKey])

  // 그룹화 및 필터 — 탭 카운트는 개별 코멘트가 아닌 이슈 그룹(latestStatus) 기준
  const allGroups   = useMemo(() => groupByKey(issues.data), [issues.data])
  const groups      = useMemo(() => {
    if (filterStatus === 'all') return allGroups
    return allGroups.filter(g => g.latestStatus === filterStatus)
  }, [allGroups, filterStatus])

  const openCount   = useMemo(() => allGroups.filter(g => g.latestStatus === 'open').length,   [allGroups])
  const reviewCount = useMemo(() => allGroups.filter(g => g.latestStatus === 'review').length, [allGroups])
  const doneCount   = useMemo(() => allGroups.filter(g => g.latestStatus === 'done').length,   [allGroups])

  // 코멘트 추가
  async function handleAddComment(group: IssueGroup) {
    if (!newBody.trim() || !currentCompany || !user) return
    setSaving(true)
    await issues.addComment({
      issue_key:   group.key,
      company:     currentCompany,
      user_label:  user.label,
      user_role:   user.role,
      body:        newBody.trim(),
      status:      group.latestStatus,
      issue_title: group.title,
      issue_desc:  group.desc,
    })
    setNewBody('')
    setSaving(false)
  }

  // 상태 변경 (새 코멘트로 기록)
  async function handleChangeStatus(group: IssueGroup, status: IssueStatus) {
    if (!currentCompany || !user) return
    await issues.addComment({
      issue_key:   group.key,
      company:     currentCompany,
      user_label:  user.label,
      user_role:   user.role,
      body:        `상태를 [${STATUS_LABEL[status]}]로 변경했습니다.`,
      status,
      issue_title: group.title,
      issue_desc:  group.desc,
    })
  }

  // 수정 저장
  async function handleEditSave(id: string) {
    await issues.updateComment(id, editBody, editStatus)
    setEditId(null)
    setEditBody('')
  }

  // 삭제
  async function handleDelete(id: string) {
    if (!confirm('코멘트를 삭제하시겠습니까?')) return
    await issues.remove(id)
  }

  function startEdit(c: IssueComment) {
    setEditId(c.id)
    setEditBody(c.body)
    setEditStatus(c.status)
  }

  const isEditable = user?.role !== 'ceo'

  return (
    <div className="space-y-5 max-w-4xl mx-auto">

      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">이슈 이력</h2>

        {/* 상태 필터 */}
        <div className="flex gap-1.5 flex-wrap">
          {([
            { key: 'all',    label: `전체 (${groups.length})` },
            { key: 'open',   label: `미조치 (${openCount})` },
            { key: 'review', label: `검토중 (${reviewCount})` },
            { key: 'done',   label: `완료 (${doneCount})` },
          ] as { key: IssueStatus | 'all'; label: string }[]).map(f => (
            <button key={f.key}
              onClick={() => setFilterStatus(f.key)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filterStatus === f.key
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-700'
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 이슈 없음 */}
      {issues.loading ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-8 text-center text-sm text-gray-400 dark:text-gray-500">로딩 중...</div>
      ) : groups.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow p-8 text-center text-sm text-gray-400 dark:text-gray-500">
          {filterStatus === 'all' ? '이슈가 없습니다.' : `[${STATUS_LABEL[filterStatus as IssueStatus]}] 상태의 이슈가 없습니다.`}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(group => {
            const isOpen = openKey === group.key
            return (
              <div key={group.key} className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow">

                {/* 이슈 헤더 행 */}
                <button
                  onClick={() => setOpenKey(isOpen ? null : group.key)}
                  className="w-full text-left px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors rounded-xl">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {(() => { const b = issueTypeBadge(group.key); return b ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${b.cls}`}>{b.label}</span> : null })()}
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{group.title}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[group.latestStatus]}`}>
                          {STATUS_LABEL[group.latestStatus]}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-gray-500">💬 {group.comments.length}개</span>
                      </div>
                      {group.desc && (
                        <p className="text-xs text-gray-500 dark:text-slate-300 mt-0.5 line-clamp-1">{group.desc}</p>
                      )}
                    </div>
                    <span className={`text-gray-400 dark:text-gray-500 transition-transform shrink-0 mt-0.5 ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                  </div>
                </button>

                {/* 코멘트 스레드 */}
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-slate-700 px-5 pb-5 space-y-4">

                    {/* 원천 레코드 바로가기 (D4) */}
                    {(() => {
                      const url = issueSourceUrl(group.key, currentCompany)
                      return url ? (
                        <div className="pt-3">
                          <Link to={url}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
                            {issueSourceLabel(group.key)} <span className="text-[10px]">↗</span>
                          </Link>
                        </div>
                      ) : null
                    })()}

                    {/* 상태 변경 버튼 */}
                    {isEditable && (
                      <div className="flex items-center gap-2 pt-4">
                        <span className="text-xs text-gray-400 dark:text-gray-500">상태 변경:</span>
                        {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                          <button key={s}
                            onClick={() => handleChangeStatus(group, s)}
                            disabled={group.latestStatus === s}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                              group.latestStatus === s
                                ? `${STATUS_COLOR[s]} border-transparent cursor-default`
                                : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700'
                            }`}>
                            {STATUS_LABEL[s]}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 코멘트 목록 */}
                    <div className="space-y-3">
                      {group.comments.map(c => (
                        <div key={c.id} className="flex gap-3">
                          {/* 아바타 */}
                          <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center shrink-0 text-xs font-bold text-blue-700 dark:text-blue-400">
                            {c.user_label.slice(0, 1)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{c.user_label}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLOR[c.status]}`}>
                                {STATUS_LABEL[c.status]}
                              </span>
                              <span className="text-xs text-gray-400 dark:text-gray-500">
                                {new Date(c.created_at).toLocaleString('ko-KR', {
                                  month: 'numeric', day: 'numeric',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </span>
                            </div>

                            {/* 수정 모드 */}
                            {editId === c.id ? (
                              <div className="mt-1.5 space-y-2">
                                <textarea
                                  value={editBody}
                                  onChange={e => setEditBody(e.target.value)}
                                  rows={2}
                                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100"
                                />
                                <div className="flex items-center gap-2">
                                  <select
                                    value={editStatus}
                                    onChange={e => setEditStatus(e.target.value as IssueStatus)}
                                    className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100">
                                    {(['open', 'review', 'done'] as IssueStatus[]).map(s => (
                                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                                    ))}
                                  </select>
                                  <button onClick={() => handleEditSave(c.id)}
                                    className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700">저장</button>
                                  <button onClick={() => setEditId(null)}
                                    className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300">취소</button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 whitespace-pre-wrap">{c.body}</p>
                            )}

                            {/* 수정/삭제 버튼 */}
                            {isEditable && editId !== c.id && (
                              <div className="flex gap-2 mt-1">
                                <button onClick={() => startEdit(c)}
                                  className="text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500">수정</button>
                                <button onClick={() => handleDelete(c.id)}
                                  className="text-xs text-gray-400 hover:text-red-500 dark:text-gray-500">삭제</button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 새 코멘트 입력 */}
                    {isEditable && (
                      <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
                        <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center shrink-0 text-xs font-bold text-gray-500 dark:text-slate-300">
                          {user?.label.slice(0, 1)}
                        </div>
                        <div className="flex-1 space-y-2">
                          <textarea
                            value={newBody}
                            onChange={e => setNewBody(e.target.value)}
                            placeholder="코멘트를 입력하세요..."
                            rows={2}
                            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none dark:bg-slate-700 dark:border-slate-600 dark:text-gray-100"
                          />
                          <button
                            onClick={() => handleAddComment(group)}
                            disabled={!newBody.trim() || saving}
                            className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                            {saving ? '저장 중...' : '코멘트 추가'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

