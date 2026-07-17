'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Send,
  Link2,
  FileText,
  CheckCircle2,
  Clock,
  Users,
  Download,
  Pencil,
  X,
  Gavel,
  History,
  ChevronDown,
  RotateCcw,
  UserPlus,
  ScrollText,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { buildSupplierLink } from '@/lib/tokenUtils'
import { ROLE_NAMES } from '@/lib/constants'
import { FinalDecisionActions } from '@/components/FinalDecisionActions'
import type { CapexLineItem, CapexRequest, DocApprovalDoc, DocSelection, IncoTermsDoc, RfqQuote, Vendor, VendorInvite } from '@/lib/types'
import {
  RFQ_STATUS_COLORS,
  RFQ_STATUS_LABELS,
  canRequestPi,
  effectiveRfqStatus,
  lowestRfqTotal,
  rfqGstAmount,
  rfqLineGstRate,
  rfqLineSubtotal,
  rfqLineUnitPrice,
  rfqLineBreakdown,
  rfqTotal,
} from '@/lib/rfqUtils'
import {
  DOC_APPROVAL_STATUS_COLORS,
  DOC_APPROVAL_STATUS_LABELS,
  DOC_OPTIONS,
  effectiveDocApprovalStatus,
} from '@/lib/docPackageUtils'
import {
  INCO_TERMS_QUESTIONS,
  INCO_TERMS_STATUS_COLORS,
  INCO_TERMS_STATUS_LABELS,
  effectiveIncoTermsStatus,
} from '@/lib/incoTermsUtils'
import { gstRateForHsn } from '@/lib/hsnGst'
import {
  INPUT,
  INPUT_RIGHT,
  LABEL,
  FOCUS_RING,
  fmtCurrency,
} from '@/lib/auctionTheme'
import { toInr, isForeignCurrency } from '@/lib/currencyUtils'

const SOURCING_ROLES = ['sourcing_member', 'super_admin']
const FULFILLMENT_STATUSES = ['pi_requested', 'pi_submitted', 'accounts_processing', 'payment_in_progress', 'completed']
const CURRENCIES = ['INR', 'USD', 'EUR']
const SINGLE_LINE_ID = '__single__'
const FD_INPUT = 'w-full border border-slate-200 rounded px-1.5 py-1 text-xs text-right tabular-nums bg-white focus:outline-none focus:ring-1 focus:ring-slate-400'

// Per-vendor quotation form: per-line unit prices keyed by line-item id, plus footer charges.
type QuoteForm = {
  lines: Record<string, string>
  freight: string; packing: string; service: string
  deliveryWeeks: string; warranty: string; currency: string
}
function blankForm(): QuoteForm {
  return { lines: {}, freight: '', packing: '', service: '', deliveryWeeks: '', warranty: '', currency: 'INR' }
}
function formFromQuote(q?: RfqQuote): QuoteForm {
  if (!q) return blankForm()
  const lines: Record<string, string> = {}
  if (q.linePrices) for (const [id, v] of Object.entries(q.linePrices)) lines[id] = String(v)
  else if (q.price != null) lines[SINGLE_LINE_ID] = String(q.price) // legacy single-price
  return {
    lines,
    freight: q.freight != null ? String(q.freight) : '',
    packing: q.packing != null ? String(q.packing) : '',
    service: q.service != null ? String(q.service) : '',
    deliveryWeeks: q.deliveryWeeks != null ? String(q.deliveryWeeks) : '',
    warranty: q.warranty != null ? String(q.warranty) : '',
    currency: q.currency ?? 'INR',
  }
}
/** Build a sanitized RfqQuote from the form against the rendered grid rows. Returns null if no line is priced. */
function quoteFromForm(f: QuoteForm, gridItems: CapexLineItem[]): RfqQuote | null {
  const linePrices: Record<string, number> = {}
  for (const it of gridItems) {
    const n = parseFloat(f.lines[it.id] ?? '')
    if (!isNaN(n) && n > 0) linePrices[it.id] = n
  }
  if (Object.keys(linePrices).length === 0) return null
  const num = (s: string) => (s.trim() === '' ? undefined : parseFloat(s))
  return {
    price: rfqLineSubtotal(linePrices, gridItems),
    linePrices,
    freight: num(f.freight),
    packing: num(f.packing),
    service: num(f.service),
    deliveryWeeks: num(f.deliveryWeeks),
    warranty: num(f.warranty),
    currency: f.currency,
  }
}
function formTotal(f: QuoteForm, gridItems: CapexLineItem[]): number | null {
  const q = quoteFromForm(f, gridItems)
  return q ? rfqTotal(q, gridItems) : null
}

// Footer attribute rows (rendered beneath the line-item rows), mirroring the auction grid.
type AttrKey = 'freight' | 'packing' | 'service' | 'deliveryWeeks' | 'warranty' | 'currency'
const ATTR_ROWS: { key: AttrKey; label: string; select?: boolean; display: (q?: RfqQuote) => string }[] = [
  { key: 'freight', label: 'Transportation / Freight', display: q => (q?.freight != null ? fmtCurrency(q.freight) : '—') },
  { key: 'packing', label: 'Packing / Forwarding', display: q => (q?.packing != null ? fmtCurrency(q.packing) : '—') },
  { key: 'service', label: 'Service / Installation', display: q => (q?.service != null ? fmtCurrency(q.service) : '—') },
  { key: 'deliveryWeeks', label: 'Delivery Lead Time (Weeks)', display: q => (q?.deliveryWeeks != null ? String(q.deliveryWeeks) : '—') },
  { key: 'warranty', label: 'Warranty (Years)', display: q => (q?.warranty != null ? String(q.warranty) : '—') },
  { key: 'currency', label: 'Currency', select: true, display: q => q?.currency ?? '—' },
]

