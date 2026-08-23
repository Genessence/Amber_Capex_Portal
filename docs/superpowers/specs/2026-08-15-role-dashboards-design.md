# Role-Specific Dashboards & KPIs — Design Spec
**Date:** 2026-08-15

## Overview

Replace the single shared dashboard at `/capex/dashboard` with four role-resolved dashboards
(Buyer, Sourcing, Administration, Maintenance) backed by one pure derivation layer,
`src/lib/kpiUtils.ts`.

Every dashboard follows the same three-band anatomy:

> **① My turn** (what is blocked on me) → **② Waiting on** (who else holds the ball, and for how
> long) → **③ Outcomes** (money, time, quality).

The portal's participants are half off-portal — plant head, Plant Accounts, Global Accounts
("Satish"), the Technical team and vendors all act on tokenised public links. Nothing in the app
currently answers "am I the blocker?" or "how long has the Technical team had this?". That question
is the product of this work; the money KPIs are secondary to it.

**Goals**
- A dashboard that is a work surface, not a report. Every tile clicks through to its rows.
- Correct numbers. The existing dashboard's metrics are stale (§2) and must be rebuilt, not extended.
- Zero new persisted state. Every KPI derives from data already in `capex_data_v2` + IndexedDB.

**Non-goals**
- Dashboards for plant head, Plant Accounts, Global Accounts, or the Technical team. They have no
  portal login by design.
- Time-series / trend charts. The app stores only current state; `statusHistory` supports *elapsed*
  metrics (cycle time) but nothing supports "utilisation over the last 6 months". See §12.
- Any new role, status, or schema field.

---

## 1. Roles in scope

| Role | Dashboard | Layout |
|---|---|---|
| `buyer`, `buyer_jhajjar_p1`, `buyer_jhajjar_p2` | Buyer | Single page |
| `sourcing_member` | Sourcing | Two tabs — **Desk** \| **Performance** |
| `super_admin` | Administration | Two tabs — **My Desk** \| **Portfolio** |
| `maintenance` | Maintenance (budget author) | Single page |

Sourcing and Administration are the deep treatments (§7, §8). Buyer and Maintenance fit on one page.

---

## 2. Defects in the current dashboard

These are corrected as part of this work. Left alone, the new dashboards inherit them.

| # | Defect | Location | Effect |
|---|---|---|---|
| D1 | "Completed" counts `buyer_approved`, a legacy status new requests never reach | `dashboard/page.tsx:186` | Completed count is permanently 0 |
| D2 | "Active" excludes `buyer_approved`/`rejected`/`draft` but **not** `completed` | `:185` | Finished requests read as in-progress forever |
| D3 | Savings reads only `invite.quotes[]` on `buyer_approved` requests | `:197-206` | Misses every RFQ award (those carry `rfqQuote`) and every split award; Negotiated Savings is structurally ₹0 |
| D4 | Donut's `ORDERED_STATUSES` omits `pi_requested → completed` | `:168-171` | Most live requests are absent from "Requests by Status" |
| D5 | `committedCr` sums `requests`, not `filtered` | `:297` | The plant filter silently does not apply to the budget strip |
| D6 | `currentFy` chosen across all field types; `fyItems` unscoped by plant | `:290-293` | A Green Field FY's allocation is compared against Brown Field commitments |
| D7 | No `toInr()` anywhere | throughout | Foreign-vendor quotes counted at face value |
| D8 | No role or plant scoping (`:174-176` reads only `useCapex()`) | whole page | A `buyer_jhajjar_p2` sees every plant and every requester's work |
| D9 | Request-level only | whole page | Split-award reverse auctions (multiple fulfilment tracks per request) are invisible |

---

## 3. Architecture

```
src/lib/kpiUtils.ts                            ← all derivations; pure, no React, no I/O
src/components/dashboards/
  DashboardTabs.tsx                            ← tab shell, state in ?view=
  KpiTile.tsx                                  ← value + sub + tone + optional href
  ActionQueue.tsx                              ← the ① / ② bands
  BuyerDashboard.tsx
  SourcingDashboard.tsx                        ← Desk | Performance
  AdminDashboard.tsx                           ← My Desk | Portfolio
  MaintenanceDashboard.tsx
src/app/(internal)/capex/dashboard/page.tsx    ← role resolver only
```

