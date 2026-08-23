/**
 * The metric registry behind `/capex/requests`' filtered routes.
 *
 * Every dashboard KPI card that links to the requests list gets an entry here, and the entry
 * carries the SAME predicate the card's number is derived from — imported from `kpiUtils` /
 * `kpiQueues` / `kpiRisk`, never re-implemented. A card whose route drops the card's own threshold
 * (the old `Stuck at plant head` → `?filter=pending_head_approval`: a tile reading 2 landing on a
 * list of 11) is the contradiction this module exists to remove, so the registry is unit-tested
 * against the very KPI derivations the tiles read.
 *
 * Three kinds of card need three different honest destinations:
 *
 * - `predicate` — a count. The route carries the whole predicate, age threshold included, and the
 *   list shows the evidence for it (the waiting age, with the breach marked).
 * - `cohort` — a median. A median is not a filter; no `?filter=` can be right. The destination is
 *   the SAMPLE the number was computed over, with each row's measured duration shown, plus the
 *   `stillOpen` count stated in words — a median over completed work only is survivorship-biased,
 *   and silently omitting the still-running rows is what makes a cycle time look faster than it is.
 * - `ratio` — the destination is the DENOMINATOR with the numerator marked, so both halves of the
 *   fraction stay visible.
 *
 * ## Precedence (explicit, and in this order)
 *
 * 1. **Role and plant scope** is applied by the caller BEFORE `ctx.requests` reaches this module.
 *    Nothing here can widen it: every step below only ever filters the array it was given, so no
 *    param combination can surface a request the role could not already see.
 * 2. **Narrowing params** — `filter` (status equality), `plant`, `vendor`, `overdue` — are AND'd
 *    together in any order and define the *universe*.
 * 3. **`metric`** then selects its cohort from that universe, and computes its evidence and its
 *    disclosures (`stillOpen`, the ratio's numerator/denominator) over exactly that universe — so
 *    the disclosures always describe the rows actually on screen.
 * 4. Anything **unusable** — an unknown `metric` key, a `filter` that is not a `CapexStatus`, an
 *    `overdue` value other than `1`, a `plant`/`vendor` the roster does not know — filters nothing
 *    and is reported in `ignored` + `notice`. Silently showing everything as though it were
 *    filtered is the same lie in a new costume — and so is the inverse: `notice.showing` states
 *    what is ACTUALLY on screen, so the page can never claim "unfiltered" while a chip above it
 *    says otherwise (`ignored` and "nothing was applied" are independent facts).
 *
 * Pure: no React, no I/O, `now` injected. Deliberately free of `./constants` (which imports
 * `lucide-react`) so the vitest suite stays dependency-light — display names for statuses, plants
 * and vendors, and the roster of known plant/vendor values, are injected via `ctx`.
 */
import type { CapexRequest, CapexStatus, VendorInvite } from './types';
import { CAPEX_STATUS_FLOW } from './types';
import type { BallHold, Party, SlaKey } from './kpiUtils';
import {
  PARTY_LABELS, PARTY_SLA, SLA_DAYS, ageInDays, ballHolders, median, stageDaySample, statusTally,
} from './kpiUtils';
import { stuckAtPlantHead } from './kpiQueues';
import { LEG_LABELS, inviteHasQuote, inviteLegSample, type LegKey } from './kpiRisk';
// The SAME formatters the tiles use (`components/dashboards/format.ts` re-exports these), so a
// tile's figure and the note explaining it can never round differently.
import { fmtDays, fmtPct } from './format';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ── evidence ─────────────────────────────────────────────────────────── */

/**
 * Per-metric evidencing columns. A number without its evidence is why the old routes felt wrong:
 * arriving from "Stuck at plant head" must show the waiting age and mark the breach; arriving from
 * a cohort median must show the duration that row contributed.
 */
export type EvidenceColumn = 'waiting' | 'duration' | 'participation' | 'outcome';

export const EVIDENCE_COLUMN_LABELS: Record<EvidenceColumn, string> = {
  waiting: 'Waiting',
  duration: 'Measured',
  participation: 'Vendors quoted',
  outcome: 'Outcome',
};

export interface WaitingEvidence {
  party: Party;
  partyLabel: string;
  days: number | null;
  /** The SLA this wait has breached, or `null` when it is inside SLA / has none. */
  breachedSla: SlaKey | null;
  /** Words for the breach — colour must never be the only carrier of meaning. */
  breachWords: string | null;
}

