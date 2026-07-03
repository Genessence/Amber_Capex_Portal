/**
 * DESKTOP single-vendor quotation table for the tokenised supplier portal. Mirrors the internal
 * sourcing comparison grid (`RfqPanel.tsx` — navy `#171717` header, `text-[10px]` uppercase white
 * labels, alternating `bg-white`/`#FAFAFA` rows, `bg-[#F4F4F5]` grand-total row with an
 * "incl. ₹X GST" subtitle), collapsed to a SINGLE vendor (the supplier viewing the page): line
 * items become rows, with the vendor's own Unit Price + Line Total columns.
 *
 * Three `variant`s share one component so the read summaries, the RFQ entry form, and the auction
 * bid table all render with identical math (rfqUtils) and the same visual language:
 *   - `read`  : unit + line total static; HSN shown as `code · X%`; attribute rows + grand total.
 *   - `entry` : unit cell = controlled number input; HSN cell = `<select>` of HSN options.
 *   - `bid`   : like entry, for the reverse auction. The auction `threshold` is a WHOLE-QUOTE
 *               ceiling, so there is no per-line threshold column or over-threshold border here —
 *               that authoritative signal lives in the page (header chip + summary card).
 *
 * Render this inside a `hidden lg:block` wrapper; `SupplierQuoteCards` covers below `lg`.
 */
import type { CapexLineItem, RfqQuote } from "@/lib/types";
import { INPUT_RIGHT, fmtCurrency } from "@/lib/auctionTheme";
import { rfqTotal, rfqGstAmount, rfqLineGstRate, rfqLineUnitPrice } from "@/lib/rfqUtils";
import { HSN_GST_OPTIONS, gstRateForHsn } from "@/lib/hsnGst";
import { TABLE_WRAP } from "@/lib/uiTokens";

export type SupplierQuoteVariant = "read" | "entry" | "bid";

export interface SupplierQuoteTableProps {
  variant: SupplierQuoteVariant;
  lineItems: CapexLineItem[];
  /** The vendor's quotation. Used for read-mode prices/attributes and grand-total math. */
  quote?: RfqQuote;
  /** Controlled per-line unit prices (string-keyed) for entry/bid variants. */
  linePrices?: Record<string, string>;
  onLinePrice?: (itemId: string, value: string) => void;
  /** Controlled per-line HSN selections for the entry variant (vendor sets HSN per line). */
  hsnByItem?: Record<string, string>;
  onHsnChange?: (itemId: string, value: string) => void;
  /** Whether to render the read-mode attribute rows + grand-total footer (default true). */
  showFooter?: boolean;
  /** Optional per-line slot under the description (auction uses it for the cross-vendor best-price hint). */
  renderLineExtra?: (item: CapexLineItem) => React.ReactNode;
}

/** Read-mode attribute rows beneath the line items (freight/packing/service/etc.). */
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

const TH = "px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider";

