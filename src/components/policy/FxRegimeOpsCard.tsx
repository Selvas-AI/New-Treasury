/**
 * FxRegimeOpsCard — FX 리짐 정책 기준 편집 (정책회의 전용)
 *
 * 세션26차 신규. 근거: docs/기획/FX리짐_정책이관_계획.md §2, §7 Phase 1
 *
 * ⭐ 소유권 원칙 — **가정은 정책, 사실은 실무**
 *   여기서 편집하는 값들은 전부 `policy_params`(법인 단위)에 저장되며,
 *   실무 화면(/fx-regime)에서는 🔒 배지와 함께 읽기 전용으로만 보인다.
 *
 * ⚠ 월 유입액·결제 버퍼가 왜 정책 소유인가:
 *   이 둘은 결제 버퍼 하한을 통해 **권고 환전액을 직접 움직인다.**
 *   버퍼를 250만불 → 500만불로 올리면 하한이 올라가 "환전 불필요"가 나온다.
 *   실무가 손대면 안 되는 레버라서 회의체 의결 대상으로 둔다.
 *
 * ⚠ 단위: 정책 밴드는 DB 에 **%**(20)로 저장한다. 0~1 변환은 fxRegimeInputs 에서만.
 */
import { useMemo, useState } from 'react'
import { NumInput } from '../common/NumInput'
import { FX_OPS_PARAM_KEYS, REGIME_CURRENCIES, regimeOpsFallback } from '../../lib/fxRegimeInputs'
import { fmtKRW } from '../../lib/format'
import type { DerivedOps } from '../../lib/cashflowFxDerive'
import type { Company } from '../../types'


interface ParamStore {
  get: (key: string) => number | null
  set: (
    key: string, value: number | null, text: string | null, updatedBy: string,
    audit?: { note?: string | null },
  ) => Promise<string | null>
  getMeta?: (key: string) => { overridden_by: string | null; overridden_at: string | null; override_note: string | null } | null
  refetch: () => Promise<void> | void
}

/**
 * 공통 NumInput 위에 **미설정(null)** 개념을 얹은 래퍼.
 * 정책 밴드는 "0%" 와 "설정 안 함" 을 구분해야 해서 null 이 필요하다.
 */
function ParamInput({ value, onChange, disabled, placeholder }: {
  value: number | null
  onChange: (v: number | null) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <NumInput
      decimal
      disabled={disabled}
      placeholder={placeholder}
      value={value == null ? '' : String(value)}
      onChange={raw => {
        if (raw === '') { onChange(null); return }
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0) onChange(n)
      }}
      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-right text-sm tabular-nums
                 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500
                 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100
                 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-400"
    />
  )
}

