'use client'

import { useCallback, useRef, useState } from 'react'

import { EmptyState } from './layout'

/**
 * The container's real pixel width, via a CALLBACK ref (not `useRef` + an effect): a chart that
 * first renders its empty state attaches no node, so a mount-time observer would never see the
 * element that appears once data arrives. The callback re-runs on every attach/detach.
 *
 * Why a chart wants this at all: these SVGs are drawn in viewBox units and scaled by `w-full`, so a
 * fixed viewBox width in a wide card either leaves the card half empty (capped) or magnifies every
 * label and blows the height up (uncapped). Measuring makes 1 viewBox unit === 1 CSS pixel, so the
 * chart fills its card at exactly the height it asked for, with 9px text staying 9px.
 */
function useMeasuredWidth(fallback: number) {
  const [width, setWidth] = useState(fallback);
  const cleanup = useRef<(() => void) | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) return;

    // Measure SYNCHRONOUSLY on attach, and never rely on the observer for the first value: a
    // `ResizeObserver` callback is delivered during a rendering step, so in a BACKGROUND tab it does
    // not fire at all and the chart would sit on its fallback width until the tab is looked at.
    // Verified live — this was not a theoretical concern.
    const measure = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      if (next > 0) setWidth((prev) => (prev === next ? prev : next));
    };
    measure();

    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(node);
    cleanup.current = () => {
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

/* ── Donut Chart ────────────────────────────────────────── */
interface DonutItem { label: string; value: number; color: string }
/**
 * `centreValue` / `centreLabel` / `formatValue` default to the request-count presentation this
 * started as, so existing callers are unchanged. Pass them to render a money donut (the legend
 * then needs `formatValue` too, or a rupee total shows up as a raw number).
 */
export function DonutChart({
  data,
  centreLabel = 'REQUESTS',
  centreValue,
  formatValue,
  ariaLabel = 'Requests by status',
  emptyText = 'No requests yet.',
}: {
  data: DonutItem[];
  centreLabel?: string;
  centreValue?: string;
  formatValue?: (n: number) => string;
  ariaLabel?: string;
  emptyText?: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <EmptyState>{emptyText}</EmptyState>;
  const fmt = formatValue ?? ((n: number) => String(n));

  const R = 72, CX = 100, CY = 100, C = 2 * Math.PI * R;
  let cum = 0;

  const segs = data.filter(d => d.value > 0).map(d => {
    const pct = d.value / total;
    const seg = { ...d, pct, dash: `${pct * C} ${C}`, offset: -(cum * C), pctStr: `${Math.round(pct * 100)}%` };
    cum += pct;
    return seg;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Donut */}
      <div className="flex justify-center">
        {/* role="img" is required for aria-label to be exposed as the accessible name on an <svg>. */}
        <svg viewBox="0 0 200 200" className="w-44 h-44" role="img" aria-label={ariaLabel}>
          {/* background track */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#f1f5f9" strokeWidth={28} />
          {segs.map((s, i) => (
            <circle key={i} cx={CX} cy={CY} r={R}
              fill="none" stroke={s.color} strokeWidth={28}
              strokeDasharray={s.dash} strokeDashoffset={s.offset}
              transform={`rotate(-90 ${CX} ${CY})`} />
          ))}
          {/* centre */}
          <text x={CX} y={CY - 8} textAnchor="middle" fontSize={centreValue ? 22 : 30} fontWeight="800" fill="#0f172a">
            {centreValue ?? total}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" fontSize={11} letterSpacing="0.08em" fill="#94a3b8">{centreLabel}</text>
        </svg>
      </div>

      {/* Legend — 2-col grid with % */}
      <div className="grid grid-cols-2 gap-1.5">
        {segs.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
            <span className="text-xs text-slate-600 truncate flex-1 min-w-0">{s.label}</span>
            <span className="text-xs font-bold text-slate-800 shrink-0">{fmt(s.value)}</span>
            <span className="text-[10px] text-slate-400 shrink-0 w-8 text-right">{s.pctStr}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Horizontal Bar Chart (Requests by Plant) ───────────── */
interface HBarItem { label: string; sub?: string; value: number }
export function HBarChart({ data, emptyText = 'No data.' }: { data: HBarItem[]; emptyText?: string }) {
  if (!data.length) return <EmptyState>{emptyText}</EmptyState>;
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max    = Math.max(...sorted.map(d => d.value), 1);
  const total  = sorted.reduce((s, d) => s + d.value, 0);

  return (
    <div className="space-y-3.5">
      {sorted.map(d => {
        const barPct   = Math.round((d.value / max) * 100);
        const sharePct = total > 0 ? Math.round((d.value / total) * 100) : 0;
        return (
          <div key={d.label}>
            <div className="flex items-baseline justify-between mb-1.5 gap-2">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {d.label}
                {d.sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{d.sub}</span>}
              </p>
              <p className="text-sm font-bold text-slate-700 shrink-0 tabular-nums">
                {d.value}
                <span className="ml-1 text-xs font-normal text-slate-400">({sharePct}%)</span>
              </p>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-[#2563EB] rounded-full transition-[width] duration-300"
                style={{ width: `${barPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Status colours (hex for SVG) ───────────────────────── */
// Pre-award statuses walk a darkening slate ramp; the fulfilment chain then takes distinct hues
// (violet → cyan → indigo) so adjacent live stages are separable, with emerald for completed and
// red for rejected. Every value is unique — two statuses sharing a hex makes their donut segments
// read as one. The legend beside the donut carries the labels, so colour is never the sole signal.
export const STATUS_HEX: Record<string, string> = {
  draft: '#CBD5E1',
  submitted: '#60A5FA',
  pending_head_approval: '#94A3B8',
  sourcing: '#64748B',
  negotiation: '#475569',
  sourcing_approved: '#334155',
  buyer_approved: '#1E293B',
  pi_requested: '#5B21B6',
  pi_submitted: '#7C3AED',
  accounts_processing: '#0891B2',
  payment_in_progress: '#4338CA',
  completed: '#059669',
  rejected: '#F87171',
};

/* ═══════════════════════════════════════════════════════════════════════
 * Stage-3 primitives: plant-wise / trend chart building blocks.
 * Presentational only — props in, SVG/DOM out. No data derivation, no clock
 * reads. Every chart states a real number in words next to any colour that
 * carries meaning (never colour alone), and every SVG chart exposes
 * role="img" + an aria-label built from the exact data it renders.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Domain that always includes 0 (so a baseline is always on-chart, even for an
 * all-positive or all-negative series) and never degenerates to a zero-width
 * range — an all-zero/all-identical series gets a padded domain instead of a
 * NaN from a `(v - min) / (max - min)` divide-by-zero, so it renders a flat
 * line at the baseline rather than crashing.
 *
 * Non-finite inputs (`NaN`/`Infinity` — e.g. an upstream ratio divided by a
 * zero allocation) are filtered out BEFORE the min/max spread: `Math.min`/
 * `Math.max` return `NaN` if any argument is `NaN`, and `NaN === NaN` is
 * `false`, so the `min === max` guard above does not catch this case on its
 * own — one bad value would otherwise poison the whole shared scale, not
 * just the point that produced it. A fully non-finite (or empty) input
 * degrades to the same padded ±1 domain as an all-zero series.
 */
function chartAxisDomain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  let min = Math.min(0, ...finite);
  let max = Math.max(0, ...finite);
  if (min === max) { min -= 1; max += 1; }
  return [min, max];
}

/**
 * Distinguishes a genuinely BROKEN (non-finite) figure from one that's simply absent. `raw == null`
 * is "not provided" — existing callers already treat this as 0 via `?? 0`, unchanged here. `raw`
 * present but `!Number.isFinite(raw)` is broken (e.g. a ratio over a zero allocation) and must never
 * silently render as a measured 0 — a broken measurement is not a measurement of zero. Shared by
 * `GroupedBarChart` and `FunnelChart` so the two bar primitives can't drift on this.
 */
function safeAmount(raw: number | undefined | null): { value: number; broken: boolean } {
  if (raw == null) return { value: 0, broken: false };
  if (!Number.isFinite(raw)) return { value: 0, broken: true };
  return { value: raw, broken: false };
}

/**
 * Negative-safe, broken-safe bar width — shared by every horizontal-bar primitive in this file.
 * Clamps a negative OR non-finite value to 0 WIDTH while the caller still prints the real signed
 * number (or an em-dash for `broken`) beside it — never a positive-width bar standing in for a
 * negative or broken figure.
 */
function barWidthPct(value: number, max: number, broken: boolean): number {
  if (broken || value < 0) return 0;
  return Math.min(100, (Math.abs(value) / max) * 100);
}

/* ── Trend Chart (multi-series line/area over month-shaped or {x,y} data) ── */
export interface TrendPoint { x: string; y: number }
export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: TrendPoint[];
  /**
   * Renders against its own right-hand scale instead of the shared left scale —
   * flagged in the legend, because a line plotted on a different axis is not
   * visually comparable to the others by eye alone.
   */
  axis?: 'left' | 'right';
  /** Overrides the chart-level formatter for this series' legend value + axis ticks. */
  formatValue?: (n: number) => string;
  /** Fills between the line and its axis baseline (subtle, low-opacity). */
  area?: boolean;
}

function trendAriaLabel(series: TrendSeries[], fmt: (n: number) => string, fallback: string): string {
  const parts = series.filter((s) => s.points.length).map((s) => {
    const f = s.formatValue ?? fmt;
    const vals = s.points.map((p) => p.y);
    const last = vals[vals.length - 1];
    // Same figure the visible legend shows — the two must never state different numbers.
    const total = vals.reduce((n, v) => n + v, 0);
    const trendWord = vals.length > 1
      ? `latest ${f(last)}, ${last > vals[0] ? 'up' : last < vals[0] ? 'down' : 'flat'} from ${f(vals[0])}`
      : 'single point';
    return `${s.label}: ${f(total)} total (${trendWord})${s.axis === 'right' ? ' [right axis]' : ''}`;
  });
  return parts.length ? `${fallback}. ${parts.join('; ')}.` : fallback;
}

/**
 * The one sentence a dropped point is disclosed with — hoisted so the visible caption and the
 * `aria-label` are LITERALLY the same string and cannot drift apart. `null` when nothing was
 * dropped, so a clean series carries no caption at all.
 *
 * Wording note: this chart BRIDGES a hole (one `<path>` across the whole series) where
 * `MeasuredSeriesChart` BREAKS at one (one `<path>` per contiguous run). Both drop a non-finite
 * value; only this one draws a line over the space it left, so the sentence has to say that the
 * join is a join and not a measurement — otherwise the picture silently asserts a value at an x
 * that has none.
 */
function droppedPointNote(count: number): string | null {
  if (count <= 0) return null;
  const one = count === 1;
  return `${count} point${one ? '' : 's'} could not be measured and ${one ? 'is' : 'are'} not plotted`
    + ` — the line joins straight across ${one ? 'it' : 'them'}, so there is no measured value at`
    + ` ${one ? 'that point' : 'those points'}.`;
}

/**
 * Multi-series line/area chart. Every series is expected to share the same x
 * categories in the same order — exactly the shape a `MonthPoint[]`-derived
 * series naturally has. Reconciling mismatched x-axes would be data
 * derivation, which this component deliberately does not do; the caller
 * aligns series before passing them in.
 *
 * Edge cases handled: a single-point series draws a dot, never a
 * zero-length path; an all-zero series renders a real flat line at the
 * baseline (via `chartAxisDomain`'s divide-by-zero guard), not a crash; and
 * negative values dip correctly below a dashed zero baseline that is only
 * drawn when the domain actually crosses zero.
 */
export function TrendChart({
  series,
  formatValue = (n: number) => String(Math.round(n)),
  ariaLabel = 'Trend chart',
  height = 200,
  emptyText = 'No data yet.',
}: {
  series: TrendSeries[];
  formatValue?: (n: number) => string;
  ariaLabel?: string;
  height?: number;
  emptyText?: string;
}) {
  // Non-finite `y` values are treated as missing data, never as a fabricated 0 — dropped before
  // they can reach the shared domain (poisoning every other point's scale) or an SVG coordinate
  // (emitting a literal "NaN" into a `d` attribute or a legend/axis label).
  //
  // Dropping them is necessary but NOT sufficient: unlike `MeasuredSeriesChart`, which breaks its
  // path at the hole, this chart draws one path straight through it, so the neighbours visually
  // assert a value at an x that was never measured. A real path reaches this — `toInr` guards an
  // unknown CURRENCY (`?? 1`) but passes a NaN AMOUNT through untouched, and this repo stores
  // free-form money strings (`SourcingDecision.freight` and siblings, the reason `formatTypedInr`
  // exists). So the count is disclosed in words below the caption and inside the aria-label.
  // Hook first: it must run on every render, including the empty-state early return below.
  const [frameRef, frameWidth] = useMeasuredWidth(640);

  const dropped = series.reduce((n, s) => n + s.points.filter((p) => !Number.isFinite(p.y)).length, 0);
  const droppedNote = droppedPointNote(dropped);

  const withPoints = series
    .map((s) => ({ ...s, points: s.points.filter((p) => Number.isFinite(p.y)) }))
    .filter((s) => s.points.length > 0);
  if (!withPoints.length) {
    // Every point was unusable (or there were none). The disclosure still has to appear: "No data
    // yet" and "every figure we had was broken" are different facts, and only the second is a bug
    // upstream worth chasing.
    return (
      <div ref={frameRef}>
        <EmptyState>
          {emptyText}
          {droppedNote && <span className="block mt-1 text-[11px] text-slate-400">{droppedNote}</span>}
        </EmptyState>
      </div>
    );
  }

  // The union of every series' x values, in first-encountered order — NOT just the longest
  // series. Two series covering different x sets (e.g. a right-axis value series that starts
  // later than the left-axis count series) each place their own points by their own `x` via the
  // `idxByX` lookup in `renderSeries` below, not by array index, so this only has to make sure
  // every x that ANY series carries has a slot on the shared axis.
  const categories: string[] = [];
  const seenX = new Set<string>();
  for (const s of withPoints) {
    for (const p of s.points) {
      if (!seenX.has(p.x)) { seenX.add(p.x); categories.push(p.x); }
    }
  }

  const left = withPoints.filter((s) => s.axis !== 'right');
  const right = withPoints.filter((s) => s.axis === 'right');
  const [leftMin, leftMax] = chartAxisDomain(left.flatMap((s) => s.points.map((p) => p.y)));
  const [rightMin, rightMax] = right.length
    ? chartAxisDomain(right.flatMap((s) => s.points.map((p) => p.y)))
    : [0, 1];

  const padL = 52, padR = right.length ? 52 : 12, padT = 12, padB = 28;
  // The card's own width, so the plot fills it — a fixed 640 left a wide card visibly empty on the
  // right. Floored so a narrow column scrolls (`ChartFrame`'s `minWidth`) instead of collapsing.
  const VW = Math.max(360, frameWidth);
  const plotW = VW - padL - padR;
  const plotH = height - padT - padB;

  const xAt = (i: number) => (categories.length > 1 ? padL + (i / (categories.length - 1)) * plotW : padL + plotW / 2);
  const yAt = (v: number, min: number, max: number) => padT + plotH - ((v - min) / (max - min)) * plotH;
  const zeroYLeft = yAt(0, leftMin, leftMax);
  const zeroYRight = right.length ? yAt(0, rightMin, rightMax) : zeroYLeft;

  const renderSeries = (s: TrendSeries, min: number, max: number, zeroY: number) => {
    const idxByX = new Map(categories.map((c, i) => [c, i]));
    const pts = s.points
      .map((p) => ({ x: idxByX.get(p.x), y: p.y }))
      .filter((p): p is { x: number; y: number } => p.x != null)
      .sort((a, b) => a.x - b.x);

    if (pts.length === 1) {
      return <circle key={s.key} cx={xAt(pts[0].x)} cy={yAt(pts[0].y, min, max)} r={4.5} fill={s.color} />;
    }

    const coords = pts.map((p) => [xAt(p.x), yAt(p.y, min, max)] as const);
    const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const areaD = s.area
      ? `${d} L${coords[coords.length - 1][0].toFixed(1)},${zeroY.toFixed(1)} L${coords[0][0].toFixed(1)},${zeroY.toFixed(1)} Z`
      : null;

    return (
      <g key={s.key}>
        {areaD && <path d={areaD} fill={s.color} opacity={0.12} stroke="none" />}
        <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />)}
      </g>
    );
  };

  return (
    <div ref={frameRef} className="flex flex-col gap-3">
      {/* Same string in the caption and in the aria-label — see `droppedPointNote`. */}
      {droppedNote && <p className="text-[11px] text-slate-400">{droppedNote}</p>}
      <svg
        viewBox={`0 0 ${VW} ${height}`}
        // 1 viewBox unit === 1 CSS pixel (see `useMeasuredWidth`), so the height is exactly what the
        // caller asked for however wide the card gets, and label sizes never scale up with it.
        width="100%"
        height={height}
        className="block"
        role="img"
        aria-label={[trendAriaLabel(withPoints, formatValue, ariaLabel), droppedNote].filter(Boolean).join(' ')}
      >
        {[leftMax, (leftMax + leftMin) / 2, leftMin].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={VW - padR} y1={yAt(v, leftMin, leftMax)} y2={yAt(v, leftMin, leftMax)} stroke="#F1F5F9" strokeWidth={1} />
            <text x={padL - 8} y={yAt(v, leftMin, leftMax) + 3} textAnchor="end" fontSize={11} fill="#94A3B8">
              {(left[0]?.formatValue ?? formatValue)(v)}
            </text>
          </g>
        ))}
        {right.length > 0 && [rightMax, rightMin].map((v, i) => (
          <text key={i} x={VW - padR + 8} y={yAt(v, rightMin, rightMax) + 3} textAnchor="start" fontSize={11} fill="#94A3B8">
            {(right[0]?.formatValue ?? formatValue)(v)}
          </text>
        ))}
        {leftMin < 0 && leftMax > 0 && (
          <line x1={padL} x2={VW - padR} y1={zeroYLeft} y2={zeroYLeft} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {left.map((s) => renderSeries(s, leftMin, leftMax, zeroYLeft))}
        {right.map((s) => renderSeries(s, rightMin, rightMax, zeroYRight))}
        {/* As many category labels as the MEASURED width can fit without crowding (~72px apart),
            always including the last one. At the old fixed 640 viewBox this was hardcoded to three,
            which left a wide chart with two gaps of unlabelled months. */}
        {(() => {
          const step = Math.max(1, Math.ceil(categories.length / Math.max(2, Math.floor(plotW / 72))));
          const last = categories.length - 1;
          return categories
            .map((_, i) => i)
            .filter((i) => i === last || (i % step === 0 && last - i >= step));
        })()
          .map((i) => (
            <text key={i} x={xAt(i)} y={height - 6} textAnchor="middle" fontSize={11} fill="#94A3B8">
              {categories[i]}
            </text>
          ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {withPoints.map((s) => {
          const f = s.formatValue ?? formatValue;
          // The TOTAL over the window, not the last point. A legend reading the final month's value
          // sits next to a caption saying "last 12 months" and is read as the period's figure — so
          // a portfolio of 15 raised requests showed "Raised 5" (August alone) and looked wrong.
          const total = s.points.reduce((n, p) => n + p.y, 0);
          return (
            <div key={s.key} className="flex items-center gap-1.5 text-xs">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
              <span className="text-slate-600">{s.label}</span>
              <span className="font-bold text-slate-800 tabular-nums">{f(total)}</span>
              {s.axis === 'right' && <span className="text-[10px] text-slate-400">(right axis)</span>}
            </div>
          );
        })}
        <span className="text-[10px] text-slate-400">Figures are totals over the period shown.</span>
      </div>
    </div>
  );
}

/* ── Measured Series Chart (daily snapshots — gaps are breaks, never zero-filled) ──
 * Enforces the "measured-only" product decision from `kpiSnapshots.ts`: an unmeasured
 * day is not a measured zero, and joining across it would draw a trend that never
 * happened. A caller-supplied `reconstructed` series renders dashed + muted and is
 * NEVER blended into the measured line's path — the two are always separate <path>s.
 */
export interface MeasuredPoint { date: string; value: number } // 'YYYY-MM-DD'

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Integer day index from a 'YYYY-MM-DD' string, via `Date.UTC` so day-difference math is exact and DST-safe. */
function dayOffset(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / ONE_DAY_MS;
}

/** Splits a series into contiguous-calendar-day runs — any gap of >1 day starts a new run (a break in the line). */
function segmentByDay(points: MeasuredPoint[]): MeasuredPoint[][] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const segments: MeasuredPoint[][] = [];
  for (const p of sorted) {
    const cur = segments[segments.length - 1];
    const prev = cur?.[cur.length - 1];
    if (prev && dayOffset(p.date) - dayOffset(prev.date) === 1) cur.push(p);
    else segments.push([p]);
  }
  return segments;
}

function fmtShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1))
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function MeasuredSeriesChart({
  measured,
  measuredFrom,
  reconstructed,
  formatValue = (n: number) => String(Math.round(n)),
  height = 180,
  ariaLabel = 'Measured trend',
  emptyText = 'Not measured yet.',
}: {
  measured: MeasuredPoint[];
  measuredFrom: string | null;
  reconstructed?: MeasuredPoint[];
  formatValue?: (n: number) => string;
  height?: number;
  ariaLabel?: string;
  emptyText?: string;
}) {
  // A non-finite `value` (e.g. an upstream ratio over a zero allocation) is treated exactly like an
  // unmeasured day — dropped BEFORE segmenting, never rendered as a measured 0. `segmentByDay` and
  // `renderSegments` are untouched: dropping a broken point here simply removes it from the array
  // they're given, which naturally becomes (or extends) a gap through their EXISTING logic, so the
  // measured-series honesty guarantee traced in the review is not touched by this fix.
  const measuredClean = measured.filter((p) => Number.isFinite(p.value));
  const recon = (reconstructed ?? []).filter((p) => Number.isFinite(p.value));
  if (!measuredClean.length && !recon.length) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  const offsets = [...measuredClean, ...recon].map((p) => dayOffset(p.date));
  const minOffset = Math.min(...offsets);
  const maxOffset = Math.max(...offsets);
  const [vMin, vMax] = chartAxisDomain([...measuredClean, ...recon].map((p) => p.value));

  const padL = 52, padR = 12, padT = 12, padB = 24;
  const VW = 640;
  const plotW = VW - padL - padR;
  const plotH = height - padT - padB;

  const xAt = (offset: number) => (minOffset === maxOffset ? padL + plotW / 2 : padL + ((offset - minOffset) / (maxOffset - minOffset)) * plotW);
  const yAt = (v: number) => padT + plotH - ((v - vMin) / (vMax - vMin)) * plotH;

  const measuredSegments = segmentByDay(measuredClean);
  const reconSegments = segmentByDay(recon);
  const gapCount = Math.max(0, measuredSegments.length - 1);

  const renderSegments = (segments: MeasuredPoint[][], color: string, dashed: boolean) =>
    segments.map((seg, si) => {
      if (seg.length === 1) {
        return <circle key={si} cx={xAt(dayOffset(seg[0].date))} cy={yAt(seg[0].value)} r={3.5} fill={color} opacity={dashed ? 0.75 : 1} />;
      }
      const coords = seg.map((p) => [xAt(dayOffset(p.date)), yAt(p.value)] as const);
      const d = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      return (
        <g key={si}>
          <path
            d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={dashed ? '5 4' : undefined} opacity={dashed ? 0.75 : 1}
          />
          {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={color} opacity={dashed ? 0.75 : 1} />)}
        </g>
      );
    });

  const last = measuredClean[measuredClean.length - 1];
  const fullAriaLabel = [
    ariaLabel,
    measuredFrom ? `Measured from ${fmtShortDate(measuredFrom)}.` : 'No measurements recorded yet.',
    last ? `Latest measured value: ${formatValue(last.value)} on ${fmtShortDate(last.date)}.` : '',
    gapCount > 0 ? `${gapCount} gap${gapCount === 1 ? '' : 's'} in the measured record, shown as a break — not interpolated.` : '',
    recon.length > 0 ? 'A separate dashed reconstructed (approximate, not measured) series is also shown.' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-slate-400">
        {measuredFrom ? `Measured from ${fmtShortDate(measuredFrom)}` : 'Not measured yet'}
        {gapCount > 0 && ` · ${gapCount} gap${gapCount === 1 ? '' : 's'} (unmeasured days — not shown as zero)`}
      </p>
      <svg viewBox={`0 0 ${VW} ${height}`} className="w-full h-auto" role="img" aria-label={fullAriaLabel}>
        {[vMax, (vMax + vMin) / 2, vMin].map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={VW - padR} y1={yAt(v)} y2={yAt(v)} stroke="#F1F5F9" strokeWidth={1} />
            <text x={padL - 8} y={yAt(v) + 3} textAnchor="end" fontSize={9} fill="#94A3B8">{formatValue(v)}</text>
          </g>
        ))}
        {vMin < 0 && vMax > 0 && (
          <line x1={padL} x2={VW - padR} y1={yAt(0)} y2={yAt(0)} stroke="#CBD5E1" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {renderSegments(reconSegments, '#94A3B8', true)}
        {renderSegments(measuredSegments, '#2563EB', false)}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke="#2563EB" strokeWidth={2} /></svg>
          <span className="text-slate-600">Measured</span>
        </div>
        {recon.length > 0 && (
          <div className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke="#94A3B8" strokeWidth={2} strokeDasharray="4 3" /></svg>
            <span className="text-slate-600">Reconstructed (approximate)</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Grouped Bar Chart (plants/heads × 2-3 measures side by side) ───────── */
export interface GroupedBarMeasure { key: string; label: string; color: string }
export interface GroupedBarGroup {
  label: string;
  sub?: string;
  values: Record<string, number>;
  /** Renders every bar in this group red AND appends a text "OVER" badge — colour is never the only carrier. */
  over?: boolean;
}

export function GroupedBarChart({
  groups,
  measures,
  formatValue = (n: number) => String(Math.round(n)),
  emptyText = 'No data.',
  ariaLabel = 'Grouped comparison',
  overLabel = 'Over',
}: {
  groups: GroupedBarGroup[];
  measures: GroupedBarMeasure[];
  formatValue?: (n: number) => string;
  emptyText?: string;
  ariaLabel?: string;
  /**
   * What the red `over` treatment MEANS, in the caller's own words — printed in the legend and, in
   * lower case, in the aria-label. This used to be the hardcoded string "over allocation", which is
   * a BUDGET fact: a caller flagging an oldest-age bucket, a late delivery or a breached threshold
   * had no way to say so and had to leave `over` unset (losing the red treatment entirely) rather
   * than let the chart label its data with the wrong noun. Same defect, same fix, as `HeatmapGrid`'s
   * `rowLabel`/`colLabel`.
   *
   * The default is deliberately domain-FREE. A generic primitive must not assert what the number is
   * about; a caller that means allocation passes `overLabel="Over allocation"`.
   */
  overLabel?: string;
}) {
  if (!groups.length || !measures.length) return <EmptyState>{emptyText}</EmptyState>;

  // A broken (non-finite) figure contributes 0 to the shared max — same effect as filtering it out
  // — so one bad cell can't stretch or poison every other bar's scale. See `safeAmount`.
  const max = Math.max(1, ...groups.flatMap((g) => measures.map((m) => {
    const { value, broken } = safeAmount(g.values[m.key]);
    return broken ? 0 : Math.abs(value);
  })));

  const fullAriaLabel = `${ariaLabel}. ${groups.map((g) => {
    const parts = measures.map((m) => {
      const { value, broken } = safeAmount(g.values[m.key]);
      return `${m.label} ${broken ? 'not available' : formatValue(value)}`;
    }).join(', ');
    return `${g.label}: ${parts}${g.over ? ` — ${overLabel.toLowerCase()}` : ''}`;
  }).join('; ')}.`;

  // Red arrives from TWO independent causes — an `over` group and a negative value — so the legend
  // names whichever is actually present, and nothing when neither is. It used to render an
  // unconditional "Over allocation" swatch, which meant a chart with no over-flagged group (the
  // aging chart on the Sourcing dashboard, say) explained a colour it never drew, in a noun that
  // had nothing to do with its data.
  const hasOver = groups.some((g) => g.over);
  const hasNegative = groups.some((g) => measures.some((m) => {
    const { value, broken } = safeAmount(g.values[m.key]);
    return !broken && value < 0;
  }));
  const redMeaning = [hasOver ? overLabel : null, hasNegative ? 'Negative' : null]
    .filter(Boolean).join(' / ');

  return (
    <div role="img" aria-label={fullAriaLabel} className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {measures.map((m) => (
          <div key={m.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: m.color }} />
            <span className="text-slate-600">{m.label}</span>
          </div>
        ))}
        {redMeaning && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-red-600" />
            <span className="text-slate-600">{redMeaning}</span>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <p className="text-sm font-semibold text-slate-800 truncate">
                {g.label}
                {g.sub && <span className="ml-1.5 text-xs font-normal text-slate-400">{g.sub}</span>}
              </p>
              {g.over && (
                // The badge is the non-colour carrier of the same fact the legend names, so it says
                // the caller's word too. Default `overLabel` is 'Over' → "OVER", exactly as before.
                <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 shrink-0">
                  {overLabel.toUpperCase()}
                </span>
              )}
            </div>
            <div className="space-y-1">
              {measures.map((m) => {
                const { value, broken } = safeAmount(g.values[m.key]);
                const negative = value < 0;
                const widthPct = barWidthPct(value, max, broken);
                // A broken figure renders as a neutral grey em-dash — never a red/blue bar standing
                // in for a number that doesn't exist.
                const barColor = broken ? '#CBD5E1' : g.over || negative ? '#DC2626' : m.color;
                return (
                  <div key={m.key} className="flex items-center gap-2">
                    <span className="w-20 text-[10px] text-slate-400 shrink-0 truncate">{m.label}</span>
                    <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{ width: `${widthPct}%`, background: barColor }}
                      />
                    </div>
                    <span
                      className={`text-xs font-bold tabular-nums w-24 text-right shrink-0 ${broken ? 'text-slate-400' : negative || g.over ? 'text-red-700' : 'text-slate-700'}`}
                      title={broken ? 'Not a valid measurement' : undefined}
                    >
                      {broken ? '—' : formatValue(value)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Funnel Chart (ordered stages, conversion vs previous, visible drop-off) ── */
export interface FunnelStage { key: string; label: string; value: number }

export function FunnelChart({
  stages,
  formatValue = (n: number) => String(Math.round(n)),
  emptyText = 'No data.',
  ariaLabel = 'Funnel',
}: {
  stages: FunnelStage[];
  formatValue?: (n: number) => string;
  emptyText?: string;
  ariaLabel?: string;
}) {
  if (!stages.length) return <EmptyState>{emptyText}</EmptyState>;

  // Broken (non-finite) stage values contribute 0 to the shared max, same reasoning as
  // `GroupedBarChart` — one bad stage can't stretch or poison every other stage's scale.
  const max = Math.max(1, ...stages.map((s) => {
    const { value, broken } = safeAmount(s.value);
    return broken ? 0 : Math.abs(value);
  }));

  /**
   * One pass per stage, shared by both the visible connector row and the aria-label below, so the
   * two can never disagree (Minor #7 — the aria-label previously omitted the drop-off amount that
   * IS shown on screen). `broken` on either side of a pair makes the conversion/drop-off
   * unavailable rather than computing through a `NaN`.
   */
  const stageInfo = stages.map((s, i) => {
    const cur = safeAmount(s.value);
    const prev = i > 0 ? safeAmount(stages[i - 1].value) : null;
    const comparable = prev != null && !prev.broken && !cur.broken;
    const conversion = comparable && prev!.value > 0 ? Math.round((cur.value / prev!.value) * 100) : null;
    const drop = comparable ? prev!.value - cur.value : null;
    return { ...cur, comparable, conversion, drop };
  });

  const fullAriaLabel = `${ariaLabel}. ${stages.map((s, i) => {
    const info = stageInfo[i];
    const valueText = info.broken ? 'value not available' : formatValue(info.value);
    if (i === 0) return `${s.label}: ${valueText} — starting stage, no conversion rate`;
    if (!info.comparable) return `${s.label}: ${valueText} (conversion not available)`;
    if (info.conversion == null) return `${s.label}: ${valueText} (no prior base to convert from)`;
    const dropText = info.drop! > 0
      ? `${formatValue(info.drop!)} dropped off`
      : info.drop! < 0 ? `grew by ${formatValue(Math.abs(info.drop!))}` : 'no change';
    return `${s.label}: ${valueText} (${info.conversion}% of ${stages[i - 1].label}, ${dropText})`;
  }).join('; ')}.`;

  return (
    <div role="img" aria-label={fullAriaLabel} className="space-y-2.5">
      {stages.map((s, i) => {
        const { value, broken, comparable, conversion, drop } = stageInfo[i];
        const negative = value < 0;
        const widthPct = barWidthPct(value, max, broken);

        return (
          <div key={s.key}>
            {i > 0 && (
              <div className="flex items-center gap-2 pl-1 py-0.5 text-[10px] text-slate-400">
                <span aria-hidden="true">↓</span>
                <span>
                  {!comparable
                    ? 'not available'
                    : conversion != null ? `${conversion}% converted` : 'no prior base to convert from'}
                </span>
                {comparable && drop != null && drop > 0 && <span>· {formatValue(drop)} dropped off</span>}
                {comparable && drop != null && drop < 0 && <span className="text-emerald-600">· grew by {formatValue(Math.abs(drop))}</span>}
              </div>
            )}
            <div className="flex items-baseline justify-between mb-1 gap-2">
              <p className="text-sm font-semibold text-slate-800 truncate">{s.label}</p>
              <p className={`text-sm font-bold tabular-nums shrink-0 ${broken ? 'text-slate-400' : negative ? 'text-red-700' : 'text-slate-700'}`}>
                {broken ? '—' : formatValue(value)}
                {i === 0 && <span className="ml-1.5 text-[10px] font-normal text-slate-400">starting stage</span>}
              </p>
            </div>
            <div className="h-4 bg-slate-100 rounded-md overflow-hidden">
              <div
                className="h-full rounded-md transition-[width] duration-300"
                style={{ width: `${widthPct}%`, background: broken ? '#CBD5E1' : i === 0 ? '#2563EB' : '#3B82F6' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Heatmap Grid (rows × cols, intensity scale, over treatment) ─────────
 * Deliberately a semantic <table>, not an SVG + role="img". A real <table> with
 * <th scope="row"/"col"> gives assistive tech native cell-by-cell navigation;
 * role="img" on a table would collapse that whole structure into one opaque
 * label, which is a WORSE text alternative for a grid meant to be read cell by
 * cell rather than glanced at as a picture. The visually-hidden <caption> still
 * gives one descriptive summary built from the same cell data being rendered
 * (so the two cannot drift), without discarding the table's native semantics.
 */
export interface HeatmapCell { row: string; col: string; value: number | null; over?: boolean }

export function HeatmapGrid({
  rows,
  cols,
  cells,
  formatValue = (n: number) => String(Math.round(n)),
  legendLabel = 'Value',
  rowLabel = 'Plant',
  colLabel = 'Head',
  overLabel = 'over',
  emptyText = 'No data.',
  caption,
}: {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  formatValue?: (n: number) => string;
  legendLabel?: string;
  /** Row-header column title + the noun used in the sr-only caption/summary. Default 'Plant' matches
   *  every caller so far, but a caller pairing something other than plants × heads (a vendor
   *  scorecard, say) MUST override this — otherwise the table and the screen-reader summary would
   *  both assert "plant" over data that isn't plants. */
  rowLabel?: string;
  /** Same as `rowLabel`, for the column axis. Default 'Head'. */
  colLabel?: string;
  /**
   * What a red `over` cell MEANS, in the caller's own words — used in the legend and the sr-only
   * summary. Was the hardcoded "over allocation"; see `GroupedBarChart.overLabel` for why a generic
   * primitive must not assert a domain. Phrased to read after "flagged", so a caller passes a bare
   * phrase (`overLabel="over allocation"`), not a sentence.
   */
  overLabel?: string;
  emptyText?: string;
  caption?: string;
}) {
  if (!rows.length || !cols.length) return <EmptyState>{emptyText}</EmptyState>;

  const byKey = new Map(cells.map((c) => [`${c.row}|${c.col}`, c]));
  // Non-finite cell values (e.g. a ratio over a zero allocation) are excluded from the scale — and,
  // below, rendered exactly like a missing cell (em-dash) — so one broken figure can't corrupt every
  // other cell's intensity or the legend's stated min/max range.
  const numeric = cells.map((c) => c.value).filter((v): v is number => v != null && Number.isFinite(v));
  const min = numeric.length ? Math.min(...numeric) : 0;
  const max = numeric.length ? Math.max(...numeric) : 1;
  const overCount = cells.filter((c) => c.over).length;
  const hottest = cells.reduce<HeatmapCell | null>(
    (best, c) => (
      c.value != null && Number.isFinite(c.value) && (best == null || c.value > (best.value as number)) ? c : best
    ),
    null,
  );

  const intensity = (v: number) => (max === min ? 0.5 : (v - min) / (max - min));

  const rowNoun = rowLabel.toLowerCase();
  const colNoun = colLabel.toLowerCase();
  const summary = [
    `${legendLabel} across ${rows.length} ${rowNoun}${rows.length === 1 ? '' : 's'} and ${cols.length} ${colNoun}${cols.length === 1 ? '' : 's'}.`,
    hottest ? `Highest: ${hottest.row} / ${hottest.col} at ${formatValue(hottest.value as number)}.` : 'No measured cells.',
    overCount > 0
      ? `${overCount} cell${overCount === 1 ? '' : 's'} flagged ${overLabel}.`
      : `No cells flagged ${overLabel}.`,
  ].join(' ');

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">{caption ?? summary}</caption>
          <thead>
            <tr className="bg-gradient-to-b from-neutral-800 to-neutral-900 text-white">
              <th scope="col" className="px-2 py-1.5 text-left font-bold uppercase tracking-wide text-[10px] sticky left-0 bg-neutral-900">
                {rowLabel}
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className="px-2 py-1.5 text-right font-bold uppercase tracking-wide text-[10px] whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} className="border-t border-border">
                <th scope="row" className="px-2 py-1.5 text-left font-semibold text-slate-700 whitespace-nowrap sticky left-0 bg-card">
                  {r}
                </th>
                {cols.map((c) => {
                  const cell = byKey.get(`${r}|${c}`);
                  // A broken (non-finite) value renders exactly like an absent one — an em-dash, never
                  // a fabricated 0 and never a NaN-poisoned background colour.
                  if (!cell || cell.value == null || !Number.isFinite(cell.value)) {
                    return (
                      <td key={c} className="px-2 py-1.5 text-right text-slate-300" title="No data measured">
                        —
                      </td>
                    );
                  }
                  const bg = cell.over
                    ? `rgba(220, 38, 38, ${0.18 + intensity(cell.value) * 0.35})`
                    : `rgba(37, 99, 235, ${0.08 + intensity(cell.value) * 0.42})`;
                  return (
                    <td
                      key={c}
                      className={`px-2 py-1.5 text-right font-semibold tabular-nums ${cell.over ? 'text-red-800' : 'text-slate-800'}`}
                      style={{ background: bg }}
                    >
                      {formatValue(cell.value)}
                      {cell.over && <span className="ml-1 text-[9px] font-bold text-red-700">OVER</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="w-16 h-2 rounded-sm" style={{ background: 'linear-gradient(to right, rgba(37,99,235,0.08), rgba(37,99,235,0.5))' }} />
          <span>{legendLabel}: {formatValue(min)} – {formatValue(max)}</span>
        </div>
        {/* Only when a red cell is actually on screen — a swatch for a state the grid never drew
            explains a colour that isn't there. The sr-only summary states the absence in words. */}
        {overCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: 'rgba(220,38,38,0.4)' }} />
            <span>{overLabel}</span>
          </div>
        )}
        <span>— no data measured</span>
      </div>
    </div>
  );
}

/* ── Percentile Bar (p50 / p90 on one track, with sample disclosure) ─────
 * `sampled` / `stillOpen` are always rendered as text, never optional — a
 * percentile computed over survivors only, shown without how many requests
 * never finished, is a survivorship lie.
 */
function PercentileMarker({
  value, color, shape, posPct, label, formatValue,
}: {
  value: number; color: string; shape: 'circle' | 'diamond'; posPct: string;
  label: string; formatValue: (n: number) => string;
}) {
  return (
    <>
      {value < 0 && (
        <span className="absolute -top-4 -translate-x-1/2 text-[9px] font-bold text-red-700 whitespace-nowrap" style={{ left: posPct }}>
          {formatValue(value)}
        </span>
      )}
      <div
        className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 border-2 border-white ${shape === 'circle' ? 'rounded-full' : 'rotate-45'}`}
        style={{ left: posPct, background: color, boxShadow: `0 0 0 1px ${color}` }}
        title={`${label}: ${formatValue(value)}`}
      />
    </>
  );
}

export function PercentileBar({
  p50,
  p90,
  sampled,
  stillOpen,
  max,
  unitLabel = 'days',
  // `formatValue` is trusted to embed its own unit (matching `fmtDays`/`fmtCr` elsewhere) — it is
  // never suffixed with `unitLabel` again after being called. `unitLabel` only feeds this default.
  formatValue = (n: number) => `${Math.round(n)} ${unitLabel}`,
  ariaLabel = 'Stage duration percentiles',
  emptyText,
}: {
  p50: number | null;
  p90: number | null;
  sampled: number;
  stillOpen: number;
  max?: number;
  unitLabel?: string;
  formatValue?: (n: number) => string;
  ariaLabel?: string;
  emptyText?: string;
}) {
  const statusLine = `${sampled} sampled · ${stillOpen} still open (not counted)`;

  if (sampled === 0 || p50 == null || p90 == null) {
    return (
      <div role="img" aria-label={`${ariaLabel}. No completed samples yet. ${statusLine}.`}>
        <EmptyState>
          {emptyText ?? 'No completions yet.'}
          <span className="block mt-0.5 text-[11px] text-slate-400">{statusLine}</span>
        </EmptyState>
      </div>
    );
  }

  // A single nullish check for `max`, used consistently on both sides of the multiplication — the
  // previous version mixed `max ?? 0` (nullish) with `max ? 1 : 1.15` (truthy), which disagreed only
  // when a caller explicitly passed `max: 0` (padding would still apply despite an explicit domain).
  const hasMax = max != null;
  const domainMax = Math.max(hasMax ? max : 0, p90, p50, 1) * (hasMax ? 1 : 1.15);
  const posOf = (v: number) => `${Math.min(100, Math.max(0, (Math.max(0, v) / domainMax) * 100))}%`;
  const fullAriaLabel = `${ariaLabel}. P50 ${formatValue(p50)}, P90 ${formatValue(p90)}. ${statusLine}.`;

  return (
    <div role="img" aria-label={fullAriaLabel} className="space-y-2">
      <div className="relative h-8">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-slate-100 rounded-full" />
        <PercentileMarker value={p50} color="#2563EB" shape="circle" posPct={posOf(p50)} label="P50" formatValue={formatValue} />
        {/* P90's dark-slate hue is in-file precedent (STATUS_HEX's `sourcing_approved`/`buyer_approved`
            ramp), not a new colour — it stays inside grayscale+blue rather than amber, which this file
            elsewhere reads as "warn" (KpiTile's `warn` tone). P90 isn't a warning, just the slower
            tail, so it's told apart from P50 by shape (diamond vs circle) plus a distinct-but-neutral
            grayscale hue, never a semantic one. */}
        <PercentileMarker value={p90} color="#334155" shape="diamond" posPct={posOf(p90)} label="P90" formatValue={formatValue} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: '#2563EB' }} />
          <span className="text-slate-600">P50</span>
          <span className="font-bold text-slate-800 tabular-nums">{formatValue(p50)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rotate-45 shrink-0" style={{ background: '#334155' }} />
          <span className="text-slate-600">P90</span>
          <span className="font-bold text-slate-800 tabular-nums">{formatValue(p90)}</span>
        </span>
        <span className="text-slate-400">{statusLine}</span>
      </div>
    </div>
  );
}