export interface DurationEvidence {
  days: number;
  /** What was measured, e.g. `sourcing → PI requested` or `median of 2 vendor invites`. */
  note: string;
}

export interface ParticipationEvidence {
  quoted: number;
  invited: number;
}

export interface OutcomeEvidence {
  inNumerator: boolean;
  label: string;
}

export interface RowEvidence {
  waiting?: WaitingEvidence;
  duration?: DurationEvidence;
  participation?: ParticipationEvidence;
  outcome?: OutcomeEvidence;
}

export interface MetricRow {
  request: CapexRequest;
  evidence: RowEvidence;
}

/* ── context + params ─────────────────────────────────────────────────── */

export interface RequestListContext {
  /**
   * Already scoped to what the current role may see. This module only narrows it — see precedence
   * rule 1 in the module doc.
   */
  requests: CapexRequest[];
  byRequest: Map<string, VendorInvite[]>;
  now: number;
  /** Display-name resolvers the caller owns (status/plant/vendor maps live in `./constants`). */
  labels?: {
    status?: (value: string) => string;
    plant?: (value: string) => string;
    vendor?: (value: string) => string;
  };
  /**
   * The values `?plant=` / `?vendor=` may legitimately carry (plant roster ∪ plants present in the
   * scoped data; the vendor roster). Supplied, an unrecognised value is reported as ignored instead
   * of quietly filtering to zero rows — a stale bookmark otherwise reads as "nothing is happening
   * here". Omitted (tests, callers with no roster), both params apply as given.
   */
  known?: {
    plants?: Iterable<string>;
    vendors?: Iterable<string>;
  };
}

export interface RequestListParams {
  metric?: string | null;
  /** Legacy single-status equality. Still supported: honest queue routes and bookmarks use it. */
  filter?: string | null;
  plant?: string | null;
  vendor?: string | null;
  /** `'1'` — only requests whose current ball-hold has breached that party's SLA. */
  overdue?: string | null;
}

export type FilterParam = keyof RequestListParams;

export interface ActiveFilter {
  param: FilterParam;
  value: string;
  /** Chip words — names the filter in plain language, threshold included. */
  words: string;
}

/* ── ball-hold helpers (shared with the dashboards' own derivation) ────── */

/** The longest-running hold on a request — the same `reduce` the dashboards' tables use. */
export function worstHold(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  now: number,
): BallHold {
  const holds = ballHolders(request, reqInvites, now);
  // `ballHolders` always returns at least one hold today, but the `reduce` seed would hand back
  // `undefined` (against the declared return type) if that ever changed — `noUncheckedIndexedAccess`
  // is off, so TS would not catch it. Fail to "nobody is holding it", never to a crash in a cell.
  if (!holds.length) {
    return { party: 'none', since: request.createdAt, days: ageInDays(request.createdAt, now) ?? 0 };
  }
  return holds.reduce((a, b) => (b.days > a.days ? b : a), holds[0]);
}

/** The SLA this hold has breached, or `null`. `PARTY_SLA` + `SLA_DAYS`, never a local threshold. */
export function holdBreach(hold: BallHold): SlaKey | null {
  const slaKey = PARTY_SLA[hold.party];
  if (!slaKey) return null;
  return hold.days > SLA_DAYS[slaKey] ? slaKey : null;
}

function waitingEvidence(
  request: CapexRequest,
  ctx: RequestListContext,
): WaitingEvidence {
  const hold = worstHold(request, ctx.byRequest.get(request.id) ?? [], ctx.now);
  const breachedSla = holdBreach(hold);
  return {
    party: hold.party,
    partyLabel: PARTY_LABELS[hold.party],
    days: hold.party === 'none' ? null : hold.days,
    breachedSla,
    breachWords: breachedSla
      ? `past the ${fmtDays(SLA_DAYS[breachedSla])} ${PARTY_LABELS[hold.party]} threshold`
      : null,
  };
}

/* ── metric registry ──────────────────────────────────────────────────── */

export type MetricKind = 'predicate' | 'cohort' | 'ratio';

export interface MetricSelection {
  rows: MetricRow[];
  /** Cohort metrics: how many samples the median was computed over. */
  sampled?: number;
  /** Cohort metrics: started the leg, never finished it — disclosed, never hidden. */
  stillOpen?: number;
  /** Cohort metrics: the median this list is the sample for — the tile's own number. */
  medianDays?: number | null;
  /** Ratio metrics. */
  numerator?: number;
  denominator?: number;
  /** Sentences the page must print. */
  notes: string[];
}

