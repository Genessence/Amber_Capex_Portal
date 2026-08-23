/**
 * Daily MEASURED snapshots of the STOCK metrics — budget position, and the sourcing desk's open
 * workload. The only new persisted state in the role dashboards work.
 *
 * ── Why this file exists, and why it refuses to backfill ──
 *
 * The dashboards' FLOW metrics (requests raised / awarded / completed per month) are already
 * historical facts on the record: `createdAt` and `statusHistory` say exactly when each transition
 * happened, so `kpiTrends.ts` derives them for any past month with no stored history. Do not
 * duplicate that here.
 *
 * The STOCK metrics — allocation, commitment, utilisation, over-allocation exposure, and how much
 * work was sitting on the sourcing desk — have no such record. `CapexMasterItem` carries no creation
 * date, so what a plant's budget *was* last month is genuinely unknowable from current state; and a
 * request's `statusHistory` records when it ENTERED `sourcing` but the desk's size on a given past
 * day is a different, uncomputable thing once statuses have moved on. A reconstructed curve would
 * divide each past month's commitment by TODAY's allocation and draw a confident, wrong line; every FY published
 * since would bend the whole history. This codebase has repeatedly deleted exactly that class of
 * plausible-but-wrong figure (see `CLAUDE.md` on the removed `diffProposalAgainstLive` view and the
 * `requestValue` basis captions), so the rule here is:
 *
 *   MEASURE FORWARD, LABEL THE START DATE, AND NEVER BLEND A RECONSTRUCTED POINT INTO A MEASURED
 *   SERIES.
 *
 * `measuredFrom` exists so a chart can state its own start date instead of implying the series
 * begins with the business.
 *
 * ── Gaps are not zeros ──
 *
 * A snapshot is written when the app is opened. If nobody opened it for a week, that week has NO
 * measurement — which is a different fact from "measured, and it was zero". `snapshotSeries`
 * therefore returns only the days that were actually measured and leaves missing days ABSENT, so
 * the chart layer can render them as breaks. Zero-filling would draw a cliff to zero that never
 * happened.
 *
 * ── Composition, not reinvention ──
 *
 * Every figure comes from the existing pure layer: `fyBudgetPosition` (allocated / committed /
 * awarded / paid) and `headPositions` (per-head breach + exposure) from `kpiPortfolio.ts`, scoped
 * with `latestMasterFyForPlantField` from `kpiPlants.ts` — THE per-plant FY rule for this layer.
 * There is deliberately no third FY rule in this file. The workflow counts add no rule either:
 * `PRE_PI_REQUEST_STATUSES` (`statusFlow.ts`), `inviteHasQuote` (`kpiRisk.ts`) and `requestFy`
 * (`kpiPortfolio.ts`) are the same predicates the live dashboards and the mutations already use.
 *
 * ── Adding a metric later ──
 *
 * A metric introduced after this store shipped is ABSENT from every record already written, and
 * absent must never read as a measured zero. So a later metric is declared OPTIONAL, `buildSnapshots`
 * always writes it, and `snapshotSeries` / `measuredFrom` skip records that lack it — the series
 * simply starts on the day the metric shipped, and says so. No migration, no backfill.
 *
 * ── Size discipline ──
 *
 * This payload lives in `capex_data_v2` under the ~5 MB `localStorage` quota that the whole
 * IndexedDB blob-offload machinery (`fileStore.ts`) exists to protect. So: numbers only, no nested
 * objects, no labels, one record per scope per calendar day (NEVER per request), integers for INR,
 * and a hard `SNAPSHOT_RETENTION_DAYS` window. See `kpiSnapshots.test.ts` for the asserted ceilings.
 * Adding the two workflow counts cost ~53 chars per record and was absorbed by raising the ceiling
 * once; that raise has since been REVERSED and paid for by cutting retention 180 → 90 days instead
 * (see `SNAPSHOT_RETENTION_DAYS`). Retention is the lever. The ceiling is not.
 *
 * Pure — no React, no I/O, `now` always injected.
 */
import type {
  BrownFieldHeadBudget, CapexMasterItem, CapexRequest, FieldType, VendorInvite,
} from './types';
import { invitesByRequest, masterIndex } from './kpiUtils';
import { fyBudgetPosition, headPositions, projectTypesForPlantFy, requestFy } from './kpiPortfolio';
import { latestMasterFyForPlantField } from './kpiPlants';
import { inviteHasQuote } from './kpiRisk';
import { PRE_PI_REQUEST_STATUSES } from './statusFlow';

