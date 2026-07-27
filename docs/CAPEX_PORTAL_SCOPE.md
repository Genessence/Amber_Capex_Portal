# Amber CAPEX Portal — Scope of Work

**Prepared for:** Amber Enterprises India Ltd.
**Date:** 20 July 2026
**Version:** 2.0 (Revised Scope)

---

## 1. What this document is

This document explains, in plain business language, exactly what the Amber CAPEX Portal will do.

It describes:

- who works on the portal and how each person participates,
- the complete journey of a CAPEX requirement from budget planning to final payment,
- **every document the portal will create**, who receives it, and who signs it,
- how electronic signatures will work,
- what is included in this scope and what is not.

This version replaces the earlier scope. Two things have changed significantly:

1. **Documents are now created by the portal, not merely acknowledged.** Earlier, terms and conditions were shown to a vendor as text with an "Accept" or "Decline" button. In the new scope, the portal **prepares a proper, formal document** for every agreement, sends it to the vendor, and the vendor **signs it**. The signature then appears on the document itself, exactly as it would on paper.
2. **The Accounts teams no longer need portal accounts.** Both Plant Accounts and Global (Central) Accounts will work entirely through secure links sent to them by email. They will not log in, will not have user IDs, and will not need any training on the portal.
3. **A technical sign-off is now compulsory before any vendor is awarded.** Amber's Technical team must approve the specification of the machine each vendor is offering. Until they do, that vendor cannot be selected and no order can be raised on them. They too work purely from an email link, with no portal account.

---

## 2. Who uses the portal

### 2.1 People who log in

| Person | What they do |
|---|---|
| **Requester / Buyer (plant-wise)** | Raises the CAPEX requirement, selects the budget line and items, and tracks it to completion. Sees only their own plant. |
| **Maintenance / Budget Planner** | Prepares the next financial year's capital budget and raises mid-year budget transfer requests. |
| **Sourcing Team** | Invites vendors, issues enquiries, negotiates prices, runs reverse auctions, decides the winning vendor(s), and manages trials. |
| **Management / Administrator** | Approves the annual budget and budget transfers, and has full visibility across all plants. |

### 2.2 People who participate by email only — no login, no user ID

| Person | How they participate |
|---|---|
| **Plant Head** | Receives an email with a private link. Opens it, reviews the requirement or the budget, edits figures if needed, writes a remark, and approves, sends back for correction, or rejects — all from the link. Nothing to install, nothing to remember. |
| **Technical Team** | Receives an email with a private link carrying a vendor's machine specification and datasheets. Reviews it, and approves, sends it back for revision, or rejects — with remarks. No vendor can be awarded until they have signed off. **No login.** |
| **Plant Accounts** | Receives an email with a private link once a vendor's proforma invoice arrives. Allocates the Fixed Asset (FA) code against each item, signs, and submits. **No login.** |
| **Global / Central Accounts** | Receives an email with a private link. Issues the Purchase Order, signs it, releases it to the vendor, and then records each payment milestone as it is paid. **No login.** |
| **Vendors / Suppliers** | Receive an email with a private link for each enquiry. They review and sign the documents sent to them, submit prices, participate in auctions, upload proforma invoices, submit trial samples, and download their Purchase Order. **No login.** |

**Why this matters:** the only people who need to be set up as portal users are the plant buyers, maintenance, sourcing and management. Everyone else — plant heads, the technical team, both accounts teams, and all vendors — simply receives an email and acts on it. Each link is private, works only for that one person and that one task, and expires once the task is done.

---

## 3. The core change — documents are generated and signed

### 3.1 The problem with the old approach

Previously the portal displayed terms on a screen and asked the vendor to click "Accept". That leaves Amber with a click, not a document. There is nothing to file, nothing to attach to a Purchase Order, and nothing to produce if a dispute arises later.

### 3.2 The new approach

For every agreement point in the process, the portal will now:

