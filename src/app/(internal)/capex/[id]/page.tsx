"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon, ClockIcon, SearchIcon, BellIcon, CheckCircleIcon, XCircleIcon, SendHorizonal } from "lucide-react"
import { VendorGrid } from "@/components/VendorGrid"
import { useCapex } from "@/lib/capexContext"
import type { CapexRequest, CapexStatus, Vendor, Quote, VendorInvite } from "@/lib/types"
import { ROLE_NAMES, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, SOURCING_ENGINEERS, PLANTS } from "@/lib/constants"

function formatPrice(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

/* ── Buyer view ──────────────────────────────────────────────── */

const BUYER_STEPS = [
  { key: "submitted",             label: "Submitted" },
  { key: "pending_head_approval", label: "Under Review" },
  { key: "sourcing",              label: "Being Sourced" },
  { key: "sourcing_approved",     label: "Awaiting Approval" },
  { key: "buyer_approved",        label: "Complete" },
]

const STATUS_TO_STEP: Record<CapexStatus, number> = {
  draft:                  0,
  submitted:              0,
  pending_head_approval:  1,
  sourcing:               2,
  negotiation:            2,
  sourcing_approved:      3,
  buyer_approved:         4,
  rejected:               -1,
}

const STATUS_MESSAGES: Partial<Record<CapexStatus, {
  icon: React.ElementType
  color: string
  textColor: string
  title: string
  body: string
}>> = {
  submitted: {
    icon: ClockIcon, color: "border-blue-400 bg-blue-50", textColor: "text-blue-800",
    title: "Request Received",
    body: "Your request has been received and is in the queue.",
  },
  pending_head_approval: {
    icon: ClockIcon, color: "border-orange-400 bg-orange-50", textColor: "text-orange-800",
    title: "Awaiting Approval",
    body: "Awaiting sourcing head approval before sourcing can begin.",
  },
  sourcing: {
    icon: SearchIcon, color: "border-violet-400 bg-violet-50", textColor: "text-violet-800",
    title: "Being Sourced",
    body: "The sourcing team is actively working on vendor quotes for this request.",
  },
  negotiation: {
    icon: SearchIcon, color: "border-amber-400 bg-amber-50", textColor: "text-amber-800",
    title: "Vendor Negotiation Ongoing",
    body: "The sourcing team is negotiating with shortlisted vendors to secure the best terms.",
  },
  sourcing_approved: {
    icon: BellIcon, color: "border-amber-500 bg-amber-50", textColor: "text-amber-900",
    title: "Action Required",
    body: "Sourcing has selected a vendor. Please review the recommendation below and approve or reject.",
  },
  buyer_approved: {
    icon: CheckCircleIcon, color: "border-green-400 bg-green-50", textColor: "text-green-800",
    title: "Request Complete",
    body: "Your request has been approved and the vendor has been engaged.",
  },
  rejected: {
    icon: XCircleIcon, color: "border-red-400 bg-red-50", textColor: "text-red-800",
    title: "Request Not Approved",
    body: "This request was not approved. Contact the sourcing team if you have questions.",
  },
}

interface BuyerViewProps {
  request: CapexRequest
  approvedVendor: Vendor | null
  approvedQuote: Quote | undefined
  approvedInvite: VendorInvite | null
  onApprove: () => void
  onReject: () => void
}

function BuyerView({ request, approvedVendor, approvedQuote, approvedInvite, onApprove, onReject }: BuyerViewProps) {
  const activeStep = STATUS_TO_STEP[request.status]
  const msg = STATUS_MESSAGES[request.status]
  const plant = PLANTS.find(p => p.value === request.plant)

  return (
    <div className="space-y-5">
      {/* Status stepper */}
      {request.status !== "rejected" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="relative flex items-start justify-between">
            {/* Connector line */}
            <div className="absolute top-4 left-[calc(10%)] right-[calc(10%)] h-px bg-slate-200" />
            {BUYER_STEPS.map((step, idx) => {
              const done   = idx < activeStep
              const active = idx === activeStep
              const future = idx > activeStep
              return (
                <div key={step.key} className="relative flex flex-col items-center gap-2 flex-1">
                  <div className={[
                    "w-8 h-8 rounded-full flex items-center justify-center z-10 transition-all text-xs font-bold",
                    done   ? "bg-amber-500 text-white shadow-sm" : "",
                    active ? "bg-white border-2 border-amber-500 text-amber-600 shadow-sm" : "",
                    future ? "bg-white border-2 border-slate-200 text-slate-300" : "",
                  ].join(" ")}>
                    {done
                      ? <CheckIcon className="w-4 h-4" />
                      : idx + 1
                    }
                  </div>
                  <span className={[
                    "text-[11px] text-center leading-tight max-w-[72px] hidden sm:block",
                    done   ? "text-amber-600 font-medium" : "",
                    active ? "text-slate-900 font-semibold" : "",
                    future ? "text-slate-400" : "",
                  ].join(" ")}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Status messaging */}
      {msg && (
        <div className={`rounded-xl border-l-4 px-5 py-4 flex items-start gap-3 ${msg.color}`}>
          <msg.icon className={`w-5 h-5 mt-0.5 shrink-0 ${msg.textColor} opacity-70`} />
          <div>
            <p className={`text-sm font-semibold ${msg.textColor}`}>{msg.title}</p>
            <p className="text-sm text-slate-600 mt-0.5">{msg.body}</p>
            {request.status === "rejected" && request.rejectionReason && (
              <p className="text-sm text-slate-500 mt-1 italic">Reason: {request.rejectionReason}</p>
            )}
          </div>
        </div>
      )}

      {/* Request summary */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Request Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4">
          {[
            { label: "Category",  value: request.category },
            { label: "Quantity",  value: request.quantity },
            { label: "Budget",    value: request.budget ? formatPrice(request.budget) : "—" },
            { label: "Plant",     value: plant ? `${plant.label}, ${plant.state}` : (request.plant ?? "—") },
            { label: "Submitted", value: formatDate(request.createdAt) },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-slate-800">{value}</p>
            </div>
          ))}
          {request.justification && (
            <div className="col-span-2 md:col-span-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Justification</p>
              <p className="text-sm text-slate-600 leading-relaxed">{request.justification}</p>
            </div>
          )}
        </div>
      </div>

      {/* Buyer approval card */}
      {request.status === "sourcing_approved" && (
        <div className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-sm font-bold text-slate-900">Sourcing Recommendation — Action Required</h2>
          </div>
          {approvedInvite && approvedVendor && approvedQuote ? (
            <>
              {/* Vendor identity */}
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Vendor</p>
                  <p className="text-sm font-bold text-slate-800">{approvedVendor.vendorName}</p>
                  <p className="text-xs text-slate-500">{approvedVendor.vendorCode}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Contact</p>
                  <p className="text-sm font-semibold text-slate-800">{approvedVendor.contactName}</p>
                  <p className="text-xs text-slate-500">{approvedVendor.contactEmail}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Payment Terms</p>
                  <p className="text-sm font-semibold text-slate-800">{approvedVendor.paymentTerms}</p>
                </div>
              </div>

              {/* Quote breakdown */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Quote Breakdown</p>
                <div className="rounded-lg border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {[
                        { label: "Base Price",        value: approvedQuote.price },
                        { label: "Freight",           value: approvedQuote.freight },
                        { label: "Packing",           value: approvedQuote.packing },
                        { label: "Service / Install", value: approvedQuote.service },
                      ].map(({ label, value }) => value !== undefined ? (
                        <tr key={label} className="border-b border-slate-100 last:border-0">
                          <td className="px-4 py-2.5 text-slate-500">{label}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-800">{formatPrice(value)}</td>
                        </tr>
                      ) : null)}
                      <tr className="bg-amber-50">
                        <td className="px-4 py-2.5 font-bold text-slate-700">Total</td>
                        <td className="px-4 py-2.5 text-right font-bold text-amber-700">
                          {formatPrice(approvedQuote.price + (approvedQuote.freight ?? 0) + (approvedQuote.packing ?? 0) + (approvedQuote.service ?? 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Delivery & terms */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: "Delivery",      value: `${Math.round(approvedQuote.deliveryDays / 7)} weeks` },
                  { label: "Warranty",      value: approvedQuote.warranty ? `${approvedQuote.warranty} yr${approvedQuote.warranty > 1 ? "s" : ""}` : "—" },
                  { label: "Quote Valid",   value: approvedQuote.validUntil ? formatDate(approvedQuote.validUntil) : "—" },
                  { label: "Currency",      value: approvedQuote.currency ?? "INR" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                    <p className="text-sm font-semibold text-slate-800">{value}</p>
                  </div>
                ))}
              </div>

              {approvedQuote.note && (
                <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Vendor Note</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{approvedQuote.note}</p>
                </div>
              )}

              <p className="text-xs text-slate-400">
                By approving, you confirm this vendor selection and quoted price. This action cannot be undone.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={onApprove}
                  className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors shadow-sm"
                >
                  Approve & Engage Vendor
                </button>
                <button
                  onClick={onReject}
                  className="px-5 py-2.5 rounded-lg bg-white hover:bg-red-50 text-red-600 text-sm font-semibold border border-red-200 transition-colors"
                >
                  Reject
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-amber-700">No vendor has been finalised yet. Please check back shortly.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */

const SOURCING_ROLES = ["sourcing_member", "sourcing_member_2", "sourcing_member_3", "sourcing_member_4", "sourcing_head", "super_admin"]

export default function CapexDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { requests, invites, vendors, updateRequest, addRequestComment, approveInvite } = useCapex()
  const [currentRole, setCurrentRole] = useState("buyer")
  const [commentText, setCommentText] = useState("")

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [])

  const request = requests.find(r => r.id === id)
  if (!request) {
    return <div className="p-6"><p className="text-slate-400">Request not found.</p></div>
  }

  const reqInvites      = invites.filter(i => i.requestId === id)
  const approvedInvite  = reqInvites.find(i => i.status === "approved") ?? null
  const approvedVendor  = approvedInvite ? (vendors.find(v => v.id === approvedInvite.vendorId) ?? null) : null
  const approvedQuote   = approvedInvite?.quotes[approvedInvite.quotes.length - 1]
  const assignedEngineer = SOURCING_ENGINEERS.find(e => e.value === request.assignedTo)

  // Best-cost invite across all received quotes (used by sourcing approval card)
  const allQuoteEntries = reqInvites.flatMap(inv =>
    inv.quotes.map(q => ({ inv, q, total: q.price + (q.freight ?? 0) + (q.packing ?? 0) + (q.service ?? 0) }))
  )
  const bestEntry = allQuoteEntries.length
    ? allQuoteEntries.reduce((a, b) => b.total < a.total ? b : a)
    : null

  const lowestPrice  = reqInvites.flatMap(i => i.quotes).reduce((min, q) => q.price < min ? q.price : min, Infinity)
  const bestDelivery = reqInvites.flatMap(i => i.quotes).reduce((min, q) => q.deliveryDays < min ? q.deliveryDays : min, Infinity)
  const totalQuotes  = reqInvites.reduce((s, i) => s + i.quotes.length, 0)
  const currentUser  = ROLE_NAMES[currentRole] ?? currentRole
  const isBuyer      = currentRole === "buyer"

  const commentRole = isBuyer ? "buyer"
    : currentRole === "sourcing_head" || currentRole === "super_admin" ? "sourcing_head"
    : "sourcing" as const

  const handleSendComment = (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    addRequestComment(id, {
      id: `rc-${Date.now()}`,
      by: commentRole,
      senderName: currentUser,
      message: commentText.trim(),
      at: new Date().toISOString(),
    })
    setCommentText("")
  }

  const handleHeadApprove = () => { updateRequest(id, { status: "sourcing" }); toast.success("Request approved for sourcing") }
  const handleHeadReject  = () => { updateRequest(id, { status: "rejected" }); toast.error("Request rejected") }
  const handleSourcingApprove = () => {
    if (bestEntry) approveInvite(bestEntry.inv.id)
    updateRequest(id, { status: "sourcing_approved" })
    toast.success("Sent to buyer for approval")
  }
  const handleBuyerApprove = () => { updateRequest(id, { status: "buyer_approved" }); toast.success("Request approved") }
  const handleBuyerReject  = () => { updateRequest(id, { status: "rejected" }); toast.error("Request rejected") }

  return (
    <div className="p-6 h-full flex flex-col space-y-6">

      {/* Shared header */}
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{request.subject}</h1>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[request.status] ?? "bg-slate-100 text-slate-600"}`}>
            {STATUS_LABELS[request.status] ?? request.status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{request.category}</span>
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${PRIORITY_COLORS[request.priority] ?? "bg-slate-100 text-slate-600"}`}>
            {request.priority.charAt(0).toUpperCase() + request.priority.slice(1)}
          </span>
          {request.budget && (
            <span className="text-sm text-slate-500 font-semibold">{formatPrice(request.budget)}</span>
          )}
          {assignedEngineer && (
            <span className="text-xs font-semibold bg-violet-50 text-violet-700 px-2.5 py-1 rounded-full">
              {assignedEngineer.name}
            </span>
          )}
          <span className="text-xs text-slate-400">#{request.id}</span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6">

      {/* Buyer view */}
      {isBuyer && (
        <BuyerView
          request={request}
          approvedVendor={approvedVendor}
          approvedQuote={approvedQuote}
          approvedInvite={approvedInvite}
          onApprove={handleBuyerApprove}
          onReject={handleBuyerReject}
        />
      )}

      {/* Sourcing view */}
      {!isBuyer && (
        <>
          {/* Head approval gate */}
          {currentRole === "sourcing_head" && request.status === "pending_head_approval" && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-orange-900">This request requires your approval before sourcing can begin.</p>
                <p className="text-sm text-orange-700 mt-0.5">
                  Submitted by {request.createdBy}
                  {request.budget ? ` · Estimated budget ${formatPrice(request.budget)}` : ""}
                  {assignedEngineer ? ` · Assigned to ${assignedEngineer.name}` : ""}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={handleHeadApprove} className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold transition-colors">
                  Approve for Sourcing
                </button>
                <button onClick={handleHeadReject} className="px-4 py-2 rounded-lg bg-white hover:bg-red-50 text-red-600 text-sm font-semibold border border-red-200 transition-colors">
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Stats strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Vendors Invited", value: String(reqInvites.length) },
              { label: "Lowest Quote",    value: lowestPrice === Infinity ? "—" : formatPrice(lowestPrice) },
              { label: "Best Delivery",   value: bestDelivery === Infinity ? "—" : `${bestDelivery}d` },
              { label: "Total Quotes",    value: String(totalQuotes) },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                <p className="text-lg font-bold text-slate-800">{value}</p>
              </div>
            ))}
          </div>

          {/* Request details + tech specs */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Business Justification</p>
              <p className="text-sm text-slate-700 leading-relaxed">{request.justification || "—"}</p>
            </div>
            {(request.techSpecs.specifications || request.techSpecs.complianceStandards) && (
              <div className="border-t border-slate-100 pt-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Technical Specifications</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {request.techSpecs.specifications && (
                    <div className="md:col-span-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Specifications & Requirements</p>
                      <p className="text-sm text-slate-700">{request.techSpecs.specifications}</p>
                    </div>
                  )}
                  {request.techSpecs.complianceStandards && (
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Compliance & Certification</p>
                      <p className="text-sm text-slate-700">{request.techSpecs.complianceStandards}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Vendor grid */}
          {!["draft", "submitted", "pending_head_approval"].includes(request.status) && (
            <VendorGrid
              request={request}
              invites={reqInvites}
              vendors={vendors}
              currentRole={currentRole}
            />
          )}

          {/* Sourcing approval card — shown once there are quotes to review */}
          {!["draft", "submitted", "pending_head_approval", "buyer_approved", "rejected"].includes(request.status) && bestEntry && (() => {
            const bestVendor  = vendors.find(v => v.id === bestEntry.inv.vendorId)
            const alreadySent = request.status === "sourcing_approved"
            const canApprove  = SOURCING_ROLES.includes(currentRole) && !alreadySent

            return (
              <div className={`rounded-xl border p-5 space-y-4 ${alreadySent ? "bg-green-50 border-green-200" : "bg-white border-amber-200"}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${alreadySent ? "bg-green-500" : "bg-amber-500 animate-pulse"}`} />
                  <h2 className="text-sm font-bold text-slate-900">
                    {alreadySent ? "Sent to Buyer for Approval" : "Sourcing Recommendation"}
                  </h2>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Recommended Vendor",    value: bestVendor?.vendorName ?? "—" },
                    { label: "Best Price",             value: "₹" + bestEntry.q.price.toLocaleString("en-IN") },
                    { label: "Total (incl. charges)",  value: "₹" + bestEntry.total.toLocaleString("en-IN") },
                    { label: "Delivery",               value: Math.round(bestEntry.q.deliveryDays / 7) + " weeks" },
                  ].map(({ label, value }) => (
                    <div key={label} className={`rounded-lg border px-4 py-3 ${alreadySent ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}`}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm font-bold text-slate-800">{value}</p>
                    </div>
                  ))}
                </div>

                {alreadySent ? (
                  <p className="text-xs text-green-700">Awaiting buyer sign-off. This recommendation is based on the lowest total cost across all received quotes.</p>
                ) : canApprove ? (
                  <div className="flex items-center gap-3">
                    <button onClick={handleSourcingApprove}
                      className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors shadow-sm">
                      Approve & Send to Buyer
                    </button>
                    <p className="text-xs text-slate-400">Lowest-cost vendor highlighted in green above. Buyer will confirm final approval.</p>
                  </div>
                ) : null}
              </div>
            )
          })()}
        </>
      )}

      {/* ── Internal discussion thread (hidden from buyer) ── */}
      {!isBuyer && <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <p className="text-sm font-bold text-slate-800">Discussion</p>
          <p className="text-xs text-slate-400 mt-0.5">Internal only — visible to buyer, sourcing, and sourcing head</p>
        </div>

        {/* Messages */}
        <div className="px-5 py-4 space-y-3 min-h-[80px]">
          {(request.comments ?? []).length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No messages yet.</p>
          ) : (request.comments ?? []).map(c => {
            const isMine = c.senderName === currentUser
            const bubbleBg =
              c.by === "buyer"         ? "bg-blue-50 text-slate-800" :
              c.by === "sourcing_head" ? "bg-violet-50 text-slate-800" :
                                         "bg-amber-50 text-slate-800"
            const tag =
              c.by === "buyer"         ? "Buyer" :
              c.by === "sourcing_head" ? "Sourcing Head" :
                                         "Sourcing"
            return (
              <div key={c.id} className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
                <p className="text-[10px] text-slate-400 px-1">
                  <span className="font-semibold text-slate-500">{c.senderName}</span>
                  {" · "}{tag}{" · "}{new Date(c.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                </p>
                <div className={`max-w-lg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${bubbleBg} ${isMine ? "rounded-tr-sm" : "rounded-tl-sm"}`}>
                  {c.message}
                </div>
              </div>
            )
          })}
        </div>

        {/* Input */}
        <form onSubmit={handleSendComment} className="border-t border-slate-100 px-4 py-3 flex gap-2">
          <input
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Write a message…"
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
          />
          <button type="submit" disabled={!commentText.trim()}
            className="p-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 text-white transition-colors">
            <SendHorizonal className="w-4 h-4" />
          </button>
        </form>
      </div>}

      </div>{/* end flex-1 scroll wrapper */}
    </div>
  )
}
