/**
 * HSN code → GST rate mapping (frontend demo — no real HSN database). The vendor enters/picks an
 * HSN code on their quote; the GST rate is derived here and the GST amount is added to the total.
 * Rates reflect common Indian GST slabs (5 / 12 / 18 / 28 %) for capital-goods procurement.
 */

export interface HsnOption {
  code: string;
  label: string;
  gst: number; // percent
}

/** Seeded list of HSN codes relevant to machinery / components / EMS / IT capex. */
export const HSN_GST_OPTIONS: HsnOption[] = [
  { code: '8414', label: '8414 — Air/gas compressors, fans, pumps', gst: 18 },
  { code: '8415', label: '8415 — Air-conditioning machines', gst: 28 },
  { code: '8418', label: '8418 — Refrigerating / freezing equipment', gst: 18 },
  { code: '8419', label: '8419 — Industrial machinery for heating/cooling', gst: 18 },
  { code: '8421', label: '8421 — Centrifuges, filtering machinery', gst: 18 },
  { code: '8422', label: '8422 — Packing / filling / bottling machinery', gst: 18 },
  { code: '8428', label: '8428 — Lifting / handling / conveyor machinery', gst: 18 },
  { code: '8438', label: '8438 — Food/beverage processing machinery', gst: 18 },
  { code: '8454', label: '8454 — Converters, ladles, casting machines', gst: 18 },
  { code: '8455', label: '8455 — Metal-rolling mills & rolls', gst: 18 },
  { code: '8456', label: '8456 — Machine tools (laser/ultrasonic, etc.)', gst: 18 },
  { code: '8457', label: '8457 — Machining centres / CNC', gst: 18 },
  { code: '8458', label: '8458 — Lathes for metal removal', gst: 18 },
  { code: '8462', label: '8462 — Forging / stamping / press machines', gst: 18 },
  { code: '8466', label: '8466 — Machine-tool parts & accessories', gst: 18 },
  { code: '8477', label: '8477 — Rubber/plastics moulding machinery', gst: 18 },
  { code: '8479', label: '8479 — Machines with individual functions', gst: 18 },
  { code: '8481', label: '8481 — Taps, cocks, valves', gst: 18 },
  { code: '8483', label: '8483 — Shafts, gears, bearings, couplings', gst: 18 },
  { code: '8501', label: '8501 — Electric motors & generators', gst: 18 },
  { code: '8504', label: '8504 — Transformers, converters, inductors', gst: 18 },
  { code: '8537', label: '8537 — Control panels / boards / consoles', gst: 18 },
  { code: '8538', label: '8538 — Parts for switchgear / control panels', gst: 18 },
  { code: '8544', label: '8544 — Insulated wires & cables', gst: 18 },
  { code: '9026', label: '9026 — Flow/level/pressure measuring instruments', gst: 18 },
  { code: '9027', label: '9027 — Analysis / lab instruments', gst: 18 },
  { code: '9031', label: '9031 — Measuring / checking instruments', gst: 18 },
  { code: '8471', label: '8471 — Computers / data-processing units (IT)', gst: 18 },
  { code: '8517', label: '8517 — Networking / telecom equipment (IT)', gst: 18 },
  { code: '7308', label: '7308 — Structures & parts of iron/steel', gst: 18 },
  { code: '9403', label: '9403 — Furniture (other)', gst: 18 },
];

const HSN_INDEX: Record<string, HsnOption> = Object.fromEntries(
  HSN_GST_OPTIONS.map((o) => [o.code, o]),
);

/** Default GST rate when an HSN code is unknown / not in the table. */
export const DEFAULT_GST_RATE = 18;

/** Resolve the GST percentage for an HSN code (matches on the leading 4-digit chapter heading). */
export function gstRateForHsn(hsn?: string): number {
  if (!hsn) return 0;
  const trimmed = hsn.trim();
  if (!trimmed) return 0;
  if (HSN_INDEX[trimmed]) return HSN_INDEX[trimmed].gst;
  const head = trimmed.slice(0, 4);
  if (HSN_INDEX[head]) return HSN_INDEX[head].gst;
  return DEFAULT_GST_RATE;
}

/** GST amount for a taxable value under a given HSN code (0 if no HSN). */
export function gstAmount(taxableValue: number, hsn?: string): number {
  if (!hsn) return 0;
  return Math.round((taxableValue * gstRateForHsn(hsn)) / 100);
}

/** Human label for an HSN code, falling back to the raw code. */
export function hsnLabel(hsn?: string): string {
  if (!hsn) return '—';
  return HSN_INDEX[hsn.trim()]?.label ?? HSN_INDEX[hsn.trim().slice(0, 4)]?.label ?? hsn;
}
