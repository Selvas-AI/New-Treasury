/**
 * 차입 유형 SSOT (2026-09-11)
 *
 * ⚠ 같은 DB 컬럼(loans.type)을 쓰는 화면이 목록을 각자 들고 있어 실제로 어긋났다:
 *     차입금 입력    — 일반대출 · 한도대출 · CP · 전자단기사채 · 팩토링 · 기타
 *     자금일보 연동  — 단기 · 장기 · 운전 · 시설 · 기타
 *   겹치는 값이 '기타' 하나뿐이라, 자금일보로 등록하면 차입금 화면 드롭다운에
 *   없는 값이 저장돼 있게 됐다(2026-09-11 사용자 리포트).
 *
 * 메뉴 목록이 두 곳에 따로 있어 어긋났던 사고(navTree 통합)와 같은 유형이다.
 * 목록을 바꿀 일이 생기면 **이 파일만** 고친다.
 */
export const LOAN_TYPES = ['일반대출', '한도대출', 'CP', '전자단기사채', '팩토링', '기타'] as const

export type LoanType = typeof LOAN_TYPES[number]

export const DEFAULT_LOAN_TYPE: LoanType = '일반대출'
