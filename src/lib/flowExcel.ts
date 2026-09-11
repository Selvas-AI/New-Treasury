/**
 * 자금흐름 분석 엑셀 내보내기 (2026-09-11, Phase 3)
 *
 * 화면에서 본 것을 그대로 보고서에 붙일 수 있게 한다. 시트를 화면 탭과 1:1 로 맞춰
 * "어느 탭의 숫자인지" 헷갈리지 않게 했다.
 *
 * ⚠ 추정·복원이 섞인 숫자는 반드시 그 사실을 함께 내보낸다.
 *   엑셀로 뽑는 순간 화면의 배지(이력복원·만기추정)와 안내문이 떨어져 나가,
 *   받아 본 사람은 전부 확정된 실적으로 읽는다. 요약 시트 맨 위에 한계를 적고,
 *   해당 열에도 표시를 남긴다.
 */
import * as XLSX from 'xlsx'
import type { FlowBridge, DailyLedgerRow, InvestItem } from './flowBridge'
import { FLOW_GROUP_LABEL } from './flowBridge'
import type { FxEffectResult } from './fxEffect'
import { IN_CATEGORIES, OUT_CATEGORIES } from './dailyReportCategories'

const CAT_LABEL: Record<string, string> = Object.fromEntries(
  [...IN_CATEGORIES, ...OUT_CATEGORIES].map(c => [c.code, c.label]),
)

export interface FlowExportInput {
  company: string
  from: string
  to: string
  bridge: FlowBridge
  ledger: DailyLedgerRow[]
  fxEffect: FxEffectResult | null
  openingItems: InvestItem[]
  closingItems: InvestItem[]
  /** 거래 단위 행 (원장 탭) */
  rows: {
    date: string; category: string; group: string
    direction: 'in' | 'out'; amountKrw: number; currency: string
    memo?: string | null; reportStatus: string
  }[]
}

/** 숫자는 문자열로 굳히지 않는다 — 엑셀에서 합계·피벗을 돌릴 수 있어야 한다 */
function sheet(rows: (string | number | null)[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows)
}

