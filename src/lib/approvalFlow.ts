/**
 * approvalFlow — 자금일보 결재 진행 판정 SSOT (2026-11-05)
 *
 * ⭐ 왜 순수 함수로 빼는가
 *   "지금 누구 차례인가"를 보는 곳이 **세 군데**다.
 *     ① 화면의 승인·반려 버튼 노출(DailyReportPage)
 *     ② 상신 시 자동 승인 대상 산출
 *     ③ 결재 요청 메일 수신자(GAS → approval_notifications_pending RPC)
 *   ③ 은 SQL 이라 같은 코드를 공유할 수 없다 — 그래서 규칙을 여기 한 곳에 적고
 *   SQL 은 이 파일의 정의를 그대로 옮긴다. 규칙이 갈라지면 "버튼은 안 보이는데
 *   메일은 오는" 상태가 된다. 수정할 때 반드시 둘을 함께 고칠 것.
 *   (대응 SQL: docs/db/approval_parallel_stage.sql)
 *
 * ── 모델: step(결재자 슬롯) vs stage(차수) ────────────────────────────
 *   step  — 결재자 1명의 고유 슬롯. (company, step) 유니크. 로그·알림 키.
 *   stage — 진행 차수. **같은 stage 끼리는 병렬**, stage 가 다르면 순차.
 *
 *   ⚠ stage 가 null 이면 step 을 쓴다 = 차수가 전부 달라짐 = **기존 순차 결재**.
 *     컬럼을 추가해도 기존 법인의 동작이 바뀌지 않는 이유다.
 *
 *   예) 중간결재자 3명 병렬 → 최종 1명
 *       step 1,2,3 → stage 1  /  step 4 → stage 2
 */

export interface ApprovalStep {
  step: number
  stage: number | null
  role_label: string
  approver_code: string
}

/** 차수. 미설정이면 step 을 그대로 써서 순차가 된다. */
export function stageOf(c: Pick<ApprovalStep, 'step' | 'stage'>): number {
  return c.stage ?? c.step
}

/** 결재자 코드 비교 — 손입력이라 공백·대소문자 차이로 조용히 어긋나지 않게 정규화 */
export function sameCode(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 차수 오름차순 그룹. 각 그룹 안은 step 오름차순. */
export function groupByStage<T extends ApprovalStep>(config: readonly T[]): { stage: number; steps: T[] }[] {
  const map = new Map<number, T[]>()
  for (const c of config) {
    const g = stageOf(c)
    const arr = map.get(g)
    if (arr) arr.push(c); else map.set(g, [c])
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stage, steps]) => ({ stage, steps: [...steps].sort((a, b) => a.step - b.step) }))
}

/**
 * 지금 진행 중인 차수 = 아직 전원 승인되지 않은 **가장 낮은** 차수.
 * 전부 승인됐으면 null.
 */
export function currentStage(
  config: readonly ApprovalStep[],
  approvedSteps: ReadonlySet<number>,
): number | null {
  for (const g of groupByStage(config)) {
    if (g.steps.some(s => !approvedSteps.has(s.step))) return g.stage
  }
  return null
}

/** 그 차수에서 아직 승인하지 않은 결재자들 — 메일 수신자·대기 안내에 쓴다 */
export function pendingInStage<T extends ApprovalStep>(
  config: readonly T[],
  approvedSteps: ReadonlySet<number>,
  stage: number,
): T[] {
  return groupByStage(config).find(g => g.stage === stage)?.steps
    .filter(s => !approvedSteps.has(s.step)) ?? []
}

/**
 * 이 승인으로 결재가 끝나는가 = 내 step 을 빼고 나머지가 전부 승인된 상태인가.
 *
 * ⚠ 순차 모델의 "마지막 step 인가"로 판단하면 병렬에서 틀린다 —
 *   최종 차수에 결재자가 둘이면 먼저 누른 사람이 확정시켜 버린다.
 */
export function isFinalApproval(
  config: readonly ApprovalStep[],
  approvedSteps: ReadonlySet<number>,
  step: number,
): boolean {
  if (config.length === 0) return true   // 결재선 미설정 → 1인 승인으로 확정
  return config.every(c => c.step === step || approvedSteps.has(c.step))
}

export interface ApproveGate {
  /** 내가 맡은 결재자 슬롯 (없으면 null) */
  mine: ApprovalStep | null
  stage: number | null
  canApprove: boolean
  /** 승인 버튼이 안 보이는 이유 — 없으면 null */
  reason: string | null
}

