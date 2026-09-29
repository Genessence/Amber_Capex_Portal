'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Wallet,
  FileText,
  Download,
  CheckCircle2,
  Hash,
  ReceiptText,
  Clock,
  Copy,
  Check,
  ExternalLink,
  Mail,
} from 'lucide-react'
import { PLANTS, PLANT_ACCOUNTS_EMAIL, GLOBAL_ACCOUNTS_EMAIL, GLOBAL_ACCOUNTS_NAME } from '@/lib/constants'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import { buildPoLink, buildPoIssueLink } from '@/lib/tokenUtils'
import type {
  CapexLineItem,
  CapexRequest,
  ProformaInvoice,
  PurchaseOrder,
  TrialStatus,
  Vendor,
  VendorInvite,
} from '@/lib/types'
import {
  resolveFinalVendor,
  resolveOrderValue,
  isAwardBased,
  awardedInvites,
  isAwardInAccounts,
} from '@/lib/paymentUtils'

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

/**
 * Internal Accounts view. The Plant Accounts team has **no portal login** — FA codes happen on the
 * emailed public `/po/[token]` page and the PO issue on Global Accounts' `/po-issue/[token]` page;
 * the track ends when the vendor re-uploads the PI against the PO (no payment milestones, 2026-09). This panel is
 * therefore a READ-ONLY tracker plus the handoff affordance (copy link + email preview), mirroring
 * the plant-head approval pattern.
 */
export function AccountsPanel({
  request,
  invites,
  vendors,
}: {
  request: CapexRequest
  invites: VendorInvite[]
  vendors: Vendor[]
  /** Kept for call-site compatibility — the panel is read-only for every internal role. */
  currentRole?: string
}) {
  const lineItems = request.lineItems ?? []

  // Split-award reverse auction: one fulfillment track per awarded vendor (each with its own FA
  // codes / PO / payments). Otherwise a single track for the request's finalized vendor.
  if (isAwardBased(invites)) {
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
            inviteId={inv.id}
            vendor={vendors.find(v => v.id === inv.vendorId)}
            pi={inv.proformaInvoice}
            lineItems={lineItems.filter(li => inv.awardedItemIds?.includes(li.id))}
            /* One resolver for the order value across the internal tracker and both public PO
               pages — this used to inline `inv.awardAmount ?? 0`, dropping the issued PO's own
               amount that `resolveOrderValue` falls back to. */
            amount={resolveOrderValue(request, invites, inv)}
            faCodes={inv.faCodes ?? {}}
            status={inv.awardStatus ?? 'pi_submitted'}
            po={inv.purchaseOrder}
            piReuploadedAt={inv.piReuploadedAt}
            trialRequired={inv.trialRequired}
            trialStatus={inv.trialStatus}
            poToken={inv.poToken}
            poIssueToken={inv.poIssueToken}
          />
        ))}
      </div>
    )
  }

  const { invite: finalInvite, amount } = resolveFinalVendor(request, invites)
  return (
    <AccountsTrack
      request={request}
      vendor={vendors.find(v => v.id === finalInvite?.vendorId)}
      pi={finalInvite?.proformaInvoice}
      lineItems={lineItems}
      amount={amount}
      faCodes={request.faCodes ?? {}}
      status={request.status}
      po={request.purchaseOrder}
      piReuploadedAt={request.piReuploadedAt}
      trialRequired={request.trialRequired}
      trialStatus={request.trialStatus}
      poToken={request.poToken}
      poIssueToken={request.poIssueToken}
    />
  )
}

/**
 * Which off-portal team owns each fulfillment stage, and the copy shown alongside their link.
 * `pi_submitted` is Plant Accounts' (`/po/[token]`); `accounts_processing` is Global Accounts' PO
 * issue (`/po-issue/[token]`, emailed by Plant Accounts on FA submit); `payment_in_progress` (the
 * key is kept for data compatibility) now means "PO issued — the vendor re-uploads the PI".
 */
const STAGE_HINT: Record<string, string> = {
  pi_submitted: 'Awaiting Plant Accounts to assign FA codes on the emailed link.',
  accounts_processing: `FA codes submitted — awaiting ${GLOBAL_ACCOUNTS_NAME} (Global Accounts) to issue the PO on the emailed link.`,
  payment_in_progress: 'PO issued — awaiting the vendor to re-upload the Proforma Invoice against it.',
  completed: 'Order complete — the vendor re-uploaded the PI against the PO.',
}

