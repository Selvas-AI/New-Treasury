import { useMemo } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { usePolicyDashboard } from '../../hooks/usePolicyDashboard'
import { usePolicyParams } from '../../hooks/usePolicyParams'
import { useFx } from '../../hooks/useFx'
import { useFxTradeHistory } from '../../hooks/useFxTradeHistory'
import { computeFxBandExceed, buildThresholdOrderPayload } from '../../lib/fxBandExceed'
import FxBandExceedCard from './FxBandExceedCard'
import type { Company, FxCode } from '../../types'

/**
 * 정책 밴드 초과 카드 — 데이터 자급자족 컨테이너(외화거래명세 전용).
 *
 * ⚠ 조건부로 마운트할 것. usePolicyDashboard 는 법인 실데이터 전체를 조회하므로
 *   보이지도 않는 탭에서 미리 돌리면 낭비다(FxPolicyTab 의 리짐 서브탭과 같은 규칙).
 *
 * FX 리짐 전략 화면은 이 컨테이너를 쓰지 않는다 — 이미 useFxRegime 이 같은
 * policyData/params 를 들고 있어 중복 조회가 되기 때문. 거기서는 FxBandExceedCard 를
 * 직접 쓰고 데이터를 주입한다.
 */
export default function FxBandExceedPanel({ company, onProposed }: {
  company: Company
  onProposed: () => void
}) {
  const { user, canAction, canEdit } = useAuth()
  const policyData = usePolicyDashboard(company)
  const params = usePolicyParams(company)
  const fx = useFx()
  const trades = useFxTradeHistory()

  const data = useMemo(() => computeFxBandExceed(policyData, params), [policyData, params])
  const marketRates = useMemo(() => Object.fromEntries(
    fx.rates.map(r => [r.code, r.rate])) as Partial<Record<FxCode, number>>, [fx.rates])

  if (policyData.loading || params.loading) {
    return <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-400 dark:border-slate-700 dark:bg-slate-900">정책 밴드 대비 보유 현황 확인 중…</div>
  }

  return (
    <FxBandExceedCard
      data={data}
      marketRates={marketRates}
      canPropose={canEdit() && canAction('fx_trade', 'write')}
      onPropose={async ({ currency, amountFx, rate, excessKRW }) => {
        const { error } = await trades.propose(buildThresholdOrderPayload({
          company, currency, amountFx, rate,
          acqRate: null, excessKRW,
          createdBy: user?.label ?? user?.code ?? 'unknown',
          origin: '외화거래명세',
        }))
        if (error) return error.message ?? String(error)
        onProposed()
        return null
      }}
    />
  )
}