1. **Create a proper document** on Amber's letterhead, with a unique document number, the enquiry/request reference, the plant, the vendor's details, the date, and the full text of the terms — with the actual figures, item names, quantities and dates filled in automatically from the requirement.
2. **Deliver the document to the signatory** — by email link for vendors, plant heads and the accounts teams; on screen for internal users.
3. **Take the signature.** The signatory reviews the document, and signs it. Signing is done by **uploading an image of their signature** (or drawing it on screen), along with their name and designation. Company stamp/seal may also be uploaded where required.
4. **Place the signature on the document.** The signature is printed into the signature block of that document — and, once captured, is applied to **every subsequent document that person signs** without them having to upload it again.
5. **Lock and file the signed document.** Once signed, the document cannot be altered. It is stored against the requirement and can be viewed, downloaded or printed at any time by anyone involved.

### 3.3 What every generated document will carry

- Amber Enterprises letterhead and company details
- A unique document number and revision number
- The CAPEX request number, plant and financial year
- The vendor / party name, address and contact details
- The full text of the agreement, with all figures and dates filled in
- A signature block showing: signature image, name, designation, company, and the date and time of signing
- A statement that the document was signed electronically through the Amber CAPEX Portal

### 3.4 Rules that apply to all documents

- **Nothing is changed after signature.** If a term or a price changes, the portal issues a **fresh revision** of the document (Rev. 1, Rev. 2 …) and both sides sign again. The earlier version is retained.
- **Both sides sign where the document is an agreement.** Vendor-facing agreements carry the vendor's signature and Amber's authorised signature.
- **Every document is traceable.** For each document the portal keeps a record of who created it, when it was sent, when it was opened, when it was signed, and by whom.
- **Every document is downloadable.** Individually, or as one complete file for the whole requirement.
- **Refusal is recorded too.** If a vendor declines a document, the decline and the reason are recorded and the sourcing team is informed.

> **Note on delivery:** in the current demonstration build, documents are displayed on screen and the flow can be walked through end to end. Signature capture, signature placement on the document, automatic email delivery and permanent filing become fully live when the system's central database and email service are built. The scope below is written for that live system.

---

## 4. Complete list of documents the portal will generate

Below is every document the portal will create, grouped by stage. For each: what it is, who receives it, and who signs it.

### Stage A — Annual budget planning

| # | Document | Sent to | Signed by |
|---|---|---|---|
| A1 | **Annual Capital Budget Proposal** — the proposed budget for the next financial year, plant-wise, listed head by head with every sub-item, quantity, rate, amount, reason for requirement, benefit and expected return, with head-wise sub-totals and a grand total | Plant Head, then Management, then Global Accounts | Prepared by Maintenance; signed in turn by Plant Head, Management and Global Accounts |
| A2 | **Budget Correction Advice** — issued when an approver edits figures and sends the proposal back, showing what was changed, from what to what, and the reason | The preparer | The approver who sent it back |
| A3 | **Budget Approval Certificate** — the final approval page carrying all approval signatures in sequence, confirming the budget is now live for the new financial year | All parties; filed against the financial year | Plant Head, Management, Global Accounts |
| A4 | **Adhoc Budget Transfer Note** — a request to move unspent budget from one head to another mid-year, showing the source head, its spare amount, the destination head, its shortfall, and the justification | Management | Requested by Sourcing/Plant; approved and signed by Management |

### Stage B — Raising the requirement

| # | Document | Sent to | Signed by |
|---|---|---|---|
| B1 | **CAPEX Requisition Form** — the formal requirement note: request number, plant, financial year, category, budget head, every line item with sub-particular, quantity, unit, specification, allocated budget, and the requester's justification | Plant Head | Requester |
| B2 | **Plant Head Approval Note** — the plant head's approval of the requirement, with any remark, confirming it may proceed to sourcing | Requester and Sourcing | Plant Head |
| B3 | **Plant Head Rejection / Send-Back Note** — the reason for rejection or the corrections required, with edited figures where applicable | Requester | Plant Head |

