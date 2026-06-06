"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon, ClockIcon, SearchIcon, BellIcon, CheckCircleIcon, XCircleIcon } from "lucide-react"
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

/* ── Request info card (shown to every role) ─────────────────── */

function RequestInfoCard({ request }: { request: CapexRequest }) {
  const plant = PLANTS.find(p => p.value === request.plant)

  const hasText = !!(
    request.justification ||
    request.remarks ||
    request.reasonForRequirement ||
    request.benefitsRoi
  )
  const hasTechSpecs = !!(
    request.techSpecs?.specifications ||
    request.techSpecs?.complianceStandards
  )
  const hasVendorRec = !!request.vendorRecommendation

  const hasLineItems = request.lineItems && request.lineItems.length > 0

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Request Details</h2>

      {/* Top meta — plant, priority, date */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-4 mb-4">
        {[
          { label: "Plant",     value: plant ? `${plant.label}, ${plant.state}` : (request.plant ?? "—") },
          { label: "Priority",  value: request.priority
              ? request.priority.charAt(0).toUpperCase() + request.priority.slice(1)
              : "—" },
          { label: "Submitted", value: formatDate(request.createdAt) },
          ...(!hasLineItems ? [
            { label: "Category", value: request.category },
            { label: "Quantity", value: request.quantity },
            { label: "Budget",   value: request.budget ? formatPrice(request.budget) : "—" },
          ] : [
            { label: "Total Budget", value: request.budget ? formatPrice(request.budget) : "—" },
            { label: "Items",        value: String(request.lineItems!.length) },
          ]),
        ].map(({ label, value }) => (
          <div key={label}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
            <p className="text-sm font-semibold text-slate-800">{value}</p>
          </div>
        ))}
      </div>

      {/* Line items table */}
      {hasLineItems && (
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#F0F4FB] text-slate-600">
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Description</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden sm:table-cell">Category</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden sm:table-cell">Qty</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Budget</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden md:table-cell">Vendor</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden md:table-cell">Doc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {request.lineItems!.map((item, idx) => (
                <tr key={item.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                  <td className="px-3 py-2.5 text-slate-400 font-bold">{idx + 1}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-slate-800">{item.description}</span>
                    {item.masterHead && <span className="ml-1.5 text-slate-400">· {item.masterHead}</span>}
                    {item.remarks && <p className="text-slate-500 mt-0.5 leading-snug">{item.remarks}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 hidden sm:table-cell">{item.category}</td>
                  <td className="px-3 py-2.5 text-slate-600 hidden sm:table-cell">{item.quantity}</td>
                  <td className="px-3 py-2.5 text-right font-medium text-slate-700">
                    {item.budget ? formatPrice(item.budget) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 hidden md:table-cell">
                    {item.vendorRecommendation?.vendorName ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    {item.attachmentName
                      ? <span className="text-teal-700 font-medium truncate max-w-[100px] block" title={item.attachmentName}>{item.attachmentName}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Justification / remarks / reason / ROI */}
      {hasText && (
        <div className="border-t border-slate-100 mt-4 pt-4 space-y-3">
          {request.justification && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Justification</p>
              <p className="text-sm text-slate-600 leading-relaxed">{request.justification}</p>
            </div>
          )}
          {request.remarks && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Complete Description</p>
              <p className="text-sm text-slate-600 leading-relaxed">{request.remarks}</p>
            </div>
          )}
          {request.reasonForRequirement && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Reason for Requirement</p>
              <p className="text-sm text-slate-600 leading-relaxed">{request.reasonForRequirement}</p>
            </div>
          )}
          {request.benefitsRoi && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Benefits / ROI</p>
              <p className="text-sm text-slate-600 leading-relaxed">{request.benefitsRoi}</p>
            </div>
          )}
        </div>
      )}

      {/* Tech specs */}
      {hasTechSpecs && (
        <div className="border-t border-slate-100 mt-4 pt-4">
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
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Compliance</p>
                <p className="text-sm text-slate-700">{request.techSpecs.complianceStandards}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preferred vendor */}
      {hasVendorRec && (
        <div className="border-t border-slate-100 mt-4 pt-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Preferred Vendor</p>
          <p className="text-sm font-semibold text-slate-800">{request.vendorRecommendation!.vendorName}</p>
          {request.vendorRecommendation!.reason && (
            <p className="text-sm text-slate-500 mt-0.5">{request.vendorRecommendation!.reason}</p>
          )}
        </div>
      )}

      {/* Attachment */}
      {request.attachmentName && (
        <div className="border-t border-slate-100 mt-4 pt-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Attached Document</p>
          <div className="inline-flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
            <svg aria-hidden="true" className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            <span className="text-sm font-medium text-slate-700">{request.attachmentName}</span>
            {request.attachmentBase64 ? (
              <button
                type="button"
                onClick={() => {
                  const ext = request.attachmentName!.split(".").pop()?.toLowerCase() ?? ""
                  const mimeMap: Record<string, string> = {
                    pdf: "application/pdf",
                    doc: "application/msword",
                    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    xls: "application/vnd.ms-excel",
                    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    png: "image/png",
                    jpg: "image/jpeg",
                    jpeg: "image/jpeg",
                  }
                  const mime = mimeMap[ext] ?? "application/octet-stream"
                  const bytes = Uint8Array.from(atob(request.attachmentBase64!), c => c.charCodeAt(0))
                  const blob = new Blob([bytes], { type: mime })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = request.attachmentName!
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-[#0D9488] hover:text-[#115E59] bg-[#CCFBF1] hover:bg-[#5EEAD4]/40 border border-[#5EEAD4] px-2 py-1 rounded-md transition-colors"
              >
                <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download
              </button>
            ) : (
              <span className="text-xs text-slate-400 ml-1">Uploaded</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Buyer view ──────────────────────────────────────────────── */

const BUYER_STEPS = [
  { key: "submitted",             label: "Submitted" },
  { key: "pending_head_approval", label: "With Plant Head" },
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
    title: "Awaiting Plant Head Approval",
    body: "Your request is with the Plant Head for review. Sourcing will begin once approved.",
  },
  sourcing: {
    icon: SearchIcon, color: "border-violet-400 bg-violet-50", textColor: "text-violet-800",
    title: "Being Sourced",
    body: "The sourcing team is actively working on vendor quotes for this request.",
  },
  negotiation: {
    icon: SearchIcon, color: "border-[#14B8A6] bg-[#CCFBF1]", textColor: "text-[#115E59]",
    title: "Vendor Negotiation Ongoing",
    body: "The sourcing team is negotiating with shortlisted vendors to secure the best terms.",
  },
  sourcing_approved: {
    icon: BellIcon, color: "border-[#0D9488] bg-[#CCFBF1]", textColor: "text-[#115E59]",
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
                    done   ? "bg-[#0D9488] text-white shadow-sm" : "",
                    active ? "bg-white border-2 border-[#0D9488] text-[#0D9488] shadow-sm" : "",
                    future ? "bg-white border-2 border-slate-200 text-slate-300" : "",
                  ].join(" ")}>
                    {done
                      ? <CheckIcon className="w-4 h-4" />
                      : idx + 1
                    }
                  </div>
                  <span className={[
                    "text-[11px] text-center leading-tight max-w-[72px] hidden sm:block",
                    done   ? "text-[#0D9488] font-medium" : "",
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

      {/* Buyer approval card */}
      {request.status === "sourcing_approved" && (
        <div className="bg-white border border-[#5EEAD4] rounded-xl p-5 shadow-sm space-y-5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#0D9488] animate-pulse" />
            <h2 className="text-sm font-bold text-slate-900">Sourcing Recommendation — Action Required</h2>
          </div>
          {approvedInvite && approvedVendor && approvedQuote ? (
            <>
              {/* Vendor identity */}
              <div className="rounded-lg bg-[#CCFBF1] border border-[#5EEAD4] px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
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
                      <tr className="bg-[#CCFBF1]">
                        <td className="px-4 py-2.5 font-bold text-slate-700">Total</td>
                        <td className="px-4 py-2.5 text-right font-bold text-[#0D9488]">
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
                  className="px-5 py-2.5 rounded-lg bg-[#0D9488] hover:bg-[#115E59] text-white text-sm font-semibold transition-colors shadow-sm"
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
            <p className="text-sm text-[#0D9488]">No vendor has been finalised yet. Please check back shortly.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Status audit trail ──────────────────────────────────────── */

function StatusTimeline({ history }: { history: CapexRequest["statusHistory"] }) {
  if (!history || history.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Status History</p>
      <ol className="relative space-y-4 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-slate-200">
        {[...history].reverse().map((entry, idx) => (
          <li key={idx} className="relative">
            <span className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#0D9488]" />
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[entry.status] ?? "bg-slate-100 text-slate-600"}`}>
                {STATUS_LABELS[entry.status] ?? entry.status.replace(/_/g, " ")}
              </span>
              <span className="text-[12px] font-medium text-slate-700">{entry.actor}</span>
              <span className="text-[11px] text-slate-400">
                {new Date(entry.at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ── Sourcing decision locked banner (all roles) ─────────────── */

function SourcingDecisionBanner({ request, vendors }: { request: CapexRequest; vendors: Vendor[] }) {
  const sd = request.sourcingDecision
  const isLocked = request.status === "sourcing_approved" || request.status === "buyer_approved"
  if (!isLocked) return null

  const items = request.lineItems ?? []
  let finalTotal = 0
  if (items.length > 0 && sd?.finalPrices) {
    finalTotal = items.reduce((sum, item) => {
      const p = Number(sd.finalPrices![`${item.id}-price`] ?? 0)
      const d = Number(sd.finalPrices![`${item.id}-disc`]  ?? 0)
      const q = parseFloat(item.quantity) || 1
      return sum + p * (1 - d / 100) * q
    }, 0)
    finalTotal += Number(sd.freight ?? 0) + Number(sd.packing ?? 0) + Number(sd.service ?? 0)
  }

  const savings    = request.budget && finalTotal > 0 ? request.budget - finalTotal : 0
  const savingsPct = request.budget && savings > 0
    ? ((savings / request.budget) * 100).toFixed(1)
    : null

  const vendorIds    = sd?.finalVendorPerItem ? [...new Set(Object.values(sd.finalVendorPerItem))] : []
  const finalVendors = vendorIds.map(vid => vendors.find(v => v.id === vid)).filter(Boolean)

  return (
    <div className="rounded-xl border border-green-300 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-3 bg-[#166534]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="w-4 h-4 text-green-300" />
          <p className="text-sm font-bold text-white">Sourcing Decision Locked</p>
        </div>
        {sd?.savedAt && (
          <p className="text-xs text-green-300">
            Locked {new Date(sd.savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        )}
      </div>
      <div className="bg-green-50 px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-5">
        {finalTotal > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Final Amount</p>
            <p className="text-xl font-bold text-slate-900">{formatPrice(Math.round(finalTotal))}</p>
          </div>
        )}
        {savings > 0 ? (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Saved vs Budget</p>
            <p className="text-xl font-bold text-green-700">{formatPrice(Math.round(savings))}</p>
            {savingsPct && <p className="text-xs text-green-600 font-semibold mt-0.5">{savingsPct}% under budget</p>}
          </div>
        ) : request.budget && finalTotal > request.budget ? (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Over Budget</p>
            <p className="text-xl font-bold text-red-600">{formatPrice(Math.round(finalTotal - request.budget))}</p>
            <p className="text-xs text-red-500 font-semibold mt-0.5">above budget</p>
          </div>
        ) : null}
        {finalVendors.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">
              {finalVendors.length > 1 ? "Selected Vendors" : "Selected Vendor"}
            </p>
            {finalVendors.map(v => (
              <p key={v!.id} className="text-sm font-semibold text-slate-800 leading-tight">{v!.vendorName}</p>
            ))}
          </div>
        )}
        {(sd?.delivery || sd?.warranty) && (
          <div>
            {sd.delivery && (
              <>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Delivery</p>
                <p className="text-sm font-semibold text-slate-800">{sd.delivery} weeks</p>
              </>
            )}
            {sd.warranty && (
              <p className="text-xs text-slate-500 mt-0.5">{sd.warranty} yr warranty</p>
            )}
          </div>
        )}
        {!finalTotal && !finalVendors.length && (
          <div className="col-span-4">
            <p className="text-sm text-green-800 font-medium">Decision approved — vendor has been engaged.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */

export default function CapexDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { requests, invites, vendors, updateRequest } = useCapex()
  const [currentRole, setCurrentRole] = useState("buyer")

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

  const currentUser  = ROLE_NAMES[currentRole] ?? currentRole
  const isBuyer      = currentRole.startsWith("buyer")

  const handleHeadApprove = () => {
    updateRequest(id, { status: "sourcing" }, ROLE_NAMES[currentRole] ?? currentRole);
    toast.success("Request approved for sourcing")
  }
  const handleHeadReject = () => {
    updateRequest(id, { status: "rejected" }, ROLE_NAMES[currentRole] ?? currentRole);
    toast.error("Request rejected")
  }
  const handleSelectFinal = (_inviteId: string) => {
    updateRequest(id, { status: "sourcing_approved" }, currentUser)
    toast.success("Vendor selected — sent to buyer for approval")
  }
  const handleBuyerApprove = () => {
    updateRequest(id, { status: "buyer_approved" }, ROLE_NAMES[currentRole] ?? currentRole);
    toast.success("Request approved")
  }
  const handleBuyerReject = () => {
    updateRequest(id, { status: "rejected" }, ROLE_NAMES[currentRole] ?? currentRole);
    toast.error("Request rejected")
  }

  return (
    <div className="p-6 space-y-6">

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
          {request.requestNo && (
            <span className="text-xs font-bold bg-[#EBF0FB] text-[#153f90] px-2 py-0.5 rounded-full">{request.requestNo}</span>
          )}
          <span className="text-xs text-slate-400 font-mono">{request.id.slice(0, 8)}…</span>
        </div>
      </div>

      <RequestInfoCard request={request} />

      <SourcingDecisionBanner request={request} vendors={vendors} />

      <div className="space-y-6">

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
          {/* Head / plant_head approval gate */}
          {(currentRole === "sourcing_head" || currentRole.startsWith("plant_head")) && request.status === "pending_head_approval" && (
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

          {/* Vendor grid */}
          <VendorGrid
            request={request}
            invites={reqInvites}
            vendors={vendors}
            currentRole={currentRole}
            onSelectFinal={handleSelectFinal}
          />
        </>
      )}

      {/* Audit trail — visible to all roles */}
      <StatusTimeline history={request.statusHistory} />

      </div>
    </div>
  )
}
