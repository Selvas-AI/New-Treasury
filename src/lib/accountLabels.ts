/** 계좌구분 레이블 — ItemsSection, ReportSummaryTable 등 공유 */
export const ACCOUNT_LABELS: Record<string, string> = {
  krw_demand: '보통예금/CMA',
  krw_govt:   '국책자금',
  krw_mmda:   '증권예수금/MMDA',
  fx_usd:     'USD',
  fx_eur:     'EUR',
  fx_jpy:     'JPY',
  fx_gbp:     'GBP',
  fx_cny:     'CNY',
}

/**
 * 통화로 계좌구분을 추론한다 (2026-09-11).
 *
 * ⭐ 왜 필요한가 — 연동 팝업(차입금 실행·투자 집행 등)으로 항목을 만들면
 *   `account_type` 이 비어 있어 **현금이 어느 계좌에서 움직였는지 표시되지 않았다.**
 *   그래서 자금현황에서 `기초 + 입금 − 출금 = 마감` 이 그 행에서 성립하지 않는 것처럼
 *   보였다(2026-09-11 리포트 — JPY 차입 13,920,000 이 JPY 행 입금에 안 잡힘).
 *
 *   검증식은 이미 그 항목을 현금 유입으로 세고 있었다(카테고리를 가리지 않는다).
 *   즉 시스템의 의도는 "차입금 실행 = 현금 유입"이 맞고 **표시만 빠져 있었다.**
 *
 * ⚠ 원화는 보통예금/CMA 로 본다. 국책자금·증권예수금으로 직접 들어오는 차입·투자는
 *   드물다. 다르면 항목 행에서 계좌구분을 직접 바꾸면 그 값이 우선한다.
 */
export function defaultAccountTypeFor(currency: string | null | undefined): string {
  const cur = (currency || 'KRW').trim().toUpperCase()
  if (cur === 'KRW' || cur === '') return 'krw_demand'
  const key = `fx_${cur.toLowerCase()}`
  return key in ACCOUNT_LABELS ? key : 'krw_demand'
}
