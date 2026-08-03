'use client'

import { Fragment, useMemo } from 'react'
import { PencilLine } from 'lucide-react'
import type { BudgetProposal, BudgetProposalItem } from '@/lib/types'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`

const STAGE_LABEL = { plant_head: 'Plant Head', admin: 'Admin' } as const

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Trail of approver edits made while sending the budget forward. Rendered above the breakdown so
 * the next approver sees at a glance that an earlier approver changed the numbers, and by how much.
 */
function EditTrail({ proposal }: { proposal: BudgetProposal }) {
  const edits = proposal.edits ?? []
  if (!edits.length) return null
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
        <PencilLine className="w-3.5 h-3.5" /> Revised in approval ({edits.length})
      </p>
      {edits.map(e => {
        const delta = e.totalAfterCr - e.totalBeforeCr
        const linesChanged = e.linesAfter !== e.linesBefore
        return (
          <div key={e.id} className="text-[12px] text-blue-900">
            <span className="font-semibold">{STAGE_LABEL[e.stage]}</span>
            <span className="text-blue-800/70">
              {e.by && e.by !== STAGE_LABEL[e.stage] ? ` (${e.by})` : ''} · {fmtWhen(e.at)}
            </span>
            {(delta !== 0 || linesChanged) && (
              <span className="ml-1 tabular-nums">
                — {cr(e.totalBeforeCr)} → <span className="font-semibold">{cr(e.totalAfterCr)}</span>
                {delta !== 0 && ` (${delta > 0 ? '+' : '−'}${cr(Math.abs(delta))})`}
                {linesChanged && `, ${e.linesBefore} → ${e.linesAfter} lines`}
              </span>
            )}
            {e.note && <p className="text-blue-800 italic">“{e.note}”</p>}
          </div>
        )
      })}
    </div>
  )
}

interface HeadGroup {
  head: string
  items: BudgetProposalItem[]
  totalCr: number
}

function groupByHead(items: BudgetProposalItem[]): HeadGroup[] {
  const map = new Map<string, HeadGroup>()
  items.forEach(it => {
    const g = map.get(it.head) ?? { head: it.head, items: [], totalCr: 0 }
    g.items.push(it)
    g.totalCr += it.totalCost || 0
    map.set(it.head, g)
  })
  return [...map.values()].sort((a, b) => a.head.localeCompare(b.head))
}

/**
 * Read-only head → sub-particular breakdown of a budget proposal. Shared by the internal
 * Budget Approvals page (admin + Global Accounts stages) and the public plant-head approval
 * link, so every approver sees the same full line-item detail — not just per-head totals.
 */
export function BudgetProposalBreakdown({
  proposal,
  className = '',
}: {
  proposal: BudgetProposal
  className?: string
}) {
  const groups = useMemo(() => groupByHead(proposal.items), [proposal.items])
  const total = useMemo(() => proposal.items.reduce((s, i) => s + (i.totalCost || 0), 0), [proposal.items])
  const showQty = proposal.items.some(i => i.qty != null)
  // Rate was removed from the budget — approvers review Sub Particulars / Department / Qty / Budget.
  const cols = 2 + (showQty ? 1 : 0) + 1

  if (!proposal.items.length) {
    return (
      <div className={`space-y-2 ${className}`}>
        <EditTrail proposal={proposal} />
        <p className="text-sm text-muted-foreground">This proposal has no budget lines.</p>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <EditTrail proposal={proposal} />
      <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm min-w-[520px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Sub Particulars</th>
            <th className="text-left px-3 py-2 font-semibold">Department</th>
            {showQty && <th className="text-right px-3 py-2 font-semibold w-16">Qty</th>}
            <th className="text-right px-3 py-2 font-semibold w-28">Budget (Cr)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {groups.map(g => (
            <Fragment key={g.head}>
              <tr className="bg-muted/60 border-t border-border">
                <td colSpan={cols - 1} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground">
                  {g.head} <span className="font-medium normal-case text-muted-foreground">· {g.items.length} {g.items.length === 1 ? 'line' : 'lines'}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{cr(g.totalCr)}</td>
              </tr>
              {g.items.map(it => (
                <tr key={it.id}>
                  <td className="px-3 py-2 text-foreground">{it.subParticulars || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{it.department || '—'}</td>
                  {showQty && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{it.qty ?? '—'}</td>}
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{cr(it.totalCost || 0)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[#F4F4F5] font-bold border-t border-border">
            <td colSpan={cols - 1} className="px-3 py-2">Total · {proposal.items.length} lines</td>
            <td className="px-3 py-2 text-right font-mono tabular-nums">{cr(total)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
    </div>
  )
}
