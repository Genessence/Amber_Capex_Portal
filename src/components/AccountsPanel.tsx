'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Wallet,
  FileText,
  Download,
  CheckCircle2,
  Hash,
  ReceiptText,
  Upload,
  Clock,
  Send,
  Copy,
  Check,
  ExternalLink,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { ROLE_NAMES, PLANTS, GLOBAL_ACCOUNTS_EMAIL } from '@/lib/constants'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import { buildPoLink } from '@/lib/tokenUtils'
import type {
  CapexLineItem,
  CapexRequest,
  PaymentMilestone,
  ProformaInvoice,
  PurchaseOrder,
  TrialStatus,
  Vendor,
  VendorInvite,
} from '@/lib/types'
import {
  buildMilestonesFromVendor,
  resolveFinalVendor,
  totalOutstanding,
  totalPaid,
  isAwardBased,
  awardedInvites,
  isAwardInAccounts,
  deliveryLeadDays,
  expectedFinalPaymentDate,
  finalPaymentBlockedByTrial,
} from '@/lib/paymentUtils'

/** Plant Accounts assigns FA codes per line item, then submits to Global Accounts. */
const PLANT_ACCOUNTS_ROLES = ['plant_accounts', 'super_admin']
/** Global Accounts issues the PO (number + document) to the vendor and ticks payment milestones. */
const GLOBAL_ACCOUNTS_ROLES = ['accounts', 'super_admin']
/** Who may tick payment milestones — plant + global accounts plus sourcing for legacy parity. */
const PAYMENT_ROLES = ['accounts', 'plant_accounts', 'sourcing_member', 'super_admin']

const MAX_PO_DOC_BYTES = 500 * 1024
const MAX_PO_DOCS = 8
const PO_DOC_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.xlsx,.doc,.docx,application/pdf,image/png,image/jpeg,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

type PoDocDraft = {
  id: string
  base64: string
  name: string
  mimeType: string
}

export function AccountsPanel({
  request,
  invites,
  vendors,
  currentRole,
}: {
  request: CapexRequest
  invites: VendorInvite[]
  vendors: Vendor[]
  currentRole: string
}) {
  const lineItems = request.lineItems ?? []

  // Split-award reverse auction: render one fulfillment track per awarded vendor (each with its own
  // FA codes / PO / payments). Otherwise a single track for the request's finalized vendor.
  if (isAwardBased(invites)) {
    // Only awards that have reached the Accounts stages (PI submitted → completed) show here; awards
    // still awaiting their PI are tracked in the per-award list on the request detail.
    const awards = awardedInvites(invites).filter(
      inv => isAwardInAccounts(inv) || inv.awardStatus === 'completed',
    )
    if (awards.length === 0) return null
    return (
      <div className="space-y-4">
        {awards.map(inv => (
          <AccountsTrack
            key={inv.id}
            request={request}
            currentRole={currentRole}
            inviteId={inv.id}
            vendor={vendors.find(v => v.id === inv.vendorId)}
            pi={inv.proformaInvoice}
            lineItems={lineItems.filter(li => inv.awardedItemIds?.includes(li.id))}
            amount={inv.awardAmount ?? 0}
            faCodes={inv.faCodes ?? {}}
            status={inv.awardStatus ?? 'pi_submitted'}
            po={inv.purchaseOrder}
            milestones={inv.paymentMilestones ?? []}
            advancePaidAt={inv.advancePaidAt}
            leadDays={deliveryLeadDays(inv)}
            trialRequired={inv.trialRequired}
            trialStatus={inv.trialStatus}
            poToken={inv.poToken}
          />
        ))}
      </div>
    )
  }

  const { invite: finalInvite, amount } = resolveFinalVendor(request, invites)
  return (
    <AccountsTrack
      request={request}
      currentRole={currentRole}
      vendor={vendors.find(v => v.id === finalInvite?.vendorId)}
      pi={finalInvite?.proformaInvoice}
      lineItems={lineItems}
      amount={amount}
      faCodes={request.faCodes ?? {}}
      status={request.status}
      po={request.purchaseOrder}
      milestones={request.paymentMilestones ?? []}
      advancePaidAt={request.advancePaidAt}
      leadDays={deliveryLeadDays(finalInvite)}
      trialRequired={request.trialRequired}
      trialStatus={request.trialStatus}
      poToken={request.poToken}
    />
  )
}

