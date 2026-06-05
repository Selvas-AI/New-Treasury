/**
 * 시안 미리보기 페이지 — 개발 완료 후 삭제
 * /mockup 에서 접근
 */
import { useState, useEffect } from 'react'

// ─── ② 팝업 방식 시안 ────────────────────────────────────────

function PopupA() {
  const [open, setOpen] = useState<string | null>(null)
  const items = [
    { key: 'operating', label: '운전자금', color: 'bg-blue-500', value: '67.4억원', badge: '가용' },
    { key: 'invest',    label: '가용 운용', color: 'bg-emerald-500', value: '463.6억원', badge: '가용' },
    { key: 'loan',      label: '차입금',   color: 'bg-red-400',    value: '148.0억원', badge: '차입' },
  ]
  const details: Record<string, { title: string; rows: {k:string;v:string}[] }> = {
    operating: { title: '운전자금 상세', rows: [
      { k: '보통예금/CMA', v: '61.3억원' }, { k: '국책자금', v: '3.7억원' },
      { k: '증권예수금', v: '4만원' }, { k: '외화(환산)', v: '2.4억원' },
    ]},
    invest: { title: '운용자금 상세', rows: [
      { k: '기업은행(181)', v: '50.0억원' }, { k: '국민은행(231)', v: '50.0억원' },
      { k: '국민은행(726)', v: '30.0억원' }, { k: '국민은행(007)', v: '100만원' },
    ]},
    loan: { title: '차입금 상세', rows: [
      { k: '하나은행 D-19', v: '50.0억원' }, { k: '하나은행 D-103', v: '30.0억원' },
      { k: '하나은행 D-196', v: '20.0억원' },
    ]},
  }
  return (
    <div className="relative">
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">A안 — 우측 드로어(슬라이드아웃)</h4>
      <p className="text-[11px] text-gray-400 mb-3">자금흐름 항목 클릭 시 화면 우측에서 드로어가 슬라이드인</p>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-2 relative overflow-hidden" style={{minHeight:180}}>
        {items.map(it => (
          <button key={it.key} onClick={() => setOpen(open === it.key ? null : it.key)}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all ${
              open === it.key ? 'ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}>
            <span className="flex items-center gap-2 font-medium text-gray-700 dark:text-gray-200">
              <span className={`w-2 h-2 rounded-full ${it.color}`} />{it.label}
            </span>
            <span className="text-gray-600 dark:text-gray-300 tabular-nums">{it.value}</span>
          </button>
        ))}
        {/* 드로어 */}
        <div className={`absolute inset-y-0 right-0 w-56 bg-white dark:bg-gray-750 border-l border-gray-200 dark:border-gray-600 shadow-xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
          style={{backgroundColor: 'var(--tw-bg-opacity, 1)', background: 'rgb(31 41 55)'}}>
          {open && details[open] && (
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-200">{details[open].title}</p>
                <button onClick={() => setOpen(null)} className="text-gray-400 hover:text-gray-200 text-sm">✕</button>
              </div>
              {details[open].rows.map(r => (
                <div key={r.k} className="flex justify-between text-[11px] py-1 border-b border-gray-700">
                  <span className="text-gray-400">{r.k}</span>
                  <span className="text-gray-200 tabular-nums font-medium">{r.v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PopupB() {
  const [open, setOpen] = useState<string | null>(null)
  const items = [
    { key: 'operating', label: '운전자금', color: 'bg-blue-500', value: '67.4억원',
      rows: [{k:'보통예금/CMA',v:'61.3억원'},{k:'국책자금',v:'3.7억원'},{k:'증권예수금',v:'4만원'},{k:'외화(환산)',v:'2.4억원'}] },
    { key: 'invest', label: '가용 운용', color: 'bg-emerald-500', value: '463.6억원',
      rows: [{k:'기업은행(181)',v:'50.0억원'},{k:'국민은행(231)',v:'50.0억원'},{k:'국민은행(726)',v:'30.0억원'}] },
    { key: 'loan', label: '차입금', color: 'bg-red-400', value: '148.0억원',
      rows: [{k:'하나은행 D-19',v:'50.0억원'},{k:'하나은행 D-103',v:'30.0억원'},{k:'하나은행 D-196',v:'20.0억원'}] },
  ]
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">B안 — 인라인 아코디언(항목 아래 펼침)</h4>
      <p className="text-[11px] text-gray-400 mb-3">클릭한 항목 바로 아래로 상세 내용이 펼쳐짐 (새 창 없음)</p>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 space-y-1">
        {items.map(it => (
          <div key={it.key}>
            <button onClick={() => setOpen(open === it.key ? null : it.key)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all ${
                open === it.key ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}>
              <span className="flex items-center gap-2 font-medium">
                <span className={`w-2 h-2 rounded-full ${it.color}`} />{it.label}
              </span>
              <span className="flex items-center gap-2 tabular-nums">
                {it.value}
                <span className="text-gray-400">{open === it.key ? '▲' : '▼'}</span>
              </span>
            </button>
            {open === it.key && (
              <div className="mx-3 mb-1 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600 px-3 py-2 space-y-1">
                {it.rows.map(r => (
                  <div key={r.k} className="flex justify-between text-[11px]">
                    <span className="text-gray-500 dark:text-gray-400">{r.k}</span>
                    <span className="font-medium text-gray-800 dark:text-gray-200 tabular-nums">{r.v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ③ 이슈 전광판 시안 ──────────────────────────────────────

const DEMO_ISSUES = [
  { key: 'loan1', title: '차입금 만기 D-19', desc: '하나은행 50억원 — 2026-06-23 만기', status: 'open' },
  { key: 'loan2', title: '차입금 만기 D-103', desc: '하나은행 30억원 — 2026-09-15 만기', status: 'review' },
  { key: 'input', title: '운전자금 미입력', desc: '오늘(2026-06-04) 운전자금이 아직 입력되지 않았습니다.', status: 'open' },
]

function IssueA() {
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">A안 — 주가 티커형 마퀴</h4>
      <p className="text-[11px] text-gray-400 mb-3">이슈들이 오른쪽→왼쪽으로 흘러감. TopBar 내 주가 티커와 동일한 패턴</p>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        <div className="flex items-center h-10 bg-gray-900 dark:bg-gray-950 px-3 gap-3">
          <span className="text-[10px] font-bold text-red-400 shrink-0">🔔 이슈 {DEMO_ISSUES.length}건</span>
          <div className="flex-1 overflow-hidden">
            <div className="flex items-center gap-8 whitespace-nowrap"
              style={{animation:'marquee 18s linear infinite', display:'flex', width:'max-content'}}>
              {[...DEMO_ISSUES, ...DEMO_ISSUES].map((iss, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iss.status === 'open' ? 'bg-red-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span className="text-gray-300 font-medium">{iss.title}</span>
                  <span className="text-gray-500">— {iss.desc}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-gray-400 p-2 text-center">↑ TopBar 하단 또는 대시보드 상단에 배치</p>
      </div>
      <style>{`@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
    </div>
  )
}

function IssueB() {
  const [curr, setCurr] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setCurr(c => (c + 1) % DEMO_ISSUES.length), 2500)
    return () => clearInterval(t)
  }, [])
  const iss = DEMO_ISSUES[curr]
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">B안 — 슬라이드쇼 (2.5초 자동 전환)</h4>
      <p className="text-[11px] text-gray-400 mb-3">한 건씩 강조 표시, 자동 순환. 클릭 시 이슈 이력으로 이동</p>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        <div className="flex items-center h-10 bg-gray-900 dark:bg-gray-950 px-4 gap-3">
          <span className="text-[10px] font-bold text-red-400 shrink-0">🔔 {curr + 1}/{DEMO_ISSUES.length}</span>
          <div className="flex-1 min-w-0">
            <span className={`inline-flex items-center gap-1.5 text-[11px] transition-all`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${iss.status === 'open' ? 'bg-red-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-white font-semibold">{iss.title}</span>
              <span className="text-gray-400 hidden sm:inline">— {iss.desc}</span>
            </span>
          </div>
          <div className="flex gap-1 shrink-0">
            {DEMO_ISSUES.map((_, i) => (
              <button key={i} onClick={() => setCurr(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === curr ? 'bg-blue-400' : 'bg-gray-600'}`} />
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 p-2 text-center">↑ TopBar 하단 배치, 도트로 몇 번째 이슈인지 표시</p>
      </div>
    </div>
  )
}

function IssueC() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">C안 — 배지+드롭다운</h4>
      <p className="text-[11px] text-gray-400 mb-3">건수 배지 + 최신 이슈 1줄 요약. 클릭 시 이슈 목록 드롭다운</p>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        <div className="flex items-center h-10 bg-gray-900 dark:bg-gray-950 px-4 gap-3">
          <button onClick={() => setOpen(o => !o)}
            className="flex items-center gap-2 text-[11px] hover:bg-gray-800 px-2 py-1 rounded transition-colors">
            <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">3</span>
            <span className="text-gray-300">
              <span className="text-red-400 font-semibold">차입금 만기 D-19</span>
              <span className="text-gray-500 ml-1">외 2건</span>
            </span>
            <span className="text-gray-500 text-[10px]">{open ? '▲' : '▼'}</span>
          </button>
        </div>
        {open && (
          <div className="border-t border-gray-700 bg-gray-900 divide-y divide-gray-800">
            {DEMO_ISSUES.map(iss => (
              <div key={iss.key} className="flex items-start gap-2 px-4 py-2">
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${iss.status === 'open' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <div>
                  <p className="text-[11px] font-semibold text-gray-200">{iss.title}</p>
                  <p className="text-[10px] text-gray-500">{iss.desc}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 p-2 text-center">↑ TopBar 내 상시 표시, 클릭 시 드롭다운 확장</p>
      </div>
    </div>
  )
}

// ─── 메인 시안 페이지 ──────────────────────────────────────────
export default function MockupPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-10">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">UI 시안 미리보기</h1>
        <p className="text-sm text-gray-400 mt-1">개발 전 UI 방향 검토용</p>
      </div>

      {/* ── ② 팝업 방식 ── */}
      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2">
          ② 자금흐름 상세 팝업 방식
        </h2>
        <div className="grid grid-cols-1 gap-6 pt-2">
          <PopupA />
          <PopupB />
        </div>
      </section>

      {/* ── ③ 이슈 전광판 ── */}
      <section className="space-y-2">
        <h2 className="text-base font-bold text-gray-700 dark:text-gray-200 border-b border-gray-200 dark:border-gray-700 pb-2">
          ③ 이슈 전광판 방식
        </h2>
        <div className="grid grid-cols-1 gap-6 pt-2">
          <IssueA />
          <IssueB />
          <IssueC />
        </div>
      </section>
    </div>
  )
}
