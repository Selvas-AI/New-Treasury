/**
 * useDailyReportAttachments — CMS 증빙 PDF 업로드/조회/삭제
 *
 * 스토리지 경로: cms-attachments/{company}/{report_date}/{uuid}.pdf
 * 만료: 90일 (daily_report_attachments.expires_at), 승인완료 시 keep_forever=true
 */
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { generateUUID } from '../lib/format'

export interface CmsAttachment {
  id:           string
  report_id:    string
  company:      string
  report_date:  string
  storage_path: string
  file_name:    string
  file_size:    number | null
  uploaded_by:  string | null
  uploaded_at:  string
  expires_at:   string
  keep_forever: boolean
}

const BUCKET = 'cms-attachments'

// Supabase Storage 경로는 ASCII만 허용 — 한글 회사명을 slug로 변환
const COMPANY_SLUG: Record<string, string> = {
  '셀바스에이아이':  'selvas-ai',
  '셀바스헬스케어': 'selvas-hc',
  '메디아나':       'mediana',
}
function toSlug(company: string): string {
  return COMPANY_SLUG[company] ?? encodeURIComponent(company).replace(/%/g, '_')
}

export function useDailyReportAttachments() {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // ── 파일 업로드 ──────────────────────────────────────────
  const upload = useCallback(async (
    file:       File,
    reportId:   string,
    company:    string,
    reportDate: string,  // YYYY-MM-DD (보고대상일)
    uploaderCode: string,
  ): Promise<CmsAttachment | null> => {
    setUploading(true)
    setUploadError(null)
    try {
      const ext  = file.name.split('.').pop() ?? 'pdf'
      const uuid = generateUUID()
      const path = `${toSlug(company)}/${reportDate}/${uuid}.${ext}`

      // ── Storage 업로드 (30초 타임아웃) ──────────────────────
      const uploadPromise = supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type || 'application/pdf' })

      const timeoutPromise = new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error('업로드 시간 초과 (30초). 버킷 정책을 확인하세요.')), 30_000)
      )

      const { error: stErr } = await Promise.race([uploadPromise, timeoutPromise])
        .catch((e: Error) => ({ error: { message: e.message } })) as { error: { message: string } | null }

      if (stErr) { setUploadError(stErr.message); return null }

      // ── DB 레코드 저장 ───────────────────────────────────────
      const { data, error: dbErr } = await supabase
        .from('daily_report_attachments')
        .insert({
          id:           uuid,
          report_id:    reportId,
          company,
          report_date:  reportDate,
          storage_path: path,
          file_name:    file.name,
          file_size:    file.size,
          uploaded_by:  uploaderCode,
        })
        .select()
        .single()

      if (dbErr) {
        // DB 저장 실패 시 storage 파일도 정리
        await supabase.storage.from(BUCKET).remove([path])
        setUploadError(`DB 저장 실패: ${dbErr.message}`)
        return null
      }
      return data as CmsAttachment
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : '알 수 없는 오류')
      return null
    } finally {
      setUploading(false)
    }
  }, [])

  // ── 리포트별 첨부파일 목록 조회 ──────────────────────────
  const listByReport = useCallback(async (
    reportId: string
  ): Promise<CmsAttachment[]> => {
    const { data, error } = await supabase
      .from('daily_report_attachments')
      .select('*')
      .eq('report_id', reportId)
      .order('uploaded_at', { ascending: false })
    if (error) return []
    return (data ?? []) as CmsAttachment[]
  }, [])

  // ── 서명된 임시 URL 생성 (1시간 유효) ────────────────────
  const getSignedUrl = useCallback(async (
    storagePath: string,
    expiresIn = 3600
  ): Promise<string | null> => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn)
    if (error) return null
    return data.signedUrl
  }, [])

  // ── 첨부파일 삭제 ────────────────────────────────────────
  const remove = useCallback(async (attachment: CmsAttachment): Promise<string | null> => {
    // storage 파일 삭제
    const { error: stErr } = await supabase.storage
      .from(BUCKET)
      .remove([attachment.storage_path])
    if (stErr) return stErr.message

    // DB 레코드 삭제
    const { error: dbErr } = await supabase
      .from('daily_report_attachments')
      .delete()
      .eq('id', attachment.id)
    return dbErr?.message ?? null
  }, [])

  // ── 만료된 파일 정리 (Free 플랜 — pg_cron 없는 경우 수동 호출) ──
  const cleanupExpired = useCallback(async (): Promise<void> => {
    const { data: expired } = await supabase
      .from('daily_report_attachments')
      .select('id, storage_path')
      .lt('expires_at', new Date().toISOString())
      .eq('keep_forever', false)

    if (!expired?.length) return

    const paths = expired.map((r: { storage_path: string }) => r.storage_path)
    await supabase.storage.from(BUCKET).remove(paths)
    await supabase
      .from('daily_report_attachments')
      .delete()
      .in('id', expired.map((r: { id: string }) => r.id))
  }, [])

  return { uploading, uploadError, upload, listByReport, getSignedUrl, remove, cleanupExpired }
}
