export type CapexStatus =
  | 'draft'
  | 'submitted'
  | 'pending_head_approval'
  | 'sourcing'
  | 'negotiation'
  | 'sourcing_approved'
  | 'buyer_approved'
  // Brown Field fulfillment chain (shared by RFQ + auction paths)
  | 'pi_requested'
  | 'pi_submitted'
  | 'accounts_processing'
  | 'payment_in_progress'
  | 'completed'
  | 'rejected';

export type AuctionApprovalStatus =
  | 'not_sent'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'excluded'
  | 'overdue';

/**
 * RFQ negotiation state (Brown Field RFQ flow — vendor quotes first).
 * Sourcing invites + sends the link → `awaiting_quote`; the vendor submits the first quotation
 * → `pending_sourcing`; sourcing may counter → `pending_vendor`; either side then accepts
 * → `approved` (or `rejected`). On approval the approval documents auto-send for separate vendor
 * sign-off. `not_sent` is the shared default for auction/legacy invites.
 */
export type RfqPriceStatus =
  | 'not_sent'
  | 'awaiting_quote'
  | 'pending_vendor'
  | 'pending_sourcing'
  | 'approved'
  | 'rejected';

/** Vendor response to the document-approval package (PBG + DLC + one-time terms). */
export type DocApprovalStatus = 'not_sent' | 'pending' | 'approved' | 'rejected';

/** Lifecycle of a next-FY Brown Field budget proposal. */
export type BudgetProposalStatus = 'draft' | 'pending_admin' | 'approved' | 'rejected';

/** Lifecycle of an Adhoc head-to-head budget transfer request. */
export type AdhocBudgetStatus = 'pending_admin' | 'approved' | 'rejected';

/** Per-milestone payment state. */
export type PaymentMilestoneStatus = 'pending' | 'paid';

export const CAPEX_STATUS_FLOW: CapexStatus[] = [
  'draft',
  'submitted',
  'pending_head_approval',
  'sourcing',
  'negotiation',
  'sourcing_approved',
  'buyer_approved',
  'pi_requested',
  'pi_submitted',
  'accounts_processing',
  'payment_in_progress',
  'completed',
  'rejected',
];

export const HEAD_APPROVAL_THRESHOLD = 1_000_000; // ₹10,00,000

export type FieldType =
  | 'green_field'
  | 'brown_field'
  | 'digitisation'
  | 'information_technology';

/** Business category (RAC, EMS, Component, Fan) — scopes master data per plant/FY for Brown and Green Field. */
export type ProjectType = 'rac' | 'ems' | 'component' | 'fan';

/** @deprecated Use ProjectType */
export type GreenFieldProjectType = ProjectType;

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  brown_field: 'Brown Field',
  green_field: 'Green Field',
  digitisation: 'Digitisation',
  information_technology: 'Information Technology',
};

export interface GreenFieldDivisionBudget {
  division: string;
  head: string;
  totalCostCr: number;
}

/** Green Field plant-level budget envelope (Cr) scoped by FY + project type + plant. */
export interface GreenFieldPlantBudget {
  plant: string;
  fy: string;
  projectType: ProjectType;
  budgetCr: number;
}

/** Green Field section-level budget envelope (Cr) inside a plant. */
export interface GreenFieldSectionBudget {
  plant: string;
  fy: string;
  projectType: ProjectType;
  division: string;
  budgetCr: number;
}

/** Green Field head-level budget envelope (Cr) within a section. */
export interface GreenFieldHeadBudget {
  plant: string;
  fy: string;
  projectType: ProjectType;
  division: string;
  head: string;
  budgetCr: number;
}

export interface GreenFieldBudgetAllocations {
  plantBudgets: GreenFieldPlantBudget[];
  sectionBudgets: GreenFieldSectionBudget[];
  headBudgets: GreenFieldHeadBudget[];
}

/**
 * Brown Field head-level budget override (Cr), written only by approved Adhoc Budget
 * transfers. Same shape as GreenFieldHeadBudget; `division` is FLAT_MASTER_DIVISION.
 * When absent for a head, the head allocation falls back to the summed `totalCost` of its rows.
 */
export type BrownFieldHeadBudget = GreenFieldHeadBudget;

