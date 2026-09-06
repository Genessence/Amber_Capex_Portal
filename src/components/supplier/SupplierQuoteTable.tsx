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
import type { CapexLineItem, QuoteLineDocument, RfqQuote } from "@/lib/types";
import { useMemo } from "react";
import { INPUT_RIGHT, fmtCurrency } from "@/lib/auctionTheme";
import { currencySymbol } from "@/lib/currencyUtils";
import { rfqTotal, rfqGstAmount, rfqLineGstRate, rfqLineUnitPrice, rfqLineBreakdown, rfqLineSubtotal } from "@/lib/rfqUtils";
import { HSN_GST_OPTIONS, gstRateForHsn } from "@/lib/hsnGst";
import { TABLE_WRAP } from "@/lib/uiTokens";
import { LineDocumentCell } from "./LineDocumentCell";

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
  /**
   * The currency these figures are IN. Every amount on this table is the vendor's own quotation —
   * what they contractually offer — so it renders in their currency, never converted. Read mode
   * falls back to the stored quote's currency; entry/bid must pass the live form selection.
   */
  currency?: string;
  /**
   * Per-line supporting documents keyed by line-item id. In read mode these come off the stored
   * quote; in entry/bid the caller owns the map and gets `onLineDocument` callbacks.
   */
  lineDocuments?: Record<string, QuoteLineDocument>;
  /** `null` clears the line's document. Passing this handler is what turns the column editable. */
  onLineDocument?: (itemId: string, doc: QuoteLineDocument | null) => void;
  /** Vendor display name stamped on an uploaded document. */
  uploadedBy?: string;
  /** Whether to render the read-mode attribute rows + grand-total footer (default true). */
  showFooter?: boolean;
}

