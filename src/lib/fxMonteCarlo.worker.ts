/**
 * fxMonteCarlo.worker.ts — 무작위 반복 시뮬레이션 전용 워커
 *
 * 세션25차 신규.
 *
 * ⚠ 왜 필요한가:
 *   백테스트 1회도 가볍지 않다(점검일마다 전체 이력을 다시 계산). 이전에는
 *   메인 스레드에서 setTimeout(0) 으로 한 틱씩 양보하며 N회를 실행했지만,
 *   개별 실행 1회 자체가 이미 눈에 띄게 느려 반복 횟수와 무관하게 화면이
 *   멈춘 것처럼 보였다(2026-08-13 사용자 리포트, 재발).
 *   근본 해결은 계산을 메인 스레드 밖(워커)으로 완전히 옮기는 것 — 아무리
 *   오래 걸려도 화면은 절대 멈추지 않는다.
 *
 * fxProjection.ts 는 순수 함수(DOM·React 의존 없음)라 워커에서 그대로 재사용한다.
 * 집계(summarizeMonteCarloDraws)도 워커 안에서 끝내 가벼운 결과만 돌려준다 —
 * draws 원본(경로별 전체 시계열)을 메인 스레드로 옮기면 postMessage 구조적
 * 복제 비용이 다시 커진다.
 */
import { runProjection, summarizeMonteCarloDraws, type FxProjectionInput, type FxProjectionResult, type MonteCarloResult } from './fxProjection'

export interface MonteCarloWorkerRequest {
  type: 'run'
  input: FxProjectionInput
  runs: number
}

export type MonteCarloWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; result: MonteCarloResult }

self.onmessage = (e: MessageEvent<MonteCarloWorkerRequest>) => {
  const { input, runs } = e.data
  const draws: FxProjectionResult[] = []
  for (let i = 0; i < runs; i++) {
    draws.push(runProjection({ ...input, randomize: true }))
    const progress: MonteCarloWorkerMessage = { type: 'progress', done: i + 1, total: runs }
    self.postMessage(progress)
  }
  const done: MonteCarloWorkerMessage = { type: 'done', result: summarizeMonteCarloDraws(draws) }
  self.postMessage(done)
}