### Stage C — Vendor engagement and enquiry

| # | Document | Sent to | Signed by |
|---|---|---|---|
| C1 | **Vendor Registration Form** — the vendor's own details: company name, address, contact person, GST and PAN details, bank details and declarations | Vendor | Vendor |
| C2 | **Non-Disclosure Agreement** — confidentiality undertaking, issued where the requirement involves proprietary specifications | Vendor | Vendor and Amber |
| C3 | **Request for Quotation (Enquiry)** — the formal enquiry: every line item with description, quantity, unit, specification, required delivery period, quotation validity required, and instructions for quoting | Vendor | Issued and signed by Sourcing; acknowledged and signed by Vendor |
| C4 | **Commercial Terms Agreement** — scope of supply, quality and inspection requirements, packing, freight, and warranty obligations | Vendor | Vendor and Amber |
| C5 | **Performance Bank Guarantee Undertaking** — the vendor's undertaking to furnish a bank guarantee of 10% of order value, valid through the warranty period, released on successful supply, installation and completion of warranty obligations | Vendor | Vendor |
| C6 | **Delay Liability Agreement** — the delay clause: the delivery clock starts one week after the proforma invoice, 0.5% of order value is deducted for each week of delay up to a cumulative 5%, and 5% per week thereafter, stopping when final payment is released | Vendor | Vendor |
| C7 | **Payment Terms Agreement** — the milestone-wise payment schedule (for example 30% advance on Purchase Order, 60% on dispatch, 10% on installation), with the trigger for each milestone | Vendor | Vendor |
| C8 | **Additional Terms Document(s)** — any further document the sourcing team wishes to add for a particular enquiry, with its own title and text | Vendor | Vendor |
| C9 | **International Trade Terms Agreement (Incoterms 2020)** — issued to overseas vendors only. Records the agreed trade term, place or port of delivery, mode of transport, who arranges and pays for freight, who arranges and pays for insurance, export clearance responsibility, import duties responsibility, the exact point at which risk passes, loading and unloading responsibility, and delivery timeline and currency remarks | Vendor | Vendor and Amber, after both sides agree |
| C10 | **Amended Trade Terms Advice** — issued whenever either side proposes a change to the trade terms, showing the changed points and the accompanying note | The other party | The party proposing the change |

### Stage D — Quotation and negotiation

| # | Document | Sent to | Signed by |
|---|---|---|---|
| D1 | **Vendor Quotation** — the vendor's formal quotation created from the prices they enter: line-wise unit rate, quantity, line value, HSN code and applicable GST per line, freight, packing, service charges, delivery period, warranty, currency, and grand total inclusive of tax | Sourcing | Vendor |
| D2 | **Counter-Offer Note** — Amber's revised price offer, line by line, with the revised charges and any covering remark | Vendor | Sourcing |
| D3 | **Vendor Revised Quotation** — the vendor's response to a counter-offer | Sourcing | Vendor |
| D4 | **Final Agreed Quotation** — the mutually accepted price sheet, line by line, with all charges, taxes and the final grand total | Both parties | Vendor and Sourcing |
| D5 | **Quotation Withdrawal / Decline Note** — recorded when a vendor declines to quote or withdraws, with the reason | Sourcing | Vendor |

### Stage E — Reverse auction (where used)

