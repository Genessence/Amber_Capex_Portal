"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { CheckIcon, ClockIcon, SearchIcon, BellIcon, CheckCircleIcon, XCircleIcon, Gavel, Timer, Copy, Users, Plus, X, FileText, Printer, Bell, UserX, AlertCircle, ArrowLeftRight } from "lucide-react"
import { VendorGrid } from "@/components/VendorGrid"
import { FinalDecisionActions } from "@/components/FinalDecisionActions"
import { TechSpecPanel } from "@/components/TechSpecPanel"
import { RfqPanel } from "@/components/RfqPanel"
import { AccountsPanel } from "@/components/AccountsPanel"
import { TatBanner } from "@/components/TatBanner"
import { ClampText } from "@/components/ClampText"
import { TrialCard } from "@/components/TrialCard"
import { EmailPreviewModal } from "@/components/EmailPreviewModal"
import { isFulfillmentStatus, resolveFinalVendor, isAwardBased, awardedInvites, awardSummary } from "@/lib/paymentUtils"
import { lowestRfqTotal } from "@/lib/rfqUtils"
import { effectiveDocApprovalStatus } from "@/lib/docPackageUtils"
import { useCapex } from "@/lib/capexContext"
import type { AuctionConfig, CapexMasterItem, CapexRequest, CapexStatus, Vendor, Quote, VendorInvite } from "@/lib/types"
import { ROLE_NAMES, SOURCING_ENGINEERS, PLANTS } from "@/lib/constants"
import { StatusBadge } from "@/components/StatusBadge"
import { CARD } from "@/lib/uiTokens"

const FIELD_TYPE_LABELS: Record<string, string> = {
  green_field: "Green Field",
  brown_field: "Brown Field",
  digitisation: "Digitisation",
  information_technology: "Information Technology",
}
import {
  buildAuctionEndsAt,
  computeVendorRankings,
  extendAuctionEndsAt,
  formatAuctionCountdown,
  getL1Price,
  isAuctionActive,
  isAuctionExpired,
  rankLabel,
} from "@/lib/auctionUtils"
import {
  AUCTION_APPROVAL_STATUS_COLORS,
  AUCTION_APPROVAL_STATUS_LABELS,
  buildAuctionDocumentPlaceholders,
  canStartAuction,
  createAuctionApprovalDocument,
  DEFAULT_AUCTION_RULES,
  formatDateDDMMYYYY,
  getEffectiveAuctionApprovalStatus,
  isVendorEligibleForAuction,
} from "@/lib/auctionDocumentUtils"
import { buildSupplierLink, buildApprovalLink } from "@/lib/tokenUtils"
import { PLANT_HEAD_EMAIL } from "@/lib/constants"
import { effectiveTrialStatus } from "@/lib/trialUtils"

function formatPrice(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

const CR_TO_INR = 10_000_000

function getAllocatedINR(masterItemId: string | undefined, capexMaster: CapexMasterItem[]): number | null {
  if (!masterItemId) return null
  const item = capexMaster.find(m => m.id === masterItemId)
  return item ? item.totalCost * CR_TO_INR : null
}

function BudgetStatusChip({ budget, allocatedINR }: { budget?: number; allocatedINR: number | null }) {
  if (allocatedINR === null || budget === undefined) {
    return <span className="text-slate-300">—</span>
  }
  const diff = budget - allocatedINR
  if (diff > 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-red-700 bg-red-100 border border-red-200 whitespace-nowrap">
        {formatPrice(diff)} over
      </span>
    )
  }
  if (diff < 0) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 whitespace-nowrap">
        {formatPrice(Math.abs(diff))} under
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 whitespace-nowrap">
      On budget
    </span>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
}

/* ── Request info card (shown to every role) ─────────────────── */

