"use client"

import React, { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { useCapex } from "@/lib/capexContext"
import { initialStatusForRequest } from "@/lib/capexContext"
import type { CapexRequest, CapexLineItem, FieldType, ProjectType, Vendor, PlantMeta } from "@/lib/types"
import {
  buildInvitesFromQuoteRows,
  emptyQuoteRow,
  findMixedCurrencyVendors,
  getLowestQuoteAmountForLine,
  getQuoteAllocationStatus,
  getQuotesForLine,
  isQuoteRowComplete,
  isQuoteRowEmpty,
  type RequestQuoteRow,
  validateQuoteRows,
  validateQuotesPerLine,
} from "@/lib/requestQuoteUtils"
import { FIELD_TYPE_LABELS } from "@/lib/types"
import { ROLE_NAMES, SOURCING_ENGINEERS, PLANTS, getPlantForRole } from "@/lib/constants"
import {
  BROWN_FIELD_HEAD_ORDER,
  defaultDivisionForFieldType,
  defaultHeadForGreenFieldSection,
  FLAT_MASTER_DIVISION,
  filterMasterItemsForRequest,
  getFieldDivisionHeads,
  getGreenFieldHeadBudgetCr,
  getGreenFieldSectionBudgetCr,
  getHeadBudgetSummaries,
  getLatestMasterFy,
  getLatestMasterFyForField,
  getOrderedHeadsForScope,
  greenFieldBudgetStatus,
  GREEN_FIELD_SECTION_ORDER,
  isProjectTypeScopedField,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  sumGreenFieldHeadBudgetsForSection,
  type GreenFieldSection,
} from "@/lib/greenFieldConstants"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ArrowLeftRight } from "lucide-react"

/* ── Types ───────────────────────────────────────────────────── */

interface GridRow {
  id: string
  masterHead: string
  masterItemId: string
  machineCapacity: string
  description: string
  quantity: string
  remarks: string
  // Brown Field: buyer provides a preferred vendor instead of quotations (the spec is the
  // Description/remarks field above; budget derives from the linked master allocation).
  prefVendorId: string
  prefVendorReason: string
}

function emptyRow(): GridRow {
  return {
    id: crypto.randomUUID(),
    masterHead: "",
    masterItemId: "",
    machineCapacity: "",
    description: "",
    quantity: "",
    remarks: "",
    prefVendorId: "",
    prefVendorReason: "",
  }
}

function formatINR(n: number) {
  return "₹" + n.toLocaleString("en-IN")
}

const CR_TO_INR = 10_000_000

const PRIORITY_DOT: Record<string, string> = {
  low:      "bg-slate-400",
  medium:   "bg-blue-500",
  high:     "bg-slate-500",
  critical: "bg-red-600",
}

const PRIORITY_TEXT: Record<string, string> = {
  low:      "text-slate-500",
  medium:   "text-blue-600",
  high:     "text-slate-600",
  critical: "text-red-600 font-bold",
}

/* ── Shared cell control classes ─────────────────────────────── */
// Base cell control — 14px minimum for tablet readability (not 13px).
// Focus ring uses teal for ≥3:1 contrast on white at outline offset.
const cellCtrl =
  "w-full text-xs text-foreground bg-card border border-border rounded-md px-2 py-1.5 " +
  "focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary " +
  "placeholder:text-muted-foreground transition-colors"

// Error state: red border + light red bg. Text remains slate-900 for contrast.
const cellCtrlError = "border-red-400 bg-red-50 focus:ring-red-500 focus:border-red-500"

// Required but empty: blue-tinted to signal "needs input" without screaming error.
const cellCtrlRequired = "border-primary/40 bg-accent/50 focus:ring-ring focus:border-primary"

// Sub-field labels inside quote expand panel
const fieldLabel = "block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1"

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
                  done    && "bg-primary text-primary-foreground",
                  active  && "bg-foreground text-background ring-2 ring-offset-2 ring-foreground",
                  pending && "bg-muted text-muted-foreground"
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
                active  && "text-foreground",
                done    && "text-primary",
                pending && "text-muted-foreground"
              )}>{s.label}</span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn(
                "h-0.5 w-8 sm:w-14 mx-2 transition-colors",
                idx < activeIdx ? "bg-primary" : "bg-border"
              )} />
            )}
          </div>
        )
      })}
    </nav>
  )
}

/* ── Wizard navigation helpers ───────────────────────────────── */
function WizardBackButton({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} className="gap-1.5 shadow-xs">
      <ChevronLeft className="w-4 h-4" />
      {label}
    </Button>
  )
}

function WizardChangeButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick} className="gap-1.5">
      <ArrowLeftRight className="w-3.5 h-3.5" />
      {label}
    </Button>
  )
}

function FieldTypeBadge({ fieldType }: { fieldType: FieldType }) {
  const styles: Record<FieldType, string> = {
    green_field: "bg-slate-50 text-slate-800 border-slate-200",
    brown_field: "bg-secondary text-secondary-foreground border-border",
    digitisation: "bg-blue-50 text-blue-800 border-blue-200",
    information_technology: "bg-slate-50 text-slate-800 border-slate-200",
  }
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border",
      styles[fieldType],
    )}>
      {FIELD_TYPE_LABELS[fieldType]}
    </span>
  )
}

function DivisionBadge({ division }: { division: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground border border-primary/15">
      {division}
    </span>
  )
}

function ProjectTypeBadge({ projectType }: { projectType: ProjectType }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-800 border border-slate-200">
      {PROJECT_TYPE_LABELS[projectType]}
    </span>
  )
}

function AmberHeader() {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#1D4ED8] text-white border border-[#1D4ED8]">
      Amber
    </span>
  )
}

function HeadBadge({ head }: { head: string }) {
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-card text-foreground border border-border">
      {head}
    </span>
  )
}

function WizardActionBar({
  onBack,
  backLabel = "Back",
  children,
}: {
  onBack: () => void
  backLabel?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <WizardBackButton onClick={onBack} label={backLabel} />
      {children ? (
        <div className="flex items-center gap-2 flex-wrap">{children}</div>
      ) : null}
    </div>
  )
}

const selectionCardBase =
  "text-left rounded-xl border-2 border-border bg-card p-5 shadow-xs hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"


const MAX_ATTACHMENT_BYTES = 500 * 1024

const CURRENCY_OPTIONS = ["INR", "USD", "EUR"] as const

function QuoteAllocationChip({
  amount,
  allocatedINR,
}: {
  amount: number
  allocatedINR: number | null
}) {
  const status = getQuoteAllocationStatus(amount, allocatedINR)
  if (!status) return null
  if (status.over) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 border border-red-300 px-2 py-0.5 rounded-full">
        {formatINR(status.delta)} over allocation
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
      {formatINR(status.delta)} under allocation
    </span>
  )
}

