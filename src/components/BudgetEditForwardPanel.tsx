'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { BudgetProposal, BudgetProposalItem } from '@/lib/types'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`
const INPUT =
  'w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none'

function emptyItem(): BudgetProposalItem {
  return { id: `bpi-${crypto.randomUUID()}`, head: 'General', department: '', subParticulars: '', rate: 0, totalCost: 0 }
}

/** Are these lines materially different from what the author submitted? */
function isDirty(before: BudgetProposalItem[], after: BudgetProposalItem[]): boolean {
  if (before.length !== after.length) return true
  const key = (it: BudgetProposalItem) =>
    [it.id, it.head, it.department, it.subParticulars, it.qty ?? '', it.totalCost || 0].join(' ')
  const b = before.map(key).sort()
  const a = after.map(key).sort()
  return b.some((k, i) => k !== a[i])
}

/**
 * Shared "edit + send forward" panel for budget approvers — the super admin on the internal
 * approvals page and the plant head on the public email link. The approver may adjust any line's
 * head / department / sub-particulars / qty / budget (or add / remove lines) and send the proposal
 * ON to the next stage carrying those edits, instead of bouncing it back to the author. The edit
 * is recorded on the proposal's audit trail so the next approver can see what changed.
 */
export function BudgetEditForwardPanel({
  proposal,
  nextStageLabel,
  onForward,
  className = '',
}: {
  proposal: BudgetProposal
  /** Where the proposal goes next, e.g. "Admin" or "Global Accounts". Shown on the CTA. */
  nextStageLabel: string
  onForward: (items: BudgetProposalItem[], note: string) => void
  className?: string
}) {
  const [items, setItems] = useState<BudgetProposalItem[]>(proposal.items)
  const [note, setNote] = useState('')

  const total = useMemo(() => items.reduce((s, i) => s + (i.totalCost || 0), 0), [items])
  const original = useMemo(() => proposal.items.reduce((s, i) => s + (i.totalCost || 0), 0), [proposal.items])
  const dirty = useMemo(() => isDirty(proposal.items, items), [proposal.items, items])
  const delta = total - original

  const patch = (id: string, p: Partial<BudgetProposalItem>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...p } : it)))

  return (
    <div className={`rounded-xl border border-border bg-card p-4 space-y-3 ${className}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-foreground">Edit &amp; Send Forward</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Adjust any line or its budget, add a remark, and send the budget on to {nextStageLabel} with your
            edits applied. It does not go back to the author.
          </p>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={() => setItems(proposal.items)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset edits
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm min-w-[620px]">
          <thead className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-2 py-1.5 font-semibold w-36">Head</th>
              <th className="text-left px-2 py-1.5 font-semibold">Sub Particulars</th>
              <th className="text-left px-2 py-1.5 font-semibold w-32">Department</th>
              <th className="text-right px-2 py-1.5 font-semibold w-16">Qty</th>
              <th className="text-right px-2 py-1.5 font-semibold w-28">Budget (Cr)</th>
              <th className="px-2 py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-xs text-muted-foreground">No lines. Add one below.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-t border-border">
                <td className="px-2 py-1">
                  <input value={it.head} onChange={e => patch(it.id, { head: e.target.value })} className={INPUT} aria-label="Head" />
                </td>
                <td className="px-2 py-1">
                  <input value={it.subParticulars} onChange={e => patch(it.id, { subParticulars: e.target.value })} className={INPUT} aria-label="Sub particulars" />
                </td>
                <td className="px-2 py-1">
                  <input value={it.department} onChange={e => patch(it.id, { department: e.target.value })} className={INPUT} aria-label="Department" />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    value={it.qty ?? ''}
                    onChange={e => {
                      const v = e.target.value
                      patch(it.id, { qty: v === '' ? undefined : Math.max(0, parseFloat(v) || 0) })
                    }}
                    className={`${INPUT} text-right tabular-nums`}
                    aria-label="Quantity"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.totalCost || ''}
                    onChange={e => patch(it.id, { totalCost: Math.max(0, parseFloat(e.target.value) || 0) })}
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
              <td colSpan={4} className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right font-mono">{cr(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => setItems(prev => [...prev, emptyItem()])}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40"
        >
          <Plus className="w-3.5 h-3.5" /> Add line
        </button>
        {dirty && (
          <p className="text-[11px] font-semibold tabular-nums">
            <span className="text-muted-foreground">Submitted {cr(original)} → </span>
            <span className={delta > 0 ? 'text-red-600' : delta < 0 ? 'text-emerald-600' : 'text-foreground'}>
              {cr(total)}{delta !== 0 ? ` (${delta > 0 ? '+' : '−'}${cr(Math.abs(delta))})` : ''}
            </span>
          </p>
        )}
      </div>

      <textarea
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder={`Remark for ${nextStageLabel} (optional) — e.g. why you revised a line…`}
        rows={2}
        className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
      />

      <div className="flex justify-end">
        <button
          onClick={() => onForward(items, note.trim())}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
        >
          {dirty ? 'Save Edits & Send to' : 'Approve & Send to'} {nextStageLabel} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
