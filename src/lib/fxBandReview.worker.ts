/**
 * fxBandReview.worker.ts — 리밸런싱 기준 회고 리포트 전용 워커 (2026-11-25 D5)
 *
 * 백테스트 20회(4개 기간 × 5개 기준)를 메인 스레드에서 돌리면 화면이 멈춘다
 * (fxMonteCarlo.worker 와 같은 이유). 계산은 lib/fxBandReview 가 하고 여기서는 실행만 한다.
 */
import { runBandReview, type BandReviewInput, type BandReviewReport } from './fxBandReview'

export interface BandReviewWorkerRequest { type: 'run'; input: BandReviewInput }

export type BandReviewWorkerMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; report: BandReviewReport }
  | { type: 'error'; message: string }

self.onmessage = (e: MessageEvent<BandReviewWorkerRequest>) => {
  try {
    const report = runBandReview(e.data.input, (done, total) => {
      const m: BandReviewWorkerMessage = { type: 'progress', done, total }
      self.postMessage(m)
    })
    const m: BandReviewWorkerMessage = { type: 'done', report }
    self.postMessage(m)
  } catch (err) {
    const m: BandReviewWorkerMessage = { type: 'error', message: err instanceof Error ? err.message : String(err) }
    self.postMessage(m)
  }
}
