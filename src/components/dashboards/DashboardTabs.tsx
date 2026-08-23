'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface DashboardTab {
  key: string
  label: string
}

/**
 * Tab shell whose active tab lives in `?view=`. Uses `router.replace` so switching tabs does not
 * stack history entries. The first tab is the default — on every role that has tabs, that is the
 * action queue, because the action queue is the point.
 *
 * `toolbar` renders BETWEEN the tab bar and the scrolling panel, outside the scroll container. That
 * position exists for two things the two tabbed dashboards each got wrong in opposite ways: the
 * Sourcing hero band ("Act on this first"), which used to sit ABOVE the tab bar and so read as
 * detached from the tabs it applies to, and the Administration plant lens, which used to be a
 * full-bleed card inside the scrolling Portfolio panel and scrolled away from the figures it scopes.
 * Rendered here, both stay put while the panel scrolls, and both dashboards get the same structure:
 * header → tabs → toolbar → panel. It takes the active key so a toolbar can be tab-specific.
 */
export function DashboardTabs({
  tabs, toolbar, children,
}: {
  tabs: DashboardTab[]
  toolbar?: (active: string) => React.ReactNode
  children: (active: string) => React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const requested = params.get('view')
  const active = tabs.some(t => t.key === requested) ? (requested as string) : tabs[0].key

  // Switching tabs PRESERVES every other query param (e.g. the Sourcing dashboard's `?plant=`
  // lens). Rebuilding the URL as `?view=` alone silently dropped them, so changing tab reset a
  // filter the user had deliberately set — and the figures would widen back to portfolio-wide
  // without anything on screen saying so.
  const go = (key: string) => {
    const next = new URLSearchParams(params.toString())
    next.set('view', key)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : (index - 1 + tabs.length) % tabs.length
    refs.current[next]?.focus()
    go(tabs[next].key)
  }

  const tabId = (key: string) => `dashboard-tab-${key}`
  const panelId = (key: string) => `dashboard-tabpanel-${key}`

  // Resolved before rendering: a toolbar that returns nothing for THIS tab must take no space at
  // all, or every tab without one opens with a phantom gap under the tab bar.
  const toolbarNode = toolbar?.(active)

  return (
    <>
      <div role="tablist" aria-label="Dashboard views" className="flex gap-1 border-b border-border">
        {tabs.map((t, i) => {
          const selected = t.key === active
          return (
            <button
              key={t.key}
              ref={el => { refs.current[i] = el }}
              id={tabId(t.key)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId(t.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => go(t.key)}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                'px-4 py-2.5 min-h-[44px] text-[13px] font-semibold border-b-2 -mb-px transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-t-lg',
                selected
                  ? 'border-[#2563EB] text-[#1D4ED8]'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      {toolbarNode && <div className="shrink-0 pt-3">{toolbarNode}</div>}
      {/* tabIndex=0 makes the scroll container itself focusable — without it a keyboard-only user
          can tab to the links inside but cannot scroll the panel. */}
      <div
        id={panelId(active)}
        role="tabpanel"
        aria-labelledby={tabId(active)}
        tabIndex={0}
        className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-lg"
      >
        {children(active)}
      </div>
    </>
  )
}
