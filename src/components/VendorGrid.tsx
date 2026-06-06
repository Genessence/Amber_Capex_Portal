"use client"

import React, { useState, useMemo, useCallback, useRef } from "react"
import { toast } from "sonner"
import { Copy, FileSpreadsheet, Paperclip, Mail, X, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCapex } from "@/lib/capexContext"
import { buildSupplierLink } from "@/lib/tokenUtils"
import { INVITE_STATUS_COLORS, SOURCING_ENGINEERS, ROLE_NAMES } from "@/lib/constants"
import type { CapexRequest, CapexLineItem, VendorInvite, Vendor, Quote, SourcingDecision } from "@/lib/types"

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
  onSelectFinal?: (inviteId: string) => void
}

const isSourcingRole = (role: string) =>
  ["sourcing_member", "sourcing_member_2", "sourcing_member_3", "sourcing_member_4", "sourcing_head", "super_admin"].includes(role)

/* ── Shared style constants (module-level = stable references, no per-render DOM thrashing) ── */
const LABEL_TD_CLASS =
  "sticky left-0 z-10 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap w-44 min-w-[176px]"
const LABEL_TD_STYLE: React.CSSProperties = {
  borderRight: "2px solid #e2e8f0",
  borderBottom: "1px solid #e2e8f0",
}
const FD_CELL_BASE = "sticky right-0 z-10 px-3 py-2.5 bg-teal-50/50 min-w-[200px]"
const FD_CELL_STYLE: React.CSSProperties = {
  borderLeft: "2px solid #14b8a6",
  borderBottom: "1px solid #e2e8f0",
}
const FD_INPUT =
  "border border-slate-200 rounded-md px-2.5 py-1.5 text-xs w-full text-right focus:outline-none focus:ring-2 focus:ring-teal-400/50 bg-white placeholder:text-slate-300"

/* ItemRowGrid style constants — all at module level so references are stable across renders */
const tdBase = "px-2 py-2 text-xs"
const DIV_BR: React.CSSProperties  = { borderRight: "1px solid rgba(255,255,255,0.25)" }
const TD_BR: React.CSSProperties   = { borderRight: "1px solid #94a3b8", borderBottom: "1px solid #94a3b8" }
const TD_LAST: React.CSSProperties = { borderRight: "2px solid #0D9488", borderBottom: "1px solid #94a3b8" }

/* Sticky item column — two variants so no spread-on-render */
const ITEM_COL_EVEN: React.CSSProperties = { borderRight: "1px solid #94a3b8", borderBottom: "1px solid #94a3b8", background: "white" }
const ITEM_COL_ODD: React.CSSProperties  = { borderRight: "1px solid #94a3b8", borderBottom: "1px solid #94a3b8", background: "#F8FAFF" }

/* Vendor (Q) column header borders */
const Q_TH_FIRST: React.CSSProperties = { borderLeft: "2px solid #0D9488", borderBottom: "1px solid #e2e8f0" }
const Q_TH_REST: React.CSSProperties  = { borderLeft: "1px solid rgba(255,255,255,0.12)", borderBottom: "1px solid #e2e8f0" }

/* Vendor (Q) body cell borders */
const Q_BODY_FIRST: React.CSSProperties = { borderLeft: "2px solid #0D9488", borderBottom: "1px solid #94a3b8" }
const Q_BODY_REST: React.CSSProperties  = { borderLeft: "1px solid #94a3b8", borderBottom: "1px solid #94a3b8" }
const Q_BODY_LOW: React.CSSProperties   = { borderLeft: "2px solid #22c55e", borderBottom: "1px solid #94a3b8" }

/* Attribute / currency row vendor cell borders */
const ATTR_Q_FIRST: React.CSSProperties = { borderLeft: "3px solid #0D9488", borderBottom: "1px solid #94a3b8" }
const ATTR_Q_REST: React.CSSProperties  = { borderLeft: "1px solid #94a3b8", borderBottom: "1px solid #94a3b8" }

/* Total row vendor cell borders */
const TOTAL_Q_FIRST: React.CSSProperties = { borderLeft: "3px solid #0D9488" }
const TOTAL_Q_REST: React.CSSProperties  = { borderLeft: "1px solid #cbd5e1" }

/* Offer column borders */
const OFFER_BORDER: React.CSSProperties   = { borderLeft: "2px solid #f59e0b", borderBottom: "1px solid #94a3b8" }
const OFFER_TOTAL: React.CSSProperties    = { borderLeft: "2px solid #f59e0b" }
const ADD_OFFER_STYLE: React.CSSProperties = { borderLeft: "2px dashed #f59e0b", borderBottom: "1px solid #e2e8f0" }
const ADD_OFFER_TOTAL: React.CSSProperties = { borderLeft: "2px dashed #f59e0b" }

/* Final Decision borders */
const FD_BODY_STYLE: React.CSSProperties  = { borderLeft: "2px solid #0D9488", borderBottom: "1px solid #e2e8f0" }
const FD_TOTAL_STYLE: React.CSSProperties = { borderLeft: "2px solid #0D9488" }

/* Attribute label cell */
const ATTR_LABEL_STYLE: React.CSSProperties = { borderRight: "3px solid #0D9488", borderBottom: "1px solid #e2e8f0", minWidth: "0" }
const SEND_LABEL_STYLE: React.CSSProperties  = { borderRight: "3px solid #0D9488", borderBottom: "1px solid #e2e8f0" }
const TOTAL_LABEL_STYLE: React.CSSProperties = { borderRight: "3px solid #0D9488" }
const TOTAL_ROW_STYLE: React.CSSProperties   = { borderTop: "2px solid #0D9488" }

