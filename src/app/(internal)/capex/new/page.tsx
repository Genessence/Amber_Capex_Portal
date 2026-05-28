"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCapex } from "@/lib/capexContext"
import { initialStatusForRequest } from "@/lib/capexContext"
import type { CapexRequest } from "@/lib/types"
import { HEAD_APPROVAL_THRESHOLD } from "@/lib/types"
import { ROLE_NAMES, SOURCING_ENGINEERS, PLANTS } from "@/lib/constants"
import { cn } from "@/lib/utils"

/* ── Types ───────────────────────────────────────────────────── */
interface GridRow {
  id: string
  description: string
  category: string
  quantity: string
  budget: string
  plant: string
  priority: "low" | "medium" | "high" | "critical" | ""
  compliance: string
}

function emptyRow(): GridRow {
  return {
    id: crypto.randomUUID(),
    description: "",
    category: "",
    quantity: "",
    budget: "",
    plant: "",
    priority: "",
    compliance: "",
  }
}

function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

/* ── Step indicator ──────────────────────────────────────────── */
function StepBar({ step }: { step: "form" | "review" | "sent" }) {
  const steps = [
    { key: "form",   label: "Fill Details", num: 1 },
    { key: "review", label: "Review",        num: 2 },
    { key: "sent",   label: "Submitted",     num: 3 },
  ] as const
  const activeIdx = steps.findIndex(s => s.key === step)

  return (
    <nav aria-label="Form progress" className="flex items-center gap-0 mb-8">
      {steps.map((s, idx) => {
        const done    = idx < activeIdx
        const active  = idx === activeIdx
        const pending = idx > activeIdx
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                aria-current={active ? "step" : undefined}
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0 transition-colors",
                  done    && "bg-amber-400 text-slate-900",
                  active  && "bg-slate-900 text-white ring-2 ring-offset-2 ring-slate-900",
                  pending && "bg-slate-300 text-slate-600"
                )}
              >
                {done ? (
                  <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : s.num}
              </div>
              <span className={cn(
                "text-[12px] font-semibold hidden sm:block",
                active  && "text-slate-900",
                done    && "text-amber-600",
                pending && "text-slate-600"
              )}>
                {s.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn(
                "h-px w-8 sm:w-12 mx-2 transition-colors",
                idx < activeIdx ? "bg-amber-400" : "bg-slate-200"
              )} />
            )}
          </div>
        )
      })}
    </nav>
  )
}

/* ── Shared cell input classes ───────────────────────────────── */
const cellInput = "w-full bg-transparent border-0 outline-none text-[13px] font-medium text-slate-900 placeholder:text-slate-300 focus:ring-1 focus:ring-amber-400/50 rounded px-1 py-0.5"
const cellSelect = "w-full bg-transparent border-0 outline-none text-[13px] font-medium text-slate-900 focus:ring-1 focus:ring-amber-400/50 rounded px-1 py-0.5 cursor-pointer"