export function SupplierQuoteTable({
  variant,
  lineItems,
  quote,
  linePrices,
  onLinePrice,
  hsnByItem,
  onHsnChange,
  showFooter = true,
  renderLineExtra,
}: SupplierQuoteTableProps) {
  const isRead = variant === "read";

  const hasLinePrices = !!quote?.linePrices && Object.keys(quote.linePrices).length > 0;

  // Unit price for a row: read pulls from the quote; entry/bid from the controlled map.
  const unitOf = (item: CapexLineItem): number =>
    isRead ? (hasLinePrices ? rfqLineUnitPrice(quote, item.id) ?? 0 : 0) : Number(linePrices?.[item.id] ?? 0);

  // GST computed identically to the mobile cards: built from the quote + per-item HSN.
  const gst = rfqGstAmount(quote, lineItems);
  const total = rfqTotal(quote, lineItems);

  // Column span for the attribute-row label cell = all columns except the trailing value column.
  // Layout is 7 columns (# / Description / Qty / UOM / HSN / Unit Price / Line Total) across every
  // variant, so the label fills the first 6. (Attribute rows only ever render in the read variant.)
  const labelSpan = 6;

  return (
    <div className={TABLE_WRAP}>
      <table className="w-full text-sm border-collapse min-w-[640px]" aria-label="Your quotation">
        <thead>
          <tr className="bg-[#171717] text-white">
            <th scope="col" className={`${TH} text-left w-10`}>#</th>
            <th scope="col" className={`${TH} text-left`}>Description</th>
            <th scope="col" className={`${TH} text-center w-16`}>Qty</th>
            <th scope="col" className={`${TH} text-center w-16`}>UOM</th>
            <th scope="col" className={`${TH} text-center ${onHsnChange ? "w-44" : "w-28"} border-l border-white/15`}>HSN / GST</th>
            <th scope="col" className={`${TH} text-right w-36 border-l border-white/15`}>
              Unit Price (₹){!isRead && <span className="text-red-300"> *</span>}
            </th>
            <th scope="col" className={`${TH} text-right w-32 border-l border-white/15`}>Line Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lineItems.map((item, idx) => {
            const unit = unitOf(item);
            const qty = parseFloat(item.quantity) || 1;
            const lineTotal = unit * qty;
            const hsn = onHsnChange ? hsnByItem?.[item.id] ?? "" : item.hsnCode ?? "";
            const zebra = idx % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]";
            return (
              <tr key={item.id} className={zebra}>
                <td className="px-3 py-3 text-xs font-bold text-slate-400 align-top">{idx + 1}</td>
                <td className="px-3 py-3 align-top">
                  <p className="font-semibold text-slate-800 leading-snug">{item.description}</p>
                  {item.machineCapacity && <p className="text-[11px] text-slate-700 mt-0.5">Capacity: {item.machineCapacity}</p>}
                  {item.specs && <p className="text-[11px] text-slate-500 mt-0.5">{item.specs}</p>}
                  {item.remarks && <p className="text-[11px] text-slate-500 mt-0.5">{item.remarks}</p>}
                  {renderLineExtra?.(item)}
                </td>
                <td className="px-3 py-3 text-center font-semibold text-slate-700 align-top">{item.quantity}</td>
                <td className="px-3 py-3 text-center text-slate-500 text-xs align-top">{item.uom ?? "EA"}</td>
                <td className="px-3 py-3 text-center align-top border-l border-slate-100">
                  {onHsnChange ? (
                    <div>
                      <select
                        value={hsn}
                        onChange={e => onHsnChange(item.id, e.target.value)}
                        aria-label={`HSN code for ${item.description}`}
                        className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30 min-h-[44px]"
                      >
                        <option value="">Select HSN…</option>
                        {HSN_GST_OPTIONS.map(o => <option key={o.code} value={o.code}>{o.code} · {o.gst}%</option>)}
                      </select>
                      {hsn && <p className="text-[10px] text-slate-700 font-semibold mt-0.5">GST {gstRateForHsn(hsn)}%</p>}
                    </div>
                  ) : hsn ? (
                    <span className="text-xs text-slate-700">{hsn} <span className="text-slate-700 font-semibold">· {rfqLineGstRate(item)}%</span></span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top border-l border-slate-100">
                  {isRead ? (
                    <p className="text-right tabular-nums text-slate-700">{hasLinePrices ? fmtCurrency(unit) : "—"}</p>
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
                      className={`${INPUT_RIGHT} min-h-[44px]`}
                    />
                  )}
                </td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-slate-800 align-top border-l border-slate-100">
                  {lineTotal > 0 ? fmtCurrency(lineTotal) : "—"}
                </td>
              </tr>
            );
          })}

          {/* Read-mode attribute rows + grand-total footer (entry/bid keep their own form sections). */}
          {isRead && showFooter && (
            <>
              {ATTR_ROWS.map((attr, attrIdx) => (
                <tr key={attr.label} className={attrIdx % 2 === 0 ? "bg-slate-50/70" : "bg-white"}>
                  <th scope="row" colSpan={labelSpan} className="px-3 py-2 text-left text-[12px] font-semibold text-slate-600 bg-slate-100 whitespace-nowrap">
                    {attr.label}
                  </th>
                  <td className="px-3 py-2 text-right text-[12px] text-slate-700 tabular-nums border-l border-slate-100">
                    {attr.value(quote, gst)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-[#F4F4F5]">
                <th scope="row" colSpan={labelSpan} className="px-3 py-2.5 text-left font-bold text-slate-900 text-[12px]">
                  Grand Total <span className="font-normal text-slate-400">(incl. GST)</span>
                </th>
                <td className="px-3 py-2.5 text-right border-l border-slate-100">
                  <p className="font-black tabular-nums text-[#2563EB]">{total > 0 ? fmtCurrency(total) : "—"}</p>
                  {total > 0 && gst > 0 && <p className="text-[10px] font-normal text-slate-500 mt-0.5">incl. {fmtCurrency(gst)} GST</p>}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
