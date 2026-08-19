import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fmtKRW } from '../../lib/format'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'
const num = (v: number) => Math.round(v).toLocaleString()
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtKRW(Math.abs(v))}`

/**
 * 권고 → 매각 지시 등록 패널.
 *
 * 세션26차 7일차: 원래 ② 환전 판단 탭 안에 있었으나, "가장 중요한 실무 행동(발의)이
 * 탭을 열어야만 보인다"는 사용자 리포트로 ① 현재 국면 조치 카드(VerdictCard) 바로
 * 아래, 화면 최상단으로 옮겼다. 실행(체결)은 여전히 외화 원장 한 곳뿐이다 —
 * 여기서는 발의(제안)까지만 한다("발의는 여러 곳, 집행·추적은 한 곳" 원칙).
 *
 * ⚠ window.confirm 을 쓰지 않는다 — 크롬이 반복 대화상자를 차단하면 즉시 false 를
 *   반환해 "버튼을 눌러도 아무 일도 안 일어나는" 상태가 된다(세션24차 실사고).
 *   화면 안에서 내용을 보여주고 명시적으로 승인받는다.
 */
export default function RegisterOrderPanel({ currency, company, allowedFx, rate, avgCostRate, onRegister }: {
  currency: string; company: string; allowedFx: number; rate: number; avgCostRate: number
  onRegister: (amountFx: number) => Promise<string | null>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const amount = Math.floor(allowedFx)
  const pnl = avgCostRate > 0 ? (rate - avgCostRate) * amount : null

  async function run() {
    setBusy(true)
    const err = await onRegister(amount)
    setBusy(false)
    setConfirming(false)
    setMsg(err ? { ok: false, text: `등록 실패: ${err}` } : {
      ok: true, text: '매각 지시로 등록했습니다 — 승인 후 완료 처리하세요(기한 3영업일).',
    })
  }

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">🧾 매각 지시 등록</div>
        <span className="text-[11px] text-gray-500 dark:text-slate-400">
          권고를 발의 → 승인 → 완료 워크플로우에 태웁니다 (기한: 등록일 +3영업일)
        </span>
        {!confirming && !msg && (
          <button type="button" onClick={() => setConfirming(true)}
            className="ml-auto rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">
            이 권고로 매각 지시 등록
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-800 dark:bg-orange-950/30">
          <div className="font-semibold text-orange-800 dark:text-orange-300">등록 내용을 확인하세요</div>
          <ul className="mt-1.5 space-y-0.5 text-orange-800 dark:text-orange-300">
            <li>· 통화 · 금액: <strong>{currency} {num(amount)}</strong> (분기 손실 한도 내 집행 가능액)</li>
            <li>· 매도 예정 환율: {rate.toLocaleString()}원 · 장부환율 {avgCostRate > 0 ? avgCostRate.toLocaleString() : '—'}</li>
            {pnl != null && (
              <li>· 예상 환차{pnl >= 0 ? '익' : '손'}: <strong>{signed(pnl)}</strong></li>
            )}
            <li>· 구분: 리짐 권고 매각 · 이행 기한: 등록일 +3영업일 (환율과 무관하게 실행)</li>
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} disabled={busy}
              className="rounded border border-orange-300 px-3 py-1.5 font-medium text-orange-700 dark:border-orange-700 dark:text-orange-300">
              취소
            </button>
            <button type="button" onClick={() => void run()} disabled={busy}
              className="rounded bg-orange-600 px-3 py-1.5 font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
              {busy ? '등록 중…' : '매각 지시 등록'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`mt-2 text-xs ${msg.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>
          {msg.text}
          {/* 승인·체결 등 실행 액션은 이 화면에서 하지 않는다 — 외화 원장이 유일한
              실행 화면이다("발의는 여러 곳, 집행·추적은 한 곳", 세션26차 7일차). */}
          {msg.ok && (
            <Link to={`/fx-ledger/${company}?tab=orders&currency=${currency}`} className="ml-1.5 font-semibold underline">
              외화거래명세에서 승인·체결 →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
