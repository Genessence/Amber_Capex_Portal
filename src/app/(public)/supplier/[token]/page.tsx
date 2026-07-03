"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import {
  ChevronDown,
  ChevronUp,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trophy,
  Send,
  RotateCcw,
  Info,
  Medal,
  FileText,
  ThumbsUp,
  ThumbsDown,
  XCircle,
  Hourglass,
  Shield,
  Download,
  ScrollText,
  Receipt,
} from "lucide-react"
import { useCapex } from "@/lib/capexContext"
import { resolveInviteByToken, isSubmissionAllowed } from "@/lib/tokenUtils"
import type { CapexLineItem, CapexRequest, PurchaseOrder, Quote, NegotiationMessage, ProformaInvoice, RfqQuote, Vendor, VendorInvite, IncoTermsDoc } from "@/lib/types"
import { rfqTotal, effectiveRfqStatus, rfqLineSubtotal, rfqGstAmount, RFQ_STATUS_LABELS, RFQ_STATUS_COLORS } from "@/lib/rfqUtils"
import {
  INCO_TERMS_QUESTIONS,
  INCO_TERMS_STATUS_LABELS,
  INCO_TERMS_STATUS_COLORS,
  effectiveIncoTermsStatus,
  incoTermsBlocksQuote,
  isIncoDocComplete,
  buildBlankIncoTermsDoc,
} from "@/lib/incoTermsUtils"
import {
  computeVendorRankings,
  formatAuctionCountdown,
  getL1Price,
  isAuctionExpired,
  rankLabel,
} from "@/lib/auctionUtils"
import {
  getEffectiveAuctionApprovalStatus,
  isVendorEligibleForAuction,
  buildAuctionDocumentPlaceholders,
  AUCTION_APPROVAL_STATUS_LABELS,
} from "@/lib/auctionDocumentUtils"
import { DocPackageReview } from "@/components/DocPackageReview"
import { TatBanner } from "@/components/TatBanner"
import { SupplierQuoteTable } from "@/components/supplier/SupplierQuoteTable"
import { SupplierQuoteCards } from "@/components/supplier/SupplierQuoteCards"
import { INPUT, INPUT_RIGHT, LABEL, LABEL_REQ } from "@/lib/auctionTheme"
import { SUPPLIER_CARD } from "@/lib/uiTokens"
import { DEFAULT_TERMS_TEXT, effectiveDocApprovalStatus, docPackageTitles } from "@/lib/docPackageUtils"
import { isFulfillmentStatus, resolveFinalVendor } from "@/lib/paymentUtils"

const MAX_FILE_BYTES = 500 * 1024

function formatTs(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  })
}

function fmt(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

function computeItemSubtotal(lineItems: CapexLineItem[], itemPrices: Record<string, string>) {
  return lineItems.reduce(
    (s, item) => s + Number(itemPrices[item.id] ?? 0) * (parseFloat(item.quantity) || 1),
    0,
  )
}

function computeExtras(freight: string, packing: string, service: string) {
  return (freight ? Number(freight) : 0) + (packing ? Number(packing) : 0) + (service ? Number(service) : 0)
}

/* ── Shell with auction header ───────────────────────────────── */
function AuctionShell({
  children,
  requestNo,
  subject,
  countdown,
  auctionExpired,
  vendorName,
  vendorCode,
  currency,
}: {
  children: React.ReactNode
  requestNo?: string
  subject?: string
  countdown?: string
  auctionExpired?: boolean
  vendorName?: string
  vendorCode?: string
  currency?: string
}) {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/amber-logo.png" alt="Amber Enterprises" className="h-7 w-auto object-contain shrink-0" />
            <div className="h-5 w-px bg-slate-200 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reverse Auction</p>
              <p className="text-sm font-bold text-slate-900 truncate">
                {requestNo ? `${requestNo}: ` : ""}{subject ?? "Supplier Portal"}
              </p>
            </div>
          </div>
          {countdown !== undefined && (
            <div className={[
              "flex items-center gap-2 px-4 py-2 rounded-lg font-mono text-sm font-bold shrink-0",
              auctionExpired
                ? "bg-red-600 text-white"
                : "bg-[#171717] text-white",
            ].join(" ")}>
              <Clock className="w-4 h-4" />
              {auctionExpired ? "Closed" : countdown}
            </div>
          )}
        </div>
        {(vendorName || currency) && (
          <div className="bg-[#EFF6FF] border-t border-blue-100">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
              {vendorName && (
                <p className="text-slate-600 min-w-0 break-words">
                  You are bidding as: <span className="font-bold text-slate-800">{vendorName}</span>
                  {vendorCode && <span className="text-slate-400 ml-1">({vendorCode})</span>}
                </p>
              )}
              {currency && (
                <p className="text-slate-500 flex items-center gap-1 shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  All prices in <span className="font-bold text-slate-700">{currency}</span>
                </p>
              )}
            </div>
          </div>
        )}
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-4 pb-28">
        {children}
      </main>
    </div>
  )
}

/* ── Auction rules (shared across approval + live bid screens) ─ */
function AuctionRulesList({
  rules,
}: {
  rules: {
    bidValidityDays: string | number
    maxDecrements: string | number
    extensionDurationMins: string | number
    maxExtensionsPerBidder: string | number
    currency: string
  }
}) {
  return (
    <ul className="text-sm text-slate-600 space-y-2 bg-slate-50 rounded-lg p-4">
      <li className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>Bid validity: <strong>{rules.bidValidityDays} days</strong></span>
      </li>
      <li className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>Max decrements per bid: <strong>{rules.maxDecrements}</strong></span>
      </li>
      <li className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>
          Time extension: <strong>{rules.extensionDurationMins} minutes</strong>
          {" "}(max {rules.maxExtensionsPerBidder} per bidder)
        </span>
      </li>
      <li className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
        <span>Currency: <strong>{rules.currency}</strong></span>
      </li>
    </ul>
  )
}

