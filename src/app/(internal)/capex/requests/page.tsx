"use client"

import { useState, useEffect, useMemo, useCallback, Fragment, Suspense } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ClipboardList, ArrowRight, X } from "lucide-react"
import { useCapex } from "@/lib/capexContext"
import { getPlantForRole, ROLE_NAMES, STATUS_LABELS, PLANTS } from "@/lib/constants"
import { StatusBadge } from "@/components/StatusBadge"
import { CapexRequest } from "@/lib/types"
import { PROJECT_TYPE_LABELS } from "@/lib/greenFieldConstants"
import { BUDGET_PROPOSAL_STATUS_COLORS, BUDGET_PROPOSAL_STATUS_LABELS, proposalTotalCr } from "@/lib/budgetProposalUtils"
import { invitesByRequest } from "@/lib/kpiUtils"
import {
  EVIDENCE_COLUMN_LABELS, buildRequestListView,
  type EvidenceColumn, type FilterParam, type RowEvidence,
} from "@/lib/kpiRoutes"
import { fmtDays } from "@/lib/format"
import { CARD } from "@/lib/uiTokens"
import { useNow } from "@/components/dashboards/useNow"

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

const STATUS_FILTER_VALUES = [
  "draft", "submitted", "pending_head_approval", "sourcing", "negotiation",
  "sourcing_approved", "buyer_approved", "pi_requested", "pi_submitted",
  "accounts_processing", "payment_in_progress", "completed", "rejected",
] as const

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All Statuses" },
  ...STATUS_FILTER_VALUES.map(v => ({ value: v as string, label: STATUS_LABELS[v] ?? v })),
]

/**
 * The evidence for the number the user clicked — the per-metric column(s) `kpiRoutes` asked for.
 * A red figure always says WHY in words next to it; colour is never the only carrier.
 */
