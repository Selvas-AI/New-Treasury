/**
 * ReportSummaryTable — 자금일보 자금현황 요약 테이블
 *
 * 구조:
 *   운전자금  : KRW 행 + FX 행(외화액 / 원화환산 분리) + 소계
 *   운용자금
 *     예금성  : 정기예금, 중금채 + 소계
 *     비예금성: 국채(단건), MMF, RP, 기타 + 소계
 *   ─────────────────────────────────────
 *   자금 총합계 (운전 + 운용, 원화환산)
 *   ─────────────────────────────────────
 *   차입금    : 단기/장기 + 소계  ← 총합계 미포함
 */
import { useCallback } from 'react'
import { Link } from 'react-router-dom'
import type { DailyRecord } from '../../types'
import type { InvestGroup, LoanGroup, EquityGroup, ItemSums } from '../../hooks/useDailyReportSummary'
import type { FxCode } from '../../types'
import type { PrefillPayload } from './ItemsSection'

interface Props {
  prevDaily:          DailyRecord | null
  currDaily:          DailyRecord | null
  investGroups:       InvestGroup[]
  depositSubtotal:    number
  nonDepositSubtotal: number
  loanGroups:         LoanGroup[]
  equityGroups:       EquityGroup[]
  itemSums:           ItemSums
  loading:            boolean
  company:            string
  baseDate:           string   // 기초일 (전전일, D-2)
  closeDate:          string   // 마감일 = 보고서 날짜 (전일, D-1)
  toKRW:              (amount: number, currency: string) => number
  fx:                 { rates: Array<{ code: string; rate: number; unit: number }> }
  onDeltaClick?:      (payload: PrefillPayload) => void
}

const FX_CODES: FxCode[] = ['USD', 'EUR', 'JPY', 'GBP', 'CNY']

function fmt(n: number): string {
  if (n === 0) return '—'
  return Math.round(n).toLocaleString('ko-KR')
}
function fmtFx(n: number, code: FxCode): string {
  if (n === 0) return '—'
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: code === 'JPY' ? 0 : 2,
  })
}

