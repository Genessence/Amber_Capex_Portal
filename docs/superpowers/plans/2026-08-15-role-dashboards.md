# Role-Specific Dashboards & KPIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared dashboard at `/capex/dashboard` with four role-resolved dashboards (Buyer, Sourcing, Administration, Maintenance) backed by one pure, tested KPI derivation layer.

**Architecture:** A pure derivation layer in `src/lib/kpi*.ts` (no React, no I/O, no clock reads — `now` is always injected) is consumed by presentational components in `src/components/dashboards/`. The route file becomes a role resolver only. Every dashboard renders the same three bands: ① my turn → ② waiting on → ③ outcomes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4, lucide-react. New devDependency: `vitest` (lib layer only).

**Spec:** `docs/superpowers/specs/2026-08-15-role-dashboards-design.md`

## Global Constraints

- **No new persisted state.** No new types, statuses, roles, context mutations, or `capex_data_v2` keys. The KPI layer is read-only over what `CapexProvider` already exposes. No migration.
- **INR basis everywhere.** Every cross-vendor or portfolio total goes through `toInr` (`currencyUtils.ts`).
- **Award-aware everywhere.** Any per-request aggregate iterates `awardedInvites` when `isAwardBased(invites)`, matching `accounts/queue/page.tsx:59-76`.
- **`now` is injected.** No helper in `src/lib/kpi*.ts` calls `Date.now()` or `new Date()` with no argument. This is what makes the layer testable.
- **Master `totalCost` is in Crore.** Multiply by `1_00_00_000` for INR. Never mix bases.
- **Relative imports only inside `src/lib`.** No `@/` aliases there (the existing lib has none), which is what lets vitest run with zero config.
- **Density tokens.** `PAGE_SHELL`, `SECTION_GAP`, `SECTION_GRID`, `CARD`, `CARD_TIGHT`, `TD_CELL` from `src/lib/uiTokens.ts`. No hardcoded padding scales.
- **Colour rules.** Grayscale + blue `#2563EB` chrome; **emerald** for savings / under-budget; **red** for over-budget / SLA breach. Colour is never the sole carrier of meaning.
- **Verification gate** (from `CLAUDE.md`): `npm test` for the lib layer, then `npx tsc --noEmit`, then `npm run build`. **`npm run lint` is broken in this repo — never run it.**
- **TypeScript strict**, with `isolatedModules: true` (`tsconfig.json:17`). Prefer `import type` for type-only imports, and **never re-export a type without `export type`** — that is the one construct `isolatedModules` rejects outright. No `any` without a comment explaining why.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/kpiUtils.ts` | Core primitives: SLA constants, time/aging, stage durations, canonical request value, savings, ball holder |
| `src/lib/kpiPortfolio.ts` | FY budget position, head positions, value funnel |
| `src/lib/kpiRisk.ts` | Delay-liability exposure, vendor scorecard |
| `src/lib/kpiQueues.ts` | The ① / ② buckets for all four roles |
| `src/components/dashboards/useNow.ts` | 60s clock hook, hydration-safe |
| `src/components/dashboards/KpiTile.tsx` | One KPI tile: value, sub, caption, tone, optional link |
| `src/components/dashboards/ActionQueue.tsx` | Renders a `QueueBucket[]` band, expandable to its rows |
| `src/components/dashboards/DashboardTabs.tsx` | Tab shell, active tab in `?view=` |
| `src/components/dashboards/charts.tsx` | `DonutChart` / `HBarChart` / `SavingsBreakdown`, lifted from the current page |
| `src/components/dashboards/BuyerDashboard.tsx` | Buyer surface |
| `src/components/dashboards/SourcingDashboard.tsx` | Sourcing surface (Desk \| Performance) |
| `src/components/dashboards/AdminDashboard.tsx` | Administration surface (My Desk \| Portfolio) |
| `src/components/dashboards/MaintenanceDashboard.tsx` | Maintenance surface |
| `src/app/(internal)/capex/dashboard/page.tsx` | Role resolver only — all metric logic removed |

**This refines spec §13**, which listed a single `kpiUtils.ts`. Four focused lib files beat one 700-line file, and the split follows the codebase's existing flat `*Utils.ts` convention.

---

### Task 1: Test harness + time primitives

**Files:**
- Modify: `package.json:5-11` (scripts), `package.json:26-35` (devDependencies)
- Create: `src/lib/kpiUtils.ts`
- Test: `src/lib/kpiUtils.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `SLA_DAYS`, `SlaKey`, `TERMINAL_STATUSES`, `DAY_MS`, `CR`, `ageInDays(iso, now)`, `oldestAgeDays(isos, now)`, `statusHistoryOf(request)`, `stageDurations(request, now)`, `firstReachedAt(request, status)`, `median(values)`, `medianStageDays(requests, from, to)`, `invitesByRequest(invites)`

- [ ] **Step 1: Install vitest and add scripts**

```bash
npm install --save-dev vitest
```

Then edit `package.json` scripts to add two entries (keep the existing four):

```json
"test": "vitest run",
"test:watch": "vitest"
```

No `vitest.config.ts` is needed: `src/lib` uses only relative imports, and vitest's default `include` already covers `**/*.test.ts`.

- [ ] **Step 2: Write the failing test**

Create `src/lib/kpiUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ageInDays, oldestAgeDays, statusHistoryOf, stageDurations,
  firstReachedAt, median, medianStageDays, invitesByRequest, DAY_MS,
} from './kpiUtils';
import type { CapexRequest, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'Chiller', category: 'Machinery', quantity: '1',
    priority: 'medium', justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing',
    createdBy: 'Arjun Mehta', createdAt: iso(10),
    ...over,
  };
}

describe('ageInDays', () => {
  it('returns whole and fractional days since the timestamp', () => {
    expect(ageInDays(iso(3), NOW)).toBeCloseTo(3);
  });
  it('returns null for missing or unparseable input', () => {
    expect(ageInDays(undefined, NOW)).toBeNull();
    expect(ageInDays('not-a-date', NOW)).toBeNull();
  });
  it('never returns a negative age for a future timestamp', () => {
    expect(ageInDays(new Date(NOW + DAY_MS).toISOString(), NOW)).toBe(0);
  });
});

describe('oldestAgeDays', () => {
  it('returns the largest age and ignores missing entries', () => {
    expect(oldestAgeDays([iso(1), undefined, iso(7)], NOW)).toBeCloseTo(7);
  });
  it('returns null when nothing is datable', () => {
    expect(oldestAgeDays([undefined], NOW)).toBeNull();
  });
});

describe('statusHistoryOf', () => {
  it('synthesises a single entry when history is absent (legacy records)', () => {
    const r = req({ statusHistory: undefined });
    expect(statusHistoryOf(r)).toEqual([
      { status: 'sourcing', actor: 'Arjun Mehta', at: r.createdAt },
    ]);
  });
});

describe('stageDurations', () => {
  it('measures each stage up to the next transition', () => {
    const r = req({
      status: 'sourcing',
      statusHistory: [
        { status: 'submitted', actor: 'A', at: iso(10) },
        { status: 'pending_head_approval', actor: 'A', at: iso(8) },
        { status: 'sourcing', actor: 'B', at: iso(5) },
      ],
    });
    const d = stageDurations(r, NOW);
    expect(d.map(x => Math.round(x.ms / DAY_MS))).toEqual([2, 3, 5]);
    expect(d[2].open).toBe(true);
  });

  it('does not accrue time on a terminal final stage', () => {
    const r = req({
      status: 'completed',
      statusHistory: [
        { status: 'sourcing', actor: 'B', at: iso(9) },
        { status: 'completed', actor: 'B', at: iso(4) },
      ],
    });
    const d = stageDurations(r, NOW);
    expect(Math.round(d[0].ms / DAY_MS)).toBe(5);
    expect(d[1].ms).toBe(0);
    expect(d[1].open).toBe(false);
  });
});

describe('medianStageDays', () => {
  it('medians only requests that reached the end status, and counts the rest as open', () => {
    const done = (from: number, to: number) => req({
      statusHistory: [
        { status: 'sourcing', actor: 'B', at: iso(from) },
        { status: 'pi_requested', actor: 'B', at: iso(to) },
      ],
    });
    const open = req({ statusHistory: [{ status: 'sourcing', actor: 'B', at: iso(20) }] });
    const r = medianStageDays([done(10, 6), done(10, 2), open], 'sourcing', 'pi_requested');
    expect(r.medianDays).toBeCloseTo(6);
    expect(r.sampled).toBe(2);
    expect(r.stillOpen).toBe(1);
  });

  it('returns a null median when nothing qualifies', () => {
    expect(medianStageDays([], 'sourcing', 'completed').medianDays).toBeNull();
  });
});

describe('median', () => {
  it('averages the middle pair for an even-length set', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('invitesByRequest', () => {
  it('groups invites by their requestId', () => {
    const inv = (id: string, requestId: string) => ({ id, requestId } as VendorInvite);
    const m = invitesByRequest([inv('i1', 'r1'), inv('i2', 'r1'), inv('i3', 'r2')]);
    expect(m.get('r1')?.map(i => i.id)).toEqual(['i1', 'i2']);
    expect(m.get('r2')?.map(i => i.id)).toEqual(['i3']);
    expect(m.get('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./kpiUtils"`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/kpiUtils.ts`:

```ts
/**
 * Pure KPI derivations for the role dashboards.
 *
 * No React, no I/O, and no clock reads — `now` is always injected, which is what makes every
 * helper deterministic and directly testable. Money is INR unless a name says `Cr`.
 */
import type { CapexRequest, CapexStatus, VendorInvite } from './types';

export const DAY_MS = 24 * 60 * 60 * 1000;
/** One Crore in rupees — master `totalCost` is stored in Cr. */
export const CR = 1_00_00_000;

/**
 * How long a party may hold the ball before a queue bucket is flagged as breached.
 * These are plausible placeholders, not measured SLAs — one const to change when a real
 * policy exists.
 */
export const SLA_DAYS = {
  vendorQuote: 5,
  techSpec: 3,
  plantHead: 3,
  adminApproval: 3,
  accounts: 3,
  vendorPi: 3,
  trialReview: 2,
} as const;
export type SlaKey = keyof typeof SLA_DAYS;

/** Statuses after which a request stops accruing time in stage. */
export const TERMINAL_STATUSES: CapexStatus[] = ['completed', 'rejected'];

/* ── time ─────────────────────────────────────────────────────────────── */

export function ageInDays(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, (now - t) / DAY_MS);
}

export function oldestAgeDays(isos: (string | undefined)[], now: number): number | null {
  const ages = isos.map((i) => ageInDays(i, now)).filter((n): n is number => n != null);
  return ages.length ? Math.max(...ages) : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/* ── stage timing (from statusHistory) ────────────────────────────────── */

export type StatusHistoryEntry = { status: CapexStatus; actor: string; at: string };

/**
 * `addRequest` has seeded a first history entry since capexContext.tsx:956-962, but legacy
 * records may predate it — synthesise one from the request itself so callers never branch.
 */
export function statusHistoryOf(request: CapexRequest): StatusHistoryEntry[] {
  const h = request.statusHistory;
  if (h && h.length) return h;
  return [{ status: request.status, actor: request.createdBy, at: request.createdAt }];
}

export interface StageDuration {
  status: CapexStatus;
  from: string;
  ms: number;
  /** Still accruing — the request is sitting in this stage right now. */
  open: boolean;
}

export function stageDurations(request: CapexRequest, now: number): StageDuration[] {
  const h = statusHistoryOf(request);
  return h.map((entry, i) => {
    const start = new Date(entry.at).getTime();
    const next = h[i + 1];
    const terminal = TERMINAL_STATUSES.includes(entry.status);
    // A terminal final stage does not accrue time — the workflow ended there.
    const end = next ? new Date(next.at).getTime() : terminal ? start : now;
    return {
      status: entry.status,
      from: entry.at,
      ms: Math.max(0, end - start),
      open: !next && !terminal,
    };
  });
}

export function firstReachedAt(request: CapexRequest, status: CapexStatus): string | undefined {
  return statusHistoryOf(request).find((e) => e.status === status)?.at;
}

export interface MedianResult {
  medianDays: number | null;
  /** Requests that actually reached the end status and were medianed. */
  sampled: number;
  /** Requests that started but never reached it — disclosed, never silently dropped. */
  stillOpen: number;
}

export function medianStageDays(
  requests: CapexRequest[],
  from: CapexStatus,
  to: CapexStatus,
): MedianResult {
  const days: number[] = [];
  let stillOpen = 0;
  for (const r of requests) {
    const a = firstReachedAt(r, from);
    if (!a) continue;
    const b = firstReachedAt(r, to);
    if (!b) {
      stillOpen++;
      continue;
    }
    const d = (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;
    if (d >= 0) days.push(d);
  }
  return { medianDays: median(days), sampled: days.length, stillOpen };
}

/* ── indexing ─────────────────────────────────────────────────────────── */

/**
 * Group invites once per render instead of filtering the whole array per request.
 * Every value/savings/ball-holder helper takes the already-scoped `VendorInvite[]`.
 */
export function invitesByRequest(invites: VendorInvite[]): Map<string, VendorInvite[]> {
  const m = new Map<string, VendorInvite[]>();
  for (const i of invites) {
    const list = m.get(i.requestId);
    if (list) list.push(i);
    else m.set(i.requestId, [i]);
  }
  return m;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/kpiUtils.ts src/lib/kpiUtils.test.ts
git commit -m "feat: KPI time primitives + vitest harness for the lib layer"
```

---

### Task 2: Canonical request value

**Files:**
- Modify: `src/lib/kpiUtils.ts` (append)
- Test: `src/lib/kpiUtils.test.ts` (append)

**Interfaces:**
- Consumes: `CR`, `invitesByRequest` (Task 1)
- Produces: `MasterIndex`, `masterIndex(capexMaster)`, `allocatedForRequest(request, index)`, `ValueBasis`, `RequestValue`, `requestValue(request, reqInvites, index)`, `paidForRequest(request, reqInvites)`, `poIssuedForRequest(request, reqInvites)`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/kpiUtils.test.ts`:

```ts
import { masterIndex, allocatedForRequest, requestValue, paidForRequest } from './kpiUtils';
import type { CapexMasterItem, PaymentMilestone } from './types';

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac',
    ...over,
  };
}

function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't1', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(6), auctionApprovalStatus: 'not_sent',
    ...over,
  };
}

describe('allocatedForRequest', () => {
  it('sums linked master totalCost in Cr and converts to INR', () => {
    const idx = masterIndex([master({ id: 'm1', totalCost: 2 }), master({ id: 'm2', totalCost: 0.5 })]);
    const r = req({
      lineItems: [
        { id: 'l1', masterItemId: 'm1', description: 'A', category: 'M', quantity: '1' },
        { id: 'l2', masterItemId: 'm2', description: 'B', category: 'M', quantity: '1' },
      ],
    });
    expect(allocatedForRequest(r, idx)).toBe(2.5 * 1_00_00_000);
  });

  it('falls back to the request-level master link when there are no line items', () => {
    const idx = masterIndex([master({ id: 'm9', totalCost: 1 })]);
    expect(allocatedForRequest(req({ masterItemId: 'm9' }), idx)).toBe(1_00_00_000);
  });

  it('returns 0 when nothing is linked', () => {
    expect(allocatedForRequest(req(), masterIndex([]))).toBe(0);
  });
});

describe('requestValue', () => {
  const idx = masterIndex([master({ id: 'm1', totalCost: 3 })]);

  it('prefers the sum of award amounts on an award-based request', () => {
    const v = requestValue(req(), [
      invite({ id: 'i1', awarded: true, awardAmount: 400 }),
      invite({ id: 'i2', awarded: true, awardAmount: 600 }),
      invite({ id: 'i3' }),
    ], idx);
    expect(v).toEqual({ inr: 1000, basis: 'awarded' });
  });

  it('uses the finalized vendor RFQ quotation when there is no split award', () => {
    const r = req({ finalVendorId: 'v1', sourcingMode: 'rfq' });
    const v = requestValue(r, [invite({ rfqQuote: { price: 900, freight: 100 }, rfqStatus: 'approved' })], idx);
    expect(v).toEqual({ inr: 1000, basis: 'awarded' });
  });

  it('falls back to the lowest live offer, on an INR basis', () => {
    const v = requestValue(req(), [
      invite({ id: 'i1', rfqQuote: { price: 1000, currency: 'INR' }, rfqStatus: 'pending_sourcing' }),
      invite({ id: 'i2', rfqQuote: { price: 900, currency: 'INR' }, rfqStatus: 'pending_sourcing' }),
    ], idx);
    expect(v.basis).toBe('quoted');
    expect(v.inr).toBe(900);
  });

  it('falls back to the estimate, then the allocation, then zero', () => {
    expect(requestValue(req({ budget: 750 }), [], idx)).toEqual({ inr: 750, basis: 'estimated' });
    const linked = req({ lineItems: [{ id: 'l1', masterItemId: 'm1', description: 'A', category: 'M', quantity: '1' }] });
    expect(requestValue(linked, [], idx)).toEqual({ inr: 3 * 1_00_00_000, basis: 'allocated' });
    expect(requestValue(req(), [], masterIndex([]))).toEqual({ inr: 0, basis: 'none' });
  });
});

describe('paidForRequest', () => {
  const ms = (amount: number, status: PaymentMilestone['status']): PaymentMilestone =>
    ({ id: `pm${amount}`, label: 'x', percent: 10, amount, status });

  it('sums paid milestones across awards when the request is award-based', () => {
    const total = paidForRequest(req(), [
      invite({ id: 'i1', awarded: true, paymentMilestones: [ms(100, 'paid'), ms(50, 'pending')] }),
      invite({ id: 'i2', awarded: true, paymentMilestones: [ms(200, 'paid')] }),
    ]);
    expect(total).toBe(300);
  });

  it('uses request-level milestones for a single-vendor request', () => {
    expect(paidForRequest(req({ paymentMilestones: [ms(75, 'paid'), ms(25, 'pending')] }), [])).toBe(75);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `masterIndex is not exported` / `requestValue is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/kpiUtils.ts` (and extend the top-level import to include `CapexMasterItem`):

```ts
import { effectiveRfqStatus, inrRfqTotal } from './rfqUtils';
import {
  awardedInvites, inrQuoteGrandTotal, isAwardBased, totalPaid,
} from './paymentUtils';

/* ── value ────────────────────────────────────────────────────────────── */

export type MasterIndex = Map<string, CapexMasterItem>;

export function masterIndex(capexMaster: CapexMasterItem[]): MasterIndex {
  return new Map(capexMaster.map((m) => [m.id, m]));
}

/** Σ linked master allocation in INR (`totalCost` is Cr). */
export function allocatedForRequest(request: CapexRequest, index: MasterIndex): number {
  const lines = request.lineItems ?? [];
  if (lines.length) {
    return lines.reduce(
      (s, l) => s + (l.masterItemId ? (index.get(l.masterItemId)?.totalCost ?? 0) * CR : 0),
      0,
    );
  }
  return request.masterItemId ? (index.get(request.masterItemId)?.totalCost ?? 0) * CR : 0;
}

/**
 * Where a request's headline number came from. Always rendered next to the figure — a number
 * whose provenance is invisible is worse than no number.
 */
export type ValueBasis = 'awarded' | 'approved' | 'quoted' | 'estimated' | 'allocated' | 'none';

export interface RequestValue {
  inr: number;
  basis: ValueBasis;
}

export const VALUE_BASIS_LABELS: Record<ValueBasis, string> = {
  awarded: 'awarded',
  approved: 'approved quotation',
  quoted: 'lowest live quote',
  estimated: 'estimated',
  allocated: 'allocated budget',
  none: 'no value yet',
};

/**
 * The canonical "what does this request cost / will it cost", on an INR basis.
 * One fallback chain, used by every money KPI on every dashboard.
 */
export function requestValue(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): RequestValue {
  if (isAwardBased(reqInvites)) {
    const inr = awardedInvites(reqInvites).reduce((s, i) => s + (i.awardAmount ?? 0), 0);
    return { inr, basis: 'awarded' };
  }

  if (request.finalVendorId) {
    const inv = reqInvites.find((i) => i.vendorId === request.finalVendorId);
    if (inv?.rfqQuote) return { inr: inrRfqTotal(inv.rfqQuote, request.lineItems), basis: 'awarded' };
  }

  const approved = reqInvites.find((i) => i.rfqQuote && effectiveRfqStatus(i) === 'approved');
  if (approved?.rfqQuote) {
    return { inr: inrRfqTotal(approved.rfqQuote, request.lineItems), basis: 'approved' };
  }

  const offers: number[] = [];
  for (const i of reqInvites) {
    if (i.rfqQuote) offers.push(inrRfqTotal(i.rfqQuote, request.lineItems));
    const q = i.quotes[i.quotes.length - 1] ?? i.openingQuote;
    if (q) offers.push(inrQuoteGrandTotal(q));
  }
  if (offers.length) return { inr: Math.min(...offers), basis: 'quoted' };

  if (request.budget != null && request.budget > 0) return { inr: request.budget, basis: 'estimated' };

  const alloc = allocatedForRequest(request, index);
  if (alloc > 0) return { inr: alloc, basis: 'allocated' };

  return { inr: 0, basis: 'none' };
}

/** Σ paid milestones — per award when award-based, else request-level. */
export function paidForRequest(request: CapexRequest, reqInvites: VendorInvite[]): number {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).reduce((s, i) => s + totalPaid(i.paymentMilestones ?? []), 0);
  }
  return totalPaid(request.paymentMilestones ?? []);
}

/** Σ PO value that has actually been issued to a vendor. */
export function poIssuedForRequest(request: CapexRequest, reqInvites: VendorInvite[]): number {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).reduce(
      (s, i) => s + (i.purchaseOrder?.issuedAt ? i.purchaseOrder.amount : 0),
      0,
    );
  }
  const po = request.purchaseOrder;
  return po?.issuedAt ? po.amount : 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiUtils.ts src/lib/kpiUtils.test.ts
