# Capex Amber — User Stories

**Last updated:** 2026-07-16

Living backlog for product requirements. The AI agent maintains this file across chats whenever you describe or change a user story.

## How to add stories

Tell the agent in plain language, e.g. *"As a buyer, I want to filter requests by plant so I only see my site."* The agent will append or update an entry here with acceptance criteria and status.

| Field | Meaning |
|-------|---------|
| **Status** | `backlog` · `in_progress` · `done` · `cancelled` |
| **Priority** | `must` · `should` · `could` |

---

## Epics (baseline — implemented)

These reflect the current app as documented in `CLAUDE.md`. Mark individual stories `done` unless you ask to change them.

### Epic: Authentication & roles

| ID | Story | Status |
|----|-------|--------|
| US-001 | As an internal user, I want to pick a role on login so I can use the portal with the right permissions. | done |
| US-002 | As an internal user, I want to switch roles from the top nav so I can demo different personas without re-logging in. | done |
| US-003 | As a plant-scoped buyer or plant head, I want data filtered to my plant so I only see relevant requests. | done |

### Epic: CAPEX request lifecycle

| ID | Story | Status |
|----|-------|--------|
| US-010 | As a buyer, I want to create a multi-line CAPEX request in a spreadsheet-style grid so I can submit several items in one request. | done |
| US-011 | As a buyer, I want sourcing engineer auto-assigned on submit so I do not have to choose one manually. | done |
| US-012 | As a plant head, I want to approve or reject requests pending my approval so high-value spend is controlled. | done |
| US-013 | As a sourcing member, I want to invite vendors and compare quotes so I can run the sourcing workflow. | done |
| US-014 | As a supplier, I want to open a tokenised link and submit a quote so I can respond without an account. | done |
| US-015 | As a buyer, I want to see request status history so I can audit who moved a request and when. | done |

### Epic: Budget & master data

| ID | Story | Status |
|----|-------|--------|
| US-020 | As a plant head or admin, I want a CAPEX master budget grid per plant and FY so planned spend is visible. | done |
| US-021 | As a plant head or admin, I want to clone master data into a new fiscal year so I do not re-enter everything. | done |
| US-022 | As an admin, I want custom budget heads and plants so the master reflects our organisation. | done |

### Epic: Administration

| ID | Story | Status |
|----|-------|--------|
| US-030 | As a super admin, I want a settings page to manage configuration so I can maintain the demo environment. | done |
| US-031 | As a super admin, I want to reset all local data so I can restart a demo from seed data. | done |

---

## Active backlog

### Epic: Brown Field procurement expansion (US-057 – US-063)

Full Brown-Field fulfillment lifecycle. **All scoped to `fieldType === 'brown_field'`** unless noted; Green Field / Digitisation / IT flows unchanged. Frontend-only (localStorage). Decisions captured with the user on 2026-06-19.

### US-057 — Maintenance & Accounts roles
- **As** Amber, **I want** a global Maintenance user (budget authoring) and a global Accounts user (FA codes, PO, payments) **so that** the new workflow has the right personas.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] `maintenance` and `accounts` are **global** roles (not plant-scoped), registered in `ROLE_NAMES`, `Sidebar` (`ROLE_META` + `NAV`), `TopNav` (`ROLE_GROUPS`), and login `ROLES`
  - [x] Maintenance can open CAPEX Master + Budget Planning; Accounts can open the Accounts Queue
- **Files:** `src/lib/constants.ts`, `src/components/Sidebar.tsx`, `src/components/TopNav.tsx`, `src/app/login/page.tsx`

### US-058 — Next-FY budget proposal, bulk upload & admin approval
- **As a** maintenance user, **I want** to author a next-FY Brown Field budget (with bulk Excel/CSV upload) that an admin approves and publishes as the new live FY **so that** buyers get the updated budget.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] Live Brown Field FY master is **read-only**; budget changes flow through a next-FY proposal (the only mid-FY change is an Adhoc transfer)
  - [x] `/capex/budget-proposals` authoring: seed from live FY, edit rows, **bulk upload** (Excel/CSV) with template download, submit for approval
  - [x] `/capex/budget-approvals` (super_admin): per-head diff vs live FY; Approve **publishes** as a new live FY; Reject; double-publish guarded
  - [x] New requests pick up the published FY via field-scoped `getLatestMasterFyForField` (Green/Digitisation/IT FY unaffected)
- **Files:** `src/lib/budgetProposalUtils.ts`, `src/lib/bulkMasterImport.ts`, `src/lib/capexContext.tsx`, `src/app/(internal)/capex/budget-proposals/page.tsx`, `src/app/(internal)/capex/budget-approvals/page.tsx`, `src/app/(internal)/capex/master/page.tsx`

### US-059 — Brown Field request without buyer quotations
- **As a** buyer, **I want** to submit a Brown Field request with only specs + a preferred vendor (no quotations) **so that** sourcing owns pricing.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] Brown Field new-request shows a preferred-vendor + est-budget block instead of the per-line quote panel; the **Description** field is the spec (no separate Specifications field)
  - [x] Line budget derives from est. budget or the linked master allocation; no `VendorInvite` seeding for Brown Field
  - [x] Other field types keep the buyer-quote flow unchanged
- **Files:** `src/app/(internal)/capex/new/page.tsx`

### US-060 — RFQ vs Reverse Auction + RFQ price flow (vendor-quotes-first)
- **As a** sourcing user, **I want** vendors to submit their quotation first, then negotiate inline or escalate to a reverse auction before requesting a Proforma Invoice **so that** RFQ works the way a real Request-for-Quotation does.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] Brown Field at `sourcing` chooses `sourcingMode` (`rfq` | `auction`); a "Change method" control reverts to the chooser before a PI is requested (invited vendors kept)
  - [x] **Vendor quotes first, per line item:** inviting a vendor sends the link and sets `awaiting_quote`; the vendor enters a **unit price per line item** (+ freight/packing/service/delivery/warranty/currency) on a responsive, auction-styled portal table → `pending_sourcing`. `RfqQuote` carries `linePrices` + base subtotal `price`
  - [x] Sourcing **counters inline in the comparison grid** (per-line unit prices, one vendor column at a time) → `pending_vendor`, or **accepts** the vendor's quote directly; the vendor accepts/counters/declines on the portal; either side accepting → `approved`; `reopenRfqQuote` re-opens an approved quote; `proposeRfqQuote` sanitizes input and `respondToRfqQuote` is turn-guarded
  - [x] RFQ comparison is the **reverse-auction grid** (modeled on `VendorGrid`): line items as rows (Item/Description/Qty), vendors as columns with per-line unit price + line total and a green "↓ Lowest" highlight, footer attribute rows, Grand Total row with L1, and a per-line **Final Decision** column **identical to the auction's** (Price ₹ / Disc % / Vendor / Price×Qty, persisted in `request.sourcingDecision`); stacked cards below `lg`; collapsible read-only thread. **Copy supplier link** is available on every vendor in every status. Accept finalizes one vendor for the single-vendor PI
  - [x] **Start Reverse Auction** carries each vendor's RFQ prices into the auction as opening bids (`seedAuctionFromRfq` → seeded `Quote` with per-line `itemPrices`); lowest = **L1**, others rebid lower; threshold also pre-fills to the lowest RFQ grand total
  - [x] A **"Start Reverse Auction"** action escalates to the existing auction flow with the threshold pre-filled to the lowest collected grand total (`lowestRfqTotal`, editable)
  - [x] After the quotation **and** documents are approved, sourcing requests a PI (`pi_requested`); vendor uploads PI (`pi_submitted`) which reaches buyer + accounts
