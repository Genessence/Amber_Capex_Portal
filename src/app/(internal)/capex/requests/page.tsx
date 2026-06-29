"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useCapex } from "@/lib/capexContext"
import { ROLE_NAMES, STATUS_COLORS, STATUS_LABELS, PLANTS, getPlantForRole } from "@/lib/constants"
import { CapexRequest, CapexStatus } from "@/lib/types"

const SOURCING_ROLES = ["sourcing_member", "sourcing_head"]

function formatBudget(n?: number) {
  if (n == null) return "—"
  return "₹" + n.toLocaleString("en-IN")
}

function plantLabel(value?: string) {
  if (!value) return null
  return PLANTS.find(p => p.value === value)?.label ?? value
}

function computeFinalTotal(req: CapexRequest): number {
  const sd = req.sourcingDecision
  if (!sd?.finalPrices) return 0
  const items = req.lineItems ?? []
  if (items.length === 0) return 0
  let total = items.reduce((sum, item) => {
    const p = Number(sd.finalPrices![`${item.id}-price`] ?? 0)
    const d = Number(sd.finalPrices![`${item.id}-disc`]  ?? 0)
    const q = parseFloat(item.quantity) || 1
    return sum + p * (1 - d / 100) * q
  }, 0)
  return total + Number(sd.freight ?? 0) + Number(sd.packing ?? 0) + Number(sd.service ?? 0)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Statuses" },
  { value: "draft",                   label: STATUS_LABELS["draft"]                   ?? "Draft" },
  { value: "submitted",               label: STATUS_LABELS["submitted"]               ?? "Submitted" },
  { value: "pending_head_approval",   label: STATUS_LABELS["pending_head_approval"]   ?? "Pending Head Approval" },
  { value: "sourcing",                label: STATUS_LABELS["sourcing"]                ?? "Sourcing" },
  { value: "negotiation",             label: STATUS_LABELS["negotiation"]             ?? "Negotiation" },
  { value: "sourcing_approved",       label: STATUS_LABELS["sourcing_approved"]       ?? "Sourcing Approved" },
  { value: "buyer_approved",          label: STATUS_LABELS["buyer_approved"]          ?? "Approved" },
  { value: "rejected",                label: STATUS_LABELS["rejected"]               ?? "Rejected" },
]