/**
 * One fulfillment track — either the whole request (single-vendor) or one award (split auction).
 * Read-only: the actionable surface is the public Plant-Accounts page at /po/[token].
 */
function AccountsTrack({
  request,
  inviteId,
  vendor,
  pi,
  lineItems,
  amount,
  faCodes,
  status,
  po,
  piReuploadedAt,
  trialRequired,
  trialStatus,
  poToken,
  poIssueToken,
}: {
  request: CapexRequest
  inviteId?: string
  vendor?: Vendor
  pi?: ProformaInvoice
  lineItems: CapexLineItem[]
  amount: number
  faCodes: Record<string, string>
  status: string
  po?: PurchaseOrder
  /** When the vendor re-uploaded the PI against the issued PO — the last step of the track. */
  piReuploadedAt?: string
  trialRequired?: boolean
  trialStatus?: TrialStatus
  /** Public Plant-Accounts token (emailed link at /po/[token]). */
  poToken?: string
  /** Public Global-Accounts PO-issue token (emailed link at /po-issue/[token]). */
  poIssueToken?: string
}) {
  const [emailOpen, setEmailOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const poIssued = !!po?.issuedAt

  const plantLabel = PLANTS.find(p => p.value === request.plant)?.label ?? request.plant ?? '—'
  const reqLabel = request.requestNo ?? request.id.slice(0, 8)
  // Accounts only hold the ball until the PO is issued; after that the vendor re-uploads the PI.
  const trackOpen = status === 'pi_submitted' || (status === 'accounts_processing' && !poIssued)

  // Which team's link is live right now. FA codes are Plant Accounts'; the PO issue after that
  // belongs to Global Accounts ("Satish"), who gets his own token/page.
  const isPoIssueStage = status === 'accounts_processing' && !poIssued
  const link = isPoIssueStage
    ? (poIssueToken && typeof window !== 'undefined' ? buildPoIssueLink(poIssueToken) : '')
    : (poToken && typeof window !== 'undefined' ? buildPoLink(poToken) : '')
  const recipientName = isPoIssueStage ? `${GLOBAL_ACCOUNTS_NAME} (Global Accounts)` : 'Plant Accounts'
  const recipientEmail = isPoIssueStage ? GLOBAL_ACCOUNTS_EMAIL : PLANT_ACCOUNTS_EMAIL

  const itemLines = lineItems.map(
    (li, i) => `  ${i + 1}. ${li.description} (Qty ${li.quantity})${faCodes[li.id] ? ` — FA Code: ${faCodes[li.id]}` : ''}`,
  )
  const emailSubject = isPoIssueStage
    ? `PO Required — ${reqLabel} · ${plantLabel}`
    : `Plant Accounts Action Needed — ${reqLabel} · ${plantLabel}`
  const emailBody = (isPoIssueStage
    ? [
        `Dear ${GLOBAL_ACCOUNTS_NAME},`,
        '',
        `Fixed Asset (FA) codes have been assigned for CAPEX request ${reqLabel} (${request.subject}). Please raise the Purchase Order for the finalized vendor using the secure link below — no portal login is required.`,
        '',
        `Plant:  ${plantLabel}`,
        `Vendor: ${vendor?.vendorName ?? '—'}`,
        `Order value: ${fmt(amount)}`,
        '',
        'Ordered items & FA codes:',
        ...itemLines,
        '',
        'Open this link to issue the PO:',
        link || '(link not ready yet)',
        '',
        'After you issue the PO, the vendor re-uploads their Proforma Invoice against it' +
          (trialRequired
            ? ' and uploads the item trial for sourcing approval — then the order is complete.'
            : ' — that completes the order.'),
      ]
    : [
        'Dear Plant Accounts team,',
        '',
        `CAPEX request ${reqLabel} (${request.subject}) has reached the accounts stage. Please assign the Fixed Asset (FA) codes using the secure link below — no portal login is required — and email ${GLOBAL_ACCOUNTS_NAME} the PO link from that same page.`,
        '',
        `Plant:  ${plantLabel}`,
        `Vendor: ${vendor?.vendorName ?? '—'}`,
        `Order value: ${fmt(amount)}`,
        '',
        'Ordered items:',
        ...itemLines,
        '',
        'Open this link to action it:',
        link || '(link not ready yet)',
        '',
        `Steps: 1) assign the FA codes  2) email ${GLOBAL_ACCOUNTS_NAME} to issue the PO. The vendor then re-uploads the Proforma Invoice against the PO, which completes the order.`,
      ]
  ).concat(['', 'Regards,', 'Amber Enterprises CAPEX Portal']).join('\n')

  function copyLink() {
    if (!link) return
    navigator.clipboard?.writeText(link)
      .then(() => {
        setLinkCopied(true)
        toast.success(`${recipientName} link copied`)
        setTimeout(() => setLinkCopied(false), 1500)
      })
      .catch(() => toast.error('Could not copy link'))
  }

  const poDocs = po?.poDocuments?.length
    ? po.poDocuments
    : po?.poDocumentBase64 && po?.poDocumentName
      ? [{
          id: 'legacy',
          base64: po.poDocumentBase64,
          name: po.poDocumentName,
          mimeType: po.poDocumentMimeType ?? 'application/octet-stream',
          uploadedAt: po.poDocumentUploadedAt ?? '',
        }]
      : []

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="w-5 h-5 text-blue-700" />
        <div>
          <h3 className="font-bold text-foreground">
            {inviteId ? `Award — ${vendor?.vendorName ?? 'Vendor'}` : 'Accounts — FA Codes & PO'}
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

      {/* ── Plant Accounts handoff: copy link + preview email (no portal role) ── */}
      {trackOpen && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {STAGE_HINT[status] ?? 'Awaiting Plant Accounts.'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isPoIssueStage
                  ? `${GLOBAL_ACCOUNTS_NAME} issues the PO on his own secure link — Plant Accounts email it to him from their page, or send it from here.`
                  : 'Plant Accounts act on the secure emailed link — no portal login.'}
              </p>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={copyLink}
                disabled={!link}
                className="px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {linkCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                {linkCopied ? 'Copied' : 'Copy link'}
              </button>
              <button
                type="button"
                onClick={() => setEmailOpen(true)}
                disabled={!link}
                className="px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card"
              >
                <Mail className="w-3.5 h-3.5" /> Preview email
              </button>
              {link && (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 text-blue-700 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open
                </a>
              )}
            </div>
          </div>
          {link && (
            <input
              readOnly
              value={link}
              onFocus={e => e.currentTarget.select()}
              aria-label={`${recipientName} link`}
              className="w-full text-xs font-mono border border-border rounded-lg px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
        </div>
      )}

      {/* ── FA codes (read-only) ── */}
      {lineItems.length > 0 && (
        <div>
          <p className="text-[12px] font-bold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <Hash className="w-3.5 h-3.5" /> FA Codes
            <span className="ml-1 normal-case font-normal text-[11px] text-muted-foreground/80">
              · Plant Accounts
            </span>
          </p>
          <div className="space-y-1.5">
            {lineItems.map(li => (
              <div key={li.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-foreground truncate">{li.description}</span>
                <span className="w-40 text-sm font-mono text-foreground shrink-0">
                  {faCodes[li.id] ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Purchase Order (read-only) ── */}
      <div className="border-t border-border pt-3">
        {!poIssued ? (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <ReceiptText className="w-4 h-4 shrink-0" />
            {status === 'accounts_processing'
              ? `PO not issued yet — ${GLOBAL_ACCOUNTS_NAME} (Global Accounts) raises it on his emailed link.`
              : 'The PO can be issued once FA codes are submitted.'}
          </p>
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
              {poDocs.length > 0 && (
                <div className="flex flex-col items-end gap-1 min-w-0">
                  {poDocs.map(d => (
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

            {/* ── Final step: the vendor re-uploads the PI against the PO (no payment milestones) ── */}
            {status === 'completed' ? (
              <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-800">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> Order complete — the vendor re-uploaded the PI against the PO.
              </div>
            ) : (
              <div className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-900">
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {piReuploadedAt
                    ? 'The vendor has re-uploaded the Proforma Invoice against the PO.'
                    : 'Awaiting the vendor to re-upload the Proforma Invoice against the PO.'}
                  {trialRequired && trialStatus !== 'approved' && ' The item trial must also be approved by sourcing before the order completes.'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <EmailPreviewModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title={`${recipientName} — Email Preview`}
        defaultTo={recipientEmail}
        subject={emailSubject}
        body={emailBody}
        link={link}
        linkLabel={isPoIssueStage ? `Link for ${GLOBAL_ACCOUNTS_NAME} to issue the PO` : 'Plant Accounts link (FA codes)'}
        sendLabel={`Send to ${recipientName}`}
        onSend={to => {
          toast.success(`Email sent to ${to}`)
          setEmailOpen(false)
        }}
      />
    </div>
  )
}
