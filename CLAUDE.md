# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js + Turbopack, port 3000)
npm run build    # production build (runs tsc + Next.js build)
npm run lint     # ESLint via next lint
npx tsc --noEmit # type-check without building
```

No test suite is configured.

## Architecture

**Capex Amber** is a Next.js 16 app (App Router, TypeScript, Tailwind v4) for Amber Enterprises' CAPEX procurement workflow. Entirely client-side — no backend, no database. All state lives in `CapexProvider` and is persisted to `localStorage` under the key `capex_data_v2`.

### Route groups

| Group | Path prefix | Purpose |
|-------|-------------|---------|
| `(internal)` | `/capex/*`, `/sourcing/*`, `/settings` | Authenticated internal portal — wraps `CapexProvider` + `LoginGate` + `Sidebar` + `TopNav`; `/settings` guarded to `super_admin`; `/capex/master` guarded to plant_head variants, sourcing_head, super_admin |
| `(public)` | `/supplier/[token]` | Tokenised supplier portal — wraps `CapexProvider` only, no auth |
| *(root)* | `/login` | Role-picker login screen |

`/` redirects to `/login` via `next/navigation`'s `redirect()`.

### Auth model

Mock-only. `LoginPage` writes the selected role to `localStorage("capex_role")`. `LoginGate` redirects to `/login` if absent. `TopNav` exposes a role-switcher dropdown that writes the same key and fires a `capex_rolechange` CustomEvent. All role-aware components listen to that event.

Roles: `buyer`, `buyer_jhajjar_p1`, `buyer_jhajjar_p2`, `sourcing_member`, `plant_head`, `plant_head_jhajjar_p1`, `plant_head_jhajjar_p2`, `sourcing_head`, `super_admin`.

Plant-scoped roles (`buyer_jhajjar_*`, `plant_head_jhajjar_*`) filter data to their plant. `ROLE_PLANT` in `constants.ts` maps these roles to their plant value; roles absent from the map have access to all plants.

### Status flow

```
draft → submitted → pending_head_approval → sourcing → negotiation → sourcing_approved → buyer_approved
                  ↘ (budget ≤ ₹10L)  → sourcing
                                                        ↘ rejected (at any stage from pending_head_approval onward)
```

`pending_head_approval` is the initial status for all new submissions (the `ALLOWED_TRANSITIONS` map also permits `submitted → sourcing` as a direct path, but `initialStatusForRequest` in `capexContext.tsx` always returns `pending_head_approval` regardless of budget). The `CapexProvider` enforces transitions via the explicit `ALLOWED_TRANSITIONS` map — `updateRequest` rejects invalid transitions with a console error and returns the unchanged request.

### State management

`CapexProvider` (`src/lib/capexContext.tsx`) is the single source of truth, mounted in both `(internal)/layout.tsx` and `(public)/layout.tsx`. It exposes:

- `requests`, `vendors`, `invites`, `chatMessages`, `plants`, `categories` — domain arrays
- `capexMaster` — `CapexMasterItem[]` for per-plant/FY budget planning (fields: `id`, `plant`, `fy`, `head`, `department`, `subParticulars`, `rate`, `totalCost`); `fy` is a 4-char string `"YYZZ"` (e.g. `"2526"` for FY 2025-26, April-start); `cloneMasterForFY` seeds a new fiscal year from the latest
- `usedCrMap` / `getUsedCr(plant)` — derived budget consumption per plant (in Crore), computed via `useMemo` over non-rejected requests
- `CapexRequest.lineItems?: CapexLineItem[]` — sub-items from the multi-row grid; each `CapexLineItem` carries its own `masterItemId?`, `masterHead?`, `description`, `category`, `quantity`, `uom?`, `specs?`, `budget?`, `remarks?`, `vendorRecommendation?`, optional attachment (base64), and `lastPrice?`/`lastVendor?` (historical pricing shown in the grid for reference)
- `CapexRequest.masterItemId` — optional link to a `CapexMasterItem` (copied from the first line item); the `/capex/master` page uses this to show which requests are associated with each budget line item
- `CapexRequest.statusHistory` — append-only log of `{ status, actor, at }` entries; `updateRequest` pushes an entry on every valid transition
- `CapexRequest.sourcingDecision?: SourcingDecision` — written by the sourcing flow; holds `selectedVendorId`, `finalPrices` per line item, `freight`/`packing`/`service`/`delivery`/`warranty`, `currency`, `offerCols` (multi-vendor comparison matrix), and `finalVendorPerItem` (per-line-item vendor selection)
- `masterHeads: string[]` — user-created custom budget heads; persisted in `capex_data_v2`; mutations: `addMasterHead`, `renameMasterHead`, `removeMasterHead`
- `addMasterItem(item)` / `updateMasterItem(id, updates)` — add or edit a `CapexMasterItem` row on the master page
- `customPlants: PlantMeta[]` — plants added by users beyond the seeded `PLANTS` list; mutation: `addCustomPlant`
- `resetData()` — clears all localStorage and redirects to `/login`

On mount, the provider seeds from `mockData.ts` if `localStorage` is empty. A `storage` event listener re-syncs `invites` when the supplier portal (a separate browser tab) submits a quote.

`VendorInvite` owns the `quotes[]` and `negotiationThread[]` for each vendor–request pairing.

The supplier portal resolves an invite from the URL token via `resolveInviteByToken` in `src/lib/tokenUtils.ts`. Supplier quote attachments are capped at 500 KB; base64 is stored inline on the `Quote` object.

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
| `src/lib/mockData.ts` | Seed data loaded on first visit |
| `src/lib/constants.ts` | Shared display maps (colours, role names) |
| `src/lib/tokenUtils.ts` | Supplier link / token helpers |
| `src/lib/exportUtils.ts` | ExcelJS export — dynamically imported, not bundled at startup |
| `src/components/LoginGate.tsx` | Redirects to `/login` if `capex_role` is absent from localStorage |
| `src/components/Sidebar.tsx` | Collapsible sidebar, role-filtered nav, user footer |
| `src/components/TopNav.tsx` | Top bar — page title, search, role switcher |
| `src/components/NegotiationDrawer.tsx` | Sheet drawer for quote negotiation thread |
| `src/components/VendorGrid.tsx` | Vendor comparison table for a request |
| `src/components/VendorOnboardModal.tsx` | Modal for onboarding a new vendor |

### UI stack

- Tailwind v4 (PostCSS plugin — no `tailwind.config`; theme tokens defined in `globals.css`)
- shadcn/ui components in `src/components/ui/` — config in `components.json` (style: `base-nova`)
- `@base-ui/react` — primitives used by shadcn components; must remain installed
- `sonner` for toasts
- `lucide-react` for icons
- `exceljs` for Excel export (dynamic import only — never import statically)

### Layout conventions

All data/table pages (`requests`, `dashboard`, `sourcing/vendors`, `capex/[id]`) use **full-width, no-scroll** layout:
- No `max-w-*` or `mx-auto` on the outer page div — content stretches edge-to-edge from the sidebar.
- Outer div: `p-6 h-full flex flex-col` — fills the main viewport height.
- Scrollable content sections (tables, lists): `flex-1 min-h-0 overflow-y-auto` so inner content scrolls, not the page.
- The `<main>` element in `(internal)/layout.tsx` has no padding (`p-6` lives on each page's own outer div).

Form/settings pages (`capex/new`, `settings`) keep their narrow centred layout (`max-w-2xl`/`max-w-3xl mx-auto`).

### New Request — multi-row grid

`capex/new/page.tsx` is a 3-step flow (form → review → sent). Step 1 is an **Excel-style spreadsheet grid**: each row is one line item. Users add/delete rows; on submit all rows are collected into a **single `CapexRequest`** where `lineItems[]` holds each row as a `CapexLineItem`. The top-level request fields are derived: `subject` = first item's description, `budget` = sum of all item budgets, `category` = "Multiple" (or first item's category for single row), `quantity` = "N items" (or first item's quantity for single row).

- Sourcing engineer is **never chosen by the user** — it is auto-assigned: `SOURCING_ENGINEERS[0].value` (round-robin intended but currently single entry).
- Request IDs use `crypto.randomUUID()` (not `Date.now()`) to prevent collisions.
- `requestNo` is auto-generated on `addRequest` as `CAP-{2-digit FY start}{2-digit FY end}-{4-digit seq}` (e.g. `CAP-2526-0001`).
- Categories in the grid are sourced from `useCapex().categories` with a hardcoded fallback.
- `HEAD_APPROVAL_THRESHOLD = 1_000_000` (₹10L) is defined in `types.ts` — it drives `initialStatusForRequest` in `capexContext.tsx`.

### CAPEX Master — budget heads

The 7 canonical heads are defined as `HEAD_ORDER` in `capex/master/page.tsx` (not in `constants.ts`): `Automation`, `Machinery`, `General`, `Digitization`, `New Business`, `Safety & Security`, `Misc.`. Each has colour styles in `HEAD_STYLE`. User-created heads append after these in `activeHeads` (derived from `masterHeads` + existing item heads). Unknown heads fall back to a neutral slate style.

### Plans and specs

`docs/superpowers/plans/` — implementation plans (date-prefixed, e.g. `2026-05-30-feature-name.md`).
`docs/superpowers/specs/` — design specs that precede implementation.

### Adding new roles or statuses

- Add the role value to `ROLE_NAMES` in `constants.ts`, `ROLE_META` in `Sidebar.tsx`, and `ROLE_GROUPS` in `TopNav.tsx`. If the role is plant-scoped, also add it to `ROLE_PLANT` in `constants.ts` and to the relevant nav entries in the `NAV` array in `Sidebar.tsx`.
- Add a new status to `CapexStatus` in `types.ts`, `CAPEX_STATUS_FLOW`, the `ALLOWED_TRANSITIONS` map in `capexContext.tsx`, `STATUS_COLORS` and `STATUS_LABELS` in `constants.ts`, and any filter/banner logic in page components.
