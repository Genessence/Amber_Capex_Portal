"use client"

import React, { useState, useMemo } from "react"
import { toast } from "sonner"
import { Copy, ChevronDown, ChevronUp, Users, FileSpreadsheet, PackageSearch, Paperclip, Mail, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCapex } from "@/lib/capexContext"
import { buildSupplierLink, generateToken } from "@/lib/tokenUtils"
import { INVITE_STATUS_COLORS, SOURCING_ENGINEERS } from "@/lib/constants"
import type { CapexRequest, VendorInvite, Vendor, Quote } from "@/lib/types"

const INVITE_STATUS_LABELS: Record<string, string> = {
  invited:        "Invited",
  quote_received: "Quote Rcvd",
  negotiating:    "Negotiating",
  approved:       "Approved",
  rejected:       "Rejected",
}

interface Props {
  request: CapexRequest
  invites: VendorInvite[]
  vendors: Vendor[]
  currentRole: string
}

const isSourcingRole = (role: string) =>
  ["sourcing_member", "sourcing_member_2", "sourcing_member_3", "sourcing_member_4", "sourcing_head", "super_admin"].includes(role)

export function VendorGrid({ request, invites, vendors, currentRole }: Props) {
  const { addInvite, approveInvite, addNegotiationMessage } = useCapex()

  /* ── Vendor selector panel state ── */
  const [panelOpen,  setPanelOpen]  = useState(invites.length === 0)
  const [searchDir,  setSearchDir]  = useState("")
  const [catFilter,  setCatFilter]  = useState("All")
  const [selected,   setSelected]   = useState<Set<string>>(new Set())

  /* ── Comparison table state ── */
  const [tableSearch,     setTableSearch]     = useState("")
  const [emailOpenId,     setEmailOpenId]     = useState<string | null>(null)
  const [counterInviteId, setCounterInviteId] = useState("")
  const [counterForm,     setCounterForm]     = useState({
    price: "", freight: "", packing: "", service: "",
    delivery: "", warranty: "", currency: "INR", remarks: "",
  })

  const invitedVendorIds = useMemo(() => new Set(invites.map(i => i.vendorId)), [invites])

  /* ── Category pills ── */
  const categories = useMemo(() => {
    const cats = Array.from(new Set(vendors.map(v => v.category))).sort()
    return ["All", ...cats]
  }, [vendors])

  /* ── Filtered directory ── */
  const filteredDir = useMemo(() => {
    return vendors.filter(v => {
      const matchSearch = !searchDir || v.vendorName.toLowerCase().includes(searchDir.toLowerCase()) || v.vendorCode.toLowerCase().includes(searchDir.toLowerCase())
      const matchCat = catFilter === "All" || v.category === catFilter
      return matchSearch && matchCat
    })
  }, [vendors, searchDir, catFilter])

  /* ── Handlers ── */
  const toggleVendor = (id: string, disabled: boolean) => {
    if (disabled) return
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const sendRFQ = () => {
    if (selected.size === 0) return
    selected.forEach(vendorId => {
      const token = generateToken(vendorId, request.id)
      addInvite({
        id: `inv_${vendorId}_${request.id}_${Date.now()}`,
        requestId: request.id,
        vendorId,
        token,
        status: "invited",
        quotes: [],
        negotiationThread: [],
        invitedAt: new Date().toISOString(),
      })
      try {
        navigator.clipboard.writeText(buildSupplierLink(token))
      } catch {}
    })
    toast.success(`RFQ sent to ${selected.size} vendor${selected.size > 1 ? "s" : ""}`)
    setSelected(new Set())
    setPanelOpen(false)
  }

  const copyLink = (inv: VendorInvite) => {
    try {
      navigator.clipboard.writeText(buildSupplierLink(inv.token))
      toast.success("Supplier link copied")
    } catch {
      toast.error("Could not copy to clipboard")
    }
  }

  const handleExport = async () => {
    try {
      const { exportVendorGridToExcel } = await import("@/lib/exportUtils")
      exportVendorGridToExcel(request, invites, vendors)
    } catch {
      toast.error("Export failed")
    }
  }

  /* ── Comparison table data ── */
  const filteredInvites = useMemo(() => {
    if (!tableSearch) return invites
    return invites.filter(inv => {
      const v = vendors.find(v => v.id === inv.vendorId)
      return v?.vendorName.toLowerCase().includes(tableSearch.toLowerCase())
    })
  }, [invites, vendors, tableSearch])

  // Flat list of all quotes across all filtered invites, sorted chronologically
  const allQuotes = useMemo(() => {
    const result: Array<{
      invite: VendorInvite
      vendor: Vendor | undefined
      quote: Quote
      quoteIndex: number
    }> = []
    filteredInvites.forEach(inv => {
      const vendor = vendors.find(v => v.id === inv.vendorId)
      inv.quotes.forEach((quote, quoteIndex) => {
        result.push({ invite: inv, vendor, quote, quoteIndex })
      })
    })
    result.sort((a, b) => new Date(a.quote.submittedAt).getTime() - new Date(b.quote.submittedAt).getTime())
    return result
  }, [filteredInvites, vendors])

  // Invites with no quotes yet (shown as awaiting columns)
  const pendingInvites = useMemo(
    () => filteredInvites.filter(inv => inv.quotes.length === 0),
    [filteredInvites]
  )

  // Quote id with lowest total (price + freight + packing + service); null if < 2 quotes
  const lowestTotalQuoteId = useMemo(() => {
    if (allQuotes.length < 2) return null
    let minTotal = Infinity
    let minId = ""
    allQuotes.forEach(({ quote }) => {
      const total = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0)
      if (total < minTotal) { minTotal = total; minId = quote.id }
    })
    return minId || null
  }, [allQuotes])

  const isSourcing = isSourcingRole(currentRole)

  /* ── Sticky label cell helpers ── */
  const labelTd = "sticky left-0 z-10 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap w-40 min-w-[160px]"
  const labelTdStyle: React.CSSProperties = { borderRight: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
  const ctCellBase = "sticky right-0 z-10 px-3 py-2 bg-violet-50"
  const ctCellStyle: React.CSSProperties = { borderLeft: "2px solid #8b5cf6", borderBottom: "1px solid #e2e8f0" }
  const ctInput = "border border-slate-200 rounded px-2 py-1 text-xs w-full text-right focus:outline-none focus:ring-1 focus:ring-violet-400 bg-white"
  const ctTotal = useMemo(() => {
    const p = Number(counterForm.price)   || 0
    const f = Number(counterForm.freight) || 0
    const k = Number(counterForm.packing) || 0
    const s = Number(counterForm.service) || 0
    return p + f + k + s
  }, [counterForm])

  // Per-quote cell border helper
  const quoteCellStyle = (quoteId: string, inviteStatus: string): React.CSSProperties => {
    const isLowest = quoteId === lowestTotalQuoteId
    const isApproved = inviteStatus === "approved"
    return isLowest
      ? { borderLeft: "3px solid #22c55e", borderBottom: "1px solid #e2e8f0" }
      : isApproved
      ? { borderLeft: "3px solid #10b981", borderBottom: "1px solid #e2e8f0" }
      : { borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
  }

  const handleCounterVendorChange = (inviteId: string) => {
    setCounterInviteId(inviteId)
    if (!inviteId) {
      setCounterForm({ price: "", freight: "", packing: "", service: "", delivery: "", warranty: "", currency: "INR", remarks: "" })
      return
    }
    const inv = filteredInvites.find(i => i.id === inviteId)
    const q   = inv?.quotes[inv.quotes.length - 1]
    setCounterForm({
      price:    q ? String(q.price)                         : "",
      freight:  q?.freight  != null ? String(q.freight)    : "",
      packing:  q?.packing  != null ? String(q.packing)    : "",
      service:  q?.service  != null ? String(q.service)    : "",
      delivery: q ? String(Math.round(q.deliveryDays / 7)) : "",
      warranty: q?.warranty != null ? String(q.warranty)   : "",
      currency: q?.currency ?? "INR",
      remarks:  "",
    })
  }

  const sendCounter = () => {
    if (!counterInviteId) return
    addNegotiationMessage(counterInviteId, {
      id: `nm-${Date.now()}`,
      by: "sourcing",
      senderName: "Sourcing Team",
      message: counterForm.remarks || "Counter-offer sent. Please review the revised targets and submit your updated quote.",
      counterPrice:    counterForm.price    ? Number(counterForm.price)                       : undefined,
      counterDelivery: counterForm.delivery ? Math.round(Number(counterForm.delivery) * 7)   : undefined,
      counterFreight:  counterForm.freight  ? Number(counterForm.freight)                     : undefined,
      counterRemarks:  counterForm.remarks  || undefined,
      type: "counter",
      at: new Date().toISOString(),
    })
    toast.success("Counter-offer sent to supplier")
    setCounterInviteId("")
    setCounterForm({ price: "", freight: "", packing: "", service: "", delivery: "", warranty: "", currency: "INR", remarks: "" })
  }

  return (
    <div className="space-y-4">

      {/* ═══════════════════════════════════════════
          TOOLBAR
      ═══════════════════════════════════════════ */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={tableSearch}
          onChange={e => setTableSearch(e.target.value)}
          placeholder="Search vendors in table…"
          className="flex-1 min-w-[180px] max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
        />
        <div className="ml-auto flex items-center gap-2">
          {isSourcing && (
            <Button size="sm" variant="outline" onClick={handleExport}
              className="text-xs font-medium gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Excel
            </Button>
          )}
          {isSourcing && (
            <Button
              size="sm"
              onClick={() => setPanelOpen(o => !o)}
              className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold gap-1.5 shadow-sm"
            >
              <Users className="w-3.5 h-3.5" />
              Add Vendors
              {panelOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </Button>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════
          SECTION 1 — VENDOR SELECTOR PANEL
      ═══════════════════════════════════════════ */}
      {isSourcing && panelOpen && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Vendor Directory</p>
            <p className="text-xs text-slate-400">{vendors.length} vendors total</p>
          </div>

          {/* Search + category filters */}
          <div className="px-4 pt-3 pb-2 space-y-2 border-b border-slate-100">
            <input
              value={searchDir}
              onChange={e => setSearchDir(e.target.value)}
              placeholder="Search by name or code…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
            <div className="flex flex-wrap gap-1.5">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCatFilter(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    catFilter === cat
                      ? "bg-amber-500 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Directory table */}
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-white text-[11px] uppercase tracking-wide">
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left">Vendor Name</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Contact</th>
                  <th className="px-3 py-2 text-left">Payment Terms</th>
                </tr>
              </thead>
              <tbody>
                {filteredDir.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-400">
                      No vendors match your filter.
                    </td>
                  </tr>
                )}
                {filteredDir.map((v, idx) => {
                  const isInvited = invitedVendorIds.has(v.id)
                  const isChecked = selected.has(v.id)
                  const rowBg = isInvited
                    ? "bg-slate-50 text-slate-400"
                    : idx % 2 === 0
                    ? "bg-white hover:bg-amber-50/40"
                    : "bg-slate-50/40 hover:bg-amber-50/40"
                  return (
                    <tr
                      key={v.id}
                      onClick={() => toggleVendor(v.id, isInvited)}
                      className={`cursor-pointer transition-colors ${rowBg}`}
                    >
                      <td className="border border-slate-100 px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isInvited}
                          onChange={() => toggleVendor(v.id, isInvited)}
                          onClick={e => e.stopPropagation()}
                          className="accent-amber-500 w-4 h-4 disabled:opacity-40"
                        />
                      </td>
                      <td className="border border-slate-100 px-3 py-2 font-medium text-slate-800">
                        {v.vendorName}
                        {isInvited && (
                          <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                            Invited
                          </span>
                        )}
                      </td>
                      <td className="border border-slate-100 px-3 py-2 font-mono text-xs text-slate-500">{v.vendorCode}</td>
                      <td className="border border-slate-100 px-3 py-2 text-slate-600">{v.category}</td>
                      <td className="border border-slate-100 px-3 py-2 text-slate-600">
                        <p className="font-medium text-slate-800">{v.contactName}</p>
                        <p className="text-xs text-slate-400">{v.contactEmail}</p>
                      </td>
                      <td className="border border-slate-100 px-3 py-2">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {v.paymentTerms}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              {selected.size > 0
                ? <span className="font-semibold text-slate-800">{selected.size} vendor{selected.size > 1 ? "s" : ""} selected</span>
                : "Select vendors to send RFQ"
              }
            </p>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={sendRFQ}
              className="bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold disabled:opacity-50 shadow-sm"
            >
              Send RFQ
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════
          SECTION 2 — COMPARISON TABLE (quote-per-column)
      ═══════════════════════════════════════════ */}
      {filteredInvites.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-14">
          <div className="flex flex-col items-center gap-2 text-slate-400">
            <PackageSearch className="w-9 h-9 opacity-30" />
            <p className="text-sm font-medium text-slate-500">No vendors invited.</p>
            <p className="text-xs">Use &ldquo;Add Vendors&rdquo; to send RFQs.</p>
          </div>
        </div>
      ) : (
        <>
        <div className="border border-slate-200 overflow-hidden bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">

              {/* ── Header row ── */}
              <thead>
                <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                  {/* Row label corner */}
                  <th className="sticky left-0 z-20 bg-slate-50 w-40 min-w-[160px]" style={{ borderRight: "2px solid #e2e8f0" }} />

                  {/* One column per submitted quote, sorted chronologically */}
                  {allQuotes.map(({ invite, vendor, quote, quoteIndex }) => {
                    const isApproved = invite.status === "approved"
                    const isLowest = quote.id === lowestTotalQuoteId
                    const isLatestForInvite = invite.quotes[invite.quotes.length - 1]?.id === quote.id
                    return (
                      <th key={quote.id}
                        className={`px-3 py-3 text-center min-w-[160px] ${isLowest ? "bg-green-50" : isApproved ? "bg-emerald-50" : "bg-slate-100"}`}
                        style={isLowest
                          ? { borderLeft: "3px solid #22c55e", borderBottom: "1px solid #e2e8f0" }
                          : isApproved
                          ? { borderLeft: "3px solid #10b981", borderBottom: "1px solid #e2e8f0" }
                          : { borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                        }
                      >
                        <p className="text-sm font-semibold text-slate-800 leading-tight">{vendor?.vendorName ?? "—"}</p>
                        <p className="text-xs text-slate-400">{vendor?.vendorCode ?? ""}</p>
                        <div className="flex items-center justify-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Q{quoteIndex + 1}</span>
                          <span className="text-[10px] text-slate-400">
                            {new Date(quote.submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                          {quote.attachmentName && <Paperclip className="w-2.5 h-2.5 text-slate-400" aria-label={quote.attachmentName} />}
                        </div>
                        <span className={`mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${INVITE_STATUS_COLORS[invite.status] ?? "bg-slate-200 text-slate-600"}`}>
                          {INVITE_STATUS_LABELS[invite.status] ?? invite.status}
                        </span>
                        <div className="flex items-center justify-center gap-1 mt-1.5">
                          <button onClick={() => copyLink(invite)} title="Copy supplier link"
                            className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <Copy className="w-3 h-3" />
                          </button>
                          {isLatestForInvite && (
                            <button onClick={() => setEmailOpenId(id => id === invite.id ? null : invite.id)} title="Email thread"
                              className={`p-1 rounded transition-colors ${emailOpenId === invite.id ? "bg-amber-100 text-amber-700" : "text-slate-400 hover:text-amber-600 hover:bg-amber-50"}`}>
                              <Mail className="w-3 h-3" />
                            </button>
                          )}
                          {currentRole === "sourcing_head" && isLatestForInvite && !isApproved && invite.quotes.length > 0 && (
                            <Button size="sm" onClick={() => approveInvite(invite.id)}
                              className="h-5 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white">
                              Approve
                            </Button>
                          )}
                        </div>
                      </th>
                    )
                  })}

                  {/* Awaiting-quote placeholder columns */}
                  {pendingInvites.map(inv => {
                    const vendor = vendors.find(v => v.id === inv.vendorId)
                    return (
                      <th key={inv.id}
                        className="px-3 py-3 text-center min-w-[160px] bg-slate-50 opacity-70"
                        style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}
                      >
                        <p className="text-sm font-semibold text-slate-700 leading-tight">{vendor?.vendorName ?? "—"}</p>
                        <p className="text-xs text-slate-400">{vendor?.vendorCode ?? ""}</p>
                        <span className="mt-1 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">
                          Awaiting Quote
                        </span>
                        <div className="flex items-center justify-center gap-1 mt-1.5">
                          <button onClick={() => copyLink(inv)} title="Copy supplier link"
                            className="p-1 rounded text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <Copy className="w-3 h-3" />
                          </button>
                          <button onClick={() => setEmailOpenId(id => id === inv.id ? null : inv.id)} title="Email thread"
                            className={`p-1 rounded transition-colors ${emailOpenId === inv.id ? "bg-amber-100 text-amber-700" : "text-slate-300 hover:text-amber-600 hover:bg-amber-50"}`}>
                            <Mail className="w-3 h-3" />
                          </button>
                        </div>
                      </th>
                    )
                  })}

                  {/* Counter Offer sticky column header — sourcing only */}
                  {isSourcing && (
                    <th className="sticky right-0 z-20 px-3 py-3 text-center min-w-[190px] bg-violet-50"
                      style={{ borderLeft: "2px solid #8b5cf6", borderBottom: "1px solid #e2e8f0" }}>
                      <p className="text-sm font-semibold text-violet-800">Counter Offer</p>
                      <select
                        value={counterInviteId}
                        onChange={e => handleCounterVendorChange(e.target.value)}
                        className="mt-1.5 border border-slate-200 rounded px-2 py-0.5 text-[11px] w-full bg-white focus:outline-none focus:ring-1 focus:ring-violet-400"
                      >
                        <option value="">Select vendor…</option>
                        {filteredInvites.filter(inv => inv.quotes.length > 0).map(inv => {
                          const v = vendors.find(vv => vv.id === inv.vendorId)
                          return <option key={inv.id} value={inv.id}>{v?.vendorName ?? inv.id}</option>
                        })}
                      </select>
                      {counterInviteId && counterForm.price && (
                        <Button size="sm" onClick={sendCounter}
                          className="mt-1.5 w-full h-6 text-[10px] bg-violet-600 hover:bg-violet-700 text-white">
                          Send to Supplier
                        </Button>
                      )}
                    </th>
                  )}

                </tr>
              </thead>

              <tbody>

                {/* ── Item Price row ── */}
                <tr className="bg-white">
                  <td className={labelTd} style={labelTdStyle}>Item Price (₹)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id}
                        className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700 font-semibold" : "text-slate-700"}`}
                        style={quoteCellStyle(quote.id, invite.status)}
                      >
                        ₹{quote.price.toLocaleString("en-IN")}
                        {isLowest && <span className="block text-[10px] text-green-500 font-semibold mt-0.5">↓ Lowest</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (
                    <td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60"
                      style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>
                  ))}
                  {isSourcing && (
                    <td className={ctCellBase} style={ctCellStyle}>
                      <input type="number" value={counterForm.price}
                        onChange={e => setCounterForm(f => ({ ...f, price: e.target.value }))}
                        placeholder="₹ Price" className={ctInput} />
                    </td>
                  )}
                </tr>

                {/* ── Freight row ── */}
                <tr className="bg-slate-50/50">
                  <td className={labelTd} style={labelTdStyle}>Freight (₹)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-600"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {quote.freight != null ? `₹${quote.freight.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && <td className={ctCellBase} style={ctCellStyle}><input type="number" value={counterForm.freight} onChange={e => setCounterForm(f => ({ ...f, freight: e.target.value }))} placeholder="₹ Freight" className={ctInput} /></td>}
                </tr>

                {/* ── Packing row ── */}
                <tr className="bg-white">
                  <td className={labelTd} style={labelTdStyle}>Packing (₹)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-600"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {quote.packing != null ? `₹${quote.packing.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && <td className={ctCellBase} style={ctCellStyle}><input type="number" value={counterForm.packing} onChange={e => setCounterForm(f => ({ ...f, packing: e.target.value }))} placeholder="₹ Packing" className={ctInput} /></td>}
                </tr>

                {/* ── Service row ── */}
                <tr className="bg-slate-50/50">
                  <td className={labelTd} style={labelTdStyle}>Service (₹)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-600"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {quote.service != null ? `₹${quote.service.toLocaleString("en-IN")}` : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && <td className={ctCellBase} style={ctCellStyle}><input type="number" value={counterForm.service} onChange={e => setCounterForm(f => ({ ...f, service: e.target.value }))} placeholder="₹ Service" className={ctInput} /></td>}
                </tr>

                {/* ── Delivery row ── */}
                <tr className="bg-white">
                  <td className={labelTd} style={labelTdStyle}>Delivery (wks)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    const weeks = Math.round(quote.deliveryDays / 7)
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-600"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {weeks} wk{weeks !== 1 ? "s" : ""}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && <td className={ctCellBase} style={ctCellStyle}><input type="number" value={counterForm.delivery} onChange={e => setCounterForm(f => ({ ...f, delivery: e.target.value }))} placeholder="Weeks" className={ctInput} /></td>}
                </tr>

                {/* ── Warranty row ── */}
                <tr className="bg-slate-50/50">
                  <td className={labelTd} style={labelTdStyle}>Warranty (yrs)</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-600"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {quote.warranty != null ? `${quote.warranty} yr${quote.warranty !== 1 ? "s" : ""}` : <span className="text-slate-300">—</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && <td className={ctCellBase} style={ctCellStyle}><input type="number" value={counterForm.warranty} onChange={e => setCounterForm(f => ({ ...f, warranty: e.target.value }))} placeholder="Years" className={ctInput} /></td>}
                </tr>

                {/* ── Currency row ── */}
                <tr className="bg-white">
                  <td className={labelTd} style={labelTdStyle}>Currency</td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    return (
                      <td key={quote.id} className={`px-4 py-2 text-center text-sm ${isLowest ? "bg-green-50 text-green-700" : "text-slate-500"}`} style={quoteCellStyle(quote.id, invite.status)}>
                        {quote.currency ?? "INR"}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (<td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60" style={{ borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>))}
                  {isSourcing && (
                    <td className={ctCellBase} style={ctCellStyle}>
                      <select value={counterForm.currency} onChange={e => setCounterForm(f => ({ ...f, currency: e.target.value }))}
                        className="border border-slate-200 rounded px-2 py-1 text-xs w-full bg-white focus:outline-none focus:ring-1 focus:ring-violet-400">
                        {["INR","USD","EUR","GBP","JPY","CNY"].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </td>
                  )}
                </tr>

                {/* ── Total Amount row ── */}
                <tr>
                  <td className="sticky left-0 z-10 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-700 uppercase tracking-wider whitespace-nowrap w-40 min-w-[160px]"
                    style={{ borderRight: "2px solid #e2e8f0", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                    Total Amount
                  </td>
                  {allQuotes.map(({ invite, quote }) => {
                    const isLowest = quote.id === lowestTotalQuoteId
                    const total = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0)
                    return (
                      <td key={quote.id}
                        className={`px-4 py-2 text-center text-sm font-bold ${isLowest ? "bg-green-50 text-green-700" : "text-slate-800"}`}
                        style={isLowest
                          ? { borderLeft: "3px solid #22c55e", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                          : invite.status === "approved"
                          ? { borderLeft: "3px solid #10b981", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                          : { borderLeft: "1px solid #e2e8f0", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                        }
                      >
                        ₹{total.toLocaleString("en-IN")}
                        {isLowest && <span className="block text-[10px] text-green-500 font-semibold mt-0.5">↓ Best</span>}
                      </td>
                    )
                  })}
                  {pendingInvites.map(inv => (
                    <td key={inv.id} className="px-4 py-2 text-center text-slate-300 opacity-60"
                      style={{ borderLeft: "1px solid #e2e8f0", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>
                  ))}
                  {isSourcing && (
                    <td className="sticky right-0 z-10 px-3 py-2 bg-violet-50"
                      style={{ borderLeft: "2px solid #8b5cf6", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                      {ctTotal > 0 ? (
                        <p className="text-sm font-bold text-violet-800 text-right">
                          ₹{ctTotal.toLocaleString("en-IN")}
                          <span className="block text-[10px] font-normal text-violet-500 mt-0.5">{counterForm.currency || "INR"}</span>
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 text-right">—</p>
                      )}
                    </td>
                  )}
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        {/* ── Counter-offer panel ── */}
        {counterInviteId && (() => {
          const inv = filteredInvites.find(i => i.id === counterInviteId)
          if (!inv) return null
          const vendor = vendors.find(v => v.id === inv.vendorId)
          const input = "border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-400/50 bg-white"
          return (
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-violet-200 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-violet-900">Send Counter-offer — {vendor?.vendorName}</p>
                  <p className="text-xs text-violet-600 mt-0.5">Edit the targets below and send. Supplier will see this in their portal and submit a revised quote.</p>
                </div>
                <button onClick={() => setCounterInviteId('')} className="text-violet-300 hover:text-violet-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Target Price (₹)</p>
                    <input type="number" value={counterForm.price} onChange={e => setCounterForm(f => ({ ...f, price: e.target.value }))} placeholder="e.g. 4500000" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Freight (₹)</p>
                    <input type="number" value={counterForm.freight} onChange={e => setCounterForm(f => ({ ...f, freight: e.target.value }))} placeholder="e.g. 20000" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Packing (₹)</p>
                    <input type="number" value={counterForm.packing} onChange={e => setCounterForm(f => ({ ...f, packing: e.target.value }))} placeholder="e.g. 5000" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Service (₹)</p>
                    <input type="number" value={counterForm.service} onChange={e => setCounterForm(f => ({ ...f, service: e.target.value }))} placeholder="e.g. 10000" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Delivery (weeks)</p>
                    <input type="number" value={counterForm.delivery} onChange={e => setCounterForm(f => ({ ...f, delivery: e.target.value }))} placeholder="e.g. 10" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Warranty (yrs)</p>
                    <input type="number" value={counterForm.warranty} onChange={e => setCounterForm(f => ({ ...f, warranty: e.target.value }))} placeholder="e.g. 2" className={input} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Currency</p>
                    <select value={counterForm.currency} onChange={e => setCounterForm(f => ({ ...f, currency: e.target.value }))} className={input}>
                      {["INR", "USD", "EUR", "GBP", "JPY", "CNY"].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Remarks / Message to Supplier</p>
                  <textarea value={counterForm.remarks} onChange={e => setCounterForm(f => ({ ...f, remarks: e.target.value }))} rows={2}
                    placeholder="e.g. Please revise your pricing to meet our budget targets…"
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-violet-400/50 resize-none bg-white" />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setCounterInviteId('')} className="text-xs">Cancel</Button>
                  <Button size="sm" onClick={sendCounter} disabled={!counterForm.price}
                    className="bg-violet-600 hover:bg-violet-700 text-white text-xs gap-1.5">
                    <Mail className="w-3 h-3" />
                    Send Counter-offer to Supplier
                  </Button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── Email thread expand panel ── */}
        {emailOpenId && (() => {
          const inv = filteredInvites.find(i => i.id === emailOpenId)
          if (!inv) return null
          const vendor = vendors.find(v => v.id === inv.vendorId)
          const latestQ = inv.quotes.length > 0 ? inv.quotes[inv.quotes.length - 1] : null
          const engineer = SOURCING_ENGINEERS.find(e => e.value === request.assignedTo)
          const supplierLink = buildSupplierLink(inv.token)
          return (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden shadow-sm">
              <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Email Thread — {vendor?.vendorName}</p>
                <button onClick={() => setEmailOpenId(null)} className="text-slate-300 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-5 py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Outgoing: RFQ to vendor */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase tracking-wide">Sent</span>
                        <span className="text-[11px] text-slate-400">{new Date(inv.invitedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                      </div>
                      {[
                        { k: "To",   v: `${vendor?.vendorName ?? "Vendor"} — ${vendor?.contactName ?? ""}` },
                        { k: "From", v: `${engineer?.name ?? "Sourcing"} · Amber Enterprises` },
                        { k: "Re",   v: `RFQ — ${request.subject} [${request.id}]` },
                      ].map(({ k, v }) => (
                        <div key={k} className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase w-8 shrink-0 pt-px">{k}</span>
                          <span className="text-[12px] text-slate-700 leading-tight">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-3 text-[12px] text-slate-600 leading-relaxed space-y-3">
                      <p>Dear {vendor?.contactName?.split(" ")[0] ?? "Team"},</p>
                      <p>We invite you to quote for the following CAPEX requirement. Please submit via the portal link.</p>
                      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-1.5">
                        {[
                          { label: "Item",      value: request.subject },
                          { label: "Category",  value: request.category },
                          { label: "Quantity",  value: request.quantity },
                          ...(request.budget ? [{ label: "Budget", value: "₹" + request.budget.toLocaleString("en-IN") }] : []),
                          ...(request.techSpecs.complianceStandards ? [{ label: "Compliance", value: request.techSpecs.complianceStandards }] : []),
                        ].map(({ label, value }) => (
                          <div key={label} className="flex gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase w-20 shrink-0 pt-px">{label}</span>
                            <span className="text-[12px] text-slate-700">{value}</span>
                          </div>
                        ))}
                      </div>
                      <a href={supplierLink} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500 text-white text-[12px] font-semibold hover:bg-amber-600 transition-colors">
                        <Mail className="w-3.5 h-3.5" />
                        Open Supplier Form
                      </a>
                    </div>
                  </div>

                  {/* Incoming: Quote from vendor */}
                  <div className={`bg-white rounded-xl border overflow-hidden ${latestQ ? "border-green-200" : "border-slate-200 opacity-60"}`}>
                    <div className={`border-b px-4 py-3 space-y-1.5 ${latestQ ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"}`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        {latestQ ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 uppercase tracking-wide">Received · Q{inv.quotes.length}</span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide">Awaiting Reply</span>
                        )}
                        {latestQ && (
                          <span className="text-[11px] text-slate-400">{new Date(latestQ.submittedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                        )}
                      </div>
                      {[
                        { k: "To",   v: `${engineer?.name ?? "Sourcing"} · Amber Enterprises` },
                        { k: "From", v: `${vendor?.vendorName ?? "Vendor"} — ${vendor?.contactName ?? ""}` },
                        { k: "Re",   v: `Quote — ${request.subject} [${request.id}]` },
                      ].map(({ k, v }) => (
                        <div key={k} className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase w-8 shrink-0 pt-px">{k}</span>
                          <span className="text-[12px] text-slate-700 leading-tight">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-3 text-[12px] text-slate-600 leading-relaxed space-y-3">
                      {latestQ ? (
                        <>
                          <p>Dear {engineer?.name?.split(" ")[0] ?? "Team"},</p>
                          <p>Please find our quotation for the above requirement.</p>
                          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-2">
                            {[
                              { label: "Unit Price",  value: "₹" + latestQ.price.toLocaleString("en-IN"), bold: true },
                              { label: "Delivery",    value: `${Math.round(latestQ.deliveryDays / 7)} weeks from PO`, bold: false },
                              { label: "Valid Until", value: new Date(latestQ.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), bold: false },
                            ].map(({ label, value, bold }) => (
                              <div key={label} className="flex gap-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase w-20 shrink-0 pt-px">{label}</span>
                                <span className={`text-[12px] ${bold ? "text-green-800 font-bold text-[14px]" : "text-slate-700"}`}>{value}</span>
                              </div>
                            ))}
                            {latestQ.note && (
                              <div className="flex gap-2 pt-1 border-t border-slate-100">
                                <span className="text-[10px] font-bold text-slate-400 uppercase w-20 shrink-0 pt-px">Notes</span>
                                <span className="text-[12px] text-slate-600 italic">{latestQ.note}</span>
                              </div>
                            )}
                          </div>
                          {inv.quotes.length > 1 && (
                            <p className="text-[11px] text-slate-400">
                              {inv.quotes.length} revisions submitted. Showing latest (Q{inv.quotes.length}).
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="py-6 text-center">
                          <p className="text-slate-400 text-[12px]">No quote received yet.</p>
                          <p className="text-slate-300 text-[11px] mt-1">Waiting for vendor to submit via the portal.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
        </>
      )}
    </div>
  )
}