**Role resolution.** `page.tsx` reads `capex_role` from `localStorage` on mount and subscribes to the
`capex_rolechange` CustomEvent, matching `Sidebar.tsx`/`requests/page.tsx`. It renders exactly one
dashboard component. Unknown roles fall back to the Buyer dashboard. The page is wrapped in
`<Suspense>` because the tab shell reads `useSearchParams` (same pattern as
`capex/requests/page.tsx:323-329`).

**Why one route.** The sidebar already points every role at a single `/capex/dashboard` href
(`Sidebar.tsx:54`), the role switcher is a live event with no navigation, and the sidebar is already
ten items deep. Adding per-role routes would mean role-conditional `NAV` entries plus a guard on each
route for no user-visible gain.

**`now` injection.** Aging and TAT are time-dependent. The dashboard holds a single `now` in state,
refreshed on a 60s interval (matching `TatBanner`), and passes it into every `kpiUtils` call. No
helper reads the clock itself, so all of `kpiUtils` stays pure and directly testable.

---

## 4. `kpiUtils.ts` — the derivation layer

All money is INR unless the name says `Cr`. All conversion goes through `toInr` from
`currencyUtils.ts`.

### 4.1 Time

```ts
ageInDays(iso: string, now: number): number
oldestAgeDays(isos: (string | undefined)[], now: number): number | null

stageDurations(request, now): Array<{ status: CapexStatus; from: string; ms: number; open: boolean }>
medianStageDays(requests, from: CapexStatus, to: CapexStatus, now)
  : { medianDays: number | null; sampled: number; stillOpen: number }
```

`stageDurations` reads `request.statusHistory`, falling back to a synthetic
`[{ status, actor: createdBy, at: createdAt }]` when absent (legacy records —
`addRequest` has seeded real history since `capexContext.tsx:956-962`). Entry *i* lasts until entry
*i+1*; the last entry lasts until `now` and is flagged `open` unless its status is `completed` or
`rejected`.

`medianStageDays` includes only requests that actually reached `to`, and returns `stillOpen` so the
UI can say *"median 6.2d over 14 completed · 9 still open"*. Survivorship is disclosed, never hidden.

### 4.2 Value — one canonical function

```ts
type ValueBasis = 'awarded' | 'approved' | 'quoted' | 'estimated' | 'allocated' | 'none'
requestValue(request, invites, capexMaster): { inr: number; basis: ValueBasis }
```

First match wins:

| Order | Condition | Value | Basis |
|---|---|---|---|
| 1 | `isAwardBased(invites)` | Σ `awardAmount` over `awardedInvites` | `awarded` |
| 2 | `request.finalVendorId` set, that invite has `rfqQuote` | `inrRfqTotal(rfqQuote, lineItems)` | `awarded` |
| 3 | any invite `effectiveRfqStatus === 'approved'` | that invite's `inrRfqTotal` | `approved` |
| 4 | any invite carries a quote | lowest of `inrRfqTotal` / `inrQuoteGrandTotal` across invites | `quoted` |
| 5 | `request.budget` present | `request.budget` | `estimated` |
| 6 | linked master rows exist | `allocatedForRequest` | `allocated` |
| 7 | otherwise | `0` | `none` |

The basis is rendered next to the figure (a small caption: *awarded / quoted / estimated*). A number
whose provenance is invisible is worse than no number.

```ts
allocatedForRequest(request, capexMaster): number
```
Σ over `request.lineItems` of the linked `CapexMasterItem.totalCost × 1_00_00_000` (master
`totalCost` is in Cr), falling back to `request.masterItemId` when there are no line items.

### 4.3 Savings

```ts
savingsForRequest(request, invites, capexMaster)
  : { negotiation: number; budget: number; comparable: boolean } | null
```

