# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev                    # start dev server (Next.js 16 / Turbopack, port 3000)
npm run build                  # production build — runs TypeScript checking + Next.js build
npm run start                  # serve the production build
npx tsc --noEmit               # type-check only (the real verification gate — see below)
npm run generate:brownfield-seed  # regen Brown Field FY 2026-27 seed (python3 scripts/generate_brownfield_seed.py)
```

**Verification:** there is **no test suite**. `npm run lint` (`next lint`) is **broken** in this Next 16 + ESLint 9 setup (it errors on an invalid directory arg / missing flat config) — do **not** rely on it. Use `npx tsc --noEmit` as the gate (it catches missing `ALLOWED_TRANSITIONS`/status-map keys, etc.), then `npm run build` to confirm routes compile, then smoke-test by switching roles in the running app.

## Architecture

**Capex Amber** is a Next.js 16 app (App Router, TypeScript, Tailwind v4) for Amber Enterprises' CAPEX procurement workflow. Entirely client-side — no backend, no database. All state lives in `CapexProvider` and is persisted to `localStorage` under the key `capex_data_v2`. **Large base64 file blobs** (Proforma Invoices, quote/line-item/land attachments) are kept OUT of the localStorage payload and stored in **IndexedDB** (`src/lib/fileStore.ts`) so the workflow state always fits the ~5 MB quota and never fails to persist; the provider strips base64 on write (`stripRequestFiles`/`stripInviteFiles`) and async-hydrates it back on load (`hydrateRequestFiles`/`hydrateInviteFiles`). This is self-migrating — older inline-base64 localStorage data shrinks on the next write.

### Route groups

| Group | Path prefix | Purpose |
|-------|-------------|---------|
| `(internal)` | `/capex/*`, `/sourcing/*`, `/accounts/*`, `/settings` | Authenticated internal portal — wraps `CapexProvider` + `LoginGate` + `Sidebar` + `TopNav`; `/settings` guarded to `super_admin`; `/capex/master` + `/capex/budget-proposals` (Budget Planning) open to plant_head variants, sourcing, maintenance, super_admin; `/capex/budget-approvals` guarded to `super_admin`; `/capex/adhoc-budget` to sourcing + plant_head + super_admin; `/accounts/queue` to `accounts` + `plant_accounts` + super_admin |
| `(public)` | `/supplier/[token]` | Tokenised supplier portal — wraps `CapexProvider` only, no auth |
| *(root)* | `/login` | Role-picker login screen |

`/` redirects to `/login` via `next/navigation`'s `redirect()`.

### Auth model

Mock-only. `LoginPage` writes the selected role to `localStorage("capex_role")`. `LoginGate` redirects to `/login` if absent. `TopNav` exposes a role-switcher dropdown that writes the same key and fires a `capex_rolechange` CustomEvent. All role-aware components listen to that event.

Roles: `buyer`, `buyer_jhajjar_p1`, `buyer_jhajjar_p2`, `sourcing_member`, `plant_head`, `plant_head_jhajjar_p1`, `plant_head_jhajjar_p2`, `sourcing_head`, `maintenance`, `plant_accounts`, `accounts`, `super_admin`.

`maintenance` (authors next-FY Brown Field budget proposals), `plant_accounts` (**Plant Accounts** — assigns FA codes), and `accounts` (**Global Accounts** — PO number + upload PO + payment milestones) are **global** (not plant-scoped). They are registered in the same places as other roles (`ROLE_NAMES`, `Sidebar.ROLE_META` + `NAV`, `TopNav.ROLE_GROUPS`, `login` `ROLES`). The accounts step is split: **Plant Accounts** assigns FA codes then submits; **Global Accounts** assigns the PO number, uploads the PO document (vendor is notified + downloads it from the supplier portal), then records payments.

Plant-scoped roles (`buyer_jhajjar_*`, `plant_head_jhajjar_*`) filter data to their plant. `ROLE_PLANT` in `constants.ts` maps these roles to their plant value; roles absent from the map have access to all plants.

### Status flow

```
draft → submitted → pending_head_approval → sourcing → pi_requested
      ↘ (Green Field) → sourcing
                                                       ↘ rejected (at any stage from pending_head_approval onward)

Brown Field fulfillment chain (RFQ and reverse-auction paths converge identically):
  sourcing ─(RFQ: vendor approves price + docs)──────────────┐
  sourcing ─(auction: ends → sourcing finalizes L1 → req PI)─┤
                                                              ▼
  pi_requested → pi_submitted → accounts_processing → payment_in_progress → completed

(legacy only: negotiation → sourcing_approved → buyer_approved; new auctions skip these)
```

After `sourcing`, a Brown Field request is **RFQ by default** (`CapexRequest.sourcingMode`: defaults to `rfq`, no chooser); a reverse `auction` can only be **escalated from RFQ** (requires ≥2 vendor quotes — see RFQ section). **Both paths converge identically at `pi_requested` and run the same fulfillment chain from there.** The auction ends via the countdown reaching `endsAt` **or** sourcing clicking **Close Auction Now**. After it ends, `sourcing_head`/`super_admin` **awards line items to vendors** in the grid's per-line **Final Decision** column (a winning vendor + final price per line) and clicks **Approve Final Decision & Award** — this is a **split award** that can hand different line items to different vendors, creating one **award** per winning vendor (`finalizeSplitAward`). **Each award is its own fulfillment track** (PI → contract-terms approval → PO → payments) carried on that vendor's `VendorInvite` (see **Split award (multi-vendor reverse auction)** below). The vendors already approved the pre-bid **Business Rules** (Commercial Terms / PBG / DLC) to participate, so there is **no post-award terms step** — sourcing clicks **Request PI** for that award directly (`requestProformaInvoice`, restricted to `sourcing_head`/`super_admin`). Each awarded vendor uploads its own Proforma Invoice, **Plant Accounts** assign FA codes per award, **Global Accounts** issue a PO per award and record that award's milestone payments; the **request** is `completed` only when **every** award completes. (RFQ + legacy single-vendor auctions keep the single-vendor request-level chain: one Request PI → one `pi_submitted` → FA → PO → payments → `completed`.) New statuses (`pi_requested`, `pi_submitted`, `accounts_processing`, `payment_in_progress`, `completed`) are added to `CapexStatus`, `CAPEX_STATUS_FLOW`, `ALLOWED_TRANSITIONS`, `STATUS_COLORS`/`STATUS_LABELS`, and `STATUS_TO_STEP`. The `sourcing_approved` / `buyer_approved` statuses are retained only for legacy/in-flight requests created before the buyer step was dropped; `ALLOWED_TRANSITIONS` keeps `negotiation → pi_requested` and `sourcing_approved → pi_requested` so those legacy requests can still reach fulfillment.

`initialStatusForRequest` in `capexContext.tsx` routes new submissions by field type: Green Field, Digitisation, and Information Technology start directly in `sourcing` (no plant-head approval); Brown Field starts in `pending_head_approval`. The `ALLOWED_TRANSITIONS` map still permits `submitted → sourcing` explicitly. The `CapexProvider` enforces transitions via this map — `updateRequest` rejects invalid transitions with a console error and returns the unchanged request.

### State management

`CapexProvider` (`src/lib/capexContext.tsx`) is the single source of truth, mounted in both `(internal)/layout.tsx` and `(public)/layout.tsx`. It exposes:

- `requests`, `vendors`, `invites`, `chatMessages`, `plants`, `categories` — domain arrays
- `capexMaster` — `CapexMasterItem[]` for per-plant/FY budget planning (fields: `id`, `fieldType`, `projectType?` (`rac` | `ems` | `component` | `fan` for Brown/Green Field; defaults to `rac` on load), `plant`, `fy`, `head`, `department`, `subParticulars`, `rate`, `totalCost`; optional Brown Field workbook fields: `sNo`, `rateRs`, `qty`, `reasonForRequirement`, `benefits`, `roi`); `qty` is editable on `/capex/master` only — not shown on request line items; `fieldType` is `green_field` | `brown_field` | `digitisation` | `information_technology` (defaults to `brown_field` on load); `cloneMasterForFY` seeds a new fiscal year from the latest
- `usedCrMap` / `getUsedCr(plant)` — derived budget consumption per plant (in Crore), computed via `useMemo` over non-rejected requests
- `usedAmountByMasterItemId` — per master line-item budget consumed (INR), from non-rejected requests linked via `masterItemId` or `lineItems[].masterItemId`; drives red overrun indicators on `/capex/master`
- `setAuctionConfig(requestId, config)` — writes `CapexRequest.auctionConfig` for reverse auction timing and threshold
- `inviteVendors(requestId, vendorIds[])` — creates `VendorInvite` records with unique tokens for the supplier portal; called automatically when auction starts with selected vendors
- `CapexRequest.lineItems?: CapexLineItem[]` — sub-items from the multi-row grid; each `CapexLineItem` carries its own `masterItemId?`, `masterHead?`, `division?` (Brown Field flat bucket or Green Field section name), `machineCapacity?` (free text, Machinery head rows), `description`, `category`, `quantity`, `uom?`, `specs?`, `budget?`, `remarks?`, `vendorRecommendation?`, optional attachment (base64), and `lastPrice?`/`lastVendor?` (historical pricing shown in the grid for reference)
- `CapexRequest.masterItemId` — optional link to a `CapexMasterItem` (copied from the first line item); the `/capex/master` page uses this to show which requests are associated with each budget line item
- `CapexRequest.statusHistory` — append-only log of `{ status, actor, at }` entries; `updateRequest` pushes an entry on every valid transition
- `CapexRequest.fieldType?: FieldType` — `green_field`, `brown_field`, `digitisation`, or `information_technology`; chosen before the new-request wizard
- `CapexRequest.projectType?: ProjectType` — RAC/EMS/Component/Fan business category for Brown and Green Field; scopes master lookups (`greenFieldProjectType` kept as legacy alias)
- `CapexRequest.greenFieldPlantCreation?` — legacy payload when a Green Field request created a plant inline (deprecated; plant creation is on master)
- `CapexRequest.auctionConfig?: AuctionConfig` — reverse auction: `startedAt`, `durationDays`, `endsAt`, optional `threshold` (INR); lifecycle tracked by timestamps, not status transitions
- `CapexRequest.sourcingDecision?: SourcingDecision` — written by the sourcing flow; holds `selectedVendorId`, `finalPrices` per line item, `freight`/`packing`/`service`/`delivery`/`warranty`, `currency`, `offerCols` (multi-vendor comparison matrix), and `finalVendorPerItem` (per-line-item vendor selection)
- `masterHeads: string[]` — user-created custom budget heads; persisted in `capex_data_v2`; mutations: `addMasterHead`, `renameMasterHead`, `removeMasterHead`
- `addMasterItem(item)` / `updateMasterItem(id, updates)` — add or edit a `CapexMasterItem` row on the master page
- `customPlants: PlantMeta[]` — plants added by users beyond the seeded `PLANTS` list; `PlantMeta.greenFieldPlant?` marks Green Field plants; mutations: `addCustomPlant`, `createGreenFieldPlant` (metadata + optional plant budget envelope)
- `greenFieldBudgetAllocations: GreenFieldBudgetAllocations` — Green Field-only plant, section, and head budget envelopes (`plantBudgets`, `sectionBudgets`, `headBudgets`) scoped by `fy + projectType + plant`; persisted in `capex_data_v2`; mutations: `setGreenFieldPlantBudget`, `setGreenFieldSectionBudget`, `setGreenFieldHeadBudget`; `createGreenFieldPlant` seeds plant budget when `budgetCr` is provided; `cloneMasterForFY` clones allocation rows with master items
- `resetData()` — clears all localStorage and redirects to `/login`

On mount, the provider seeds from `mockData.ts` if `localStorage` is empty. A `storage` event listener re-syncs `invites` when the supplier portal (a separate browser tab) submits a quote. If localStorage already contains `capexMaster` data, the provider backfills missing **Green Field** seed rows only (matched by backfill key including `projectType`). Brown Field rows are replaced once when `brownfieldSeedVersion` in storage differs from `BROWNFIELD_SEED_VERSION` in `brownFieldSeedData.ts` (`fy2026_27_rac_plants`). Digitization-head Brown Field rows migrate to `digitisation` field type once when `digitisationMigrationVersion` differs from `DIGITISATION_MIGRATION_V1`. Brown Field master rows are flattened to `FLAT_MASTER_DIVISION` (`Other Brown Field`, internal only) once when `flatMasterMigrationVersion` differs from `FLAT_MASTER_MIGRATION_V1`. Green Field rows migrate to section structure (`Plant Machinery`, `Utilities`, `Compliances`, `Information Technology`) once when `greenFieldSectionMigrationVersion` differs from `GREEN_FIELD_SECTION_MIGRATION_V1` in `greenFieldConstants.ts`. Stored master rows are migrated on load via `normalizeMasterItemDivision` in `greenFieldConstants.ts`.

- `Quote.seededByBuyer?` — true when the buyer entered the quote during request creation (shown as “Added at request” in `VendorGrid`)

The supplier portal (`/supplier/[token]`) resolves an invite from the URL token via `resolveInviteByToken` in `src/lib/tokenUtils.ts`. Layout is a modern auction bid screen: sticky header (request no, countdown, vendor identity, currency), rank + best price + your bid summary card, collapsible auction rules and request details, bid-entry table (line items with unit price, total, per-line best price only — no anonymous vendor labels), additional-charges panel, delivery/validity/supporting-info section, and a sticky bottom submit bar (rank hint, reset, submit). Supplier quote attachments are capped at 500 KB; base64 is stored inline on the `Quote` object. Reverse-auction re-bids overwrite the single stored quote (`submitQuote` replaces `quotes[0]`). Ranking, gap-to-best-price, threshold warnings, and countdown use helpers in `src/lib/auctionUtils.ts`.

**Responsive (two distinct UIs).** Every supplier-portal state renders cleanly on **desktop** and **mobile (~390px)**. The **pricing** screens (RFQ quotation entry, read-only quote summaries, and the auction bid) present line-item pricing as a **desktop table that mirrors the internal sourcing grid** (`SupplierQuoteTable` — navy `#1E3A5F` header, line items as rows: `# / Description / Qty / UOM / HSN-GST / Unit Price / Line Total`, attribute rows, `#F0F4FB` grand-total row with "incl. ₹X GST") via `hidden lg:block`, and a **mobile card stack** (`SupplierQuoteCards`) via `lg:hidden`. Both share one `variant` API (`read`/`entry`/`bid`) and compute GST + grand total through `rfqUtils` (`rfqTotal`/`rfqGstAmount`), so desktop and mobile never diverge; **all** read surfaces (under-review, counter, agreed, approved, rejected) route through the same line-item-aware summary (`RfqQuoteSummary`, which falls back to the legacy lump-sum `QuoteSummaryCard` only when a request has no line items). The reverse-auction **threshold is whole-quote** — surfaced once (bid-entry header chip + rank summary), not per line. Non-pricing states (auction-approval pending/waiting/declined/ineligible, closed, invalid, PI upload, fulfillment/PO/payments, INCO gate) use the shared public hero card `SUPPLIER_CARD` (`uiTokens.ts`) with action-button rows that stack on mobile (`flex-col sm:flex-row`).

### Shared constants

`src/lib/constants.ts` is the single source of truth for display maps — do not redefine these inline in components:
- `ROLE_NAMES` — role value → display name
- `STATUS_COLORS` — request status → Tailwind badge classes
- `STATUS_LABELS` — request status → human-readable label
- `INVITE_STATUS_COLORS` — invite status → Tailwind badge classes
- `PRIORITY_COLORS` — priority → Tailwind badge classes
- `SOURCING_ENGINEERS` — sourcing member list (currently one entry); used for round-robin auto-assignment at submit
- `ROLE_PLANT` — maps plant-scoped role values to their plant value (e.g. `buyer_jhajjar_p1` → `"jhajjar_p1"`)
- `getPlantForRole(role)` — exported helper; returns the plant string or `null`; preferred over direct `ROLE_PLANT` lookup because it also handles dynamic prefixes (`buyer_*`, `plant_head_*`)
- `PLANTS` — plant locations with value, label, and state

### Key files

| File | Role |
|------|------|
| `src/lib/types.ts` | All domain types and `CAPEX_STATUS_FLOW` array |
| `src/lib/capexContext.tsx` | Global state, mutation functions, transition enforcement |
| `src/lib/greenFieldConstants.ts` | Flat master helpers (`FLAT_MASTER_DIVISION`, `getCanonicalHeadOrder`, `migrateToFlatMaster`), field taxonomy, master migration, filtering helpers, and backfill key helper |
| `src/lib/auctionDocumentUtils.ts` | Reverse auction approval document helpers: placeholder generation, status utilities, eligibility check |
| `src/lib/requestQuoteUtils.ts` | Buyer quote rows on new request: validation, line-item mapping, `VendorInvite` + seeded `Quote` build on submit (non-Brown-Field only) |
| `src/lib/budgetProposalUtils.ts` | Next-FY Brown Field budget proposals: seed from live FY, per-head diff, validate, publish to master |
| `src/lib/bulkMasterImport.ts` | Bulk Excel/CSV import of master rows (dynamic `exceljs`) + downloadable template |
| `src/lib/rfqUtils.ts` | RFQ price-flow status labels/helpers (`effectiveRfqStatus` w/ legacy tolerance, two-gate `canRequestPi`, `rfqTotal`, `rfqLineUnitPrice`, `rfqLineSubtotal`, `lowestRfqTotal`) |
| `src/lib/auctionTheme.ts` | Shared field/style tokens (`INPUT`/`INPUT_RIGHT`/`LABEL`/`LABEL_REQ`/`FOCUS_RING`/`fmtCurrency`) so RFQ + auction surfaces match |
| `src/lib/fileStore.ts` | IndexedDB store for base64 file blobs (`getAllFiles`/`putAllFiles`) — keeps localStorage lean |
| `src/lib/hsnGst.ts` | HSN→GST table + `gstRateForHsn`/`gstAmount`/`hsnLabel` (GST derived per line item, folded into `rfqTotal`) |
| `src/lib/incoTermsUtils.ts` | Incoterms 2020 12-question spec + status maps + `incoTermsBlocksQuote` gate |
| `src/lib/docPackageUtils.ts` | PBG/DLC/one-time-terms default text + `buildDocApprovalPackage` + doc-approval status helpers |
| `src/lib/paymentUtils.ts` | Payment milestones from vendor splits, finalized-vendor/amount resolution, fulfillment-status check |
| `src/lib/tatUtils.ts` | TAT + delay-liability computation (`computeTat`) |
| `src/lib/adhocBudgetUtils.ts` | Adhoc head→head budget: effective/spare allocation, validation, override lookup |
| `src/lib/uiTokens.ts` | Canonical compact density + surface tokens (page/section/card/table/meta + `SUPPLIER_CARD`) — reference for the portal's spacing rhythm |
| `src/components/ClampText.tsx` | Labelled long-text that stays visible but clamps to 2 lines with a measured "Show more/less" toggle (request-detail card) |
| `src/components/supplier/SupplierQuoteTable.tsx` | Vendor portal **desktop** pricing table (navy sourcing-grid style; variants `read`/`entry`/`bid`) — line items as rows |
| `src/components/supplier/SupplierQuoteCards.tsx` | Vendor portal **mobile** pricing card stack (same `read`/`entry`/`bid` variants; GST/total math shared with the table via `rfqUtils`) |
| `src/components/RfqPanel.tsx` | Sourcing RFQ panel: per-vendor price negotiation, doc package, request PI |
| `src/components/DocPackageReview.tsx` | Supplier-facing PBG/DLC/payment-terms review + accept/decline |
| `src/components/AccountsPanel.tsx` | Accounts: FA codes, PO builder, payment-milestone checkboxes |
| `src/components/TatBanner.tsx` | Live TAT / delay-liability banner (detail + supplier) |
| `src/lib/mockData.ts` | Seed data loaded on first visit. Brown Field FY `2026-27` RAC plant master (356 rows, 9 plants) lives in `brownFieldSeedData.ts`. Green Field demo rows use section + child-head structure for `jhajjar_p1`, `jhajjar_p2`, and `pune` (`fy: 2025-26`). |
| `src/lib/brownFieldSeedData.ts` | Generated FY 2026-27 Brown Field RAC plant master seed + `BROWNFIELD_SEED_VERSION` |
| `src/lib/constants.ts` | Shared display maps (colours, role names) |
| `src/lib/tokenUtils.ts` | Supplier link / token helpers |
| `src/lib/exportUtils.ts` | ExcelJS export — dynamically imported, not bundled at startup |
| `src/components/LoginGate.tsx` | Redirects to `/login` if `capex_role` is absent from localStorage |
| `src/components/Sidebar.tsx` | Light cream collapsible sidebar, role-filtered nav, user footer |
| `src/components/TopNav.tsx` | Top bar — page title, search, role switcher |
| `src/components/NegotiationDrawer.tsx` | Sheet drawer for quote negotiation thread |
| `src/components/VendorGrid.tsx` | Vendor comparison table for a request |
| `src/components/VendorOnboardModal.tsx` | Modal for onboarding a new vendor |

### UI stack

- Tailwind v4 (PostCSS plugin — no `tailwind.config`; theme tokens defined in `globals.css`)
- **Theme:** cream/off-white app background (`--background`), navy foreground (`--foreground`), teal primary accent (`--primary`); light cream sidebar via `--sidebar` tokens. Prefer semantic tokens (`bg-background`, `text-foreground`, `bg-primary`, `border-border`) over hardcoded hex in new UI work.
- shadcn/ui components in `src/components/ui/` — config in `components.json` (style: `base-nova`)
- `@base-ui/react` — primitives used by shadcn components; must remain installed
- `sonner` for toasts
- `lucide-react` for icons
- `exceljs` for Excel export (dynamic import only — never import statically)
- **Density tokens (`src/lib/uiTokens.ts`):** canonical compact class strings — `PAGE_SHELL`/`PAGE_STACK` (`p-5`), `SECTION_GAP` (`space-y-4`), `SECTION_GRID` (`gap-4`), `CARD` (`bg-card rounded-xl border border-border shadow-sm p-4`), `META_GRID` (`gap-x-6 gap-y-3`), `TABLE_HEAD` (navy `#1E3A5F`), `TH_CELL`/`TD_CELL` (`py-2` — read-only data rows), `TD_CELL_INPUT` (`py-3`, the documented exception for editable input-grid cells), and `SUPPLIER_CARD` (the public vendor hero card). These are the canonical reference for the portal's rhythm; data tables apply the same `py-2` directly. Brand literals (navy `#1E3A5F`, teal `#0D9488`, table surface `#F0F4FB`) are kept as-is.

### Layout conventions

All data/table pages (`requests`, `dashboard`, `sourcing/vendors`, `capex/[id]`) use **full-width, no-scroll** layout:
- No `max-w-*` or `mx-auto` on the outer page div — content stretches edge-to-edge from the sidebar.
- Outer div: `p-5 h-full flex flex-col` — fills the main viewport height (moderate-compact density; see `uiTokens.ts`).
- Scrollable content sections (tables, lists): `flex-1 min-h-0 overflow-y-auto` so inner content scrolls, not the page.
- The `<main>` element in `(internal)/layout.tsx` has no padding (`p-5` lives on each page's own outer div).

Form/settings pages (`capex/new`, `settings`) keep their narrow centred layout (`max-w-2xl`/`max-w-3xl mx-auto`).

**Compact density:** the portal uses a unified, dense rhythm — page padding `p-5`, section gaps `space-y-4`/`gap-4`, internal cards `bg-card rounded-xl border-border shadow-sm p-4`, **data-table rows `py-2`** (editable input-grid cells stay `py-3`/`py-0.5` by design — see `TD_CELL_INPUT`), page titles `text-xl`. Key-value metadata is rendered as a **dense inline `label: value` strip** (`flex flex-wrap gap-x-4 gap-y-1`), not stacked label-over-value cells — see the request-detail `RequestInfoCard` and the vendors expanded row. Long text fields use **`ClampText`** (`src/components/ClampText.tsx`) — visible but clamped to 2 lines with a measured "Show more/less" toggle. The login page is responsive (marketing hero hidden below `lg`, card `w-full max-w-md`). Touch targets stay ≥44px on interactive controls. Values live in `src/lib/uiTokens.ts`.

### New Request — multi-row grid

`capex/new/page.tsx` opens with a **four-tile field type picker** (Brown Field, Green Field, Digitisation, Information Technology) under an **Amber** company badge. Brown and Green Field then pick **business category** (`RAC`, `EMS`, `Component`, `Fan`) via `projectType`, which scopes master lookups for both field types.

**Brown Field:** category → plant picker → budget head cards (only heads with master line items) → line-item grid (head locked). Starts in `pending_head_approval`.

**Green Field:** category → plant picker (Green Field plants) → **section cards** (`Plant Machinery`, `Utilities`, `Compliances`, `Information Technology`) → child head cards → line grid. Plant creation on CAPEX Master (sourcing/admin): metadata only; budgets added on master detail under sections. New plants appear in Brown Field plant picker.

**Digitisation / IT:** plant picker → budget head cards from dedicated masters → line-item grid (head locked). Digitization rows migrated from Brown Field on first load. Both start in `sourcing`.

Master filtering uses `filterMasterItemsForRequest` — scoped by plant, FY, `fieldType`, `projectType` (Brown/Green), `division` (Green Field sections), and head. Brown Field uses flat head scope (no division tabs in UI).

- Sourcing engineer is **never chosen by the user** — it is auto-assigned: `SOURCING_ENGINEERS[0].value` (round-robin intended but currently single entry).
- Request IDs use `crypto.randomUUID()` (not `Date.now()`) to prevent collisions.
- `requestNo` is auto-generated on `addRequest` as `CAP-{2-digit FY start}{2-digit FY end}-{4-digit seq}` (e.g. `CAP-2526-0001`).
- Categories in the grid are sourced from `useCapex().categories` with a hardcoded fallback.
- `HEAD_APPROVAL_THRESHOLD = 1_000_000` (₹10L) remains defined in `types.ts` for approval policy reference; Green Field now bypasses plant-head approval and starts directly in sourcing.
- **Wizard navigation:** every step exposes **Back** (previous step or requests list) and **Change** actions (field type / division / head) via `WizardActionBar`, `WizardBackButton`, and `WizardChangeButton` helpers in `capex/new/page.tsx`. Changing scope clears dependent rows/documents via existing reset helpers.
- **Line grid:** each row shows **Allocated Budget** (read-only from linked master sub-particular `totalCost`). Est. budget, document, and vendor are **not** on the main row — they are captured in per-line quote cards below each row.
- **Vendor quotes (required per line):** below each line item, a collapsed **Vendor Quotes** panel with **Add Quote**. Fields: vendor, est. budget total for qty, document (500 KB), freight/service/packing, delivery weeks, warranty, currency. Each quote shows green/red vs master allocation. At least one complete quote per line is required before Review. On submit, line `budget` uses the lowest quote per line; quotes seed `VendorInvite` records (`quote_received`, `seededByBuyer: true`) via `buildInvitesFromQuoteRows` in `requestQuoteUtils.ts`. Review shows each line with its quotes grouped underneath.

### CAPEX Master — budget heads

The master page has **four field-type tabs**: Brown Field, Green Field, Digitisation, Information Technology. Brown and Green Field add a **project-type card step** (RAC/EMS/Component/Fan) before plant selection. **Brown Field detail is head-gated:** plant → **budget head cards** (General, Automation, Machinery, etc.) → line-item table for the selected head only; no `All Heads` view; **Add Item** requires a selected head; empty predefined heads are hidden (custom heads from **Manage Heads** appear before first item). **Green Field detail is strictly sectioned:** plant → four section cards → **head cards** (Moulding Shop, Press Shop, etc.) → line-item table for the selected head only; no `All Heads` view; **Add Item** requires a selected head. **Green Field budget hierarchy (plant → section → head → sub-particular):** Create Green Field Plant requires an **overall plant budget (Cr)**; first open of a section prompts **Assign Section Budget** modal; first open of a head prompts **Assign Head Budget** modal; section budgets deduct from the plant envelope, head budgets deduct from the section envelope, and sub-particular `totalCost` rows deduct from the head envelope with green/red remaining/over indicators (warning-only — no hard block). Plant/section/head cards and detail banners show allocated vs used. Plant Machinery and Utilities expose predefined child heads (shops/utilities); Compliances and Information Technology are empty section buckets where line items use the section name as head (custom heads allowed). Green Field shows **created plants** (`greenFieldPlant` flag or existing Green Field master rows). **Sourcing** (`sourcing_member`, `sourcing_head`) and **super_admin** can use **Create Green Field Plant** (name, state, FY, category, plant budget, optional plant head) and **Set FY** on the Green Field tab. Digitisation and IT use plant grid → head cards → line-item table. `CapexMasterItem.projectType` isolates Brown/Green budgets per category. Digitization-head rows migrate to `digitisation` field type on load (`DIGITISATION_MIGRATION_V1`). Green Field section migration runs on load (`GREEN_FIELD_SECTION_MIGRATION_V1`).

**Request detail (`/capex/[id]`):** `RequestInfoCard` shows per-line **Allocated** (from linked `CapexMasterItem.totalCost × 1 Cr`) and **Status** chips (green "₹X under" / red "₹X over") for all roles at every approval stage; a summary row totals allocated when line items link to master rows. The requested-**Budget** display was removed from the line-items table, the Budget Summary, and the meta strip (also from the requests list and dashboard tables, and the "Est. Budget (Total, ₹)" input on `/capex/new`) — the `budget`/`item.budget` **data** is kept (it still feeds savings, dashboard KPIs, and PO/threshold/`resolveFinalVendor` fallbacks); only the display/input is gone. Brown Field line `budget` now defaults to the master allocation. The card does **not** show Priority or a separate Technical Specifications block (the line-item Description carries the spec; both were removed as redundant). The **RfqPanel is hidden for `plant_head*` roles** (`isPlantHead` gate on the `isRfqMode` render) — plant heads are approval-only and don't run sourcing.

### Plans, specs, and user stories

- `docs/USER_STORY.md` — living product backlog; updated whenever requirements or user stories change (maintained across chats).
- `docs/SCOPE.md` — product scope document: implemented features, workflows, limitations, and planned roadmap.
- `docs/superpowers/plans/` — implementation plans (date-prefixed, e.g. `2026-05-30-feature-name.md`).
- `docs/superpowers/specs/` — design specs that precede implementation.

When architecture or conventions change, update this file (`CLAUDE.md`) in the same session. A Cursor rule (`.cursor/rules/project-docs.mdc`) enforces keeping both docs in sync.

### Reverse auction approval document (pre-auction vendor confirmation)

Before an auction starts, the sourcing team must generate a "Business Rules for Reverse Auction" document and send it to shortlisted vendors for approval. Vendors must approve their participation before they can bid.

**Document structure (`AuctionApprovalDocument` in `types.ts`):**
- Generated document ID, timestamps (`generatedAt`, `sentAt`)
- Auction dates/times: `auctionDate`, `auctionOpeningTime`, `auctionClosingTime`
- Bidder acceptance deadline: `bidderAcceptanceDeadlineDate`, `bidderAcceptanceDeadlineTime`
- Vendor revert deadline: `vendorRevertDeadlineAt`
- Buyer contact details: `buyerName`, `buyerDesignation`, `buyerEmail`, `buyerMobile`
- Green Field delivery locations: array of `{ name, state, subLocationCount? }`
- Auction rules: `bidValidityDays` (default 180), `maxDecrements` (default 5), `extensionDurationMinutes` (default 15), `maxExtensionsPerBidder` (default 2), `currency` (default "INR")
- Optional fields: `supplyFrame`, `paymentTerms`, `signatoryName`, `signatoryDesignation`

**Vendor approval status (`AuctionApprovalStatus` in `types.ts`):**
- `not_sent` — document not yet sent to this vendor
- `pending` — awaiting vendor response
- `approved` — vendor confirmed participation, eligible to bid
- `rejected` — vendor declined participation
- `excluded` — manually excluded by sourcing team
- `overdue` — pending past deadline (computed from `vendorRevertDeadlineAt`)

Stored on `VendorInvite.auctionApprovalStatus` with timestamps:
- `approvalDocumentSentAt`, `approvalRespondedAt`, `approvalReminderSentAt`, `approvalExcludedAt`, `approvalExclusionReason`

**Key mutations in `capexContext.tsx`:**
- `saveAuctionApprovalDocument(requestId, document)` — stores the generated document
- `sendAuctionApprovalToVendors(requestId, vendorIds[])` — marks invites as `pending` and stamps `sentAt`
- `respondToAuctionApproval(inviteId, 'approved' | 'rejected')` — vendor-facing action via supplier portal
- `sendAuctionApprovalReminder(inviteId)` — stamps `reminderSentAt` and shows toast
- `excludeVendorFromAuction(inviteId, reason)` — marks as `excluded` with reason

**Eligibility helper:** `isVendorEligibleForAuction(invite, revertDeadline)` returns true only for approved vendors not past deadline. The `canStartAuction(invites, revertDeadline)` helper returns `{ canStart, approvedCount, pendingCount, rejectedCount, overdueCount }` — used to gate the Start Auction button (requires ≥1 approved).

**Document placeholder helpers in `auctionDocumentUtils.ts`:**
- `buildAuctionDocumentPlaceholders(request, document)` — generates all template placeholders including formatted dates (`DD/MM/YYYY`, `HH:MM Hrs`, `HH:MM AM/PM`)
- `AUCTION_APPROVAL_STATUS_LABELS` and `AUCTION_APPROVAL_STATUS_COLORS` — for UI badges

**Internal UI (`capex/[id]/page.tsx`):**
- Sourcing setup form with date/time pickers, auction rules with defaults
- Green Field delivery location entry (repeatable rows)
- Document preview with print support (browser print)
- Vendor approval tracker table: vendor name, sent at, response status, responded at, actions (reminder, exclude)
- Status summary chips: Approved, Pending, Rejected/Excluded, Overdue
- Gated Start Auction button: disabled with message until ≥1 vendor approved

**Supplier portal (`supplier/[token]/page.tsx`):**
- If document pending: shows Business Rules approval screen with summary, rules, deadline, Approve/Decline buttons
- If approved: shows waiting state until auction starts
- If rejected/excluded/overdue: shows non-participating state with contact info
- If auction active: bid form only accessible to approved vendors; summary shows vendor rank, auction best price, and collapsible rules (no Supplier A/B labels)

**Related files:**
- `src/lib/types.ts` — type definitions
- `src/lib/auctionDocumentUtils.ts` — helpers, placeholders, status utilities
- `src/lib/capexContext.tsx` — mutations, data persistence
- `src/app/(internal)/capex/[id]/page.tsx` — internal auction panel
- `src/app/(public)/supplier/[token]/page.tsx` — supplier portal approval flow

### Brown Field procurement expansion (US-057 – US-063)

A full Brown-Field fulfillment lifecycle layered on top of the base flow. **All of the following is scoped to `fieldType === 'brown_field'`** unless noted; Green Field / Digitisation / IT behave exactly as before. The document-approval enhancements (PBG/DLC/one-time terms) also apply to the reverse-auction approval, which runs for any field type.

**New global roles:** `maintenance`, `accounts` (see Auth model).

**Budget proposals → admin approval → new FY (`maintenance`):**
- Live Brown Field FY master is **read-only** on `/capex/master` (`brownFieldLocked` gate — Add Item / edit / Manage Heads / New FY hidden; a "Plan Next-FY Budget" CTA links to `/capex/budget-proposals`). The only mid-FY change is an Adhoc transfer (below).
- `/capex/budget-proposals` (Budget Planning) — maintenance/plant_head/sourcing author a `BudgetProposal` for a target FY, seeded from the live FY (`createProposalFromLiveFy`), editable inline, with **bulk Excel/CSV upload** (`src/lib/bulkMasterImport.ts` — dynamic `exceljs`, `parseMasterWorkbook`/`parseCsvText`/`downloadImportTemplate`). Submit → `pending_admin`.
- `/capex/budget-approvals` (super_admin) — review per-head diff vs live FY; **Approve publishes** the proposal as a new live FY (`decideBudgetProposal` → `buildMasterItemsFromProposal` appends `CapexMasterItem`s with the target FY; double-publish guarded).
- New-request + master use **field-scoped** `getLatestMasterFyForField` so a published Brown Field FY becomes the live FY buyers see, without changing the FY for other field types.
- Helpers: `src/lib/budgetProposalUtils.ts`. State/mutations: `budgetProposals`, `createBudgetProposal`/`updateBudgetProposal`/`submitBudgetProposal`/`decideBudgetProposal`.

**Request creation — no buyer quotes (Brown Field):** `/capex/new` Brown Field shows a **preferred-vendor + est-budget** block (`BrownFieldLineDetail`) instead of the per-line `LineQuoteSection`; the line's **Description** field is the specification (there is no separate Specifications field). Line `budget` derives from the buyer's est. budget or the linked master allocation; no `VendorInvite` seeding. Other field types keep the buyer-quote flow.

**RFQ vs Reverse Auction (sourcing):** Brown Field is **RFQ-only by default** — there is no RFQ/Auction chooser; `capex/[id]` auto-sets `sourcingMode:'rfq'` when a Brown Field request enters `sourcing`, and a reverse auction can only be **escalated from RFQ** (and only with **≥2 vendor quotes**). RFQ uses `RfqPanel` (`src/components/RfqPanel.tsx`) and is a **vendor-quotes-first, per-line-item negotiation**. `RfqQuote` carries `linePrices` (unit price per `CapexLineItem.id`), `price` (base subtotal = Σ unit×qty), and footer charges (freight/packing/service/delivery/warranty/currency); grand total = `rfqTotal` = subtotal + freight + packing + service. Per-line helpers: `rfqLineUnitPrice`, `rfqLineSubtotal` (in `rfqUtils.ts`). **Flow:** sourcing **invites vendors (sends the link)** — for an RFQ request `inviteVendors` stamps `rfqStatus: 'awaiting_quote'` (mode-aware; `setSourcingMode('rfq')` backfills already-invited un-quoted vendors). The **vendor prices each line item** on the supplier portal (`proposeRfqQuote(...,'supplier')` → `pending_sourcing`); sourcing then **counters inline in the comparison grid** (per-line unit prices + footer, one vendor column at a time → `proposeRfqQuote(...,'sourcing')` → `pending_vendor`) or **accepts** the vendor's quote (`respondToRfqQuote(...,'approved','sourcing')`); the vendor accepts/counters/declines on the portal. Either side accepting → `approved`. `reopenRfqQuote(inviteId)` re-opens an approved quotation (`approved → pending_sourcing`, resets docs). `proposeRfqQuote` sanitizes input (price finite > 0; per-line + footer charges non-negative); `respondToRfqQuote` is turn-guarded. The panel uses the **reverse-auction comparison grid** (modeled on `VendorGrid`, shared field styles in `src/lib/auctionTheme.ts`): **line items as rows (Item / Description / Qty / HSN-GST), vendors as columns** with a **read-only HSN / GST** column per item row (vendor-entered, see GST section) and per-line unit price + line total and a green "↓ Lowest" highlight per line, footer attribute rows (freight/packing/service/delivery/warranty/currency), a Grand Total row with the L1 lowest highlight, and a per-line **Final Decision** column (a vendor dropdown defaulting to the lowest, recorded via `setRfqFinalVendor` → `CapexRequest.rfqFinalVendorPerItem`). Stacked per-vendor cards render below `lg`. The per-line **Final Decision** column is **identical to the reverse-auction grid** (`VendorGrid`): Price (₹) input + Disc (%) input + Vendor select + a computed `Price × Qty` net, persisted in `request.sourcingDecision` (`finalPrices` keyed `${itemId}-price`/`${itemId}-disc`, `finalVendorPerItem`). **Accept** still finalizes one vendor for the single-vendor PI/fulfillment. The sourcing **copy supplier link** is available on every vendor in every status (header + mobile card). A **"Start Reverse Auction"** CTA (enabled once **≥2** vendors have quoted) calls `seedAuctionFromRfq(requestId)` then `setSourcingMode('auction')`: `seedAuctionFromRfq` carries each vendor's RFQ quotation into the auction as an **opening `Quote`** (per-line `itemPrices`, grand total, footer charges, `seededByBuyer: true`) so the lowest is **L1** immediately and vendors can rebid lower via `submitQuote`. The auction setup also pre-fills its threshold with `lowestRfqTotal(reqInvites)` (editable). Sourcing requests a PI only once **both** the quotation and the documents are approved (`canRequestPi`). `VendorInvite` carries `rfqQuote`/`rfqStatus` (`not_sent`/`awaiting_quote`/`pending_sourcing`/`pending_vendor`/`approved`/`rejected`)/`rfqThread`; `effectiveRfqStatus` is tolerant of legacy data (an invited, un-quoted RFQ invite resolves to `awaiting_quote`). Legacy/simple requests with no `lineItems` render a single synthetic row (unit price = the whole quote).

**GST via HSN — item-wise (`src/lib/hsnGst.ts`):** the HSN code is a property of **each line item** (`CapexLineItem.hsnCode`), **not** the vendor's quote — the same item carries one HSN across all vendors. **Only the vendor enters it** (per line in their bid table — the supplier `SupplierQuoteTable`/`SupplierQuoteCards` entry variant — persisted onto the line items on submit via `setLineHsn(requestId, itemId, code)`). **Sourcing sees the HSN / GST column read-only** in the RFQ comparison grid (no dropdown); they cannot set or override it. GST is computed **per line** = `unit × qty × gstRateForHsn(item.hsnCode)` (see `rfqLineGstAmount`/`rfqLineGstRate`); footer charges (freight/packing/service) are **not taxed**. `rfqGstAmount(quote, items?)` sums the per-line GST (legacy fallback to the deprecated quote-level `RfqQuote.hsnCode` when no items are passed); `rfqTotal(quote, items?)` = `rfqTaxableValue` (subtotal + freight + packing + service) + item-wise GST. `lowestRfqTotal(invites, items?)` likewise takes the line items. So L1 ranking, threshold, auction seeding and the PO amount stay **GST-inclusive**. The grid's Grand Total row shows an `incl. ₹X GST` subtitle per vendor; the supplier Grand Total shows the item-wise GST line. (`RfqQuote.hsnCode` is retained only as a legacy fallback.)

**INCO Terms (Incoterms 2020) gate (`src/lib/incoTermsUtils.ts`):** sourcing can **quick-add a one-time vendor** by name/email/phone in the RFQ picker (`inviteNewVendor` → `Vendor.oneTime`, `contactPhone`). A one-time vendor is sent a **12-question Incoterms agreement** (`INCO_TERMS_QUESTIONS`) that they must **approve before their price-quote form unlocks** (`incoTermsBlocksQuote`). Two-sided negotiation mirrors the RFQ thread: vendor fills (`proposeIncoTerms(...,'vendor')` → `pending_sourcing`); sourcing reviews, edits any field & resends (`proposeIncoTerms(...,'sourcing')` → `pending_vendor`) or approves/rejects (`respondToIncoTerms`); statuses `awaiting_vendor`/`pending_sourcing`/`pending_vendor`/`approved`/`rejected` on `VendorInvite.incoTermsStatus` (+ `incoTermsDoc`/`incoTermsThread`). Only sent to new/one-time vendors; onboarded vendors quote directly.

**Document-approval package (RFQ + auction):** Commercial Terms + Performance Bank Guarantee + Delay Liability Clause are sent for vendor agreement; for **one-time / not-onboarded vendors** (flagged on the `Vendor` via the onboard modal, with `paymentTermsText` + `paymentSplits`), payment terms are included too. In **RFQ the documents must be approved BEFORE the vendor can enter a price**: when sourcing invites an RFQ vendor (`inviteVendors`, and the `setSourcingMode('rfq')` backfill), the `DocApprovalPackage` is built and `docApprovalStatus: 'pending'` is set up front. On the supplier portal the **quotation form is gated** (`docsBlocked`, mirroring the INCO-terms gate): the vendor sees `DocPackageReview` first and must **Accept** (→ `respondToDocApproval`) before the quote entry unlocks; declining shows a "Terms Declined" lock. (Legacy invites with no package fall through unblocked.) PI is still gated on **both** `effectiveRfqStatus === 'approved'` **and** `effectiveDocApprovalStatus === 'approved'` (`canRequestPi` in `rfqUtils.ts`) — docs are simply approved earlier now. `respondToRfqQuote`'s old auto-send on price agreement remains as a harmless no-op (its `docsAlreadyApproved` guard). If the vendor declines the documents, the supplier shows a "Terms Declined" state and sourcing can re-send via `resendDocApprovalPackage`; re-opening an approved quote (`reopenRfqQuote`) or sourcing countering an approved quote resets the documents. (`sendDocApprovalPackage` remains in context for standalone use.) The **reverse auction** embeds Commercial Terms (default) + PBG/DLC text on `AuctionApprovalDocument` (defaults from `docPackageUtils`), rendered in the print view and the supplier auction-approval screen — all three are agreed by accepting participation. Helpers/defaults in `src/lib/docPackageUtils.ts`.

**Proforma Invoice + Accounts (split: Plant → Global) + payments:** the finalized vendor uploads a PI on the supplier portal (`submitProformaInvoice` → `pi_submitted`, stamps `piSubmittedAt`); it surfaces to the buyer and the **Accounts Queue** (`/accounts/queue`). `AccountsPanel` (`src/components/AccountsPanel.tsx`) is **role-split**: **Plant Accounts** (`plant_accounts`) assign **FA codes** per line (`assignFaCode`) and **Submit FA codes** — which first opens a **FA-code email preview** (`FaEmailModal`, simulated send since there is no email backend): a one-time notification to a dedicated recipient (`FA_CODE_RECIPIENT_EMAIL` in `constants.ts`, editable in the modal) listing the ordered items + their FA codes; clicking **Send** fires a toast and then `submitFaCodes` (→ `accounts_processing` / award status); **Global Accounts** (`accounts`) assign the **PO number**, **upload the PO document**, and **Issue PO to vendor** (`issuePurchaseOrder` → `payment_in_progress`, stamps `issuedAt`/`issuedBy`; PO-doc base64 offloaded to IndexedDB; the vendor is notified and downloads the PO from a **Purchase Order card** on the supplier portal), then tick **payment milestones** (`markPaymentMade`) built from the vendor's `paymentSplits` (`src/lib/paymentUtils.ts`). Ticking the final milestone sets `tatStoppedAt` and moves to `completed`; each tick "notifies" the vendor (toast + supplier Payments card). Both modes converge here identically. The **auction** is awarded via the per-line Final Decision split award (see **Split award** above): after the auction **ends** (`isAuctionExpired`, via the countdown or **Close Auction Now** `closeAuction`), `finalizeSplitAward` marks each winning invite `awarded` — there is **no post-award doc-package** (vendors approved the pre-bid Business Rules — Commercial Terms + PBG + DLC — to bid), so sourcing requests each award's PI directly (`requestProformaInvoice`, `canFinalize` = `sourcing_head`/`super_admin`). **Supplier routing:** the finalized vendor routes into the shared PI-upload/fulfillment view (`RfqSupplierView`) for `pi_requested` **as well as** the `FULFILLMENT_STATUSES` (`pi_requested` is **not** in that list, so it must be matched explicitly — otherwise an auction winner at `pi_requested` could never upload the PI). (`PurchaseOrder` gained `poDocumentBase64`/`poDocumentName`/`poDocumentMimeType`/`issuedAt`/`issuedBy`; the legacy `createPurchaseOrder`/`submitPurchaseOrder` remain in context but the split flow uses `submitFaCodes`/`issuePurchaseOrder`.)

**Split award (multi-vendor reverse auction):** a reverse auction can be **awarded across multiple vendors** — different line items to different winners. Sourcing fills the per-line **Final Decision** column in `VendorGrid` (vendor + final price, GST-inclusive via `hsnGst`) and clicks **Approve Final Decision & Award** (`sourcing_head`/`super_admin`, gated until the auction has ended and every line has a vendor + price). `finalizeSplitAward(requestId, decision)` groups the lines by vendor (`buildAwardGroups` in `paymentUtils.ts`) and turns **each winning vendor's `VendorInvite` into a self-contained fulfillment track** via new invite fields: `awarded`, `awardedItemIds`, `awardAmount` (Σ net + item-wise GST), `awardStatus` (`awarded → pi_requested → pi_submitted → accounts_processing → payment_in_progress → completed`), plus per-award `faCodes`, `purchaseOrder`, `paymentMilestones`, `piSubmittedAt`, `tatStoppedAt`. A request is **award-based** when `isAwardBased(invites)` (any invite `awarded`). Helpers in `paymentUtils.ts`: `awardedInvites`, `isAwardInAccounts`, `awardSummary`, `deriveRequestStatus`. **Each award runs the full chain independently:** there is **no post-award terms step** (vendors approved the pre-bid Business Rules — Commercial Terms / PBG / DLC — to bid), so an awarded vendor sees a "You won — awaiting PI request" screen (`AuctionWinnerTerms`) and sourcing clicks **Request PI** per award directly (`requestProformaInvoice` sets the invite's `awardStatus`, not `finalVendorId`) → that vendor uploads its own PI (`submitProformaInvoice` → award `pi_submitted`) → **Plant Accounts** FA codes per award (`assignFaCode`/`submitFaCodes` with the `inviteId` arg) → **Global Accounts** PO per award (`issuePurchaseOrder(..., inviteId)`) → per-award milestone payments (`markPaymentMade(..., inviteId)`). The **request status stays coarse** for award-based requests (`pi_requested` while awards are in flight, `completed` once **all** awards complete — `ALLOWED_TRANSITIONS` allows `pi_requested → completed`); granular progress lives per-award. The fulfillment mutations take an **optional `inviteId`** that targets one award; omitting it keeps the legacy request-level behavior for RFQ / single-vendor. Surfaces that fan out per award: the per-award tracker on `capex/[id]` (Request PI / terms / live status per vendor), the **supplier portal** (each vendor sees only its `awardedItemIds` + its own PI/PO/payments, routed by `invite.awarded` + `awardStatus`), `AccountsPanel` (one `AccountsTrack` per award), and `/accounts/queue` (one row per award). TAT is per award.

**TAT + delay liability:** `src/lib/tatUtils.ts` `computeTat` — the clock starts at PI + 1 week; deduct **0.5%/week up to a cumulative 5%** (weeks 1–10), then escalate to **5%/week**; stops at `tatStoppedAt`. `TatBanner` (`src/components/TatBanner.tsx`) shows the live status on the request detail and supplier portal (recomputes every 60s); for split awards one banner renders per award (per-invite `piSubmittedAt`/`tatStoppedAt`/`awardAmount`).

**Adhoc head→head budget (`/capex/adhoc-budget`):** when a head exceeds its allocation, sourcing or plant_head raise an `AdhocBudgetRequest` to move budget from a head with spare to the over-budget head (same plant + FY, Brown Field). **Admin is the sole approver** (on `/capex/budget-approvals`). Approval writes per-head allocation overrides (`brownFieldHeadAllocations`, a `BrownFieldHeadBudget[]` alias of `GreenFieldHeadBudget` with `division = FLAT_MASTER_DIVISION`); master Brown Field head allocations prefer the override over the summed line-item budgets. Helpers in `src/lib/adhocBudgetUtils.ts`; mutations `createAdhocBudgetRequest`/`decideAdhocBudgetRequest`.

**Persistence:** `budgetProposals`, `adhocBudgetRequests`, `brownFieldHeadAllocations` are persisted in `capex_data_v2` (read with `?? []`).

### Adding new roles or statuses

- Add the role value to `ROLE_NAMES` in `constants.ts`, `ROLE_META` in `Sidebar.tsx`, and `ROLE_GROUPS` in `TopNav.tsx`. If the role is plant-scoped, also add it to `ROLE_PLANT` in `constants.ts` and to the relevant nav entries in the `NAV` array in `Sidebar.tsx`.
- Add a new status to `CapexStatus` in `types.ts`, `CAPEX_STATUS_FLOW`, the `ALLOWED_TRANSITIONS` map in `capexContext.tsx`, `STATUS_COLORS` and `STATUS_LABELS` in `constants.ts`, and any filter/banner logic in page components.