function RequestInfoCard({ request }: { request: CapexRequest }) {
  const { capexMaster } = useCapex()
  const plant = PLANTS.find(p => p.value === request.plant)

  const hasText = !!(
    request.justification ||
    request.remarks ||
    request.reasonForRequirement ||
    request.benefitsRoi
  )
  const hasVendorRec = !!request.vendorRecommendation

  const hasLineItems = request.lineItems && request.lineItems.length > 0

  const legacyAllocatedINR = getAllocatedINR(request.masterItemId, capexMaster)
  const legacyOverAllocated =
    request.budget !== undefined &&
    legacyAllocatedINR !== null &&
    request.budget > legacyAllocatedINR

  const lineBudgetSummary = useMemo(() => {
    if (!hasLineItems) return null
    const items = request.lineItems!
    const totalBudget = items.reduce((sum, item) => sum + (item.budget ?? 0), 0)
    const totalAllocated = items.reduce((sum, item) => {
      const allocated = getAllocatedINR(item.masterItemId, capexMaster)
      return sum + (allocated ?? 0)
    }, 0)
    const hasAnyAllocation = items.some(item => getAllocatedINR(item.masterItemId, capexMaster) !== null)
    return {
      totalBudget: totalBudget || undefined,
      totalAllocated: hasAnyAllocation ? totalAllocated : null,
    }
  }, [hasLineItems, request.lineItems, capexMaster])

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h2 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Request Details</h2>

      {/* Top meta — dense inline label: value strip (no stacked cells, no orphaned fields) */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3">
        {[
          { label: "Field Type", value: FIELD_TYPE_LABELS[request.fieldType ?? "brown_field"] ?? "—" },
          { label: "Plant",     value: plant ? `${plant.label}, ${plant.state}` : (request.plant ?? "—") },
          { label: "Submitted", value: formatDate(request.createdAt) },
          ...(!hasLineItems ? [
            { label: "Category", value: request.category },
            { label: "Quantity", value: request.quantity },
          ] : [
            { label: "Items",        value: String(request.lineItems!.length) },
          ]),
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="font-bold text-slate-400 uppercase tracking-wider">{label}</span>
            <span className="text-[13px] font-semibold text-slate-800">{value}</span>
          </div>
        ))}
      </div>

      {/* Line items table */}
      {hasLineItems && (
        <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#F4F4F5] text-slate-600">
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Description</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden sm:table-cell">Category</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden sm:table-cell">Qty</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider hidden md:table-cell">Allocated</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden md:table-cell">Status</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden lg:table-cell">Vendor</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden lg:table-cell">Doc</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {request.lineItems!.map((item, idx) => {
                const allocatedINR = getAllocatedINR(item.masterItemId, capexMaster)
                const overAllocated =
                  item.budget !== undefined &&
                  allocatedINR !== null &&
                  item.budget > allocatedINR
                return (
                  <tr
                    key={item.id}
                    className={[
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50",
                      overAllocated ? "border-l-4 border-l-red-500" : "",
                    ].join(" ")}
                  >
                    <td className="px-3 py-2 text-slate-400 font-bold">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-slate-800">{item.description}</span>
                      {item.division && <span className="ml-1.5 text-slate-600 text-xs font-semibold">{item.division}</span>}
                      {item.masterHead && <span className="ml-1.5 text-slate-400">· {item.masterHead}</span>}
                      {item.machineCapacity && (
                        <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
                          Capacity: {item.machineCapacity}
                        </span>
                      )}
                      {item.remarks && <p className="text-slate-500 mt-0.5 leading-snug">{item.remarks}</p>}
                    </td>
                    <td className="px-3 py-2 text-slate-600 hidden sm:table-cell">{item.category}</td>
                    <td className="px-3 py-2 text-slate-600 hidden sm:table-cell">{item.quantity}</td>
                    <td className="px-3 py-2 text-right font-medium text-slate-600 hidden md:table-cell">
                      {allocatedINR !== null ? formatPrice(allocatedINR) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <BudgetStatusChip budget={item.budget} allocatedINR={allocatedINR} />
                    </td>
                    <td className="px-3 py-2 text-slate-600 hidden lg:table-cell">
                      {item.vendorRecommendation?.vendorName ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {item.attachmentName
                        ? <span className="text-blue-700 font-medium truncate max-w-[100px] block" title={item.attachmentName}>{item.attachmentName}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {lineBudgetSummary && lineBudgetSummary.totalAllocated !== null && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Budget Summary</p>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="text-slate-600">
                  Allocated:{" "}
                  <span className="font-semibold text-slate-800">
                    {formatPrice(lineBudgetSummary.totalAllocated)}
                  </span>
                </span>
                <BudgetStatusChip
                  budget={lineBudgetSummary.totalBudget}
                  allocatedINR={lineBudgetSummary.totalAllocated}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Justification / remarks / reason / ROI — clamped-but-visible, 2-up */}
      {hasText && (
        <div className="border-t border-slate-100 mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {request.justification && <ClampText label="Justification" text={request.justification} />}
          {request.remarks && <ClampText label="Complete Description" text={request.remarks} />}
          {request.reasonForRequirement && <ClampText label="Reason for Requirement" text={request.reasonForRequirement} />}
          {request.benefitsRoi && <ClampText label="Benefits / ROI" text={request.benefitsRoi} />}
        </div>
      )}

      {/* Preferred vendor */}
      {hasVendorRec && (
        <div className="border-t border-slate-100 mt-3 pt-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Preferred Vendor</p>
          <p className="text-sm font-semibold text-slate-800">{request.vendorRecommendation!.vendorName}</p>
          {request.vendorRecommendation!.reason && (
            <p className="text-sm text-slate-500 mt-0.5">{request.vendorRecommendation!.reason}</p>
          )}
        </div>
      )}

      {/* Attachment */}
      {request.attachmentName && (
        <div className="border-t border-slate-100 mt-3 pt-3">
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
                className="ml-1 inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:text-[#1D4ED8] bg-[#DBEAFE] hover:bg-[#93C5FD]/40 border border-[#93C5FD] px-2 py-1 rounded-md transition-colors"
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

// Per-award (split reverse auction) fulfillment-status labels for the internal award tracker.
const AWARD_STATUS_LABEL: Record<string, string> = {
  awarded:              "Awarded — terms pending",
  pi_requested:         "PI requested",
  pi_submitted:         "PI submitted",
  accounts_processing:  "With Accounts (FA codes)",
  payment_in_progress:  "PO issued — payments",
  completed:            "Completed",
}

const STATUS_TO_STEP: Record<CapexStatus, number> = {
  draft:                  0,
  submitted:              0,
  pending_head_approval:  1,
  sourcing:               2,
  negotiation:            2,
  sourcing_approved:      3,
  buyer_approved:         4,
  // Brown Field fulfillment chain (step tracker refined in later phases)
  pi_requested:           4,
  pi_submitted:           4,
  accounts_processing:    4,
  payment_in_progress:    4,
  completed:              4,
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
    icon: ClockIcon, color: "border-slate-400 bg-slate-50", textColor: "text-slate-800",
    title: "Awaiting Plant Head Approval",
    body: "Your request is with the Plant Head for review. Sourcing will begin once approved.",
  },
  sourcing: {
    icon: SearchIcon, color: "border-slate-400 bg-slate-50", textColor: "text-slate-800",
    title: "Being Sourced",
    body: "The sourcing team is actively working on vendor quotes for this request.",
  },
  negotiation: {
    icon: SearchIcon, color: "border-[#2563EB] bg-[#DBEAFE]", textColor: "text-[#1D4ED8]",
    title: "Vendor Negotiation Ongoing",
    body: "The sourcing team is negotiating with shortlisted vendors to secure the best terms.",
  },
  sourcing_approved: {
    icon: BellIcon, color: "border-[#2563EB] bg-[#DBEAFE]", textColor: "text-[#1D4ED8]",
    title: "Action Required",
    body: "Sourcing has selected a vendor. Please review the recommendation below and approve or reject.",
  },
  buyer_approved: {
    icon: CheckCircleIcon, color: "border-slate-400 bg-slate-50", textColor: "text-slate-800",
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
    <div className="space-y-4">
      {/* Status stepper */}
      {request.status !== "rejected" && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5">
          <div className="relative flex items-start justify-between">
            {/* Connector line */}
            <div className="absolute top-3 left-[calc(10%)] right-[calc(10%)] h-px bg-slate-200" />
            {BUYER_STEPS.map((step, idx) => {
              const done   = idx < activeStep
              const active = idx === activeStep
              const future = idx > activeStep
              return (
                <div key={step.key} className="relative flex flex-col items-center gap-1 flex-1">
                  <div className={[
                    "w-6 h-6 rounded-full flex items-center justify-center z-10 transition-all text-[11px] font-bold",
                    done   ? "bg-[#2563EB] text-white shadow-sm" : "",
                    active ? "bg-white border-2 border-[#2563EB] text-[#2563EB] shadow-sm" : "",
                    future ? "bg-white border-2 border-slate-200 text-slate-300" : "",
                  ].join(" ")}>
                    {done
                      ? <CheckIcon className="w-3.5 h-3.5" />
                      : idx + 1
                    }
                  </div>
                  <span className={[
                    "text-[11px] text-center leading-tight max-w-[72px] hidden sm:block",
                    done   ? "text-[#2563EB] font-medium" : "",
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
        <div className={`rounded-xl border-l-4 px-4 py-3 flex items-start gap-3 ${msg.color}`}>
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
        <div className="bg-white border border-[#93C5FD] rounded-xl p-4 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#2563EB] animate-pulse" />
            <h2 className="text-sm font-bold text-slate-900">Sourcing Recommendation — Action Required</h2>
          </div>
          {approvedInvite && approvedVendor && approvedQuote ? (
            <>
              {/* Vendor identity */}
              <div className="rounded-lg bg-[#DBEAFE] border border-[#93C5FD] px-4 py-3 flex flex-wrap gap-x-6 gap-y-2">
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
                          <td className="px-4 py-2 text-slate-500">{label}</td>
                          <td className="px-4 py-2 text-right font-medium text-slate-800">{formatPrice(value)}</td>
                        </tr>
                      ) : null)}
                      <tr className="bg-[#DBEAFE]">
                        <td className="px-4 py-2 font-bold text-slate-700">Total</td>
                        <td className="px-4 py-2 text-right font-bold text-[#2563EB]">
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
                  className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-sm font-semibold transition-colors shadow-sm"
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
            <p className="text-sm text-[#2563EB]">No vendor has been finalised yet. Please check back shortly.</p>
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
    <div className={CARD}>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">Status History</p>
      <ol className="relative space-y-4 pl-5 before:absolute before:left-1.5 before:top-1 before:bottom-1 before:w-px before:bg-slate-200">
        {[...history].reverse().map((entry, idx) => (
          <li key={idx} className="relative">
            <span className="absolute -left-[17px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-[#2563EB]" />
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={entry.status} size="xs" />
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
    <div className="rounded-xl border border-slate-300 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-[#334155]">
        <div className="flex items-center gap-2">
          <CheckCircleIcon className="w-4 h-4 text-slate-300" />
          <p className="text-sm font-bold text-white">Sourcing Decision Locked</p>
        </div>
        {sd?.savedAt && (
          <p className="text-xs text-slate-300">
            Locked {new Date(sd.savedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        )}
      </div>
      <div className="bg-slate-50 px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
        {finalTotal > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Final Amount</p>
            <p className="text-xl font-bold text-slate-900">{formatPrice(Math.round(finalTotal))}</p>
          </div>
        )}
        {savings > 0 ? (
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Saved vs Budget</p>
            <p className="text-xl font-bold text-emerald-700">{formatPrice(Math.round(savings))}</p>
            {savingsPct && <p className="text-xs text-emerald-600 font-semibold mt-0.5">{savingsPct}% under budget</p>}
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
            <p className="text-sm text-slate-800 font-medium">Decision approved — vendor has been engaged.</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Reverse auction panel ───────────────────────────────────── */

const SOURCING_ROLES = ["sourcing_member", "sourcing_member_2", "sourcing_member_3", "sourcing_member_4", "super_admin"]

// Delivery location form component
function DeliveryLocationRow({
  location,
  onChange,
  onRemove,
  showRemove
}: {
  location: { name: string; state: string; subLocationCount?: number }
  onChange: (updates: Partial<{ name: string; state: string; subLocationCount: number }>) => void
  onRemove: () => void
  showRemove: boolean
}) {
  return (
    <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-lg">
      <div className="flex-1 grid grid-cols-3 gap-2">
        <input
          type="text"
          value={location.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Location name (e.g., Jhajjar)"
          className="text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <input
          type="text"
          value={location.state}
          onChange={e => onChange({ state: e.target.value })}
          placeholder="State (e.g., Haryana)"
          className="text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <input
          type="number"
          value={location.subLocationCount || ''}
          onChange={e => onChange({ subLocationCount: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="Sub-locations (optional)"
          className="text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      {showRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="p-2 text-red-500 hover:bg-red-50 rounded-md"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// Auction Document Print View
function AuctionDocumentPrintView({
  request,
  document,
  vendors,
  reqInvites
}: {
  request: CapexRequest
  document: import("@/lib/types").AuctionApprovalDocument
  vendors: Vendor[]
  reqInvites: VendorInvite[]
}) {
  const placeholders = buildAuctionDocumentPlaceholders(request, document)
  const vendorList = reqInvites
    .filter(inv => inv.auctionApprovalStatus !== 'not_sent')
    .map(inv => vendors.find(v => v.id === inv.vendorId))
    .filter(Boolean)

  return (
    <div className="bg-white p-8 max-w-4xl mx-auto print:p-0 print:m-0">
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold uppercase tracking-wide">Business Rules for Reverse Auction</h1>
        <p className="text-sm text-slate-500">(Annexure – I)</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div>
          <p className="text-slate-500">Auction No:</p>
          <p className="font-semibold">{placeholders.auctionNumber}</p>
        </div>
        <div className="text-right">
          <p className="text-slate-500">Closing Date/Time:</p>
          <p className="font-semibold">{placeholders.auctionDate} {placeholders.closingTime}</p>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 mb-6 text-sm">
        <p className="mb-4">
          Amber Enterprises India Limited ('Amber') will be finalizing the rates for the procurement of{' '}
          <strong>{placeholders.itemName}</strong> through Reverse Auction mode.
        </p>

        <p className="font-semibold mb-2">Name of Work: {placeholders.itemName}</p>
        <p className="mb-4">
          Bidders are requested to go through the guidelines given herein below and submit their acceptance
          before the <strong>{placeholders.vendorRevertExpectedByDate} {placeholders.vendorRevertExpectedByTime}</strong>.
        </p>
      </div>

      <div className="space-y-4 text-sm">
        <h3 className="font-bold">1. Procedure of Reverse Auctioning:</h3>
        <div className="pl-4 space-y-2">
          <p>i. Eligibility for Bidding: Price bids shall be opened for all techno-commercially qualified bidders.</p>
          <p>ii. Bid decrement: The bid decrement will be determined by Amber.</p>
          <p>iii. Ranking order for Bids: Lowest to Highest.</p>
          <p>iv. Max decrements at one go: {placeholders.maxDecrements}</p>
        </div>

        <h3 className="font-bold">2. Schedule for reverse auction:</h3>
        <div className="pl-4 space-y-1">
          <p>Date: {placeholders.auctionDate}</p>
          <p>Opening Time: {placeholders.openingTime}</p>
          <p>Closing Time: {placeholders.closingTime}</p>
        </div>

        <h3 className="font-bold">3. Auction extension:</h3>
        <div className="pl-4">
          <p>During the Reverse Auction if a bidder is not able to bid and requests for extension of time,
          time extension of additional {placeholders.extensionDurationMins} minutes will be provided. Only {placeholders.maxExtensionsPerBidder} such requests per bidder can be entertained.</p>
        </div>

        <h3 className="font-bold">4. Bid validity:</h3>
        <div className="pl-4">
          <p>The Bid shall be valid for <strong>{placeholders.bidValidityDays} Days</strong> from the date of reverse auction.</p>
        </div>

        <h3 className="font-bold">5. Bidding currency:</h3>
        <div className="pl-4">
          <p>Bidding will be conducted in <strong>{placeholders.currency}</strong>.</p>
        </div>

        <h3 className="font-bold">6. Delivery Locations:</h3>
        <div className="pl-4">
          <pre className="whitespace-pre-wrap font-sans">{placeholders.deliveryLocations}</pre>
        </div>

        {document.performanceBankGuaranteeText && (
          <>
            <h3 className="font-bold">7. Performance Bank Guarantee:</h3>
            <div className="pl-4"><p>{document.performanceBankGuaranteeText}</p></div>
          </>
        )}
        {document.delayLiabilityClauseText && (
          <>
            <h3 className="font-bold">8. Delay Liability Clause:</h3>
            <div className="pl-4"><p>{document.delayLiabilityClauseText}</p></div>
          </>
        )}
      </div>

      <div className="mt-8 pt-6 border-t border-slate-200">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-sm font-semibold mb-2">For Amber Enterprises India Limited</p>
            <p className="text-sm">{placeholders.buyerName}</p>
            <p className="text-sm">{placeholders.buyerDesignation}</p>
            <p className="text-sm">Email: {placeholders.buyerEmail}</p>
            <p className="text-sm">Mob: {placeholders.buyerMobile}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold mb-2">Authorized Signatory</p>
            <p className="text-sm">{placeholders.signatoryName}</p>
            <p className="text-sm">{placeholders.signatoryDesignation}</p>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-4 border-t border-slate-200">
        <p className="text-xs text-slate-400 text-center">
          Amber Enterprises India Limited | www.ambergroupindia.com
        </p>
      </div>
    </div>
  )
}

function ReverseAuctionPanel({
  request,
  reqInvites,
  vendors,
  currentRole,
  selectedVendorIds,
  onSelectionChange,
}: {
  request: CapexRequest
  reqInvites: VendorInvite[]
  vendors: Vendor[]
  currentRole: string
  selectedVendorIds: string[]
  onSelectionChange: (ids: string[]) => void
}) {
  const {
    setAuctionConfig,
    inviteVendors,
    saveAuctionApprovalDocument,
    sendAuctionApprovalToVendors,
    sendAuctionApprovalReminder,
    excludeVendorFromAuction,
  } = useCapex()

  // Auction config state — threshold pre-fills from the lowest RFQ quote collected (if any),
  // so an auction escalated from RFQ starts at the best price already on the table.
  const rfqFloor = lowestRfqTotal(reqInvites, request.lineItems)
  const [durationDays, setDurationDays] = useState(request.auctionConfig?.durationDays ?? 7)
  const [threshold, setThreshold] = useState(
    String(request.auctionConfig?.threshold ?? rfqFloor ?? request.budget ?? "")
  )

  // Document setup state
  const [showDocumentForm, setShowDocumentForm] = useState(false)
  const [showDocumentPreview, setShowDocumentPreview] = useState(false)
  const [showVendorSelect, setShowVendorSelect] = useState(false)
  const [newVendorId, setNewVendorId] = useState("")
  const [tick, setTick] = useState(0)

  // Form state for document generation
  const [auctionDate, setAuctionDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 3)
    return d.toISOString().split('T')[0]
  })
  const [auctionOpeningTime, setAuctionOpeningTime] = useState('11:00')
  const [auctionClosingTime, setAuctionClosingTime] = useState('12:00')
  const [bidderAcceptanceDeadlineDate, setBidderAcceptanceDeadlineDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    return d.toISOString().split('T')[0]
  })
  const [bidderAcceptanceDeadlineTime, setBidderAcceptanceDeadlineTime] = useState('17:00')
  const [vendorRevertDeadlineAt, setVendorRevertDeadlineAt] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    return d.toISOString().slice(0, 16)
  })

  // Green field delivery locations
  const [deliveryLocations, setDeliveryLocations] = useState<{ name: string; state: string; subLocationCount?: number }[]>([
    { name: '', state: '', subLocationCount: undefined }
  ])

  // Auction rules with defaults
  const [bidValidityDays, setBidValidityDays] = useState(DEFAULT_AUCTION_RULES.bidValidityDays)
  const [maxDecrements, setMaxDecrements] = useState(DEFAULT_AUCTION_RULES.maxDecrements)
  const [extensionDurationMins, setExtensionDurationMins] = useState(DEFAULT_AUCTION_RULES.extensionDurationMinutes)
  const [maxExtensionsPerBidder, setMaxExtensionsPerBidder] = useState(DEFAULT_AUCTION_RULES.maxExtensionsPerBidder)
  const [currency, setCurrency] = useState(DEFAULT_AUCTION_RULES.currency)

  const canManage = SOURCING_ROLES.includes(currentRole)
  const showPanel = ["sourcing", "negotiation"].includes(request.status)

  const document = request.auctionApprovalDocument
  const hasDocument = !!document

  useEffect(() => {
    if (!request.auctionConfig?.endsAt) return
    const id = window.setInterval(() => setTick(t => t + 1), 60_000)
    return () => window.clearInterval(id)
  }, [request.auctionConfig?.endsAt])

  const rankings = useMemo(() => computeVendorRankings(reqInvites), [reqInvites, tick])
  const l1Price = getL1Price(rankings)
  const config = request.auctionConfig
  const active = isAuctionActive(config)
  const expired = isAuctionExpired(config)

  const invitedVendorIds = useMemo(() => new Set(reqInvites.map(inv => inv.vendorId)), [reqInvites])
  const uninvitedVendors = useMemo(
    () => vendors.filter(v => !invitedVendorIds.has(v.id)),
    [vendors, invitedVendorIds]
  )

  // Auction approval status check
  const approvalStatus = useMemo(() => canStartAuction(reqInvites, document?.vendorRevertDeadlineAt), [reqInvites, document?.vendorRevertDeadlineAt])

  if (!showPanel || !canManage) return null

  function toggleVendor(vendorId: string) {
    const isSelected = selectedVendorIds.includes(vendorId)
    if (isSelected) {
      if (invitedVendorIds.has(vendorId)) return
      onSelectionChange(selectedVendorIds.filter(id => id !== vendorId))
    } else {
      onSelectionChange([...selectedVendorIds, vendorId])
    }
  }

  function generateAndSendDocument() {
    const currentUser = {
      name: ROLE_NAMES[currentRole] || currentRole,
      designation: SOURCING_ROLES.find(r => r === currentRole)?.replace(/_/g, ' ') || 'Sourcing Member',
      email: 'sourcing@ambergroupindia.com',
      mobile: '+91 99999 99999',
    }

    const doc = createAuctionApprovalDocument(request, currentUser, {
      auctionDate,
      auctionOpeningTime: `${auctionOpeningTime} Hrs`,
      auctionClosingTime: `${auctionClosingTime} Hrs`,
      bidderAcceptanceDeadlineDate,
      bidderAcceptanceDeadlineTime: `${bidderAcceptanceDeadlineTime} Hrs`,
      vendorRevertDeadlineAt,
      deliveryLocations: request.fieldType === 'green_field' ? deliveryLocations.filter(l => l.name && l.state) : undefined,
      rules: {
        bidValidityDays,
        maxDecrements,
        extensionDurationMinutes: extensionDurationMins,
        maxExtensionsPerBidder,
        currency,
      },
      supplyFrame: 'As per Amber Terms and Conditions',
      paymentTerms: '60 Days from the date of Invoice (Open Account)',
    })

    saveAuctionApprovalDocument(request.id, doc)
    sendAuctionApprovalToVendors(request.id, selectedVendorIds)

    toast.success(`Business Rules document generated and sent to ${selectedVendorIds.length} vendor${selectedVendorIds.length !== 1 ? 's' : ''}`)
    setShowDocumentForm(false)
  }

  function startAuction() {
    // Only include approved vendors
    const approvedVendors = reqInvites.filter(inv =>
      isVendorEligibleForAuction(inv, document?.vendorRevertDeadlineAt)
    )
    const approvedVendorIds = approvedVendors.map(inv => inv.vendorId)

    const newVendorIds = approvedVendorIds.filter(id => !invitedVendorIds.has(id))
    if (newVendorIds.length > 0) {
      inviteVendors(request.id, newVendorIds)
    }

    const startedAt = new Date().toISOString()
    const next: AuctionConfig = {
      startedAt,
      durationDays,
      endsAt: buildAuctionEndsAt(startedAt, durationDays),
      threshold: threshold ? Number(threshold) : request.budget,
    }
    setAuctionConfig(request.id, next)
    toast.success(`Reverse auction started · ${approvedVendors.length} approved vendor${approvedVendors.length !== 1 ? "s" : ""} invited`)
  }

  function extendAuction(days: number) {
    if (!config) return
    const next: AuctionConfig = {
      ...config,
      endsAt: extendAuctionEndsAt(config.endsAt, days),
      durationDays: config.durationDays + days,
    }
    setAuctionConfig(request.id, next)
    toast.success(`Auction extended by ${days} day${days > 1 ? "s" : ""}`)
  }

  // End the auction early (in addition to the natural countdown expiry) so sourcing can
  // finalize the winner without waiting for `endsAt`. Sets `endsAt` to now → isAuctionExpired
  // becomes true → the "Select as Final" action in the vendor grid unlocks.
  function closeAuction() {
    if (!config) return
    if (!window.confirm("Close the auction now? Vendors will no longer be able to revise their bids.")) return
    setAuctionConfig(request.id, { ...config, endsAt: new Date().toISOString() })
    toast.success("Auction closed — select the winning vendor")
  }

  function addVendorToAuction() {
    if (!newVendorId) return
    inviteVendors(request.id, [newVendorId])
    if (!selectedVendorIds.includes(newVendorId)) {
      onSelectionChange([...selectedVendorIds, newVendorId])
    }
    setNewVendorId("")
    toast.success("Vendor added to auction")
  }

  function copyLink(inv: VendorInvite) {
    navigator.clipboard.writeText(buildSupplierLink(inv.token))
      .then(() => toast.success("Supplier link copied"))
      .catch(() => toast.error("Could not copy to clipboard"))
  }

  function handleSendReminder(inviteId: string, vendorName: string) {
    sendAuctionApprovalReminder(inviteId)
    toast.success(`Reminder sent to ${vendorName}`)
  }

  function handleExcludeVendor(inviteId: string, vendorName: string) {
    if (confirm(`Exclude ${vendorName} from auction?`)) {
      excludeVendorFromAuction(inviteId, 'Manually excluded by sourcing team')
      toast.success(`${vendorName} excluded from auction`)
    }
  }

  function addDeliveryLocation() {
    setDeliveryLocations(prev => [...prev, { name: '', state: '', subLocationCount: undefined }])
  }

  function updateDeliveryLocation(index: number, updates: Partial<{ name: string; state: string; subLocationCount: number }>) {
    setDeliveryLocations(prev => prev.map((loc, i) => i === index ? { ...loc, ...updates } : loc))
  }

  function removeDeliveryLocation(index: number) {
    setDeliveryLocations(prev => prev.filter((_, i) => i !== index))
  }

  // Document preview section
  if (showDocumentPreview && document) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">Business Rules for Reverse Auction - Preview</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={() => setShowDocumentPreview(false)}
              className="p-1.5 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="p-4 max-h-[600px] overflow-y-auto">
          <AuctionDocumentPrintView request={request} document={document} vendors={vendors} reqInvites={reqInvites} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Auction Document Setup Form */}
      {!hasDocument && !config && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Gavel className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold text-slate-900">Reverse Auction Setup</h2>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Step 1: Vendor Selection */}
            <div>
              <button
                type="button"
                onClick={() => setShowVendorSelect(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-800"
              >
                <Users className="w-4 h-4" />
                {showVendorSelect ? "Hide" : "Select"} Vendors ({selectedVendorIds.length} selected)
              </button>
              {showVendorSelect && (
                <div className="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Choose vendors to invite</p>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {vendors.map(vendor => {
                        const isInvited = invitedVendorIds.has(vendor.id)
                        const isSelected = selectedVendorIds.includes(vendor.id)
                        return (
                          <label
                            key={vendor.id}
                            className={[
                              "flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                              isSelected
                                ? "bg-slate-50 border-slate-200"
                                : "bg-white border-slate-200 hover:border-slate-200",
                              isInvited && "opacity-75",
                            ].join(" ")}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isInvited}
                              onChange={() => toggleVendor(vendor.id)}
                              className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{vendor.vendorName}</p>
                              <p className="text-xs text-slate-500">{vendor.vendorCode}</p>
                            </div>
                            {isInvited && (
                              <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">Already invited</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Document Configuration */}
            {!showDocumentForm ? (
              <button
                onClick={() => setShowDocumentForm(true)}
                disabled={selectedVendorIds.length === 0}
                className="w-full px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                Configure Auction Document
              </button>
            ) : (
              <div className="space-y-4 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-800">Auction Dates & Times</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Auction Date</label>
                    <input
                      type="date"
                      value={auctionDate}
                      onChange={e => setAuctionDate(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Open Time</label>
                      <input
                        type="time"
                        value={auctionOpeningTime}
                        onChange={e => setAuctionOpeningTime(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Close Time</label>
                      <input
                        type="time"
                        value={auctionClosingTime}
                        onChange={e => setAuctionClosingTime(e.target.value)}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Bidder Acceptance Deadline Date</label>
                    <input
                      type="date"
                      value={bidderAcceptanceDeadlineDate}
                      onChange={e => setBidderAcceptanceDeadlineDate(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Bidder Acceptance Deadline Time</label>
                    <input
                      type="time"
                      value={bidderAcceptanceDeadlineTime}
                      onChange={e => setBidderAcceptanceDeadlineTime(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Vendor Revert Expected By</label>
                    <input
                      type="datetime-local"
                      value={vendorRevertDeadlineAt}
                      onChange={e => setVendorRevertDeadlineAt(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                  </div>
                </div>

                {/* Green Field Delivery Locations */}
                {request.fieldType === 'green_field' && (
                  <div className="border-t border-slate-100 pt-4">
                    <h3 className="text-sm font-semibold text-slate-800 mb-3">Delivery Locations</h3>
                    <div className="space-y-2">
                      {deliveryLocations.map((loc, idx) => (
                        <DeliveryLocationRow
                          key={idx}
                          location={loc}
                          onChange={updates => updateDeliveryLocation(idx, updates)}
                          onRemove={() => removeDeliveryLocation(idx)}
                          showRemove={deliveryLocations.length > 1}
                        />
                      ))}
                    </div>
                    <button
                      onClick={addDeliveryLocation}
                      className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-800"
                    >
                      <Plus className="w-4 h-4" />
                      Add Location
                    </button>
                  </div>
                )}

                {/* Auction Rules */}
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">Auction Rules (Optional)</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Bid Validity (days)</label>
                      <input
                        type="number"
                        value={bidValidityDays}
                        onChange={e => setBidValidityDays(Number(e.target.value))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Max Decrements</label>
                      <input
                        type="number"
                        value={maxDecrements}
                        onChange={e => setMaxDecrements(Number(e.target.value))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Extension (mins)</label>
                      <input
                        type="number"
                        value={extensionDurationMins}
                        onChange={e => setExtensionDurationMins(Number(e.target.value))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Max Extensions</label>
                      <input
                        type="number"
                        value={maxExtensionsPerBidder}
                        onChange={e => setMaxExtensionsPerBidder(Number(e.target.value))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Currency</label>
                      <input
                        type="text"
                        value={currency}
                        onChange={e => setCurrency(e.target.value)}
                        placeholder="INR"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Threshold and Duration */}
                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">Auction Configuration</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Duration (days)</label>
                      <select
                        value={durationDays}
                        onChange={e => setDurationDays(Number(e.target.value))}
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      >
                        {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                          <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Threshold price (₹)</label>
                      <input
                        type="number"
                        value={threshold}
                        onChange={e => setThreshold(e.target.value)}
                        placeholder="Buyer estimate"
                        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                      {rfqFloor != null && (
                        <p className="text-[10px] text-slate-400 mt-1">Pre-filled from lowest RFQ quote ({formatPrice(rfqFloor)}) — editable.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={generateAndSendDocument}
                    disabled={selectedVendorIds.length === 0 || !auctionDate || !auctionOpeningTime || !auctionClosingTime}
                    className="flex-1 px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                  >
                    Generate & Send to Vendors
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDocumentForm(false)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Document Generated - Show Status & Approval Tracker */}
      {hasDocument && !config && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold text-slate-900">Auction Document & Vendor Approvals</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDocumentPreview(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
              >
                <FileText className="w-3.5 h-3.5" />
                View Document
              </button>
            </div>
          </div>

          <div className="p-4 space-y-4">
            {/* Approval Status Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-slate-700">{approvalStatus.approvedCount}</p>
                <p className="text-xs font-semibold text-slate-600 uppercase">Approved</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-slate-700">{approvalStatus.pendingCount}</p>
                <p className="text-xs font-semibold text-slate-600 uppercase">Pending</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{approvalStatus.rejectedCount}</p>
                <p className="text-xs font-semibold text-red-600 uppercase">Rejected/Excluded</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-slate-700">{approvalStatus.overdueCount}</p>
                <p className="text-xs font-semibold text-slate-600 uppercase">Overdue</p>
              </div>
            </div>

            {/* Vendor Approval Tracker */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vendor Approval Tracker</p>
                <span className="text-xs text-slate-500">
                  Deadline: {document.vendorRevertDeadlineAt ? new Date(document.vendorRevertDeadlineAt).toLocaleString('en-IN') : 'Not set'}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {reqInvites.filter(inv => inv.auctionApprovalStatus !== 'not_sent').length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No vendors have been sent the approval document yet.</p>
                ) : (
                  reqInvites
                    .filter(inv => inv.auctionApprovalStatus !== 'not_sent')
                    .map(inv => {
                      const vendor = vendors.find(v => v.id === inv.vendorId)
                      const status = getEffectiveAuctionApprovalStatus(inv, document?.vendorRevertDeadlineAt)
                      return (
                        <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs">
                              {vendor?.vendorName?.charAt(0) ?? "V"}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{vendor?.vendorName ?? inv.vendorId}</p>
                              <p className="text-xs text-slate-500">{vendor?.vendorCode ?? ""}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <span className={[
                                "text-[10px] font-semibold px-2 py-0.5 rounded-full",
                                AUCTION_APPROVAL_STATUS_COLORS[status],
                              ].join(" ")}>
                                {AUCTION_APPROVAL_STATUS_LABELS[status]}
                              </span>
                              {inv.approvalRespondedAt && (
                                <p className="text-[10px] text-slate-400 mt-0.5">
                                  Responded: {new Date(inv.approvalRespondedAt).toLocaleDateString('en-IN')}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {status === 'pending' && (
                                <>
                                  <button
                                    onClick={() => handleSendReminder(inv.id, vendor?.vendorName || 'Vendor')}
                                    className="p-1.5 text-slate-600 hover:bg-slate-50 rounded-md"
                                    title="Send reminder"
                                  >
                                    <Bell className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => handleExcludeVendor(inv.id, vendor?.vendorName || 'Vendor')}
                                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                                    title="Exclude from auction"
                                  >
                                    <UserX className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => copyLink(inv)}
                                className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-md"
                                title="Copy supplier link"
                              >
                                <Copy className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>

            {/* Auction Launch Gate */}
            <div className="border-t border-slate-100 pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Duration (days)</label>
                  <select
                    value={durationDays}
                    onChange={e => setDurationDays(Number(e.target.value))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  >
                    {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Threshold price (₹)</label>
                  <input
                    type="number"
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    placeholder="Buyer estimate"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={startAuction}
                  disabled={!approvalStatus.canStart}
                  className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
                >
                  {approvalStatus.canStart
                    ? `Start Auction (${approvalStatus.approvedCount} approved)`
                    : 'Start Auction (needs ≥1 approval)'}
                </button>
              </div>
              {!approvalStatus.canStart && (
                <p className="mt-2 text-xs text-slate-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  At least one vendor must approve the document before starting the auction.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active Auction Panel */}
      {config && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3.5 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Gavel className="w-4 h-4 text-slate-600" />
              <h2 className="text-sm font-bold text-slate-900">Reverse Auction</h2>
            </div>
            {config?.endsAt && (
              <div className={[
                "flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full",
                expired ? "bg-red-100 text-red-700" : active ? "bg-slate-100 text-slate-700" : "bg-slate-100 text-slate-600",
              ].join(" ")}>
                <Timer className="w-3.5 h-3.5" />
                {expired ? "Auction closed" : formatAuctionCountdown(config.endsAt)}
              </div>
            )}
          </div>

          <div className="p-4 space-y-4">
            {expired && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 font-medium">
                Auction has ended. Extend to allow vendors to revise quotes.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-slate-500">Threshold:</span>
              <span className="font-bold text-slate-800">
                {config.threshold ? formatPrice(config.threshold) : "—"}
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-slate-500">Ends:</span>
              <span className="font-semibold text-slate-700">
                {new Date(config.endsAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
              <div className="flex gap-2 ml-auto">
                {[1, 3, 7].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => extendAuction(d)}
                    className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50"
                  >
                    +{d}d
                  </button>
                ))}
                {!expired && canManage && (
                  <button
                    type="button"
                    onClick={closeAuction}
                    className="px-3 py-1.5 text-xs font-semibold bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50"
                  >
                    Close Auction Now
                  </button>
                )}
              </div>
            </div>

            {/* Approved Vendors Only in Active Auction */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Approved Vendors Only</p>
                <span className="text-xs text-slate-500">{reqInvites.filter(inv => isVendorEligibleForAuction(inv, document?.vendorRevertDeadlineAt)).length} eligible</span>
              </div>
              <div className="divide-y divide-slate-100">
                {reqInvites
                  .filter(inv => isVendorEligibleForAuction(inv, document?.vendorRevertDeadlineAt))
                  .map(inv => {
                    const vendor = vendors.find(v => v.id === inv.vendorId)
                    return (
                      <div key={inv.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs">
                            {vendor?.vendorName?.charAt(0) ?? "V"}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{vendor?.vendorName ?? inv.vendorId}</p>
                            <p className="text-xs text-slate-500">{vendor?.vendorCode ?? ""}</p>
                          </div>
                          <span className={[
                            "ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                            inv.status === "quote_received"
                              ? "bg-slate-100 text-slate-700"
                              : inv.status === "approved"
                              ? "bg-slate-100 text-slate-700"
                              : "bg-slate-100 text-slate-600",
                          ].join(" ")}>
                            {inv.status.replace("_", " ")}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyLink(inv)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 hover:border-slate-200 hover:text-slate-700 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy Link
                        </button>
                      </div>
                    )
                  })}
              </div>
              {uninvitedVendors.length > 0 && (
                <div className="px-4 py-3 bg-slate-50/50 border-t border-slate-100">
                  <div className="flex items-center gap-2">
                    <select
                      value={newVendorId}
                      onChange={e => setNewVendorId(e.target.value)}
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
                    >
                      <option value="">Add vendor to auction…</option>
                      {uninvitedVendors.map(v => (
                        <option key={v.id} value={v.id}>{v.vendorName} ({v.vendorCode})</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addVendorToAuction}
                      disabled={!newVendorId}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 text-white rounded-lg hover:bg-slate-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>

            {request.auctionConfig?.openingBestPrice != null && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 flex-wrap">
                <div>
                  <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Opening Price to Beat</p>
                  <p className="text-lg font-bold text-emerald-800 tabular-nums">{formatPrice(request.auctionConfig.openingBestPrice)}</p>
                </div>
                <p className="text-xs text-emerald-700 max-w-[18rem]">Best RFQ price cut 5% at auction start. All ranks reset — vendors must submit a fresh bid to reveal their rank.</p>
              </div>
            )}
            {rankings.length === 0 && (
              <p className="text-sm text-slate-500 border border-slate-200 rounded-lg px-4 py-3">No bids yet — vendors bid to reveal their rank.</p>
            )}

            {rankings.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vendor Ranking</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      <th className="px-4 py-2 text-left">Rank</th>
                      <th className="px-4 py-2 text-left">Vendor</th>
                      <th className="px-4 py-2 text-right">Quote</th>
                      <th className="px-4 py-2 text-right">Gap to L1</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rankings.map(row => {
                      const vendor = vendors.find(v => v.id === row.vendorId)
                      const gap = l1Price !== null && row.rank > 1 ? row.price - l1Price : 0
                      return (
                        <tr key={row.inviteId} className={row.rank === 1 ? "bg-slate-50/50" : ""}>
                          <td className="px-4 py-2">
                            <span className={[
                              "text-xs font-bold px-2 py-0.5 rounded-full",
                              row.rank === 1 ? "bg-slate-100 text-slate-800" : "bg-slate-100 text-slate-600",
                            ].join(" ")}>
                              {rankLabel(row.rank)}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-semibold text-slate-800">{vendor?.vendorName ?? row.vendorId}</td>
                          <td className="px-4 py-2 text-right font-mono font-bold text-slate-800">{formatPrice(row.price)}</td>
                          <td className="px-4 py-2 text-right">
                            {row.rank === 1 ? (
                              <span className="text-xs font-semibold text-slate-700">Lowest</span>
                            ) : (
                              <span className="text-xs font-semibold text-slate-700">+{formatPrice(gap)}</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Main page ───────────────────────────────────────────────── */

export default function CapexDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { requests, invites, vendors, updateRequest, setSourcingMode, requestProformaInvoice, sendDocApprovalPackage, resendDocApprovalPackage, decideRequestPlantHead, respondToTrial, setTrialRequired } = useCapex()
  const [currentRole, setCurrentRole] = useState("buyer")
  const [phEmailOpen, setPhEmailOpen] = useState(false)

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [])

  const request = requests.find(r => r.id === id)
  if (!request) {
    return <div className="p-5"><p className="text-slate-400">Request not found.</p></div>
  }

  const reqInvites      = invites.filter(i => i.requestId === id)
  // Split-award (reverse auction): a request fans out into one fulfillment track per awarded vendor.
  const awardBased      = isAwardBased(reqInvites)
  const awardInvites    = awardedInvites(reqInvites)
  const approvedInvite  = reqInvites.find(i => i.status === "approved") ?? null
  const approvedVendor  = approvedInvite ? (vendors.find(v => v.id === approvedInvite.vendorId) ?? null) : null
  const approvedQuote   = approvedInvite?.quotes[approvedInvite.quotes.length - 1]
  const assignedEngineer = SOURCING_ENGINEERS.find(e => e.value === request.assignedTo)

  const currentUser  = ROLE_NAMES[currentRole] ?? currentRole
  const isBuyer      = currentRole.startsWith("buyer")
  const canManageSourcing = SOURCING_ROLES.includes(currentRole)
  // The sourcing team finalizes the winner + requests the PI directly — there is no sourcing-head gate.
  const canFinalize = canManageSourcing
  // Auction winner's contract-terms approval status — gates the Request-PI card (mirror RFQ).
  const winnerDocStatus = approvedInvite ? effectiveDocApprovalStatus(approvedInvite.docApprovalStatus) : "not_sent"
  const isBrownField = (request.fieldType ?? "brown_field") === "brown_field"
  // Brown Field is RFQ-only by default; a reverse auction can only be started from within RFQ
  // (RfqPanel sets sourcingMode='auction'). So RFQ shows unless the request was escalated to auction.
  const isRfqMode = isBrownField && request.sourcingMode !== "auction"

  // A timed reverse auction was run on this request (Brown Field escalation or a Green Field
  // auction). This is what makes the flow mirror RFQ (no buyer sign-off); non-auction
  // seeded-quote comparisons keep their buyer-approval step.
  const ranAuction = !!request.auctionConfig?.endsAt
  // The auction winner can only be finalized (and the PI requested) once the auction has ended:
  // either the countdown reached `endsAt` or sourcing closed it early.
  const auctionEnded = !ranAuction || isAuctionExpired(request.auctionConfig)
  // Pre-PI states an auction winner may sit in before the PI is requested (the last two only for
  // legacy/in-flight requests created before the buyer step was dropped).
  const PRE_PI_STATUSES: CapexStatus[] = ["sourcing", "negotiation", "sourcing_approved", "buyer_approved"]

  // Default a Brown Field request entering sourcing into RFQ mode (no chooser) so the supplier
  // portal routes to the RFQ view and invites are stamped awaiting_quote.
  useEffect(() => {
    if (isBrownField && !request.sourcingMode && (request.status === "sourcing" || request.status === "negotiation")) {
      setSourcingMode(id, "rfq")
    }
  }, [id, isBrownField, request.sourcingMode, request.status, setSourcingMode])

  // Auction vendor selection state - shared between auction panel and vendor grid
  const [auctionSelectedVendorIds, setAuctionSelectedVendorIds] = useState<string[]>(() =>
    reqInvites.map(inv => inv.vendorId)
  )

  // Keep selection in sync when new invites are added
  useEffect(() => {
    const invitedIds = reqInvites.map(inv => inv.vendorId)
    setAuctionSelectedVendorIds(prev => [...new Set([...prev, ...invitedIds])])
  }, [reqInvites.map(inv => inv.vendorId).join(",")])

  const handleHeadApprove = () => {
    decideRequestPlantHead(id, "approved")
    toast.success("Request approved for sourcing")
  }
  const handleHeadReject = () => {
    decideRequestPlantHead(id, "rejected")
    toast.error("Request rejected")
  }
  const approvalLink = request.approvalToken ? buildApprovalLink(request.approvalToken) : ""
  const phEmailSubject = `Approval Needed — ${request.requestNo ?? request.id.slice(0, 8)} · ${request.subject}`
  const phEmailBody = [
    "Dear Plant Head,",
    "",
    `A CAPEX request requires your approval before it can move to sourcing.`,
    "",
    `Request: ${request.requestNo ?? request.id.slice(0, 8)} — ${request.subject}`,
    `Raised by: ${request.createdBy}`,
    request.plant ? `Plant: ${request.plant}` : "",
    "",
    "Please review and Approve / Reject using the secure link below:",
    approvalLink,
    "",
    "Regards,",
    "Amber Enterprises CAPEX Portal",
  ].filter(Boolean).join("\n")
  const handleSelectFinal = (inviteId: string) => {
    const inv = reqInvites.find(i => i.id === inviteId)
    if (ranAuction) {
      // Reverse auction mirrors RFQ: finalizing the winner does NOT route through a
      // separate buyer approval. The grid already marked the invite `approved`; we record
      // the finalized vendor (field-only update, no status hop) so resolveFinalVendor resolves
      // the correct winner, then auto-send the doc-package (Commercial Terms / PBG / DLC /
      // payment terms) for the vendor to approve before the PI can be requested — exactly as
      // RFQ does the moment a price is agreed.
      if (inv) {
        updateRequest(id, { finalVendorId: inv.vendorId }, currentUser)
        sendDocApprovalPackage(id, [inv.vendorId])
      }
      toast.success("Winner finalized — contract terms sent to the vendor for approval")
    } else {
      // Non-auction seeded-quote comparison (Green Field / Digitisation / IT) keeps its
      // existing buyer sign-off before the PI is requested.
      updateRequest(id, { status: "sourcing_approved" }, currentUser)
      toast.success("Vendor selected — sent to buyer for approval")
    }
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
    <div className="p-5 space-y-4">

      {/* Shared header */}
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{request.subject}</h1>
          <StatusBadge status={request.status} />
          {awardBased && (
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">
              {awardSummary(reqInvites).completed} / {awardSummary(reqInvites).total} awards complete
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">{request.category}</span>
          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">Qty: {request.quantity}</span>
          {request.budget && (
            <span className="text-sm text-slate-500 font-semibold">{formatPrice(request.budget)}</span>
          )}
          {assignedEngineer && (
            <span className="text-xs font-semibold bg-slate-50 text-slate-700 px-2.5 py-1 rounded-full">
              {assignedEngineer.name}
            </span>
          )}
          {request.requestNo && (
            <span className="text-xs font-bold bg-slate-100 text-slate-900 px-2 py-0.5 rounded-full">{request.requestNo}</span>
          )}
          <span className={[
            "text-xs font-semibold px-2.5 py-1 rounded-full",
            request.fieldType === "green_field" ? "bg-slate-100 text-slate-800" : "bg-slate-100 text-slate-600",
          ].join(" ")}>
            {request.fieldType === "green_field" ? "Green Field" : "Brown Field"}
          </span>
          <span className="text-xs text-slate-900 font-mono font-semibold">{request.id.slice(0, 8)}…</span>
        </div>
      </div>

      <RequestInfoCard request={request} />

      <SourcingDecisionBanner request={request} vendors={vendors} />

      <div className="space-y-4">

      {/* Plant-head approval — shown to EVERYONE (incl. the buyer who raised it) so they can send
          the emailed public link to the plant head. No in-app plant-head role. */}
      {request.status === "pending_head_approval" && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="font-semibold text-slate-900">Awaiting Plant Head approval (sent via email).</p>
            <p className="text-sm text-slate-700 mt-0.5">
              Submitted by {request.createdBy}
              {request.plant ? ` · ${request.plant}` : ""}
              {assignedEngineer ? ` · Assigned to ${assignedEngineer.name}` : ""}
            </p>
            <p className="text-xs text-slate-500 mt-1">Share the secure link below with the plant head to approve or reject.</p>
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap">
            <button
              onClick={() => { if (approvalLink) { navigator.clipboard?.writeText(approvalLink); toast.success("Approval link copied") } }}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <Copy className="w-4 h-4" /> Copy link
            </button>
            <button
              onClick={() => setPhEmailOpen(true)}
              className="px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold inline-flex items-center gap-1.5"
            >
              <FileText className="w-4 h-4" /> Preview email
            </button>
            {currentRole === "super_admin" && (
              <>
                <button onClick={handleHeadApprove} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">
                  Approve
                </button>
                <button onClick={handleHeadReject} className="px-3 py-2 rounded-lg bg-white hover:bg-red-50 text-red-600 text-sm font-semibold border border-red-200">
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <EmailPreviewModal
        open={phEmailOpen}
        onClose={() => setPhEmailOpen(false)}
        title="Plant Head Approval — Email Preview"
        defaultTo={PLANT_HEAD_EMAIL}
        subject={phEmailSubject}
        body={phEmailBody}
        link={approvalLink}
        linkLabel="Plant-head approval link"
        sendLabel="Send to Plant Head"
        onSend={(to) => { toast.success(`Approval email sent to ${to}`); setPhEmailOpen(false) }}
      />

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
          {/* Sourcing setup — import/add vendors and (optionally) require an item trial. Available to
              the sourcing team while the request is pre-award (sourcing / negotiation), for BOTH the
              RFQ and reverse-auction paths. */}
          {canManageSourcing && (request.status === "sourcing" || request.status === "negotiation") && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2">
                <p className="text-sm font-bold text-slate-900">Sourcing setup</p>
                <p className="text-xs text-slate-500">Optionally require an item trial before you approve a vendor. Add vendors from the invite options below.</p>
              </div>
              <label className="flex items-start gap-2.5 cursor-pointer border-t border-slate-100 pt-3">
                <input
                  type="checkbox"
                  checked={!!request.trialRequired}
                  onChange={e => { setTrialRequired(request.id, e.target.checked); toast.success(e.target.checked ? "Item trial required before final payment" : "Item trial turned off") }}
                  className="mt-0.5 h-4 w-4 accent-[#2563EB]"
                />
                <span className="text-sm text-slate-700 leading-snug">
                  <span className="font-semibold text-slate-900">Require an item trial before final payment</span> — after the advance
                  is paid, the awarded vendor uploads a trial video / photo / report for your approval; the final payment stays
                  blocked until you approve it. Set this <span className="font-semibold">before</span> approving the vendor.
                </span>
              </label>
            </div>
          )}

          {/* RFQ path (Brown Field default) */}
          {isRfqMode && (
            <RfqPanel
              request={request}
              invites={reqInvites}
              vendors={vendors}
              currentRole={currentRole}
            />
          )}

          {/* Reverse auction path (non-Brown, or RFQ escalated to auction) */}
          {!isRfqMode && (
            <>
              <ReverseAuctionPanel
                request={request}
                reqInvites={reqInvites}
                vendors={vendors}
                currentRole={currentRole}
                selectedVendorIds={auctionSelectedVendorIds}
                onSelectionChange={setAuctionSelectedVendorIds}
              />

              {/* Split award (reverse auction): one fulfillment track per awarded vendor. Each
                  vendor approves its own contract terms, then sourcing requests that vendor's PI;
                  thereafter the award progresses independently (PI → FA → PO → payments). */}
              {awardBased && canManageSourcing && (
                <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <p className="font-semibold text-foreground">
                    Awarded vendors ({awardSummary(reqInvites).completed} / {awardSummary(reqInvites).total} complete)
                  </p>
                  {awardInvites.map(inv => {
                    const v = vendors.find(vv => vv.id === inv.vendorId)
                    const itemNames = (request.lineItems ?? [])
                      .filter(li => inv.awardedItemIds?.includes(li.id))
                      .map(li => li.description)
                    // Auction terms were approved pre-bid (Business Rules), so an awarded vendor is
                    // immediately ready for the PI request — no per-award doc-approval step.
                    const prePi = (inv.awardStatus ?? "awarded") === "awarded"
                    return (
                      <div key={inv.id} className="border border-border rounded-lg p-3 flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{v?.vendorName ?? "Vendor"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {itemNames.length} item{itemNames.length === 1 ? "" : "s"} · ₹{(inv.awardAmount ?? 0).toLocaleString("en-IN")} (incl. GST)
                          </p>
                          {itemNames.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate" title={itemNames.join(", ")}>{itemNames.join(", ")}</p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {!prePi ? (
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-50 text-slate-700">
                              {AWARD_STATUS_LABEL[inv.awardStatus ?? "awarded"]}
                            </span>
                          ) : canFinalize ? (
                            <button
                              onClick={() => { requestProformaInvoice(id, inv.vendorId, currentUser); toast.success(`Proforma Invoice requested from ${v?.vendorName ?? "vendor"}`) }}
                              className="px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold whitespace-nowrap"
                            >
                              Request PI
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Awaiting sourcing head to request the PI</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Legacy single-vendor auction (finalized before split award existed): the finalized
                  winner approves the doc-package, then sourcing requests one PI. */}
              {!awardBased && approvedInvite && canManageSourcing && ranAuction && auctionEnded &&
                PRE_PI_STATUSES.includes(request.status) && (
                winnerDocStatus === "approved" ? (
                  <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-semibold text-foreground">Terms approved. Request the Proforma Invoice to begin fulfillment.</p>
                      <p className="text-sm text-muted-foreground mt-0.5">{approvedVendor?.vendorName} will upload a PI for accounts to raise the PO.</p>
                    </div>
                    {canFinalize ? (
                      <button
                        onClick={() => {
                          requestProformaInvoice(id, approvedInvite.vendorId, currentUser)
                          toast.success("Proforma Invoice requested")
                        }}
                        className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold whitespace-nowrap"
                      >
                        Request Proforma Invoice
                      </button>
                    ) : (
                      <p className="text-sm text-muted-foreground whitespace-nowrap">Awaiting sourcing head to request the PI.</p>
                    )}
                  </div>
                ) : winnerDocStatus === "rejected" ? (
                  <div className="bg-card border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="font-semibold text-foreground">{approvedVendor?.vendorName} declined the contract terms.</p>
                      <p className="text-sm text-muted-foreground mt-0.5">Re-send the Commercial Terms / PBG / Delay Liability Clause for the vendor to review before requesting the PI.</p>
                    </div>
                    {canFinalize && (
                      <button
                        onClick={() => {
                          resendDocApprovalPackage(approvedInvite.id)
                          toast.success("Contract terms re-sent to the vendor")
                        }}
                        className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold whitespace-nowrap"
                      >
                        Re-send terms
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-card border border-border rounded-xl p-4">
                    <p className="font-semibold text-foreground">Winner finalized — waiting on {approvedVendor?.vendorName} to approve the contract terms.</p>
                    <p className="text-sm text-muted-foreground mt-0.5">The Request Proforma Invoice action unlocks once the vendor accepts the Commercial Terms / PBG / Delay Liability Clause.</p>
                  </div>
                )
              )}

              {/* Non-auction seeded comparison (Green Field / Digitisation / IT): requests the PI
                  after the buyer approves (buyer_approved) — existing behavior, unchanged. */}
              {approvedInvite && canManageSourcing && !ranAuction && request.status === "buyer_approved" && (
                <div className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-foreground">Winner finalized. Request the Proforma Invoice to begin fulfillment.</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{approvedVendor?.vendorName} will upload a PI for accounts to raise the PO.</p>
                  </div>
                  <button
                    onClick={() => {
                      requestProformaInvoice(id, approvedInvite.vendorId, currentUser)
                      toast.success("Proforma Invoice requested")
                    }}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold whitespace-nowrap"
                  >
                    Request Proforma Invoice
                  </button>
                </div>
              )}

              {/* Vendor grid */}
              <VendorGrid
                request={request}
                invites={reqInvites}
                vendors={vendors}
                currentRole={currentRole}
                onSelectFinal={handleSelectFinal}
                auctionSelectedVendorIds={auctionSelectedVendorIds}
                onAuctionSelectionChange={setAuctionSelectedVendorIds}
              />

              {/* Technical spec sign-off — the gate that must clear BEFORE the award below */}
              {(request.status === "sourcing" || awardBased) && (
                <TechSpecPanel
                  request={request}
                  invites={reqInvites}
                  vendors={vendors}
                  canManage={canManageSourcing}
                  senderName={ROLE_NAMES[currentRole] ?? currentRole}
                />
              )}

              {/* Unified Final-Decision approve + Request-PI (split award; bulk or per-vendor) */}
              {canManageSourcing && (request.status === "sourcing" || awardBased) && (
                <FinalDecisionActions
                  request={request}
                  invites={reqInvites}
                  vendors={vendors}
                  currentRole={currentRole}
                  canAward={auctionEnded}
                  blockedReason={!auctionEnded ? "Close the auction (or wait for it to end) before approving the Final Decision." : undefined}
                />
              )}
            </>
          )}

          {/* Shared fulfillment: TAT clock + accounts FA codes, PO & payment milestones.
              Award-based requests keep a coarse request.status (pi_requested), so also show this
              whenever any award has reached the Accounts stage. */}
          {(isFulfillmentStatus(request.status) ||
            (awardBased && awardInvites.some(i => ["pi_submitted", "accounts_processing", "payment_in_progress", "completed"].includes(i.awardStatus ?? "")))) && (
            <>
              {awardBased ? (
                awardInvites
                  .filter(i => ["pi_submitted", "accounts_processing", "payment_in_progress", "completed"].includes(i.awardStatus ?? ""))
                  .map(i => (
                    <TatBanner
                      key={i.id}
                      piSubmittedAt={i.piSubmittedAt}
                      tatStoppedAt={i.tatStoppedAt}
                      vendorAmount={i.awardAmount ?? 0}
                    />
                  ))
              ) : (
                <TatBanner
                  piSubmittedAt={request.piSubmittedAt}
                  tatStoppedAt={request.tatStoppedAt}
                  vendorAmount={resolveFinalVendor(request, reqInvites).amount}
                />
              )}
              {/* Trials — sourcing reviews the vendor's uploaded trial (approve/reject loop). */}
              {canManageSourcing && (
                awardBased
                  ? awardInvites.filter(i => i.trialRequired).map(i => (
                      <TrialCard
                        key={`trial-${i.id}`}
                        mode="review"
                        status={effectiveTrialStatus(i)}
                        submission={i.trialSubmission}
                        thread={i.trialThread}
                        onApprove={() => { respondToTrial(request.id, "approved", i.id); toast.success("Trial approved") }}
                        onReject={(m) => { respondToTrial(request.id, "rejected", i.id, m); toast("Trial rejected — vendor asked to re-upload") }}
                      />
                    ))
                  : request.trialRequired && (
                      <TrialCard
                        mode="review"
                        status={effectiveTrialStatus(request)}
                        submission={request.trialSubmission}
                        thread={request.trialThread}
                        onApprove={() => { respondToTrial(request.id, "approved"); toast.success("Trial approved") }}
                        onReject={(m) => { respondToTrial(request.id, "rejected", undefined, m); toast("Trial rejected — vendor asked to re-upload") }}
                      />
                    )
              )}
              <AccountsPanel
                request={request}
                invites={reqInvites}
                vendors={vendors}
                currentRole={currentRole}
              />
            </>
          )}
        </>
      )}

      {/* Audit trail — visible to all roles */}
      <StatusTimeline history={request.statusHistory} />

      </div>
    </div>
  )
}
