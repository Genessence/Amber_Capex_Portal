/**
 * Time-series (flow) KPIs for the trend chart.
 *
 * Pure — no React, no I/O, `now` always injected. Every other file in this `kpi*` layer derives
 * CURRENT STATE only (see `CLAUDE.md`'s "No time-series" note) because nothing is snapshotted —
 * this file is the deliberate exception: `raised`/`awarded`/`completed` are read straight off
 * `createdAt`/`firstReachedAt`, which are genuinely historical facts already on the record, not a
 * derived-then-frozen snapshot. No new persistence is introduced.
 *
 * ── Bucketing is LOCAL time, consistently ──
 * `monthKey` reads `Date#getFullYear`/`Date#getMonth` (the LOCAL getters), never the UTC ones.
 * Mixing UTC bucketing for one field and local for another is exactly how a request lands in the
 * wrong month — a request stamped just after local midnight would be UTC-bucketed into the
 * previous day/month while everything else in the UI (which renders local time) shows it in the
 * next one. Every date read in this file goes through `monthKey`, so there is one convention.
 */
import type { CapexRequest, VendorInvite } from './types';
import type { MasterIndex } from './kpiUtils';
import { firstReachedAt, requestValue } from './kpiUtils';

export interface MonthPoint {
  month: string; // 'YYYY-MM', local time
  raised: number;
  awarded: number;
  completed: number;
  valueAwardedInr: number;
}

/** 'YYYY-MM' in LOCAL time — see file header. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/** First-of-month `Date`, LOCAL time, `delta` months from `d` (negative = earlier). */
function shiftMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/**
 * A contiguous month series ending at `now`'s month — a chart built off a sparse map could imply
 * a month never happened; this guarantees every month in the window is present, zero-filled.
 *
 * `raised` buckets on `createdAt` and EXCLUDES drafts (an unsubmitted request was never raised). `awarded` buckets on the month the request FIRST reached
 * `pi_requested` (`firstReachedAt`), regardless of value basis. `completed` buckets on the month it
 * first reached `completed`. `valueAwardedInr` attributes `requestValue().inr` to the SAME
 * award month, but ONLY when `basis === 'awarded'` — an approved-but-unawarded quotation is not
 * "the value that was awarded that month".
 */
export function monthlyFlow(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  opts: { now: number; months: number },
): MonthPoint[] {
  const { now, months } = opts;
  const anchor = new Date(now);
  const anchorMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);

  const points = new Map<string, MonthPoint>();
  const order: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = shiftMonths(anchorMonth, -i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    points.set(key, { month: key, raised: 0, awarded: 0, completed: 0, valueAwardedInr: 0 });
    order.push(key);
  }
  if (!order.length) return [];
  const firstKey = order[0];
  const lastKey = order[order.length - 1];
  const inWindow = (key: string) => key >= firstKey && key <= lastKey;

  for (const r of requests) {
    // A DRAFT was never raised — it has not left the author's hands, and every other Administration
    // figure (`fyBudgetPosition`, `valueFunnel`, `statusTally`) already excludes it. Counting it here
    // made the trend's `raised` line the only number on the tab that included unsubmitted work, so
    // the chart disagreed with the funnel directly beneath it. A REJECTED request is kept: it was
    // genuinely raised that month, and the rejection is a later fact about it, not an unraising.
    // Bucketing stays on `createdAt`: `addRequest` seeds `statusHistory` with the initial status at
    // `createdAt`, so for a non-draft request the two are the same instant.
    if (r.status !== 'draft') {
      const raisedKey = monthKey(r.createdAt);
      if (inWindow(raisedKey)) points.get(raisedKey)!.raised++;
    }

    const awardedAt = firstReachedAt(r, 'pi_requested');
    if (awardedAt) {
      const awardedKey = monthKey(awardedAt);
      if (inWindow(awardedKey)) {
        points.get(awardedKey)!.awarded++;
        const value = requestValue(r, byRequest.get(r.id) ?? [], index);
        if (value.basis === 'awarded') points.get(awardedKey)!.valueAwardedInr += value.inr;
      }
    }

    const completedAt = firstReachedAt(r, 'completed');
    if (completedAt) {
      const completedKey = monthKey(completedAt);
      if (inWindow(completedKey)) points.get(completedKey)!.completed++;
    }
  }

  return order.map((k) => points.get(k)!);
}

/**
 * Drop the leading months in which NOTHING happened, so the line uses the whole plot instead of
 * running flat along the axis for the half of the window that predates the portal's first request.
 *
 * Only LEADING months go: a zero month BETWEEN two active ones is a real fact about the pipeline and
 * is kept, and if every month is empty the series is returned untouched so the caller's own
 * empty-state check still sees what it expects. `keepMin` leaves a little context before the first
 * activity rather than starting the axis exactly on the spike.
 */
export function trimLeadingEmptyMonths(points: MonthPoint[], keepMin = 4): MonthPoint[] {
  const firstActive = points.findIndex(
    (p) => p.raised || p.awarded || p.completed || p.valueAwardedInr,
  );
  if (firstActive <= 0) return points;
  const start = Math.min(firstActive, Math.max(0, points.length - keepMin));
  return points.slice(start);
}
