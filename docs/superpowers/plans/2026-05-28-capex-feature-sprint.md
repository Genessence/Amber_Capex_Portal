# Capex Amber Feature Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add plant_head role with approval workflow, enhance the new request form with vendor recommendation and master-linked categories, and build a CAPEX master data system with budget tracking and dashboard KPIs.

**Architecture:** Three sequential phases gated by `npx tsc --noEmit`. All state is client-side in `CapexProvider` persisted to `localStorage` under `capex_data_v2`. No new routes — all changes extend existing pages.

**Tech Stack:** Next.js 16 App Router, TypeScript 5, Tailwind v4, shadcn/ui, localStorage

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/lib/types.ts` | Modify | Add `statusHistory`, `remarks`, `VendorRecommendation`, `vendorRecommendation`, `reasonForRequirement`, `benefitsRoi`, `CapexMasterItem` |
| `src/lib/constants.ts` | Modify | Remove surplus roles; add `plant_head`; `SOURCING_ENGINEERS` → 1 entry; replace `jhajjar` with `jhajjar_p1`/`jhajjar_p2` in `PLANTS` |
| `src/lib/capexContext.tsx` | Modify | `updateRequest` gains `actor?` param + statusHistory append; add `capexMaster` state, `usedCrMap`, `getUsedCr`, `updateMasterItem`, `addMasterItem`, `cloneMasterForFY`; persist `capexMaster` |
| `src/lib/mockData.ts` | Modify | Fix `assignedTo`/`plant` on existing mock requests; add 44 `CapexMasterItem` exports |
| `src/components/Sidebar.tsx` | Modify | Remove surplus `ROLE_META` entries; add `plant_head`; update `NAV` for `plant_head`; "Settings" → "Configurations" |
| `src/components/TopNav.tsx` | Modify | Update `ROLE_GROUPS`; `PAGE_LABELS['/settings']` label → "Configurations" |
| `src/app/(internal)/settings/page.tsx` | Modify | `<h1>` → "Configurations"; `Tab` type + `capex_master` tab content |
| `src/app/(internal)/capex/requests/page.tsx` | Modify | Assigned-to + plant columns; status filter dropdown; role-gated filtering with URL param |
| `src/app/(internal)/capex/[id]/page.tsx` | Modify | Status timeline stepper; statusHistory audit trail; `plant_head` approval panel; display `remarks`, `vendorRecommendation`, `reasonForRequirement`, `benefitsRoi` |
| `src/app/(internal)/capex/new/page.tsx` | Modify | `compliance` → `remarks`; vendor rec column; reason/roi columns; master-linked category select; email confirmation screen |
| `src/app/(internal)/capex/dashboard/page.tsx` | Modify | KPI strip above existing donut chart |

---

## Phase 1 — Roles, Visibility & Audit Trail

### Task 1 — Add `statusHistory` to `CapexRequest`; update `updateRequest`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/capexContext.tsx`

- [ ] **Step 1: Add `statusHistory` field to `CapexRequest` in `types.ts`**

In `src/lib/types.ts`, add after `comments?: RequestComment[]`:

```ts
statusHistory?: { status: CapexStatus; actor: string; at: string }[]
```

- [ ] **Step 2: Update `updateRequest` in `capexContext.tsx` to accept `actor` and append history**

Replace the existing `updateRequest` function (lines 139–155) and its interface entry:

```ts
// In CapexContextValue interface, change:
updateRequest: (id: string, updates: Partial<CapexRequest>, actor?: string) => void;

// Implementation:
function updateRequest(id: string, updates: Partial<CapexRequest>, actor?: string) {
  setRequests((prev) =>
    prev.map((req) => {
      if (req.id !== id) return req;
      if (updates.status && updates.status !== req.status) {
        const allowed = ALLOWED_TRANSITIONS[req.status] ?? [];
        if (!allowed.includes(updates.status)) {
          console.error(`[CapexContext] Invalid status transition: ${req.status} → ${updates.status}`);
          return req;
        }
      }
      const historyEntry =
        updates.status && updates.status !== req.status && actor
          ? { status: updates.status, actor, at: new Date().toISOString() }
          : null;
      return {
        ...req,
        ...updates,
        statusHistory: historyEntry
          ? [...(req.statusHistory ?? []), historyEntry]
          : req.statusHistory,
      };
    })
  );
}
```

- [ ] **Step 3: Seed `statusHistory` in `addRequest`**

Replace the existing `addRequest` function:

```ts
function addRequest(req: CapexRequest) {
  const withHistory: CapexRequest = req.statusHistory?.length
    ? req
    : {
        ...req,
        statusHistory: [{ status: req.status, actor: req.createdBy, at: req.createdAt }],
      };
  setRequests((prev) => dedupeById([...prev, withHistory]));
}
```

- [ ] **Step 4: Update all `updateRequest` callers in `capex/[id]/page.tsx` to pass actor**

In `src/app/(internal)/capex/[id]/page.tsx`, the existing handlers at lines ~341–349 become:

```ts
const handleHeadApprove = () => {
  updateRequest(id, { status: "sourcing" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.success("Request approved for sourcing");
}
const handleHeadReject = () => {
  updateRequest(id, { status: "rejected" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.error("Request rejected");
}
const handleSourcingApprove = () => {
  if (bestEntry) approveInvite(bestEntry.inv.id);
  updateRequest(id, { status: "sourcing_approved" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.success("Sent to buyer for approval");
}
const handleBuyerApprove = () => {
  updateRequest(id, { status: "buyer_approved" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.success("Request approved");
}
const handleBuyerReject = () => {
  updateRequest(id, { status: "rejected" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.error("Request rejected");
}
```

- [ ] **Step 5: Verify types**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (or only errors from files not yet updated — fix any `updateRequest` call-site mismatches).

- [ ] **Step 6: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/lib/types.ts src/lib/capexContext.tsx src/app/\(internal\)/capex/\[id\]/page.tsx && git commit -m "feat: add statusHistory to CapexRequest; updateRequest tracks actor"
```

---

### Task 2 — Clean up roles; add `plant_head`; update `PLANTS` and `SOURCING_ENGINEERS`

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Replace the entire contents of `src/lib/constants.ts`**

```ts
export const ROLE_NAMES: Record<string, string> = {
  buyer:          "Arjun Mehta",
  sourcing_member: "Neha Kapoor",
  plant_head:     "Karan Mehta",
  sourcing_head:  "Rajiv Sinha",
  super_admin:    "Super Admin",
}

