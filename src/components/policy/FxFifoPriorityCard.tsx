import { useMemo, useState } from 'react'
import { ACCOUNT_TYPE_LABEL, parseAccountPriority, type FxAccountType } from '../../lib/fxLots'
import type { Company } from '../../types'

/** 정기예금은 만기 전 소진이 불가능해 우선순위 대상이 아니다 — 목록에서 제외한다. */
const SELECTABLE: FxAccountType[] = ['demand_deposit', 'mmda']

const PRESETS: { key: string; text: string; label: string; hint: string }[] = [
  { key: 'none', text: '', label: '취득일 순만 (현행)',
    hint: '계좌유형을 보지 않고 오래된 로트부터 소진합니다. 가장 단순하고 조작 여지가 없습니다.' },
  { key: 'demand_first', text: 'demand_deposit,mmda', label: '보통예금 → MMDA',
    hint: '이자가 붙는 MMDA 를 남기고 보통예금부터 씁니다. 이자 수익을 지키는 선택입니다.' },
  { key: 'mmda_first', text: 'mmda,demand_deposit', label: 'MMDA → 보통예금',
    hint: 'MMDA 를 먼저 헐어 씁니다. MMDA 금리가 낮거나 계좌를 정리할 때 씁니다.' },
]

/**
 * FIFO 계좌유형 소진 우선순위 편집 (세션26차 11일차, 정책회의 전용).
 *
 * ⚠⚠ 이건 표시 설정이 아니라 **원가흐름 가정의 변경**이다. 로트마다 취득환율이
 *   다르므로 소진 순서가 바뀌면 앞으로 기록될 **확정 환차손익이 달라진다.**
 *   그래서 체결 단위 임의 선택을 지원하지 않고 법인 단위 정책값으로만 둔다 —
 *   담당자가 매번 유리한 로트를 고르는 cherry-picking 을 구조적으로 막기 위함.
 *
 * 이미 소진된 과거 이력은 바뀌지 않는다(정상 — 그때의 가정으로 확정된 손익이다).
 */