// 차액(Δ) 셀 — 양수: 파랑+, 음수: 빨강, 0: 회색 / onClick 있으면 클릭 가능
function DeltaCell({ diff, isFx, code, onClick }: {
  diff: number; isFx?: boolean; code?: FxCode; onClick?: () => void
}) {
  if (diff === 0) return <td className="px-3 py-2 text-right text-gray-300 dark:text-gray-600 text-[10px]">—</td>
  const pos   = diff > 0
  const cls   = pos ? 'text-blue-500 dark:text-blue-400' : 'text-red-500 dark:text-red-400'
  const label = isFx && code
    ? `${pos ? '+' : ''}${fmtFx(diff, code)}`
    : `${pos ? '+' : ''}${Math.round(diff).toLocaleString('ko-KR')}`

  if (onClick) {
    return (
      <td className={`px-3 py-2 text-right tabular-nums text-[11px] font-medium ${cls} cursor-pointer hover:opacity-70`}
          onClick={onClick}
          title="클릭 → 입출금 항목에 자동 반영">
        {label} <span className="text-[9px] opacity-50">↗</span>
      </td>
    )
  }
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-[11px] font-medium ${cls}`}>
      {label}
    </td>
  )
}

// ── 섹션 헤더 ──────────────────────────────────────────────────
function SectionHeader({ label, sub }: { label: string; sub?: string }) {
  return (
    <tr className="bg-gray-50 dark:bg-slate-700/40">
      <td colSpan={7} className="px-4 py-1.5">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-300 uppercase tracking-wider">
          {label}
        </span>
        {sub && (
          <span className="ml-2 text-[10px] text-gray-400 dark:text-gray-500 normal-case tracking-normal">
            {sub}
          </span>
        )}
      </td>
    </tr>
  )
}

// ── 서브섹션 헤더 (예금성/비예금성) ──────────────────────────
function SubSectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-blue-50/30 dark:bg-blue-900/10">
      <td colSpan={7} className="px-4 py-1 pl-5">
        <span className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 uppercase tracking-wider">
          {label}
        </span>
      </td>
    </tr>
  )
}

// ── 소계 행 ────────────────────────────────────────────────────
function SubtotalRow({
  label, prevKrw, inKrw, outKrw, currKrw, note, indent,
}: {
  label: string; prevKrw: number; inKrw: number; outKrw: number; currKrw: number
  note?: string; indent?: boolean
}) {
  const diff = (currKrw || prevKrw) - prevKrw
  return (
    <tr className="border-t border-gray-200 dark:border-slate-600 font-semibold text-xs bg-gray-50/50 dark:bg-slate-700/20">
      <td className={`px-4 py-2 text-gray-600 dark:text-slate-100 ${indent ? 'pl-7' : 'pl-4'}`}>
        {label}
        {note && <span className="ml-1.5 text-[10px] font-normal text-gray-400 dark:text-gray-500">{note}</span>}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmt(prevKrw)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
        {inKrw > 0 ? fmt(inKrw) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
        {outKrw > 0 ? fmt(outKrw) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{fmt(currKrw || prevKrw)}</td>
      <td className="px-4 py-2 text-right text-[10px] text-gray-400 dark:text-gray-500">{note ? '(원화환산)' : ''}</td>
      <DeltaCell diff={diff} />
    </tr>
  )
}

// ── 총합계 행 ──────────────────────────────────────────────────
function TotalRow({ label, krw, prevKrw }: { label: string; krw: number; prevKrw: number }) {
  return (
    <tr className="border-t-2 border-gray-300 dark:border-gray-500 font-bold text-sm bg-blue-50 dark:bg-blue-900/20">
      <td className="px-4 py-2.5 text-blue-700 dark:text-blue-300">{label}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-blue-600 dark:text-blue-400 text-xs">{fmt(prevKrw)}</td>
      <td colSpan={2} />
      <td className="px-4 py-2.5 text-right tabular-nums text-blue-700 dark:text-blue-300">{fmt(krw)}</td>
      <td className="px-4 py-2.5 text-right text-[10px] text-blue-400 dark:text-blue-500">(원화환산)</td>
      <DeltaCell diff={krw - prevKrw} />
    </tr>
  )
}

// ── KRW 데이터 행 ──────────────────────────────────────────────
function KrwRow({ label, prevVal, currVal, inVal, outVal, isMissing, accountType, onDeltaClick }: {
  label: string; prevVal: number; currVal: number
  inVal: number; outVal: number; isMissing: boolean
  accountType: string
  onDeltaClick?: (p: PrefillPayload) => void
}) {
  // 미입력이지만 입출금 내역이 있으면 예상잔액 계산
  const estimated = isMissing && (inVal > 0 || outVal > 0) ? prevVal + inVal - outVal : null
  const diff = isMissing
    ? (estimated !== null ? estimated - prevVal : 0)
    : currVal - prevVal
  const handleDelta = (!isMissing && diff !== 0 && onDeltaClick)
    ? () => onDeltaClick({
        direction:   diff > 0 ? 'in' : 'out',
        amount:      Math.abs(diff),
        currency:    'KRW',
        accountType,
      })
    : undefined

  return (
    <tr className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 text-xs">
      <td className="px-4 py-2 pl-7 text-gray-600 dark:text-slate-300">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{fmt(prevVal)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
        {inVal > 0 ? fmt(inVal) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
        {outVal > 0 ? fmt(outVal) : '—'}
      </td>
      <td className={`px-4 py-2 text-right tabular-nums ${isMissing && estimated === null ? 'text-gray-300 dark:text-gray-600 italic' : 'text-gray-600 dark:text-slate-300'}`}>
        {isMissing
          ? (estimated !== null
              ? <span className="text-amber-500 dark:text-amber-400" title="입출금 입력 기반 예상 잔액">~{fmt(estimated)}</span>
              : '미입력')
          : fmt(currVal)}
      </td>
      <td className="px-4 py-2 text-right text-gray-300 dark:text-gray-700 text-[10px]">KRW</td>
      {(isMissing && estimated === null) ? <td /> : <DeltaCell diff={diff} onClick={handleDelta} />}
    </tr>
  )
}

// ── FX 데이터 행 ───────────────────────────────────────────────
function FxRow({ code, prevRaw, currRaw, prevKrw, currKrw, isMissing, inRaw, outRaw, onDeltaClick }: {
  code: FxCode; prevRaw: number; currRaw: number
  prevKrw: number; currKrw: number; isMissing: boolean
  inRaw?: number; outRaw?: number
  onDeltaClick?: (p: PrefillPayload) => void
}) {
  const label   = code === 'JPY' ? 'JPY (¥100 단위)' : code
  const diffRaw = isMissing ? 0 : currRaw - prevRaw
  const acctKey = `fx_${code.toLowerCase()}`
  const handleDelta = (!isMissing && diffRaw !== 0 && onDeltaClick)
    ? () => onDeltaClick({
        direction:   diffRaw > 0 ? 'in' : 'out',
        amount:      Math.abs(diffRaw),
        currency:    code,
        accountType: acctKey,
      })
    : undefined

  return (
    <tr className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 text-xs">
      <td className="px-4 py-2 pl-7 text-gray-600 dark:text-slate-300">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">
        {prevRaw > 0 ? fmtFx(prevRaw, code) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
        {(inRaw ?? 0) > 0 ? fmtFx(inRaw!, code) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
        {(outRaw ?? 0) > 0 ? fmtFx(outRaw!, code) : '—'}
      </td>
      <td className={`px-4 py-2 text-right tabular-nums ${isMissing ? 'text-gray-300 dark:text-gray-600 italic' : 'text-gray-600 dark:text-slate-300'}`}>
        {isMissing ? '미입력' : currRaw > 0 ? fmtFx(currRaw, code) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400 font-medium">
        {(currKrw > 0 ? currKrw : prevKrw) > 0 ? fmt(currKrw > 0 ? currKrw : prevKrw) : '—'}
      </td>
      {isMissing ? <td /> : <DeltaCell diff={diffRaw} isFx code={code} onClick={handleDelta} />}
    </tr>
  )
}

// ── 운용자금 일반 행 ────────────────────────────────────────────
// FX 예금(totalRaw 있음): 기초/마감잔액 = 외화액, 원화환산 열 = KRW (FxRow 패턴 동일)
// 국채(isBondGroup): 기초=prevKrw, 마감=totalKrw, 원화환산=KRW + 평가손익 자동 표시
// 기타(KRW): 모든 열 KRW
function InvestRow({ group, inKrw, outKrw, isAutoEval }: {
  group: InvestGroup; inKrw: number; outKrw: number; isAutoEval?: boolean
}) {
  const isBond  = group.isBondGroup === true
  const isFxDep = !isBond && group.totalRaw !== undefined && group.currency !== 'KRW'
  const code    = group.currency as FxCode

  const tooltipText = isBond
    ? `국채 API T+1 제한\n당일잔액: ${group.bondCurrDate ?? '미확인'} 기준가\n전일잔액: ${group.bondPrevDate ?? '미확인'} 기준가`
    : undefined

  // 전일잔액: 국채=prevKrw, FX예금=prevRaw(외화), 기타=totalKrw
  const prevDisplay = isBond
    ? fmt(group.prevKrw ?? group.totalKrw)
    : isFxDep
      ? (group.prevRaw != null && group.prevRaw > 0
          ? fmtFx(group.prevRaw, code)
          : (group.totalRaw! > 0 ? fmtFx(group.totalRaw!, code) : '—'))
      : fmt(group.totalKrw)

  // 당일잔액: 국채=totalKrw, FX예금=totalRaw(외화), 기타=totalKrw
  const currDisplay = isBond
    ? fmt(group.totalKrw)
    : isFxDep
      ? (group.totalRaw! > 0 ? fmtFx(group.totalRaw!, code) : '—')
      : fmt(group.totalKrw)

  return (
    <tr className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 text-xs">
      <td className="px-4 py-2 pl-9 text-gray-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5">
          <span className={isBond ? 'font-medium' : ''}>{group.label}</span>
          {isBond && group.bankLabel && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">({group.bankLabel})</span>
          )}
          {isBond && (
            <span
              title={tooltipText}
              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 text-[9px] cursor-help shrink-0 leading-none"
            >
              T
            </span>
          )}
          {isAutoEval && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400">🔄 자동</span>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">
        {prevDisplay}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
        {inKrw > 0 ? fmt(inKrw) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
        {outKrw > 0 ? fmt(outKrw) : '—'}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">
        {currDisplay}
      </td>
      {/* 원화환산 열: FX예금=KRW환산(파란색), 국채=KRW, 일반=KRW라벨 */}
      {isFxDep ? (
        <td className="px-4 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400 font-medium">
          {group.totalKrw > 0 ? fmt(group.totalKrw) : '—'}
        </td>
      ) : (
        <td className="px-4 py-2 text-right text-gray-300 dark:text-gray-700 text-[10px]">KRW</td>
      )}
      {/* Δ 열: FX예금=외화차액, 국채=KRW차액(prevKrw→totalKrw), 기타=0 */}
      {isFxDep
        ? <DeltaCell diff={(group.totalRaw ?? 0) - (group.prevRaw ?? group.totalRaw ?? 0)} isFx code={code} />
        : isBond
          ? <DeltaCell diff={group.totalKrw - (group.prevKrw ?? group.totalKrw)} />
          : <td className="px-3 py-2 text-right text-gray-300 dark:text-gray-600 text-[10px]">—</td>
      }
    </tr>
  )
}

export default function ReportSummaryTable({
  prevDaily, currDaily,
  investGroups, depositSubtotal, nonDepositSubtotal,
  loanGroups, equityGroups,
  itemSums,
  loading, company, baseDate, closeDate, toKRW, fx,
  onDeltaClick,
}: Props) {

  const fxKRW = useCallback((d: DailyRecord | null, code: FxCode): number => {
    if (!d) return 0
    const raw = d[`fx_${code.toLowerCase()}` as keyof DailyRecord] as number ?? 0
    return toKRW(raw, code)
  }, [toKRW])

  const opKRW = useCallback((d: DailyRecord | null): number => {
    if (!d) return 0
    const fxSum = FX_CODES.reduce((s, code) => s + fxKRW(d, code), 0)
    return (d.krw_demand ?? 0) + (d.krw_govt ?? 0) + (d.krw_mmda ?? 0) + fxSum
  }, [fxKRW])

  const prevOpKRW    = opKRW(prevDaily)
  const currOpKRW    = opKRW(currDaily)
  const totalInvKRW  = depositSubtotal + nonDepositSubtotal
  const totalLoanKRW = loanGroups.reduce((s, g) => s + g.totalKrw, 0)

  // 자금 총합계 = 운전자금 + 운용자금 (차입금·지분 제외)
  // prevOpKRW: fx_krw 기준 → 대시보드와 동일 공식
  const grandTotal = (currOpKRW > 0 ? currOpKRW : prevOpKRW) + totalInvKRW

  const activeFxCodes = FX_CODES.filter(code => {
    const p = prevDaily ? (prevDaily[`fx_${code.toLowerCase()}` as keyof DailyRecord] as number ?? 0) : 0
    const c = currDaily ? (currDaily[`fx_${code.toLowerCase()}` as keyof DailyRecord] as number ?? 0) : 0
    return p > 0 || c > 0
  })

  const depositGroups    = investGroups.filter(g => g.category === 'deposit')
  const nonDepositGroups = investGroups.filter(g => g.category === 'non-deposit')

  if (loading) {
    return (
      <div className="overflow-x-auto p-4 space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-3 bg-gray-100 dark:bg-slate-700 rounded animate-pulse"
            style={{ width: `${60 + (i % 4) * 10}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      {/* 당일 운전자금 미입력 안내 */}
      {!currDaily && (
        <div className="mx-4 mt-3 mb-2 flex items-center gap-2 px-3 py-2
                        bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700
                        rounded-lg text-xs text-amber-700 dark:text-amber-400">
          <span>⚠</span>
          <span>당일 운전자금이 입력되지 않았습니다.</span>
          <Link to={`/input/${company}/${closeDate}`}
            className="ml-auto underline hover:text-amber-800 dark:hover:text-amber-300 font-medium">
            입력하기 →
          </Link>
        </div>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-700/50 text-gray-500 dark:text-slate-300 text-[11px]">
            <th className="text-left px-4 py-2.5 font-medium w-52">구분</th>
            <th className="text-right px-4 py-2 font-medium leading-tight">
              기초잔액
              <div className="text-[9px] font-normal text-gray-400 dark:text-gray-500">{baseDate}</div>
            </th>
            <th className="text-right px-4 py-2.5 font-medium text-green-600 dark:text-green-400">입금액</th>
            <th className="text-right px-4 py-2.5 font-medium text-red-500 dark:text-red-400">출금액</th>
            <th className="text-right px-4 py-2 font-medium leading-tight">
              마감잔액
              <div className="text-[9px] font-normal text-gray-400 dark:text-gray-500">{closeDate}</div>
            </th>
            <th className="text-right px-4 py-2.5 font-medium text-blue-500 dark:text-blue-400">
              원화환산{activeFxCodes.length > 0 && <span className="text-[9px] ml-0.5 text-gray-400">(FX)</span>}
            </th>
            <th className="text-center px-3 py-2.5 font-medium text-gray-400 dark:text-gray-500">
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px]">Δ 차액</span>
                <span className="text-[9px] font-normal opacity-70">(마감－기초)</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">

          {/* ─── 운전자금 ─────────────────────────────────── */}
          <SectionHeader label="운전자금" />
          <KrwRow label="보통예금/CMA"    accountType="krw_demand" onDeltaClick={onDeltaClick}
            prevVal={prevDaily?.krw_demand ?? 0} currVal={currDaily?.krw_demand ?? 0}
            inVal={itemSums.byAccount['krw_demand']?.inKrw ?? 0}
            outVal={itemSums.byAccount['krw_demand']?.outKrw ?? 0}
            isMissing={!currDaily} />
          <KrwRow label="국책자금"        accountType="krw_govt"   onDeltaClick={onDeltaClick}
            prevVal={prevDaily?.krw_govt ?? 0}   currVal={currDaily?.krw_govt ?? 0}
            inVal={itemSums.byAccount['krw_govt']?.inKrw ?? 0}
            outVal={itemSums.byAccount['krw_govt']?.outKrw ?? 0}
            isMissing={!currDaily} />
          <KrwRow label="증권예수금/MMDA" accountType="krw_mmda"   onDeltaClick={onDeltaClick}
            prevVal={prevDaily?.krw_mmda ?? 0}   currVal={currDaily?.krw_mmda ?? 0}
            inVal={itemSums.byAccount['krw_mmda']?.inKrw ?? 0}
            outVal={itemSums.byAccount['krw_mmda']?.outKrw ?? 0}
            isMissing={!currDaily} />

          {activeFxCodes.map(code => {
            const prevRaw = prevDaily ? (prevDaily[`fx_${code.toLowerCase()}` as keyof DailyRecord] as number ?? 0) : 0
            const currRaw = currDaily ? (currDaily[`fx_${code.toLowerCase()}` as keyof DailyRecord] as number ?? 0) : 0
            const acctKey = `fx_${code.toLowerCase()}`
            return (
              <FxRow key={code} code={code}
                prevRaw={prevRaw} currRaw={currRaw}
                prevKrw={fxKRW(prevDaily, code)} currKrw={fxKRW(currDaily, code)}
                isMissing={!currDaily}
                inRaw={itemSums.byAccount[acctKey]?.inRaw ?? 0}
                outRaw={itemSums.byAccount[acctKey]?.outRaw ?? 0}
                onDeltaClick={onDeltaClick}
              />
            )
          })}

          <SubtotalRow label="운전자금 소계" note="(원화 환산 합계)"
            prevKrw={prevOpKRW} inKrw={itemSums.opIn} outKrw={itemSums.opOut}
            currKrw={currOpKRW > 0 ? currOpKRW : prevOpKRW}
          />

          {/* ─── 운용자금 ─────────────────────────────────── */}
          {investGroups.length > 0 && (
            <>
              <SectionHeader label="운용자금" />

              {/* 예금성 */}
              {depositGroups.length > 0 && (
                <>
                  <SubSectionHeader label="① 예금성" />
                  {depositGroups.map((g, i) => (
                    <InvestRow key={`dep-${i}`} group={g}
                      inKrw={g.product === '정기예금' ? itemSums.investOut : 0}
                      outKrw={g.product === '정기예금' ? itemSums.investIn  : 0}
                    />
                  ))}
                  <SubtotalRow label="예금성 소계" indent note="(원화 환산)"
                    prevKrw={depositSubtotal} inKrw={0} outKrw={0} currKrw={depositSubtotal}
                  />
                </>
              )}

              {/* 비예금성 */}
              {nonDepositGroups.length > 0 && (
                <>
                  <SubSectionHeader label="② 비예금성" />
                  {nonDepositGroups.map((g, i) => {
                    const bondEval = g.isBondGroup ? itemSums.byBondLabel[g.label] : undefined
                    return (
                      <InvestRow key={`ndep-${i}`} group={g}
                        inKrw={bondEval?.inKrw ?? 0}
                        outKrw={bondEval?.outKrw ?? 0}
                        isAutoEval={g.isBondGroup && (bondEval?.inKrw ?? 0) + (bondEval?.outKrw ?? 0) > 0}
                      />
                    )
                  })}
                  {/* 비예금성 소계: 기초잔액은 국채 prevKrw + 비국채 totalKrw 합산 */}
                  <SubtotalRow label="비예금성 소계" indent note="(원화 환산)"
                    prevKrw={nonDepositGroups.reduce((s, g) =>
                      s + (g.isBondGroup ? (g.prevKrw ?? g.totalKrw) : g.totalKrw), 0)}
                    inKrw={itemSums.evalIn} outKrw={itemSums.evalOut}
                    currKrw={nonDepositSubtotal}
                  />
                </>
              )}

              <SubtotalRow label="운용자금 소계" note="(원화 환산 합계)"
                prevKrw={
                  depositSubtotal +
                  nonDepositGroups.reduce((s, g) =>
                    s + (g.isBondGroup ? (g.prevKrw ?? g.totalKrw) : g.totalKrw), 0)
                }
                inKrw={itemSums.investOut} outKrw={itemSums.investIn}
                currKrw={totalInvKRW}
              />
            </>
          )}

          {/* ─── 자금 총합계 (차입금·지분 제외) ─────────── */}
          <TotalRow
            label="자금 총합계"
            krw={grandTotal}
            prevKrw={prevOpKRW + depositSubtotal + nonDepositGroups.reduce((s, g) => s + (g.isBondGroup ? (g.prevKrw ?? g.totalKrw) : g.totalKrw), 0)}
          />

          {/* ─── 지분·장기투자 (총합계 미포함, 대시보드 불가용자산 대응) ── */}
          {equityGroups.length > 0 && (
            <>
              <SectionHeader label="지분·장기투자" sub="(총합계 미포함 — 평가금액 기준)" />
              {equityGroups.map(g => {
                const evalSums = itemSums.byEquityName[g.name]
                const evalInKrw  = evalSums?.inKrw  ?? 0
                const evalOutKrw = evalSums?.outKrw ?? 0
                return (
                  <tr key={g.name} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 text-xs">
                    <td className="px-4 py-2 pl-7 text-gray-600 dark:text-slate-300 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {g.name}
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">({g.market})</span>
                        {g.available === '불가용' && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400">불가용</span>
                        )}
                        {/* 자동 반영 표시 */}
                        {(evalInKrw > 0 || evalOutKrw > 0) && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-500 dark:text-purple-400">🔄 자동</span>
                        )}
                      </span>
                    </td>
                    {/* 전일잔액: 직전 평가이력 */}
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{fmt(g.prevValue)}</td>
                    {/* 입금액: 평가이익 */}
                    <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                      {evalInKrw > 0 ? fmt(evalInKrw) : '—'}
                    </td>
                    {/* 출금액: 평가손실 */}
                    <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                      {evalOutKrw > 0 ? fmt(evalOutKrw) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{fmt(g.totalValue)}</td>
                    <td className="px-4 py-2 text-right text-gray-300 dark:text-gray-700 text-[10px]">KRW</td>
                    {/* Δ: 당일평가 - 전일평가 */}
                    <DeltaCell diff={g.totalValue - g.prevValue} />
                  </tr>
                )
              })}
              <SubtotalRow
                label="지분·장기투자 소계"
                note="(평가금액 기준)"
                prevKrw={equityGroups.reduce((s, g) => s + g.prevValue, 0)}
                inKrw={itemSums.evalIn}
                outKrw={itemSums.evalOut}
                currKrw={equityGroups.reduce((s, g) => s + g.totalValue, 0)}
              />
            </>
          )}

          {/* ─── 차입금 (총합계 미포함, 별도 표시) ──────── */}
          {loanGroups.length > 0 && (
            <>
              <SectionHeader label="차입금" sub="(총합계 미포함)" />
              {loanGroups.map(g => (
                <tr key={g.label} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 text-xs">
                  <td className="px-4 py-2 pl-7 text-gray-600 dark:text-slate-300">{g.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{fmt(g.totalKrw)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                    {itemSums.loanIn > 0 ? fmt(itemSums.loanIn) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600 dark:text-red-400">
                    {itemSums.loanOut > 0 ? fmt(itemSums.loanOut) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{fmt(g.totalKrw)}</td>
                  <td className="px-4 py-2 text-right text-gray-300 dark:text-gray-700 text-[10px]">KRW</td>
                  <td className="px-3 py-2 text-right text-gray-300 dark:text-gray-600 text-[10px]">—</td>
                </tr>
              ))}
              <SubtotalRow label="차입금 소계" note="(원화 환산 합계)"
                prevKrw={totalLoanKRW} inKrw={itemSums.loanIn} outKrw={itemSums.loanOut}
                currKrw={totalLoanKRW}
              />
            </>
          )}

        </tbody>
      </table>

      {/* 대시보드 일치 확인 안내 */}
      <div className="no-print px-4 py-2 border-t border-gray-100 dark:border-slate-700 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span>ℹ</span>
        <span>자금 총합계(운전+운용) = 통합상황판 가용자금 합계와 일치해야 합니다.</span>
        {equityGroups.length > 0 && (
          <span className="ml-2">지분·장기투자 포함 시 통합상황판 총자산과 일치합니다.</span>
        )}
      </div>

      {/* 환율 기준 */}
      {fx.rates.length > 0 && activeFxCodes.length > 0 && (
        <div className="no-print px-4 py-2 border-t border-gray-100 dark:border-slate-700 flex flex-wrap gap-3 items-center">
          <span className="text-[10px] text-gray-400 dark:text-gray-600">적용 환율 :</span>
          {activeFxCodes.map(code => {
            const r = fx.rates.find(x => x.code === code)
            if (!r) return null
            const display = code === 'JPY'
              ? `100JPY = ${(r.rate * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`
              : `${code} = ${r.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`
            return <span key={code} className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">{display}</span>
          })}
        </div>
      )}
    </div>
  )
}

