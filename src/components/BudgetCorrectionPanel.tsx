'use client'

import { useState } from 'react'
import { RotateCcw, Plus, Trash2 } from 'lucide-react'
import type { BudgetProposal, BudgetProposalItem } from '@/lib/types'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`
const INPUT =
  'w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none'

function emptyItem(): BudgetProposalItem {
  return { id: `bpi-${crypto.randomUUID()}`, head: 'General', department: '', subParticulars: '', rate: 0, totalCost: 0 }
}

/**
 * Shared "edit + send back for correction" panel for budget approvers (super admin on the internal
 * approvals page, and the plant head on the public email link). The approver may adjust any line's
 * head / sub-particulars / budget (or add / remove lines), add a remark, and send it back to the
 * budget author — who sees the edits + remark and resubmits (restarting from the plant head).
 */
export function BudgetCorrectionPanel({
  proposal,
  onSendBack,
  className = '',
}: {
  proposal: BudgetProposal
  onSendBack: (items: BudgetProposalItem[], note: string) => void
  className?: string
}) {
  const [items, setItems] = useState<BudgetProposalItem[]>(proposal.items)
  const [note, setNote] = useState('')

  const total = items.reduce((s, i) => s + (i.totalCost || 0), 0)
  const patch = (id: string, p: Partial<BudgetProposalItem>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)))

  return (
    <div className={`rounded-xl border border-border bg-card p-4 space-y-3 ${className}`}>
      <div>
        <p className="text-sm font-bold text-foreground">Edit &amp; Send Back for Correction</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Adjust any line or its budget, add a remark, and send it back to the budget author. It restarts from the plant head when they resubmit.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[520px]">
          <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold w-36">Head</th>
              <th className="text-left px-2 py-1.5 font-semibold">Sub Particulars</th>
              <th className="text-right px-2 py-1.5 font-semibold w-28">Budget (Cr)</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-4 text-center text-xs text-muted-foreground">No lines. Add one below.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-t border-border">
                <td className="px-2 py-1">
                  <input value={it.head} onChange={e => patch(it.id, { head: e.target.value })} className={INPUT} aria-label="Head" />
                </td>
                <td className="px-2 py-1">
                  <input value={it.subParticulars} onChange={e => patch(it.id, { subParticulars: e.target.value })} className={INPUT} aria-label="Sub particulars" />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    value={it.totalCost || ''}
                    onChange={e => patch(it.id, { totalCost: parseFloat(e.target.value) || 0 })}
                    className={`${INPUT} text-right font-mono font-semibold`}
                    aria-label="Budget in crore"
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <button onClick={() => setItems(prev => prev.filter(x => x.id !== it.id))} className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded" aria-label="Remove line">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-bold border-t border-border">
              <td colSpan={2} className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right font-mono">{cr(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button
        onClick={() => setItems(prev => [...prev, emptyItem()])}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40"
      >
        <Plus className="w-3.5 h-3.5" /> Add line
      </button>

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Correction remark for the author (optional)…"
        rows={2}
        className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
      />

      <div className="flex justify-end">
        <button
          onClick={() => onSendBack(items, note.trim())}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-orange-600 hover:bg-orange-700 text-white rounded-lg"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Send Back for Correction
        </button>
      </div>
    </div>
  )
}
