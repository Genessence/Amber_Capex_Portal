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
| `(internal)` | `/capex/*`, `/sourcing/*`, `/settings` | Authenticated internal portal — wraps `CapexProvider` + `LoginGate` + `Sidebar` + `TopNav`; `/settings` is guarded to `super_admin` only |
| `(public)` | `/supplier/[token]` | Tokenised supplier portal — wraps `CapexProvider` only, no auth |
| *(root)* | `/login` | Role-picker login screen |

`/` redirects to `/login` via `next/navigation`'s `redirect()`.

### Auth model

Mock-only. `LoginPage` writes the selected role to `localStorage("capex_role")`. `LoginGate` redirects to `/login` if absent. `TopNav` exposes a role-switcher dropdown that writes the same key and fires a `capex_rolechange` CustomEvent. All role-aware components listen to that event.

Roles: `buyer`, `sourcing_member`, `sourcing_member_2`, `sourcing_member_3`, `sourcing_member_4`, `sourcing_head`, `super_admin`.

### Status flow

```
draft → submitted → pending_head_approval → sourcing → negotiation → sourcing_approved → buyer_approved
                  ↘ (budget ≤ ₹10L)  → sourcing
                                                        ↘ rejected (at any stage from pending_head_approval onward)
```

`pending_head_approval` is only entered when `budget > ₹10,00,000`. The `CapexProvider` enforces transitions via an explicit allowed-transitions map (not a simple adjacency check).

### State management

`CapexProvider` (`src/lib/capexContext.tsx`) is the single source of truth, mounted in both `(internal)/layout.tsx` and `(public)/layout.tsx`. It exposes `requests`, `vendors`, `invites`, `chatMessages`, `plants`, and `categories` arrays plus mutation functions. `VendorInvite` owns the `quotes[]` and `negotiationThread[]` for each vendor–request pairing.

The supplier portal resolves an invite from the URL token via `resolveInviteByToken` in `src/lib/tokenUtils.ts`.

### Shared constants

`src/lib/constants.ts` is the single source of truth for display maps — do not redefine these inline in components:
- `ROLE_NAMES` — role value → display name
- `STATUS_COLORS` — request status → Tailwind badge classes
- `STATUS_LABELS` — request status → human-readable label
- `INVITE_STATUS_COLORS` — invite status → Tailwind badge classes
- `PRIORITY_COLORS` — priority → Tailwind badge classes
- `SOURCING_ENGINEERS` — sourcing member roles with name + specialisation area
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

`capex/new/page.tsx` is a 3-step flow. Step 1 is an **Excel-style spreadsheet grid**: each row is one line item (columns: Item Description, Category, Quantity, Est. Budget, Plant, Priority, Compliance). Users add/delete rows; on submit each row becomes one `CapexRequest`.

- Sourcing engineer is **never chosen by the user** — it is auto-assigned round-robin at submit time: `SOURCING_ENGINEERS[idx % SOURCING_ENGINEERS.length].value`.
- Request IDs use `crypto.randomUUID()` (not `Date.now()`) to prevent collisions on bulk submit.
- Categories in the grid are sourced from `useCapex().categories` with a hardcoded fallback.

### Adding new roles or statuses

- Add the role value to `ROLE_NAMES` in `constants.ts`, `ROLE_META` in `Sidebar.tsx`, and `ROLE_GROUPS` in `TopNav.tsx`.
- Add a new status to `CapexStatus` in `types.ts`, `CAPEX_STATUS_FLOW`, the transitions map in `capexContext.tsx`, `STATUS_COLORS` in `constants.ts`, and any filter/banner logic in page components.
