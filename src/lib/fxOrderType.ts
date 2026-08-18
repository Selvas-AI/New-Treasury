/**
 * fxOrderType — 외화 매각 지시의 발생 경로
 *
 * 세션26차 Phase 4. 근거: docs/기획/FX리짐_정책이관_계획.md §6
 *
 * 같은 "매각 지시"라도 왜 생겼는지가 다르면 사후 검토도 달라진다.
 *   threshold     — 손실허용 한도 모델의 통화별 상한을 넘어서 생긴 지시
 *   discretionary — 정책회의가 재량으로 낸 지시
 *   regime        — 리짐 판정이 낸 권고를 실무가 지시로 등록한 것 (신규)
 *
 * ⚠ 라벨을 화면마다 따로 쓰면 한쪽만 갱신되어 'regime' 이 "한도초과 매각"으로
 *   잘못 표시된다(실제로 대시보드·자금일보가 삼항 연산자로 두 종류만 구분하고 있었다).
 *   반드시 이 맵을 쓸 것.
 */
export type FxOrderType = 'threshold' | 'discretionary' | 'regime'

export const ORDER_TYPE_LABEL: Record<FxOrderType, string> = {
  threshold:     '한도초과 매각',
  discretionary: '재량 매각',
  regime:        '리짐 권고 매각',
}

/** null(레거시 데이터 포함)이면 한도초과 매각으로 본다 — 기존 표시와 동일 */
export function orderTypeLabel(t: string | null | undefined): string {
  return ORDER_TYPE_LABEL[(t ?? 'threshold') as FxOrderType] ?? '매각'
}
