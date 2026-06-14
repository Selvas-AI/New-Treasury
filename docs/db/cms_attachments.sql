-- ============================================================
-- CMS 증빙 첨부파일 관리 (S7)
-- 실행 순서:
--   1. Supabase Dashboard > Storage > New bucket
--      이름: cms-attachments, Public: OFF
--   2. 아래 SQL을 Supabase SQL Editor에서 실행
-- ============================================================

-- ── 1. daily_report_attachments 테이블 ──────────────────────
CREATE TABLE IF NOT EXISTS public.daily_report_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id    uuid        NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  company      text        NOT NULL,
  report_date  date        NOT NULL,   -- 보고대상일 (파일 경로 구성용)
  storage_path text        NOT NULL,   -- cms-attachments 버킷 내 경로
  file_name    text        NOT NULL,   -- 원본 파일명
  file_size    integer,                -- bytes
  uploaded_by  text,                   -- user code
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  keep_forever boolean     NOT NULL DEFAULT false   -- 승인완료 건 영구보존 플래그
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_dra_report_id ON public.daily_report_attachments(report_id);
CREATE INDEX IF NOT EXISTS idx_dra_expires   ON public.daily_report_attachments(expires_at)
  WHERE keep_forever = false;

-- ── 2. RLS 정책 ──────────────────────────────────────────────
ALTER TABLE public.daily_report_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dra_select" ON public.daily_report_attachments;
CREATE POLICY "dra_select" ON public.daily_report_attachments
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "dra_insert" ON public.daily_report_attachments;
CREATE POLICY "dra_insert" ON public.daily_report_attachments
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "dra_update" ON public.daily_report_attachments;
CREATE POLICY "dra_update" ON public.daily_report_attachments
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dra_delete" ON public.daily_report_attachments;
CREATE POLICY "dra_delete" ON public.daily_report_attachments
  FOR DELETE TO anon, authenticated USING (true);

-- ── 3. Storage 버킷 RLS (Supabase Dashboard > Storage > Policies) ──
-- 아래는 참고용. Dashboard에서 직접 설정하거나 SQL로 실행.
-- INSERT policy: allow authenticated & anon
-- SELECT policy: allow authenticated & anon (signed URL 사용)
-- DELETE policy: allow authenticated & anon

-- ── 4. 90일 자동삭제 (pg_cron — Supabase Pro 이상에서 사용 가능) ──
-- Free 플랜이면 아래 대신 수동 삭제 또는 Edge Function 스케줄러 사용.
/*
SELECT cron.schedule(
  'delete-expired-cms-attachments',  -- job name
  '0 2 * * *',                       -- 매일 새벽 2시
  $$
    -- 1) DB 레코드 먼저 조회해서 storage_path 수집 후 삭제
    DELETE FROM public.daily_report_attachments
    WHERE expires_at < now()
      AND keep_forever = false;
    -- 2) Storage 파일은 Edge Function 또는 아래 주석 참조
    --    storage.delete_object('cms-attachments', storage_path) 는 SQL 직접 불가
    --    → useDailyReportAttachments.ts의 cleanupExpired() 함수로 처리
  $$
);
*/

-- ── 5. 승인 완료 시 keep_forever = true 자동 설정 트리거 ──────
CREATE OR REPLACE FUNCTION public.set_attachment_keep_forever()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- daily_report_approvals에 approve 행 삽입 시 해당 report_id의 첨부파일 영구보존
  IF NEW.action = 'approve' THEN
    UPDATE public.daily_report_attachments
    SET keep_forever = true
    WHERE report_id = NEW.report_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attachment_keep_forever ON public.daily_report_approvals;
CREATE TRIGGER trg_attachment_keep_forever
  AFTER INSERT ON public.daily_report_approvals
  FOR EACH ROW EXECUTE FUNCTION public.set_attachment_keep_forever();
