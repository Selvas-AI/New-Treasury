/**
 * issueLink — 이슈 key ↔ 원천 레코드 링크 표준화 (D4)
 *
 * 이슈 issue_key 규칙:
 *   input_daily          → 운전자금 입력
 *   loan_{uuid}          → 차입금 상세
 *   equity_{종목명}      → 지분/장기투자 상세
 *   policy_{id}          → 자금정책
 *
 * IssueDrawer(대시보드 팝업)·IssueHistoryPage 등 여러 곳에서 동일 매핑을 쓰도록
 * 단일 함수로 통일한다(기존엔 IssueDrawer 에만 buildLinkUrl 이 있어 history 페이지는
 * 원천 바로가기가 없었음).
 */

/** 이슈 key → 원천 레코드 딥링크 URL (없으면 null) */
export function issueSourceUrl(key: string, company: string | null | undefined): string | null {
  const c = company ?? ''
  if (key === 'input_daily')      return `/input/${c}`
  if (key.startsWith('loan_'))    return `/loans/${c}/${key.replace('loan_', '')}`
  if (key.startsWith('equity_'))  return `/equity/${c}/${encodeURIComponent(key.replace('equity_', ''))}`
  if (key.startsWith('policy_'))  return `/policy/${c}`
  return null
}

/** 원천 바로가기 링크 라벨 */
export function issueSourceLabel(key: string): string {
  if (key === 'input_daily')     return '운전자금 보기'
  if (key.startsWith('loan_'))   return '차입금 보기'
  if (key.startsWith('equity_')) return '종목 보기'
  if (key.startsWith('policy_')) return '자금정책 보기'
  return '바로가기'
}
