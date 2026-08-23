'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import type { QueueBucket } from '@/lib/kpiQueues'
import { CARD } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'
import { EmptyState } from './layout'
import { fmtCr, fmtDays } from './format'

export interface ActionQueueProps {
  /** Names the region. Rendered visibly only when this queue is NOT already inside a titled band. */
  title: string
  /** `mine` = blocked on this user (blue). `waiting` = blocked on someone else (slate). */
  variant: 'mine' | 'waiting'
  buckets: QueueBucket[]
  emptyText: string
  /**
   * Set false when a `DashboardSection` heading immediately above already says this — a band titled
   * "Waiting on you" wrapping a card labelled "Your approvals" is one box wearing two labels. The
   * `title` still names the region for assistive tech either way.
   */
  showTitle?: boolean
  /** Drops the card surface — for a queue that sits inside a `DashboardSection card`. */
  bare?: boolean
}

export function ActionQueue({
  title, variant, buckets, emptyText, showTitle = true, bare = false,
}: ActionQueueProps) {
  const live = buckets.filter(b => b.count > 0)

  return (
    <section className={bare ? undefined : CARD} aria-label={title}>
      {showTitle && (
        <p className="text-[12px] font-bold tracking-tight text-slate-800 mb-2.5">{title}</p>
      )}
      {live.length === 0 ? (
        <EmptyState>{emptyText}</EmptyState>
      ) : (
        <ul className="space-y-1.5">
          {live.map(b => <BucketRow key={b.key} bucket={b} variant={variant} />)}
        </ul>
      )}
    </section>
  )
}

function BucketRow({ bucket, variant }: { bucket: QueueBucket; variant: 'mine' | 'waiting' }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  const accent = variant === 'mine' ? 'border-l-[#2563EB]' : 'border-l-slate-300'

  return (
    <li className={cn('rounded-lg border border-border border-l-4 bg-card', accent)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-lg"
      >
        <Chevron aria-hidden="true" className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate">
          {bucket.label}
        </span>
        {bucket.amountCr != null && bucket.amountCr > 0 && (
          <span className="text-[11px] font-semibold text-slate-500 shrink-0">{fmtCr(bucket.amountCr)}</span>
        )}
        {bucket.oldestDays != null && (
          <span
            className={cn(
              'text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
              bucket.breached
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-slate-50 text-slate-600 border-slate-200',
            )}
          >
            {bucket.breached ? 'overdue ' : ''}{fmtDays(bucket.oldestDays)}
          </span>
        )}
        <span className="text-sm font-black text-slate-900 tabular-nums shrink-0 w-6 text-right">
          {bucket.count}
        </span>
      </button>

      {open && (
        <ul className="border-t border-border divide-y divide-border">
          {bucket.items
            .slice()
            .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
            .map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 min-h-[44px] text-[12px] hover:bg-[#EBF0FB]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]"
                >
                  <span className="flex-1 min-w-0 truncate text-slate-700">{item.label}</span>
                  {item.sub && <span className="text-slate-400 shrink-0">{item.sub}</span>}
                  <span className="text-slate-400 shrink-0 tabular-nums">{fmtDays(item.ageDays)}</span>
                  <ArrowRight aria-hidden="true" className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </Link>
              </li>
            ))}
          {bucket.href && (
            <li>
              <Link href={bucket.href} className="block px-3 py-2 text-[12px] font-semibold text-primary hover:underline">
                Open the full list →
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}
