"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useCapex } from "@/lib/capexContext"
import { ROLE_NAMES, STATUS_COLORS, STATUS_LABELS, PLANTS } from "@/lib/constants"

const SOURCING_ROLES = ["sourcing_member", "sourcing_member_2", "sourcing_member_3", "sourcing_member_4"]

function formatBudget(n?: number) {
  if (n == null) return "—"
  return "₹" + n.toLocaleString("en-IN")
}

function plantLabel(value?: string) {
  if (!value) return null
  return PLANTS.find(p => p.value === value)?.label ?? value
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export default function RequestsPage() {
  const { requests } = useCapex()
  const [currentRole, setCurrentRole] = useState("buyer")

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [])

  const currentUser = ROLE_NAMES[currentRole] ?? ""

  const filteredRequests = (() => {
    if (currentRole === "buyer") return requests.filter(r => r.createdBy === currentUser)
    if (SOURCING_ROLES.includes(currentRole)) return requests.filter(r => r.assignedTo === currentRole)
    return requests
  })()

  const summaryLabel =
    currentRole === "buyer" ? "Your submitted requests" :
    SOURCING_ROLES.includes(currentRole) ? "Requests assigned to you" :
    "All requests"

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">CAPEX Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          {summaryLabel} — {filteredRequests.length} request{filteredRequests.length !== 1 ? "s" : ""}
        </p>
      </div>

      {filteredRequests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <p className="text-slate-400 font-medium">No requests found.</p>
          <p className="text-slate-300 text-sm mt-1">
            {currentRole === "buyer" ? "Submit a new request to get started." : "No requests are assigned to you yet."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Request</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden sm:table-cell">Plant</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Budget</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden lg:table-cell">Date</th>
                <th className="px-4 py-3.5 text-right text-[11px] font-bold uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRequests.map((req, idx) => (
                <tr key={req.id} className={`transition-colors group hover:bg-amber-50/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  {/* Subject + ID */}
                  <td className="px-5 py-4 max-w-[260px]">
                    <p className="font-semibold text-slate-900 truncate leading-snug">{req.subject}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{req.id}</p>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[req.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[req.status] ?? req.status.replace(/_/g, " ")}
                    </span>
                  </td>

                  {/* Plant */}
                  <td className="px-4 py-4 hidden sm:table-cell">
                    {plantLabel(req.plant)
                      ? <span className="text-[12px] bg-slate-700 text-white px-2 py-0.5 rounded-full font-medium">{plantLabel(req.plant)}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>

                  {/* Category */}
                  <td className="px-4 py-4 text-slate-600 hidden md:table-cell">{req.category}</td>

                  {/* Budget */}
                  <td className="px-4 py-4 font-medium text-slate-700 hidden md:table-cell">{formatBudget(req.budget)}</td>

                  {/* Date */}
                  <td className="px-4 py-4 text-slate-400 text-[12px] hidden lg:table-cell">{formatDate(req.createdAt)}</td>

                  {/* View button */}
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/capex/${req.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[12px] font-semibold transition-colors"
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