/* ── Rank + best price + your bid summary ────────────────────── */
function RankSummaryCard({
  rank,
  bestPrice,
  grandTotal,
  gapToBest,
  aboveThreshold,
  threshold,
  hasExistingQuote,
}: {
  rank?: number
  bestPrice: number | null
  grandTotal: number
  gapToBest: number
  aboveThreshold: boolean
  threshold?: number
  hasExistingQuote: boolean
}) {
  const isLeading = rank === 1
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Rank</p>
          {rank != null ? (
            <div className="flex items-center gap-3">
              <div className={[
                "w-12 h-12 rounded-full flex items-center justify-center",
                isLeading ? "bg-slate-100" : "bg-slate-100",
              ].join(" ")}>
                <Medal className={["w-6 h-6", isLeading ? "text-slate-500" : "text-slate-400"].join(" ")} />
              </div>
              <div>
                <p className="text-3xl font-black text-slate-900 leading-none">{rankLabel(rank)}</p>
                <p className="text-sm text-slate-500 mt-1">
                  {isLeading
                    ? "You hold the best price."
                    : gapToBest > 0
                      ? `${fmt(gapToBest)} above best price`
                      : hasExistingQuote
                        ? "Submit a revised bid to improve your rank."
                        : "Submit your first bid to enter the ranking."}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Submit a bid to see your rank.</p>
          )}
        </div>
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Best Price</p>
          <p className="text-3xl font-black text-emerald-700 tabular-nums leading-none">
            {bestPrice != null ? fmt(Math.round(bestPrice)) : "—"}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {bestPrice != null ? "Lowest bid in this auction" : "No bids submitted yet"}
          </p>
        </div>
        <div className="px-6 py-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Your Bid Total</p>
          <p className="text-3xl font-black text-[#2563EB] tabular-nums leading-none">
            {grandTotal > 0 ? fmt(Math.round(grandTotal)) : "—"}
          </p>
          {threshold != null && (
            <p className={[
              "text-xs mt-2 font-medium",
              aboveThreshold ? "text-red-600" : "text-slate-600",
            ].join(" ")}>
              {aboveThreshold
                ? `Above threshold of ${fmt(threshold)}`
                : `Within threshold of ${fmt(threshold)}`}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Per-line-item best market price (no vendor identity) ──────── */
function InlineItemBestPrice({
  itemId,
  siblingInvites,
}: {
  itemId: string
  siblingInvites: Array<{ id: string; quotes: Quote[] }>
}) {
  const bestPrice = useMemo(() => {
    let lowest: number | null = null
    for (const inv of siblingInvites) {
      const latest = inv.quotes[inv.quotes.length - 1]
      const unitPrice = latest?.itemPrices?.[itemId]
      if (unitPrice == null) continue
      if (lowest === null || unitPrice < lowest) lowest = unitPrice
    }
    return lowest
  }, [itemId, siblingInvites])

  if (bestPrice === null) return null

  return (
    <p className="inline-flex items-center gap-1 mt-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
      <span aria-hidden="true">↓</span>
      <span className="uppercase tracking-wide">Best</span>
      <span className="tabular-nums">{fmt(bestPrice)}</span>
    </p>
  )
}

/* ── Turn banner: who the ball is with ──────────────────────────── */
function TurnBanner({ actionNeeded, label }: { actionNeeded: boolean; label: string }) {
  return (
    <div
      role="status"
      className={[
        "flex-1 min-w-[220px] flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold",
        actionNeeded
          ? "bg-[#EFF6FF] border-blue-200 text-[#1D4ED8]"
          : "bg-slate-50 border-slate-200 text-slate-500",
      ].join(" ")}
    >
      {actionNeeded ? <AlertCircle className="w-4 h-4 shrink-0" /> : <Hourglass className="w-4 h-4 shrink-0" />}
      <span>{label}</span>
    </div>
  )
}

/* ── RFQ status pill (single-vendor, no cross-vendor data) ───────── */
function RfqStatusPill({ status }: { status: ReturnType<typeof effectiveRfqStatus> }) {
  return (
    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${RFQ_STATUS_COLORS[status]}`}>
      {RFQ_STATUS_LABELS[status]}
    </span>
  )
}

/* ── Read-only request scope (reference rows — NO price inputs) ──── */
function RequestScopeCard({ request }: { request: CapexRequest }) {
  const lineItems = request.lineItems ?? []
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100">
        <h2 className="text-base font-bold text-slate-900">Requirement Scope</h2>
        <p className="text-xs text-slate-500 mt-0.5">For reference — this is a lump-sum quotation, not per-line pricing.</p>
      </div>
      <div className="px-5 sm:px-6 py-4 space-y-4 text-sm text-slate-700">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{request.category}</span>
          {lineItems.length > 0
            ? <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{lineItems.length} item{lineItems.length !== 1 ? "s" : ""}</span>
            : <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>}
        </div>
        {request.justification && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Requirement</p>
            <p className="leading-relaxed">{request.justification}</p>
          </div>
        )}
        {request.techSpecs?.specifications && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Specifications</p>
            <p className="leading-relaxed">{request.techSpecs.specifications}</p>
          </div>
        )}
        {lineItems.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
            {lineItems.map((item, idx) => (
              <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 bg-white">
                <span className="text-xs font-bold text-slate-300 w-5 shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 leading-snug">{item.description}</p>
                  {item.machineCapacity && (
                    <p className="text-xs text-slate-700 mt-0.5">Capacity: {item.machineCapacity}</p>
                  )}
                  {item.specs && <p className="text-xs text-slate-500 mt-0.5">{item.specs}</p>}
                  {item.remarks && <p className="text-xs text-slate-500 mt-0.5">{item.remarks}</p>}
                </div>
                <span className="text-sm font-bold text-slate-600 shrink-0">×{item.quantity}{item.uom ? ` ${item.uom}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/* ── Read-only quotation summary (vendor's own figures only) ─────── */
function QuoteSummaryCard({ quote, title }: { quote?: RfqQuote; title: string }) {
  const total = rfqTotal(quote)
  const rows: [string, string][] = [
    ["Price", quote ? fmt(quote.price) : "—"],
    ["Transportation / Freight", quote?.freight != null ? fmt(quote.freight) : "—"],
    ["Packing / Forwarding", quote?.packing != null ? fmt(quote.packing) : "—"],
    ["Service / Installation", quote?.service != null ? fmt(quote.service) : "—"],
    ["Delivery Lead Time", quote?.deliveryWeeks != null ? `${quote.deliveryWeeks} week${quote.deliveryWeeks !== 1 ? "s" : ""}` : "—"],
    ["Warranty", quote?.warranty != null ? `${quote.warranty} year${quote.warranty !== 1 ? "s" : ""}` : "—"],
    ["GST", rfqGstAmount(quote) > 0 ? fmt(Math.round(rfqGstAmount(quote))) : "—"],
    ["Currency", quote?.currency ?? "INR"],
  ]
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <FileText className="w-5 h-5 text-[#2563EB]" />
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
      </div>
      <div className="px-5 sm:px-6 py-3">
        {rows.map(([label, val]) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold tabular-nums text-slate-800">{val}</span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-3 mt-1">
          <span className="text-sm font-bold text-slate-700">Grand Total</span>
          <span className="text-xl font-black text-[#2563EB] tabular-nums">{total > 0 ? fmt(total) : "—"}</span>
        </div>
      </div>
    </section>
  )
}

const CURRENCIES = ["INR", "USD", "EUR"] as const

/* ── Quotation summary with a per-line table (or attribute rows for legacy) ──
   The single source of truth for showing a submitted/agreed quotation across EVERY
   read surface (under-review, counter, agreed/terms-declined, approved/all-set, and
   rejected/last-quotation), so the same quote shows one identical GST-inclusive grand
   total everywhere. When the request has line items it renders the navy-header
   single-vendor table (desktop) / cards (mobile) with item-wise GST via rfqUtils; when
   there are none it falls back to the legacy lump-sum QuoteSummaryCard. */
function RfqQuoteSummary({
  quote,
  lineItems,
  title,
}: {
  quote?: RfqQuote
  lineItems: CapexLineItem[]
  title: string
}) {
  if (!lineItems.length) return <QuoteSummaryCard quote={quote} title={title} />
  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center gap-2">
        <FileText className="w-5 h-5 text-[#2563EB]" />
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
      </div>
      <div className="px-5 sm:px-6 py-4">
        <div className="hidden lg:block">
          <SupplierQuoteTable variant="read" quote={quote} lineItems={lineItems} />
        </div>
        <div className="lg:hidden">
          <SupplierQuoteCards variant="read" quote={quote} lineItems={lineItems} />
        </div>
      </div>
    </section>
  )
}

/* ── Quotation ENTRY form (vendor-quotes-first default) ──────────── */
function QuotationEntryForm({
  invite,
  request,
  vendorName,
}: {
  invite: VendorInvite
  request: CapexRequest
  vendorName: string
}) {
  const { proposeRfqQuote, setLineHsn } = useCapex()
  const existing = invite.rfqQuote
  const lineItems = request.lineItems ?? []
  const hasLineItems = lineItems.length > 0

  // Per-line HSN codes the vendor enters (string-keyed). Seeded from the item's current HSN so
  // anything Amber pre-set shows up; the vendor can change it. Persisted onto the line items on submit.
  const seedHsn = () => Object.fromEntries(lineItems.filter(i => i.hsnCode).map(i => [i.id, i.hsnCode!]))
  const [hsnByItem, setHsnByItem] = useState<Record<string, string>>(seedHsn)

  // Per-line unit prices (string-keyed for inputs). Seeded from any existing quote.
  const [linePrices, setLinePrices] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (existing?.linePrices) {
      for (const [id, v] of Object.entries(existing.linePrices)) seed[id] = String(v)
    }
    return seed
  })
  // Legacy single-price fallback (only used when the request has no line items).
  const [price, setPrice] = useState(existing?.price != null && !existing.linePrices ? String(existing.price) : "")
  const [freight, setFreight] = useState(existing?.freight != null ? String(existing.freight) : "")
  const [packing, setPacking] = useState(existing?.packing != null ? String(existing.packing) : "")
  const [service, setService] = useState(existing?.service != null ? String(existing.service) : "")
  const [deliveryWeeks, setDeliveryWeeks] = useState(existing?.deliveryWeeks != null ? String(existing.deliveryWeeks) : "")
  const [warranty, setWarranty] = useState(existing?.warranty != null ? String(existing.warranty) : "")
  const [currency, setCurrency] = useState(existing?.currency ?? "INR")

  const numericLinePrices = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, v] of Object.entries(linePrices)) out[id] = Number(v) || 0
    return out
  }, [linePrices])

  // Line items with the vendor's in-progress HSN selections applied, so the GST preview is live.
  const effectiveLineItems = useMemo(
    () => lineItems.map(it => ({ ...it, hsnCode: hsnByItem[it.id] || it.hsnCode })),
    [lineItems, hsnByItem],
  )

  const subtotal = hasLineItems
    ? rfqLineSubtotal(numericLinePrices, lineItems)
    : (Number(price) || 0)
  const extrasTotal = (Number(freight) || 0) + (Number(packing) || 0) + (Number(service) || 0)
  const taxableValue = subtotal + extrasTotal
  // GST is item-wise: derived from each line item's own HSN code (which the vendor enters per line).
  const gstValue = hasLineItems ? rfqGstAmount({ price: subtotal, linePrices: numericLinePrices }, effectiveLineItems) : 0
  const grandTotal = taxableValue + gstValue

  const allLinesPriced = hasLineItems
    ? lineItems.every(it => (Number(linePrices[it.id]) || 0) > 0)
    : (Number(price) || 0) > 0
  const valid = allLinesPriced && deliveryWeeks.trim() !== "" && Number(deliveryWeeks) > 0

  function reset() {
    setLinePrices({})
    setHsnByItem(seedHsn())
    setPrice(""); setFreight(""); setPacking(""); setService("")
    setDeliveryWeeks(""); setWarranty(""); setCurrency("INR")
  }

  function submit() {
    if (!valid) {
      toast.error(hasLineItems ? "Enter a unit price for every line item and a delivery lead time" : "Enter a valid price and delivery lead time")
      return
    }
    // Persist the vendor's per-item HSN onto the line items (item-wise; drives GST for everyone).
    if (hasLineItems) {
      for (const it of lineItems) setLineHsn(request.id, it.id, hsnByItem[it.id] ?? "")
    }
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s))
    const quote: RfqQuote = {
      price: subtotal,
      ...(hasLineItems ? { linePrices: numericLinePrices } : {}),
      freight: num(freight),
      packing: num(packing),
      service: num(service),
      deliveryWeeks: num(deliveryWeeks),
      warranty: num(warranty),
      currency,
    }
    proposeRfqQuote(invite.id, quote, "supplier", vendorName)
    toast.success("Quotation sent to Amber.")
  }

  return (
    <div className="space-y-4">
      {!hasLineItems && <RequestScopeCard request={request} />}

      {/* Your Quotation */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-900 mb-1">Your Quotation</h2>
        <p className="text-xs text-slate-500 mb-4">
          {hasLineItems ? "Enter your unit price and HSN code for each line item below." : "Enter your lump-sum price for this requirement."}
        </p>
        {hasLineItems ? (
          <>
            <div className="hidden lg:block">
              <SupplierQuoteTable
                variant="entry"
                lineItems={lineItems}
                linePrices={linePrices}
                onLinePrice={(id, v) => setLinePrices(prev => ({ ...prev, [id]: v }))}
                hsnByItem={hsnByItem}
                onHsnChange={(id, v) => setHsnByItem(prev => ({ ...prev, [id]: v }))}
              />
            </div>
            <div className="lg:hidden">
              <SupplierQuoteCards
                variant="entry"
                lineItems={lineItems}
                linePrices={linePrices}
                onLinePrice={(id, v) => setLinePrices(prev => ({ ...prev, [id]: v }))}
                hsnByItem={hsnByItem}
                onHsnChange={(id, v) => setHsnByItem(prev => ({ ...prev, [id]: v }))}
              />
            </div>
          </>
        ) : (
          <div className="max-w-sm">
            <label htmlFor="rfq-price" className={LABEL_REQ}>Unit Price (₹)</label>
            <input
              id="rfq-price"
              type="number"
              inputMode="decimal"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
              placeholder="e.g. 4,500,000"
              className={`${INPUT_RIGHT} min-h-[44px]`}
            />
          </div>
        )}
      </section>

      {/* Additional Charges */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">Additional Charges</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([
            { id: "rfq-freight", label: "Freight & Handling", value: freight, set: setFreight },
            { id: "rfq-packing", label: "Packing & Forwarding", value: packing, set: setPacking },
            { id: "rfq-service", label: "Service / Installation", value: service, set: setService },
          ]).map(({ id, label, value, set }) => (
            <div key={id}>
              <label htmlFor={id} className={LABEL}>{label} <span className="font-normal text-slate-400">(₹)</span></label>
              <input
                id={id}
                type="number"
                inputMode="decimal"
                min="0"
                value={value}
                onChange={e => set(e.target.value)}
                placeholder="0"
                className={`${INPUT} min-h-[44px]`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Delivery & Validity */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">Delivery &amp; Validity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="rfq-delivery" className={LABEL_REQ}>Delivery Lead Time (weeks)</label>
            <input
              id="rfq-delivery"
              type="number"
              inputMode="decimal"
              min="1"
              value={deliveryWeeks}
              onChange={e => setDeliveryWeeks(e.target.value)}
              placeholder="e.g. 12"
              className={`${INPUT} min-h-[44px]`}
            />
          </div>
          <div>
            <label htmlFor="rfq-warranty" className={LABEL}>Warranty <span className="font-normal text-slate-400">(years)</span></label>
            <input
              id="rfq-warranty"
              type="number"
              inputMode="decimal"
              min="0"
              value={warranty}
              onChange={e => setWarranty(e.target.value)}
              placeholder="e.g. 2"
              className={`${INPUT} min-h-[44px]`}
            />
          </div>
          <div>
            <label htmlFor="rfq-currency" className={LABEL}>Currency</label>
            <select
              id="rfq-currency"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className={`${INPUT} min-h-[44px]`}
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* Grand Total Summary */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 sm:p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">Grand Total Summary</h2>
        <div className="space-y-3">
          <div className="flex justify-between text-sm text-slate-600">
            <span>{hasLineItems ? "Subtotal (line items)" : "Subtotal (price)"}</span>
            <span className="font-semibold tabular-nums" aria-live="polite">{subtotal > 0 ? fmt(Math.round(subtotal)) : "—"}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>Total Additional</span>
            <span className="font-semibold tabular-nums text-slate-600">{extrasTotal > 0 ? `+${fmt(Math.round(extrasTotal))}` : "—"}</span>
          </div>
          <div className="flex justify-between text-sm text-slate-600">
            <span>GST <span className="text-slate-400">(as per HSN)</span></span>
            <span className="font-semibold tabular-nums text-slate-700" aria-live="polite">{gstValue > 0 ? `+${fmt(Math.round(gstValue))}` : "—"}</span>
          </div>
          <div className="border-t border-slate-200 pt-3 flex justify-between items-end">
            <span className="text-sm font-bold text-slate-700">Grand Total <span className="font-normal text-slate-400">(incl. GST)</span></span>
            <span className="text-2xl font-black text-[#2563EB] tabular-nums" aria-live="polite">
              {grandTotal > 0 ? fmt(Math.round(grandTotal)) : "—"}
            </span>
          </div>
        </div>
      </section>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500 truncate min-w-0">
            {grandTotal > 0
              ? <>Grand total <span className="font-bold text-slate-700">{fmt(Math.round(grandTotal))}</span></>
              : hasLineItems ? "Enter a unit price for each line to continue" : "Enter your price to continue"}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reset
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!valid}
              className="inline-flex items-center gap-2 min-h-[44px] px-6 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-sm"
            >
              <Send className="w-4 h-4" /> Submit Quotation
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── INCO Terms status pill (mirrors RfqStatusPill) ──────────────────────── */
function IncoStatusPill({ status }: { status: ReturnType<typeof effectiveIncoTermsStatus> }) {
  return (
    <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${INCO_TERMS_STATUS_COLORS[status]}`}>
      {INCO_TERMS_STATUS_LABELS[status]}
    </span>
  )
}

/* ── INCO Terms questionnaire form (vendor fills / suggests changes) ──────── */
function IncoTermsForm({
  doc,
  onChange,
}: {
  doc: IncoTermsDoc
  onChange: (key: keyof IncoTermsDoc, value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {INCO_TERMS_QUESTIONS.map(q => {
        const id = `inco-${q.key}`
        const value = (doc[q.key] as string | undefined) ?? ""
        const isWide = q.type === "textarea"
        const label = q.required
          ? <label htmlFor={id} className={LABEL_REQ}>{q.label}</label>
          : <label htmlFor={id} className={LABEL}>{q.label}</label>
        return (
          <div key={q.key} className={isWide ? "sm:col-span-2" : ""}>
            {label}
            {q.type === "select" ? (
              <select
                id={id}
                value={value}
                onChange={e => onChange(q.key, e.target.value)}
                className={`${INPUT} min-h-[44px]`}
              >
                <option value="">Select…</option>
                {q.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            ) : q.type === "textarea" ? (
              <textarea
                id={id}
                value={value}
                onChange={e => onChange(q.key, e.target.value)}
                rows={3}
                placeholder="Delivery timeline, currency & any remarks…"
                className={`${INPUT} resize-none`}
              />
            ) : (
              <input
                id={id}
                type="text"
                value={value}
                onChange={e => onChange(q.key, e.target.value)}
                className={`${INPUT} min-h-[44px]`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── INCO Terms read-only review (submitted / sourcing-revised answers) ───── */
function IncoTermsReview({ doc, revisionNote }: { doc?: IncoTermsDoc; revisionNote?: string }) {
  return (
    <div className="space-y-3">
      {revisionNote && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <span className="font-bold">Note from Amber: </span>{revisionNote}
        </div>
      )}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {INCO_TERMS_QUESTIONS.map(q => {
          const v = (doc?.[q.key] as string | undefined)
          return (
            <div key={q.key} className="flex items-start justify-between gap-4 px-4 py-2.5 border-b border-slate-100 last:border-0 text-sm">
              <span className="text-slate-500 shrink-0">{q.label}</span>
              <span className="font-semibold text-slate-800 text-right break-words">{v && v.trim() ? v : "—"}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── INCO Terms gate screen (one-time vendors agree before quoting) ──────── */
function IncoTermsGate({
  invite,
  request,
  vendor,
  vendorName,
}: {
  invite: VendorInvite
  request: CapexRequest
  vendor: Vendor | null
  vendorName: string
}) {
  const { proposeIncoTerms, respondToIncoTerms } = useCapex()
  const status = effectiveIncoTermsStatus(invite)
  const card = SUPPLIER_CARD

  // Editable working copy of the doc (used in awaiting_vendor + "Suggest changes").
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<IncoTermsDoc>(() => invite.incoTermsDoc ?? buildBlankIncoTermsDoc())
  const setField = (key: keyof IncoTermsDoc, value: string) =>
    setDraft(prev => ({ ...prev, [key]: value }))

  const complete = isIncoDocComplete(draft)
  const isFormScreen = status === "awaiting_vendor" || status === "not_sent" || editing

  function submitTerms() {
    if (!complete) { toast.error("Answer all required questions before submitting"); return }
    proposeIncoTerms(invite.id, draft, "vendor", vendorName)
    setEditing(false)
    toast.success("INCO Terms sent to Amber for review")
  }

  // Turn banner copy by state.
  let actionNeeded = false
  let turnLabel = "Waiting on Amber's sourcing team."
  if (isFormScreen) { actionNeeded = true; turnLabel = "Action needed — complete the INCO (Incoterms 2020) agreement to begin quoting." }
  else if (status === "pending_sourcing") { turnLabel = "Waiting on Amber — your INCO Terms are under review." }
  else if (status === "pending_vendor") { actionNeeded = true; turnLabel = "Action needed — review Amber's revised INCO Terms." }
  else if (status === "rejected") { turnLabel = "INCO Terms declined." }

  let body: React.ReactNode

  if (isFormScreen) {
    /* ── Vendor fills (or re-opens to suggest changes) ── */
    body = (
      <div className={`${card} max-w-3xl mx-auto`}>
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-bold text-slate-900">INCO Terms (Incoterms 2020)</h2>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          As a first-time supplier, please confirm the delivery and risk terms below before submitting a price quote.
        </p>
        <IncoTermsForm doc={draft} onChange={setField} />
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={submitTerms}
            disabled={!complete}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-[44px] px-6 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-sm"
          >
            <Send className="w-4 h-4" /> Submit Terms
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => { setDraft(invite.incoTermsDoc ?? buildBlankIncoTermsDoc()); setEditing(false) }}
              className="px-4 min-h-[44px] rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold text-sm transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  } else if (status === "pending_sourcing") {
    /* ── Under review by sourcing ── */
    body = (
      <div className="space-y-4 max-w-3xl mx-auto">
        <div className={`${card} text-center`}>
          <Hourglass className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Under Review by Amber&apos;s Sourcing Team</h2>
          <p className="text-sm text-slate-600 mt-2">
            We&apos;ll update this page once Amber reviews your INCO Terms. You can start quoting once they&apos;re approved.
          </p>
        </div>
        <div className={card}>
          <h3 className="text-sm font-bold text-slate-800 mb-3">Your Submitted Terms</h3>
          <IncoTermsReview doc={invite.incoTermsDoc} />
        </div>
      </div>
    )
  } else if (status === "pending_vendor") {
    /* ── Sourcing revised — vendor accepts / suggests changes / declines ── */
    body = (
      <div className="space-y-4 max-w-3xl mx-auto">
        <div className={card}>
          <div className="flex items-center gap-2 mb-1">
            <ScrollText className="w-5 h-5 text-[#2563EB]" />
            <h2 className="text-lg font-bold text-slate-900">Amber&apos;s Revised INCO Terms</h2>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Amber&apos;s sourcing team has revised the terms. Review them and accept, suggest changes, or decline.
          </p>
          <IncoTermsReview doc={invite.incoTermsDoc} revisionNote={invite.incoTermsDoc?.revisionNote} />
        </div>
        <div className={card}>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={() => { respondToIncoTerms(invite.id, "approved", "vendor", vendorName); toast.success("INCO Terms accepted") }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 min-h-[44px]"
            >
              <ThumbsUp className="w-4 h-4" /> Accept Terms
            </button>
            <button
              type="button"
              onClick={() => { setDraft(invite.incoTermsDoc ?? buildBlankIncoTermsDoc()); setEditing(true) }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-white border border-[#2563EB]/30 text-[#2563EB] hover:bg-[#2563EB]/5 font-semibold py-2.5 min-h-[44px]"
            >
              <RotateCcw className="w-4 h-4" /> Suggest Changes
            </button>
            <button
              type="button"
              onClick={() => { respondToIncoTerms(invite.id, "rejected", "vendor", vendorName); toast("INCO Terms declined") }}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold py-2.5 min-h-[44px]"
            >
              <ThumbsDown className="w-4 h-4" /> Decline
            </button>
          </div>
        </div>
      </div>
    )
  } else {
    /* ── Terminal: rejected ── */
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">INCO Terms Declined</h2>
          <p className="text-sm text-slate-600 mt-2">
            The INCO (Incoterms 2020) agreement was declined, so quoting is on hold. Please contact your Amber
            sourcing contact to revise and resubmit the terms.
          </p>
        </div>
        {invite.incoTermsDoc && (
          <div className={card}>
            <h3 className="text-sm font-bold text-slate-800 mb-3">Last Submitted Terms</h3>
            <IncoTermsReview doc={invite.incoTermsDoc} />
          </div>
        )}
      </div>
    )
  }

  return (
    <AuctionShell
      requestNo={request.requestNo}
      subject={request.subject}
      vendorName={vendor?.vendorName}
      vendorCode={vendor?.vendorCode}
    >
      <div className={`flex flex-wrap items-center justify-between gap-3 ${isFormScreen ? "max-w-3xl" : "max-w-3xl"} mx-auto`}>
        <TurnBanner actionNeeded={actionNeeded} label={turnLabel} />
        <IncoStatusPill status={status} />
      </div>
      {body}
    </AuctionShell>
  )
}

/* ── Vendor Purchase Order card (post-PI fulfillment) ────────────────────── */
function PurchaseOrderCard({ po }: { po?: PurchaseOrder }) {
  if (!po?.issuedAt) return null
  const hasDoc = !!po.poDocumentBase64
  return (
    <div className={SUPPLIER_CARD}>
      <div className="flex items-center gap-2 mb-4">
        <Receipt className="w-5 h-5 text-[#2563EB]" />
        <h3 className="font-bold text-slate-900">Purchase Order</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">PO Number</p>
          <p className="text-sm font-bold text-slate-800 break-words" title={po.poNumber}>{po.poNumber}</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">PO Amount</p>
          <p className="text-sm font-bold text-slate-800 tabular-nums break-words" title={fmt(po.amount)}>{fmt(po.amount)}</p>
        </div>
      </div>
      {hasDoc ? (
        <a
          href={`data:${po.poDocumentMimeType || "application/octet-stream"};base64,${po.poDocumentBase64}`}
          download={po.poDocumentName || `PO-${po.poNumber}`}
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold text-sm transition-colors w-full sm:w-auto"
        >
          <Download className="w-4 h-4" /> Download PO Document
        </a>
      ) : (
        <p className="text-xs text-slate-400">PO document not attached. Contact your Amber buyer for a copy.</p>
      )}
      <p className="flex items-center gap-1.5 text-xs text-slate-700 font-medium mt-3">
        <CheckCircle2 className="w-3.5 h-3.5" /> PO received from Amber
        <span className="text-slate-400 font-normal">· issued {formatTs(po.issuedAt)}</span>
      </p>
    </div>
  )
}

/* ── Brown Field RFQ supplier view (vendor-quotes-first) ───────────────── */
function RfqSupplierView({
  invite,
  request,
  vendor,
}: {
  invite: VendorInvite
  request: CapexRequest
  vendor: Vendor | null
}) {
  const { respondToRfqQuote, proposeRfqQuote, submitProformaInvoice, respondToDocApproval, invites } = useCapex()
  // Split-award: this invite is a self-contained fulfillment track. Scope the line items to the
  // ones this vendor was awarded, and drive the total / PO / payments from the invite's own fields.
  const isAward = !!invite.awarded
  const lineItems = (request.lineItems ?? []).filter(
    (li) => !isAward || invite.awardedItemIds?.includes(li.id),
  )
  const hasLineItems = lineItems.length > 0
  // RFQ keeps its rfqQuote-derived total; an award / auction winner's rfqQuote is stale/absent (the
  // final price lives in the award amount or auction Quote), so use the award amount or the
  // canonical resolver used by accounts/PO.
  const quoteTotal = isAward
    ? invite.awardAmount ?? 0
    : invite.rfqQuote && request.sourcingMode !== "auction"
      ? rfqTotal(invite.rfqQuote, lineItems)
      : resolveFinalVendor(request, invites).amount
  const [piName, setPiName] = useState(invite.proformaInvoice?.name ?? "")
  const [piBase64, setPiBase64] = useState(invite.proformaInvoice?.base64 ?? "")
  const [piMime, setPiMime] = useState(invite.proformaInvoice?.mimeType ?? "")
  const [piAmount, setPiAmount] = useState(quoteTotal ? String(quoteTotal) : "")
  const [piNote, setPiNote] = useState("")
  const [fileError, setFileError] = useState("")

  // Counter-offer form (vendor edits sourcing's counter and sends it back).
  const cq = invite.rfqQuote
  const [counterOpen, setCounterOpen] = useState(false)
  // Per-line counter prices, pre-filled from the current quote's line prices.
  const [cLinePrices, setCLinePrices] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    if (cq?.linePrices) {
      for (const [id, v] of Object.entries(cq.linePrices)) seed[id] = String(v)
    }
    return seed
  })
  const [cForm, setCForm] = useState({
    price: cq?.price != null ? String(cq.price) : "",
    freight: cq?.freight != null ? String(cq.freight) : "",
    packing: cq?.packing != null ? String(cq.packing) : "",
    service: cq?.service != null ? String(cq.service) : "",
    deliveryWeeks: cq?.deliveryWeeks != null ? String(cq.deliveryWeeks) : "",
    warranty: cq?.warranty != null ? String(cq.warranty) : "",
    currency: cq?.currency ?? "INR",
  })

  const rfqStatus = effectiveRfqStatus(invite)
  const docStatus = effectiveDocApprovalStatus(invite.docApprovalStatus)
  const vendorName = vendor?.vendorName ?? "Vendor"
  // For an award, fulfillment is tracked on the invite (awardStatus); otherwise on request.status.
  const fulfilled = isAward
    ? ["pi_submitted", "accounts_processing", "payment_in_progress", "completed"].includes(invite.awardStatus ?? "")
    : ["pi_submitted", "accounts_processing", "payment_in_progress", "completed"].includes(request.status)
  const piRequested = isAward ? invite.awardStatus === "pi_requested" : request.status === "pi_requested"
  const card = `${SUPPLIER_CARD} max-w-2xl mx-auto`

  // INCO Terms gate: a one-time vendor must agree to the Incoterms questionnaire before the
  // price-quote flow opens. Never gate once we're past quoting (PI request + fulfillment).
  const inQuotingPhase = !fulfilled && !piRequested
  const incoBlocked = inQuotingPhase && incoTermsBlocksQuote(invite, vendor)
  // Contract-documents gate: an RFQ vendor must approve the doc-package (Commercial Terms / PBG /
  // Delay Liability Clause / payment terms) BEFORE entering their price. Only blocks when a package
  // was actually sent (legacy invites with no package fall through unchanged).
  const docsBlocked =
    inQuotingPhase &&
    !!invite.docApprovalPackage &&
    effectiveDocApprovalStatus(invite.docApprovalStatus) !== "approved"

  const cNumericLinePrices = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [id, v] of Object.entries(cLinePrices)) out[id] = Number(v) || 0
    return out
  }, [cLinePrices])
  const cSubtotal = hasLineItems
    ? rfqLineSubtotal(cNumericLinePrices, lineItems)
    : (parseFloat(cForm.price) || 0)
  const cExtras = (Number(cForm.freight) || 0) + (Number(cForm.packing) || 0) + (Number(cForm.service) || 0)
  const cTaxable = cSubtotal + cExtras
  // GST is item-wise — derived from each line item's HSN code (set by Amber on the request).
  const cGstValue = hasLineItems ? rfqGstAmount({ price: cSubtotal, linePrices: cNumericLinePrices }, lineItems) : 0
  const cGrandTotal = cTaxable + cGstValue

  function sendCounter() {
    if (hasLineItems) {
      const allPriced = lineItems.every(it => (Number(cLinePrices[it.id]) || 0) > 0)
      if (!allPriced) { toast.error("Enter a unit price for every line item"); return }
    } else {
      const price = parseFloat(cForm.price)
      if (isNaN(price) || price <= 0) { toast.error("Enter a valid price"); return }
    }
    const num = (s: string) => (s.trim() === "" ? undefined : parseFloat(s))
    const quote: RfqQuote = {
      price: cSubtotal,
      ...(hasLineItems ? { linePrices: cNumericLinePrices } : {}),
      freight: num(cForm.freight), packing: num(cForm.packing), service: num(cForm.service),
      deliveryWeeks: num(cForm.deliveryWeeks), warranty: num(cForm.warranty),
      currency: cForm.currency,
    }
    proposeRfqQuote(invite.id, quote, "supplier", vendorName)
    setCounterOpen(false)
    toast.success("Counter-quotation sent to Amber")
  }

  function handlePiFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) { setFileError("File must be under 500 KB"); return }
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result as string
      setPiBase64(r.split(",")[1] ?? "")
      setPiName(file.name)
      setPiMime(file.type)
      setFileError("")
    }
    reader.readAsDataURL(file)
  }

  function submitPi() {
    if (!piBase64) { toast.error("Attach the Proforma Invoice file"); return }
    submitProformaInvoice(invite.id, {
      id: `pi-${Date.now()}`,
      name: piName,
      base64: piBase64,
      mimeType: piMime,
      uploadedAt: new Date().toISOString(),
      amount: piAmount ? Number(piAmount) : undefined,
      note: piNote || undefined,
    })
    toast.success("Proforma Invoice submitted")
  }

  // One-time vendors agree to INCO Terms before the quote flow renders.
  if (incoBlocked) {
    return <IncoTermsGate invite={invite} request={request} vendor={vendor} vendorName={vendorName} />
  }

  // Contract documents must be approved BEFORE the vendor can enter a price.
  if (docsBlocked) {
    const dStatus = effectiveDocApprovalStatus(invite.docApprovalStatus)
    return (
      <AuctionShell
        requestNo={request.requestNo}
        subject={request.subject}
        vendorName={vendor?.vendorName}
        vendorCode={vendor?.vendorCode}
        currency={invite.rfqQuote?.currency ?? "INR"}
      >
        {dStatus === "rejected" ? (
          <div className={`${card} text-center`}>
            <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-900">Terms Declined</h2>
            <p className="text-sm text-slate-600 mt-2">
              You declined the contract terms ({docPackageTitles(invite.docApprovalPackage).join(" / ") || "Commercial Terms / PBG / Delay Liability Clause"}), so the
              quotation form is locked. Please contact Amber&apos;s sourcing team to re-open the documents.
            </p>
          </div>
        ) : (
          <div className="space-y-4 max-w-2xl mx-auto">
            <div className={`${card} text-center`}>
              <FileText className="w-12 h-12 text-[#2563EB] mx-auto mb-3" />
              <h2 className="text-lg font-bold text-slate-900">First, Approve the Contract Terms</h2>
              <p className="text-sm text-slate-600 mt-2">
                Please review and accept the documents below. Your quotation form unlocks once you accept.
              </p>
            </div>
            {invite.docApprovalPackage && (
              <DocPackageReview
                pkg={invite.docApprovalPackage}
                onApprove={() => { respondToDocApproval(invite.id, "approved"); toast.success("Terms accepted — you can now submit your quotation") }}
                onReject={() => { respondToDocApproval(invite.id, "rejected"); toast("Terms declined") }}
              />
            )}
          </div>
        )}
      </AuctionShell>
    )
  }

  // Turn banner copy by state.
  let actionNeeded = false
  let turnLabel = "No action needed — waiting on Amber."
  if (!fulfilled && !piRequested) {
    if (rfqStatus === "awaiting_quote") { actionNeeded = true; turnLabel = "Action needed — submit your quotation." }
    else if (rfqStatus === "pending_vendor") { actionNeeded = true; turnLabel = "Action needed — review Amber's counter-quotation." }
    else if (rfqStatus === "pending_sourcing") { turnLabel = "No action needed — your quotation is under review by Amber." }
    else if (rfqStatus === "approved" && docStatus === "pending") { actionNeeded = true; turnLabel = "Action needed — approve the contract terms." }
    else if (rfqStatus === "approved") { turnLabel = "No action needed — waiting on Amber to request your Proforma Invoice." }
  } else if (piRequested) {
    actionNeeded = true
    turnLabel = "Action needed — upload your Proforma Invoice."
  }

  let body: React.ReactNode

  /* ── Fulfillment: PI submitted → PO → payments (per-award when awarded) ── */
  if (fulfilled) {
    // Award tracks carry their own PO + milestones + TAT anchors on the invite.
    const milestones = (isAward ? invite.paymentMilestones : request.paymentMilestones) ?? []
    const po = isAward ? invite.purchaseOrder : request.purchaseOrder
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Proforma Invoice Submitted</h2>
          <p className="text-sm text-slate-600 mt-2">
            Thank you. Your PI has been sent to Amber&apos;s buyer and accounts team for PO processing and payment.
          </p>
        </div>
        <TatBanner
          piSubmittedAt={isAward ? invite.piSubmittedAt : request.piSubmittedAt}
          tatStoppedAt={isAward ? invite.tatStoppedAt : request.tatStoppedAt}
          vendorAmount={quoteTotal || po?.amount || request.budget || 0}
        />
        <PurchaseOrderCard po={po} />
        {milestones.length > 0 && (
          <div className={card}>
            <h3 className="font-bold text-slate-900 mb-3">Payment Status</h3>
            <div className="space-y-1.5">
              {milestones.map(m => (
                <div key={m.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${m.status === "paid" ? "border-slate-200 bg-slate-50" : "border-slate-200"}`}>
                  <span className="text-sm text-slate-700 min-w-0">
                    {m.label} <span className="text-slate-400">({m.percent}%)</span>
                  </span>
                  <span className="flex items-center gap-2 text-sm shrink-0">
                    <span className="font-mono font-semibold break-words" title={fmt(m.amount)}>{fmt(m.amount)}</span>
                    {m.status === "paid"
                      ? <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Paid</span>
                      : <span className="text-[11px] font-semibold text-slate-400">Pending</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  } else if (piRequested) {
    /* ── PI upload ── */
    body = (
      <div className={card}>
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-[#2563EB]" />
          <h2 className="text-lg font-bold text-slate-900">Upload Proforma Invoice</h2>
        </div>
        <p className="text-sm text-slate-600 mb-4">
          Your quotation of <span className="font-bold">{quoteTotal ? fmt(quoteTotal) : "—"}</span> (grand total) was approved.
          Upload your Proforma Invoice to proceed.
        </p>
        <div className="space-y-4">
          <div>
            <label htmlFor="pi-amount" className={LABEL}>PI Amount (₹)</label>
            <input id="pi-amount" type="number" inputMode="decimal" value={piAmount} onChange={e => setPiAmount(e.target.value)} className={`${INPUT_RIGHT} min-h-[44px]`} />
          </div>
          <div>
            <label className={LABEL_REQ}>Proforma Invoice File</label>
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:bg-slate-50 min-h-[44px]">
              <Paperclip className="w-4 h-4" />
              {piName || "Attach PDF / image (max 500 KB)"}
              <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.doc,.docx" onChange={handlePiFile} className="hidden" />
            </label>
            {fileError && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
          </div>
          <div>
            <label htmlFor="pi-note" className={LABEL}>Note (optional)</label>
            <input id="pi-note" value={piNote} onChange={e => setPiNote(e.target.value)} className={`${INPUT} min-h-[44px]`} placeholder="Any remarks for the buyer…" />
          </div>
          <button onClick={submitPi}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold py-2.5 min-h-[44px] transition-colors">
            <Send className="w-4 h-4" /> Submit Proforma Invoice
          </button>
        </div>
      </div>
    )
  } else if (rfqStatus === "awaiting_quote") {
    /* ── 1. Vendor submits the first quotation ── */
    body = <QuotationEntryForm invite={invite} request={request} vendorName={vendorName} />
  } else if (rfqStatus === "pending_sourcing") {
    /* ── 2. Vendor's quotation under review by sourcing ── */
    body = (
      <div className={`space-y-4 mx-auto ${hasLineItems ? "max-w-3xl" : "max-w-2xl"}`}>
        <RfqQuoteSummary quote={invite.rfqQuote} lineItems={lineItems} title="Quotation Under Review" />
        <div className={`${card} text-center`}>
          <Hourglass className="w-12 h-12 text-slate-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Submitted to Amber</h2>
          <p className="text-sm text-slate-600 mt-2">
            Your quotation{quoteTotal ? ` of ${fmt(quoteTotal)} (grand total)` : ""} is with Amber&apos;s sourcing team for review.
            We&apos;ll update this page when they respond.
          </p>
        </div>
      </div>
    )
  } else if (rfqStatus === "pending_vendor") {
    /* ── 3. Sourcing countered — vendor approves / counters / declines ── */
    body = (
      <div className={`space-y-4 mx-auto ${hasLineItems ? "max-w-3xl" : "max-w-2xl"}`}>
        <RfqQuoteSummary quote={invite.rfqQuote} lineItems={lineItems} title="Amber's Counter-Quotation" />
        <div className={card}>
          <p className="text-sm text-slate-600">
            Amber&apos;s sourcing team has revised your quotation. Review the figures above and approve, counter, or decline.
          </p>
        </div>

        <div className={card}>
          {!counterOpen ? (
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => { respondToRfqQuote(invite.id, "approved", "supplier", vendorName); toast.success("Quotation approved") }}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 min-h-[44px]">
                <ThumbsUp className="w-4 h-4" /> Approve Quotation
              </button>
              <button
                onClick={() => setCounterOpen(true)}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white border border-[#2563EB]/30 text-[#2563EB] hover:bg-[#2563EB]/5 font-semibold py-2.5 min-h-[44px]">
                <RotateCcw className="w-4 h-4" /> Counter
              </button>
              <button
                onClick={() => { respondToRfqQuote(invite.id, "rejected", "supplier", vendorName); toast("Quotation declined") }}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold py-2.5 min-h-[44px]">
                <ThumbsDown className="w-4 h-4" /> Decline
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-bold text-slate-800">Your Counter-Quotation</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <CounterField label="Price (₹)" required value={cForm.price} onChange={v => setCForm(f => ({ ...f, price: v }))} />
                <CounterField label="Freight (₹)" value={cForm.freight} onChange={v => setCForm(f => ({ ...f, freight: v }))} />
                <CounterField label="Packing (₹)" value={cForm.packing} onChange={v => setCForm(f => ({ ...f, packing: v }))} />
                <CounterField label="Service (₹)" value={cForm.service} onChange={v => setCForm(f => ({ ...f, service: v }))} />
                <CounterField label="Delivery (wks)" value={cForm.deliveryWeeks} onChange={v => setCForm(f => ({ ...f, deliveryWeeks: v }))} />
                <CounterField label="Warranty (yrs)" value={cForm.warranty} onChange={v => setCForm(f => ({ ...f, warranty: v }))} />
                <div>
                  <label htmlFor="counter-currency" className={LABEL}>Currency</label>
                  <select id="counter-currency" value={cForm.currency} onChange={e => setCForm(f => ({ ...f, currency: e.target.value }))} className={`${INPUT} min-h-[44px]`}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-2.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Taxable value</span>
                  <span className="font-semibold tabular-nums">{cTaxable > 0 ? fmt(Math.round(cTaxable)) : "—"}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>GST <span className="text-slate-400">(as per HSN)</span></span>
                  <span className="font-semibold tabular-nums">{cGstValue > 0 ? `+${fmt(Math.round(cGstValue))}` : "—"}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-slate-200">
                  <span className="font-bold text-slate-700">Grand Total <span className="font-normal text-slate-400">(incl. GST)</span></span>
                  <span className="font-black text-[#2563EB] tabular-nums">{cGrandTotal > 0 ? fmt(Math.round(cGrandTotal)) : "—"}</span>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={sendCounter}
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold py-2.5 min-h-[44px]">
                  <Send className="w-4 h-4" /> Send Counter-Quotation
                </button>
                <button onClick={() => setCounterOpen(false)}
                  className="px-4 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-semibold py-2.5 min-h-[44px]">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  } else if (rfqStatus === "approved" && docStatus === "pending") {
    /* ── 4. Price agreed — interactive document sign-off ── */
    body = invite.docApprovalPackage ? (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Price Agreed — Final Step: Approve the Terms</h2>
          <p className="text-sm text-slate-600 mt-2">
            Your quotation{quoteTotal ? ` of ${fmt(quoteTotal)} (grand total)` : ""} is agreed. Please review and accept the
            contract terms below to proceed to the Proforma Invoice.
          </p>
        </div>
        <DocPackageReview
          pkg={invite.docApprovalPackage}
          onApprove={() => { respondToDocApproval(invite.id, "approved"); toast.success("Terms accepted") }}
          onReject={() => { respondToDocApproval(invite.id, "rejected"); toast("Terms declined") }}
        />
      </div>
    ) : (
      <div className={`${card} text-center`}>
        <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Quotation Approved</h2>
        <p className="text-sm text-slate-600 mt-2">
          Your quotation{quoteTotal ? ` of ${fmt(quoteTotal)}` : ""} is approved. Awaiting Amber to request your Proforma Invoice.
        </p>
      </div>
    )
  } else if (rfqStatus === "approved" && docStatus === "rejected") {
    /* ── 4b. Price agreed but the vendor declined the contract terms ── */
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Terms Declined</h2>
          <p className="text-sm text-slate-600 mt-2">
            The price is agreed, but you declined the contract terms ({docPackageTitles(invite.docApprovalPackage).join(" / ") || "Commercial Terms / PBG / Delay Liability Clause"}).
            Amber&apos;s sourcing team can re-send the documents for your review. Please contact them to proceed.
          </p>
        </div>
        {invite.rfqQuote && <RfqQuoteSummary quote={invite.rfqQuote} lineItems={lineItems} title="Agreed Quotation" />}
      </div>
    )
  } else if (rfqStatus === "approved") {
    /* ── 5. All set — awaiting PI request ── */
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">All Set</h2>
          <p className="text-sm text-slate-600 mt-2">
            Your quotation{quoteTotal ? ` of ${fmt(quoteTotal)} (grand total)` : ""} and the contract terms are approved.
            Awaiting Amber to request your Proforma Invoice.
          </p>
        </div>
        <RfqQuoteSummary quote={invite.rfqQuote} lineItems={lineItems} title="Approved Quotation" />
      </div>
    )
  } else if (rfqStatus === "rejected") {
    /* ── 6. Terminal — quotation declined ── */
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">Quotation Declined</h2>
          <p className="text-sm text-slate-600 mt-2">
            This quotation was declined. Please contact your Amber sourcing contact if you would like to revise and resubmit.
          </p>
        </div>
        {invite.rfqQuote && <RfqQuoteSummary quote={invite.rfqQuote} lineItems={lineItems} title="Last Quotation" />}
      </div>
    )
  } else {
    body = (
      <div className={`${card} text-center`}>
        <Hourglass className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Awaiting Quotation</h2>
        <p className="text-sm text-slate-600 mt-2">Please submit your quotation to begin.</p>
      </div>
    )
  }

  return (
    <AuctionShell
      requestNo={request.requestNo}
      subject={request.subject}
      vendorName={vendor?.vendorName}
      vendorCode={vendor?.vendorCode}
      currency={invite.rfqQuote?.currency ?? "INR"}
    >
      <div className={`flex flex-wrap items-center justify-between gap-3 ${rfqStatus === "awaiting_quote" ? "" : "max-w-2xl mx-auto"}`}>
        <TurnBanner actionNeeded={actionNeeded} label={turnLabel} />
        <RfqStatusPill status={rfqStatus} />
      </div>
      {body}
    </AuctionShell>
  )
}

/**
 * Auction winner's contract-terms (doc-package) approval window — mirrors the RFQ doc step.
 * Rendered after the auction ends and sourcing finalizes the winner (`docApprovalStatus` sent),
 * while the request is still pre-`pi_requested`. Once the terms are approved and sourcing requests
 * the PI, the supplier routes into RfqSupplierView for the shared PI → payments chain.
 */
function AuctionWinnerTerms({
  invite,
  request,
  vendor,
}: {
  invite: VendorInvite
  request: CapexRequest
  vendor: Vendor | null
}) {
  const { respondToDocApproval } = useCapex()
  const docStatus = effectiveDocApprovalStatus(invite.docApprovalStatus)
  const card = `${SUPPLIER_CARD} max-w-2xl mx-auto`

  let body: React.ReactNode
  if (docStatus === "approved") {
    body = (
      <div className={`${card} text-center`}>
        <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">All Set</h2>
        <p className="text-sm text-slate-600 mt-2">
          You won the auction and the contract terms are approved. Awaiting Amber to request your
          Proforma Invoice.
        </p>
      </div>
    )
  } else if (docStatus === "rejected") {
    body = (
      <div className={`${card} text-center`}>
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Terms Declined</h2>
        <p className="text-sm text-slate-600 mt-2">
          You won the auction, but you declined the contract terms (Commercial Terms / PBG / Delay
          Liability Clause). Amber&apos;s sourcing team can re-send the documents for your review.
          Please contact them to proceed.
        </p>
      </div>
    )
  } else if (invite.docApprovalPackage) {
    body = (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className={`${card} text-center`}>
          <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-slate-900">You Won the Auction — Final Step: Approve the Terms</h2>
          <p className="text-sm text-slate-600 mt-2">
            Congratulations. Please review and accept the contract terms below to proceed to the
            Proforma Invoice.
          </p>
        </div>
        <DocPackageReview
          pkg={invite.docApprovalPackage}
          onApprove={() => { respondToDocApproval(invite.id, "approved"); toast.success("Terms accepted") }}
          onReject={() => { respondToDocApproval(invite.id, "rejected"); toast("Terms declined") }}
        />
      </div>
    )
  } else {
    // Standard split-award winner: terms were already accepted via the pre-bid Business Rules, so
    // they simply wait for Amber to request the Proforma Invoice.
    body = (
      <div className={`${card} text-center`}>
        <CheckCircle2 className="w-12 h-12 text-slate-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-900">You Won the Auction</h2>
        <p className="text-sm text-slate-600 mt-2">
          Congratulations. Awaiting Amber to request your Proforma Invoice to begin fulfillment.
        </p>
      </div>
    )
  }

  return (
    <AuctionShell
      requestNo={request.requestNo}
      subject={request.subject}
      vendorName={vendor?.vendorName}
      vendorCode={vendor?.vendorCode}
      currency={request.sourcingDecision?.currency ?? "INR"}
      countdown=""
      auctionExpired
    >
      {body}
    </AuctionShell>
  )
}

function CounterField({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const id = `cf-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}{required && <span className="text-red-500"> *</span>}</label>
      <input id={id} type="number" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} className={`${INPUT_RIGHT} min-h-[44px]`} />
    </div>
  )
}

export default function SupplierPortalPage() {
  const { token } = useParams<{ token: string }>()
  const { loaded, invites, requests, vendors, submitQuote, addNegotiationMessage } = useCapex()

  const [ready, setReady] = useState(false)
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({})
  const [price, setPrice] = useState("")
  const [deliveryWeeks, setDeliveryWeeks] = useState("")
  const [freight, setFreight] = useState("")
  const [packing, setPacking] = useState("")
  const [service, setService] = useState("")
  const [warranty, setWarranty] = useState("")
  const [currency, setCurrency] = useState("INR")
  const [validUntil, setValidUntil] = useState("")
  const [note, setNote] = useState("")
  const [fileError, setFileError] = useState("")
  const [fileName, setFileName] = useState("")
  const [fileBase64, setFileBase64] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [countdown, setCountdown] = useState("")
  const [prefilled, setPrefilled] = useState(false)

  useEffect(() => { setReady(true) }, [])

  const inviteEarly = ready && loaded ? resolveInviteByToken(token, invites) : null
  const requestEarly = inviteEarly ? requests.find(r => r.id === inviteEarly.requestId) : null

  useEffect(() => {
    if (!inviteEarly?.quotes.length || prefilled) return
    const q = inviteEarly.quotes[inviteEarly.quotes.length - 1]
    if (q.itemPrices) {
      const next: Record<string, string> = {}
      Object.entries(q.itemPrices).forEach(([id, val]) => { next[id] = String(val) })
      setItemPrices(next)
    } else {
      setPrice(String(q.price))
    }
    setDeliveryWeeks(String(Math.round(q.deliveryDays / 7)))
    setFreight(q.freight != null ? String(q.freight) : "")
    setPacking(q.packing != null ? String(q.packing) : "")
    setService(q.service != null ? String(q.service) : "")
    setWarranty(q.warranty != null ? String(q.warranty) : "")
    setCurrency(q.currency ?? "INR")
    setValidUntil(q.validUntil?.slice(0, 10) ?? "")
    setNote(q.note ?? "")
    setFileName(q.attachmentName ?? "")
    setFileBase64(q.attachmentBase64 ?? "")
    setPrefilled(true)
  }, [inviteEarly, prefilled])

  useEffect(() => {
    const endsAt = requestEarly?.auctionConfig?.endsAt
    if (!endsAt) return
    const update = () => setCountdown(formatAuctionCountdown(endsAt))
    update()
    const id = window.setInterval(update, 60_000)
    return () => window.clearInterval(id)
  }, [requestEarly?.auctionConfig?.endsAt])

  // ── Live sync ──────────────────────────────────────────────────
  // The provider's own `storage` listener re-syncs INVITES across tabs (so RFQ status,
  // counters and doc-package responses already reflect live). REQUEST-level changes
  // (e.g. sourcing requesting a PI → `pi_requested`, accounts → payments) are NOT
  // re-synced by the provider, so an open vendor tab would otherwise miss them. Here we
  // read the persisted snapshot for THIS request/invite and reload only when something
  // the vendor must see actually changed. A 15s poll backstops same-document edits where
  // the native `storage` event does not fire.
  const reqId = requestEarly?.id
  const reqStatus = requestEarly?.status
  const invId = inviteEarly?.id
  const invRfqStatus = inviteEarly?.rfqStatus
  const invDocStatus = inviteEarly?.docApprovalStatus
  const invIncoStatus = inviteEarly?.incoTermsStatus
  const invAwardStatus = inviteEarly?.awardStatus
  useEffect(() => {
    if (!reqId || !invId) return
    const check = () => {
      let raw: string | null
      try { raw = localStorage.getItem("capex_data_v2") } catch { return }
      if (!raw) return
      let parsed: { requests?: CapexRequest[]; invites?: VendorInvite[] }
      try { parsed = JSON.parse(raw) } catch { return }
      const storedReq = parsed.requests?.find(r => r.id === reqId)
      const storedInv = parsed.invites?.find(i => i.id === invId)
      const requestChanged = storedReq && storedReq.status !== reqStatus
      const inviteChanged = storedInv && (
        storedInv.rfqStatus !== invRfqStatus ||
        storedInv.docApprovalStatus !== invDocStatus ||
        storedInv.incoTermsStatus !== invIncoStatus ||
        storedInv.awardStatus !== invAwardStatus
      )
      if (requestChanged || inviteChanged) {
        window.location.reload()
      }
    }
    const onStorage = (e: StorageEvent) => { if (e.key === "capex_data_v2") check() }
    window.addEventListener("storage", onStorage)
    const id = window.setInterval(check, 15_000)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.clearInterval(id)
    }
  }, [reqId, reqStatus, invId, invRfqStatus, invDocStatus, invIncoStatus, invAwardStatus])

  const resetForm = useCallback(() => {
    setItemPrices({})
    setPrice("")
    setDeliveryWeeks("")
    setFreight("")
    setPacking("")
    setService("")
    setWarranty("")
    setNote("")
    setFileName("")
    setFileBase64("")
    setFileError("")
    setPrefilled(false)
  }, [])

  if (!ready || !loaded) {
    return (
      <AuctionShell>
        <div className="flex items-center justify-center py-24">
          <div className="w-7 h-7 rounded-full border-2 border-[#2563EB] border-t-transparent animate-spin" />
        </div>
      </AuctionShell>
    )
  }

  const invite = resolveInviteByToken(token, invites)

  if (!invite) {
    return (
      <AuctionShell>
        <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto text-center border-red-200`}>
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="font-bold text-red-900 text-lg">Link Invalid or Expired</h2>
          <p className="text-red-700 text-sm mt-2">Contact your Amber sourcing contact for a fresh link.</p>
        </div>
      </AuctionShell>
    )
  }

  const request = requests.find(r => r.id === invite.requestId)
  const vendor = vendors.find(v => v.id === invite.vendorId)
  const auctionExpired = request?.auctionConfig ? isAuctionExpired(request.auctionConfig) : false
  const auctionActive = request?.auctionConfig ? !auctionExpired && request.auctionConfig.startedAt : false
  const submissionAllowed = request ? isSubmissionAllowed(invite, requests) && !auctionExpired : false
  const lineItems = request?.lineItems ?? []
  const hasLineItems = lineItems.length > 0
  const threshold = request?.auctionConfig?.threshold

  // Auction approval status check
  const document = request?.auctionApprovalDocument
  const approvalStatus = getEffectiveAuctionApprovalStatus(invite, document?.vendorRevertDeadlineAt)
  const isApproved = isVendorEligibleForAuction(invite, document?.vendorRevertDeadlineAt)
  const hasPendingDocument = document && !request?.auctionConfig && approvalStatus === 'pending'
  const { respondToAuctionApproval } = useCapex()

  const siblingInvites = invites.filter(i => i.requestId === invite.requestId)
  const rankings = computeVendorRankings(siblingInvites)
  const myRanking = rankings.find(r => r.inviteId === invite.id)
  const l1Price = getL1Price(rankings)
  const gapToBest = myRanking && l1Price !== null && myRanking.rank > 1 ? myRanking.price - l1Price : 0

  const itemSubtotal = hasLineItems
    ? computeItemSubtotal(lineItems, itemPrices)
    : Number(price || 0)
  const extrasTotal = computeExtras(freight, packing, service)
  const grandTotal = itemSubtotal + extrasTotal
  const aboveThreshold = threshold != null && itemSubtotal > threshold

  const shellProps = {
    requestNo: request?.requestNo,
    subject: request?.subject,
    countdown: request?.auctionConfig?.endsAt
      ? (auctionExpired ? "Closed" : countdown || formatAuctionCountdown(request.auctionConfig.endsAt))
      : undefined,
    auctionExpired,
    vendorName: vendor?.vendorName,
    vendorCode: vendor?.vendorCode,
    currency,
  }

  // Brown Field RFQ flow — dedicated supplier view (price/doc approval + PI upload).
  // Also handles the shared fulfillment chain (PI upload + payments) for the finalized
  // vendor in either mode, so auction winners reach the same PI → payments screens.
  // NOTE: `pi_requested` is intentionally included alongside the fulfillment statuses —
  // it is NOT in FULFILLMENT_STATUSES, and without it an auction winner sitting at
  // `pi_requested` could never reach the PI-upload screen (the flow dead-ended before accounts).
  // Split-award (reverse auction): each awarded vendor runs its OWN fulfillment track, keyed off the
  // invite's awardStatus (not request.finalVendorId / request.status). Pre-PI awards see the terms
  // screen; once their PI is requested they reach the shared PI → payments view (scoped to their
  // own items / PO / payments inside RfqSupplierView).
  if (request && invite.awarded) {
    const aStatus = invite.awardStatus ?? 'awarded'
    if (aStatus !== 'awarded') {
      return <RfqSupplierView invite={invite} request={request} vendor={vendor ?? null} />
    }
    // Awarded but PI not yet requested: the vendor already approved the pre-bid Business Rules
    // (Commercial Terms + PBG + DLC), so they just wait for Amber to request the PI. (No post-award
    // doc step; the legacy DocPackageReview branch in AuctionWinnerTerms only fires if a stale
    // package exists.)
    return <AuctionWinnerTerms invite={invite} request={request} vendor={vendor ?? null} />
  }

  const isFinalizedVendor = invite.vendorId === request?.finalVendorId
  const winnerInFulfillment =
    isFinalizedVendor && (request?.status === 'pi_requested' || isFulfillmentStatus(request?.status ?? ''))
  if (request && !invite.awarded && (request.sourcingMode === 'rfq' || winnerInFulfillment)) {
    return <RfqSupplierView invite={invite} request={request} vendor={vendor ?? null} />
  }

  // Auction winner — contract-terms (doc-package) approval window, mirroring RFQ. After the
  // auction ends and sourcing finalizes the winner, the winner approves the Commercial Terms /
  // PBG / DLC (+ payment terms for one-time vendors) before Amber requests the Proforma Invoice.
  // Once requested (`pi_requested`), the routing block above takes over. Kept separate from
  // RfqSupplierView, whose pre-PI body keys on rfqStatus (not `approved` for auction winners).
  if (
    request &&
    request.sourcingMode === 'auction' &&
    isFinalizedVendor &&
    request.status !== 'pi_requested' &&
    !isFulfillmentStatus(request.status) &&
    invite.docApprovalStatus &&
    invite.docApprovalStatus !== 'not_sent'
  ) {
    return <AuctionWinnerTerms invite={invite} request={request} vendor={vendor ?? null} />
  }

  // Handle auction approval flow states
  if (document && !request.auctionConfig) {
    // Document sent but vendor needs to respond
    if (approvalStatus === 'pending') {
      const placeholders = document ? buildAuctionDocumentPlaceholders(request, document) : null
      const revertDeadline = document?.vendorRevertDeadlineAt
        ? new Date(document.vendorRevertDeadlineAt).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : 'soon'

      return (
        <AuctionShell {...shellProps}>
          <div className="max-w-2xl mx-auto space-y-5">
            <div className={SUPPLIER_CARD}>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <FileText className="w-6 h-6 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-slate-800 text-lg">Business Rules for Reverse Auction</h2>
                  <p className="text-slate-500 text-sm">Please review and confirm your participation</p>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <Hourglass className="w-5 h-5 text-slate-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-800">Response Required By</p>
                    <p className="text-slate-700 text-sm">{revertDeadline}</p>
                    <p className="text-slate-600 text-xs mt-1">
                      Please respond before the deadline to confirm your participation in the auction.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <h3 className="font-semibold text-slate-800">Auction Summary</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="bg-slate-50 rounded-lg p-3 min-w-0">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Item</p>
                    <p className="font-medium text-slate-800 break-words">{placeholders?.itemName || request.subject}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 min-w-0">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Auction Date</p>
                    <p className="font-medium text-slate-800 break-words">{placeholders?.auctionDate || 'TBD'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 min-w-0">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Opening Time</p>
                    <p className="font-medium text-slate-800 break-words">{placeholders?.openingTime || 'TBD'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 min-w-0">
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Closing Time</p>
                    <p className="font-medium text-slate-800 break-words">{placeholders?.closingTime || 'TBD'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold text-slate-800">Auction Rules</h3>
                <AuctionRulesList
                  rules={{
                    bidValidityDays: placeholders?.bidValidityDays || '180',
                    maxDecrements: placeholders?.maxDecrements || '5',
                    extensionDurationMins: placeholders?.extensionDurationMins || '15',
                    maxExtensionsPerBidder: placeholders?.maxExtensionsPerBidder || '2',
                    currency: placeholders?.currency || 'INR',
                  }}
                />
              </div>

              {/* Commercial Terms + Performance Bank Guarantee + Delay Liability Clause (+ one-time payment terms) */}
              <div className="space-y-3 mt-6">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 mb-1"><FileText className="w-4 h-4" /> Commercial Terms</p>
                  <p className="text-sm text-slate-600 leading-relaxed">{document.paymentTerms ? `${DEFAULT_TERMS_TEXT} Payment terms: ${document.paymentTerms}.` : DEFAULT_TERMS_TEXT}</p>
                </div>
                {document.performanceBankGuaranteeText && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 mb-1"><Shield className="w-4 h-4" /> Performance Bank Guarantee</p>
                    <p className="text-sm text-slate-900/80 leading-relaxed">{document.performanceBankGuaranteeText}</p>
                  </div>
                )}
                {document.delayLiabilityClauseText && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-red-800 mb-1"><AlertCircle className="w-4 h-4" /> Delay Liability Clause</p>
                    <p className="text-sm text-red-900/80 leading-relaxed">{document.delayLiabilityClauseText}</p>
                  </div>
                )}
                {vendor?.oneTime && (vendor.paymentTermsText || vendor.paymentSplits?.length) && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-800 mb-1"><FileText className="w-4 h-4" /> Payment Terms</p>
                    {vendor.paymentTermsText && <p className="text-sm text-slate-900/80 leading-relaxed">{vendor.paymentTermsText}</p>}
                    {vendor.paymentSplits?.length ? (
                      <ul className="mt-2 space-y-1">
                        {vendor.paymentSplits.map(s => (
                          <li key={s.id} className="flex justify-between text-xs text-slate-900/80">
                            <span>{s.label}{s.trigger ? ` (${s.trigger})` : ''}</span>
                            <span className="font-semibold">{s.percent}%</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-6 mt-6">
                <p className="text-sm text-slate-600 mb-4">
                  By confirming your participation, you agree to the Business Rules, the Commercial Terms, the
                  Performance Bank Guarantee, and the Delay Liability Clause{vendor?.oneTime ? ' (and the payment terms above)' : ''}.
                  You will be eligible to bid once the auction begins.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => {
                      respondToAuctionApproval(invite.id, 'approved')
                      toast.success('You have confirmed participation in the auction.')
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-lg bg-slate-600 hover:bg-slate-700 text-white font-semibold transition-colors"
                  >
                    <ThumbsUp className="w-4 h-4" />
                    Approve &amp; Participate
                  </button>
                  <button
                    onClick={() => {
                      respondToAuctionApproval(invite.id, 'rejected')
                      toast.info('You have declined participation in the auction.')
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50 font-semibold transition-colors"
                  >
                    <ThumbsDown className="w-4 h-4" />
                    Decline Participation
                  </button>
                </div>
              </div>
            </div>
          </div>
        </AuctionShell>
      )
    }

    // Vendor has approved but auction hasn't started yet
    if (approvalStatus === 'approved') {
      return (
        <AuctionShell {...shellProps}>
          <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto text-center`}>
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8 text-slate-600" />
            </div>
            <h2 className="font-bold text-slate-800 text-lg mb-2">Participation Confirmed</h2>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              You have confirmed your participation in this reverse auction. The auction has not started yet.
              You will be notified when bidding begins.
            </p>
            <div className="mt-6 bg-slate-50 rounded-lg p-4 max-w-sm mx-auto">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Auction Scheduled</p>
              <p className="font-semibold text-slate-800">
                {document?.auctionDate ? new Date(document.auctionDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : 'TBD'}
              </p>
              <p className="text-sm text-slate-600">
                {document?.auctionOpeningTime} - {document?.auctionClosingTime}
              </p>
            </div>
          </div>
        </AuctionShell>
      )
    }

    // Vendor rejected participation
    if (approvalStatus === 'rejected') {
      return (
        <AuctionShell {...shellProps}>
          <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto text-center`}>
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="font-bold text-slate-800 text-lg mb-2">Participation Declined</h2>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              You have declined participation in this reverse auction. You will not be able to bid when the auction begins.
            </p>
            <p className="text-slate-400 text-xs mt-6">
              If this was a mistake, please contact your Amber sourcing contact.
            </p>
          </div>
        </AuctionShell>
      )
    }

    // Vendor excluded or overdue
    if (approvalStatus === 'excluded' || approvalStatus === 'overdue') {
      return (
        <AuctionShell {...shellProps}>
          <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto text-center`}>
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-gray-600" />
            </div>
            <h2 className="font-bold text-slate-800 text-lg mb-2">
              {approvalStatus === 'overdue' ? 'Response Deadline Passed' : 'Not Eligible'}
            </h2>
            <p className="text-slate-500 text-sm max-w-md mx-auto">
              {approvalStatus === 'overdue'
                ? 'You did not respond to the auction approval document before the deadline. You are no longer eligible to participate in this auction.'
                : 'You have been excluded from participating in this auction. You will not be able to bid.'}
            </p>
            <p className="text-slate-400 text-xs mt-6">
              Please contact your Amber sourcing contact for more information.
            </p>
          </div>
        </AuctionShell>
      )
    }
  }

  if (request && (request.status === "buyer_approved" || request.status === "rejected")) {
    return (
      <AuctionShell {...shellProps}>
        <div className={`${SUPPLIER_CARD} max-w-2xl mx-auto text-center`}>
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <h2 className="font-bold text-slate-800 text-lg break-words">{request.subject}</h2>
          <p className="text-slate-500 text-sm mt-2">This CAPEX request is closed. No further quotes are being accepted.</p>
        </div>
      </AuctionShell>
    )
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setFileError("File exceeds 500 KB. Please attach a smaller file.")
      setFileName(""); setFileBase64(""); return
    }
    setFileError("")
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => setFileBase64(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const formValid = hasLineItems
    ? lineItems.every(item => !!itemPrices[item.id]?.trim()) && !!deliveryWeeks && !!validUntil
    : !!price && !!deliveryWeeks && !!validUntil

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return

    let totalPrice: number
    let resolvedItemPrices: Record<string, number> | undefined

    if (hasLineItems) {
      resolvedItemPrices = {}
      totalPrice = 0
      for (const item of lineItems) {
        const p = Number(itemPrices[item.id] ?? 0)
        resolvedItemPrices[item.id] = p
        totalPrice += p * (parseFloat(item.quantity) || 1)
      }
    } else {
      totalPrice = Number(price)
    }

    const quote: Quote = {
      id: `q-${Date.now()}`,
      price: totalPrice,
      itemPrices: resolvedItemPrices,
      deliveryDays: Math.round(Number(deliveryWeeks) * 7),
      freight: freight ? Number(freight) : undefined,
      packing: packing ? Number(packing) : undefined,
      service: service ? Number(service) : undefined,
      warranty: warranty ? Number(warranty) : undefined,
      currency: currency || "INR",
      validUntil,
      note: note || undefined,
      attachmentName: fileName || undefined,
      attachmentBase64: fileBase64 || undefined,
      submittedAt: new Date().toISOString(),
    }
    submitQuote(invite.id, quote)

    const priceDisplay = hasLineItems ? fmt(totalPrice) + " total" : fmt(totalPrice)
    const msg: NegotiationMessage = {
      id: `nm-${Date.now()}`,
      by: "supplier",
      senderName: vendor?.vendorName ?? "Supplier",
      message: `Quote submitted: ${priceDisplay}, ${deliveryWeeks} week${Number(deliveryWeeks) !== 1 ? "s" : ""} delivery.${note ? " Note: " + note : ""}`,
      at: new Date().toISOString(),
    }
    addNegotiationMessage(invite.id, msg)
    setSubmitted(true)
  }

  /* ── Success screen ── */
  if (submitted) {
    return (
      <AuctionShell {...shellProps}>
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden max-w-2xl mx-auto">
          <div className="bg-[#2563EB] px-6 py-10 text-center">
            <CheckCircle2 className="w-14 h-14 text-white mx-auto mb-3" />
            <h1 className="text-2xl font-bold text-white">Bid Submitted</h1>
            <p className="text-blue-100 text-sm mt-1">Amber Enterprises sourcing team has been notified.</p>
          </div>
          <div className="px-6 py-6 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Grand Total", value: fmt(Math.round(grandTotal)) },
                { label: "Delivery", value: `${deliveryWeeks} week${Number(deliveryWeeks) !== 1 ? "s" : ""}` },
                { label: "Valid Until", value: new Date(validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
                { label: "Currency", value: currency },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100 min-w-0">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm font-bold text-slate-800 break-words">{value}</p>
                </div>
              ))}
            </div>
            {hasLineItems && (
              <div className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Item Breakdown</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {lineItems.map(item => (
                    <div key={item.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex-1 mr-4 min-w-0">
                        <p className="text-sm text-slate-700 leading-snug">{item.description}</p>
                        {item.machineCapacity && (
                          <p className="text-xs text-slate-700 mt-0.5 font-medium">Machine capacity: {item.machineCapacity}</p>
                        )}
                      </div>
                      <p className="text-sm font-bold text-slate-800 shrink-0 tabular-nums">{fmt(Number(itemPrices[item.id] ?? 0))}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {note && (
              <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Notes</p>
                <p className="text-sm text-slate-700">{note}</p>
              </div>
            )}
            {fileName && (
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium">{fileName}</span>
              </div>
            )}
            <p className="text-xs text-slate-400 text-center pt-1">
              You may close this window. The team will reach out if they need more details.
            </p>
          </div>
        </div>
      </AuctionShell>
    )
  }

  const latestCounter = [...invite.negotiationThread].reverse().find(
    m => m.by === "sourcing" && m.type === "counter",
  )

  const showMarketData = siblingInvites.some(i => i.quotes.some(q => q.itemPrices))

  return (
    <AuctionShell {...shellProps}>

      {/* Counter-offer */}
      {latestCounter && (
        <div className="rounded-xl border-2 border-slate-300 bg-slate-50 overflow-hidden">
          <div className="bg-slate-600 px-5 py-2.5 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-white shrink-0" />
            <p className="text-sm font-bold text-white">Counter-offer received — review and resubmit</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: "Target Price", value: latestCounter.counterPrice ? fmt(latestCounter.counterPrice) : "—" },
              { label: "Required Delivery", value: latestCounter.counterDelivery ? Math.round(latestCounter.counterDelivery / 7) + " wks" : "—" },
              { label: "Max Freight", value: latestCounter.counterFreight ? fmt(latestCounter.counterFreight) : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white rounded-lg border border-slate-100 px-3 py-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                <p className="text-sm font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
          {latestCounter.counterRemarks && (
            <p className="px-5 pb-4 text-sm text-slate-800 italic">&ldquo;{latestCounter.counterRemarks}&rdquo;</p>
          )}
        </div>
      )}

      {/* Rank + best price + your bid */}
      <RankSummaryCard
        rank={myRanking?.rank}
        bestPrice={l1Price}
        grandTotal={grandTotal}
        gapToBest={gapToBest}
        aboveThreshold={aboveThreshold}
        threshold={threshold}
        hasExistingQuote={invite.quotes.length > 0}
      />

      {/* Auction rules */}
      {document && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setRulesOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            aria-expanded={rulesOpen}
          >
            <span className="text-sm font-semibold text-slate-700">Auction Rules</span>
            {rulesOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {rulesOpen && (
            <div className="border-t border-slate-100 px-5 py-4">
              <AuctionRulesList
                rules={{
                  bidValidityDays: document.rules.bidValidityDays,
                  maxDecrements: document.rules.maxDecrements,
                  extensionDurationMins: document.rules.extensionDurationMinutes,
                  maxExtensionsPerBidder: document.rules.maxExtensionsPerBidder,
                  currency: document.rules.currency,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Collapsible request details */}
      {request && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setDetailsOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            aria-expanded={detailsOpen}
          >
            <span className="text-sm font-semibold text-slate-700">Request Details</span>
            {detailsOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {detailsOpen && (
            <div className="border-t border-slate-100 px-5 py-4 space-y-4 text-sm text-slate-700">
              <div className="flex flex-wrap gap-2">
                <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{request.category}</span>
                {hasLineItems
                  ? <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{lineItems.length} item{lineItems.length !== 1 ? "s" : ""}</span>
                  : <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>}
              </div>
              {request.justification && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Requirement</p>
                  <p className="leading-relaxed">{request.justification}</p>
                </div>
              )}
              {(request.techSpecs.specifications || request.techSpecs.complianceStandards) && (
                <div className="space-y-2">
                  {request.techSpecs.specifications && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Specifications</p>
                      <p>{request.techSpecs.specifications}</p>
                    </div>
                  )}
                  {request.techSpecs.complianceStandards && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Compliance</p>
                      <p>{request.techSpecs.complianceStandards}</p>
                    </div>
                  )}
                </div>
              )}
              {hasLineItems && (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-100 overflow-hidden">
                  {lineItems.map((item, idx) => (
                    <div key={item.id} className="flex items-start gap-3 px-4 py-2.5 bg-white">
                      <span className="text-xs font-bold text-slate-300 w-5 shrink-0">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800">{item.description}</p>
                        {item.machineCapacity && (
                          <p className="text-xs text-slate-700 mt-0.5">Machine capacity: {item.machineCapacity}</p>
                        )}
                        {item.remarks && <p className="text-xs text-slate-500 mt-0.5">{item.remarks}</p>}
                      </div>
                      <span className="text-sm font-bold text-slate-600 shrink-0">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Previous quotes */}
      {invite.quotes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
            aria-expanded={historyOpen}
          >
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Previous Bids</span>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{invite.quotes.length}</span>
            </div>
            {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {historyOpen && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {invite.quotes.map((q, idx) => (
                <div key={q.id} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-800">Bid {idx + 1} · {fmt(q.price)}</span>
                    <span className="text-xs text-slate-400">{formatTs(q.submittedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{Math.round(q.deliveryDays / 7)} wk delivery</span>
                    <span>Valid {new Date(q.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    {q.currency && q.currency !== "INR" && <span>{q.currency}</span>}
                    {q.attachmentName && (
                      <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" />{q.attachmentName}</span>
                    )}
                  </div>
                  {q.note && <p className="mt-1 text-xs text-slate-400 italic">{q.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bid entry form */}
      {submissionAllowed ? (
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Bid entry table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">Bid Entry</h2>
              {aboveThreshold && (
                <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Above threshold
                </span>
              )}
            </div>

            {hasLineItems ? (
              <div className="px-5 py-4">
                <div className="hidden lg:block">
                  <SupplierQuoteTable
                    variant="bid"
                    lineItems={lineItems}
                    linePrices={itemPrices}
                    onLinePrice={(id, v) => setItemPrices(prev => ({ ...prev, [id]: v }))}
                    showFooter={false}
                    renderLineExtra={item =>
                      showMarketData ? <InlineItemBestPrice itemId={item.id} siblingInvites={siblingInvites} /> : null
                    }
                  />
                </div>
                <div className="lg:hidden">
                  <SupplierQuoteCards
                    variant="bid"
                    lineItems={lineItems}
                    linePrices={itemPrices}
                    onLinePrice={(id, v) => setItemPrices(prev => ({ ...prev, [id]: v }))}
                    showFooter={false}
                    renderLineExtra={item =>
                      showMarketData ? <InlineItemBestPrice itemId={item.id} siblingInvites={siblingInvites} /> : null
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="px-5 py-5">
                <label className={LABEL_REQ}>Item Price (₹)</label>
                <input
                  type="number"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="e.g. 4,500,000"
                  required
                  className={[
                    INPUT,
                    "min-h-[44px]",
                    threshold != null && Number(price) > threshold ? "border-red-400 focus:ring-red-400/40" : "",
                  ].join(" ")}
                />
                {threshold != null && Number(price) > threshold && (
                  <p className="text-xs text-red-600 mt-1 font-medium">Above threshold of {fmt(threshold)}</p>
                )}
              </div>
            )}
          </div>

          {/* Additional charges + grand total */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h3 className="text-sm font-bold text-slate-800 mb-4">Additional Charges</h3>
              <div className="space-y-3">
                {[
                  { label: "Freight & Handling", value: freight, setter: setFreight },
                  { label: "Packing & Forwarding", value: packing, setter: setPacking },
                  { label: "Service / Installation", value: service, setter: setService },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className={LABEL}>{label} <span className="font-normal text-slate-400">(₹)</span></label>
                    <input type="number" value={value} onChange={e => setter(e.target.value)} placeholder="0" className={`${INPUT} min-h-[44px]`} />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col justify-between">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-800">Grand Total Summary</h3>
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Subtotal Base</span>
                  <span className="font-semibold tabular-nums">{itemSubtotal > 0 ? fmt(Math.round(itemSubtotal)) : "—"}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Total Additional</span>
                  <span className="font-semibold tabular-nums text-slate-600">
                    {extrasTotal > 0 ? `+${fmt(Math.round(extrasTotal))}` : "—"}
                  </span>
                </div>
                <div className="border-t border-slate-200 pt-3 flex justify-between items-end">
                  <span className="text-sm font-bold text-slate-700">Grand Total</span>
                  <span className="text-2xl font-black text-[#2563EB] tabular-nums">
                    {grandTotal > 0 ? fmt(Math.round(grandTotal)) : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Delivery, validity, supporting info */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-5">
            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3">Delivery & Quote Validity</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_REQ}>Delivery Lead Time (weeks)</label>
                  <input type="number" value={deliveryWeeks} onChange={e => setDeliveryWeeks(e.target.value)}
                    placeholder="e.g. 12" required min="1" className={`${INPUT} min-h-[44px]`} />
                </div>
                <div>
                  <label className={LABEL}>Warranty <span className="font-normal text-slate-400">(years)</span></label>
                  <input type="number" value={warranty} onChange={e => setWarranty(e.target.value)}
                    placeholder="e.g. 2" min="0" className={`${INPUT} min-h-[44px]`} />
                </div>
                <div>
                  <label className={LABEL}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={`${INPUT} min-h-[44px]`}>
                    {[
                      { code: "INR", label: "INR — Indian Rupee" },
                      { code: "USD", label: "USD — US Dollar" },
                      { code: "EUR", label: "EUR — Euro" },
                      { code: "GBP", label: "GBP — British Pound" },
                      { code: "JPY", label: "JPY — Japanese Yen" },
                      { code: "CNY", label: "CNY — Chinese Yuan" },
                    ].map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL_REQ}>Quote Valid Until</label>
                  <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} required className={`${INPUT} min-h-[44px]`} />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-slate-800 mb-3">Supporting Information</h3>
              <div className="space-y-3">
                <div>
                  <label className={LABEL}>Notes / Special Terms</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Special conditions, payment terms, exclusions…"
                    rows={3} className={`${INPUT} resize-none`} />
                </div>
                <div>
                  <label className={LABEL}>Attachment</label>
                  <div className="border border-dashed border-slate-300 rounded-lg px-4 py-3 bg-slate-50">
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange}
                      className="block w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-white file:text-slate-700 file:shadow-sm cursor-pointer" />
                    <p className="text-[10px] text-slate-400 mt-1">PDF, JPG or PNG · max 500 KB</p>
                  </div>
                  {fileError && (
                    <p className="flex items-center gap-1 mt-1 text-xs text-red-600">
                      <AlertCircle className="w-3 h-3" />{fileError}
                    </p>
                  )}
                  {fileName && !fileError && (
                    <p className="flex items-center gap-1 mt-1 text-xs text-slate-700">
                      <Paperclip className="w-3 h-3" />{fileName}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sticky submit bar */}
          <div className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                {myRanking && (
                  <span className={[
                    "text-xs font-bold px-3 py-1.5 rounded-lg border shrink-0",
                    myRanking.rank === 1
                      ? "bg-slate-50 text-slate-700 border-slate-200"
                      : "bg-blue-50 text-blue-700 border-blue-200",
                  ].join(" ")}>
                    Rank: {rankLabel(myRanking.rank)}
                  </span>
                )}
                {gapToBest > 0 && grandTotal > 0 && (
                  <span className="text-xs text-slate-500 truncate min-w-0">
                    <span className="sm:hidden">{fmt(gapToBest)} above best</span>
                    <span className="hidden sm:inline">{fmt(gapToBest)} above best price — lower your bid to improve rank</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={resetForm}
                  className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
                <button
                  type="submit"
                  disabled={!formValid}
                  className="inline-flex items-center gap-2 min-h-[44px] px-6 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-sm"
                >
                  <Send className="w-4 h-4" />
                  {invite.quotes.length > 0 ? "Submit Revised Bid" : "Submit Bid"}
                </button>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-12 text-center shadow-sm">
          <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700">Submissions Closed</p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
            {auctionExpired
              ? "The reverse auction has ended. Contact your Amber sourcing contact if an extension is needed."
              : "The quote window for this request is no longer open."}
          </p>
        </div>
      )}
    </AuctionShell>
  )
}