- **Files:** `src/lib/rfqUtils.ts`, `src/lib/auctionTheme.ts`, `src/components/RfqPanel.tsx`, `src/app/(internal)/capex/[id]/page.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/lib/capexContext.tsx`

### US-061 — Document approval package (PBG + DLC + one-time terms)
- **As a** sourcing user, **I want** vendors to approve a Performance Bank Guarantee and Delay Liability Clause (plus payment terms for one-time vendors) **so that** terms are agreed before fulfillment — in both RFQ and auction flows.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] One-time / not-onboarded vendor flag on the vendor (onboard modal) with payment terms + splits; onboarded vendors carry fetched (mocked) terms
  - [x] In RFQ the package (Commercial Terms + PBG + DLC) is **decoupled from the price** and **auto-sends the moment the price is agreed** (`respondToRfqQuote` on approve → `docApprovalStatus: 'pending'`); the vendor reviews and approves the documents on a **separate** screen (`respondToDocApproval`); PI gated on **both** price and documents approved (`canRequestPi`). Declining the documents shows a "Terms Declined" state; sourcing can re-send (`resendDocApprovalPackage`); re-opening/countering an approved quote resets the documents
  - [x] Auction embeds Commercial Terms + PBG/DLC on the approval document (print view + supplier screen); one-time payment terms shown; all agreed by accepting participation
- **Files:** `src/lib/docPackageUtils.ts`, `src/components/DocPackageReview.tsx`, `src/components/VendorOnboardModal.tsx`, `src/lib/auctionDocumentUtils.ts`, `src/lib/capexContext.tsx`

### US-062 — Accounts (FA codes + PO), milestone payments & TAT
- **As an** accounts user, **I want** to assign FA codes, raise a PO, and record milestone payments (advance/dispatch/installation), with a delay-liability TAT clock **so that** fulfillment and penalties are tracked.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] `/accounts/queue` lists requests in fulfillment; `AccountsPanel` on request detail
  - [x] FA code per line; PO build + submit; payment milestones from the vendor's split with per-term checkboxes; ticking notifies the vendor (toast + supplier card)
  - [x] TAT starts PI + 1 week; **0.5%/week to a cumulative 5%, then 5%/week**; final payment stops the clock and completes the request
  - [x] Sourcing or accounts can record payments; both RFQ and auction winners converge into this chain
- **Files:** `src/lib/paymentUtils.ts`, `src/lib/tatUtils.ts`, `src/components/AccountsPanel.tsx`, `src/components/TatBanner.tsx`, `src/app/(internal)/accounts/queue/page.tsx`, `src/lib/capexContext.tsx`

### US-064 — Accounts split: Plant Accounts (FA) → Global Accounts (PO upload + payments)
- **As an** accounts organisation, **I want** Plant Accounts to assign FA codes and Global Accounts to issue the PO (with an uploaded PO document the vendor receives) **so that** FA coding and PO issuance are separated and the vendor gets the official PO.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] New `plant_accounts` role (single, global) registered everywhere; `accounts` relabelled **Global Accounts**; `/accounts/queue` open to both
  - [x] `pi_submitted` → Plant Accounts assigns FA codes + **Submit FA codes** (`submitFaCodes` → `accounts_processing`) → Global Accounts assigns **PO number** + **uploads PO doc** + **Issue PO** (`issuePurchaseOrder` → `payment_in_progress`, `issuedAt`)
  - [x] Vendor is notified and sees/downloads the PO on the supplier portal (**Purchase Order card**); PO-doc base64 stored in IndexedDB
  - [x] Payment milestones unchanged after PO issue; final tick → `completed`
- **Files:** `src/components/AccountsPanel.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/lib/capexContext.tsx`, `src/lib/types.ts`, `src/lib/constants.ts`, `src/components/Sidebar.tsx`, `src/components/TopNav.tsx`, `src/app/login/page.tsx`, `src/app/(internal)/accounts/queue/page.tsx`

### US-065 — Brown Field is RFQ-only; auction needs ≥2 quotes
- **As a** sourcing user, **I want** every Brown Field request to run RFQ (no direct-auction option) and only escalate to a reverse auction once **≥2 vendors have quoted** **so that** auctions are always competitive and preceded by an RFQ.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] The RFQ/Auction chooser + "Change method" are removed; `capex/[id]` auto-sets `sourcingMode:'rfq'` on entering `sourcing`
  - [x] "Start Reverse Auction" is enabled only when `invites.filter(i => i.rfqQuote).length >= 2` (hint when <2)
- **Files:** `src/app/(internal)/capex/[id]/page.tsx`, `src/components/RfqPanel.tsx`, `src/lib/capexContext.tsx`

### US-066 — Item-wise GST via HSN code
- **As** sourcing, **I want** to set an HSN code per **line item** (not per vendor) so the correct GST is derived for each item identically across all vendors; **as a** vendor **I want** to see each item's HSN/GST.
- **Priority:** must · **Status:** done · **Updated:** 2026-07-14
- **Acceptance criteria**
  - [x] HSN lives on `CapexLineItem.hsnCode` (item-wise, one value per item); **only the vendor enters it** (required per-line HSN dropdown in their bid table). **Sourcing sees it read-only** in the RFQ comparison grid (no dropdown) and cannot set/override it
  - [x] Supplier RFQ submission is **atomic**: `proposeRfqQuote(..., itemHsn?)` validates required HSN, writes the quote, and patches request line-item HSN in one pass (no separate `setLineHsn` loop). Cross-tab `storage` sync rehydrates **both** `requests` and `invites` so sourcing sees HSN + GST immediately
  - [x] The old whole-quote HSN dropdown is removed from the bid + counter forms; HSN is per line item only
  - [x] GST is per line = unit × qty × `gstRateForHsn(item.hsnCode)` (`rfqLineGstAmount`); footer charges (freight/packing/service) are **not** taxed
  - [x] Shared `rfqLineBreakdown` drives per-item display: HSN, GST rate, pre-GST subtotal, GST amount, and GST-inclusive line total on supplier + sourcing RFQ grids (desktop + mobile)
  - [x] `rfqGstAmount`/`rfqTotal`/`lowestRfqTotal` accept optional `items[]` and stay GST-inclusive → L1, threshold, auction seeding, PO amount unchanged; grid Grand Total shows an `incl. ₹X GST` subtitle per vendor
  - [x] `RfqQuote.hsnCode` kept only as a legacy fallback for old lump-sum quotes