Returns `null` unless `requestValue().basis` is `awarded` or `approved` — a live quote is not a
saving, and reporting it as one would inflate every number on the page.

**Negotiation savings** = first offer − final, on a like-for-like basis:

- *Award-based (RFQ split award or auction).* Per awarded invite, restrict both sides to that
  vendor's `awardedItemIds`:
  `firstOfferForItems(firstQuote, awardedItemIds, lineItems)` = Σ `linePrices[id] × qty` + item-wise
  GST, versus `invite.awardAmount` (which `buildAwardGroups` computes on exactly that basis).
  Freight / packing / service are **excluded from both sides** — they are whole-quote charges that
  cannot be attributed to a subset of lines. Documented in the tile caption.
- *Single-vendor RFQ.* Whole-quote basis: `inrRfqTotal(firstSupplierQuote)` versus
  `inrRfqTotal(approved rfqQuote)`. Footer charges included on both sides.
- *First offer source.* RFQ: the earliest `rfqThread` entry with `by === 'supplier'` carrying a
  `quote`. Auction: `invite.openingQuote` (the seeded RFQ bid — `quotes[]` is overwritten in place by
  `submitQuote` and only ever holds the current bid). If neither exists, negotiation savings is `0`
  and `comparable` is `false`.

**Budget savings** = `allocatedForRequest − requestValue().inr`, computed only when the allocation is
> 0. Where a request has no master link, it falls back to `request.budget`; where it has neither,
budget savings is `0` with `comparable: false`.

Aggregate tiles show `comparable` counts (*"across 12 awards · 2 not comparable"*) rather than
silently dropping rows.

### 4.4 Ball holder

```ts
type Party = 'buyer' | 'sourcing' | 'plant_head' | 'vendor' | 'technical'
           | 'plant_accounts' | 'global_accounts' | 'none'
ballHolder(request, invites, now): { party: Party; since: string; days: number }[]
```

One entry for a single-vendor request; one per award for award-based requests. First match wins:

| Request / award state | Holder |
|---|---|
| `draft` | `buyer` |
| `pending_head_approval` | `plant_head` |
| pre-award, any invite `rfqStatus === 'pending_sourcing'`, INCO `pending_sourcing`, or techSpec `needs_revision` | `sourcing` |
| pre-award, any invite `awaiting_quote` / `pending_vendor` | `vendor` |
| pre-award, any invite techSpec `pending_technical` | `technical` |
| pre-award, otherwise | `sourcing` |
| `pi_requested` | `vendor` |
| `pi_submitted` | `plant_accounts` |
| `accounts_processing` | `global_accounts` |
| `payment_in_progress`, trial `pending_upload` | `vendor` |
| `payment_in_progress`, trial `pending_review` | `sourcing` |
| `payment_in_progress`, otherwise | `plant_accounts` |
| `completed` / `rejected` | `none` |

`since` is the `at` of the most recent `statusHistory` entry (or the relevant invite timestamp —
`invitedAt`, `techSpec.sentAt`, `piSubmittedAt`) for that state.

### 4.5 Portfolio position

```ts
fyBudgetPosition(capexMaster, requests, invites, scope: { fieldType; plant?; fy })
  : { allocatedInr; committedInr; awardedInr; paidInr; remainingInr; utilisationPct }
```

- **allocated** — Σ `totalCost × 1_00_00_000` over master rows matching `fieldType` + `fy` (+ `plant`).
- **committed** — Σ `requestValue().inr` over requests in scope that are not `draft` and not
  `rejected`.
- **awarded** — the same sum restricted to `basis === 'awarded'`.
- **paid** — Σ `totalPaid(milestones)` across each request's awards, or the request-level milestones
  when not award-based.
- **remaining** = allocated − committed. **utilisation** = committed ÷ allocated.

**FY attribution rule (resolves D6).** A request belongs to the FY of its linked master rows; when it
has no master link it belongs to the current live FY for its own `fieldType`
(`getLatestMasterFyForField`). A request is only ever counted under its own field type. This is the
single rule for every scoped aggregate on the page.

