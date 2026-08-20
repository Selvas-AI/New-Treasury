import { useMemo } from 'react'
import { NAV_GROUPS, type NavGroup, type NavItem } from '../../lib/navTree'

/**
 * 메뉴 접근 권한 트리 (세션26차 13일차).
 *
 * ⭐ 왜 트리인가: 권한 부여가 평면 칩이라 **관리자가 체크한 것과 사용자가 실제로 보는
 *   사이드바가 같은지 확인할 방법이 없었다**(2026-08-20 리포트). 라벨도 5건 어긋나 있었고
 *   (`환율 국면` vs `FX 리짐 전략`), 섹션 계층도 사라져 있었다.
 *   이제 `navTree.ts`(사이드바와 동일 SSOT)를 그대로 그린다 — 아이콘·라벨·순서가 같다.
 *
 * 설계 포인트:
 *   · 섹션 체크는 3-state — 전체(☑) / 부분(◪) / 없음(☐)
 *   · **같은 slug 를 공유하는 항목은 묶어서** 보여준다. `daily` 체크 하나가 자금일보 작성과
 *     목록 **둘 다**를 여는데, 과거 UI 는 "자금일보" 하나로만 보여 이걸 알 수 없었다.
 *   · 커스텀 미설정이면 **역할 기본값을 회색 체크로 미리보기** — "미선택 시 역할 기본값
 *     적용"이라는 문장만으로는 실제로 무엇이 열리는지 알 수 없다.
 *   · masterOnly 섹션(관리)은 표시하되 체크박스를 주지 않는다. 사이드바와 같은 그림이어야
 *     "왜 여긴 체크가 없지?"라는 의문이 안 생긴다.
 */
export default function MenuPermissionTree({ selected, roleDefaults, enabled, onChange }: {
  /** 현재 선택된 slug 목록 (커스텀). enabled=false 면 무시된다 */
  selected: string[]
  /** 역할 기본값 slug 목록 — 커스텀 미설정 시 실제로 적용되는 값 */
  roleDefaults: string[]
  /** 커스텀 설정 사용 여부. false 면 읽기 전용으로 역할 기본값을 보여준다 */
  enabled: boolean
  onChange: (next: string[]) => void
}) {
  // 표시 단위 = slug. 같은 slug 항목은 한 행에 묶는다.
  const rows = useMemo(() => NAV_GROUPS.map(g => {
    const bySlug = new Map<string, NavItem[]>()
    for (const i of g.items) {
      const arr = bySlug.get(i.slug) ?? []
      arr.push(i); bySlug.set(i.slug, arr)
    }
    return { group: g, entries: [...bySlug.entries()].map(([slug, items]) => ({ slug, items })) }
  }), [])

  const effective = enabled ? selected : roleDefaults
  const has = (slug: string) => effective.includes(slug)

  function toggle(slug: string) {
    if (!enabled) return
    onChange(selected.includes(slug) ? selected.filter(s => s !== slug) : [...selected, slug])
  }

  function toggleSection(g: NavGroup) {
    if (!enabled || g.masterOnly) return
    const slugs = [...new Set(g.items.map(i => i.slug))]
    const allOn = slugs.every(s => selected.includes(s))
    onChange(allOn
      ? selected.filter(s => !slugs.includes(s))
      : [...new Set([...selected, ...slugs])])
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-600 divide-y divide-gray-100 dark:divide-slate-700">
      {rows.map(({ group, entries }) => {
        const slugs = [...new Set(group.items.map(i => i.slug))]
        const onCount = slugs.filter(has).length
        const state = group.masterOnly ? 'master'
          : onCount === 0 ? 'none' : onCount === slugs.length ? 'all' : 'partial'

        return (
          <div key={group.section} className="px-3 py-2">
            {/* 섹션 헤더 */}
            <div className="flex items-center gap-2">
              {group.masterOnly ? (
                <span className="w-4 text-center text-[11px] text-gray-300 dark:text-slate-600">—</span>
              ) : (
                <button type="button" onClick={() => toggleSection(group)} disabled={!enabled}
                  title={state === 'all' ? '섹션 전체 해제' : '섹션 전체 선택'}
                  className={`w-4 h-4 rounded border text-[10px] leading-none flex items-center justify-center transition-colors
                    ${state === 'all' ? 'bg-indigo-600 border-indigo-600 text-white'
                      : state === 'partial' ? 'bg-indigo-100 border-indigo-400 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-slate-500'}
                    ${enabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                  {state === 'all' ? '✓' : state === 'partial' ? '−' : ''}
                </button>
              )}
              <span className="text-xs font-bold text-gray-700 dark:text-slate-200">{group.section}</span>
              {group.masterOnly && (
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                  master 전용 · 부여 대상 아님
                </span>
              )}
              {!group.masterOnly && (
                <span className="ml-auto text-[10px] text-gray-400">{onCount}/{slugs.length}</span>
              )}
            </div>

            {/* 항목 */}
            <div className="mt-1 space-y-0.5 pl-6">
              {entries.map(({ slug, items }) => {
                const on = has(slug)
                const shared = items.length > 1
                if (group.masterOnly) {
                  return (
                    <div key={slug} className="flex flex-wrap items-center gap-x-2 py-0.5 text-xs text-gray-400 dark:text-slate-500">
                      {items.map(i => <span key={i.to}>{i.icon} {i.label}</span>)}
                    </div>
                  )
                }
                return (
                  <label key={slug}
                    className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1.5 py-1 text-xs transition-colors
                      ${enabled ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/50' : 'cursor-not-allowed'}
                      ${on ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-slate-400'}`}>
                    <input type="checkbox" checked={on} disabled={!enabled}
                      onChange={() => toggle(slug)}
                      className="h-3.5 w-3.5 accent-indigo-600" />
                    {items.map((i, idx) => (
                      <span key={i.to} className="flex items-center gap-1">
                        {idx > 0 && <span className="text-gray-300 dark:text-slate-600">+</span>}
                        <span>{i.icon}</span>
                        <span className={on ? 'font-medium' : ''}>{i.label}</span>
                      </span>
                    ))}
                    <code className="text-[10px] text-gray-400 dark:text-slate-500">{slug}</code>
                    {shared && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400"
                        title="이 화면들은 같은 권한을 공유합니다 — 체크 하나로 함께 열립니다">
                        함께 열림
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