/** Read-mode attribute rows beneath the line items (freight/packing/service/etc.). */
const ATTR_ROWS: Array<{ label: string; value: (q: RfqQuote | undefined, gst: number, cur: string) => string }> = [
  { label: "Transportation / Freight", value: (q, _gst, cur) => (q?.freight != null ? fmtCurrency(q.freight, cur) : "—") },
  { label: "Packing / Forwarding", value: (q, _gst, cur) => (q?.packing != null ? fmtCurrency(q.packing, cur) : "—") },
  { label: "Service / Installation", value: (q, _gst, cur) => (q?.service != null ? fmtCurrency(q.service, cur) : "—") },
  {
    label: "Delivery Lead Time",
    value: q => (q?.deliveryWeeks != null ? `${q.deliveryWeeks} week${q.deliveryWeeks !== 1 ? "s" : ""}` : "—"),
  },
  {
    label: "Warranty",
    value: q => (q?.warranty != null ? `${q.warranty} year${q.warranty !== 1 ? "s" : ""}` : "—"),
  },
  { label: "GST (as per HSN)", value: (_q, gst, cur) => (gst > 0 ? fmtCurrency(gst, cur) : "—") },
  { label: "Currency", value: (_q, _gst, cur) => cur },
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
  lineDocuments,
  onLineDocument,
  uploadedBy,
  currency,
  showFooter = true,
}: SupplierQuoteTableProps) {
  const isRead = variant === "read";
  // Own-currency throughout: the vendor's quotation is what they offer. Cross-vendor comparison and
  // anything Accounts consume convert to INR elsewhere (`inrRfqTotal`), never here.
  const cur = currency ?? quote?.currency ?? "INR";
  const sym = currencySymbol(cur);

  const hasLinePrices = !!quote?.linePrices && Object.keys(quote.linePrices).length > 0;

  const previewQuote = useMemo((): RfqQuote | undefined => {
    if (isRead) return quote;
    if (!linePrices) return undefined;
    const lp: Record<string, number> = {};
    for (const [id, v] of Object.entries(linePrices)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) lp[id] = n;
    }
    if (!Object.keys(lp).length) return undefined;
    return { price: rfqLineSubtotal(lp, lineItems), linePrices: lp };
  }, [isRead, quote, linePrices, lineItems]);

  const effectiveItems = useMemo(
    () => lineItems.map(it => ({
      ...it,
      hsnCode: onHsnChange ? (hsnByItem?.[it.id]?.trim() || it.hsnCode) : it.hsnCode,
    })),
    [lineItems, hsnByItem, onHsnChange],
  );

  const activeQuote = isRead ? quote : previewQuote;

  // Unit price for a row: read pulls from the quote; entry/bid from the controlled map.
  const unitOf = (item: CapexLineItem): number =>
    isRead ? (hasLinePrices ? rfqLineUnitPrice(quote, item.id) ?? 0 : 0) : Number(linePrices?.[item.id] ?? 0);

  // GST computed identically to the mobile cards: built from the quote + per-item HSN.
  const gst = rfqGstAmount(activeQuote, effectiveItems);
  const total = rfqTotal(activeQuote, effectiveItems);

  // The per-line Document column is rendered when the vendor can upload (entry/bid) OR when a
  // stored quote actually carries documents — a read surface with no attachments keeps the old
  // 7-column layout rather than showing a column of dashes.
  // Read surfaces get the documents off the stored quote for free — every "here is the quotation"
  // card in the portal renders through this component, so falling back here means none of them can
  // be the one that forgets to thread the prop.
  const docs = lineDocuments ?? quote?.lineDocuments;
  const hasLineDocs = !!docs && lineItems.some(it => !!docs[it.id]);
  const showDocColumn = !!onLineDocument || hasLineDocs;

  // Column span for the attribute-row label cell = all columns except the trailing value column.
  // Base layout is 7 columns (# / Description / Qty / UOM / HSN / Unit Price / Line Total), so the
  // label fills the first 6 — plus one more when the Document column is present. (Attribute rows
  // only ever render in the read variant.)
  const labelSpan = showDocColumn ? 7 : 6;

  return (
    <div className={TABLE_WRAP}>
      <table className={`w-full text-sm border-collapse ${showDocColumn ? "min-w-[820px]" : "min-w-[640px]"}`} aria-label="Your quotation">
        <thead>
          <tr className="bg-[#171717] text-white">
            <th scope="col" className={`${TH} text-left w-10`}>#</th>
            <th scope="col" className={`${TH} text-left`}>Description</th>
            <th scope="col" className={`${TH} text-center w-16`}>Qty</th>
            <th scope="col" className={`${TH} text-center w-16`}>UOM</th>
            <th scope="col" className={`${TH} text-center ${onHsnChange ? "w-44" : "w-28"} border-l border-white/15`}>HSN / GST</th>
            <th scope="col" className={`${TH} text-right w-36 border-l border-white/15`}>
              Unit Price ({sym}){!isRead && <span className="text-red-300"> *</span>}
            </th>
            <th scope="col" className={`${TH} text-right w-32 border-l border-white/15`}>Line Total</th>
            {showDocColumn && (
              <th scope="col" className={`${TH} text-left w-40 border-l border-white/15`}>Document</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lineItems.map((item, idx) => {
            const unit = unitOf(item);
            const effItem = effectiveItems.find(it => it.id === item.id) ?? item;
            const breakdown = rfqLineBreakdown(activeQuote, effItem);
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
                    <div className="text-xs text-slate-700">
                      <p className="font-semibold">{hsn} <span className="font-semibold">· {breakdown.gstRate}%</span></p>
                      {breakdown.gstAmount > 0 && (
                        <p className="text-[10px] text-slate-500 mt-0.5">GST {fmtCurrency(breakdown.gstAmount, cur)}</p>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top border-l border-slate-100">
                  {isRead ? (
                    <p className="text-right tabular-nums text-slate-700">{hasLinePrices ? fmtCurrency(unit, cur) : "—"}</p>
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
                  {breakdown.taxableSubtotal > 0 ? (
                    <div>
                      <p>{fmtCurrency(breakdown.lineTotalInclGst, cur)}</p>
                      <p className="text-[10px] font-normal text-slate-500">
                        {fmtCurrency(breakdown.taxableSubtotal, cur)} + {fmtCurrency(breakdown.gstAmount, cur)} GST
                      </p>
                    </div>
                  ) : "—"}
                </td>
                {showDocColumn && (
                  <td className="px-3 py-3 align-top border-l border-slate-100">
                    <LineDocumentCell
                      compact
                      itemLabel={item.description}
                      doc={docs?.[item.id]}
                      uploadedBy={uploadedBy}
                      readOnly={!onLineDocument}
                      onChange={onLineDocument ? d => onLineDocument(item.id, d) : undefined}
                    />
                  </td>
                )}
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
                    {attr.value(quote, gst, cur)}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 bg-[#F4F4F5]">
                <th scope="row" colSpan={labelSpan} className="px-3 py-2.5 text-left font-bold text-slate-900 text-[12px]">
                  Grand Total <span className="font-normal text-slate-400">(incl. GST)</span>
                </th>
                <td className="px-3 py-2.5 text-right border-l border-slate-100">
                  <p className="font-black tabular-nums text-[#2563EB]">{total > 0 ? fmtCurrency(total, cur) : "—"}</p>
                  {total > 0 && gst > 0 && <p className="text-[10px] font-normal text-slate-500 mt-0.5">incl. {fmtCurrency(gst, cur)} GST</p>}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