```ts
headPositions(capexMaster, requests, scope): Array<{
  head; allocatedCr; committedCr; remainingCr; over: boolean
}>
```
Allocation comes from `effectiveHeadAllocationCr` (`adhocBudgetUtils.ts`), so approved adhoc
transfers are respected. `over` drives the red treatment and feeds the Administration
over-allocation exposure tile.

### 4.6 Fulfilment risk

```ts
delayLiabilityExposure(requests, invites, now)
  : { runningInr: number; runningCount: number; realisedInr: number; pastGraceCount: number }
```
Σ `computeTat({ piSubmittedAt, vendorAmount, tatStoppedAt, now }).deductionAmount` per fulfilment
track (per award when award-based). `running` = clock still going (exposure); `realised` = stopped
tracks that accrued a deduction.

```ts
vendorScorecard(vendors, invites, requests, now): Array<{
  vendorId; invited; quoted; responseRatePct; medianResponseDays;
  awards; awardedInr; delayAccruedInr
}>
```
`medianResponseDays` = median of (first supplier `rfqThread` entry − `invitedAt`).

### 4.7 Queues

```ts
interface QueueBucket { key; label; count; oldestDays: number | null; breached: boolean; href }
sourcingQueues(requests, invites, now): { mine: QueueBucket[]; waiting: QueueBucket[] }
adminQueues(requests, invites, budgetProposals, adhocBudgetRequests, now): { mine; waiting }
buyerQueues(requests, invites, currentUser, plant, now): { mine; waiting }
maintenanceQueues(budgetProposals, currentUser, now): { mine; waiting }
```

`breached` = `oldestDays > SLA_DAYS[key]`.

```ts
export const SLA_DAYS = {
  vendorQuote: 5, techSpec: 3, plantHead: 3, adminApproval: 3,
  accounts: 3, vendorPi: 3, trialReview: 2,
} as const
```

These are placeholders chosen to be plausible, not measured. They live in one exported const so a
real SLA policy is a one-line change.

---

## 5. Shared UI primitives

**`KpiTile`** — `{ label, value, sub?, caption?, tone, icon, href?, ariaLabel? }`. Built on
`CARD_TIGHT` with the existing left accent bar, preserving today's visual language.
`tone: 'neutral' | 'good' | 'warn' | 'danger'` maps to slate / emerald / amber / red per the
CLAUDE.md colour rules — grayscale-and-blue chrome, **emerald for savings and under-budget, red for
over-budget and SLA breach**. When `href` is set the whole tile is a link with a descriptive
`aria-label`; tone is never the only carrier of meaning (a breached bucket also reads "11d").

**`ActionQueue`** — renders a `QueueBucket[]` as a labelled list: count, oldest-age badge, and a link
into the filtered destination. Two variants, `mine` (blue accent, imperative labels) and `waiting`
(slate accent, "waiting N days on X"). Empty state per band, e.g. *"Nothing is waiting on you."*

**`DashboardTabs`** — `{ tabs: {key,label}[], children }`. Active tab in `?view=`, written with
`router.replace` so tab changes do not stack history entries. `role="tablist"` with left/right arrow
navigation and `aria-selected`. Default tab is the **first** one (Desk), because the action queue is
the point.

**Charts.** The existing `DonutChart` / `HBarChart` / `SavingsBreakdown` are lifted out of
`dashboard/page.tsx` into `src/components/dashboards/charts.tsx` unchanged in behaviour, except the
donut is fed the full `CAPEX_STATUS_FLOW` (fixes D4).

**Empty states.** The portal ships on a clean slate (`mockRequests`/`mockInvites` are empty), so the
zero-state *is* the first impression. Every band gets purposeful copy plus the relevant CTA
(Buyer → New Request; Sourcing → Requests; Maintenance → Budget Planning; Admin → Budget Approvals),
never a bare "—".

---

## 6. Buyer dashboard

