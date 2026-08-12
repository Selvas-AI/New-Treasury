/**
 * DecisionTab — 환전 판단 (집행 단계)
 *
 * 세션22차 신규.
 *
 * 탭별 역할 분담:
 *   ① 현재 국면   — 무슨 일이 벌어지고 있나 (진단)
 *   ② 환전 판단   — 이번에 실제로 얼마를 팔 것인가 (집행)  ← 이 파일
 *   ③ 정책 프로토콜 — 우리 규칙은 무엇인가 (기준·거버넌스)
 *   ④ 시뮬레이션   — 그 규칙이 옳은가 (검증)
 *
 * ①③④ 는 이미 있었지만 ② 가 비어 있었다. 그래서 "그래서 지금 어떻게 하나"라는
 * 가장 중요한 질문에 화면이 답하지 못했다.
 *
 * ⭐ 이 탭이 깨야 할 착시:
 *   "평단 아래라 팔면 손실이 확정되니 안 판다."
 *   화폐성 외화항목은 매 결산기 마감환율로 평가되어 **팔지 않아도 손익에 반영**된다.
 *   따라서 팔든 안 팔든 손실은 이미 있다. 나란히 보여 주지 않으면 매도만 유독 나빠 보인다.
 */
import {
  pnlSnapshot, bepStats, lossBudget,
} from '../../lib/fxPnl'
import type { FxRegimeSignal, RegimeSeriesPoint } from '../../lib/fxRegime'
import InfoTip from '../common/InfoTip'
import { fmtKRW } from '../../lib/format'

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900'

export interface DecisionTabProps {
  signal:        FxRegimeSignal | null
  series:        RegimeSeriesPoint[]
  currency:      string
  holdingFx:     number
  availableFx:   number
  avgCostRate:   number
  quarterCapKRW: number
  usedLossKRW:   number
}

