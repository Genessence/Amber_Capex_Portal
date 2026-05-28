# Capex Amber — Feature Sprint Design

**Date:** 2026-05-28  
**Phases:** 3 (Roles & Visibility → New Request Form → CAPEX Master & Dashboard)  
**Constraint:** Entirely client-side; no API routes, server components, or database. All state in `CapexProvider` + `localStorage`.

---

## Phase 1 — Roles, Users & Visibility

### 1.1 Role cleanup

**Remove** from `constants.ts`, `types.ts` (if referenced), `Sidebar.tsx` (`ROLE_META`), `TopNav.tsx` (`ROLE_GROUPS`), and `mockData.ts`:
- `sourcing_member_2`, `sourcing_member_3`, `sourcing_member_4`

**Keep:** `sourcing_member` — display name "Sourcing Member"

**Add:** `plant_head`
- Display name: "Plant Head"
- Persona name: "Karan Mehta" (used in `ROLE_META` for the sidebar user footer)
- Associated plant: `plant: 'all'` (stored in `ROLE_META` as a `plant` field). For the demo, the single plant head sees requests from **all** plants — no plant filter is applied. The filtering logic in the requests list and KPI scoping must check `ROLE_META[role].plant === 'all'` and skip the plant filter in that case. In production, each plant head would have a specific plant value here — this is a demo-only hardcode; do not implement it as a system-level constraint.
- Color: amber (`bg-amber-600` / `dot: bg-amber-500`)

**`SOURCING_ENGINEERS`** in `constants.ts` becomes a 1-entry array:
```ts
[{ value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" }]
```
Round-robin in `capex/new` always assigns `sourcing_member`.

**Mock data:** all `assignedTo` values of `sourcing_member_2/3/4` → replaced with `sourcing_member`.

---

### 1.2 Status history & plant head approval

**New field on `CapexRequest`** (`types.ts`):
```ts
statusHistory?: { status: CapexStatus; actor: string; at: string }[]
```
- `actor` = `ROLE_NAMES[role]` (display name, not role key)
- Seeded on new request creation: `[{ status: initialStatus, actor: createdBy, at: createdAt }]`
- Appended on every `updateRequest(id, { status: newStatus })` call — all transition sites in the codebase must pass `actor` so `CapexProvider` can append the entry. The `updateRequest` signature gains an optional third argument `actor?: string`; callers that transition status must supply it.

**Plant head approval panel** on `/capex/[id]`:
- Visible when: `role === 'plant_head'` AND `request.status === 'pending_head_approval'`
- Approve button: transitions to `sourcing`, appends history entry
- Reject button: opens a small inline textarea for `rejectionReason` (required), then transitions to `rejected`, appends history entry
- Panel is a card rendered above the main request details

**Detail page timeline/stepper:**
A horizontal stepper showing the status flow in order:
`Submitted → Pending Approval → In Sourcing → Negotiation → Sourcing Approved → Approved`
with `Rejected` shown as a separate branch indicator.
- Current status step is highlighted (amber ring)
- Completed steps shown with a checkmark
- Below the stepper: a "History" section lists `statusHistory` entries as a vertical timeline (status label + actor name + formatted date)

---

### 1.3 Sidebar navigation for plant_head

`plant_head` gets exactly these nav entries (no Dashboard, New Request, Vendors, or Configurations):
- "Pending Approvals" → `/capex/requests?filter=pending_head_approval`
- "All Requests" → `/capex/requests`

The `ROLE_META` for `plant_head` includes `plant: 'all'`. No plant filter is applied for the demo.

---

### 1.4 Visibility improvements

**Requests list (`/capex/requests`):**

New columns added to every row:
- **Status** — badge using `STATUS_COLORS` + `STATUS_LABELS`
- **Assigned To** — display name from `ROLE_NAMES[request.assignedTo]`
- **Plant** — label from `PLANTS.find(p => p.value === request.plant)?.label`

Status filter dropdown above the table:
- Options: "All Statuses" + each `CapexStatus` value rendered with its `STATUS_LABELS` label
- Initialised from URL param `?filter=<status>` (enables sidebar deep-link for plant_head)
- Updates URL param on change (via `router.replace`, no full navigation)