| # | Document | Sent to | Signed by |
|---|---|---|---|
| E1 | **Business Rules for Reverse Auction** — auction date, opening and closing time, the deadline by which the vendor must confirm participation, the buyer's name, designation, email and mobile, delivery locations, bid validity period, the maximum number of price reductions permitted, the automatic time-extension rule and how many extensions each bidder gets, the currency, and the commercial, bank guarantee and delay-liability terms that apply | Vendor | Vendor (confirming participation) and Amber |
| E2 | **Auction Participation Confirmation** — the vendor's confirmation that they will bid | Sourcing | Vendor |
| E3 | **Auction Non-Participation / Decline Note** — recorded when a vendor declines or does not respond by the deadline | Sourcing | Vendor, or recorded by Sourcing where no response was received |
| E4 | **Auction Reminder Notice** — a reminder to vendors yet to confirm | Vendor | Issued by Sourcing |
| E5 | **Vendor Bid Confirmation** — the vendor's final bid: line-wise rates, charges and total, with the time it was placed | Vendor and Sourcing | Vendor |
| E6 | **Auction Closing Report** — the complete auction record: opening price to beat, every bid received, final standings, savings achieved against the opening position, and the time the auction closed | Internal file | Sourcing |

### Stage F — Technical specification approval (before any vendor can be awarded)

Before a vendor can be selected, Amber's own Technical team must sign off on the machine or equipment that vendor is offering. This is done **vendor by vendor**, because different vendors offer different machines — and where an order is split across vendors, each one is signed off separately. The Technical team works entirely from an email link and has no portal account.

| # | Document | Sent to | Signed by |
|---|---|---|---|
| F1 | **Technical Specification Approval Request** — the complete specification package for one vendor's offering: the vendor's own datasheets, drawings and technical literature, together with the sourcing team's notes on the machine, its capacity, and any deviation that needs checking | Technical Team | Issued and signed by Sourcing |
| F2 | **Technical Specification Approval Certificate** — the Technical team's sign-off confirming the offered machine meets the requirement, with their remarks. This is what unlocks the award for that vendor | Sourcing and internal file | **Technical Team, by email link — no login** |
| F3 | **Technical Revision Advice** — issued where the Technical team wants the specification revised: what is missing or incorrect, and what is to be resubmitted | Sourcing | **Technical Team, by email link — no login** |
| F4 | **Technical Rejection Note** — issued where the offered machine does not meet the requirement, with reasons. That vendor cannot be awarded | Sourcing | **Technical Team, by email link — no login** |
| F5 | **Revised Specification Submission** — the corrected package sourcing resubmits after a revision advice, showing what was changed | Technical Team | Sourcing |

### Stage G — Selection and award

| # | Document | Sent to | Signed by |
|---|---|---|---|
| G1 | **Comparative Statement** — all quoting vendors side by side, line item by line item, showing each vendor's rate, taxes and totals, with the lowest highlighted for each line and overall, the technical sign-off status of each vendor, and the recommendation | Management / internal file | Sourcing |
| G2 | **Final Decision Note** — the selected vendor and final agreed price for each line item, including cases where different lines are awarded to different vendors, with the total award value per vendor | Internal file | Sourcing |
| G3 | **Letter of Award / Letter of Intent** — the formal award to each winning vendor, listing the items awarded to them, the agreed rates, the total value, the delivery period and the terms already agreed | Vendor | Amber; acknowledged and signed by Vendor |
| G4 | **Regret Letter** — a courteous notification to vendors who were not awarded | Vendor | Sourcing |

### Stage H — Trial / sample approval (where required)

| # | Document | Sent to | Signed by |
|---|---|---|---|
| H1 | **Trial Requirement Advice** — confirms that a trial or sample is required before the final payment, what is to be submitted and by when | Vendor | Sourcing |
| H2 | **Trial Submission Form** — the vendor's submission: sample details, test reports, photographs, video evidence and the vendor's declaration | Sourcing | Vendor |
| H3 | **Trial Approval Certificate** — confirms the trial has passed and the final payment may proceed | Vendor | Sourcing / Quality |
| H4 | **Trial Rejection Report** — the reasons for rejection and what the vendor must correct and resubmit | Vendor | Sourcing / Quality |

### Stage I — Order, accounts and payment