export interface MetricDef {
  key: MetricKey;
  kind: MetricKind;
  /** Chip words. Carries any threshold baked into the predicate. */
  label: string;
  /** One line saying what the list is and how it relates to the card's number. */
  description: string;
  columns: EvidenceColumn[];
  select(universe: CapexRequest[], ctx: RequestListContext): MetricSelection;
}

export type MetricKey =
  | 'my_requests'
  | 'stuck_plant_head'
  | 'rejection_rate'
  | 'sourcing_cycle'
  | 'invite_first_quote'
  | 'first_quote_agreed'
  | 'tech_spec_gate'
  | 'vendor_participation';

/** Shared shape for the three per-invite cycle-time legs. */
function legMetric(key: MetricKey, leg: LegKey, label: string): MetricDef {
  return {
    key,
    kind: 'cohort',
    label,
    description: `The vendor invites this median was measured over (${LEG_LABELS[leg]}).`,
    columns: ['duration'],
    select(universe, ctx) {
      const rows: MetricRow[] = [];
      const samples: number[] = [];
      let stillOpen = 0;
      for (const request of universe) {
        const mine: number[] = [];
        for (const inv of ctx.byRequest.get(request.id) ?? []) {
          const s = inviteLegSample(inv, leg);
          if (s.state === 'sampled') {
            samples.push(s.days);
            mine.push(s.days);
          } else if (s.state === 'open') {
            stillOpen++;
          }
        }
        if (!mine.length) continue;
        rows.push({
          request,
          evidence: {
            duration: {
              // A request can contribute several invites; show its own median so the row's figure
              // and the cohort's figure are the same kind of number.
              days: median(mine) ?? 0,
              note: mine.length > 1
                ? `median of ${plural(mine.length, 'vendor invite')}`
                : LEG_LABELS[leg],
            },
          },
        });
      }
      const medianDays = median(samples);
      return {
        rows,
        sampled: samples.length,
        stillOpen,
        medianDays,
        notes: [
          `Median ${fmtDays(medianDays)} over ${plural(samples.length, 'vendor invite')}`
          + ` across ${plural(rows.length, 'request')}.`,
          // "with no recorded finish", NOT "still running": an invite whose quotation sourcing
          // REJECTED, or a losing vendor in a split award, never gets the end stamp this leg looks
          // for and would sit in this count forever. The count is honest about what it can see —
          // a start with no end — and deliberately does not claim the work is still in flight.
          stillOpen > 0
            ? `Excluded from the median: ${plural(stillOpen, 'vendor invite')} that started this`
              + ' leg with no recorded finish (including any that were rejected or lost the award).'
              + ' Not listed below.'
            : 'Every invite that started this leg has a recorded finish, so nothing is excluded'
              + ' from the median.',
        ],
      };
    },
  };
}

