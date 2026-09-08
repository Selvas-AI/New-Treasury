/**
 * 결재 요청 메일 트리거 (2026-09-08)
 *
 * 자금일보를 상신하거나 한 단계를 승인하면 **다음 차례 결재자**에게 즉시 메일이 가야 한다.
 * 발송은 GAS(MailApp)가 한다 — 운전자금 미입력 알림에서 이미 쓰는 검증된 경로다.
 *
 * ⚠ 여기서 보내는 것은 reportId 뿐이다. 수신자·내용은 전부 서버(GAS+DB)가 정한다
 *   — 브라우저가 보낸 값으로 메일을 만들면 임의 수신자에게 발송이 가능해진다.
 *
 * ⚠ 실패해도 화면 흐름을 막지 않는다(fire-and-forget). 호출이 유실돼도
 *   GAS 의 sweepApprovalNotifications() 주기 트리거가 뒤늦게 발송한다.
 *   중복은 DB 의 unique(report_id, step) 가 막는다.
 */
const GAS_URL = import.meta.env.VITE_GAS_API_URL as string | undefined

export function notifyApprovalTurn(reportId: string | null | undefined): void {
  if (!GAS_URL || !reportId) return
  const url = `${GAS_URL}?type=approvalnotify&reportId=${encodeURIComponent(reportId)}`
  // keepalive — 승인 직후 화면을 옮겨도 요청이 끊기지 않게
  void fetch(url, { method: 'GET', keepalive: true })
    .catch(err => { console.warn('[approvalNotify] 결재 알림 요청 실패(스윕이 보완):', err) })
}