| # | Document | Sent to | Signed by |
|---|---|---|---|
| I1 | **Proforma Invoice Request** — the formal request to the awarded vendor to raise a proforma invoice against the awarded items | Vendor | Sourcing |
| I2 | **Proforma Invoice Acknowledgement** — Amber's acknowledgement of the vendor's proforma invoice, confirming the items, values and taxes received | Vendor | Sourcing |
| I3 | **Fixed Asset Code Allocation Sheet** — every awarded line item with its allocated Fixed Asset code, the plant and the capitalisation head | Global Accounts | **Plant Accounts, by email link — no login** |
| I4 | **Purchase Order** — the formal order: PO number and date, vendor details, plant and delivery address, every line item with rate, quantity, value, HSN and GST, freight and other charges, order total, delivery schedule, payment milestones, warranty, bank guarantee requirement and delay liability terms | Vendor | **Global Accounts, by email link — no login**; acknowledged and signed by Vendor |
| I5 | **Purchase Order Acknowledgement** — the vendor's confirmation of receipt and acceptance of the order | Global Accounts and Sourcing | Vendor |
| I6 | **Purchase Order Amendment** — issued whenever the order value, quantity, delivery date or terms change after issue, showing the original and revised particulars and the reason | Vendor | Global Accounts; acknowledged and signed by Vendor |
| I7 | **Payment Advice (one per milestone)** — the milestone being released, the percentage and amount, the invoice reference and the date of release | Vendor | **Global Accounts, by email link — no login** |
| I8 | **Advance Payment Acknowledgement** — the vendor's confirmation of receipt of the advance | Global Accounts | Vendor |
| I9 | **Delay Deduction Note** — issued where delivery has run past the agreed period: the number of weeks delayed, the deduction percentage applied, the amount deducted and the revised payable | Vendor | Global Accounts; acknowledged by Vendor |
| I10 | **Final Payment & Order Completion Certificate** — confirms the order is fully supplied, installed where applicable, fully paid, and closed | Vendor and internal file | Global Accounts and Vendor |
| I11 | **Bank Guarantee Release Note** — confirms the performance bank guarantee is released on completion of the warranty obligations | Vendor | Global Accounts |

### Stage J — Records

| # | Document | Purpose |
|---|---|---|
| J1 | **Complete Case File** — one downloadable file per CAPEX request containing every signed document from requisition to completion, in sequence |
| J2 | **Approval Trail Sheet** — a single page listing every action taken on the request, who took it, when, and with what remark |

---

## 5. What each person will be able to do

### 5.1 Requester / Buyer

- Raise a requirement by choosing the project category, the plant, the budget head, and then the exact budget sub-items already approved in the annual budget — so no requirement can be raised against money that was never sanctioned.
- See, against each line, how much budget was allocated and whether the request is within or over that allocation, marked clearly in green or red.
- Attach supporting documents and vendor references.
- Sign and submit the requisition, and forward the plant head's approval link straight from the portal, with a ready-made email that can be copied and sent.
- Track the requirement at every stage — approval, enquiry, negotiation, award, order, delivery and payment — and open any signed document at any point.

### 5.2 Plant Head — by email link only

- Open a private link and see the full requirement or budget proposal, with every line item, quantity, rate and allocated amount.
- Edit the figures where the numbers need correcting, add a remark, and send it back for correction.
- Approve or reject, and sign — with the signature appearing on the approval note.
- No user ID, no password, no training required.

### 5.3 Maintenance / Budget Planner

- Prepare the next financial year's capital budget, starting from the current year's approved budget as a base.
- Enter items line by line, or upload the whole budget from an Excel sheet using a downloadable template.
- Submit it for approval and track it through plant head, management and accounts approval.
- See any correction remark, make the corrections, and resubmit.
- Raise a request to transfer unspent budget from one head to another during the year.

### 5.4 Sourcing Team

