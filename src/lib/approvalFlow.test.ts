import { describe, it, expect } from 'vitest'
import {
  stageOf, groupByStage, currentStage, pendingInStage, isFinalApproval,
  evaluateApproveGate, autoApproveStepsOnSubmit, describeFlow,
  type ApprovalStep,
} from './approvalFlow'

const cfg = (step: number, stage: number | null, code: string, label = `직책${step}`): ApprovalStep =>
  ({ step, stage, role_label: label, approver_code: code })

/** 기존 데이터 = stage 미설정 → 순차 */
const SEQ = [cfg(1, null, 'A'), cfg(2, null, 'B'), cfg(3, null, 'C')]
/** 중간 3명 병렬 → 최종 1명 */
const PAR = [cfg(1, 1, 'A'), cfg(2, 1, 'B'), cfg(3, 1, 'C'), cfg(4, 2, 'D')]

describe('stageOf — 마이그레이션 안전장치', () => {
  it('stage 가 null 이면 step 을 쓴다(= 기존 순차 동작 유지)', () => {
    expect(stageOf({ step: 2, stage: null })).toBe(2)
  })
  it('stage 가 있으면 그 값을 쓴다', () => {
    expect(stageOf({ step: 3, stage: 1 })).toBe(1)
  })
})

describe('groupByStage', () => {
  it('순차 설정은 차수마다 1명', () => {
    expect(groupByStage(SEQ).map(g => g.steps.length)).toEqual([1, 1, 1])
  })
  it('병렬 설정은 1차 3명 · 2차 1명', () => {
    const g = groupByStage(PAR)
    expect(g.map(x => x.stage)).toEqual([1, 2])
    expect(g[0].steps.map(s => s.step)).toEqual([1, 2, 3])
  })
})

describe('currentStage — 지금 차례', () => {
  it('순차: 1차 승인 후 2차', () => {
    expect(currentStage(SEQ, new Set())).toBe(1)
    expect(currentStage(SEQ, new Set([1]))).toBe(2)
  })
  it('병렬: 1차는 전원 승인해야 2차로 넘어간다', () => {
    expect(currentStage(PAR, new Set([1]))).toBe(1)
    expect(currentStage(PAR, new Set([1, 2]))).toBe(1)
    expect(currentStage(PAR, new Set([1, 2, 3]))).toBe(2)
  })
  it('전부 승인되면 null', () => {
    expect(currentStage(PAR, new Set([1, 2, 3, 4]))).toBeNull()
  })
})

describe('pendingInStage', () => {
  it('같은 차수에서 아직 안 누른 사람만', () => {
    expect(pendingInStage(PAR, new Set([1]), 1).map(s => s.approver_code)).toEqual(['B', 'C'])
  })
})

describe('isFinalApproval — 병렬 최종 차수의 조기 확정 방지', () => {
  it('순차: 마지막 step 일 때만 확정', () => {
    expect(isFinalApproval(SEQ, new Set([1]), 2)).toBe(false)
    expect(isFinalApproval(SEQ, new Set([1, 2]), 3)).toBe(true)
  })
  it('병렬 최종 차수에 2명이면 먼저 누른 사람이 확정시키지 않는다', () => {
    const twoFinal = [cfg(1, 1, 'A'), cfg(2, 2, 'B'), cfg(3, 2, 'C')]
    expect(isFinalApproval(twoFinal, new Set([1]), 2)).toBe(false)
    expect(isFinalApproval(twoFinal, new Set([1, 2]), 3)).toBe(true)
  })
  it('결재선 미설정이면 1인 승인으로 확정', () => {
    expect(isFinalApproval([], new Set(), 1)).toBe(true)
  })
})

