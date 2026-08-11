/**
 * ProtocolTab — 환율 국면별 정책 프로토콜 편집
 *
 * 세션21차 신규. docs/기획/환율국면_동적헷지_시뮬레이터.md Phase 4
 *
 * 국면별 목표 비율을 코드에 하드코딩하지 않는 이유:
 *   회사마다 외화 수급 구조가 다르고(순지출 vs 순수입), 이 값은 정책회의 의결 대상이다.
 *   → policy_params 에 저장하고, 변경 이력이 남도록 한다.
 *
 * ⚠ 저장 단위는 **%** 다 (0.35 가 아니라 35). 기존 fx_target_min/max 가 % 로 저장돼 있어
 *   단위를 섞으면 조용히 100배 틀린 값이 들어간다.
 */
import { useState } from 'react'
import {
  ALL_REGIME_CODES, targetParamKey, PROTOCOL_PARAM_KEYS,
  regimeLabel, DEFAULT_TARGETS, DEFAULT_PROTOCOL,
  type PolicyProtocol, type RegimeCode, type TrendCode,
} from '../../lib/fxRegime'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

const TREND_TONE: Record<TrendCode, string> = {
  '1': 'text-red-600 dark:text-red-400',
  '2': 'text-red-500 dark:text-red-300',
  '3': 'text-slate-600 dark:text-slate-300',
  '4': 'text-blue-500 dark:text-blue-300',
  '5': 'text-blue-600 dark:text-blue-400',
}

interface ScalarField {
  key:   string
  label: string
  hint:  string
  /** 화면·저장 단위가 % 인지 */
  unit:  string
  value: number
  def:   number
}

export interface ProtocolTabProps {
  protocol:  PolicyProtocol
  canEdit:   boolean
  userCode:  string
  /** usePolicyParams().set */
  onSave:    (key: string, value: number) => Promise<string | null>
  onSaved:   () => void
}