function quoteCellStyle(
  quoteId: string,
  lowestId: string | null,
  inviteStatus: string
): React.CSSProperties {
  const isLowest   = quoteId === lowestId
  const isApproved = inviteStatus === "approved"
  return isLowest
    ? { borderLeft: "3px solid #22c55e", borderBottom: "1px solid #e2e8f0" }
    : isApproved
    ? { borderLeft: "3px solid #10b981", borderBottom: "1px solid #e2e8f0" }
    : { borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
}

function LowestChip({ label = "Lowest" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 leading-none align-middle">
      ↓ {label}
    </span>
  )
}

/* ══════════════════════════════════════════════════════════════
   ITEMS-AS-ROWS GRID  (used when request.lineItems exists)
══════════════════════════════════════════════════════════════ */

interface OfferCol {
  id: string
  vendorId: string
  prices: Record<string, string>
  sent?: boolean
}

type VendorCol = { inv: VendorInvite; vendor: Vendor | undefined; latestQuote: Quote | null }

function vendorLabel(v: { vendorCode: string; vendorName: string }) {
  return `V${v.vendorCode} - ${v.vendorName}`
}

/* ── Memoized item body row — only re-renders when its own data changes ── */
interface ItemBodyRowProps {
  item: CapexLineItem
  idx: number
  vendorCols: VendorCol[]
  lowestItemColIdx: number | undefined
  visibleOfferCols: OfferCol[]
  isSourcing: boolean
  isLocked: boolean
  finalPrice: string
  finalDisc: string
  finalVendorId: string
  vendors: Vendor[]
  onSetOfferPrice: (colId: string, itemId: string, val: string) => void
  onSetFinalPrice: (key: string, val: string) => void
  onSetFinalVendor: (itemId: string, val: string) => void
}

const ItemBodyRow = React.memo(function ItemBodyRow({
  item, idx, vendorCols, lowestItemColIdx, visibleOfferCols, isSourcing, isLocked,
  finalPrice, finalDisc, finalVendorId, vendors,
  onSetOfferPrice, onSetFinalPrice, onSetFinalVendor,
}: ItemBodyRowProps) {
  const rowBg      = idx % 2 === 0 ? "bg-white" : "bg-[#F8FAFF]"
  const stickyBg   = idx % 2 === 0 ? ITEM_COL_EVEN : ITEM_COL_ODD

  const net = (() => {
    const p = Number(finalPrice ?? 0)
    const d = Number(finalDisc  ?? 0)
    const q = parseFloat(item.quantity) || 1
    return p * (1 - d / 100) * q
  })()

  return (
    <tr className={rowBg}>
      {/* Item sticky */}
      <td className={`sticky left-0 z-20 ${tdBase} min-w-[120px]`} style={stickyBg}>
        <p className="font-semibold text-slate-800 text-[12px] leading-snug">{item.description}</p>
        {item.masterItemId && <p className="text-[10px] text-slate-400 mt-0.5">{item.masterItemId}</p>}
        {item.masterHead && !item.masterItemId && <p className="text-[10px] text-slate-400 mt-0.5">{item.masterHead}</p>}
      </td>
      {/* Description */}
      <td className={`${tdBase} min-w-[140px]`} style={TD_BR}>
        <p className="text-slate-500 text-[11px] leading-snug">{item.remarks || <span className="text-slate-300">—</span>}</p>
      </td>
      {/* Qty */}
      <td className={`${tdBase} text-right text-slate-700 font-semibold w-14`} style={TD_LAST}>{item.quantity}</td>

      {/* Q vendor cells */}
      {vendorCols.map(({ inv, latestQuote }, colIdx) => {
        const isLowestItem = lowestItemColIdx === colIdx && !!latestQuote
        const isApproved   = inv.status === "approved"
        const price = latestQuote ? (latestQuote.itemPrices?.[item.id] ?? latestQuote.price) : 0
        const qty   = parseFloat(item.quantity) || 1
        const total = price * qty
        return (
          <td key={inv.id}
            className={["px-2 py-2 text-center text-xs",
              isLowestItem ? "bg-green-50" : isApproved ? "bg-emerald-50/60" : ""].join(" ")}
            style={isLowestItem ? Q_BODY_LOW : colIdx === 0 ? Q_BODY_FIRST : Q_BODY_REST}
          >
            {latestQuote ? (
              <>
                <p className={["font-bold text-[12px]", isLowestItem ? "text-green-700" : "text-slate-800"].join(" ")}>
                  ₹{price.toLocaleString("en-IN")}
                </p>
                <p className={["text-[11px]", isLowestItem ? "text-green-600" : "text-slate-500"].join(" ")}>
                  Total: ₹{total.toLocaleString("en-IN")}
                </p>
                {isLowestItem && (
                  <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 leading-none">↓ Lowest</span>
                )}
              </>
            ) : (
              <>
                <p className="font-bold text-[12px] text-slate-300">₹0</p>
                <p className="text-[11px] text-slate-200">Total: ₹0</p>
              </>
            )}
          </td>
        )
      })}

      {/* Offer col cells */}
      {visibleOfferCols.map(col => {
        const price = col.prices[item.id] ?? ""
        const qty   = parseFloat(item.quantity) || 1
        const total = Number(price) * qty
        const cellBg = col.sent ? "bg-emerald-50/70" : "bg-amber-50/60"
        return (
          <td key={col.id} className={`px-2 py-2 text-center text-xs ${cellBg}`} style={OFFER_BORDER}>
            {col.sent ? (
              <>
                <p className={["font-bold text-[12px]", price ? "text-emerald-800" : "text-slate-300"].join(" ")}>
                  {price ? "₹" + Number(price).toLocaleString("en-IN") : "₹0"}
                </p>
                {price && <p className="text-[11px] text-emerald-600 font-semibold">Total: ₹{total.toLocaleString("en-IN")}</p>}
              </>
            ) : (
              <>
                <input type="number" value={price}
                  onChange={e => onSetOfferPrice(col.id, item.id, e.target.value)}
                  placeholder="₹ price"
                  className="w-full text-xs text-right border border-amber-300 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-slate-300"
                />
                {price && <p className="text-[11px] text-amber-700 font-semibold mt-0.5">Total: ₹{total.toLocaleString("en-IN")}</p>}
              </>
            )}
          </td>
        )
      })}

      {/* Add offer spacer — hidden when locked */}
      {isSourcing && !isLocked && <td className="bg-slate-50/30" style={ADD_OFFER_STYLE} />}

      {/* Final Decision per-row — read-only when locked, editable when sourcing + not locked */}
      {(isSourcing || isLocked) && (
        <td className="sticky right-0 z-10 px-2 py-2 bg-[#F0FAF6] min-w-[210px]" style={FD_BODY_STYLE}>
          {isLocked ? (
            <div className="space-y-0.5">
              <p className="text-[12px] font-bold text-teal-800">
                {finalPrice ? "₹" + Number(finalPrice).toLocaleString("en-IN") : <span className="text-slate-300">—</span>}
              </p>
              {Number(finalDisc) > 0 && (
                <p className="text-[10px] text-teal-600">{finalDisc}% discount</p>
              )}
              <p className="text-[11px] text-slate-600 truncate">
                {vendors.find(v => v.id === finalVendorId)?.vendorName ?? <span className="text-slate-300">—</span>}
              </p>
              <p className="text-[11px] font-bold text-teal-700 text-right border-t border-teal-200 pt-0.5 mt-0.5">
                {"₹" + (net > 0 ? Math.round(net).toLocaleString("en-IN") : "0")}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 mb-1">
                <div className="flex-1">
                  <p className="text-[10px] font-bold text-teal-700 uppercase mb-0.5">Price (₹)</p>
                  <input type="number" placeholder="0" className={FD_INPUT}
                    value={finalPrice}
                    onChange={e => onSetFinalPrice(`${item.id}-price`, e.target.value)} />
                </div>
                <div className="w-14">
                  <p className="text-[10px] font-bold text-teal-700 uppercase mb-0.5">Disc (%)</p>
                  <input type="number" placeholder="0" className={FD_INPUT}
                    value={finalDisc}
                    onChange={e => onSetFinalPrice(`${item.id}-disc`, e.target.value)} />
                </div>
              </div>
              <div className="mb-1">
                <p className="text-[10px] font-bold text-teal-700 uppercase mb-0.5">Select Vendor</p>
                <select
                  value={finalVendorId}
                  onChange={e => onSetFinalVendor(item.id, e.target.value)}
                  className="border border-slate-200 rounded px-1.5 py-1 text-xs w-full bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 text-slate-700"
                >
                  <option value="">Select Vendor</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{vendorLabel(v)}</option>)}
                </select>
              </div>
              <p className="text-[11px] font-bold text-teal-700 text-right">
                {"Price × QTY: ₹" + (net > 0 ? Math.round(net).toLocaleString("en-IN") : "0")}
              </p>
            </>
          )}
        </td>
      )}
    </tr>
  )
})