/* ── Page ────────────────────────────────────────────────────── */
export default function NewCapexPage() {
  const router         = useRouter()
  const { addRequest, categories: ctxCategories } = useCapex()
  const [step, setStep] = useState<"form" | "review" | "sent">("form")
  const [currentRole, setCurrentRole] = useState("buyer")

  // Grid rows state
  const [rows, setRows] = useState<GridRow[]>([emptyRow()])

  // Submitted IDs for the "sent" screen
  const [submittedIds, setSubmittedIds] = useState<string[]>([])

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
  }, [])

  const categories = ctxCategories?.length
    ? ctxCategories
    : ["Machinery", "Infrastructure", "IT", "Tooling"]

  /* ── Row helpers ────────────────────────────────────────────── */
  function updateRow(id: string, field: keyof GridRow, value: string) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  function addRow() {
    setRows(prev => [...prev, emptyRow()])
  }

  function deleteRow(id: string) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter(r => r.id !== id))
  }

  /* ── Validation ─────────────────────────────────────────────── */
  const formValid = rows.every(r => r.description.trim() && r.category && r.quantity.trim())

  /* ── Submit all rows ─────────────────────────────────────────── */
  function handleSubmit() {
    const createdBy = ROLE_NAMES[currentRole] ?? currentRole
    const ids: string[] = []

    rows.forEach((row, idx) => {
      const budgetNum = row.budget ? Number(row.budget) : undefined
      const assignedTo = SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length].value
      const plant = row.plant || "jhajjar"
      const reqId = `REQ-${crypto.randomUUID()}`

      const req: CapexRequest = {
        id:            reqId,
        subject:       row.description,
        category:      row.category,
        quantity:      row.quantity,
        budget:        budgetNum,
        priority:      (row.priority || "medium") as CapexRequest["priority"],
        justification: "",
        techSpecs:     { specifications: "", complianceStandards: row.compliance },
        assignedTo,
        status:        initialStatusForRequest(budgetNum),
        createdBy,
        createdAt:     new Date().toISOString(),
        plant,
      }

      addRequest(req)
      ids.push(reqId)
    })

    setSubmittedIds(ids)
    setStep("sent")
  }

  /* ── FORM ─────────────────────────────────────────────────── */
  if (step === "form") return (
    <div className="py-8 px-6">
      <StepBar step="form" />

      <div className="mb-6">
        <p className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1" aria-hidden="true">
          Step 1 of 3
        </p>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-snug">
          Capital Expenditure Request
        </h1>
        <p className="text-[13px] text-slate-700 mt-1.5">
          Enter each line item below. You can add multiple items and review everything before submitting.
        </p>
      </div>

      {/* Grid */}
      <div className="rounded-2xl border border-slate-400 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wide">
                <th className="px-3 py-3 text-center w-10 font-semibold">#</th>
                <th className="px-3 py-3 text-left min-w-[200px] font-semibold">Item Description <span className="text-amber-400">*</span></th>
                <th className="px-3 py-3 text-left w-36 font-semibold">Category <span className="text-amber-400">*</span></th>
                <th className="px-3 py-3 text-left w-28 font-semibold">Quantity <span className="text-amber-400">*</span></th>
                <th className="px-3 py-3 text-left w-36 font-semibold">Est. Budget (₹)</th>
                <th className="px-3 py-3 text-left w-36 font-semibold">Plant</th>
                <th className="px-3 py-3 text-left w-28 font-semibold">Priority</th>
                <th className="px-3 py-3 text-left min-w-[140px] font-semibold">Compliance / Cert</th>
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const budgetNum = row.budget ? Number(row.budget) : undefined
                const overThreshold = budgetNum !== undefined && budgetNum > HEAD_APPROVAL_THRESHOLD
                const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-100"
                return (
                  <tr key={row.id} className={cn("border-b border-slate-300 last:border-b-0 group", rowBg)}>
                    {/* # */}
                    <td className="px-3 py-2 text-center text-[12px] font-bold text-slate-800 select-none">
                      {idx + 1}
                    </td>

                    {/* Item Description */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={row.description}
                        onChange={e => updateRow(row.id, "description", e.target.value)}
                        placeholder="e.g. CNC Machining Center"
                        className={cellInput}
                        aria-label={`Row ${idx + 1} item description`}
                      />
                    </td>

                    {/* Category */}
                    <td className="px-2 py-1.5">
                      <select
                        value={row.category}
                        onChange={e => updateRow(row.id, "category", e.target.value)}
                        className={cn(cellSelect, !row.category && "text-slate-600")}
                        aria-label={`Row ${idx + 1} category`}
                      >
                        <option value="">Select…</option>
                        {categories.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </td>

                    {/* Quantity */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={row.quantity}
                        onChange={e => updateRow(row.id, "quantity", e.target.value)}
                        placeholder="e.g. 2 units"
                        className={cellInput}
                        aria-label={`Row ${idx + 1} quantity`}
                      />
                    </td>

                    {/* Est. Budget */}
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-0.5">
                        <span className="text-[12px] text-slate-800 font-semibold shrink-0 select-none">₹</span>
                        <input
                          type="number"
                          min={0}
                          value={row.budget}
                          onChange={e => updateRow(row.id, "budget", e.target.value)}
                          placeholder="0"
                          className={cn(cellInput, "pl-0.5")}
                          aria-label={`Row ${idx + 1} estimated budget`}
                        />
                      </div>
                      {overThreshold && (
                        <div className="flex items-center gap-1 mt-1">
                          <svg aria-hidden="true" className="w-3 h-3 text-orange-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                          </svg>
                          <span className="text-[10px] text-orange-600 font-medium leading-tight">
                            Head approval required
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Plant */}
                    <td className="px-2 py-1.5">
                      <select
                        value={row.plant}
                        onChange={e => updateRow(row.id, "plant", e.target.value)}
                        className={cn(cellSelect, !row.plant && "text-slate-600")}
                        aria-label={`Row ${idx + 1} plant`}
                      >
                        <option value="">Default</option>
                        {PLANTS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </td>

                    {/* Priority */}
                    <td className="px-2 py-1.5">
                      <select
                        value={row.priority}
                        onChange={e => updateRow(row.id, "priority", e.target.value as GridRow["priority"])}
                        className={cn(cellSelect, !row.priority && "text-slate-600")}
                        aria-label={`Row ${idx + 1} priority`}
                      >
                        <option value="">Default</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </select>
                    </td>

                    {/* Compliance */}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={row.compliance}
                        onChange={e => updateRow(row.id, "compliance", e.target.value)}
                        placeholder="e.g. ISO 9001"
                        className={cellInput}
                        aria-label={`Row ${idx + 1} compliance`}
                      />
                    </td>

                    {/* Delete */}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => deleteRow(row.id)}
                        disabled={rows.length <= 1}
                        aria-label={`Delete row ${idx + 1}`}
                        className={cn(
                          "w-6 h-6 rounded flex items-center justify-center text-[13px] transition-colors",
                          rows.length > 1
                            ? "text-red-500 hover:text-red-700 hover:bg-red-100"
                            : "text-slate-200 cursor-not-allowed"
                        )}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Table footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold text-amber-600 border border-amber-300 bg-white hover:bg-amber-50 hover:border-amber-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Row
          </button>

          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={!formValid}
              onClick={() => setStep("review")}
              aria-disabled={!formValid}
              className={cn(
                "inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-[13px] font-semibold transition-all",
                formValid
                  ? "bg-slate-900 hover:bg-slate-700 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed pointer-events-none"
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

      <p className="text-[11px] text-slate-600 mt-3">
        <span className="text-amber-500 font-bold">*</span> Required per row. Plant, Priority and Compliance are optional.
      </p>
    </div>
  )

  /* ── REVIEW ───────────────────────────────────────────────── */
  if (step === "review") {
    return (
      <div className="max-w-4xl mx-auto py-8 px-4">
        <StepBar step="review" />

        <div className="mb-6">
          <p className="text-[11px] font-bold text-amber-500 uppercase tracking-widest mb-1" aria-hidden="true">
            Step 2 of 3
          </p>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-snug">
            Confirm Your Request
          </h1>
          <p className="text-[13px] text-slate-700 mt-1.5">
            Review carefully — once submitted these requests will be routed immediately.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-400 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-3 text-center w-10 font-semibold">#</th>
                  <th className="px-3 py-3 text-left font-semibold">Item Description</th>
                  <th className="px-3 py-3 text-left font-semibold">Category</th>
                  <th className="px-3 py-3 text-left font-semibold">Qty</th>
                  <th className="px-3 py-3 text-left font-semibold">Est. Budget</th>
                  <th className="px-3 py-3 text-left font-semibold">Plant</th>
                  <th className="px-3 py-3 text-left font-semibold">Priority</th>
                  <th className="px-3 py-3 text-left font-semibold">Assigned To</th>
                  <th className="px-3 py-3 text-left font-semibold">Compliance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const budgetNum = row.budget ? Number(row.budget) : undefined
                  const overThreshold = budgetNum !== undefined && budgetNum > HEAD_APPROVAL_THRESHOLD
                  const engineer = SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length]
                  const plantLabel = (PLANTS.find(p => p.value === (row.plant || "jhajjar"))?.label ?? row.plant) || "Jhajjar"
                  const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-100"
                  return (
                    <tr key={row.id} className={cn("border-b border-slate-300 last:border-b-0", rowBg)}>
                      <td className="px-3 py-2.5 text-center text-[12px] font-bold text-slate-800">{idx + 1}</td>
                      <td className="px-3 py-2.5 text-[13px] font-semibold text-slate-800">{row.description}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{row.category}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{row.quantity}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">
                        {budgetNum ? formatINR(budgetNum) : <span className="text-slate-400">—</span>}
                        {overThreshold && (
                          <span className="ml-1.5 text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            Head approval
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{plantLabel}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700 capitalize">{row.priority || "medium"}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{engineer.name}</td>
                      <td className="px-3 py-2.5 text-[13px] text-slate-700">{row.compliance || <span className="text-slate-400">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 py-4 border-t border-slate-300 bg-slate-50">
            <button
              type="button"
              onClick={() => setStep("form")}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400"
            >
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Edit Details
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              className="inline-flex items-center justify-center gap-2 px-7 py-2.5 rounded-xl text-[13px] font-semibold bg-amber-400 hover:bg-amber-300 text-slate-900 shadow-sm shadow-amber-200/80 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-amber-400"
            >
              Submit {rows.length} Request{rows.length !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── SENT ─────────────────────────────────────────────────── */
  const createdBy = ROLE_NAMES[currentRole] ?? currentRole
  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <StepBar step="sent" />

      {/* Success header */}
      <div className="mb-6 flex items-start gap-4">
        <div
          role="img"
          aria-label="Requests submitted successfully"
          className="w-11 h-11 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5"
        >
          <svg aria-hidden="true" className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 leading-snug">
            {submittedIds.length} Request{submittedIds.length !== 1 ? "s" : ""} Submitted
          </h1>
          <p className="text-[13px] text-slate-700 mt-1">
            Each item has been assigned to a sourcing engineer and routed for action.
          </p>
        </div>
      </div>

      {/* Summary card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-3">
          <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Submitted Items</p>
        </div>
        <ul className="divide-y divide-slate-300">
          {rows.map((row, idx) => {
            const engineer = SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length]
            const budgetNum = row.budget ? Number(row.budget) : undefined
            const overThreshold = budgetNum !== undefined && budgetNum > HEAD_APPROVAL_THRESHOLD
            return (
              <li key={row.id} className="px-5 py-3.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-800 truncate">{row.description}</p>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    {row.category} · {row.quantity}
                    {budgetNum ? ` · ${formatINR(budgetNum)}` : ""}
                    {overThreshold && (
                      <span className="ml-1.5 text-orange-600 font-medium">— Head approval required</span>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[12px] font-semibold text-slate-700">{engineer.name}</p>
                  <p className="text-[11px] text-slate-400">{engineer.area}</p>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="bg-slate-50 border-t border-slate-300 px-5 py-3.5">
          <p className="text-[12px] text-slate-600 leading-relaxed">
            Submitted by <span className="font-semibold text-slate-800">{createdBy}</span> · {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() => router.push("/capex/requests")}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold bg-slate-900 hover:bg-slate-700 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-900"
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