**Scope.** `createdBy === ROLE_NAMES[role]`; additionally `plant === getPlantForRole(role)` for the
plant-scoped variants (fixes D8). The plant filter chips remain for the unscoped `buyer` role and are
hidden for plant-scoped ones.

**① My turn** — Drafts to submit (`status === 'draft'`) · Awaiting plant head
(`pending_head_approval`; the buyer holds the copy-link/preview-email affordance on
`capex/[id]`, so this genuinely is their move) · Rejected, needs rework.

**② Waiting on** — plant head · sourcing · vendor · accounts, each "N requests · oldest Xd", derived
from `ballHolder`.

**③ KPIs**

| Tile | Definition |
|---|---|
| My requests | Total, with in-flight / completed / rejected split |
| Value in flight | Σ `requestValue` over non-terminal requests, with basis caption |
| Against allocation | Σ `allocatedForRequest` vs value in flight; emerald under, red over |
| Plant-head turnaround | `medianStageDays(pending_head_approval → sourcing)` |
| Request to completion | `medianStageDays(submitted → completed)` |

**Views** — *Where my requests are stuck*: horizontal bars, count per stage with the median age in
that stage, red past `SLA_DAYS`. Then a compact request table with next action and current ball
holder.

---

## 7. Sourcing dashboard (`sourcing_member`) — deep

**Scope.** `assignedTo === 'sourcing_member'`, matching `requests/page.tsx:85`.

### 7.1 Tab — Desk

**① My turn**

| Bucket | Predicate |
|---|---|
| New requests to pick up | `status === 'sourcing'` and no invites for the request |
| Quotes to review | `effectiveRfqStatus(invite) === 'pending_sourcing'` |
| INCO terms to settle | `effectiveIncoTermsStatus(invite) === 'pending_sourcing'` |
| Tech spec to send | pre-award invite with `effectiveTechSpecStatus === 'not_sent'` on a request with an approved quotation |
| Tech spec to revise | `effectiveTechSpecStatus === 'needs_revision'` |
| Ready to award | ≥1 invite passes `canRequestPi` **and** `!techSpecBlocksAward`, and the request is not yet award-based |
| Auction ended, unawarded | `isAuctionExpired(auctionConfig)` and `!isAwardBased(invites)` |
| Trials to review | `effectiveTrialStatus === 'pending_review'` |

**② Waiting on** — vendor quote (`awaiting_quote` / `pending_vendor`, aged from `invitedAt` or the
last sourcing counter) · Technical team (`pending_technical`, from `techSpec.sentAt`) · plant head ·
vendor PI (`pi_requested`) · Plant Accounts (`pi_submitted`) · Satish (`accounts_processing`).

### 7.2 Tab — Performance

| Tile | Definition |
|---|---|
| Negotiation savings | Σ `savingsForRequest().negotiation`, with % of first offer and a not-comparable count |
| Budget savings | Σ `savingsForRequest().budget` vs allocation |
| Auction effectiveness | Σ (`auctionConfig.openingBestPrice` − awarded) over auctioned requests, plus mean % decrement |
| Sourcing cycle time | `medianStageDays(sourcing → pi_requested)`, broken into *days to first quote*, *days in negotiation*, *days in tech-spec gate* |
| Vendor participation | invites sent vs quotes received (%), mean vendors per award |
| Single-quote awards | Count of awards decided with exactly one quoting vendor — a governance flag, shown in `warn` tone |
| Spend concentration | Top vendors by awarded INR with share % |
| Delay-liability exposure | `delayLiabilityExposure().runningInr` + `pastGraceCount` |
| Commitments | PO issued / paid / outstanding, from `purchaseOrder` + `totalPaid` / `totalOutstanding` |

**Views** — *Live negotiation board* (per request: vendors, best price, whose turn, gap to lowest) ·
*Auction watch* (`isAuctionActive`, countdown via `formatAuctionCountdown`, `computeAuctionBestPrice`,
bidder count) · *Vendor scorecard* table from `vendorScorecard`.

---

