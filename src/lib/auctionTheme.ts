/**
 * Shared field/style tokens for the auction-style surfaces (supplier portal bid screen, RFQ
 * supplier view, and the internal RfqPanel). Keeping these in one place means the two halves of
 * a negotiation render with the exact same visual language. Palette: primary blue #2563EB,
 * deep navy #1E3A5F, emerald for L1/success, table surface #F0F4FB.
 */

export const INPUT =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/40 focus:border-[#2563EB] transition-colors";

export const INPUT_RIGHT = `${INPUT} text-right tabular-nums`;

export const LABEL = "block text-xs font-semibold text-slate-600 mb-1";

export const LABEL_REQ = `${LABEL} after:content-['*'] after:ml-0.5 after:text-red-500`;

/** Apply to interactive controls that lack a built-in focus ring (buttons, editable cells). */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/50 focus-visible:ring-offset-2";

/** Currency formatter shared across auction/RFQ screens. */
export function fmtCurrency(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}