export const SOURCING_ENGINEERS = [
  { value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" },
]

export const STATUS_COLORS: Record<string, string> = {
  draft:                 "bg-slate-400 text-white",
  submitted:             "bg-blue-600 text-white",
  pending_head_approval: "bg-orange-500 text-white",
  sourcing:              "bg-violet-600 text-white",
  negotiation:           "bg-amber-500 text-slate-900",
  sourcing_approved:     "bg-teal-600 text-white",
  buyer_approved:        "bg-green-600 text-white",
  rejected:              "bg-red-600 text-white",
}

export const STATUS_LABELS: Record<string, string> = {
  draft:                 "Draft",
  submitted:             "Submitted",
  pending_head_approval: "Pending Approval",
  sourcing:              "In Sourcing",
  negotiation:           "Negotiation",
  sourcing_approved:     "Sourcing Approved",
  buyer_approved:        "Approved",
  rejected:              "Rejected",
}

export const PRIORITY_COLORS: Record<string, string> = {
  low:      "bg-slate-300 text-slate-800",
  medium:   "bg-blue-500 text-white",
  high:     "bg-orange-500 text-white",
  critical: "bg-red-600 text-white",
}

export const INVITE_STATUS_COLORS: Record<string, string> = {
  invited:        "bg-slate-400 text-white",
  quote_received: "bg-blue-600 text-white",
  negotiating:    "bg-amber-500 text-slate-900",
  approved:       "bg-green-600 text-white",
  rejected:       "bg-red-600 text-white",
}

export const PLANTS = [
  { value: "jhajjar_p1", label: "Jhajjar Plant 1", state: "Haryana" },
  { value: "jhajjar_p2", label: "Jhajjar Plant 2", state: "Haryana" },
  { value: "chennai",    label: "Chennai",          state: "Tamil Nadu" },
  { value: "rajpura",    label: "Rajpura",          state: "Punjab" },
  { value: "pune",       label: "Pune",             state: "Maharashtra" },
  { value: "ahmedabad",  label: "Ahmedabad",        state: "Gujarat" },
]
```

- [ ] **Step 2: Verify types**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -40
```

Fix any reference errors to removed role names.

- [ ] **Step 3: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/lib/constants.ts && git commit -m "feat: remove surplus sourcing roles; add plant_head; split jhajjar into p1/p2"
```

---

### Task 3 — Fix mock data: `assignedTo` and `plant` values

**Files:**
- Modify: `src/lib/mockData.ts`

- [ ] **Step 1: Update all mock requests**

In `src/lib/mockData.ts`, make these targeted replacements on `mockRequests`:

| Request | Field | Old value | New value |
|---------|-------|-----------|-----------|
| REQ-002 | `assignedTo` | `'sourcing_member_3'` | `'sourcing_member'` |
| REQ-002 | `plant` | `'chennai'` | `'chennai'` (no change) |
| REQ-003 | `assignedTo` | `'sourcing_member_2'` | `'sourcing_member'` |
| REQ-004 | `assignedTo` | `'sourcing_member_2'` | `'sourcing_member'` |
| REQ-006 | `assignedTo` | `'sourcing_member_3'` | `'sourcing_member'` |
| REQ-001 | `plant` | `'jhajjar'` | `'jhajjar_p1'` |
| REQ-006 | `plant` | `'jhajjar'` | `'jhajjar_p1'` |
| REQ-007 | `plant` | `'jhajjar'` | `'jhajjar_p1'` |

- [ ] **Step 2: Verify types**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/lib/mockData.ts && git commit -m "fix: update mock data assignedTo and plant values for role cleanup"
```

---

### Task 4 — Update `Sidebar.tsx`: `ROLE_META`, `NAV`, rename Settings → Configurations

**Files:**
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: Replace `ROLE_META` and `NAV` in `Sidebar.tsx`**

Replace the `ROLE_META` constant (currently lines 12–20):

```ts
const ROLE_META: Record<string, { name: string; label: string; colorClass: string; dot: string; plant?: string }> = {
  buyer:           { name: "Arjun Mehta",  label: "Buyer",          colorClass: "bg-blue-600",   dot: "bg-blue-500"   },
  sourcing_member: { name: "Neha Kapoor",  label: "Sourcing Member", colorClass: "bg-violet-600", dot: "bg-violet-500" },
  plant_head:      { name: "Karan Mehta",  label: "Plant Head",      colorClass: "bg-amber-600",  dot: "bg-amber-500", plant: "all" },
  sourcing_head:   { name: "Rajiv Sinha",  label: "Sourcing Head",   colorClass: "bg-violet-800", dot: "bg-violet-700" },
  super_admin:     { name: "Super Admin",  label: "Full Access",     colorClass: "bg-slate-700",  dot: "bg-slate-500"  },
}
```

Replace the `NAV` constant:

```ts
const NAV: NavLink[] = [
  { href: '/capex/dashboard',  label: 'Dashboard',          icon: LayoutDashboard, roles: ['buyer', 'sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/capex/new',        label: 'New Request',         icon: FilePlus,        roles: ['buyer', 'super_admin'] },
  { href: '/capex/requests',   label: 'Pending Approvals',   icon: List,            roles: ['plant_head'], params: '?filter=pending_head_approval' },
  { href: '/capex/requests',   label: 'All Requests',        icon: List,            roles: ['plant_head'] },
  { href: '/capex/requests',   label: 'Requests',            icon: List,            roles: ['buyer', 'sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/sourcing/vendors', label: 'Vendors',             icon: Users,           roles: ['sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/settings',         label: 'Configurations',      icon: Settings,        roles: ['super_admin'] },
]
```

Update the `NavLink` type to include optional `params`:

```ts
type NavLink = {
  href: string
  label: string
  icon: React.ElementType
  roles?: string[]
  params?: string
}
```

Update the link rendering inside the sidebar JSX to append `params` to the href:

```tsx
// where the Link component renders href, change to:
href={`${link.href}${link.params ?? ''}`}
```

- [ ] **Step 2: Verify types**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/components/Sidebar.tsx && git commit -m "feat: add plant_head nav; remove surplus roles from ROLE_META; rename Settings to Configurations"
```

---

### Task 5 — Update `TopNav.tsx`: `ROLE_GROUPS`, `PAGE_LABELS`

**Files:**
- Modify: `src/components/TopNav.tsx`

- [ ] **Step 1: Replace `ROLE_GROUPS` (lines 7–29)**

```ts
const ROLE_GROUPS = [
  {
    label: "Capital Expenditure",
    roles: [{ value: "buyer", name: "Arjun Mehta", area: "CAPEX Requests" }],
  },
  {
    label: "Plant Leadership",
    roles: [{ value: "plant_head", name: "Karan Mehta", area: "Pending Approvals" }],
  },
  {
    label: "Sourcing",
    roles: [{ value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" }],
  },
  {
    label: "Sourcing Leadership",
    roles: [{ value: "sourcing_head", name: "Rajiv Sinha", area: "All Requests" }],
  },
  {
    label: "Administration",
    roles: [{ value: "super_admin", name: "Super Admin", area: "Full Access" }],
  },
]
```

- [ ] **Step 2: Update `PAGE_LABELS` entry for `/settings`**

```ts
"/settings": { label: "Configurations", sub: "Plants, categories & master data" },
```

- [ ] **Step 3: Update `getRoleBg` helper**

```ts
function getRoleBg(value: string): string {
  if (value === "buyer")          return "bg-blue-600"
  if (value === "plant_head")     return "bg-amber-600"
  if (value.startsWith("sourcing_member")) return "bg-violet-600"
  if (value === "sourcing_head")  return "bg-violet-800"
  return "bg-slate-700"
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/components/TopNav.tsx && git commit -m "feat: update TopNav role groups and settings label rename"
```

---

### Task 6 — Rename Settings page to Configurations

**Files:**
- Modify: `src/app/(internal)/settings/page.tsx`

- [ ] **Step 1: Update `<h1>` and subtitle**

```tsx
// Replace:
<h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
// With:
<h1 className="text-2xl font-semibold text-slate-900">Configurations</h1>

// Replace subtitle:
<p className="text-sm text-slate-500 mt-1">Manage plants, categories, and system users</p>
// With:
<p className="text-sm text-slate-500 mt-1">Manage plants, categories, master data, and system settings</p>
```

- [ ] **Step 2: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/app/\(internal\)/settings/page.tsx && git commit -m "feat: rename Settings page heading to Configurations"
```

---

### Task 7 — Requests page: status filter, assigned-to column, role-gated filtering

**Files:**
- Modify: `src/app/(internal)/capex/requests/page.tsx`

- [ ] **Step 1: Replace the full page component**

```tsx
"use client"

import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { useCapex } from "@/lib/capexContext"
import { ROLE_NAMES, STATUS_COLORS, STATUS_LABELS, PLANTS } from "@/lib/constants"
import type { CapexStatus } from "@/lib/types"

function formatBudget(n?: number) {
  if (n == null) return "—"
  return "₹" + n.toLocaleString("en-IN")
}

function plantLabel(value?: string) {
  if (!value) return "—"
  return PLANTS.find(p => p.value === value)?.label ?? value
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

const ALL_STATUSES = Object.keys(STATUS_LABELS) as CapexStatus[]

export default function RequestsPage() {
  const { requests } = useCapex()
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const [currentRole, setCurrentRole] = useState("buyer")
  const [statusFilter, setStatusFilter] = useState<CapexStatus | "all">(
    (searchParams.get("filter") as CapexStatus) ?? "all"
  )

  useEffect(() => {
    setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener("capex_rolechange", onRoleChange as EventListener)
    return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
  }, [])

  // Sync filter param → state when sidebar link changes it
  useEffect(() => {
    const f = searchParams.get("filter") as CapexStatus | null
    setStatusFilter(f ?? "all")
  }, [searchParams])

  function handleFilterChange(value: CapexStatus | "all") {
    setStatusFilter(value)
    const url = value === "all" ? "/capex/requests" : `/capex/requests?filter=${value}`
    router.replace(url)
  }

  const currentUser = ROLE_NAMES[currentRole] ?? ""

  // Role-gated base filter
  const baseFiltered = (() => {
    if (currentRole === "buyer")
      return requests.filter(r => r.createdBy === currentUser)
    if (currentRole === "sourcing_member")
      return requests.filter(r =>
        r.assignedTo === currentRole &&
        (r.status === "sourcing" || r.status === "negotiation")
      )
    if (currentRole === "plant_head")
      return requests.filter(r => r.status === "pending_head_approval")
    return requests // sourcing_head, super_admin
  })()

  const filtered = statusFilter === "all"
    ? baseFiltered
    : baseFiltered.filter(r => r.status === statusFilter)

  const summaryLabel =
    currentRole === "buyer"           ? "Your submitted requests" :
    currentRole === "sourcing_member" ? "Requests assigned to you" :
    currentRole === "plant_head"      ? "Pending your approval" :
    "All requests"

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="mb-4 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">CAPEX Requests</h1>
          <p className="text-sm text-slate-500 mt-1">
            {summaryLabel} — {filtered.length} request{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => handleFilterChange(e.target.value as CapexStatus | "all")}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="all">All Statuses</option>
          {ALL_STATUSES.map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center flex-1">
          <p className="text-slate-400 font-medium">No requests found.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Request</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider">Status</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden sm:table-cell">Plant</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Assigned To</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden md:table-cell">Budget</th>
                <th className="px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider hidden lg:table-cell">Date</th>
                <th className="px-4 py-3.5 text-right text-[11px] font-bold uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((req, idx) => (
                <tr key={req.id} className={`transition-colors group hover:bg-amber-50/60 ${idx % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  <td className="px-5 py-4 max-w-[240px]">
                    <p className="font-semibold text-slate-900 truncate leading-snug">{req.subject}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{req.id}</p>
                  </td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[req.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {STATUS_LABELS[req.status] ?? req.status}
                    </span>
                  </td>
                  <td className="px-4 py-4 hidden sm:table-cell">
                    <span className="text-[12px] bg-slate-700 text-white px-2 py-0.5 rounded-full font-medium">
                      {plantLabel(req.plant)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-slate-600 hidden md:table-cell">{req.category}</td>
                  <td className="px-4 py-4 text-slate-600 hidden md:table-cell">
                    {ROLE_NAMES[req.assignedTo] ?? req.assignedTo}
                  </td>
                  <td className="px-4 py-4 font-medium text-slate-700 hidden md:table-cell">{formatBudget(req.budget)}</td>
                  <td className="px-4 py-4 text-slate-400 text-[12px] hidden lg:table-cell">{formatDate(req.createdAt)}</td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/capex/${req.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-[12px] font-semibold transition-colors"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Fix Suspense requirement for `useSearchParams`**

Next.js requires a `<Suspense>` boundary around components that call `useSearchParams()`. Wrap the default export:

```tsx
import { Suspense } from "react"

function RequestsPageInner() { /* move all existing code here */ }

export default function RequestsPage() {
  return <Suspense><RequestsPageInner /></Suspense>
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/app/\(internal\)/capex/requests/page.tsx && git commit -m "feat: add status filter, assigned-to column, role-gated filtering to requests page"
```

---

### Task 8 — Detail page: status timeline stepper + audit trail

**Files:**
- Modify: `src/app/(internal)/capex/[id]/page.tsx`

- [ ] **Step 1: Add `StatusTimeline` component above `BuyerView` in the file**

Insert before the `interface BuyerViewProps` declaration:

```tsx
const TIMELINE_STEPS: { key: CapexStatus; label: string }[] = [
  { key: "submitted",             label: "Submitted" },
  { key: "pending_head_approval", label: "Pending Approval" },
  { key: "sourcing",              label: "In Sourcing" },
  { key: "negotiation",           label: "Negotiation" },
  { key: "sourcing_approved",     label: "Sourcing Approved" },
  { key: "buyer_approved",        label: "Approved" },
]

const STEP_ORDER: Record<CapexStatus, number> = {
  draft: -1, submitted: 0, pending_head_approval: 1,
  sourcing: 2, negotiation: 3, sourcing_approved: 4,
  buyer_approved: 5, rejected: -1,
}

function StatusTimeline({ request }: { request: CapexRequest }) {
  const currentIdx = STEP_ORDER[request.status] ?? -1
  const isRejected = request.status === "rejected"

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      {/* Stepper */}
      <div className="relative flex items-start justify-between">
        <div className="absolute top-4 left-[calc(8%)] right-[calc(8%)] h-px bg-slate-200" />
        {TIMELINE_STEPS.map((step, idx) => {
          const done   = !isRejected && idx < currentIdx
          const active = !isRejected && idx === currentIdx
          return (
            <div key={step.key} className="relative flex flex-col items-center gap-1.5 flex-1">
              <div className={[
                "w-8 h-8 rounded-full flex items-center justify-center z-10 text-xs font-bold border-2 transition-all",
                done   ? "bg-amber-500 border-amber-500 text-white" : "",
                active ? "bg-white border-amber-500 text-amber-600 shadow-sm" : "",
                !done && !active ? "bg-white border-slate-200 text-slate-300" : "",
              ].join(" ")}>
                {done
                  ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                  : idx + 1}
              </div>
              <span className={[
                "text-[10px] text-center leading-tight max-w-[72px] hidden sm:block",
                done   ? "text-amber-600 font-medium" : "",
                active ? "text-slate-900 font-semibold" : "",
                !done && !active ? "text-slate-400" : "",
              ].join(" ")}>{step.label}</span>
            </div>
          )
        })}
      </div>
      {isRejected && (
        <p className="text-xs font-semibold text-red-600 text-center">
          This request was rejected{request.rejectionReason ? `: ${request.rejectionReason}` : ""}.
        </p>
      )}

      {/* Audit trail */}
      {request.statusHistory && request.statusHistory.length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">History</p>
          {request.statusHistory.map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px]">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[entry.status] ?? "bg-slate-100 text-slate-600"}`}>
                {STATUS_LABELS[entry.status] ?? entry.status}
              </span>
              <span className="text-slate-500">{entry.actor}</span>
              <span className="text-slate-300 ml-auto">
                {new Date(entry.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add `StatusTimeline` to the shared header section in `CapexDetailPage`**

In the main return block, after the shared header `</div>` (around line 378), and before `{/* Buyer view */}`, insert:

```tsx
{/* Status timeline — visible to all roles */}
<StatusTimeline request={request} />
```

- [ ] **Step 3: Add the `CapexRequest` import type to StatusTimeline**

The `StatusTimeline` component uses `CapexRequest` — confirm it is already imported at the top of the file via `import type { CapexRequest, CapexStatus, ... } from '@/lib/types'`. Add `CapexStatus` to the import if not present.

Also confirm `STATUS_COLORS` and `STATUS_LABELS` are imported from `@/lib/constants`.

- [ ] **Step 4: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/app/\(internal\)/capex/\[id\]/page.tsx && git commit -m "feat: add status timeline stepper and audit trail to request detail page"
```

---

### Task 9 — Detail page: `plant_head` approval panel

**Files:**
- Modify: `src/app/(internal)/capex/[id]/page.tsx`

- [ ] **Step 1: Add `plantHeadRejectReason` state and handler**

In `CapexDetailPage`, add after existing state declarations:

```tsx
const [plantHeadRejectReason, setPlantHeadRejectReason] = useState("")
const [showPlantHeadReject, setShowPlantHeadReject]     = useState(false)
```

Add handlers (alongside existing `handleHeadApprove` etc.):

```tsx
const handlePlantHeadApprove = () => {
  updateRequest(id, { status: "sourcing" }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.success("Request approved — routed to sourcing");
}
const handlePlantHeadReject = () => {
  if (!plantHeadRejectReason.trim()) return;
  updateRequest(id, { status: "rejected", rejectionReason: plantHeadRejectReason.trim() }, ROLE_NAMES[currentRole] ?? currentRole);
  toast.error("Request rejected");
  setShowPlantHeadReject(false);
}
```

- [ ] **Step 2: Add the plant_head approval panel JSX inside the sourcing view block**

In the `{!isBuyer && (...)}` section, after the existing `{currentRole === "sourcing_head" && ...}` block, add:

```tsx
{/* Plant head approval panel */}
{currentRole === "plant_head" && request.status === "pending_head_approval" && (
  <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-4">
    <div>
      <p className="font-semibold text-amber-900">This request requires your approval before sourcing can begin.</p>
      <p className="text-sm text-amber-700 mt-0.5">
        Submitted by {request.createdBy}
        {request.budget ? ` · Estimated budget ₹${request.budget.toLocaleString("en-IN")}` : ""}
        {assignedEngineer ? ` · Will be assigned to ${assignedEngineer.name}` : ""}
      </p>
    </div>
    {!showPlantHeadReject ? (
      <div className="flex gap-2">
        <button
          onClick={handlePlantHeadApprove}
          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors"
        >
          Approve for Sourcing
        </button>
        <button
          onClick={() => setShowPlantHeadReject(true)}
          className="px-4 py-2 rounded-lg bg-white hover:bg-red-50 text-red-600 text-sm font-semibold border border-red-200 transition-colors"
        >
          Reject
        </button>
      </div>
    ) : (
      <div className="space-y-2">
        <textarea
          value={plantHeadRejectReason}
          onChange={e => setPlantHeadRejectReason(e.target.value)}
          placeholder="Reason for rejection (required)"
          rows={3}
          className="w-full text-sm border border-red-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePlantHeadReject}
            disabled={!plantHeadRejectReason.trim()}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
          >
            Confirm Rejection
          </button>
          <button
            onClick={() => { setShowPlantHeadReject(false); setPlantHeadRejectReason("") }}
            className="px-4 py-2 rounded-lg bg-white text-slate-600 text-sm font-semibold border border-slate-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Remove the `SOURCING_ROLES` array referencing deleted roles**

On the line `const SOURCING_ROLES = ["sourcing_member", "sourcing_member_2", ...]`, replace with:

```ts
const SOURCING_ROLES = ["sourcing_member", "sourcing_head", "super_admin"]
```

And update `const isBuyer = currentRole === "buyer"` usage — `plant_head` should also NOT see the buyer view. Update:

```ts
const isBuyer = currentRole === "buyer"
const isPlantHead = currentRole === "plant_head"
```

Then in the JSX, the sourcing block condition:
```tsx
{/* Sourcing view — sourcing roles + plant_head */}
{(!isBuyer) && (
```
This already covers `plant_head` since plant_head is not buyer.

- [ ] **Step 4: Phase 1 type check**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1
```

Fix any remaining errors.

- [ ] **Step 5: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/app/\(internal\)/capex/\[id\]/page.tsx && git commit -m "feat: add plant_head approval panel to request detail page"
```

---

## Phase 2 — New Request Form Enhancements

### Task 10 — Add new types: `remarks`, `VendorRecommendation`, `reasonForRequirement`, `benefitsRoi`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add new interface and fields to `types.ts`**

After the `TechSpecs` interface, add:

```ts
export interface VendorRecommendation {
  type: 'master' | 'manual'
  vendorId?: string
  vendorCode: string
  vendorName: string
  spocName: string
  spocMobile: string
}
```

On `CapexRequest`, add after `comments?`:

```ts
remarks?: string
vendorRecommendation?: VendorRecommendation
reasonForRequirement?: string
benefitsRoi?: string
```

- [ ] **Step 2: Verify types**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/lib/types.ts && git commit -m "feat: add VendorRecommendation type and new CapexRequest fields for Phase 2"
```

---

### Task 11 — New request form: rename column, add vendor rec + reason/roi columns

**Files:**
- Modify: `src/app/(internal)/capex/new/page.tsx`

- [ ] **Step 1: Update `GridRow` type — rename `compliance` to `remarks`, add new fields**

Replace the `GridRow` interface (currently lines 13–22):

```ts
interface GridVendorRec {
  mode: 'select' | 'manual' | ''
  vendorId: string
  vendorCode: string
  vendorName: string
  spocName: string
  spocMobile: string
}

interface GridRow {
  id: string
  description: string
  category: string
  quantity: string
  budget: string
  plant: string
  priority: "low" | "medium" | "high" | "critical" | ""
  remarks: string
  vendorRec: GridVendorRec
  reasonForRequirement: string
  benefitsRoi: string
}
```

Update `emptyRow()`:

```ts
function emptyRow(): GridRow {
  return {
    id: crypto.randomUUID(),
    description: "",
    category: "",
    quantity: "",
    budget: "",
    plant: "",
    priority: "",
    remarks: "",
    vendorRec: { mode: "", vendorId: "", vendorCode: "", vendorName: "", spocName: "", spocMobile: "" },
    reasonForRequirement: "",
    benefitsRoi: "",
  }
}
```

- [ ] **Step 2: Update column header row in the grid**

Replace the `<th>` for "Compliance / Cert":
```tsx
<th className="px-3 py-3 text-left min-w-[140px] font-semibold">Remarks</th>
```

Add new column headers after Remarks:
```tsx
<th className="px-3 py-3 text-left min-w-[200px] font-semibold">Vendor Recommendation</th>
<th className="px-3 py-3 text-left min-w-[160px] font-semibold">Reason for Requirement</th>
<th className="px-3 py-3 text-left min-w-[140px] font-semibold">Benefits / ROI</th>
```

- [ ] **Step 3: Update the Remarks cell (was Compliance)**

Replace the compliance `<td>` cell with:
```tsx
{/* Remarks */}
<td className="px-3 py-2 border-l border-slate-200">
  <input
    className={cellInput}
    placeholder="Optional remarks"
    value={row.remarks}
    onChange={e => updateRow(row.id, "remarks", e.target.value)}
  />
</td>
```

- [ ] **Step 4: Add Vendor Recommendation cell**

After the Remarks cell, add:

```tsx
{/* Vendor Recommendation */}
<td className="px-3 py-2 border-l border-slate-200 min-w-[200px]">
  <VendorRecCell row={row} onUpdate={(rec) => setRows(prev => prev.map(r => r.id === row.id ? { ...r, vendorRec: rec } : r))} vendors={vendors} />
</td>
```

- [ ] **Step 5: Add Reason for Requirement cell**

```tsx
{/* Reason for Requirement */}
<td className="px-3 py-2 border-l border-slate-200">
  <textarea
    className={`${cellInput} resize-none`}
    rows={2}
    placeholder="Why is this needed?"
    value={row.reasonForRequirement}
    onChange={e => updateRow(row.id, "reasonForRequirement", e.target.value)}
  />
</td>
```

- [ ] **Step 6: Add Benefits / ROI cell**

```tsx
{/* Benefits / ROI */}
<td className="px-3 py-2 border-l border-slate-200">
  <textarea
    className={`${cellInput} resize-none`}
    rows={2}
    placeholder="ROI in years or 'Non Calculable'"
    value={row.benefitsRoi}
    onChange={e => updateRow(row.id, "benefitsRoi", e.target.value)}
  />
</td>
```

- [ ] **Step 7: Add `VendorRecCell` component**

Import `useCapex` vendors at the top of the page (already imported) and add `Vendor` to the type imports.

Add this component above `NewCapexPage`:

```tsx
function VendorRecCell({
  row, onUpdate, vendors
}: {
  row: GridRow
  onUpdate: (rec: GridVendorRec) => void
  vendors: import("@/lib/types").Vendor[]
}) {
  const rec = row.vendorRec

  if (rec.mode === 'manual') {
    return (
      <div className="space-y-1">
        <input className={cellInput} placeholder="Vendor Code*" value={rec.vendorCode}
          onChange={e => onUpdate({ ...rec, vendorCode: e.target.value })} />
        <input className={cellInput} placeholder="Vendor Name*" value={rec.vendorName}
          onChange={e => onUpdate({ ...rec, vendorName: e.target.value })} />
        <input className={cellInput} placeholder="SPOC Name*" value={rec.spocName}
          onChange={e => onUpdate({ ...rec, spocName: e.target.value })} />
        <input
          className={`${cellInput} ${rec.spocMobile && !/^\d{10}$/.test(rec.spocMobile) ? "ring-1 ring-red-400" : ""}`}
          placeholder="SPOC Mobile (10 digits)*"
          value={rec.spocMobile}
          onChange={e => onUpdate({ ...rec, spocMobile: e.target.value })}
        />
        <button type="button" className="text-[11px] text-slate-400 hover:text-slate-600 underline"
          onClick={() => onUpdate({ mode: '', vendorId: '', vendorCode: '', vendorName: '', spocName: '', spocMobile: '' })}>
          ← Select from master
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <select
        className={cellSelect}
        value={rec.vendorId}
        onChange={e => {
          const v = vendors.find(v => v.id === e.target.value)
          if (!v) { onUpdate({ ...rec, mode: '', vendorId: '' }); return }
          onUpdate({ mode: 'select', vendorId: v.id, vendorCode: v.vendorCode, vendorName: v.vendorName, spocName: v.contactName, spocMobile: '' })
        }}
      >
        <option value="">— select vendor —</option>
        {vendors.map(v => (
          <option key={v.id} value={v.id}>{v.vendorName} — {v.vendorCode}</option>
        ))}
      </select>
      <button type="button" className="text-[11px] text-amber-500 hover:text-amber-700 underline"
        onClick={() => onUpdate({ ...rec, mode: 'manual' })}>
        + Add new vendor
      </button>
    </div>
  )
}
```

- [ ] **Step 8: Update `handleSubmit` to include new fields**

In `handleSubmit`, update the `CapexRequest` construction:

```ts
const req: CapexRequest = {
  id:            reqId,
  subject:       row.description,
  category:      row.category,
  quantity:      row.quantity,
  budget:        budgetNum,
  priority:      (row.priority || "medium") as CapexRequest["priority"],
  justification: "",
  techSpecs:     { specifications: "", complianceStandards: "" },
  remarks:       row.remarks || undefined,
  vendorRecommendation: row.vendorRec.mode
    ? {
        type:      row.vendorRec.mode as 'master' | 'manual',
        vendorId:  row.vendorRec.vendorId || undefined,
        vendorCode: row.vendorRec.vendorCode,
        vendorName: row.vendorRec.vendorName,
        spocName:   row.vendorRec.spocName,
        spocMobile: row.vendorRec.spocMobile,
      }
    : undefined,
  reasonForRequirement: row.reasonForRequirement || undefined,
  benefitsRoi:   row.benefitsRoi || undefined,
  assignedTo,
  status:        initialStatusForRequest(budgetNum),
  statusHistory: [{ status: initialStatusForRequest(budgetNum), actor: createdBy, at: new Date().toISOString() }],
  createdBy,
  createdAt:     new Date().toISOString(),
  plant,
}
```

Also add `const { addRequest, categories: ctxCategories, vendors } = useCapex()` (add `vendors` to the destructure).

- [ ] **Step 9: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -30
git add src/app/\(internal\)/capex/new/page.tsx && git commit -m "feat: rename compliance to remarks; add vendor rec, reason, and ROI columns to new request grid"
```

---

### Task 12 — Detail page: display Phase 2 fields

**Files:**
- Modify: `src/app/(internal)/capex/[id]/page.tsx`

- [ ] **Step 1: Add remarks + vendor rec + reason + ROI to the `BuyerView` request summary grid**

In `BuyerView`, inside the "Request Details" card, after the existing fields array, add:

```tsx
{request.remarks && (
  <div className="col-span-2 md:col-span-3">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Remarks</p>
    <p className="text-sm text-slate-600">{request.remarks}</p>
  </div>
)}
{request.reasonForRequirement && (
  <div className="col-span-2 md:col-span-3">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Reason for Requirement</p>
    <p className="text-sm text-slate-600 leading-relaxed">{request.reasonForRequirement}</p>
  </div>
)}
{request.benefitsRoi && (
  <div className="col-span-2 md:col-span-3">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Benefits / ROI</p>
    <p className="text-sm text-slate-600 leading-relaxed">{request.benefitsRoi}</p>
  </div>
)}
{request.vendorRecommendation && (
  <div className="col-span-2 md:col-span-3">
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Buyer Recommendation</p>
    <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full self-start ${request.vendorRecommendation.type === 'master' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
        {request.vendorRecommendation.type === 'master' ? 'From master' : 'Manually added'}
      </span>
      {[
        { label: "Vendor Code", value: request.vendorRecommendation.vendorCode },
        { label: "Vendor Name", value: request.vendorRecommendation.vendorName },
        { label: "SPOC Name",   value: request.vendorRecommendation.spocName },
        { label: "SPOC Mobile", value: request.vendorRecommendation.spocMobile },
      ].filter(f => f.value).map(({ label, value }) => (
        <div key={label}>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
          <p className="text-sm font-semibold text-slate-800">{value}</p>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 2: Add the same fields to the sourcing view's "Request details + tech specs" card**

In the sourcing section's details card (the one with "Business Justification"), add after the existing justification block:

```tsx
{request.remarks && (
  <div>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Remarks</p>
    <p className="text-sm text-slate-700 leading-relaxed">{request.remarks}</p>
  </div>
)}
{request.vendorRecommendation && (
  <div>
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Buyer Recommendation</p>
    <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 flex flex-wrap gap-x-8 gap-y-2">
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full self-start ${request.vendorRecommendation.type === 'master' ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}>
        {request.vendorRecommendation.type === 'master' ? 'From master' : 'Manually added'}
      </span>
      {[
        { label: "Code",   value: request.vendorRecommendation.vendorCode },
        { label: "Name",   value: request.vendorRecommendation.vendorName },
        { label: "SPOC",   value: request.vendorRecommendation.spocName },
        { label: "Mobile", value: request.vendorRecommendation.spocMobile },
      ].filter(f => f.value).map(({ label, value }) => (
        <div key={label}>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</p>
          <p className="text-sm font-semibold text-slate-800">{value}</p>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/app/\(internal\)/capex/\[id\]/page.tsx && git commit -m "feat: display remarks, vendor recommendation, reason, and ROI on request detail page"
```

---

### Task 13 — New request form: post-submission email confirmation screen

**Files:**
- Modify: `src/app/(internal)/capex/new/page.tsx`

- [ ] **Step 1: Replace the `step === "sent"` render block**

Find the current `sent` state render (the existing `if (step === "sent")` block) and replace its entire body:

```tsx
if (step === "sent") {
  const submittedRows = rows  // captured at submit time — pass through state instead
  return (
    <div className="py-8 px-6">
      <StepBar step="sent" />
      <div className="max-w-2xl mx-auto">
        <div className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Email header */}
          <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">✉</span>
              <p className="font-bold text-slate-900 text-sm">New CAPEX Request — Submission Confirmation</p>
            </div>
            <div className="text-[12px] text-slate-500 space-y-0.5">
              <p><span className="font-semibold text-slate-700 w-8 inline-block">From:</span> {ROLE_NAMES[currentRole] ?? currentRole} &lt;capex@amber.in&gt;</p>
              <p><span className="font-semibold text-slate-700 w-8 inline-block">To:</span> Plant Head — Approvals</p>
              <p><span className="font-semibold text-slate-700 w-8 inline-block">CC:</span> Sourcing Team</p>
              <p><span className="font-semibold text-slate-700 w-8 inline-block">Sub:</span> CAPEX Request — {submittedIds.length} item{submittedIds.length !== 1 ? "s" : ""} submitted</p>
            </div>
          </div>

          {/* Email body */}
          <div className="px-5 py-5 space-y-4">
            <p className="text-sm text-slate-700">Dear Plant Head,</p>
            <p className="text-sm text-slate-700">
              The following CAPEX item{submittedIds.length !== 1 ? "s have" : " has"} been submitted for review.
              Please find the summary below.
            </p>

            {/* Summary table */}
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-100 text-slate-600">
                    <th className="px-3 py-2 text-left font-semibold">Item</th>
                    <th className="px-3 py-2 text-left font-semibold">Plant</th>
                    <th className="px-3 py-2 text-left font-semibold">Qty</th>
                    <th className="px-3 py-2 text-left font-semibold">Est. Budget</th>
                    <th className="px-3 py-2 text-left font-semibold">Remarks</th>
                    <th className="px-3 py-2 text-left font-semibold">Routing</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const budgetNum = row.budget ? Number(row.budget) : undefined
                    const needsApproval = budgetNum !== undefined && budgetNum > HEAD_APPROVAL_THRESHOLD
                    const plant = PLANTS.find(p => p.value === row.plant)
                    return (
                      <tr key={row.id} className="bg-white">
                        <td className="px-3 py-2 font-medium text-slate-800">{row.description || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{plant?.label ?? row.plant ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600">{row.quantity || "—"}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {budgetNum ? `₹${budgetNum.toLocaleString("en-IN")}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-500 max-w-[140px] truncate">{row.remarks || "—"}</td>
                        <td className="px-3 py-2">
                          {needsApproval ? (
                            <span className="text-orange-600 font-semibold">⏳ Pending Plant Head Approval</span>
                          ) : (
                            <span className="text-violet-600 font-semibold">→ Routed to Sourcing</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-sm text-slate-500">
              Regards,<br />{ROLE_NAMES[currentRole] ?? currentRole}
            </p>
          </div>

          {/* Footer actions */}
          <div className="bg-slate-50 border-t border-slate-200 px-5 py-4 flex gap-3">
            <button
              onClick={() => router.push(`/capex/${submittedIds[0]}`)}
              className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
            >
              View Request
            </button>
            <button
              onClick={() => { setRows([emptyRow()]); setStep("form") }}
              className="px-4 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors"
            >
              New Request
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

Also ensure `PLANTS` is imported from `@/lib/constants`.

- [ ] **Step 2: Phase 2 type check**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1
```

Fix any errors.

- [ ] **Step 3: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/app/\(internal\)/capex/new/page.tsx && git commit -m "feat: replace sent screen with email confirmation preview"
```

---

## Phase 3 — CAPEX Master & Dashboard KPIs

### Task 14 — Add `CapexMasterItem` type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add `CapexMasterItem` to `types.ts`**

At the end of `src/lib/types.ts`, add:

```ts
export interface CapexMasterItem {
  id: string
  plant: string
  head: string
  department: string
  subParticulars: string
  rateCr: number
  qty: number
  totalCostCr: number
  budgetAllocatedCr: number
  financialYear: string
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -10
git add src/lib/types.ts && git commit -m "feat: add CapexMasterItem type"
```

---

### Task 15 — Seed mock master data (44 items)

**Files:**
- Modify: `src/lib/mockData.ts`

- [ ] **Step 1: Add `CapexMasterItem` import and export to `mockData.ts`**

Add `CapexMasterItem` to the import line at the top:

```ts
import { CapexRequest, Vendor, VendorInvite, CapexMasterItem } from './types';
```

- [ ] **Step 2: Add the JJR Plant 1 master items export (append to end of file)**

```ts
export const mockCapexMaster: CapexMasterItem[] = [
  // ── JJR Plant 1 ──────────────────────────────────────────────────────────
  // Automation — budgetAllocatedCr: 1.65
  { id: "m-p1-a1",  plant:"jhajjar_p1", head:"Automation",        department:"HEX",                       subParticulars:"HEX Black Copper Detection",                                              rateCr:0.11,    qty:3,  totalCostCr:0.33,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  { id: "m-p1-a2",  plant:"jhajjar_p1", head:"Automation",        department:"IMM",                       subParticulars:"Part Conveying System (Injection Machine to Mezzanine)",                  rateCr:1.05,    qty:1,  totalCostCr:1.05,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  { id: "m-p1-a3",  plant:"jhajjar_p1", head:"Automation",        department:"RAC Quality",               subParticulars:"Printing Part Inspection",                                                rateCr:0.10,    qty:1,  totalCostCr:0.10,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  { id: "m-p1-a4",  plant:"jhajjar_p1", head:"Automation",        department:"RAC Quality",               subParticulars:"Remote Testing",                                                          rateCr:0.04,    qty:1,  totalCostCr:0.04,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  { id: "m-p1-a5",  plant:"jhajjar_p1", head:"Automation",        department:"RAC Quality",               subParticulars:"CFF Testing SPM",                                                         rateCr:0.07,    qty:1,  totalCostCr:0.07,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  { id: "m-p1-a6",  plant:"jhajjar_p1", head:"Automation",        department:"RAC Quality",               subParticulars:"PCB Checking Jig",                                                        rateCr:0.06,    qty:1,  totalCostCr:0.06,   budgetAllocatedCr:1.65, financialYear:"2026-27" },
  // Machinery — budgetAllocatedCr: 2.20
  { id: "m-p1-m1",  plant:"jhajjar_p1", head:"Machinery",         department:"HEX",                       subParticulars:"Shrinkless Vertical M/C",                                                 rateCr:2.10,    qty:1,  totalCostCr:2.10,   budgetAllocatedCr:2.20, financialYear:"2026-27" },
  { id: "m-p1-m2",  plant:"jhajjar_p1", head:"Machinery",         department:"HEX",                       subParticulars:"Scissor Lifter",                                                          rateCr:0.05,    qty:1,  totalCostCr:0.05,   budgetAllocatedCr:2.20, financialYear:"2026-27" },
  { id: "m-p1-m3",  plant:"jhajjar_p1", head:"Machinery",         department:"HEX",                       subParticulars:"BOPT (Battery Operated Pallet Truck)",                                    rateCr:0.05,    qty:1,  totalCostCr:0.05,   budgetAllocatedCr:2.20, financialYear:"2026-27" },
  // General — budgetAllocatedCr: 2.755
  { id: "m-p1-g1",  plant:"jhajjar_p1", head:"General",           department:"IMM",                       subParticulars:"Centralised Material Feeding for Molding Machines",                       rateCr:1.50,    qty:1,  totalCostCr:1.50,   budgetAllocatedCr:2.755,financialYear:"2026-27" },
  { id: "m-p1-g2",  plant:"jhajjar_p1", head:"General",           department:"RAC",                       subParticulars:"Declined Conveyors from Mezzanine to RAC Drop Points",                   rateCr:0.045,   qty:9,  totalCostCr:0.405,  budgetAllocatedCr:2.755,financialYear:"2026-27" },
  { id: "m-p1-g3",  plant:"jhajjar_p1", head:"General",           department:"Maintenance",               subParticulars:"DG 1010 KVA",                                                             rateCr:0.75,    qty:1,  totalCostCr:0.75,   budgetAllocatedCr:2.755,financialYear:"2026-27" },
  { id: "m-p1-g4",  plant:"jhajjar_p1", head:"General",           department:"Moulding",                  subParticulars:"Stepping Motor Bush Mould",                                               rateCr:0.10,    qty:1,  totalCostCr:0.10,   budgetAllocatedCr:2.755,financialYear:"2026-27" },
  // Digitization — budgetAllocatedCr: 0.785
  { id: "m-p1-d1",  plant:"jhajjar_p1", head:"Digitization",      department:"Innovation / Data Analyst", subParticulars:"Plant ESG/EMS",                                                           rateCr:0.40,    qty:1,  totalCostCr:0.40,   budgetAllocatedCr:0.785,financialYear:"2026-27" },
  { id: "m-p1-d2",  plant:"jhajjar_p1", head:"Digitization",      department:"Innovation / Data Analyst", subParticulars:"Trolley RFID Detection",                                                  rateCr:0,       qty:0,  totalCostCr:0,      budgetAllocatedCr:0.785,financialYear:"2026-27" },
  { id: "m-p1-d3",  plant:"jhajjar_p1", head:"Digitization",      department:"Innovation / Data Analyst", subParticulars:"RAC Parameter Monitoring",                                                rateCr:0,       qty:0,  totalCostCr:0,      budgetAllocatedCr:0.785,financialYear:"2026-27" },
  { id: "m-p1-d4",  plant:"jhajjar_p1", head:"Digitization",      department:"Innovation / Data Analyst", subParticulars:"Manpower Cost Monitoring",                                                rateCr:0,       qty:0,  totalCostCr:0,      budgetAllocatedCr:0.785,financialYear:"2026-27" },
  { id: "m-p1-d5",  plant:"jhajjar_p1", head:"Digitization",      department:"Innovation / Data Analyst", subParticulars:"MES for Water Purifier",                                                  rateCr:0.20,    qty:1,  totalCostCr:0.20,   budgetAllocatedCr:0.785,financialYear:"2026-27" },
  { id: "m-p1-d6",  plant:"jhajjar_p1", head:"Digitization",      department:"Utility",                   subParticulars:"Digital Competency for Utility",                                          rateCr:0.0037,  qty:50, totalCostCr:0.185,  budgetAllocatedCr:0.785,financialYear:"2026-27" },
  // New Business — budgetAllocatedCr: 2.10
  { id: "m-p1-n1",  plant:"jhajjar_p1", head:"New Business",      department:"HEX",                       subParticulars:"Mezzanine, Goods Lift & Utilities",                                       rateCr:2.10,    qty:1,  totalCostCr:2.10,   budgetAllocatedCr:2.10, financialYear:"2026-27" },
  // Safety & Security — budgetAllocatedCr: 0.81
  { id: "m-p1-s1",  plant:"jhajjar_p1", head:"Safety & Security", department:"Safety & Security",         subParticulars:"Weighbridge Upgrade + Intrusion Detection + Fire Alarm + Extinguishers",  rateCr:0.806,   qty:1,  totalCostCr:0.81,   budgetAllocatedCr:0.81, financialYear:"2026-27" },
  // Misc. — budgetAllocatedCr: 0.25
  { id: "m-p1-x1",  plant:"jhajjar_p1", head:"Misc.",             department:"—",                         subParticulars:"Miscellaneous",                                                           rateCr:0.25,    qty:1,  totalCostCr:0.25,   budgetAllocatedCr:0.25, financialYear:"2026-27" },

  // ── JJR Plant 2 ──────────────────────────────────────────────────────────
  // Automation — budgetAllocatedCr: 1.804
  { id: "m-p2-a1",  plant:"jhajjar_p2", head:"Automation",        department:"Assembly",                  subParticulars:"PD Gun, Fan Torque Tool, Label Printing & Pasting, Carton Box Pick & Place, Valve Plate SPM", rateCr:0.60,  qty:1,  totalCostCr:0.60,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a2",  plant:"jhajjar_p2", head:"Automation",        department:"Copper",                    subParticulars:"Auto Brazing - Induction (Copper Shop)",                                  rateCr:0.36,    qty:1,  totalCostCr:0.36,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a3",  plant:"jhajjar_p2", head:"Automation",        department:"Copper",                    subParticulars:"Auto Brazing - PNG (Copper Shop) i4 Inhouse",                             rateCr:0.30,    qty:1,  totalCostCr:0.30,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a4",  plant:"jhajjar_p2", head:"Automation",        department:"Assembly",                  subParticulars:"Compressor Lifting SPM",                                                  rateCr:0,       qty:1,  totalCostCr:0,      budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a5",  plant:"jhajjar_p2", head:"Automation",        department:"Assembly",                  subParticulars:"Auto Shut Off Gun",                                                       rateCr:0.10,    qty:1,  totalCostCr:0.10,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a6",  plant:"jhajjar_p2", head:"Automation",        department:"HEX",                       subParticulars:"Black Copper Detection",                                                  rateCr:0.042,   qty:7,  totalCostCr:0.294,  budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a7",  plant:"jhajjar_p2", head:"Automation",        department:"HEX",                       subParticulars:"Lacing Conveyor 5mm",                                                     rateCr:0.05,    qty:1,  totalCostCr:0.05,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  { id: "m-p2-a8",  plant:"jhajjar_p2", head:"Automation",        department:"Dispatch",                  subParticulars:"Auto Scanning & Tracking of Loading/Unloading",                           rateCr:0.10,    qty:1,  totalCostCr:0.10,   budgetAllocatedCr:1.804,financialYear:"2026-27" },
  // Machinery — budgetAllocatedCr: 6.025
  { id: "m-p2-m1",  plant:"jhajjar_p2", head:"Machinery",         department:"IMM",                       subParticulars:"Injection Moulding Machine for ODU Fan Guard (Set of 2)",                 rateCr:2.92,    qty:1,  totalCostCr:2.92,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m2",  plant:"jhajjar_p2", head:"Machinery",         department:"Copper",                    subParticulars:"IDU Setup for i4 - 1200 nos./day",                                        rateCr:1.20,    qty:1,  totalCostCr:1.20,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m3",  plant:"jhajjar_p2", head:"Machinery",         department:"Press",                     subParticulars:"RTS Replacement (Press Shop Line 1)",                                     rateCr:0.10,    qty:6,  totalCostCr:0.60,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m4",  plant:"jhajjar_p2", head:"Machinery",         department:"Tool Room",                 subParticulars:"Universal Vertical Milling Machine",                                      rateCr:0.17,    qty:1,  totalCostCr:0.17,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m5",  plant:"jhajjar_p2", head:"Machinery",         department:"Store",                     subParticulars:"Jib Crane",                                                               rateCr:0.15,    qty:1,  totalCostCr:0.15,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m6",  plant:"jhajjar_p2", head:"Machinery",         department:"Store",                     subParticulars:"Semi Automatic Electric Stacker",                                         rateCr:0.08,    qty:1,  totalCostCr:0.08,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m7",  plant:"jhajjar_p2", head:"Machinery",         department:"Quality",                   subParticulars:"Dummy Vacuum Setup at Line 2",                                            rateCr:0.0075,  qty:42, totalCostCr:0.315,  budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m8",  plant:"jhajjar_p2", head:"Machinery",         department:"Utility",                   subParticulars:"DG Sync Panel",                                                           rateCr:0.50,    qty:1,  totalCostCr:0.50,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m9",  plant:"jhajjar_p2", head:"Machinery",         department:"Utility",                   subParticulars:"APFC Panel",                                                              rateCr:0.05,    qty:1,  totalCostCr:0.05,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  { id: "m-p2-m10", plant:"jhajjar_p2", head:"Machinery",         department:"Utility",                   subParticulars:"Diesel Storage & Distribution Management",                                rateCr:0.04,    qty:1,  totalCostCr:0.04,   budgetAllocatedCr:6.025,financialYear:"2026-27" },
  // General — budgetAllocatedCr: 4.56
  { id: "m-p2-g1",  plant:"jhajjar_p2", head:"General",           department:"Building",                  subParticulars:"Mezzanine above Assembly Line 2 (30,000 Sq. Ft.)",                        rateCr:3.90,    qty:1,  totalCostCr:3.90,   budgetAllocatedCr:4.56, financialYear:"2026-27" },
  { id: "m-p2-g2",  plant:"jhajjar_p2", head:"General",           department:"HEX",                       subParticulars:"Fin Press Puff Cabin",                                                    rateCr:0.25,    qty:1,  totalCostCr:0.25,   budgetAllocatedCr:4.56, financialYear:"2026-27" },
  { id: "m-p2-g3",  plant:"jhajjar_p2", head:"General",           department:"Store",                     subParticulars:"MS Rack for RM Storage",                                                  rateCr:0.03,    qty:10, totalCostCr:0.30,   budgetAllocatedCr:4.56, financialYear:"2026-27" },
  { id: "m-p2-g4",  plant:"jhajjar_p2", head:"General",           department:"Maint",                     subParticulars:"Maint Store Cabin & Storage Rack",                                        rateCr:0.11,    qty:1,  totalCostCr:0.11,   budgetAllocatedCr:4.56, financialYear:"2026-27" },
  // Digitization — budgetAllocatedCr: 0.685
  { id: "m-p2-d1",  plant:"jhajjar_p2", head:"Digitization",      department:"—",                         subParticulars:"Plant ESG/EMS + Trolley RFID + RAC Monitoring + Manpower Cost",           rateCr:0.50,    qty:1,  totalCostCr:0.50,   budgetAllocatedCr:0.685,financialYear:"2026-27" },
  { id: "m-p2-d2",  plant:"jhajjar_p2", head:"Digitization",      department:"—",                         subParticulars:"Digital Competency for Utility",                                          rateCr:0.0037,  qty:50, totalCostCr:0.185,  budgetAllocatedCr:0.685,financialYear:"2026-27" },
  // Safety & Security — budgetAllocatedCr: 0.76
  { id: "m-p2-s1",  plant:"jhajjar_p2", head:"Safety & Security", department:"—",                         subParticulars:"CCTV + Intrusion System + Smart Fire Alarm",                              rateCr:0.76,    qty:1,  totalCostCr:0.76,   budgetAllocatedCr:0.76, financialYear:"2026-27" },
  // Misc. — budgetAllocatedCr: 0.20
  { id: "m-p2-x1",  plant:"jhajjar_p2", head:"Misc.",             department:"—",                         subParticulars:"Sudden Expenses / Unplanned Additions",                                   rateCr:0.20,    qty:1,  totalCostCr:0.20,   budgetAllocatedCr:0.20, financialYear:"2026-27" },
]
```

- [ ] **Step 3: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -10
git add src/lib/mockData.ts && git commit -m "feat: seed 44 CapexMasterItem entries for JJR Plant 1 and Plant 2"
```

---

### Task 16 — `CapexProvider`: `capexMaster` state, `usedCrMap`, mutations

**Files:**
- Modify: `src/lib/capexContext.tsx`

- [ ] **Step 1: Add imports and state**

Add to the import line at top:

```ts
import { mockCapexMaster } from './mockData';
import type { CapexMasterItem } from './types';
```

Add to `CapexContextValue` interface:

```ts
capexMaster: CapexMasterItem[]
getUsedCr: (plant: string, head: string) => number
updateMasterItem: (id: string, updates: Partial<CapexMasterItem>) => void
addMasterItem: (item: CapexMasterItem) => void
cloneMasterForFY: (newFY: string) => void
```

Add state variable inside `CapexProvider` (alongside other `useState` calls):

```ts
const [capexMaster, setCapexMaster] = useState<CapexMasterItem[]>([]);
```

- [ ] **Step 2: Update localStorage load effect to hydrate `capexMaster`**

Inside the first `useEffect` (the load effect), add inside the `if (raw)` block:

```ts
if (parsed.capexMaster?.length) {
  setCapexMaster(parsed.capexMaster);
} else {
  setCapexMaster(mockCapexMaster);
}
```

And in the `else` block (no stored data):

```ts
setCapexMaster(mockCapexMaster);
```

And in the `catch` block:

```ts
setCapexMaster(mockCapexMaster);
```

- [ ] **Step 3: Update the save effect to persist `capexMaster`**

Replace:

```ts
localStorage.setItem(STORAGE_KEY, JSON.stringify({ requests, vendors, invites, chatMessages, plants, categories }));
```

With:

```ts
localStorage.setItem(STORAGE_KEY, JSON.stringify({ requests, vendors, invites, chatMessages, plants, categories, capexMaster }));
```

Also add `capexMaster` to the dependency array of this effect.

- [ ] **Step 4: Add `usedCrMap` memo and `getUsedCr` function**

After the `categories` state declaration, add:

```ts
const usedCrMap = React.useMemo(() => {
  const map = new Map<string, number>();
  for (const item of capexMaster) {
    const key = `${item.plant}:${item.head}`;
    if (map.has(key)) continue;
    const used = requests
      .filter(r =>
        r.plant === item.plant &&
        r.category === item.head &&
        (r.status === 'sourcing_approved' || r.status === 'buyer_approved')
      )
      .reduce((sum, r) => sum + (r.budget ?? 0) / 1e7, 0);
    map.set(key, used);
  }
  return map;
}, [capexMaster, requests]);

function getUsedCr(plant: string, head: string): number {
  return usedCrMap.get(`${plant}:${head}`) ?? 0;
}
```

Add `React` to the import if not already: `import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';`

Or use `useMemo` directly since it's already destructured — replace `React.useMemo` with `useMemo`.

- [ ] **Step 5: Add master mutations**

```ts
function updateMasterItem(id: string, updates: Partial<CapexMasterItem>) {
  setCapexMaster(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
}

function addMasterItem(item: CapexMasterItem) {
  setCapexMaster(prev => [...prev, item]);
}

function cloneMasterForFY(newFY: string) {
  setCapexMaster(prev => [
    ...prev,
    ...prev
      .filter(item => {
        // Only clone the most recent FY (avoid re-cloning old FYs)
        const allFYs = [...new Set(prev.map(i => i.financialYear))].sort();
        const latestFY = allFYs[allFYs.length - 1];
        return item.financialYear === latestFY;
      })
      .map(item => ({ ...item, id: crypto.randomUUID(), financialYear: newFY })),
  ]);
}
```

- [ ] **Step 6: Add all new functions/values to the Provider's `value` prop**

```ts
capexMaster,
getUsedCr,
updateMasterItem,
addMasterItem,
cloneMasterForFY,
```

- [ ] **Step 7: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/lib/capexContext.tsx && git commit -m "feat: add capexMaster state, usedCrMap, getUsedCr and master mutations to CapexProvider"
```

---

### Task 17 — New request form: master-linked category select + budget indicator

**Files:**
- Modify: `src/app/(internal)/capex/new/page.tsx`

- [ ] **Step 1: Add `capexMaster` and `getUsedCr` to the `useCapex()` destructure**

```ts
const { addRequest, categories: ctxCategories, vendors, capexMaster, getUsedCr } = useCapex()
```

- [ ] **Step 2: Replace the Category cell in the grid row**

Find the Category `<td>` cell in the row map. Replace it with:

```tsx
{/* Category */}
<td className="px-3 py-2 border-l border-slate-200">
  {row.plant ? (
    (() => {
      const plantItems = capexMaster.filter(m => m.plant === row.plant && m.financialYear === "2026-27");
      const heads = [...new Set(plantItems.map(m => m.head))];
      return (
        <select
          className={cellSelect}
          value={row.category}
          onChange={e => {
            const item = plantItems.find(m => m.subParticulars === e.target.value || m.head === e.target.value);
            if (item) {
              setRows(prev => prev.map(r => r.id === row.id ? {
                ...r,
                category: item.head,
                description: r.description || item.subParticulars,
                budget: r.budget || String(Math.round(item.totalCostCr * 1e7)),
              } : r));
            } else {
              updateRow(row.id, "category", e.target.value);
            }
          }}
        >
          <option value="">— select —</option>
          {heads.map(head => (
            <optgroup key={head} label={head}>
              {plantItems.filter(m => m.head === head).map(m => (
                <option key={m.id} value={m.subParticulars}>{m.subParticulars}</option>
              ))}
            </optgroup>
          ))}
        </select>
      );
    })()
  ) : (
    <select
      className={cellSelect}
      value={row.category}
      onChange={e => updateRow(row.id, "category", e.target.value)}
    >
      <option value="">— select plant first —</option>
      {categories.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  )}
</td>
```

- [ ] **Step 3: Add budget remaining indicator below the Est. Budget input**

In the Est. Budget `<td>`, after the existing input, add:

```tsx
{row.plant && row.category && (() => {
  const allocated = capexMaster.find(m => m.plant === row.plant && m.head === row.category)?.budgetAllocatedCr ?? 0;
  const used = getUsedCr(row.plant, row.category);
  const remaining = allocated - used;
  const budgetNum = row.budget ? Number(row.budget) / 1e7 : 0;
  const wouldExceed = budgetNum > 0 && (used + budgetNum) > allocated;
  if (allocated === 0) return null;
  return (
    <div className="mt-0.5 space-y-0.5">
      <p className={`text-[10px] font-semibold ${remaining <= allocated * 0.1 ? "text-red-500" : "text-slate-400"}`}>
        Remaining: ₹{remaining.toFixed(2)} Cr
      </p>
      {wouldExceed && (
        <p className="text-[10px] font-semibold text-amber-600">⚠ Exceeds allocated budget</p>
      )}
    </div>
  );
})()}
```

- [ ] **Step 4: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/app/\(internal\)/capex/new/page.tsx && git commit -m "feat: master-linked category select with budget indicator in new request grid"
```

---

### Task 18 — Dashboard: KPI strip

**Files:**
- Modify: `src/app/(internal)/capex/dashboard/page.tsx`

- [ ] **Step 1: Add role + capexMaster to the page**

At the top of `DashboardPage` (or wherever the existing `useMemo` and state are), add:

```tsx
const { requests, capexMaster, getUsedCr } = useCapex()
const [currentRole, setCurrentRole] = useState("buyer")

useEffect(() => {
  setCurrentRole(localStorage.getItem("capex_role") ?? "buyer")
  const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
  window.addEventListener("capex_rolechange", onRoleChange as EventListener)
  return () => window.removeEventListener("capex_rolechange", onRoleChange as EventListener)
}, [])
```

- [ ] **Step 2: Compute role-scoped requests and KPI values**

Add before the return:

```tsx
import { ROLE_NAMES } from '@/lib/constants'

// Role scoping
const scopedRequests = useMemo(() => {
  if (currentRole === "buyer")
    return requests.filter(r => r.createdBy === (ROLE_NAMES[currentRole] ?? ""))
  if (currentRole === "sourcing_member")
    return requests.filter(r => r.assignedTo === currentRole)
  return requests
}, [requests, currentRole])

const currentFY = "2026-27"
const masterItems = capexMaster.filter(m => m.financialYear === currentFY)
const totalBudget = masterItems.reduce((s, m) => s + m.budgetAllocatedCr, 0)
// De-dupe by plant:head so we sum usedCr once per combo
const usedBudget = useMemo(() => {
  const seen = new Set<string>()
  let total = 0
  for (const m of masterItems) {
    const key = `${m.plant}:${m.head}`
    if (seen.has(key)) continue
    seen.add(key)
    total += getUsedCr(m.plant, m.head)
  }
  return total
}, [masterItems, getUsedCr])

const kpis = [
  { label: "Total Budget",       value: `₹${totalBudget.toFixed(2)} Cr`,   sub: "FY 2026-27" },
  { label: "Budget Utilised",    value: `₹${usedBudget.toFixed(2)} Cr`,    sub: totalBudget > 0 ? `${((usedBudget / totalBudget) * 100).toFixed(1)}%` : "—" },
  { label: "Submitted",          value: String(scopedRequests.filter(r => r.status !== "draft").length),          sub: "requests" },
  { label: "Pending Approval",   value: String(scopedRequests.filter(r => r.status === "pending_head_approval").length), sub: "" },
  { label: "In Negotiation",     value: String(scopedRequests.filter(r => r.status === "negotiation").length),    sub: "" },
  { label: "Sourcing Approved",  value: String(scopedRequests.filter(r => r.status === "sourcing_approved").length), sub: "" },
  { label: "Approved",           value: String(scopedRequests.filter(r => r.status === "buyer_approved").length), sub: "" },
  { label: "Rejected",           value: String(scopedRequests.filter(r => r.status === "rejected").length),       sub: "" },
]
```

- [ ] **Step 3: Render KPI strip before the existing donut chart JSX**

At the very start of the page's return JSX (before the existing content), add:

```tsx
{/* KPI strip */}
<div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
  {kpis.map(kpi => (
    <div key={kpi.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 leading-tight">{kpi.label}</p>
      <p className="text-xl font-bold text-slate-900 leading-none">{kpi.value}</p>
      {kpi.sub && <p className="text-[11px] text-slate-400 mt-0.5">{kpi.sub}</p>}
    </div>
  ))}
</div>
```

- [ ] **Step 4: Verify + commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1 | head -20
git add src/app/\(internal\)/capex/dashboard/page.tsx && git commit -m "feat: add KPI strip to dashboard with role-scoped budget and request counts"
```

---

### Task 19 — Configurations page: CAPEX Master tab

**Files:**
- Modify: `src/app/(internal)/settings/page.tsx`

- [ ] **Step 1: Add `capexMaster` imports and state**

Add to destructure from `useCapex()`:

```ts
const { plants, categories, addPlant, removePlant, addCategory, removeCategory, resetData,
        capexMaster, updateMasterItem, addMasterItem, cloneMasterForFY, getUsedCr } = useCapex();
```

Add `CapexMasterItem` to the type imports at the top.

- [ ] **Step 2: Update `Tab` type and tabs array**

```ts
type Tab = 'plants' | 'categories' | 'users' | 'system' | 'capex_master';

const tabs: { key: Tab; label: string }[] = [
  { key: 'capex_master', label: 'CAPEX Master' },
  { key: 'plants',       label: 'Plants' },
  { key: 'categories',   label: 'Categories' },
  { key: 'users',        label: 'Users' },
  { key: 'system',       label: 'System' },
];
```

Update `useState<Tab>` initial value to `'capex_master'`.

- [ ] **Step 3: Add state for FY selector, inline editing, new row**

```ts
const allFYs = [...new Set(capexMaster.map(m => m.financialYear))].sort();
const [selectedFY, setSelectedFY] = useState(allFYs[allFYs.length - 1] ?? "2026-27");
const [editingId, setEditingId] = useState<string | null>(null);
const [editDraft, setEditDraft] = useState<Partial<CapexMasterItem>>({});
const [addingHead, setAddingHead] = useState<string | null>(null);
const [newRowDraft, setNewRowDraft] = useState<Partial<CapexMasterItem>>({});
const [showFYModal, setShowFYModal] = useState(false);

function nextFY(fy: string): string {
  const [a, b] = fy.split("-").map(Number);
  return `${a + 1}-${b + 1}`;
}
const computedNextFY = nextFY(selectedFY);
const nextFYExists = capexMaster.some(m => m.financialYear === computedNextFY);
```

- [ ] **Step 4: Add the CAPEX Master tab JSX**

Inside the tab content area, add after the existing tab blocks:

```tsx
{activeTab === 'capex_master' && (
  <div className="space-y-4">
    {/* FY controls */}
    <div className="flex items-center gap-3 justify-between flex-wrap">
      <div className="flex items-center gap-2">
        <label className="text-sm font-semibold text-slate-700">Financial Year:</label>
        <select
          value={selectedFY}
          onChange={e => setSelectedFY(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {allFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
        </select>
      </div>
      <button
        disabled={nextFYExists}
        onClick={() => setShowFYModal(true)}
        className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
      >
        Start New FY ({computedNextFY})
      </button>
    </div>

    {/* FY Modal */}
    {showFYModal && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
          <h2 className="font-bold text-slate-900">Start New Financial Year</h2>
          <p className="text-sm text-slate-600">
            This will carry over the master structure from <strong>{selectedFY}</strong> to <strong>{computedNextFY}</strong> with zero usage. Are you sure?
          </p>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setShowFYModal(false)} className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-700">Cancel</button>
            <button
              onClick={() => { cloneMasterForFY(computedNextFY); setSelectedFY(computedNextFY); setShowFYModal(false); }}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Master table grouped by plant → head */}
    {(() => {
      const fyItems = capexMaster.filter(m => m.financialYear === selectedFY);
      const isPastFY = selectedFY !== (allFYs[allFYs.length - 1] ?? selectedFY);
      const plants = [...new Set(fyItems.map(m => m.plant))];

      return plants.map(plant => {
        const plantItems = fyItems.filter(m => m.plant === plant);
        const heads = [...new Set(plantItems.map(m => m.head))];
        const plantLabel = plant; // PLANTS.find(p => p.value === plant)?.label ?? plant — import PLANTS if needed

        return (
          <div key={plant} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="bg-slate-800 text-white px-4 py-2.5 text-sm font-bold">{plantLabel}</div>
            {heads.map(head => {
              const headItems = plantItems.filter(m => m.head === head);
              const usedCr = getUsedCr(plant, head);
              const allocated = headItems[0]?.budgetAllocatedCr ?? 0;

              return (
                <div key={head}>
                  <div className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
                    <span>{head}</span>
                    {!isPastFY && (
                      <button
                        onClick={() => { setAddingHead(head); setNewRowDraft({ plant, head, financialYear: selectedFY, rateCr: 0, qty: 0, totalCostCr: 0, budgetAllocatedCr: allocated }); }}
                        className="text-[11px] font-semibold text-amber-600 hover:text-amber-800"
                      >+ Add Item</button>
                    )}
                  </div>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-400 text-[10px] uppercase tracking-wider">
                        <th className="px-4 py-2 text-left">Sub Particulars</th>
                        <th className="px-3 py-2 text-right">Rate (Cr)</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Total (Cr)</th>
                        <th className="px-3 py-2 text-right">Allocated (Cr)</th>
                        <th className="px-3 py-2 text-right">Used (Cr)</th>
                        <th className="px-3 py-2 text-right">Remaining (Cr)</th>
                        {!isPastFY && <th className="px-3 py-2" />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {headItems.map(item => {
                        const remaining = item.budgetAllocatedCr - usedCr;
                        const rowColor =
                          remaining < 0 ? "bg-red-50" :
                          remaining < item.budgetAllocatedCr * 0.1 ? "bg-amber-50" :
                          "";
                        const isEditing = editingId === item.id;

                        if (isEditing) {
                          const draft = editDraft;
                          const draftTotal = ((draft.rateCr ?? item.rateCr) * (draft.qty ?? item.qty));
                          return (
                            <tr key={item.id} className="bg-blue-50">
                              <td className="px-4 py-2"><input className="w-full text-xs border border-slate-200 rounded px-2 py-1" value={draft.subParticulars ?? item.subParticulars} onChange={e => setEditDraft(d => ({ ...d, subParticulars: e.target.value }))} /></td>
                              <td className="px-3 py-2"><input type="number" step="0.001" className="w-20 text-xs border border-slate-200 rounded px-2 py-1 text-right" value={draft.rateCr ?? item.rateCr} onChange={e => setEditDraft(d => ({ ...d, rateCr: Number(e.target.value) }))} /></td>
                              <td className="px-3 py-2"><input type="number" className="w-16 text-xs border border-slate-200 rounded px-2 py-1 text-right" value={draft.qty ?? item.qty} onChange={e => setEditDraft(d => ({ ...d, qty: Number(e.target.value) }))} /></td>
                              <td className="px-3 py-2 text-right text-slate-500">{draftTotal.toFixed(3)}</td>
                              <td className="px-3 py-2"><input type="number" step="0.001" className="w-20 text-xs border border-slate-200 rounded px-2 py-1 text-right" value={draft.budgetAllocatedCr ?? item.budgetAllocatedCr} onChange={e => setEditDraft(d => ({ ...d, budgetAllocatedCr: Number(e.target.value) }))} /></td>
                              <td className="px-3 py-2 text-right">{usedCr.toFixed(3)}</td>
                              <td className="px-3 py-2 text-right">{(item.budgetAllocatedCr - usedCr).toFixed(3)}</td>
                              <td className="px-3 py-2 text-right space-x-2">
                                <button onClick={() => { updateMasterItem(item.id, { ...draft, totalCostCr: draftTotal }); setEditingId(null); setEditDraft({}); }} className="text-green-600 font-semibold hover:underline">Save</button>
                                <button onClick={() => { setEditingId(null); setEditDraft({}); }} className="text-slate-400 hover:underline">Cancel</button>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={item.id} className={`${rowColor} hover:bg-amber-50/40 cursor-pointer`} onClick={() => { if (!isPastFY) { setEditingId(item.id); setEditDraft({}); } }}>
                            <td className="px-4 py-2 text-slate-700">{item.subParticulars}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{item.rateCr}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{item.qty}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{item.totalCostCr.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{item.budgetAllocatedCr.toFixed(3)}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{usedCr.toFixed(3)}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${remaining < 0 ? "text-red-600" : remaining < item.budgetAllocatedCr * 0.1 ? "text-amber-600" : "text-slate-700"}`}>
                              {remaining.toFixed(3)}
                            </td>
                            {!isPastFY && <td className="px-3 py-2 text-slate-300 text-center">✎</td>}
                          </tr>
                        );
                      })}

                      {/* Add new row inline */}
                      {addingHead === head && !isPastFY && (
                        <tr className="bg-green-50">
                          <td className="px-4 py-2"><input className="w-full text-xs border border-slate-200 rounded px-2 py-1" placeholder="Sub Particulars" value={newRowDraft.subParticulars ?? ""} onChange={e => setNewRowDraft(d => ({ ...d, subParticulars: e.target.value }))} /></td>
                          <td className="px-3 py-2"><input type="number" step="0.001" className="w-20 text-xs border border-slate-200 rounded px-2 py-1 text-right" placeholder="Rate" value={newRowDraft.rateCr ?? ""} onChange={e => setNewRowDraft(d => ({ ...d, rateCr: Number(e.target.value) }))} /></td>
                          <td className="px-3 py-2"><input type="number" className="w-16 text-xs border border-slate-200 rounded px-2 py-1 text-right" placeholder="Qty" value={newRowDraft.qty ?? ""} onChange={e => setNewRowDraft(d => ({ ...d, qty: Number(e.target.value) }))} /></td>
                          <td className="px-3 py-2 text-right text-slate-400 text-xs">{(((newRowDraft.rateCr ?? 0) * (newRowDraft.qty ?? 0))).toFixed(3)}</td>
                          <td className="px-3 py-2"><input type="number" step="0.001" className="w-20 text-xs border border-slate-200 rounded px-2 py-1 text-right" placeholder="Allocated" value={newRowDraft.budgetAllocatedCr ?? ""} onChange={e => setNewRowDraft(d => ({ ...d, budgetAllocatedCr: Number(e.target.value) }))} /></td>
                          <td colSpan={2} />
                          <td className="px-3 py-2 text-right space-x-2">
                            <button onClick={() => {
                              const rateCr = newRowDraft.rateCr ?? 0;
                              const qty    = newRowDraft.qty ?? 0;
                              addMasterItem({
                                id: crypto.randomUUID(),
                                plant, head,
                                department: newRowDraft.department ?? "—",
                                subParticulars: newRowDraft.subParticulars ?? "",
                                rateCr, qty,
                                totalCostCr: rateCr * qty,
                                budgetAllocatedCr: newRowDraft.budgetAllocatedCr ?? allocated,
                                financialYear: selectedFY,
                              });
                              setAddingHead(null); setNewRowDraft({});
                            }} className="text-green-600 font-semibold hover:underline text-xs">Add</button>
                            <button onClick={() => { setAddingHead(null); setNewRowDraft({}); }} className="text-slate-400 hover:underline text-xs">Cancel</button>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        );
      });
    })()}
  </div>
)}
```

Also add `PLANTS` import from `@/lib/constants` if you want to resolve the plant label, or just use the raw plant value (the code above does the latter — fine for now).

- [ ] **Step 5: Phase 3 final type check**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1
```

Fix all remaining errors.

- [ ] **Step 6: Commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add src/app/\(internal\)/settings/page.tsx && git commit -m "feat: add CAPEX Master tab to Configurations page with inline editing and FY management"
```

---

### Task 20 — Final smoke test

- [ ] **Step 1: Start dev server**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npm run dev
```

- [ ] **Step 2: Verify Phase 1 flows**

1. Log in as `buyer` → submit a request with budget > ₹10L → verify it enters `pending_head_approval`
2. Switch to `plant_head` → Sidebar shows "Pending Approvals" and "All Requests"  
3. Open the request → Approval panel visible, approve → status moves to `sourcing`
4. Open the request again → StatusTimeline shows correct step, History shows two entries
5. Requests page → status filter dropdown works; Assigned To column shows name

- [ ] **Step 3: Verify Phase 2 flows**

1. As `buyer`, open New Request → grid shows Remarks, Vendor Rec, Reason, ROI columns
2. Fill vendor rec via master select — auto-fills
3. Fill vendor rec via "Add new vendor" — 4 fields appear
4. Submit → email confirmation screen appears with routing column
5. View Request → detail page shows Remarks, Buyer Recommendation, Reason, ROI

- [ ] **Step 4: Verify Phase 3 flows**

1. New Request → select Jhajjar Plant 1 → Category shows grouped heads/sub-particulars  
2. Select a sub-particular → description and budget auto-fill; remaining indicator appears
3. Dashboard → KPI strip shows 8 cards with live counts
4. Configurations (super_admin) → CAPEX Master tab loads with 44 items grouped; click row to edit; Start New FY modal works

- [ ] **Step 5: Final type check**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Final commit**

```bash
cd /home/div-dev/div_dev_code/Capex_amber && git add -A && git commit -m "chore: final Phase 3 smoke test pass"
```