export const METRICS: Record<MetricKey, MetricDef> = {
  my_requests: {
    key: 'my_requests',
    kind: 'predicate',
    // Role-agnostic words on purpose: the chip must stay true if this URL is hand-shared to
    // someone whose scope is not "mine" (a super_admin pasting it sees every request in the
    // portal, and a chip reading "My requests" would then be a lie).
    label: 'Every request in your scope · all statuses',
    description: 'Every request in your scope, drafts and closed ones included — the tile counts the same rows.',
    columns: ['waiting'],
    select(universe, ctx) {
      // `statusTally` (kpiUtils) is the one home for this split — the Buyer tile's sub reads the
      // same helper, so the tile and this note cannot come to describe different populations.
      const tally = statusTally(universe);
      return {
        rows: universe.map((request) => ({ request, evidence: { waiting: waitingEvidence(request, ctx) } })),
        notes: [
          `${plural(tally.total, 'request')} · ${tally.completed} completed`
          + ` · ${tally.rejected} rejected.`,
        ],
      };
    },
  },

  stuck_plant_head: {
    key: 'stuck_plant_head',
    kind: 'predicate',
    label: `Stuck at plant head · older than ${fmtDays(SLA_DAYS.plantHead)}`,
    description: `Awaiting plant-head approval for longer than the ${fmtDays(SLA_DAYS.plantHead)} threshold — the same predicate the tile counts.`,
    columns: ['waiting'],
    select(universe, ctx) {
      const stuck = stuckAtPlantHead(universe, ctx.now);
      return {
        rows: stuck.map((request) => ({ request, evidence: { waiting: waitingEvidence(request, ctx) } })),
        notes: [
          `${plural(stuck.length, 'request')} past the ${fmtDays(SLA_DAYS.plantHead)} plant-head threshold.`
          + ` ${universe.filter((r) => r.status === 'pending_head_approval').length - stuck.length}`
          + ' other request(s) are with the plant head but still inside it.',
        ],
      };
    },
  },

  rejection_rate: {
    key: 'rejection_rate',
    kind: 'ratio',
    label: 'Rejection rate · all requests, rejected marked',
    description: 'The denominator of the rate — every request in scope, with the rejected ones marked.',
    columns: ['outcome'],
    select(universe) {
      const rows = universe.map((request) => {
        const rejected = request.status === 'rejected';
        return {
          request,
          evidence: { outcome: { inNumerator: rejected, label: rejected ? 'Rejected' : 'Not rejected' } },
        };
      });
      // The rate itself comes from `statusTally` (kpiUtils) — the same helper that owns the
      // Administration tile's figure — so the fraction on this page is the tile's own fraction and
      // not a second, lookalike formula.
      const tally = statusTally(universe);
      return {
        rows,
        numerator: tally.rejected,
        denominator: tally.total,
        notes: [
          `${tally.rejected} of ${plural(tally.total, 'request')} rejected`
          + `${tally.total ? ` (${fmtPct(tally.rejectionRatePct)})` : ''}.`,
        ],
      };
    },
  },

  sourcing_cycle: {
    key: 'sourcing_cycle',
    kind: 'cohort',
    label: 'Sourcing cycle time · the measured sample',
    description: 'The requests this median was measured over (sourcing → PI requested).',
    columns: ['duration'],
    select(universe) {
      const rows: MetricRow[] = [];
      const samples: number[] = [];
      let stillOpen = 0;
      for (const request of universe) {
        const s = stageDaySample(request, 'sourcing', 'pi_requested');
        if (s.state === 'sampled') {
          samples.push(s.days);
          rows.push({ request, evidence: { duration: { days: s.days, note: 'sourcing → PI requested' } } });
        } else if (s.state === 'open') {
          stillOpen++;
        }
      }
      const medianDays = median(samples);
      return {
        rows,
        sampled: samples.length,
        stillOpen,
        medianDays,
        notes: [
          `Median ${fmtDays(medianDays)} over ${plural(samples.length, 'completed request')}.`,
          // Same honesty as the leg metrics: a request REJECTED at sourcing never reaches
          // `pi_requested`, so it is a start with no recorded finish rather than work in flight.
          // (This count is `medianStageDays.stillOpen`, which the tile's sub shows too — the
          // wording is corrected on both surfaces by being derived from the one helper.)
          stillOpen > 0
            ? `Excluded from the median: ${plural(stillOpen, 'request')} that reached sourcing with`
              + ' no recorded PI request (including any rejected there). Not listed below —'
              + ' the median measures finished work only.'
            : 'Every request that reached sourcing also reached PI requested, so nothing is'
              + ' excluded from the median.',
        ],
      };
    },
  },

  invite_first_quote: legMetric('invite_first_quote', 'firstQuote', 'Invite → first quote · the measured sample'),
  first_quote_agreed: legMetric('first_quote_agreed', 'negotiation', 'First quote → agreed · the measured sample'),
  tech_spec_gate: legMetric('tech_spec_gate', 'techSpec', 'Tech-spec gate · the measured sample'),

  vendor_participation: {
    key: 'vendor_participation',
    kind: 'ratio',
    label: 'Vendor participation · quoted of invited',
    description: 'The denominator of the rate — every request with invited vendors, showing how many of them quoted.',
    columns: ['participation'],
    select(universe, ctx) {
      const rows: MetricRow[] = [];
      let quoted = 0;
      let invited = 0;
      for (const request of universe) {
        const reqInvites = ctx.byRequest.get(request.id) ?? [];
        invited += reqInvites.length;
        const q = reqInvites.filter(inviteHasQuote).length;
        quoted += q;
        if (reqInvites.length) {
          rows.push({ request, evidence: { participation: { quoted: q, invited: reqInvites.length } } });
        }
      }
      return {
        rows,
        numerator: quoted,
        denominator: invited,
        notes: [
          `${quoted} of ${plural(invited, 'invited vendor')} quoted`
          + `${invited ? ` (${fmtPct((quoted / invited) * 100)})` : ''},`
          + ` across ${plural(rows.length, 'request')}.`,
        ],
      };
    },
  },
};