/** One measured point for one scope on one calendar day. */
export interface KpiSnapshot {
  /** 'YYYY-MM-DD', LOCAL time — same convention as `kpiTrends.monthKey`. */
  date: string;
  fieldType: FieldType;
  /** `null` = the all-plants roll-up for that field type. */
  plant: string | null;
  /**
   * The FY these figures were measured against — each plant on ITS OWN latest FY for this field
   * type. On the roll-up this is the shared FY when every contributing plant is on the same year,
   * else the literal `'mixed'`: plants publish next-FY budgets independently, and naming one year
   * for a roll-up spanning two would be a false label.
   */
  fy: string;
  allocatedInr: number;
  committedInr: number;
  awardedInr: number;
  paidInr: number;
  /** Brown Field only (heads are a Brown Field concept) — always 0 for other field types. */
  overExposureCr: number;
  /** Brown Field only — always 0 for other field types. */
  breachedHeads: number;
  /**
   * WORKFLOW stock: live requests sitting on the sourcing desk right now — status in
   * `PRE_PI_REQUEST_STATUSES` (`sourcing`, `negotiation`, and the two legacy pre-PI states). A
   * genuine stock, exactly like allocation: nothing on the record says how many were open last
   * month, so it can only be measured forward.
   *
   * OPTIONAL, and that is load-bearing: every record written before this metric existed carries no
   * value for it. Reading a missing field as `0` would invent a measured "nothing was open" for a
   * day that measured only the money figures — the same backfill lie this whole file refuses. So
   * `snapshotSeries` and `measuredFrom` treat an absent value as a GAP. `buildSnapshots` always
   * writes it, so only pre-existing history is ever absent.
   *
   * Scoped exactly like the money figures in the same record (field type + THIS plant's FY + plant,
   * via the shared `requestFy` rule), so one record is one consistent scope. Consequence, stated:
   * a request attributed to a different FY is not counted here, the same way its value is not in
   * `committedInr`.
   */
  openSourcingRequests?: number;
  /**
   * WORKFLOW stock: vendor invites on those same open-sourcing requests that have no price on the
   * table yet — `!inviteHasQuote`, the SAME predicate `sourcingPerformance`'s participation figure
   * uses, so the two can never disagree about what "quoted" means.
   *
   * Deliberately restricted to the open-sourcing set: an un-quoted invite on a request that is
   * already awarded or completed is not a pending quotation, it is a vendor who never replied.
   *
   * Optional for the same legacy reason as `openSourcingRequests`.
   */
  pendingQuoteInvites?: number;
}

/**
 * Retention window, in CALENDAR DAYS INCLUDING TODAY. A record dated exactly
 * `SNAPSHOT_RETENTION_DAYS` days ago falls OUTSIDE the window and is dropped; one dated
 * `SNAPSHOT_RETENTION_DAYS - 1` days ago is the oldest kept. Pinned in the tests.
 *
 * ── Why 90 and not 180 (2026-08) ──
 *
 * At 180 days the seeded worst case measured **2,013,841 chars ≈ 1.92 MiB — ~38% of the ~5 MB
 * `localStorage` quota**, and the way that was accommodated was to RAISE the size ceiling in
 * `kpiSnapshots.test.ts`, against that test's own written instruction to cut retention instead.
 * That trade is reversed here, because it was the wrong way round:
 *
 * Snapshots are DERIVED OBSERVATIONAL data — every point is a measurement of state that the app can
 * re-measure tomorrow, and losing the oldest ones costs a shorter chart. `requests` / `invites` /
 * `budgetProposals` in the same `capex_data_v2` payload are the IRREPLACEABLE PRIMARY RECORD: lose
 * those and the workflow itself is gone, with nothing to reconstruct them from. This app already
 * offloads every file blob to IndexedDB (`fileStore.ts`) precisely because `localStorage` kept
 * overflowing, so a derived series must never be allowed to crowd out the state whose loss is
 * catastrophic. 90 days puts the same worst case at **1,006,921 chars ≈ 0.96 MiB (~19% of quota)**.
 *
 * Doing it NOW is free: no stored snapshot is more than about two weeks old, so nothing real is
 * discarded. The same cut in six months would silently delete three months of genuine measurement
 * that cannot be re-derived (see this file's header — stock metrics are unknowable in hindsight).
 * That asymmetry is the whole argument for taking retention down early rather than when it hurts.
 */
export const SNAPSHOT_RETENTION_DAYS = 90;

/** The FY label used on a roll-up whose contributing plants are not all on the same FY. */
export const MIXED_FY = 'mixed';