- **Files:** `src/lib/hsnGst.ts`, `src/lib/rfqUtils.ts`, `src/lib/types.ts`, `src/lib/capexContext.tsx`, `src/lib/paymentUtils.ts`, `src/app/(public)/supplier/[token]/page.tsx`, `src/app/(internal)/capex/[id]/page.tsx`, `src/components/RfqPanel.tsx`, `src/components/supplier/SupplierQuoteTable.tsx`, `src/components/supplier/SupplierQuoteCards.tsx`

### US-067 — INCO Terms (Incoterms 2020) gate for new vendors
- **As a** sourcing user, **I want** to invite any vendor by name/email/phone and require new/one-time vendors to agree a 12-question Incoterms document before they can quote **so that** delivery terms are settled up front.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] Quick-add new vendor (name/email/phone) in the RFQ picker → one-time vendor (`inviteNewVendor`, `Vendor.contactPhone`)
  - [x] One-time vendor must **approve the 12-question INCO Terms before quoting** (`incoTermsBlocksQuote`); two-sided fill/edit-resend/accept/reject loop (`proposeIncoTerms`/`respondToIncoTerms`); sent only to new/one-time vendors
- **Files:** `src/lib/incoTermsUtils.ts`, `src/lib/types.ts`, `src/lib/capexContext.tsx`, `src/components/RfqPanel.tsx`, `src/app/(public)/supplier/[token]/page.tsx`