- Invite vendors to an enquiry and choose, vendor by vendor, exactly which documents that vendor must sign.
- Add a new vendor on the spot where required, marking whether they are an overseas supplier — overseas suppliers are automatically issued the international trade terms agreement.
- Receive vendor quotations line by line, with tax computed automatically from the HSN code the vendor enters.
- Compare all vendors side by side on one screen, with the lowest price highlighted for every line and overall.
- Negotiate line by line, sending counter-offers and receiving revised quotations, until a price is agreed.
- Escalate an enquiry to a reverse auction where at least two vendors have quoted — the auction opens at 5% below the best price already received, so bidding starts from a stronger position.
- Run the auction with a live countdown, close it early where required, and see the full bid record.
- Send each vendor's machine specification — the vendor's own datasheets and drawings, plus their own notes — to Amber's Technical team for sign-off, and see at a glance which vendors are approved, which are awaiting review, and which have been sent back.
- Revise and resend a specification as many times as the Technical team requires.
- Award the requirement — to a single vendor, or line by line to different vendors, each award then running its own order, delivery and payment track. Only technically approved vendors can be awarded.
- Require a trial or sample before final payment, and approve or reject what the vendor submits.
- Issue every document above and see, at a glance, which vendor has signed what and which are still pending.

### 5.5 Technical Team — by email link only

- Receive an email with a private link the moment sourcing sends a vendor's specification for review.
- Open the link and see the requirement, the vendor, the items being offered, the sourcing team's notes, and every datasheet, drawing and technical document — viewable and downloadable.
- Approve the specification with a remark, and sign — the approval certificate is generated and the vendor becomes eligible for award.
- Send it back for revision, stating exactly what is missing or incorrect, so sourcing can resubmit.
- Reject the specification outright, with reasons — that vendor cannot then be awarded.
- Review each vendor separately, so a requirement split across suppliers is signed off machine by machine.
- No user ID, no password.

### 5.6 Plant Accounts — by email link only

- Receive an email the moment a vendor's proforma invoice arrives.
- Open the link, see every awarded line item with its description, quantity and value.
- Enter the Fixed Asset code against each line.
- Sign and submit — which automatically notifies Global Accounts with the complete allocation sheet attached.
- No user ID, no password.

### 5.7 Global / Central Accounts — by email link only

- Receive an email with a private link once the Fixed Asset codes are allocated.
- Open the link, see the requirement, the awarded vendor, the agreed prices and the proforma invoice.
- Enter the Purchase Order number, generate the Purchase Order, sign it, and release it to the vendor — the vendor is notified immediately and can download the signed order.
- Record each payment milestone as it is released, with the vendor notified at each step.
- See the delivery clock and any delay deduction that applies before releasing the final payment.
- Be prevented from releasing the final payment where a trial was required and has not yet been approved.
- No user ID, no password.

### 5.8 Vendor / Supplier — by email link only

- Open a private link and see the full enquiry: every item, quantity, specification and required delivery.
- Read and sign each document sent to them, uploading their signature once and having it applied to every document thereafter.
- Enter prices line by line — unit rate, HSN code, freight, packing, service charges, delivery period, warranty and currency — and see the total, including tax, calculated live.
- Quote in their own currency; Amber sees both the original currency and the equivalent in rupees for comparison.
- Answer the international trade terms questions at the time of quoting, where they are an overseas supplier.
- Submit the machine's datasheets, drawings and technical literature along with the quotation, so Amber's Technical team can review what is being offered.
- Receive counter-offers, and accept, counter or decline.
- Participate in a reverse auction, seeing their rank, the price to beat and the countdown, and rebid until the auction closes.
- Upload the proforma invoice, download the signed Purchase Order, upload trial samples and reports, and see each payment as it is released.
- Work entirely from a phone or a desktop — every screen is built for both.

### 5.9 Management / Administrator

- Approve or send back the annual budget for every plant.
- Approve budget transfers between heads.
- See every request, every vendor, every document and every approval across all plants.
- See spend against budget, savings achieved through negotiation and auction, and where budgets are running over.

---

## 6. How the electronic signature works

