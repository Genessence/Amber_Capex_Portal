'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import {
  CheckCircle2,
  XCircle,
  Wallet,
  FileText,
  Download,
  Send,
  Clock,
  Hash,
  Building2,
  ReceiptText,
  Copy,
  Check,
  ExternalLink,
  Mail,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { resolvePoTarget, buildPoIssueLink } from '@/lib/tokenUtils'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import { PLANTS, STATUS_LABELS, GLOBAL_ACCOUNTS_EMAIL, GLOBAL_ACCOUNTS_NAME } from '@/lib/constants'
import {
  totalPaid,
  totalOutstanding,
  deliveryLeadDays,
  expectedFinalPaymentDate,
  finalPaymentBlockedByTrial,
} from '@/lib/paymentUtils'
import type { PaymentMilestone } from '@/lib/types'

/** The actor stamped on every mutation made from this public link (no portal login). */
const PLANT_ACCOUNTS_ACTOR = 'Plant Accounts (email)'

const fmt = (n: number) => '₹' + n.toLocaleString('en-IN')

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black flex flex-col">
      <header className="px-5 py-4 border-b border-white/10">
        <div className="max-w-2xl mx-auto flex items-center gap-2 text-white">
          <Wallet className="w-5 h-5 text-blue-400" />
          <span className="font-bold tracking-tight">Amber CAPEX</span>
          <span className="text-white/50 text-sm">· Plant Accounts</span>
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

