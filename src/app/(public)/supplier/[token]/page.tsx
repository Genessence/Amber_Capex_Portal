"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import { ChevronDown, ChevronUp, Paperclip, AlertCircle, CheckCircle2, Clock, Trophy, Package, Truck, ShieldCheck, CalendarDays } from "lucide-react"
import { useCapex } from "@/lib/capexContext"
import { resolveInviteByToken, isSubmissionAllowed } from "@/lib/tokenUtils"
import type { CapexLineItem, Quote, NegotiationMessage } from "@/lib/types"

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

const FIELD = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/60 focus:border-[#0D9488] transition-colors"
const LABEL = "block text-xs font-semibold text-slate-600 mb-1.5"
const LABEL_REQ = "block text-xs font-semibold text-slate-600 mb-1.5 after:content-['*'] after:ml-0.5 after:text-red-500"

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-bold text-slate-800 leading-none">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F3F4F8]">
      <header className="bg-white border-b border-slate-200 px-5 py-3.5 sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/amber-logo.png" alt="Amber Enterprises" className="h-7 w-auto object-contain" />
          <div className="h-4 w-px bg-slate-200" />
          <span className="text-sm font-semibold text-slate-500 tracking-tight">Supplier Portal</span>
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {children}
      </div>
    </div>
  )
}

/* ── Anonymous leaderboard for a single line item ───────────── */
const MEDALS = ["🥇", "🥈", "🥉"]
const ANON_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"]

