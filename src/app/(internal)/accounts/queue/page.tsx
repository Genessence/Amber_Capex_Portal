'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { PLANTS } from '@/lib/constants'
import { StatusBadge } from '@/components/StatusBadge'
import {
  resolveFinalVendor,
  totalPaid,
  totalOutstanding,
  isAwardBased,
  awardedInvites,
  isAwardInAccounts,
} from '@/lib/paymentUtils'
import type { CapexRequest, PaymentMilestone, VendorInvite } from '@/lib/types'

const ACTIVE = ['pi_submitted', 'accounts_processing', 'payment_in_progress']

// A queue row is either a single-vendor request, or one AWARD (a winning vendor's fulfillment
// track) of a split-award reverse auction.
interface QueueRow {
  key: string
  req: CapexRequest
  invite?: VendorInvite
}

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}
function plantLabel(v?: string) {
  return PLANTS.find(p => p.value === v)?.label ?? v ?? '—'
}

export default function AccountsQueuePage() {
  const router = useRouter()
  const { requests, invites, vendors } = useCapex()
  const [role, setRole] = useState('')

  useEffect(() => {
    const allowed = (rr: string) => rr === 'accounts' || rr === 'plant_accounts' || rr === 'super_admin'
    const r = localStorage.getItem('capex_role') ?? ''
    if (!allowed(r)) { router.replace('/capex/requests'); return }
    setRole(r)
    const handler = (e: Event) => {
      const next = (e as CustomEvent).detail as string
      setRole(next)
      if (!allowed(next)) router.replace('/capex/requests')
    }
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [router])

  // Build flat row lists: award-based requests emit one row per award (filtered by the award's own
  // status); single-vendor requests emit one row keyed off request.status.
  const { active, completed } = useMemo(() => {
    const activeRows: QueueRow[] = []
    const completedRows: QueueRow[] = []
    for (const req of requests) {
      const reqInvites = invites.filter(i => i.requestId === req.id)
      if (isAwardBased(reqInvites)) {
        for (const inv of awardedInvites(reqInvites)) {
          if (isAwardInAccounts(inv)) activeRows.push({ key: inv.id, req, invite: inv })
          else if (inv.awardStatus === 'completed') completedRows.push({ key: inv.id, req, invite: inv })
        }
      } else if (ACTIVE.includes(req.status)) {
        activeRows.push({ key: req.id, req })
      } else if (req.status === 'completed') {
        completedRows.push({ key: req.id, req })
      }
    }
    return { active: activeRows, completed: completedRows }
  }, [requests, invites])

  if (role !== 'accounts' && role !== 'plant_accounts' && role !== 'super_admin') return null

  const renderRow = ({ key, req, invite }: QueueRow) => {
    const ms: PaymentMilestone[] = (invite ? invite.paymentMilestones : req.paymentMilestones) ?? []
    const po = invite ? invite.purchaseOrder : req.purchaseOrder
    const status = invite ? (invite.awardStatus ?? 'pi_submitted') : req.status
    const vName = invite
      ? vendors.find(v => v.id === invite.vendorId)?.vendorName ?? '—'
      : vendors.find(v => v.id === resolveFinalVendor(req, invites.filter(i => i.requestId === req.id)).invite?.vendorId)?.vendorName ?? '—'
    return (
      <tr key={key} className="border-t border-border hover:bg-muted/30">
        <td className="px-4 py-2">
          <Link href={`/capex/${req.id}`} className="text-sm font-semibold text-primary hover:underline">
            {req.requestNo ?? req.id.slice(0, 8)}
          </Link>
        </td>
        <td className="px-4 py-2 text-sm text-foreground max-w-xs truncate">{req.subject}</td>
        <td className="px-4 py-2 text-sm text-muted-foreground">{plantLabel(req.plant)}</td>
        <td className="px-4 py-2 text-sm text-foreground">{vName}</td>
        <td className="px-4 py-2">
          <StatusBadge status={status} />
        </td>
        <td className="px-4 py-2 text-right text-sm">
          {ms.length > 0 ? (
            <span className="text-muted-foreground">
              Paid <span className="font-semibold text-slate-700">{fmt(totalPaid(ms))}</span>
              {totalOutstanding(ms) > 0 && <> · Due <span className="font-semibold text-foreground">{fmt(totalOutstanding(ms))}</span></>}
            </span>
          ) : po ? fmt(po.amount) : '—'}
        </td>
      </tr>
    )
  }

  const headRow = (
    <tr>
      <th className="text-left px-4 py-2 font-semibold">Request</th>
      <th className="text-left px-4 py-2 font-semibold">Subject</th>
      <th className="text-left px-4 py-2 font-semibold">Plant</th>
      <th className="text-left px-4 py-2 font-semibold">Vendor</th>
      <th className="text-left px-4 py-2 font-semibold">Status</th>
      <th className="text-right px-4 py-2 font-semibold">Payments</th>
    </tr>
  )

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Wallet className="w-5 h-5 text-blue-700" /> Accounts Queue
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Assign FA codes, raise purchase orders, and record milestone payments for finalized requests
          (one row per awarded vendor on split reverse auctions).
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        <section className="space-y-2">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide">In Progress ({active.length})</h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
              Nothing awaiting accounts right now.
            </p>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/60 text-muted-foreground text-[12px] uppercase tracking-wide">{headRow}</thead>
                <tbody>{active.map(renderRow)}</tbody>
              </table>
            </div>
          )}
        </section>

        {completed.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide">Completed ({completed.length})</h2>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/60 text-muted-foreground text-[12px] uppercase tracking-wide">{headRow}</thead>
                <tbody>{completed.map(renderRow)}</tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