export interface GreenFieldPlantCreation {
  plantValue: string;
  plantLabel: string;
  state: string;
  assignedUser?: string;
  projectType: ProjectType;
  fy: string;
  /** Overall plant budget (Cr) assigned at creation. */
  budgetCr?: number;
  /** @deprecated Pre-flat master; optional on legacy requests */
  divisionBudgets?: GreenFieldDivisionBudget[];
}

export interface AuctionConfig {
  startedAt: string;
  durationDays: number;
  endsAt: string;
  threshold?: number;
}

export interface DeliveryLocation {
  name: string;
  state: string;
  subLocationCount?: number;
}

export interface AuctionRules {
  bidValidityDays: number;
  maxDecrements: number;
  extensionDurationMinutes: number;
  maxExtensionsPerBidder: number;
  currency: string;
}

export interface AuctionApprovalDocument {
  id: string;
  generatedAt: string;
  sentAt?: string;
  vendorRevertDeadlineAt?: string;
  auctionDate: string;
  auctionOpeningTime: string;
  auctionClosingTime: string;
  bidderAcceptanceDeadlineDate: string;
  bidderAcceptanceDeadlineTime: string;
  buyerName: string;
  buyerDesignation: string;
  buyerEmail: string;
  buyerMobile: string;
  deliveryLocations?: DeliveryLocation[];
  rules: AuctionRules;
  supplyFrame?: string;
  paymentTerms?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  /** Performance Bank Guarantee text sent for vendor agreement (auction approval package). */
  performanceBankGuaranteeText?: string;
  /** Delay Liability Clause text sent for vendor agreement (auction approval package). */
  delayLiabilityClauseText?: string;
}

export interface TechSpecs {
  specifications: string;
  complianceStandards: string;
}

export interface RequestComment {
  id: string;
  by: 'buyer' | 'sourcing' | 'sourcing_head';
  senderName: string;
  message: string;
  at: string;
}

export interface VendorRecommendation {
  vendorName: string;
  reason: string;
}

export interface CapexLineItem {
  id: string;
  masterItemId?: string;
  masterHead?: string;
  division?: string;
  machineCapacity?: string;
  description: string;
  category: string;
  quantity: string;
  uom?: string;
  specs?: string;
  /** HSN code for THIS item; the GST rate (and per-line GST amount) is derived from it. Item-wise — same across all vendors. */
  hsnCode?: string;
  lastPrice?: number;
  lastVendor?: string;
  budget?: number;
  remarks?: string;
  vendorRecommendation?: VendorRecommendation;
  attachmentName?: string;
  attachmentBase64?: string;
}

export interface SourcingDecision {
  selectedVendorId?: string;
  finalPrices?: Record<string, string>;
  freight?: string;
  packing?: string;
  service?: string;
  delivery?: string;
  warranty?: string;
  currency?: string;
  offerCols?: Array<{ vendorId: string; prices: Record<string, string>; attrs: Record<string, string> }>;
  finalVendorPerItem?: Record<string, string>;
  savedAt?: string;
}

export interface LandDocument {
  id: string;
  name: string;
  base64: string;
  mimeType?: string;
  uploadedAt: string;
}