export default function ProtocolTab({ protocol, canEdit, userCode, onSave, onSaved }: ProtocolTabProps) {
  const [draft, setDraft]   = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState<string | null>(null)
  const [err, setErr]       = useState<string | null>(null)

  const scalars: ScalarField[] = [
    { key: PROTOCOL_PARAM_KEYS.strongTrendER, label: '강한 추세 기준 (ER)',
      hint: '이 값 이상이면 ①/⑤ 강한 추세', unit: '',
      value: protocol.thresholds.strongTrendER, def: DEFAULT_PROTOCOL.thresholds.strongTrendER },
    { key: PROTOCOL_PARAM_KEYS.weakTrendER, label: '추세 인정 기준 (ER)',
      hint: '이 값 미만이면 ③ 횡보', unit: '',
      value: protocol.thresholds.weakTrendER, def: DEFAULT_PROTOCOL.thresholds.weakTrendER },
    { key: PROTOCOL_PARAM_KEYS.minTrendMovePct, label: '최소 순변동폭',
      hint: '20일간 이 폭 미만이면 방향 무관 횡보 (랜덤워크 1σ≈2%)', unit: '%',
      value: protocol.thresholds.minTrendMovePct * 100, def: DEFAULT_PROTOCOL.thresholds.minTrendMovePct * 100 },
    { key: PROTOCOL_PARAM_KEYS.highVolZ, label: '고변동성 기준 (Z)',
      hint: '변동성 Z-Score 가 이 값 이상이면 A(고변동)', unit: '',
      value: protocol.thresholds.highVolZ, def: DEFAULT_PROTOCOL.thresholds.highVolZ },
    { key: PROTOCOL_PARAM_KEYS.confirmDays, label: '국면 확정 일수',
      hint: '연속 동일 판정 시에만 전환 (웝소 방지)', unit: '일',
      value: protocol.confirmDays, def: DEFAULT_PROTOCOL.confirmDays },
    { key: PROTOCOL_PARAM_KEYS.rebalanceBandPct, label: '리밸런싱 밴드',
      hint: '목표와 현재 차이가 이 값 미만이면 거래 안 함', unit: '%p',
      value: protocol.rebalanceBandPct * 100, def: DEFAULT_PROTOCOL.rebalanceBandPct * 100 },
    { key: PROTOCOL_PARAM_KEYS.kalmanQ, label: '칼만 Q (전이 노이즈)',
      hint: '클수록 시장을 빨리 따라감', unit: '',
      value: protocol.kalmanQ, def: DEFAULT_PROTOCOL.kalmanQ },
    { key: PROTOCOL_PARAM_KEYS.kalmanR, label: '칼만 R (관측 노이즈)',
      hint: '클수록 강하게 평활 (지연 증가)', unit: '',
      value: protocol.kalmanR, def: DEFAULT_PROTOCOL.kalmanR },
  ]

  function setD(key: string, v: string) {
    setDraft(d => ({ ...d, [key]: v }))
    setMsg(null)
  }

  async function saveAll() {
    const entries = Object.entries(draft)
    if (!entries.length) return
    setSaving(true); setErr(null); setMsg(null)

    let ok = 0
    for (const [key, raw] of entries) {
      const v = Number(String(raw).replace(/,/g, ''))
      if (!Number.isFinite(v)) { setErr(`${key}: 숫자가 아닙니다`); setSaving(false); return }
      const e = await onSave(key, v)
      if (e) { setErr(`${key} 저장 실패: ${e}`); setSaving(false); return }
      ok++
    }
    setSaving(false)
    setDraft({})
    setMsg(`${ok}개 항목 저장 완료`)
    onSaved()
  }

  const dirty = Object.keys(draft).length > 0

  return (
    <div className="space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
            🎯 국면별 목표 외화 보유 비율
          </div>
          <div className="text-[11px] text-gray-500 dark:text-slate-400">
            이 값은 <strong>제안의 출발점</strong>일 뿐이며, 결제 버퍼 하한과 정책 밴드로 다시 조정됩니다.
          </div>
          {canEdit && dirty && (
            <button
              onClick={() => void saveAll()}
              disabled={saving}
              className="ml-auto rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >{saving ? '저장 중…' : `변경사항 저장 (${Object.keys(draft).length})`}</button>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-slate-700 dark:text-slate-400">
                <th className="py-2">국면</th>
                <th className="py-2">설명</th>
                <th className="py-2 text-right">목표 비율 (%)</th>
                <th className="py-2 text-right">기본값</th>
              </tr>
            </thead>
            <tbody>
              {ALL_REGIME_CODES.map((code: RegimeCode) => {
                const key = targetParamKey(code)
                const cur = (protocol.targets[code] * 100)
                const def = (DEFAULT_TARGETS[code] * 100)
                const trend = code.split('-')[0] as TrendCode
                return (
                  <tr key={code} className="border-b border-gray-100 dark:border-slate-800">
                    <td className={`py-1.5 font-semibold ${TREND_TONE[trend]}`}>{code}</td>
                    <td className="py-1.5 text-xs text-gray-600 dark:text-slate-300">{regimeLabel(code)}</td>
                    <td className="py-1.5 text-right">
                      {canEdit ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={draft[key] ?? cur.toFixed(1)}
                          onChange={e => setD(key, e.target.value)}
                          className="w-20 rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        <span className="tabular-nums">{cur.toFixed(1)}</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right text-xs tabular-nums text-gray-400 dark:text-slate-500">
                      {def.toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={CARD}>
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">⚙️ 판정 파라미터</div>
        <div className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
          기본값은 원/달러 데이터에 맞춰 교정한 <strong>추정치</strong>입니다.
          확정 전에 시뮬레이션 탭에서 반드시 검증하세요.
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {scalars.map(f => (
            <div key={f.key} className="rounded bg-gray-50 p-2 dark:bg-slate-800">
              <div className="text-[11px] font-medium text-gray-700 dark:text-slate-200">{f.label}</div>
              <div className="mt-1 flex items-center gap-1">
                {canEdit ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draft[f.key] ?? String(f.value)}
                    onChange={e => setD(f.key, e.target.value)}
                    className="w-20 rounded border border-gray-300 bg-white px-2 py-0.5 text-right text-xs tabular-nums dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <span className="text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">{f.value}</span>
                )}
                <span className="text-[11px] text-gray-500 dark:text-slate-400">{f.unit}</span>
                <span className="ml-auto text-[10px] text-gray-400 dark:text-slate-500">기본 {f.def}</span>
              </div>
              <div className="mt-1 text-[10px] leading-tight text-gray-400 dark:text-slate-500">{f.hint}</div>
            </div>
          ))}
        </div>
        {canEdit && dirty && (
          <button
            onClick={() => void saveAll()}
            disabled={saving}
            className="mt-3 rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >{saving ? '저장 중…' : `변경사항 저장 (${Object.keys(draft).length})`}</button>
        )}
        {msg && <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">{msg} · 변경자 {userCode}</div>}
        {err && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</div>}
      </div>

      <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        <strong>거버넌스</strong> — 이 프로토콜 변경은 자금정책회의 의결 대상입니다.
        값을 바꾸면 대시보드의 매각/매수 제안 금액이 즉시 달라지므로,
        변경 전 시뮬레이션 결과를 회의체에 함께 보고하세요.
      </div>
    </div>
  )
}
