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
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { ROLE_NAMES, PLANTS, FA_CODE_RECIPIENT_EMAIL } from '@/lib/constants'
import { FaEmailModal } from '@/components/FaEmailModal'
import type {
  CapexLineItem,
  CapexRequest,
  PaymentMilestone,
  ProformaInvoice,
  PurchaseOrder,
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
} from '@/lib/paymentUtils'

/** Plant Accounts assigns FA codes per line item, then submits to Global Accounts. */
const PLANT_ACCOUNTS_ROLES = ['plant_accounts', 'super_admin']
/** Global Accounts issues the PO (number + document) to the vendor and ticks payment milestones. */
const GLOBAL_ACCOUNTS_ROLES = ['accounts', 'super_admin']
/** Who may tick payment milestones — global accounts plus sourcing for legacy parity. */
const PAYMENT_ROLES = ['accounts', 'sourcing_member', 'sourcing_head', 'super_admin']

const MAX_PO_DOC_BYTES = 500 * 1024
const PO_DOC_ACCEPT =
  '.pdf,.png,.jpg,.jpeg,.xlsx,.doc,.docx,application/pdf,image/png,image/jpeg,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

type PoDocDraft = {
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
}) {
  const { assignFaCode, submitFaCodes, issuePurchaseOrder, markPaymentMade } = useCapex()
  const actor = ROLE_NAMES[currentRole] ?? currentRole

  const canPlantAccounts = PLANT_ACCOUNTS_ROLES.includes(currentRole)
  const canGlobalAccounts = GLOBAL_ACCOUNTS_ROLES.includes(currentRole)
  const canPay = PAYMENT_ROLES.includes(currentRole) || canGlobalAccounts

  const poIssued = !!po?.issuedAt

  // Stage gates by this track's status — keeps each role's controls live only at the right step.
  const faEditable = canPlantAccounts && status === 'pi_submitted'
  const faAssigned = lineItems.length > 0 && lineItems.every(li => !!faCodes[li.id])
  const showPoForm = canGlobalAccounts && status === 'accounts_processing' && !poIssued

  const [faDrafts, setFaDrafts] = useState<Record<string, string>>(faCodes)
  const [emailOpen, setEmailOpen] = useState(false)

  // FA-code notification email (simulated — no backend). Sent once, after FA codes are submitted.
  const plantLabel = PLANTS.find(p => p.value === request.plant)?.label ?? request.plant ?? '—'
  const reqLabel = request.requestNo ?? request.id.slice(0, 8)
  const emailSubject = `FA Codes — ${reqLabel} · ${plantLabel}`
  const emailBody = [
    'Dear Team,',
    '',
    `Fixed Asset (FA) codes have been assigned for the ordered items on CAPEX request ${reqLabel} (${request.subject}).`,
    '',
    `Plant:  ${plantLabel}`,
    `Vendor: ${vendor?.vendorName ?? '—'}`,
    '',
    'Ordered items & FA codes:',
    ...lineItems.map((li, i) => `  ${i + 1}. ${li.description} (Qty ${li.quantity}) — FA Code: ${(faDrafts[li.id] ?? faCodes[li.id] ?? '—')}`),
    '',
    'Kindly record these FA codes against the corresponding assets.',
    '',
    'Regards,',
    `${actor} — Amber Enterprises CAPEX Portal`,
  ].join('\n')

  const [poNumber, setPoNumber] = useState(
    `PO-${request.requestNo ?? request.id.slice(0, 6)}${inviteId ? '-' + (vendor?.vendorCode ?? vendor?.vendorName?.slice(0, 4) ?? '') : ''}`,
  )
  const [poAmount, setPoAmount] = useState(String(amount || po?.amount || request.budget || ''))
  const [poDoc, setPoDoc] = useState<PoDocDraft | null>(null)
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
    // Open the FA-code email preview; sending it advances the flow (one email per submission).
    setEmailOpen(true)
  }

  function sendFaEmailAndSubmit(to: string) {
    toast.success(`Email sent to ${to}`)
    submitFaCodes(request.id, actor, inviteId)
    setEmailOpen(false)
    toast.success('FA codes submitted — sent to Global Accounts')
  }

  function handlePoDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PO_DOC_BYTES) {
      setPoDocError('File must be under 500 KB')
      setPoDoc(null)
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      setPoDoc({
        base64: result.split(',')[1] ?? '',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
      })
      setPoDocError('')
    }
    reader.readAsDataURL(file)
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
    if (!poDoc) {
      toast.error('Upload the signed PO document')
      return
    }
    const now = new Date().toISOString()
    const newPo: PurchaseOrder = {
      id: `po-${Date.now()}`,
      poNumber: poNumber.trim(),
      vendorId: vendor?.id ?? request.finalVendorId ?? '',
      amount: amt,
      createdAt: now,
      createdBy: actor,
      poDocumentBase64: poDoc.base64,
      poDocumentName: poDoc.name,
      poDocumentMimeType: poDoc.mimeType,
      poDocumentUploadedAt: now,
    }
    const ms: PaymentMilestone[] = buildMilestonesFromVendor(vendor, amt)
    issuePurchaseOrder(request.id, newPo, ms, actor, inviteId)
    toast.success('PO issued — vendor notified')
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-teal-700" />
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
                className="px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card inline-flex items-center gap-1.5"
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
                  · Global Accounts
                </span>
              </p>
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

              {/* PO document upload */}
              <div>
                <label htmlFor={`po-doc-${inviteId ?? 'req'}`} className="block text-[11px] text-muted-foreground mb-1">
                  PO Document <span className="text-muted-foreground/70">(PDF / image / Office · max 500 KB)</span>
                </label>
                <input
                  ref={fileInputRef}
                  id={`po-doc-${inviteId ?? 'req'}`}
                  type="file"
                  accept={PO_DOC_ACCEPT}
                  onChange={handlePoDocFile}
                  className="sr-only"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <Upload className="w-3.5 h-3.5" /> {poDoc ? 'Replace file' : 'Choose file'}
                  </button>
                  <span className="text-xs text-muted-foreground truncate max-w-[16rem]">
                    {poDoc?.name ?? 'No file selected'}
                  </span>
                </div>
                {poDocError && (
                  <p className="mt-1 text-xs text-red-600" role="alert">
                    {poDocError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end">
                <button
                  onClick={issuePo}
                  className="px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> Issue PO to vendor
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {status === 'accounts_processing'
                ? 'Awaiting Global Accounts to issue the PO.'
                : 'Awaiting Plant Accounts to assign FA codes before the PO can be issued.'}
            </p>
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
              {po!.poDocumentBase64 && po!.poDocumentName && (
                <a
                  href={`data:${po!.poDocumentMimeType ?? 'application/octet-stream'};base64,${po!.poDocumentBase64}`}
                  download={po!.poDocumentName}
                  className="flex items-center gap-1 text-primary font-semibold hover:underline text-sm"
                >
                  <Download className="w-3.5 h-3.5" /> {po!.poDocumentName}
                </a>
              )}
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
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${paid ? 'border-emerald-200 bg-emerald-50' : 'border-border'} ${canPay && !paid ? 'cursor-pointer' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={paid}
                          disabled={paid || !canPay}
                          onChange={() => {
                            markPaymentMade(request.id, m.id, actor, inviteId)
                            toast.success(`${m.label} marked paid — vendor notified`)
                          }}
                          className="w-4 h-4 accent-emerald-600"
                        />
                        <span className="flex-1 text-sm text-foreground">
                          {m.label}{' '}
                          <span className="text-muted-foreground">
                            ({m.percent}%{m.trigger ? ` · ${m.trigger}` : ''})
                          </span>
                          {m.isFinal && (
                            <span className="ml-1.5 text-[10px] font-bold text-amber-700">FINAL</span>
                          )}
                        </span>
                        <span className="text-sm font-mono font-semibold">{fmt(m.amount)}</span>
                        {paid && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                      </label>
                    )
                  })}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-2">
                  <span>
                    Paid:{' '}
                    <span className="font-semibold text-emerald-700">{fmt(totalPaid(milestones))}</span>
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
              <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-800">
                <CheckCircle2 className="w-4 h-4" /> All payments cleared · {fmt(totalPaid(milestones))}
              </div>
            )}
          </div>
        )}
      </div>

      <FaEmailModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        defaultTo={FA_CODE_RECIPIENT_EMAIL}
        subject={emailSubject}
        body={emailBody}
        onSend={sendFaEmailAndSubmit}
      />
    </div>
  )
}
