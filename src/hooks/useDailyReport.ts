/**
 * useDailyReport — 자금일보 헤더 CRUD 훅
 *
 * 담당: daily_reports 테이블 (1건/법인/날짜)
 * 관련 훅: useDailyReportItems (라인 아이템), useApprovalConfig (결재선 설정)
 */
import { useState, useCallback, useEffect } from 'react'
import { supabase, restInsert, restUpdate, restDelete, restUpsert, withTimeout } from '../lib/supabase'
import { generateUUID } from '../lib/format'
import type { Company } from '../types'

// ─── 타입 ────────────────────────────────────────────────────

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface DailyReport {
  id:            string
  company:       Company
  report_date:   string          // YYYY-MM-DD
  status:        ReportStatus
  fx_rates:      Record<string, number> | null  // 환율 스냅샷
  note:          string | null

  submitted_by:  string | null
  submitted_at:  string | null
  approved_by:   string | null
  approved_at:   string | null

  created_at:    string
  updated_at:    string
}

export interface ApprovalLog {
  id:           string
  report_id:    string
  step:         number
  action:       'submit' | 'approve' | 'reject' | 'withdraw'
  actor_code:   string
  actor_label:  string | null
  comment:      string | null
  created_at:   string
}

export interface ApprovalConfig {
  id:             string
  company:        Company
  step:           number
  role_label:     string
  approver_code:  string
  is_active:      boolean
}

// ─── 훅 ─────────────────────────────────────────────────────

