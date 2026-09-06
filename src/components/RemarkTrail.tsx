'use client'

import { MessageSquare } from 'lucide-react'
import type { ApprovalRemark, ApprovalStage } from '@/lib/types'
import {
  APPROVAL_ACTION_COLORS,
  APPROVAL_ACTION_LABELS,
  APPROVAL_STAGE_LABELS,
  remarksForStage,
} from '@/lib/approvalRemarks'

const fmtWhen = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Read-only display of the remark trail an entity has collected across its gates. Rendered on both
 * sides of every handoff — the internal request detail / budget approvals AND the tokenised public
 * pages — because the whole point of collecting a remark is that the NEXT actor reads it.
 *
 * Renders nothing at all when the trail is empty: an "Approval Remarks — none yet" box on a fresh
 * request is noise, not information.
 */
export function RemarkTrail({
  remarks,
  stage,
  title = 'Approval Remarks',
  className = '',
  /** Newest-first (the default) is what an approver wants; the trail is stored oldest-first. */
  newestFirst = true,
  emptyNote,
}: {
  remarks?: ApprovalRemark[]
  /** Optionally narrow to one stage (or a set of them). */
  stage?: ApprovalStage | ApprovalStage[]
  title?: string
  className?: string
  newestFirst?: boolean
  /** When set, an empty trail renders this line instead of nothing. */
  emptyNote?: string
}) {
  const list = stage ? remarksForStage(remarks, stage) : (remarks ?? [])
  const ordered = newestFirst ? [...list].reverse() : list

  if (!ordered.length) {
    if (!emptyNote) return null
    return (
      <div className={className}>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{title}</p>
        <p className="text-sm text-muted-foreground">{emptyNote}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5">
        <MessageSquare className="w-3.5 h-3.5" /> {title} ({ordered.length})
      </p>
      <ul className="space-y-2">
        {ordered.map(r => (
          <li key={r.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  APPROVAL_ACTION_COLORS[r.action] ?? APPROVAL_ACTION_COLORS.noted
                }`}
              >
                {APPROVAL_ACTION_LABELS[r.action] ?? r.action}
              </span>
              <span className="text-xs font-semibold text-foreground">{APPROVAL_STAGE_LABELS[r.stage] ?? r.stage}</span>
              <span className="text-xs text-muted-foreground">· {r.by}</span>
              <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">{fmtWhen(r.at)}</span>
            </div>
            <p className="mt-1.5 text-sm text-foreground whitespace-pre-wrap break-words">{r.text}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