function EvidenceCell({ column, evidence }: { column: EvidenceColumn; evidence: RowEvidence }) {
  if (column === "waiting") {
    const w = evidence.waiting
    if (!w) return <span className="text-slate-300">—</span>
    // A closed request holds nobody up — `PARTY_LABELS.none` is a dash, so "with —" would read
    // as missing data rather than as "finished".
    if (w.party === "none") {
      return (
        <div>
          <p className="text-sm font-semibold text-slate-400">—</p>
          <p className="text-[11px] text-slate-500">closed — nobody is holding it</p>
        </div>
      )
    }
    return (
      <div>
        <p className={`text-sm font-semibold tabular-nums ${w.breachedSla ? "text-red-700" : "text-slate-800"}`}>
          {fmtDays(w.days)}
        </p>
        <p className="text-[11px] text-slate-500">
          with {w.partyLabel}{w.breachWords ? ` · ${w.breachWords}` : ""}
        </p>
      </div>
    )
  }

  if (column === "duration") {
    const d = evidence.duration
    if (!d) return <span className="text-slate-300">—</span>
    return (
      <div>
        <p className="text-sm font-semibold tabular-nums text-slate-800">{fmtDays(d.days)}</p>
        <p className="text-[11px] text-slate-500">{d.note}</p>
      </div>
    )
  }

  if (column === "participation") {
    const p = evidence.participation
    if (!p) return <span className="text-slate-300">—</span>
    const none = p.quoted === 0
    return (
      <div>
        <p className={`text-sm font-semibold tabular-nums ${none ? "text-red-700" : "text-slate-800"}`}>
          {p.quoted} of {p.invited}
        </p>
        <p className="text-[11px] text-slate-500">
          {none ? "no vendor quoted yet" : "invited vendors quoted"}
        </p>
      </div>
    )
  }

  const o = evidence.outcome
  if (!o) return <span className="text-slate-300">—</span>
  return (
    <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${
      o.inNumerator ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-100 text-slate-600 border border-slate-200"
    }`}>
      {o.label}
    </span>
  )
}

function RequestsTable() {
  const { requests, invites, vendors, customPlants } = useCapex()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const now = useNow()
  const [currentRole, setCurrentRole] = useState("buyer")

  const setParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString())
    mutate(next)
    const qs = next.toString()
    // `replace`, not `push`: filtering is not a navigation step the Back button should replay.
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  useEffect(() => {
    const role = localStorage.getItem("capex_role") ?? "buyer_jhajjar_p1"
    setCurrentRole(role)
    const onRoleChange = (e: CustomEvent) => {
      setCurrentRole(e.detail)
      // A different role sees a different set of rows, so every filter a previous role arrived
      // with is dropped rather than silently re-applied to someone else's data.
      router.replace(pathname, { scroll: false })
    }
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [router, pathname])

  const byRequest = useMemo(() => invitesByRequest(invites), [invites])

  // The URL is the single source of truth for the filter — the select, the chips and any
  // dashboard link all read and write the same params, so they can never disagree.
  const statusFilter = searchParams.get("filter") ?? ""
  const metricParam = searchParams.get("metric")
  const overdueParam = searchParams.get("overdue")

  const currentUser = ROLE_NAMES[currentRole] ?? ""

  // The budget-upload user (maintenance) sees BUDGET approval requests here, not item requests.
  if (currentRole === "maintenance") return <BudgetApprovalRequests />

  const isBuyerRole      = currentRole.startsWith("buyer")

  const roleFiltered = (() => {
    // Plant-scoped too: ROLE_NAMES.buyer and ROLE_NAMES.buyer_jhajjar_p1 are the same person, so
    // `createdBy` alone shows a plant-scoped buyer other plants' work — and makes the dashboard
    // tile (which scopes by both) disagree with the list it links to.
    if (isBuyerRole) {
      const buyerPlant = getPlantForRole(currentRole)
      return requests.filter(r => r.createdBy === currentUser && (!buyerPlant || r.plant === buyerPlant))
    }
    if (currentRole === "sourcing_member") return requests.filter(r => r.assignedTo === currentRole)
    return requests
  })()

  // Every param is applied to `roleFiltered` — the role/plant bound above is the outer bound and
  // `buildRequestListView` only ever narrows it, so no combination can widen visibility.
  const view = buildRequestListView(
    {
      metric: metricParam,
      filter: statusFilter,
      plant: searchParams.get("plant"),
      vendor: searchParams.get("vendor"),
      overdue: overdueParam,
    },
    {
      requests: roleFiltered,
      byRequest,
      now,
      labels: {
        status: v => STATUS_LABELS[v] ?? v,
        plant: v => plantLabel(v) ?? v,
        vendor: v => vendors.find(x => x.id === v)?.vendorName ?? v,
      },
      // What `?plant=` / `?vendor=` may legitimately name. The plant roster is unioned with the
      // plants actually present in scope, so a legacy plant value on real data still filters
      // normally — only a genuinely dead value is reported as stale.
      known: {
        plants: [
          ...PLANTS.map(p => p.value),
          ...customPlants.map(p => p.value),
          ...roleFiltered.map(r => r.plant).filter((p): p is string => !!p),
        ],
        vendors: vendors.map(v => v.id),
      },
    },
  )

  const displayRequests = view.rows.map(r => r.request)
  const showAssignedTo = ["super_admin"].includes(currentRole)

  // Ages and durations need the clock, which is 0 until `useNow` mounts (hydration safety).
  const awaitingClock = now === 0 && (!!metricParam || overdueParam != null)

  const summaryLabel =
    isBuyerRole          ? "Your submitted requests" :
    currentRole === "sourcing_member" ? "Requests assigned to you" :
    "All requests"

  const clear = (param: FilterParam) => setParams(p => p.delete(param))
  const clearAll = () => router.replace(pathname, { scroll: false })

  return (
    <div className="p-5 h-full flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">CAPEX Requests</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {/* No count until the clock is up: a time-based filter would flash a wrong number. */}
            {awaitingClock ? `${summaryLabel} — measuring…` : (
              <>
                {summaryLabel} — {displayRequests.length} request{displayRequests.length !== 1 ? "s" : ""}
                {view.metric ? " matching the metric you clicked" : ""}
              </>
            )}
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
            onChange={e => setParams(p => (e.target.value ? p.set("filter", e.target.value) : p.delete("filter")))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 min-h-[36px] text-[13px] text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            {STATUS_FILTER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Active filters — named in words, each dismissible, with a clear-all back to the plain list */}
      {view.chips.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Filtered by</span>
          {view.chips.map(chip => (
            <span
              key={chip.param}
              className="inline-flex items-center gap-1 rounded-full border border-[#2563EB]/30 bg-[#EBF0FB] pl-3.5 pr-0.5 min-h-[44px] text-[12px] font-semibold text-[#1D4ED8]"
            >
              {chip.words}
              {/* 44×44 hit area — the project convention for interactive controls. This is pressed
                  repeatedly to widen a list, so it does not get to be a 28px target. */}
              <button
                type="button"
                onClick={() => clear(chip.param)}
                aria-label={`Remove filter: ${chip.words}`}
                className="inline-flex items-center justify-center w-11 h-11 rounded-full hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-[12px] font-semibold text-slate-500 underline hover:text-slate-800 px-3 min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded"
          >
            Clear all
          </button>
        </div>
      )}

      {/* What the number was, and what this list excludes — stated, never implied.
          Inside the clock guard: with `now === 0` every age clamps to 0, so an un-guarded panel
          would print "0 requests past the 3d threshold" for one paint next to "Measuring…". */}
      {view.metric && (
        <div className={`${CARD} mb-3`}>
          <p className="text-[13px] font-semibold text-slate-800">{view.metric.description}</p>
          {awaitingClock ? (
            <p className="text-[12px] text-slate-500 mt-1">Measuring against the clock…</p>
          ) : (
            view.notes.map(note => (
              <p key={note} className="text-[12px] text-slate-600 mt-1">{note}</p>
            ))
          )}
        </div>
      )}

      {/* A stale or hand-typed param is disclosed — never silently shown as though it applied.
          The headline names ONLY the failure; `showing` states what is actually on screen, so this
          can never claim "unfiltered" while a chip above it says the list is filtered. */}
      {view.notice && (
        <div role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-900 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            {view.notice.headline}
          </p>
          <ul className="mt-1 space-y-0.5">
            {view.notice.items.map(ig => (
              <li key={`${ig.param}:${ig.value}`} className="text-[12px] text-amber-800">
                <code className="font-mono">{ig.param}={ig.value}</code> — {ig.reason}.
              </li>
            ))}
          </ul>
          <p className="text-[12px] font-semibold text-amber-900 mt-1.5">
            {view.notice.showing}
          </p>
        </div>
      )}

      {awaitingClock ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-slate-400 font-medium">Measuring…</p>
          <p className="text-slate-300 text-sm mt-1">This filter is measured against the clock.</p>
        </div>
      ) : displayRequests.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <p className="text-slate-400 font-medium">No requests found.</p>
          <p className="text-slate-300 text-sm mt-1">
            {view.chips.length > 0
              ? "Nothing matches the filters above — clear one to widen the list."
              : currentRole === "buyer" ? "Submit a new request to get started." : "No requests match the current filter."}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F4F4F5] text-[#1E293B]">
                <th className="px-5 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Req. No.</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Subject</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider">Status</th>
                {/* The evidence for the number the user clicked, per `kpiRoutes` metric */}
                {view.columns.map(col => (
                  <th key={col} className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider">
                    {EVIDENCE_COLUMN_LABELS[col]}
                  </th>
                ))}
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
              {view.rows.map(({ request: req, evidence }, idx) => (
                <tr key={req.id} className={`transition-colors group hover:bg-[#EBF0FB]/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  {/* Request No. */}
                  <td className="px-5 py-2 whitespace-nowrap">
                    {req.requestNo
                      ? <span className="text-sm font-bold text-slate-900">{req.requestNo}</span>
                      : <span className="text-sm font-mono text-slate-400">{req.id.slice(0, 8)}…</span>
                    }
                  </td>

                  {/* Subject */}
                  <td className="px-4 py-2 max-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 truncate">{req.subject}</span>
                      {req.lineItems && req.lineItems.length > 1 && (
                        <span className="shrink-0 text-[10px] font-bold bg-[#EBF0FB] text-[#1D4ED8] px-1.5 py-0.5 rounded-full">
                          {req.lineItems.length} items
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2 whitespace-nowrap">
                    <StatusBadge status={req.status} />
                  </td>

                  {/* Evidence for the metric that routed here */}
                  {view.columns.map(col => (
                    <td key={col} className="px-4 py-2 whitespace-nowrap">
                      <EvidenceCell column={col} evidence={evidence} />
                    </td>
                  ))}

                  {/* Plant */}
                  <td className="px-4 py-2 hidden sm:table-cell">
                    {plantLabel(req.plant)
                      ? <span className="text-[12px] bg-[#EBF0FB] text-[#1D4ED8] px-2 py-0.5 rounded-full font-medium">{plantLabel(req.plant)}</span>
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
                            <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
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
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[36px] rounded-lg bg-[#1D4ED8] hover:bg-[#1D4ED8] text-white text-[12px] font-semibold transition-colors"
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

/** The budget-upload user's (maintenance) Requests screen — lists BUDGET approval requests, not item requests. */
function BudgetApprovalRequests() {
  const { budgetProposals } = useCapex()
  const proposals = useMemo(
    () => [...budgetProposals].sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt)),
    [budgetProposals],
  )
  const editable = (s: string) => s === "draft" || s === "needs_correction" || s === "rejected"

  return (
    <div className="p-5 h-full flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-slate-600" /> Budget Approval Requests
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Your next-FY budget proposals and where each one is in the approval flow.</p>
        </div>
        <Link href="/capex/budget-proposals" className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white rounded-lg">
          Budget Planning <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {proposals.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center py-20">
            <ClipboardList className="w-10 h-10 text-slate-200" />
            <p className="text-sm text-slate-500">No budget proposals yet.</p>
            <Link href="/capex/budget-proposals" className="text-xs font-semibold text-primary hover:underline">Create one in Budget Planning →</Link>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[12px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Target FY</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Plant</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Category</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Total</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {proposals.map(p => (
                  <Fragment key={p.id}>
                    <tr className="border-t border-slate-100">
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{p.targetFy || "—"}</td>
                      <td className="px-4 py-2.5 text-slate-600">{plantLabel(p.plant)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{PROJECT_TYPE_LABELS[p.projectType]}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">₹{proposalTotalCr(p).toFixed(2)} Cr</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[p.status]}`}>
                          {BUDGET_PROPOSAL_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href="/capex/budget-proposals" className={`text-xs font-semibold hover:underline ${editable(p.status) ? "text-primary" : "text-slate-400"}`}>
                          {editable(p.status) ? "Edit & Resubmit" : "View"}
                        </Link>
                      </td>
                    </tr>
                    {p.status === "needs_correction" && p.correctionNote && (
                      <tr className="bg-orange-50/40">
                        <td colSpan={6} className="px-4 py-2 text-xs text-orange-800">
                          <span className="font-semibold">Correction requested:</span> {p.correctionNote}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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
