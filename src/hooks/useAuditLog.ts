import { useCallback } from 'react'
import { restInsert } from '../lib/supabase'
import { useAuth } from './useAuth'
import { generateUUID } from '../lib/format'

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'SETACTIVE'
export type AuditTable = 'daily' | 'investments' | 'loans' | 'equities'

interface LogParams {
  table: AuditTable
  action: AuditAction
  company: string
  recordId?: string
  summary: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

export function useAuditLog() {
  const { user } = useAuth()

  const logAction = useCallback(async (params: LogParams): Promise<void> => {
    if (!user) return
    // fire-and-forget: 로그 실패가 본 작업을 막지 않음
    void restInsert('audit_logs', {
      id:          generateUUID(),
      company:     params.company,
      table_name:  params.table,
      action:      params.action,
      record_id:   params.recordId ?? null,
      user_label:  user.label,
      user_role:   user.role,
      summary:     params.summary,
      before_data: params.before ?? null,
      after_data:  params.after  ?? null,
    })
  }, [user])

  return { logAction }
}
