'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ClipboardCheck, Check, X, ChevronDown, ChevronRight, PencilLine, Landmark, Copy, Mail, ExternalLink } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { BudgetEditForwardPanel } from '@/components/BudgetEditForwardPanel'
import { RemarkField } from '@/components/RemarkField'
import { RemarkTrail } from '@/components/RemarkTrail'
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
  // Which proposal has its "edit & send forward" panel open.
  const [editing, setEditing] = useState<string | null>(null)
  // Which proposal has its rejection panel open, and the remark being typed into it. One at a time:
  // the remark belongs to the decision being taken, so it must not leak between rows.
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [remark, setRemark] = useState('')
  // The ad-hoc transfer list has its own pair — a remark typed for a budget proposal must never be
  // submitted against a reallocation that happens to be open on the same screen.
  const [adhocRejecting, setAdhocRejecting] = useState<string | null>(null)
  const [adhocRemark, setAdhocRemark] = useState('')
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

  function approve(p: BudgetProposal, note?: string) {
    decideBudgetProposal(p.id, 'approved', role, note?.trim() || undefined)
    setRejecting(null)
    setRemark('')
    toast.success('Approved — send the Global Accounts sign-off link from the section below')
  }
  /** Approve with the admin's line-item edits applied, and send it ON to Global Accounts. */
  function forwardWithEdits(p: BudgetProposal, items: BudgetProposalItem[], note: string) {
    decideBudgetProposal(p.id, 'approved', role, note || undefined, items)
    setEditing(null)
    setRejecting(null)
    toast.success('Approved with your edits — send the Global Accounts sign-off link below')
  }
  /**
   * Rejection is a two-step inline flow, not a `window.prompt`. The prompt was cancellable into a
   * silent no-op, could not be styled or validated, and — being a native modal — blocks the page
   * outright. A remark is REQUIRED here: the author cannot revise a budget against "rejected".
   */
  function reject(p: BudgetProposal) {
    if (rejecting !== p.id) { setRejecting(p.id); setRemark(''); return }
    if (!remark.trim()) return
    decideBudgetProposal(p.id, 'rejected', role, remark.trim())
    setRejecting(null)
    setRemark('')
    toast.success('Proposal rejected — your reason was sent to the author')
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
                  <button onClick={() => setEditing(editing === p.id ? null : p.id)}
                    aria-expanded={editing === p.id}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg ${editing === p.id ? 'bg-blue-700 text-white border-blue-700' : 'bg-white hover:bg-blue-50 text-blue-700 border-blue-200'}`}>
                    <PencilLine className="w-3.5 h-3.5" /> Edit &amp; Send Forward
                  </button>
                  <button onClick={() => reject(p)}
                    aria-expanded={rejecting === p.id}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg ${rejecting === p.id ? 'bg-red-600 text-white border-red-600' : 'bg-white hover:bg-red-50 text-red-600 border-red-200'}`}>
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                  <button onClick={() => approve(p, rejecting === p.id ? undefined : remark)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Approve → Accounts
                  </button>
                </div>
                {rejecting === p.id && (
                  <div className="border-t border-border px-4 py-3 bg-red-50/30 space-y-2">
                    <RemarkField
                      id={`reject-remark-${p.id}`}
                      label="Reason for rejection"
                      required
                      autoFocus
                      value={remark}
                      onChange={setRemark}
                      placeholder="e.g. The machinery head is 40% above the approved envelope — re-scope and resubmit."
                      hint="Required — the author has to know what to change before resubmitting."
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setRejecting(null); setRemark('') }}
                        className="px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40">
                        Cancel
                      </button>
                      <button onClick={() => reject(p)} disabled={!remark.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                        <X className="w-3.5 h-3.5" /> Confirm rejection
                      </button>
                    </div>
                  </div>
                )}
                {editing === p.id && (
                  <div className="border-t border-border px-4 py-3 bg-blue-50/30">
                    <BudgetEditForwardPanel
                      proposal={p}
                      nextStageLabel="Global Accounts"
                      onForward={(items, note) => forwardWithEdits(p, items, note)}
                    />
                  </div>
                )}
                {isOpen && (
                  <div className="border-t border-border px-4 py-3 bg-muted/30">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                      Proposed FY {p.targetFy} budget · head &amp; sub particulars
                    </p>
                    <BudgetProposalBreakdown proposal={p} />
                    {/* What the plant head wrote when they sent it on. */}
                    <RemarkTrail remarks={p.approvalRemarks} className="mt-4" />
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
                  <button onClick={() => { if (adhocRejecting !== r.id) { setAdhocRejecting(r.id); setAdhocRemark(''); return } }}
                    aria-expanded={adhocRejecting === r.id}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border rounded-lg ${adhocRejecting === r.id ? 'bg-red-600 text-white border-red-600' : 'bg-white hover:bg-red-50 text-red-600 border-red-200'}`}>
                    <X className="w-3.5 h-3.5" /> Reject
                  </button>
                  <button onClick={() => { decideAdhocBudgetRequest(r.id, 'approved', role, adhocRejecting === r.id ? undefined : adhocRemark.trim() || undefined); setAdhocRejecting(null); setAdhocRemark(''); toast.success('Reallocation approved') }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg">
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                </div>
                {adhocRejecting === r.id && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <RemarkField
                      id={`adhoc-reject-remark-${r.id}`}
                      label="Reason for rejection"
                      required
                      autoFocus
                      value={adhocRemark}
                      onChange={setAdhocRemark}
                      placeholder="e.g. The source head has committed spend against that balance this quarter."
                      hint="Required — the requester has to know why the transfer was refused."
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setAdhocRejecting(null); setAdhocRemark('') }}
                        className="px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40">
                        Cancel
                      </button>
                      <button
                        onClick={() => { if (!adhocRemark.trim()) return; decideAdhocBudgetRequest(r.id, 'rejected', role, adhocRemark.trim()); setAdhocRejecting(null); setAdhocRemark(''); toast.success('Reallocation rejected — your reason was recorded') }}
                        disabled={!adhocRemark.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
                        <X className="w-3.5 h-3.5" /> Confirm rejection
                      </button>
                    </div>
                  </div>
                )}
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