git commit -m "feat: canonical INR request value with documented fallback basis"
```

---

### Task 3: Savings

**Files:**
- Modify: `src/lib/kpiUtils.ts` (append)
- Test: `src/lib/kpiUtils.test.ts` (append)

**Interfaces:**
- Consumes: `requestValue`, `allocatedForRequest`, `MasterIndex` (Task 2)
- Produces: `offerForItems(linePrices, itemIds, lineItems, currency)`, `RequestSavings`, `savingsForRequest(request, reqInvites, index)`

**Why two comparability flags:** negotiation savings and budget savings fail independently — a request can have a first quote but no master link, or vice versa. Spec §4.3 described a single `comparable`; two flags let the tiles report each exclusion count honestly. This is a deliberate refinement.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/kpiUtils.test.ts`:

```ts
import { offerForItems, savingsForRequest } from './kpiUtils';
import type { CapexLineItem } from './types';

const line = (id: string, quantity = '1'): CapexLineItem =>
  ({ id, description: id, category: 'Machinery', quantity });

describe('offerForItems', () => {
  it('sums unit x qty for the given items only, ignoring unlisted ones', () => {
    const items = [line('l1', '2'), line('l2', '3')];
    expect(offerForItems({ l1: 100, l2: 50 }, ['l1'], items, 'INR')).toBe(200);
  });

  it('converts a foreign-currency offer to INR', () => {
    const items = [line('l1')];
    const inr = offerForItems({ l1: 100 }, ['l1'], items, 'USD');
    expect(inr).toBeGreaterThan(100);
  });

  it('treats an unpriced item as zero rather than throwing', () => {
    expect(offerForItems({}, ['l1'], [line('l1')], 'INR')).toBe(0);
  });
});

describe('savingsForRequest', () => {
  const idx = masterIndex([master({ id: 'm1', totalCost: 0.001 })]); // ₹1,00,000

  it('returns null when the request has not been awarded or approved', () => {
    const r = req({ lineItems: [line('l1')] });
    expect(savingsForRequest(r, [invite({ rfqQuote: { price: 500 }, rfqStatus: 'pending_sourcing' })], idx)).toBeNull();
  });

  it('measures single-vendor negotiation from the first supplier quotation to the final', () => {
    const r = req({ finalVendorId: 'v1', sourcingMode: 'rfq', lineItems: [line('l1')] });
    const inv = invite({
      rfqStatus: 'approved',
      rfqQuote: { price: 800, currency: 'INR' },
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5), quote: { price: 1000, currency: 'INR' } },
        { id: 'm2', by: 'sourcing', senderName: 'S', action: 'countered', at: iso(4), quote: { price: 800, currency: 'INR' } },
      ],
    });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.negotiation).toBe(200);
    expect(s?.negotiationComparable).toBe(true);
  });

  it('measures split-award negotiation per vendor, restricted to that vendor awarded lines', () => {
    const r = req({ lineItems: [line('l1'), line('l2')] });
    const inv = invite({
      awarded: true, awardedItemIds: ['l1'], awardAmount: 700,
      rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'V', action: 'proposed', at: iso(5),
          quote: { price: 1500, linePrices: { l1: 1000, l2: 500 }, currency: 'INR' } },
      ],
    });
    // Only l1 counts on both sides: 1000 offered vs 700 awarded.
    expect(savingsForRequest(r, [inv], idx)?.negotiation).toBe(300);
  });

  it('flags negotiation as not comparable when there is no first offer to compare against', () => {
    const r = req({ lineItems: [line('l1')] });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 700 });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.negotiation).toBe(0);
    expect(s?.negotiationComparable).toBe(false);
  });

  it('measures budget savings against the linked master allocation', () => {
    const r = req({
      lineItems: [{ ...line('l1'), masterItemId: 'm1' }],
    });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 60_000 });
    const s = savingsForRequest(r, [inv], idx);
    expect(s?.budget).toBe(40_000);
    expect(s?.budgetComparable).toBe(true);
  });

  it('flags budget as not comparable with no allocation and no estimate', () => {
    const r = req({ lineItems: [line('l1')] });
    const inv = invite({ awarded: true, awardedItemIds: ['l1'], awardAmount: 700 });
    expect(savingsForRequest(r, [inv], idx)?.budgetComparable).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `offerForItems is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/kpiUtils.ts` (extend the type import to include `CapexLineItem`, and add the two new value imports):

```ts
import { toInr } from './currencyUtils';
import { gstAmount } from './hsnGst';

/* ── savings ──────────────────────────────────────────────────────────── */

function firstSupplierRfqQuote(invite: VendorInvite) {
  return invite.rfqThread?.find((m) => m.by === 'supplier' && m.quote)?.quote;
}

/**
 * Σ (unit × qty) + item-wise GST for a SUBSET of line items, converted to INR.
 *
 * This is exactly the basis `buildAwardGroups` uses for `awardAmount`, which is what makes a
 * split-award comparison like-for-like. Freight / packing / service are deliberately excluded
 * from both sides: they are whole-quote charges that cannot be attributed to a subset of lines.
 */
export function offerForItems(
  linePrices: Record<string, number> | undefined,
  itemIds: string[],
  lineItems: CapexLineItem[],
  currency?: string,
): number {
  const byId = new Map(lineItems.map((l) => [l.id, l]));
  let total = 0;
  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item) continue;
    const unit = linePrices?.[id] ?? 0;
    const qty = parseFloat(item.quantity) || 1;
    const net = unit * qty;
    total += net + gstAmount(net, item.hsnCode);
  }
  return toInr(total, currency);
}

export interface RequestSavings {
  /** First offer → final, like-for-like. */
  negotiation: number;
  /** Allocation (or estimate) → final. */
  budget: number;
  negotiationComparable: boolean;
  budgetComparable: boolean;
}

/**
 * Savings for a request, or `null` when nothing has been awarded or approved yet — a live
 * quote is not a saving, and counting it as one would inflate every aggregate on the page.
 */
