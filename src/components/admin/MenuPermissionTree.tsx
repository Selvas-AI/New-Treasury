import { useMemo, useState } from 'react'
import { NAV_GROUPS, type NavGroup, type NavItem } from '../../lib/navTree'
import type { SectionKey, SectionPermission } from '../../types'

const ACTIONS: { key: keyof SectionPermission; label: string }[] = [
  { key: 'view',   label: '조회' },
  { key: 'write',  label: '입력·수정' },
  { key: 'delete', label: '삭제' },
]

/**
 * 메뉴 접근 + 작업 권한 통합 트리 (세션26차 13일차)
 *
 * ⭐ 왜 하나로 합쳤나: 과거엔 `메뉴 접근 / 카테고리 권한 / 작업 권한` 3개 탭이 따로 있어
 *   같은 화면의 권한이 세 곳에 흩어져 있었다. 게다가 메뉴 목록이 평면 칩이라 **관리자가
 *   체크한 것과 사용자가 보는 사이드바가 같은지 확인할 수 없었다**(2026-08-20 리포트).
 *   이제 `navTree.ts`(사이드바와 동일 SSOT)를 그대로 그리고, 각 화면 행에 그 화면의
 *   작업 권한(조회/입력·수정/삭제)을 붙인다 — "이 사람이 이 화면에서 뭘 할 수 있나"를
 *   한 줄에서 읽을 수 있다.
 *
 * ⚠ menu slug 와 작업 권한 섹션은 1:1 이 아니다:
 *   · `history` slug 하나를 `자금 변동 이력`(section: history)과 `이슈 이력`(issue_history)이
 *     공유한다 → **메뉴 체크는 slug 단위로 묶고, 작업 권한은 항목 단위로** 그린다.
 *   · `자금일보 작성`은 한 화면 안에서 `작성`(daily_write)과 `상신·결재`(daily_submit)가
 *     갈린다 → extraSections 로 하위 행을 하나 더 둔다.
 *   · 조회 전용 화면(대시보드·환율 현황·리짐·감사로그)은 section 이 없어 작업 권한 칸이 비고,
 *     "조회 전용"으로 표시한다.
 *
 * ⚠ 카테고리 권한은 **메뉴가 아니라 자금일보 안의 입출금 항목 종류**라 트리로 대체할 수
 *   없다(축이 다르다). 대신 자금일보 작성 행 아래에 접이식으로 붙여 한 화면에서 끝낸다.
 */
