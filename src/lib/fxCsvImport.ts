import type { FxAccountType } from './fxLots'

export interface InventoryCsvRow {
  date: string; currency: string; accountType: FxAccountType; amount: number; bookRate: number
  annualInterestRate: number; maturityDate: string | null
}
export interface SalesCsvRow {
  date: string; currency: string; amount: number; acquisitionRate: number; saleRate: number
  realizedPnlKRW: number
}
export interface CsvValidation<T> { rows: T[]; errors: string[]; skipped: number }

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false
  const src = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' && quoted && src[i + 1] === '"') { cell += '"'; i++; continue }
    if (ch === '"') { quoted = !quoted; continue }
    if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; continue }
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      if (row.some(Boolean)) rows.push(row)
      row = []; continue
    }
    cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row) }
  return rows
}

/**
 * 헤더를 키로 하는 객체 배열 + **원본 파일의 행 번호**.
 *
 * ⚠ 행 번호를 함께 돌려주는 이유: '#' 주석 줄을 건너뛰면 배열 인덱스와 실제 줄 번호가
 *   어긋나 오류 메시지가 엉뚱한 줄을 가리킨다.
 */
function objects(text: string): { raw: Record<string, string>; line: number }[] {
  const [headers, ...rows] = parseCsv(text)
  if (!headers) return []
  return rows
    .map((row, i) => ({ row, line: i + 2 }))   // 1행은 헤더
    // '#' 로 시작하는 줄은 안내 주석 — 표준 양식에 계좌유형 설명을 넣어도
    // 그 파일을 그대로 다시 올릴 수 있어야 한다.
    .filter(({ row }) => !(row[0] ?? '').startsWith('#'))
    .map(({ row, line }) => ({
      raw: Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])),
      line,
    }))
}
const dateOk = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)
const currencyOk = (v: string) => ['USD', 'EUR', 'JPY', 'GBP', 'CNY'].includes(v)
// ⚠ 실제 개시재고 CSV 에는 mmda(수시입출식 고금리 예금) 가 6건 있다.
//   과거 파서는 이를 거부해 같은 CSV 를 다시 올릴 수 없었다.
//   mmda 는 환전 가능성은 보통예금과 같고 이자율만 붙으며 만기가 없다.
const accountTypeOk = (v: string) => ['demand_deposit', 'term_deposit', 'mmda'].includes(v)

export function parseInventoryCsv(text: string): CsvValidation<InventoryCsvRow> {
  const rows: InventoryCsvRow[] = []; const errors: string[] = []; let skipped = 0
  objects(text).forEach(({ raw, line }) => {
    const amount = Number(raw.amount); const bookRate = Number(raw.bookRate)
    if (amount === 0) { skipped++; return }
    const accountType = raw.accountType || 'demand_deposit'
    const interestRate = Number(raw.annualInterestRate || 0)
    const maturityDate = raw.maturityDate || null
    if (!dateOk(raw.date) || !currencyOk(raw.currency) || !accountTypeOk(accountType) || !(amount > 0) || !(bookRate > 0)) {
      errors.push(`${line}행: 날짜·통화·금액·장부환율을 확인하세요. (계좌유형은 demand_deposit·mmda·term_deposit)`); return
    }
    if (interestRate < 0 || (accountType === 'term_deposit' && (!maturityDate || !dateOk(maturityDate) || maturityDate < raw.date))) {
      errors.push(`${line}행: 정기예금은 취득일 이후의 만기일과 0 이상의 연이율이 필요합니다.`); return
    }
    rows.push({ date: raw.date, currency: raw.currency, accountType: accountType as InventoryCsvRow['accountType'],
      amount, bookRate, annualInterestRate: interestRate,
      maturityDate: accountType === 'term_deposit' ? maturityDate : null })
  })
  return { rows, errors, skipped }
}

export function parseSalesCsv(text: string): CsvValidation<SalesCsvRow> {
  const rows: SalesCsvRow[] = []; const errors: string[] = []
  objects(text).forEach(({ raw, line }) => {
    const amount = Number(raw.amount)
    const acquisitionRate = Number(raw.acquisitionRate); const saleRate = Number(raw.saleRate)
    if (!dateOk(raw.date) || !currencyOk(raw.currency) || !(amount > 0) || !(acquisitionRate > 0) || !(saleRate > 0)) {
      errors.push(`${line}행: 날짜·통화·금액·취득환율·매각환율을 확인하세요.`); return
    }
    rows.push({ date: raw.date, currency: raw.currency, amount, acquisitionRate, saleRate,
      realizedPnlKRW: amount * (saleRate - acquisitionRate) })
  })
  return { rows, errors, skipped: 0 }
}

export const inventoryKey = (r: InventoryCsvRow) =>
  [r.date, r.currency, r.accountType, r.amount, r.bookRate, r.annualInterestRate, r.maturityDate ?? ''].join('|')

/**
 * 이미 등록된 로트를 CSV 행과 대조하기 위한 키.
 *
 * ⚠ `inventoryKey`(7필드)와 다르다. 로트 memo 에 저장된 `import-key:` 는
 *   **5필드**(date|currency|accountType|amount|bookRate)이므로 여기에 맞춘다.
 *   이자율·만기는 교정 대상이라 키에 넣으면 매칭이 깨진다.
 */
export const inventoryMatchKey = (
  r: Pick<InventoryCsvRow, 'date'|'currency'|'accountType'|'amount'|'bookRate'>,
) => [r.date, r.currency, r.accountType, r.amount, r.bookRate].join('|')

export const INVENTORY_CSV_TEMPLATE = [
  'date,currency,accountType,amount,bookRate,annualInterestRate,maturityDate',
  '# accountType: demand_deposit(보통예금) | mmda(수시입출·이자율有) | term_deposit(정기예금·만기必)',
  '2026-08-12,USD,demand_deposit,100000,1412.9,0,',
  '2026-08-12,USD,mmda,500000,1450.0,3.0,',
  '2026-08-12,USD,term_deposit,1000000,1472.8,3.57,2026-09-11',
].join('\r\n')

export const SALES_CSV_TEMPLATE = [
  'date,currency,amount,acquisitionRate,saleRate',
  '2026-08-12,USD,100000,1450.0,1500.0',
].join('\r\n')
export const saleKey = (r: Pick<SalesCsvRow, 'date'|'currency'|'amount'|'acquisitionRate'|'saleRate'>) =>
  [r.date, r.currency, r.amount, r.acquisitionRate, r.saleRate].join('|')