export function savingsForRequest(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): RequestSavings | null {
  const value = requestValue(request, reqInvites, index);
  if (value.basis !== 'awarded' && value.basis !== 'approved') return null;

  const lines = request.lineItems ?? [];
  let negotiation = 0;
  let negotiationComparable = true;

  if (isAwardBased(reqInvites)) {
    for (const inv of awardedInvites(reqInvites)) {
      const ids = inv.awardedItemIds ?? [];
      const first = firstSupplierRfqQuote(inv);
      // Auction ranks reset on start: the seeded opening bid lives on `openingQuote`, never in
      // `quotes[]` (which `submitQuote` overwrites in place with the current bid).
      const openingPrices = first?.linePrices ?? inv.openingQuote?.itemPrices;
      const currency = first?.currency ?? inv.openingQuote?.currency;
      if (!openingPrices || !ids.length) {
        negotiationComparable = false;
        continue;
      }
      negotiation += offerForItems(openingPrices, ids, lines, currency) - (inv.awardAmount ?? 0);
    }
  } else {
    const inv = request.finalVendorId
      ? reqInvites.find((i) => i.vendorId === request.finalVendorId)
      : reqInvites.find((i) => i.rfqQuote && effectiveRfqStatus(i) === 'approved');
    const first = inv ? firstSupplierRfqQuote(inv) : undefined;
    if (first) negotiation = inrRfqTotal(first, lines) - value.inr;
    else negotiationComparable = false;
  }

  const baseline = allocatedForRequest(request, index) || (request.budget ?? 0);
  const budgetComparable = baseline > 0;

  return {
    negotiation: Math.round(negotiation),
    budget: budgetComparable ? Math.round(baseline - value.inr) : 0,
    negotiationComparable,
    budgetComparable,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiUtils.ts src/lib/kpiUtils.test.ts
git commit -m "feat: like-for-like negotiation and budget savings, split-award aware"
```

---

### Task 4: Ball holder

**Files:**
- Modify: `src/lib/kpiUtils.ts` (append)
- Test: `src/lib/kpiUtils.test.ts` (append)

**Interfaces:**
- Consumes: `ageInDays`, `statusHistoryOf` (Task 1)
- Produces: `Party`, `PARTY_LABELS`, `BallHold`, `ballHolders(request, reqInvites, now)`

**Semantics:** one `BallHold` per single-vendor request, or one per award when `isAwardBased`. This is what makes every "waiting on" band and the Administration stalled-list award-aware for free.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/kpiUtils.test.ts`:

```ts
import { ballHolders } from './kpiUtils';

describe('ballHolders', () => {
  it('puts a draft on the requester and a terminal request on nobody', () => {
    expect(ballHolders(req({ status: 'draft' }), [], NOW)[0].party).toBe('buyer');
    expect(ballHolders(req({ status: 'completed' }), [], NOW)[0].party).toBe('none');
    expect(ballHolders(req({ status: 'rejected' }), [], NOW)[0].party).toBe('none');
  });

  it('puts a pending-approval request on the plant head, aged from the transition', () => {
    const r = req({
      status: 'pending_head_approval',
      statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(4) }],
    });
    const [h] = ballHolders(r, [], NOW);
    expect(h.party).toBe('plant_head');
    expect(h.days).toBeCloseTo(4);
  });

  it('prefers sourcing over vendor when a quotation is waiting to be reviewed', () => {
    const r = req({ status: 'sourcing' });
    const inv = [
      invite({ id: 'i1', rfqQuote: { price: 10 }, rfqStatus: 'pending_sourcing' }),
      invite({ id: 'i2', rfqStatus: 'awaiting_quote' }),
    ];
    expect(ballHolders(r, inv, NOW)[0].party).toBe('sourcing');
  });

  it('falls to the vendor, then the technical team, then sourcing', () => {
    const r = req({ status: 'sourcing' });
    expect(ballHolders(r, [invite({ rfqStatus: 'awaiting_quote' })], NOW)[0].party).toBe('vendor');
    expect(
      ballHolders(r, [invite({
        rfqStatus: 'approved', rfqQuote: { price: 10 },
        techSpec: { id: 't', status: 'pending_technical', documents: [], thread: [], sentAt: iso(2) },
      })], NOW)[0].party,
    ).toBe('technical');
    expect(ballHolders(r, [], NOW)[0].party).toBe('sourcing');
  });

  it('routes the fulfilment chain to the right off-portal team', () => {
    expect(ballHolders(req({ status: 'pi_requested' }), [], NOW)[0].party).toBe('vendor');
    expect(ballHolders(req({ status: 'pi_submitted' }), [], NOW)[0].party).toBe('plant_accounts');
    expect(ballHolders(req({ status: 'accounts_processing' }), [], NOW)[0].party).toBe('global_accounts');
    expect(ballHolders(req({ status: 'payment_in_progress' }), [], NOW)[0].party).toBe('plant_accounts');
  });

  it('diverts payment stage to the vendor or sourcing while a trial is open', () => {
    const upload = req({ status: 'payment_in_progress', trialRequired: true, trialStatus: 'pending_upload' });
    const review = req({ status: 'payment_in_progress', trialRequired: true, trialStatus: 'pending_review' });
    expect(ballHolders(upload, [], NOW)[0].party).toBe('vendor');
    expect(ballHolders(review, [], NOW)[0].party).toBe('sourcing');
  });

  it('returns one holder per award on an award-based request', () => {
    const r = req({ status: 'pi_requested' });
    const holders = ballHolders(r, [
      invite({ id: 'i1', awarded: true, awardStatus: 'awarded' }),
      invite({ id: 'i2', awarded: true, awardStatus: 'pi_submitted', piSubmittedAt: iso(3) }),
      invite({ id: 'i3' }),
    ], NOW);
    expect(holders.map(h => h.party)).toEqual(['sourcing', 'plant_accounts']);
    expect(holders[1].days).toBeCloseTo(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `ballHolders is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/kpiUtils.ts`:

```ts
import { effectiveIncoTermsStatus } from './incoTermsUtils';
import { effectiveTechSpecStatus } from './techSpecUtils';
import { effectiveTrialStatus } from './trialUtils';

/* ── ball holder ──────────────────────────────────────────────────────── */

export type Party =
  | 'buyer' | 'sourcing' | 'plant_head' | 'vendor'
  | 'technical' | 'plant_accounts' | 'global_accounts' | 'none';

export const PARTY_LABELS: Record<Party, string> = {
  buyer: 'Requester',
  sourcing: 'Sourcing',
  plant_head: 'Plant Head',
  vendor: 'Vendor',
  technical: 'Technical Team',
  plant_accounts: 'Plant Accounts',
  global_accounts: 'Global Accounts (Satish)',
  none: '—',
};

/** Which SLA a wait against each party is measured against. */
export const PARTY_SLA: Partial<Record<Party, SlaKey>> = {
  plant_head: 'plantHead',
  vendor: 'vendorQuote',
  technical: 'techSpec',
  plant_accounts: 'accounts',
  global_accounts: 'accounts',
};

export interface BallHold {
  party: Party;
  since: string;
  days: number;
  /** Set when the hold belongs to one award / one vendor rather than the whole request. */
  inviteId?: string;
}

function lastStatusAt(request: CapexRequest): string {
  const h = statusHistoryOf(request);
  return h[h.length - 1].at;
}

function hold(party: Party, since: string, now: number, inviteId?: string): BallHold {
  return { party, since, days: ageInDays(since, now) ?? 0, inviteId };
}

function awardHold(request: CapexRequest, inv: VendorInvite, now: number): BallHold {
  const at = lastStatusAt(request);
  switch (inv.awardStatus ?? 'awarded') {
    case 'completed':
      return hold('none', at, now, inv.id);
    // Awarded but the PI has not been requested — sourcing still has to click Request PI.
    case 'awarded':
      return hold('sourcing', at, now, inv.id);
    case 'pi_requested':
      return hold('vendor', at, now, inv.id);
    case 'pi_submitted':
      return hold('plant_accounts', inv.piSubmittedAt ?? at, now, inv.id);
    case 'accounts_processing':
      return hold('global_accounts', inv.piSubmittedAt ?? at, now, inv.id);
    default: {
      const trial = effectiveTrialStatus(inv);
      if (trial === 'pending_upload') return hold('vendor', inv.advancePaidAt ?? at, now, inv.id);
      if (trial === 'pending_review') {
        return hold('sourcing', inv.trialSubmission?.uploadedAt ?? at, now, inv.id);
      }
      return hold('plant_accounts', inv.purchaseOrder?.issuedAt ?? at, now, inv.id);
    }
  }
}

/**
 * Who is blocking this request right now, and since when. One entry per award for award-based
 * requests (each award is its own fulfilment track), otherwise a single entry.
 */
export function ballHolders(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  now: number,
): BallHold[] {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).map((inv) => awardHold(request, inv, now));
  }

  const at = lastStatusAt(request);
  switch (request.status) {
    case 'draft':
      return [hold('buyer', request.createdAt, now)];
    case 'submitted':
    case 'pending_head_approval':
      return [hold('plant_head', at, now)];
    case 'completed':
    case 'rejected':
      return [hold('none', at, now)];
    case 'pi_requested':
      return [hold('vendor', at, now)];
    case 'pi_submitted':
      return [hold('plant_accounts', request.piSubmittedAt ?? at, now)];
    case 'accounts_processing':
      return [hold('global_accounts', request.piSubmittedAt ?? at, now)];
    case 'payment_in_progress': {
      const trial = effectiveTrialStatus(request);
      if (trial === 'pending_upload') return [hold('vendor', request.advancePaidAt ?? at, now)];
      if (trial === 'pending_review') {
        return [hold('sourcing', request.trialSubmission?.uploadedAt ?? at, now)];
      }
      return [hold('plant_accounts', request.purchaseOrder?.issuedAt ?? at, now)];
    }
    default: {
      // Pre-award: sourcing / negotiation / the legacy sourcing_approved + buyer_approved states.
      const mine = reqInvites.find(
        (i) =>
          (i.rfqQuote && effectiveRfqStatus(i) === 'pending_sourcing') ||
          effectiveIncoTermsStatus(i) === 'pending_sourcing' ||
          effectiveTechSpecStatus(i) === 'needs_revision',
      );
      if (mine) return [hold('sourcing', at, now, mine.id)];

      const vendor = reqInvites.find((i) => {
        const s = effectiveRfqStatus(i);
        return s === 'awaiting_quote' || s === 'pending_vendor';
      });
      if (vendor) return [hold('vendor', vendor.invitedAt, now, vendor.id)];

      const tech = reqInvites.find((i) => effectiveTechSpecStatus(i) === 'pending_technical');
      if (tech) return [hold('technical', tech.techSpec?.sentAt ?? at, now, tech.id)];

      return [hold('sourcing', at, now)];
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiUtils.ts src/lib/kpiUtils.test.ts
git commit -m "feat: ball-holder derivation, per award on split-award requests"
```

---

### Task 5: Portfolio positions

**Files:**
- Create: `src/lib/kpiPortfolio.ts`
- Test: `src/lib/kpiPortfolio.test.ts`

**Interfaces:**
- Consumes: `CR`, `MasterIndex`, `masterIndex`, `requestValue`, `allocatedForRequest`, `paidForRequest`, `poIssuedForRequest`, `firstReachedAt` (Tasks 1-2)
- Produces: `FyScope`, `FyPosition`, `requestFy(request, index, capexMaster)`, `fyBudgetPosition(opts)`, `HeadPosition`, `headPositions(opts)`, `ValueFunnel`, `valueFunnel(requests, byRequest, index)`

**The FY attribution rule (spec §4.5), stated once and used everywhere:** a request belongs to the FY of its linked master rows; with no master link it belongs to the current live FY *for its own field type* (`getLatestMasterFyForField`). A request is only ever counted under its own field type. This is what fixes defect D6.

**Head-level basis:** `headPositions` consumes the context's existing `usedAmountByMasterItemId` and `effectiveHeadAllocationCr`, so head figures agree exactly with what `/capex/master` already shows (and respect approved adhoc transfers). That is an *estimate* basis, unlike the FY-level `requestValue` basis — the UI labels it "Committed (est.)". Two surfaces disagreeing about the same head would be worse than one caption.

- [ ] **Step 1: Write the failing test**

Create `src/lib/kpiPortfolio.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { requestFy, fyBudgetPosition, headPositions, valueFunnel } from './kpiPortfolio';
import { masterIndex, invitesByRequest, DAY_MS } from './kpiUtils';
import type { CapexMasterItem, CapexRequest, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

function master(over: Partial<CapexMasterItem> = {}): CapexMasterItem {
  return {
    id: 'm1', plant: 'jhajjar_p1', head: 'Machinery', department: 'Prod',
    subParticulars: 'Chiller', rate: 0, totalCost: 2, fy: '2026-27',
    fieldType: 'brown_field', projectType: 'rac', ...over,
  };
}
function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    fieldType: 'brown_field', projectType: 'rac',
    createdBy: 'Arjun Mehta', createdAt: iso(10), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(6),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}

describe('requestFy', () => {
  const capexMaster = [master({ id: 'm1', fy: '2026-27' }), master({ id: 'm2', fy: '2025-26' })];
  const idx = masterIndex(capexMaster);

  it('takes the FY of the first linked master row', () => {
    const r = req({ lineItems: [{ id: 'l1', masterItemId: 'm2', description: 'x', category: 'M', quantity: '1' }] });
    expect(requestFy(r, idx, capexMaster)).toBe('2025-26');
  });

  it('falls back to the live FY of the request own field type', () => {
    expect(requestFy(req({ fieldType: 'brown_field' }), idx, capexMaster)).toBe('2026-27');
  });
});

describe('fyBudgetPosition', () => {
  const capexMaster = [
    master({ id: 'm1', totalCost: 2, fy: '2026-27' }),
    master({ id: 'm2', totalCost: 1, fy: '2026-27' }),
    // A Green Field row in the same FY must never leak into a Brown Field position (defect D6).
    master({ id: 'g1', totalCost: 99, fy: '2026-27', fieldType: 'green_field' }),
  ];

  it('scopes allocation to the field type and plant', () => {
    const p = fyBudgetPosition({
      capexMaster, requests: [], byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.allocatedInr).toBe(3 * 1_00_00_000);
  });

  it('excludes draft and rejected requests from committed', () => {
    const requests = [
      req({ id: 'r1', status: 'sourcing', budget: 100 }),
      req({ id: 'r2', status: 'draft', budget: 500 }),
      req({ id: 'r3', status: 'rejected', budget: 500 }),
    ];
    const p = fyBudgetPosition({
      capexMaster, requests, byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.committedInr).toBe(100);
  });

  it('counts only awarded-basis value as awarded, and reports utilisation', () => {
    const requests = [req({ id: 'r1', status: 'pi_requested', budget: 100 })];
    const byRequest = invitesByRequest([invite({ requestId: 'r1', awarded: true, awardAmount: 1_00_00_000 })]);
    const p = fyBudgetPosition({
      capexMaster, requests, byRequest,
      scope: { fieldType: 'brown_field', fy: '2026-27', plant: 'jhajjar_p1' },
    });
    expect(p.awardedInr).toBe(1_00_00_000);
    expect(p.remainingInr).toBe(2 * 1_00_00_000);
    expect(p.utilisationPct).toBeCloseTo(33.3, 0);
  });

  it('reports 0% utilisation rather than dividing by zero on an empty FY', () => {
    const p = fyBudgetPosition({
      capexMaster: [], requests: [], byRequest: new Map(),
      scope: { fieldType: 'brown_field', fy: '2026-27' },
    });
    expect(p.utilisationPct).toBe(0);
    expect(p.allocatedInr).toBe(0);
  });
});

describe('headPositions', () => {
  it('flags a head as over when committed exceeds its effective allocation', () => {
    const capexMaster = [master({ id: 'm1', head: 'Machinery', totalCost: 1 })];
    const rows = headPositions({
      capexMaster, headOverrides: [], usedAmountByMasterItemId: { m1: 1.5 * 1_00_00_000 },
      scope: { plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].head).toBe('Machinery');
    expect(rows[0].allocatedCr).toBe(1);
    expect(rows[0].committedCr).toBeCloseTo(1.5);
    expect(rows[0].over).toBe(true);
  });

  it('prefers an approved adhoc override over the summed line items', () => {
    const capexMaster = [master({ id: 'm1', head: 'Machinery', totalCost: 1 })];
    const rows = headPositions({
      capexMaster,
      headOverrides: [{ plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac', division: 'Other Brown Field', head: 'Machinery', budgetCr: 3 }],
      usedAmountByMasterItemId: {},
      scope: { plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac' },
    });
    expect(rows[0].allocatedCr).toBe(3);
    expect(rows[0].over).toBe(false);
  });
});

describe('valueFunnel', () => {
  it('counts a request as approved once it reached sourcing', () => {
    const requests = [
      req({ id: 'r1', status: 'sourcing', budget: 100, statusHistory: [
        { status: 'submitted', actor: 'A', at: iso(9) },
        { status: 'sourcing', actor: 'A', at: iso(8) },
      ] }),
      req({ id: 'r2', status: 'pending_head_approval', budget: 50, statusHistory: [
        { status: 'pending_head_approval', actor: 'A', at: iso(9) },
      ] }),
    ];
    const f = valueFunnel(requests, new Map(), masterIndex([]));
    expect(f.requested).toBe(150);
    expect(f.approved).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./kpiPortfolio"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kpiPortfolio.ts`:

```ts
/**
 * Portfolio-level KPI derivations: FY budget position, per-head position, and the value funnel.
 * Pure — no clock reads, no React.
 */
import type {
  BrownFieldHeadBudget, CapexMasterItem, CapexRequest, FieldType, ProjectType, VendorInvite,
} from './types';
import {
  CR, MasterIndex, allocatedForRequest, firstReachedAt, masterIndex,
  paidForRequest, poIssuedForRequest, requestValue,
} from './kpiUtils';
import { getLatestMasterFyForField, resolveProjectType } from './greenFieldConstants';
import { effectiveHeadAllocationCr, headsForScope } from './adhocBudgetUtils';

/* ── FY attribution ───────────────────────────────────────────────────── */

/**
 * A request belongs to the FY of its linked master rows; with no link it belongs to the current
 * live FY for its OWN field type. Never mixes field types — this is what fixes the old dashboard's
 * "Green Field FY allocation vs Brown Field commitments" bug.
 */
export function requestFy(
  request: CapexRequest,
  index: MasterIndex,
  capexMaster: CapexMasterItem[],
): string {
  for (const l of request.lineItems ?? []) {
    const m = l.masterItemId ? index.get(l.masterItemId) : undefined;
    if (m) return m.fy;
  }
  if (request.masterItemId) {
    const m = index.get(request.masterItemId);
    if (m) return m.fy;
  }
  return getLatestMasterFyForField(capexMaster, request.fieldType ?? 'brown_field');
}

/* ── FY position ──────────────────────────────────────────────────────── */

export interface FyScope {
  fieldType: FieldType;
  fy: string;
  plant?: string;
  projectType?: ProjectType;
}

export interface FyPosition {
  scope: FyScope;
  allocatedInr: number;
  committedInr: number;
  awardedInr: number;
  poIssuedInr: number;
  paidInr: number;
  remainingInr: number;
  utilisationPct: number;
}

function inScope(request: CapexRequest, scope: FyScope, fy: string): boolean {
  if ((request.fieldType ?? 'brown_field') !== scope.fieldType) return false;
  if (fy !== scope.fy) return false;
  if (scope.plant && request.plant !== scope.plant) return false;
  if (scope.projectType && resolveProjectType(request) !== scope.projectType) return false;
  return true;
}

export function fyBudgetPosition(opts: {
  capexMaster: CapexMasterItem[];
  requests: CapexRequest[];
  byRequest: Map<string, VendorInvite[]>;
  scope: FyScope;
}): FyPosition {
  const { capexMaster, requests, byRequest, scope } = opts;
  const index = masterIndex(capexMaster);

  const allocatedInr =
    capexMaster
      .filter((m) => {
        if ((m.fieldType ?? 'brown_field') !== scope.fieldType) return false;
        if (m.fy !== scope.fy) return false;
        if (scope.plant && m.plant !== scope.plant) return false;
        if (scope.projectType && resolveProjectType(m) !== scope.projectType) return false;
        return true;
      })
      .reduce((s, m) => s + m.totalCost, 0) * CR;

  let committedInr = 0;
  let awardedInr = 0;
  let poIssuedInr = 0;
  let paidInr = 0;

  for (const r of requests) {
    if (r.status === 'draft' || r.status === 'rejected') continue;
    if (!inScope(r, scope, requestFy(r, index, capexMaster))) continue;
    const reqInvites = byRequest.get(r.id) ?? [];
    const v = requestValue(r, reqInvites, index);
    committedInr += v.inr;
    if (v.basis === 'awarded') awardedInr += v.inr;
    poIssuedInr += poIssuedForRequest(r, reqInvites);
    paidInr += paidForRequest(r, reqInvites);
  }

  return {
    scope,
    allocatedInr,
    committedInr,
    awardedInr,
    poIssuedInr,
    paidInr,
    remainingInr: allocatedInr - committedInr,
    utilisationPct: allocatedInr > 0 ? (committedInr / allocatedInr) * 100 : 0,
  };
}

/* ── head position (Brown Field) ──────────────────────────────────────── */

export interface HeadPosition {
  head: string;
  allocatedCr: number;
  /** Estimate basis — same source `/capex/master` uses, so the two screens never disagree. */
  committedCr: number;
  remainingCr: number;
  over: boolean;
}

/**
 * Per-head allocation vs consumption for a Brown Field plant/FY/category. Allocation respects
 * approved adhoc transfers via `effectiveHeadAllocationCr`.
 */
export function headPositions(opts: {
  capexMaster: CapexMasterItem[];
  headOverrides: BrownFieldHeadBudget[];
  usedAmountByMasterItemId: Record<string, number>;
  scope: { plant: string; fy: string; projectType: ProjectType };
}): HeadPosition[] {
  const { capexMaster, headOverrides, usedAmountByMasterItemId, scope } = opts;
  const { plant, fy, projectType } = scope;

  return headsForScope(capexMaster, plant, fy, projectType).map((head) => {
    const allocatedCr = effectiveHeadAllocationCr(capexMaster, headOverrides, plant, fy, projectType, head);
    const committedCr =
      capexMaster
        .filter(
          (m) =>
            (m.fieldType ?? 'brown_field') === 'brown_field' &&
            m.plant === plant &&
            m.fy === fy &&
            resolveProjectType(m) === projectType &&
            m.head === head,
        )
        .reduce((s, m) => s + (usedAmountByMasterItemId[m.id] ?? 0), 0) / CR;
    return {
      head,
      allocatedCr,
      committedCr,
      remainingCr: allocatedCr - committedCr,
      over: committedCr > allocatedCr,
    };
  });
}

/* ── value funnel ─────────────────────────────────────────────────────── */

export interface ValueFunnel {
  requested: number;
  approved: number;
  awarded: number;
  poIssued: number;
  paid: number;
}

/** "Approved" = the request actually reached `sourcing` (past the plant-head gate, or Green-Field direct). */
export function valueFunnel(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
): ValueFunnel {
  const f: ValueFunnel = { requested: 0, approved: 0, awarded: 0, poIssued: 0, paid: 0 };
  for (const r of requests) {
    if (r.status === 'draft' || r.status === 'rejected') continue;
    const reqInvites = byRequest.get(r.id) ?? [];
    const v = requestValue(r, reqInvites, index);
    f.requested += v.inr;
    if (firstReachedAt(r, 'sourcing')) f.approved += v.inr;
    if (v.basis === 'awarded') f.awarded += v.inr;
    f.poIssued += poIssuedForRequest(r, reqInvites);
    f.paid += paidForRequest(r, reqInvites);
  }
  return f;
}
```

Note: `allocatedForRequest` is imported for symmetry with the spec but is not used here — remove it from the import list if TypeScript flags it as unused.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiPortfolio.ts src/lib/kpiPortfolio.test.ts
git commit -m "feat: field-type-scoped FY position, head positions, value funnel"
```

---

### Task 6: Delay-liability exposure + vendor scorecard

**Files:**
- Create: `src/lib/kpiRisk.ts`
- Test: `src/lib/kpiRisk.test.ts`

**Interfaces:**
- Consumes: `MasterIndex`, `requestValue`, `median`, `ageInDays` (Tasks 1-2)
- Produces: `DelayExposure`, `delayLiabilityExposure(requests, byRequest, index, now)`, `VendorScore`, `vendorScorecard(vendors, requests, byRequest, index, now)`

- [ ] **Step 1: Write the failing test**

Create `src/lib/kpiRisk.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { delayLiabilityExposure, vendorScorecard } from './kpiRisk';
import { masterIndex, invitesByRequest, DAY_MS } from './kpiUtils';
import type { CapexRequest, Vendor, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const IDX = masterIndex([]);

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', subject: 'S', category: 'M', quantity: '1', priority: 'medium',
    justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'payment_in_progress',
    createdBy: 'Arjun Mehta', createdAt: iso(60), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(30),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}
const vendor = (id: string, vendorName: string): Vendor => ({
  id, vendorCode: id.toUpperCase(), vendorName, category: 'Machinery', gstin: '', pan: '',
  contactName: '', contactEmail: '', paymentTerms: 'Net-30', bankName: '', accountNumber: '',
  ifsc: '', onboardedAt: iso(200),
});

describe('delayLiabilityExposure', () => {
  it('accrues 0.5% per week after the one-week grace period', () => {
    // PI 5 weeks ago = 1 week grace + 4 late weeks = 2% of 10,00,000 = 20,000.
    const requests = [req({ piSubmittedAt: iso(35), budget: 1_000_000 })];
    const e = delayLiabilityExposure(requests, new Map(), IDX, NOW);
    expect(e.runningInr).toBe(20_000);
    expect(e.runningCount).toBe(1);
    expect(e.pastGraceCount).toBe(1);
  });

  it('counts a stopped clock as realised, not running', () => {
    const requests = [req({ status: 'completed', piSubmittedAt: iso(35), tatStoppedAt: iso(21), budget: 1_000_000 })];
    const e = delayLiabilityExposure(requests, new Map(), IDX, NOW);
    expect(e.runningInr).toBe(0);
    expect(e.realisedInr).toBeGreaterThan(0);
  });

  it('measures each award separately against its own award amount', () => {
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', awarded: true, awardAmount: 1_000_000, piSubmittedAt: iso(35) }),
      invite({ id: 'i2', awarded: true, awardAmount: 2_000_000, piSubmittedAt: iso(35) }),
    ]);
    expect(delayLiabilityExposure(requests, byRequest, IDX, NOW).runningInr).toBe(60_000);
  });

  it('ignores tracks with no PI', () => {
    expect(delayLiabilityExposure([req({ piSubmittedAt: undefined })], new Map(), IDX, NOW).runningCount).toBe(0);
  });
});

describe('vendorScorecard', () => {
  it('computes response rate and median response time from invite to first supplier quote', () => {
    const vendors = [vendor('v1', 'Acme'), vendor('v2', 'Zeta')];
    const requests = [req({ id: 'r1', status: 'sourcing' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', vendorId: 'v1', invitedAt: iso(10), rfqThread: [
        { id: 'm1', by: 'supplier', senderName: 'Acme', action: 'proposed', at: iso(6), quote: { price: 1 } },
      ] }),
      invite({ id: 'i2', vendorId: 'v1', invitedAt: iso(10) }),
      invite({ id: 'i3', vendorId: 'v2', invitedAt: iso(10) }),
    ]);
    const rows = vendorScorecard(vendors, requests, byRequest, IDX, NOW);
    const acme = rows.find(r => r.vendorId === 'v1')!;
    expect(acme.invited).toBe(2);
    expect(acme.quoted).toBe(1);
    expect(acme.responseRatePct).toBe(50);
    expect(acme.medianResponseDays).toBeCloseTo(4);
    expect(rows.find(r => r.vendorId === 'v2')!.medianResponseDays).toBeNull();
  });

  it('sums awarded value per vendor', () => {
    const vendors = [vendor('v1', 'Acme')];
    const requests = [req({ id: 'r1' })];
    const byRequest = invitesByRequest([
      invite({ id: 'i1', vendorId: 'v1', awarded: true, awardAmount: 500 }),
    ]);
    const row = vendorScorecard(vendors, requests, byRequest, IDX, NOW)[0];
    expect(row.awards).toBe(1);
    expect(row.awardedInr).toBe(500);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./kpiRisk"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kpiRisk.ts`:

```ts
/**
 * Fulfilment-risk KPIs: aggregate delay liability (money the company is owed under the TAT
 * clause) and a vendor scorecard. Pure — `now` is injected.
 */
import type { CapexRequest, Vendor, VendorInvite } from './types';
import { MasterIndex, ageInDays, median, requestValue } from './kpiUtils';
import { awardedInvites, isAwardBased } from './paymentUtils';
import { computeTat } from './tatUtils';

export interface DelayExposure {
  /** Deductions accrued on clocks that are still running — live exposure. */
  runningInr: number;
  runningCount: number;
  /** Deductions accrued on tracks whose clock has stopped. */
  realisedInr: number;
  /** Tracks past the one-week grace period. */
  pastGraceCount: number;
}

interface Track {
  piSubmittedAt?: string;
  tatStoppedAt?: string;
  amount: number;
}

function tracksFor(
  request: CapexRequest,
  reqInvites: VendorInvite[],
  index: MasterIndex,
): Track[] {
  if (isAwardBased(reqInvites)) {
    return awardedInvites(reqInvites).map((i) => ({
      piSubmittedAt: i.piSubmittedAt,
      tatStoppedAt: i.tatStoppedAt,
      amount: i.awardAmount ?? 0,
    }));
  }
  return [{
    piSubmittedAt: request.piSubmittedAt,
    tatStoppedAt: request.tatStoppedAt,
    amount: requestValue(request, reqInvites, index).inr,
  }];
}

export function delayLiabilityExposure(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
): DelayExposure {
  const out: DelayExposure = { runningInr: 0, runningCount: 0, realisedInr: 0, pastGraceCount: 0 };
  for (const r of requests) {
    for (const t of tracksFor(r, byRequest.get(r.id) ?? [], index)) {
      if (!t.piSubmittedAt) continue;
      const tat = computeTat({
        piSubmittedAt: t.piSubmittedAt,
        vendorAmount: t.amount,
        tatStoppedAt: t.tatStoppedAt,
        now,
      });
      if (!tat.applicable) continue;
      if (tat.weeksLate > 0) out.pastGraceCount++;
      if (tat.running) {
        out.runningCount++;
        out.runningInr += tat.deductionAmount;
      } else {
        out.realisedInr += tat.deductionAmount;
      }
    }
  }
  return out;
}

export interface VendorScore {
  vendorId: string;
  vendorName: string;
  invited: number;
  quoted: number;
  responseRatePct: number;
  medianResponseDays: number | null;
  awards: number;
  awardedInr: number;
  delayAccruedInr: number;
}

export function vendorScorecard(
  vendors: Vendor[],
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  index: MasterIndex,
  now: number,
): VendorScore[] {
  const rows = new Map<string, VendorScore>();
  const responseDays = new Map<string, number[]>();

  const blank = (v: Vendor): VendorScore => ({
    vendorId: v.id, vendorName: v.vendorName, invited: 0, quoted: 0, responseRatePct: 0,
    medianResponseDays: null, awards: 0, awardedInr: 0, delayAccruedInr: 0,
  });
  for (const v of vendors) rows.set(v.id, blank(v));

  for (const r of requests) {
    const reqInvites = byRequest.get(r.id) ?? [];
    for (const inv of reqInvites) {
      const row = rows.get(inv.vendorId);
      if (!row) continue; // invite for a vendor no longer in the roster
      row.invited++;

      const firstReply = inv.rfqThread?.find((m) => m.by === 'supplier' && m.quote);
      if (firstReply || inv.rfqQuote || inv.quotes.length) row.quoted++;
      if (firstReply) {
        const days = (new Date(firstReply.at).getTime() - new Date(inv.invitedAt).getTime()) / 86_400_000;
        if (days >= 0) {
          const list = responseDays.get(inv.vendorId) ?? [];
          list.push(days);
          responseDays.set(inv.vendorId, list);
        }
      }

      if (inv.awarded) {
        row.awards++;
        row.awardedInr += inv.awardAmount ?? 0;
        const tat = computeTat({
          piSubmittedAt: inv.piSubmittedAt,
          vendorAmount: inv.awardAmount ?? 0,
          tatStoppedAt: inv.tatStoppedAt,
          now,
        });
        if (tat.applicable) row.delayAccruedInr += tat.deductionAmount;
      }
    }

    // Single-vendor fulfilment: attribute the request-level TAT to the finalized vendor.
    if (!isAwardBased(reqInvites) && r.finalVendorId && r.piSubmittedAt) {
      const row = rows.get(r.finalVendorId);
      if (row) {
        const tat = computeTat({
          piSubmittedAt: r.piSubmittedAt,
          vendorAmount: requestValue(r, reqInvites, index).inr,
          tatStoppedAt: r.tatStoppedAt,
          now,
        });
        if (tat.applicable) row.delayAccruedInr += tat.deductionAmount;
      }
    }
  }

  for (const row of rows.values()) {
    row.responseRatePct = row.invited > 0 ? Math.round((row.quoted / row.invited) * 100) : 0;
    row.medianResponseDays = median(responseDays.get(row.vendorId) ?? []);
  }

  return [...rows.values()]
    .filter((r) => r.invited > 0)
    .sort((a, b) => b.awardedInr - a.awardedInr);
}
```

Note the import line at the top of this file mixes a type (`MasterIndex`) with values. Under `isolatedModules` that is fine for *imports*; split it into `import type { MasterIndex } from './kpiUtils'` if you prefer to match the repo's house style. Do **not** re-export `ageInDays` or any type from here — dashboards import from `kpiUtils` directly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiRisk.ts src/lib/kpiRisk.test.ts
git commit -m "feat: aggregate delay-liability exposure and vendor scorecard"
```

---

### Task 7: Role queues

**Files:**
- Create: `src/lib/kpiQueues.ts`
- Test: `src/lib/kpiQueues.test.ts`

**Interfaces:**
- Consumes: `SLA_DAYS`, `SlaKey`, `ageInDays`, `oldestAgeDays`, `ballHolders`, `PARTY_LABELS`, `PARTY_SLA`, `statusHistoryOf` (Tasks 1, 4)
- Produces: `QueueItem`, `QueueBucket`, `QueueBands`, `buildBucket(...)`, `waitingBands(requests, byRequest, now, parties?)`, `buyerQueues(...)`, `sourcingQueues(...)`, `adminQueues(...)`, `maintenanceQueues(...)`

**Two design points, both deliberate:**

1. **Buckets carry their rows.** There is no filtered route for "quotes to review", and inventing one is more surface than this needs. Each bucket carries `items: QueueItem[]` and `ActionQueue` expands it inline to `/capex/[id]` links. `href` is set only where a real route already exists.
2. **`pending_accounts` appears once.** Spec §8.1 listed it in both ① ("Awaiting Global Accounts link") and ② ("Waiting on — Global Accounts"). It belongs in ① only: the admin holds the link and the action is to send or chase it. ② carries plant head and idle-sourcing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/kpiQueues.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adminQueues, buyerQueues, maintenanceQueues, sourcingQueues } from './kpiQueues';
import { invitesByRequest, DAY_MS } from './kpiUtils';
import type { AdhocBudgetRequest, BudgetProposal, CapexRequest, VendorInvite } from './types';

const NOW = new Date('2026-08-15T00:00:00.000Z').getTime();
const iso = (d: number) => new Date(NOW - d * DAY_MS).toISOString();
const bucket = (bands: { mine: { key: string }[] }, key: string) =>
  bands.mine.find(b => b.key === key)!;

function req(over: Partial<CapexRequest> = {}): CapexRequest {
  return {
    id: 'r1', requestNo: 'CAP-2627-0001', subject: 'Chiller', category: 'M', quantity: '1',
    priority: 'medium', justification: '', techSpecs: { specifications: '', complianceStandards: '' },
    assignedTo: 'sourcing_member', status: 'sourcing', plant: 'jhajjar_p1',
    createdBy: 'Arjun Mehta', createdAt: iso(10), ...over,
  };
}
function invite(over: Partial<VendorInvite> = {}): VendorInvite {
  return {
    id: 'i1', requestId: 'r1', vendorId: 'v1', token: 't', status: 'invited',
    quotes: [], negotiationThread: [], invitedAt: iso(9),
    auctionApprovalStatus: 'not_sent', ...over,
  };
}
function proposal(over: Partial<BudgetProposal> = {}): BudgetProposal {
  return {
    id: 'p1', plant: 'jhajjar_p1', projectType: 'rac', targetFy: '2027-28',
    status: 'pending_admin', items: [{ id: 'bi1', head: 'Machinery', department: 'Prod',
      subParticulars: 'Chiller', rate: 0, totalCost: 2 }],
    createdBy: 'Sunil Verma', createdAt: iso(20), submittedAt: iso(6), ...over,
  };
}

describe('sourcingQueues', () => {
  it('flags a sourcing request with no invites as one to pick up', () => {
    const b = sourcingQueues([req({ status: 'sourcing' })], new Map(), NOW);
    expect(bucket(b, 'pickup').count).toBe(1);
    expect(bucket(b, 'pickup').items[0].label).toContain('CAP-2627-0001');
  });

  it('does not flag pickup once vendors are invited', () => {
    const byRequest = invitesByRequest([invite({ rfqStatus: 'awaiting_quote' })]);
    expect(bucket(sourcingQueues([req()], byRequest, NOW), 'pickup').count).toBe(0);
  });

  it('collects quotations awaiting sourcing review and breaches nothing inside SLA', () => {
    const byRequest = invitesByRequest([
      invite({ id: 'i1', rfqQuote: { price: 10 }, rfqStatus: 'pending_sourcing' }),
    ]);
    const q = bucket(sourcingQueues([req()], byRequest, NOW), 'quotesToReview');
    expect(q.count).toBe(1);
    expect(q.breached).toBe(false);
  });

  it('flags a vendor who has sat on an RFQ past the SLA', () => {
    const byRequest = invitesByRequest([invite({ rfqStatus: 'awaiting_quote', invitedAt: iso(9) })]);
    const bands = sourcingQueues([req()], byRequest, NOW);
    const waiting = bands.waiting.find(b => b.key === 'vendor')!;
    expect(waiting.count).toBe(1);
    expect(waiting.breached).toBe(true);
  });

  it('flags an ended auction that was never awarded', () => {
    const r = req({ auctionConfig: { startedAt: iso(5), durationDays: 2, endsAt: iso(3) } });
    expect(bucket(sourcingQueues([r], new Map(), NOW), 'auctionUnawarded').count).toBe(1);
  });

  it('flags a vendor ready to award only when the tech spec is approved', () => {
    const ready = invite({
      rfqStatus: 'approved', rfqQuote: { price: 10 }, docApprovalStatus: 'approved',
      techSpec: { id: 't', status: 'approved', documents: [], thread: [] },
    });
    const blocked = { ...ready, id: 'i2', techSpec: { id: 't2', status: 'pending_technical' as const, documents: [], thread: [] } };
    expect(bucket(sourcingQueues([req()], invitesByRequest([ready]), NOW), 'readyToAward').count).toBe(1);
    expect(bucket(sourcingQueues([req()], invitesByRequest([blocked]), NOW), 'readyToAward').count).toBe(0);
  });
});

describe('buyerQueues', () => {
  it('lists drafts and rejections as the requester own work', () => {
    const bands = buyerQueues([req({ id: 'r1', status: 'draft' }), req({ id: 'r2', status: 'rejected' })], new Map(), NOW);
    expect(bucket(bands, 'drafts').count).toBe(1);
    expect(bucket(bands, 'rejected').count).toBe(1);
  });

  it('surfaces a request awaiting the plant head as the requester next move', () => {
    const r = req({ status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(5) }] });
    const b = bucket(buyerQueues([r], new Map(), NOW), 'awaitingPlantHead');
    expect(b.count).toBe(1);
    expect(b.breached).toBe(true);
  });
});

describe('adminQueues', () => {
  it('groups proposals and adhoc transfers awaiting admin, with their Cr totals', () => {
    const adhoc: AdhocBudgetRequest = {
      id: 'a1', plant: 'jhajjar_p1', fy: '2026-27', projectType: 'rac',
      fromHead: 'General', toHead: 'Machinery', amountCr: 0.6, status: 'pending_admin',
      createdBy: 'Neha Kapoor', createdAt: iso(2),
    };
    const bands = adminQueues([], new Map(), [proposal()], [adhoc], NOW);
    expect(bucket(bands, 'proposals').count).toBe(1);
    expect(bucket(bands, 'proposals').amountCr).toBe(2);
    expect(bucket(bands, 'proposals').breached).toBe(true);
    expect(bucket(bands, 'adhoc').amountCr).toBeCloseTo(0.6);
    expect(bucket(bands, 'adhoc').breached).toBe(false);
  });

  it('lists a proposal awaiting the Global Accounts link exactly once, in the admin band', () => {
    const p = proposal({ status: 'pending_accounts', adminDecidedAt: iso(4) });
    const bands = adminQueues([], new Map(), [p], [], NOW);
    expect(bucket(bands, 'accountsLink').count).toBe(1);
    expect(bands.waiting.some(b => b.key === 'accountsLink')).toBe(false);
  });

  it('only flags plant-head requests once past the SLA', () => {
    const fresh = req({ id: 'r1', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(1) }] });
    const stale = req({ id: 'r2', status: 'pending_head_approval', statusHistory: [{ status: 'pending_head_approval', actor: 'A', at: iso(9) }] });
    expect(bucket(adminQueues([fresh, stale], new Map(), [], [], NOW), 'stuckPlantHead').count).toBe(1);
  });
});

describe('maintenanceQueues', () => {
  it('separates the author own rework from what is with approvers', () => {
    const bands = maintenanceQueues([
      proposal({ id: 'p1', status: 'draft' }),
      proposal({ id: 'p2', status: 'needs_correction' }),
      proposal({ id: 'p3', status: 'pending_admin' }),
    ], NOW);
    expect(bucket(bands, 'drafts').count).toBe(1);
    expect(bucket(bands, 'needsCorrection').count).toBe(1);
    expect(bands.waiting.find(b => b.key === 'withAdmin')!.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./kpiQueues"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kpiQueues.ts`:

```ts
/**
 * The ① "my turn" and ② "waiting on" bands for each role dashboard.
 *
 * Every bucket carries its own rows so the UI can expand inline — there is no filtered route for
 * most of these, and each bucket links straight to `/capex/[id]`.
 */
import type {
  AdhocBudgetRequest, BudgetProposal, CapexRequest, VendorInvite,
} from './types';
import {
  PARTY_LABELS, PARTY_SLA, Party, SLA_DAYS, SlaKey,
  ageInDays, ballHolders, oldestAgeDays, statusHistoryOf,
} from './kpiUtils';
import { effectiveRfqStatus, canRequestPi } from './rfqUtils';
import { effectiveIncoTermsStatus } from './incoTermsUtils';
import { effectiveTechSpecStatus, techSpecBlocksAward } from './techSpecUtils';
import { effectiveTrialStatus } from './trialUtils';
import { isAwardBased } from './paymentUtils';
import { isAuctionExpired } from './auctionUtils';
import { proposalTotalCr } from './budgetProposalUtils';

export interface QueueItem {
  id: string;
  label: string;
  sub?: string;
  href: string;
  ageDays: number | null;
}

export interface QueueBucket {
  key: string;
  label: string;
  items: QueueItem[];
  count: number;
  oldestDays: number | null;
  breached: boolean;
  slaKey?: SlaKey;
  /** Only set where a real filtered route already exists. */
  href?: string;
  /** Σ value in Crore, for budget buckets. */
  amountCr?: number;
}

export interface QueueBands {
  mine: QueueBucket[];
  waiting: QueueBucket[];
}

export function buildBucket(opts: {
  key: string;
  label: string;
  items: QueueItem[];
  slaKey?: SlaKey;
  href?: string;
  amountCr?: number;
}): QueueBucket {
  const oldestDays = opts.items.length
    ? Math.max(...opts.items.map((i) => i.ageDays ?? 0))
    : null;
  const limit = opts.slaKey ? SLA_DAYS[opts.slaKey] : null;
  return {
    ...opts,
    count: opts.items.length,
    oldestDays,
    breached: limit != null && oldestDays != null && oldestDays > limit,
  };
}

const requestLabel = (r: CapexRequest) => `${r.requestNo ?? r.id.slice(0, 8)} · ${r.subject}`;
const requestHref = (r: CapexRequest) => `/capex/${r.id}`;
const lastAt = (r: CapexRequest) => statusHistoryOf(r).slice(-1)[0].at;

/* ── shared "waiting on" band, derived from ball holders ──────────────── */

/**
 * Group every request by whoever is currently blocking it. Used by both the buyer and sourcing
 * dashboards, so the two never disagree about who holds the ball.
 */
export function waitingBands(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
  parties: Party[],
): QueueBucket[] {
  const grouped = new Map<Party, QueueItem[]>();
  for (const r of requests) {
    for (const h of ballHolders(r, byRequest.get(r.id) ?? [], now)) {
      if (!parties.includes(h.party)) continue;
      const list = grouped.get(h.party) ?? [];
      list.push({
        id: h.inviteId ? `${r.id}:${h.inviteId}` : r.id,
        label: requestLabel(r),
        sub: `waiting ${Math.round(h.days)}d`,
        href: requestHref(r),
        ageDays: h.days,
      });
      grouped.set(h.party, list);
    }
  }
  return parties
    .filter((p) => grouped.has(p))
    .map((p) =>
      buildBucket({
        key: p,
        label: PARTY_LABELS[p],
        items: grouped.get(p) ?? [],
        slaKey: PARTY_SLA[p],
      }),
    );
}

/* ── buyer ────────────────────────────────────────────────────────────── */

export function buyerQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
): QueueBands {
  const item = (r: CapexRequest, at: string): QueueItem => ({
    id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(at, now),
  });

  return {
    mine: [
      buildBucket({
        key: 'drafts',
        label: 'Drafts to submit',
        items: requests.filter((r) => r.status === 'draft').map((r) => item(r, r.createdAt)),
        href: '/capex/requests?filter=draft',
      }),
      buildBucket({
        key: 'awaitingPlantHead',
        label: 'Awaiting plant head — send or chase the link',
        items: requests
          .filter((r) => r.status === 'pending_head_approval')
          .map((r) => item(r, lastAt(r))),
        slaKey: 'plantHead',
        href: '/capex/requests?filter=pending_head_approval',
      }),
      buildBucket({
        key: 'rejected',
        label: 'Rejected — needs rework',
        items: requests.filter((r) => r.status === 'rejected').map((r) => item(r, lastAt(r))),
        href: '/capex/requests?filter=rejected',
      }),
    ],
    waiting: waitingBands(requests, byRequest, now, [
      'plant_head', 'sourcing', 'vendor', 'technical', 'plant_accounts', 'global_accounts',
    ]),
  };
}

/* ── sourcing ─────────────────────────────────────────────────────────── */

export function sourcingQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  now: number,
): QueueBands {
  const pickup: QueueItem[] = [];
  const quotesToReview: QueueItem[] = [];
  const incoToSettle: QueueItem[] = [];
  const techSpecToSend: QueueItem[] = [];
  const techSpecToRevise: QueueItem[] = [];
  const readyToAward: QueueItem[] = [];
  const auctionUnawarded: QueueItem[] = [];
  const trialsToReview: QueueItem[] = [];

  const inviteItem = (r: CapexRequest, inv: VendorInvite, at: string | undefined): QueueItem => ({
    id: inv.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(at, now),
  });

  for (const r of requests) {
    const reqInvites = byRequest.get(r.id) ?? [];
    const awardBased = isAwardBased(reqInvites);

    if (r.status === 'sourcing' && reqInvites.length === 0) {
      pickup.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now) });
    }

    if (isAuctionExpired(r.auctionConfig) && !awardBased) {
      auctionUnawarded.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(r.auctionConfig?.endsAt, now) });
    }

    if (!awardBased && reqInvites.some((i) => canRequestPi(i) && !techSpecBlocksAward(i))) {
      readyToAward.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now) });
    }

    if (effectiveTrialStatus(r) === 'pending_review') {
      trialsToReview.push({ id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(r.trialSubmission?.uploadedAt, now) });
    }

    for (const inv of reqInvites) {
      const rfq = effectiveRfqStatus(inv);
      if (inv.rfqQuote && rfq === 'pending_sourcing') quotesToReview.push(inviteItem(r, inv, lastAt(r)));
      if (effectiveIncoTermsStatus(inv) === 'pending_sourcing') incoToSettle.push(inviteItem(r, inv, inv.incoTermsDoc?.respondedAt ?? lastAt(r)));

      const spec = effectiveTechSpecStatus(inv);
      if (spec === 'needs_revision') techSpecToRevise.push(inviteItem(r, inv, inv.techSpec?.decidedAt));
      if (spec === 'not_sent' && rfq === 'approved') techSpecToSend.push(inviteItem(r, inv, lastAt(r)));

      if (inv.awarded && effectiveTrialStatus(inv) === 'pending_review') {
        trialsToReview.push(inviteItem(r, inv, inv.trialSubmission?.uploadedAt));
      }
    }
  }

  return {
    mine: [
      buildBucket({ key: 'pickup', label: 'New requests to pick up', items: pickup }),
      buildBucket({ key: 'quotesToReview', label: 'Quotations to review', items: quotesToReview }),
      buildBucket({ key: 'incoToSettle', label: 'INCO terms to settle', items: incoToSettle }),
      buildBucket({ key: 'techSpecToSend', label: 'Tech spec to send', items: techSpecToSend, slaKey: 'techSpec' }),
      buildBucket({ key: 'techSpecToRevise', label: 'Tech spec to revise', items: techSpecToRevise, slaKey: 'techSpec' }),
      buildBucket({ key: 'readyToAward', label: 'Ready to award', items: readyToAward }),
      buildBucket({ key: 'auctionUnawarded', label: 'Auction ended, not awarded', items: auctionUnawarded }),
      buildBucket({ key: 'trialsToReview', label: 'Trials to review', items: trialsToReview, slaKey: 'trialReview' }),
    ],
    waiting: waitingBands(requests, byRequest, now, [
      'vendor', 'technical', 'plant_head', 'plant_accounts', 'global_accounts',
    ]),
  };
}

/* ── administration ───────────────────────────────────────────────────── */

export function adminQueues(
  requests: CapexRequest[],
  byRequest: Map<string, VendorInvite[]>,
  budgetProposals: BudgetProposal[],
  adhocRequests: AdhocBudgetRequest[],
  now: number,
): QueueBands {
  const proposalItem = (p: BudgetProposal, at: string | undefined): QueueItem => ({
    id: p.id,
    label: `FY ${p.targetFy} · ${p.plant}`,
    sub: `₹${proposalTotalCr(p).toFixed(2)} Cr`,
    href: '/capex/budget-approvals',
    ageDays: ageInDays(at, now),
  });

  const pendingAdmin = budgetProposals.filter((p) => p.status === 'pending_admin');
  const pendingAccounts = budgetProposals.filter((p) => p.status === 'pending_accounts');
  const pendingPlantHead = budgetProposals.filter((p) => p.status === 'pending_plant_head');
  const adhocPending = adhocRequests.filter((a) => a.status === 'pending_admin');

  const stuckPlantHead = requests.filter((r) => {
    if (r.status !== 'pending_head_approval') return false;
    const age = ageInDays(lastAt(r), now);
    return age != null && age > SLA_DAYS.plantHead;
  });

  const sumCr = (ps: BudgetProposal[]) => ps.reduce((s, p) => s + proposalTotalCr(p), 0);

  return {
    mine: [
      buildBucket({
        key: 'proposals',
        label: 'Budget proposals to decide',
        items: pendingAdmin.map((p) => proposalItem(p, p.submittedAt ?? p.createdAt)),
        slaKey: 'adminApproval',
        href: '/capex/budget-approvals',
        amountCr: sumCr(pendingAdmin),
      }),
      buildBucket({
        key: 'adhoc',
        label: 'Adhoc transfers to decide',
        items: adhocPending.map((a) => ({
          id: a.id,
          label: `${a.fromHead} → ${a.toHead}`,
          sub: `₹${a.amountCr.toFixed(2)} Cr · ${a.plant}`,
          href: '/capex/adhoc-budget',
          ageDays: ageInDays(a.createdAt, now),
        })),
        slaKey: 'adminApproval',
        href: '/capex/adhoc-budget',
        amountCr: adhocPending.reduce((s, a) => s + a.amountCr, 0),
      }),
      buildBucket({
        key: 'accountsLink',
        label: 'Awaiting Global Accounts sign-off — share or chase the link',
        items: pendingAccounts.map((p) => proposalItem(p, p.adminDecidedAt ?? p.submittedAt)),
        slaKey: 'accounts',
        href: '/capex/budget-approvals',
        amountCr: sumCr(pendingAccounts),
      }),
      buildBucket({
        key: 'stuckPlantHead',
        label: 'Requests stuck at the plant head',
        items: stuckPlantHead.map((r) => ({
          id: r.id, label: requestLabel(r), href: requestHref(r), ageDays: ageInDays(lastAt(r), now),
        })),
        slaKey: 'plantHead',
        href: '/capex/requests?filter=pending_head_approval',
      }),
    ],
    waiting: [
      buildBucket({
        key: 'proposalsPlantHead',
        label: 'Budget proposals with the plant head',
        items: pendingPlantHead.map((p) => proposalItem(p, p.submittedAt ?? p.createdAt)),
        slaKey: 'plantHead',
        amountCr: sumCr(pendingPlantHead),
      }),
      ...waitingBands(requests, byRequest, now, ['sourcing', 'vendor', 'technical', 'plant_accounts', 'global_accounts']),
    ],
  };
}

/* ── maintenance (budget author) ──────────────────────────────────────── */

export function maintenanceQueues(proposals: BudgetProposal[], now: number): QueueBands {
  const item = (p: BudgetProposal, at: string | undefined): QueueItem => ({
    id: p.id,
    label: `FY ${p.targetFy} · ${p.plant}`,
    sub: `₹${proposalTotalCr(p).toFixed(2)} Cr`,
    href: '/capex/budget-proposals',
    ageDays: ageInDays(at, now),
  });
  const byStatus = (s: BudgetProposal['status']) => proposals.filter((p) => p.status === s);

  return {
    mine: [
      buildBucket({ key: 'drafts', label: 'Drafts to submit', items: byStatus('draft').map((p) => item(p, p.createdAt)) }),
      buildBucket({ key: 'needsCorrection', label: 'Sent back for correction', items: byStatus('needs_correction').map((p) => item(p, p.decidedAt ?? p.submittedAt)) }),
      buildBucket({ key: 'rejected', label: 'Rejected', items: byStatus('rejected').map((p) => item(p, p.decidedAt ?? p.submittedAt)) }),
    ],
    waiting: [
      buildBucket({ key: 'withPlantHead', label: 'With the plant head', items: byStatus('pending_plant_head').map((p) => item(p, p.submittedAt)), slaKey: 'plantHead' }),
      buildBucket({ key: 'withAdmin', label: 'With the admin', items: byStatus('pending_admin').map((p) => item(p, p.plantHeadDecidedAt ?? p.submittedAt)), slaKey: 'adminApproval' }),
      buildBucket({ key: 'withAccounts', label: 'With Global Accounts', items: byStatus('pending_accounts').map((p) => item(p, p.adminDecidedAt)), slaKey: 'accounts' }),
    ],
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS. (`proposalTotalCr` is already exported from `budgetProposalUtils.ts` — `capex/requests/page.tsx:12` imports it.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/kpiQueues.ts src/lib/kpiQueues.test.ts
git commit -m "feat: role action queues with SLA breach flags"
```

---

### Task 8: Shared UI primitives

**Files:**
- Create: `src/components/dashboards/useNow.ts`, `src/components/dashboards/format.ts`, `src/components/dashboards/KpiTile.tsx`, `src/components/dashboards/ActionQueue.tsx`, `src/components/dashboards/DashboardTabs.tsx`, `src/components/dashboards/charts.tsx`
- Reference: `src/app/(internal)/capex/dashboard/page.tsx:19-148` (charts to lift), `src/lib/uiTokens.ts`

**Interfaces:**
- Consumes: `QueueBucket`, `QueueItem` (Task 7)
- Produces: `useNow(intervalMs?)`, `fmtInr(n)`, `fmtInrFull(n)`, `fmtCr(n)`, `fmtDays(n)`, `Tone`, `KpiTile`, `ActionQueue`, `DashboardTabs`, `DonutChart`, `HBarChart`, `SavingsBreakdown`, `STATUS_HEX`

There is no test framework for React here (vitest is lib-only, by design — adding jsdom + testing-library is a bigger change than this feature warrants). These components are verified by type-check, build, and the role smoke-test in Task 13.

- [ ] **Step 1: Create the clock hook**

Create `src/components/dashboards/useNow.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'

/**
 * A coarse clock for aging + TAT figures, refreshed every 60s (matching `TatBanner`).
 *
 * Starts at 0 rather than `Date.now()`: these are client components but Next still renders them
 * on the server, and a real timestamp in the initial state would differ between the two passes
 * and trip a hydration mismatch. Callers render a skeleton while `now === 0`.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
```

- [ ] **Step 2: Create the formatters**

Create `src/components/dashboards/format.ts`:

```ts
/** Shared dashboard formatters. Compact for tile values, full for captions. */

const CR = 1_00_00_000

export function fmtInr(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= CR) return `${sign}₹${(abs / CR).toFixed(2)}Cr`
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)}L`
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}

export function fmtInrFull(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`
}

export function fmtCr(n: number): string {
  return `₹${n.toFixed(2)} Cr`
}

export function fmtDays(n: number | null): string {
  if (n == null) return '—'
  if (n < 1) return '<1d'
  return `${Math.round(n)}d`
}

export function fmtPct(n: number): string {
  return `${Math.round(n)}%`
}
```

- [ ] **Step 3: Create the KPI tile**

Create `src/components/dashboards/KpiTile.tsx`:

```tsx
'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { CARD_TIGHT } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'

/** Grayscale + blue chrome; emerald for value gained, red for value lost or an SLA breach. */
export type Tone = 'neutral' | 'good' | 'warn' | 'danger'

const ACCENT: Record<Tone, string> = {
  neutral: '#64748B',
  good: '#059669',
  warn: '#D97706',
  danger: '#DC2626',
}

const VALUE_CLASS: Record<Tone, string> = {
  neutral: 'text-slate-900',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  danger: 'text-red-700',
}

export interface KpiTileProps {
  label: string
  value: string
  /** Secondary line under the value — counts, comparisons. */
  sub?: string
  /** Provenance / basis line, e.g. "awarded" or "excl. freight". */
  caption?: string
  tone?: Tone
  icon: LucideIcon
  href?: string
  ariaLabel?: string
}

export function KpiTile({
  label, value, sub, caption, tone = 'neutral', icon: Icon, href, ariaLabel,
}: KpiTileProps) {
  const accent = ACCENT[tone]
  const body = (
    <>
      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <div className="rounded-lg p-1.5 shrink-0" style={{ background: `${accent}18` }}>
          <Icon aria-hidden="true" className="w-4 h-4" style={{ color: accent }} />
        </div>
      </div>
      <div>
        <p className={cn('text-2xl font-black tracking-tight leading-none tabular-nums', VALUE_CLASS[tone])}>
          {value}
        </p>
        {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
        {caption && <p className="text-[10px] text-slate-400 mt-0.5 italic">{caption}</p>}
      </div>
    </>
  )

  const className = cn(
    CARD_TIGHT,
    'flex flex-col gap-1.5 relative overflow-hidden min-h-[92px]',
    href && 'transition-colors hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]',
  )

  if (!href) return <div className={className}>{body}</div>
  return (
    <Link href={href} className={className} aria-label={ariaLabel ?? `${label}: ${value}`}>
      {body}
    </Link>
  )
}
```

- [ ] **Step 4: Create the action queue**

Create `src/components/dashboards/ActionQueue.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import type { QueueBucket } from '@/lib/kpiQueues'
import { CARD } from '@/lib/uiTokens'
import { cn } from '@/lib/utils'
import { fmtCr, fmtDays } from './format'

export interface ActionQueueProps {
  title: string
  /** `mine` = blocked on this user (blue). `waiting` = blocked on someone else (slate). */
  variant: 'mine' | 'waiting'
  buckets: QueueBucket[]
  emptyText: string
}

export function ActionQueue({ title, variant, buckets, emptyText }: ActionQueueProps) {
  const live = buckets.filter(b => b.count > 0)

  return (
    <section className={CARD} aria-label={title}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{title}</p>
      {live.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {live.map(b => <BucketRow key={b.key} bucket={b} variant={variant} />)}
        </ul>
      )}
    </section>
  )
}

function BucketRow({ bucket, variant }: { bucket: QueueBucket; variant: 'mine' | 'waiting' }) {
  const [open, setOpen] = useState(false)
  const Chevron = open ? ChevronDown : ChevronRight
  const accent = variant === 'mine' ? 'border-l-[#2563EB]' : 'border-l-slate-300'

  return (
    <li className={cn('rounded-lg border border-border border-l-4 bg-card', accent)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-lg"
      >
        <Chevron aria-hidden="true" className="w-4 h-4 text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0 text-[13px] font-semibold text-slate-800 truncate">
          {bucket.label}
        </span>
        {bucket.amountCr != null && bucket.amountCr > 0 && (
          <span className="text-[11px] font-semibold text-slate-500 shrink-0">{fmtCr(bucket.amountCr)}</span>
        )}
        {bucket.oldestDays != null && (
          <span
            className={cn(
              'text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 border',
              bucket.breached
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-slate-50 text-slate-600 border-slate-200',
            )}
          >
            {bucket.breached ? 'overdue ' : ''}{fmtDays(bucket.oldestDays)}
          </span>
        )}
        <span className="text-sm font-black text-slate-900 tabular-nums shrink-0 w-6 text-right">
          {bucket.count}
        </span>
      </button>

      {open && (
        <ul className="border-t border-border divide-y divide-border">
          {bucket.items
            .slice()
            .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
            .map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center gap-2 px-3 py-2 min-h-[44px] text-[12px] hover:bg-[#EBF0FB]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2563EB]"
                >
                  <span className="flex-1 min-w-0 truncate text-slate-700">{item.label}</span>
                  {item.sub && <span className="text-slate-400 shrink-0">{item.sub}</span>}
                  <span className="text-slate-400 shrink-0 tabular-nums">{fmtDays(item.ageDays)}</span>
                  <ArrowRight aria-hidden="true" className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </Link>
              </li>
            ))}
          {bucket.href && (
            <li>
              <Link href={bucket.href} className="block px-3 py-2 text-[12px] font-semibold text-primary hover:underline">
                Open the full list →
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}
```

- [ ] **Step 5: Create the tab shell**

Create `src/components/dashboards/DashboardTabs.tsx`:

```tsx
'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useRef } from 'react'
import { cn } from '@/lib/utils'

export interface DashboardTab {
  key: string
  label: string
}

/**
 * Tab shell whose active tab lives in `?view=`. Uses `router.replace` so switching tabs does not
 * stack history entries. The first tab is the default — on every role that has tabs, that is the
 * action queue, because the action queue is the point.
 */
export function DashboardTabs({
  tabs, children,
}: {
  tabs: DashboardTab[]
  children: (active: string) => React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const requested = params.get('view')
  const active = tabs.some(t => t.key === requested) ? (requested as string) : tabs[0].key

  const go = (key: string) => router.replace(`${pathname}?view=${key}`, { scroll: false })

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : (index - 1 + tabs.length) % tabs.length
    refs.current[next]?.focus()
    go(tabs[next].key)
  }

  return (
    <>
      <div role="tablist" aria-label="Dashboard views" className="flex gap-1 border-b border-border">
        {tabs.map((t, i) => {
          const selected = t.key === active
          return (
            <button
              key={t.key}
              ref={el => { refs.current[i] = el }}
              role="tab"
              type="button"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => go(t.key)}
              onKeyDown={e => onKeyDown(e, i)}
              className={cn(
                'px-4 py-2.5 min-h-[44px] text-[13px] font-semibold border-b-2 -mb-px transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB] rounded-t-lg',
                selected
                  ? 'border-[#2563EB] text-[#1D4ED8]'
                  : 'border-transparent text-slate-500 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-4">
        {children(active)}
      </div>
    </>
  )
}
```

- [ ] **Step 6: Lift the charts**

Create `src/components/dashboards/charts.tsx` by moving `DonutChart` (`dashboard/page.tsx:19-67`), `HBarChart` (`:69-103`), `SavingsBreakdown` (`:105-148`) and `STATUS_HEX` (`:150-167`) verbatim, adding `'use client'` at the top and `export` on each. Two changes only:

1. `STATUS_HEX` gains the fulfilment statuses it is missing (fixes D4):

```ts
export const STATUS_HEX: Record<string, string> = {
  draft: '#CBD5E1',
  submitted: '#60A5FA',
  pending_head_approval: '#94A3B8',
  sourcing: '#64748B',
  negotiation: '#475569',
  sourcing_approved: '#334155',
  buyer_approved: '#334155',
  pi_requested: '#5B21B6',
  pi_submitted: '#7C3AED',
  accounts_processing: '#0891B2',
  payment_in_progress: '#4338CA',
  completed: '#059669',
  rejected: '#F87171',
}
```

2. `ORDERED_STATUSES` is deleted. Callers pass `CAPEX_STATUS_FLOW` from `@/lib/types` instead, so no status can ever be silently dropped from the donut again.

Delete the `SavingsEntry` interface from the page and export it from `charts.tsx` unchanged.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: clean. (`charts.tsx` will report unused imports until Task 9 consumes it — resolve by keeping only the imports the file actually uses.)

- [ ] **Step 8: Commit**

```bash
git add src/components/dashboards/
git commit -m "feat: shared dashboard primitives — tile, action queue, tabs, charts"
```

---

### Task 9: Role resolver + Buyer dashboard

**Files:**
- Rewrite: `src/app/(internal)/capex/dashboard/page.tsx`
- Create: `src/components/dashboards/BuyerDashboard.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1-8
- Produces: `BuyerDashboard({ requests, byRequest, index, now })`, and the role-resolving default export

- [ ] **Step 1: Rewrite the route as a role resolver**

Replace the entire contents of `src/app/(internal)/capex/dashboard/page.tsx`:

```tsx
'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useCapex } from '@/lib/capexContext'
import { getPlantForRole, ROLE_NAMES } from '@/lib/constants'
import { invitesByRequest, masterIndex } from '@/lib/kpiUtils'
import { useNow } from '@/components/dashboards/useNow'
import { BuyerDashboard } from '@/components/dashboards/BuyerDashboard'
import { SourcingDashboard } from '@/components/dashboards/SourcingDashboard'
import { AdminDashboard } from '@/components/dashboards/AdminDashboard'
import { MaintenanceDashboard } from '@/components/dashboards/MaintenanceDashboard'

function DashboardResolver() {
  const capex = useCapex()
  const now = useNow()
  const [role, setRole] = useState('buyer')

  useEffect(() => {
    setRole(localStorage.getItem('capex_role') ?? 'buyer')
    const onChange = (e: Event) => setRole((e as CustomEvent).detail as string)
    window.addEventListener('capex_rolechange', onChange as EventListener)
    return () => window.removeEventListener('capex_rolechange', onChange as EventListener)
  }, [])

  const byRequest = useMemo(() => invitesByRequest(capex.invites), [capex.invites])
  const index = useMemo(() => masterIndex(capex.capexMaster), [capex.capexMaster])

  // `now` is 0 until the clock hook mounts (see useNow — hydration safety).
  if (now === 0) {
    return (
      <div className="p-5 h-full flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading dashboard…</p>
      </div>
    )
  }

  const shared = { now, byRequest, index }

  // Explicit props, never the whole context — these are presentational components.
  if (role === 'sourcing_member') {
    return (
      <SourcingDashboard
        {...shared}
        requests={capex.requests.filter(r => r.assignedTo === 'sourcing_member')}
        vendors={capex.vendors}
      />
    )
  }
  if (role === 'super_admin') {
    return (
      <AdminDashboard
        {...shared}
        requests={capex.requests}
        capexMaster={capex.capexMaster}
        budgetProposals={capex.budgetProposals}
        adhocBudgetRequests={capex.adhocBudgetRequests}
        brownFieldHeadAllocations={capex.brownFieldHeadAllocations}
        usedAmountByMasterItemId={capex.usedAmountByMasterItemId}
      />
    )
  }
  if (role === 'maintenance') {
    return <MaintenanceDashboard now={now} proposals={capex.budgetProposals} />
  }

  // Every buyer variant, and any unknown role, lands here.
  const plant = getPlantForRole(role)
  const currentUser = ROLE_NAMES[role] ?? ''
  const mine = capex.requests.filter(
    r => r.createdBy === currentUser && (!plant || r.plant === plant),
  )
  return <BuyerDashboard {...shared} requests={mine} plant={plant} capexMaster={capex.capexMaster} />
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-5 text-slate-400">Loading…</div>}>
      <DashboardResolver />
    </Suspense>
  )
}
```

- [ ] **Step 2: Create the buyer dashboard**

Create `src/components/dashboards/BuyerDashboard.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Activity, CheckCheck, FileText, IndianRupee, Timer } from 'lucide-react'
import type { CapexMasterItem, CapexRequest, VendorInvite } from '@/lib/types'
import { CAPEX_STATUS_FLOW } from '@/lib/types'
import { STATUS_LABELS } from '@/lib/constants'
import { StatusBadge } from '@/components/StatusBadge'
import { CARD, PAGE_SHELL, SECTION_GRID } from '@/lib/uiTokens'
import {
  MasterIndex, TERMINAL_STATUSES, allocatedForRequest, ballHolders,
  PARTY_LABELS, medianStageDays, requestValue, VALUE_BASIS_LABELS,
} from '@/lib/kpiUtils'
import { buyerQueues } from '@/lib/kpiQueues'
import { ActionQueue } from './ActionQueue'
import { KpiTile } from './KpiTile'
import { DonutChart, STATUS_HEX } from './charts'
import { fmtDays, fmtInr, fmtInrFull } from './format'

export function BuyerDashboard({
  requests, byRequest, index, now, plant, capexMaster,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  plant: string | null
  capexMaster: CapexMasterItem[]
}) {
  const stats = useMemo(() => {
    const live = requests.filter(r => !TERMINAL_STATUSES.includes(r.status) && r.status !== 'draft')
    const valueInFlight = live.reduce(
      (s, r) => s + requestValue(r, byRequest.get(r.id) ?? [], index).inr, 0,
    )
    const allocated = live.reduce((s, r) => s + allocatedForRequest(r, index), 0)
    const donut = CAPEX_STATUS_FLOW
      .map(s => ({
        label: STATUS_LABELS[s] ?? s,
        value: requests.filter(r => r.status === s).length,
        color: STATUS_HEX[s] ?? '#94a3b8',
      }))
      .filter(d => d.value > 0)

    return {
      total: requests.length,
      completed: requests.filter(r => r.status === 'completed').length,
      rejected: requests.filter(r => r.status === 'rejected').length,
      live: live.length,
      valueInFlight,
      allocated,
      headTat: medianStageDays(requests, 'pending_head_approval', 'sourcing'),
      fullTat: medianStageDays(requests, 'submitted', 'completed'),
      donut,
    }
  }, [requests, byRequest, index])

  const bands = useMemo(() => buyerQueues(requests, byRequest, now), [requests, byRequest, now])
  const underBudget = stats.allocated > 0 && stats.valueInFlight <= stats.allocated

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">My CAPEX Dashboard</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Your requests{plant ? ` · ${plant.replace(/_/g, ' ')}` : ''} — what needs you, and where the rest are stuck.
        </p>
      </header>

      <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID} shrink-0`}>
        <KpiTile
          label="My requests" value={String(stats.total)} icon={FileText}
          sub={`${stats.completed} completed · ${stats.rejected} rejected`}
          href="/capex/requests"
        />
        <KpiTile
          label="In flight" value={String(stats.live)} icon={Activity}
          sub="not yet completed"
        />
        <KpiTile
          label="Value in flight" value={fmtInr(stats.valueInFlight)} icon={IndianRupee}
          sub={fmtInrFull(stats.valueInFlight)}
          caption={`mixed basis — see ${VALUE_BASIS_LABELS.awarded}/${VALUE_BASIS_LABELS.quoted} per request`}
        />
        <KpiTile
          label="Against allocation"
          value={stats.allocated > 0 ? fmtInr(stats.allocated - stats.valueInFlight) : '—'}
          icon={CheckCheck}
          tone={stats.allocated === 0 ? 'neutral' : underBudget ? 'good' : 'danger'}
          sub={stats.allocated > 0
            ? `${fmtInr(stats.allocated)} allocated · ${underBudget ? 'under' : 'over'}`
            : 'no linked budget lines'}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
          <ActionQueue
            title="Needs you" variant="mine" buckets={bands.mine}
            emptyText="Nothing is waiting on you."
          />
          <ActionQueue
            title="Waiting on others" variant="waiting" buckets={bands.waiting}
            emptyText="Nothing in flight."
          />
        </div>

        <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
          <section className={CARD}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Turnaround</p>
            <div className="grid grid-cols-2 gap-3">
              <KpiTile
                label="Plant-head decision" icon={Timer}
                value={fmtDays(stats.headTat.medianDays)}
                sub={`median over ${stats.headTat.sampled} · ${stats.headTat.stillOpen} still open`}
              />
              <KpiTile
                label="Request → completed" icon={Timer}
                value={fmtDays(stats.fullTat.medianDays)}
                sub={`median over ${stats.fullTat.sampled} · ${stats.fullTat.stillOpen} still open`}
              />
            </div>
          </section>

          <section className={CARD}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">My requests by status</p>
            <DonutChart data={stats.donut} />
          </section>
        </div>

        <section className={CARD}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
            Who holds the ball
          </p>
          {requests.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-slate-400">You have not raised a request yet.</p>
              <Link href="/capex/new" className="text-xs font-semibold text-primary hover:underline">
                Raise your first CAPEX request →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2">Request</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">With</th>
                    <th className="px-3 py-2 text-right">Waiting</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {requests.map(r => {
                    const holds = ballHolders(r, byRequest.get(r.id) ?? [], now)
                    const worst = holds.reduce((a, b) => (b.days > a.days ? b : a), holds[0])
                    return (
                      <tr key={r.id} className="hover:bg-[#EBF0FB]/60">
                        <td className="px-3 py-2">
                          <Link href={`/capex/${r.id}`} className="font-semibold text-primary hover:underline">
                            {r.requestNo ?? r.id.slice(0, 8)}
                          </Link>
                          <span className="ml-2 text-slate-600">{r.subject}</span>
                        </td>
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                        <td className="px-3 py-2 text-slate-600">{PARTY_LABELS[worst.party]}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {worst.party === 'none' ? '—' : fmtDays(worst.days)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only for the three dashboards not yet created (Tasks 10-12). Create temporary one-line stubs so the build stays green between tasks:

```tsx
// src/components/dashboards/SourcingDashboard.tsx (replaced in Task 10)
'use client'
export function SourcingDashboard(_: Record<string, unknown>) { return null }
```

Repeat for `AdminDashboard.tsx` and `MaintenanceDashboard.tsx`. Re-run until clean.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: compiles; `/capex/dashboard` present in the route list.

- [ ] **Step 5: Smoke-test**

Run `npm run dev`, log in as **Buyer · Jhajjar P1**, open `/capex/dashboard`. Verify: only that buyer's requests appear; the empty state offers "Raise your first CAPEX request"; switching to **Buyer · Jhajjar P2** via the top-nav switcher swaps the data without a reload.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(internal\)/capex/dashboard/page.tsx src/components/dashboards/
git commit -m "feat: role-resolved dashboard route + buyer dashboard"
```

---

### Task 10: Sourcing dashboard

**Files:**
- Rewrite: `src/components/dashboards/SourcingDashboard.tsx` (replaces the Task 9 stub)

**Interfaces:**
- Consumes: `sourcingQueues`, `savingsForRequest`, `requestValue`, `poIssuedForRequest`, `paidForRequest`, `median`, `medianStageDays`, `delayLiabilityExposure`, `vendorScorecard`, `DashboardTabs`, `ActionQueue`, `KpiTile`
- Produces: `SourcingDashboard({ requests, byRequest, index, now, vendors })`

- [ ] **Step 1: Write the component**

Replace `src/components/dashboards/SourcingDashboard.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, Clock, Gavel, HandCoins, Timer, TrendingDown, Truck, Users,
} from 'lucide-react'
import type { CapexRequest, Vendor, VendorInvite } from '@/lib/types'
import { CARD, PAGE_SHELL, SECTION_GRID } from '@/lib/uiTokens'
import {
  MasterIndex, median, medianStageDays, paidForRequest, poIssuedForRequest,
  requestValue, savingsForRequest,
} from '@/lib/kpiUtils'
import { sourcingQueues } from '@/lib/kpiQueues'
import { delayLiabilityExposure, vendorScorecard } from '@/lib/kpiRisk'
import { awardedInvites, isAwardBased } from '@/lib/paymentUtils'
import { isAuctionActive, formatAuctionCountdown, computeAuctionBestPrice } from '@/lib/auctionUtils'
import { ActionQueue } from './ActionQueue'
import { DashboardTabs } from './DashboardTabs'
import { KpiTile } from './KpiTile'
import { fmtDays, fmtInr, fmtInrFull, fmtPct } from './format'

const DAY = 86_400_000
const daysBetween = (a?: string, b?: string) =>
  a && b ? (new Date(b).getTime() - new Date(a).getTime()) / DAY : null

export function SourcingDashboard({
  requests, byRequest, index, now, vendors,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  vendors: Vendor[]
}) {
  const bands = useMemo(() => sourcingQueues(requests, byRequest, now), [requests, byRequest, now])

  const perf = useMemo(() => {
    let negotiation = 0, budget = 0, negNotComparable = 0, budNotComparable = 0
    let auctionSaved = 0
    const auctionPcts: number[] = []
    let invited = 0, quoted = 0, singleQuoteAwards = 0, awardCount = 0
    let poIssued = 0, paid = 0
    const firstQuoteDays: number[] = []
    const negotiationDays: number[] = []
    const techSpecDays: number[] = []

    for (const r of requests) {
      const reqInvites = byRequest.get(r.id) ?? []
      const s = savingsForRequest(r, reqInvites, index)
      if (s) {
        negotiation += s.negotiation
        budget += s.budget
        if (!s.negotiationComparable) negNotComparable++
        if (!s.budgetComparable) budNotComparable++
      }

      const opening = r.auctionConfig?.openingBestPrice
      const value = requestValue(r, reqInvites, index)
      if (opening && opening > 0 && value.basis === 'awarded' && value.inr > 0) {
        auctionSaved += opening - value.inr
        auctionPcts.push(((opening - value.inr) / opening) * 100)
      }

      poIssued += poIssuedForRequest(r, reqInvites)
      paid += paidForRequest(r, reqInvites)

      const withQuote = reqInvites.filter(i => i.rfqQuote || i.quotes.length || i.openingQuote)
      invited += reqInvites.length
      quoted += withQuote.length

      if (isAwardBased(reqInvites)) {
        const awards = awardedInvites(reqInvites)
        awardCount += awards.length
        if (withQuote.length === 1) singleQuoteAwards += awards.length
      }

      for (const inv of reqInvites) {
        const first = inv.rfqThread?.find(m => m.by === 'supplier' && m.quote)
        const settled = inv.rfqThread?.find(m => m.action === 'approved')
        const d1 = daysBetween(inv.invitedAt, first?.at)
        if (d1 != null && d1 >= 0) firstQuoteDays.push(d1)
        const d2 = daysBetween(first?.at, settled?.at)
        if (d2 != null && d2 >= 0) negotiationDays.push(d2)
        const d3 = daysBetween(inv.techSpec?.sentAt, inv.techSpec?.decidedAt)
        if (d3 != null && d3 >= 0) techSpecDays.push(d3)
      }
    }

    return {
      negotiation, budget, negNotComparable, budNotComparable,
      auctionSaved, auctionPct: median(auctionPcts),
      invited, quoted, singleQuoteAwards, awardCount,
      poIssued, paid, outstanding: Math.max(0, poIssued - paid),
      cycle: medianStageDays(requests, 'sourcing', 'pi_requested'),
      firstQuote: median(firstQuoteDays),
      negotiationTime: median(negotiationDays),
      techSpecTime: median(techSpecDays),
      exposure: delayLiabilityExposure(requests, byRequest, index, now),
      scorecard: vendorScorecard(vendors, requests, byRequest, index, now),
    }
  }, [requests, byRequest, index, now, vendors])

  const liveAuctions = requests.filter(r => isAuctionActive(r.auctionConfig))
  const totalAwarded = perf.scorecard.reduce((s, v) => s + v.awardedInr, 0)

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Sourcing Cockpit</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          What is blocked on you, who you are waiting on, and what your negotiations delivered.
        </p>
      </header>

      <DashboardTabs tabs={[{ key: 'desk', label: 'Desk' }, { key: 'performance', label: 'Performance' }]}>
        {active => active === 'desk' ? (
          <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
            <ActionQueue
              title="Your turn" variant="mine" buckets={bands.mine}
              emptyText="Nothing is blocked on you right now."
            />
            <ActionQueue
              title="Waiting on others — chase list" variant="waiting" buckets={bands.waiting}
              emptyText="Nothing is in someone else's court."
            />
          </div>
        ) : (
          <>
            <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID}`}>
              <KpiTile
                label="Negotiation savings" value={fmtInr(perf.negotiation)} icon={TrendingDown}
                tone={perf.negotiation > 0 ? 'good' : 'neutral'}
                sub={fmtInrFull(perf.negotiation)}
                caption={perf.negNotComparable > 0
                  ? `${perf.negNotComparable} award(s) not comparable · split awards exclude freight/packing/service`
                  : 'first quotation → final, like-for-like'}
              />
              <KpiTile
                label="Budget savings" value={fmtInr(perf.budget)} icon={HandCoins}
                tone={perf.budget >= 0 ? 'good' : 'danger'}
                sub="allocation → awarded"
                caption={perf.budNotComparable > 0 ? `${perf.budNotComparable} with no allocation` : undefined}
              />
              <KpiTile
                label="Auction effectiveness" value={fmtInr(perf.auctionSaved)} icon={Gavel}
                tone={perf.auctionSaved > 0 ? 'good' : 'neutral'}
                sub={perf.auctionPct != null ? `median ${fmtPct(perf.auctionPct)} below opening` : 'no closed auctions'}
              />
              <KpiTile
                label="Delay liability" value={fmtInr(perf.exposure.runningInr)} icon={AlertTriangle}
                tone={perf.exposure.runningInr > 0 ? 'danger' : 'neutral'}
                sub={`${perf.exposure.pastGraceCount} past grace · ${fmtInr(perf.exposure.realisedInr)} realised`}
              />
            </div>

            <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID}`}>
              <KpiTile
                label="Sourcing cycle time" value={fmtDays(perf.cycle.medianDays)} icon={Timer}
                sub={`median over ${perf.cycle.sampled} · ${perf.cycle.stillOpen} still open`}
                caption="sourcing → PI requested"
              />
              <KpiTile
                label="Vendor participation"
                value={perf.invited > 0 ? fmtPct((perf.quoted / perf.invited) * 100) : '—'}
                icon={Users}
                sub={`${perf.quoted} quoted of ${perf.invited} invited`}
              />
              <KpiTile
                label="Single-quote awards" value={String(perf.singleQuoteAwards)} icon={AlertTriangle}
                tone={perf.singleQuoteAwards > 0 ? 'warn' : 'good'}
                sub={`of ${perf.awardCount} award(s)`}
                caption="decided against one quoting vendor"
              />
              <KpiTile
                label="Commitments" value={fmtInr(perf.outstanding)} icon={Truck}
                sub={`${fmtInr(perf.poIssued)} PO issued · ${fmtInr(perf.paid)} paid`}
                caption="outstanding"
                href="/accounts/queue"
              />
            </div>

            <section className={CARD}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                Cycle time, leg by leg
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <KpiTile label="Invite → first quote" value={fmtDays(perf.firstQuote)} icon={Clock} />
                <KpiTile label="First quote → agreed" value={fmtDays(perf.negotiationTime)} icon={Clock} />
                <KpiTile label="Tech-spec gate" value={fmtDays(perf.techSpecTime)} icon={Clock} />
              </div>
            </section>

            {liveAuctions.length > 0 && (
              <section className={CARD}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Auction watch</p>
                <ul className="divide-y divide-border">
                  {liveAuctions.map(r => {
                    const reqInvites = byRequest.get(r.id) ?? []
                    const best = computeAuctionBestPrice(reqInvites, r.lineItems, r.auctionConfig)
                    return (
                      <li key={r.id} className="flex items-center gap-3 py-2 text-[13px]">
                        <Link href={`/capex/${r.id}`} className="font-semibold text-primary hover:underline shrink-0">
                          {r.requestNo ?? r.id.slice(0, 8)}
                        </Link>
                        <span className="flex-1 min-w-0 truncate text-slate-600">{r.subject}</span>
                        <span className="text-slate-500 shrink-0">{reqInvites.length} bidders</span>
                        <span className="font-semibold text-emerald-700 shrink-0">
                          {best != null ? fmtInr(best) : '—'}
                        </span>
                        <span className="text-slate-500 tabular-nums shrink-0">
                          {r.auctionConfig ? formatAuctionCountdown(r.auctionConfig.endsAt) : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section className={CARD}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                Vendor scorecard
              </p>
              {perf.scorecard.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">No vendors have been invited yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2">Vendor</th>
                        <th className="px-3 py-2 text-right">Invited</th>
                        <th className="px-3 py-2 text-right">Response</th>
                        <th className="px-3 py-2 text-right">Median reply</th>
                        <th className="px-3 py-2 text-right">Awards</th>
                        <th className="px-3 py-2 text-right">Awarded value</th>
                        <th className="px-3 py-2 text-right">Share</th>
                        <th className="px-3 py-2 text-right">Delay accrued</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {perf.scorecard.map(v => (
                        <tr key={v.vendorId} className="hover:bg-[#EBF0FB]/60">
                          <td className="px-3 py-2 font-semibold text-slate-800">{v.vendorName}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{v.invited}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtPct(v.responseRatePct)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtDays(v.medianResponseDays)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600">{v.awards}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{fmtInr(v.awardedInr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {totalAwarded > 0 ? fmtPct((v.awardedInr / totalAwarded) * 100) : '—'}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${v.delayAccruedInr > 0 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>
                            {v.delayAccruedInr > 0 ? fmtInr(v.delayAccruedInr) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </DashboardTabs>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (Admin + Maintenance stubs still in place).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Smoke-test**

`npm run dev` → switch to **Sourcing Member**. Verify: Desk is the default tab and `?view=desk` appears in the URL; clicking **Performance** swaps content without a page reload; the browser Back button does not step through tab changes; a bucket expands to its rows and each row opens the right request.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/SourcingDashboard.tsx
git commit -m "feat: sourcing cockpit — desk queues + performance KPIs"
```

---

### Task 11: Administration dashboard

**Files:**
- Rewrite: `src/components/dashboards/AdminDashboard.tsx` (replaces the Task 9 stub)

**Interfaces:**
- Consumes: `adminQueues`, `fyBudgetPosition`, `headPositions`, `valueFunnel`, `requestFy`, `delayLiabilityExposure`, `medianStageDays`, `ballHolders`, `canRequestPi`, `incoTermsBlocksAward`, `techSpecBlocksAward`, `finalPaymentBlockedByTrial`
- Produces: `AdminDashboard({ requests, byRequest, index, now, capexMaster, budgetProposals, adhocBudgetRequests, brownFieldHeadAllocations, usedAmountByMasterItemId })`

- [ ] **Step 1: Write the component**

Replace `src/components/dashboards/AdminDashboard.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ClipboardCheck, IndianRupee, Layers, Scissors, Timer, TrendingDown,
} from 'lucide-react'
import type {
  AdhocBudgetRequest, BrownFieldHeadBudget, BudgetProposal, CapexMasterItem,
  CapexRequest, FieldType, VendorInvite,
} from '@/lib/types'
import { FIELD_TYPE_LABELS, CAPEX_STATUS_FLOW } from '@/lib/types'
import { PLANTS } from '@/lib/constants'
import { CARD, PAGE_SHELL, SECTION_GRID } from '@/lib/uiTokens'
import {
  MasterIndex, PARTY_LABELS, ballHolders, medianStageDays,
} from '@/lib/kpiUtils'
import { adminQueues } from '@/lib/kpiQueues'
import { fyBudgetPosition, headPositions, requestFy, valueFunnel } from '@/lib/kpiPortfolio'
import { delayLiabilityExposure } from '@/lib/kpiRisk'
import { getLatestMasterFyForField, resolveProjectType } from '@/lib/greenFieldConstants'
import { proposalTotalCr } from '@/lib/budgetProposalUtils'
import { awardedInvites, finalPaymentBlockedByTrial, isAwardBased } from '@/lib/paymentUtils'
import { incoTermsBlocksAward } from '@/lib/incoTermsUtils'
import { techSpecBlocksAward } from '@/lib/techSpecUtils'
import { ActionQueue } from './ActionQueue'
import { DashboardTabs } from './DashboardTabs'
import { KpiTile } from './KpiTile'
import { HBarChart } from './charts'
import { fmtCr, fmtDays, fmtInr, fmtPct } from './format'

const FIELD_TYPES: FieldType[] = ['brown_field', 'green_field', 'digitisation', 'information_technology']

export function AdminDashboard({
  requests, byRequest, index, now, capexMaster,
  budgetProposals, adhocBudgetRequests, brownFieldHeadAllocations, usedAmountByMasterItemId,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  capexMaster: CapexMasterItem[]
  budgetProposals: BudgetProposal[]
  adhocBudgetRequests: AdhocBudgetRequest[]
  brownFieldHeadAllocations: BrownFieldHeadBudget[]
  usedAmountByMasterItemId: Record<string, number>
}) {
  const bands = useMemo(
    () => adminQueues(requests, byRequest, budgetProposals, adhocBudgetRequests, now),
    [requests, byRequest, budgetProposals, adhocBudgetRequests, now],
  )

  const portfolio = useMemo(() => {
    const positions = FIELD_TYPES.map(fieldType =>
      fyBudgetPosition({
        capexMaster, requests, byRequest,
        scope: { fieldType, fy: getLatestMasterFyForField(capexMaster, fieldType) },
      }),
    ).filter(p => p.allocatedInr > 0 || p.committedInr > 0)

    // Over-allocation is a Brown Field concern (that is where adhoc transfers apply).
    const brownScopes = new Set<string>()
    for (const m of capexMaster) {
      if ((m.fieldType ?? 'brown_field') !== 'brown_field') continue
      brownScopes.add(`${m.plant}|${m.fy}|${resolveProjectType(m)}`)
    }
    let overExposureCr = 0
    let breachedHeads = 0
    for (const key of brownScopes) {
      const [plant, fy, projectType] = key.split('|')
      for (const h of headPositions({
        capexMaster, headOverrides: brownFieldHeadAllocations, usedAmountByMasterItemId,
        scope: { plant, fy, projectType: projectType as 'rac' },
      })) {
        if (!h.over) continue
        breachedHeads++
        overExposureCr += h.committedCr - h.allocatedCr
      }
    }

    const byPlant = PLANTS.map(p => ({
      label: p.label,
      sub: p.state,
      value: requests.filter(r => r.plant === p.value && r.status !== 'draft' && r.status !== 'rejected').length,
    })).filter(p => p.value > 0)

    const editTrimCr = budgetProposals.reduce(
      (s, p) => s + (p.edits ?? []).reduce((t, e) => t + (e.totalBeforeCr - e.totalAfterCr), 0),
      0,
    )
    const resubmits = budgetProposals.reduce((s, p) => s + (p.resubmitCount ?? 0), 0)

    // Governance flags — every one derivable, none inferred.
    let singleQuoteAwards = 0
    let incoOpenAwards = 0
    let techSpecMissing = 0
    let paidWithTrialOpen = 0
    for (const r of requests) {
      const reqInvites = byRequest.get(r.id) ?? []
      if (!isAwardBased(reqInvites)) continue
      const withQuote = reqInvites.filter(i => i.rfqQuote || i.quotes.length || i.openingQuote)
      for (const a of awardedInvites(reqInvites)) {
        if (withQuote.length === 1) singleQuoteAwards++
        if (incoTermsBlocksAward(a)) incoOpenAwards++
        if (techSpecBlocksAward(a)) techSpecMissing++
        const paidFinal = (a.paymentMilestones ?? []).some(m => m.isFinal && m.status === 'paid')
        if (paidFinal && finalPaymentBlockedByTrial(a)) paidWithTrialOpen++
      }
    }

    const stalled = [...requests]
      .filter(r => r.status !== 'completed' && r.status !== 'rejected' && r.status !== 'draft')
      .map(r => {
        const holds = ballHolders(r, byRequest.get(r.id) ?? [], now)
        return { r, hold: holds.reduce((a, b) => (b.days > a.days ? b : a), holds[0]) }
      })
      .sort((a, b) => b.hold.days - a.hold.days)
      .slice(0, 10)

    const stageMedians = CAPEX_STATUS_FLOW.slice(0, -1)
      .map((from, i) => ({ from, to: CAPEX_STATUS_FLOW[i + 1], ...medianStageDays(requests, from, CAPEX_STATUS_FLOW[i + 1]) }))
      .filter(s => s.medianDays != null)

    return {
      positions, overExposureCr, breachedHeads, byPlant, editTrimCr, resubmits,
      singleQuoteAwards, incoOpenAwards, techSpecMissing, paidWithTrialOpen, stalled, stageMedians,
      funnel: valueFunnel(requests, byRequest, index),
      exposure: delayLiabilityExposure(requests, byRequest, index, now),
      rejectionRate: requests.length
        ? (requests.filter(r => r.status === 'rejected').length / requests.length) * 100
        : 0,
    }
  }, [
    capexMaster, requests, byRequest, index, now,
    budgetProposals, brownFieldHeadAllocations, usedAmountByMasterItemId,
  ])

  const pendingAdminCr = budgetProposals
    .filter(p => p.status === 'pending_admin')
    .reduce((s, p) => s + proposalTotalCr(p), 0)

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Administration</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Approvals waiting on you, and the CAPEX portfolio end to end.
        </p>
      </header>

      <DashboardTabs tabs={[{ key: 'desk', label: 'My Desk' }, { key: 'portfolio', label: 'Portfolio' }]}>
        {active => active === 'desk' ? (
          <>
            <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID}`}>
              <KpiTile
                label="Proposals to decide"
                value={String(bands.mine.find(b => b.key === 'proposals')?.count ?? 0)}
                sub={fmtCr(pendingAdminCr)} icon={ClipboardCheck}
                tone={bands.mine.find(b => b.key === 'proposals')?.breached ? 'danger' : 'neutral'}
                href="/capex/budget-approvals"
              />
              <KpiTile
                label="Adhoc transfers"
                value={String(bands.mine.find(b => b.key === 'adhoc')?.count ?? 0)}
                sub={fmtCr(bands.mine.find(b => b.key === 'adhoc')?.amountCr ?? 0)}
                icon={Layers} href="/capex/adhoc-budget"
              />
              <KpiTile
                label="Awaiting accounts link"
                value={String(bands.mine.find(b => b.key === 'accountsLink')?.count ?? 0)}
                sub="share or chase the sign-off link" icon={Timer}
                href="/capex/budget-approvals"
              />
              <KpiTile
                label="Stuck at plant head"
                value={String(bands.mine.find(b => b.key === 'stuckPlantHead')?.count ?? 0)}
                sub={`older than the ${fmtDays(3)} threshold`} icon={AlertTriangle}
                tone={(bands.mine.find(b => b.key === 'stuckPlantHead')?.count ?? 0) > 0 ? 'warn' : 'good'}
              />
            </div>

            <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
              <ActionQueue
                title="Your approvals" variant="mine" buckets={bands.mine}
                emptyText="No approvals are waiting on you."
              />
              <ActionQueue
                title="Elsewhere in the chain" variant="waiting" buckets={bands.waiting}
                emptyText="Nothing in flight."
              />
            </div>
          </>
        ) : (
          <>
            <section className={CARD}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                FY budget position, by field type
              </p>
              {portfolio.positions.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">
                  No budget has been published yet. Approve a proposal to establish the live FY.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="px-3 py-2">Field type</th>
                        <th className="px-3 py-2">FY</th>
                        <th className="px-3 py-2 text-right">Allocated</th>
                        <th className="px-3 py-2 text-right">Committed</th>
                        <th className="px-3 py-2 text-right">Awarded</th>
                        <th className="px-3 py-2 text-right">Paid</th>
                        <th className="px-3 py-2 text-right">Remaining</th>
                        <th className="px-3 py-2 text-right">Utilised</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {portfolio.positions.map(p => (
                        <tr key={p.scope.fieldType} className="hover:bg-[#EBF0FB]/60">
                          <td className="px-3 py-2 font-semibold text-slate-800">{FIELD_TYPE_LABELS[p.scope.fieldType]}</td>
                          <td className="px-3 py-2 text-slate-500">{p.scope.fy}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.allocatedInr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.committedInr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.awardedInr)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInr(p.paidInr)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${p.remainingInr >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                            {fmtInr(p.remainingInr)}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${p.utilisationPct > 90 ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
                            {fmtPct(p.utilisationPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID}`}>
              <KpiTile
                label="Over-allocation exposure" value={fmtCr(portfolio.overExposureCr)} icon={AlertTriangle}
                tone={portfolio.breachedHeads > 0 ? 'danger' : 'good'}
                sub={`${portfolio.breachedHeads} head(s) over`}
                caption="committed (est.) vs effective head allocation"
                href="/capex/adhoc-budget"
              />
              <KpiTile
                label="Approver edit impact" value={fmtCr(portfolio.editTrimCr)} icon={Scissors}
                tone={portfolio.editTrimCr > 0 ? 'good' : 'neutral'}
                sub={`${portfolio.resubmits} resubmission(s)`}
                caption="trimmed while sending forward"
              />
              <KpiTile
                label="Delay liability" value={fmtInr(portfolio.exposure.runningInr)} icon={TrendingDown}
                tone={portfolio.exposure.runningInr > 0 ? 'danger' : 'neutral'}
                sub={`${portfolio.exposure.pastGraceCount} past grace`}
              />
              <KpiTile
                label="Rejection rate" value={fmtPct(portfolio.rejectionRate)} icon={IndianRupee}
                sub={`of ${requests.length} request(s)`}
              />
            </div>

            <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
              <section className={CARD}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Value funnel</p>
                <ul className="space-y-2">
                  {([
                    ['Requested', portfolio.funnel.requested],
                    ['Approved', portfolio.funnel.approved],
                    ['Awarded', portfolio.funnel.awarded],
                    ['PO issued', portfolio.funnel.poIssued],
                    ['Paid', portfolio.funnel.paid],
                  ] as const).map(([label, v], i, all) => {
                    const top = all[0][1]
                    const prev = i > 0 ? all[i - 1][1] : null
                    return (
                      <li key={label}>
                        <div className="flex items-baseline justify-between text-[13px] mb-1">
                          <span className="font-semibold text-slate-800">{label}</span>
                          <span className="tabular-nums text-slate-700">
                            {fmtInr(v)}
                            {prev != null && prev > 0 && (
                              <span className="ml-2 text-[11px] text-slate-400">{fmtPct((v / prev) * 100)} of prev</span>
                            )}
                          </span>
                        </div>
                        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#2563EB] rounded-full" style={{ width: `${top > 0 ? (v / top) * 100 : 0}%` }} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section className={CARD}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">Live requests by plant</p>
                <HBarChart data={portfolio.byPlant} emptyText="No live requests." />
              </section>
            </div>

            <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
              <section className={CARD}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                  Governance flags
                </p>
                <ul className="space-y-1.5 text-[13px]">
                  {([
                    ['Awards decided on a single quote', portfolio.singleQuoteAwards],
                    ['Awards with INCO terms unsettled', portfolio.incoOpenAwards],
                    ['Awards without technical sign-off', portfolio.techSpecMissing],
                    ['Final payment released with a trial open', portfolio.paidWithTrialOpen],
                  ] as const).map(([label, n]) => (
                    <li key={label} className="flex items-center justify-between gap-3 py-1">
                      <span className="text-slate-700">{label}</span>
                      <span className={`font-bold tabular-nums ${n > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={CARD}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                  Median days per stage
                </p>
                {portfolio.stageMedians.length === 0 ? (
                  <p className="text-sm text-slate-400 py-6 text-center">Not enough completed transitions yet.</p>
                ) : (
                  <HBarChart
                    data={portfolio.stageMedians.map(s => ({
                      label: `${s.from} → ${s.to}`,
                      sub: `${s.sampled} sampled`,
                      value: Math.round(s.medianDays ?? 0),
                    }))}
                  />
                )}
              </section>
            </div>

            <section className={CARD}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
                Longest-waiting live requests
              </p>
              {portfolio.stalled.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">Nothing is in flight.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="px-3 py-2">Request</th>
                      <th className="px-3 py-2">Plant</th>
                      <th className="px-3 py-2">With</th>
                      <th className="px-3 py-2 text-right">Waiting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {portfolio.stalled.map(({ r, hold }) => (
                      <tr key={r.id} className="hover:bg-[#EBF0FB]/60">
                        <td className="px-3 py-2">
                          <Link href={`/capex/${r.id}`} className="font-semibold text-primary hover:underline">
                            {r.requestNo ?? r.id.slice(0, 8)}
                          </Link>
                          <span className="ml-2 text-slate-600">{r.subject}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-500">
                          {PLANTS.find(p => p.value === r.plant)?.label ?? r.plant ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{PARTY_LABELS[hold.party]}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${hold.days > 7 ? 'text-red-700' : 'text-slate-600'}`}>
                          {fmtDays(hold.days)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </DashboardTabs>
    </div>
  )
}
```

Note: `requestFy` is imported for the FY-scoping contract but only used inside `fyBudgetPosition`. Drop it from the import list if TypeScript flags it unused.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Smoke-test**

`npm run dev` → switch to **Super Admin**. Verify: **My Desk** loads first; a pending proposal appears with its Cr total and links to `/capex/budget-approvals`; the **Portfolio** tab shows one row per field type with distinct FYs (a Green Field FY must never appear on the Brown Field row); the empty-portfolio copy renders on a clean slate.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/AdminDashboard.tsx
git commit -m "feat: administration dashboard — approvals desk + portfolio"
```

---

### Task 12: Maintenance dashboard

**Files:**
- Rewrite: `src/components/dashboards/MaintenanceDashboard.tsx` (replaces the Task 9 stub)

**Interfaces:**
- Consumes: `maintenanceQueues`, `median`, `ageInDays`, `proposalTotalCr`, `BUDGET_PROPOSAL_STATUS_COLORS/LABELS`
- Produces: `MaintenanceDashboard({ now, proposals })`

Scoped to proposals authored by this user. Deliberately **no live-FY vs proposed-FY comparison** — that would mean re-adding `diffProposalAgainstLive` / `summarizeMasterByHead`, removed when the per-head diff came off the approval surfaces (spec §9).

- [ ] **Step 1: Write the component**

Replace `src/components/dashboards/MaintenanceDashboard.tsx`:

```tsx
'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ClipboardList, RotateCcw, Scissors, Timer } from 'lucide-react'
import type { BudgetProposal } from '@/lib/types'
import { ROLE_NAMES } from '@/lib/constants'
import { CARD, PAGE_SHELL, SECTION_GRID } from '@/lib/uiTokens'
import { ageInDays, median } from '@/lib/kpiUtils'
import { maintenanceQueues } from '@/lib/kpiQueues'
import {
  BUDGET_PROPOSAL_STATUS_COLORS, BUDGET_PROPOSAL_STATUS_LABELS, proposalTotalCr,
} from '@/lib/budgetProposalUtils'
import { ActionQueue } from './ActionQueue'
import { KpiTile } from './KpiTile'
import { HBarChart } from './charts'
import { fmtCr, fmtDays } from './format'

const DAY = 86_400_000

export function MaintenanceDashboard({ now, proposals: all }: { now: number; proposals: BudgetProposal[] }) {
  const proposals = useMemo(
    () => all.filter(p => p.createdBy === ROLE_NAMES.maintenance),
    [all],
  )

  const stats = useMemo(() => {
    const published = proposals.filter(p => p.status === 'approved')
    const proposedCr = proposals.reduce((s, p) => s + proposalTotalCr(p), 0)
    const publishedCr = published.reduce((s, p) => s + proposalTotalCr(p), 0)
    const trimCr = proposals.reduce(
      (s, p) => s + (p.edits ?? []).reduce((t, e) => t + (e.totalBeforeCr - e.totalAfterCr), 0),
      0,
    )
    const turnarounds = published
      .map(p => (p.submittedAt && p.accountsDecidedAt
        ? (new Date(p.accountsDecidedAt).getTime() - new Date(p.submittedAt).getTime()) / DAY
        : null))
      .filter((d): d is number => d != null && d >= 0)

    // Head composition of the most recent target FY the author is working on.
    const latest = [...proposals].sort((a, b) =>
      (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))[0]
    const byHead = new Map<string, number>()
    for (const item of latest?.items ?? []) {
      byHead.set(item.head, (byHead.get(item.head) ?? 0) + item.totalCost)
    }

    return {
      proposedCr, publishedCr, trimCr,
      turnaround: median(turnarounds),
      turnaroundSample: turnarounds.length,
      resubmits: proposals.reduce((s, p) => s + (p.resubmitCount ?? 0), 0),
      latest,
      headBars: [...byHead.entries()].map(([label, value]) => ({ label, value: Number(value.toFixed(2)) })),
    }
  }, [proposals])

  const bands = useMemo(() => maintenanceQueues(proposals, now), [proposals, now])

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <header className="shrink-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Budget Planning Dashboard</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Your next-FY proposals — what needs your rework, where each one sits, and what approvers changed.
        </p>
      </header>

      <div className={`grid grid-cols-2 lg:grid-cols-4 ${SECTION_GRID} shrink-0`}>
        <KpiTile
          label="Proposed" value={fmtCr(stats.proposedCr)} icon={ClipboardList}
          sub={`${proposals.length} proposal(s)`} href="/capex/budget-proposals"
        />
        <KpiTile
          label="Published live" value={fmtCr(stats.publishedCr)} icon={ClipboardList}
          tone={stats.publishedCr > 0 ? 'good' : 'neutral'} sub="approved and live on master"
        />
        <KpiTile
          label="Trimmed by approvers" value={fmtCr(stats.trimCr)} icon={Scissors}
          tone={stats.trimCr > 0 ? 'warn' : 'neutral'} caption="edits made while sending forward"
        />
        <KpiTile
          label="Approval turnaround" value={fmtDays(stats.turnaround)} icon={Timer}
          sub={`median over ${stats.turnaroundSample} published`}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
          <ActionQueue
            title="Needs you" variant="mine" buckets={bands.mine}
            emptyText="Nothing needs your rework."
          />
          <ActionQueue
            title="With approvers" variant="waiting" buckets={bands.waiting}
            emptyText="Nothing is in approval."
          />
        </div>

        <div className={`grid grid-cols-1 lg:grid-cols-2 ${SECTION_GRID}`}>
          <section className={CARD}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              {stats.latest ? `FY ${stats.latest.targetFy} composition by head` : 'Composition by head'}
            </p>
            <HBarChart data={stats.headBars} emptyText="No lines authored yet." />
          </section>

          <section className={CARD}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Rework</p>
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {stats.resubmits} resubmission(s)
              </span>
            </div>
            {proposals.length === 0 ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-slate-400">You have not authored a budget yet.</p>
                <Link href="/capex/budget-proposals" className="text-xs font-semibold text-primary hover:underline">
                  Start next year&rsquo;s budget →
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-3 py-2">Target FY</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2 text-right">Age</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {proposals.map(p => (
                    <tr key={p.id} className="hover:bg-[#EBF0FB]/60">
                      <td className="px-3 py-2 font-semibold text-slate-800">{p.targetFy || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCr(proposalTotalCr(p))}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[p.status]}`}>
                          {BUDGET_PROPOSAL_STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {fmtDays(ageInDays(p.submittedAt ?? p.createdAt, now))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean — no stubs remain.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 4: Smoke-test**

`npm run dev` → switch to **Maintenance**. Verify: the dashboard shows only proposals authored by Sunil Verma; a `needs_correction` proposal appears under "Needs you"; the empty state links to Budget Planning.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboards/MaintenanceDashboard.tsx
git commit -m "feat: maintenance budget-planning dashboard"
```

---

### Task 13: Documentation + full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/USER_STORY.md`, `docs/SCOPE.md:68-70`

- [ ] **Step 1: Update `CLAUDE.md`**

In the **Key files** table, add these rows (keep the existing rows and ordering style):

```markdown
| `src/lib/kpiUtils.ts` | Dashboard KPI primitives — SLA constants, aging, stage durations from `statusHistory`, canonical `requestValue` (with its `ValueBasis`), savings, `ballHolders` |
| `src/lib/kpiPortfolio.ts` | `fyBudgetPosition` (field-type scoped), `headPositions` (adhoc-override aware), `valueFunnel`, and the FY attribution rule |
| `src/lib/kpiRisk.ts` | Aggregate delay-liability exposure (`computeTat` across tracks) + vendor scorecard |
| `src/lib/kpiQueues.ts` | The ① "my turn" / ② "waiting on" buckets per role, with SLA breach flags |
| `src/components/dashboards/` | Role dashboards (Buyer / Sourcing / Admin / Maintenance) + shared tile, action queue, tab shell, charts |
```

Then add a new section after **Workflow overhaul (2026-07)**:

```markdown
### Role dashboards (2026-08)

`/capex/dashboard` is a **role resolver** — it reads `capex_role`, subscribes to `capex_rolechange`,
and renders one of four dashboards from `src/components/dashboards/`. All metric logic lives in the
pure `src/lib/kpi*.ts` layer (no React, no I/O, **`now` always injected**), which is the only part
of this codebase with unit tests (`npm test`, vitest, lib only — `src/lib` has no `@/` aliases, so
it needs no config).

Every dashboard renders three bands: **① my turn → ② waiting on → ③ outcomes**. Sourcing
(`Desk | Performance`) and super_admin (`My Desk | Portfolio`) are tabbed, with the active tab in
`?view=`; buyer and maintenance are single-page.

Key invariants:
- **`requestValue(request, reqInvites, index)` is the single source of a request's money figure**,
  returning a `ValueBasis` (`awarded` → `approved` → `quoted` → `estimated` → `allocated` → `none`)
  that is always rendered as a caption. Never inline a different fallback chain.
- **FY attribution:** a request belongs to the FY of its linked master rows, else the live FY of its
  **own field type** (`getLatestMasterFyForField`). Field types are never mixed — the old dashboard
  compared a Green Field FY allocation against Brown Field commitments.
- **Savings only exist once a request is `awarded`/`approved`** (`savingsForRequest` returns `null`
  otherwise). Split-award negotiation savings restrict both sides to `awardedItemIds` via
  `linePrices` and exclude freight/packing/service, matching `buildAwardGroups`' basis.
- **Head-level figures use `usedAmountByMasterItemId` + `effectiveHeadAllocationCr`**, the same
  source `/capex/master` uses, so the two screens can never disagree. Labelled "committed (est.)".
- **`SLA_DAYS` in `kpiUtils.ts` are placeholders**, not measured SLAs — one const to change.
- **No time-series.** Only current state is stored; elapsed metrics work via `statusHistory`, trends
  would need snapshotting and are out of scope.
```

- [ ] **Step 2: Update `docs/SCOPE.md`**

Replace §4.2 (`docs/SCOPE.md:68-70`) — the current text reads "Summary KPI cards: total requests, total budget, active sourcing count" — with a description of the four role dashboards, the three-band anatomy, the tabbed Sourcing/Administration surfaces, and the "no time-series" limitation.

- [ ] **Step 3: Update `docs/USER_STORY.md`**

Append four user stories in the file's existing numbering and checkbox style — one per role — each stating the ① / ② / ③ bands that role gets, and noting that the plant head, Plant Accounts, Global Accounts and Technical team get no dashboard because they have no portal login.

- [ ] **Step 4: Run the full gate**

```bash
npm test
npx tsc --noEmit
npm run build
```
Expected: all green. Do **not** run `npm run lint` — it is broken in this Next 16 + ESLint 9 setup.

- [ ] **Step 5: Full role smoke-test**

`npm run dev`, then walk every role via the top-nav switcher and confirm each item:

| Check | Expectation |
|---|---|
| Clean slate | Every band renders purposeful empty copy with a CTA — never a bare "—" |
| Buyer · Jhajjar P1 → P2 | Data swaps on role change with no reload; each sees only their own requests, and only their own plant |
| Sourcing | Desk is default; every tile's number equals the row count it expands to |
| Sourcing | An overdue vendor bucket shows the red "overdue" badge **and** the day count (colour is never the only signal) |
| Administration | `?view=desk` ↔ `?view=portfolio` toggles; Back does not step through tab changes; arrow keys move between tabs |
| Administration | One portfolio row per field type, each with its own FY |
| Split award | A split-award request contributes **one row per award** in every "waiting on" band and in the accounts-facing counts |
| Maintenance | Only proposals authored by Sunil Verma appear |
| Foreign vendor | A USD quote is counted at its INR value, not face value |

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/SCOPE.md docs/USER_STORY.md
git commit -m "docs: role dashboards + KPI layer conventions"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: §2 defects → D1/D2 (Task 2 `requestValue` + Task 9 status handling), D3 (Task 3), D4 (Task 8 charts), D5/D6 (Task 5 scoping), D7 (`toInr` throughout Tasks 2-3), D8 (Task 9 resolver scoping), D9 (award-awareness in Tasks 2, 4, 6). §4.1-4.7 → Tasks 1-7. §5 → Task 8. §6 → Task 9. §7 → Task 10. §8 → Task 11. §9 → Task 12. §10 rules are in Global Constraints. §11 (no data-model impact) is enforced by the constraint that no context or type file appears in any task's Files list. §12 limitations are documented in Task 13. §13/§14 → Task 13.

**Deliberate refinements to the spec**, each called out at its task:
1. `kpiUtils.ts` split into four files (File Structure).
2. `savingsForRequest` returns two comparability flags rather than one (Task 3).
3. `medianStageDays` needs no `now` (Task 1).
4. `pending_accounts` appears once, in the admin band only (Task 7).
5. Queue buckets carry their rows and expand inline instead of linking to routes that do not exist (Task 7).

**Placeholder scan.** No TBDs. Every code step carries the real implementation; every verification step names the command and the expected result. The two "drop the import if unused" notes are concrete instructions, not deferrals.

**Type consistency.** `requestValue` / `savingsForRequest` / `ballHolders` take `(entity, reqInvites, …)` — the already-scoped array from `invitesByRequest`, never the global list — consistently across Tasks 2, 3, 4, 5, 6, 10 and 11. `QueueBucket.items` is used by `ActionQueue` (Task 8) exactly as `buildBucket` produces it (Task 7). `MasterIndex` is produced by `masterIndex` (Task 2) and consumed by name in Tasks 3, 5, 6, 9, 10, 11. `Tone` values (`neutral`/`good`/`warn`/`danger`) match between `KpiTile` (Task 8) and every caller.

