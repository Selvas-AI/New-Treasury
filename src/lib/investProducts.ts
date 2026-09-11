/**
 * 운용자금 상품유형 SSOT (2026-09-11)
 *
 * ⚠ 차입 유형과 같은 이유로 목록이 갈라져 있었다:
 *     운용자금 입력      — 정기예금·중금채·RP·MMF·발행어음·CMA·채권·기타
 *     자금일보 연동 팝업 — 정기예금·중금채·MMF·RP·CP·전자단기사채·기타
 *   → 두 목록의 합집합으로 통합한다. 기존에 저장된 값은 그대로 유지된다.
 *
 * ⚠ '국채'는 여기 넣지 않는다 — 지분/장기투자 메뉴에서 bond_* 필드와 함께
 *   별도로 다루며, 자금현황·FIFO 판정도 product === '국채' 로 분기한다.
 */
export const INVEST_PRODUCTS = [
  '정기예금', '중금채', 'RP', 'MMF', '발행어음', 'CMA',
  'CP', '전자단기사채', '채권', '기타',
] as const

export type InvestProduct = typeof INVEST_PRODUCTS[number]

export const DEFAULT_INVEST_PRODUCT: InvestProduct = '정기예금'