Role-based row filtering (applied before status filter):
| Role | Visible requests |
|------|-----------------|
| `buyer` | `createdBy === ROLE_NAMES[role]` |
| `sourcing_member` | `assignedTo === role` AND `status` in `['sourcing', 'negotiation']` |
| `plant_head` | `status === 'pending_head_approval'` (no plant filter for demo) |
| `sourcing_head` | all |
| `super_admin` | all |

Action column: "View" link for all roles; additional role-specific CTAs (e.g. "Review" for sourcing_member) can be added per existing patterns in the file.

---

## Phase 2 — New Request Form & Vendor Recommendation

### 2.1 Rename "Compliance" → "Remarks"

- Column header: "Compliance / Cert" → **"Remarks"**
- `GridRow.compliance` → `GridRow.remarks`
- `CapexRequest`: add top-level `remarks?: string` field. The existing `techSpecs.complianceStandards` field is retained for actual compliance standards (entered elsewhere in the flow), but the Step 1 grid column now maps to `remarks`.
- Submission mapper: `remarks: row.remarks` (instead of `techSpecs.complianceStandards: row.compliance`)
- Detail page: display `remarks` in the Info section (replaces or supplements the compliance display)

### 2.2 Vendor Recommendation

**New type** (`types.ts`):
```ts
interface VendorRecommendation {
  type: 'master' | 'manual'
  vendorId?: string       // only when type === 'master'
  vendorCode: string
  vendorName: string
  spocName: string
  spocMobile: string      // 10-digit; validated on blur
}
```

**On `CapexRequest`:** `vendorRecommendation?: VendorRecommendation`

**Grid column** (after "Remarks"):
- Default state: a searchable `<select>` populated from `useCapex().vendors` (shows `vendorName — vendorCode`)
- On master vendor select: auto-fills `vendorCode`, `vendorName`, and `spocMobile` from the vendor record; `spocName` maps to `contactName`; sets `type: 'master'`
- "Add new vendor" toggle link below the select: hides the select, reveals 4 inline text inputs (Vendor Code, Vendor Name, SPOC Name, SPOC Mobile); sets `type: 'manual'`
- The manually entered vendor is **not** saved to the master `vendors[]` list — it lives only on the request
- 10-digit mobile validation: shown as a red cell border on blur if invalid, does not block submission

**Detail page — "Buyer Recommendation" sub-section:**
- Shown in the Info section, visible to all internal roles
- Displays: Vendor Code, Vendor Name, SPOC Name, SPOC Mobile
- Label: "From master" (amber badge) or "Manually added" (slate badge)

### 2.3 Reason for Requirement & Benefits / ROI

**New fields on `CapexRequest`:**
```ts
reasonForRequirement?: string
benefitsRoi?: string
```

**Grid columns** (after "Vendor Recommendation"):
- "Reason for Requirement" — compact `<textarea>` cell, 2-row fixed height, free text
- "Benefits / ROI" — same; placeholder: `"ROI in years or 'Non Calculable'"`
- Styled as Excel-style cells: no label, no border except the table grid lines, same `cellInput` class pattern

**Detail page:** Both fields displayed in the Info section below Remarks.

---

## Phase 3 — CAPEX Master & Dashboard KPIs

### 3.1 Data model

**New type** (`types.ts`):
```ts
interface CapexMasterItem {
  id: string
  plant: string               // 'jhajjar_p1' | 'jhajjar_p2' | ...
  head: string                // 'Automation' | 'Machinery' | 'General' | etc.
  department: string
  subParticulars: string
  rateCr: number              // rate per unit, stored in Crore
  qty: number
  totalCostCr: number         // = rateCr * qty
  budgetAllocatedCr: number   // fixed sanctioned cap for this head+plant; editable only by super_admin in the Settings tab; does NOT auto-sum from item totals — adding or editing items does not change it
  financialYear: string       // '2026-27'
}
```

`usedCr` is **not stored** on the item — it is derived dynamically (see §3.3).

> **Unit note:** `rateCr` stores values in Crore — the source Excel column was labelled "Rate (Rs)" but all values are in Crore. `totalCostCr = rateCr × qty`.
>
> **Rate correction:** The "Digital Competency for Utility" entries in both plants use `rateCr: 0.0037` (not `0.000037`) so that `0.0037 × 50 = 0.185 Cr` matches the given total.

**`CapexProvider` changes:**
- New state: `capexMaster: CapexMasterItem[]`
- New mutations: `updateMasterItem(id, updates)`, `addMasterItem(item)`, `cloneMasterForFY(newFY: string)`
- `capexMaster` is persisted to `localStorage` alongside other state

