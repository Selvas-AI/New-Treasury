/**
 * fxRegime.ts 엔진 검증 스크립트
 *
 * 실행:  npx tsx scripts/testFxRegime.ts
 *
 * 이 프로젝트에는 테스트 러너가 없어 단독 실행 스크립트로 둔다.
 * 국면 엔진은 순수 수학이라 UI 없이 검증 가능하며, 실제로 이 스크립트가
 * "평탄한 시계열이 미세 드리프트만으로 강한 추세로 오분류되는" 버그를 잡아냈다
 * (→ RegimeThresholds.minTrendMovePct 도입). 엔진 수정 시 반드시 다시 돌릴 것.
 */
import {
  sma, stdev, bollinger, ema, macd, efficiencyRatio, annualizedVol,
  kalmanSmooth, classifyRegime, computeIndicators, confirmRegime,
  applyConstraints, evaluateRegime, regimeLabel,
  type RegimeCode, type RegimeSeriesPoint,
} from '../src/lib/fxRegime'

let pass = 0, fail = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}
function near(a: number | null, b: number, tol = 1e-6) {
  return a != null && Math.abs(a - b) < tol
}

console.log('\n── 1. 기초 통계 ──')
ok('sma([1..5],5)=3', near(sma([1, 2, 3, 4, 5], 5), 3))
ok('sma 데이터부족 → null', sma([1, 2], 5) === null)
ok('stdev([2,4,4,4,5,5,7,9],8)≈2.138', near(stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)!, 2.13809, 1e-4))

const flat = Array(30).fill(100)
const bb = bollinger(flat, 20, 2)
ok('볼린저 평탄 → 상하단=중앙', bb != null && bb.upper === 100 && bb.lower === 100)
ok('볼린저 평탄 → pctB=0.5 (0나눗셈 방어)', bb?.pctB === 0.5)

// EMA 초기값이 SMA인지 (첫값 사용 시 초반 왜곡)
ok('ema 평탄 시퀀스 → 동일값', near(ema(flat, 20), 100))

console.log('\n── 2. Efficiency Ratio (ADX 대체) ──')
const straight = Array.from({ length: 21 }, (_, i) => 100 + i)      // 완전 직선 상승
const zigzag: number[] = []
for (let i = 0; i < 21; i++) zigzag.push(100 + (i % 2))             // 완전 왕복
ok('직선 추세 ER=100', near(efficiencyRatio(straight, 20)!, 100, 1e-6),
   `got ${efficiencyRatio(straight, 20)}`)
ok('왕복 ER≈0', efficiencyRatio(zigzag, 20)! < 10, `got ${efficiencyRatio(zigzag, 20)}`)

console.log('\n── 3. 칼만 필터 ──')
const noisy = [100, 110, 90, 105, 95, 100, 100, 100, 100, 100]
const sm = kalmanSmooth(noisy, 0.5, 10)
const rawRange = Math.max(...noisy) - Math.min(...noisy)
const smRange = Math.max(...sm) - Math.min(...sm)
ok('평활 후 변동폭 축소', smRange < rawRange, `raw=${rawRange} smooth=${smRange.toFixed(2)}`)
ok('평활 길이 = 원본 길이', sm.length === noisy.length)
const trendUp = Array.from({ length: 100 }, (_, i) => 1000 + i * 5)
const smT = kalmanSmooth(trendUp, 0.5, 10)
ok('추세는 따라감 (마지막 오차 <2%)',
   Math.abs(smT[smT.length - 1] - 1495) / 1495 < 0.02,
   `got ${smT[smT.length - 1].toFixed(1)} vs 1495`)

console.log('\n── 4. 국면 분류 ──')
function mkSeries(gen: (i: number) => number, n = 320): RegimeSeriesPoint[] {
  const out: RegimeSeriesPoint[] = []
  const d = new Date('2024-01-01')
  for (let i = 0; i < n; i++) {
    d.setDate(d.getDate() + 1)
    out.push({ date: d.toISOString().slice(0, 10), rate: gen(i) })
  }
  return out
}
// 추세 시계열은 "노이즈와 구분되는" 강도여야 한다.
// 원/달러 20영업일 랜덤워크 σ ≈ 2% 이므로, 1.2원/일(20일 1.4%)은 추세가 아니라 노이즈 범위다.
// 2.5원/일 ≈ 20일 3.5% — 실제 추세장에서 흔한 속도.
const rise  = mkSeries(i => 1300 + i * 2.5)
const fallS = mkSeries(i => 2100 - i * 2.5)
const side  = mkSeries(i => 1400 + Math.sin(i / 2) * 8)