/**
 * One fulfillment track — either the whole request (single-vendor) or one award (split auction).
 * All mutations carry the optional `inviteId` so award tracks write per-invite; the stage gates key
 * off `status` (request.status or the award's awardStatus), which share the same string values.
 */
function AccountsTrack({
  request,
  currentRole,
  inviteId,
  vendor,
  pi,
  lineItems,
  amount,
  faCodes,
  status,
  po,
  milestones,
  advancePaidAt,
  leadDays,
  trialRequired,
  trialStatus,
  poToken,
}: {
  request: CapexRequest
  currentRole: string
  inviteId?: string
  vendor?: Vendor
  pi?: ProformaInvoice
  lineItems: CapexLineItem[]
  amount: number
  faCodes: Record<string, string>
  status: string
  po?: PurchaseOrder
  milestones: PaymentMilestone[]
  advancePaidAt?: string
  leadDays?: number
  trialRequired?: boolean
  trialStatus?: TrialStatus
  /** Public Sandeep PO-issue token (emailed link at /po/[token]). */
  poToken?: string
}) {
  const { assignFaCode, submitFaCodes, issuePurchaseOrder, markPaymentMade } = useCapex()
  const actor = ROLE_NAMES[currentRole] ?? currentRole

  // Final payment is blocked until a required trial is approved.
  const finalBlocked = finalPaymentBlockedByTrial({ trialRequired, trialStatus })
  // Delivery lead time (days) → expected final-payment date, anchored on the advance tick.
  const finalDate = expectedFinalPaymentDate(advancePaidAt, leadDays)

  const canPlantAccounts = PLANT_ACCOUNTS_ROLES.includes(currentRole)
  const canGlobalAccounts = GLOBAL_ACCOUNTS_ROLES.includes(currentRole)
  const canPay = PAYMENT_ROLES.includes(currentRole) || canGlobalAccounts

  const poIssued = !!po?.issuedAt

  // Stage gates by this track's status — keeps each role's controls live only at the right step.
  const faEditable = canPlantAccounts && status === 'pi_submitted'
  const faAssigned = lineItems.length > 0 && lineItems.every(li => !!faCodes[li.id])
  // Internal Global Accounts can still issue the PO here; the emailed public /po/[token] page is
  // the primary path for Sandeep (no portal login).
  const showPoForm = canGlobalAccounts && status === 'accounts_processing' && !poIssued

  const [faDrafts, setFaDrafts] = useState<Record<string, string>>(faCodes)
  const [emailOpen, setEmailOpen] = useState(false)
  const [poLinkCopied, setPoLinkCopied] = useState(false)

  // FA-code notification email (simulated — no backend). Sent once, after FA codes are submitted.
  const plantLabel = PLANTS.find(p => p.value === request.plant)?.label ?? request.plant ?? '—'
  const reqLabel = request.requestNo ?? request.id.slice(0, 8)
  // Public link for Sandeep to raise the PO (no login) — not the internal /capex/[id] page.
  const poLink = poToken && typeof window !== 'undefined' ? buildPoLink(poToken) : ''
  const emailSubject = `FA Codes & PO Request — ${reqLabel} · ${plantLabel}`
  const emailBody = [
    'Dear Sandeep,',
    '',
    `Fixed Asset (FA) codes have been assigned for the ordered items on CAPEX request ${reqLabel} (${request.subject}). Please raise the Purchase Order for the finalized vendor.`,
    '',
    `Plant:  ${plantLabel}`,
    `Vendor: ${vendor?.vendorName ?? '—'}`,
    `Order value: ${fmt(amount)}`,
    '',
    'Ordered items & FA codes:',
    ...lineItems.map((li, i) => `  ${i + 1}. ${li.description} (Qty ${li.quantity}) — FA Code: ${(faDrafts[li.id] ?? faCodes[li.id] ?? '—')}`),
    '',
    'Open this link to issue the PO (no portal login required):',
    poLink || '(link will be ready after you send)',
    '',
    'After you issue the PO: the vendor re-uploads the PI against it, then Accounts records milestone payments' +
      (trialRequired ? ', and the vendor uploads the item trial after the advance is paid (final payment waits for trial approval).' : '.'),
    '',
    'Regards,',
    `${actor} — Amber Enterprises CAPEX Portal`,
  ].join('\n')

  const [poNumber, setPoNumber] = useState(
    `PO-${request.requestNo ?? request.id.slice(0, 6)}${inviteId ? '-' + (vendor?.vendorCode ?? vendor?.vendorName?.slice(0, 4) ?? '') : ''}`,
  )
  const [poAmount, setPoAmount] = useState(String(amount || po?.amount || request.budget || ''))
  const [poDocs, setPoDocs] = useState<PoDocDraft[]>([])
  const [poDocError, setPoDocError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function saveFa(lineId: string) {
    const code = (faDrafts[lineId] ?? '').trim()
    if (!code) return
    assignFaCode(request.id, lineId, code, inviteId)
    toast.success('FA code saved')
  }

  function submitFa() {
    if (lineItems.length && !faAssigned) {
      toast.error('Assign an FA code to every line item first')
      return
    }
    if (!poToken) {
      toast.error('PO handoff link is not ready yet — refresh and try again')
      return
    }
    // Open the FA-code email preview; sending it advances the flow (one email per submission).
    setEmailOpen(true)
  }

  function sendFaEmailAndSubmit(to: string) {
    toast.success(`Email sent to ${to}`)
    submitFaCodes(request.id, actor, inviteId)
    setEmailOpen(false)
    toast.success('FA codes submitted — Sandeep can issue the PO from the public link')
  }

  function copyPoLink() {
    if (!poLink) return
    navigator.clipboard?.writeText(poLink)
      .then(() => {
        setPoLinkCopied(true)
        toast.success('Sandeep PO link copied')
        setTimeout(() => setPoLinkCopied(false), 1500)
      })
      .catch(() => toast.error('Could not copy link'))
  }

  function handlePoDocFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    // Cap the number of PO documents so the (single-record) IndexedDB blob store isn't overrun.
    if (poDocs.length + files.length > MAX_PO_DOCS) {
      setPoDocError(`You can attach at most ${MAX_PO_DOCS} PO documents.`)
      e.target.value = ''
      return
    }
    const tooBig = files.find(f => f.size > MAX_PO_DOC_BYTES)
    if (tooBig) {
      setPoDocError(`"${tooBig.name}" is over 500 KB — each file must be under 500 KB.`)
      e.target.value = ''
      return
    }
    setPoDocError('')
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        setPoDocs(prev => [
          ...prev,
          {
            id: `podoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            base64: result.split(',')[1] ?? '',
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
          },
        ])
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  function removePoDoc(id: string) {
    setPoDocs(prev => prev.filter(d => d.id !== id))
  }

  function issuePo() {
    const amt = parseFloat(poAmount)
    if (!poNumber.trim()) {
      toast.error('Enter a PO number')
      return
    }
    if (isNaN(amt) || amt <= 0) {
      toast.error('Enter a valid PO amount')
      return
    }
    if (poDocs.length === 0) {
      toast.error('Upload at least one PO document')
      return
    }
    const now = new Date().toISOString()
    const first = poDocs[0]
    const newPo: PurchaseOrder = {
      id: `po-${Date.now()}`,
      poNumber: poNumber.trim(),
      vendorId: vendor?.id ?? request.finalVendorId ?? '',
      amount: amt,
      createdAt: now,
      createdBy: actor,
      // Keep the first doc in the legacy single-doc fields for back-compat; full set in poDocuments.
      poDocumentBase64: first.base64,
      poDocumentName: first.name,
      poDocumentMimeType: first.mimeType,
      poDocumentUploadedAt: now,
      poDocuments: poDocs.map(d => ({ id: d.id, base64: d.base64, name: d.name, mimeType: d.mimeType, uploadedAt: now })),
    }
    const ms: PaymentMilestone[] = buildMilestonesFromVendor(vendor, amt)
    issuePurchaseOrder(request.id, newPo, ms, actor, inviteId)
    toast.success(`PO issued (${poDocs.length} document${poDocs.length !== 1 ? 's' : ''}) — vendor notified`)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-blue-700" />
        <div>
          <h3 className="font-bold text-foreground">
            {inviteId ? `Award — ${vendor?.vendorName ?? 'Vendor'}` : 'Accounts — FA Codes, PO & Payments'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {inviteId ? 'Awarded vendor' : 'Finalized vendor'}:{' '}
            <span className="font-semibold text-foreground">{vendor?.vendorName ?? '—'}</span> · Order
            value {fmt(amount)}
          </p>
        </div>
      </div>

      {/* Proforma Invoice */}
      {pi && (
        <div className="flex items-center gap-2 text-sm bg-muted/30 border border-border rounded-lg px-3 py-2">
          <FileText className="w-4 h-4 text-[#2563EB]" />
          <span className="text-foreground">
            Proforma Invoice{pi.amount ? ` · ${fmt(pi.amount)}` : ''}
          </span>
          <a
            href={`data:${pi.mimeType ?? 'application/octet-stream'};base64,${pi.base64}`}
            download={pi.name}
            className="ml-auto flex items-center gap-1 text-primary font-semibold hover:underline"
          >
            <Download className="w-3.5 h-3.5" /> {pi.name}
          </a>
        </div>
      )}

      {/* ── Plant Accounts: FA codes ── */}
      {lineItems.length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <Hash className="w-3.5 h-3.5" /> FA Codes
            <span className="ml-1 normal-case font-normal text-[11px] text-muted-foreground/80">
              · Plant Accounts
            </span>
          </p>
          <div className="space-y-1.5">
            {lineItems.map(li => {
              const faInputId = `fa-${inviteId ?? 'req'}-${li.id}`
              return (
                <div key={li.id} className="flex items-center gap-2">
                  <label
                    htmlFor={faEditable ? faInputId : undefined}
                    className="flex-1 text-sm text-foreground truncate"
                  >
                    {li.description}
                  </label>
                  {faEditable ? (
                    <input
                      id={faInputId}
                      value={faDrafts[li.id] ?? ''}
                      onChange={e => setFaDrafts(d => ({ ...d, [li.id]: e.target.value }))}
                      onBlur={() => saveFa(li.id)}
                      placeholder="FA code"
                      aria-label={`FA code for ${li.description}`}
                      className="w-40 text-sm border border-border rounded-lg px-2.5 py-1 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  ) : (
                    <span className="w-40 text-sm font-mono text-foreground">
                      {faCodes[li.id] ?? '—'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Submit FA codes (plant accounts, awaiting handoff) */}
          {canPlantAccounts && status === 'pi_submitted' && (
            <div className="mt-3 flex items-center justify-end">
              <button
                onClick={submitFa}
                disabled={lineItems.length > 0 && !faAssigned}
                className="px-3 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Submit FA codes
              </button>
            </div>
          )}
          {!canPlantAccounts && status === 'pi_submitted' && (
            <p className="mt-3 text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-4 h-4" /> Awaiting Plant Accounts to assign FA codes.
            </p>
          )}
        </div>
      )}

      {/* ── Global Accounts: Purchase Order ── */}
      <div className="border-t border-border pt-3">
        {!poIssued ? (
          showPoForm ? (
            <div className="space-y-3">
              <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <ReceiptText className="w-3.5 h-3.5" /> Issue Purchase Order
                <span className="ml-1 normal-case font-normal text-[11px] text-muted-foreground/80">
                  · Global Accounts (Sandeep)
                </span>
              </p>

              {/* Link emailed to Sandeep — copy so the flow can continue in another tab/role */}
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  Link for Sandeep to raise the PO
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={poLink}
                    onFocus={e => e.currentTarget.select()}
                    aria-label="Request URL for Global Accounts"
                    className="flex-1 text-xs font-mono border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary min-w-0"
                  />
                  <button
                    type="button"
                    onClick={copyPoLink}
                    className="px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {poLinkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {poLinkCopied ? 'Copied' : 'Copy URL'}
                  </button>
                  <a
                    href={poLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-primary text-blue-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open
                  </a>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Public link (no login) — or issue the PO below as Global Accounts.
                </p>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={`po-number-${inviteId ?? 'req'}`} className="block text-[11px] text-muted-foreground mb-1">
                    PO Number
                  </label>
                  <input
                    id={`po-number-${inviteId ?? 'req'}`}
                    value={poNumber}
                    onChange={e => setPoNumber(e.target.value)}
                    className="w-44 text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label htmlFor={`po-amount-${inviteId ?? 'req'}`} className="block text-[11px] text-muted-foreground mb-1">
                    Amount (₹)
                  </label>
                  <input
                    id={`po-amount-${inviteId ?? 'req'}`}
                    type="number"
                    value={poAmount}
                    onChange={e => setPoAmount(e.target.value)}
                    className="w-40 text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* PO document upload (multiple allowed) */}
              <div>
                <label htmlFor={`po-doc-${inviteId ?? 'req'}`} className="block text-[11px] text-muted-foreground mb-1">
                  PO Documents <span className="text-muted-foreground/70">(PDF / image / Office · max 500 KB each · multiple allowed)</span>
                </label>
                <input
                  ref={fileInputRef}
                  id={`po-doc-${inviteId ?? 'req'}`}
                  type="file"
                  multiple
                  accept={PO_DOC_ACCEPT}
                  onChange={handlePoDocFiles}
                  className="sr-only"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Upload className="w-3.5 h-3.5" /> Add file{poDocs.length ? 's' : ''}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {poDocs.length ? `${poDocs.length} file${poDocs.length !== 1 ? 's' : ''} selected` : 'No files selected'}
                  </span>
                </div>
                {poDocs.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {poDocs.map(d => (
                      <li key={d.id} className="flex items-center gap-2 text-xs text-foreground bg-muted/20 border border-border rounded-lg px-2.5 py-1.5">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{d.name}</span>
                        <button type="button" onClick={() => removePoDoc(d.id)} className="text-red-600 hover:underline shrink-0">Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                {poDocError && (
                  <p className="mt-1 text-xs text-red-600" role="alert">
                    {poDocError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={issuePo}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Issue PO to vendor
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-4 h-4 shrink-0" />
                {status === 'accounts_processing'
                  ? 'Awaiting Sandeep (Global Accounts) to issue the PO from the public link.'
                  : 'Awaiting Plant Accounts to assign FA codes before the PO can be issued.'}
              </p>
              {status === 'accounts_processing' && poLink && (
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    Public PO link for Sandeep (no login)
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      readOnly
                      value={poLink}
                      onFocus={e => e.currentTarget.select()}
                      aria-label="Public PO link for Global Accounts"
                      className="flex-1 min-w-[12rem] text-xs font-mono border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={copyPoLink}
                      className="px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {poLinkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      {poLinkCopied ? 'Copied' : 'Copy URL'}
                    </button>
                    <a
                      href={poLink}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 shrink-0 text-blue-700 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </a>
                  </div>
                  <ol className="text-[11px] text-muted-foreground list-decimal list-inside space-y-0.5">
                    <li>Sandeep issues the PO on the public page</li>
                    <li>Vendor re-uploads the PI against the PO</li>
                    <li>Accounts records milestone payments</li>
                    {trialRequired && (
                      <li>After the advance is paid, vendor uploads the trial — final payment waits for sourcing approval</li>
                    )}
                  </ol>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-foreground">{po!.poNumber}</p>
                <p className="text-xs text-muted-foreground">
                  PO value {fmt(po!.amount)} · Issued
                  {po!.issuedBy ? ` by ${po!.issuedBy}` : ''}
                </p>
              </div>
              {(() => {
                const docs = po!.poDocuments?.length
                  ? po!.poDocuments
                  : po!.poDocumentBase64 && po!.poDocumentName
                    ? [{ id: 'legacy', base64: po!.poDocumentBase64, name: po!.poDocumentName, mimeType: po!.poDocumentMimeType ?? 'application/octet-stream', uploadedAt: po!.poDocumentUploadedAt ?? '' }]
                    : []
                if (!docs.length) return null
                return (
                  <div className="flex flex-col items-end gap-1">
                    {docs.map(d => (
                      <a
                        key={d.id}
                        href={`data:${d.mimeType ?? 'application/octet-stream'};base64,${d.base64}`}
                        download={d.name}
                        className="flex items-center gap-1 text-primary font-semibold hover:underline text-sm"
                      >
                        <Download className="w-3.5 h-3.5" /> {d.name}
                      </a>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* ── Global Accounts: Payment milestones ── */}
            {milestones.length > 0 && status === 'payment_in_progress' && (
              <div>
                <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  Payment Milestones
                </p>
                <div className="space-y-1.5">
                  {milestones.map(m => {
                    const paid = m.status === 'paid'
                    const blocked = !!m.isFinal && finalBlocked
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${paid ? 'border-slate-200 bg-slate-50' : 'border-border'} ${canPay && !paid && !blocked ? 'cursor-pointer' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={paid}
                          disabled={paid || !canPay || blocked}
                          onChange={() => {
                            if (blocked) return
                            markPaymentMade(request.id, m.id, actor, inviteId)
                            toast.success(`${m.label} marked paid — vendor notified`)
                          }}
                          className="w-4 h-4 accent-slate-600"
                        />
                        <span className="flex-1 text-sm text-foreground">
                          {m.label}{' '}
                          <span className="text-muted-foreground">
                            ({m.percent}%{m.trigger ? ` · ${m.trigger}` : ''})
                          </span>
                          {m.isFinal && (
                            <span className="ml-1.5 text-[10px] font-bold text-slate-700">FINAL</span>
                          )}
                          {m.isFinal && finalDate && (
                            <span className="ml-1.5 text-[10px] font-semibold text-blue-700">
                              · Expected {finalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                          )}
                          {blocked && (
                            <span className="block text-[11px] font-semibold text-amber-700 mt-0.5">
                              Blocked until the item trial is approved by sourcing.
                            </span>
                          )}
                        </span>
                        <span className="text-sm font-mono font-semibold">{fmt(m.amount)}</span>
                        {paid && <CheckCircle2 className="w-4 h-4 text-slate-600" />}
                      </label>
                    )
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>
                    Paid:{' '}
                    <span className="font-semibold text-slate-700">{fmt(totalPaid(milestones))}</span>
                  </span>
                  <span>
                    Outstanding:{' '}
                    <span className="font-semibold text-foreground">
                      {fmt(totalOutstanding(milestones))}
                    </span>
                  </span>
                </div>
              </div>
            )}

            {/* Completed summary */}
            {status === 'completed' && milestones.length > 0 && (
              <div className="flex items-center gap-2 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800">
                <CheckCircle2 className="w-4 h-4" /> All payments cleared · {fmt(totalPaid(milestones))}
              </div>
            )}
          </div>
        )}
      </div>

      <EmailPreviewModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="FA Codes → Global Accounts (Sandeep)"
        defaultTo={GLOBAL_ACCOUNTS_EMAIL}
        subject={emailSubject}
        body={emailBody}
        link={poLink}
        linkLabel="Link for Sandeep to raise the PO"
        sendLabel="Send to Sandeep"
        onSend={sendFaEmailAndSubmit}
      />
    </div>
  )
}