### US-069 — Reverse auction converges to the PI flow exactly like RFQ
- **As a** sourcing user, **I want** a reverse auction, once it ends and a winning vendor is finalized, to enter the **same** doc-package approval → Proforma-Invoice → Accounts (FA codes) → Global Accounts (PO) → payments flow as RFQ — with no extra buyer-approval detour — **so that** both sourcing paths behave identically from finalization onward.
- **Priority:** must · **Status:** done · **Updated:** 2026-06-26 (now mirrors RFQ's doc-package step + routing fix)
- **Acceptance criteria**
  - [x] **Buyer step dropped:** finalizing the auction winner no longer routes to `sourcing_approved → buyer_approved`; sourcing finalizes (sets `finalVendorId` + `approveInvite`, status stays `sourcing`) then **Request Proforma Invoice** → `pi_requested`, mirroring RFQ
  - [x] **Finalize gated on auction-ended:** **Select as Final** / **✓ OK** in `VendorGrid` is disabled while the auction is live (`auctionLive = auctionConfig?.endsAt && !isAuctionExpired`); enabled once the countdown expires **or** sourcing clicks the new **Close Auction Now** button (`closeAuction` sets `endsAt` to now). No timed auction (seeded-quote comparison) ⇒ finalize stays available
  - [x] **Manual winner selection** (sourcing may override L1); the legacy direct-**Approve** back-door is also gated on `auctionLive`
  - [x] **Doc-package gate (mirrors RFQ):** finalizing the winner auto-sends the doc-package (`sendDocApprovalPackage` → `docApprovalStatus: 'pending'`); the winner approves it on the supplier portal (`AuctionWinnerTerms` → `DocPackageReview` → `respondToDocApproval`) before **Request Proforma Invoice** unlocks (gated on `effectiveDocApprovalStatus === 'approved'`). PBG/DLC are accepted twice (pre-auction Business Rules + here), but this confirms the per-vendor payment splits that drive milestones
  - [x] **Request PI restricted to `sourcing_head`/`super_admin`** (`canFinalize`) on **both** RFQ and auction; a `sourcing_member` runs the negotiation/auction but sees an "Awaiting sourcing head" note instead of the Request-PI action
  - [x] **Supplier routing fix:** the finalized vendor routes into the shared PI-upload/fulfillment view for `pi_requested` **as well as** the `FULFILLMENT_STATUSES` (`pi_requested` is not in that list, so it is matched explicitly) — without this an auction winner at `pi_requested` could never upload the PI and the flow dead-ended before accounts
  - [x] From `pi_requested` onward every step (PI upload → Plant Accounts FA → Global Accounts PO → milestone payments → `completed`) is the **same shared code** as RFQ (`resolveFinalVendor` resolves the auction winner via `finalVendorId` + approved invite, and defaults the PI amount to the winning bid)
  - [x] `ALLOWED_TRANSITIONS` keeps `negotiation → pi_requested` and `sourcing_approved → pi_requested` so legacy/in-flight requests still reach fulfillment; `sourcing_approved`/`buyer_approved` retained for legacy only
- **Files:** `src/app/(internal)/capex/[id]/page.tsx`, `src/components/VendorGrid.tsx`, `src/components/RfqPanel.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/lib/capexContext.tsx`, `src/lib/auctionUtils.ts`, `src/lib/paymentUtils.ts`, `src/lib/docPackageUtils.ts`

### US-070 — Reverse auction: split award across multiple vendors
- **As a** sourcing user, **I want** to close a reverse auction and award line items to **different vendors** in the Final Decision grid (each with a final price), then have **each awarded vendor** run its own PI → terms → PO → payments track **so that** a single request can be fulfilled by multiple suppliers.
- **Priority:** must · **Status:** done · **Added:** 2026-06-27
- **Acceptance criteria**
  - [x] **Close + award in the Final Decision column:** after **Close Auction Now**, sourcing picks a vendor + enters a final price per line item; a single **Approve Final Decision & Award** button (gated on auction-ended + every line having a vendor + price, `sourcing_head`/`super_admin`) calls `finalizeSplitAward`. The legacy "✓ OK / Select as Final" header + "Approve → buyer" footer are hidden on the auction path
  - [x] **Per-vendor awards:** lines are grouped by vendor (`buildAwardGroups`) into one **award** per winning vendor, stored on its `VendorInvite` (`awarded`, `awardedItemIds`, `awardAmount` incl. item-wise GST, `awardStatus`, per-award `faCodes`/`purchaseOrder`/`paymentMilestones`/`piSubmittedAt`/`tatStoppedAt`)
  - [x] **Entered price = PO amount:** each award's `awardAmount` (Final-Decision net + GST) drives that award's PI default, PO, and milestones
  - [x] **Terms per award:** each award auto-sends its own doc-package on award; the vendor approves on the supplier portal (`AuctionWinnerTerms`) before sourcing can **Request PI** for that award (restricted to `sourcing_head`/`super_admin`)
  - [x] **Independent fulfillment:** each award progresses on its own (`requestProformaInvoice`/`submitProformaInvoice`/`submitFaCodes`/`issuePurchaseOrder`/`markPaymentMade` take an optional `inviteId`); the supplier sees only its `awardedItemIds` + own PI/PO/payments; `AccountsPanel` renders one `AccountsTrack` per award; `/accounts/queue` shows one row per award; TAT is per award
  - [x] **Request status stays coarse:** award-based requests sit at `pi_requested` until **all** awards are `completed` (`deriveRequestStatus`); `ALLOWED_TRANSITIONS` adds `pi_requested → completed`; a "{n}/{m} awards complete" chip shows on the request. RFQ / single-vendor flows keep the request-level chain unchanged (coexistence via `isAwardBased`)
- **Files:** `src/lib/types.ts`, `src/lib/paymentUtils.ts`, `src/lib/capexContext.tsx`, `src/components/VendorGrid.tsx`, `src/components/AccountsPanel.tsx`, `src/app/(internal)/capex/[id]/page.tsx`, `src/app/(internal)/accounts/queue/page.tsx`, `src/app/(public)/supplier/[token]/page.tsx`

### US-071 — Docs-before-price, FA-code email, and budget-display removal
- **As a** sourcing/accounts user, **I want** vendors to accept the contract documents before pricing, a notification email after FA-code assignment, and the estimate-budget clutter removed, **so that** terms are locked before quotes, asset codes are communicated, and the UI is cleaner.
- **Priority:** must · **Status:** done · **Added:** 2026-06-28
- **Acceptance criteria**
  - [x] **Docs before price (RFQ):** an RFQ vendor receives the doc-package on invite (`inviteVendors` / `setSourcingMode('rfq')` build `docApprovalPackage`, `docApprovalStatus:'pending'`) and must **Accept** it on the supplier portal (`docsBlocked` gate → `DocPackageReview`) **before** the quotation form unlocks; declining locks it with a "Terms Declined" state. `canRequestPi` unchanged (docs already approved by PI time)
  - [x] **Docs before price (auction):** unchanged — vendors approve the pre-bid Business Rules (PBG + DLC) before bidding; the **redundant post-award terms step was removed** (`finalizeSplitAward` no longer sends a doc-package; awarded vendors see "You won — awaiting PI request" and Request PI is available immediately)
  - [x] **FA-code email:** **Submit FA codes** opens `FaEmailModal` — a preview of a one-time notification email (To `FA_CODE_RECIPIENT_EMAIL`, editable; Subject; Body listing the ordered items + FA codes) — and **Send** fires a toast then `submitFaCodes` (simulated; no backend). One email per FA submission (per award on split auctions)
  - [x] **Budget display removed** from the requests list, dashboard recent-requests, and request-detail line-items tables + the detail meta strip; the **"Est. Budget (Total, ₹)"** input removed from `/capex/new`. The `budget` **data** is retained (savings, KPIs, PO/threshold/`resolveFinalVendor` fallbacks); Brown Field line budget now defaults to the master allocation
- **Files:** `src/lib/capexContext.tsx`, `src/lib/constants.ts`, `src/components/FaEmailModal.tsx`, `src/components/AccountsPanel.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/app/(internal)/capex/[id]/page.tsx`, `src/app/(internal)/capex/requests/page.tsx`, `src/app/(internal)/capex/dashboard/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-063 — Adhoc head→head budget reallocation
- **As a** sourcing user or plant head, **I want** to move budget from a head with spare to an over-budget head (same plant + FY), with admin approval **so that** overruns can be covered mid-FY.
- **Priority:** must · **Status:** done
- **Acceptance criteria**
  - [x] `/capex/adhoc-budget` shows per-head allocation/used/spare and raises an `AdhocBudgetRequest`
  - [x] Admin is the **sole** approver (on `/capex/budget-approvals`); approval writes per-head allocation overrides
  - [x] Master Brown Field head allocations prefer the override; the transfer is the only permitted mid-FY change
- **Files:** `src/lib/adhocBudgetUtils.ts`, `src/app/(internal)/capex/adhoc-budget/page.tsx`, `src/app/(internal)/capex/budget-approvals/page.tsx`, `src/app/(internal)/capex/master/page.tsx`, `src/lib/capexContext.tsx`

### US-056 — Green Field budget hierarchy (plant → section → head → sub-particular)

- **As a** sourcing admin / plant head
- **I want** to assign an overall plant budget at Green Field plant creation, distribute envelopes to sections, then distribute each section budget to heads and track sub-particular prices against each head budget
- **So that** new-plant capex planning shows clear over/under budget status at every level
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] **Create Green Field Plant** modal requires **Overall Plant Budget (Cr)** scoped to FY + business category + plant
  - [x] First time a Green Field section (`Plant Machinery`, `Utilities`, `Compliances`, `Information Technology`) is opened, a modal prompts **Assign Section Budget** before showing heads
  - [x] **Edit Section Budget** action available on Green Field section detail
  - [x] First time a Green Field head (e.g. Moulding Shop) is opened, a modal prompts **Assign Head Budget** before the sub-particular table
  - [x] **Edit Head Budget** action available on Green Field head detail
  - [x] Section budgets deduct from plant budget; head budgets deduct from section budget
  - [x] Sub-particular master rows (`CapexMasterItem.totalCost`) deduct from head allocated budget; green remaining / red over indicators (warning-only, no hard block)
  - [x] Plant grid cards, section cards, and head cards show allocated vs used with over/under status
  - [x] Plant, section, and head detail banners summarise budget envelope, distribution, and remaining
  - [x] Green Field new-request section/head pickers show allocated budget and remaining/over status
  - [x] Brown Field, Digitisation, and IT flows unchanged
  - [x] `greenFieldBudgetAllocations` persisted in `capex_data_v2`; cloned with FY clone
- **Notes / related files:** `src/lib/types.ts` (`GreenFieldPlantBudget`, `GreenFieldSectionBudget`, `GreenFieldHeadBudget`), `src/lib/greenFieldConstants.ts` (budget helpers), `src/lib/capexContext.tsx`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-055 — Buyer vendor quotes at request creation

- **As a** buyer
- **I want** to add multiple vendor quotes while creating a CAPEX request (vendor, line item, expected total, extras, attachment)
- **So that** sourcing starts with benchmark quotes already in the comparison grid
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Main line grid removes **Est. Budget**, **Document**, and **Preferred Vendor** columns — those fields live in per-line quote cards only
  - [x] Each line item shows a collapsed **Vendor Quotes** area directly below the row with **Add Quote** (expand/collapse)
  - [x] Each quote card captures vendor, est. budget (total for qty), document, Transportation/Freight, Service/Installation, Packing/Forwarding, Delivery Lead Time (Weeks), Warranty (Years), and Currency
  - [x] At least one complete quote is **required per line item** before Review/Submit
  - [x] Each quote shows green/red allocation status against the linked master budget for that line
  - [x] Line item budget and request total derive from the **lowest quote amount** per line on submit
  - [x] Same vendor across multiple lines groups into one `VendorInvite` with multi-line `itemPrices` on submit
  - [x] Seeded quotes appear in sourcing `VendorGrid` with status quote received and “Added at request” badge; visible to buyer, plant head, and sourcing on request detail
  - [x] Review step shows each line item with its quote cards grouped underneath
- **Notes / related files:** `src/lib/requestQuoteUtils.ts`, `src/lib/types.ts` (`Quote.seededByBuyer`), `src/app/(internal)/capex/new/page.tsx`, `src/components/VendorGrid.tsx`

### US-053 — Green Field master sections (Plant Machinery, Utilities, Compliances, IT)

- **As a** sourcing admin / plant head
- **I want** Green Field CAPEX Master to use section cards after site creation, with predefined shop and utility child heads
- **So that** new-plant budgets follow the Green Field taxonomy while Brown Field stays flat
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Green Field master detail: plant → four section cards (`Plant Machinery`, `Utilities`, `Compliances`, `Information Technology`) even when a section has zero rows
  - [x] After selecting a section, user must pick a **head card** (e.g. Moulding Shop, Press Shop) before the item table or Add Item is shown — no `All Heads` view for Green Field
  - [x] `Plant Machinery` child heads: Moulding Shop, Press Shop, Copper Shop, Paint Shop, Tool Room, Assembly Shop, Lab & Quality Shop, Research and Development
  - [x] `Utilities` child heads: Fire & Safety, N2/O2/Helium/LPG/PNG, ETP/STP, Electrical, Misc.
  - [x] `Compliances` and `Information Technology` support line items under the section name (custom heads allowed)
  - [x] Add Item requires selected section **and** selected head; new rows write `division` = section and `head` = selected head card
  - [x] Breadcrumb: Plants / Plant / Section / Head when inside a Green Field head
  - [x] Brown Field master remains flat (no middle section layer)
  - [x] Green Field new request: category → plant → section cards → head cards → locked-head line grid; submit blocked without section + head
  - [x] `GREEN_FIELD_SECTION_MIGRATION_V1` migrates legacy flat Green Field rows on load
- **Notes / related files:** `src/lib/greenFieldConstants.ts`, `src/lib/capexContext.tsx`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`, `src/lib/mockData.ts`

### US-052 — Flatten CAPEX Master + align Green Field with Brown Field

- **As a** plant head / sourcing admin / buyer
- **I want** budget heads directly under each plant (no division tabs) and Green Field budgets using the same head + sub-particular structure as Brown Field
- **So that** master planning and new requests work consistently across field types
- **Priority:** must
- **Status:** done (superseded for Green Field by US-053 — Brown Field flattening retained)
- **Acceptance criteria**
  - [x] Master detail: no Machinery / Utilities / Legal division tabs; head cards sit directly under plant
  - [x] Green Field uses `BROWN_FIELD_HEAD_ORDER` (Automation, Machinery, General, etc.) with sub-particular rows
  - [x] `createGreenFieldPlant()` adds plant metadata only (`PlantMeta.greenFieldPlant`); budgets added via master Add Item
  - [x] Green Field new request: category → plant → head cards → line grid (no inline plant creation)
  - [x] `FLAT_MASTER_MIGRATION_V1` normalizes stored Brown/Green rows to flat division bucket on load
- **Notes / related files:** `src/lib/greenFieldConstants.ts`, `src/lib/capexContext.tsx`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`, `src/lib/mockData.ts`

### US-051 — Field type restructure (Amber → RAC/EMS/Component/Fan → plant)

- **As a** buyer / plant head
- **I want** four field types (Brown, Green, Digitisation, IT) with Amber → business category → plant hierarchy, and Green Field plant creation that flows into Brown Field
- **So that** capex is organised consistently across new-plant builds, existing plants, digitisation, and IT spend
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] `FieldType` extended: `digitisation`, `information_technology`; `projectType` on requests and master (Brown + Green)
  - [x] New request: 4-tile picker; Brown = category → plant → heads → grid; Green = category → create plant + budgets; Digitisation/IT = plant → heads → grid
  - [x] `createGreenFieldPlant()` adds plant to `customPlants` and master rows; plant available in Brown Field
  - [x] Digitization Brown Field rows migrate to Digitisation master on load
  - [x] Master page: 4 tabs; Brown/Green project-type step; Green shows created plants
- **Notes / related files:** `src/lib/types.ts`, `src/lib/greenFieldConstants.ts`, `src/lib/capexContext.tsx`, `src/app/(internal)/capex/new/page.tsx`, `src/app/(internal)/capex/master/page.tsx`

### US-050 — Green Field master business category (RAC / EMS / Component / Fan)

- **As a** plant head / admin
- **I want** Green Field CAPEX master scoped by business category (RAC, EMS, Component, Fan) before plant selection, with Brown Field-style head budget cards
- **So that** each new-plant build type has its own budget master per plant and FY without mixing line items across categories
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] `GreenFieldProjectType` on `CapexMasterItem` and `CapexRequest` (`rac` | `ems` | `component` | `fan`); legacy Green Field rows default to `rac` on load
  - [x] CAPEX Master Green Field tab: choose category → choose plant → manage rows; RAC and EMS budgets for the same plant/FY are isolated
  - [x] Green Field master detail uses selectable head budget cards (same pattern as Brown Field)
  - [x] New Green Field request: category picker after field type, before division/head flow; master lookups filtered by selected category
  - [x] `filterMasterItemsForRequest` and `getMasterBackfillKey` include `greenFieldProjectType` for Green Field scope
- **Notes / related files:** `src/lib/types.ts`, `src/lib/greenFieldConstants.ts`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-049 — FY 2026-27 Brown Field RAC master refresh & head budget cards

- **As a** plant head / buyer
- **I want** Brown Field CAPEX master data replaced with FY 2026-27 RAC plant budgets and selectable head cards showing allocated budget
- **So that** planned spend matches the approved workbook and I can browse or request items by head with clear budget visibility
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Brown Field seed data regenerated from `Capex FY 2026-27 RAC Plants final 18 April.xlsx` for all 9 RAC plants (`ddn_4`, `ddn_5`, `ddn_6`, `jhajjar_p1`, `jhajjar_p2`, `supa`, `rudrapur`, `sircity_1`, `sircity_2`) at `fy: 2026-27`
  - [x] Green Field master data unchanged (`fy: 2025-26` templates for `jhajjar_p1`, `jhajjar_p2`, `pune`)
  - [x] `CapexMasterItem` extended with optional `sNo`, `rateRs`, `qty`, `reasonForRequirement`, `benefits`, `roi`
  - [x] One-time `brownfieldSeedVersion` migration replaces stored Brown Field rows without wiping Green Field or user edits on subsequent loads
  - [x] CAPEX Master Brown Field detail view: head cards show allocated budget (Cr) and sub-particular count; selecting a card filters the table
  - [x] New Brown Field request: head card picker (budget + count) before grid; selected head locks sub-particular choices
  - [x] Plant totals validated against workbook summary (Sricity-2 excludes duplicate total rollup row)
- **Notes / related files:** `src/lib/brownFieldSeedData.ts`, `scripts/generate_brownfield_seed.py`, `src/lib/mockData.ts`, `src/lib/capexContext.tsx`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-048 — Cream theme and New Request wizard navigation

- **As a** internal portal user
- **I want** a modern cream/off-white UI with clear back and change controls on every New CAPEX request step
- **So that** the app feels professional and I can navigate the multi-step flow without getting stuck
- **Priority:** should
- **Status:** done
- **Acceptance criteria**
  - [x] Light cream sidebar (near-white) with teal accent and navy text; no dark blue sidebar
  - [x] Global theme tokens in `globals.css`: cream background, navy foreground, teal primary
  - [x] Top nav and shared button variants aligned to the new palette
  - [x] Field type picker: back to requests list
  - [x] Division picker: back to project type; change field type button
  - [x] Machinery head picker: back to divisions; change division / field type buttons
  - [x] Line-item grid: back to previous step; change field type, division, and head buttons
  - [x] Review step: back to edit details
  - [x] Submitted step: view submitted request, create another request, view all requests
- **Notes / related files:** `src/app/globals.css`, `src/components/Sidebar.tsx`, `src/components/TopNav.tsx`, `src/components/ui/button.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-040 — Green Field / Brown Field classification

- **As a** buyer
- **I want** to choose Green Field or Brown Field before creating a request
- **So that** capex is classified correctly for new plant builds vs existing plant spend
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Request-level field type picker on `/capex/new` before the line-item grid
  - [x] Head dropdown filters CAPEX master by `fieldType` and plant
  - [x] `fieldType` persisted on `CapexRequest`
  - [x] Green Field master tab with legacy flat heads (superseded by US-043 division structure)
  - [x] Brown Field master includes Utilities head
  - [x] Seed data includes detailed Green Field master templates (114 rows per plant) for `jhajjar_p1`, `jhajjar_p2`, and `pune` with `fy: "2025-26"` to match master page FY filter
  - [x] Backfill migration automatically adds missing Green Field seed rows to existing localStorage data (matched by `fieldType|fy|plant|head|department|subParticulars`)

### US-041 — Budget overrun indicators

- **As a** plant head or admin
- **I want** master budget rows and heads to turn red when allocated spend is exceeded
- **So that** I can see overruns at line and head level
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Per master line: red row + "↑ ₹X L over" when linked request budgets exceed `totalCost`
  - [x] Per head summary chip: red + "Over by ₹X Cr" when aggregate used exceeds planned
  - [x] Plant cards on master grid show overrun warning when any line is over

### US-054 — Request budget vs master allocation at approval

- **As a** buyer, plant head, sourcing member, or admin
- **I want** each request line to show estimated budget alongside master-allocated budget with green/red overrun indicators
- **So that** approvers at every stage can see whether the request exceeds planned spend
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] `/capex/[id]` `RequestInfoCard` shows per-line **Allocated** (from linked master `totalCost`) and **Status** chip (green "₹X under" / red "₹X over")
  - [x] Budget summary row totals requested vs allocated when line items link to master rows
  - [x] Legacy single-row requests show allocated + status in the meta grid
  - [x] Visible to all roles at every approval stage (plant head, sourcing, admin)
  - [x] `/capex/new` line-item grid shows **Allocated Budget** beside **Est. Budget** per row (from linked master sub-particular); review step shows both columns; est. budget highlights red when over allocation
