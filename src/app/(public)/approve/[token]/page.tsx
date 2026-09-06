'use client'

import { useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle2, XCircle, ShieldCheck, FileText, Building2, Landmark, Clock, PencilLine } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { resolveApprovalTarget } from '@/lib/tokenUtils'
import { BudgetEditForwardPanel } from '@/components/BudgetEditForwardPanel'
import { RemarkField } from '@/components/RemarkField'
import { RemarkTrail } from '@/components/RemarkTrail'
import { BudgetProposalBreakdown } from '@/components/BudgetProposalBreakdown'
import { RequestQuotationView } from '@/components/RequestQuotationView'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import { GLOBAL_ACCOUNTS_ACTOR, STATUS_LABELS } from '@/lib/constants'
import {
  BUDGET_PROPOSAL_STATUS_LABELS,
  proposalTotalCr,
} from '@/lib/budgetProposalUtils'

const cr = (n: number) => `₹${n.toFixed(2)} Cr`

function Shell({
  children,
  label = 'Plant Head Approval',
  wide = false,
}: {
  children: React.ReactNode
  label?: string
  /** Request approvals carry a full budget + quotation table and need the extra width. */
  wide?: boolean
}) {
  const width = wide ? 'max-w-4xl' : 'max-w-2xl'
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black flex flex-col">
      <header className="px-5 py-4 border-b border-white/10">
        <div className={`${width} mx-auto flex items-center gap-2 text-white`}>
          <ShieldCheck className="w-5 h-5 text-blue-400" />
          <span className="font-bold tracking-tight">Amber CAPEX</span>
          <span className="text-white/50 text-sm">· {label}</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className={`${width} mx-auto`}>{children}</div>
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
  const [done, setDone] = useState<null | 'approved' | 'rejected' | 'approved_edited'>(null)
  const [editing, setEditing] = useState(false)
  // The approver's remark, sent with EITHER outcome. A rejection without a reason is the failure
  // mode this page exists to remove, so Reject is disabled until something is typed; an approval
  // may carry a condition or a note and is never blocked on one.
  const [remark, setRemark] = useState('')
  const remarkFilled = remark.trim().length > 0

  const target = useMemo(
    () => resolveApprovalTarget(token, requests, budgetProposals),
    [token, requests, budgetProposals],
  )

  // The header label tracks who the link was issued to — plant head or Global Accounts.
  const isAccountsLink = target?.kind === 'budget' && target.stage === 'accounts'
  const shellLabel = isAccountsLink ? 'Global Accounts Sign-off' : 'Plant Head Approval'
  // A decision BURNS the token, so `target` goes null the instant it lands. Remember who the link
  // was issued to while it still resolves, so the confirmation screen keeps the right wording.
  const issuedTo = useRef({ label: shellLabel, accounts: isAccountsLink })
  if (target) issuedTo.current = { label: shellLabel, accounts: isAccountsLink }

  if (!loaded) {
    return (
      <Shell label={shellLabel}>
        <Terminal icon={<Clock className="w-10 h-10 text-muted-foreground" />} title="Loading…" note="Fetching the approval details." />
      </Shell>
    )
  }

  // Checked BEFORE `!target`: every decision burns the token, so by the time this renders the
  // target no longer resolves — showing "Link Invalid or Expired" on top of a successful approval
  // was the bug. A decision made in this session is authoritative, token or not.
  if (done) {
    const cfg = {
      approved: {
        icon: <CheckCircle2 className="w-10 h-10 text-emerald-500" />,
        title: 'Approved',
        note: issuedTo.current.accounts
          ? 'Your sign-off has been recorded and this proposal is now published as the live FY budget.'
          : 'Your approval has been recorded and the workflow has moved forward.',
      },
      rejected: { icon: <XCircle className="w-10 h-10 text-red-500" />, title: 'Rejected', note: 'Your rejection has been recorded.' },
      approved_edited: {
        icon: <CheckCircle2 className="w-10 h-10 text-emerald-500" />,
        title: 'Approved with Edits',
        note: 'Your revised budget has been sent forward to the admin for the next approval. The next approver can see exactly what you changed.',
      },
    }[done]
    return <Shell label={issuedTo.current.label}><Terminal icon={cfg.icon} title={cfg.title} note={cfg.note} /></Shell>
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
    return (
      <Shell wide>
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

          {/* The whole commercial picture — allocated budget, expected cost, and every vendor
              quotation — so the approver is not signing off on numbers they cannot see. */}
          <RequestQuotationView request={r} className="mt-4" />

          {/* Anything an earlier approver wrote on this request, so a decision is never taken
              without the context that produced it. Renders nothing when the trail is empty. */}
          <RemarkTrail remarks={r.approvalRemarks} className="mt-4" />

          <div className="mt-5">
            <RemarkField
              id="plant-head-request-remark"
              label="Your remarks"
              value={remark}
              onChange={setRemark}
              placeholder="e.g. Approved — please negotiate the freight down before award."
              hint="Optional to approve, required to reject. Shown to the requester and to sourcing."
            />
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => { decideRequestPlantHead(r.id, 'approved', remark); setDone('approved') }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve for Sourcing
            </button>
            <button
              onClick={() => { decideRequestPlantHead(r.id, 'rejected', remark); setDone('rejected') }}
              disabled={!remarkFilled}
              title={remarkFilled ? undefined : 'Write a reason above to reject'}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
          {!remarkFilled && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Rejecting needs a reason — the requester has to know what to change before raising it again.
            </p>
          )}
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

        {/* What the earlier approvers said. At the accounts stage this carries the plant head's and
            the admin's remarks — the final signatory is otherwise deciding on the numbers alone. */}
        <RemarkTrail remarks={p.approvalRemarks} className="mt-4" />

        {/* Hidden while the edit panel is open — that panel carries its own remark box, and two
            remark fields on one screen makes it ambiguous which one is actually sent. */}
        {!editing && (
          <div className="mt-5">
            <RemarkField
              id="budget-approval-remark"
              label="Your remarks"
              value={remark}
              onChange={setRemark}
              placeholder={
                isAccountsStage
                  ? 'e.g. Signed off — funded from the FY reserve as discussed.'
                  : 'e.g. Approved, but the automation head must stay within the agreed ceiling.'
              }
              hint={
                isAccountsStage
                  ? 'Optional to approve, required to reject. Recorded against this budget for everyone who opens it.'
                  : 'Optional to approve, required to reject. Shown to the admin and to Global Accounts.'
              }
            />
          </div>
        )}

        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => {
              if (isAccountsStage) decideBudgetAccounts(p.id, 'approved', GLOBAL_ACCOUNTS_ACTOR, remark)
              else decideBudgetPlantHead(p.id, 'approved', remark)
              setDone('approved')
            }}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
          >
            <CheckCircle2 className="w-4 h-4" /> {isAccountsStage ? 'Approve & Publish' : 'Approve Budget'}
          </button>
          {!isAccountsStage && (
            <button
              onClick={() => setEditing(v => !v)}
              aria-expanded={editing}
              className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm border ${editing ? 'bg-blue-700 text-white border-blue-700' : 'bg-white border-blue-200 text-blue-700 hover:bg-blue-50'}`}
            >
              <PencilLine className="w-4 h-4" /> Edit &amp; Send Forward
            </button>
          )}
          <button
            onClick={() => {
              if (isAccountsStage) decideBudgetAccounts(p.id, 'rejected', GLOBAL_ACCOUNTS_ACTOR, remark)
              else decideBudgetPlantHead(p.id, 'rejected', remark)
              setDone('rejected')
            }}
            disabled={editing || !remarkFilled}
            title={remarkFilled ? undefined : 'Write a reason above to reject'}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <XCircle className="w-4 h-4" /> Reject
          </button>
        </div>
        {!editing && !remarkFilled && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Rejecting needs a reason — the author has to know what to fix before resubmitting.
          </p>
        )}

        {editing && !isAccountsStage && (
          <div className="mt-4">
            <BudgetEditForwardPanel
              proposal={p}
              nextStageLabel="Admin"
              onForward={(items, note) => {
                decideBudgetPlantHead(p.id, 'approved', note || undefined, items)
                setDone('approved_edited')
              }}
            />
          </div>
        )}
      </div>
    </Shell>
  )
}