export default function MenuPermissionTree({
  selectedMenus, roleDefaultMenus, menuEnabled, onMenuChange,
  actions, roleDefaultActions, actionEnabled, onActionChange,
  categorySlot,
}: {
  selectedMenus: string[]
  roleDefaultMenus: string[]
  menuEnabled: boolean
  onMenuChange: (next: string[]) => void
  /** 커스텀 작업 권한 (action_permissions). actionEnabled=false 면 무시된다 */
  actions: Partial<Record<SectionKey, SectionPermission>>
  roleDefaultActions: Partial<Record<SectionKey, SectionPermission>>
  actionEnabled: boolean
  onActionChange: (next: Partial<Record<SectionKey, SectionPermission>>) => void
  /** 자금일보 작성 행 아래에 끼워 넣을 카테고리 권한 UI */
  categorySlot?: React.ReactNode
}) {
  const [openCat, setOpenCat] = useState(false)

  const rows = useMemo(() => NAV_GROUPS.map(g => {
    const bySlug = new Map<string, NavItem[]>()
    for (const i of g.items) {
      const arr = bySlug.get(i.slug) ?? []
      arr.push(i); bySlug.set(i.slug, arr)
    }
    return { group: g, entries: [...bySlug.entries()].map(([slug, items]) => ({ slug, items })) }
  }), [])

  const effMenus = menuEnabled ? selectedMenus : roleDefaultMenus
  const hasMenu = (slug: string) => effMenus.includes(slug)

  const effActions = actionEnabled ? actions : roleDefaultActions
  const perm = (k: SectionKey): SectionPermission =>
    effActions[k] ?? { view: false, write: false, delete: false }

  function toggleMenu(slug: string) {
    if (!menuEnabled) return
    onMenuChange(selectedMenus.includes(slug)
      ? selectedMenus.filter(s => s !== slug) : [...selectedMenus, slug])
  }

  function toggleSection(g: NavGroup) {
    if (!menuEnabled || g.masterOnly) return
    const slugs = [...new Set(g.items.map(i => i.slug))]
    const allOn = slugs.every(s => selectedMenus.includes(s))
    onMenuChange(allOn
      ? selectedMenus.filter(s => !slugs.includes(s))
      : [...new Set([...selectedMenus, ...slugs])])
  }

  function toggleAction(k: SectionKey, a: keyof SectionPermission) {
    if (!actionEnabled) return
    const cur = actions[k] ?? { view: false, write: false, delete: false }
    const next = { ...cur, [a]: !cur[a] }
    // 조회를 끄면 입력·삭제도 의미가 없다 — 함께 끈다(권한 조합의 모순 방지).
    if (a === 'view' && !next.view) { next.write = false; next.delete = false }
    // 반대로 입력·삭제를 켜면 조회는 당연히 필요하다.
    if ((a === 'write' || a === 'delete') && next[a]) next.view = true
    onActionChange({ ...actions, [k]: next })
  }

  /** 작업 권한 체크박스 3개 — 메뉴 접근이 없으면 의미가 없으므로 비활성 */
  function ActionCells({ k, menuOn, label }: { k: SectionKey; menuOn: boolean; label?: string }) {
    const p = perm(k)
    const disabled = !actionEnabled || !menuOn
    return (
      <span className="flex items-center gap-2">
        {label && <span className="text-[10px] text-gray-400">{label}</span>}
        {ACTIONS.map(a => (
          <label key={a.key}
            className={`flex items-center gap-0.5 text-[10px] ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
              ${p[a.key] ? 'text-emerald-700 dark:text-emerald-400 font-medium' : 'text-gray-400 dark:text-slate-500'}`}
            title={!menuOn ? '메뉴 접근이 없으면 작업 권한은 적용되지 않습니다' : undefined}>
            <input type="checkbox" checked={p[a.key]} disabled={disabled}
              onChange={() => toggleAction(k, a.key)}
              className="h-3 w-3 accent-emerald-600" />
            {a.label}
          </label>
        ))}
      </span>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-600 divide-y divide-gray-100 dark:divide-slate-700">
      {/* 열 머리 */}
      <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:bg-slate-800 dark:text-slate-500">
        <span>메뉴 접근</span>
        <span className="ml-auto">작업 권한 (조회 · 입력·수정 · 삭제)</span>
      </div>

      {rows.map(({ group, entries }) => {
        const slugs = [...new Set(group.items.map(i => i.slug))]
        const onCount = slugs.filter(hasMenu).length
        const state = group.masterOnly ? 'master'
          : onCount === 0 ? 'none' : onCount === slugs.length ? 'all' : 'partial'

        return (
          <div key={group.section} className="px-3 py-2">
            <div className="flex items-center gap-2">
              {group.masterOnly ? (
                <span className="w-4 text-center text-[11px] text-gray-300 dark:text-slate-600">—</span>
              ) : (
                <button type="button" onClick={() => toggleSection(group)} disabled={!menuEnabled}
                  title={state === 'all' ? '섹션 전체 해제' : '섹션 전체 선택'}
                  className={`flex h-4 w-4 items-center justify-center rounded border text-[10px] leading-none transition-colors
                    ${state === 'all' ? 'border-indigo-600 bg-indigo-600 text-white'
                      : state === 'partial' ? 'border-indigo-400 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'border-gray-300 dark:border-slate-500'}
                    ${menuEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
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

            <div className="mt-1 space-y-0.5 pl-6">
              {entries.map(({ slug, items }) => {
                const on = hasMenu(slug)
                const shared = items.length > 1

                if (group.masterOnly) {
                  return (
                    <div key={slug} className="flex flex-wrap items-center gap-x-2 py-0.5 text-xs text-gray-400 dark:text-slate-500">
                      {items.map(i => <span key={i.to}>{i.icon} {i.label}</span>)}
                    </div>
                  )
                }

                const single = items.length === 1 ? items[0] : null

                return (
                  <div key={slug}>
                    {/* 메뉴 체크 행 */}
                    <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-1.5 py-1 text-xs
                      ${on ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-500 dark:text-slate-400'}`}>
                      <label className={`flex items-center gap-1.5 ${menuEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                        <input type="checkbox" checked={on} disabled={!menuEnabled}
                          onChange={() => toggleMenu(slug)} className="h-3.5 w-3.5 accent-indigo-600" />
                        {shared
                          ? <span className="font-medium">{items.map(i => `${i.icon} ${i.label}`).join(' + ')}</span>
                          : <span className={on ? 'font-medium' : ''}>{single!.icon} {single!.label}</span>}
                      </label>
                      <code className="text-[10px] text-gray-400 dark:text-slate-500">{slug}</code>
                      {shared && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400"
                          title="이 화면들은 같은 메뉴 권한을 공유합니다 — 체크 하나로 함께 열립니다">
                          함께 열림
                        </span>
                      )}
                      {/* 항목이 하나뿐이면 작업 권한을 같은 줄에 붙인다 */}
                      {single && single.section && (
                        <span className="ml-auto"><ActionCells k={single.section} menuOn={on} /></span>
                      )}
                      {single && !single.section && (
                        <span className="ml-auto text-[10px] text-gray-300 dark:text-slate-600">조회 전용</span>
                      )}
                    </div>

                    {/* 항목이 여럿이거나 extraSections 가 있으면 하위 행으로 작업 권한을 분리 */}
                    <div className="space-y-0.5 pl-6">
                      {shared && items.map(i => (
                        <div key={i.to} className="flex flex-wrap items-center gap-x-2 py-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                          <span>{i.icon} {i.label}</span>
                          {i.section
                            ? <span className="ml-auto"><ActionCells k={i.section} menuOn={on} /></span>
                            : <span className="ml-auto text-[10px] text-gray-300 dark:text-slate-600">조회 전용</span>}
                        </div>
                      ))}
                      {items.flatMap(i => i.extraSections ?? []).map(ex => (
                        <div key={ex.key} className="flex flex-wrap items-center gap-x-2 py-0.5 text-[11px] text-gray-500 dark:text-slate-400">
                          <span className="text-gray-400">└ {ex.label}</span>
                          <span className="ml-auto"><ActionCells k={ex.key} menuOn={on} /></span>
                        </div>
                      ))}

                      {/* 카테고리 권한 — 메뉴가 아니라 자금일보 안의 입출금 항목 종류라
                          트리로 대체할 수 없다. 해당 화면 아래 접이식으로 둔다. */}
                      {categorySlot && items.some(i => i.hasCategories) && (
                        <div className="py-0.5">
                          <button type="button" onClick={() => setOpenCat(o => !o)}
                            className="text-[11px] text-blue-600 hover:underline dark:text-blue-400">
                            └ 입출금 카테고리 권한 {openCat ? '접기 ▾' : '펼치기 ▸'}
                          </button>
                          {openCat && <div className="mt-1">{categorySlot}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
