/**
 * MOBILE single-vendor quotation cards for the tokenised supplier portal — the `lg:hidden`
 * counterpart to `SupplierQuoteTable`. One card per line item (description + capacity/specs/
 * remarks, Qty × UOM, HSN, unit price, live line total), mirroring the stacked per-vendor cards
 * in `RfqPanel.tsx` but collapsed to the single supplier viewing the page.
 *
 * Shares the exact same `variant` + controlled props as the desktop table so GST and grand-total
 * math (rfqUtils) MATCH between the two layouts:
 *   - `read`  : unit + line total static; HSN as text; read-mode charges block + grand total.
 *   - `entry` : unit cell = controlled input; HSN = `<select>`. Charges live in the form sections.
 *   - `bid`   : like entry, for the auction. The `threshold` is a WHOLE-QUOTE ceiling, so there is
 *               no per-line threshold chip or over-threshold border here — that authoritative
 *               signal lives in the page (header chip + summary card).
 */
import type { CapexLineItem, RfqQuote } from "@/lib/types";
import { INPUT_RIGHT, LABEL, fmtCurrency } from "@/lib/auctionTheme";
import { rfqTotal, rfqGstAmount, rfqLineGstRate, rfqLineUnitPrice } from "@/lib/rfqUtils";
import { HSN_GST_OPTIONS, gstRateForHsn } from "@/lib/hsnGst";
import type { SupplierQuoteVariant } from "./SupplierQuoteTable";

export interface SupplierQuoteCardsProps {
  variant: SupplierQuoteVariant;
  lineItems: CapexLineItem[];
  quote?: RfqQuote;
  linePrices?: Record<string, string>;
  onLinePrice?: (itemId: string, value: string) => void;
  hsnByItem?: Record<string, string>;
  onHsnChange?: (itemId: string, value: string) => void;
  /** Read-mode only: render the charges block + grand-total summary below the cards (default true). */
  showFooter?: boolean;
  /** Optional per-line slot under the description (auction uses it for the cross-vendor best-price hint). */
  renderLineExtra?: (item: CapexLineItem) => React.ReactNode;
}

const ATTR_ROWS: Array<{ label: string; value: (q?: RfqQuote, gst?: number) => string }> = [
  { label: "Transportation / Freight", value: q => (q?.freight != null ? fmtCurrency(q.freight) : "—") },
  { label: "Packing / Forwarding", value: q => (q?.packing != null ? fmtCurrency(q.packing) : "—") },
  { label: "Service / Installation", value: q => (q?.service != null ? fmtCurrency(q.service) : "—") },
  {
    label: "Delivery Lead Time",
    value: q => (q?.deliveryWeeks != null ? `${q.deliveryWeeks} week${q.deliveryWeeks !== 1 ? "s" : ""}` : "—"),
  },
  {
    label: "Warranty",
    value: q => (q?.warranty != null ? `${q.warranty} year${q.warranty !== 1 ? "s" : ""}` : "—"),
  },
  { label: "GST (as per HSN)", value: (_q, gst) => ((gst ?? 0) > 0 ? fmtCurrency(gst ?? 0) : "—") },
  { label: "Currency", value: q => q?.currency ?? "INR" },
];

