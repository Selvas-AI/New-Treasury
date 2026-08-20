/**
 * FxRegimeStandardTab — 정책 기준(의결값) 편집 화면
 *
 * 세션26차 신규. 근거: docs/기획/FX리짐_정책이관_계획.md §4 (정책 화면 ①탭)
 *
 * 실무 화면(/fx-regime)에 있던 `③ 정책 프로토콜` 탭을 그대로 이관했다.
 * 여기가 앵커·수준 임계·5×3 목표표·국면 판정 파라미터의 **유일한 편집 지점**이다.
 *
 * ⚠ 이 컴포넌트는 활성 서브탭일 때만 마운트한다 —
 *   useFxRegime 이 환율 이력·FIFO 로트·법인 실데이터를 모두 조회하므로,
 *   보이지도 않는 탭에서 미리 돌리면 불필요한 네트워크 비용이 든다.
 */
import FxRegimeOpsCard from './FxRegimeOpsCard'
import FxFifoPriorityCard from './FxFifoPriorityCard'
import ProtocolTab from '../fxRegime/ProtocolTab'
import { useFxRegime } from '../../hooks/useFxRegime'
import { useCashflowPlan, get12Weeks } from '../../hooks/useCashflowPlan'
import { deriveRegimeOpsFromPlan } from '../../lib/cashflowFxDerive'
import { REGIME_CURRENCIES } from '../../lib/fxRegimeInputs'
import type { Company } from '../../types'

export default function FxRegimeStandardTab({
  company, currency, canEdit, userCode, incomingBand, onConsumeBand,
}: {
  company: Company
  currency: string
  canEdit: boolean
  userCode: string
  /** 한도 계산기(③탭)에서 넘어온 권고 밴드(%). 저장 전 초안이다. */
  incomingBand?: { min: number; max: number } | null
  onConsumeBand?: () => void
}) {
  // autoSync=false — 이력 보충은 실무 화면 담당. 정책 화면까지 켜면 ECOS 호출이 중복된다.
  const { params, protocol, series, ctx, signal, inputs, hist } =
    useFxRegime(company, currency, 'live', false)
  // 주간예측(12주 롤링)에서 운영 가정을 산출하기 위한 계획 항목
  const plan = useCashflowPlan(company)

  return (
    <div className="space-y-5">
      <FxRegimeOpsCard
        company={company}
        params={params}
        canEdit={canEdit}
        userLabel={userCode}
        incomingBand={incomingBand}
        onConsumeBand={onConsumeBand}
        // ⚠ 기준 주는 반드시 get12Weeks()[0] 을 쓴다 — 주간예측 화면이 week_start 를
        //   만드는 것과 **같은 함수**여야 문자열이 정확히 일치한다.
        //   (getMonday 는 로컬 자정 Date 라 toISOString 이 KST 기준 전날을 내놓는데,
        //    저장·조회가 같은 규칙이라 자체적으로는 일관된다. 여기서만 다르게 계산하면 어긋난다.)
        onDeriveFromPlan={() => deriveRegimeOpsFromPlan(
          plan.items, get12Weeks()[0], REGIME_CURRENCIES,
        )}
      />

      <FxFifoPriorityCard company={company} params={params} canEdit={canEdit} userLabel={userCode} />

      {hist.loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
          환율 이력 불러오는 중…
        </div>
      ) : (
        <ProtocolTab
          protocol={protocol}
          series={series}
          context={ctx}
          currency={currency}
          currentSignal={signal}
          policyMinRatio={inputs.policyMinRatio}
          policyMaxRatio={inputs.policyMaxRatio}
          canEdit={canEdit}
          userCode={userCode}
          onSave={(key, value) => params.set(key, value, null, userCode)}
          onSaved={() => void params.refetch()}
        />
      )}
    </div>
  )
}