export interface CapexRequest {
  id: string;
  requestNo?: string;
  fieldType?: FieldType;
  /** Business category (RAC, EMS, Component, Fan) for Brown/Green Field master scoping. */
  projectType?: ProjectType;
  /** @deprecated Use projectType */
  greenFieldProjectType?: ProjectType;
  greenFieldPlantCreation?: GreenFieldPlantCreation;
  masterItemId?: string;
  subject: string;
  category: string;
  quantity: string;
  budget?: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  justification: string;
  techSpecs: TechSpecs;
  plant?: string;
  assignedTo: string;
  status: CapexStatus;
  rejectionReason?: string;
  sourcingDecision?: SourcingDecision;
  auctionConfig?: AuctionConfig;
  auctionApprovalDocument?: AuctionApprovalDocument;
  createdBy: string;
  createdAt: string;
  comments?: RequestComment[];
  statusHistory?: { status: CapexStatus; actor: string; at: string }[];
  remarks?: string;
  vendorRecommendation?: VendorRecommendation;
  reasonForRequirement?: string;
  benefitsRoi?: string;
  attachmentName?: string;
  attachmentBase64?: string;
  lineItems?: CapexLineItem[];
  landDocuments?: LandDocument[];
  // ── Brown Field fulfillment (RFQ / auction → PI → accounts → payments) ──
  /** Sourcing path chosen for this request. */
  sourcingMode?: 'rfq' | 'auction';
  /** RFQ per-line "Final Decision" — winning vendor id keyed by CapexLineItem id. */
  rfqFinalVendorPerItem?: Record<string, string>;
  /** Finalized vendor for fulfillment (PI / PO / payments / TAT). */
  finalVendorId?: string;
  /** FA codes assigned by accounts, keyed by line-item id. */
  faCodes?: Record<string, string>;
  purchaseOrder?: PurchaseOrder;
  paymentMilestones?: PaymentMilestone[];
  /** When the vendor submitted the Proforma Invoice (TAT clock anchor). */
  piSubmittedAt?: string;
  /** When the final payment was made — stops the TAT clock. */
  tatStoppedAt?: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  amount: number;
  createdAt: string;
  createdBy: string;
  submittedAt?: string;
  notes?: string;
  // ── Global Accounts: uploaded PO document sent to the vendor ──
  poDocumentBase64?: string;
  poDocumentName?: string;
  poDocumentMimeType?: string;
  poDocumentUploadedAt?: string;
  /** When the PO was issued to the vendor (vendor notified + sees it on the portal). */
  issuedAt?: string;
  issuedBy?: string;
}

export interface PaymentMilestone {
  id: string;
  label: string;
  percent: number;
  trigger?: string;
  amount: number;
  status: PaymentMilestoneStatus;
  paidAt?: string;
  paidBy?: string;
  /** The last instalment — ticking it stops the TAT clock and completes the request. */
  isFinal?: boolean;
}

/** One head/sub-particular row inside a next-FY Brown Field budget proposal. */
export interface BudgetProposalItem {
  id: string;
  head: string;
  department: string;
  subParticulars: string;
  rate: number;
  totalCost: number;
  division?: string;
  qty?: number;
  rateRs?: number;
  sNo?: string;
  reasonForRequirement?: string;
  benefits?: string;
  roi?: string;
  /** Set when this row was cloned from a live-FY master item. */
  sourceMasterItemId?: string;
}

/** A maintenance-authored Brown Field budget for a future FY, pending admin approval. */
export interface BudgetProposal {
  id: string;
  plant: string;
  projectType: ProjectType;
  /** The new FY this proposal publishes into when approved, e.g. "2027-28". */
  targetFy: string;
  /** The live FY this proposal was based on. */
  sourceFy?: string;
  status: BudgetProposalStatus;
  items: BudgetProposalItem[];
  createdBy: string;
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
  publishedAt?: string;
}

/** A request to move budget between two heads in the same plant + FY (admin-approved). */
export interface AdhocBudgetRequest {
  id: string;
  plant: string;
  fy: string;
  projectType: ProjectType;
  fromHead: string;
  toHead: string;
  amountCr: number;
  reason?: string;
  status: AdhocBudgetStatus;
  createdBy: string;
  createdByRole?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
}

/** A single instalment of a vendor's payment-terms split (e.g. 30% advance). */
export interface PaymentSplit {
  id: string;
  /** Display label, e.g. "Advance", "On Dispatch", "On Installation". */
  label: string;
  /** Percentage of the order value (0–100). */
  percent: number;
  /** When this instalment is triggered, e.g. "On PO", "On dispatch", "On installation". */
  trigger?: string;
}

export interface Vendor {
  id: string;
  vendorCode: string;
  vendorName: string;
  category: string;
  gstin: string;
  pan: string;
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  paymentTerms: 'Net-30' | 'Net-60' | 'Advance';
  bankName: string;
  accountNumber: string;
  ifsc: string;
  onboardedAt: string;
  /** True for one-time / not-yet-onboarded vendors whose terms aren't fetched from the onboarding portal. */
  oneTime?: boolean;
  /** Human-readable payment terms (mock: fetched from the external onboarding portal for onboarded vendors). */
  paymentTermsText?: string;
  /** Structured payment-terms split (e.g. 30/60/10) used to build payment milestones. */
  paymentSplits?: PaymentSplit[];
}