function RequestsTable() {
  const { requests } = useCapex()
  const searchParams = useSearchParams()
  const [currentRole, setCurrentRole] = useState("buyer")
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("filter") ?? "")

  useEffect(() => {
    const role = localStorage.getItem("capex_role") ?? "buyer_jhajjar_p1"
    setCurrentRole(role)
    if (role.startsWith("plant_head") && !searchParams.get("filter")) {
      setStatusFilter("pending_head_approval")
    }
    const onRoleChange = (e: CustomEvent) => {
      setCurrentRole(e.detail)
      if (e.detail.startsWith("plant_head")) setStatusFilter(s => s || "pending_head_approval")
      else setStatusFilter("")
    }
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [])

  // When URL filter param changes (e.g. navigating between Pending Approvals / All Requests links)
  useEffect(() => {
    setStatusFilter(searchParams.get("filter") ?? "")
  }, [searchParams])

  const currentUser = ROLE_NAMES[currentRole] ?? ""

  const isBuyerRole      = currentRole.startsWith("buyer")
  const isPlantHeadRole  = currentRole.startsWith("plant_head")

  const roleFiltered = (() => {
    if (isBuyerRole) return requests.filter(r => r.createdBy === currentUser)
    if (currentRole === "sourcing_member") return requests.filter(r => r.assignedTo === currentRole)
    if (isPlantHeadRole) {
      const plant = getPlantForRole(currentRole)
      return plant ? requests.filter(r => r.plant === plant) : requests
    }
    return requests
  })()

  const displayRequests = statusFilter
    ? roleFiltered.filter(r => r.status === statusFilter as CapexStatus)
    : roleFiltered

  const showAssignedTo = ["sourcing_head", "super_admin"].includes(currentRole) || isPlantHeadRole

  const summaryLabel =
    isBuyerRole          ? "Your submitted requests" :
    currentRole === "sourcing_member" ? "Requests assigned to you" :
    isPlantHeadRole      ? "Plant requests" :
    "All requests"

  return (
    <div className="p-5 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">CAPEX Requests</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {summaryLabel} — {displayRequests.length} request{displayRequests.length !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-[12px] font-semibold text-slate-500 whitespace-nowrap">
            Filter by status:
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-[36px] text-[13px] text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
          >
            {STATUS_FILTER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {displayRequests.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-slate-400 font-medium">No requests found.</p>
          <p className="text-slate-300 text-sm mt-1">
            {currentRole === "buyer" ? "Submit a new request to get started." : "No requests match the current filter."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F0F4FB] text-[#1E293B]">
                <th className="px-5 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Req. No.</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Subject</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider hidden sm:table-cell">Plant</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Finalized</th>
                {showAssignedTo && (
                  <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider hidden lg:table-cell">Assigned To</th>
                )}
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider hidden lg:table-cell">Date</th>
                <th className="px-4 py-2 text-right text-[11px] font-bold uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {displayRequests.map((req, idx) => (
                <tr key={req.id} className={`transition-colors group hover:bg-[#EBF0FB]/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  {/* Request No. */}
                  <td className="px-5 py-2 whitespace-nowrap">
                    {req.requestNo
                      ? <span className="text-sm font-bold text-[#153f90]">{req.requestNo}</span>
                      : <span className="text-sm font-mono text-slate-400">{req.id.slice(0, 8)}…</span>
                    }
                  </td>

                  {/* Subject */}
                  <td className="px-4 py-2 max-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{req.subject}</span>
                      {req.lineItems && req.lineItems.length > 1 && (
                        <span className="shrink-0 text-[10px] font-bold bg-[#EBF0FB] text-[#153f90] px-1.5 py-0.5 rounded-full">
                          {req.lineItems.length} items
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[req.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[req.status] ?? req.status.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* Plant */}
                  <td className="px-4 py-2 hidden sm:table-cell">
                    {plantLabel(req.plant)
                      ? <span className="text-[12px] bg-[#EBF0FB] text-[#153f90] px-2 py-0.5 rounded-full font-medium">{plantLabel(req.plant)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Finalized price + savings */}
                  <td className="px-4 py-2 hidden md:table-cell">
                    {(() => {
                      const isApproved = req.status === "sourcing_approved" || req.status === "buyer_approved"
                      if (!isApproved) return <span className="text-slate-300">—</span>
                      const finalTotal = computeFinalTotal(req)
                      if (finalTotal <= 0) return <span className="text-slate-300">—</span>
                      const savings = (req.budget ?? 0) - finalTotal
                      const savingsPct = req.budget ? ((savings / req.budget) * 100).toFixed(1) : null
                      return (
                        <div>
                          <p className="text-sm font-bold text-slate-800">{formatBudget(Math.round(finalTotal))}</p>
                          {savings > 0 ? (
                            <p className="text-[11px] font-semibold text-green-600 mt-0.5">
                              ↓ {formatBudget(Math.round(savings))} saved{savingsPct ? ` (${savingsPct}%)` : ""}
                            </p>
                          ) : savings < 0 ? (
                            <p className="text-[11px] font-semibold text-red-500 mt-0.5">
                              ↑ {formatBudget(Math.round(-savings))} over budget
                            </p>
                          ) : null}
                        </div>
                      )
                    })()}
                  </td>

                  {/* Assigned To */}
                  {showAssignedTo && (
                    <td className="px-4 py-2 text-slate-600 text-[12px] hidden lg:table-cell">
                      {req.assignedTo ? (ROLE_NAMES[req.assignedTo] ?? req.assignedTo) : <span className="text-slate-300">—</span>}
                    </td>
                  )}

                  {/* Date */}
                  <td className="px-4 py-2 text-slate-400 text-[12px] hidden lg:table-cell">{formatDate(req.createdAt)}</td>

                  {/* View button */}
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/capex/${req.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[36px] rounded-lg bg-[#153f90] hover:bg-[#1a4da8] text-white text-[12px] font-semibold transition-colors"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function RequestsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading…</div>}>
      <RequestsTable />
    </Suspense>
  )
}
