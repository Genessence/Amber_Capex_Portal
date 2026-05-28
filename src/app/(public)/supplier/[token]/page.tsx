"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { ChevronDown, ChevronUp, Paperclip, AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { useCapex } from "@/lib/capexContext"
import { resolveInviteByToken, isSubmissionAllowed } from "@/lib/tokenUtils"
import type { Quote, NegotiationMessage } from "@/lib/types"

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

const FIELD = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400 transition-colors"
const LABEL = "block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5"

/* ── Shared page shell ────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f8f8f6]">
      <header className="bg-white border-b border-slate-200 px-5 py-3.5 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/amber-logo.png" alt="Amber Enterprises" className="h-7 w-auto object-contain" />
          <div className="h-4 w-px bg-slate-200" />
          <span className="text-sm font-semibold text-slate-500 tracking-tight">Supplier Portal</span>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-7 space-y-5">
        {children}
      </div>
    </div>
  )
}

export default function SupplierPortalPage() {
  const { token } = useParams<{ token: string }>()
  const { loaded, invites, requests, vendors, submitQuote, addNegotiationMessage } = useCapex()

  const [ready,         setReady]         = useState(false)
  const [price,         setPrice]         = useState("")
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
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
      </div>
    </Shell>
  )

  const invite = resolveInviteByToken(token, invites)

  /* ── Invalid / expired link ── */
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

  const request          = requests.find(r => r.id === invite.requestId)
  const vendor           = vendors.find(v => v.id === invite.vendorId)
  const submissionAllowed = request ? isSubmissionAllowed(invite, requests) : false

  /* ── Closed request ── */
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

  const formValid = price && deliveryWeeks && validUntil

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    const quote: Quote = {
      id: `q-${Date.now()}`,
      price: Number(price),
      deliveryDays: Math.round(Number(deliveryWeeks) * 7),
      freight:  freight  ? Number(freight)  : undefined,
      packing:  packing  ? Number(packing)  : undefined,
      service:  service  ? Number(service)  : undefined,
      warranty: warranty ? Number(warranty) : undefined,
      currency: currency || "INR",
      validUntil,
      note: note || undefined,
      attachmentName:  fileName  || undefined,
      attachmentBase64: fileBase64 || undefined,
      submittedAt: new Date().toISOString(),
    }
    submitQuote(invite.id, quote)
    const msg: NegotiationMessage = {
      id: `nm-${Date.now()}`,
      by: "supplier",
      senderName: vendor?.vendorName ?? "Supplier",
      message: `Quote submitted: ${fmt(Number(price))}, ${deliveryWeeks} week${Number(deliveryWeeks) !== 1 ? "s" : ""} delivery.${note ? " Note: " + note : ""}`,
      at: new Date().toISOString(),
    }
    addNegotiationMessage(invite.id, msg)
    setSubmitted(true)
  }

  /* ── Success screen ── */
  if (submitted) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="bg-green-500 px-6 py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-white mx-auto mb-3" />
            <h1 className="text-xl font-bold text-white">Quote Submitted</h1>
            <p className="text-green-100 text-sm mt-1">Amber Enterprises sourcing team has been notified.</p>
          </div>
          <div className="px-6 py-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Unit Price",   value: fmt(Number(price)) },
                { label: "Delivery",     value: `${Math.round(Number(deliveryWeeks) * 7)} days` },
                { label: "Valid Until",  value: new Date(validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) },
                { label: "Currency",     value: currency },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                  <p className="text-sm font-bold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
            {note && (
              <div className="bg-slate-50 rounded-xl px-4 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Notes</p>
                <p className="text-sm text-slate-700">{note}</p>
              </div>
            )}
            {fileName && (
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 rounded-xl px-4 py-3">
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

      {/* ── Counter-offer alert (top, prominent) ── */}
      {latestCounter && (
        <div className="rounded-2xl border-2 border-violet-400 bg-violet-50 overflow-hidden">
          <div className="bg-violet-500 px-5 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-white shrink-0" />
            <p className="text-sm font-bold text-white">Amber has sent a counter-offer — please review and resubmit</p>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Target Price",      value: latestCounter.counterPrice    ? fmt(latestCounter.counterPrice)                              : "—" },
                { label: "Required Delivery", value: latestCounter.counterDelivery ? Math.round(latestCounter.counterDelivery / 7) + " weeks"     : "—" },
                { label: "Max Freight",       value: latestCounter.counterFreight  ? fmt(latestCounter.counterFreight)                            : "—" },
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
            <p className="text-xs text-violet-600">Fill in the quote form below with your revised pricing.</p>
          </div>
        </div>
      )}

      {/* ── Request brief ── */}
      {request && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">RFQ — Amber Enterprises</p>
            <h1 className="text-lg font-bold text-slate-900 leading-snug">{request.subject}</h1>
            <div className="flex gap-2 mt-2 flex-wrap">
              <span className="text-xs font-semibold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full">{request.category}</span>
              <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>
            </div>
          </div>
          {request.justification && (
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Requirement</p>
              <p className="text-sm text-slate-700 leading-relaxed">{request.justification}</p>
            </div>
          )}
          {(request.techSpecs.specifications || request.techSpecs.complianceStandards) && (
            <div className="border-t border-slate-100 px-5 py-4 space-y-3">
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
        </div>
      )}

      {/* ── Previous quotes accordion ── */}
      {invite.quotes.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => setHistoryOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            aria-expanded={historyOpen}
          >
            <span>Your Previous Quotes <span className="ml-1 text-xs font-bold text-slate-400">({invite.quotes.length})</span></span>
            {historyOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {historyOpen && (
            <div className="border-t border-slate-100 divide-y divide-slate-100">
              {invite.quotes.map((q, idx) => (
                <div key={q.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-bold text-slate-800">Quote #{idx + 1} · {fmt(q.price)}</span>
                    <span className="text-xs text-slate-400">{formatTs(q.submittedAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-slate-500">
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

      {/* ── Quote submission form ── */}
      {submissionAllowed ? (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">
              {invite.quotes.length > 0 ? "Submit Revised Quote" : "Submit Your Quote"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Fields marked * are required</p>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-5 space-y-5">

            {/* Pricing section */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Pricing</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Item Price (₹) *</label>
                  <input type="number" value={price} onChange={e => setPrice(e.target.value)}
                    placeholder="e.g. 4500000" required className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={FIELD}>
                    {["INR", "USD", "EUR", "GBP", "JPY", "CNY"].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Freight (₹)</label>
                  <input type="number" value={freight} onChange={e => setFreight(e.target.value)}
                    placeholder="e.g. 25000" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Packing (₹)</label>
                  <input type="number" value={packing} onChange={e => setPacking(e.target.value)}
                    placeholder="e.g. 5000" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Service / Installation (₹)</label>
                  <input type="number" value={service} onChange={e => setService(e.target.value)}
                    placeholder="e.g. 10000" className={FIELD} />
                </div>
              </div>
            </div>

            {/* Delivery section */}
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Delivery & Validity</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={LABEL}>Lead Time (weeks) *</label>
                  <input type="number" value={deliveryWeeks} onChange={e => setDeliveryWeeks(e.target.value)}
                    placeholder="e.g. 12" required className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Warranty (years)</label>
                  <input type="number" value={warranty} onChange={e => setWarranty(e.target.value)}
                    placeholder="e.g. 2" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Valid Until *</label>
                  <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                    required className={FIELD} />
                </div>
              </div>
            </div>

            {/* Notes & attachment */}
            <div className="space-y-3">
              <div>
                <label className={LABEL}>Notes / Terms</label>
                <textarea value={note} onChange={e => setNote(e.target.value)}
                  placeholder="Special conditions, payment terms, exclusions…"
                  rows={3} className={`${FIELD} resize-none`} />
              </div>
              <div>
                <label className={LABEL}>Attachment (PDF / JPG / PNG · max 500 KB)</label>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange}
                  className="block w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-amber-50 cursor-pointer" />
                {fileError  && <p className="text-xs text-red-600 mt-1">{fileError}</p>}
                {fileName && !fileError && (
                  <p className="text-xs text-green-700 mt-1 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> {fileName}
                  </p>
                )}
              </div>
            </div>

            <button type="submit" disabled={!formValid}
              className="w-full py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm transition-colors">
              {invite.quotes.length > 0 ? "Submit Revised Quote" : "Submit Quote"}
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 px-5 py-8 text-center">
          <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-600">Submissions Closed</p>
          <p className="text-xs text-slate-400 mt-1">Quote submission is not currently open for this request.</p>
        </div>
      )}

    </Shell>
  )
}