const num = (v: number) => Math.round(v).toLocaleString()
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmtKRW(Math.abs(v))}`
const toneCls = (v: number) =>
  v >= 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'

export default function DecisionTab({
  signal, series, currency, holdingFx, availableFx, avgCostRate, quarterCapKRW, usedLossKRW,
}: DecisionTabProps) {

  if (!signal) {
    return (
      <div className={CARD}>
        <div className="text-sm text-gray-600 dark:text-slate-300">
          판정 결과가 없어 환전 판단을 계산할 수 없습니다. 환율 이력과 자금 입력을 먼저 확인하세요.
        </div>
      </div>
    )
  }

  const rate = signal.indicators.close
  // 권고 매도 금액(원화) → 외화 수량
  const suggestedKRW = signal.decision.actionRequired && signal.decision.suggestedTradeKRW < 0
    ? -signal.decision.suggestedTradeKRW : 0
  const requestedFx = rate > 0 ? Math.min(suggestedKRW / rate, availableFx) : 0

  const pnl = pnlSnapshot(holdingFx, avgCostRate, rate, requestedFx)
  const bep = bepStats(series, avgCostRate, 750)
  const budget = lossBudget(quarterCapKRW, usedLossKRW, requestedFx, holdingFx, avgCostRate, rate)

  const noCost = !(avgCostRate > 0)
  const inLoss = pnl != null && pnl.unrealizedKRW < 0

  return (
    <div className="space-y-4">

      {/* 안내 — 이 탭의 전제 */}
      {availableFx < holdingFx && <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"><strong>보유 {currency} 중 {num(holdingFx-availableFx)}는 만기 전 정기예금 등 잠긴 재고입니다.</strong> 이번 환전 권고는 현재 집행 가능한 {num(availableFx)}까지만 계산했습니다.</div>}
      {noCost ? (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          <strong>평균 취득환율을 입력해 주세요.</strong> 상단 &lsquo;자금·정책 입력&rsquo;에 값을 넣으면
          이 탭의 손익 계산이 모두 활성화됩니다.
        </div>
      ) : inLoss && (
        <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900 dark:bg-blue-900/20 dark:text-blue-200">
          <strong>먼저 짚을 것 — 팔지 않아도 손실은 이미 반영되어 있습니다.</strong>
          <div className="mt-1">
            외화예금·외화현금은 화폐성 외화항목이라 <strong>매 결산기 마감환율로 평가</strong>되고
            그 차이가 당기손익에 들어갑니다. 즉 <strong>지금 팔면 외환차손, 안 팔면 외화환산손실</strong>로
            계정 이름만 달라질 뿐 손익계산서에는 이미 잡혀 있습니다.
            &ldquo;팔면 손실이 확정되니 안 판다&rdquo;는 판단은 손실을 미루는 것이 아니라,
            <strong>같은 손실을 유지하면서 앞으로의 환율 변동 위험까지 함께 떠안는</strong> 선택입니다.
          </div>
          <div className="mt-1 text-[11px] opacity-80">
            ※ 세무상 취급(평가방법 신고에 따른 익금·손금 산입)은 회계팀·감사인 확인이 필요합니다.
          </div>
        </div>
      )}

      {/* ① 손익 현황 */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
          ① 손익 현황 — 팔든 안 팔든
          <InfoTip text={[
            '왼쪽은 지금 보유한 외화 전체의 평가손익입니다. 팔지 않아도 결산 시 손익에 반영되는 금액입니다.',
            '가운데는 이번 권고대로 환전할 때 그중 실현되는 부분, 오른쪽은 환전 후에도 남는 평가손익입니다.',
            '세 값을 더하면 왼쪽과 같습니다 — 환전은 손실을 만들지 않고, 이미 있는 손실의 일부를 확정할 뿐입니다.',
          ]} />
        </div>

        {pnl == null ? (
          <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
            평균 취득환율과 보유액이 있어야 계산됩니다.
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] text-gray-500 dark:text-slate-400">현재 평가손익 (전체 보유)</div>
                <div className={`mt-1 text-xl font-bold ${toneCls(pnl.unrealizedKRW)}`}>
                  {signed(pnl.unrealizedKRW)}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  팔지 않아도 이미 인식됨
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] text-gray-500 dark:text-slate-400">이번 환전 시 실현</div>
                <div className={`mt-1 text-xl font-bold ${pnl.convertFx > 0 ? toneCls(pnl.realizingKRW) : 'text-gray-400'}`}>
                  {pnl.convertFx > 0 ? signed(pnl.realizingKRW) : '—'}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  {pnl.convertFx > 0 ? `${currency} ${num(pnl.convertFx)} 환전 기준` : '현재 환전 권고 없음'}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                <div className="text-[11px] text-gray-500 dark:text-slate-400">환전 후 남는 평가손익</div>
                <div className={`mt-1 text-xl font-bold ${toneCls(pnl.remainingKRW)}`}>
                  {signed(pnl.remainingKRW)}
                </div>
                <div className="text-[11px] text-gray-500 dark:text-slate-400">
                  계속 환율에 노출됨
                </div>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <tbody className="tabular-nums">
                  <tr className="border-b border-gray-100 dark:border-slate-800">
                    <td className="py-1.5 text-gray-500 dark:text-slate-400">평균 취득환율</td>
                    <td className="py-1.5 text-right font-semibold">{pnl.avgCostRate.toLocaleString()}원</td>
                    <td className="py-1.5 text-gray-500 dark:text-slate-400">보유</td>
                    <td className="py-1.5 text-right font-semibold">{currency} {num(pnl.holdingFx)}</td>
                  </tr>
                  <tr>
                    <td className="py-1.5 text-gray-500 dark:text-slate-400">현재 환율</td>
                    <td className="py-1.5 text-right font-semibold">{pnl.currentRate.toLocaleString()}원</td>
                    <td className="py-1.5 text-gray-500 dark:text-slate-400">차이</td>
                    <td className={`py-1.5 text-right font-semibold ${toneCls(pnl.currentRate - pnl.avgCostRate)}`}>
                      {pnl.currentRate >= pnl.avgCostRate ? '+' : '−'}
                      {Math.abs(pnl.currentRate - pnl.avgCostRate).toFixed(1)}원
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ② 손익분기 환율 */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
          ② 손익분기 환율 — 기다리면 회복될까?
          <InfoTip text={[
            '평균 취득환율까지 환율이 올라야 평가손실이 사라집니다. 그 지점이 손익분기 환율입니다.',
            '아래 숫자는 예측이 아니라 과거 관측 사실입니다. "언젠가 오르겠지"라는 기대를 실제 빈도로 바꿔 봅니다.',
            '회복 가능성이 낮다는 사실도 의사결정에 필요한 정보입니다.',
          ]} />
        </div>

        {bep == null ? (
          <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">평균 취득환율을 입력하면 표시됩니다.</div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="손익분기 환율" value={`${bep.bep.toLocaleString()}원`} />
              <Tile
                label="현재 대비 필요 변동"
                value={`${bep.needPct >= 0 ? '+' : ''}${(bep.needPct * 100).toFixed(1)}%`}
                tone={bep.needPct > 0 ? 'bad' : 'good'}
                sub={bep.needPct > 0 ? '이만큼 올라야 회복' : '이미 상회 중'}
              />
              <Tile
                label={`최근 3년 중 ${bep.bep.toLocaleString()}원 이상`}
                value={`${(bep.pctDaysAbove * 100).toFixed(0)}%`}
                sub={`${bep.sampleDays}영업일 중`}
                tone={bep.pctDaysAbove >= 0.3 ? 'good' : 'bad'}
              />
              <Tile
                label="마지막 도달"
                value={bep.lastAboveDate ?? '없음'}
                sub={bep.daysSinceAbove != null ? `${bep.daysSinceAbove}영업일 전` : '관측 구간 내 없음'}
              />
            </div>
            <div className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-slate-400">
              관측 구간 최고 {bep.maxRate.toLocaleString()}원 · 최저 {bep.minRate.toLocaleString()}원.
              {bep.pctDaysAbove < 0.15 && bep.needPct > 0 && (
                <span className="ml-1 font-semibold text-amber-700 dark:text-amber-400">
                  최근 3년 중 손익분기 이상이었던 날이 {(bep.pctDaysAbove * 100).toFixed(0)}% 에 불과합니다 —
                  회복을 전제로 보유를 지속하는 판단은 근거가 약합니다.
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* ③ 분할 실현 계획 */}
      <div className={CARD}>
        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
          ③ 분할 실현 계획 — 한 분기에 몰지 않기
          <InfoTip text={[
            '회사는 FIFO(선입선출)를 쓰므로 지금 팔면 가장 비싼 옛 물량부터 나갑니다. 손실이 앞쪽에 집중됩니다.',
            '분기 실현 한도를 정해 두면 시스템이 그 한도 안에서만 환전을 권고합니다.',
            '⚠ 손실을 줄이는 장치가 아니라 인식 시점을 분산하는 장치입니다. 총 손실 금액은 달라지지 않습니다.',
          ]} />
        </div>

        {quarterCapKRW <= 0 ? (
          <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
            분기 실현 한도가 설정되지 않았습니다. 상단 &lsquo;자금·정책 입력&rsquo;에서 한도를 넣으면
            권고 금액이 한도 안으로 조정됩니다.
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="분기 실현 한도" value={fmtKRW(budget.quarterCapKRW)} />
              <Tile label="이번 분기 사용" value={fmtKRW(budget.usedKRW)} />
              <Tile
                label="잔여 한도"
                value={fmtKRW(budget.remainingKRW)}
                tone={budget.remainingKRW <= 0 ? 'bad' : 'good'}
              />
              <Tile
                label="전량 처리 소요"
                value={budget.quartersToClear != null ? `${budget.quartersToClear}분기` : '—'}
                sub="현 한도 기준"
              />
            </div>

            {budget.exceedsCap ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <strong>⚠ 권고 금액이 이번 분기 한도를 초과합니다.</strong>
                <div className="mt-1">
                  권고 {currency} {num(budget.requestedFx)} 중 한도 내 집행 가능액은{' '}
                  <strong>{currency} {num(budget.allowedFx)}</strong> 입니다.
                  나머지는 다음 분기로 이월하거나, 회의체 승인으로 한도를 조정해야 합니다.
                </div>
              </div>
            ) : requestedFx > 0 && (
              <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
                권고 금액이 한도 안에 있습니다 — {currency} {num(budget.requestedFx)} 전량 집행 가능합니다.
              </div>
            )}
          </>
        )}
      </div>

      {/* 결론 */}
      <div className="rounded-lg border-l-4 border-gray-800 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:border-slate-300 dark:bg-slate-800 dark:text-slate-200">
        <strong>이 탭을 읽는 순서</strong>
        <div className="mt-1">
          ① 팔든 안 팔든 손실이 같다는 것을 확인하고 → ② 기다려서 회복될 가능성이 실제로 얼마인지 보고 →
          ③ 실현할 금액을 분기 한도에 맞춰 나눕니다.
          최종 실행은 <strong>기존 외화 매각 지시 워크플로우(발의 → 승인 → 완료)</strong>를 거칩니다.
        </div>
      </div>
    </div>
  )
}

// ── 모듈 레벨 헬퍼 (렌더 중 컴포넌트 정의 금지) ──
function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'bad'
}) {
  const cls = tone === 'good' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'bad' ? 'text-red-600 dark:text-red-400'
    : 'text-gray-900 dark:text-slate-100'
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[11px] text-gray-500 dark:text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}