export default function FxRegimeOpsCard({
  company, params, canEdit, userLabel, incomingBand, onConsumeBand, onDeriveFromPlan,
}: {
  company: Company
  params: ParamStore
  canEdit: boolean
  userLabel: string
  /** 한도 계산기에서 넘어온 권고 밴드(%). 저장 전 초안으로만 들어간다. */
  incomingBand?: { min: number; max: number } | null
  /** 초안에 반영한 뒤 부모의 값을 비운다 — 탭을 오갈 때마다 되살아나지 않게 */
  onConsumeBand?: () => void
  /** 주간예측(12주 롤링)에서 통화별 운영 가정을 산출한다. 저장하지 않고 초안만 채운다. */
  onDeriveFromPlan?: () => DerivedOps[]
}) {
  /** 사용자가 직접 편집한 값만 담는 초안. 비어 있으면 저장할 것이 없다. */
  const [draft, setDraft] = useState<Record<string, number | null>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  /** 주간예측 산출 결과 — 초안에 얹되 사용자가 직접 고친 값이 우선한다 */
  const [derived, setDerived] = useState<DerivedOps[] | null>(null)

  /**
   * 화면에 반영되는 초안 = 계산기에서 넘어온 밴드 + 사용자 편집(사용자 편집이 우선).
   *
   * ⚠ effect + setState 로 초안에 밀어넣지 않는다 — 렌더마다 상태를 덧쓰는 구조가 되어
   *   불필요한 캐스케이드 렌더가 생기고, 사용자가 값을 지워도 계산기 값이 되살아난다.
   *   부모(bandDraft)는 저장 성공·되돌리기 때만 비운다(서브탭을 오가도 초안이 살아남게).
   */
  const effectiveDraft = useMemo<Record<string, number | null>>(() => {
    const base: Record<string, number | null> = {}
    if (incomingBand) {
      base[FX_OPS_PARAM_KEYS.bandMin] = incomingBand.min
      base[FX_OPS_PARAM_KEYS.bandMax] = incomingBand.max
    }
    for (const d of derived ?? []) {
      // 계획이 하나도 없는 통화까지 0 으로 덮으면 기존 의결값이 날아간다 — 건너뛴다.
      if (d.itemCount === 0) continue
      base[FX_OPS_PARAM_KEYS.monthlyInflow(d.currency)] = d.monthlyInflowFx
      base[FX_OPS_PARAM_KEYS.payable(d.currency)]       = d.fxPayableFx
    }
    return { ...base, ...draft }
  }, [incomingBand, derived, draft])

  /** 계산기에서 불러온 값이 아직 살아있는가 — "이미 저장됐다"는 오해를 막는 배지 조건 */
  const fromCalc = incomingBand != null

  const read = (key: string): number | null =>
    key in effectiveDraft ? effectiveDraft[key] : params.get(key)

  const edit = (key: string, v: number | null) => {
    setDraft(prev => ({ ...prev, [key]: v }))
    setMsg(null)
  }

  const dirtyKeys = useMemo(
    () => Object.keys(effectiveDraft).filter(k => effectiveDraft[k] !== params.get(k)),
    [effectiveDraft, params],
  )

  const bandMin = read(FX_OPS_PARAM_KEYS.bandMin)
  const bandMax = read(FX_OPS_PARAM_KEYS.bandMax)
  const bandInvalid = bandMin != null && bandMax != null && bandMin > bandMax

  async function save() {
    if (bandInvalid) { setMsg({ ok: false, text: '정책 밴드 하한이 상한보다 큽니다.' }); return }
    setSaving(true)
    try {
      const errors: string[] = []
      for (const key of dirtyKeys) {
        // 사유는 감사 추적용 — 컬럼 미적용 환경이면 usePolicyParams 가 값만 저장한다.
        const err = await params.set(key, effectiveDraft[key], null, userLabel, { note: note.trim() || null })
        if (err) errors.push(`${key}: ${err}`)
      }
      await params.refetch()
      if (errors.length) {
        setMsg({ ok: false, text: `일부 저장 실패 — ${errors.join(' / ')}` })
      } else {
        setDraft({}); setNote(''); setDerived(null); onConsumeBand?.()
        setMsg({ ok: true, text: `${dirtyKeys.length}건 저장했습니다. 실무 화면에 즉시 반영됩니다.` })
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '저장 실패' })
    } finally {
      setSaving(false)
    }
  }

  const cell = 'px-2 py-1.5'

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-5 dark:border-blue-900 dark:bg-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-gray-800 dark:text-slate-100">
          🧭 FX 리짐 정책 기준
        </h3>
        <span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
          정책회의 전용
        </span>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">
          {company} · 환율 국면 화면(/fx-regime)의 판정 입력값
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
        여기서 정한 값은 실무 화면에서 <strong>읽기 전용</strong>으로만 보입니다.
        월 유입액과 결제 버퍼는 버퍼 하한을 통해 권고 환전액을 직접 바꾸므로 실무가 임의로
        변경할 수 없습니다. 근거 자료(매출계획·결제예정표)는 실무가 회의에 제출하고,
        숫자 확정은 이 화면에서 합니다.
      </p>

      {/* ── 통화별 운영 가정 ───────────────────────────────────── */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-slate-600 dark:text-slate-400">
              <th className={`${cell} text-left`}>통화</th>
              <th className={`${cell} text-right`}>월 외화 유입 가정</th>
              <th className={`${cell} text-right`}>향후 3개월 결제 버퍼</th>
            </tr>
          </thead>
          <tbody>
            {REGIME_CURRENCIES.map(code => {
              const inflowKey = FX_OPS_PARAM_KEYS.monthlyInflow(code)
              const payableKey = FX_OPS_PARAM_KEYS.payable(code)
              // 미설정이면 판정이 쓰는 폴백값을 placeholder 로 보여준다 —
              // 화면에 0, 엔진에 300만이 들어가면 회의체가 실제 적용값을 알 수 없다.
              const fb = regimeOpsFallback(company, code)
              const ph = (v: number) => (v > 0 ? `${v.toLocaleString()} (기본값 적용 중)` : '0')
              return (
                <tr key={code} className="border-b border-gray-100 dark:border-slate-700/60">
                  <td className={`${cell} font-semibold text-gray-700 dark:text-slate-200`}>{code}</td>
                  <td className={cell}>
                    <ParamInput value={read(inflowKey)} disabled={!canEdit}
                      placeholder={ph(fb.monthlyInflowFx)}
                      onChange={v => edit(inflowKey, v)} />
                  </td>
                  <td className={cell}>
                    <ParamInput value={read(payableKey)} disabled={!canEdit}
                      placeholder={ph(fb.fxPayableFx)}
                      onChange={v => edit(payableKey, v)} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* 주간예측에서 산출 — 계산기 → 정책 기준 인계와 같은 원칙(참고안만, 확정은 저장) */}
      {canEdit && onDeriveFromPlan && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setDerived(onDeriveFromPlan()); setMsg(null) }}
            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700
                       hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
            📥 주간예측에서 산출
          </button>
          <span className="text-[11px] text-gray-400 dark:text-slate-500">
            향후 12주 외화 유입 ÷ 3 = 월 유입 · 13주 이내 외화 유출 = 결제 버퍼 (저장 전 초안)
          </span>
        </div>
      )}
      {derived && (
        <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800 dark:bg-blue-900/25 dark:text-blue-200">
          {derived.some(d => d.itemCount > 0)
            ? <>📥 주간예측에서 산출한 값을 채웠습니다 — <strong>아직 저장되지 않았습니다.</strong>{' '}
                {derived.filter(d => d.itemCount > 0).map(d => `${d.currency} ${d.itemCount}건`).join(' · ')}</>
            : <>주간예측에 <strong>외화 계획 항목이 없습니다.</strong> 주간예측 탭에서 통화를 지정해
                입력하면 여기서 자동 산출할 수 있습니다.</>}
        </p>
      )}

      <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
        금액은 <strong>외화 원금</strong>입니다(원화 환산액이 아닙니다). 결제 버퍼가 0이면
        하한이 없어 알고리즘이 전량 매도를 제안할 수 있습니다.
        회색으로 <em>기본값 적용 중</em>이라고 표시된 칸은 아직 의결값이 없어 실측 기본값이
        판정에 쓰이는 상태입니다 — 회의에서 확정해 저장하세요.
      </p>

      {/* ── 정책 밴드 · 손실 한도 ──────────────────────────────── */}
      {fromCalc && (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800 dark:bg-blue-900/25 dark:text-blue-200">
          📥 한도 계산기의 <strong>권고 밴드</strong>를 아래 칸에 채웠습니다 —
          아직 <strong>저장되지 않았습니다</strong>. 값을 확인하고 사유와 함께 의결 저장하세요.
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-600 dark:text-slate-300">
          <span className="flex justify-between gap-2">
            <span>정책 밴드 하한</span><span className="text-gray-400">%</span>
          </span>
          <div className="mt-1">
            <ParamInput value={bandMin} disabled={!canEdit} placeholder="미설정"
              onChange={v => edit(FX_OPS_PARAM_KEYS.bandMin, v)} />
          </div>
        </label>
        <label className="text-xs text-gray-600 dark:text-slate-300">
          <span className="flex justify-between gap-2">
            <span>정책 밴드 상한</span><span className="text-gray-400">%</span>
          </span>
          <div className="mt-1">
            <ParamInput value={bandMax} disabled={!canEdit} placeholder="미설정"
              onChange={v => edit(FX_OPS_PARAM_KEYS.bandMax, v)} />
          </div>
        </label>
        <label className="text-xs text-gray-600 dark:text-slate-300">
          <span className="flex justify-between gap-2">
            <span>분기 손실 실현 한도</span><span className="text-gray-400">원</span>
          </span>
          <div className="mt-1">
            <ParamInput value={read(FX_OPS_PARAM_KEYS.lossCap)} disabled={!canEdit} placeholder="0"
              onChange={v => edit(FX_OPS_PARAM_KEYS.lossCap, v)} />
          </div>
        </label>
      </div>

      <p className="mt-1 text-[11px] text-gray-400 dark:text-slate-500">
        정책 밴드는 <strong>전사 외화 바구니 ÷ 총자금</strong> 기준이며, 리짐 목표 비중이 이 밴드를
        넘을 수 없습니다(충돌 시 정책이 이깁니다). 아래 한도 계산기의 권고 밴드를 참고안으로
        쓰되, 확정값은 이 칸에 직접 입력합니다.
        {' '}이번 분기 <strong>기실현 손실</strong>은 실무가 기록하는 사실 항목이라 여기서 편집하지 않습니다
        (현재 {fmtKRW(params.get(FX_OPS_PARAM_KEYS.lossUsed) ?? 0)}).
      </p>

      {bandInvalid && (
        <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
          정책 밴드 하한은 상한보다 클 수 없습니다.
        </p>
      )}

      {/* ── 정정 사유 (감사 추적) ──────────────────────────────── */}
      {canEdit && dirtyKeys.length > 0 && (
        <label className="mt-4 block text-xs text-gray-600 dark:text-slate-300">
          정정 사유 <span className="text-gray-400">(선택 — 회의록 대조용으로 함께 저장)</span>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="예) 2026년 3차 정책회의 의결 — 하반기 결제 계획 반영"
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm
                       dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
      )}

      {/* 마지막 정정 기록 — 마이그레이션 미적용 시에는 표시되지 않는다 */}
      {(() => {
        const meta = params.getMeta?.(FX_OPS_PARAM_KEYS.bandMax)
        if (!meta?.overridden_at) return null
        return (
          <p className="mt-2 text-[11px] text-gray-400 dark:text-slate-500">
            최근 밴드 정정: {meta.overridden_at.slice(0, 10)} · {meta.overridden_by ?? '—'}
            {meta.override_note ? ` · "${meta.override_note}"` : ''}
          </p>
        )
      })()}

      {/* ── 저장 ───────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canEdit || saving || dirtyKeys.length === 0 || bandInvalid}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white
                     hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? '저장 중…' : dirtyKeys.length > 0 ? `의결값 저장 (${dirtyKeys.length}건)` : '변경 없음'}
        </button>
        {dirtyKeys.length > 0 && !saving && (
          <button type="button" onClick={() => { setDraft({}); setMsg(null); setDerived(null); onConsumeBand?.() }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-600
                       hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700">
            되돌리기
          </button>
        )}
        {!canEdit && (
          <span className="text-xs text-gray-500 dark:text-slate-400">
            조회 전용 — 정책 편집 권한이 있는 계정만 변경할 수 있습니다.
          </span>
        )}
        {msg && (
          <span className={`text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  )
}