const iRise = computeIndicators(rise.map(p => p.rate))!
const iFall = computeIndicators(fallS.map(p => p.rate))!
const iSide = computeIndicators(side.map(p => p.rate))!
const cRise = classifyRegime(iRise)
const cFall = classifyRegime(iFall)
const cSide = classifyRegime(iSide)
console.log(`     상승=${cRise} (${regimeLabel(cRise)})  하락=${cFall}  횡보=${cSide}`)
for (const [nm, ii] of [['상승', iRise], ['하락', iFall], ['사인파', iSide]] as const) {
  console.log(`       ${nm}: ER=${ii.trendER?.toFixed(1)} netMove=${((ii.netMovePct ?? 0) * 100).toFixed(2)}% ` +
              `volZ=${ii.volZ?.toFixed(2)} annVol=${((ii.annualVol ?? 0) * 100).toFixed(2)}%`)
}
ok('꾸준한 상승 → 국면 ①', cRise.startsWith('1'), `got ${cRise}`)
ok('꾸준한 하락 → 국면 ⑤', cFall.startsWith('5'), `got ${cFall}`)
ok('사인파 → 국면 ③(횡보)', cSide.startsWith('3'), `got ${cSide}`)

console.log('\n── 5. 히스테리시스 ──')
const seq: RegimeCode[] = ['3-B', '3-B', '3-B', '1-B']
ok('1일만 바뀌면 미확정 → 이전 국면 유지',
   confirmRegime(seq, 2).code === '3-B', `got ${confirmRegime(seq, 2).code}`)
ok('2일 연속이면 확정',
   confirmRegime([...seq, '1-B'], 2).code === '1-B')
ok('confirmedDays 카운트', confirmRegime([...seq, '1-B'], 2).confirmedDays === 2)

console.log('\n── 6. 제약 클램프 ──')
const base = { totalFundKRW: 1000, fxHoldingKRW: 400, fxPayableKRW: 0,
               policyMaxRatio: null, policyMinRatio: null }
ok('제약 없으면 원안 그대로',
   applyConstraints(0.5, base).appliedTarget === 0.5 &&
   applyConstraints(0.5, base).clampedBy === 'none')
ok('정책 상한 초과 → 밴드로 클램프',
   applyConstraints(0.5, { ...base, policyMaxRatio: 0.3 }).appliedTarget === 0.3 &&
   applyConstraints(0.5, { ...base, policyMaxRatio: 0.3 }).clampedBy === 'policy_band')
const bufRes = applyConstraints(0.1, { ...base, fxPayableKRW: 250, policyMaxRatio: 0.3 })
ok('결제 버퍼가 최종 하한 (정책보다 우선)',
   near(bufRes.appliedTarget, 0.25) && bufRes.clampedBy === 'buffer',
   `got ${bufRes.appliedTarget} / ${bufRes.clampedBy}`)
ok('버퍼가 상한보다 커도 버퍼 우선',
   applyConstraints(0.1, { ...base, fxPayableKRW: 400, policyMaxRatio: 0.3 }).appliedTarget === 0.4)

console.log('\n── 7. 종합 시그널 ──')
const sig = evaluateRegime(fallS, {
  totalFundKRW: 100_000_000_000,
  fxHoldingKRW:  45_000_000_000,   // 45%
  fxPayableKRW:   5_000_000_000,   // 버퍼 5%
  policyMaxRatio: 0.35,
  policyMinRatio: 0.05,
})!
console.log(`     국면=${sig.regime.code} 목표=${(sig.decision.appliedTargetRatio * 100).toFixed(1)}% ` +
            `현재=${(sig.decision.currentRatio * 100).toFixed(1)}% ` +
            `제안=${(sig.decision.suggestedTradeKRW / 1e8).toFixed(1)}억 (${sig.decision.action})`)
ok('강한 하락 → 매도 제안(음수)', sig.decision.suggestedTradeKRW < 0)
ok('조치 필요 플래그', sig.decision.actionRequired)
ok('현재 비율 정확', near(sig.decision.currentRatio, 0.45, 1e-9))
ok('표본 부족 시 null', evaluateRegime(fallS.slice(0, 10), base) === null)

console.log(`\n결과: ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