export default function FxFifoPriorityCard({ company, params, canEdit, userLabel }: {
  company: Company
  params: {
    getText: (key: string) => string | null
    set: (key: string, value: number | null, text: string | null, updatedBy: string,
      audit?: { note?: string | null }) => Promise<string | null>
    refetch: () => Promise<void>
  }
  canEdit: boolean
  userLabel: string
}) {
  const saved = params.getText('fx_fifo_account_priority') ?? ''
  const savedValuation = params.getText('fx_transfer_valuation') === 'revalue' ? 'revalue' : 'carryover'
  const [draft, setDraft] = useState<string | null>(null)
  const [valuationDraft, setValuationDraft] = useState<'carryover' | 'revalue' | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const current = draft ?? saved
  const valuation = valuationDraft ?? savedValuation
  const dirty = current !== saved || valuation !== savedValuation
  const order = useMemo(() => {
    const p = parseAccountPriority(current)
    return [...SELECTABLE].sort((a, b) => (p[a] ?? 999) - (p[b] ?? 999))
  }, [current])

  async function save() {
    setSaving(true)
    try {
      const errors: string[] = []
      if (current !== saved) {
        // 빈 문자열이 아니라 null 로 저장한다 — 서버 헬퍼가 nullif(trim(...),'') 로
        // 둘을 같게 보긴 하지만, "미설정"이 명시적으로 남는 편이 읽기 쉽다.
        const e = await params.set('fx_fifo_account_priority', null, current || null, userLabel,
          { note: note.trim() || null })
        if (e) errors.push(e)
      }
      if (valuation !== savedValuation) {
        const e = await params.set('fx_transfer_valuation', null, valuation, userLabel,
          { note: note.trim() || null })
        if (e) errors.push(e)
      }
      if (errors.length) { setMsg({ ok: false, text: errors.join(' / ') }); return }
      await params.refetch()
      setDraft(null); setValuationDraft(null); setNote('')
      setMsg({ ok: true, text: '저장했습니다. 이후 등록되는 체결·대체부터 적용됩니다.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-5 dark:border-blue-900 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">📒 외화 원장 회계정책</h3>
        <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          정책회의 전용
        </span>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">{company}</span>
      </div>

      <p className="mt-3 text-xs font-semibold text-gray-700 dark:text-slate-200">① 매각 시 소진 우선순위</p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
        외화를 매각할 때 <strong>어느 계좌의 재고부터 소진할지</strong>를 정합니다.
        각 유형 안에서는 항상 취득일이 오래된 로트부터(FIFO) 소진합니다.
        <br />
        ⚠ 로트마다 취득환율이 달라 <strong>순서가 바뀌면 앞으로 확정될 환차손익이 달라집니다</strong> —
        원가흐름 가정의 변경이므로 정책회의 의결 사항입니다. 이미 소진된 과거 이력은 바뀌지 않습니다.
        <br />
        정기예금은 만기 전 소진이 불가능해 우선순위와 무관하게 항상 제외됩니다.
      </p>

      <div className="mt-3 space-y-2">
        {PRESETS.map(p => (
          <label key={p.key}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
              current === p.text
                ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/30'
                : 'border-gray-200 dark:border-slate-700'}`}>
            <input type="radio" name="fifo-priority" className="mt-0.5" checked={current === p.text}
              disabled={!canEdit} onChange={() => { setDraft(p.text); setMsg(null) }} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-gray-800 dark:text-slate-100">
                {p.label}
                {saved === p.text && <span className="ml-1.5 text-[10px] font-normal text-gray-400">현재 적용 중</span>}
              </span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-gray-500 dark:text-slate-400">
        적용 순서: <strong>{order.map(t => ACCOUNT_TYPE_LABEL[t]).join(' → ')}</strong>
        {!current && <span className="ml-1 text-gray-400">(유형 구분 없이 취득일 순)</span>}
      </p>

      {/* ② 계좌 간 대체 평가 방식 — 은행 실무가 회사마다 달라 법인별로 고른다. */}
      <p className="mt-5 text-xs font-semibold text-gray-700 dark:text-slate-200">② 계좌 간 대체 평가 방식</p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
        보통예금↔MMDA 이체, 정기예금 예치·해지처럼 <strong>총 외화 잔액이 변하지 않는 내부 이동</strong>에
        적용됩니다. 각 대체 건에는 <strong>그때 적용한 방식이 기록</strong>되므로, 나중에 정책을 바꿔도
        과거 이력의 해석은 흔들리지 않습니다.
      </p>
      <div className="mt-2 space-y-2">
        {([
          { key: 'carryover' as const, label: '원가승계 (권장)',
            hint: '장부환율·취득일을 그대로 물려받습니다. 실현손익 0, FIFO 순서 보존. 대체는 환전이 아니라는 회계 원칙에 부합합니다.' },
          { key: 'revalue' as const, label: '재평가',
            hint: '대체 시점 환율로 장부환율을 다시 잡습니다. 실현손익이 발생하고 취득일이 대체일로 리셋됩니다 — 사실상 매각+재매입입니다. 은행이 대체 시 환율을 새로 적용하는 실무일 때만 선택하세요.' },
        ]).map(o => (
          <label key={o.key}
            className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${
              valuation === o.key
                ? 'border-blue-400 bg-blue-50 dark:border-blue-600 dark:bg-blue-950/30'
                : 'border-gray-200 dark:border-slate-700'}`}>
            <input type="radio" name="fx-transfer-valuation" className="mt-0.5" checked={valuation === o.key}
              disabled={!canEdit} onChange={() => { setValuationDraft(o.key); setMsg(null) }} />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-gray-800 dark:text-slate-100">
                {o.label}
                {savedValuation === o.key && <span className="ml-1.5 text-[10px] font-normal text-gray-400">현재 적용 중</span>}
              </span>
              <span className="block text-[11px] text-gray-500 dark:text-slate-400">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="변경 사유 (의결 근거)"
            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
          <button onClick={() => void save()} disabled={!dirty || saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            {saving ? '저장 중…' : '의결 저장'}
          </button>
          {dirty && (
            <button onClick={() => { setDraft(null); setValuationDraft(null); setMsg(null) }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 dark:border-slate-600 dark:text-slate-300">
              되돌리기
            </button>
          )}
        </div>
      )}

      {msg && (
        <p className={`mt-2 text-[11px] ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {msg.text}
        </p>
      )}
      <p className="mt-2 text-[10px] text-gray-400">
        ⚠ 서버 마이그레이션이 적용돼야 실제로 반영됩니다 —
        ①은 <code>docs/db/fx_fifo_account_priority.sql</code>, ②는 <code>docs/db/fx_lot_transfer.sql</code>.
        미적용 상태에서는 저장은 되지만 서버는 기본 동작(취득일 순 · 원가승계)을 유지합니다.
      </p>
    </div>
  )
}