**`mockData.ts`:** Seeded with all 44 items (22 × JJR Plant 1 at `jhajjar_p1`, 22 × JJR Plant 2 at `jhajjar_p2`). `budgetAllocatedCr` is set at seed time to the sum of `totalCostCr` for all items sharing the same `head` + `plant` — this represents the sanctioned budget cap and does not change when items are later added or edited inline.

**PLANTS constant update:**
Replace `{ value: "jhajjar", ... }` with:
```ts
{ value: "jhajjar_p1", label: "Jhajjar Plant 1", state: "Haryana" },
{ value: "jhajjar_p2", label: "Jhajjar Plant 2", state: "Haryana" },
```
Mock request `plant` values of `"jhajjar"` → updated to `"jhajjar_p1"`.

---

### 3.2 Link master to new request form

If no plant is selected yet, the Category cell shows the flat `useCapex().categories` list as a fallback (existing behaviour). The grouped master select only activates after a plant is chosen.

When a grid row's **Plant** cell changes:
- Category `<select>` is replaced by a grouped `<select>`:
  - `<optgroup label={head}>` containing `<option value={item.id}>{item.subParticulars}</option>` for each master item in that plant
- On sub-particular select:
  - `row.description` ← `item.subParticulars`
  - `row.budget` ← `String(item.totalCostCr * 1e7)` (converted to Rs)
  - `row.category` ← `item.head` exactly (e.g. `"Automation"`) — this is critical so that the `r.category === item.head` filter in `usedCrMap` matches correctly

**Inline budget indicator** in the row (below the budget input):
- `"Remaining: ₹X Cr"` where X = `budgetAllocatedCr - usedCr` for that head × plant
- Red text if remaining ≤ 10% of `budgetAllocatedCr`

**Over-budget warning:**
- If `(usedCr + budgetNum/1e7) > budgetAllocatedCr`, show an amber warning chip in the row: `"⚠ Exceeds allocated budget for this head"`
- Submission is **not** blocked — plant head approval is the gate

---

### 3.3 `usedCr` derivation

`usedCr` is a **head-level** metric — all items sharing the same `plant` + `head` consume from the same budget pool. The map key is `${plant}:${head}`, computed once per combo to avoid double-counting.

In `CapexProvider`:
```ts
const usedCrMap = useMemo(() => {
  const map = new Map<string, number>()
  for (const item of capexMaster) {
    const key = `${item.plant}:${item.head}`
    if (map.has(key)) continue          // already computed for this head
    const used = requests
      .filter(r =>
        r.plant === item.plant &&
        r.category === item.head &&
        (r.status === 'sourcing_approved' || r.status === 'buyer_approved')
      )
      .reduce((sum, r) => sum + (r.budget ?? 0) / 1e7, 0)
    map.set(key, used)
  }
  return map
}, [capexMaster, requests])
```

Exposed as `getUsedCr: (plant: string, head: string) => number` on the context value. All call sites (grid budget indicator, Settings table, KPI strip) pass `item.plant, item.head`. The "Used (Cr)" column in the Settings table shows the same value for every row within a head — correct, since budget is tracked at head granularity.

---

### 3.4 Configurations — CAPEX Master tab

The existing `/settings` page is renamed to **"Configurations"** throughout the UI:
- Sidebar nav label: "Settings" → "Configurations" (route `/settings` stays unchanged)
- `TopNav` `PAGE_LABELS` entry updated: `{ label: "Configurations", sub: "Plants, categories & master data" }`
- Page `<h1>` heading updated to "Configurations"
- The existing `Tab` type gains a new value: `'capex_master'`

**Layout:** FY selector (`<select>`) at the top right showing all distinct `financialYear` values present in `capexMaster`. "Start New FY" button beside it.

Button disabled condition: `capexMaster` already contains items with `financialYear === nextFY`. Next FY is computed by splitting the current FY string on `"-"`, parsing both parts as integers, and adding 1 to each — e.g. `"2026-27"` → split → `[2026, 27]` → add 1 → `[2027, 28]` → join → `"2027-28"`.

**Table:** Grouped by Plant section → Head sub-section → rows per item.
Columns: Sub Particulars | Rate (Cr) | Qty | Total (Cr) | Allocated (Cr) | Used (Cr) | Remaining (Cr)