## 8. Administration dashboard (`super_admin`) — deep

Two tabs at `/capex/dashboard?view=desk|portfolio`, defaulting to **My Desk**. Deciding still happens
on `/capex/budget-approvals` and `/capex/adhoc-budget`; the desk is a summary that links into them.

### 8.1 Tab — My Desk

**① My turn**

| Bucket | Predicate | Shows |
|---|---|---|
| Budget proposals to decide | `BudgetProposal.status === 'pending_admin'` | count · Σ Cr · oldest age |
| Adhoc transfers to decide | `AdhocBudgetRequest.status === 'pending_admin'` | count · Σ Cr · oldest age |
| Awaiting Global Accounts link | `status === 'pending_accounts'` | count · Σ Cr · age since `adminDecidedAt` — the admin shares/chases the sign-off link |
| Stuck at plant head | `pending_head_approval` older than `SLA_DAYS.plantHead` | count · oldest age |

**② Waiting on** — plant head (proposals `pending_plant_head`) · Global Accounts
(`pending_accounts`) · the sourcing team (requests idle in `sourcing` past SLA).

**View** — a unified approval queue table (proposals + adhoc in one list: type, plant, FY, ₹ Cr, age,
Review link).

### 8.2 Tab — Portfolio

| Tile / view | Definition |
|---|---|
| FY budget position **per field type** | `fyBudgetPosition` for each of Brown Field / Green Field / Digitisation / IT — Allocated, Committed, Awarded, Paid, Remaining, utilisation %. Fixes D6 |
| Utilisation by plant | Bars, committed ÷ allocated, red > 90% |
| Over-allocation exposure | Σ (committed − allocated) over heads where `over`, plus breached-head count, from `headPositions` |
| Value funnel | Requested → Approved → Awarded → PO issued → Paid, in ₹ with conversion % between stages |
| Approval pipeline health | Proposals by stage (plant head / admin / accounts) with Σ Cr and median age per stage; end-to-end median from `submittedAt` to `accountsDecidedAt` |
| Approver edit impact | Σ (`totalBeforeCr − totalAfterCr`) across `BudgetProposal.edits`, plus resubmit rate from `resubmitCount` — does the approval chain change anything? |
| Cycle time by stage | `medianStageDays` across every adjacent pair in `CAPEX_STATUS_FLOW`, worst stage flagged |
| Rejection analysis | Rejection rate by stage and by field type |
| Risk strip | Single-quote awards · foreign-vendor awards with INCO unsettled (`incoTermsBlocksAward`) · payments released while a required trial is unapproved (`finalPaymentBlockedByTrial`) · awards whose `techSpec.status !== 'approved'` |
| Delay liability, org-wide | `delayLiabilityExposure` across all tracks |
| Stalled top-10 | Oldest live requests with ball holder and days waiting |

---

## 9. Maintenance dashboard (`maintenance`)

The budget author, not a requester — consistent with `requests/page.tsx:79`, which already swaps
their Requests page for budget proposals.

**Scope.** `BudgetProposal.createdBy === ROLE_NAMES.maintenance`.

**① My turn** — Drafts to submit · Sent back for correction (`needs_correction`, with the
`correctionNote`) · Rejected.

**② Waiting on** — plant head / admin / Global Accounts, with age per stage.

**③ KPIs** — Proposals by stage with Σ Cr · **Proposed Cr vs published Cr** for the target FY and the
Δ approvers trimmed (from `edits`) · median approval turnaround · resubmit rate.

**View** — my proposals table (target FY, plant, category, ₹ Cr, stage, age, approver remark) and
target-FY composition by head.

**Deliberately excluded:** a live-FY vs proposed-FY comparison. That would mean re-adding
`diffProposalAgainstLive` / `summarizeMasterByHead`, removed when the per-head diff was taken off the
approval surfaces. Reopening that is a separate decision.

---

## 10. Cross-cutting rules

1. **INR basis everywhere.** Every cross-vendor or portfolio total goes through `toInr`; the original
   currency is shown beneath where a single foreign quote is displayed (fixes D7).