export function useDailyReport() {
  const [report,   setReport]   = useState<DailyReport | null>(null)
  const [approvals, setApprovals] = useState<ApprovalLog[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // ── 특정 날짜 일보 조회 (없으면 null) ─────────────────────
  const fetchReport = useCallback(async (company: Company, date: string) => {
    setLoading(true)
    setError(null)
    setReport(null)
    setApprovals([])
    try {
      const { data, error: err } = await withTimeout(
        supabase.from('daily_reports').select('*')
          .eq('company', company).eq('report_date', date).maybeSingle(),
      )
      if (err) throw err
      setReport(data as DailyReport | null)

      if (data) {
        const { data: logs, error: logErr } = await withTimeout(
          supabase.from('daily_report_approvals').select('*')
            .eq('report_id', data.id).order('created_at', { ascending: true }),
        )
        if (logErr) throw logErr
        setApprovals((logs ?? []) as ApprovalLog[])
      }
    } catch (e) {
      console.error('[useDailyReport.fetchReport] 실패:', { company, date, error: e })
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // ── 일보 생성 or 임시저장 ─────────────────────────────────
  const saveReport = useCallback(async (
    company: Company,
    date: string,
    patch: Partial<Pick<DailyReport, 'note' | 'fx_rates'>>,
  ): Promise<DailyReport | null> => {
    setError(null)
    try {
      const now = new Date().toISOString()
      if (report?.id) {
        // 업데이트 (REST, 반환행 요청)
        const { data, error: err } = await restUpdate<DailyReport>(
          'daily_reports', { ...patch, updated_at: now }, { id: report.id }, true,
        )
        if (err) throw new Error(err.message)
        const updated = (data?.[0] ?? null) as DailyReport | null
        if (updated) setReport(updated)
        return updated
      } else {
        // 신규 생성 또는 이미 존재하면 merge (company+report_date unique 충돌 방지)
        const { data, error: err } = await restUpsert<DailyReport>('daily_reports', {
          id:          generateUUID(),
          company,
          report_date: date,
          status:      'draft',
          ...patch,
          created_at:  now,
          updated_at:  now,
        }, true, 'company,report_date')
        if (err) throw new Error(err.message)
        const created = (data?.[0] ?? null) as DailyReport | null
        if (created) setReport(created)
        return created
      }
    } catch (e) {
      setError(String(e))
      return null
    }
  }, [report])

  // ── 상신 ──────────────────────────────────────────────────
  const submitReport = useCallback(async (
    actorCode: string,
    actorLabel: string,
  ): Promise<boolean> => {
    if (!report?.id) return false
    setError(null)
    try {
      const now = new Date().toISOString()
      const { error: err } = await restUpdate('daily_reports', {
        status: 'submitted', submitted_by: actorCode, submitted_at: now, updated_at: now,
      }, { id: report.id })
      if (err) throw new Error(err.message)

      // 결재 로그 추가
      const logId = generateUUID()
      await restInsert('daily_report_approvals', {
        id: logId, report_id: report.id, step: 0, action: 'submit',
        actor_code: actorCode, actor_label: actorLabel, created_at: now,
      })

      setReport(prev => prev ? { ...prev, status: 'submitted', submitted_by: actorCode, submitted_at: now } : prev)
      setApprovals(prev => [...prev, {
        id: logId, report_id: report.id, step: 0,
        action: 'submit', actor_code: actorCode, actor_label: actorLabel,
        comment: null, created_at: now,
      }])
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }, [report])

  // ── 승인 ──────────────────────────────────────────────────
  // isFinal=true(최종 결재 단계)일 때만 status='approved' 확정 + daily.confirmed.
  // 중간 단계 승인은 로그만 남기고 status='submitted' 유지 → 다단계 순차 결재.
  const approveReport = useCallback(async (
    step: number,
    actorCode: string,
    actorLabel: string,
    comment?: string,
    isFinal: boolean = true,
  ): Promise<boolean> => {
    if (!report?.id) return false
    setError(null)
    try {
      const now = new Date().toISOString()
      if (isFinal) {
        const { error: err } = await restUpdate('daily_reports', {
          status: 'approved', approved_by: actorCode, approved_at: now, updated_at: now,
        }, { id: report.id })
        if (err) throw new Error(err.message)
      }

      const logId = generateUUID()
      await restInsert('daily_report_approvals', {
        id: logId, report_id: report.id, step, action: 'approve',
        actor_code: actorCode, actor_label: actorLabel, comment: comment ?? null, created_at: now,
      })

      // C안: 최종 승인 시에만 daily 테이블 confirmed = true (daily.report_id 연결 레코드)
      if (isFinal) await restUpdate('daily', { confirmed: true }, { report_id: report.id })

      if (isFinal) {
        setReport(prev => prev ? { ...prev, status: 'approved', approved_by: actorCode, approved_at: now } : prev)
      }
      setApprovals(prev => [...prev, {
        id: logId, report_id: report.id, step,
        action: 'approve', actor_code: actorCode, actor_label: actorLabel,
        comment: comment ?? null, created_at: now,
      }])
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }, [report])

  // ── 반려 ──────────────────────────────────────────────────
  const rejectReport = useCallback(async (
    step: number,
    actorCode: string,
    actorLabel: string,
    comment: string,
  ): Promise<boolean> => {
    if (!report?.id) return false
    setError(null)
    try {
      const now = new Date().toISOString()
      const { error: err } = await restUpdate('daily_reports', { status: 'rejected', updated_at: now }, { id: report.id })
      if (err) throw new Error(err.message)

      const logId = generateUUID()
      await restInsert('daily_report_approvals', {
        id: logId, report_id: report.id, step,
        action: 'reject', actor_code: actorCode, actor_label: actorLabel,
        comment, created_at: now,
      })

      setReport(prev => prev ? { ...prev, status: 'rejected' } : prev)
      setApprovals(prev => [...prev, {
        id: logId, report_id: report.id, step,
        action: 'reject', actor_code: actorCode, actor_label: actorLabel,
        comment, created_at: now,
      }])
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }, [report])

  return {
    report,
    approvals,
    loading,
    error,
    fetchReport,
    saveReport,
    submitReport,
    approveReport,
    rejectReport,
  }
}

// ─── 결재선 설정 훅 ──────────────────────────────────────────

export function useApprovalConfig(company: Company | null) {
  const [config,  setConfig]  = useState<ApprovalConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!company) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await withTimeout(
        supabase.from('daily_report_approval_config').select('*')
          .eq('company', company).eq('is_active', true).order('step', { ascending: true }),
      )
      if (err) throw err
      setConfig((data ?? []) as ApprovalConfig[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [company])

  // company 변경(또는 마운트) 시 자동 조회 — key 재마운트 모델에서 필수.
  // 이게 없으면 탭 전환 후 config=[] 인 채로 fetch가 호출되지 않아 빈 화면이 됨.
  useEffect(() => { void fetch() }, [fetch])

  const upsert = useCallback(async (
    step: number,
    roleLabel: string,
    approverCode: string,
  ): Promise<boolean> => {
    if (!company) return false
    setError(null)
    try {
      // 동일 (company, step) 기존 행 제거 (is_active 무관) → UNIQUE VIOLATION 방지
      await restDelete('daily_report_approval_config', { company, step })
      const { error: err } = await restInsert('daily_report_approval_config', {
        id: generateUUID(), company, step,
        role_label: roleLabel, approver_code: approverCode, is_active: true,
      })
      if (err) throw new Error(err.message)
      await fetch()
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }, [company, fetch])

  const remove = useCallback(async (step: number): Promise<boolean> => {
    if (!company) return false
    setError(null)
    try {
      const { error: err } = await restDelete('daily_report_approval_config', { company, step })
      if (err) throw new Error(err.message)
      setConfig(prev => prev.filter(c => c.step !== step))
      return true
    } catch (e) {
      setError(String(e))
      return false
    }
  }, [company])

  return { config, loading, error, fetch, upsert, remove }
}
