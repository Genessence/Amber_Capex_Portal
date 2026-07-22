'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ClipboardCheck, Check, X, ChevronDown, ChevronRight, RotateCcw, Landmark, Copy, Mail, ExternalLink } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { BudgetCorrectionPanel } from '@/components/BudgetCorrectionPanel'
import { BudgetProposalBreakdown } from '@/components/BudgetProposalBreakdown'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import { buildApprovalLink } from '@/lib/tokenUtils'
import { PLANTS, ROLE_NAMES, GLOBAL_ACCOUNTS_EMAIL } from '@/lib/constants'
import type { BudgetProposal, BudgetProposalItem } from '@/lib/types'
import { PROJECT_TYPE_LABELS } from '@/lib/greenFieldConstants'
import {
  BUDGET_PROPOSAL_STATUS_COLORS,
  BUDGET_PROPOSAL_STATUS_LABELS,
  proposalTotalCr,
} from '@/lib/budgetProposalUtils'
import { ADHOC_STATUS_COLORS, ADHOC_STATUS_LABELS, effectiveHeadAllocationCr, headUsedCr } from '@/lib/adhocBudgetUtils'

function fmtCr(n: number) {
  return `₹${n.toFixed(2)} Cr`
}
function plantLabel(v: string, custom: { value: string; label: string }[]) {
  return PLANTS.find(p => p.value === v)?.label ?? custom.find(p => p.value === v)?.label ?? v
}