export function isMetricKey(value: string): value is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, value);
}

/**
 * THE route builder for every dashboard KPI that links into `/capex/requests`. One home, on purpose.
 *
 * `plant` is the dashboards' plant lens. When a tile's number is scoped to one plant its destination
 * must be too, or the list contradicts the number it was reached from — `?plant=` is a narrowing
 * param `buildRequestListView` applies (precedence rule 2) BEFORE the metric selects its cohort, so
 * tile and list stay equal. Pass `null`/`undefined` (no lens) and the route is unchanged.
 *
 * ── Why this lives here and nowhere else ──
 *
 * There were two implementations of this one rule: `AdminDashboard` appended `&plant=` by hand
 * because this builder took no plant, and `kpiSourcing` carried its own `scopedMetricHref`. They
 * were byte-identical when written and DIVERGED inside a single review window (one moved to
 * `URLSearchParams`, so one emitted `%20` for a space and the other `+`). Nothing broke only because
 * plant values happen to be slugified today. Two copies of one rule is the drift defect this whole
 * feature exists to remove, so there is exactly one now, and the encoding is pinned by a test.
 *
 * Built through `URLSearchParams`, not concatenated: it is correct whether or not the base already
 * carries a query string, and it escapes the value on the way out. It renders a space as `+`, which
 * is a valid query-string space and what `URLSearchParams` (and therefore `useSearchParams`) reads
 * back — the test asserts the ROUND TRIP, not just the spelling.
 */
export function metricHref(key: MetricKey, plant?: string | null): string {
  const params = new URLSearchParams({ metric: key });
  if (plant) params.set('plant', plant);
  return `/capex/requests?${params.toString()}`;
}

/* ── the view ─────────────────────────────────────────────────────────── */

/**
 * A param that was present in the URL but could NOT be applied (stale bookmark, hand-typed value,
 * a metric key that has since been renamed). Never dropped silently — see `FallbackNotice`.
 */
export interface IgnoredParam {
  param: FilterParam;
  value: string;
  reason: string;
}

/**
 * What to tell the user when something in the URL could not be applied.
 *
 * TWO INDEPENDENT FACTS, stated separately, because conflating them is how the first version of
 * this banner lied: `?metric=sourcing_cycle&overdue=yes` ignores one param while the OTHER still
 * filters the list, and a single "showing the unfiltered list" headline then contradicted the chip
 * sitting directly above it. `headline` names the failure only; `showing` describes what is
 * actually on screen and is derived from the filters that were applied, so it can never disagree
 * with the chips.
 */
export interface FallbackNotice {
  headline: string;
  showing: string;
  /** True only when NOTHING was applied and the list really is every row in scope. */
  listIsUnfiltered: boolean;
  items: IgnoredParam[];
}

export interface RequestListView {
  rows: MetricRow[];
  columns: EvidenceColumn[];
  chips: ActiveFilter[];
  notes: string[];
  metric: MetricDef | null;
  ignored: IgnoredParam[];
  /** `null` when every param was usable — the page renders no banner then. */
  notice: FallbackNotice | null;
  sampled?: number;
  stillOpen?: number;
  medianDays?: number | null;
  numerator?: number;
  denominator?: number;
}

const isSet = (v: string | null | undefined): v is string => !!v && v.trim().length > 0;

const isStatus = (v: string): v is CapexStatus => (CAPEX_STATUS_FLOW as string[]).includes(v);

/** Builds the notice from the two facts — see `FallbackNotice`. */
function buildNotice(ignored: IgnoredParam[], applied: ActiveFilter[]): FallbackNotice | null {
  if (!ignored.length) return null;
  const listIsUnfiltered = applied.length === 0;
  return {
    headline: ignored.length === 1
      ? 'One filter in this link could not be applied'
      : `${ignored.length} filters in this link could not be applied`,
    showing: listIsUnfiltered
      ? 'Nothing else was filtered, so this list is every request in your scope.'
      : `The ${plural(applied.length, 'filter')} shown above`
        + ` ${applied.length === 1 ? 'is' : 'are'} still applied — this list IS filtered.`,
    listIsUnfiltered,
    items: ignored,
  };
}