function ItemRowGrid({ request, invites, vendors, currentRole, onSelectFinal }: Props) {
  const { approveInvite, updateRequest, inviteVendors } = useCapex()
  const items = request.lineItems!
  const isSourcing = isSourcingRole(currentRole)
  const isLocked   = request.status === "sourcing_approved" || request.status === "buyer_approved"

  // Cache each VendorCol by invite id so stable references survive re-renders
  // where that invite's data didn't change — lets React.memo bail out per-row.
  const vendorColCache = useRef<Map<string, VendorCol>>(new Map())
  const vendorCols = useMemo<VendorCol[]>(() => {
    const next = new Map<string, VendorCol>()
    const cols = invites.map(inv => {
      const latestQuote = inv.quotes.length > 0 ? inv.quotes[inv.quotes.length - 1] : null
      const vendor = vendors.find(v => v.id === inv.vendorId)
      const prev = vendorColCache.current.get(inv.id)
      // Reuse previous object reference when nothing that affects rendering changed
      if (
        prev &&
        prev.inv === inv &&
        prev.vendor === vendor &&
        prev.latestQuote === latestQuote
      ) {
        next.set(inv.id, prev)
        return prev
      }
      const col: VendorCol = { inv, vendor, latestQuote }
      next.set(inv.id, col)
      return col
    })
    vendorColCache.current = next
    return cols
  }, [invites, vendors])

  const approvedInviteId = useMemo(
    () => invites.find(i => i.status === "approved")?.id ?? null,
    [invites]
  )

  const saved = request.sourcingDecision

  const [offerCols, setOfferCols] = useState<OfferCol[]>(() => {
    if (!saved?.offerCols?.length) return []
    return saved.offerCols.map((oc, i) => ({
      id: `restored-${i}`,
      vendorId: oc.vendorId,
      prices: oc.prices,
      sent: true,
    }))
  })
  const [finalPrices, setFinalPrices] = useState<Record<string, string>>(saved?.finalPrices ?? {})
  const [finalVendorPerItem, setFinalVendorPerItem] = useState<Record<string, string>>(saved?.finalVendorPerItem ?? {})

  const [fdAttr, setFdAttr] = useState({
    freight:  saved?.freight  ?? "",
    packing:  saved?.packing  ?? "",
    service:  saved?.service  ?? "",
    delivery: saved?.delivery ?? "",
    warranty: saved?.warranty ?? "",
    currency: saved?.currency ?? "INR",
  })
  function setFdAttrField(field: keyof typeof fdAttr, val: string) {
    setFdAttr(prev => ({ ...prev, [field]: val }))
  }

  const [offerAttrs, setOfferAttrs] = useState<Record<string, Record<string, string>>>(() => {
    if (!saved?.offerCols?.length) return {}
    const attrs: Record<string, Record<string, string>> = {}
    saved.offerCols.forEach((oc, i) => { attrs[`restored-${i}`] = oc.attrs ?? {} })
    return attrs
  })
  function setOfferAttr(colId: string, field: string, val: string) {
    setOfferAttrs(prev => ({ ...prev, [colId]: { ...(prev[colId] ?? {}), [field]: val } }))
  }

  /* Stable callbacks — functional updates so no closure over state */
  const onSetOfferPrice = useCallback((colId: string, itemId: string, val: string) => {
    setOfferCols(prev => prev.map(o => o.id === colId ? { ...o, prices: { ...o.prices, [itemId]: val } } : o))
  }, [])

  const onSetFinalPrice = useCallback((key: string, val: string) => {
    setFinalPrices(p => ({ ...p, [key]: val }))
  }, [])

  const onSetFinalVendor = useCallback((itemId: string, val: string) => {
    setFinalVendorPerItem(p => ({ ...p, [itemId]: val }))
  }, [])

  function buildDecision(): SourcingDecision {
    return {
      finalPrices,
      finalVendorPerItem,
      freight:  fdAttr.freight  || undefined,
      packing:  fdAttr.packing  || undefined,
      service:  fdAttr.service  || undefined,
      delivery: fdAttr.delivery || undefined,
      warranty: fdAttr.warranty || undefined,
      currency: fdAttr.currency,
      offerCols: offerCols.map(col => ({
        vendorId: col.vendorId,
        prices:   col.prices,
        attrs:    offerAttrs[col.id] ?? {},
      })),
      savedAt: new Date().toISOString(),
    }
  }

  function handleSave() {
    updateRequest(request.id, { sourcingDecision: buildDecision() })
    toast.success("Changes saved")
  }

  function handleSendQuoteToSupplier(col: OfferCol) {
    if (!col.vendorId) { toast.error("Select a vendor first"); return }
    updateRequest(request.id, { sourcingDecision: buildDecision() })
    const alreadyInvited = invites.find(i => i.vendorId === col.vendorId && i.requestId === request.id)
    if (alreadyInvited) {
      navigator.clipboard.writeText(buildSupplierLink(alreadyInvited.token))
        .then(() => toast.success("Supplier link copied"))
        .catch(() => toast.success("Vendor already invited"))
    } else {
      inviteVendors(request.id, [col.vendorId])
      const v = vendors.find(vv => vv.id === col.vendorId)
      toast.success(`Quote sent to ${v ? vendorLabel(v) : "vendor"} — invite created`)
    }
    lockOfferCol(col.id)
  }

  function addOfferCol() {
    setOfferCols(prev => [...prev, { id: crypto.randomUUID(), vendorId: "", prices: {} }])
  }
  function removeOfferCol(id: string) {
    const col = offerCols.find(o => o.id === id)
    if (col?.sent) toast("Offer column removed — supplier invite remains active")
    setOfferCols(prev => prev.filter(o => o.id !== id))
    setOfferAttrs(prev => { const next = { ...prev }; delete next[id]; return next })
  }
  function lockOfferCol(id: string) {
    setOfferCols(prev => prev.map(o => o.id === id ? { ...o, sent: true } : o))
  }
  function setOfferVendor(id: string, vendorId: string) {
    setOfferCols(prev => prev.map(o => o.id === id ? { ...o, vendorId } : o))
  }

  const copyLink = (inv: VendorInvite) => {
    navigator.clipboard.writeText(buildSupplierLink(inv.token))
      .then(() => toast.success("Supplier link copied"))
      .catch(() => toast.error("Could not copy to clipboard"))
  }

  const TH_FIXED = "bg-[#1A3A6E] text-white px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider"
  const TH_Q     = "px-2 py-2 text-center min-w-[120px] bg-[#1A3A6E] text-white"
  const TH_FD    = "sticky right-0 z-20 px-3 py-2 min-w-[210px] bg-[#1A6B5A] text-white text-left"

  const lowestPerItem = useMemo(() => {
    const result: Record<string, number> = {}
    for (const item of items) {
      let min = Infinity, minIdx = -1
      vendorCols.forEach(({ latestQuote }, i) => {
        if (!latestQuote) return
        const p = latestQuote.itemPrices?.[item.id] ?? latestQuote.price
        if (p < min) { min = p; minIdx = i }
      })
      if (minIdx >= 0) result[item.id] = minIdx
    }
    return result
  }, [items, vendorCols])

  const visibleOfferCols = useMemo(
    () => offerCols.filter(col => !col.vendorId || !vendorCols.some(vc => vc.inv.vendorId === col.vendorId)),
    [offerCols, vendorCols]
  )

  const fdGrand = useMemo(() =>
    items.reduce((sum, item) => {
      const p = Number(finalPrices[`${item.id}-price`] ?? 0)
      const d = Number(finalPrices[`${item.id}-disc`]  ?? 0)
      const q = parseFloat(item.quantity) || 1
      return sum + p * (1 - d / 100) * q
    }, 0),
  [items, finalPrices])

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" aria-label="Request comparison grid">

          {/* ── Header ── */}
          <thead>
            <tr style={TOTAL_ROW_STYLE}>
              <th scope="col" className={`sticky left-0 z-30 ${TH_FIXED} min-w-[120px] text-left`} style={DIV_BR}>Item</th>
              <th scope="col" className={`${TH_FIXED} min-w-[140px] text-left`} style={DIV_BR}>Description</th>
              <th scope="col" className={`${TH_FIXED} w-14 text-right`} style={{ borderRight: "2px solid #0D9488" }}># Qty</th>

              {vendorCols.map(({ inv, vendor, latestQuote }, colIdx) => {
                const isApproved = inv.status === "approved"
                return (
                  <th key={inv.id} scope="col"
                    className={[TH_Q, isApproved ? "!bg-emerald-700" : ""].join(" ")}
                    style={colIdx === 0 ? Q_TH_FIRST : Q_TH_REST}
                  >
                    <div className="flex items-center justify-center gap-1 mb-1">
                      <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">Q{colIdx + 1}</span>
                      <span className="text-[10px] text-white/60">{vendor?.vendorCode}</span>
                    </div>
                    <p className="text-[11px] font-bold text-white truncate max-w-[112px] mx-auto leading-tight" title={vendor?.vendorName}>
                      {vendor?.vendorName ?? "—"}
                    </p>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      {latestQuote?.attachmentName && (
                        <span className="flex items-center gap-0.5 text-[10px] text-white/60 truncate max-w-[90px]">
                          <Paperclip className="w-2.5 h-2.5 shrink-0" />{latestQuote.attachmentName}
                        </span>
                      )}
                      <button onClick={() => copyLink(inv)} className="p-0.5 rounded text-white/50 hover:text-white transition-colors" title="Copy supplier link">
                        <Copy className="w-3 h-3" />
                      </button>
                      {currentRole === "sourcing_head" && !isApproved && latestQuote && (
                        <button onClick={() => { approveInvite(inv.id); onSelectFinal?.(inv.id) }}
                          className="px-1.5 py-0.5 rounded bg-emerald-400 hover:bg-emerald-300 text-white text-[10px] font-bold"
                          disabled={!!approvedInviteId}>✓ OK</button>
                      )}
                    </div>
                  </th>
                )
              })}

              {visibleOfferCols.map(col => {
                const v = vendors.find(vv => vv.id === col.vendorId)
                const existingInvite = col.vendorId
                  ? invites.find(i => i.vendorId === col.vendorId && i.requestId === request.id)
                  : undefined
                const headerBg = col.sent ? "bg-[#1A5C3A]" : "bg-amber-500"
                return (
                  <th key={col.id} scope="col"
                    className={`px-2 py-2 text-center min-w-[180px] text-white ${headerBg}`}
                    style={OFFER_BORDER}
                  >
                    {col.sent ? (
                      <>
                        <div className="flex items-center justify-center gap-1 mb-1">
                          <span className="text-[10px] font-bold bg-white/20 px-1.5 py-0.5 rounded">✓ Sent</span>
                          {existingInvite && (
                            <button onClick={() => copyLink(existingInvite)} title="Copy supplier link"
                              className="p-0.5 rounded bg-white/20 hover:bg-white/40 text-white">
                              <Mail className="w-3 h-3" />
                            </button>
                          )}
                          <button onClick={() => removeOfferCol(col.id)} className="shrink-0 text-white/50 hover:text-white">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-[11px] font-bold text-white truncate max-w-[108px] mx-auto">{v?.vendorName ?? "—"}</p>
                        <p className="text-[10px] text-white/60">{v?.vendorCode}</p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 mb-1">
                          <select value={col.vendorId} onChange={e => setOfferVendor(col.id, e.target.value)}
                            className="flex-1 text-[11px] border border-amber-300 rounded px-1.5 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400 w-full">
                            <option value="">Select vendor…</option>
                            {vendors.map(vv => <option key={vv.id} value={vv.id}>{vendorLabel(vv)}</option>)}
                          </select>
                          <button onClick={() => removeOfferCol(col.id)} className="shrink-0 text-white/70 hover:text-white">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">+ Offer</span>
                          {existingInvite && (
                            <button onClick={() => copyLink(existingInvite)} title="Copy supplier link"
                              className="p-0.5 rounded bg-white/20 hover:bg-white/40 text-white">
                              <Mail className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {v && <p className="text-[10px] text-white/80 truncate mt-0.5">{v.vendorName}</p>}
                      </>
                    )}
                  </th>
                )
              })}

              {isSourcing && !isLocked && (
                <th scope="col" onClick={addOfferCol}
                  className="px-2 py-2 text-center w-16 bg-slate-50 cursor-pointer hover:bg-amber-50 transition-colors"
                  style={ADD_OFFER_STYLE}>
                  <div className="flex flex-col items-center gap-0.5 text-amber-400">
                    <span className="text-lg font-bold leading-none">+</span>
                    <span className="text-[10px] font-semibold uppercase">Add Offer</span>
                  </div>
                </th>
              )}

              {(isSourcing || isLocked) && (
                <th scope="col" className={TH_FD} style={FD_BODY_STYLE}>
                  <p className="text-xs font-bold text-white">Final Decision</p>
                  {isLocked
                    ? <p className="text-[10px] text-green-300 mt-0.5 font-semibold">🔒 Locked</p>
                    : <p className="text-[10px] text-white/60 mt-0.5">Price · Disc · Vendor · Total</p>
                  }
                </th>
              )}
            </tr>
          </thead>

          {/* ── Body: one memoized row per line item ── */}
          <tbody>
            {items.map((item, idx) => (
              <ItemBodyRow
                key={item.id}
                item={item}
                idx={idx}
                vendorCols={vendorCols}
                lowestItemColIdx={lowestPerItem[item.id]}
                visibleOfferCols={visibleOfferCols}
                isSourcing={isSourcing}
                isLocked={isLocked}
                finalPrice={finalPrices[`${item.id}-price`] ?? ""}
                finalDisc={finalPrices[`${item.id}-disc`] ?? ""}
                finalVendorId={finalVendorPerItem[item.id] ?? ""}
                vendors={vendors}
                onSetOfferPrice={onSetOfferPrice}
                onSetFinalPrice={onSetFinalPrice}
                onSetFinalVendor={onSetFinalVendor}
              />
            ))}

            {/* ── Attribute rows ── */}
            {[
              { key: "freight",  label: "Transportation / Freight",   placeholder: "Enter freight",            getVal: (q: Quote) => q.freight  != null ? String(q.freight)  : "0" },
              { key: "packing",  label: "Packing / Forwarding",       placeholder: "Enter packing charges",    getVal: (q: Quote) => q.packing  != null ? String(q.packing)  : "0" },
              { key: "service",  label: "Service / Installation",     placeholder: "Enter service / install",  getVal: (q: Quote) => q.service  != null ? String(q.service)  : "0" },
              { key: "delivery", label: "Delivery Lead Time (Weeks)", placeholder: "Enter delivery lead time", getVal: (q: Quote) => String(Math.round(q.deliveryDays / 7)) },
              { key: "warranty", label: "Warranty (Years)",           placeholder: "Enter warranty",           getVal: (q: Quote) => q.warranty != null ? String(q.warranty) : "0" },
            ].map((attr, attrIdx) => (
              <tr key={attr.key} className={attrIdx % 2 === 0 ? "bg-slate-50/70" : "bg-white"}>
                <td colSpan={3}
                  className="sticky left-0 z-10 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 whitespace-nowrap"
                  style={ATTR_LABEL_STYLE}>
                  {attr.label}
                </td>
                {vendorCols.map(({ inv, latestQuote }, colIdx) => (
                  <td key={inv.id}
                    className="px-2 py-2 text-center text-xs text-slate-600"
                    style={colIdx === 0 ? ATTR_Q_FIRST : ATTR_Q_REST}>
                    {latestQuote ? attr.getVal(latestQuote) : <span className="text-slate-300">0</span>}
                  </td>
                ))}
                {visibleOfferCols.map(col => {
                  const val = offerAttrs[col.id]?.[attr.key] ?? ""
                  return (
                    <td key={col.id}
                      className={["px-2 py-2 text-center", col.sent ? "bg-emerald-50/50" : "bg-amber-50/40"].join(" ")}
                      style={OFFER_BORDER}>
                      {col.sent ? (
                        <p className={["text-xs font-semibold text-center", val ? "text-emerald-800" : "text-slate-300"].join(" ")}>{val || "0"}</p>
                      ) : (
                        <input type="number" placeholder="0" value={val}
                          onChange={e => setOfferAttr(col.id, attr.key, e.target.value)}
                          className="w-full text-xs text-right border border-amber-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-slate-300"
                        />
                      )}
                    </td>
                  )
                })}
                {isSourcing && !isLocked && <td className="bg-slate-50/40" style={ADD_OFFER_STYLE} />}
                {(isSourcing || isLocked) && (
                  <td className="sticky right-0 z-10 px-3 py-2 bg-teal-50/60 min-w-[190px]" style={FD_BODY_STYLE}>
                    {isLocked ? (
                      <p className="text-xs font-semibold text-teal-800 text-right">
                        {fdAttr[attr.key as keyof typeof fdAttr] || <span className="text-slate-300">—</span>}
                      </p>
                    ) : (
                      <input type="number"
                        placeholder={attr.placeholder}
                        value={fdAttr[attr.key as keyof typeof fdAttr]}
                        onChange={e => setFdAttrField(attr.key as keyof typeof fdAttr, e.target.value)}
                        className={FD_INPUT}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}

            {/* Currency row */}
            <tr className="bg-slate-50/70">
              <td colSpan={3}
                className="sticky left-0 z-10 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 whitespace-nowrap"
                style={ATTR_LABEL_STYLE}>
                Currency
              </td>
              {vendorCols.map(({ inv, latestQuote }, colIdx) => (
                <td key={inv.id}
                  className="px-2 py-2 text-center text-xs text-slate-600"
                  style={colIdx === 0 ? ATTR_Q_FIRST : ATTR_Q_REST}>
                  {latestQuote?.currency ?? "INR"}
                </td>
              ))}
              {visibleOfferCols.map(col => {
                const cur = offerAttrs[col.id]?.currency ?? "INR"
                return (
                  <td key={col.id}
                    className={["px-2 py-2 text-center", col.sent ? "bg-emerald-50/50" : "bg-amber-50/40"].join(" ")}
                    style={OFFER_BORDER}>
                    {col.sent ? (
                      <span className="text-xs font-semibold text-emerald-800">{cur}</span>
                    ) : (
                      <select value={cur} onChange={e => setOfferAttr(col.id, "currency", e.target.value)}
                        className="border border-amber-200 rounded px-1.5 py-0.5 text-xs w-full bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
                        {["INR", "USD", "EUR", "GBP", "JPY", "CNY"].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    )}
                  </td>
                )
              })}
              {isSourcing && !isLocked && <td className="bg-slate-50/40" style={ADD_OFFER_STYLE} />}
              {(isSourcing || isLocked) && (
                <td className="sticky right-0 z-10 px-3 py-2 bg-teal-50/60 min-w-[190px]" style={FD_BODY_STYLE}>
                  {isLocked ? (
                    <p className="text-xs font-semibold text-teal-800 text-right">{fdAttr.currency}</p>
                  ) : (
                    <select value={fdAttr.currency} onChange={e => setFdAttrField("currency", e.target.value)}
                      className="border border-slate-200 rounded px-2 py-1 text-xs w-full bg-white focus:outline-none focus:ring-2 focus:ring-teal-400/50">
                      {["INR", "USD", "EUR", "GBP", "JPY", "CNY"].map(c => (
                        <option key={c} value={c}>{c === "INR" ? "INR - Indian Rupee" : c}</option>
                      ))}
                    </select>
                  )}
                </td>
              )}
            </tr>

            {/* ── Total Amount row ── */}
            <tr style={TOTAL_ROW_STYLE} className="bg-slate-100">
              <td colSpan={3}
                className="sticky left-0 z-10 px-3 py-2 text-xs font-bold text-slate-800 bg-slate-200 uppercase tracking-wider"
                style={TOTAL_LABEL_STYLE}>
                Total Amount
              </td>
              {vendorCols.map(({ inv, latestQuote }, colIdx) => {
                const q = latestQuote
                const total = q
                  ? items.reduce((s, item) => s + q.price * (parseFloat(item.quantity) || 1), 0)
                    + (q.freight ?? 0) + (q.packing ?? 0) + (q.service ?? 0)
                  : 0
                return (
                  <td key={inv.id}
                    className="px-2 py-2 text-center text-xs font-bold text-slate-800 bg-slate-100"
                    style={colIdx === 0 ? TOTAL_Q_FIRST : TOTAL_Q_REST}>
                    {total > 0 ? "₹" + Math.round(total).toLocaleString("en-IN") : <span className="text-slate-400">₹0</span>}
                  </td>
                )
              })}
              {visibleOfferCols.map(col => {
                const itemTotal = items.reduce((s, item) => s + (Number(col.prices[item.id] ?? 0) * (parseFloat(item.quantity) || 1)), 0)
                const freight   = Number(offerAttrs[col.id]?.freight ?? 0)
                const packing   = Number(offerAttrs[col.id]?.packing ?? 0)
                const service   = Number(offerAttrs[col.id]?.service ?? 0)
                const grand     = itemTotal + freight + packing + service
                return (
                  <td key={col.id} className="px-2 py-2 text-center text-xs font-bold bg-amber-100"
                    style={OFFER_TOTAL}>
                    {grand > 0 ? <span className="text-amber-800">₹{Math.round(grand).toLocaleString("en-IN")}</span> : <span className="text-slate-400">₹0</span>}
                  </td>
                )
              })}
              {isSourcing && !isLocked && <td className="bg-slate-100" style={ADD_OFFER_TOTAL} />}
              {(isSourcing || isLocked) && (
                <td className="sticky right-0 z-10 px-3 py-2 bg-teal-100 min-w-[210px]" style={FD_TOTAL_STYLE}>
                  <p className="text-sm font-bold text-teal-800 text-right">
                    {"₹" + (fdGrand > 0 ? Math.round(fdGrand).toLocaleString("en-IN") : "0")}
                  </p>
                </td>
              )}
            </tr>

            {/* ── Send Quote to Supplier row ── */}
            {isSourcing && !isLocked && visibleOfferCols.length > 0 && (
              <tr className="bg-amber-50/30">
                <td colSpan={3}
                  className="sticky left-0 z-10 px-3 py-2 text-xs font-semibold text-slate-400 bg-amber-50/50 whitespace-nowrap"
                  style={SEND_LABEL_STYLE}>
                  Send to Supplier
                </td>
                {vendorCols.map(({ inv }, colIdx) => (
                  <td key={inv.id} className="bg-white"
                    style={colIdx === 0 ? ATTR_Q_FIRST : ATTR_Q_REST} />
                ))}
                {visibleOfferCols.map(col => (
                  <td key={col.id}
                    className={["px-2 py-2 text-center", col.sent ? "bg-emerald-50/50" : "bg-amber-50/60"].join(" ")}
                    style={OFFER_BORDER}>
                    {col.sent ? (
                      <span className="text-[11px] font-semibold text-emerald-700">✓ Sent</span>
                    ) : (
                      <button
                        onClick={() => handleSendQuoteToSupplier(col)}
                        disabled={!col.vendorId}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
                      >
                        <Mail className="w-3 h-3" />
                        Send Quote
                      </button>
                    )}
                  </td>
                ))}
                <td className="bg-slate-50/40" style={ADD_OFFER_STYLE} />
                <td className="sticky right-0 z-10 bg-teal-50/30 min-w-[190px]" style={FD_BODY_STYLE} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Review Request footer — hidden when decision is locked ── */}
      {isSourcing && !isLocked && (
        <div className="border-t border-slate-200 px-5 py-4 flex items-center justify-between gap-4 bg-white">
          <div>
            <p className="text-sm font-bold text-slate-800">Review Request</p>
            <p className="text-xs text-slate-500 mt-0.5">Review the request details above before making your decision</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                updateRequest(request.id, { status: "rejected" }, ROLE_NAMES[currentRole] ?? currentRole)
                toast.error("Request rejected")
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => {
                handleSave()
                updateRequest(request.id, { status: "sourcing_approved" }, ROLE_NAMES[currentRole] ?? currentRole)
                toast.success("Request approved — sent to buyer")
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#153f90] hover:bg-[#1a4da8] text-white text-xs font-semibold transition-colors"
            >
              ✓ Approve
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   LEGACY ATTRIBUTE-ROWS GRID  (requests without lineItems)
══════════════════════════════════════════════════════════════ */
function AttributeRowGrid({ request, invites, vendors, currentRole, onSelectFinal }: Props) {
  const { approveInvite, addNegotiationMessage } = useCapex()

  const [tableSearch,   setTableSearch]   = useState("")
  const [emailOpenId,   setEmailOpenId]   = useState<string | null>(null)
  const [finalInviteId, setFinalInviteId] = useState("")
  const [finalForm, setFinalForm] = useState({
    price: "", freight: "", packing: "", service: "",
    delivery: "", warranty: "", currency: "INR", remarks: "",
  })

  const copyLink = (inv: VendorInvite) => {
    navigator.clipboard.writeText(buildSupplierLink(inv.token))
      .then(() => toast.success("Supplier link copied"))
      .catch(() => toast.error("Could not copy to clipboard"))
  }

  const filteredInvites = useMemo(() => {
    if (!tableSearch) return invites
    return invites.filter(inv => {
      const v = vendors.find(v => v.id === inv.vendorId)
      return v?.vendorName.toLowerCase().includes(tableSearch.toLowerCase())
    })
  }, [invites, vendors, tableSearch])

  const allQuotes = useMemo(() => {
    const result: Array<{ invite: VendorInvite; vendor: Vendor | undefined; quote: Quote; quoteIndex: number }> = []
    filteredInvites.forEach(inv => {
      const vendor = vendors.find(v => v.id === inv.vendorId)
      inv.quotes.forEach((quote, quoteIndex) => result.push({ invite: inv, vendor, quote, quoteIndex }))
    })
    result.sort((a, b) => new Date(a.quote.submittedAt).getTime() - new Date(b.quote.submittedAt).getTime())
    return result
  }, [filteredInvites, vendors])

  const pendingInvites = useMemo(
    () => filteredInvites.filter(inv => inv.quotes.length === 0),
    [filteredInvites]
  )

  const lowestTotalQuoteId = useMemo(() => {
    if (allQuotes.length < 2) return null
    let minTotal = Infinity, minId = ""
    allQuotes.forEach(({ quote }) => {
      const total = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0)
      if (total < minTotal) { minTotal = total; minId = quote.id }
    })
    return minId || null
  }, [allQuotes])

  const finalTotal = useMemo(() =>
    (Number(finalForm.price) || 0) + (Number(finalForm.freight) || 0) +
    (Number(finalForm.packing) || 0) + (Number(finalForm.service) || 0),
  [finalForm])

  const finalDecisionRows = useMemo(() =>
    invites.filter(inv => inv.quotes.length > 0).map(inv => {
      const vendor = vendors.find(v => v.id === inv.vendorId)
      const quote  = inv.quotes[inv.quotes.length - 1]
      const total  = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0)
      return { inv, vendor, quote, total }
    }).sort((a, b) => a.total - b.total),
  [invites, vendors])

  const approvedInviteId = useMemo(
    () => invites.find(i => i.status === "approved")?.id ?? null,
    [invites]
  )

  const isSourcing = isSourcingRole(currentRole)
  const totalColCount = 1 + allQuotes.length + pendingInvites.length + (isSourcing ? 1 : 0)

  const handleFinalVendorChange = (inviteId: string) => {
    setFinalInviteId(inviteId)
    if (!inviteId) { setFinalForm({ price: "", freight: "", packing: "", service: "", delivery: "", warranty: "", currency: "INR", remarks: "" }); return }
    const inv = filteredInvites.find(i => i.id === inviteId)
    const q   = inv?.quotes[inv.quotes.length - 1]
    setFinalForm({
      price:    q ? String(q.price) : "",
      freight:  q?.freight  != null ? String(q.freight)  : "",
      packing:  q?.packing  != null ? String(q.packing)  : "",
      service:  q?.service  != null ? String(q.service)  : "",
      delivery: q ? String(Math.round(q.deliveryDays / 7)) : "",
      warranty: q?.warranty != null ? String(q.warranty) : "",
      currency: q?.currency ?? "INR",
      remarks:  "",
    })
  }

  const sendFinalDecision = () => {
    if (!finalInviteId) return
    addNegotiationMessage(finalInviteId, {
      id: `nm-fd-${Date.now()}`, by: "sourcing", senderName: "Sourcing Team",
      message: finalForm.remarks || "Final decision: Please confirm acceptance of the terms below.",
      counterPrice:    finalForm.price    ? Number(finalForm.price)                    : undefined,
      counterDelivery: finalForm.delivery ? Math.round(Number(finalForm.delivery) * 7) : undefined,
      counterFreight:  finalForm.freight  ? Number(finalForm.freight)                  : undefined,
      counterRemarks:  finalForm.remarks  || undefined,
      type: "counter", at: new Date().toISOString(),
    })
    toast.success("Final decision sent to supplier")
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={tableSearch} onChange={e => setTableSearch(e.target.value)}
          placeholder="Search vendors…"
          className="flex-1 min-w-[160px] max-w-sm rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0D9488]/50" />
        {isSourcing && (
          <Button size="sm" variant="outline"
            onClick={async () => { try { const { exportVendorGridToExcel } = await import("@/lib/exportUtils"); exportVendorGridToExcel(request, invites, vendors) } catch { toast.error("Export failed") } }}
            className="ml-auto text-xs font-medium gap-1.5 shrink-0">
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
          </Button>
        )}
      </div>

      <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: "2px solid #e2e8f0" }}>
                <th className="sticky left-0 z-20 bg-slate-50 w-44 min-w-[176px]"
                  style={{ borderRight: "2px solid #e2e8f0" }} aria-label="Row labels" />
                {allQuotes.map(({ invite, vendor, quote, quoteIndex }) => {
                  const isApproved = invite.status === "approved"
                  const isLowest   = quote.id === lowestTotalQuoteId
                  const isLatest   = invite.quotes[invite.quotes.length - 1]?.id === quote.id
                  return (
                    <th key={quote.id} scope="col"
                      className={["px-3 py-3 text-center min-w-[168px]",
                        isLowest ? "bg-green-50" : isApproved ? "bg-emerald-50" : "bg-slate-50"].join(" ")}
                      style={quoteCellStyle(quote.id, lowestTotalQuoteId, invite.status)}>
                      <p className="text-sm font-semibold text-slate-800">{vendor?.vendorName ?? "—"}</p>
                      <p className="text-xs text-slate-400">{vendor?.vendorCode ?? ""}</p>
                      <div className="flex items-center justify-center gap-1.5 mt-1">
                        <span className="text-xs font-bold text-slate-500 uppercase">Q{quoteIndex + 1}</span>
                        <span className="text-xs text-slate-400">{new Date(quote.submittedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                        {quote.attachmentName && <Paperclip className="w-3 h-3 text-slate-400" />}
                      </div>
                      <span className={["mt-1.5 inline-block text-xs font-semibold px-2 py-0.5 rounded-full", INVITE_STATUS_COLORS[invite.status] ?? "bg-slate-200 text-slate-600"].join(" ")}>
                        {INVITE_STATUS_LABELS[invite.status] ?? invite.status}
                      </span>
                      <div className="flex items-center justify-center gap-1 mt-2">
                        <button onClick={() => copyLink(invite)} className="p-1.5 rounded-md text-slate-400 hover:text-[#0D9488] hover:bg-[#CCFBF1] transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                        {isLatest && <button onClick={() => setEmailOpenId(id => id === invite.id ? null : invite.id)} className={["p-1.5 rounded-md transition-colors", emailOpenId === invite.id ? "bg-[#CCFBF1] text-[#0D9488]" : "text-slate-400 hover:text-[#0D9488] hover:bg-[#CCFBF1]"].join(" ")}><Mail className="w-3.5 h-3.5" /></button>}
                        {currentRole === "sourcing_head" && isLatest && !isApproved && invite.quotes.length > 0 && (
                          <Button size="sm" onClick={() => approveInvite(invite.id)} className="h-6 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white ml-0.5">Approve</Button>
                        )}
                      </div>
                    </th>
                  )
                })}
                {pendingInvites.map(inv => {
                  const vendor = vendors.find(v => v.id === inv.vendorId)
                  return (
                    <th key={inv.id} scope="col"
                      className="px-3 py-3 text-center min-w-[168px] bg-slate-50/60 opacity-75"
                      style={{ borderLeft: "1px dashed #cbd5e1", borderBottom: "1px solid #e2e8f0" }}>
                      <p className="text-sm font-semibold text-slate-600">{vendor?.vendorName ?? "—"}</p>
                      <p className="text-xs text-slate-400">{vendor?.vendorCode ?? ""}</p>
                      <span className="mt-1.5 inline-block text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">Awaiting Quote</span>
                      <div className="flex items-center justify-center gap-1 mt-2">
                        <button onClick={() => copyLink(inv)} className="p-1.5 rounded-md text-slate-300 hover:text-[#0D9488] hover:bg-[#CCFBF1] transition-colors"><Copy className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEmailOpenId(id => id === inv.id ? null : inv.id)} className={["p-1.5 rounded-md transition-colors", emailOpenId === inv.id ? "bg-[#CCFBF1] text-[#0D9488]" : "text-slate-300 hover:text-[#0D9488] hover:bg-[#CCFBF1]"].join(" ")}><Mail className="w-3.5 h-3.5" /></button>
                      </div>
                    </th>
                  )
                })}
                {isSourcing && (
                  <th scope="col" className="sticky right-0 z-20 px-4 py-3 min-w-[200px] bg-teal-50 text-left"
                    style={{ borderLeft: "2px solid #14b8a6", borderBottom: "1px solid #e2e8f0" }}>
                    <p className="text-sm font-bold text-teal-800 mb-2">Final Decision</p>
                    <select value={finalInviteId} onChange={e => handleFinalVendorChange(e.target.value)}
                      className="border border-slate-200 rounded-md px-2.5 py-1.5 text-xs w-full bg-white focus:outline-none focus:ring-2 focus:ring-teal-400/50 text-slate-700">
                      <option value="">Select vendor…</option>
                      {filteredInvites.filter(i => i.quotes.length > 0).map(inv => {
                        const v = vendors.find(vv => vv.id === inv.vendorId)
                        return <option key={inv.id} value={inv.id}>{v?.vendorName ?? inv.id}</option>
                      })}
                    </select>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 && (
                <tr>
                  <td colSpan={totalColCount || 2} className="px-6 py-14 text-center">
                    <div className="flex flex-col items-center gap-2.5 text-slate-400">
                      <Users className="w-9 h-9 opacity-30" />
                      <p className="text-sm font-semibold text-slate-500">No vendors invited yet</p>
                      <p className="text-xs text-slate-400 max-w-xs leading-relaxed">Use the Onboard Vendor panel to invite vendors and request quotes.</p>
                    </div>
                  </td>
                </tr>
              )}
              {invites.length > 0 && (
                <>
                  {[
                    { label: "Item Price (₹)", key: "price",    bg: "bg-white",       getValue: (q: Quote) => `₹${q.price.toLocaleString("en-IN")}`, getFD: () => <input type="number" value={finalForm.price}    onChange={e => setFinalForm(f => ({ ...f, price:    e.target.value }))} placeholder="₹ Price"   className={FD_INPUT} /> },
                    { label: "Freight (₹)",    key: "freight",  bg: "bg-slate-50/40", getValue: (q: Quote) => q.freight  != null ? `₹${q.freight.toLocaleString("en-IN")}` : "—",  getFD: () => <input type="number" value={finalForm.freight}  onChange={e => setFinalForm(f => ({ ...f, freight:  e.target.value }))} placeholder="₹ Freight" className={FD_INPUT} /> },
                    { label: "Packing (₹)",    key: "packing",  bg: "bg-white",       getValue: (q: Quote) => q.packing  != null ? `₹${q.packing.toLocaleString("en-IN")}` : "—",  getFD: () => <input type="number" value={finalForm.packing}  onChange={e => setFinalForm(f => ({ ...f, packing:  e.target.value }))} placeholder="₹ Packing" className={FD_INPUT} /> },
                    { label: "Service (₹)",    key: "service",  bg: "bg-slate-50/40", getValue: (q: Quote) => q.service  != null ? `₹${q.service.toLocaleString("en-IN")}` : "—",  getFD: () => <input type="number" value={finalForm.service}  onChange={e => setFinalForm(f => ({ ...f, service:  e.target.value }))} placeholder="₹ Service" className={FD_INPUT} /> },
                    { label: "Delivery (wks)", key: "delivery", bg: "bg-white",       getValue: (q: Quote) => `${Math.round(q.deliveryDays / 7)} wks`, getFD: () => <input type="number" value={finalForm.delivery} onChange={e => setFinalForm(f => ({ ...f, delivery: e.target.value }))} placeholder="Weeks"    className={FD_INPUT} /> },
                    { label: "Warranty (yrs)", key: "warranty", bg: "bg-slate-50/40", getValue: (q: Quote) => q.warranty != null ? `${q.warranty} yr${q.warranty !== 1 ? "s" : ""}` : "—", getFD: () => <input type="number" value={finalForm.warranty} onChange={e => setFinalForm(f => ({ ...f, warranty: e.target.value }))} placeholder="Years"    className={FD_INPUT} /> },
                  ].map(row => (
                    <tr key={row.key} className={row.bg}>
                      <td className={LABEL_TD_CLASS} style={LABEL_TD_STYLE}>{row.label}</td>
                      {allQuotes.map(({ invite, quote }) => {
                        const isLowest = quote.id === lowestTotalQuoteId
                        return (
                          <td key={quote.id}
                            className={["px-4 py-2.5 text-center text-sm", isLowest ? "bg-green-50 text-green-700 font-semibold" : "text-slate-700"].join(" ")}
                            style={quoteCellStyle(quote.id, lowestTotalQuoteId, invite.status)}>
                            {row.getValue(quote)}
                            {isLowest && row.key === "price" && <LowestChip />}
                          </td>
                        )
                      })}
                      {pendingInvites.map(inv => (
                        <td key={inv.id} className="px-4 py-2.5 text-center text-slate-300"
                          style={{ borderLeft: "1px dashed #cbd5e1", borderBottom: "1px solid #e2e8f0" }}>—</td>
                      ))}
                      {isSourcing && <td className={FD_CELL_BASE} style={FD_CELL_STYLE}>{row.getFD()}</td>}
                    </tr>
                  ))}
                  <tr>
                    <td className="sticky left-0 z-10 bg-[#CCFBF1] px-4 py-3 text-xs font-bold text-[#115E59] uppercase tracking-wider whitespace-nowrap w-44 min-w-[176px]"
                      style={{ borderRight: "2px solid #e2e8f0", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                      Total Amount
                    </td>
                    {allQuotes.map(({ invite, quote }) => {
                      const isLowest = quote.id === lowestTotalQuoteId
                      const total = quote.price + (quote.freight ?? 0) + (quote.packing ?? 0) + (quote.service ?? 0)
                      return (
                        <td key={quote.id}
                          className={["px-4 py-3 text-center text-sm font-bold", isLowest ? "bg-green-50 text-green-700" : "text-slate-800"].join(" ")}
                          style={isLowest ? { borderLeft: "3px solid #22c55e", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                            : invite.status === "approved" ? { borderLeft: "3px solid #10b981", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }
                            : { borderLeft: "1px solid #e2e8f0", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                          ₹{total.toLocaleString("en-IN")}
                          {isLowest && <LowestChip label="Best" />}
                        </td>
                      )
                    })}
                    {pendingInvites.map(inv => (
                      <td key={inv.id} className="px-4 py-3 text-center text-slate-300"
                        style={{ borderLeft: "1px dashed #cbd5e1", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>—</td>
                    ))}
                    {isSourcing && (
                      <td className="sticky right-0 z-10 px-4 py-3 bg-teal-50/50 min-w-[200px]"
                        style={{ borderLeft: "2px solid #14b8a6", borderTop: "2px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                        {finalTotal > 0
                          ? <p className="text-sm font-bold text-teal-800 text-right">₹{finalTotal.toLocaleString("en-IN")}<span className="block text-xs font-normal text-teal-500 mt-0.5">{finalForm.currency || "INR"}</span></p>
                          : <p className="text-xs text-slate-400 text-right">—</p>}
                      </td>
                    )}
                  </tr>
                  {isSourcing && finalInviteId && (
                    <tr>
                      <td className={LABEL_TD_CLASS} style={{ ...LABEL_TD_STYLE, borderTop: "1px solid #e2e8f0" }}>Remarks</td>
                      <td colSpan={allQuotes.length + pendingInvites.length} className="px-4 py-2.5 bg-white" style={{ borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                        <input type="text" value={finalForm.remarks} onChange={e => setFinalForm(f => ({ ...f, remarks: e.target.value }))}
                          placeholder="Optional note to supplier…" className="border border-slate-200 rounded-md px-3 py-1.5 text-sm w-full max-w-md focus:outline-none focus:ring-2 focus:ring-teal-400/50" />
                      </td>
                      <td className="sticky right-0 z-10 px-4 py-2.5 bg-teal-50/50 min-w-[200px]"
                        style={{ borderLeft: "2px solid #14b8a6", borderTop: "1px solid #e2e8f0", borderBottom: "1px solid #e2e8f0" }}>
                        <Button size="sm" onClick={sendFinalDecision} disabled={!finalForm.price}
                          className="w-full text-xs bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
                          Send Decision
                        </Button>
                      </td>
                    </tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {emailOpenId && (() => {
        const inv    = filteredInvites.find(i => i.id === emailOpenId)
        if (!inv) return null
        const vendor = vendors.find(v => v.id === inv.vendorId)
        const latestQ = inv.quotes.length > 0 ? inv.quotes[inv.quotes.length - 1] : null
        const engineer = SOURCING_ENGINEERS.find(e => e.value === request.assignedTo)
        const supplierLink = buildSupplierLink(inv.token)
        return (
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden shadow-sm">
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Email Thread — {vendor?.vendorName}</p>
              <button onClick={() => setEmailOpenId(null)} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 mb-1"><span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 uppercase">Sent</span><span className="text-xs text-slate-400">{new Date(inv.invitedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span></div>
                    {[{ k: "To", v: `${vendor?.vendorName ?? "Vendor"} — ${vendor?.contactName ?? ""}` }, { k: "From", v: `${engineer?.name ?? "Sourcing"} · Amber Enterprises` }, { k: "Re", v: `RFQ — ${request.subject} [${request.id}]` }].map(({ k, v }) => (
                      <div key={k} className="flex items-start gap-2"><span className="text-[10px] font-bold text-slate-400 uppercase w-8 shrink-0 pt-px">{k}</span><span className="text-xs text-slate-700">{v}</span></div>
                    ))}
                  </div>
                  <div className="px-4 py-3 text-xs text-slate-600 leading-relaxed space-y-3">
                    <p>Dear {vendor?.contactName?.split(" ")[0] ?? "Team"},</p>
                    <p>We invite you to quote for the following CAPEX requirement.</p>
                    <a href={supplierLink} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0D9488] text-white text-xs font-semibold hover:bg-[#115E59] transition-colors"><Mail className="w-3.5 h-3.5" />Open Supplier Form</a>
                  </div>
                </div>
                <div className={["bg-white rounded-xl border overflow-hidden", latestQ ? "border-green-200" : "border-slate-200 opacity-60"].join(" ")}>
                  <div className={["border-b px-4 py-3", latestQ ? "bg-green-50 border-green-200" : "bg-slate-50 border-slate-200"].join(" ")}>
                    <div className="flex items-center gap-1.5 mb-1">{latestQ ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 uppercase">Received · Q{inv.quotes.length}</span> : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 uppercase">Awaiting Reply</span>}</div>
                  </div>
                  <div className="px-4 py-3 text-xs text-slate-600 space-y-3">
                    {latestQ ? (
                      <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-2">
                        {[{ label: "Unit Price", value: "₹" + latestQ.price.toLocaleString("en-IN"), bold: true }, { label: "Delivery", value: `${Math.round(latestQ.deliveryDays / 7)} weeks`, bold: false }, { label: "Valid Until", value: new Date(latestQ.validUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }), bold: false }].map(({ label, value, bold }) => (
                          <div key={label} className="flex gap-2"><span className="text-[10px] font-bold text-slate-400 uppercase w-20 shrink-0">{label}</span><span className={bold ? "text-sm font-bold text-green-800" : "text-xs text-slate-700"}>{value}</span></div>
                        ))}
                      </div>
                    ) : <div className="py-6 text-center"><p className="text-sm text-slate-400">No quote received yet.</p></div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {finalDecisionRows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-bold text-slate-800">Vendor Shortlist</p>
            {approvedInviteId && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">Vendor Selected</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead><tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                {["Vendor", "Base Price", "Freight", "Packing", "Service", "Total", "Delivery", "Warranty", "Status", ...(currentRole === "sourcing_head" ? ["Action"] : [])].map(h => (
                  <th key={h} scope="col" className={["px-4 py-2.5 font-semibold", h === "Vendor" ? "text-left" : h === "Action" ? "text-center" : "text-right"].join(" ")}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {finalDecisionRows.map(({ inv, vendor, quote, total }, idx) => {
                  const isLowest   = idx === 0
                  const isApproved = inv.id === approvedInviteId
                  return (
                    <tr key={inv.id} className={["border-b border-slate-100 last:border-b-0", isApproved ? "border-l-4 border-l-emerald-600 bg-emerald-50/30" : isLowest ? "border-l-4 border-l-green-500 bg-green-50/40" : "border-l-4 border-l-transparent"].join(" ")}>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-800">{vendor?.vendorName ?? "—"}</p><p className="text-xs text-slate-400">{vendor?.vendorCode ?? ""}</p>{isLowest && !isApproved && <span className="text-xs font-semibold text-green-600">↓ Cheapest</span>}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-700">₹{quote.price.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{quote.freight != null ? `₹${quote.freight.toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{quote.packing != null ? `₹${quote.packing.toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{quote.service != null ? `₹${quote.service.toLocaleString("en-IN")}` : "—"}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800">₹{total.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{Math.round(quote.deliveryDays / 7)} wks</td>
                      <td className="px-4 py-3 text-center text-slate-600">{quote.warranty != null ? `${quote.warranty} yr${quote.warranty !== 1 ? "s" : ""}` : "—"}</td>
                      <td className="px-4 py-3 text-center"><span className={["text-xs font-semibold px-2 py-0.5 rounded-full", INVITE_STATUS_COLORS[inv.status] ?? "bg-slate-200 text-slate-600"].join(" ")}>{INVITE_STATUS_LABELS[inv.status] ?? inv.status}</span></td>
                      {currentRole === "sourcing_head" && <td className="px-4 py-3 text-center">{isApproved ? <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">✓ Selected</span> : <button disabled={!!approvedInviteId} onClick={() => { approveInvite(inv.id); onSelectFinal?.(inv.id) }} className="px-3 py-1.5 rounded-lg bg-[#0D9488] hover:bg-[#115E59] text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Select as Final</button>}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════
   PUBLIC EXPORT — picks the right layout automatically
══════════════════════════════════════════════════════════════ */
export function VendorGrid(props: Props) {
  if (props.request.lineItems && props.request.lineItems.length > 0) {
    return <ItemRowGrid {...props} />
  }
  return <AttributeRowGrid {...props} />
}
