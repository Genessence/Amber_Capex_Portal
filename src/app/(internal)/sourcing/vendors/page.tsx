"use client"

import React, { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { VendorOnboardModal } from "@/components/VendorOnboardModal"
import { useCapex } from "@/lib/capexContext"
import type { Vendor } from "@/lib/types"

export default function VendorMasterPage() {
  const { vendors } = useCapex()
  const [search,       setSearch]       = useState("")
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [showModal,    setShowModal]    = useState(false)

  const filtered = vendors.filter(v =>
    !search ||
    v.vendorName.toLowerCase().includes(search.toLowerCase()) ||
    v.vendorCode.toLowerCase().includes(search.toLowerCase()) ||
    v.category.toLowerCase().includes(search.toLowerCase())
  )

  const toggleExpand = (id: string) =>
    setExpandedId(prev => prev === id ? null : id)

  return (
    <div className="p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Vendor Master</h1>
          <p className="text-xs text-slate-500 mt-0.5">All onboarded vendors across CAPEX requests.</p>
        </div>
        <Button
          onClick={() => setShowModal(true)}
          className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold"
        >
          Onboard New Vendor
        </Button>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, code, or category…"
          className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/50"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-400 text-sm">No vendors found.</p>
            <Button onClick={() => setShowModal(true)} className="mt-4 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold">
              Onboard First Vendor
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {["Vendor Code", "Name", "Category", "GSTIN", "Contact Name", "Contact Email", "Payment Terms", "Actions"].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((v, idx) => (
                <React.Fragment key={v.id}>
                  <tr className={`transition-colors hover:bg-[#EBF0FB]/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                    <td className="px-4 py-2 font-mono text-xs text-slate-600">{v.vendorCode}</td>
                    <td className="px-4 py-2 font-semibold text-slate-800">{v.vendorName}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-semibold bg-[#EBF0FB] text-[#1D4ED8] px-2 py-0.5 rounded-full">{v.category}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600 font-mono text-xs">{v.gstin || "—"}</td>
                    <td className="px-4 py-2 text-slate-700">{v.contactName || "—"}</td>
                    <td className="px-4 py-2 text-slate-600 text-xs">{v.contactEmail}</td>
                    <td className="px-4 py-2">
                      <span className="text-xs font-semibold bg-blue-600 text-white px-2 py-0.5 rounded-full">{v.paymentTerms}</span>
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => toggleExpand(v.id)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        View {expandedId === v.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                  {expandedId === v.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-5 py-3.5">
                        <ExpandedVendor vendor={v} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <VendorOnboardModal
          open={showModal}
          onClose={() => setShowModal(false)}
          requestId=""
          defaultTab="onboard"
        />
      )}
    </div>
  )
}

function ExpandedVendor({ vendor: v }: { vendor: Vendor }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
      {[
        { label: "Bank Name",       value: v.bankName },
        { label: "Account Number",  value: v.accountNumber },
        { label: "IFSC",            value: v.ifsc },
        { label: "PAN",             value: v.pan },
        { label: "Onboarded At",    value: new Date(v.onboardedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) },
      ].map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-1.5 text-xs min-w-0">
          <span className="font-bold text-slate-400 uppercase tracking-wider shrink-0">{label}:</span>
          <span className="font-semibold text-slate-700 break-words min-w-0">{value || "—"}</span>
        </div>
      ))}
    </div>
  )
}