export function SupplierQuoteCards({
  variant,
  lineItems,
  quote,
  linePrices,
  onLinePrice,
  hsnByItem,
  onHsnChange,
  showFooter = true,
  renderLineExtra,
}: SupplierQuoteCardsProps) {
  const isRead = variant === "read";
  const hasLinePrices = !!quote?.linePrices && Object.keys(quote.linePrices).length > 0;

  const unitOf = (item: CapexLineItem): number =>
    isRead ? (hasLinePrices ? rfqLineUnitPrice(quote, item.id) ?? 0 : 0) : Number(linePrices?.[item.id] ?? 0);

  const gst = rfqGstAmount(quote, lineItems);
  const total = rfqTotal(quote, lineItems);

  return (
    <div className="space-y-3">
      {lineItems.map((item, idx) => {
        const unit = unitOf(item);
        const qty = parseFloat(item.quantity) || 1;
        const lineTotal = unit * qty;
        const hsn = onHsnChange ? hsnByItem?.[item.id] ?? "" : item.hsnCode ?? "";
        return (
          <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
            {/* Header: index + description + qty/uom */}
            <div className="flex items-start gap-2">
              <span className="text-xs font-bold text-slate-300 w-5 shrink-0 mt-0.5">{idx + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-800 leading-snug">{item.description}</p>
                {item.machineCapacity && <p className="text-[11px] text-sky-700 mt-0.5">Capacity: {item.machineCapacity}</p>}
                {item.specs && <p className="text-[11px] text-slate-500 mt-0.5">{item.specs}</p>}
                {item.remarks && <p className="text-[11px] text-slate-500 mt-0.5">{item.remarks}</p>}
                {renderLineExtra?.(item)}
              </div>
              <span className="text-sm font-bold text-slate-600 shrink-0">×{item.quantity}{item.uom ? ` ${item.uom}` : ""}</span>
            </div>

            {/* HSN */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5">
              <span className={LABEL + " mb-0"}>HSN / GST</span>
              {onHsnChange ? (
                <div className="w-44">
                  <select
                    value={hsn}
                    onChange={e => onHsnChange(item.id, e.target.value)}
                    aria-label={`HSN code for ${item.description}`}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 min-h-[44px]"
                  >
                    <option value="">Select HSN…</option>
                    {HSN_GST_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} · {o.gst}%</option>)}
                  </select>
                  {hsn && <p className="text-[10px] text-emerald-700 font-semibold mt-0.5 text-right">GST {gstRateForHsn(hsn)}%</p>}
                </div>
              ) : hsn ? (
                <span className="text-xs text-slate-700">{hsn} <span className="text-emerald-700 font-semibold">· {rfqLineGstRate(item)}%</span></span>
              ) : (
                <span className="text-xs text-slate-300">—</span>
              )}
            </div>

            {/* Unit price */}
            <div className="flex items-center justify-between gap-3">
              <span className={LABEL + " mb-0"}>
                Unit Price (₹){!isRead && <span className="text-red-500"> *</span>}
              </span>
              {isRead ? (
                <span className="text-sm font-semibold tabular-nums text-slate-800">{hasLinePrices ? fmtCurrency(unit) : "—"}</span>
              ) : (
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  required
                  placeholder="0"
                  aria-label={`Unit price for ${item.description}`}
                  value={linePrices?.[item.id] ?? ""}
                  onChange={e => onLinePrice?.(item.id, e.target.value)}
                  className={`${INPUT_RIGHT} min-h-[44px] w-40`}
                />
              )}
            </div>

            {/* Line total */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
              <span className="text-xs font-semibold text-slate-500">Line Total</span>
              <span className="text-sm font-bold tabular-nums text-slate-900">{lineTotal > 0 ? fmtCurrency(lineTotal) : "—"}</span>
            </div>
          </div>
        );
      })}

      {/* Read-mode charges block + grand total (entry/bid keep their own form sections). */}
      {isRead && showFooter && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {ATTR_ROWS.map(attr => (
            <div key={attr.label} className="flex items-center justify-between px-4 py-2 border-b border-slate-100 text-sm">
              <span className="text-slate-500">{attr.label}</span>
              <span className="font-semibold tabular-nums text-slate-800">{attr.value(quote, gst)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-[#F0F4FB]">
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-700">Grand Total <span className="font-normal text-slate-400">(incl. GST)</span></span>
              {total > 0 && gst > 0 && <span className="text-[10px] text-slate-400">incl. {fmtCurrency(gst)} GST</span>}
            </div>
            <span className="text-xl font-black text-[#2563EB] tabular-nums">{total > 0 ? fmtCurrency(total) : "—"}</span>
          </div>
        </div>
      )}
    </div>
  );
}
