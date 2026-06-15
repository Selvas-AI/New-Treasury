/**
 * CmsVerificationModal — CMS 증빙 PDF 뷰어 + 자금일보 대사 검증 (다중 PDF 지원)
 *
 * 좌측: PDF 탭 + 캔버스 렌더링 (텍스트 선택 가능)
 * 우측: 자금일보 항목 대사 — 모든 PDF에서 금액 자동 추출·매칭(출처 PDF·페이지 표기)
 *       카드 클릭 → 해당 PDF 탭 전환 + 페이지 점프 + 추출 금액 목록에서 강조
 *       대사 완료 시 어느 PDF에서 확인했는지 출처 자동 기록 + 메모
 *
 * 설계 노트
 *  - 캔버스 위 텍스트 하이라이트는 PDF 구조(숫자 분할)에 따라 불안정 → 사용하지 않음.
 *    대신 "페이지 점프 + 우측 추출 금액 목록 강조"로 위치를 안내한다.
 *  - 대사 상태는 localStorage(법인+보고일)로 영속.
 *
 * pdfjs-dist v6: TextLayer 클래스 사용
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import type { DailyRecord } from '../../types'

// ── PDF.js 동적 임포트 ────────────────────────────────────────
type PdfLib = typeof import('pdfjs-dist')
let _pdfLib: PdfLib | null = null
async function getPdfLib(): Promise<PdfLib> {
  if (_pdfLib) return _pdfLib
  _pdfLib = await import('pdfjs-dist')
  _pdfLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${_pdfLib.version}/build/pdf.worker.min.mjs`
  return _pdfLib
}

// ── 자금일보 대사 항목 ────────────────────────────────────────
interface DailyField { key: string; label: string; value: number }

function buildFields(daily: DailyRecord | null, toKRW: (n: number, c: string) => number): DailyField[] {
  if (!daily) return []
  const fxKrw =
    toKRW(daily.fx_usd ?? 0, 'USD') + toKRW(daily.fx_eur ?? 0, 'EUR') +
    toKRW(daily.fx_jpy ?? 0, 'JPY') + toKRW(daily.fx_gbp ?? 0, 'GBP') +
    toKRW(daily.fx_cny ?? 0, 'CNY')
  const total = (daily.krw_demand ?? 0) + (daily.krw_govt ?? 0) + (daily.krw_mmda ?? 0) + fxKrw
  return [
    { key: 'krw_demand', label: '보통예금/일반예금', value: Math.round(daily.krw_demand ?? 0) },
    { key: 'krw_govt',   label: '국책과제자금',      value: Math.round(daily.krw_govt   ?? 0) },
    { key: 'krw_mmda',   label: 'MMDA/증권예수금',   value: Math.round(daily.krw_mmda   ?? 0) },
    { key: 'fx_krw',     label: '외화 환산 합계',     value: Math.round(fxKrw) },
    { key: 'total_krw',  label: '현금 합계 (전체)',   value: Math.round(total) },
  ]
}

function parseAmounts(text: string): number[] {
  const out: number[] = []
  const re = /[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]{4,}(?:\.[0-9]+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[0].replace(/,/g, ''))
    if (isFinite(n) && n >= 1000) out.push(Math.round(n))
  }
  return out
}

const fmtKRW = (n: number) => Math.round(n).toLocaleString('ko-KR') + '원'

type MatchStatus = 'exact' | 'near' | 'mismatch'
function matchOf(target: number, candidate: number): MatchStatus {
  if (target === 0) return 'mismatch'
  const diff = Math.abs(candidate - target)
  if (diff <= 1) return 'exact'
  if (diff <= 500) return 'near'
  if (diff / target <= 0.001) return 'near'
  return 'mismatch'
}

// PDF별 추출 결과
interface Extraction { amounts: number[]; pageMap: Map<number, number>; hasText: boolean; numPages: number }
// 전체 PDF에 걸친 금액 후보
interface Hit { amount: number; pdfIndex: number; fileName: string; page: number }

function bestHit(value: number, hits: Hit[]): { status: MatchStatus; hit: Hit | null } {
  let best: MatchStatus = 'mismatch'
  let chosen: Hit | null = null
  for (const h of hits) {
    const st = matchOf(value, h.amount)
    if (st === 'exact') return { status: 'exact', hit: h }
    if (st === 'near' && best !== 'near') { best = 'near'; chosen = h }
  }
  return { status: best, hit: chosen }
}

// ── Props ─────────────────────────────────────────────────────
interface PdfSource { fileName: string; url: string }
interface Props {
  pdfs:        PdfSource[]
  initialIndex?: number
  daily:       DailyRecord | null
  reportDate:  string
  toKRW:       (n: number, currency: string) => number
  onClose:     () => void
}

interface VState { done: boolean; memo: string; editMemo: boolean; collapsed: boolean; source: string }
const EMPTY_VS: VState = { done: false, memo: '', editMemo: false, collapsed: false, source: '' }

export default function CmsVerificationModal({
  pdfs, initialIndex = 0, daily, reportDate, toKRW, onClose,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

  const [activePdf,  setActivePdf]  = useState(Math.min(initialIndex, pdfs.length - 1))
  const [loadState,  setLoadState]  = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg,   setErrorMsg]   = useState('')
  const [page,       setPage]       = useState(1)
  const [scale,      setScale]      = useState(1.3)
  const [clicked,    setClicked]    = useState<number | null>(null)
  const [extractions, setExtractions] = useState<Extraction[]>([])
  const [extracted,  setExtracted]  = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docsRef = useRef<any[]>([])
  const fields = buildFields(daily, toKRW)

  // 대사 상태 (localStorage 영속)
  const storageKey = `cms_verify_${daily?.company ?? 'x'}_${reportDate}`
  const [verifyState, setVerifyState] = useState<Record<string, VState>>(() => {
    try {
      const raw = localStorage.getItem(`cms_verify_${daily?.company ?? 'x'}_${reportDate}`)
      return raw ? (JSON.parse(raw) as Record<string, VState>) : {}
    } catch { return {} }
  })
  useEffect(() => {
    if (Object.keys(verifyState).length === 0) return
    try { localStorage.setItem(storageKey, JSON.stringify(verifyState)) } catch { /* quota */ }
  }, [storageKey, verifyState])
  const getVS = (key: string): VState => verifyState[key] ?? EMPTY_VS
  function setVS(key: string, patch: Partial<VState>) {
    setVerifyState(prev => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_VS), ...patch } }))
  }

  // ── 모든 PDF 로드 + 금액 추출 ───────────────────────────────
  const pdfsKey = pdfs.map(p => p.url).join('|')
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadState('loading'); setExtracted(false)
      try {
        const lib = await getPdfLib()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const docs: any[] = []
        const exts: Extraction[] = []
        for (const p of pdfs) {
          const doc = await lib.getDocument({ url: p.url }).promise
          if (cancelled) return
          const amounts: number[] = []
          const pageMap = new Map<number, number>()
          let chars = 0
          for (let pg = 1; pg <= doc.numPages; pg++) {
            const page = await doc.getPage(pg)
            const tc = await page.getTextContent()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const line = (tc.items as any[]).map(i => i.str ?? '').join(' ')
            chars += line.replace(/\s/g, '').length
            for (const n of parseAmounts(line)) { amounts.push(n); if (!pageMap.has(n)) pageMap.set(n, pg) }
          }
          docs.push(doc)
          exts.push({ amounts: [...new Set(amounts)].sort((a, b) => b - a), pageMap, hasText: chars > 10, numPages: doc.numPages })
        }
        if (cancelled) return
        docsRef.current = docs
        setExtractions(exts)
        setLoadState('ready')
        setExtracted(true)
      } catch (e) {
        if (!cancelled) { setErrorMsg(e instanceof Error ? e.message : 'PDF 로드 실패'); setLoadState('error') }
      }
    })()
    return () => { cancelled = true }
  }, [pdfsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 전체 PDF 금액 후보 (자동 매칭용)
  const allHits = useMemo<Hit[]>(() => {
    const out: Hit[] = []
    extractions.forEach((ext, idx) => {
      for (const n of ext.amounts) out.push({ amount: n, pdfIndex: idx, fileName: pdfs[idx]?.fileName ?? `PDF${idx + 1}`, page: ext.pageMap.get(n) ?? 1 })
    })
    return out
  }, [extractions, pdfsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeExt = extractions[activePdf]
  const totalPages = activeExt?.numPages ?? 0

  // ── 페이지 렌더링 (activePdf 문서) ──────────────────────────
  const renderPage = useCallback(async (pageNum: number) => {
    const doc = docsRef.current[activePdf]
    const canvas = canvasRef.current
    const tDiv = textLayerRef.current
    if (!doc || !canvas || !tDiv) return

    const lib = await getPdfLib()
    const pdfPage = await doc.getPage(pageNum)
    const viewport = pdfPage.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    await pdfPage.render({ canvasContext: ctx, viewport }).promise

    tDiv.innerHTML = ''
    tDiv.style.width = `${viewport.width}px`
    tDiv.style.height = `${viewport.height}px`
    tDiv.style.setProperty('--scale-factor', String(scale))
    const tc = await pdfPage.getTextContent()
    const tl = new lib.TextLayer({ textContentSource: tc, container: tDiv, viewport })
    await tl.render()
    tDiv.querySelectorAll('span').forEach(el => {
      const s = el as HTMLElement
      const fh = s.style.getPropertyValue('--font-height').trim()
      const sx = s.style.getPropertyValue('--scale-x').trim() || '1'
      if (fh) s.style.fontSize = fh
      s.style.transform = `scaleX(${sx})`; s.style.transformOrigin = '0% 0%'
      s.style.position = 'absolute'; s.style.whiteSpace = 'pre'; s.style.color = 'transparent'
    })
  }, [scale, activePdf])

  useEffect(() => { if (loadState === 'ready') void renderPage(page) }, [loadState, page, activePdf, renderPage])
  // PDF 전환 시 1페이지로
  useEffect(() => { setPage(1) }, [activePdf])

  // ── 카드/금액 클릭 → 해당 PDF·페이지로 이동 ──────────────────
  function locate(hit: Hit | null) {
    if (!hit) return
    setClicked(hit.amount)
    if (hit.pdfIndex !== activePdf) { setActivePdf(hit.pdfIndex); setPage(hit.page) }
    else setPage(hit.page)
  }

  const verifiable = fields.filter(f => f.value > 0)
  const doneCount  = verifiable.filter(f => getVS(f.key).done).length
  const allDone    = verifiable.length > 0 && doneCount === verifiable.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col"
        style={{ width: '94vw', maxWidth: 1400, height: '92vh' }}>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-slate-700 shrink-0">
          <div>
            <h2 className="font-bold text-gray-800 dark:text-gray-100">📄 CMS 잔고내역 대사 검증</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {reportDate} 보고기준 · 증빙 {pdfs.length}건 · 카드를 클릭하면 해당 PDF·페이지로 이동합니다
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              allDone ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                      : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-100'}`}>
              대사 {doneCount} / {verifiable.length}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl px-1 leading-none">✕</button>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── 좌: PDF 뷰어 ── */}
          <div className="flex-1 flex flex-col min-w-0 border-r border-gray-200 dark:border-slate-700">
            {/* PDF 탭 (2건 이상일 때) */}
            {pdfs.length > 1 && (
              <div className="flex items-center gap-1 px-3 pt-2 border-b border-gray-100 dark:border-gray-800 overflow-x-auto shrink-0">
                {pdfs.map((p, i) => (
                  <button key={i} onClick={() => setActivePdf(i)}
                    className={`px-3 py-1.5 text-xs rounded-t-lg whitespace-nowrap border-b-2 -mb-px ${
                      i === activePdf
                        ? 'border-blue-500 text-blue-600 dark:text-blue-300 font-semibold bg-blue-50/50 dark:bg-blue-900/20'
                        : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                    title={p.fileName}>
                    📄 {p.fileName.length > 18 ? p.fileName.slice(0, 16) + '…' : p.fileName}
                    {extracted && !extractions[i]?.hasText && <span className="ml-1 text-amber-500" title="스캔본(텍스트 없음)">⚠</span>}
                  </button>
                ))}
              </div>
            )}
            {/* 툴바 */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 text-xs text-gray-600 dark:text-slate-300 shrink-0 flex-wrap">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-2 py-1 rounded bg-gray-100 dark:bg-slate-800 disabled:opacity-40">◀</button>
              <span className="tabular-nums">{page} / {totalPages || '—'}</span>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 rounded bg-gray-100 dark:bg-slate-800 disabled:opacity-40">▶</button>
              <span className="ml-3">배율</span>
              {[1.0, 1.3, 1.6, 2.0].map(s => (
                <button key={s} onClick={() => setScale(s)}
                  className={`px-2 py-0.5 rounded text-xs border ${
                    scale === s ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border-blue-300'
                                : 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700'}`}>
                  {Math.round(s * 100)}%
                </button>
              ))}
              {extracted && activeExt && (
                activeExt.hasText
                  ? <span className="ml-auto text-emerald-600 dark:text-emerald-400 font-medium">✓ 이 PDF 금액 {activeExt.amounts.length}건 추출</span>
                  : <span className="ml-auto text-amber-600 dark:text-amber-400 font-medium">⚠ 스캔본 — 화면 대조</span>
              )}
            </div>
            {/* 캔버스 */}
            <div className="flex-1 overflow-auto bg-gray-200 dark:bg-slate-800 p-4">
              {loadState === 'loading' && <div className="flex items-center justify-center h-full text-gray-500 text-sm">PDF 로딩 중…</div>}
              {loadState === 'error' && <div className="flex items-center justify-center h-full text-red-500 text-sm">{errorMsg}</div>}
              {loadState === 'ready' && (
                <div className="relative inline-block shadow-lg">
                  <canvas ref={canvasRef} style={{ display: 'block' }} />
                  <div ref={textLayerRef} className="cms-text-overlay absolute top-0 left-0" />
                </div>
              )}
            </div>
          </div>

          {/* ── 우: 대사 패널 ── */}
          <div className="w-96 shrink-0 overflow-y-auto p-4 space-y-2.5 bg-gray-50/50 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200">자금일보 항목 대사</h3>

            {fields.map(f => {
              const vs   = getVS(f.key)
              const auto = extracted ? bestHit(f.value, allHits) : null
              const zero = f.value === 0

              if (vs.done && vs.collapsed) {
                return (
                  <div key={f.key}
                    className="rounded-lg border border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 flex items-center justify-between cursor-pointer"
                    onClick={() => setVS(f.key, { collapsed: false })}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-green-600 dark:text-green-400 text-xs font-bold">✅</span>
                        <span className="text-xs font-medium text-gray-600 dark:text-slate-100 truncate">{f.label}</span>
                      </div>
                      <div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtKRW(f.value)}</div>
                      <div className="text-[10px] text-gray-400 truncate">
                        {vs.source && `📎 ${vs.source}`}{vs.source && vs.memo && ' · '}{vs.memo && `📝 ${vs.memo}`}
                      </div>
                    </div>
                    <span className="text-gray-400 text-xs shrink-0 ml-2">▾ 펼치기</span>
                  </div>
                )
              }

              return (
                <div key={f.key}
                  className={`rounded-lg border p-3 transition-colors ${
                    vs.done ? 'border-green-400 dark:border-green-600 bg-green-50 dark:bg-green-900/20'
                            : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  } ${!zero && auto?.hit ? 'cursor-pointer hover:border-blue-300' : ''}`}
                  onClick={() => !zero && auto?.hit && locate(auto.hit)}>

                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600 dark:text-slate-100">{f.label}</span>
                    {zero
                      ? <span className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700">대상 아님</span>
                      : vs.done
                        ? <span className="text-[10px] font-bold text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/50">✅ 대사완료</span>
                        : <span className="text-[10px] font-bold text-gray-500 dark:text-slate-300 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-700">○ 미대사</span>}
                  </div>

                  <div className="text-base font-bold tabular-nums text-gray-800 dark:text-gray-100">{fmtKRW(f.value)}</div>

                  {/* 자동 대조 결과 — 출처 PDF·페이지 표기 */}
                  {!zero && auto && (
                    <div className={`text-xs mt-1.5 ${
                      auto.status === 'exact' ? 'text-green-600 dark:text-green-400'
                      : auto.status === 'near' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>
                      {auto.status === 'exact' ? <>🟢 {auto.hit!.fileName} p.{auto.hit!.page} 에서 일치 · 클릭해 이동</>
                      : auto.status === 'near' ? <>🟡 {auto.hit!.fileName} p.{auto.hit!.page} 근사값 {fmtKRW(auto.hit!.amount)} (차이 {fmtKRW(Math.abs(auto.hit!.amount - f.value))})</>
                      : <>⚪ 모든 PDF에서 동일 금액 미발견 — 합산 항목일 수 있음</>}
                    </div>
                  )}

                  {/* 메모/출처 (완료 시) */}
                  {vs.done && (
                    <div className="mt-2 space-y-1" onClick={e => e.stopPropagation()}>
                      {vs.source && <div className="text-[11px] text-gray-500 dark:text-slate-300">📎 출처: {vs.source}</div>}
                      {vs.editMemo ? (
                        <div className="flex gap-1">
                          <input type="text" value={vs.memo} maxLength={100} autoFocus
                            placeholder="예: 2건 합산 / 별도 증빙 확인"
                            className="flex-1 text-xs border border-gray-300 dark:border-slate-600 rounded px-2 py-1 bg-white dark:bg-slate-700 text-gray-800 dark:text-gray-100"
                            onChange={e => setVS(f.key, { memo: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') setVS(f.key, { editMemo: false }) }} />
                          <button className="text-xs px-2 py-1 rounded bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-100"
                            onClick={() => setVS(f.key, { editMemo: false })}>저장</button>
                        </div>
                      ) : (
                        <button className="text-[11px] text-gray-500 dark:text-slate-300 hover:text-blue-600"
                          onClick={() => setVS(f.key, { editMemo: true })}>
                          {vs.memo ? `📝 ${vs.memo}` : '+ 메모 추가'}
                        </button>
                      )}
                    </div>
                  )}

                  {!zero && (
                    <div className="mt-2 flex gap-1.5" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setVS(f.key, {
                          done: !vs.done, editMemo: false, collapsed: false,
                          // 완료 처리 시 현재 보고 있는 PDF(또는 자동매칭 PDF)를 출처로 기록
                          source: !vs.done ? (auto?.hit?.fileName ?? pdfs[activePdf]?.fileName ?? '') : vs.source,
                        })}
                        className={`flex-1 text-xs py-1.5 rounded font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                          vs.done ? 'bg-green-600 hover:bg-green-700 text-white'
                                  : 'bg-white dark:bg-slate-700 border border-blue-400 dark:border-blue-500 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40'}`}>
                        {vs.done ? <><span className="text-sm">☑</span> 대사 완료됨 · 취소하려면 클릭</>
                                 : <><span className="text-sm">☐</span> 클릭하여 대사 완료</>}
                      </button>
                      {vs.done && (
                        <button onClick={() => setVS(f.key, { collapsed: true })}
                          className="px-2.5 text-xs rounded border border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                          title="카드 접기">▴ 접기</button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {allDone && (
              <div className="rounded-lg bg-green-100 dark:bg-green-900/40 border border-green-300 p-3 text-center">
                <div className="text-green-700 dark:text-green-300 font-bold text-sm">✅ 모든 항목 대사 완료</div>
                <div className="text-xs text-green-600 mt-1">창을 닫고 승인을 진행하세요</div>
              </div>
            )}

            {/* 현재 PDF의 추출 금액 목록 — 클릭 강조 */}
            {extracted && activeExt && activeExt.amounts.length > 0 && (
              <details className="rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-xs" open>
                <summary className="cursor-pointer px-3 py-2 text-gray-600 dark:text-slate-100 font-medium select-none">
                  📄 {pdfs[activePdf]?.fileName} 추출 금액 {activeExt.amounts.length}건
                </summary>
                <div className="px-3 pb-2 flex flex-wrap gap-1 max-h-44 overflow-y-auto">
                  {activeExt.amounts.map((n, i) => (
                    <button key={i} onClick={() => locate({ amount: n, pdfIndex: activePdf, fileName: pdfs[activePdf].fileName, page: activeExt.pageMap.get(n) ?? 1 })}
                      className={`px-1.5 py-0.5 rounded tabular-nums border ${
                        clicked === n
                          ? 'bg-yellow-200 dark:bg-yellow-600/50 border-yellow-500 text-gray-900 dark:text-yellow-100 font-bold'
                          : 'bg-gray-100 dark:bg-slate-700 border-transparent text-gray-600 dark:text-slate-100 hover:bg-blue-100 dark:hover:bg-blue-900'}`}>
                      {n.toLocaleString('ko-KR')}
                      <span className="text-[9px] text-gray-400 ml-0.5">p{activeExt.pageMap.get(n) ?? 1}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}

            <div className="rounded-lg bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-3 text-xs text-gray-500 space-y-1">
              <div className="font-medium text-gray-600 dark:text-slate-100">대사 방법</div>
              <div>① 카드 클릭 → 매칭 PDF·페이지로 이동 + 금액 목록 강조</div>
              <div>② 좌측 PDF에서 금액 확인 (PDF가 여러 개면 상단 탭 전환)</div>
              <div>③ "대사 완료" 클릭 → 확인한 PDF가 출처로 자동 기록</div>
              <div>④ 합산 등은 메모에 보충 설명</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .cms-text-overlay { position: absolute; top: 0; left: 0; overflow: hidden; line-height: 1; }
        .cms-text-overlay span {
          color: transparent; position: absolute; white-space: pre;
          cursor: text; transform-origin: 0% 0%;
          font-size: var(--font-height); transform: scaleX(var(--scale-x, 1));
        }
        .cms-text-overlay ::selection { background: rgba(59,130,246,0.35); }
      `}</style>
    </div>
  )
}

