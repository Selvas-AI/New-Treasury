/**
 * 금융기관명 정규화 유틸 — BankLimitsTab, usePolicyDashboard 등 공유
 */
export const BANK_TYPES = ['은행', '증권사', '보험', '기타'] as const

/**
 * 금융기관명 정규화 — 동일 은행의 계좌별 등록명을 하나로 합산
 * "국민은행(231)-2" → "국민은행"
 * "기업은행(007)"   → "기업은행"
 */
export function normBank(bank: string): string {
  const idx = bank.indexOf('은행')
  if (idx >= 0) return bank.slice(0, idx + 2).trim()
  return bank.replace(/\s*\([^)]*\)\s*$/, '').trim()
}
