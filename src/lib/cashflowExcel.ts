/**
 * cashflowExcel — 12주 롤링 포캐스트 엑셀 템플릿 다운로드 / 업로드 파싱
 *
 * 템플릿 컬럼: 법인 | 주차시작일 | 구분 | 카테고리 | 금액 | 메모
 * - 법인: 현재 선택된 법인명과 정확히 일치해야 함 (다른 법인 데이터 오반영 방지)
 * - 주차시작일: YYYY-MM-DD, 현재 12주 창의 월요일 중 하나여야 함
 * - 구분: "입금"/"출금" (또는 in/out)
 * - 카테고리: 자금일보와 동일한 한글 라벨 (예: "매출채권 회수")
 */
import * as XLSX from 'xlsx'
import type { CategoryDef } from './dailyReportCategories'
import type { CashflowItemInput } from '../hooks/useCashflowPlan'

const TEMPLATE_HEADERS = ['법인', '주차시작일', '구분', '카테고리', '금액', '메모']

export function downloadCashflowTemplate(company: string, weeks: string[]) {
  const sample = [
    [company, weeks[0], '입금', '매출채권 회수', 100000000, '예시 — 실제 데이터로 교체하세요'],
    [company, weeks[0], '출금', '미지급금 지급', 50000000, ''],
  ]
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...sample])
  ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 24 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '주간예측')
  XLSX.writeFile(wb, `주간예측_${company}_템플릿.xlsx`)
}

export interface ParsedCashflowResult {
  rows:   CashflowItemInput[]
  errors: string[]   // "3행: 카테고리를 찾을 수 없습니다 (오타?)" 등
}

function normalizeDirection(raw: string): 'in' | 'out' | null {
  const v = raw.trim().toLowerCase()
  if (v === '입금' || v === 'in') return 'in'
  if (v === '출금' || v === 'out') return 'out'
  return null
}

function toDateStr(raw: unknown): string | null {
  if (raw instanceof Date) return raw.toISOString().slice(0, 10)
  if (typeof raw === 'number') {
    // 엑셀 시리얼 날짜
    const d = XLSX.SSF.parse_date_code(raw)
    if (!d) return null
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(raw ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export async function parseCashflowExcel(
  file: File, company: string, weeks: string[], inCategories: CategoryDef[], outCategories: CategoryDef[],
): Promise<ParsedCashflowResult> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: true })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  const weekSet = new Set(weeks)
  const rows: CashflowItemInput[] = []
  const errors: string[] = []

  raw.forEach((r, i) => {
    const lineNo = i + 2 // 헤더 다음 줄부터
    const rowCompany = String(r['법인'] ?? '').trim()
    if (!rowCompany) return // 빈 줄은 조용히 skip
    if (rowCompany !== company) {
      errors.push(`${lineNo}행: 법인 불일치 (${rowCompany} ≠ ${company}) — 제외됨`)
      return
    }
    const week_start = toDateStr(r['주차시작일'])
    if (!week_start || !weekSet.has(week_start)) {
      errors.push(`${lineNo}행: 주차시작일이 유효하지 않습니다 (현재 12주 범위 내 월요일이어야 함) — 제외됨`)
      return
    }
    const direction = normalizeDirection(String(r['구분'] ?? ''))
    if (!direction) {
      errors.push(`${lineNo}행: 구분은 "입금" 또는 "출금"이어야 합니다 — 제외됨`)
      return
    }
    const catLabel = String(r['카테고리'] ?? '').trim()
    const catList = direction === 'in' ? inCategories : outCategories
    const cat = catList.find(c => c.label === catLabel)
    if (!cat) {
      errors.push(`${lineNo}행: 카테고리 "${catLabel}"를 찾을 수 없습니다 — 제외됨`)
      return
    }
    const amountRaw = r['금액']
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(String(amountRaw).replace(/,/g, ''))
    if (!amount || amount <= 0) {
      errors.push(`${lineNo}행: 금액이 올바르지 않습니다 — 제외됨`)
      return
    }
    rows.push({ week_start, direction, category: cat.code, amount, memo: String(r['메모'] ?? '').trim() })
  })

  return { rows, errors }
}