export interface Quote {
  id: string;
  price: number;
  itemPrices?: Record<string, number>;
  deliveryDays: number;
  validUntil: string;
  attachmentName?: string;
  attachmentBase64?: string;
  note?: string;
  submittedAt: string;
  freight?: number;
  packing?: number;
  service?: number;
  warranty?: number;
  currency?: string;
  /** True when the buyer seeded this quote during request creation. */
  seededByBuyer?: boolean;
}

export interface NegotiationMessage {
  id: string;
  by: 'sourcing' | 'supplier';
  senderName: string;
  message: string;
  counterPrice?: number;
  at: string;
  type?: 'counter' | 'message';
  counterDelivery?: number;
  counterFreight?: number;
  counterRemarks?: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  to: string;
  toName: string;
  text: string;
  at: string;
}

export interface CapexMasterItem {
  id: string;
  fieldType?: FieldType;
  /** Business category (RAC, EMS, Component, Fan) for Brown/Green Field master scoping. */
  projectType?: ProjectType;
  /** @deprecated Use projectType */
  greenFieldProjectType?: ProjectType;
  division?: string;
  plant: string;
  head: string;
  department: string;
  subParticulars: string;
  rate: number;
  totalCost: number;
  fy: string;
  /** Serial number from RAC plant workbook (Brown Field). */
  sNo?: string;
  /** Unit rate in INR from workbook. */
  rateRs?: number;
  qty?: number;
  reasonForRequirement?: string;
  benefits?: string;
  roi?: string;
}

export interface PlantMeta {
  value: string;
  label: string;
  state: string;
  assignedUser?: string;
  /** Set when plant is created via Green Field master flow */
  greenFieldPlant?: boolean;
}

/** A full RFQ quotation (mirrors the reverse-auction quote fields). */
export interface RfqQuote {
  /** Base subtotal = Σ(linePrices[itemId] × qty). Excludes freight/packing/service. */
  price: number;
  /** Per-line unit prices keyed by CapexLineItem id (mirrors the auction Quote.itemPrices). */
  linePrices?: Record<string, number>;
  freight?: number;
  packing?: number;
  service?: number;
  deliveryWeeks?: number;
  warranty?: number;
  currency?: string;
  /** @deprecated HSN now lives per line item on CapexLineItem.hsnCode. Kept only as a legacy fallback for old lump-sum quotes. */
  hsnCode?: string;
}

/** One entry in the RFQ negotiation thread (either side may propose / counter / accept). */
export interface RfqPriceMessage {
  id: string;
  by: 'sourcing' | 'supplier';
  senderName: string;
  /** Convenience copy of the offered price; full offer in `quote`. */
  price?: number;
  /** The full quotation offered on 'proposed' / 'revised' / 'countered' actions. */
  quote?: RfqQuote;
  action: 'requested' | 'proposed' | 'revised' | 'countered' | 'approved' | 'rejected';
  message?: string;
  at: string;
}

/**
 * Document-approval package sent to a vendor before PI/auction bidding.
 * Always carries PBG + DLC; carries payment terms only for one-time vendors.
 */
export interface DocApprovalPackage {
  id: string;
  sentAt?: string;
  respondedAt?: string;
  /** Business / RFQ terms text. */
  termsText?: string;
  performanceBankGuaranteeText?: string;
  delayLiabilityClauseText?: string;
  /** Payment terms included only for one-time / non-onboarded vendors. */
  paymentTermsText?: string;
  paymentSplits?: PaymentSplit[];
  /** Note shown when the package is re-sent with corrections. */
  revisionNote?: string;
}

/** Proforma Invoice uploaded by the vendor via the supplier portal. */
export interface ProformaInvoice extends LandDocument {
  amount?: number;
  note?: string;
  submittedByVendor?: boolean;
}

/**
 * INCO (Incoterms 2020) agreement state. Sourcing sends the 12-question form to a new/one-time
 * vendor; the vendor fills it (→ pending_sourcing); sourcing edits & resends (→ pending_vendor)
 * or approves; either side may approve/reject. A one-time vendor must reach `approved` before they
 * can submit a price quote. Mirrors the RFQ turn-taking.
 */