Row states:
- Normal: white
- Remaining < 10% of Allocated: amber background (`bg-amber-50 border-amber-200`)
- Remaining < 0: red background (`bg-red-50 border-red-200`)

**Inline editing:** clicking a row enters edit mode for that row (Rate, Qty, Sub Particulars are `<input>` elements; Total = `rateCr × qty` shown read-only; `budgetAllocatedCr` is also editable inline by super_admin). "Save" / "Cancel" buttons on the row.

**Add Item:** "Add Item" button per Head group appends an empty editable row to that head in the current FY + plant.

**Start New FY flow:**
1. Click "Start New FY" → modal: "This will carry over the master structure to FY XXXX-XX with zero usage. Continue?"
2. On confirm: `cloneMasterForFY(nextFY)` clones all items for the current FY, sets `financialYear = nextFY`; `usedCr` is always derived, so no reset needed
3. Old FY data shown read-only when a past FY is selected in the selector

---

### 3.5 Dashboard KPIs

**Location:** `/capex/dashboard` — a KPI strip rendered above the existing donut chart.

**8 KPI cards in a responsive row:**
| KPI | Logic |
|-----|-------|
| Total Budget (Cr) | `sum(budgetAllocatedCr)` across master items in current FY |
| Utilised (Cr) | `sum(getUsedCr(item.id))` across master items in current FY |
| Utilisation % | Utilised / Total × 100 |
| Requests Submitted | `requests.filter(r => r.status !== 'draft').length` |
| Pending Approval | `requests.filter(r => r.status === 'pending_head_approval').length` |
| In Negotiation | `requests.filter(r => r.status === 'negotiation').length` |
| Approved | `requests.filter(r => ['sourcing_approved','buyer_approved'].includes(r.status)).length` |
| Rejected | `requests.filter(r => r.status === 'rejected').length` |

**Role scoping (applied before all counts):**
| Role | Filter |
|------|--------|
| `buyer` | `r.createdBy === ROLE_NAMES[role]` |
| `plant_head` | no filter (same as sourcing_head for the demo) |
| `sourcing_member` | `r.assignedTo === role` |
| `sourcing_head` / `super_admin` | no filter |

Budget KPIs scope `capexMaster` to all plants for the demo (no plant filter for `plant_head`).

---

### Post-Submission Confirmation Screen

When `step === 'sent'` in `capex/new`:

Replace the current sent state with a full email-preview card (narrow centred layout, same `max-w-2xl mx-auto` as the rest of the form):

```
┌─────────────────────────────────────────────────────┐
│  ✉  New CAPEX Request — Approval Required           │
│─────────────────────────────────────────────────────│
│  From:  Arjun Mehta <buyer@amber.in>                │
│  To:    Plant Head — Jhajjar Plant 1                │
│  CC:    Sourcing Team                               │
│  Sub:   CAPEX Request — [N] item(s) submitted       │
│─────────────────────────────────────────────────────│
│  Dear Plant Head,                                   │
│                                                     │
│  The following CAPEX items have been submitted...   │
│                                                     │
│  [Summary table: Item | Plant | Qty | Budget | Remarks | Vendor | Routing] │
│                                                     │
│  "Routing" column: "⏳ Pending Plant Head Approval" │
│  if budget > ₹10L, else "→ Routed to Sourcing"     │
│─────────────────────────────────────────────────────│
│  [View Request]          [New Request]              │
└─────────────────────────────────────────────────────┘
```

- The card is styled to look like an email client pane (white card, thin border, header row with `bg-slate-50`)
- "View Request" → `router.push('/capex/requests/' + submittedIds[0])`
  - Wait: the detail route is `/capex/[id]`, so → `router.push('/capex/' + submittedIds[0])`
- "New Request" → resets `rows` to `[emptyRow()]` and `setStep('form')`
- The `StepBar` shows step 3 ("Submitted") as active

---

## Constraints (all phases)

- No database, API routes, or server components
- Full-width no-scroll layout for list/table pages; narrow centred for form/settings pages
- All new display constants in `constants.ts`; all new types in `types.ts`
- `crypto.randomUUID()` for all new IDs
- Tailwind v4 only — no `tailwind.config`
- shadcn/ui for all new UI components
- `npx tsc --noEmit` must pass after each phase before proceeding