export function RfqPanel({
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
  const {
    inviteVendors,
    inviteNewVendor,
    proposeIncoTerms,
    respondToIncoTerms,
    proposeRfqQuote,
    respondToRfqQuote,
    reopenRfqQuote,
    seedAuctionFromRfq,
    requestProformaInvoice,
    setSourcingMode,
    resendDocApprovalPackage,
    updateRequest,
  } = useCapex()

  const [forms, setForms] = useState<Record<string, QuoteForm>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedToInvite, setSelectedToInvite] = useState<string[]>([])
  const [showVendorSelect, setShowVendorSelect] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showNewVendor, setShowNewVendor] = useState(false)
  const [newVendor, setNewVendor] = useState({ name: '', email: '', phone: '', foreign: false })
  // Per-vendor document selection chosen at invite time (which docs each vendor must approve).
  const [docSel, setDocSel] = useState<Record<string, DocSelection>>({})
  const [customDocs, setCustomDocs] = useState<DocApprovalDoc[]>([])
  const [newDoc, setNewDoc] = useState({ title: '', text: '' })
  const [newVendorDocSel, setNewVendorDocSel] = useState<DocSelection>({ commercialTerms: true, pbg: true, dlc: true, paymentTerms: true, extraDocs: [] })
  const [incoReviewId, setIncoReviewId] = useState<string | null>(null)
  const [incoEdits, setIncoEdits] = useState<Record<string, IncoTermsDoc>>({})

  const canManage = SOURCING_ROLES.includes(currentRole)
  // Requesting the Proforma Invoice (finalizing for fulfillment) is restricted to the sourcing
  // head / admin, matching the reverse-auction path. A sourcing_member runs the negotiation but
  // does not request the PI.
  // Sourcing team can award directly — no sourcing-head gate.
  const canFinalize = canManage
  const senderName = ROLE_NAMES[currentRole] ?? currentRole

  const invitedIds = useMemo(() => new Set(invites.map(i => i.vendorId)), [invites])
  const vendorName = (id: string) => vendors.find(v => v.id === id)?.vendorName ?? id

  const inFulfillment = FULFILLMENT_STATUSES.includes(request.status)
  const finalInvite = request.finalVendorId ? invites.find(i => i.vendorId === request.finalVendorId) : undefined

  // Grid rows: real line items, or a single synthetic row for legacy/simple requests.
  const hasLines = !!request.lineItems?.length
  const gridItems = useMemo<CapexLineItem[]>(() => {
    if (hasLines) return request.lineItems!
    return [{
      id: SINGLE_LINE_ID,
      description: request.subject || 'Requested item',
      category: '',
      quantity: '1',
    }]
  }, [hasLines, request.lineItems, request.subject])

  // Final Decision — identical to the reverse-auction grid: per-line Price/Disc/Vendor persisted
  // in request.sourcingDecision (finalPrices keyed `${itemId}-price`/`${itemId}-disc`).
  const [finalPrices, setFinalPrices] = useState<Record<string, string>>(request.sourcingDecision?.finalPrices ?? {})
  const [finalVendorPerItem, setFinalVendorPerItem] = useState<Record<string, string>>(request.sourcingDecision?.finalVendorPerItem ?? {})
  function persistDecision(nextPrices: Record<string, string>, nextVendors: Record<string, string>) {
    updateRequest(request.id, {
      sourcingDecision: {
        ...(request.sourcingDecision ?? {}),
        finalPrices: nextPrices,
        finalVendorPerItem: nextVendors,
        savedAt: new Date().toISOString(),
      },
    })
  }
  function setFinalPrice(key: string, val: string) {
    const next = { ...finalPrices, [key]: val }
    setFinalPrices(next)
    persistDecision(next, finalVendorPerItem)
  }
  function setFinalVendor(itemId: string, val: string) {
    const next = { ...finalVendorPerItem }
    if (val) next[itemId] = val
    else delete next[itemId]
    setFinalVendorPerItem(next)
    // Auto-fill the Final Decision price from the chosen vendor's quoted unit price for this line.
    let nextPrices = finalPrices
    if (val) {
      const inv = invites.find(i => i.vendorId === val)
      const u = inv ? unitFor(inv, itemId) : null
      if (u != null) {
        nextPrices = { ...finalPrices, [`${itemId}-price`]: String(u) }
        setFinalPrices(nextPrices)
      }
    }
    persistDecision(nextPrices, next)
  }
  function fdNet(item: CapexLineItem): number {
    const p = Number(finalPrices[`${item.id}-price`] ?? 0)
    const d = Number(finalPrices[`${item.id}-disc`] ?? 0)
    return p * (1 - d / 100) * qtyOf(item)
  }

  const lowest = useMemo(() => lowestRfqTotal(invites, gridItems), [invites, gridItems])
  const quotedCount = useMemo(() => invites.filter(i => i.rfqQuote).length, [invites])
  const canStartAuction = quotedCount >= 2

  const counts = useMemo(() => {
    const c = { awaiting_quote: 0, pending_sourcing: 0, pending_vendor: 0, approved: 0, rejected: 0, not_sent: 0 }
    for (const inv of invites) c[effectiveRfqStatus(inv)]++
    return c
  }, [invites])

  function getForm(inv: VendorInvite): QuoteForm {
    return forms[inv.id] ?? formFromQuote(inv.rfqQuote)
  }
  function setForm(inviteId: string, patch: Partial<Omit<QuoteForm, 'lines'>>) {
    setForms(prev => {
      const base = prev[inviteId] ?? formFromQuote(invites.find(i => i.id === inviteId)?.rfqQuote)
      return { ...prev, [inviteId]: { ...base, ...patch } }
    })
  }
  function setLine(inviteId: string, itemId: string, val: string) {
    setForms(prev => {
      const base = prev[inviteId] ?? formFromQuote(invites.find(i => i.id === inviteId)?.rfqQuote)
      return { ...prev, [inviteId]: { ...base, lines: { ...base.lines, [itemId]: val } } }
    })
  }

  // Unit price a vendor offers for a line (live form value while editing; legacy price fallback).
  function unitFor(inv: VendorInvite, itemId: string): number | null {
    if (editingId === inv.id) {
      const n = parseFloat(getForm(inv).lines[itemId] ?? '')
      return isNaN(n) ? null : n
    }
    const u = rfqLineUnitPrice(inv.rfqQuote, itemId)
    if (u != null) return u
    if (!hasLines && inv.rfqQuote) return inv.rfqQuote.price // legacy single-line
    return null
  }
  function qtyOf(item: CapexLineItem): number {
    return parseFloat(item.quantity) || 1
  }
  // Lowest unit price across vendors for a given line (for the green "Lowest" highlight).
  // Compared on an INR basis so a foreign-currency unit isn't wrongly flagged lowest; returns the
  // vendor's own-currency unit that is lowest in INR terms (matches what the cell renders).
  function lowestUnit(itemId: string): number | null {
    let minInr: number | null = null
    let minUnit: number | null = null
    for (const inv of invites) {
      const u = unitFor(inv, itemId)
      if (u == null || u <= 0) continue
      const inr = toInr(u, inv.rfqQuote?.currency)
      if (minInr == null || inr < minInr) { minInr = inr; minUnit = u }
    }
    return minUnit
  }
  function grandTotalOf(inv: VendorInvite): number | null {
    if (editingId === inv.id) return formTotal(getForm(inv), gridItems)
    return inv.rfqQuote ? rfqTotal(inv.rfqQuote, gridItems) : null
  }
  // Item-wise GST total for a vendor's quote (for the "incl ₹X GST" subtitle on the grand total).
  function gstOf(inv: VendorInvite): number {
    const q = editingId === inv.id ? quoteFromForm(getForm(inv), gridItems) : inv.rfqQuote
    return q ? rfqGstAmount(q, gridItems) : 0
  }

  // INR grand total for a vendor (for cross-vendor comparison — the cell renders the own-currency value).
  function inrGrandTotalOf(inv: VendorInvite): number | null {
    const t = grandTotalOf(inv)
    if (t == null) return null
    const cur = editingId === inv.id ? getForm(inv).currency : inv.rfqQuote?.currency
    return toInr(t, cur)
  }
  const liveLowestTotal = useMemo(() => {
    const totals: number[] = []
    for (const inv of invites) {
      const t = inrGrandTotalOf(inv)
      if (t != null) totals.push(t)
    }
    return totals.length ? Math.min(...totals) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invites, editingId, forms, gridItems])

  const quotedInvites = useMemo(() => invites.filter(i => i.rfqQuote), [invites])

  // Incoterms gate FOREIGN vendors (international shipping terms), not one-time vendors.
  const isForeign = (inv: VendorInvite) => !!vendors.find(v => v.id === inv.vendorId)?.foreign
  const foreignInvites = useMemo(
    () => invites.filter(inv => vendors.find(v => v.id === inv.vendorId)?.foreign),
    [invites, vendors],
  )

  function startCounter(inv: VendorInvite) {
    setForms(prev => ({ ...prev, [inv.id]: formFromQuote(inv.rfqQuote) }))
    setEditingId(inv.id)
  }
  function cancelCounter() {
    setEditingId(null)
  }

  // ── Per-vendor document selection (which docs each invited vendor must approve) ──
  function defaultDocSel(vendor?: Vendor): DocSelection {
    return { commercialTerms: true, pbg: true, dlc: true, paymentTerms: !!vendor?.oneTime, extraDocs: [] }
  }
  function toggleStdDoc(vendorId: string, key: 'commercialTerms' | 'pbg' | 'dlc' | 'paymentTerms') {
    setDocSel(prev => {
      const sel = prev[vendorId] ?? defaultDocSel(vendors.find(v => v.id === vendorId))
      return { ...prev, [vendorId]: { ...sel, [key]: !sel[key] } }
    })
  }
  function toggleCustomDoc(vendorId: string, doc: DocApprovalDoc) {
    setDocSel(prev => {
      const sel = prev[vendorId] ?? defaultDocSel(vendors.find(v => v.id === vendorId))
      const has = (sel.extraDocs ?? []).some(d => d.id === doc.id)
      const extraDocs = has ? (sel.extraDocs ?? []).filter(d => d.id !== doc.id) : [...(sel.extraDocs ?? []), doc]
      return { ...prev, [vendorId]: { ...sel, extraDocs } }
    })
  }
  function addCustomDoc() {
    const title = newDoc.title.trim()
    if (!title) { toast.error('Enter a document name'); return }
    setCustomDocs(prev => [...prev, { id: `cd-${Date.now()}`, title, text: newDoc.text.trim() || title }])
    setNewDoc({ title: '', text: '' })
  }

  function toggleInvite(id: string) {
    if (invitedIds.has(id)) return
    setSelectedToInvite(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setDocSel(prev => prev[id] ? prev : { ...prev, [id]: defaultDocSel(vendors.find(v => v.id === id)) })
  }
  function addVendors() {
    if (!selectedToInvite.length) return
    const n = selectedToInvite.length
    const selections: Record<string, DocSelection> = {}
    for (const vid of selectedToInvite) selections[vid] = docSel[vid] ?? defaultDocSel(vendors.find(v => v.id === vid))
    inviteVendors(request.id, selectedToInvite, selections)
    setSelectedToInvite([])
    setShowVendorSelect(false)
    toast.success(`Invited ${n} vendor(s) — link sent`)
  }
  function sendNewVendor() {
    const name = newVendor.name.trim()
    const email = newVendor.email.trim()
    if (!name || !email) { toast.error('Enter the vendor name and email'); return }
    inviteNewVendor(request.id, { name, email, phone: newVendor.phone.trim(), foreign: newVendor.foreign }, senderName, newVendorDocSel)
    setNewVendor({ name: '', email: '', phone: '', foreign: false })
    setNewVendorDocSel({ commercialTerms: true, pbg: true, dlc: true, paymentTerms: true, extraDocs: [] })
    setShowNewVendor(false)
    toast.success(`Invited ${name} — INCO Terms sent`)
  }

  // INCO Terms review (one-time vendors) — sourcing reviews the vendor's 12 answers.
  function incoDoc(inv: VendorInvite): IncoTermsDoc {
    return incoEdits[inv.id] ?? inv.incoTermsDoc ?? { id: `inco-${inv.id}` }
  }
  function setIncoField(inviteId: string, base: IncoTermsDoc, key: keyof IncoTermsDoc, val: string) {
    setIncoEdits(prev => ({ ...prev, [inviteId]: { ...base, ...(prev[inviteId] ?? {}), [key]: val } }))
  }
  function approveInco(inv: VendorInvite) {
    respondToIncoTerms(inv.id, 'approved', 'sourcing', senderName)
    setIncoReviewId(null)
    toast.success(`INCO Terms approved for ${vendorName(inv.vendorId)} — vendor can now quote`)
  }
  function editResendInco(inv: VendorInvite) {
    proposeIncoTerms(inv.id, incoDoc(inv), 'sourcing', senderName)
    setIncoReviewId(null)
    setIncoEdits(prev => { const next = { ...prev }; delete next[inv.id]; return next })
    toast.success(`INCO Terms revised & sent back to ${vendorName(inv.vendorId)}`)
  }
  function rejectInco(inv: VendorInvite) {
    if (!window.confirm(`Reject ${vendorName(inv.vendorId)}'s INCO Terms? They will not be able to quote.`)) return
    respondToIncoTerms(inv.id, 'rejected', 'sourcing', senderName)
    setIncoReviewId(null)
    toast(`INCO Terms rejected for ${vendorName(inv.vendorId)}`)
  }

  function sendCounter(inv: VendorInvite) {
    const quote = quoteFromForm(getForm(inv), gridItems)
    if (!quote) { toast.error('Enter a price for at least one line'); return }
    proposeRfqQuote(inv.id, quote, 'sourcing', senderName)
    setEditingId(null)
    toast.success(`Counter sent to ${vendorName(inv.vendorId)}`)
  }
  function acceptQuote(inv: VendorInvite) {
    if (!window.confirm(`Accept ${vendorName(inv.vendorId)}'s quotation of ${inv.rfqQuote ? fmtCurrency(rfqTotal(inv.rfqQuote, gridItems)) : '—'}? This finalizes this vendor and sends the approval documents for sign-off.`)) return
    respondToRfqQuote(inv.id, 'approved', 'sourcing', senderName)
    toast.success(`Accepted ${vendorName(inv.vendorId)} — documents sent for approval`)
  }
  function declineQuote(inv: VendorInvite) {
    if (!window.confirm(`Decline ${vendorName(inv.vendorId)}'s quotation?`)) return
    respondToRfqQuote(inv.id, 'rejected', 'sourcing', senderName)
    toast(`Declined ${vendorName(inv.vendorId)}'s quotation`)
  }
  function reopen(inv: VendorInvite) {
    if (!window.confirm(`Reopen negotiation with ${vendorName(inv.vendorId)}? This resets the sent approval documents.`)) return
    reopenRfqQuote(inv.id)
    toast(`Reopened negotiation with ${vendorName(inv.vendorId)}`)
  }
  function requestPi(inv: VendorInvite) {
    requestProformaInvoice(request.id, inv.vendorId, senderName)
    toast.success(`Proforma Invoice requested from ${vendorName(inv.vendorId)}`)
  }
  function resendDocs(inv: VendorInvite) {
    resendDocApprovalPackage(inv.id)
    toast.success(`Approval documents re-sent to ${vendorName(inv.vendorId)}`)
  }
  function startAuction() {
    if (quotedCount < 2) { toast.error('Need at least 2 vendor quotes to start an auction.'); return }
    if (!window.confirm('Escalate this RFQ to a live reverse auction? The current best price drops 5% to become the new price to beat, and every vendor’s rank resets — vendors must submit a fresh bid to reveal their rank.')) return
    seedAuctionFromRfq(request.id)
    setSourcingMode(request.id, 'auction')
    toast.success('Switched to Reverse Auction — best price cut 5% and ranks reset')
  }
  function copyLink(inv: VendorInvite) {
    navigator.clipboard.writeText(buildSupplierLink(inv.token))
      .then(() => toast.success('Supplier link copied'))
      .catch(() => toast.error('Could not copy link'))
  }

  const invitesByPrice = useMemo(() => {
    return [...invites].sort((a, b) => {
      const ta = a.rfqQuote ? rfqTotal(a.rfqQuote, gridItems) : Infinity
      const tb = b.rfqQuote ? rfqTotal(b.rfqQuote, gridItems) : Infinity
      return ta - tb
    })
  }, [invites, gridItems])

  const historyEntries = useMemo(() => {
    const rows = invites.flatMap(inv =>
      (inv.rfqThread ?? []).map(m => ({ ...m, vendor: vendorName(inv.vendorId), inviteId: inv.id })),
    )
    return rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invites, vendors])

  const actionsProps = (inv: VendorInvite, mobile: boolean) => ({
    inv,
    status: effectiveRfqStatus(inv),
    isEditing: editingId === inv.id,
    canManage,
    canFinalize,
    formValid: !!quoteFromForm(getForm(inv), gridItems),
    onSend: () => sendCounter(inv),
    onCancel: cancelCounter,
    onAccept: () => acceptQuote(inv),
    onDecline: () => declineQuote(inv),
    onReopen: () => reopen(inv),
    onRequestPi: () => requestPi(inv),
    onResendDocs: () => resendDocs(inv),
    onCopyLink: () => copyLink(inv),
    vendorLabel: vendorName(inv.vendorId),
    ...(mobile ? { showCounterTrigger: true, onStartCounter: () => startCounter(inv) } : {}),
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F4F5] text-[#171717]">
          <FileText className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-900">RFQ — Request for Quotation</h3>
          <p className="text-xs text-slate-500">
            Vendors quote each line first. Counter inline, set the per-line Final Decision, then accept — or escalate to a live auction.
          </p>
          {invites.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {counts.awaiting_quote > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">{counts.awaiting_quote} awaiting quote</span>
              )}
              {counts.pending_sourcing > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">{counts.pending_sourcing} need review</span>
              )}
              {counts.pending_vendor > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">{counts.pending_vendor} counter sent</span>
              )}
              {counts.approved > 0 && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">{counts.approved} approved</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fulfillment: PI tracking after a vendor is finalized */}
      {inFulfillment && finalInvite ? (
        <div className="rounded-lg border border-slate-200 bg-[#F4F4F5] p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-slate-900">{vendorName(finalInvite.vendorId)}</p>
              <p className="text-xs text-slate-500">
                Approved RFQ total: <span className="tabular-nums font-semibold text-slate-900">{finalInvite.rfqQuote ? fmtCurrency(rfqTotal(finalInvite.rfqQuote, gridItems)) : '—'}</span>
              </p>
            </div>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">
              {request.status === 'pi_requested' ? 'Awaiting PI' : 'PI Received'}
            </span>
          </div>
          {request.status === 'pi_requested' ? (
            <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
              <Clock className="w-4 h-4" />
              Waiting for the vendor to upload the Proforma Invoice.
              {canManage && (
                <button
                  onClick={() => copyLink(finalInvite)}
                  aria-label={`Copy supplier link for ${vendorName(finalInvite.vendorId)}`}
                  className={`flex items-center gap-1 text-[#171717] font-semibold hover:underline ${FOCUS_RING} rounded`}
                >
                  <Link2 className="w-3.5 h-3.5" /> Copy supplier link
                </button>
              )}
            </div>
          ) : finalInvite.proformaInvoice ? (
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <CheckCircle2 className="w-4 h-4 text-slate-600" />
              <span className="text-slate-900">PI submitted — forwarded to buyer &amp; accounts.</span>
              <a
                href={`data:${finalInvite.proformaInvoice.mimeType ?? 'application/octet-stream'};base64,${finalInvite.proformaInvoice.base64}`}
                download={finalInvite.proformaInvoice.name}
                className={`flex items-center gap-1 text-[#171717] font-semibold hover:underline ${FOCUS_RING} rounded`}
              >
                <Download className="w-3.5 h-3.5" /> {finalInvite.proformaInvoice.name}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* Invite picker — auction-style checkbox cards */}
          {canManage && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowVendorSelect(v => !v)}
                  aria-expanded={showVendorSelect}
                  aria-label="Invite vendors and send the quotation link"
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg ${FOCUS_RING}`}
                >
                  <Users className="w-4 h-4" /> Invite vendors (send link){selectedToInvite.length ? ` · ${selectedToInvite.length} selected` : ''}
                </button>
                <button
                  onClick={() => setShowNewVendor(v => !v)}
                  aria-expanded={showNewVendor}
                  aria-label="Invite a new one-time vendor"
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg ${FOCUS_RING}`}
                >
                  <UserPlus className="w-4 h-4" /> Invite new vendor
                </button>
              </div>

              {/* New one-time vendor form — INCO Terms are sent automatically on invite */}
              {showNewVendor && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-[#F4F4F5] px-4 py-2 border-b border-slate-200">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">New / one-time vendor — mark foreign to send Incoterms (approved before quoting)</p>
                  </div>
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="rfq-nv-name" className={LABEL}>Name</label>
                      <input id="rfq-nv-name" type="text" value={newVendor.name}
                        onChange={e => setNewVendor(v => ({ ...v, name: e.target.value }))}
                        placeholder="Vendor name" className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="rfq-nv-email" className={LABEL}>Email</label>
                      <input id="rfq-nv-email" type="email" value={newVendor.email}
                        onChange={e => setNewVendor(v => ({ ...v, email: e.target.value }))}
                        placeholder="name@vendor.com" className={INPUT} />
                    </div>
                    <div>
                      <label htmlFor="rfq-nv-phone" className={LABEL}>Phone</label>
                      <input id="rfq-nv-phone" type="tel" value={newVendor.phone}
                        onChange={e => setNewVendor(v => ({ ...v, phone: e.target.value }))}
                        placeholder="Optional" className={INPUT} />
                    </div>
                  </div>
                  <div className="px-3 pb-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input type="checkbox" checked={newVendor.foreign}
                        onChange={e => setNewVendor(v => ({ ...v, foreign: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 accent-[#2563EB]" />
                      <span className="text-[11px] text-slate-600 leading-snug">
                        <span className="font-semibold text-slate-800">Foreign / international vendor</span> — the Incoterms (2020) agreement is sent for the vendor to accept before they can quote.
                      </span>
                    </label>
                  </div>
                  <div className="px-3 py-2 border-t border-slate-200 bg-[#F4F4F5] flex justify-end">
                    <button onClick={sendNewVendor}
                      disabled={!newVendor.name.trim() || !newVendor.email.trim()}
                      aria-label="Send invite and INCO Terms to the new vendor"
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#171717] hover:bg-[#000000] disabled:opacity-50 text-white rounded-lg ${FOCUS_RING}`}>
                      <Send className="w-3.5 h-3.5" /> Send invite
                    </button>
                  </div>
                </div>
              )}
              {showVendorSelect && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-[#F4F4F5] px-4 py-2 border-b border-slate-200">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Choose vendors &amp; the documents each must approve</p>
                  </div>

                  {/* Custom-document manager — add any other document (e.g. NDA) to the checklist */}
                  <div className="px-3 pt-3">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex-1 min-w-[140px]">
                        <p className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Add custom document</p>
                        <input value={newDoc.title} onChange={e => setNewDoc(d => ({ ...d, title: e.target.value }))}
                          placeholder="Document name (e.g. NDA)" aria-label="Custom document name" className={INPUT} />
                      </div>
                      <div className="flex-[2] min-w-[180px]">
                        <input value={newDoc.text} onChange={e => setNewDoc(d => ({ ...d, text: e.target.value }))}
                          placeholder="Optional details / clause text" aria-label="Custom document text" className={INPUT} />
                      </div>
                      <button type="button" onClick={addCustomDoc}
                        className={`px-3 py-2 text-xs font-semibold bg-[#171717] hover:bg-black text-white rounded-lg ${FOCUS_RING}`}>+ Add</button>
                    </div>
                    {customDocs.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {customDocs.map(d => (
                          <span key={d.id} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full">
                            {d.title}
                            <button type="button" onClick={() => setCustomDocs(prev => prev.filter(x => x.id !== d.id))}
                              aria-label={`Remove ${d.title}`} className="text-slate-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto p-3 space-y-2">
                    {vendors.map(vendor => {
                      const isInvited = invitedIds.has(vendor.id)
                      const isSelected = selectedToInvite.includes(vendor.id)
                      const sel = docSel[vendor.id] ?? defaultDocSel(vendor)
                      return (
                        <div key={vendor.id}
                          className={[
                            'px-3 py-2 rounded-lg border transition-colors',
                            isSelected ? 'bg-[#F4F4F5] border-[#171717]/40' : 'bg-white border-slate-200',
                            isInvited && 'opacity-75',
                          ].filter(Boolean).join(' ')}>
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" checked={isSelected || isInvited} disabled={isInvited}
                              onChange={() => toggleInvite(vendor.id)}
                              aria-label={`Invite ${vendor.vendorName}`}
                              className="w-4 h-4 rounded border-slate-300 text-[#171717] focus:ring-[#171717]" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{vendor.vendorName}</p>
                              <p className="text-xs text-slate-500">{vendor.vendorCode}{vendor.oneTime ? ' · one-time' : ''}</p>
                            </div>
                            {isInvited && <span className="text-[10px] font-medium text-[#171717] bg-white border border-slate-200 px-2 py-0.5 rounded-full">Invited</span>}
                          </label>
                          {isSelected && !isInvited && (
                            <div className="mt-2 pl-7 flex flex-wrap gap-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase self-center mr-1">Send:</span>
                              {DOC_OPTIONS.map(opt => {
                                const on = !!sel[opt.key]
                                return (
                                  <button key={opt.key} type="button" onClick={() => toggleStdDoc(vendor.id, opt.key)}
                                    className={[
                                      'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors',
                                      on ? 'bg-[#171717] text-white border-[#171717]' : 'bg-white text-slate-500 border-slate-300',
                                    ].join(' ')}>
                                    {on ? '✓ ' : ''}{opt.label}
                                  </button>
                                )
                              })}
                              {customDocs.map(d => {
                                const on = (sel.extraDocs ?? []).some(x => x.id === d.id)
                                return (
                                  <button key={d.id} type="button" onClick={() => toggleCustomDoc(vendor.id, d)}
                                    className={[
                                      'text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors',
                                      on ? 'bg-[#171717] text-white border-[#171717]' : 'bg-white text-slate-500 border-slate-300',
                                    ].join(' ')}>
                                    {on ? '✓ ' : ''}{d.title}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <div className="px-3 py-2 border-t border-slate-200 bg-[#F4F4F5] flex justify-end">
                    <button onClick={addVendors} disabled={!selectedToInvite.length}
                      aria-label="Send quotation link to selected vendors"
                      className={`px-3 py-1.5 text-xs font-semibold bg-[#171717] hover:bg-[#000000] disabled:opacity-50 text-white rounded-lg ${FOCUS_RING}`}>
                      Send link
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {invites.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">No vendors invited yet. Invite vendors to send them the quotation link.</p>
          ) : (
            <>
              {/* ── Comparison grid — line items as rows, vendors as columns (lg and up) ── */}
              <div className="hidden lg:block overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm border-collapse" aria-label="RFQ comparison grid">
                  <thead>
                    <tr className="bg-[#171717] text-white">
                      <th scope="col" className="sticky left-0 z-20 bg-[#171717] text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider min-w-[150px]">Item</th>
                      <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider min-w-[140px]">Description</th>
                      <th scope="col" className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider w-16">Qty</th>
                      <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider min-w-[150px] border-l border-white/15">HSN / GST</th>
                      {invites.map((inv, colIdx) => {
                        const s = effectiveRfqStatus(inv)
                        const isEditing = editingId === inv.id
                        return (
                          <th key={inv.id} scope="col" className="px-3 py-2 text-center align-bottom whitespace-nowrap min-w-[150px] border-l border-white/15">
                            <div className="flex flex-col items-center gap-1">
                              <div className="flex items-center gap-1">
                                <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">Q{colIdx + 1}</span>
                                <span className="text-[10px] text-white/60">{vendors.find(v => v.id === inv.vendorId)?.vendorCode}</span>
                              </div>
                              <span className="text-[11px] font-bold text-white truncate max-w-[130px]">{vendorName(inv.vendorId)}</span>
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${RFQ_STATUS_COLORS[s]}`}>{RFQ_STATUS_LABELS[s]}</span>
                              {isForeign(inv) && effectiveIncoTermsStatus(inv) !== 'approved' && (
                                <span className="text-[9px] font-semibold text-slate-200 leading-tight max-w-[130px]">Awaiting INCO Terms approval</span>
                              )}
                              {canManage && !isEditing && (s === 'pending_sourcing' || s === 'pending_vendor') && (
                                <button
                                  onClick={() => startCounter(inv)}
                                  aria-label={`Counter ${vendorName(inv.vendorId)}'s quotation`}
                                  className={`flex items-center gap-1 text-[10px] font-semibold text-white/90 hover:text-white underline ${FOCUS_RING} rounded`}
                                >
                                  <Pencil className="w-3 h-3" /> Counter
                                </button>
                              )}
                              {canManage && (
                                <button
                                  onClick={() => copyLink(inv)}
                                  aria-label={`Copy supplier link for ${vendorName(inv.vendorId)}`}
                                  className={`flex items-center gap-1 text-[10px] font-semibold text-white/80 hover:text-white ${FOCUS_RING} rounded`}
                                >
                                  <Link2 className="w-3 h-3" /> Copy link
                                </button>
                              )}
                            </div>
                          </th>
                        )
                      })}
                      {canManage && (
                        <th scope="col" className="sticky right-0 z-20 bg-[#171717] text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider min-w-[190px] border-l border-white/15">
                          Final Decision
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Line-item rows */}
                    {gridItems.map((item, idx) => {
                      const qty = qtyOf(item)
                      const low = lowestUnit(item.id)
                      return (
                        <tr key={item.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}>
                          <td className={`sticky left-0 z-10 px-3 py-2 ${idx % 2 === 0 ? 'bg-white' : 'bg-[#FAFAFA]'}`}>
                            <p className="font-semibold text-slate-800 text-[12px] leading-snug">{item.description}</p>
                            {item.machineCapacity && <p className="text-[10px] text-slate-700 mt-0.5">Capacity: {item.machineCapacity}</p>}
                            {item.masterHead && <p className="text-[10px] text-slate-400 mt-0.5">{item.masterHead}</p>}
                          </td>
                          <td className="px-3 py-2 text-[11px] text-slate-500 leading-snug">{item.remarks || item.specs || <span className="text-slate-300">—</span>}</td>
                          <td className="px-3 py-2 text-right text-[12px] font-semibold text-slate-700">{item.quantity}{item.uom ? <span className="text-slate-400 text-[10px]"> {item.uom}</span> : ''}</td>
                          {/* HSN / GST — read-only; entered by the vendor on their quote, not editable by sourcing */}
                          <td className="px-3 py-2 border-l border-slate-100 align-top">
                            {item.hsnCode ? (
                              <>
                                <p className="text-[12px] font-semibold text-slate-700">{item.hsnCode}</p>
                                <p className="text-[10px] font-semibold text-slate-700">GST {gstRateForHsn(item.hsnCode)}%</p>
                              </>
                            ) : (
                              <span className="text-[12px] text-amber-600 font-medium">Awaiting HSN</span>
                            )}
                          </td>
                          {invites.map(inv => {
                            const isEditing = editingId === inv.id
                            if (isEditing) {
                              return (
                                <td key={inv.id} className="px-2 py-1.5 border-l border-slate-100 bg-slate-50/40">
                                  <input
                                    type="number" min="0" inputMode="decimal" placeholder="0"
                                    value={getForm(inv).lines[item.id] ?? ''}
                                    onChange={e => setLine(inv.id, item.id, e.target.value)}
                                    aria-label={`${vendorName(inv.vendorId)} — unit price for ${item.description}`}
                                    className={`${INPUT_RIGHT} py-1`}
                                  />
                                </td>
                              )
                            }
                            const unit = unitFor(inv, item.id)
                            const isLow = unit != null && unit > 0 && low != null && unit === low
                            const vendorQuote = editingId === inv.id ? quoteFromForm(getForm(inv), gridItems) : inv.rfqQuote
                            const breakdown = vendorQuote && unit != null && unit > 0 ? rfqLineBreakdown(vendorQuote, item) : null
                            return (
                              <td key={inv.id} className={`px-3 py-2 text-center border-l border-slate-100 ${isLow ? 'bg-emerald-50' : ''}`}>
                                {unit != null && unit > 0 ? (
                                  <>
                                    <p className={`font-bold text-[12px] ${isLow ? 'text-emerald-700' : 'text-slate-800'}`}>{fmtCurrency(unit)}</p>
                                    {breakdown && (
                                      <>
                                        <p className={`text-[11px] ${isLow ? 'text-emerald-600' : 'text-slate-500'}`}>
                                          Subtotal: {fmtCurrency(breakdown.taxableSubtotal)}
                                        </p>
                                        {breakdown.gstAmount > 0 && (
                                          <p className={`text-[10px] ${isLow ? 'text-emerald-600' : 'text-slate-500'}`}>
                                            + {fmtCurrency(breakdown.gstAmount)} GST
                                          </p>
                                        )}
                                        <p className={`text-[11px] font-semibold ${isLow ? 'text-emerald-700' : 'text-slate-700'}`}>
                                          Total: {fmtCurrency(breakdown.lineTotalInclGst)}
                                        </p>
                                      </>
                                    )}
                                    {isLow && <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 leading-none">↓ Lowest</span>}
                                  </>
                                ) : (
                                  <p className="text-[12px] text-slate-300">—</p>
                                )}
                              </td>
                            )
                          })}
                          {canManage && (
                            <td className="sticky right-0 z-10 px-2 py-2 bg-[#F4F4F5] border-l border-slate-200 align-top min-w-[190px]">
                              <div className="flex gap-1.5 mb-1">
                                <div className="flex-1">
                                  <p className="text-[10px] font-bold text-slate-700 uppercase mb-0.5">Price (₹)</p>
                                  <input type="number" min="0" inputMode="decimal" placeholder="0"
                                    value={finalPrices[`${item.id}-price`] ?? ''}
                                    onChange={e => setFinalPrice(`${item.id}-price`, e.target.value)}
                                    aria-label={`Final price for ${item.description}`} className={FD_INPUT} />
                                </div>
                                <div className="w-12">
                                  <p className="text-[10px] font-bold text-slate-700 uppercase mb-0.5">Disc %</p>
                                  <input type="number" min="0" inputMode="decimal" placeholder="0"
                                    value={finalPrices[`${item.id}-disc`] ?? ''}
                                    onChange={e => setFinalPrice(`${item.id}-disc`, e.target.value)}
                                    aria-label={`Final discount % for ${item.description}`} className={FD_INPUT} />
                                </div>
                              </div>
                              <select
                                value={finalVendorPerItem[item.id] ?? ''}
                                onChange={e => setFinalVendor(item.id, e.target.value)}
                                aria-label={`Final decision vendor for ${item.description}`}
                                className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700"
                              >
                                <option value="">Select vendor…</option>
                                {quotedInvites.map(inv => {
                                  const u = unitFor(inv, item.id)
                                  return <option key={inv.id} value={inv.vendorId}>{vendorName(inv.vendorId)}{u != null ? ` — ${fmtCurrency(u)}` : ''}</option>
                                })}
                              </select>
                              <p className="text-[11px] font-bold text-slate-700 text-right mt-1">Price × Qty: {fmtCurrency(fdNet(item))}</p>
                            </td>
                          )}
                        </tr>
                      )
                    })}

                    {/* Attribute rows */}
                    {ATTR_ROWS.map((attr, attrIdx) => (
                      <tr key={attr.key} className={attrIdx % 2 === 0 ? 'bg-slate-50/70' : 'bg-white'}>
                        <th scope="row" colSpan={4} className="sticky left-0 z-10 px-3 py-1.5 text-left text-[12px] font-semibold text-slate-600 bg-slate-100 whitespace-nowrap">
                          {attr.label}
                        </th>
                        {invites.map(inv => {
                          const isEditing = editingId === inv.id
                          if (isEditing) {
                            const form = getForm(inv)
                            return (
                              <td key={inv.id} className="px-2 py-1 border-l border-slate-100 bg-slate-50/40">
                                {attr.select ? (
                                  <select value={form.currency} onChange={e => setForm(inv.id, { currency: e.target.value })}
                                    aria-label={`${vendorName(inv.vendorId)} — ${attr.label}`} className={`${INPUT_RIGHT} py-1`}>
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                ) : (
                                  <input type="number" min="0" inputMode="decimal"
                                    value={form[attr.key]}
                                    onChange={e => setForm(inv.id, { [attr.key]: e.target.value } as Partial<Omit<QuoteForm, 'lines'>>)}
                                    aria-label={`${vendorName(inv.vendorId)} — ${attr.label}`} className={`${INPUT_RIGHT} py-1`} />
                                )}
                              </td>
                            )
                          }
                          return (
                            <td key={inv.id} className="px-3 py-1.5 text-center text-[12px] text-slate-600 border-l border-slate-100">
                              {attr.display(inv.rfqQuote)}
                            </td>
                          )
                        })}
                        {canManage && <td className="sticky right-0 z-10 bg-[#F4F4F5] border-l border-slate-200" />}
                      </tr>
                    ))}

                    {/* Grand total (incl. item-wise GST) */}
                    <tr className="border-t-2 border-slate-200 bg-[#F4F4F5]">
                      <th scope="row" colSpan={4} className="sticky left-0 z-10 px-3 py-2 text-left font-bold text-slate-900 text-[12px] bg-[#F4F4F5]">Grand Total <span className="font-normal text-slate-400">(incl. GST)</span></th>
                      {invites.map(inv => {
                        const total = grandTotalOf(inv)
                        const gst = gstOf(inv)
                        // Foreign quotes: show the INR value (converted), with the original currency amount below.
                        const cur = inv.rfqQuote?.currency ?? 'INR'
                        const foreign = isForeignCurrency(cur)
                        const inrTot = total != null ? toInr(total, cur) : null
                        const isLowest = inrTot != null && liveLowestTotal != null && inrTot === liveLowestTotal
                        return (
                          <td key={inv.id} className={`px-3 py-2 text-center font-bold tabular-nums border-l border-slate-100 ${isLowest ? 'text-emerald-700 bg-emerald-50' : 'text-slate-900'}`}>
                            {total != null ? fmtCurrency(foreign ? toInr(total, cur) : total) : '—'}
                            {isLowest && <span className="ml-1 align-middle text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">L1</span>}
                            {foreign && total != null && <p className="text-[10px] font-normal text-slate-500 mt-0.5">{fmtCurrency(total, cur)} {cur}</p>}
                            {total != null && gst > 0 && <p className="text-[10px] font-normal text-slate-500 mt-0.5">incl. {fmtCurrency(foreign ? toInr(gst, cur) : gst)} GST</p>}
                          </td>
                        )
                      })}
                      {canManage && <td className="sticky right-0 z-10 bg-[#F4F4F5] border-l border-slate-200" />}
                    </tr>

                    {/* Per-column action footer */}
                    <tr className="border-t border-slate-200">
                      <th scope="row" colSpan={4} className="sticky left-0 z-10 px-3 py-2 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-white">Actions</th>
                      {invites.map(inv => (
                        <td key={inv.id} className="px-2 py-2 align-top border-l border-slate-100">
                          <VendorActions {...actionsProps(inv, false)} />
                        </td>
                      ))}
                      {canManage && <td className="sticky right-0 z-10 bg-[#F4F4F5] border-l border-slate-200" />}
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* ── Stacked per-vendor cards (below lg) — cheapest first ── */}
              <div className="lg:hidden space-y-3">
                {invitesByPrice.map(inv => {
                  const s = effectiveRfqStatus(inv)
                  const isEditing = editingId === inv.id
                  const form = getForm(inv)
                  const total = grandTotalOf(inv)
                  const isLowest = total != null && liveLowestTotal != null && total === liveLowestTotal
                  return (
                    <div key={inv.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900">{vendorName(inv.vendorId)}</p>
                          {isForeign(inv) && effectiveIncoTermsStatus(inv) !== 'approved' && (
                            <p className="text-[10px] font-semibold text-slate-700">Awaiting INCO Terms approval</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${RFQ_STATUS_COLORS[s]}`}>{RFQ_STATUS_LABELS[s]}</span>
                          {canManage && (
                            <button
                              onClick={() => copyLink(inv)}
                              aria-label={`Copy supplier link for ${vendorName(inv.vendorId)}`}
                              className={`flex items-center gap-1 text-[10px] font-semibold text-[#171717] hover:underline ${FOCUS_RING} rounded`}
                            >
                              <Link2 className="w-3 h-3" /> Link
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Line items */}
                      <div className="border-t border-slate-100 pt-2 space-y-1.5">
                        {gridItems.map(item => {
                          const qty = qtyOf(item)
                          if (isEditing) {
                            return (
                              <div key={item.id} className="flex items-center gap-2">
                                <span className="flex-1 text-[12px] text-slate-700 truncate">{item.description} <span className="text-slate-400">×{item.quantity}</span></span>
                                <input type="number" min="0" inputMode="decimal" placeholder="unit ₹"
                                  value={form.lines[item.id] ?? ''} onChange={e => setLine(inv.id, item.id, e.target.value)}
                                  aria-label={`${vendorName(inv.vendorId)} — unit price for ${item.description}`}
                                  className={`${INPUT_RIGHT} w-28 py-1`} />
                              </div>
                            )
                          }
                          const unit = unitFor(inv, item.id)
                          const vendorQuote = isEditing ? quoteFromForm(form, gridItems) : inv.rfqQuote
                          const breakdown = vendorQuote && unit != null && unit > 0 ? rfqLineBreakdown(vendorQuote, item) : null
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-2 text-[12px]">
                              <span className="text-slate-600 truncate">
                                {item.description} <span className="text-slate-400">×{item.quantity}</span>
                                {item.hsnCode
                                  ? <span className="text-[10px] text-slate-700 ml-1">HSN {item.hsnCode} · {rfqLineGstRate(item)}%</span>
                                  : <span className="text-[10px] text-amber-600 ml-1">Awaiting HSN</span>}
                              </span>
                              <span className="text-slate-800 font-semibold tabular-nums shrink-0 text-right">
                                {unit != null && unit > 0 && breakdown ? (
                                  <>
                                    <span>{fmtCurrency(unit)}</span>
                                    <span className="block text-[10px] text-slate-500">
                                      {fmtCurrency(breakdown.lineTotalInclGst)} incl. GST
                                    </span>
                                  </>
                                ) : '—'}
                              </span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Attributes */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-100 pt-2">
                        {ATTR_ROWS.map(attr => (
                          <div key={attr.key}>
                            {isEditing ? (
                              <>
                                <label className={LABEL}>{attr.label}</label>
                                {attr.select ? (
                                  <select value={form.currency} onChange={e => setForm(inv.id, { currency: e.target.value })}
                                    aria-label={`${vendorName(inv.vendorId)} — ${attr.label}`} className={`${INPUT_RIGHT} py-1`}>
                                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                ) : (
                                  <input type="number" min="0" inputMode="decimal" value={form[attr.key]}
                                    onChange={e => setForm(inv.id, { [attr.key]: e.target.value } as Partial<Omit<QuoteForm, 'lines'>>)}
                                    aria-label={`${vendorName(inv.vendorId)} — ${attr.label}`} className={`${INPUT_RIGHT} py-1`} />
                                )}
                              </>
                            ) : (
                              <div className="flex items-center justify-between text-[12px]">
                                <span className="text-slate-500">{attr.label}</span>
                                <span className="text-slate-700">{attr.display(inv.rfqQuote)}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
                        <div className="flex flex-col">
                          <span className="text-[11px] font-semibold text-slate-500">Grand total <span className="font-normal text-slate-400">(incl. GST)</span></span>
                          {gstOf(inv) > 0 && <span className="text-[10px] text-slate-400">incl. {fmtCurrency(gstOf(inv))} GST</span>}
                        </div>
                        <span className={`text-sm font-bold tabular-nums px-1.5 rounded ${isLowest ? 'text-emerald-700 bg-emerald-50' : 'text-slate-900'}`}>
                          {total != null ? fmtCurrency(total) : '—'}
                          {isLowest && <span className="ml-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">L1</span>}
                        </span>
                      </div>

                      <VendorActions {...actionsProps(inv, true)} />
                    </div>
                  )
                })}

                {/* Final Decision per item (mobile) — Price / Disc / Vendor, like the auction */}
                {canManage && quotedInvites.length > 0 && (
                  <div className="rounded-lg border border-slate-300 bg-[#F4F4F5] p-3 space-y-3">
                    <p className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">Final Decision</p>
                    {gridItems.map(item => (
                      <div key={item.id} className="space-y-1.5 border-t border-slate-200 pt-2 first:border-0 first:pt-0">
                        <p className="text-[12px] font-semibold text-slate-700">{item.description} <span className="text-slate-400">×{item.quantity}</span></p>
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <p className="text-[10px] font-bold text-slate-700 uppercase mb-0.5">Price (₹)</p>
                            <input type="number" min="0" inputMode="decimal" placeholder="0"
                              value={finalPrices[`${item.id}-price`] ?? ''}
                              onChange={e => setFinalPrice(`${item.id}-price`, e.target.value)}
                              aria-label={`Final price for ${item.description}`} className={FD_INPUT} />
                          </div>
                          <div className="w-16">
                            <p className="text-[10px] font-bold text-slate-700 uppercase mb-0.5">Disc %</p>
                            <input type="number" min="0" inputMode="decimal" placeholder="0"
                              value={finalPrices[`${item.id}-disc`] ?? ''}
                              onChange={e => setFinalPrice(`${item.id}-disc`, e.target.value)}
                              aria-label={`Final discount % for ${item.description}`} className={FD_INPUT} />
                          </div>
                        </div>
                        <select
                          value={finalVendorPerItem[item.id] ?? ''}
                          onChange={e => setFinalVendor(item.id, e.target.value)}
                          aria-label={`Final decision vendor for ${item.description}`}
                          className="w-full text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400 text-slate-700"
                        >
                          <option value="">Select vendor…</option>
                          {quotedInvites.map(inv => <option key={inv.id} value={inv.vendorId}>{vendorName(inv.vendorId)}</option>)}
                        </select>
                        <p className="text-[11px] font-bold text-slate-700 text-right">Price × Qty: {fmtCurrency(fdNet(item))}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* helper note */}
              {canManage && quotedInvites.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  The <span className="font-semibold text-slate-500">Final Decision</span> column (Price / Disc / Vendor) records the negotiated award per line — the same as the reverse auction. <span className="font-semibold text-slate-500">Accept</span> finalizes a vendor for the single-vendor Proforma Invoice &amp; fulfillment.
                </p>
              )}

              {/* INCO Terms tracker — foreign vendors only (gates their quoting) */}
              {foreignInvites.length > 0 && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-[#F4F4F5] border-b border-slate-200">
                    <ScrollText className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">INCO Terms — Foreign Vendors</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {foreignInvites.map(inv => {
                      const incoStatus = effectiveIncoTermsStatus(inv)
                      const isReviewing = incoReviewId === inv.id
                      const needsReview = incoStatus === 'pending_sourcing'
                      const doc = incoDoc(inv)
                      return (
                        <li key={inv.id} className="px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{vendorName(inv.vendorId)}</p>
                              {incoStatus !== 'approved' && (
                                <p className="text-[11px] text-slate-700">Awaiting INCO Terms approval — vendor can’t quote yet</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${INCO_TERMS_STATUS_COLORS[incoStatus]}`}>
                                {INCO_TERMS_STATUS_LABELS[incoStatus]}
                              </span>
                              {canManage && needsReview && (
                                <button
                                  onClick={() => setIncoReviewId(isReviewing ? null : inv.id)}
                                  aria-expanded={isReviewing}
                                  aria-label={`Review INCO Terms from ${vendorName(inv.vendorId)}`}
                                  className={`flex items-center gap-1 text-[11px] font-semibold text-[#171717] hover:underline ${FOCUS_RING} rounded`}
                                >
                                  {isReviewing ? 'Close' : 'Review'}
                                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isReviewing ? 'rotate-180' : ''}`} />
                                </button>
                              )}
                            </div>
                          </div>

                          {canManage && needsReview && isReviewing && (
                            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                              <p className="text-[11px] text-slate-500">
                                Review the vendor’s answers below. Approve to let them quote, edit &amp; resend to send back for confirmation, or reject.
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {INCO_TERMS_QUESTIONS.map(q => {
                                  const val = (doc[q.key] as string | undefined) ?? ''
                                  const fieldId = `inco-${inv.id}-${q.key}`
                                  return (
                                    <div key={q.key} className={q.type === 'textarea' ? 'sm:col-span-2' : ''}>
                                      <label htmlFor={fieldId} className={LABEL}>{q.label}</label>
                                      {q.type === 'select' ? (
                                        <select id={fieldId} value={val}
                                          onChange={e => setIncoField(inv.id, doc, q.key, e.target.value)}
                                          className={INPUT}>
                                          <option value="">Select…</option>
                                          {(q.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                      ) : q.type === 'textarea' ? (
                                        <textarea id={fieldId} value={val} rows={2}
                                          onChange={e => setIncoField(inv.id, doc, q.key, e.target.value)}
                                          className={`${INPUT} resize-y`} />
                                      ) : (
                                        <input id={fieldId} type="text" value={val}
                                          onChange={e => setIncoField(inv.id, doc, q.key, e.target.value)}
                                          className={INPUT} />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 pt-1">
                                <button onClick={() => approveInco(inv)}
                                  aria-label={`Approve INCO Terms for ${vendorName(inv.vendorId)}`}
                                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg ${FOCUS_RING}`}>
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                </button>
                                <button onClick={() => editResendInco(inv)}
                                  aria-label={`Edit and resend INCO Terms to ${vendorName(inv.vendorId)}`}
                                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold bg-[#171717] hover:bg-[#000000] text-white rounded-lg ${FOCUS_RING}`}>
                                  <Send className="w-3.5 h-3.5" /> Edit &amp; resend
                                </button>
                                <button onClick={() => rejectInco(inv)}
                                  aria-label={`Reject INCO Terms for ${vendorName(inv.vendorId)}`}
                                  className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-red-600 hover:text-red-700 ${FOCUS_RING} rounded`}>
                                  <X className="w-3.5 h-3.5" /> Reject
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Unified Final-Decision approve + Request-PI (split award; bulk or per-vendor) */}
              {canManage && quotedCount >= 1 && !inFulfillment && (
                <FinalDecisionActions
                  request={request}
                  invites={invites}
                  vendors={vendors}
                  currentRole={currentRole}
                  canAward={true}
                />
              )}

              {/* Start Reverse Auction CTA */}
              {canManage && quotedCount >= 1 && (
                <div className="rounded-lg bg-[#F4F4F5] border border-[#171717]/20 p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-[#171717]/10 text-[#171717]">
                      <Gavel className="w-4 h-4" />
                    </div>
                    <div className="max-w-md space-y-1">
                      <p className="text-xs text-slate-600">
                        Escalate to a live reverse auction. The current best price{lowest != null ? <> (<span className="font-semibold tabular-nums text-slate-900">{fmtCurrency(lowest)}</span>)</> : ''} drops 5% to become the new price to beat, and every vendor’s rank resets — vendors must submit a fresh bid to reveal their rank.
                      </p>
                      {!canStartAuction && (
                        <p className="text-[11px] font-semibold text-slate-700">Need at least 2 vendor quotes to start an auction.</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={startAuction}
                    disabled={!canStartAuction}
                    aria-label="Start a reverse auction"
                    title={canStartAuction ? undefined : 'Need at least 2 vendor quotes to start an auction.'}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#171717] hover:bg-[#171717] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg whitespace-nowrap ${FOCUS_RING}`}
                  >
                    <Gavel className="w-4 h-4" /> Start Reverse Auction
                  </button>
                </div>
              )}

              {/* Negotiation history (read-only, collapsible) */}
              {historyEntries.length > 0 && (
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => setShowHistory(h => !h)}
                    aria-expanded={showHistory}
                    aria-label="Toggle negotiation history"
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 bg-[#F4F4F5] hover:bg-slate-100 ${FOCUS_RING}`}
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <History className="w-3.5 h-3.5" /> Negotiation History ({historyEntries.length})
                    </span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
                  </button>
                  {showHistory && (
                    <ul className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                      {historyEntries.map(m => (
                        <li key={`${m.inviteId}-${m.id}`} className="px-3 py-2 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-900">{m.vendor}</span>{' · '}
                          <span className="capitalize">{m.by}</span> {m.action}
                          {m.quote ? <span className="tabular-nums"> {fmtCurrency(rfqTotal(m.quote, gridItems))}</span> : m.price != null ? <span className="tabular-nums"> {fmtCurrency(m.price)}</span> : ''}
                          {m.message ? ` — ${m.message}` : ''}
                          <span className="text-slate-400"> · {new Date(m.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Per-vendor action cluster — shared by the comparison-grid footer and the stacked mobile cards.
 * All price entry happens in the grid cells (via the inline counter), so this only renders
 * send/cancel, accept/decline, reopen, copy-link, request-PI, and re-send-documents.
 */
function VendorActions({
  inv,
  status,
  isEditing,
  canManage,
  canFinalize,
  formValid,
  onSend,
  onCancel,
  onAccept,
  onDecline,
  onReopen,
  onRequestPi,
  onResendDocs,
  onCopyLink,
  vendorLabel,
  showCounterTrigger = false,
  onStartCounter,
}: {
  inv: VendorInvite
  status: ReturnType<typeof effectiveRfqStatus>
  isEditing: boolean
  canManage: boolean
  canFinalize: boolean
  formValid: boolean
  onSend: () => void
  onCancel: () => void
  onAccept: () => void
  onDecline: () => void
  onReopen: () => void
  onRequestPi: () => void
  onResendDocs: () => void
  onCopyLink: () => void
  vendorLabel: string
  showCounterTrigger?: boolean
  onStartCounter?: () => void
}) {
  const docStatus = effectiveDocApprovalStatus(inv.docApprovalStatus)
  const readyForPi = canRequestPi(inv)

  if (isEditing) {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <button
          onClick={onSend}
          disabled={!formValid}
          aria-label={`Send counter to ${vendorLabel}`}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-[#171717] hover:bg-[#000000] disabled:opacity-50 text-white rounded-lg ${FOCUS_RING}`}
        >
          <Send className="w-3.5 h-3.5" /> Send to vendor
        </button>
        <button
          onClick={onCancel}
          aria-label={`Cancel counter for ${vendorLabel}`}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded-lg ${FOCUS_RING}`}
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </button>
      </div>
    )
  }

  if (status === 'approved') {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <span className={`self-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${DOC_APPROVAL_STATUS_COLORS[docStatus]}`}>
          {DOC_APPROVAL_STATUS_LABELS[docStatus]}
        </span>
        {canManage && (
          <>
            {readyForPi ? (
              <p className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 leading-snug text-center">
                Quotation &amp; docs approved — approve &amp; request PI in the <span className="font-semibold">Final Decision</span> area below.
              </p>
            ) : docStatus === 'rejected' ? (
              <>
                <p className="text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1 leading-snug">
                  Vendor declined the approval documents.
                </p>
                <button
                  onClick={onResendDocs}
                  aria-label={`Re-send approval documents to ${vendorLabel}`}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-[#171717] hover:bg-[#000000] text-white rounded-lg ${FOCUS_RING}`}
                >
                  <Send className="w-3.5 h-3.5" /> Re-send documents
                </button>
              </>
            ) : (
              <p className="text-[10px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 leading-snug">
                Vendor must approve the documents before a Proforma Invoice can be requested.
              </p>
            )}
            <button
              onClick={onReopen}
              aria-label={`Reopen negotiation with ${vendorLabel}`}
              className={`flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 ${FOCUS_RING} rounded`}
            >
              <RotateCcw className="w-3 h-3" /> Reopen negotiation
            </button>
          </>
        )}
      </div>
    )
  }

  if (!canManage) {
    return <span className="text-[11px] text-slate-400">—</span>
  }

  if (status === 'awaiting_quote' || status === 'not_sent') {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <span className="text-[10px] text-slate-400 text-center">Awaiting vendor quote</span>
        <button
          onClick={onCopyLink}
          aria-label={`Copy quotation link for ${vendorLabel}`}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 rounded-lg ${FOCUS_RING}`}
        >
          <Link2 className="w-3.5 h-3.5" /> Copy link
        </button>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        {showCounterTrigger && onStartCounter && (
          <button
            onClick={onStartCounter}
            aria-label={`Re-counter ${vendorLabel}`}
            className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg ${FOCUS_RING}`}
          >
            <Pencil className="w-3.5 h-3.5" /> Counter again
          </button>
        )}
        <button
          onClick={onCopyLink}
          aria-label={`Copy quotation link for ${vendorLabel}`}
          className={`flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 ${FOCUS_RING} rounded`}
        >
          <Link2 className="w-3 h-3" /> Copy link
        </button>
      </div>
    )
  }

  if (status === 'pending_vendor') {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <span className="text-[10px] text-slate-400 text-center">Counter sent — awaiting vendor</span>
        {showCounterTrigger && onStartCounter && (
          <button
            onClick={onStartCounter}
            aria-label={`Revise counter for ${vendorLabel}`}
            className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg ${FOCUS_RING}`}
          >
            <Pencil className="w-3.5 h-3.5" /> Revise
          </button>
        )}
      </div>
    )
  }

  // pending_sourcing — sourcing's turn: accept / decline (+ counter trigger on mobile cards).
  return (
    <div className="flex flex-col items-stretch gap-1.5">
      {showCounterTrigger && onStartCounter && (
        <button
          onClick={onStartCounter}
          aria-label={`Counter ${vendorLabel}'s quotation`}
          className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-white border border-[#171717]/30 text-[#171717] rounded-lg ${FOCUS_RING}`}
        >
          <Pencil className="w-3.5 h-3.5" /> Counter
        </button>
      )}
      <button
        onClick={onAccept}
        aria-label={`Accept ${vendorLabel}'s quotation`}
        className={`flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg ${FOCUS_RING}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5" /> Accept
      </button>
      <button
        onClick={onDecline}
        aria-label={`Decline ${vendorLabel}'s quotation`}
        className={`flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 hover:text-red-700 ${FOCUS_RING} rounded`}
      >
        <X className="w-3.5 h-3.5" /> Decline
      </button>
    </div>
  )
}