/**
 * 승인 가능 여부 + 불가 사유.
 *
 * 버튼은 불가 시 아예 렌더되지 않으므로, 사유가 없으면 결재자가
 * "권한이 없는 건지 내 차례가 아닌 건지" 알 방법이 없다(2026-08-27 리포트).
 */
export function evaluateApproveGate(params: {
  config: readonly ApprovalStep[]
  approvedSteps: ReadonlySet<number>
  status: string
  userCode?: string | null
  /** master 는 다음 차수를 대행 승인할 수 있다 */
  isMaster: boolean
  canApproveFlag: boolean
}): ApproveGate {
  const { config, approvedSteps, status, userCode, isMaster, canApproveFlag } = params
  const mine = config.find(c => sameCode(c.approver_code, userCode)) ?? null
  const stage = currentStage(config, approvedSteps)

  if (status !== 'submitted') {
    return { mine, stage, canApprove: false, reason: null }
  }
  if (isMaster) {
    return { mine, stage, canApprove: true, reason: null }
  }
  if (!mine) {
    return { mine, stage, canApprove: false,
      reason: '이 법인 결재선에 등록되지 않은 계정입니다 — 조직도/결재선 관리에서 확인하세요.' }
  }
  if (!canApproveFlag) {
    return { mine, stage, canApprove: false,
      reason: '계정에 결재 권한(can_approve)이 없습니다 — 사용자 관리에서 부여해야 합니다.' }
  }
  if (approvedSteps.has(mine.step)) {
    const waiting = stage == null ? [] : pendingInStage(config, approvedSteps, stage)
    return { mine, stage, canApprove: false,
      reason: waiting.length
        ? `이미 승인하셨습니다. 같은 차수의 ${waiting.map(w => w.role_label).join('·')} 승인을 기다리는 중입니다.`
        : '이미 승인 처리되었습니다.' }
  }
  if (stage == null) {
    return { mine, stage, canApprove: false, reason: '모든 결재 단계가 승인된 상태입니다.' }
  }
  if (stageOf(mine) !== stage) {
    const waiting = pendingInStage(config, approvedSteps, stage)
    return { mine, stage, canApprove: false,
      reason: `${stage}차(${waiting.map(w => `${w.role_label} ${w.approver_code}`).join(', ') || '-'}) 승인 후에 ${stageOf(mine)}차 차례가 됩니다.` }
  }
  return { mine, stage, canApprove: true, reason: null }
}

/**
 * 상신과 동시에 자동 승인할 슬롯 — 상신자가 결재자인 본인 슬롯.
 *
 * 차수를 앞에서부터 훑으며 **본인 슬롯만** 승인한다. 그 차수가 본인 승인만으로
 * 전부 채워지면 다음 차수로 넘어가고, 다른 사람이 남아 있으면 거기서 멈춘다.
 *   · 순차(차수당 1명)  → 기존 "본인이 결재자인 연속 구간" 과 완전히 동일
 *   · 병렬             → 본인 슬롯만 처리하고 동료 검토는 건너뛰지 않는다
 *
 * ⚠ 결재선에 있다는 것만으로는 부족하다 — 승인 권한(can_approve)도 있어야 한다.
 *   수동 승인 게이트와 같은 기준이어야 "자동으로는 되는데 수동은 안 되는" 모순이 없다.
 */
export function autoApproveStepsOnSubmit(params: {
  config: readonly ApprovalStep[]
  userCode?: string | null
  isMaster: boolean
  canApproveFlag: boolean
}): number[] {
  const { config, userCode, isMaster, canApproveFlag } = params
  if (!userCode) return []
  if (!(isMaster || canApproveFlag)) return []

  const out: number[] = []
  const done = new Set<number>()
  for (const g of groupByStage(config)) {
    for (const s of g.steps) {
      if (sameCode(s.approver_code, userCode)) { out.push(s.step); done.add(s.step) }
    }
    // 이 차수에 남이 남아 있으면 더 진행하지 않는다
    if (g.steps.some(s => !done.has(s.step))) break
  }
  return out
}

/** 차수 구성 요약 — 설정 화면에서 "지금 순차인가 병렬인가"를 한 줄로 보여준다 */
export function describeFlow(config: readonly ApprovalStep[]): string {
  const groups = groupByStage(config)
  if (groups.length === 0) return '결재선 미설정'
  const parallel = groups.filter(g => g.steps.length > 1).length
  const shape = groups.map(g => g.steps.length === 1 ? '1' : `${g.steps.length}(병렬)`).join(' → ')
  return parallel === 0 ? `순차 결재 · ${shape}` : `병렬 포함 · ${shape}`
}
