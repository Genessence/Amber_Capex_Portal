"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCapex } from "@/lib/capexContext"
import { initialStatusForRequest } from "@/lib/capexContext"
import type { CapexRequest, CapexLineItem, Vendor, VendorRecommendation } from "@/lib/types"
import { ROLE_NAMES, SOURCING_ENGINEERS, PLANTS, getPlantForRole } from "@/lib/constants"
import { cn } from "@/lib/utils"

/* ── Types ───────────────────────────────────────────────────── */
interface GridRow {
  id: string
  masterHead: string
  masterItemId: string
  description: string
  category: string
  quantity: string
  budget: string
  remarks: string
  attachmentName: string
  attachmentBase64: string
  vendorMode: "" | "existing" | "suggest_new"
  vendorId: string
  vendorRecName: string
  vendorCode: string
  vendorSpocName: string
  vendorContact: string
}

const MAX_ATTACHMENT_BYTES = 500 * 1024

function emptyRow(): GridRow {
  return {
    id: crypto.randomUUID(),
    masterHead: "",
    masterItemId: "",
    description: "",
    category: "",
    quantity: "",
    budget: "",
    remarks: "",
    attachmentName: "",
    attachmentBase64: "",
    vendorMode: "",
    vendorId: "",
    vendorRecName: "",
    vendorCode: "",
    vendorSpocName: "",
    vendorContact: "",
  }
}

function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

const CR_TO_INR = 10_000_000

const PRIORITY_DOT: Record<string, string> = {
  low:      "bg-slate-400",
  medium:   "bg-blue-500",
  high:     "bg-orange-500",
  critical: "bg-red-600",
}

const PRIORITY_TEXT: Record<string, string> = {
  low:      "text-slate-500",
  medium:   "text-blue-600",
  high:     "text-orange-600",
  critical: "text-red-600 font-bold",
}

/* ── Shared cell control classes ─────────────────────────────── */
// Base cell control — 14px minimum for tablet readability (not 13px).
// Focus ring uses teal for ≥3:1 contrast on white at outline offset.
const cellCtrl =
  "w-full text-xs text-slate-900 bg-white border border-slate-200 rounded-md px-2 py-1.5 " +
  "focus:outline-none focus:ring-2 focus:ring-[#0D9488] focus:border-[#0D9488] " +
  "placeholder:text-slate-400 transition-colors"

// Error state: red border + light red bg. Text remains slate-900 for contrast.
const cellCtrlError = "border-red-400 bg-red-50 focus:ring-red-500 focus:border-red-500"

// Required but empty: teal-tinted to signal "needs input" without screaming error.
const cellCtrlRequired = "border-[#5EEAD4] bg-[#CCFBF1]/30 focus:ring-[#0D9488] focus:border-[#0D9488]"

// Sub-field labels inside vendor expand panel — 11px is acceptable for supplementary
// metadata labels but must be paired with sufficient surrounding contrast.
const fieldLabel = "block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"

// Mini input for the vendor suggestion sub-panel
const miniCtrl =
  "w-full text-[13px] text-slate-800 bg-white border border-slate-200 rounded px-2 py-1.5 " +
  "focus:outline-none focus:ring-2 focus:ring-[#0D9488] focus:border-[#0D9488] " +
  "placeholder:text-slate-400 transition-colors"

/* ── Step bar ────────────────────────────────────────────────── */
function StepBar({ step }: { step: "form" | "review" | "sent" }) {
  const steps = [
    { key: "form",   label: "Fill Details", num: 1 },
    { key: "review", label: "Review",        num: 2 },
    { key: "sent",   label: "Submitted",     num: 3 },
  ] as const
  const activeIdx = steps.findIndex(s => s.key === step)
  return (
    <nav aria-label="Form progress" className="flex items-center gap-0">
      {steps.map((s, idx) => {
        const done    = idx < activeIdx
        const active  = idx === activeIdx
        const pending = idx > activeIdx
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              {/* Step circle — larger (32px) for easier tablet touch recognition */}
              <div
                aria-current={active ? "step" : undefined}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 transition-all",
                  done    && "bg-[#0D9488] text-white",
                  active  && "bg-[#153f90] text-white ring-2 ring-offset-2 ring-[#153f90]",
                  pending && "bg-slate-200 text-slate-500"
                )}
              >
                {done ? (
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : s.num}
              </div>
              <span className={cn(
                "text-[13px] font-semibold hidden sm:block",
                active  && "text-[#153f90]",
                done    && "text-[#0D9488]",
                pending && "text-slate-400"
              )}>{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn(
                "h-0.5 w-8 sm:w-14 mx-2 transition-colors",
                idx < activeIdx ? "bg-[#0D9488]" : "bg-slate-200"
              )} />
            )}
          </div>
        )
      })}
    </nav>
  )
}