// `NonNullable`, not a bare `extends number`: a metric added after this store shipped is declared
// OPTIONAL (see the header), so its property type is `number | undefined`, which does NOT extend
// `number` — without this it would be silently excluded from `SnapshotMetric` and `snapshotSeries`
// could not be asked for it at all.
type NumericKeys<T> = { [K in keyof T]-?: NonNullable<T[K]> extends number ? K : never }[keyof T];

/** The numeric fields of `KpiSnapshot` — derived from the interface so it can never drift from it. */
export type SnapshotMetric = NumericKeys<KpiSnapshot>;

/** A series identity. `fy` is deliberately NOT part of it — see `snapshotSeries`. */
export interface SnapshotScope {
  fieldType: FieldType;
  plant: string | null;
}

/* ── date keys (local time, DST-safe) ─────────────────────────────────── */

function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' for `now` in LOCAL time. Exported so the provider can ask "already captured today?". */
export function snapshotDateKey(now: number): string {
  return dateKeyOf(new Date(now));
}

/**
 * Oldest date still inside the retention window. Computed with LOCAL calendar arithmetic
 * (`new Date(y, m, d - n)`) rather than by subtracting `n × 86_400_000` ms, so it cannot land on
 * the wrong date across a DST boundary.
 */
function retentionCutoff(now: number): string {
  const d = new Date(now);
  return dateKeyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (SNAPSHOT_RETENTION_DAYS - 1)));
}

/* ── keying ───────────────────────────────────────────────────────────── */

/**
 * A record's identity: one record per (day, field type, plant). `buildSnapshots` emits exactly one
 * per scope per day, so this key is unique within a day's output and is what makes a same-day
 * re-capture a REPLACEMENT rather than a duplicate.
 */
function snapshotKey(s: KpiSnapshot): string {
  return `${s.date}|${s.fieldType}|${s.plant ?? '*'}`;
}

const roundInr = (n: number) => Math.round(n);
/** 4 dp of a Crore ≈ ₹1,000 precision — enough to show a small head breach, cheap in bytes. */
const roundCr = (n: number) => Math.round(n * 10_000) / 10_000;

/* ── build ────────────────────────────────────────────────────────────── */

/**
 * Distinct plants that have master rows for this field type. Scopes exist where budgets exist.
 *
 * NOTE for the size budget: this enumerates plants from `capexMaster`, NOT from `PLANTS`. Plants can
 * be created at runtime (`createGreenFieldPlant` / `addCustomPlant`), so the scope count is NOT
 * bounded by the seeded list — the "40 scopes/day" figure in the size test is today's seeded
 * ceiling, not an invariant. Every new plant that gets a budget adds one scope per field type it is
 * funded under (~4.2 KB/day at full retention each).
 */
function plantsForFieldType(capexMaster: CapexMasterItem[], fieldType: FieldType): string[] {
  const set = new Set<string>();
  for (const m of capexMaster) {
    if ((m.fieldType ?? 'brown_field') !== fieldType) continue;
    if (m.plant) set.add(m.plant);
  }
  return [...set].sort();
}

const FIELD_TYPES: FieldType[] = [
  'brown_field', 'green_field', 'digitisation', 'information_technology',
];

/** `PRE_PI_REQUEST_STATUSES` as a set — the four statuses at which sourcing owns the request. */
const OPEN_SOURCING_STATUSES = new Set<string>(PRE_PI_REQUEST_STATUSES);

/**
 * The two WORKFLOW stock counts for one (field type, fy, plant) scope.
 *
 * Composed, never restated: the status set is `statusFlow`'s `PRE_PI_REQUEST_STATUSES` (the same
 * list `awardAndRequestPi` bumps from), the "has this vendor put a price on the table" predicate is
 * `kpiRisk`'s `inviteHasQuote`, and the FY attribution is `kpiPortfolio`'s `requestFy` — the same
 * rule `fyBudgetPosition` scopes the money figures in this very record with. There is no fourth
 * rule in this file.
 */
function sourcingStock(opts: {
  requests: CapexRequest[];
  byRequest: Map<string, VendorInvite[]>;
  index: ReturnType<typeof masterIndex>;
  capexMaster: CapexMasterItem[];
  fieldType: FieldType;
  fy: string;
  plant: string;
}): { openSourcingRequests: number; pendingQuoteInvites: number } {
  const { requests, byRequest, index, capexMaster, fieldType, fy, plant } = opts;
  let openSourcingRequests = 0;
  let pendingQuoteInvites = 0;
  for (const r of requests) {
    if (!OPEN_SOURCING_STATUSES.has(r.status)) continue;
    if ((r.fieldType ?? 'brown_field') !== fieldType) continue;
    if (r.plant !== plant) continue;
    if (requestFy(r, index, capexMaster) !== fy) continue;
    openSourcingRequests++;
    for (const inv of byRequest.get(r.id) ?? []) {
      if (!inviteHasQuote(inv)) pendingQuoteInvites++;
    }
  }
  return { openSourcingRequests, pendingQuoteInvites };
}