export default function BudgetApprovalsPage() {
  const router = useRouter()
  const {
    capexMaster, customPlants, budgetProposals, decideBudgetProposal,
    adhocBudgetRequests, brownFieldHeadAllocations, usedAmountByMasterItemId, decideAdhocBudgetRequest,
  } = useCapex()
  const [role, setRole] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [correcting, setCorrecting] = useState<string | null>(null)
  // Global Accounts have no portal login — the admin emails them the public sign-off link.
  const [emailFor, setEmailFor] = useState<BudgetProposal | null>(null)

  const isAllowed = (r: string) => r === 'super_admin'

  useEffect(() => {
    const r = localStorage.getItem('capex_role') ?? ''
    if (!isAllowed(r)) { router.replace('/capex/requests'); return }
    setRole(r)
    const handler = (e: Event) => {
      const next = (e as CustomEvent).detail as string
      setRole(next)
      if (!isAllowed(next)) router.replace('/capex/requests')
    }
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [router])

  const isAdmin = role === 'super_admin'

  // Super-admin stage.
  const pending = useMemo(
    () => budgetProposals.filter(p => p.status === 'pending_admin'),
    [budgetProposals],
  )
  // Global-accounts stage (final gate).
  const pendingAccounts = useMemo(
    () => budgetProposals.filter(p => p.status === 'pending_accounts'),
    [budgetProposals],
  )
  const pendingAdhoc = useMemo(
    () => adhocBudgetRequests.filter(r => r.status === 'pending_admin'),
    [adhocBudgetRequests],
  )
  const decided = useMemo(
    () => budgetProposals
      .filter(p => p.status === 'approved' || p.status === 'rejected')
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
      .slice(0, 10),
    [budgetProposals],
  )

  if (!isAllowed(role)) return null

  function approve(p: BudgetProposal) {
    decideBudgetProposal(p.id, 'approved', role)
    toast.success('Approved — send the Global Accounts sign-off link from the section below')
  }
  function sendBackWithEdits(p: BudgetProposal, items: BudgetProposalItem[], note: string) {
    decideBudgetProposal(p.id, 'needs_correction', role, note || undefined, items)
    setCorrecting(null)
    toast.success('Sent back for correction — the author will see your edits')
  }
  function reject(p: BudgetProposal) {
    const note = window.prompt('Reason for rejection (optional):')
    if (note === null) return // cancelled
    decideBudgetProposal(p.id, 'rejected', role, note || undefined)
    toast.success('Proposal rejected')
  }
  function accountsLink(p: BudgetProposal) {
    return p.accountsToken && typeof window !== 'undefined' ? buildApprovalLink(p.accountsToken) : ''
  }
  function copyAccountsLink(p: BudgetProposal) {
    const link = accountsLink(p)
    if (!link) { toast.error('Sign-off link is not ready yet'); return }
    navigator.clipboard?.writeText(link)
      .then(() => toast.success('Global Accounts sign-off link copied'))
      .catch(() => toast.error('Could not copy link'))
  }
  function accountsEmailBody(p: BudgetProposal) {
    return [
      'Dear Global Accounts team,',
      '',
      `A next-FY CAPEX budget has cleared the plant head and admin approvals and needs your final sign-off. Approving it publishes the budget as the live FY ${p.targetFy} master.`,
      '',
      `Plant:    ${plantLabel(p.plant, customPlants)}`,
      `Category: ${PROJECT_TYPE_LABELS[p.projectType]}`,
      `Target FY: ${p.targetFy}${p.sourceFy ? ` (based on FY ${p.sourceFy})` : ''}`,
      `Line items: ${p.items.length}`,
      `Total: ${fmtCr(proposalTotalCr(p))}`,
      p.adminDecidedBy ? `Admin approval: ${p.adminDecidedBy}` : '',
      '',
      'Please review and Approve / Reject using the secure link below (no portal login required):',
      accountsLink(p) || '(link not ready yet)',
      '',
      'Regards,',
      'Amber Enterprises CAPEX Portal',
    ].filter(Boolean).join('\n')
  }
  const fmtCr = (n: number) => `₹${n.toFixed(2)} Cr`

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" /> Budget Approvals
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review next-FY Brown Field budget proposals. Approving publishes the proposal as a new live FY that buyers will use.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        {/* Super-admin stage */}
        {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide">
            With Admin ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
              No proposals awaiting approval.
            </p>
          ) : pending.map(p => {
            const isOpen = expanded === p.id
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(isOpen ? null : p.id)} className="p-1 text-muted-foreground">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {plantLabel(p.plant, customPlants)} · {PROJECT_TYPE_LABELS[p.projectType]} · FY {p.targetFy}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {p.items.length} lines · {fmtCr(proposalTotalCr(p))} · from FY {p.sourceFy ?? '—'} · by {ROLE_NAMES[p.createdBy] ?? p.createdBy}
                    </p>
                  </div>
                  <button onClick={() => setCorrecting(correcting === p.id ? null : p.id)}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg ${correcting === p.id ? 'bg-orange-600 text-white border-orange-600' : 'bg-white hover:bg-orange-50 text-orange-600 border-orange-200'}`}>
                    <RotateCcw className="w-3.5 h-3.5" /> Edit &amp; Send Back
                  </button>
                  <button onClick={() => reject(p)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                  <button onClick={() => approve(p)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Approve → Accounts
                  </button>
                </div>
                {correcting === p.id && (
                  <div className="border-t border-border px-4 py-3 bg-orange-50/30">
                    <BudgetCorrectionPanel proposal={p} onSendBack={(items, note) => sendBackWithEdits(p, items, note)} />
                  </div>
                )}
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 bg-muted/30">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                      Proposed FY {p.targetFy} budget · head &amp; sub particulars
                    </p>
                    <BudgetProposalBreakdown proposal={p} />
                  </div>
                )}
              </div>
            )
          })}
        </section>
        )}

        {/* Global-accounts stage — they have NO portal login. The admin shares the public sign-off
            link (copy / preview email); approving on that page publishes to the live master. */}
        {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5" /> With Global Accounts ({pendingAccounts.length})
          </h2>
          {pendingAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
              No proposals awaiting Global Accounts sign-off.
            </p>
          ) : pendingAccounts.map(p => {
            const isOpen = expanded === p.id
            const link = accountsLink(p)
            return (
              <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <button onClick={() => setExpanded(isOpen ? null : p.id)} className="p-1 text-muted-foreground">
                    {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {plantLabel(p.plant, customPlants)} · {PROJECT_TYPE_LABELS[p.projectType]} · FY {p.targetFy}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      {p.items.length} lines · {fmtCr(proposalTotalCr(p))} · admin-approved by {p.adminDecidedBy ?? '—'}
                    </p>
                  </div>
                  <button onClick={() => copyAccountsLink(p)} disabled={!link}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-muted/40 text-foreground border border-border rounded-lg disabled:opacity-50">
                    <Copy className="w-3.5 h-3.5" /> Copy link
                  </button>
                  <button onClick={() => setEmailFor(p)} disabled={!link}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50">
                    <Mail className="w-3.5 h-3.5" /> Preview email
                  </button>
                  {link && (
                    <a href={link} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-muted/40 text-blue-700 border border-border rounded-lg">
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </a>
                  )}
                </div>
                <div className="px-4 pb-3">
                  <p className="text-[11px] text-muted-foreground">
                    Global Accounts approve or reject on the secure link — approving publishes FY {p.targetFy} as the live budget.
                  </p>
                </div>
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 bg-muted/30">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                      Proposed FY {p.targetFy} budget · head &amp; sub particulars
                    </p>
                    <BudgetProposalBreakdown proposal={p} />
                  </div>
                )}
              </div>
            )
          })}
        </section>
        )}

        {/* Pending adhoc reallocations */}
        {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide">
            Adhoc Reallocations ({pendingAdhoc.length})
          </h2>
          {pendingAdhoc.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
              No adhoc budget transfers awaiting approval.
            </p>
          ) : pendingAdhoc.map(r => {
            const fromAlloc = effectiveHeadAllocationCr(capexMaster, brownFieldHeadAllocations, r.plant, r.fy, r.projectType, r.fromHead)
            const fromUsed = headUsedCr(capexMaster, usedAmountByMasterItemId, r.plant, r.fy, r.projectType, r.fromHead)
            const toAlloc = effectiveHeadAllocationCr(capexMaster, brownFieldHeadAllocations, r.plant, r.fy, r.projectType, r.toHead)
            const toUsed = headUsedCr(capexMaster, usedAmountByMasterItemId, r.plant, r.fy, r.projectType, r.toHead)
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {plantLabel(r.plant, customPlants)} · {PROJECT_TYPE_LABELS[r.projectType]} · FY {r.fy}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      Move <span className="font-semibold">{fmtCr(r.amountCr)}</span> from <span className="font-semibold">{r.fromHead}</span> → <span className="font-semibold">{r.toHead}</span> · by {r.createdBy}
                      {r.reason ? ` · ${r.reason}` : ''}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {r.fromHead}: {fmtCr(fromUsed)} used / {fmtCr(fromAlloc)} → {fmtCr(fromAlloc - r.amountCr)} &nbsp;·&nbsp;
                      {r.toHead}: {fmtCr(toUsed)} used / {fmtCr(toAlloc)} → {fmtCr(toAlloc + r.amountCr)}
                    </p>
                  </div>
                  <button onClick={() => { decideAdhocBudgetRequest(r.id, 'rejected', role, window.prompt('Reason (optional):') ?? undefined); toast.success('Reallocation rejected') }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white hover:bg-red-50 text-red-600 border border-red-200 rounded-lg">
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                  <button onClick={() => { decideAdhocBudgetRequest(r.id, 'approved', role); toast.success('Reallocation approved') }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                </div>
              </div>
            )
          })}
        </section>
        )}

        {/* Recently decided */}
        {decided.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide">Recently Decided</h2>
            <div className="rounded-xl border border-border bg-card divide-y divide-border">
              {decided.map(p => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[p.status]}`}>
                    {BUDGET_PROPOSAL_STATUS_LABELS[p.status]}
                  </span>
                  <span className="text-sm text-foreground flex-1">
                    {plantLabel(p.plant, customPlants)} · {PROJECT_TYPE_LABELS[p.projectType]} · FY {p.targetFy}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{fmtCr(proposalTotalCr(p))}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {emailFor && (
        <EmailPreviewModal
          open={!!emailFor}
          onClose={() => setEmailFor(null)}
          title="Global Accounts Sign-off — Email Preview"
          defaultTo={GLOBAL_ACCOUNTS_EMAIL}
          subject={`Budget Sign-off Needed — ${plantLabel(emailFor.plant, customPlants)} · FY ${emailFor.targetFy}`}
          body={accountsEmailBody(emailFor)}
          link={accountsLink(emailFor)}
          linkLabel="Global Accounts sign-off link"
          sendLabel="Send to Global Accounts"
          onSend={to => { toast.success(`Sign-off email sent to ${to}`); setEmailFor(null) }}
        />
      )}
    </div>
  )
}