describe('evaluateApproveGate', () => {
  const base = { status: 'submitted', isMaster: false, canApproveFlag: true }

  it('병렬 1차 결재자 3명은 서로를 기다리지 않고 각자 승인 가능', () => {
    for (const code of ['A', 'B', 'C']) {
      const g = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set(), userCode: code })
      expect(g.canApprove).toBe(true)
    }
  })

  it('최종 결재자는 1차 전원이 끝나야 승인 가능', () => {
    const before = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set([1, 2]), userCode: 'D' })
    expect(before.canApprove).toBe(false)
    expect(before.reason).toContain('1차')

    const after = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set([1, 2, 3]), userCode: 'D' })
    expect(after.canApprove).toBe(true)
  })

  it('이미 승인한 병렬 결재자에게는 누구를 기다리는지 알려준다', () => {
    const g = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set([1]), userCode: 'A' })
    expect(g.canApprove).toBe(false)
    expect(g.reason).toContain('직책2')
    expect(g.reason).toContain('직책3')
  })

  it('코드 공백·대소문자 차이를 흡수한다', () => {
    const g = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set(), userCode: ' a ' })
    expect(g.canApprove).toBe(true)
  })

  it('can_approve 가 꺼져 있으면 차단하고 사유를 밝힌다', () => {
    const g = evaluateApproveGate({ ...base, canApproveFlag: false, config: PAR, approvedSteps: new Set(), userCode: 'A' })
    expect(g.canApprove).toBe(false)
    expect(g.reason).toContain('can_approve')
  })

  it('결재선에 없는 계정', () => {
    const g = evaluateApproveGate({ ...base, config: PAR, approvedSteps: new Set(), userCode: 'Z' })
    expect(g.reason).toContain('결재선에 등록되지 않은')
  })

  it('master 는 대행 승인 가능', () => {
    const g = evaluateApproveGate({ ...base, isMaster: true, config: PAR, approvedSteps: new Set(), userCode: 'Z' })
    expect(g.canApprove).toBe(true)
  })

  it('상신 전에는 버튼도 사유도 없다', () => {
    const g = evaluateApproveGate({ ...base, status: 'draft', config: PAR, approvedSteps: new Set(), userCode: 'A' })
    expect(g.canApprove).toBe(false)
    expect(g.reason).toBeNull()
  })
})

describe('autoApproveStepsOnSubmit', () => {
  const base = { isMaster: false, canApproveFlag: true }

  it('순차: 본인이 결재자인 앞쪽 연속 구간 (기존 동작 그대로)', () => {
    expect(autoApproveStepsOnSubmit({ ...base, config: SEQ, userCode: 'A' })).toEqual([1])
    const allMine = [cfg(1, null, 'A'), cfg(2, null, 'A'), cfg(3, null, 'C')]
    expect(autoApproveStepsOnSubmit({ ...base, config: allMine, userCode: 'A' })).toEqual([1, 2])
  })

  it('순차: 1차가 남이면 아무것도 자동 승인하지 않는다', () => {
    expect(autoApproveStepsOnSubmit({ ...base, config: SEQ, userCode: 'B' })).toEqual([])
  })

  it('병렬: 본인 슬롯만 승인하고 동료 검토는 건너뛰지 않는다', () => {
    expect(autoApproveStepsOnSubmit({ ...base, config: PAR, userCode: 'A' })).toEqual([1])
  })

  it('병렬: 1차가 전부 본인이면 다음 차수까지 진행', () => {
    const solo = [cfg(1, 1, 'A'), cfg(2, 1, 'A'), cfg(3, 2, 'A'), cfg(4, 3, 'D')]
    expect(autoApproveStepsOnSubmit({ ...base, config: solo, userCode: 'A' })).toEqual([1, 2, 3])
  })

  it('결재 권한이 없으면 자동 승인도 하지 않는다', () => {
    expect(autoApproveStepsOnSubmit({ ...base, canApproveFlag: false, config: SEQ, userCode: 'A' })).toEqual([])
  })
})

describe('describeFlow', () => {
  it('순차', () => { expect(describeFlow(SEQ)).toBe('순차 결재 · 1 → 1 → 1') })
  it('병렬 포함', () => { expect(describeFlow(PAR)).toBe('병렬 포함 · 3(병렬) → 1') })
  it('미설정', () => { expect(describeFlow([])).toBe('결재선 미설정') })
})