2. **Award-aware everywhere.** Any per-request aggregate iterates `awardedInvites` when
   `isAwardBased`, matching `accounts/queue/page.tsx:59-76` (fixes D9).
3. **Click-through mandatory.** Every tile and queue row links to its rows — an existing filtered
   route where one exists (`/capex/requests?filter=…`, `/capex/budget-approvals`,
   `/accounts/queue`, `/capex/[id]`).
4. **Density.** `PAGE_SHELL`, `SECTION_GAP`, `CARD` / `CARD_TIGHT`, `TD_CELL` from `uiTokens.ts`.
   Header + tabs + band ① stay above the fold; the rest scrolls in a `flex-1 min-h-0 overflow-y-auto`
   wrapper, per the layout conventions.
5. **Accessibility (WCAG AA).** Tiles are links with descriptive labels; charts keep text
   alternatives; the tablist is arrow-key navigable; colour is never the sole signal; interactive
   targets ≥44px.
6. **Honest zeroes.** A metric with no qualifying rows renders `0` with an explanatory caption, never
   a fabricated or hidden value. Aggregates that exclude rows disclose the excluded count.

---

## 11. Data model impact

**None.** No new types, statuses, roles, context mutations, or persisted keys. `kpiUtils` is a pure
read layer over `requests`, `invites`, `vendors`, `capexMaster`, `budgetProposals`,
`adhocBudgetRequests` and `brownFieldHeadAllocations` as already exposed by `CapexProvider`. No
migration, and in-flight data works with no backfill.

---

## 12. Known limitations

- **No time-series.** All KPIs are point-in-time derivations of current state. Elapsed metrics
  (cycle time, aging, TAT) work because `statusHistory` and the timestamps are retained; trend lines
  ("utilisation month over month") would require snapshotting, which is out of scope.
- **SLA thresholds are assumed**, not measured (§4.7).
- **Negotiation savings on split awards excludes footer charges** on both sides (§4.3) — necessary
  for a like-for-like comparison, and captioned on the tile.
- **`medianStageDays` is survivorship-limited** by construction; the `stillOpen` count is always
  displayed alongside.

---

## 13. Files changed

| File | Change |
|---|---|
| `src/lib/kpiUtils.ts` | **New** — the whole derivation layer (§4) |
| `src/components/dashboards/KpiTile.tsx` | **New** |
| `src/components/dashboards/ActionQueue.tsx` | **New** |
| `src/components/dashboards/DashboardTabs.tsx` | **New** |
| `src/components/dashboards/charts.tsx` | **New** — `DonutChart` / `HBarChart` / `SavingsBreakdown` lifted from the current page |
| `src/components/dashboards/BuyerDashboard.tsx` | **New** (§6) |
| `src/components/dashboards/SourcingDashboard.tsx` | **New** (§7) |
| `src/components/dashboards/AdminDashboard.tsx` | **New** (§8) |
| `src/components/dashboards/MaintenanceDashboard.tsx` | **New** (§9) |
| `src/app/(internal)/capex/dashboard/page.tsx` | Rewritten as a role resolver; all metric logic removed |
| `CLAUDE.md` | Document the dashboard layer, `kpiUtils`, and the per-role surfaces |
| `docs/USER_STORY.md` | New user stories for the four dashboards |
| `docs/SCOPE.md` | Replace §4.2 "Dashboard" with the role-specific description |

---

## 14. Verification

There is no test suite. The gate, in order:

1. `npx tsc --noEmit` — catches missing status/role map keys.
2. `npm run build` — confirms the route compiles.
3. Smoke-test each role via the `TopNav` switcher on a seeded dataset: buyer (both plant-scoped
   variants), `sourcing_member`, `maintenance`, `super_admin` (both tabs), verifying that
   (a) every tile's number matches the list it links to, (b) plant-scoped buyers see only their
   plant, (c) the clean-slate zero-state renders on every band, and (d) a split-award request
   contributes one row per award wherever awards are counted.
