/**
 * BandReviewModal — 리밸런싱 기준 회고 리포트 + 정책회의 안건 상정 (2026-11-25 결정 D5)
 *
 * 흐름: 규칙 검증 탭 [회고 리포트] 한 번 → 워커가 4개 기간 × 1~5%p 백테스트 →
 *   결론·근거·기간별 표 → (정책 편집 권한) 회의 선택 또는 새 정책회의 → 미리보기 확인 → [안건 상정]
 *   → policy_decisions 에 '대기' 상태로 등록 → 자금정책 › 회의·의결 화면에서 바로 열 수 있다.
 *
 * ⚠ 계산은 lib/fxBandReview(→ runBacktest). 이 컴포넌트는 실행·표시·등록만 한다.
 * ⚠ 등록은 미리보기 패널의 버튼으로만 한다(window.confirm 금지 — CLAUDE.md).
 * ⚠ 같은 회의에 같은 안건명이 이미 있으면 막는다(중복 상정 방지).
 * 감사로그(useAuditLog)는 대상 테이블이 정해져 있어 쓰지 않는다 — 안건 행 자체가 생성 시각·담당자를 남긴다.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  bandLabel, bandReviewAgendaText, REVIEW_BANDS,
  type BandReviewInput, type BandReviewReport,
} from '../../lib/fxBandReview'
import type { BandReviewWorkerMessage, BandReviewWorkerRequest } from '../../lib/fxBandReview.worker'
import { usePolicyMeetings } from '../../hooks/usePolicyMeetings'
import { usePolicyDecisions } from '../../hooks/usePolicyDecisions'
import { useAuth } from '../../hooks/useAuth'
import { restInsert } from '../../lib/supabase'
import { generateUUID, fmtKRW } from '../../lib/format'
import { todayStr } from '../../lib/bizDay'

const NEW_MEETING = '__new__'

export default function BandReviewModal({ input, company, onClose }: {
  input: BandReviewInput
  company: string
  onClose: () => void
}) {
  const { user, canAction } = useAuth()
  const canPropose = canAction('policy', 'write')
  const userLabel = user?.label ?? user?.code ?? 'unknown'

  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: REVIEW_BANDS.length * 4 })
  const [report, setReport] = useState<BandReviewReport | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  // 열리면 바로 실행 — "클릭 한 번"
  useEffect(() => {
    const worker = new Worker(new URL('../../lib/fxBandReview.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (e: MessageEvent<BandReviewWorkerMessage>) => {
      const m = e.data
      if (m.type === 'progress') setProgress({ done: m.done, total: m.total })
      else if (m.type === 'done') { setReport(m.report); worker.terminate() }
      else { setRunError(m.message); worker.terminate() }
    }
    worker.onerror = ev => { setRunError(ev.message || '계산 중 오류'); worker.terminate() }
    const req: BandReviewWorkerRequest = { type: 'run', input }
    worker.postMessage(req)
    return () => worker.terminate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번만 계산한다(조건이 바뀌면 다시 열기)
  }, [])

  // ── 안건 상정 ──
  const meetings = usePolicyMeetings()
  const policyMeetings = useMemo(
    () => meetings.data.filter(m => m.meeting_type === '정책회의'),
    [meetings.data],
  )
  const [meetingId, setMeetingId] = useState<string>('')
  const effectiveMeetingId = meetingId || policyMeetings[0]?.id || NEW_MEETING
  const [newTitle, setNewTitle] = useState('정책회의 — FX 리밸런싱 기준 검토')
  const [newDate, setNewDate] = useState(todayStr())
  const [owner, setOwner] = useState(userLabel)
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [savedMeetingId, setSavedMeetingId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const existing = usePolicyDecisions(effectiveMeetingId === NEW_MEETING ? null : effectiveMeetingId)
  const agendaTitle = report ? `[FX 리짐] 리밸런싱 기준 ${bandLabel(report.currentBand)} 적정성 검토 (${report.currency})` : ''
  const agendaBody = useMemo(() => (report ? bandReviewAgendaText(report) : ''), [report])
  const duplicate = existing.data.some(d => d.title === agendaTitle && d.company === company)

  async function propose() {
    if (!report) return
    setSaving(true); setSaveErr(null)
    try {
      let mid = effectiveMeetingId
      if (mid === NEW_MEETING) {
        if (!newTitle.trim() || !newDate) throw new Error('새 회의의 제목과 날짜를 입력하세요.')
        mid = generateUUID()
        const { error } = await restInsert('policy_meetings', {
          id: mid, title: newTitle.trim(), meeting_type: '정책회의', held_at: newDate, created_by: userLabel,
        })
        if (error) throw new Error(`회의 등록 실패: ${error.message}`)
      }
      const id = generateUUID()
      const row = {
        id, meeting_id: mid, company, title: agendaTitle, decision: agendaBody,
        owner, due_date: dueDate || null, status: 'pending',
      }
      const { error } = await restInsert('policy_decisions', row)
      if (error) throw new Error(`안건 등록 실패: ${error.message}`)
      await meetings.refetch()
      setSavedMeetingId(mid)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function copyBody() {
    try { await navigator.clipboard.writeText(`${agendaTitle}\n\n${agendaBody}`); setCopied(true) } catch { /* 무시 */ }
  }

  const tone = report?.conclusion === 'keep'
    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-200'
    : report?.conclusion === 'review'
    ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
    : 'border-gray-400 bg-gray-50 text-gray-800 dark:bg-slate-800 dark:text-slate-200'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative my-6 w-full max-w-4xl space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">
            📊 리밸런싱 기준 회고 리포트 — {input.currency}
          </h3>
          <button onClick={onClose} className="text-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">✕</button>
        </div>

        {!report && !runError && (
          <div>
            <div className="text-sm text-gray-600 dark:text-slate-300">
              4개 기간 × 기준 1~5%p 를 실전 규칙으로 돌리는 중… ({progress.done}/{progress.total})
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-gray-100 dark:bg-slate-800">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          </div>
        )}
        {runError && <div className="text-sm text-red-600 dark:text-red-400">계산 실패: {runError}</div>}

        {report && (
          <>
            {/* 결론 */}
            <div className={`rounded-lg border-l-4 p-3 text-sm ${tone}`}>
              <div className="font-bold">
                {report.conclusion === 'keep' && `현행 ${bandLabel(report.currentBand)} 유지 근거 있음`}
                {report.conclusion === 'review' && `${bandLabel(report.suggestedBand ?? report.currentBand)} 로 변경 검토 제안`}
                {report.conclusion === 'insufficient' && '자료 부족 — 판단 보류'}
                <span className="ml-2 text-[11px] font-normal opacity-80">판단 보조 · 기준일 {report.asOf}</span>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {report.reasons.map(r => <li key={r}>{r}</li>)}
              </ul>
            </div>

            {/* 기간별 표 */}
            {report.periods.map(p => (
              <div key={p.key} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-gray-800 dark:text-slate-100">{p.label}</span>
                  <span className="text-[11px] text-gray-500 dark:text-slate-400">
                    {p.startDate} ~ {p.endDate} · 기간 평균 {p.periodAverageRate.toFixed(1)}원 · 1위 {bandLabel(p.bestBand)}
                  </span>
                  {p.actual && p.actual.count > 0 && p.actual.weightedRate != null && (
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                      회사 실제 매각 {p.actual.count}건 · 평균 {p.actual.weightedRate.toFixed(1)}원
                    </span>
                  )}
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-1.5">기준</th>
                        <th className="py-1.5 text-right">순위</th>
                        <th className="py-1.5 text-right">최선 대비 총가치</th>
                        <th className="py-1.5 text-right">평균 실현환율</th>
                        <th className="py-1.5 text-right">기간 평균 대비</th>
                        <th className="py-1.5 text-right">연 거래</th>
                        <th className="py-1.5 text-right">기말 미환전</th>
                        <th className="py-1.5 text-right">기준 미만 보류</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {p.rows.map(r => {
                        const cur = Math.abs(r.band - report.currentBand) < 1e-9
                        return (
                          <tr key={r.band} className={`border-b border-gray-100 dark:border-slate-800 ${cur ? 'bg-blue-50/60 font-semibold dark:bg-blue-900/10' : ''}`}>
                            <td className="py-1.5">{bandLabel(r.band)}{cur && ' (현행)'}</td>
                            <td className="py-1.5 text-right">{r.rank}위</td>
                            <td className={`py-1.5 text-right ${r.gapToBestKRW < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                              {r.gapToBestKRW === 0 ? '최선' : fmtKRW(r.gapToBestKRW)}
                            </td>
                            <td className="py-1.5 text-right">{r.weightedAverageRate == null ? '—' : `${r.weightedAverageRate.toFixed(1)}원`}</td>
                            <td className="py-1.5 text-right">{r.ratePremium == null ? '—' : `${r.ratePremium >= 0 ? '+' : ''}${r.ratePremium.toFixed(1)}원`}</td>
                            <td className="py-1.5 text-right">{r.tradesPerYear.toFixed(1)}회</td>
                            <td className="py-1.5 text-right">{Math.round(r.endingHoldingFx).toLocaleString()}</td>
                            <td className="py-1.5 text-right">{r.heldByBandChecks}회</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-gray-500 dark:text-slate-400">※ {report.assumptions}</p>

            {/* 안건 상정 */}
            <div className="rounded-xl border-2 border-blue-200 p-4 dark:border-blue-900">
              <div className="text-sm font-bold text-gray-800 dark:text-slate-100">🏛 정책회의 안건으로 상정</div>
              {savedMeetingId ? (
                <div className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
                  ✅ 안건을 '대기' 상태로 등록했습니다.{' '}
                  <Link to={`/policy?tab=decisions&meeting=${savedMeetingId}&company=${encodeURIComponent(company)}`} className="font-semibold underline" onClick={onClose}>
                    자금정책 › 회의·의결에서 보기 →
                  </Link>
                </div>
              ) : !canPropose ? (
                <div className="mt-2 space-y-2 text-xs text-gray-600 dark:text-slate-300">
                  <p>정책 편집 권한이 없어 직접 상정할 수 없습니다. 본문을 복사해 정책 담당자에게 전달하세요.</p>
                  <button onClick={copyBody} className="rounded bg-gray-100 px-3 py-1 font-medium hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700">
                    {copied ? '복사됨 ✓' : '안건 본문 복사'}
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs text-gray-600 dark:text-slate-300">
                      회의
                      <select value={effectiveMeetingId} onChange={e => setMeetingId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                        {policyMeetings.map(m => (
                          <option key={m.id} value={m.id}>{m.held_at?.slice(0, 10)} — {m.title}</option>
                        ))}
                        <option value={NEW_MEETING}>+ 새 정책회의 만들기</option>
                      </select>
                    </label>
                    {effectiveMeetingId === NEW_MEETING && (
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <label className="text-xs text-gray-600 dark:text-slate-300">
                          새 회의 제목
                          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                        </label>
                        <label className="text-xs text-gray-600 dark:text-slate-300">
                          개최일
                          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
                            className="mt-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                        </label>
                      </div>
                    )}
                    <label className="text-xs text-gray-600 dark:text-slate-300">
                      담당자
                      <input value={owner} onChange={e => setOwner(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </label>
                    <label className="text-xs text-gray-600 dark:text-slate-300">
                      검토 기한 (선택)
                      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                    </label>
                  </div>

                  {/* 미리보기 — 이대로 등록된다 */}
                  <div>
                    <div className="text-[11px] font-medium text-gray-500 dark:text-slate-400">미리보기 · 법인 {company} · 상태 대기</div>
                    <div className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800 dark:bg-slate-800 dark:text-slate-100">{agendaTitle}</div>
                    <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-gray-700 dark:bg-slate-800 dark:text-slate-300">{agendaBody}</pre>
                  </div>

                  {duplicate && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      이 회의에 같은 안건이 이미 있습니다 — 다른 회의를 고르거나 기존 안건을 수정하세요.
                    </p>
                  )}
                  {saveErr && <p className="text-xs text-red-600 dark:text-red-400">{saveErr}</p>}
                  <div className="flex justify-end gap-2">
                    <button onClick={copyBody} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-slate-300">
                      {copied ? '복사됨 ✓' : '본문 복사'}
                    </button>
                    <button onClick={() => void propose()} disabled={saving || duplicate || report.periods.length === 0}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                      {saving ? '등록 중…' : effectiveMeetingId === NEW_MEETING ? '회의 만들고 안건 상정' : '안건 상정'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