/**
 * Apply `?metric` / `?filter` / `?plant` / `?vendor` / `?overdue` to an ALREADY role-scoped
 * request array. See the module doc for the precedence rules — narrowing params first, metric
 * second, and anything unusable reported in `ignored` rather than silently dropped.
 */
export function buildRequestListView(
  params: RequestListParams,
  ctx: RequestListContext,
): RequestListView {
  const label = ctx.labels ?? {};
  const chips: ActiveFilter[] = [];
  const ignored: IgnoredParam[] = [];
  let universe = ctx.requests;

  // ── 2. narrowing params (AND, order irrelevant) ──
  const rawStatus = isSet(params.filter) ? params.filter.trim() : null;
  if (rawStatus && isStatus(rawStatus)) {
    universe = universe.filter((r) => r.status === rawStatus);
    chips.push({
      param: 'filter',
      value: rawStatus,
      words: `Status: ${label.status?.(rawStatus) ?? rawStatus}`,
    });
  } else if (rawStatus) {
    ignored.push({ param: 'filter', value: rawStatus, reason: 'not a known request status' });
  }

  // `known.*` is optional: with no roster supplied the value applies as given (the pre-existing
  // behaviour), with one, an unrecognised value is reported instead of quietly filtering to zero.
  const knownPlants = ctx.known?.plants ? new Set(ctx.known.plants) : null;
  const knownVendors = ctx.known?.vendors ? new Set(ctx.known.vendors) : null;

  if (isSet(params.plant)) {
    const plant = params.plant.trim();
    if (knownPlants && !knownPlants.has(plant)) {
      ignored.push({ param: 'plant', value: plant, reason: 'not a plant on record' });
    } else {
      universe = universe.filter((r) => r.plant === plant);
      chips.push({ param: 'plant', value: plant, words: `Plant: ${label.plant?.(plant) ?? plant}` });
    }
  }

  if (isSet(params.vendor)) {
    const vendorId = params.vendor.trim();
    if (knownVendors && !knownVendors.has(vendorId)) {
      ignored.push({ param: 'vendor', value: vendorId, reason: 'not a vendor on the roster' });
    } else {
      universe = universe.filter(
        (r) => (ctx.byRequest.get(r.id) ?? []).some((i) => i.vendorId === vendorId),
      );
      chips.push({
        param: 'vendor',
        value: vendorId,
        words: `Vendor: ${label.vendor?.(vendorId) ?? vendorId}`,
      });
    }
  }

  if (isSet(params.overdue)) {
    if (params.overdue.trim() === '1') {
      universe = universe.filter((r) => {
        const hold = worstHold(r, ctx.byRequest.get(r.id) ?? [], ctx.now);
        return holdBreach(hold) != null;
      });
      chips.push({ param: 'overdue', value: '1', words: 'Past its SLA only' });
    } else {
      ignored.push({
        param: 'overdue',
        value: params.overdue.trim(),
        // Reads as a sentence on its own — the page prints the reason verbatim.
        reason: 'not a valid value: the only accepted value is overdue=1',
      });
    }
  }

  // ── 3./4. the metric ──
  const rawMetric = isSet(params.metric) ? params.metric.trim() : null;
  if (rawMetric && !isMetricKey(rawMetric)) {
    ignored.push({ param: 'metric', value: rawMetric, reason: 'not a known metric' });
  }

  if (!rawMetric || !isMetricKey(rawMetric)) {
    return {
      rows: universe.map((request) => ({ request, evidence: {} })),
      columns: [],
      chips,
      notes: [],
      metric: null,
      ignored,
      notice: buildNotice(ignored, chips),
    };
  }

  const def = METRICS[rawMetric];
  const selection = def.select(universe, ctx);
  chips.unshift({ param: 'metric', value: def.key, words: def.label });

  return {
    rows: selection.rows,
    columns: def.columns,
    chips,
    notes: selection.notes,
    metric: def,
    ignored,
    // Built AFTER the metric chip is unshifted: a metric is itself an applied filter, so a list
    // narrowed by a cohort must never be described as unfiltered.
    notice: buildNotice(ignored, chips),
    sampled: selection.sampled,
    stillOpen: selection.stillOpen,
    medianDays: selection.medianDays,
    numerator: selection.numerator,
    denominator: selection.denominator,
  };
}