export function exportFlowAnalysis(input: FlowExportInput): void {
  const { company, from, to, bridge, ledger, fxEffect, rows } = input
  const wb = XLSX.utils.book_new()

  // ── 요약 ────────────────────────────────────────────────
  const coveragePct = Math.round(bridge.coverage * 100)
  const summary: (string | number | null)[][] = [
    ['자금흐름 분석', null],
    ['법인', company],
    ['기간', `${bridge.from} ~ ${bridge.to}`],
    ['생성 시각', new Date().toLocaleString('ko-KR')],
    [null, null],
    ['⚠ 읽기 전 참고', null],
    ['', '· 과거 시점 분석은 제한적입니다. 연장·수정으로 덮어써진 건은 변경 이력으로 복원하며, 복원·추정이 섞일 수 있습니다.'],
    ['', '· 자금일보에 입출금 항목이 없는 날의 증감은 설명되지 않아 미설명으로 남습니다.'],
    ['', `· 이 기간 설명률 ${coveragePct}% / 미설명 ${Math.round(bridge.unexplained)}원`],
    [null, null],
    ['잔액', '기초', '기말', '증감'],
    ['가용',   Math.round(bridge.opening.operatingKrw + bridge.openingBreakdown.availKrw + bridge.openingBreakdown.bondAvailKrw),
              Math.round(bridge.closing.operatingKrw + bridge.closingBreakdown.availKrw + bridge.closingBreakdown.bondAvailKrw),
              null],
    ['불가용', Math.round(bridge.openingBreakdown.lockedKrw + bridge.openingBreakdown.bondLockedKrw),
              Math.round(bridge.closingBreakdown.lockedKrw + bridge.closingBreakdown.bondLockedKrw),
              null],
    ['합계',   Math.round(bridge.openingFull), Math.round(bridge.closingFull), Math.round(bridge.observed)],
    [null, null],
    ['증감 분해', '금액', '근거'],
    ['영업활동',       Math.round(bridge.groups.operating.net), '자금일보 항목'],
    ['재무활동',       Math.round(bridge.groups.financing.net), '자금일보 항목'],
    ['범위 밖 자산',   Math.round(bridge.groups.external.net),  '자금일보 항목'],
    ['운용으로 이동',  Math.round(bridge.groups.internal.net),  '자금일보 항목 (합계 불변)'],
    ['가용운용 개시·해지', Math.round(bridge.lanes.investExplained), '운용자금 레코드'],
    ['운용 조정',      Math.round(bridge.lanes.investAdjust),   '레코드로 설명되지 않는 잔여'],
    ['국채 평가',      Math.round(bridge.lanes.bondDelta),      '시가 변동 (현금 이동 없음)'],
    ['불가용 증감',    Math.round(bridge.lanes.lockedDelta),    '잔액 관측'],
    ['미설명',         Math.round(bridge.lanes.opUnexplained),  '일보에 항목이 없는 날의 운전자금 변동'],
  ]
  // 가용/불가용 증감은 위 두 행에서 계산해 채운다
  summary[11][3] = Number(summary[11][2]) - Number(summary[11][1])
  summary[12][3] = Number(summary[12][2]) - Number(summary[12][1])
  XLSX.utils.book_append_sheet(wb, sheet(summary), '요약')

  // ── 일자별 증감 ─────────────────────────────────────────
  const daily: (string | number | null)[][] = [[
    '일자', '총액', '총 증감', '운전자금', '운전 증감',
    '가용운용', '가용운용 증감', '국채', '국채 증감', '불가용', '불가용 증감',
    '개시 건수', '해지 건수', '일보 항목 수',
  ]]
  for (const r of [...ledger].reverse()) {
    daily.push([
      r.date, Math.round(r.allTotal), Math.round(r.allDelta),
      Math.round(r.opCash), Math.round(r.opDelta),
      Math.round(r.breakdown.availKrw), Math.round(r.investDelta),
      Math.round(r.breakdown.bondKrw), Math.round(r.bondDelta),
      Math.round(r.breakdown.lockedKrw), Math.round(r.lockedDelta),
      r.opened.length, r.closed.length, r.itemCount,
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheet(daily), '일자별 증감')

  // ── 순유출 분해 ─────────────────────────────────────────
  const cats: (string | number | null)[][] = [['항목', '성격', '입금', '출금', '순액', '건수']]
  for (const c of bridge.categories) {
    cats.push([
      CAT_LABEL[c.category] ?? c.category,
      FLOW_GROUP_LABEL[c.group],
      Math.round(c.inKrw), Math.round(c.outKrw), Math.round(c.net), c.count,
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheet(cats), '순유출 분해')

  // ── 환율효과 ────────────────────────────────────────────
  if (fxEffect) {
    const fx: (string | number | null)[][] = [
      ['외화 환산액 변동', Math.round(fxEffect.observedKrwDelta)],
      ['거래효과', Math.round(fxEffect.tradeEffect), '외화가 실제로 늘거나 줄어서'],
      ['환율효과', Math.round(fxEffect.fxEffect),    '가만히 있었는데 환율이 움직여서'],
      ['교차항',   Math.round(fxEffect.crossEffect), '기중 증감분에 붙은 환율 변동'],
      ['설명 안 됨', Math.round(fxEffect.residual),  '입력 당시 환율과 ECOS 매매기준율의 차이 · 이력 없는 통화'],
      [null, null],
      ['통화', '기초 잔액', '기말 잔액', '기초 환율', '기말 환율', '거래효과', '환율효과', '교차항', '합계'],
    ]
    for (const c of fxEffect.currencies) {
      fx.push([
        c.currency, c.openAmount, c.closeAmount, c.openRate, c.closeRate,
        c.tradeEffect === null ? null : Math.round(c.tradeEffect),
        c.fxEffect   === null ? null : Math.round(c.fxEffect),
        c.crossEffect=== null ? null : Math.round(c.crossEffect),
        c.totalEffect=== null ? null : Math.round(c.totalEffect),
      ])
    }
    XLSX.utils.book_append_sheet(wb, sheet(fx), '환율효과')
  }

  // ── 원장 ────────────────────────────────────────────────
  const ledgerRows: (string | number | null)[][] = [[
    '일자', '항목', '성격', '구분', '금액(원화)', '통화', '메모', '일보 상태',
  ]]
  for (const r of rows) {
    ledgerRows.push([
      r.date, CAT_LABEL[r.category] ?? r.category, r.group,
      r.direction === 'in' ? '입금' : '출금',
      Math.round(r.amountKrw), r.currency, r.memo ?? '', r.reportStatus,
    ])
  }
  XLSX.utils.book_append_sheet(wb, sheet(ledgerRows), '원장')

  // ── 잔액 구성 (기초·기말) ───────────────────────────────
  const comp: (string | number | null)[][] = [[
    '시점', '은행·상품', '통화', '원통화 금액', '원화환산', '가용여부', '비고',
  ]]
  const pushItems = (label: string, items: InvestItem[]) => {
    for (const i of items) {
      const notes = [i.restored && '이력복원', i.inferred && '만기추정'].filter(Boolean).join(' · ')
      comp.push([label, i.label, i.currency, i.amount, Math.round(i.amountKrw), i.available, notes])
    }
  }
  pushItems(`기초 ${bridge.from}`, input.openingItems)
  pushItems(`기말 ${bridge.to}`,   input.closingItems)
  XLSX.utils.book_append_sheet(wb, sheet(comp), '잔액 구성')

  XLSX.writeFile(wb, `자금흐름분석_${company}_${from}_${to}.xlsx`)
}