1. **First time a person signs.** They are asked to provide their signature — by uploading a scanned image of it, or drawing it on the screen with a finger or mouse — along with their name and designation. A company stamp may also be uploaded.
2. **The signature is saved against that person.** From then on, every document they sign is signed with one confirmation click; they are not asked to upload again.
3. **The signature is placed on the document.** It appears in the signature block of the document itself, above the person's name, designation and company, with the date and time of signing printed alongside.
4. **Both parties appear on two-sided agreements.** Amber's authorised signature appears alongside the vendor's on every agreement, order and certificate.
5. **The document is then locked.** It cannot be edited afterwards. Any change requires a fresh revision, signed again by both sides, with the earlier version retained on file.
6. **Everything is recorded.** For each document the portal keeps a record of when it was created, sent, opened and signed, and by whom — available on the approval trail sheet.

---

## 7. Rules built into the process

- **No requirement can exceed sanctioned budget without visibility.** Every line shows its sanctioned allocation and flags an overrun in red.
- **Budget is approved in sequence, not in parallel.** Plant Head, then Management, then Global Accounts. Any of them can send it back with edits, and it restarts from the plant head.
- **A vendor cannot quote before signing the terms.** The pricing screen stays locked until the documents sent to that vendor are signed.
- **A vendor cannot be awarded while trade terms are unsettled.** Overseas suppliers must have their international trade terms agreed before the order can proceed.
- **No vendor can be awarded without technical sign-off.** The Technical team must approve that vendor's machine specification. The step cannot be skipped — a vendor whose specification was never sent for review is treated exactly like one that was rejected, and cannot be selected.
- **Technical approval is per vendor, not per requirement.** Where different items go to different suppliers, each supplier's machine is signed off on its own merits.
- **A reverse auction can only be raised from a live enquiry with at least two quotations** — so there is always a genuine benchmark to bid against.
- **Awarded vendors run independently.** Where different items go to different vendors, each vendor has its own proforma invoice, asset codes, Purchase Order, trial and payments. The requirement closes only when every award closes.
- **The final payment is protected.** Where a trial was required, the final milestone cannot be released until the trial is approved.
- **Delay is calculated, not argued.** The clock starts one week after the proforma invoice; deductions accrue automatically per the signed delay clause and are shown live to both sides.

---

## 8. What is not included in this scope

- Integration with Amber's ERP or accounting system. Purchase Orders, asset codes and payments are recorded in the portal; posting them into the ERP is a separate exercise.
- Physical goods receipt, inspection at gate, and stores/inventory management.
- Vendor bank payment execution. The portal records that a milestone has been released; the funds transfer itself happens in the bank/ERP.
- Legally certified digital signatures issued by a certifying authority. The portal's signatures are signature images applied with a full record of who signed and when — sufficient for internal control and commercial correspondence.
- Statutory filing of any kind.

---

## 9. What we need from Amber

- Amber letterhead artwork and the company details to appear on every document.
- The approved standard text for the commercial terms, bank guarantee, delay liability and payment terms documents, and confirmation of the standard payment milestone split.
- The list of plants, budget heads and the Fixed Asset code structure.
- The names, designations and email addresses of the plant heads, the technical team reviewers, the plant accounts contacts and the global accounts contact.
- Confirmation of who in the Technical team is authorised to sign off machine specifications, and whether that differs by plant or by equipment type.
- The authorised signatory for Purchase Orders and their signature.
- Confirmation of the document numbering format Amber wishes to use.

---

## 10. Summary

The portal takes a CAPEX requirement from the annual budget through to final payment, and at every point where two parties must agree, it produces a **real, numbered, signed document** rather than a click. No vendor reaches an order without the Technical team having signed off the machine being supplied. Vendors, plant heads, the technical team and both accounts teams participate entirely through private email links, with no accounts to create and nothing to learn. Everything that happens is recorded, and every signed document can be produced on demand — as a single case file for the whole requirement.