function ItemLeaderboard({
  itemId,
  siblingInvites,
}: {
  itemId: string
  siblingInvites: Array<{ id: string; quotes: Quote[] }>
}) {
  const rows = useMemo(() => {
    const entries: Array<{ price: number }> = []
    for (const inv of siblingInvites) {
      const latest = inv.quotes[inv.quotes.length - 1]
      if (!latest?.itemPrices?.[itemId]) continue
      entries.push({ price: latest.itemPrices[itemId] })
    }
    return entries.sort((a, b) => a.price - b.price)
  }, [itemId, siblingInvites])

  if (rows.length === 0) return null

  const top3 = rows.slice(0, 3)

  return (
    <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-3 py-2 flex items-center gap-1.5 border-b border-slate-100">
        <Trophy className="w-3 h-3 text-amber-400" />
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Market Prices · Anonymous</span>
      </div>
      <div className="divide-y divide-slate-100">
        {top3.map((row, idx) => (
          <div key={idx} className="flex items-center justify-between px-3 py-2 bg-white">
            <div className="flex items-center gap-2">
              <span className="text-sm w-5 text-center leading-none">{MEDALS[idx]}</span>
              <span className="text-xs font-medium text-slate-600">Supplier {ANON_LABELS[idx]}</span>
              {idx === 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 leading-none">Lowest</span>
              )}
            </div>
            <span className={["text-xs font-bold tabular-nums", idx === 0 ? "text-green-700" : "text-slate-500"].join(" ")}>
              {fmt(row.price)}
            </span>
          </div>
        ))}
      </div>
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
  const [freight,       setFreight]       = useState("")
  const [packing,       setPacking]       = useState("")
  const [service,       setService]       = useState("")
  const [warranty,      setWarranty]      = useState("")
  const [currency,      setCurrency]      = useState("INR")
  const [validUntil,    setValidUntil]    = useState("")
  const [note,          setNote]          = useState("")
  const [fileError,     setFileError]     = useState("")
  const [fileName,      setFileName]      = useState("")
  const [fileBase64,    setFileBase64]    = useState("")
  const [submitted,     setSubmitted]     = useState(false)
  const [historyOpen,   setHistoryOpen]   = useState(false)

  useEffect(() => { setReady(true) }, [])

  if (!ready || !loaded) return (
    <Shell>
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 rounded-full border-2 border-[#0D9488] border-t-transparent animate-spin" />
      </div>
    </Shell>
  )

  const invite = resolveInviteByToken(token, invites)

  if (!invite) {
    return (
      <Shell>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <h2 className="font-bold text-red-900 text-base">Link Invalid or Expired</h2>
          <p className="text-red-700 text-sm mt-1.5">This link is no longer active. Contact your Amber sourcing contact for a fresh link.</p>
        </div>
      </Shell>
    )
  }

  const request           = requests.find(r => r.id === invite.requestId)
  const vendor            = vendors.find(v => v.id === invite.vendorId)
  const submissionAllowed = request ? isSubmissionAllowed(invite, requests) : false
  const lineItems         = request?.lineItems ?? []
  const hasLineItems      = lineItems.length > 0

  const siblingInvites = invites.filter(i => i.requestId === invite.requestId)

  if (request && (request.status === "buyer_approved" || request.status === "rejected")) {
    return (
      <Shell>
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-sm">
          <Clock className="w-9 h-9 text-slate-300 mx-auto mb-3" />
          <h2 className="font-bold text-slate-800 text-base">{request.subject}</h2>
          <p className="text-slate-500 text-sm mt-2">This CAPEX request is closed. No further quotes are being accepted.</p>
        </div>
      </Shell>
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
      freight:  freight  ? Number(freight)  : undefined,
      packing:  packing  ? Number(packing)  : undefined,
      service:  service  ? Number(service)  : undefined,
      warranty: warranty ? Number(warranty) : undefined,
      currency: currency || "INR",
      validUntil,
      note: note || undefined,
      attachmentName:   fileName   || undefined,
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
    const totalDisplay = hasLineItems
      ? lineItems.reduce((s, item) => s + (Number(itemPrices[item.id] ?? 0) * (parseFloat(item.quantity) || 1)), 0)
      : Number(price)

    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-[#0D9488] px-6 py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-white mx-auto mb-3" />
            <h1 className="text-xl font-bold text-white">Quote Submitted</h1>
            <p className="text-teal-100 text-sm mt-1">Amber Enterprises sourcing team has been notified.</p>
          </div>
          <div className="px-6 py-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Total Value",  value: fmt(totalDisplay) },
                { label: "Delivery",     value: `${deliveryWeeks} week${Number(deliveryWeeks) !== 1 ? "s" : ""}` },
                { label: "Valid Until",  value: new Date(validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
                { label: "Currency",     value: currency },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm font-bold text-slate-800">{value}</p>
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
                      <p className="text-sm text-slate-700 leading-snug flex-1 mr-4">{item.description}</p>
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
      </Shell>
    )
  }

  /* ── Active portal ── */
  const latestCounter = [...invite.negotiationThread].reverse().find(
    m => m.by === "sourcing" && m.type === "counter"
  )

  return (
    <Shell>

      {/* ── Counter-offer alert ── */}
      {latestCounter && (
        <div className="rounded-xl border-2 border-violet-400 bg-violet-50 overflow-hidden">
          <div className="bg-violet-600 px-5 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-white shrink-0" />
            <p className="text-sm font-bold text-white">Amber has sent a counter-offer — please review and resubmit</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Target Price",      value: latestCounter.counterPrice    ? fmt(latestCounter.counterPrice)                          : "—" },
                { label: "Required Delivery", value: latestCounter.counterDelivery ? Math.round(latestCounter.counterDelivery / 7) + " wks"   : "—" },
                { label: "Max Freight",       value: latestCounter.counterFreight  ? fmt(latestCounter.counterFreight)                        : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-white rounded-lg border border-violet-100 px-3 py-2.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm font-bold text-violet-900">{value}</p>
                </div>
              ))}
            </div>
            {latestCounter.counterRemarks && (
              <p className="text-sm text-violet-800 bg-violet-100 rounded-lg px-3 py-2.5 italic">&ldquo;{latestCounter.counterRemarks}&rdquo;</p>
            )}
          </div>
        </div>
      )}

      {/* ── RFQ info card ── */}
      {request && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          {/* Header strip */}
          <div className="bg-[#1A3A6E] px-5 py-4">
            <p className="text-[10px] font-bold text-blue-200 uppercase tracking-wider mb-1">Request for Quotation · Amber Enterprises</p>
            <h1 className="text-base font-bold text-white leading-snug">{request.subject}</h1>
            <div className="flex gap-2 mt-2.5 flex-wrap">
              <span className="text-[11px] font-semibold bg-white/15 text-white px-2.5 py-1 rounded-full">{request.category}</span>
              {hasLineItems
                ? <span className="text-[11px] font-semibold bg-white/15 text-white px-2.5 py-1 rounded-full">{lineItems.length} item{lineItems.length !== 1 ? "s" : ""}</span>
                : <span className="text-[11px] font-semibold bg-white/15 text-white px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>
              }
              <span className="text-[11px] font-bold bg-amber-400/90 text-amber-900 px-2.5 py-1 rounded-full flex items-center gap-1">
                <Clock className="w-3 h-3" /> 2-day quote window
              </span>
            </div>
          </div>

          {/* Requirement */}
          {request.justification && (
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Requirement</p>
              <p className="text-sm text-slate-700 leading-relaxed">{request.justification}</p>
            </div>
          )}

          {/* Tech specs */}
          {(request.techSpecs.specifications || request.techSpecs.complianceStandards) && (
            <div className="px-5 py-4 border-b border-slate-100 space-y-3">
              {request.techSpecs.specifications && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Specifications</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{request.techSpecs.specifications}</p>
                </div>
              )}
              {request.techSpecs.complianceStandards && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Compliance</p>
                  <p className="text-sm text-slate-700">{request.techSpecs.complianceStandards}</p>
                </div>
              )}
            </div>
          )}

          {/* Items table */}
          {hasLineItems && (
            <div>
              <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Items to Quote</p>
              </div>
              <div className="divide-y divide-slate-100">
                {lineItems.map((item, idx) => (
                  <div key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="text-[11px] font-bold text-slate-300 w-5 shrink-0 pt-0.5">{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 leading-snug">{item.description}</p>
                      {item.remarks && <p className="text-xs text-slate-500 mt-0.5">{item.remarks}</p>}
                    </div>
                    <span className="text-sm font-bold text-slate-700 shrink-0 tabular-nums">×{item.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Previous quotes ── */}
      {invite.quotes.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 transition-colors"
            aria-expanded={historyOpen}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Previous Quotes</span>
              <span className="text-xs font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{invite.quotes.length}</span>
            </div>
            {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {historyOpen && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {invite.quotes.map((q, idx) => (
                <div key={q.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-800">Q{idx + 1} · {fmt(q.price)}</span>
                    <span className="text-xs text-slate-400">{formatTs(q.submittedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                    <span>{Math.round(q.deliveryDays / 7)} wk delivery</span>
                    <span>Valid {new Date(q.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                    {q.currency && q.currency !== "INR" && <span>{q.currency}</span>}
                    {q.attachmentName && (
                      <span className="flex items-center gap-1"><Paperclip className="w-3 h-3" />{q.attachmentName}</span>
                    )}
                  </div>
                  {q.note && <p className="mt-1.5 text-xs text-slate-400 italic">{q.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Quote form ── */}
      {submissionAllowed ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">

          {/* Form header */}
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
            <h2 className="text-base font-bold text-slate-900">
              {invite.quotes.length > 0 ? "Submit Revised Quote" : "Submit Your Quote"}
            </h2>
            <div className="flex items-start gap-2 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
              <span>This RFQ is valid for <strong>2 days</strong> from the date of invitation. Fields marked <span className="text-red-500 font-bold">*</span> are required.</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="divide-y divide-slate-100">

            {/* ── Section 1: Item Pricing ── */}
            <div className="px-5 py-5">
              <SectionHeader icon={Package} title="Item Pricing" subtitle="Enter your unit price for each item" />

              {hasLineItems ? (
                <>
                  {/* Per-item market leaderboards — shown first so supplier sees market before pricing */}
                  {siblingInvites.some(i => i.quotes.some(q => q.itemPrices)) && (
                    <div className="mb-4 space-y-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Market Position per Item</p>
                      {lineItems.map((item, idx) => {
                        const siblingHasData = siblingInvites.some(i => i.quotes.some(q => q.itemPrices?.[item.id]))
                        if (!siblingHasData) return null
                        return (
                          <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
                            <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                              <span className="text-[10px] font-bold text-slate-400">{idx + 1}.</span>
                              <p className="text-xs font-semibold text-slate-700">{item.description}</p>
                            </div>
                            <div className="px-4 pb-3">
                              <ItemLeaderboard itemId={item.id} siblingInvites={siblingInvites} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-[#F0F4FB] border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="px-4 py-2.5 text-left w-8">#</th>
                          <th className="px-4 py-2.5 text-left">Item</th>
                          <th className="px-4 py-2.5 text-center w-16">Qty</th>
                          <th className="px-4 py-2.5 text-right w-40">Unit Price (₹) <span className="text-red-500">*</span></th>
                          <th className="px-4 py-2.5 text-right w-32">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {lineItems.map((item: CapexLineItem, idx) => {
                          const unitPrice = Number(itemPrices[item.id] ?? 0)
                          const qty       = parseFloat(item.quantity) || 1
                          const lineTotal = unitPrice * qty
                          return (
                            <tr key={item.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                              <td className="px-4 py-3 text-xs text-slate-400 font-bold">{idx + 1}</td>
                              <td className="px-4 py-3">
                                <p className="font-semibold text-slate-800 text-sm leading-snug">{item.description}</p>
                                {item.remarks && <p className="text-xs text-slate-500 mt-0.5">{item.remarks}</p>}
                              </td>
                              <td className="px-4 py-3 text-center text-slate-600 font-semibold text-sm">{item.quantity}</td>
                              <td className="px-4 py-3 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  required
                                  placeholder="0"
                                  value={itemPrices[item.id] ?? ""}
                                  onChange={e => setItemPrices(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  className="w-full text-right rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/60 focus:border-[#0D9488] transition-colors"
                                />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <p className={["text-sm font-bold tabular-nums", lineTotal > 0 ? "text-slate-800" : "text-slate-300"].join(" ")}>
                                  {lineTotal > 0 ? fmt(Math.round(lineTotal)) : "—"}
                                </p>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-[#F0F4FB]">
                          <td colSpan={4} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Grand Total</td>
                          <td className="px-4 py-3 text-right">
                            {(() => {
                              const grand = lineItems.reduce((s, item) => s + (Number(itemPrices[item.id] ?? 0) * (parseFloat(item.quantity) || 1)), 0)
                              return <p className={["text-sm font-bold tabular-nums", grand > 0 ? "text-[#0D9488]" : "text-slate-300"].join(" ")}>{grand > 0 ? fmt(Math.round(grand)) : "—"}</p>
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              ) : (
                <div>
                  <label className={LABEL_REQ}>Item Price (₹)</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                    placeholder="e.g. 4,500,000" required className={FIELD} />
                </div>
              )}
            </div>

            {/* ── Section 2: Logistics Costs ── */}
            <div className="px-5 py-5">
              <SectionHeader icon={Truck} title="Logistics & Additional Costs" subtitle="Optional — leave blank if not applicable" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL}>
                    Freight / Transport
                    <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case">(₹)</span>
                  </label>
                  <input type="number" value={freight} onChange={e => setFreight(e.target.value)}
                    placeholder="0" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>
                    Packing / Forwarding
                    <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case">(₹)</span>
                  </label>
                  <input type="number" value={packing} onChange={e => setPacking(e.target.value)}
                    placeholder="0" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>
                    Service / Installation
                    <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case">(₹)</span>
                  </label>
                  <input type="number" value={service} onChange={e => setService(e.target.value)}
                    placeholder="0" className={FIELD} />
                </div>
              </div>
            </div>

            {/* ── Section 3: Delivery & Validity ── */}
            <div className="px-5 py-5">
              <SectionHeader icon={CalendarDays} title="Delivery & Quote Validity" subtitle="Required fields — these determine your offer's terms" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_REQ}>Delivery Lead Time (weeks)</label>
                  <input type="number" value={deliveryWeeks} onChange={e => setDeliveryWeeks(e.target.value)}
                    placeholder="e.g. 12" required min="1" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>
                    Warranty
                    <span className="ml-1 text-[10px] font-normal text-slate-400 normal-case">(years, optional)</span>
                  </label>
                  <input type="number" value={warranty} onChange={e => setWarranty(e.target.value)}
                    placeholder="e.g. 2" min="0" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={FIELD}>
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
                  <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                    required className={FIELD} />
                </div>
              </div>
            </div>

            {/* ── Section 4: Supporting Info ── */}
            <div className="px-5 py-5">
              <SectionHeader icon={ShieldCheck} title="Supporting Information" subtitle="Optional — attach a quote document or add special terms" />
              <div className="space-y-3">
                <div>
                  <label className={LABEL}>Notes / Special Terms</label>
                  <textarea value={note} onChange={e => setNote(e.target.value)}
                    placeholder="Special conditions, payment terms, exclusions, GST applicability…"
                    rows={3} className={`${FIELD} resize-none`} />
                </div>
                <div>
                  <label className={LABEL}>Attachment</label>
                  <div className="border border-dashed border-slate-300 rounded-lg px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange}
                      className="block w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-white file:text-slate-700 file:shadow-sm hover:file:bg-[#CCFBF1] cursor-pointer" />
                    <p className="text-[10px] text-slate-400 mt-1.5">PDF, JPG or PNG · max 500 KB</p>
                  </div>
                  {fileError && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-red-600">
                      <AlertCircle className="w-3 h-3 shrink-0" />{fileError}
                    </div>
                  )}
                  {fileName && !fileError && (
                    <div className="flex items-center gap-1.5 mt-1.5 text-xs text-green-700">
                      <Paperclip className="w-3 h-3 shrink-0" />{fileName}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Submit ── */}
            <div className="px-5 py-4 bg-slate-50/60">
              {hasLineItems && (() => {
                const grand = lineItems.reduce((s, item) => s + (Number(itemPrices[item.id] ?? 0) * (parseFloat(item.quantity) || 1)), 0)
                const extras = (freight ? Number(freight) : 0) + (packing ? Number(packing) : 0) + (service ? Number(service) : 0)
                const total = grand + extras
                return total > 0 ? (
                  <div className="flex items-center justify-between mb-3 px-4 py-2.5 bg-white border border-slate-200 rounded-lg">
                    <span className="text-xs font-semibold text-slate-500">Quote Total (items + logistics)</span>
                    <span className="text-sm font-bold text-[#0D9488] tabular-nums">{fmt(Math.round(total))}</span>
                  </div>
                ) : null
              })()}
              <button type="submit" disabled={!formValid}
                className="w-full py-3.5 rounded-xl bg-[#0D9488] hover:bg-[#115E59] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors shadow-sm">
                {invite.quotes.length > 0 ? "Submit Revised Quote" : "Submit Quote"}
              </button>
              {!formValid && (
                <p className="text-[11px] text-slate-400 text-center mt-2">
                  Fill in all required fields to submit.
                </p>
              )}
            </div>

          </form>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-10 text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <Clock className="w-5 h-5 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">Submissions Closed</p>
          <p className="text-xs text-slate-400 mt-1.5 max-w-xs mx-auto">
            The quote window for this request is no longer open. Contact your Amber sourcing contact if you have questions.
          </p>
        </div>
      )}

    </Shell>
  )
}
