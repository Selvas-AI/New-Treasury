import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface ViewState {
  visibleColumns: string[]
  sortBy: { key: string; dir: 'asc' | 'desc' } | null
}

interface UseTableSettingsReturn {
  settings: ViewState | null
  updateSettings: (next: ViewState) => Promise<void>
  loading: boolean
}

// debounce upsert to avoid rapid-fire DB writes during column toggling
function useDebouncedCallback<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  const timer = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  return useCallback((...args: T) => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => fn(...args), ms)
  }, [fn, ms])
}

export function useTableSettings(tableId: string): UseTableSettingsReturn {
  const { user } = useAuth()
  const [settings, setSettings] = useState<ViewState | null>(null)
  const [loading, setLoading] = useState(true)

  // ── fetch on mount / tableId change ──────────────────────────────────────
  useEffect(() => {
    if (!user?.sb_id) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function fetch() {
      setLoading(true)
      const { data, error } = await supabase
        .from('user_table_views')
        .select('view_state')
        .eq('sb_id', user!.sb_id)
        .eq('table_id', tableId)
        .maybeSingle()

      if (cancelled) return

      if (error) {
        console.warn('[useTableSettings] fetch error:', error.message)
        setSettings(null)
      } else {
        setSettings((data?.view_state as ViewState) ?? null)
      }
      setLoading(false)
    }

    void fetch()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId, user?.sb_id])  // user 객체 전체 대신 sb_id만 dep으로 사용 (불필요한 재실행 방지)

  // ── upsert ───────────────────────────────────────────────────────────────
  const upsert = useCallback(async (next: ViewState) => {
    if (!user?.sb_id) return
    const { error } = await supabase
      .from('user_table_views')
      .upsert(
        {
          sb_id: user.sb_id,
          table_id: tableId,
          view_state: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'sb_id,table_id' }
      )
    if (error) console.warn('[useTableSettings] upsert error:', error.message)
  }, [tableId, user?.sb_id])

  const debouncedUpsert = useDebouncedCallback(upsert, 600)

  const updateSettings = useCallback(async (next: ViewState) => {
    setSettings(next)        // optimistic update
    debouncedUpsert(next)
  }, [debouncedUpsert])

  return { settings, updateSettings, loading }
}