/* ── Per-line quote section (collapsed under each row) ───────── */
function LineQuoteSection({
  lineRowId,
  lineIndex,
  quotes,
  vendors,
  allocatedINR,
  expanded,
  mixedCurrencyVendorIds,
  onToggle,
  onAddQuote,
  onUpdate,
  onUpdateMulti,
  onRemove,
}: {
  lineRowId: string
  lineIndex: number
  quotes: RequestQuoteRow[]
  vendors: Vendor[]
  allocatedINR: number | null
  expanded: boolean
  mixedCurrencyVendorIds: string[]
  onToggle: () => void
  onAddQuote: () => void
  onUpdate: (id: string, field: keyof RequestQuoteRow, value: string) => void
  onUpdateMulti: (id: string, updates: Partial<RequestQuoteRow>) => void
  onRemove: (id: string) => void
}) {
  const completeCount = quotes.filter(isQuoteRowComplete).length
  const needsQuote = completeCount === 0

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-xs font-semibold text-foreground hover:text-primary transition-colors"
          aria-expanded={expanded}
        >
          <svg
            aria-hidden="true"
            className={cn("w-3.5 h-3.5 transition-transform", expanded && "rotate-90")}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          Vendor Quotes ({completeCount})
          {needsQuote && (
            <span className="text-red-600 font-bold normal-case">— at least 1 required</span>
          )}
        </button>
        <Button type="button" variant="outline" size="sm" onClick={onAddQuote} className="h-7 text-xs gap-1">
          Add Quote
        </Button>
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          {quotes.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">
              No quotes yet. Add at least one vendor quote for this line item.
            </p>
          ) : (
            quotes.map((qr, qIdx) => {
              const incomplete = !isQuoteRowEmpty(qr) && !isQuoteRowComplete(qr)
              const currencyConflict = mixedCurrencyVendorIds.includes(qr.vendorId)
              const amount = qr.expectedAmount ? Number(qr.expectedAmount) : NaN
              return (
                <div
                  key={qr.id}
                  className={cn(
                    "rounded-md border border-border bg-card p-3 space-y-3",
                    incomplete && "border-red-300 bg-red-50/30",
                    currencyConflict && "ring-1 ring-slate-300",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Quote {qIdx + 1}
                      {incomplete && <span className="ml-2 text-red-600 normal-case">— incomplete</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemove(qr.id)}
                      className="text-xs font-semibold text-muted-foreground hover:text-red-600"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className={fieldLabel} htmlFor={`qq-vendor-${qr.id}`}>Vendor</label>
                      <select
                        id={`qq-vendor-${qr.id}`}
                        value={qr.vendorId}
                        onChange={e => onUpdate(qr.id, "vendorId", e.target.value)}
                        className={cn(cellCtrl, "h-10", !qr.vendorId && incomplete && cellCtrlRequired)}
                      >
                        <option value="">Select vendor…</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.vendorName}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className={fieldLabel} htmlFor={`qq-amt-${qr.id}`}>Est. Budget (Total)</label>
                      <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 h-10 bg-card focus-within:ring-2 focus-within:ring-ring">
                        <span className="text-xs font-semibold text-muted-foreground shrink-0">₹</span>
                        <input
                          id={`qq-amt-${qr.id}`}
                          type="number"
                          min={0}
                          value={qr.expectedAmount}
                          onChange={e => onUpdate(qr.id, "expectedAmount", e.target.value)}
                          placeholder="Total for qty"
                          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-xs text-right"
                        />
                      </div>
                      {Number.isFinite(amount) && amount > 0 && (
                        <div className="mt-1">
                          <QuoteAllocationChip amount={amount} allocatedINR={allocatedINR} />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className={fieldLabel} htmlFor={`qq-cur-${qr.id}`}>Currency</label>
                      <select
                        id={`qq-cur-${qr.id}`}
                        value={qr.currency}
                        onChange={e => onUpdate(qr.id, "currency", e.target.value)}
                        className={cn(cellCtrl, "h-10")}
                      >
                        {CURRENCY_OPTIONS.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {currencyConflict && (
                        <p className="text-[11px] text-slate-700 mt-1">Same vendor must use one currency.</p>
                      )}
                    </div>

                    <div>
                      <label className={fieldLabel}>Document</label>
                      {qr.attachmentName ? (
                        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                          <span className="truncate font-medium" title={qr.attachmentName}>{qr.attachmentName}</span>
                          <button
                            type="button"
                            onClick={() => onUpdateMulti(qr.id, { attachmentName: "", attachmentBase64: "" })}
                            className="ml-auto text-blue-500 hover:text-red-600 shrink-0"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <label className="cursor-pointer inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 border border-slate-200 hover:border-primary hover:text-primary transition-colors w-full justify-center">
                          Attach
                          <input
                            type="file"
                            className="sr-only"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              if (file.size > MAX_ATTACHMENT_BYTES) {
                                alert("File too large. Maximum size is 500 KB.")
                                e.target.value = ""
                                return
                              }
                              const reader = new FileReader()
                              reader.onload = ev => {
                                const base64 = (ev.target?.result as string).split(",")[1] ?? ""
                                onUpdateMulti(qr.id, { attachmentName: file.name, attachmentBase64: base64 })
                              }
                              reader.readAsDataURL(file)
                              e.target.value = ""
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {[
                      { id: "freight", label: "Transportation / Freight", field: "freight" as const, placeholder: "Freight" },
                      { id: "service", label: "Service / Installation", field: "service" as const, placeholder: "Service" },
                      { id: "packing", label: "Packing / Forwarding", field: "packing" as const, placeholder: "Packing" },
                      { id: "delivery", label: "Delivery Lead Time (Weeks)", field: "deliveryWeeks" as const, placeholder: "Weeks" },
                      { id: "warranty", label: "Warranty (Years)", field: "warrantyYears" as const, placeholder: "Years" },
                    ].map(({ id, label, field, placeholder }) => (
                      <div key={id}>
                        <label className={fieldLabel} htmlFor={`qq-${id}-${qr.id}`}>{label}</label>
                        <input
                          id={`qq-${id}-${qr.id}`}
                          type="number"
                          min={0}
                          value={qr[field]}
                          onChange={e => onUpdate(qr.id, field, e.target.value)}
                          placeholder={placeholder}
                          className={cn(cellCtrl, "h-10")}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

/* ── Per-line specs + preferred vendor (Brown Field — no quotations) ───── */
function BrownFieldLineDetail({
  row,
  vendors,
  allocatedINR,
  onUpdate,
}: {
  row: GridRow
  vendors: Vendor[]
  allocatedINR: number | null
  onUpdate: (id: string, field: keyof GridRow, value: string) => void
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Preferred Vendor</label>
          <select
            value={row.prefVendorId}
            onChange={e => onUpdate(row.id, "prefVendorId", e.target.value)}
            className={cellCtrl}
          >
            <option value="">— None —</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.vendorName}</option>
            ))}
          </select>
        </div>
        {row.prefVendorId && (
          <div className="lg:col-span-2">
            <label className={fieldLabel}>Why this vendor (optional)</label>
            <input
              value={row.prefVendorReason}
              onChange={e => onUpdate(row.id, "prefVendorReason", e.target.value)}
              placeholder="Reason for recommending this vendor…"
              className={cellCtrl}
            />
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Sourcing will obtain quotations via RFQ or reverse auction — buyers do not enter prices.
      </p>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────── */
export default function NewCapexPage() {
  const router = useRouter()
  const { addRequest, addInvite, vendors, capexMaster, customPlants, greenFieldBudgetAllocations } = useCapex()
  const [step, setStep]               = useState<"form" | "review" | "sent">("form")
  const [fieldType, setFieldType]     = useState<FieldType | null>(null)
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null)
  const [brownFieldHead, setBrownFieldHead] = useState<string | null>(null)
  const [greenFieldSection, setGreenFieldSection] = useState<GreenFieldSection | null>(null)
  const [greenFieldHead, setGreenFieldHead] = useState<string | null>(null)
  const [specialFieldHead, setSpecialFieldHead] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState("buyer")
  const [rows, setRows]               = useState<GridRow[]>([emptyRow()])
  const [quoteRows, setQuoteRows]     = useState<RequestQuoteRow[]>([])
  const [expandedQuoteLines, setExpandedQuoteLines] = useState<Record<string, boolean>>({})
  const [submittedIds, setSubmittedIds] = useState<string[]>([])

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
  }, [])

  // Scope the active FY to the chosen field type so a published next-FY Brown Field budget
  // is picked up by Brown Field requests without changing the FY for Green Field / Digitisation / IT.
  const activeFy = useMemo(
    () => (fieldType ? getLatestMasterFyForField(capexMaster, fieldType) : getLatestMasterFy(capexMaster)),
    [capexMaster, fieldType],
  )
  const rolePlant = useMemo(
    () => getPlantForRole(currentRole),
    [currentRole],
  )

  const allPlants = useMemo((): PlantMeta[] => {
    const customVals = new Set(customPlants.map(p => p.value))
    const defaults = PLANTS.filter(p => !customVals.has(p.value))
    return [...defaults, ...customPlants]
  }, [customPlants])

  const visiblePlants = useMemo(() => {
    return rolePlant ? allPlants.filter(p => p.value === rolePlant) : allPlants
  }, [allPlants, rolePlant])

  const greenFieldPlants = useMemo((): PlantMeta[] => {
    const plantValues = new Set(
      capexMaster
        .filter(i => (i.fieldType ?? "brown_field") === "green_field" && i.fy === activeFy)
        .map(i => i.plant),
    )
    const gfPlants = allPlants.filter(p => p.greenFieldPlant || plantValues.has(p.value))
    return rolePlant ? gfPlants.filter(p => p.value === rolePlant) : gfPlants
  }, [allPlants, capexMaster, activeFy, rolePlant])

  const rowPlant = selectedPlant ?? rolePlant ?? "jhajjar_p1"

  const isBrownFieldRequest = fieldType === "brown_field"
  const isDigitisationRequest = fieldType === "digitisation"
  const isITRequest = fieldType === "information_technology"
  const isSpecialFieldRequest = isDigitisationRequest || isITRequest
  const isGreenFieldRequest = fieldType === "green_field"
  const isHeadLockedRequest =
    (isBrownFieldRequest && !!brownFieldHead) ||
    (isGreenFieldRequest && !!greenFieldHead) ||
    (isSpecialFieldRequest && !!specialFieldHead)
  const lockedRequestHead = isBrownFieldRequest
    ? brownFieldHead
    : isGreenFieldRequest
      ? greenFieldHead
      : specialFieldHead
  const isMachineryHead =
    (isBrownFieldRequest && brownFieldHead === "Machinery") ||
    (isGreenFieldRequest && greenFieldSection === "Plant Machinery")
  const needsProjectType = fieldType != null && isProjectTypeScopedField(fieldType)

  const projectTypeMasterScope = useMemo(
    () => (needsProjectType && projectType ? { projectType } : {}),
    [needsProjectType, projectType],
  )

  const brownFieldHeadSummaries = useMemo(() => {
    if (!isBrownFieldRequest || !projectType || !selectedPlant) return []
    const scopeItems = filterMasterItemsForRequest({
      capexMaster,
      plant: selectedPlant,
      fieldType: "brown_field",
      fy: activeFy,
      projectType,
    })
    const summaries = getHeadBudgetSummaries(scopeItems).filter(s => s.count > 0)
    const predefined = [...BROWN_FIELD_HEAD_ORDER]
    const extras = summaries
      .map(s => s.head)
      .filter(h => !predefined.includes(h))
      .sort()
    const order = [...predefined, ...extras]
    return summaries.sort(
      (a, b) => order.indexOf(a.head) - order.indexOf(b.head) || b.totalCr - a.totalCr,
    )
  }, [capexMaster, selectedPlant, activeFy, isBrownFieldRequest, projectType])

  const greenFieldSectionSummaries = useMemo(() => {
    if (!isGreenFieldRequest || !projectType || !selectedPlant) return []
    return GREEN_FIELD_SECTION_ORDER.map(section => {
      const items = filterMasterItemsForRequest({
        capexMaster,
        plant: selectedPlant,
        fieldType: "green_field",
        fy: activeFy,
        projectType,
        division: section,
      })
      const subParticularsCr = items.reduce((s, i) => s + i.totalCost, 0)
      const allocatedCr = getGreenFieldSectionBudgetCr(
        greenFieldBudgetAllocations,
        selectedPlant,
        activeFy,
        projectType,
        section,
      )
      const headAllocatedCr = sumGreenFieldHeadBudgetsForSection(
        greenFieldBudgetAllocations,
        selectedPlant,
        activeFy,
        projectType,
        section,
      )
      const status = greenFieldBudgetStatus(
        allocatedCr,
        headAllocatedCr,
      )
      return {
        section,
        totalCr: subParticularsCr,
        count: items.length,
        headAllocatedCr,
        subParticularsCr,
        ...status,
      }
    })
  }, [capexMaster, selectedPlant, activeFy, isGreenFieldRequest, projectType, greenFieldBudgetAllocations])

  const greenFieldHeadSummaries = useMemo(() => {
    if (!isGreenFieldRequest || !projectType || !selectedPlant || !greenFieldSection) return []
    const scopeItems = filterMasterItemsForRequest({
      capexMaster,
      plant: selectedPlant,
      fieldType: "green_field",
      fy: activeFy,
      projectType,
      division: greenFieldSection,
    })
    let summaries = getHeadBudgetSummaries(scopeItems)
    const predefined = [...getFieldDivisionHeads("green_field", greenFieldSection)]
    const existing = new Set(summaries.map(s => s.head))
    predefined.forEach(head => {
      if (!existing.has(head)) summaries.push({ head, totalCr: 0, count: 0 })
    })
    return summaries
      .map(({ head, totalCr, count }) => {
        const usedCr = totalCr
        const allocatedCr = getGreenFieldHeadBudgetCr(
          greenFieldBudgetAllocations,
          selectedPlant,
          activeFy,
          projectType,
          greenFieldSection,
          head,
        )
        const status = greenFieldBudgetStatus(allocatedCr, usedCr)
        return {
          head,
          totalCr: status.hasAllocation ? status.allocatedCr : usedCr,
          count,
          ...status,
        }
      })
      .sort(
        (a, b) => predefined.indexOf(a.head) - predefined.indexOf(b.head) || b.totalCr - a.totalCr,
      )
  }, [capexMaster, selectedPlant, activeFy, isGreenFieldRequest, projectType, greenFieldSection, greenFieldBudgetAllocations])

  const specialFieldHeadSummaries = useMemo(() => {
    if (!isSpecialFieldRequest || !selectedPlant || !fieldType) return []
    const scopeItems = filterMasterItemsForRequest({
      capexMaster,
      plant: selectedPlant,
      fieldType,
      fy: activeFy,
      division: defaultDivisionForFieldType(fieldType),
    })
    return getHeadBudgetSummaries(scopeItems)
  }, [capexMaster, selectedPlant, activeFy, isSpecialFieldRequest, fieldType])

  function resetQuoteRows() {
    setQuoteRows([])
    setExpandedQuoteLines({})
  }

  function resetFieldTypeSelection() {
    setFieldType(null)
    setProjectType(null)
    setSelectedPlant(null)
    setBrownFieldHead(null)
    setGreenFieldSection(null)
    setGreenFieldHead(null)
    setSpecialFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetProjectTypeSelection() {
    setProjectType(null)
    setSelectedPlant(null)
    setBrownFieldHead(null)
    setGreenFieldSection(null)
    setGreenFieldHead(null)
    setSpecialFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetPlantSelection() {
    setSelectedPlant(null)
    setBrownFieldHead(null)
    setGreenFieldSection(null)
    setGreenFieldHead(null)
    setSpecialFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetBrownFieldHeadSelection() {
    setBrownFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetGreenFieldSectionSelection() {
    setGreenFieldSection(null)
    setGreenFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetGreenFieldHeadSelection() {
    setGreenFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function resetSpecialFieldHeadSelection() {
    setSpecialFieldHead(null)
    setRows([emptyRow()])
    resetQuoteRows()
  }

  function goBackInWizard() {
    if (step === "review") {
      setStep("form")
      return
    }
    if (step !== "form") return

    if (isBrownFieldRequest && brownFieldHead) {
      resetBrownFieldHeadSelection()
      return
    }
    if (isGreenFieldRequest && greenFieldHead) {
      resetGreenFieldHeadSelection()
      return
    }
    if (isGreenFieldRequest && greenFieldSection) {
      resetGreenFieldSectionSelection()
      return
    }
    if (isSpecialFieldRequest && specialFieldHead) {
      resetSpecialFieldHeadSelection()
      return
    }
    if (isGreenFieldRequest && selectedPlant) {
      resetPlantSelection()
      return
    }
    if (selectedPlant && (isBrownFieldRequest || isSpecialFieldRequest)) {
      resetPlantSelection()
      return
    }
    if (needsProjectType && projectType) {
      resetProjectTypeSelection()
      return
    }
    if (fieldType) {
      resetFieldTypeSelection()
      return
    }
    router.push("/capex/requests")
  }

  function startNewRequest() {
    setStep("form")
    resetFieldTypeSelection()
    setSubmittedIds([])
    resetQuoteRows()
  }

  function addQuoteForLine(lineRowId: string) {
    setQuoteRows(prev => [...prev, emptyQuoteRow(lineRowId)])
    setExpandedQuoteLines(prev => ({ ...prev, [lineRowId]: true }))
  }

  function toggleQuoteLine(lineRowId: string) {
    setExpandedQuoteLines(prev => ({ ...prev, [lineRowId]: !prev[lineRowId] }))
  }

  function updateQuoteRow(id: string, field: keyof RequestQuoteRow, value: string) {
    setQuoteRows(prev => prev.map(q => (q.id === id ? { ...q, [field]: value } : q)))
  }

  function updateQuoteRowMulti(id: string, updates: Partial<RequestQuoteRow>) {
    setQuoteRows(prev => prev.map(q => (q.id === id ? { ...q, ...updates } : q)))
  }

  function removeQuoteRow(id: string) {
    setQuoteRows(prev => prev.filter(q => q.id !== id))
  }

  function selectBrownFieldHead(head: string) {
    setBrownFieldHead(head)
    setRows([{ ...emptyRow(), masterHead: head }])
  }

  function selectGreenFieldSection(section: GreenFieldSection) {
    setGreenFieldSection(section)
    setGreenFieldHead(null)
    setRows([emptyRow()])
  }

  function selectGreenFieldHead(head: string) {
    setGreenFieldHead(head)
    setRows([{ ...emptyRow(), masterHead: head }])
  }

  function selectSpecialFieldHead(head: string) {
    if (!fieldType) return
    setSpecialFieldHead(head)
    setRows([{ ...emptyRow(), masterHead: head }])
  }

  /** Keep every locked-head row stamped with the request-level head. */
  useEffect(() => {
    if (!isHeadLockedRequest || !lockedRequestHead) return
    setRows(prev => {
      const outOfSync = prev.some(r => r.masterHead !== lockedRequestHead)
      if (!outOfSync) return prev
      return prev.map(r =>
        r.masterHead === lockedRequestHead
          ? r
          : {
              ...r,
              masterHead: lockedRequestHead,
              masterItemId: "",
              machineCapacity: "",
              description: "",
            },
      )
    })
  }, [isHeadLockedRequest, lockedRequestHead])

  function updateRow(id: string, field: keyof GridRow, value: string) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, [field]: value }))
  }
  function updateRowMulti(id: string, updates: Partial<GridRow>) {
    setRows(prev => prev.map(r => r.id !== id ? r : { ...r, ...updates }))
  }
  function addRow() {
    setRows(prev => [
      ...prev,
      {
        ...emptyRow(),
        ...(isHeadLockedRequest && lockedRequestHead ? { masterHead: lockedRequestHead } : {}),
      },
    ])
  }
  function deleteRow(id: string) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter(r => r.id !== id))
    setQuoteRows(prev => prev.filter(q => q.lineRowId !== id))
  }

  function getAllocatedINR(row: GridRow): number | null {
    if (!row.masterItemId) return null
    const item = capexMaster.find(m => m.id === row.masterItemId)
    return item ? item.totalCost * CR_TO_INR : null
  }

  const mixedCurrencyVendorIds = useMemo(() => findMixedCurrencyVendors(quoteRows), [quoteRows])
  const quotesValid =
    validateQuoteRows(quoteRows) &&
    mixedCurrencyVendorIds.length === 0 &&
    validateQuotesPerLine(quoteRows, rows.map(r => r.id))
  // Brown Field buyers enter specs + preferred vendor (no quotations); other field types
  // keep the buyer-quote flow and its validation.
  const formValid = isBrownFieldRequest
    ? rows.every(r => r.description.trim() && r.quantity.trim() && r.remarks.trim())
    : rows.every(r => r.description.trim() && r.quantity.trim() && r.remarks.trim()) && quotesValid

  function handleSubmit() {
    if (isBrownFieldRequest && !brownFieldHead) {
      console.error('Brown Field requests require a budget head before submit')
      return
    }
    if (isGreenFieldRequest && (!greenFieldSection || !greenFieldHead)) {
      console.error('Green Field requests require a section and budget head before submit')
      return
    }

    const createdBy  = ROLE_NAMES[currentRole] ?? currentRole
    const plant      = rowPlant
    const assignedTo = SOURCING_ENGINEERS[0].value
    const reqId      = crypto.randomUUID()

    const lockedHead = lockedRequestHead
    if (lockedHead && rows.some(r => r.masterHead && r.masterHead !== lockedHead)) {
      console.error("Rows must use the selected request head:", lockedHead)
      return
    }

    const lineRowIdToLineItemId = new Map<string, string>()
    const quantityByLineRowId = new Map<string, string>()

    const lineItems: CapexLineItem[] = rows.map(row => {
      const lineItemId = crypto.randomUUID()
      lineRowIdToLineItemId.set(row.id, lineItemId)
      quantityByLineRowId.set(row.id, row.quantity)

      const resolvedHead = lockedHead ?? (row.masterHead || undefined)
      // Brown Field has no buyer quotes and no est-budget input — budget derives from the linked
      // master allocation. Other field types use the lowest seeded quote.
      const allocatedINR = getAllocatedINR(row)
      const budgetNum = isBrownFieldRequest
        ? (allocatedINR ?? undefined)
        : getLowestQuoteAmountForLine(quoteRows, row.id)
      const prefVendor = isBrownFieldRequest && row.prefVendorId
        ? vendors.find(v => v.id === row.prefVendorId)
        : undefined
      return {
        id: lineItemId,
        masterItemId: row.masterItemId || undefined,
        masterHead: resolvedHead,
        division:
          isBrownFieldRequest
            ? FLAT_MASTER_DIVISION
            : isGreenFieldRequest && greenFieldSection
              ? greenFieldSection
              : isSpecialFieldRequest && fieldType
                ? defaultDivisionForFieldType(fieldType)
                : undefined,
        machineCapacity:
          isMachineryHead && row.masterItemId && row.machineCapacity.trim()
            ? row.machineCapacity.trim()
            : undefined,
        description: row.description,
        category: resolvedHead ?? 'General',
        quantity: row.quantity,
        budget: budgetNum,
        remarks: row.remarks || undefined,
        // For Brown Field the Description/remarks field is the specification.
        specs: isBrownFieldRequest && row.remarks.trim() ? row.remarks.trim() : undefined,
        vendorRecommendation: prefVendor
          ? { vendorName: prefVendor.vendorName, reason: row.prefVendorReason.trim() }
          : undefined,
      }
    })

    const totalBudget = lineItems.reduce((sum, item) => sum + (item.budget ?? 0), 0) || undefined
    const first = lineItems[0]

    addRequest({
      id: reqId,
      fieldType: fieldType ?? "brown_field",
      ...(needsProjectType && projectType
        ? { projectType, greenFieldProjectType: projectType }
        : {}),
      subject: first.description,
      masterItemId: first.masterItemId,
      category: rows.length > 1 ? "Multiple" : (lockedHead ?? first.masterHead ?? "General"),
      quantity: rows.length > 1 ? `${rows.length} items` : first.quantity,
      budget: totalBudget,
      priority: "medium" as CapexRequest["priority"],
      justification: "",
      techSpecs: { specifications: first.specs ?? "", complianceStandards: "" },
      assignedTo,
      status: initialStatusForRequest(totalBudget, fieldType ?? "brown_field"),
      createdBy,
      createdAt: new Date().toISOString(),
      plant,
      lineItems,
      remarks: rows.length === 1 ? first.remarks : undefined,
      vendorRecommendation: first.vendorRecommendation,
    })

    // Brown Field has no buyer quotations — nothing to seed. Other field types seed
    // VendorInvite + Quote records from the buyer's quote rows.
    if (!isBrownFieldRequest) {
      const seededInvites = buildInvitesFromQuoteRows({
        requestId: reqId,
        quoteRows,
        lineRowIdToLineItemId,
        quantityByLineRowId,
      })
      seededInvites.forEach(invite => addInvite(invite))
    }

    setSubmittedIds([reqId])
    setStep("sent")
  }

  /* ─────────────────────────────────────────────────────────────
     FIELD TYPE PICKER (before grid)
  ───────────────────────────────────────────────────────────── */
  if (step === "form" && !fieldType) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-5xl">
      <WizardActionBar
        onBack={() => router.push("/capex/requests")}
        backLabel="Back to requests"
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          Choose a field type to begin.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {([
          { type: "brown_field" as FieldType, desc: "Capex for existing plants — machinery, automation, utilities, and site improvements scoped by RAC/EMS/Component/Fan." },
          { type: "green_field" as FieldType, desc: "New Green Field plant budgets — select plant, section, and head from CAPEX Master." },
          { type: "digitisation" as FieldType, desc: "Digitisation capex from the dedicated Digitisation master (migrated from Brown Field Digitization)." },
          { type: "information_technology" as FieldType, desc: "IT capex — hardware, software, network, cloud, and support from the IT master." },
        ]).map(({ type, desc }) => (
          <button
            key={type}
            type="button"
            onClick={() => setFieldType(type)}
            className={cn(
              selectionCardBase,
              type === "green_field" ? "hover:border-slate-600 focus-visible:ring-slate-600" :
              type === "digitisation" ? "hover:border-blue-600 focus-visible:ring-blue-600" :
              type === "information_technology" ? "hover:border-slate-600 focus-visible:ring-slate-600" :
              "hover:border-primary",
            )}
          >
            <p className="text-lg font-bold text-foreground">{FIELD_TYPE_LABELS[type]}</p>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{desc}</p>
          </button>
        ))}
      </div>
    </div>
  )

  /* Project type picker — Brown & Green Field */
  if (step === "form" && needsProjectType && !projectType) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-5xl">
      <WizardActionBar onBack={resetFieldTypeSelection} backLabel="Back to field type">
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          {fieldType && <FieldTypeBadge fieldType={fieldType} />}
          Choose a business category (RAC, EMS, Component, Fan).
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PROJECT_TYPES.map(pt => (
          <button
            key={pt}
            type="button"
            onClick={() => {
              setProjectType(pt)
              setSelectedPlant(null)
              setBrownFieldHead(null)
              setGreenFieldHead(null)
              setRows([emptyRow()])
            }}
            className={cn(selectionCardBase, "hover:border-slate-600 focus-visible:ring-slate-600")}
          >
            <p className="text-lg font-bold text-slate-900">{PROJECT_TYPE_LABELS[pt]}</p>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              {FIELD_TYPE_LABELS[fieldType!]} master scoped to {PROJECT_TYPE_LABELS[pt]}.
            </p>
          </button>
        ))}
      </div>
    </div>
  )

  /* Plant picker — Brown, Digitisation, IT */
  if (step === "form" && (isBrownFieldRequest || isSpecialFieldRequest) && !selectedPlant) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-5xl">
      <WizardActionBar
        onBack={isBrownFieldRequest ? resetProjectTypeSelection : resetFieldTypeSelection}
        backLabel={isBrownFieldRequest ? "Back to category" : "Back to field type"}
      >
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
        {isBrownFieldRequest && projectType && (
          <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
        )}
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          {fieldType && <FieldTypeBadge fieldType={fieldType} />}
          {projectType && <ProjectTypeBadge projectType={projectType} />}
          Select a plant.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visiblePlants.map(plant => (
          <button
            key={plant.value}
            type="button"
            onClick={() => setSelectedPlant(plant.value)}
            className={cn(selectionCardBase, "hover:border-primary")}
          >
            <p className="text-lg font-bold text-slate-900">{plant.label}</p>
            <p className="text-sm text-slate-500 mt-1">{plant.state}</p>
          </button>
        ))}
      </div>
    </div>
  )

  /* Green Field — plant picker */
  if (step === "form" && isGreenFieldRequest && projectType && !selectedPlant) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-5xl">
      <WizardActionBar onBack={resetProjectTypeSelection} backLabel="Back to category">
        <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          <FieldTypeBadge fieldType="green_field" />
          <ProjectTypeBadge projectType={projectType} />
          Select a Green Field plant.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {greenFieldPlants.map(plant => (
          <button
            key={plant.value}
            type="button"
            onClick={() => setSelectedPlant(plant.value)}
            className={cn(selectionCardBase, "hover:border-slate-600")}
          >
            <p className="text-lg font-bold text-slate-900">{plant.label}</p>
            <p className="text-sm text-slate-500 mt-1">{plant.state}</p>
          </button>
        ))}
      </div>
      {greenFieldPlants.length === 0 && (
        <p className="text-sm text-slate-500">
          No Green Field plants found for this category and fiscal year. Ask sourcing to create a plant on CAPEX Master first.
        </p>
      )}
    </div>
  )

  /* Green Field — section picker */
  if (step === "form" && isGreenFieldRequest && selectedPlant && projectType && !greenFieldSection) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-6xl">
      <WizardActionBar onBack={resetPlantSelection} backLabel="Back to plants">
        <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          <FieldTypeBadge fieldType="green_field" />
          {projectType && <ProjectTypeBadge projectType={projectType} />}
          <span>Choose a Green Field section — allocated budget is shown on each card.</span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {greenFieldSectionSummaries.map(({ section, count, allocatedCr, usedCr, over, remainingCr, hasAllocation, headAllocatedCr, subParticularsCr }) => (
          <button
            key={section}
            type="button"
            onClick={() => selectGreenFieldSection(section)}
            className={cn(
              "text-left rounded-xl border-2 bg-card p-4 shadow-xs hover:shadow-md transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600",
              over ? "border-red-300 hover:border-red-400" : "border-border hover:border-slate-600",
            )}
          >
            <p className="text-sm font-bold text-slate-900 leading-snug">{section}</p>
            {hasAllocation ? (
              <>
                <p className={cn("text-xl font-black font-mono mt-2", over ? "text-red-700" : "text-slate-700")}>
                  ₹{allocatedCr.toFixed(2)} <span className="text-xs font-semibold">Cr allocated</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-2 font-medium">
                  ₹{usedCr.toFixed(2)} Cr to heads · ₹{subParticularsCr.toFixed(2)} Cr in sub-particulars
                </p>
                {over ? (
                  <p className="text-[11px] font-bold text-red-600 mt-1">Over by ₹{Math.abs(remainingCr).toFixed(2)} Cr</p>
                ) : remainingCr > 0 ? (
                  <p className="text-[11px] font-semibold text-slate-700 mt-1">₹{remainingCr.toFixed(2)} Cr remaining</p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-xl font-black font-mono text-slate-700 mt-2">
                  Budget not set
                </p>
                <p className="text-[11px] text-slate-400 mt-2 font-medium">
                  {count} sub-particular{count !== 1 ? "s" : ""} · ₹{headAllocatedCr.toFixed(2)} Cr to heads
                </p>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )

  /* Green Field — head picker */
  if (step === "form" && isGreenFieldRequest && selectedPlant && projectType && greenFieldSection && !greenFieldHead) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-6xl">
      <WizardActionBar onBack={resetGreenFieldSectionSelection} backLabel="Back to sections">
        <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          <FieldTypeBadge fieldType="green_field" />
          {projectType && <ProjectTypeBadge projectType={projectType} />}
          <DivisionBadge division={greenFieldSection} />
          <span>Choose a budget head — allocated budget is shown on each card.</span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {greenFieldHeadSummaries.map(({ head, totalCr, usedCr, count, over, remainingCr, hasAllocation }) => (
          <button
            key={head}
            type="button"
            onClick={() => selectGreenFieldHead(head)}
            className={cn(
              "text-left rounded-xl border-2 bg-card p-4 shadow-xs hover:shadow-md transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600",
              over ? "border-red-300 hover:border-red-400" : "border-border hover:border-slate-600",
            )}
          >
            <p className="text-sm font-bold text-slate-900 leading-snug">{head}</p>
            {hasAllocation ? (
              <>
                <p className={cn("text-xl font-black font-mono mt-2", over ? "text-red-700" : "text-slate-700")}>
                  ₹{totalCr.toFixed(2)} <span className="text-xs font-semibold">Cr allocated</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-2 font-medium">
                  ₹{usedCr.toFixed(2)} Cr used · {count} sub-particular{count !== 1 ? "s" : ""}
                </p>
                {over ? (
                  <p className="text-[11px] font-bold text-red-600 mt-1">Over by ₹{Math.abs(remainingCr).toFixed(2)} Cr</p>
                ) : remainingCr > 0 ? (
                  <p className="text-[11px] font-semibold text-slate-700 mt-1">₹{remainingCr.toFixed(2)} Cr remaining</p>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-xl font-black font-mono text-slate-700 mt-2">
                  ₹{totalCr.toFixed(2)} <span className="text-xs font-semibold">Cr</span>
                </p>
                <p className="text-[11px] text-slate-400 mt-2 font-medium">
                  {count} sub-particular{count !== 1 ? "s" : ""}
                </p>
              </>
            )}
          </button>
        ))}
      </div>
      {greenFieldHeadSummaries.length === 0 && (
        <p className="text-sm text-slate-500">
          No Green Field budget heads found for this plant and fiscal year. Add master data first.
        </p>
      )}
    </div>
  )

  /* Digitisation / IT head picker */
  if (step === "form" && isSpecialFieldRequest && selectedPlant && !specialFieldHead) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-6xl">
      <WizardActionBar onBack={resetPlantSelection} backLabel="Back to plants">
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          {fieldType && <FieldTypeBadge fieldType={fieldType} />}
          <span>Choose a budget head — allocated budget is shown on each card.</span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {specialFieldHeadSummaries.map(({ head, totalCr, count }) => (
          <button
            key={head}
            type="button"
            onClick={() => selectSpecialFieldHead(head)}
            className={cn(
              "text-left rounded-xl border-2 border-border bg-card p-4 shadow-xs hover:shadow-md transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:border-primary",
            )}
          >
            <p className="text-sm font-bold text-slate-900 leading-snug">{head}</p>
            <p className="text-xl font-black font-mono text-primary mt-2">
              ₹{totalCr.toFixed(2)} <span className="text-xs font-semibold">Cr</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-2 font-medium">
              {count} sub-particular{count !== 1 ? "s" : ""}
            </p>
          </button>
        ))}
      </div>
      {specialFieldHeadSummaries.length === 0 && (
        <p className="text-sm text-slate-500">
          No budget heads found for this plant and fiscal year. Add master data first.
        </p>
      )}
    </div>
  )

  /* Brown Field — budget head picker */
  if (step === "form" && isBrownFieldRequest && selectedPlant && projectType && !brownFieldHead) return (
    <div className="py-5 px-5 flex flex-col gap-5 h-full max-w-6xl">
      <WizardActionBar onBack={resetPlantSelection} backLabel="Back to plants">
        <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
        <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
      </WizardActionBar>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">New CAPEX Request</h1>
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
          <AmberHeader />
          <FieldTypeBadge fieldType="brown_field" />
          {projectType && <ProjectTypeBadge projectType={projectType} />}
          <span>Choose a budget head — allocated budget is shown on each card.</span>
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {brownFieldHeadSummaries.map(({ head, totalCr, count }) => (
          <button
            key={head}
            type="button"
            onClick={() => selectBrownFieldHead(head)}
            className={cn(
              "text-left rounded-xl border-2 border-border bg-card p-4 shadow-xs hover:shadow-md transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]",
              "hover:border-[#1D4ED8]",
            )}
          >
            <p className="text-sm font-bold text-slate-900 leading-snug">{head}</p>
            <p className="text-xl font-black font-mono text-[#1D4ED8] mt-2">
              ₹{totalCr.toFixed(2)} <span className="text-xs font-semibold">Cr</span>
            </p>
            <p className="text-[11px] text-slate-400 mt-2 font-medium">
              {count} sub-particular{count !== 1 ? "s" : ""}
            </p>
          </button>
        ))}
      </div>
      {brownFieldHeadSummaries.length === 0 && (
        <p className="text-sm text-slate-500">
          No budget heads with line items for this plant and fiscal year. Add master data in CAPEX Master first.
        </p>
      )}
    </div>
  )

  /* ─────────────────────────────────────────────────────────────
     STEP 1 — FORM
  ───────────────────────────────────────────────────────────── */
  if (step === "form") return (
    <div className="py-5 px-5 flex flex-col gap-4 h-full">

      {/* Page header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-3 min-w-0">
            <WizardBackButton
              onClick={goBackInWizard}
              label={
                isHeadLockedRequest && lockedRequestHead
                  ? "Back to budget heads"
                  : isBrownFieldRequest && !brownFieldHead
                    ? "Back to plants"
                  : isGreenFieldRequest && greenFieldSection && !greenFieldHead
                    ? "Back to sections"
                    : selectedPlant && (isBrownFieldRequest || isGreenFieldRequest || isSpecialFieldRequest)
                      ? "Back to plants"
                      : needsProjectType && projectType
                        ? "Back to category"
                        : "Back to field type"
              }
            />
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                New CAPEX Request
              </h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                <AmberHeader />
                {fieldType && <FieldTypeBadge fieldType={fieldType} />}
                {needsProjectType && projectType && (
                  <ProjectTypeBadge projectType={projectType} />
                )}
                {isGreenFieldRequest && greenFieldSection && (
                  <DivisionBadge division={greenFieldSection} />
                )}
                {isHeadLockedRequest && lockedRequestHead && <HeadBadge head={lockedRequestHead} />}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Add one row per line item. Fields marked <span className="text-red-600 font-bold" aria-hidden="true">*</span>
                <span className="sr-only">asterisk</span> are required. Budget is in ₹ (rupees).
              </p>
            </div>
          </div>
          <StepBar step="form" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <WizardChangeButton onClick={resetFieldTypeSelection} label="Change field type" />
          {needsProjectType && projectType && (
            <WizardChangeButton onClick={resetProjectTypeSelection} label="Change category" />
          )}
          {selectedPlant && (isBrownFieldRequest || isGreenFieldRequest || isSpecialFieldRequest) && (
            <WizardChangeButton onClick={resetPlantSelection} label="Change plant" />
          )}
          {isHeadLockedRequest && lockedRequestHead && (
            <WizardChangeButton
              onClick={
                isGreenFieldRequest
                  ? resetGreenFieldHeadSelection
                  : isSpecialFieldRequest
                    ? resetSpecialFieldHeadSelection
                    : resetBrownFieldHeadSelection
              }
              label="Change head"
            />
          )}
        </div>
      </div>

      {/* Grid container */}
      <div className="rounded-xl border border-border overflow-hidden shadow-sm flex-1 min-h-0 flex flex-col bg-card">
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
              CAPEX request line items. Subject, Quantity, and Description are required per row.
            </caption>

            {/* ── Desktop thead (hidden on mobile) ── */}
            <thead className="sticky top-0 z-10 hidden lg:table-header-group">
              <tr className="bg-foreground text-background text-xs font-semibold uppercase tracking-wider">
                {/* # — 40px fixed */}
                <th scope="col" className="px-3 py-3 text-center w-10 border-r border-slate-700 select-none">#</th>
                {/* Subject — flex-1, min 220px */}
                <th scope="col" className="px-3 py-3 text-left min-w-[220px] border-r border-slate-700">
                  Subject
                  <span className="text-red-400 ml-1" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </th>
                {/* Head — 180px (chip for Machinery; dropdown for others) */}
                <th scope="col" className="px-3 py-3 text-left w-[180px] border-r border-slate-700">Head</th>
                {isMachineryHead ? (
                  <>
                    <th scope="col" className="px-3 py-3 text-left w-[300px] border-r border-slate-700">Sub Particular</th>
                    <th scope="col" className="px-3 py-3 text-left w-[160px] border-r border-slate-700">Machine Capacity</th>
                  </>
                ) : (
                  <>
                    {fieldType === "green_field" && (
                      <th scope="col" className="px-3 py-3 text-left w-[160px] border-r border-slate-700">Machine Capacity</th>
                    )}
                    <th scope="col" className="px-3 py-3 text-left w-[300px] border-r border-slate-700">Sub Particular</th>
                  </>
                )}
                {/* Qty — 90px, right-aligned */}
                <th scope="col" className="px-3 py-3 text-right w-[90px] border-r border-slate-700">
                  Qty
                  <span className="text-red-400 ml-1" aria-hidden="true">*</span>
                  <span className="sr-only"> (required)</span>
                </th>
                {/* Allocated Budget — 160px */}
                <th scope="col" className="px-3 py-3 text-right w-[160px] border-r border-slate-700">Allocated Budget</th>
                {/* Delete — 44px */}
                <th scope="col" className="px-3 py-3 w-[44px]">
                  <span className="sr-only">Delete row</span>
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, idx) => {
                const allocatedINR  = getAllocatedINR(row)
                const rowBase       = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60"
                const rowExtra      = "border-l-4 border-l-transparent"
                const lineQuotes    = getQuotesForLine(quoteRows, row.id)
                const mainColSpan   = isMachineryHead ? 8 : fieldType === "green_field" ? 8 : 7
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

                const scopeItems = filterMasterItemsForRequest({
                  capexMaster,
                  plant: rowPlant,
                  fieldType: fieldType ?? "brown_field",
                  fy: activeFy,
                  ...(isBrownFieldRequest && brownFieldHead
                    ? { head: brownFieldHead }
                    : isGreenFieldRequest && greenFieldSection
                      ? { division: greenFieldSection }
                      : fieldType
                        ? { division: defaultDivisionForFieldType(fieldType) }
                        : {}),
                  ...projectTypeMasterScope,
                })
                const heads = getOrderedHeadsForScope(
                  scopeItems,
                  fieldType ?? "brown_field",
                )

                const lockedHeadForRow = lockedRequestHead

                const headField = isHeadLockedRequest ? (
                  <div className="flex flex-col gap-1 min-w-0">
                    {lockedHeadForRow ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200 leading-tight"
                        title="Head is fixed for this request"
                      >
                        <svg aria-hidden="true" className="w-3 h-3 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        {lockedHeadForRow}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">No head selected</span>
                    )}
                  </div>
                ) : (() => (
                  <select
                    value={row.masterHead}
                    onChange={e => {
                      const prevItem = row.masterItemId
                        ? capexMaster.find(m => m.id === row.masterItemId)
                        : null
                      updateRowMulti(row.id, {
                        masterHead: e.target.value,
                        masterItemId: "",
                        ...(row.description === prevItem?.subParticulars ? { description: "" } : {}),
                      })
                    }}
                    className={cn(cellCtrl, "h-10", !row.masterHead && "text-slate-500")}
                    aria-label={`Row ${idx + 1} CAPEX head`}
                  >
                    <option value="">Select…</option>
                    {heads.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                ))()

                const showMachineCapacity = isMachineryHead && !!row.masterItemId

                const machineCapacityField =
                  showMachineCapacity ? (
                    <input
                      type="text"
                      value={row.machineCapacity}
                      onChange={e => updateRow(row.id, "machineCapacity", e.target.value)}
                      placeholder="e.g. 500 units/hr, 50T press"
                      className={cn(cellCtrl, "h-10")}
                      aria-label={`Row ${idx + 1} machine capacity`}
                    />
                  ) : isMachineryHead ? (
                    <span className="text-xs text-slate-400 px-2">Select sub-particular first</span>
                  ) : fieldType === "green_field" ? (
                    <span className="text-xs text-slate-400 px-2">—</span>
                  ) : null

                const subParticularField = (() => {
                  const activeHead = lockedHeadForRow ?? row.masterHead
                  const subItems = activeHead
                    ? filterMasterItemsForRequest({
                        capexMaster,
                        plant: rowPlant,
                        fieldType: fieldType ?? "brown_field",
                        fy: activeFy,
                        ...(isBrownFieldRequest && brownFieldHead
                          ? { head: brownFieldHead }
                          : isGreenFieldRequest && greenFieldSection
                            ? { division: greenFieldSection }
                            : fieldType
                              ? { division: defaultDivisionForFieldType(fieldType) }
                              : {}),
                        head: activeHead,
                        ...projectTypeMasterScope,
                      })
                    : []
                  const isLocked   = !activeHead

                  const handleSubChange = (val: string) => {
                    if (!val) { updateRowMulti(row.id, { masterItemId: "" }); return }
                    const item = subItems.find(m => m.id === val)
                    if (!item || item.head !== activeHead) return
                    const updates: Partial<GridRow> = { masterItemId: val }
                    const prevItem = row.masterItemId
                      ? capexMaster.find(m => m.id === row.masterItemId)
                      : null
                    if (!row.description || row.description === prevItem?.subParticulars)
                      updates.description = item.subParticulars
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
                          <span className="text-xs text-slate-400 truncate">
                            {isHeadLockedRequest ? "Select a head before adding items" : "Select a Head first"}
                          </span>
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

                const allocatedBudgetField = (
                  <div
                    className="h-10 flex items-center justify-end px-2 rounded-md border border-slate-100 bg-slate-50/80"
                    aria-label={
                      allocatedINR !== null
                        ? `Row ${idx + 1} allocated budget ${formatINR(allocatedINR)}`
                        : `Row ${idx + 1} allocated budget not available`
                    }
                  >
                    {allocatedINR !== null ? (
                      <span className="text-xs font-semibold text-slate-700 tabular-nums">{formatINR(allocatedINR)}</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
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

                const quoteSection = (
                  <LineQuoteSection
                    lineRowId={row.id}
                    lineIndex={idx}
                    quotes={lineQuotes}
                    vendors={vendors}
                    allocatedINR={allocatedINR}
                    expanded={!!expandedQuoteLines[row.id]}
                    mixedCurrencyVendorIds={mixedCurrencyVendorIds}
                    onToggle={() => toggleQuoteLine(row.id)}
                    onAddQuote={() => addQuoteForLine(row.id)}
                    onUpdate={updateQuoteRow}
                    onUpdateMulti={updateQuoteRowMulti}
                    onRemove={removeQuoteRow}
                  />
                )

                // Brown Field buyers provide specs + preferred vendor only (no quotations).
                const lineDetailSection = isBrownFieldRequest ? (
                  <BrownFieldLineDetail
                    row={row}
                    vendors={vendors}
                    allocatedINR={allocatedINR}
                    onUpdate={updateRow}
                  />
                ) : quoteSection

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
                      aria-label={`Line item ${idx + 1}`}
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
                      {isMachineryHead ? (
                        <>
                          <td className="px-3 py-3 border-r border-slate-200 w-[300px]">
                            {subParticularField}
                          </td>
                          <td className="px-3 py-3 border-r border-slate-200 w-[160px]">
                            {machineCapacityField}
                          </td>
                        </>
                      ) : (
                        <>
                          {fieldType === "green_field" && (
                            <td className="px-3 py-3 border-r border-slate-200 w-[160px]">
                              {machineCapacityField}
                            </td>
                          )}
                          <td className="px-3 py-3 border-r border-slate-200 w-[300px]">
                            {subParticularField}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-3 border-r border-slate-200 w-[90px]">
                        {qtyField}
                      </td>
                      <td className="px-3 py-3 border-r border-slate-200 w-[160px]">
                        {allocatedBudgetField}
                      </td>
                      <td className="px-2 py-3 w-[44px] text-center">
                        {deleteButton}
                      </td>
                    </tr>

                    {/* ── DESKTOP description sub-row ── */}
                    <tr
                      className={cn(
                        "border-b border-slate-200 hidden lg:table-row",
                        idx % 2 === 0 ? "bg-[#F8FAFC]" : "bg-slate-50/80",
                        "border-l-4 border-l-transparent"
                      )}
                    >
                      <td className="px-3 py-2 text-center border-r border-slate-100 bg-slate-100/40 w-10">
                        <span className="text-[10px] font-bold text-slate-300 select-none">↳</span>
                      </td>
                      <td colSpan={mainColSpan - 1} className="px-3 pb-2 pt-1">
                        {remarksField}
                      </td>
                    </tr>

                    {/* ── DESKTOP quote sub-row ── */}
                    <tr
                      className={cn(
                        "border-b border-slate-200 hidden lg:table-row",
                        idx % 2 === 0 ? "bg-[#F8FAFC]" : "bg-slate-50/80",
                      )}
                    >
                      <td className="px-3 py-2 text-center border-r border-slate-100 bg-slate-100/40 w-10">
                        <span className="text-[10px] font-bold text-slate-300 select-none">↳</span>
                      </td>
                      <td colSpan={mainColSpan - 1} className="px-3 pb-3 pt-1">
                        {lineDetailSection}
                      </td>
                    </tr>

                    {/* ── TABLET row (640–1023px) ── */}
                    <tr
                      key={`tablet-${row.id}`}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0 align-top group transition-colors hover:bg-[#EBF0FB]/40",
                        "hidden sm:table-row lg:hidden",
                        rowExtra, rowBase
                      )}
                      aria-label={`Line item ${idx + 1}`}
                    >
                      <td colSpan={mainColSpan} className="px-3 py-3">
                        <div className="flex gap-3 mb-3 items-start flex-wrap">
                          <span className="text-xs font-bold text-slate-500 select-none w-6 shrink-0 pt-2.5 text-center">{idx + 1}</span>
                          <div className="flex-1 min-w-[180px]">{subjectField}</div>
                          <div className="w-[160px] shrink-0">{headField}</div>
                          <div className="w-[220px] shrink-0">{subParticularField}</div>
                          {isMachineryHead && (
                            <div className="w-[180px] shrink-0">{machineCapacityField}</div>
                          )}
                        </div>
                        <div className="flex gap-3 items-start pl-9">
                          <div className="w-[90px] shrink-0">{qtyField}</div>
                          <div className="w-[140px] shrink-0">{allocatedBudgetField}</div>
                          <div className="shrink-0">{deleteButton}</div>
                        </div>
                        <div className="mt-3 pl-9">{remarksField}</div>
                        <div className="mt-3 pl-9">{lineDetailSection}</div>
                      </td>
                    </tr>

                    {/* ── MOBILE card (< 640px) ── */}
                    <tr
                      key={`mobile-${row.id}`}
                      className={cn(
                        "border-b border-slate-200 last:border-b-0",
                        "table-row sm:hidden",
                        rowBase
                      )}
                    >
                      <td colSpan={mainColSpan} className="p-3">
                        <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 border-b border-slate-200">
                            <span className="text-xs font-bold text-slate-500">Item {idx + 1}</span>
                            <div className="flex items-center gap-2">{deleteButton}</div>
                          </div>
                          <div className="p-3 grid grid-cols-1 gap-3">
                            <div>
                              <label className={fieldLabel}>
                                Subject <span className="text-red-500" aria-hidden="true">*</span>
                              </label>
                              {subjectField}
                            </div>
                            <div>
                              <label className={fieldLabel}>Head</label>
                              {headField}
                            </div>
                            <div>
                              <label className={fieldLabel}>Sub Particular</label>
                              {subParticularField}
                            </div>
                            {isMachineryHead && (
                              <div>
                                <label className={fieldLabel}>Machine Capacity</label>
                                {machineCapacityField}
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className={fieldLabel}>Qty <span className="text-red-500" aria-hidden="true">*</span></label>
                                {qtyField}
                              </div>
                              <div>
                                <label className={fieldLabel}>Allocated Budget</label>
                                {allocatedBudgetField}
                              </div>
                            </div>
                            <div>{remarksField}</div>
                            <div>{lineDetailSection}</div>
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
          className="bg-foreground border-t border-foreground/80 px-4 py-3 flex items-center justify-between shrink-0 flex-wrap gap-2"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            className="gap-1.5 border-background/25 text-background bg-transparent hover:bg-background/10 hover:text-background"
          >
            <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Row
          </Button>

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
                {isBrownFieldRequest
                  ? "Fill in Subject, Quantity, and Description for all rows."
                  : "Fill in Subject, Quantity, and Description for all rows. Add at least one complete vendor quote per line item."}
              </span>
            )}
            <Button
              type="button"
              disabled={!formValid}
              onClick={!formValid ? undefined : () => setStep("review")}
              aria-disabled={!formValid}
              aria-describedby={!formValid ? "submit-hint" : undefined}
              size="sm"
              className={cn(
                "gap-2 px-5",
                !formValid && "bg-background/10 text-background/30 hover:bg-background/10"
              )}
            >
              Review Request
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Button>
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
      <div className="py-5 px-5 flex flex-col gap-4 h-full">

        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-3">
              <WizardBackButton onClick={() => setStep("form")} label="Back to edit details" />
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Confirm Your Request</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Review all items below. Once submitted, requests are routed immediately to sourcing.
                </p>
              </div>
            </div>
            <StepBar step="review" />
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden shadow-sm flex-1 min-h-0 flex flex-col bg-card">
          <div className="overflow-auto flex-1 p-4 space-y-4" role="region" aria-label="Review line items">
            {rows.map((row, idx) => {
              const allocatedINR = getAllocatedINR(row)
              const lineQuotes = getQuotesForLine(quoteRows, row.id).filter(isQuoteRowComplete)
              const lowestBudget = getLowestQuoteAmountForLine(quoteRows, row.id)
              const resolvedPlant = rowPlant
              const plantLabel = PLANTS.find(p => p.value === resolvedPlant)?.label ?? resolvedPlant
              const engineer = SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length]

              return (
                <div key={row.id} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-muted/30">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Item {idx + 1}</p>
                        <p className="font-semibold text-foreground mt-0.5">{row.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {row.masterHead || lockedRequestHead || "—"} · Qty {row.quantity} · {plantLabel}
                        </p>
                      </div>
                      <div className="text-right text-xs space-y-1">
                        <p className="text-muted-foreground">
                          Allocated: {allocatedINR !== null ? formatINR(allocatedINR) : "—"}
                        </p>
                        {!isBrownFieldRequest && lowestBudget !== undefined && (
                          <p className="font-semibold text-foreground">
                            Line budget (lowest quote): {formatINR(lowestBudget)}
                          </p>
                        )}
                      </div>
                    </div>
                    {row.remarks && (
                      <p className="text-xs text-slate-600 mt-2 border-t border-border pt-2">{row.remarks}</p>
                    )}
                  </div>

                  <div className="px-4 py-3">
                    {isBrownFieldRequest ? (
                      <>
                        {row.prefVendorId && (() => {
                          const v = vendors.find(vd => vd.id === row.prefVendorId)
                          return (
                            <p className="text-xs text-muted-foreground mt-2">
                              Preferred vendor: <span className="font-semibold text-foreground">{v?.vendorName ?? row.prefVendorId}</span>
                              {row.prefVendorReason ? ` — ${row.prefVendorReason}` : ""}
                            </p>
                          )
                        })()}
                        <p className="text-[11px] text-muted-foreground mt-2">Assigned to {engineer.name}</p>
                      </>
                    ) : (
                    <>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Vendor Quotes ({lineQuotes.length})
                    </p>
                    <div className="space-y-2">
                      {lineQuotes.map((qr, qIdx) => {
                        const vendor = vendors.find(v => v.id === qr.vendorId)
                        const amount = Number(qr.expectedAmount)
                        return (
                          <div key={qr.id} className="rounded-md border border-border bg-muted/10 p-3 text-sm">
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div>
                                <p className="font-semibold text-foreground">{vendor?.vendorName ?? qr.vendorId}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">Quote {qIdx + 1}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-bold tabular-nums">{formatINR(amount)}</p>
                                <QuoteAllocationChip amount={amount} allocatedINR={allocatedINR} />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs text-slate-600">
                              <span>Freight: {qr.freight ? formatINR(Number(qr.freight)) : "—"}</span>
                              <span>Service: {qr.service ? formatINR(Number(qr.service)) : "—"}</span>
                              <span>Packing: {qr.packing ? formatINR(Number(qr.packing)) : "—"}</span>
                              <span>Delivery: {qr.deliveryWeeks ? `${qr.deliveryWeeks} wks` : "—"}</span>
                              <span>Warranty: {qr.warrantyYears ? `${qr.warrantyYears} yrs` : "—"}</span>
                              <span>Currency: {qr.currency || "INR"}</span>
                              <span className="col-span-2 truncate" title={qr.attachmentName}>
                                Doc: {qr.attachmentName || "—"}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">Assigned to {engineer.name}</p>
                    </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bg-foreground border-t border-foreground/80 px-5 py-3 flex items-center justify-between shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep("form")}
              className="gap-2 border-background/20 text-background/90 bg-transparent hover:bg-background/10 hover:text-background"
            >
              <ChevronLeft className="w-4 h-4" />
              Edit Details
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              className="gap-2 px-6 font-bold"
            >
              Submit Request ({rows.length} item{rows.length !== 1 ? "s" : ""})
              <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Button>
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

  const submittedId = submittedIds[0]

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6">
        <WizardBackButton onClick={() => router.push("/capex/requests")} label="Back to requests" />
      </div>
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
          className="w-12 h-12 rounded-full bg-slate-100 border-2 border-slate-300 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <svg className="w-6 h-6 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
      <div className="rounded-xl border border-border shadow-sm overflow-hidden bg-card">
        <div className="bg-slate-50 border-b border-slate-200 px-5 py-2.5 flex items-center gap-2">
          <svg aria-hidden="true" className="w-4 h-4 text-[#2563EB]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                <tr className="bg-foreground text-background">
                  {["#", "Item", "Qty", "Budget", "Plant"].map(h => (
                    <th key={h} scope="col" className="px-3 py-2 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const budgetNum = getLowestQuoteAmountForLine(quoteRows, row.id)
                  const pLabel = PLANTS.find(p => p.value === rowPlant)?.label ?? rowPlant
                  return (
                    <tr key={row.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                      <td className="px-3 py-2 text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.description}</td>
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

      <div className="mt-5 flex justify-end gap-3 flex-wrap">
        <Button
          type="button"
          variant="outline"
          onClick={startNewRequest}
        >
          Create Another Request
        </Button>
        {submittedId && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push(`/capex/${submittedId}`)}
          >
            View Submitted Request
          </Button>
        )}
        <Button
          type="button"
          onClick={() => router.push("/capex/requests")}
          className="gap-2"
        >
          View All Requests
          <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Button>
      </div>
    </div>
  )
}
