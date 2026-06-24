/**
 * DailyReportPage — 자금일보
 *
 * 라우트: /daily-report/:company?/:date?
 * 개발 단계: S1 (골격) — S2~S6 순차 추가 예정
 *
 * 데이터 반영 정책 (C안):
 *   draft/submitted → daily.confirmed=false (임시 반영, 대시보드 표시)
 *   approved        → daily.confirmed=true  (공식 확정)
 */
import { useEffect, useState, useMemo, useRef, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { prevBizDay, snapToBizDay, nextBizDay, todayStr, isBusinessDay } from '../lib/bizDay'

import { useDailyReport, useApprovalConfig } from '../hooks/useDailyReport'
import { useDailyReportSummary, type ItemSums } from '../hooks/useDailyReportSummary'
import { useDailyReportItems } from '../hooks/useDailyReportItems'
import ReportSummaryTable from '../components/daily-report/ReportSummaryTable'
import ItemsSection, { type PrefillPayload } from '../components/daily-report/ItemsSection'
import { ACCOUNT_LABELS } from '../lib/accountLabels'
import CmsVerificationModal from '../components/daily-report/CmsVerificationModal'
import UserPicker from '../components/common/UserPicker'
import { useDailyReportAttachments } from '../hooks/useDailyReportAttachments'
import { useCompanies } from '../hooks/useCompanies'
import { usePageCompany } from '../hooks/usePageCompany'
import type { Company, DailyRecord } from '../types'


// ── 인쇄용 카테고리 레이블 ────────────────────────────────────
const CATEGORY_LABEL: Record<string, string> = {
  ar_collection:    '매출채권 회수',
  other_receivable: '미수금 회수',
  govt_fund:        '국책자금 회수',
  advance_in:       '선수금 입금',
  invest_return:    '투자금 회수',
  loan_drawdown:    '차입금 실행',
  interest_income:  '이자수익',
  invest_eval_in:   '투자자산평가',
  other_in:         '기타',
  ap_payment:       '미지급금 지급',
  trade_ap_payment: '외상매입금 지급',
  advance_out:      '선급금 지급',
  invest_execute:   '투자 집행',
  loan_repayment:   '차입금 상환',
  interest_expense: '이자비용',
  enote_payment:    '전자어음결제',
  invest_eval_out:  '투자자산평가',
  other_out:        '기타',
}

// ── 인쇄 전용 컬러 헤더 (네이비 바) ─────────────────────────
const PRINT_NAVY = '#1e3a5f'
function PrintColorHeader({
  company, reportDate, selectedDate, statusLabel, compact,
}: { company: string; reportDate: string; selectedDate: string; statusLabel: string; compact?: boolean }) {
  const statusColor =
    statusLabel.includes('승인') ? '#22c55e' :
    statusLabel.includes('반려') ? '#ef4444' :
    statusLabel.includes('결재') ? '#f59e0b' : '#6b7280'
  return (
    <div style={{
      background: PRINT_NAVY, color: '#fff',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: compact ? '3px 10px' : '5px 10px',
      marginBottom: compact ? 6 : 0,
    }}>
      <div>
        <div style={{ fontSize: compact ? '9pt' : '13pt', fontWeight: 700, letterSpacing: compact ? 2 : 4 }}>
          {compact ? '자금일보 — 입출금 상세' : '자 금 일 보'}
        </div>
        <div style={{ fontSize: '7pt', opacity: 0.75, marginTop: 1 }}>{company}</div>
      </div>
      <div style={{ textAlign: 'right', fontSize: '7.5pt', opacity: 0.85, lineHeight: 1.7 }}>
        보고대상일: {reportDate} &nbsp;|&nbsp; 작성일: {selectedDate}<br />
        <span style={{
          background: statusColor, color: '#fff', borderRadius: 2,
          padding: '1px 5px', fontSize: '7pt', opacity: 1,
        }}>
          {statusLabel.replace('● ', '')}
        </span>
      </div>
    </div>
  )
}


// 상태 배지
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:     { label: '● 작성 중',  cls: 'text-gray-500 bg-gray-100 dark:bg-slate-700' },
  submitted: { label: '● 결재 중',  cls: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30' },
  approved:  { label: '● 승인 완료', cls: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  rejected:  { label: '● 반려',     cls: 'text-red-600 bg-red-50 dark:bg-red-900/30' },
}

// ── 영업일 달력 피커 ──────────────────────────────────────────
function BusinessDatePicker({
  value, max, availableDates, onChange,
}: {
  value: string; max: string; availableDates: Set<string>; onChange: (d: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // 보여줄 연·월 (value 바뀌면 동기화)
  const [ym, setYm] = useState(() => value.slice(0, 7))
  useEffect(() => { setYm(value.slice(0, 7)) }, [value])

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const [yearStr, monthStr] = ym.split('-')
  const year = Number(yearStr), month = Number(monthStr)

  // 월 이동
  const toLocalDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const goPrevMonth = () => {
    const d = new Date(year, month - 2, 1)
    setYm(toLocalDate(d).slice(0, 7))
  }
  const goNextMonth = () => {
    const d = new Date(year, month, 1)
    setYm(toLocalDate(d).slice(0, 7))
  }

  // 달력 날짜 배열 (일~토 순, 빈 칸 포함)
  const firstDow = new Date(year, month - 1, 1).getDay()  // 0=일 … 6=토
  const daysInMonth = new Date(year, month, 0).getDate()
  const cells: Array<{ date: string; curr: boolean } | null> = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`
    cells.push({ date, curr: true })
  }

  const handleSelect = (date: string) => {
    onChange(date)
    setOpen(false)
  }

  const DOW_LABELS = ['일','월','화','수','목','금','토']

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-sm font-medium text-gray-700 dark:text-gray-200 bg-transparent border border-gray-200 dark:border-slate-600 rounded px-2 py-1 hover:border-blue-400 transition-colors flex items-center gap-1"
      >
        {value}
        <span className="text-gray-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-50 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 w-60">
          {/* 월 헤더 */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={goPrevMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 text-sm">‹</button>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">{year}년 {month}월</span>
            <button onClick={goNextMonth} className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 text-sm">›</button>
          </div>

          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1">
            {DOW_LABELS.map((l, i) => (
              <div key={l} className={`text-center text-[10px] font-medium py-0.5 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{l}</div>
            ))}
          </div>

          {/* 날짜 셀 */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((cell, i) => {
              if (!cell) return <div key={`e-${i}`} />
              const { date } = cell
              const dayNum      = new Date(date + 'T00:00:00').getDay()  // 0=일 … 6=토
              const isWeekend   = dayNum === 0 || dayNum === 6
              const isHoliday   = !isWeekend && !isBusinessDay(date)  // 공휴일 (주말 아님)
              const isNonBizDay = isWeekend || isHoliday
              const isFuture    = date > max
              const isSelected  = date === value
              const isToday     = date === max
              // 작성일 셀: 보고 대상일(직전영업일) 운전자금 데이터 존재 여부
              const hasData   = !isNonBizDay && availableDates.has(prevBizDay(date))
              const disabled  = isNonBizDay || isFuture

              return (
                <button
                  key={date}
                  disabled={disabled}
                  onClick={() => handleSelect(date)}
                  title={isNonBizDay ? (isWeekend ? '주말 (비영업일)' : '공휴일') : hasData ? '보고 대상일 데이터 있음' : undefined}
                  className={[
                    'relative flex flex-col items-center justify-center h-7 rounded text-[11px] transition-colors',
                    isSelected
                      ? 'bg-blue-600 text-white font-semibold'
                      : isToday
                        ? 'ring-1 ring-blue-400 text-blue-600 dark:text-blue-400'
                        : '',
                    disabled
                      ? isWeekend
                        ? 'text-red-300 dark:text-red-800 cursor-not-allowed'
                        : 'text-amber-300 dark:text-amber-800 cursor-not-allowed'
                      : 'hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-700 dark:text-gray-200 cursor-pointer',
                  ].join(' ')}
                >
                  {new Date(date + 'T00:00:00').getDate()}
                  {hasData && !isSelected && (
                    <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-400" />
                  )}
                </button>
              )
            })}
          </div>

          {/* 범례 */}
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700 flex items-center gap-3 text-[9px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />보고 대상일 데이터</span>
            <span className="text-red-400">토·일 = 비영업일</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DailyReportPage() {
  const { date: paramDate } = useParams<{ date?: string }>()
  const navigate = useNavigate()
  const { user, setCurrentCompany, canEdit, hasCompany } = useAuth()
  const { names: allCompanyNames } = useCompanies()
  const companyNames = allCompanyNames.filter(c => hasCompany(c))  // 권한 부여 법인만
  // 회사 컨텍스트 해석·동기화 (D2 SSOT). URL 에 :date 가 있어 basePath 자동 nav 는
  // 쓰지 않고, 법인 전환은 아래 handleCompanyChange 가 날짜까지 포함해 navigate 한다.
  const { company: resolvedCompany, paramCompany } = usePageCompany()

  // ── 날짜 모델 (docs/pages/DailyReportPage.md §0 참조) ──────────
  // 전제: daily[D] = 담당자가 D일 아침 입력 = 전일(D-1영업일) 마감잔액
  // selectedDate = 작성일 (담당자가 일보를 작성하는 날, 기본값 = 오늘) → 리포트/조회 키
  // reportDate   = 보고 대상일 = prevBizDay(selectedDate) → 라벨 표기 + 지분/국채 거래일
  //   · 마감잔액 = daily[selectedDate]            (오늘 입력 = 보고대상일 마감)
  //   · 기초잔액 = daily[prevBizDay(selectedDate)] (직전영업일 입력 = 보고대상일 기초)
  //   · 라벨은 기초·마감 모두 reportDate
  // 예) 작성일 6/10(수) → reportDate 6/9(화): 마감=daily[6/10], 기초=daily[6/9], 라벨=6/9
  const [selectedDate, setSelectedDate] = useState(
    paramDate ? snapToBizDay(paramDate) : snapToBizDay(todayStr())
  )
  const reportDate = useMemo(() => prevBizDay(selectedDate), [selectedDate])
  const maxWriteDate = snapToBizDay(todayStr())  // 작성일 상한 = 오늘(또는 직전영업일)

  // daily 입력된 영업일 목록 (캘린더 dot 표시용)
  const [availableDates, setAvailableDates] = useState<Set<string>>(new Set())
  useEffect(() => {
    supabase
      .from('daily')
      .select('date')
      .eq('company', resolvedCompany)
      .then(({ data }) => setAvailableDates(new Set((data ?? []).map(r => r.date as string))))
  }, [resolvedCompany])

  const dr      = useDailyReport()
  const ac      = useApprovalConfig(resolvedCompany)
  const summary = useDailyReportSummary()
  const itemHook = useDailyReportItems()

  // 법인/날짜 변경 시 일보 조회
  // 리포트·daily 조회는 작성일(selectedDate) 기준:
  //   · 마감잔액 = daily[selectedDate]            (오늘 입력 = 보고대상일 마감)
  //   · 기초잔액 = daily[prevBizDay(selectedDate)] (직전영업일 입력)  ← 훅 내부 처리
  useEffect(() => {
    void dr.fetchReport(resolvedCompany, selectedDate)
    void ac.fetch()
    void summary.fetch(resolvedCompany, selectedDate)
  }, [resolvedCompany, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // 일보 report_id 확정 시 아이템 로드
  useEffect(() => {
    if (dr.report?.id) {
      void itemHook.fetchItems(dr.report.id)
    } else {
      itemHook.setExternalItems([])
    }
  }, [dr.report?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL 동기화
  useEffect(() => {
    if (paramCompany !== resolvedCompany || paramDate !== selectedDate) {
      navigate(`/daily-report/${resolvedCompany}/${selectedDate}`, { replace: true })
    }
  }, [resolvedCompany, selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // 법인 탭 전환
  function handleCompanyChange(c: Company) {
    setCurrentCompany(c)
    navigate(`/daily-report/${c}/${selectedDate}`, { replace: true })
  }

  // ── 이슈1: Δ 클릭 → 입출금 항목 prefill ────────────────────
  const [prefillIn,  setPrefillIn]  = useState<PrefillPayload | null>(null)
  const [prefillOut, setPrefillOut] = useState<PrefillPayload | null>(null)

  function handleDeltaClick(payload: PrefillPayload) {
    if (payload.direction === 'in') setPrefillIn(payload)
    else setPrefillOut(payload)
  }

  // ── itemHook.items 기반 실시간 itemSums (summary.itemSums는 stale) ──
  const liveItemSums = useMemo((): ItemSums => {
    const krwAmt = (i: { amount: number; amount_krw: number | null; currency: string }) =>
      i.amount_krw ?? summary.toKRW(i.amount, i.currency)

    const byAccount:    Record<string, { inKrw: number; outKrw: number; inRaw: number; outRaw: number }> = {}
    const byEquityName: Record<string, { inKrw: number; outKrw: number }> = {}
    const byBondLabel:  Record<string, { inKrw: number; outKrw: number }> = {}

    for (const item of itemHook.items) {
      const acct = item.account_type
      if (acct) {
        if (!byAccount[acct]) byAccount[acct] = { inKrw: 0, outKrw: 0, inRaw: 0, outRaw: 0 }
        if (item.direction === 'in') { byAccount[acct].inKrw  += krwAmt(item); byAccount[acct].inRaw  += item.amount }
        else                         { byAccount[acct].outKrw += krwAmt(item); byAccount[acct].outRaw += item.amount }
      }
      const isEval = item.category === 'invest_eval_in' || item.category === 'invest_eval_out'
      if (isEval) {
        const raw = item.memo?.startsWith('@auto:') ? item.memo.slice(6) : (item.memo ?? '기타')
        if (raw.startsWith('bond:')) {
          const label = raw.slice(5)
          if (!byBondLabel[label]) byBondLabel[label] = { inKrw: 0, outKrw: 0 }
          if (item.direction === 'in') byBondLabel[label].inKrw  += krwAmt(item)
          else                         byBondLabel[label].outKrw += krwAmt(item)
        } else {
          if (!byEquityName[raw]) byEquityName[raw] = { inKrw: 0, outKrw: 0 }
          if (item.direction === 'in') byEquityName[raw].inKrw  += krwAmt(item)
          else                         byEquityName[raw].outKrw += krwAmt(item)
        }
      }
    }

    return {
      // invest_eval은 현금 이동 없으므로 운전자금 opIn/opOut에서 제외
      opIn:      itemHook.items.filter(i => i.direction === 'in'  && i.category !== 'invest_eval_in' ).reduce((s, i) => s + krwAmt(i), 0),
      opOut:     itemHook.items.filter(i => i.direction === 'out' && i.category !== 'invest_eval_out').reduce((s, i) => s + krwAmt(i), 0),
      investIn:  itemHook.items.filter(i => i.direction === 'out' && i.category === 'invest_execute').reduce((s, i) => s + krwAmt(i), 0),
      investOut: itemHook.items.filter(i => i.direction === 'in'  && i.category === 'invest_return' ).reduce((s, i) => s + krwAmt(i), 0),
      loanIn:    itemHook.items.filter(i => i.direction === 'in'  && i.category === 'loan_drawdown' ).reduce((s, i) => s + krwAmt(i), 0),
      loanOut:   itemHook.items.filter(i => i.direction === 'out' && i.category === 'loan_repayment').reduce((s, i) => s + krwAmt(i), 0),
      evalIn:    itemHook.items.filter(i => i.category === 'invest_eval_in' ).reduce((s, i) => s + krwAmt(i), 0),
      evalOut:   itemHook.items.filter(i => i.category === 'invest_eval_out').reduce((s, i) => s + krwAmt(i), 0),
      byAccount,
      byEquityName,
      byBondLabel,
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemHook.items, summary.toKRW])

  // 활성 계좌 목록 (daily 데이터에서 추출)
  const activeAccounts = useMemo(() => {
    const base = ['krw_demand', 'krw_govt', 'krw_mmda']
    const codes = ['usd', 'eur', 'jpy', 'gbp', 'cny']
    for (const code of codes) {
      const key = `fx_${code}` as keyof DailyRecord
      const p   = (summary.prevDaily?.[key] as number) ?? 0
      const c   = (summary.currDaily?.[key] as number) ?? 0
      if (p > 0 || c > 0) base.push(`fx_${code}`)
    }
    return base
  }, [summary.prevDaily, summary.currDaily])

  // ── 지분 평가손익 자동 기재 ──────────────────────────────────
  // 조건: 전일/당일 수량 동일 + 평가금액 변동 → invest_eval_in/out 자동 생성
  // memo = '@auto:{종목명}' → 이 prefix로 자동항목 추적
  // 재발 방지 설계:
  //   1) autoRunningRef — 비동기 IIFE 동시 실행 차단 (다중 렌더링 시 race 방지)
  //   2) seedKey에 resolvedCompany 포함 — 법인 전환 시 재실행 허용
  //   3) DB 직접 조회 — itemHook.items stale 상태 무관하게 정확한 중복 확인
  //   4) 동일 memo 중복 행 발견 시 최신 1건만 남기고 나머지 즉시 삭제
  const autoSeedRef    = useRef('')
  const autoRunningRef = useRef(false)

  // ⚠️ 자동기재 effect가 memoized 배열 참조 변화에 매 렌더 재실행되어 무한 루프
  // (Maximum update depth)를 일으키지 않도록, 배열은 ref로 최신값만 보관하고
  // effect deps는 안정적인 primitive(report id·법인·날짜·loading)로만 구성한다.
  const equityGroupsLatest = useRef(summary.equityGroups)
  // eslint-disable-next-line react-hooks/refs
  equityGroupsLatest.current = summary.equityGroups   // latest-value 패턴: 렌더마다 갱신, effect 재실행 없음
  const investGroupsLatest = useRef(summary.investGroups)
  // eslint-disable-next-line react-hooks/refs
  investGroupsLatest.current = summary.investGroups

  useEffect(() => {
    if (summary.loading) return
    if (!canEdit()) return  // 조회-쓰기 분리: viewer 는 자동기재(DB write) 미수행
    const groups = equityGroupsLatest.current
    if (groups.length === 0) return

    const candidates = groups.filter(g =>
      g.currShares === g.prevShares && Math.abs(g.totalValue - g.prevValue) >= 1
    )
    // 후보도 없고 기존 일보도 없으면 정리 대상 자체가 없음 → skip
    // (후보가 없어도 일보가 있으면 stale 자동항목 정리를 위해 진행)
    if (!candidates.length && !dr.report?.id) return
    if (autoRunningRef.current) return  // 이미 실행 중 → skip

    autoRunningRef.current = true

    void (async () => {
      try {
        // report가 없으면 자동 생성 (후보가 있을 때만 — 정리만 필요하면 일보 없음=대상 없음)
        let reportId = dr.report?.id
        if (!reportId) {
          if (!candidates.length) return
          const created = await dr.saveReport(resolvedCompany, selectedDate, {})
          reportId = created?.id ?? undefined
          if (!reportId) return
          await itemHook.fetchItems(reportId)
        }

        const seedKey = `${reportId}:${resolvedCompany}:${selectedDate}`
        if (autoSeedRef.current === seedKey) return  // 이미 처리됨
        autoSeedRef.current = seedKey

        // DB에서 @auto: 항목 전체 조회 (created_at 포함해 중복 정리용)
        const { data: dbItems } = await supabase
          .from('daily_report_items')
          .select('id, memo, amount, direction, created_at')
          .eq('report_id', reportId)
          .like('memo', '@auto:%')
          .order('created_at', { ascending: false })

        // 동일 memo 중복 행 정리: 최신 1건만 유지, 나머지 삭제
        const byMemo = new Map<string, Array<{ id: string; memo: string; amount: number; direction: string }>>()
        for (const item of dbItems ?? []) {
          const key = item.memo as string
          if (!byMemo.has(key)) byMemo.set(key, [])
          byMemo.get(key)!.push(item as { id: string; memo: string; amount: number; direction: string })
        }
        const dupIds: string[] = []
        const cleanMap = new Map<string, { id: string; memo: string; amount: number; direction: string }>()
        for (const [memo, rows] of byMemo) {
          // rows는 created_at 내림차순 → index 0이 최신
          cleanMap.set(memo, rows[0])
          for (const dup of rows.slice(1)) dupIds.push(dup.id)
        }
        if (dupIds.length > 0) {
          // removeItem(REST) 가 DB 삭제 + 로컬 state 제거를 함께 처리 (중복 supabase 삭제 제거)
          for (const id of dupIds) await itemHook.removeItem(id)
        }

        // 🆕 현재 유효 후보가 아닌 지분 자동항목 제거 — 평가변동이 0으로 돌아갔거나
        //    수량이 변동된 종목의 과거 @auto 항목이 유령으로 남는 것을 차단.
        //    (국채 @auto:bond:%는 별도 effect가 관리하므로 건드리지 않음)
        const validKeys = new Set(candidates.map(g => `@auto:${g.name}`))
        for (const [memo, row] of Array.from(cleanMap)) {
          if (memo.startsWith('@auto:bond:')) continue
          if (!validKeys.has(memo)) {
            await itemHook.removeItem(row.id)
            cleanMap.delete(memo)
          }
        }

        // insert / update
        for (const g of candidates) {
          const diff    = g.totalValue - g.prevValue
          const autoKey = `@auto:${g.name}`
          const existing = cleanMap.get(autoKey)

          const correctDir = diff > 0 ? 'in' : 'out'
          const correctCat = diff > 0 ? 'invest_eval_in' : 'invest_eval_out'

          if (existing) {
            // direction / category 도 함께 검증 — 이전 오류로 잘못 저장된 경우 수정
            const needsUpdate =
              Math.abs(existing.amount - Math.abs(diff)) >= 1 ||
              existing.direction !== correctDir
            if (needsUpdate) {
              await itemHook.updateItem(existing.id, {
                direction:  correctDir,
                category:   correctCat,
                amount:     Math.abs(diff),
                amount_krw: Math.abs(diff),
              })
            }
          } else {
            await itemHook.addItem(reportId, {
              direction:  correctDir,
              category:   correctCat,
              amount:     Math.abs(diff),
              currency:   'KRW',
              amount_krw: Math.abs(diff),
              memo:       autoKey,
            })
          }
        }
      } finally {
        autoRunningRef.current = false
      }
    })()
  }, [dr.report?.id, resolvedCompany, selectedDate, summary.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 국채 평가손익 자동 기재 ──────────────────────────────────
  // 조건: 기초(prev) / 마감(curr) bondQty 동일 + 평가금액 변동
  // memo = '@auto:bond:{채권명}'
  const autoSeedBondRef    = useRef('')
  const autoRunningBondRef = useRef(false)

  useEffect(() => {
    if (summary.loading) return
    if (!canEdit()) return  // 조회-쓰기 분리: viewer 는 자동기재(DB write) 미수행

    const bondCandidates = investGroupsLatest.current.filter(g =>
      g.isBondGroup === true &&
      g.prevKrw !== undefined &&
      g.bondQtyMatch === true &&
      Math.abs(g.totalKrw - (g.prevKrw ?? g.totalKrw)) >= 1
    )
    // 후보도 없고 기존 일보도 없으면 정리 대상 자체가 없음 → skip
    if (!bondCandidates.length && !dr.report?.id) return
    if (autoRunningBondRef.current) return

    autoRunningBondRef.current = true

    void (async () => {
      try {
        let reportId = dr.report?.id
        if (!reportId) {
          if (!bondCandidates.length) return
          const created = await dr.saveReport(resolvedCompany, selectedDate, {})
          reportId = created?.id ?? undefined
          if (!reportId) return
          await itemHook.fetchItems(reportId)
        }

        const seedKey = `bond:${reportId}:${resolvedCompany}:${selectedDate}`
        if (autoSeedBondRef.current === seedKey) return
        autoSeedBondRef.current = seedKey

        const { data: dbItems } = await supabase
          .from('daily_report_items')
          .select('id, memo, amount, direction, created_at')
          .eq('report_id', reportId)
          .like('memo', '@auto:bond:%')
          .order('created_at', { ascending: false })

        const existing = new Map<string, { id: string; amount: number }>()
        for (const row of dbItems ?? []) {
          if (!existing.has(row.memo as string))
            existing.set(row.memo as string, { id: row.id as string, amount: row.amount as number })
        }

        // 🆕 현재 유효 후보가 아닌 국채 자동항목 제거 (평가변동 0 복귀·수량변동 등)
        const validBondKeys = new Set(bondCandidates.map(g => `@auto:bond:${g.label}`))
        for (const [memo, ex] of Array.from(existing)) {
          if (!validBondKeys.has(memo)) {
            await itemHook.removeItem(ex.id)
            existing.delete(memo)
          }
        }

        for (const g of bondCandidates) {
          const diff    = g.totalKrw - (g.prevKrw ?? g.totalKrw)
          const autoKey = `@auto:bond:${g.label}`
          const ex      = existing.get(autoKey)

          if (ex) {
            if (Math.abs(ex.amount - Math.abs(diff)) >= 1)
              await itemHook.updateItem(ex.id, { amount: Math.abs(diff), amount_krw: Math.abs(diff) })
          } else {
            await itemHook.addItem(reportId, {
              direction:  diff > 0 ? 'in' : 'out',
              category:   diff > 0 ? 'invest_eval_in' : 'invest_eval_out',
              amount:     Math.abs(diff),
              currency:   'KRW',
              amount_krw: Math.abs(diff),
              memo:       autoKey,
            })
          }
        }
      } finally {
        autoRunningBondRef.current = false
      }
    })()
  }, [dr.report?.id, resolvedCompany, selectedDate, summary.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const status = dr.report?.status ?? 'draft'
  const badge  = STATUS_LABEL[status] ?? STATUS_LABEL.draft
  const isReadOnly = status === 'approved'
  const canSubmit  = status === 'draft' || status === 'rejected'
  const myApproveStep = ac.config.find(c => c.approver_code === user?.code)?.step
  // 다단계 순차 결재: 정렬된 결재선 단계 + 이미 승인된 단계 → 다음 기대 단계
  const sortedSteps   = [...ac.config].map(c => c.step).sort((a, b) => a - b)
  const approvedSteps = new Set(dr.approvals.filter(a => a.action === 'approve').map(a => a.step))
  const nextStep      = sortedSteps.find(s => !approvedSteps.has(s))  // undefined = 모든 단계 완료
  const lastStep      = sortedSteps.length ? sortedSteps[sortedSteps.length - 1] : undefined
  const canApprove = status === 'submitted' && (
    // master: 다음 기대 단계를 대행 승인 가능 (오버라이드)
    (user?.role === 'master') ||
    // 일반: 본인 단계가 '다음 기대 단계'일 때만 (이전 단계 미승인 시 차단)
    (myApproveStep !== undefined && myApproveStep === nextStep && (user?.can_approve !== false))
  )

  // ── 모달 상태 ────────────────────────────────────────────────
  const [approveModal, setApproveModal] = useState<{ comment: string } | null>(null)
  const [rejectModal,  setRejectModal]  = useState<{ comment: string } | null>(null)
  const [configModal,  setConfigModal]  = useState(false)
  const [cfgForm, setCfgForm] = useState({ step: '', role_label: '', approver_code: '' })
  const [actionBusy, setActionBusy] = useState(false)

  // ── CMS 증빙 첨부 상태 ───────────────────────────────────────
  const attachHook = useDailyReportAttachments()
  const [attachments,    setAttachments]    = useState<Awaited<ReturnType<typeof attachHook.listByReport>>>([])
  const [cmsVerifyPdfs,  setCmsVerifyPdfs]  = useState<{ fileName: string; url: string }[] | null>(null)
  const [cmsInitialIdx,  setCmsInitialIdx]  = useState(0)
  const [cmsVerifyKey,   setCmsVerifyKey]   = useState(0)  // 재팝업 강제 재마운트용
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 리포트 ID가 생기면 첨부파일 목록 로드
  useEffect(() => {
    if (!dr.report?.id) { setAttachments([]); return }
    void attachHook.listByReport(dr.report.id).then(setAttachments)
  }, [dr.report?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCmsUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !resolvedCompany) return
    let reportId: string | null | undefined = dr.report?.id
    if (!reportId) {
      reportId = await ensureReport()
      if (!reportId) return
    }
    const att = await attachHook.upload(file, reportId as string, resolvedCompany, reportDate, user?.code ?? 'unknown')
    if (att) setAttachments(prev => [att, ...prev])
    e.target.value = ''
  }

  async function handleCmsVerifyOpen(storagePath: string) {
    // 업로드된 모든 증빙 PDF의 signed URL을 한 번에 확보 → 모달에서 탭 전환하며 대사
    const sources = await Promise.all(
      attachments.map(async a => ({ fileName: a.file_name, url: await attachHook.getSignedUrl(a.storage_path) })),
    )
    const valid = sources.filter((s): s is { fileName: string; url: string } => !!s.url)
    if (valid.length === 0) return
    const idx = Math.max(0, attachments.findIndex(a => a.storage_path === storagePath))
    setCmsVerifyPdfs(valid)
    setCmsInitialIdx(idx)
    setCmsVerifyKey(k => k + 1)  // 재팝업 시에도 강제 재마운트
  }

  async function handleCmsDelete(att: (typeof attachments)[0]) {
    if (!confirm(`"${att.file_name}" 파일을 삭제하시겠습니까?`)) return
    await attachHook.remove(att)
    setAttachments(prev => prev.filter(a => a.id !== att.id))
  }

  // ── 검증 로직 (useMemo — 상신 버튼 조건 공유) ────────────────
  // 환율 기준 통일: 항목 amount_krw(저장 시점 환율) vs daily.fx_krw(InputPage 저장 시점 환율)의
  // 기준 불일치로 FX 환율 변동분만큼 차이 발생 → 현재 시세로 모두 재계산하여 통일.
  const validation = useMemo(() => {
    // FX 항목: 현재 시세로 재계산 (저장된 amount_krw 대신 현재 환율 적용)
    const krwAmt = (i: { amount: number; currency: string; amount_krw: number | null }) => {
      if (i.currency && i.currency !== 'KRW') return summary.toKRW(i.amount, i.currency)
      return i.amount_krw ?? i.amount
    }
    const inTotal  = itemHook.items.filter(i => i.direction === 'in'  && i.category !== 'invest_eval_in' ).reduce((s, i) => s + krwAmt(i), 0)
    const outTotal = itemHook.items.filter(i => i.direction === 'out' && i.category !== 'invest_eval_out').reduce((s, i) => s + krwAmt(i), 0)
    // 잔액 증감: daily.fx_krw(저장값) 대신 raw FX 필드 × 현재 시세로 재계산
    const calcAtCurrentRate = (d: DailyRecord | null): number => {
      if (!d) return 0
      const FX_FIELDS: [string, string][] = [['fx_usd','USD'],['fx_eur','EUR'],['fx_jpy','JPY'],['fx_gbp','GBP'],['fx_cny','CNY']]
      const fxKrw = FX_FIELDS.reduce((s, [f, c]) => s + summary.toKRW((d as unknown as Record<string,number>)[f] ?? 0, c), 0)
      return (d.krw_demand ?? 0) + (d.krw_govt ?? 0) + (d.krw_mmda ?? 0) + fxKrw
    }
    const prevKRW = calcAtCurrentRate(summary.prevDaily)
    const currKRW = calcAtCurrentRate(summary.currDaily)
    const delta   = currKRW - prevKRW
    const diff    = inTotal - outTotal - delta
    const hasData = inTotal > 0 || outTotal > 0
    const isValid = hasData && Math.abs(diff) < 1
    return { inTotal, outTotal, prevKRW, currKRW, delta, diff, hasData, isValid }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemHook.items, summary.prevDaily, summary.currDaily, summary.toKRW])

  // ── 액션 핸들러 ──────────────────────────────────────────────
  async function handleSubmit() {
    if (!validation.isValid || !user) return
    setActionBusy(true)
    // report 없으면 먼저 생성
    if (!dr.report?.id) await dr.saveReport(resolvedCompany, selectedDate, {})
    await dr.submitReport(user.code, user.label ?? user.code)
    setActionBusy(false)
  }

  async function handleApprove() {
    if (!user) return
    setActionBusy(true)
    // 승인 단계: master는 다음 기대 단계 대행, 일반은 본인 단계
    const step = user.role === 'master' ? (nextStep ?? lastStep ?? 1) : (myApproveStep ?? 1)
    // 최종 단계(또는 결재선 미설정)일 때만 승인 확정
    const isFinal = lastStep === undefined ? true : step === lastStep
    await dr.approveReport(step, user.code, user.label ?? user.code, approveModal?.comment || undefined, isFinal)
    setApproveModal(null)
    setActionBusy(false)
  }

  async function handleReject() {
    if (!user || !rejectModal?.comment.trim()) return
    setActionBusy(true)
    const step = myApproveStep ?? 1
    await dr.rejectReport(step, user.code, user.label ?? user.code, rejectModal.comment)
    setRejectModal(null)
    setActionBusy(false)
  }

  async function handleCfgSave() {
    const step = parseInt(cfgForm.step)
    if (!cfgForm.step || !cfgForm.role_label.trim() || !cfgForm.approver_code.trim() || isNaN(step)) return
    setActionBusy(true)
    await ac.upsert(step, cfgForm.role_label.trim(), cfgForm.approver_code.trim())
    setCfgForm({ step: '', role_label: '', approver_code: '' })
    setActionBusy(false)
  }

  // 2번 이슈: 항목 추가 시 report 없으면 자동 생성
  async function ensureReport(): Promise<string | null> {
    if (dr.report?.id) return dr.report.id
    await dr.saveReport(resolvedCompany, selectedDate, {})
    // saveReport 후 dr.report가 갱신될 때까지 짧은 대기
    return new Promise(resolve => {
      setTimeout(() => resolve(dr.report?.id ?? null), 200)
    })
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-900">

      {/* ── 헤더 바 ─────────────────────────────────────────── */}
      <div className="no-print bg-white dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700 px-6 py-3 flex items-center gap-4 flex-wrap shrink-0">

        {/* 아이콘 + 제목 */}
        <div className="flex items-center gap-2">
          <span className="text-lg">📄</span>
          <h1 className="text-base font-bold text-gray-800 dark:text-gray-100 tracking-tight">자금일보</h1>
        </div>

        {/* 법인 선택 (master/ceo는 탭으로 전환) */}
        {user?.role !== 'company' && (
          <div className="flex gap-1">
            {companyNames.map(c => (
              <button
                key={c}
                onClick={() => handleCompanyChange(c)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                  resolvedCompany === c
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        {user?.role === 'company' && (
          <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{resolvedCompany}</span>
        )}

        {/* 날짜 네비게이션 — 영업일 전용 */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setSelectedDate(prevBizDay(selectedDate))}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 transition-colors"
            title="전 영업일"
          >
            ‹
          </button>
          <BusinessDatePicker
            value={selectedDate}
            max={maxWriteDate}
            availableDates={availableDates}
            onChange={d => setSelectedDate(snapToBizDay(d))}
          />
          <button
            onClick={() => setSelectedDate(nextBizDay(selectedDate, maxWriteDate))}
            disabled={selectedDate >= maxWriteDate}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 transition-colors disabled:opacity-30"
            title="다음 영업일"
          >
            ›
          </button>
        </div>

        {/* 상태 배지 */}
        <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${badge.cls}`}>
          {badge.label}
        </span>

        {/* 액션 버튼 */}
        <div className="flex gap-2">
          {!isReadOnly && (
            <button
              onClick={() => void dr.saveReport(resolvedCompany, selectedDate, {})}
              disabled={dr.loading}
              className="text-xs px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              💾 임시저장
            </button>
          )}
          {canSubmit && (
            <button
              disabled={!validation.isValid || actionBusy}
              onClick={() => void handleSubmit()}
              title={validation.isValid ? '검증 완료 — 결재 상신' : '입출금 합계 검증 후 활성화'}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                validation.isValid
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-blue-600 text-white opacity-40 cursor-not-allowed'
              }`}
            >
              {actionBusy ? '처리 중…' : '상신 →'}
            </button>
          )}
          {canApprove && (
            <button
              onClick={() => setApproveModal({ comment: '' })}
              disabled={actionBusy}
              className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              ✓ 승인
            </button>
          )}
          {canApprove && (
            <button
              onClick={() => setRejectModal({ comment: '' })}
              disabled={actionBusy}
              className="text-xs px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              반려
            </button>
          )}
          <button
            onClick={() => {
              // Chrome 인쇄 미리보기 활성화:
              // @media print 적용 전에 body.is-printing 클래스로 overflow/height 선제 해제
              document.body.classList.add('is-printing')
              const restore = () => {
                document.body.classList.remove('is-printing')
                window.removeEventListener('afterprint', restore)
              }
              window.addEventListener('afterprint', restore)
              // 레이아웃 재계산 후 print 호출 (rAF × 2 = 2 paint cycle)
              requestAnimationFrame(() => requestAnimationFrame(() => window.print()))
            }}
            className="text-xs px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            title="A4 가로 인쇄 (1장: 자금현황, 2장: 입출금+결재란)"
          >
            🖨️
          </button>
        </div>
      </div>

      {/* ── 미승인 데이터 경고 배너 (C안) ─────────────────────── */}
      {dr.report && status !== 'approved' && (
        <div className="no-print mx-6 mt-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-lg flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 shrink-0">
          <span>⚠</span>
          <span>
            {status === 'draft' && '작성 중인 일보입니다. 승인 완료 전까지 대시보드에 임시 반영됩니다.'}
            {status === 'submitted' && '결재 진행 중입니다. 승인 완료 시 공식 확정됩니다.'}
            {status === 'rejected' && '반려된 일보입니다. 내용 수정 후 재상신해 주세요.'}
          </span>
        </div>
      )}

      {/* ── 메인 콘텐츠 ─────────────────────────────────────── */}
      <div className="no-print flex-1 overflow-y-auto px-6 py-4 space-y-4">

        {dr.loading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-sm text-gray-400 animate-pulse">일보 데이터 불러오는 중…</div>
          </div>
        )}

        {dr.error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-600 dark:text-red-400">
            ⚠ 오류: {dr.error}
          </div>
        )}

        {!dr.loading && (
          <>
            {/* S2: 자금현황 요약 테이블 */}
            <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">자금 현황</h2>
                {summary.loading && (
                  <span className="text-[10px] text-gray-400 animate-pulse">데이터 불러오는 중…</span>
                )}
              </div>
              <ReportSummaryTable
                prevDaily={summary.prevDaily}
                currDaily={summary.currDaily}
                investGroups={summary.investGroups}
                depositSubtotal={summary.depositSubtotal}
                nonDepositSubtotal={summary.nonDepositSubtotal}
                loanGroups={summary.loanGroups}
                equityGroups={summary.equityGroups}
                itemSums={liveItemSums}
                loading={summary.loading}
                company={resolvedCompany}
                baseDate={reportDate}
                closeDate={reportDate}
                toKRW={summary.toKRW}
                fx={summary.fx}
                onDeltaClick={handleDeltaClick}
              />
            </section>

            {/* S3: 입금/출금 내역 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(['in', 'out'] as const).map(dir => (
                <ItemsSection
                  key={dir}
                  direction={dir}
                  company={resolvedCompany}
                  reportDate={reportDate}
                  reportId={dr.report?.id ?? null}
                  items={itemHook.items}
                  threads={itemHook.threads}
                  isReadOnly={isReadOnly}
                  authorCode={user?.code ?? ''}
                  authorLabel={user?.label ?? user?.code ?? ''}
                  activeAccounts={activeAccounts}
                  prefill={dir === 'in' ? prefillIn : prefillOut}
                  onPrefillConsumed={() => dir === 'in' ? setPrefillIn(null) : setPrefillOut(null)}
                  toKRW={summary.toKRW}
                  onEnsureReport={ensureReport}
                  onAdd={async (input) => {
                    const rid = dr.report?.id ?? await ensureReport()
                    if (!rid) return null
                    return itemHook.addItem(rid, input)
                  }}
                  onUpdate={itemHook.updateItem}
                  onRemove={itemHook.removeItem}
                  onFetchThreads={itemHook.fetchThreads}
                  onAddThread={itemHook.addThread}
                />
              ))}
            </div>

            {/* S7: CMS 증빙 첨부 */}
            <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📎 CMS 잔고내역 증빙</h2>
                {!isReadOnly && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachHook.uploading}
                    className="text-xs px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/40 border border-blue-200 dark:border-blue-700 disabled:opacity-50"
                  >
                    {attachHook.uploading ? '업로드 중…' : '+ PDF 첨부'}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={e => void handleCmsUpload(e)}
                />
              </div>
              <div className="px-5 py-3">
                {attachHook.uploadError && (
                  <p className="text-xs text-red-500 mb-2">{attachHook.uploadError}</p>
                )}
                {attachments.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
                    첨부된 증빙이 없습니다. CMS 잔고내역 PDF를 첨부하면 결재권자가 대사 검증할 수 있습니다.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {attachments.map(att => (
                      <div key={att.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-700">
                        <span className="text-lg">📄</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">{att.file_name}</div>
                          <div className="text-[10px] text-gray-400 dark:text-gray-500">
                            {new Date(att.uploaded_at).toLocaleString('ko-KR')}
                            {att.file_size && ` · ${(att.file_size / 1024).toFixed(0)}KB`}
                            {att.keep_forever ? ' · 영구보존' : ` · ${new Date(att.expires_at).toLocaleDateString('ko-KR')} 만료`}
                          </div>
                        </div>
                        <button
                          onClick={() => void handleCmsVerifyOpen(att.storage_path)}
                          className="text-xs px-2 py-1 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 shrink-0"
                        >
                          🔍 대사
                        </button>
                        {!isReadOnly && (
                          <button
                            onClick={() => void handleCmsDelete(att)}
                            className="text-xs text-red-400 hover:text-red-600 shrink-0 px-1"
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* S5: 검증 바 + 결재선 */}
            <section className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">검증 및 결재</h2>
              </div>
              <div className="px-5 py-4 space-y-4">

                {/* 검증 수식 */}
                {(() => {
                  const { inTotal, outTotal, currKRW, delta, diff, hasData, isValid } = validation
                  const fmt = (n: number) => (n / 1e8).toFixed(2) + '억'
                  return (
                    <div className={`flex items-center gap-2 flex-wrap text-xs rounded-lg px-4 py-3 ${
                      isValid    ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : hasData  ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400'
                                 : 'bg-gray-50 dark:bg-slate-700/50 text-gray-500 dark:text-slate-300'
                    }`}>
                      <span className="text-green-600 dark:text-green-400 font-medium">입금</span>
                      <span className="tabular-nums font-semibold">{hasData ? fmt(inTotal) : '—'}</span>
                      <span className="opacity-50">−</span>
                      <span className="text-red-500 dark:text-red-400 font-medium">출금</span>
                      <span className="tabular-nums font-semibold">{hasData ? fmt(outTotal) : '—'}</span>
                      <span className="opacity-50">−</span>
                      <span className="font-medium">잔액증감</span>
                      <span className="tabular-nums font-semibold">{currKRW > 0 ? fmt(delta) : '—'}</span>
                      <span className="opacity-50">=</span>
                      <span className={`font-bold tabular-nums ${isValid ? 'text-green-600 dark:text-green-400' : hasData ? 'text-red-500' : 'text-gray-300 dark:text-gray-600'}`}>
                        {isValid ? '✅ 0원 (검증 통과)' : hasData ? fmt(diff) + ' ⚠ 차이 발생' : '미계산'}
                      </span>
                      {!hasData && <span className="ml-auto text-[10px] opacity-60">입출금 내역 입력 후 자동 계산</span>}
                      {isValid && canSubmit && (
                        <button
                          onClick={() => void handleSubmit()}
                          disabled={actionBusy}
                          className="ml-auto text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50"
                        >
                          {actionBusy ? '처리 중…' : '상신 →'}
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* 결재선 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wider">결재선</p>
                    {user?.role === 'master' && (
                      <button
                        onClick={() => setConfigModal(true)}
                        className="text-[11px] text-blue-500 hover:text-blue-700 dark:text-blue-400"
                      >
                        ⚙ 결재선 설정
                      </button>
                    )}
                  </div>
                  {/* ── 결재라인 시각화 (Case A/B/C) ── */}
                  {ac.config.length === 0 ? (
                    /* Case B: 결재선 미설정 */
                    <div className="mt-2">
                      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-xs text-amber-800 dark:text-amber-300 mb-2">
                        <span className="mt-0.5">⚠</span>
                        <div>
                          <div className="font-medium">결재선이 설정되지 않았습니다</div>
                          <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                            상신 전에 결재선을 먼저 설정해 주세요.
                            {user?.role === 'master' && <span className="ml-1 font-medium">→ 우측 상단 "⚙ 결재선 설정" 버튼을 눌러 추가하세요.</span>}
                          </div>
                        </div>
                      </div>
                      {/* 빈 슬롯 미리보기 */}
                      <div className="flex items-center gap-1 opacity-50 px-1">
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-9 h-9 rounded-full border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 flex items-center justify-center text-base text-gray-400">✏</div>
                          <span className="text-[10px] text-gray-400">작성</span>
                        </div>
                        <span className="text-gray-300 dark:text-gray-600 pb-3 mx-1">→</span>
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-9 h-9 rounded-full border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center text-base text-gray-300 dark:text-slate-500">+</div>
                          <span className="text-[10px] text-gray-400">step 1</span>
                        </div>
                        <span className="text-gray-300 dark:text-gray-600 pb-3 mx-1">→</span>
                        <div className="flex flex-col items-center gap-1">
                          <div className="w-9 h-9 rounded-full border-2 border-dashed border-gray-300 dark:border-slate-600 flex items-center justify-center text-base text-gray-300 dark:text-slate-500">+</div>
                          <span className="text-[10px] text-gray-400">step 2</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Case A/C: 결재선 있음 */
                    <div className="mt-2">
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* 작성 노드 */}
                        {(() => {
                          const submitLog = dr.approvals.find(a => a.action === 'submit')
                          const authorLabel = submitLog?.actor_label ?? (status !== 'draft' ? '—' : user?.label ?? '—')
                          return (
                            <div className="flex flex-col items-center gap-1">
                              <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-base ${
                                submitLog
                                  ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-300 dark:border-blue-600 text-blue-600 dark:text-blue-300'
                                  : 'bg-gray-50 dark:bg-slate-700 border-gray-300 dark:border-slate-600 text-gray-400'
                              }`}>✏</div>
                              <span className="text-[10px] text-gray-500 dark:text-slate-400 max-w-[56px] text-center truncate">{authorLabel}</span>
                              <span className="text-[9px] text-gray-400 dark:text-slate-500">
                                {submitLog
                                  ? new Date(submitLog.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                                  : '작성 중'}
                              </span>
                            </div>
                          )
                        })()}

                        {/* 결재 단계 노드들 */}
                        {ac.config.map((cfg) => {
                          const approvedLog = dr.approvals.find(a => a.step === cfg.step && a.action === 'approve')
                          const rejectedLog = dr.approvals.find(a => a.step === cfg.step && a.action === 'reject')
                          return (
                            <Fragment key={cfg.step}>
                              <span className="text-gray-300 dark:text-gray-600 pb-4 mx-0.5">→</span>
                              <div className="flex flex-col items-center gap-1">
                                <div className={`w-9 h-9 rounded-full border flex items-center justify-center text-base font-medium ${
                                  approvedLog
                                    ? 'bg-green-50 dark:bg-green-900/30 border-green-400 dark:border-green-600 text-green-600 dark:text-green-300'
                                    : rejectedLog
                                    ? 'bg-red-50 dark:bg-red-900/30 border-red-400 dark:border-red-600 text-red-500 dark:text-red-300'
                                    : 'bg-gray-50 dark:bg-slate-700 border-dashed border-gray-300 dark:border-slate-500 text-gray-400'
                                }`}>
                                  {approvedLog ? '✓' : rejectedLog ? '✗' : '?'}
                                </div>
                                <span className="text-[10px] text-gray-500 dark:text-slate-400 max-w-[56px] text-center truncate">{cfg.role_label}</span>
                                <span className="text-[9px] text-gray-400 dark:text-slate-500">
                                  {approvedLog
                                    ? new Date(approvedLog.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                                    : rejectedLog
                                    ? new Date(rejectedLog.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
                                    : cfg.approver_code}
                                </span>
                              </div>
                            </Fragment>
                          )
                        })}
                      </div>

                      {/* 반려 사유 */}
                      {dr.approvals.some(a => a.action === 'reject' && a.comment) && (
                        <div className="mt-2 text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-3 py-1.5">
                          ✗ 반려 사유: {dr.approvals.find(a => a.action === 'reject')?.comment}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
           인쇄 전용 레이아웃 (S6 개편)
           Page 1: 컬러 헤더 + 결재란(ac.config 동적) + 자금현황
           Page 2: 컬러 헤더 + 입출금 2열 + 검증 바(하단 고정)
           — inline style 전용, CSS override 불필요
           Page 1: 자금현황 요약 테이블
           Page 2: 입출금 내역 + 결재란
           ══════════════════════════════════════════════════════ */}
      {!dr.loading && (
        <div className="print-only">

          {/* ════ PAGE 1: 컬러 헤더 + 결재란 + 자금현황 ════ */}
          <PrintColorHeader
            company={resolvedCompany}
            reportDate={reportDate}
            selectedDate={selectedDate}
            statusLabel={badge.label}
          />

          {/* 결재란 — 헤더 바로 아래 */}
          {(() => {
            const submitLog = dr.approvals.find(a => a.action === 'submit')
            const apvCellStyle: React.CSSProperties = {
              flex: 1, borderRight: `0.5px solid #ccc`, textAlign: 'center',
            }
            const apvLabelStyle: React.CSSProperties = {
              background: PRINT_NAVY, color: '#fff',
              fontSize: '7.5pt', fontWeight: 600, padding: '2px 0',
            }
            const apvBodyStyle: React.CSSProperties = {
              minHeight: 30, display: 'flex', alignItems: 'flex-end',
              justifyContent: 'center', paddingBottom: 3, fontSize: '7.5pt', color: '#333',
            }
            return (
              <div style={{
                display: 'flex', border: `1px solid #ccc`,
                marginTop: 6, marginBottom: 8, pageBreakInside: 'avoid',
              }}>
                {/* 좌: 메타 정보 */}
                <div style={{
                  flex: 2.5, padding: '4px 8px', borderRight: '1px solid #ccc',
                  fontSize: '8pt', color: '#444', display: 'flex',
                  flexDirection: 'column', justifyContent: 'center', gap: 3,
                }}>
                  <div>
                    <span style={{ color: '#888', display: 'inline-block', minWidth: 44 }}>작성자</span>
                    {submitLog?.actor_label ?? '—'}
                  </div>
                  <div>
                    <span style={{ color: '#888', display: 'inline-block', minWidth: 44 }}>상신일시</span>
                    {submitLog
                      ? new Date(submitLog.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : '미상신'}
                  </div>
                  <div>
                    <span style={{ color: '#888', display: 'inline-block', minWidth: 44 }}>검증</span>
                    <span style={{ color: validation.isValid ? '#166534' : '#991b1b', fontWeight: 600 }}>
                      {validation.isValid ? '✓ 통과' : validation.hasData ? '⚠ 불일치' : '미입력'}
                    </span>
                  </div>
                </div>
                {/* 우: 결재 칸 (ac.config 동적) */}
                <div style={{ flex: 1, display: 'flex' }}>
                  {/* 작성 칸 */}
                  <div style={{ ...apvCellStyle }}>
                    <div style={apvLabelStyle}>작 성</div>
                    <div style={apvBodyStyle}>{submitLog?.actor_label ?? '—'}</div>
                  </div>
                  {/* ac.config 기반 동적 결재 칸 */}
                  {ac.config.map((cfg, idx) => {
                    const approvedLog = dr.approvals.find(a => a.step === cfg.step && a.action === 'approve')
                    const rejectedLog = dr.approvals.find(a => a.step === cfg.step && a.action === 'reject')
                    return (
                      <div key={cfg.step} style={{
                        ...apvCellStyle,
                        borderRight: idx === ac.config.length - 1 ? 'none' : `0.5px solid #ccc`,
                      }}>
                        <div style={apvLabelStyle}>{cfg.role_label}</div>
                        <div style={apvBodyStyle}>
                          {approvedLog ? (
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ color: '#166534', fontWeight: 600 }}>✓ 승인</div>
                              <div style={{ fontSize: '6.5pt', color: '#6b7280', marginTop: 1 }}>
                                {new Date(approvedLog.created_at)
                                  .toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          ) : rejectedLog ? (
                            <span style={{ color: '#b91c1c', fontWeight: 600 }}>✗ 반려</span>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                  {/* 결재선 미설정 시 빈 칸 */}
                  {ac.config.length === 0 && (
                    <div style={{ ...apvCellStyle, borderRight: 'none' }}>
                      <div style={apvLabelStyle}>결 재</div>
                      <div style={apvBodyStyle} />
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* 자금현황 테이블 */}
          <div className="print-summary-table">
            <ReportSummaryTable
              prevDaily={summary.prevDaily}
              currDaily={summary.currDaily}
              investGroups={summary.investGroups}
              depositSubtotal={summary.depositSubtotal}
              nonDepositSubtotal={summary.nonDepositSubtotal}
              loanGroups={summary.loanGroups}
              equityGroups={summary.equityGroups}
              itemSums={liveItemSums}
              loading={false}
              company={resolvedCompany}
              baseDate={reportDate}
              closeDate={reportDate}
              toKRW={summary.toKRW}
              fx={summary.fx}
            />
          </div>

          {/* ════ PAGE 2: 컬러 헤더 + 입출금 2열 + 검증 바(하단) ════ */}
          <div className="print-page-break" style={{
            display: 'flex', flexDirection: 'column', minHeight: '160mm',
          }}>
            <PrintColorHeader
              company={resolvedCompany}
              reportDate={reportDate}
              selectedDate={selectedDate}
              statusLabel={badge.label}
              compact
            />

            {/* 입금 / 출금 2열 — flex:1 로 공간 채움 */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
              marginTop: 6, flex: 1,
            }}>
              {(['in', 'out'] as const).map(dir => {
                const filtered = itemHook.items.filter(i => i.direction === dir)
                const total = filtered.reduce((s, i) =>
                  s + (i.amount_krw ?? summary.toKRW(i.amount, i.currency)), 0)
                const sectionColor = dir === 'in' ? '#166534' : '#991b1b'
                return (
                  <div key={dir}>
                    {/* 섹션 제목 */}
                    <div style={{
                      borderLeft: `3px solid ${sectionColor}`, paddingLeft: 5,
                      fontSize: '9pt', fontWeight: 700, color: sectionColor,
                      marginBottom: 4,
                    }}>
                      {dir === 'in' ? '입금 내역' : '출금 내역'}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
                      <thead>
                        <tr>
                          <th style={{ background: '#dbeafe', color: '#1e3a5f', border: '0.5px solid #bfdbfe', padding: '2px 5px', textAlign: 'left', width: '30%' }}>구분</th>
                          <th style={{ background: '#dbeafe', color: '#1e3a5f', border: '0.5px solid #bfdbfe', padding: '2px 5px', width: '16%' }}>계좌</th>
                          <th style={{ background: '#dbeafe', color: '#1e3a5f', border: '0.5px solid #bfdbfe', padding: '2px 5px', textAlign: 'right', width: '22%' }}>금액 (원)</th>
                          <th style={{ background: '#dbeafe', color: '#1e3a5f', border: '0.5px solid #bfdbfe', padding: '2px 5px', textAlign: 'left' }}>메모</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af', padding: '6px', border: '0.5px solid #e2e8f0' }}>
                              내역 없음
                            </td>
                          </tr>
                        ) : (
                          filtered.map(item => {
                            const krwAmt = item.amount_krw ?? summary.toKRW(item.amount, item.currency)
                            const isAuto = item.memo?.startsWith('@auto:')
                            const memoDisplay = isAuto
                              ? (item.memo?.replace('@auto:bond:', '[국채] ').replace('@auto:', '') ?? '')
                              : (item.memo ?? '')
                            return (
                              <tr key={item.id}>
                                <td style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px' }}>
                                  {CATEGORY_LABEL[item.category] ?? item.category}
                                  {isAuto && (
                                    <span style={{ fontSize: '6.5pt', marginLeft: 3, color: '#7c3aed' }}>(자동)</span>
                                  )}
                                </td>
                                <td style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px', textAlign: 'center' }}>
                                  {item.account_type ? (ACCOUNT_LABELS[item.account_type] ?? item.account_type) : '—'}
                                </td>
                                <td style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                  {krwAmt > 0 ? Math.round(krwAmt).toLocaleString('ko-KR') : '—'}
                                </td>
                                <td style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px' }}>{memoDisplay}</td>
                              </tr>
                            )
                          })
                        )}
                        <tr style={{ fontWeight: 700, borderTop: `1.5px solid ${sectionColor}` }}>
                          <td colSpan={2} style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px', background: dir === 'in' ? '#f0fdf4' : '#fef2f2' }}>
                            {dir === 'in' ? '입금 합계' : '출금 합계'}
                          </td>
                          <td style={{ border: '0.5px solid #e2e8f0', padding: '2px 5px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: sectionColor, background: dir === 'in' ? '#f0fdf4' : '#fef2f2' }}>
                            {Math.round(total).toLocaleString('ko-KR')}
                          </td>
                          <td style={{ border: '0.5px solid #e2e8f0', background: dir === 'in' ? '#f0fdf4' : '#fef2f2' }} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>

            {/* 검증 바 — marginTop:auto 로 페이지 하단 고정 */}
            {(() => {
              const { inTotal, outTotal, delta, diff, hasData, isValid } = validation
              const fmt = (n: number) => (Math.round(n / 1e6) / 100).toFixed(2) + '억'
              return (
                <div style={{
                  marginTop: 'auto',
                  border: `1px solid ${isValid ? '#bbf7d0' : '#fecaca'}`,
                  background: isValid ? '#f0fdf4' : '#fef2f2',
                  padding: '4px 10px',
                  display: 'flex', gap: 8, alignItems: 'center',
                  fontSize: '8.5pt', pageBreakInside: 'avoid',
                }}>
                  <span style={{ fontWeight: 600, color: '#1e3a5f' }}>검증</span>
                  <span>입금 <strong style={{ color: '#166534' }}>{hasData ? fmt(inTotal) : '—'}</strong></span>
                  <span style={{ color: '#9ca3af' }}>−</span>
                  <span>출금 <strong style={{ color: '#991b1b' }}>{hasData ? fmt(outTotal) : '—'}</strong></span>
                  <span style={{ color: '#9ca3af' }}>−</span>
                  <span>잔액증감 <strong>{hasData ? fmt(delta) : '—'}</strong></span>
                  <span style={{ color: '#9ca3af' }}>=</span>
                  <span style={{ fontWeight: 700, color: isValid ? '#166534' : '#991b1b', marginLeft: 4 }}>
                    {isValid
                      ? '✅ 검증 통과'
                      : hasData
                        ? `⚠ 차이 ${Math.round(diff).toLocaleString('ko-KR')}원`
                        : '미계산'}
                  </span>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── 승인 모달 ─────────────────────────────────────────── */}
      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setApproveModal(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">결재 승인</h3>
            <p className="text-xs text-gray-500 dark:text-slate-300 mb-4">
              {resolvedCompany} · {reportDate} 자금일보를 승인합니다.
            </p>
            <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">의견 (선택)</label>
            <textarea
              value={approveModal.comment}
              onChange={e => setApproveModal({ comment: e.target.value })}
              placeholder="승인 의견을 입력하세요 (선택사항)"
              rows={3}
              className="w-full text-sm border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setApproveModal(null)} className="flex-1 text-sm py-2 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">취소</button>
              <button
                onClick={() => void handleApprove()}
                disabled={actionBusy}
                className="flex-1 text-sm py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {actionBusy ? '처리 중…' : '✓ 승인'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 반려 모달 ─────────────────────────────────────────── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setRejectModal(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">결재 반려</h3>
            <p className="text-xs text-gray-500 dark:text-slate-300 mb-4">
              {resolvedCompany} · {reportDate} 자금일보를 반려합니다.
            </p>
            <label className="block text-xs text-gray-500 dark:text-slate-300 mb-1">반려 사유 <span className="text-red-500">*</span></label>
            <textarea
              value={rejectModal.comment}
              onChange={e => setRejectModal({ comment: e.target.value })}
              placeholder="반려 사유를 입력하세요 (필수)"
              rows={3}
              autoFocus
              className="w-full text-sm border border-gray-200 dark:border-slate-600 rounded-xl px-3 py-2 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejectModal(null)} className="flex-1 text-sm py-2 border border-gray-200 dark:border-slate-600 rounded-xl text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-700">취소</button>
              <button
                onClick={() => void handleReject()}
                disabled={!rejectModal.comment.trim() || actionBusy}
                className="flex-1 text-sm py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium disabled:opacity-50"
              >
                {actionBusy ? '처리 중…' : '반려'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 결재선 설정 모달 (master 전용) ───────────────────────── */}
      {configModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setConfigModal(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">결재선 설정</h3>
              <button onClick={() => setConfigModal(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{resolvedCompany} 자금일보 결재선</p>

            {/* 현재 결재선 목록 */}
            <div className="space-y-2 mb-4">
              {ac.config.length === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-3">설정된 결재선이 없습니다</p>
              )}
              {ac.config.map(cfg => (
                <div key={cfg.step} className="flex items-center gap-2 bg-gray-50 dark:bg-slate-700 rounded-lg px-3 py-2">
                  <span className="text-[10px] text-gray-400 w-8">Step {cfg.step}</span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-200 flex-1">{cfg.role_label}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{cfg.approver_code}</span>
                  <button
                    onClick={() => void ac.remove(cfg.step)}
                    className="text-red-400 hover:text-red-600 text-xs ml-2"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>

            {/* 신규 추가 폼 */}
            <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
              <p className="text-[11px] text-gray-500 dark:text-slate-300 font-medium mb-2">결재 단계 추가</p>
              <div className="flex gap-2 mb-2">
                <div className="w-16">
                  <label className="block text-[10px] text-gray-400 mb-1">Step</label>
                  <input
                    type="number" min="1" max="9"
                    value={cfgForm.step}
                    onChange={e => setCfgForm(f => ({ ...f, step: e.target.value }))}
                    placeholder="1"
                    className="w-full text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                <div className="w-24">
                  <label className="block text-[10px] text-gray-400 mb-1">역할명</label>
                  <input
                    value={cfgForm.role_label}
                    onChange={e => setCfgForm(f => ({ ...f, role_label: e.target.value }))}
                    placeholder="팀장"
                    className="w-full text-xs border border-gray-200 dark:border-slate-600 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-slate-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div className="mb-2">
                <label className="block text-[10px] text-gray-400 mb-1">
                  결재자 선택
                  <span className="text-gray-300 dark:text-slate-500 ml-1">— {resolvedCompany} 소속</span>
                </label>
                <UserPicker
                  company={resolvedCompany}
                  value={cfgForm.approver_code}
                  onChange={(code, label) => setCfgForm(f => ({
                    ...f,
                    approver_code: code,
                    role_label: f.role_label || label,
                  }))}
                />
              </div>
              <button
                onClick={() => void handleCfgSave()}
                disabled={!cfgForm.step || !cfgForm.role_label.trim() || !cfgForm.approver_code.trim() || actionBusy}
                className="w-full text-xs py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-40"
              >
                + 추가
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CMS 대사 검증 모달 ─────────────────────────────────────── */}
      {cmsVerifyPdfs && (
        <CmsVerificationModal
          key={cmsVerifyKey}
          pdfs={cmsVerifyPdfs}
          initialIndex={cmsInitialIdx}
          daily={summary.currDaily ?? null}
          reportDate={reportDate}
          toKRW={summary.toKRW}
          onClose={() => setCmsVerifyPdfs(null)}
        />
      )}
    </div>
  )
}

