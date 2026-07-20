'use client'

import { Fragment, useMemo } from 'react'
import type { BudgetProposal, BudgetProposalItem } from '@/lib/types'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`
const rs = (n: number) => `₹${n.toLocaleString('en-IN')}`

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
  const showRate = proposal.items.some(i => i.rateRs != null)
  const cols = 2 + (showQty ? 1 : 0) + (showRate ? 1 : 0) + 1

  if (!proposal.items.length) {
    return <p className={`text-sm text-muted-foreground ${className}`}>This proposal has no budget lines.</p>
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-border ${className}`}>
      <table className="w-full text-sm min-w-[520px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Sub Particulars</th>
            <th className="text-left px-3 py-2 font-semibold">Department</th>
            {showQty && <th className="text-right px-3 py-2 font-semibold w-16">Qty</th>}
            {showRate && <th className="text-right px-3 py-2 font-semibold w-28">Rate (₹)</th>}
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
                  {showRate && <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{it.rateRs != null ? rs(it.rateRs) : '—'}</td>}
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
  )
}