/** Compact step rail so the Plant Accounts user always sees where the track stands. */
function Steps({ status }: { status: string }) {
  const order = ['pi_submitted', 'accounts_processing', 'payment_in_progress', 'completed']
  const idx = order.indexOf(status)
  const labels = ['FA codes', `PO (${GLOBAL_ACCOUNTS_NAME})`, 'Payments', 'Done']
  return (
    <ol className="flex items-center gap-1.5 flex-wrap text-[11px] font-semibold">
      {labels.map((l, i) => (
        <li
          key={l}
          className={`px-2 py-1 rounded-full border ${
            idx > i
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : idx === i
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-muted/30 text-muted-foreground border-border'
          }`}
        >
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  )
}

export default function PlantAccountsPage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const { requests, invites, vendors, loaded, assignFaCode, submitFaCodes, markPaymentMade } = useCapex()

  const target = useMemo(
    () => resolvePoTarget(token, requests, invites),
    [token, requests, invites],
  )

  const request = target?.request
  const invite = target?.kind === 'award' ? target.invite : undefined

  const vendor = useMemo(() => {
    if (!target) return undefined
    if (target.kind === 'award') return vendors.find(v => v.id === target.invite.vendorId)
    const reqInvites = invites.filter(i => i.requestId === target.request.id)
    const pick =
      reqInvites.find(i => i.proformaInvoice) ??
      reqInvites.find(i => i.status === 'approved') ??
      reqInvites[0]
    const vid = target.request.finalVendorId ?? pick?.vendorId
    return vid ? vendors.find(v => v.id === vid) : undefined
  }, [target, vendors, invites])

  const lineItems = useMemo(() => {
    if (!request) return []
    const all = request.lineItems ?? []
    if (invite?.awardedItemIds?.length) return all.filter(li => invite.awardedItemIds!.includes(li.id))
    return all
  }, [request, invite])

  const faCodes = useMemo(
    () => (invite ? invite.faCodes : request?.faCodes) ?? {},
    [invite, request],
  )
  const amount = invite?.awardAmount ?? request?.purchaseOrder?.amount ?? request?.budget ?? 0
  const status = (invite ? invite.awardStatus : request?.status) ?? ''
  const existingPo = invite ? invite.purchaseOrder : request?.purchaseOrder
  const poIssued = !!existingPo?.issuedAt
  const milestones: PaymentMilestone[] = (invite ? invite.paymentMilestones : request?.paymentMilestones) ?? []
  const trialRequired = !!(invite ? invite.trialRequired : request?.trialRequired)
  const trialStatus = invite ? invite.trialStatus : request?.trialStatus
  const advancePaidAt = invite ? invite.advancePaidAt : request?.advancePaidAt
  const leadDays = deliveryLeadDays(
    invite ?? invites.find(i => i.requestId === request?.id && i.vendorId === vendor?.id),
  )
  const finalBlocked = finalPaymentBlockedByTrial({ trialRequired, trialStatus })
  const finalDate = expectedFinalPaymentDate(advancePaidAt, leadDays)

  const pi = invite ? invite.proformaInvoice : invites.find(i => i.requestId === request?.id && i.vendorId === vendor?.id)?.proformaInvoice
  const plantLabel = PLANTS.find(p => p.value === request?.plant)?.label ?? request?.plant ?? '—'

  // ── FA-code drafts ──
  const [faDrafts, setFaDrafts] = useState<Record<string, string>>({})
  const faSeeded = useRef(false)
  useEffect(() => {
    if (faSeeded.current || !Object.keys(faCodes).length) return
    faSeeded.current = true
    setFaDrafts(faCodes)
  }, [faCodes])

  const faAssigned = lineItems.length > 0 && lineItems.every(li => !!(faDrafts[li.id] ?? faCodes[li.id])?.trim())

  // ── Satish (Global Accounts) PO-issue handoff ──
  const poIssueToken = invite ? invite.poIssueToken : request?.poIssueToken
  const poIssueLink =
    poIssueToken && typeof window !== 'undefined' ? buildPoIssueLink(poIssueToken) : ''
  const [emailOpen, setEmailOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const reqLabel = request?.requestNo ?? request?.id.slice(0, 8) ?? ''
  const poEmailSubject = `PO Required — ${reqLabel} · ${plantLabel}`
  const poEmailBody = [
    `Dear ${GLOBAL_ACCOUNTS_NAME},`,
    '',
    `Fixed Asset (FA) codes have been assigned for CAPEX request ${reqLabel} (${request?.subject ?? ''}). Please raise the Purchase Order for the finalized vendor using the secure link below — no portal login is required.`,
    '',
    `Plant:  ${plantLabel}`,
    `Vendor: ${vendor?.vendorName ?? '—'}`,
    `Order value: ${fmt(amount)}`,
    '',
    'Ordered items & FA codes:',
    ...lineItems.map(
      (li, i) => `  ${i + 1}. ${li.description} (Qty ${li.quantity}) — FA Code: ${faDrafts[li.id] ?? faCodes[li.id] ?? '—'}`,
    ),
    '',
    'Open this link to issue the PO:',
    poIssueLink || '(link will be ready shortly)',
    '',
    'After you issue the PO: the vendor re-uploads their Proforma Invoice against it, then Plant Accounts record the milestone payments' +
      (trialRequired
        ? ', and the vendor uploads the item trial after the advance is paid (the final payment stays blocked until sourcing approves it).'
        : '.'),
    '',
    'Regards,',
    'Plant Accounts — Amber Enterprises CAPEX Portal',
  ].join('\n')

  function copyPoIssueLink() {
    if (!poIssueLink) return
    navigator.clipboard?.writeText(poIssueLink)
      .then(() => {
        setLinkCopied(true)
        toast.success(`${GLOBAL_ACCOUNTS_NAME}'s PO link copied`)
        setTimeout(() => setLinkCopied(false), 1500)
      })
      .catch(() => toast.error('Could not copy link'))
  }

  function saveFa(lineId: string) {
    if (!request) return
    const code = (faDrafts[lineId] ?? '').trim()
    if (!code || code === faCodes[lineId]) return
    assignFaCode(request.id, lineId, code, invite?.id)
  }

  function submitFa() {
    if (!request || !faAssigned) return
    // Flush any unsaved drafts before advancing so nothing is lost on blur-less submits.
    lineItems.forEach(li => {
      const code = (faDrafts[li.id] ?? '').trim()
      if (code && code !== faCodes[li.id]) assignFaCode(request.id, li.id, code, invite?.id)
    })
    // Mints Satish's PO-issue token in the same state pass, so the email below has its link.
    submitFaCodes(request.id, PLANT_ACCOUNTS_ACTOR, invite?.id)
    setEmailOpen(true)
  }

  if (!loaded) {
    return (
      <Shell>
        <Terminal
          icon={<Clock className="w-10 h-10 text-muted-foreground" />}
          title="Loading…"
          note="Fetching the accounts handoff details."
        />
      </Shell>
    )
  }

  // A PO-issue token resolves to the same request but belongs to Satish's page — never accept it here.
  if (!target || !request || target.stage !== 'plant_accounts') {
    return (
      <Shell>
        <Terminal
          icon={<XCircle className="w-10 h-10 text-red-500" />}
          title="Link Invalid or Expired"
          note="This Plant Accounts link could not be matched to a live request. Please check with the sourcing team."
        />
      </Shell>
    )
  }

  const notReady = !['pi_submitted', 'accounts_processing', 'payment_in_progress', 'completed'].includes(status)
  if (notReady) {
    return (
      <Shell>
        <Terminal
          icon={<Clock className="w-10 h-10 text-muted-foreground" />}
          title="Not Ready for Accounts Yet"
          note={`This request is currently "${STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}". The vendor must submit the Proforma Invoice first.`}
        />
      </Shell>
    )
  }

  const poDocsIssued = existingPo?.poDocuments?.length
    ? existingPo.poDocuments
    : existingPo?.poDocumentBase64 && existingPo?.poDocumentName
      ? [{
          id: 'legacy',
          base64: existingPo.poDocumentBase64,
          name: existingPo.poDocumentName,
          mimeType: existingPo.poDocumentMimeType ?? 'application/octet-stream',
          uploadedAt: existingPo.poDocumentUploadedAt ?? '',
        }]
      : []

  return (
    <Shell>
      <div className={`${SUPPLIER_CARD} space-y-4`}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="w-4 h-4 text-blue-700" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Plant Accounts — FA Codes, PO &amp; Payments
            </span>
          </div>
          <h1 className="text-xl font-bold text-foreground">{request.subject || 'Capex Request'}</h1>
          <p className="text-sm text-muted-foreground">{request.requestNo}</p>
          <div className="mt-3">
            <Steps status={status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Field: </span>
            <span className="font-semibold">{FIELD_TYPE_LABELS[request.fieldType ?? 'brown_field']}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Plant: </span>
            <span className="font-semibold">{plantLabel}</span>
          </div>
          <div className="flex items-center gap-1.5 col-span-2">
            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Vendor: </span>
            <span className="font-semibold">{vendor?.vendorName ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Order value: </span>
            <span className="font-semibold">{fmt(amount)}</span>
          </div>
        </div>

        {pi && (
          <div className="flex items-center gap-2 text-sm bg-muted/30 border border-border rounded-lg px-3 py-2">
            <FileText className="w-4 h-4 text-[#2563EB] shrink-0" />
            <span className="text-foreground">
              Proforma Invoice{pi.amount ? ` · ${fmt(pi.amount)}` : ''}
            </span>
            <a
              href={`data:${pi.mimeType ?? 'application/octet-stream'};base64,${pi.base64}`}
              download={pi.name}
              className="ml-auto flex items-center gap-1 text-primary font-semibold hover:underline min-w-0"
            >
              <Download className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{pi.name}</span>
            </a>
          </div>
        )}

        {/* ── Step 1 · FA codes ── */}
        {lineItems.length > 0 && (
          <div className="border-t border-border pt-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Hash className="w-3.5 h-3.5" /> Ordered items &amp; FA codes
            </p>
            <div className="space-y-1.5">
              {lineItems.map((li, i) => (
                <div
                  key={li.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-2 border border-border rounded-lg px-3 py-2"
                >
                  <label
                    htmlFor={status === 'pi_submitted' ? `fa-${li.id}` : undefined}
                    className="flex-1 text-sm text-foreground min-w-0"
                  >
                    <span className="text-muted-foreground mr-1">{i + 1}.</span>
                    {li.description}
                    <span className="text-muted-foreground"> · Qty {li.quantity}</span>
                  </label>
                  {status === 'pi_submitted' ? (
                    <input
                      id={`fa-${li.id}`}
                      value={faDrafts[li.id] ?? ''}
                      onChange={e => setFaDrafts(d => ({ ...d, [li.id]: e.target.value }))}
                      onBlur={() => saveFa(li.id)}
                      placeholder="FA code"
                      aria-label={`FA code for ${li.description}`}
                      className="w-full sm:w-44 text-sm border border-border rounded-lg px-2.5 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary min-h-[44px]"
                    />
                  ) : (
                    <span className="sm:w-44 text-sm font-mono font-semibold text-foreground">
                      {faCodes[li.id] ?? '—'}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {status === 'pi_submitted' && (
              <>
                <button
                  type="button"
                  onClick={submitFa}
                  disabled={!faAssigned}
                  className="mt-3 w-full flex items-center justify-center gap-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 min-h-[44px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <Send className="w-4 h-4" /> Submit FA codes &amp; continue to PO
                </button>
                {!faAssigned && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground text-center">
                    Assign an FA code to every item to continue.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step 2 · Hand off to Satish (Global Accounts) to issue the PO ── */}
        {status === 'accounts_processing' && !poIssued && (
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <ReceiptText className="w-3.5 h-3.5" /> Purchase Order · with {GLOBAL_ACCOUNTS_NAME} (Global Accounts)
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
              <p className="text-sm font-semibold text-foreground">
                FA codes submitted — {GLOBAL_ACCOUNTS_NAME} raises the PO next.
              </p>
              <p className="text-xs text-muted-foreground">
                Send him the secure link below. He uploads the PO and issues it to the vendor; the
                vendor then re-uploads the Proforma Invoice against it and the payment milestones
                appear here for you.
              </p>
              {poIssueLink && (
                <input
                  readOnly
                  value={poIssueLink}
                  onFocus={e => e.currentTarget.select()}
                  aria-label={`PO-issue link for ${GLOBAL_ACCOUNTS_NAME}`}
                  className="w-full text-xs font-mono border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              )}
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setEmailOpen(true)}
                  disabled={!poIssueLink}
                  className="flex-1 sm:flex-none px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg inline-flex items-center justify-center gap-1.5 min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  <Mail className="w-3.5 h-3.5" /> Preview &amp; send email
                </button>
                <button
                  type="button"
                  onClick={copyPoIssueLink}
                  disabled={!poIssueLink}
                  className="flex-1 sm:flex-none px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center justify-center gap-1.5 min-h-[44px] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {linkCopied ? 'Copied' : 'Copy link'}
                </button>
                {poIssueLink && (
                  <a
                    href={poIssueLink}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 sm:flex-none px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center justify-center gap-1.5 min-h-[44px] text-blue-700 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Issued PO summary ── */}
        {poIssued && existingPo && (
          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-foreground">{existingPo.poNumber}</p>
                <p className="text-xs text-muted-foreground">
                  PO value {fmt(existingPo.amount)} · Issued
                  {existingPo.issuedBy ? ` by ${existingPo.issuedBy}` : ''}
                </p>
              </div>
              {poDocsIssued.length > 0 && (
                <div className="flex flex-col items-start sm:items-end gap-1 min-w-0">
                  {poDocsIssued.map(d => (
                    <a
                      key={d.id}
                      href={`data:${d.mimeType ?? 'application/octet-stream'};base64,${d.base64}`}
                      download={d.name}
                      className="flex items-center gap-1 text-primary font-semibold hover:underline text-sm max-w-full"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{d.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3 · Payment milestones ── */}
        {milestones.length > 0 && (status === 'payment_in_progress' || status === 'completed') && (
          <div className="border-t border-border pt-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Payment Milestones
            </p>
            <div className="space-y-1.5">
              {milestones.map(m => {
                const paid = m.status === 'paid'
                const blocked = !!m.isFinal && finalBlocked
                const locked = paid || blocked || status !== 'payment_in_progress'
                return (
                  <label
                    key={m.id}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${paid ? 'border-slate-200 bg-slate-50' : 'border-border'} ${locked ? '' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={paid}
                      disabled={locked}
                      onChange={() => {
                        if (locked || !request) return
                        markPaymentMade(request.id, m.id, PLANT_ACCOUNTS_ACTOR, invite?.id)
                      }}
                      className="w-4 h-4 accent-slate-600 shrink-0"
                    />
                    <span className="flex-1 text-sm text-foreground min-w-0">
                      {m.label}{' '}
                      <span className="text-muted-foreground">
                        ({m.percent}%{m.trigger ? ` · ${m.trigger}` : ''})
                      </span>
                      {m.isFinal && <span className="ml-1.5 text-[10px] font-bold text-slate-700">FINAL</span>}
                      {m.isFinal && finalDate && (
                        <span className="ml-1.5 text-[10px] font-semibold text-blue-700">
                          · Expected{' '}
                          {finalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      )}
                      {blocked && (
                        <span className="block text-[11px] font-semibold text-amber-700 mt-0.5">
                          Blocked until the item trial is approved by sourcing.
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-mono font-semibold shrink-0">{fmt(m.amount)}</span>
                    {paid && <CheckCircle2 className="w-4 h-4 text-slate-600 shrink-0" />}
                  </label>
                )
              })}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-2">
              <span>
                Paid: <span className="font-semibold text-slate-700">{fmt(totalPaid(milestones))}</span>
              </span>
              <span>
                Outstanding:{' '}
                <span className="font-semibold text-foreground">{fmt(totalOutstanding(milestones))}</span>
              </span>
            </div>
          </div>
        )}

        {status === 'completed' && (
          <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-emerald-800">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> All payments cleared
            {milestones.length > 0 ? ` · ${fmt(totalPaid(milestones))}` : ''}
          </div>
        )}
      </div>

      <EmailPreviewModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title={`PO Request → ${GLOBAL_ACCOUNTS_NAME} (Global Accounts)`}
        defaultTo={GLOBAL_ACCOUNTS_EMAIL}
        subject={poEmailSubject}
        body={poEmailBody}
        link={poIssueLink}
        linkLabel={`Link for ${GLOBAL_ACCOUNTS_NAME} to issue the PO`}
        sendLabel={`Send to ${GLOBAL_ACCOUNTS_NAME}`}
        onSend={to => {
          toast.success(`Email sent to ${to} — he can now issue the PO`)
          setEmailOpen(false)
        }}
      />
    </Shell>
  )
}