/**
 * Today's measured snapshots — one per (field type, plant) that has master rows, plus one
 * all-plants roll-up per field type.
 *
 * A scope with master rows but nothing spent DOES get a record, with zeros: that is a real
 * measurement, and omitting it would be indistinguishable from "not measured" under this file's gap
 * semantics. A field type / plant with NO master rows gets no record at all — there is no FY to
 * attribute and no allocation to measure against, so there is genuinely nothing to record.
 *
 * The roll-up is the SUM of that field type's per-plant records, never a `fyBudgetPosition` call
 * with the plant scope dropped: that call resolves ONE global latest FY per field type and would
 * silently omit every plant still on an earlier year the moment any other plant published a newer
 * one — the exact failure the Admin over-allocation tile and `kpiPlants` were both built to avoid.
 *
 * Takes `invites` (not a prebuilt `byRequest`) because this runs once a day, not on a hot path.
 */
export function buildSnapshots(opts: {
  capexMaster: CapexMasterItem[];
  requests: CapexRequest[];
  invites: VendorInvite[];
  headOverrides: BrownFieldHeadBudget[];
  usedAmountByMasterItemId: Record<string, number>;
  now: number;
}): KpiSnapshot[] {
  const { capexMaster, requests, invites, headOverrides, usedAmountByMasterItemId, now } = opts;
  const date = snapshotDateKey(now);
  const byRequest = invitesByRequest(invites);
  // Built once here rather than per scope: `fyBudgetPosition` builds its own internally, but the
  // workflow counts need the SAME index to resolve `requestFy` identically, and rebuilding it inside
  // the plant loop would be O(scopes × master rows) for no gain.
  const index = masterIndex(capexMaster);
  const out: KpiSnapshot[] = [];

  for (const fieldType of FIELD_TYPES) {
    const plants = plantsForFieldType(capexMaster, fieldType);
    if (!plants.length) continue;

    const perPlant: KpiSnapshot[] = [];
    for (const plant of plants) {
      // Non-null by construction: `plant` came from this field type's own master rows.
      const fy = latestMasterFyForPlantField(capexMaster, plant, fieldType) ?? '';
      const position = fyBudgetPosition({
        capexMaster, requests, byRequest, scope: { fieldType, fy, plant },
      });

      let breachedHeads = 0;
      let overExposureCr = 0;
      // This guard is LOAD-BEARING, not belt-and-braces. `projectTypesForPlantFy` and
      // `headsForScope` both filter to Brown Field rows by `plant + fy`, NOT by field type of the
      // scope being measured — so for a plant that has Brown AND Green rows on the same FY, a
      // green_field scope would otherwise resolve the Brown Field heads and report that plant's
      // brown-field breaches as Green Field exposure. Pinned by a test with exactly that fixture.
      if (fieldType === 'brown_field') {
        for (const projectType of projectTypesForPlantFy(capexMaster, plant, fy)) {
          for (const h of headPositions({
            capexMaster, headOverrides, usedAmountByMasterItemId, scope: { plant, fy, projectType },
          })) {
            if (!h.over) continue;
            breachedHeads++;
            overExposureCr += h.committedCr - h.allocatedCr;
          }
        }
      }

      const stock = sourcingStock({
        requests, byRequest, index, capexMaster, fieldType, fy, plant,
      });

      perPlant.push({
        date,
        fieldType,
        plant,
        fy,
        allocatedInr: roundInr(position.allocatedInr),
        committedInr: roundInr(position.committedInr),
        awardedInr: roundInr(position.awardedInr),
        paidInr: roundInr(position.paidInr),
        overExposureCr: roundCr(overExposureCr),
        breachedHeads,
        openSourcingRequests: stock.openSourcingRequests,
        pendingQuoteInvites: stock.pendingQuoteInvites,
      });
    }

    const fys = new Set(perPlant.map((p) => p.fy));
    out.push({
      date,
      fieldType,
      plant: null,
      fy: fys.size === 1 ? [...fys][0] : MIXED_FY,
      allocatedInr: perPlant.reduce((s, p) => s + p.allocatedInr, 0),
      committedInr: perPlant.reduce((s, p) => s + p.committedInr, 0),
      awardedInr: perPlant.reduce((s, p) => s + p.awardedInr, 0),
      paidInr: perPlant.reduce((s, p) => s + p.paidInr, 0),
      overExposureCr: roundCr(perPlant.reduce((s, p) => s + p.overExposureCr, 0)),
      breachedHeads: perPlant.reduce((s, p) => s + p.breachedHeads, 0),
      // `?? 0` only for the type — `perPlant` is built above and always carries both counts.
      openSourcingRequests: perPlant.reduce((s, p) => s + (p.openSourcingRequests ?? 0), 0),
      pendingQuoteInvites: perPlant.reduce((s, p) => s + (p.pendingQuoteInvites ?? 0), 0),
    });
    out.push(...perPlant);
  }

  return sortSnapshots(out);
}