export type IncoTermsStatus =
  | 'not_sent'
  | 'awaiting_vendor'
  | 'pending_sourcing'
  | 'pending_vendor'
  | 'approved'
  | 'rejected';

/** The 12 Incoterms answers (all optional until filled). Keys match INCO_TERMS_QUESTIONS. */
export interface IncoTermsDoc {
  id: string;
  sentAt?: string;
  respondedAt?: string;
  revisionNote?: string;
  incoterm?: string;
  placeOfDelivery?: string;
  modeOfTransport?: string;
  freightArrangedBy?: string;
  freightCostBy?: string;
  insuranceArrangedBy?: string;
  insuranceCostBy?: string;
  exportCustoms?: string;
  importCustoms?: string;
  riskTransfer?: string;
  loadingUnloading?: string;
  remarks?: string;
}

export interface IncoTermsMessage {
  id: string;
  by: 'sourcing' | 'vendor';
  senderName: string;
  doc?: IncoTermsDoc;
  action: 'sent' | 'filled' | 'revised' | 'approved' | 'rejected';
  message?: string;
  at: string;
}

export interface VendorInvite {
  id: string;
  requestId: string;
  vendorId: string;
  token: string;
  status: 'invited' | 'quote_received' | 'negotiating' | 'approved' | 'rejected';
  quotes: Quote[];
  negotiationThread: NegotiationMessage[];
  invitedAt: string;
  auctionApprovalStatus: AuctionApprovalStatus;
  approvalDocumentSentAt?: string;
  approvalRespondedAt?: string;
  approvalReminderSentAt?: string;
  approvalExcludedAt?: string;
  approvalExclusionReason?: string;
  // ── Brown Field RFQ flow ──
  /** The current RFQ quotation on the table (latest offer from either side). */
  rfqQuote?: RfqQuote;
  rfqStatus?: RfqPriceStatus;
  rfqThread?: RfqPriceMessage[];
  // ── Document-approval package (RFQ + auction) ──
  docApprovalStatus?: DocApprovalStatus;
  docApprovalPackage?: DocApprovalPackage;
  // ── INCO (Incoterms) agreement — gates quoting for one-time vendors ──
  incoTermsStatus?: IncoTermsStatus;
  incoTermsDoc?: IncoTermsDoc;
  incoTermsThread?: IncoTermsMessage[];
  // ── Proforma Invoice (post price-approval) ──
  proformaInvoice?: ProformaInvoice;
  // ── Split award (reverse auction): this invite becomes a self-contained fulfillment track ──
  // A request is "award-based" when at least one of its invites has `awarded === true`. Each
  // awarded vendor runs its OWN PI → terms → PO → payments track via the fields below, so one
  // request can fan out to multiple vendors. Single-vendor / RFQ requests leave these undefined and
  // keep using the request-level fulfillment fields (finalVendorId, request.purchaseOrder, etc.).
  awarded?: boolean;
  /** Line-item ids (CapexLineItem.id) won by this vendor. */
  awardedItemIds?: string[];
  /** Σ Final-Decision net for the awarded items + item-wise GST (GST-inclusive) — drives PO + milestones. */
  awardAmount?: number;
  /** Per-award fulfillment status (doc-approval is tracked separately via docApprovalStatus). */
  awardStatus?: AwardStatus;
  /** FA codes for this award's items, keyed by line-item id. */
  faCodes?: Record<string, string>;
  /** This award's own Purchase Order + payment milestones (per-vendor). */
  purchaseOrder?: PurchaseOrder;
  paymentMilestones?: PaymentMilestone[];
  /** Per-award TAT anchors. */
  piSubmittedAt?: string;
  tatStoppedAt?: string;
}

/**
 * Per-award fulfillment status for a split reverse auction (lives on VendorInvite). Mirrors the
 * request-level fulfillment statuses but is tracked per winning vendor. `awarded` = finalized,
 * contract terms pending/approved, PI not yet requested.
 */
export type AwardStatus =
  | 'awarded'
  | 'pi_requested'
  | 'pi_submitted'
  | 'accounts_processing'
  | 'payment_in_progress'
  | 'completed';
