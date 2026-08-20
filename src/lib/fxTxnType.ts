/**
 * 외화 원장 거래 유형 (세션26차 12일차, Phase 3)
 *
 * ⚠ 과거엔 `source_type`(어느 화면에서 만들었나) 하나가 거래 성격까지 겸했다.
 *   그래서 **매입대금 결제(대외 지급)가 매각과 똑같이 기록**되어 환차손익 요약의
 *   "매각 실적"이 부풀려졌다. 두 축을 분리한다.
 *
 * 실현손익 해석:
 *   sale     — 원화로 환전. **매각 실적의 정본**
 *   payment  — 대외 외화 지급(매입대금·수수료). 환차손익은 나지만 매각 실적이 아니다
 *   transfer — 내부 대체. 원가승계면 0, 재평가면 발생하지만 매각도 지급도 아니다
 */
export type FxOutflowTxnType = 'sale' | 'payment' | 'transfer' | 'adjustment'
export type FxInflowTxnType = 'opening' | 'acquisition' | 'interest' | 'transfer' | 'adjustment'

export const OUTFLOW_TXN_LABEL: Record<FxOutflowTxnType, string> = {
  sale:       '매각(환전)',
  payment:    '대외 지급',
  transfer:   '계좌 대체',
  adjustment: '조정',
}

export const INFLOW_TXN_LABEL: Record<FxInflowTxnType, string> = {
  opening:     '개시 재고',
  acquisition: '외화 수취',
  interest:    '이자 수취',
  transfer:    '계좌 대체',
  adjustment:  '조정',
}

/** 사용자가 유출 등록 시 고를 수 있는 유형 (transfer 는 전용 화면에서만 생성된다) */
export const SELECTABLE_OUTFLOW_TXN: FxOutflowTxnType[] = ['sale', 'payment']

/** null(마이그레이션 이전 데이터)이면 대외 지급으로 본다 — backfill 규칙과 동일 */
export function outflowTxnLabel(t: string | null | undefined): string {
  return OUTFLOW_TXN_LABEL[(t ?? 'payment') as FxOutflowTxnType] ?? '기타'
}

export function inflowTxnLabel(t: string | null | undefined): string {
  return INFLOW_TXN_LABEL[(t ?? 'acquisition') as FxInflowTxnType] ?? '기타'
}

/** 환차손익 요약 — 유형별로 나눠 집계한다. 매각과 지급을 합치면 매각 실적이 부풀려진다. */
export function summarizeRealizedPnl(
  rows: { txn_type?: string | null; realized_pnl: number }[],
): { sale: number; payment: number; transfer: number; total: number } {
  const out = { sale: 0, payment: 0, transfer: 0, total: 0 }
  for (const r of rows) {
    const t = (r.txn_type ?? 'payment') as FxOutflowTxnType
    if (t === 'sale') out.sale += r.realized_pnl
    else if (t === 'transfer') out.transfer += r.realized_pnl
    else out.payment += r.realized_pnl
    out.total += r.realized_pnl
  }
  return out
}