- **Notes / related files:**
  - `src/app/(internal)/capex/[id]/page.tsx` — `RequestInfoCard`, `BudgetStatusChip`
  - `src/app/(internal)/capex/new/page.tsx` — allocated budget column on create/review grid
  - `src/app/(internal)/capex/master/page.tsx` — Qty column inline edit + add-item form

### US-042 — Reverse auction (sourcing & supplier)

- **As a** sourcing member
- **I want** to run a reverse auction with duration, threshold, vendor ranking, and extension
- **So that** vendors compete on price transparently
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Auction setup on `/capex/[id]`: duration (1–30 days), threshold, Start Auction
  - [x] Live countdown; extend +1/+3/+7 days
  - [x] Vendor ranking table with L1/L2 labels and gap-to-L1 column
  - [x] Supplier portal: countdown, rank badge, gap to L1, threshold warning (non-blocking red)
  - [x] Re-bid overwrites existing quote in place
  - [x] Supplier auction UI: modern bid-entry layout — sticky header, rank/total summary, bid table, additional charges, grand total, sticky submit bar (all existing quote fields preserved)

### US-043 — Green Field divisions & machine capacity

- **As a** buyer / plant head
- **I want** Green Field capex organised into Land & Building, Machinery, Utilities, and Legal divisions with sub-heads, and a machine capacity field on Machinery requests
- **So that** new plant budgets and quotes align with the real project structure
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Green Field master detail view has division tabs: Land & Building, Machinery, Utilities, Legal
  - [x] Each division has canonical sub-heads per `GF_DIVISION_HEADS` in `greenFieldConstants.ts`
  - [x] `Land Building` renamed to `Land & Building` across all Green Field flows
  - [x] `Legal` division added with empty heads array (no predefined budget heads)
  - [x] New request (Green Field): division card picker (Land & Building / Machinery / Utilities / Legal) before the line-item grid
  - [x] Legal division shows empty-state message when selected (no budget heads available)
  - [x] Machinery only: budget head card picker (Moulding, Press, etc.) after division selection, before the grid; default head applied to new rows
  - [x] Machinery grid: request-level head lock — no Head dropdown and no per-row head change; read-only locked head chip on every row; **Change head** in page header only; Sub Particular scoped to selected head only
  - [x] Land & Building and Utilities: per-row Head → Sub Particular dropdown cascade scoped to division/field type
  - [x] Head and Sub Particular dropdowns filter by plant, active FY, division (GF), and selected head — Sub Particular shows only lines for the chosen head
  - [x] Machinery rows show free-text Machine Capacity after a sub-particular is chosen; value stored on `CapexLineItem.machineCapacity`
  - [x] Request detail and supplier portal display machine capacity when present
  - [x] Seed data migrated to `division` + sub-head structure; missing Admin Blocks / Paint Shop / etc. template rows backfilled
