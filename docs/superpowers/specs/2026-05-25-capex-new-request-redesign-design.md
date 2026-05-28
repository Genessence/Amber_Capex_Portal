# CAPEX New Request Redesign — Design Spec
**Date:** 2026-05-25

## Overview

Replace the existing 3-step wizard at `/capex/new` with a single-page professional form. Introduce a head-approval gate for high-value requests, expand the sourcing team roster, and add `quantity` and `assignedTo` fields to `CapexRequest`.

---

## 1. Form Layout

Single scrollable page at `/capex/new`, accessible to `buyer` and `super_admin` roles only.

Three labeled sections rendered top-to-bottom with no step navigation:

### Section A — Request Overview
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Subject | text input | Yes | Replaces "Title" |
| Category | select | Yes | Machinery, Infrastructure, IT, Tooling |
| Quantity | text input | Yes | Free text, e.g. "5 units", "2 sets" |
| Business Justification | textarea | Yes | Why this asset is needed |

### Section B — Technical Specifications
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Capacity / Output Required | text input | No | e.g. "5-axis, 800mm table" |
| Power & Utility Requirements | text input | No | e.g. "3-phase 415V, 45kVA" |
| Installation & Civil Requirements | textarea | No | Site prep, civil work |
| Compliance & Certification Standards | text input | No | e.g. "ISO 9001:2015, CE Marking" |

### Section C — Budget & Sourcing Assignment
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Estimated Budget (INR) | number input | No | Optional — drives approval routing |
| Assign to Sourcing Engineer | select | Yes | Dropdown of 4 sourcing personas |
| Priority | select | Yes | Low / Medium / High / Critical |

**Submit button:** "Submit Request" — disabled until Section A fields and Priority + Assign are filled.

---

## 2. Approval Routing Logic

Threshold: **₹10,00,000 (₹10 lakhs)**

| Budget entered | Amount | Initial status on submit |
|----------------|--------|--------------------------|
| No | — | `sourcing` |
| Yes | ≤ ₹10,00,000 | `sourcing` |
| Yes | > ₹10,00,000 | `pending_head_approval` |

### Status Flow (updated)
```
submitted
    ↓
pending_head_approval  ← only if budget > ₹10L
    ↓  (sourcing_head approves)
sourcing  ← assigned sourcing engineer picks it up
    ↓
negotiation
    ↓
sourcing_approved  ← sourcing_head signs off
    ↓
buyer_approved  ← buyer final sign-off
```

Rejection is possible at `pending_head_approval` (by sourcing_head) and at `sourcing_approved` (by buyer).

### Head Approval UI
On the request detail page, when `status === 'pending_head_approval'` and `currentRole === 'sourcing_head'`:
- Show an amber banner: **"This request requires your approval before sourcing can begin."**
- Two action buttons: **"Approve for Sourcing"** and **"Reject"**

### Request Visibility by Role
| Role | Sees |
|------|------|
| `buyer` | Only requests they created (`createdBy === currentUser`) |
| `sourcing_member*` | Only requests where `assignedTo === currentRole` |
| `sourcing_head` | All requests |
| `super_admin` | All requests |

---

## 3. Data Model Changes

### `CapexStatus` (types.ts)
Add `'pending_head_approval'` between `'submitted'` and `'sourcing'`.

### `CAPEX_STATUS_FLOW` (types.ts)
```ts
['draft', 'submitted', 'pending_head_approval', 'sourcing', 'negotiation', 'sourcing_approved', 'buyer_approved', 'rejected']
```

### `CapexRequest` (types.ts)
```ts
subject: string          // replaces title
quantity: string         // new — e.g. "5 units"
budget?: number          // now optional
assignedTo: string       // new — sourcing engineer role value
priority: 'low' | 'medium' | 'high' | 'critical'  // add 'critical'
```
Field `title` is removed and replaced by `subject`. All references updated.

### Status transition enforcement (capexContext.ts)
The adjacency check is replaced with an explicit allowed-transitions map to support the bypass route (`submitted → sourcing` for low-budget requests):

```
submitted       → pending_head_approval | sourcing
pending_head_approval → sourcing | rejected
sourcing        → negotiation
negotiation     → sourcing_approved | rejected
sourcing_approved → buyer_approved | rejected
```

### STATUS_COLORS (constants.ts)
```ts
pending_head_approval: "bg-orange-100 text-orange-700"
```

---

## 4. Sourcing Personas

Four sourcing engineers replace the single `sourcing_member` role:

| Role value | Display name | Specialisation |
|------------|-------------|----------------|
| `sourcing_member` | Neha Kapoor | Machinery |
| `sourcing_member_2` | Vikram Malhotra | Infrastructure |
| `sourcing_member_3` | Priya Nair | IT & Tooling |
| `sourcing_member_4` | Ananya Reddy | Civil Works |

Updated in: `TopNav.tsx` (role switcher), `Sidebar.tsx` (ROLE_META), `constants.ts` (ROLE_NAMES), `capexContext.tsx` (sourcing engineer filter logic).

---

## 5. Mock Data Migration

All existing `mockRequests` entries:
- `title` field renamed to `subject`
- `assignedTo` set to `'sourcing_member'`
- `quantity` set to `'1 unit'`
- `budget` remains as-is (already a number; now typed as `number | undefined`)

No changes to `mockVendors` or `mockInvites`.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add status, update `CapexRequest`, update flow array |
| `src/lib/capexContext.tsx` | Replace adjacency check with transitions map, update filter logic |
| `src/lib/constants.ts` | Add `pending_head_approval` colour, update `ROLE_NAMES` |
| `src/lib/mockData.ts` | Migrate seed data fields |
| `src/app/(internal)/capex/new/page.tsx` | Full rewrite — single-page form |
| `src/app/(internal)/capex/[id]/page.tsx` | Add head-approval banner + actions |
| `src/app/(internal)/capex/requests/page.tsx` | Filter by `assignedTo` for sourcing roles |
| `src/components/Sidebar.tsx` | Add 3 new sourcing personas to ROLE_META |
| `src/components/TopNav.tsx` | Add 3 new sourcing personas to role switcher |