/* ── merge + read ─────────────────────────────────────────────────────── */

/** Deterministic order: date, then field type, then plant (the `null` roll-up first). */
function sortSnapshots(rows: KpiSnapshot[]): KpiSnapshot[] {
  return [...rows].sort((a, b) =>
    a.date.localeCompare(b.date)
    || a.fieldType.localeCompare(b.fieldType)
    || (a.plant ?? '').localeCompare(b.plant ?? ''));
}

/**
 * Fold `incoming` into `stored`: a record REPLACES any stored record for the same (day, field type,
 * plant), and anything outside the retention window is dropped. Keyed on each record's own `date`,
 * so re-opening the app twice in one day overwrites that day's records instead of stacking a second
 * set — which is what keeps the payload one-record-per-scope-per-day.
 *
 * The window is bounded at BOTH ends. The upper bound matters because the date on a record comes
 * from the device clock: a machine briefly set to next week writes a future-dated point that no
 * later run would ever replace (`buildSnapshots` only ever writes today's key), so it would sit in
 * the series forever, reading as a measurement of a day that has not happened. Dropping it costs
 * nothing — the day will be measured for real when it arrives.
 */
export function mergeSnapshots(
  stored: KpiSnapshot[],
  incoming: KpiSnapshot[],
  now: number,
): KpiSnapshot[] {
  const byKey = new Map<string, KpiSnapshot>();
  for (const s of stored) byKey.set(snapshotKey(s), s);
  for (const s of incoming) byKey.set(snapshotKey(s), s);
  const cutoff = retentionCutoff(now);
  const today = snapshotDateKey(now);
  return sortSnapshots([...byKey.values()].filter((s) => s.date >= cutoff && s.date <= today));
}

/**
 * A chart-ready MEASURED series for one scope, oldest first. Days that were never measured are
 * ABSENT, not zero — see the file header.
 *
 * `fy` is not part of the scope on purpose: `buildSnapshots` emits exactly one record per
 * (day, field type, plant), so adding `fy` could only ever split one continuous series in two at
 * the moment a plant rolls to a new FY. Each point carries the `fy` it was measured against, so a
 * consumer that cares can read it per point.
 *
 * A record that carries no value for `metric` — a day measured before that metric was introduced —
 * is ABSENT from the series, exactly like an unmeasured day. Substituting 0 there would draw a
 * confident flat run at zero across every day before the metric existed, which is the same lie as
 * zero-filling a gap.
 */
export function snapshotSeries(
  stored: KpiSnapshot[],
  scope: SnapshotScope,
  metric: SnapshotMetric,
): { date: string; value: number }[] {
  return stored
    .filter((s) => s.fieldType === scope.fieldType && s.plant === scope.plant)
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((s) => {
      const value = s[metric];
      return value == null ? [] : [{ date: s.date, value }];
    });
}

/**
 * The earliest measured date, so a chart can say "measured from X" instead of implying the series
 * starts with the business. `null` when nothing has been measured.
 *
 * Pass `scope` when labelling a single scope's chart: a plant whose budget was published last week
 * must say ITS start date, not the store's — the store may reach back months for other plants.
 *
 * Pass `metric` when labelling a chart of ONE metric. A metric added later than the store itself
 * (the workflow counts) starts being measured on the day it shipped, so the store's earliest date
 * would over-claim its horizon by however long the store predates it — a caption saying "measured
 * from 1 March" over a line that starts in June. With `metric`, only days that actually carry that
 * metric count.
 */
export function measuredFrom(
  stored: KpiSnapshot[],
  scope?: SnapshotScope,
  metric?: SnapshotMetric,
): string | null {
  let earliest: string | null = null;
  for (const s of stored) {
    if (scope && (s.fieldType !== scope.fieldType || s.plant !== scope.plant)) continue;
    if (metric && s[metric] == null) continue;
    if (earliest == null || s.date < earliest) earliest = s.date;
  }
  return earliest;
}