- **Notes / related files:** `src/lib/greenFieldConstants.ts`, `src/lib/mockData.ts`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-047 — Brown Field flat budget heads (General, Automation, etc.)

- **As a** buyer / plant head
- **I want** Brown Field capex organised by flat budget heads (General, Automation, Machinery, etc.) without Machinery/Utilities/Legal group cards
- **So that** existing-plant master and requests match the legacy head structure in seed data
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] Brown Field master detail: plant → budget head cards (General, Automation, Machinery, Digitization, New Business, Safety & Security, Utilities, Misc.) → line-item table for selected head only; no `All Heads` view
  - [x] Add Item requires a selected head; rows stored under `Other Brown Field` division with chosen `head`
  - [x] Predefined heads plus custom heads from existing master rows appear as cards
  - [x] Empty predefined heads (no line items) are hidden from the head-card picker; custom heads added via **Manage Heads** appear even before the first item
  - [x] New request (Brown Field): category → plant → budget head cards (only heads with master line items) → locked-head line grid; submit blocked without head
  - [x] No Machinery / Utilities / Legal division picker in Brown Field master or new-request wizard
  - [x] `division` on line items uses internal `Other Brown Field` bucket; `masterHead` holds the selected flat head
- **Notes / related files:** `src/lib/greenFieldConstants.ts`, `src/app/(internal)/capex/master/page.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-046 — Land & Building document folder

- **As a** buyer creating a Green Field Land & Building request
- **I want** to upload multiple land-related documents (deeds, surveys, permits, etc.) in a dedicated folder
- **So that** all land documentation is collected with the CAPEX request for legal and compliance review
- **Priority:** should
- **Status:** done
- **Acceptance criteria**
  - [x] Land Documents folder appears only when Green Field + Land & Building division is selected on `/capex/new`
  - [x] Folder supports unlimited number of file uploads (no file count limit)
  - [x] No per-file size cap for land documents (unlike line-item attachments which are capped at 500 KB)
  - [x] Uploaded documents display in a grid with file name and delete option
  - [x] Documents persist in `CapexRequest.landDocuments[]` array with `id`, `name`, `base64`, `mimeType`, `uploadedAt` fields
  - [x] Land Documents summary shown in review step before submission
  - [x] Documents cleared when changing field type or division (reset behavior)
- **Notes / related files:** `src/lib/types.ts` (`LandDocument` type), `src/app/(internal)/capex/new/page.tsx`

### US-048 — Green Field skips plant-head approval

- **As a** buyer creating a Green Field request
- **I want** the request to move directly to sourcing without plant-head approval
- **So that** Green Field projects start sourcing workflow immediately
- **Priority:** must
- **Status:** done
- **Acceptance criteria**
  - [x] New Green Field submissions are created with status `sourcing`
  - [x] Brown Field submissions continue to start at `pending_head_approval`
  - [x] Request status history starts with the computed initial status on creation
- **Notes / related files:** `src/lib/capexContext.tsx`, `src/app/(internal)/capex/new/page.tsx`

### US-044 — Automated email notifications

- **As a** sourcing member / buyer / plant head / vendor
- **I want** the system to send emails automatically at key workflow events
- **So that** stakeholders are notified without manual link copying and follow-up
- **Priority:** should
- **Status:** backlog
- **Acceptance criteria**
  - [ ] Email sent when vendor is invited to RFQ or auction (portal link included)
  - [ ] Email sent to sourcing when a vendor submits or updates a quote
  - [ ] Email sent to plant head when request awaits approval
  - [ ] Email sent to buyer when sourcing decision is ready for sign-off
  - [ ] Email sent on rejection (to buyer) with reason
  - [ ] Optional: auction ending-soon and auction-extended reminders to vendors
  - [ ] Delivery logged per request / invite (sent at, recipient, template type)
  - [ ] Replaces mock email-thread UI in `VendorGrid` with real sent/received state
- **Notes / related files:** `src/components/VendorGrid.tsx`, future email service integration; see `docs/SCOPE.md` §6.1

### US-045 — Pre-auction vendor approval document

- **As a** sourcing member
- **I want** to send a Business Rules approval document to shortlisted vendors before the auction starts
- **So that** vendors formally confirm their participation and understand auction terms
- **Priority:** should
- **Status:** done
- **Acceptance criteria**
  - [x] Sourcing team can configure auction document with dates, times, rules, and delivery locations
  - [x] Document auto-populates with request details (item name, enquiry number, quantities)
  - [x] Green Field requests show delivery location entry form
  - [x] Auction rules have sensible defaults (180 days validity, 5 decrements, 15min extension, 2 max extensions, INR currency)
  - [x] Sourcing team can preview/print the Annexure-style document
  - [x] Document is "sent" to selected vendors (mock delivery - in-app only)
  - [x] Vendor approval tracker shows real-time status: Pending, Approved, Rejected, Excluded, Overdue
  - [x] Sourcing team can send reminders to pending vendors
  - [x] Sourcing team can manually exclude vendors
  - [x] **Start Auction** is blocked until at least one vendor approves
  - [x] Only approved vendors can participate when auction goes live
  - [x] Supplier portal shows approval screen with document summary and Approve/Decline actions
  - [x] Once approved, supplier sees waiting state until auction starts
  - [x] Rejected, excluded, or overdue vendors cannot bid
  - [x] Supplier bid screen shows rank, best price, and auction rules only — no anonymous Supplier A/B labels
- **Notes / related files:**
  - `src/lib/types.ts` — new `AuctionApprovalDocument`, `AuctionApprovalStatus`, fields on `VendorInvite`
  - `src/lib/auctionDocumentUtils.ts` — document helpers, status utilities
  - `src/lib/capexContext.tsx` — mutations: `saveAuctionApprovalDocument`, `sendAuctionApprovalToVendors`, `respondToAuctionApproval`, `sendAuctionApprovalReminder`, `excludeVendorFromAuction`
  - `src/app/(internal)/capex/[id]/page.tsx` — document setup form, approval tracker, gated start auction
  - `src/app/(public)/supplier/[token]/page.tsx` — supplier approval/rejection flow, eligibility check
  - `docs/SCOPE.md` §6.2 — updated with implementation details

---

### US-068 — Compact UI pass + responsive vendor portal (desktop table / mobile)
- **As** any user, **I want** a sleeker, more compact, consistent portal; **as a** vendor **I want** the link screen to work well on both my phone and a desktop, with the desktop showing my pricing as a table like the sourcing team sees.
- **Priority:** should · **Status:** done
- **Acceptance criteria**
  - [x] Portal-wide **compact density** applied consistently via `src/lib/uiTokens.ts` (page `p-5`, section `space-y-4`, cards `bg-card rounded-xl border-border shadow-sm p-4`, **data rows `py-2`**, page titles `text-xl`); editable input-grid cells stay `py-3`/`py-0.5` by design (`TD_CELL_INPUT`). No overlap; touch targets ≥44px.
  - [x] **Aggressive space utilization (v2):** key-value metadata rendered as a dense inline `label: value` strip (not stacked cells) on the request-detail `RequestInfoCard` and vendors expanded row; long text fields use `ClampText` (visible, clamped to 2 lines, measured "Show more/less"); status stepper + dashboard KPIs tightened. Fixes the wasted-space / scroll complaint on `capex/[id]`.
  - [x] **Login responsive** — marketing hero hidden below `lg`, card `w-full max-w-md`, tighter small-screen padding.
  - [x] **Vendor portal: two explicit UIs.** Pricing screens render a **desktop table** mirroring the sourcing grid (`SupplierQuoteTable`, navy header, line items as rows) and a **mobile card stack** (`SupplierQuoteCards`); both share a `read`/`entry`/`bid` variant API and compute GST/totals through `rfqUtils` so they never diverge.
  - [x] **All read surfaces** (under-review, counter, agreed, approved, rejected) use the line-item-aware summary (correct item-wise GST), not a GST-less lump-sum card; reverse-auction threshold surfaced once (whole-quote), not per line.
  - [x] **All non-pricing states** (auction-approval, closed, invalid, PI upload, fulfillment/PO/payments, INCO gate) unified on `SUPPLIER_CARD` with mobile-stacking action rows.
  - [x] Fixed a latent bug: `/accounts/queue` now renders for `plant_accounts` (render guard previously excluded it → blank screen).
- **Notes / related files:** `src/lib/uiTokens.ts`, `src/components/supplier/SupplierQuoteTable.tsx`, `src/components/supplier/SupplierQuoteCards.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/components/DocPackageReview.tsx`, `src/app/login/page.tsx`, all `src/app/(internal)/**/page.tsx`. Built/reviewed via frontend-engineer + ux-tester + quality-challenger.

---

## Epic: Workflow overhaul (2026-07)

| ID | Story | Status |
|----|-------|--------|
| US-064 | As a budget author, I want my budget to route **plant head → super admin → global accounts** before it goes live, so it's properly approved. | done |
| US-065 | As a super admin, I want to **approve, reject, or send a budget back for correction** with a remark, so the author can fix and resubmit (restarting from the plant head). | done |
| US-066 | As a plant head with no portal login, I want to **approve/reject budgets and requests from an emailed link**, so I don't need an account. | done |
| US-067 | As any internal user, I want to **preview the approval email and copy its link**, so I can see the email + URL layout (demo). | done |
| US-068 | As a requester, I want all field types **except Green Field** to need plant-head approval before sourcing. | done |
| US-069 | As sourcing, I want approving a vendor (RFQ or auction) to go **straight to the vendor's PI upload** with no head gate. | done |
| US-070 | As sourcing, I want starting a reverse auction to **cut the best price 5%** and **reset ranks** until vendors re-bid. | done |
| US-071 | As sourcing, I want to **require an item trial** before awarding; the vendor uploads a video/photo/report after the advance, I approve/reject (loop), and the **final payment is blocked** until approved. | done |
| US-072 | As global accounts ("Sandeep"), I want a **public emailed PO link** (`/po/[token]`) to **upload PO docs and issue the PO** (no login); then the **vendor re-uploads the PI**, **Accounts pays milestones**, and if a **trial** is required it runs after the advance (final payment gated). | done |
| US-073 | As plant accounts, I want the **final-payment date computed** from the supplier's delivery lead time (days) starting at the advance tick. | done |
| US-074 | As sourcing, I want **foreign vendors** to accept Incoterms before quoting, and to see **INR values with the original foreign amount below**. | done |
| US-075 | As anyone, I want the **currency I pick to actually change the displayed currency/amount** (bug fix). | done |
| US-076 | As the vendor, after the PO is issued I want to **re-upload the PI** against it. | done |
| US-077 | As a super admin, I want to **edit the budget line items** (not just write a remark) when sending it back, so the author sees my corrections. | done |
| US-078 | As a plant head, I want the **same edit + send-back-for-correction** ability on my approval link, not just approve/reject. | done |
| US-079 | As the budget-upload user (maintenance), I want my **Requests screen to show my budget approval requests** (status + corrections), not the item requests. | done |

- **Notes / related files:** `src/app/(public)/approve/[token]/page.tsx`, `src/components/EmailPreviewModal.tsx`, `src/components/TrialCard.tsx`, `src/lib/currencyUtils.ts`, `src/lib/trialUtils.ts`, `src/lib/tokenUtils.ts`, `src/lib/capexContext.tsx`, `src/lib/rfqUtils.ts`, `src/lib/paymentUtils.ts`, `src/components/{RfqPanel,VendorGrid,FinalDecisionActions,AccountsPanel,VendorOnboardModal}.tsx`, `src/app/(internal)/capex/{[id],budget-proposals,budget-approvals}/page.tsx`, `src/app/(public)/supplier/[token]/page.tsx`, `src/components/{Sidebar,TopNav}.tsx`, `src/app/login/page.tsx`. `plant_head*`/`sourcing_head` roles removed. Built with frontend/backend engineers; reviewed by security-auditor + quality-challenger + ux-tester; verified via `tsc`/`build` + runtime (plant-head approval + budget publish). See **Workflow overhaul (2026-07)** in `CLAUDE.md`.

---

## Story detail template

When a story needs acceptance criteria, the agent expands it below using this shape:

### US-XXX — Title

- **As a** …
- **I want** …
- **So that** …
- **Priority:** …
- **Status:** …
- **Acceptance criteria**
  - [ ] …
- **Notes / related files:** …
