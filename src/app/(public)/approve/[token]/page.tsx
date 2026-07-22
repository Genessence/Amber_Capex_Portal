'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, XCircle, ShieldCheck, FileText, Building2, Landmark, Clock, RotateCcw } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { resolveApprovalTarget } from '@/lib/tokenUtils'
import { BudgetCorrectionPanel } from '@/components/BudgetCorrectionPanel'
import { BudgetProposalBreakdown } from '@/components/BudgetProposalBreakdown'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import { STATUS_LABELS } from '@/lib/constants'
import {
  BUDGET_PROPOSAL_STATUS_LABELS,
  proposalTotalCr,
} from '@/lib/budgetProposalUtils'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`

function Shell({ children, label = 'Plant Head Approval' }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black flex flex-col">
      <header className="px-5 py-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center gap-2 text-white">
          <ShieldCheck className="w-5 h-5 text-blue-400" />
          <span className="font-bold tracking-tight">Amber CAPEX</span>
          <span className="text-white/50 text-sm">· {label}</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className="max-w-2xl mx-auto">{children}</div>
      </main>
    </div>
  )
}

function Terminal({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className={SUPPLIER_CARD}>
      <div className="flex flex-col items-center text-center gap-3 py-4">
        {icon}
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">{note}</p>
      </div>
    </div>
  )
}

export default function ApprovePage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const {
    requests, budgetProposals, loaded,
    decideRequestPlantHead, decideBudgetPlantHead, decideBudgetAccounts,
  } = useCapex()
  const [done, setDone] = useState<null | 'approved' | 'rejected' | 'sent_back'>(null)
  const [correcting, setCorrecting] = useState(false)

  const target = useMemo(
    () => resolveApprovalTarget(token, requests, budgetProposals),
    [token, requests, budgetProposals],
  )

  // The header label tracks who the link was issued to — plant head or Global Accounts.
  const shellLabel =
    target?.kind === 'budget' && target.stage === 'accounts'
      ? 'Global Accounts Sign-off'
      : 'Plant Head Approval'

  if (!loaded) {
    return (
      <Shell label={shellLabel}>
        <Terminal icon={<Clock className="w-10 h-10 text-muted-foreground" />} title="Loading…" note="Fetching the approval details." />
      </Shell>
    )
  }

  if (!target) {
    return (
      <Shell>
        <Terminal
          icon={<XCircle className="w-10 h-10 text-red-500" />}
          title="Link Invalid or Expired"
          note="This approval link could not be matched to a live request or budget. Please check with the sender."
        />
      </Shell>
    )
  }

  if (done) {
    const cfg = {
      approved: { icon: <CheckCircle2 className="w-10 h-10 text-emerald-500" />, title: 'Approved', note: 'Your approval has been recorded and the workflow has moved forward.' },
      rejected: { icon: <XCircle className="w-10 h-10 text-red-500" />, title: 'Rejected', note: 'Your rejection has been recorded.' },
      sent_back: { icon: <RotateCcw className="w-10 h-10 text-orange-500" />, title: 'Sent Back for Correction', note: 'Your edits and remark were sent to the budget author to revise and resubmit.' },
    }[done]
    return <Shell label={shellLabel}><Terminal icon={cfg.icon} title={cfg.title} note={cfg.note} /></Shell>
  }

  // ── Request approval ──
  if (target.kind === 'request') {
    const r = target.request
    if (r.status !== 'pending_head_approval') {
      const wasRejected = r.status === 'rejected'
      return (
        <Shell>
          <Terminal
            icon={wasRejected ? <XCircle className="w-10 h-10 text-red-500" /> : <CheckCircle2 className="w-10 h-10 text-emerald-500" />}
            title={wasRejected ? 'Rejected' : 'Already Actioned'}
            note={`This request is now "${STATUS_LABELS[r.status] ?? r.status}". No further approval is needed here.`}
          />
        </Shell>
      )
    }
    const lines = r.lineItems ?? []
    return (
      <Shell>
        <div className={SUPPLIER_CARD}>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-blue-700" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Capex Request Approval</span>
          </div>
          <h1 className="text-xl font-bold text-foreground">{r.subject || 'Capex Request'}</h1>
          <p className="text-sm text-muted-foreground">{r.requestNo}</p>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
            <div><span className="text-muted-foreground">Field Type: </span><span className="font-semibold">{FIELD_TYPE_LABELS[r.fieldType ?? 'brown_field']}</span></div>
            <div><span className="text-muted-foreground">Plant: </span><span className="font-semibold">{r.plant ?? '—'}</span></div>
            <div><span className="text-muted-foreground">Category: </span><span className="font-semibold">{r.category || '—'}</span></div>
            <div><span className="text-muted-foreground">Priority: </span><span className="font-semibold capitalize">{r.priority}</span></div>
          </div>

          {r.justification && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Justification</p>
              <p className="text-sm text-foreground whitespace-pre-wrap">{r.justification}</p>
            </div>
          )}

          {lines.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Line Items ({lines.length})</p>
              <div className="rounded-lg border border-border divide-y divide-border">
                {lines.map((li) => (
                  <div key={li.id} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
                    <span className="text-foreground">{li.description || li.masterHead || 'Item'}</span>
                    <span className="text-muted-foreground shrink-0">Qty {li.quantity}{li.uom ? ` ${li.uom}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => { decideRequestPlantHead(r.id, 'approved'); setDone('approved') }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve for Sourcing
            </button>
            <button
              onClick={() => { if (window.confirm('Reject this request? The requester will need to raise it again.')) { decideRequestPlantHead(r.id, 'rejected'); setDone('rejected') } }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  // ── Budget approval (plant-head stage OR the final Global-Accounts sign-off) ──
  const p = target.proposal
  const isAccountsStage = target.stage === 'accounts'
  const requiredStatus = isAccountsStage ? 'pending_accounts' : 'pending_plant_head'
  if (p.status !== requiredStatus) {
    const wasRejected = p.status === 'rejected'
    return (
      <Shell label={shellLabel}>
        <Terminal
          icon={wasRejected ? <XCircle className="w-10 h-10 text-red-500" /> : <CheckCircle2 className="w-10 h-10 text-emerald-500" />}
          title={wasRejected ? 'Rejected' : 'Already Actioned'}
          note={`This budget is now "${BUDGET_PROPOSAL_STATUS_LABELS[p.status] ?? p.status}". No further approval is needed here.`}
        />
      </Shell>
    )
  }
  const total = proposalTotalCr(p)
  return (
    <Shell label={shellLabel}>
      <div className={SUPPLIER_CARD}>
        <div className="flex items-center gap-2 mb-1">
          <Landmark className="w-4 h-4 text-blue-700" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {isAccountsStage ? 'Budget Sign-off · Global Accounts' : 'Budget Approval'}
          </span>
        </div>
        <h1 className="text-xl font-bold text-foreground">FY {p.targetFy} Budget</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {p.plant}</span>
          <span className="uppercase">{p.projectType}</span>
          <span>{p.items.length} line items</span>
          <span className="font-semibold text-foreground tabular-nums">{cr(total)}</span>
        </div>
        {isAccountsStage && (
          <p className="mt-3 text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/20">
            Already approved by the plant head and the admin
            {p.adminDecidedBy ? ` (${p.adminDecidedBy})` : ''}. Your approval is the final gate — it
            publishes this proposal as the live FY {p.targetFy} budget.
          </p>
        )}

        <BudgetProposalBreakdown proposal={p} className="mt-4" />

        <div className="mt-6 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => {
              if (isAccountsStage) decideBudgetAccounts(p.id, 'approved', 'Global Accounts (email)')
              else decideBudgetPlantHead(p.id, 'approved')
              setDone('approved')
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
          >
            <CheckCircle2 className="w-4 h-4" /> {isAccountsStage ? 'Approve & Publish' : 'Approve Budget'}
          </button>
          {!isAccountsStage && (
            <button
              onClick={() => setCorrecting(v => !v)}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm border ${correcting ? 'bg-orange-600 text-white border-orange-600' : 'bg-white border-orange-200 text-orange-700 hover:bg-orange-50'}`}
            >
              <RotateCcw className="w-4 h-4" /> Edit &amp; Send Back
            </button>
          )}
          <button
            onClick={() => {
              if (!window.confirm('Reject this budget? The author will need to revise and resubmit.')) return
              if (isAccountsStage) decideBudgetAccounts(p.id, 'rejected', 'Global Accounts (email)')
              else decideBudgetPlantHead(p.id, 'rejected')
              setDone('rejected')
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm"
          >
            <XCircle className="w-4 h-4" /> Reject
          </button>
        </div>

        {correcting && !isAccountsStage && (
          <div className="mt-4">
            <BudgetCorrectionPanel
              proposal={p}
              onSendBack={(items, note) => { decideBudgetPlantHead(p.id, 'needs_correction', note || undefined, items); setDone('sent_back') }}
            />
          </div>
        )}
      </div>
    </Shell>
  )
}