/* ── Vendor cell ─────────────────────────────────────────────── */
function VendorCell({
  row, idx, vendors, updateRow, updateRowMulti,
}: {
  row: GridRow
  idx: number
  vendors: Vendor[]
  updateRow: (id: string, field: keyof GridRow, value: string) => void
  updateRowMulti: (id: string, updates: Partial<GridRow>) => void
}) {
  const selectVal = row.vendorMode === "suggest_new" ? "__new__" : row.vendorId || ""

  const handleSelect = (val: string) => {
    if (val === "__new__") {
      updateRowMulti(row.id, { vendorMode: "suggest_new", vendorId: "" })
    } else if (val === "") {
      updateRowMulti(row.id, {
        vendorMode: "", vendorId: "", vendorRecName: "",
        vendorCode: "", vendorSpocName: "", vendorContact: "",
      })
    } else {
      updateRowMulti(row.id, { vendorMode: "existing", vendorId: val, vendorRecName: "" })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={selectVal}
        onChange={e => handleSelect(e.target.value)}
        className={cn(cellCtrl, !selectVal && "text-slate-500")}
        aria-label={`Row ${idx + 1} preferred vendor`}
      >
        <option value="">No preference</option>
        {vendors.map(v => <option key={v.id} value={v.id}>{v.vendorName}</option>)}
        <option value="__new__">+ Suggest new vendor</option>
      </select>

      {row.vendorMode === "suggest_new" && (
        // [CLARITY] Left border highlights expansion visually; amber color ties it
        // to the parent action without ambiguity
        <div
          className="flex flex-col gap-2 pl-3 border-l-4 border-[#14B8A6] mt-1"
          role="group"
          aria-label={`Row ${idx + 1} new vendor details`}
        >
          <div>
            <label className={fieldLabel} htmlFor={`vc-${row.id}`}>Vendor Code</label>
            <input id={`vc-${row.id}`} type="text" value={row.vendorCode} onChange={e => updateRow(row.id, "vendorCode", e.target.value)} placeholder="e.g. VND-010" className={miniCtrl} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`vn-${row.id}`}>Vendor Name</label>
            <input id={`vn-${row.id}`} type="text" value={row.vendorRecName} onChange={e => updateRow(row.id, "vendorRecName", e.target.value)} placeholder="Company name" className={miniCtrl} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`vs-${row.id}`}>SPOC Name</label>
            <input id={`vs-${row.id}`} type="text" value={row.vendorSpocName} onChange={e => updateRow(row.id, "vendorSpocName", e.target.value)} placeholder="Contact person" className={miniCtrl} />
          </div>
          <div>
            <label className={fieldLabel} htmlFor={`vct-${row.id}`}>Contact No.</label>
            <input id={`vct-${row.id}`} type="text" value={row.vendorContact} onChange={e => updateRow(row.id, "vendorContact", e.target.value)} placeholder="+91 XXXXX XXXXX" className={miniCtrl} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────── */
export default function NewCapexPage() {
  const router = useRouter()
  const { addRequest, categories: ctxCategories, vendors, capexMaster } = useCapex()
  const [step, setStep]               = useState<"form" | "review" | "sent">("form")
  const [currentRole, setCurrentRole] = useState("buyer")
  const [rows, setRows]               = useState<GridRow[]>([emptyRow()])
  const [submittedIds, setSubmittedIds] = useState<string[]>([])

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
  }, [])

  const categories = ctxCategories?.length ? ctxCategories : ["Machinery", "Infrastructure", "IT", "Tooling"]

  function updateRow(id: string, field: keyof GridRow, value: string) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, [field]: value }))
  }
  function updateRowMulti(id: string, updates: Partial<GridRow>) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, ...updates }))
  }
  function addRow() { setRows(prev => [...prev, emptyRow()]) }
  function deleteRow(id: string) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter(r => r.id !== id))
  }

  function getAllocatedINR(row: GridRow): number | null {
    if (!row.masterItemId) return null
    const item = capexMaster.find(m => m.id === row.masterItemId)
    return item ? item.totalCost * CR_TO_INR : null
  }

  const formValid = rows.every(r => r.description.trim() && r.category && r.quantity.trim() && r.remarks.trim())

  function handleSubmit() {
    const createdBy  = ROLE_NAMES[currentRole] ?? currentRole
    const plant      = getPlantForRole(currentRole) ?? "jhajjar_p1"
    const assignedTo = SOURCING_ENGINEERS[0].value
    const reqId      = crypto.randomUUID()

    const lineItems: CapexLineItem[] = rows.map(row => {
      const budgetNum = row.budget ? Number(row.budget) : undefined
      let vendorRec: VendorRecommendation | undefined
      if (row.vendorMode === "existing" && row.vendorId) {
        const v = vendors.find(v => v.id === row.vendorId)
        if (v) vendorRec = { vendorName: v.vendorName, reason: "" }
      } else if (row.vendorMode === "suggest_new" && row.vendorRecName) {
        const parts = [
          row.vendorCode     && `Code: ${row.vendorCode}`,
          row.vendorSpocName && `SPOC: ${row.vendorSpocName}`,
          row.vendorContact  && `Contact: ${row.vendorContact}`,
        ].filter(Boolean).join(" | ")
        vendorRec = { vendorName: row.vendorRecName, reason: parts }
      }
      return {
        id: crypto.randomUUID(),
        masterItemId: row.masterItemId || undefined,
        masterHead: row.masterHead || undefined,
        description: row.description,
        category: row.category,
        quantity: row.quantity,
        budget: budgetNum,
        remarks: row.remarks || undefined,
        vendorRecommendation: vendorRec,
        attachmentName: row.attachmentName || undefined,
        attachmentBase64: row.attachmentBase64 || undefined,
      }
    })

    const totalBudget = lineItems.reduce((sum, item) => sum + (item.budget ?? 0), 0) || undefined
    const first = lineItems[0]

    addRequest({
      id: reqId,
      subject: first.description,
      masterItemId: first.masterItemId,
      category: rows.length > 1 ? "Multiple" : first.category,
      quantity: rows.length > 1 ? `${rows.length} items` : first.quantity,
      budget: totalBudget,
      priority: "medium" as CapexRequest["priority"],
      justification: "",
      techSpecs: { specifications: "", complianceStandards: "" },
      assignedTo,
      status: initialStatusForRequest(totalBudget),
      createdBy,
      createdAt: new Date().toISOString(),
      plant,
      lineItems,
      remarks: rows.length === 1 ? first.remarks : undefined,
      vendorRecommendation: rows.length === 1 ? first.vendorRecommendation : undefined,
      attachmentName: rows.length === 1 ? first.attachmentName : undefined,
      attachmentBase64: rows.length === 1 ? first.attachmentBase64 : undefined,
    })

    setSubmittedIds([reqId])
    setStep("sent")
  }

  /* ─────────────────────────────────────────────────────────────
     STEP 1 — FORM
  ───────────────────────────────────────────────────────────── */
  if (step === "form") return (
    <div className="py-6 px-6 flex flex-col gap-5 h-full">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            New CAPEX Request
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Add one row per line item. Fields marked <span className="text-red-600 font-bold" aria-hidden="true">*</span>
            <span className="sr-only">asterisk</span> are required.
            Budget is in ₹ (rupees).
          </p>
        </div>
        <StepBar step="form" />
      </div>

      {/* Grid container */}
      <div className="rounded-xl border border-slate-300 overflow-hidden shadow-sm flex-1 min-h-0 flex flex-col">
        <div
          className="overflow-auto flex-1"
          role="region"
          aria-label="CAPEX request line items"
        >
          {/*
            [MOBILE/TABLET] Table needs horizontal scroll on tablet — the outer
            overflow-auto handles that. Min-width on table prevents column collapse.
          */}
          <table
            className="w-full border-collapse text-sm"
            aria-label="Line items"
            aria-describedby="required-fields-note"
          >
            {/*
              [A11Y] caption is visually hidden but provides screen-reader context.
              The required-field footnote is linked via aria-describedby on the table.
            */}
            <caption className="sr-only">
              CAPEX request line items. Subject, Category, Quantity, and Description are required per row.
            </caption>

            {/* ── Desktop thead (hidden on mobile) ── */}
            <thead className="sticky top-0 z-10 hidden lg:table-header-group">
              <tr className="bg-[#153f90] text-white text-xs font-semibold uppercase tracking-wider">
                {/* # — 40px fixed */}
                <th scope="col" className="px-3 py-3 text-center w-10 border-r border-slate-700 select-none">#</th>
                {/* Subject — flex-1, min 220px */}
                <th scope="col" className="px-3 py-3 text-left min-w-[220px] border-r border-slate-700">
                  Subject
                  <span className="text-red-400 ml-1" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </th>
                {/* Head — 180px */}
                <th scope="col" className="px-3 py-3 text-left w-[180px] border-r border-slate-700">Head</th>
                {/* Sub Particular — 300px */}
                <th scope="col" className="px-3 py-3 text-left w-[300px] border-r border-slate-700">Sub Particular</th>
                {/* Category — 140px */}
                <th scope="col" className="px-3 py-3 text-left w-[140px] border-r border-slate-700">
                  Category
                  <span className="text-red-400 ml-1" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </th>
                {/* Qty — 90px, right-aligned */}
                <th scope="col" className="px-3 py-3 text-right w-[90px] border-r border-slate-700">
                  Qty
                  <span className="text-red-400 ml-1" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </th>
                {/* Est. Budget — 180px */}
                <th scope="col" className="px-3 py-3 text-right w-[180px] border-r border-slate-700">Est. Budget</th>
                {/* Document — 160px */}
                <th scope="col" className="px-3 py-3 text-left w-[160px] border-r border-slate-700">Document</th>
                {/* Preferred Vendor — 200px */}
                <th scope="col" className="px-3 py-3 text-left w-[200px] border-r border-slate-700">Preferred Vendor</th>
                {/* Delete — 44px */}
                <th scope="col" className="px-3 py-3 w-[44px]">
                  <span className="sr-only">Delete row</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, idx) => {
                const budgetNum     = row.budget ? Number(row.budget) : undefined
                const allocatedINR  = getAllocatedINR(row)
                const overAllocated = budgetNum !== undefined && allocatedINR !== null && budgetNum > allocatedINR
                const pct           = (budgetNum && allocatedINR) ? Math.round((budgetNum / allocatedINR) * 100) : 0
                const rowBase       = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                const rowExtra      = overAllocated ? "bg-red-50/30 border-l-4 border-l-red-500" : "border-l-4 border-l-transparent"
                // ── Shared cell render helpers (reused in both desktop and card) ──

                const subjectField = (
                  <input
                    type="text"
                    id={`desc-${row.id}`}
                    value={row.description}
                    onChange={e => updateRowMulti(row.id, { description: e.target.value })}
                    placeholder="Enter item name…"
                    className={cn(cellCtrl, "h-10", !row.description && cellCtrlRequired)}
                    aria-label={`Row ${idx + 1} subject (required)`}
                    aria-required="true"
                    aria-invalid={!row.description || undefined}
                  />
                )

                const rowPlant = getPlantForRole(currentRole) ?? "jhajjar_p1"

                const headField = (() => {
                  const plantItems = capexMaster.filter(m => m.plant === rowPlant)
                  const heads = Array.from(new Set(plantItems.map(m => m.head))).sort()
                  return (
                    <select
                      value={row.masterHead}
                      onChange={e => {
                        const prevItem = row.masterItemId
                          ? capexMaster.find(m => m.id === row.masterItemId)
                          : null
                        const prevBudgetStr = prevItem ? String(Math.round(prevItem.totalCost * CR_TO_INR)) : ""
                        updateRowMulti(row.id, {
                          masterHead: e.target.value,
                          masterItemId: "",
                          ...(row.description === prevItem?.subParticulars ? { description: "" } : {}),
                          ...(row.budget === prevBudgetStr ? { budget: "" } : {}),
                        })
                      }}
                      className={cn(cellCtrl, "h-10", !row.masterHead && "text-slate-500")}
                      aria-label={`Row ${idx + 1} CAPEX head`}
                    >
                      <option value="">Select…</option>
                      {heads.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  )
                })()

                const subParticularField = (() => {
                  const plantItems = capexMaster.filter(m => m.plant === rowPlant)
                  const subItems   = !row.masterHead ? [] : plantItems.filter(m => m.head === row.masterHead)
                  const isLocked   = !row.masterHead

                  const handleSubChange = (val: string) => {
                    if (!val) { updateRowMulti(row.id, { masterItemId: "" }); return }
                    const item = capexMaster.find(m => m.id === val)
                    if (!item) return
                    const updates: Partial<GridRow> = { masterItemId: val }
                    const prevItem = row.masterItemId
                      ? capexMaster.find(m => m.id === row.masterItemId)
                      : null
                    const prevBudgetStr = prevItem ? String(Math.round(prevItem.totalCost * CR_TO_INR)) : ""
                    if (!row.description || row.description === prevItem?.subParticulars)
                      updates.description = item.subParticulars
                    if (!row.budget || row.budget === prevBudgetStr)
                      updates.budget = String(Math.round(item.totalCost * CR_TO_INR))
                    updateRowMulti(row.id, updates)
                  }

                  return (
                    <div className="relative">
                      {isLocked && (
                        <div
                          className="absolute inset-0 z-10 flex items-center px-2.5 gap-1.5 rounded-md bg-slate-100 border border-slate-200 cursor-not-allowed pointer-events-none"
                          aria-hidden="true"
                        >
                          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          <span className="text-xs text-slate-400 truncate">Select a Head first</span>
                        </div>
                      )}
                      <select
                        value={row.masterItemId}
                        onChange={e => handleSubChange(e.target.value)}
                        disabled={isLocked}
                        className={cn(
                          cellCtrl, "h-10",
                          !row.masterItemId && "text-slate-500",
                          isLocked && "opacity-0"
                        )}
                        aria-label={`Row ${idx + 1} sub particular`}
                        aria-disabled={isLocked}
                        tabIndex={isLocked ? -1 : 0}
                      >
                        <option value="">Select…</option>
                        {subItems.map(item => (
                          <option key={item.id} value={item.id}>{item.subParticulars}</option>
                        ))}
                      </select>
                    </div>
                  )
                })()

                const categoryField = (
                  <select
                    value={row.category}
                    onChange={e => updateRow(row.id, "category", e.target.value)}
                    className={cn(cellCtrl, "h-10", !row.category && cn("text-slate-500", cellCtrlRequired))}
                    aria-label={`Row ${idx + 1} category (required)`}
                    aria-required="true"
                    aria-invalid={!row.category || undefined}
                  >
                    <option value="">Select…</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                )

                const qtyField = (
                  <input
                    type="text"
                    value={row.quantity}
                    onChange={e => updateRow(row.id, "quantity", e.target.value)}
                    placeholder="e.g. 2 units"
                    className={cn(cellCtrl, "h-10 text-right", !row.quantity && cellCtrlRequired)}
                    aria-label={`Row ${idx + 1} quantity (required)`}
                    aria-required="true"
                    aria-invalid={!row.quantity || undefined}
                  />
                )

                const budgetField = (
                  <div>
                    <div className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 h-10 transition-colors focus-within:ring-2 focus-within:ring-[#0D9488]",
                      overAllocated
                        ? "border-red-400 bg-red-50 focus-within:ring-red-500"
                        : "border-slate-200 bg-white"
                    )}>
                      <span className="text-xs font-semibold text-slate-400 shrink-0 select-none" aria-hidden="true">₹</span>
                      <input
                        type="number"
                        min={0}
                        value={row.budget}
                        onChange={e => updateRow(row.id, "budget", e.target.value)}
                        placeholder="0"
                        className={cn(
                          "flex-1 min-w-0 bg-transparent border-0 outline-none text-xs font-medium text-right placeholder:text-slate-300",
                          overAllocated ? "text-red-700" : "text-slate-900"
                        )}
                        aria-label={`Row ${idx + 1} estimated budget in rupees`}
                      />
                    </div>

                    {/* Budget allocation bar */}
                    {allocatedINR !== null && (
                      <div className="mt-2 space-y-1.5">
                        <div
                          role="progressbar"
                          aria-valuenow={Math.min(pct, 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Budget usage: ${pct}% of allocation`}
                          className="h-2 bg-slate-200 rounded-full overflow-hidden"
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              overAllocated ? "bg-red-500" : pct > 80 ? "bg-orange-500" : "bg-teal-500"
                            )}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <p className={cn(
                          "text-[12px] font-semibold flex items-center gap-1",
                          overAllocated ? "text-red-600" : "text-slate-500"
                        )}>
                          {overAllocated && (
                            <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                            </svg>
                          )}
                          {overAllocated ? "Exceeds allocation" : `${pct}% of`} {formatINR(allocatedINR)}
                        </p>
                      </div>
                    )}

                  </div>
                )

                const remarksField = (
                  <textarea
                    rows={2}
                    value={row.remarks}
                    onChange={e => updateRow(row.id, "remarks", e.target.value)}
                    placeholder="Share complete description…"
                    className={cn(cellCtrl, "resize-none leading-snug", !row.remarks && cellCtrlRequired)}
                    aria-label={`Row ${idx + 1} description (required)`}
                    aria-required="true"
                    aria-invalid={!row.remarks || undefined}
                  />
                )

                const attachmentField = (
                  <div>
                    {row.attachmentName ? (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs">
                        <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="truncate max-w-[100px] font-medium" title={row.attachmentName}>{row.attachmentName}</span>
                        <button
                          type="button"
                          onClick={() => updateRowMulti(row.id, { attachmentName: "", attachmentBase64: "" })}
                          aria-label={`Remove attachment for row ${idx + 1}`}
                          className="ml-auto text-teal-500 hover:text-red-600 transition-colors shrink-0"
                        >
                          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <label
                        className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 border border-slate-200 hover:border-[#14B8A6] hover:text-[#0D9488] hover:bg-[#CCFBF1] transition-colors w-full justify-center"
                        aria-label={`Upload document for row ${idx + 1}`}
                      >
                        <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                        </svg>
                        Attach
                        <input
                          type="file"
                          className="sr-only"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                          onChange={e => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            if (file.size > MAX_ATTACHMENT_BYTES) {
                              alert(`File too large. Maximum size is 500 KB.`)
                              e.target.value = ""
                              return
                            }
                            const reader = new FileReader()
                            reader.onload = ev => {
                              const base64 = (ev.target?.result as string).split(",")[1] ?? ""
                              updateRowMulti(row.id, { attachmentName: file.name, attachmentBase64: base64 })
                            }
                            reader.readAsDataURL(file)
                            e.target.value = ""
                          }}
                        />
                      </label>
                    )}
                  </div>
                )

                const deleteButton = (
                  <button
                    type="button"
                    onClick={() => deleteRow(row.id)}
                    disabled={rows.length <= 1}
                    aria-label={`Delete row ${idx + 1}`}
                    aria-disabled={rows.length <= 1}
                    tabIndex={rows.length <= 1 ? -1 : 0}
                    className={cn(
                      "w-10 h-10 rounded-md flex items-center justify-center transition-colors mx-auto",
                      rows.length > 1
                        ? "text-slate-400 hover:text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                        : "text-slate-200 cursor-not-allowed"
                    )}
                  >
                    <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )

                return (
                  <React.Fragment key={row.id}>
                    {/* ── DESKTOP row (lg+): single <tr> with all columns ── */}
                    <tr
                      key={`desktop-${row.id}`}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0 align-top group transition-colors hover:bg-[#EBF0FB]/40",
                        "hidden lg:table-row",
                        rowExtra, rowBase
                      )}
                      aria-label={`Line item ${idx + 1}${overAllocated ? " — over budget allocation" : ""}`}
                    >
                      {/* # */}
                      <td className="px-3 py-3 text-center border-r border-slate-200 bg-slate-100/60 group-hover:bg-[#EBF0FB]/40 w-10">
                        <span className="text-xs font-bold text-slate-500 select-none">{idx + 1}</span>
                      </td>
                      {/* Subject */}
                      <td className="px-3 py-3 border-r border-slate-200 min-w-[220px]">
                        {subjectField}
                      </td>
                      {/* Head */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[180px]">
                        {headField}
                      </td>
                      {/* Sub Particular */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[300px]">
                        {subParticularField}
                      </td>
                      {/* Category */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[140px]">
                        {categoryField}
                      </td>
                      {/* Qty — right-aligned numeric */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[90px]">
                        {qtyField}
                      </td>
                      {/* Est. Budget */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[180px]">
                        {budgetField}
                      </td>
                      {/* Document — 160px */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[160px]">
                        {attachmentField}
                      </td>
                      {/* Preferred Vendor — 200px */}
                      <td className="px-3 py-3 border-r border-slate-200 w-[200px]">
                        <VendorCell
                          row={row}
                          idx={idx}
                          vendors={vendors}
                          updateRow={updateRow}
                          updateRowMulti={updateRowMulti}
                        />
                      </td>
                      {/* Delete — 44px */}
                      <td className="px-2 py-3 w-[44px] text-center">
                        {deleteButton}
                      </td>
                    </tr>

                    {/* ── DESKTOP description sub-row (always visible) ── */}
                    <tr
                      className={cn(
                        "border-b border-slate-200 hidden lg:table-row",
                        idx % 2 === 0 ? "bg-[#F8FAFC]" : "bg-slate-50/80",
                        overAllocated ? "border-l-4 border-l-red-500" : "border-l-4 border-l-transparent"
                      )}
                    >
                      <td className="px-3 py-2 text-center border-r border-slate-100 bg-slate-100/40 w-10">
                        <span className="text-[10px] font-bold text-slate-300 select-none">↳</span>
                      </td>
                      <td colSpan={11} className="px-3 pb-3 pt-1">
                        {remarksField}
                      </td>
                    </tr>

                    {/* ── TABLET row (640–1023px): 2 sub-rows inside the same logical row ── */}
                    <tr
                      key={`tablet-${row.id}`}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0 align-top group transition-colors hover:bg-[#EBF0FB]/40",
                        "hidden sm:table-row lg:hidden",
                        rowExtra, rowBase
                      )}
                      aria-label={`Line item ${idx + 1}${overAllocated ? " — over budget allocation" : ""}`}
                    >
                      <td colSpan={12} className="px-3 py-3">
                        {/* Sub-row 1: # + Subject + Head + Sub Particular + Category */}
                        <div className="flex gap-3 mb-3 items-start">
                          <span className="text-xs font-bold text-slate-500 select-none w-6 shrink-0 pt-2.5 text-center">{idx + 1}</span>
                          <div className="flex-1 min-w-0">{subjectField}</div>
                          <div className="w-[160px] shrink-0">{headField}</div>
                          <div className="w-[220px] shrink-0">{subParticularField}</div>
                          <div className="w-[130px] shrink-0">{categoryField}</div>
                        </div>
                        {/* Sub-row 2: Qty + Budget + Document + Vendor + Delete */}
                        <div className="flex gap-3 items-start pl-9">
                          <div className="w-[90px] shrink-0">{qtyField}</div>
                          <div className="w-[160px] shrink-0">{budgetField}</div>
                          <div className="w-[140px] shrink-0">{attachmentField}</div>
                          <div className="flex-1 min-w-0">
                            <VendorCell
                              row={row}
                              idx={idx}
                              vendors={vendors}
                              updateRow={updateRow}
                              updateRowMulti={updateRowMulti}
                            />
                          </div>
                          <div className="shrink-0">{deleteButton}</div>
                        </div>
                        {/* Description — always visible */}
                        <div className="mt-3 pl-9">{remarksField}</div>
                      </td>
                    </tr>

                    {/* ── MOBILE card (< 640px): one card per row ── */}
                    <tr
                      key={`mobile-${row.id}`}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0",
                        "table-row sm:hidden",
                        overAllocated ? "border-l-4 border-l-red-500" : "border-l-4 border-l-transparent",
                        rowBase
                      )}
                    >
                      <td colSpan={12} className="p-3">
                        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                          {/* Card header */}
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
                            <span className="text-xs font-bold text-slate-500">Item {idx + 1}</span>
                            <div className="flex items-center gap-2">
                              {deleteButton}
                            </div>
                          </div>
                          {/* Card fields */}
                          <div className="p-3 grid grid-cols-1 gap-3">
                            <div>
                              <label className={fieldLabel}>
                                Subject <span className="text-red-500" aria-hidden="true">*</span>
                              </label>
                              {subjectField}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={fieldLabel}>Head</label>
                                {headField}
                              </div>
                              <div>
                                <label className={fieldLabel}>Category <span className="text-red-500" aria-hidden="true">*</span></label>
                                {categoryField}
                              </div>
                            </div>
                            <div>
                              <label className={fieldLabel}>Sub Particular</label>
                              {subParticularField}
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={fieldLabel}>Qty <span className="text-red-500" aria-hidden="true">*</span></label>
                                {qtyField}
                              </div>
                              <div>
                                <label className={fieldLabel}>Est. Budget</label>
                                {budgetField}
                              </div>
                            </div>
                            <div>
                              {remarksField}
                            </div>
                            <div>
                              <label className={fieldLabel}>Document</label>
                              {attachmentField}
                            </div>
                            <div>
                              <label className={fieldLabel}>Preferred Vendor</label>
                              <VendorCell
                                row={row}
                                idx={idx}
                                vendors={vendors}
                                updateRow={updateRow}
                                updateRowMulti={updateRowMulti}
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Action toolbar — fused to table bottom */}
        <div
          id="required-fields-note"
          className="bg-[#153f90] border-t border-[#153f90]/50 px-4 py-3 flex items-center justify-between shrink-0 flex-wrap gap-2"
        >
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-[#5EEAD4] border border-[#5EEAD4]/40 hover:bg-[#5EEAD4]/10 hover:border-[#5EEAD4] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Row
          </button>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[12px] text-slate-400 select-none">
              {rows.length} item{rows.length !== 1 ? "s" : ""}
              {" · "}
              <span className="text-red-400 font-bold" aria-hidden="true">*</span>
              <span className="sr-only">asterisk</span> required per row
            </span>

            {/*
              [A11Y] "Review Request" button:
              — When invalid: visible but clearly disabled (muted styling), NOT
                pointer-events-none (that breaks keyboard access + tooltip potential).
              — tabIndex remains 0 so keyboard users reach it and get the aria-disabled signal.
              — aria-describedby ties to a hint about what's missing.
            */}
            {!formValid && (
              <span id="submit-hint" className="sr-only">
                Fill in Subject, Category, Quantity, and Description for all rows to continue.
              </span>
            )}
            <button
              type="button"
              disabled={!formValid}
              onClick={!formValid ? undefined : () => setStep("review")}
              aria-disabled={!formValid}
              aria-describedby={!formValid ? "submit-hint" : undefined}
              className={cn(
                "inline-flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]",
                formValid
                  ? "bg-[#0D9488] hover:bg-[#115E59] text-white shadow-sm cursor-pointer"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              )}
            >
              Review Request
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  /* ─────────────────────────────────────────────────────────────
     STEP 2 — REVIEW
  ───────────────────────────────────────────────────────────── */
  if (step === "review") {
    return (
      <div className="py-6 px-6 flex flex-col gap-5 h-full">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Confirm Your Request</h1>
            <p className="text-sm text-slate-500 mt-1">
              Review all items below. Once submitted, requests are routed immediately to sourcing.
            </p>
          </div>
          <StepBar step="review" />
        </div>

        <div className="rounded-xl border border-slate-300 overflow-hidden shadow-sm flex-1 min-h-0 flex flex-col">
          <div
            className="overflow-auto flex-1"
            role="region"
            aria-label="Review line items"
          >
            <table className="w-full border-collapse text-sm" aria-label="Review table">
              <caption className="sr-only">Review of CAPEX request items before submission.</caption>
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#153f90] text-white text-xs font-semibold uppercase tracking-wider">
                  <th scope="col" className="px-3 py-3 text-center w-10 border-r border-slate-700">#</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Item Description</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Category</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Qty</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Budget</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Plant</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Assigned To</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Description</th>
                  <th scope="col" className="px-3 py-3 text-left border-r border-slate-700">Document</th>
                  <th scope="col" className="px-3 py-3 text-left">Preferred Vendor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const budgetNum    = row.budget ? Number(row.budget) : undefined
                  const allocatedINR = getAllocatedINR(row)
                  const overAllocated = budgetNum !== undefined && allocatedINR !== null && budgetNum > allocatedINR
                  const engineer     = SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length]
                  const resolvedPlant = getPlantForRole(currentRole) ?? "jhajjar_p1"
                  const plantLabel   = PLANTS.find(p => p.value === resolvedPlant)?.label ?? resolvedPlant

                  let vendorDisplay: React.ReactNode = <span className="text-slate-400">—</span>
                  if (row.vendorMode === "existing" && row.vendorId) {
                    const v = vendors.find(v => v.id === row.vendorId)
                    vendorDisplay = <span className="font-medium text-slate-800">{v?.vendorName ?? row.vendorId}</span>
                  } else if (row.vendorMode === "suggest_new" && row.vendorRecName) {
                    vendorDisplay = (
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[#0D9488]">{row.vendorRecName}</span>
                          <span className="text-[10px] bg-[#CCFBF1] text-[#115E59] px-1.5 py-0.5 rounded font-bold border border-[#5EEAD4]">NEW</span>
                        </div>
                        {(row.vendorCode || row.vendorSpocName || row.vendorContact) && (
                          <p className="text-xs text-slate-500 mt-0.5 space-x-1.5">
                            {row.vendorCode && <span>Code: {row.vendorCode}</span>}
                            {row.vendorSpocName && <span>· SPOC: {row.vendorSpocName}</span>}
                            {row.vendorContact && <span>· {row.vendorContact}</span>}
                          </p>
                        )}
                      </div>
                    )
                  }

                  const rowBg = overAllocated
                    ? "bg-red-50/40 border-l-4 border-l-red-500"
                    : idx % 2 === 0
                      ? "bg-white border-l-4 border-l-transparent"
                      : "bg-slate-50/60 border-l-4 border-l-transparent"

                  return (
                    <tr
                      key={row.id}
                      className={cn("border-b border-slate-200 last:border-b-0 align-top", rowBg)}
                      aria-label={`Item ${idx + 1}${overAllocated ? " — exceeds budget allocation" : ""}`}
                    >
                      <td className="px-3 py-3 text-center border-r border-slate-200 bg-slate-100/60">
                        <span className="text-xs font-bold text-slate-500">{idx + 1}</span>
                      </td>
                      <td className="px-3 py-3 border-r border-slate-200">
                        <span className="font-semibold text-slate-900">{row.description}</span>
                        {row.masterHead && (
                          <p className="text-xs text-slate-400 mt-0.5">{row.masterHead}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-700 border-r border-slate-200">{row.category}</td>
                      <td className="px-3 py-3 text-slate-700 border-r border-slate-200 whitespace-nowrap">{row.quantity}</td>

                      {/* Budget with over-allocation callout */}
                      <td className="px-3 py-3 border-r border-slate-200">
                        {budgetNum ? (
                          <div>
                            <span className={cn("font-semibold text-base", overAllocated ? "text-red-600" : "text-slate-900")}>
                              {formatINR(budgetNum)}
                            </span>
                            {overAllocated && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 border border-red-300 px-1.5 py-0.5 rounded-full">
                                <svg aria-hidden="true" className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                </svg>
                                Over allocation
                              </span>
                            )}
                            {allocatedINR !== null && (
                              <p className="text-xs text-slate-400 mt-0.5">of {formatINR(allocatedINR)} allocated</p>
                            )}
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </td>

                      <td className="px-3 py-3 text-slate-700 border-r border-slate-200 whitespace-nowrap">{plantLabel}</td>

                      <td className="px-3 py-3 text-slate-700 border-r border-slate-200 whitespace-nowrap text-sm">{engineer.name}</td>
                      <td className="px-3 py-3 text-slate-600 border-r border-slate-200 text-xs">
                        {row.remarks || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-3 border-r border-slate-200">
                        {row.attachmentName ? (
                          <div className="flex items-center gap-1.5 text-xs text-teal-700">
                            <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                            <span className="font-medium truncate max-w-[120px]" title={row.attachmentName}>{row.attachmentName}</span>
                          </div>
                        ) : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="px-3 py-3">{vendorDisplay}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-[#153f90] border-t border-[#153f90]/50 px-5 py-3 flex items-center justify-between shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep("form")}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold text-white/80 border border-white/20 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Edit Details
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center gap-2 px-6 py-2 rounded-lg text-[13px] font-bold bg-[#0D9488] hover:bg-[#115E59] text-white shadow-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
            >
              Submit Request ({rows.length} item{rows.length !== 1 ? "s" : ""})
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ─────────────────────────────────────────────────────────────
     STEP 3 — SENT
  ───────────────────────────────────────────────────────────── */
  const createdBy = ROLE_NAMES[currentRole] ?? currentRole
  const engineer  = SOURCING_ENGINEERS[0]
  const today     = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <StepBar step="sent" />

      {/*
        [A11Y] role="status" announces the success message to screen readers
        without requiring focus. aria-live="polite" is implied by role="status".
      */}
      <div
        role="status"
        className="mt-8 mb-6 flex items-start gap-4"
      >
        <div
          className="w-12 h-12 rounded-full bg-green-100 border-2 border-green-300 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <svg className="w-6 h-6 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Request Submitted ({rows.length} item{rows.length !== 1 ? "s" : ""})
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Routed to the sourcing team. A confirmation email has been sent.
          </p>
        </div>
      </div>

      {/* Email preview */}
      <div className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white">
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-2.5 flex items-center gap-2">
          <svg aria-hidden="true" className="w-4 h-4 text-[#0D9488]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email Preview</span>
        </div>

        <div className="px-5 py-4 border-b border-slate-100 space-y-1.5 text-sm">
          {[
            { label: "To",      value: `${engineer.name} <sourcing@amberenterprises.in>` },
            { label: "From",    value: `${createdBy} <procurement@amberenterprises.in>` },
            { label: "Subject", value: `CAPEX Request — ${rows.length} item${rows.length !== 1 ? "s" : ""} submitted [${today}]` },
          ].map(({ label, value }) => (
            <div key={label} className="flex gap-2">
              <span className="text-slate-400 w-16 shrink-0 text-xs">{label}:</span>
              <span className="font-medium text-slate-800">{value}</span>
            </div>
          ))}
        </div>

        <div className="px-5 py-5 text-sm text-slate-700 space-y-4">
          <p>Dear {engineer.name},</p>
          <p>
            A new CAPEX request was submitted by <strong>{createdBy}</strong> and assigned to you for sourcing.
            Please review and initiate vendor outreach at the earliest.
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[#153f90] text-white">
                  {["#", "Item", "Category", "Qty", "Budget", "Plant"].map(h => (
                    <th key={h} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const budgetNum     = row.budget ? Number(row.budget) : undefined
                  const resolvedPlant = getPlantForRole(currentRole) ?? "jhajjar_p1"
                  const pLabel        = PLANTS.find(p => p.value === resolvedPlant)?.label ?? resolvedPlant
                  return (
                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.description}</td>
                      <td className="px-3 py-2 text-slate-600">{row.category}</td>
                      <td className="px-3 py-2 text-slate-600">{row.quantity}</td>
                      <td className="px-3 py-2 text-slate-600">{budgetNum ? formatINR(budgetNum) : "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{pLabel}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-slate-400 text-xs">Automated notification — Amber Enterprises CAPEX Portal</p>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => router.push("/capex/requests")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold bg-[#153f90] hover:bg-[#1a4da8] text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#153f90]"
        >
          View All Requests
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
