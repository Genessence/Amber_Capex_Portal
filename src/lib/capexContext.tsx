'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import {
  AdhocBudgetRequest,
  ApprovalRemark,
  ApprovalStage,
  AuctionApprovalDocument,
  AuctionConfig,
  BudgetProposal,
  BudgetProposalItem,
  BrownFieldHeadBudget,
  CapexMasterItem,
  CapexRequest,
  CapexStatus,
  ChatMessage,
  FieldType,
  GreenFieldPlantCreation,
  GreenFieldBudgetAllocations,
  IncoTermsDoc,
  IncoTermsMessage,
  NegotiationMessage,
  DocSelection,
  PaymentMilestone,
  PlantMeta,
  ProformaInvoice,
  ProjectType,
  PurchaseOrder,
  Quote,
  QuoteLineDocument,
  RequestComment,
  RfqPriceMessage,
  RfqQuote,
  SourcingDecision,
  TrialMessage,
  TechSpecDocument,
  TrialStatus,
  TrialSubmission,
  Vendor,
  VendorInvite,
} from './types';
import {
  applyApproverEdit,
  buildGreenFieldAllocationsFromProposal,
  buildMasterItemsFromProposal,
  proposalFieldType,
} from './budgetProposalUtils';
import { ALLOWED_TRANSITIONS, PRE_PI_REQUEST_STATUSES } from './statusFlow';
import { generateApprovalToken, generatePoToken, generatePoIssueToken, generateTechSpecToken } from './tokenUtils';
import { buildDocApprovalPackage, effectiveDocApprovalStatus } from './docPackageUtils';
import { buildAwardGroups, deriveRequestStatus, isAwardBased, awardedInvites, finalPaymentBlockedByTrial } from './paymentUtils';
import { effectiveRfqStatus, resolveSupplierItemHsn, rfqTotal } from './rfqUtils';
import { toInr } from './currencyUtils';
import {
  buildBlankIncoTermsDoc,
  effectiveIncoTermsStatus,
  incoTermsNegotiationOpen,
  incoTermsRequired,
  isIncoDocComplete,
  needsIncoTermsWithQuote,
} from './incoTermsUtils';
import {
  MAX_TECH_SPEC_DOCS,
  buildBlankTechSpec,
  canDecideTechSpec,
  canSendTechSpec,
  effectiveTechSpecStatus,
  isTechSpecReadyToSend,
  techSpecBlocksAward,
} from './techSpecUtils';
import { getAllFiles, putAllFiles, type FileMap } from './fileStore';
import {
  buildSnapshots,
  mergeSnapshots,
  snapshotDateKey,
  type KpiSnapshot,
} from './kpiSnapshots';
import { effectiveHeadAllocationCr } from './adhocBudgetUtils';
import { buildApprovalRemark, appendRemark, remarkPatch } from './approvalRemarks';
import { sanitizeLineDocuments } from './quoteDocuments';
import { FLAT_MASTER_DIVISION } from './greenFieldConstants';
import {
  mockCapexMaster,
  mockInvites,
  mockRequests,
  mockVendors,
  CLEAN_SLATE_PURGE_V1,
  GREEN_FIELD_BUDGET_CLEAR_V1,
} from './mockData';
import {
  PLANTS,
  ROLE_NAMES,
  PLANT_HEAD_ACTOR,
  PLANT_ACCOUNTS_ACTOR,
  GLOBAL_ACCOUNTS_ACTOR,
} from './constants';
import { BROWNFIELD_SEED_VERSION, brownFieldSeedData } from './brownFieldSeedData';
import {
  BROWN_FIELD_NESTED_MIGRATION_V1,
  DIGITISATION_MIGRATION_V1,
  FLAT_MASTER_MIGRATION_V1,
  GREEN_FIELD_SECTION_MIGRATION_V1,
  getMasterBackfillKey,
  migrateBrownFieldToNestedDivisions,
  migrateDigitisationMasterItems,
  migrateGreenFieldToSections,
  migrateToFlatMaster,
  normalizeMasterItemDivision,
  resolveProjectType,
  withProjectType,
} from './greenFieldConstants';

const STORAGE_KEY = 'capex_data_v2';

const DEFAULT_PLANTS = PLANTS.map((p) => p.value);
const DEFAULT_CATEGORIES = ['Machinery', 'Infrastructure', 'IT', 'Tooling'];

// The status flow (which transitions are legal) lives in `./statusFlow` so UI call sites can ask
// `canTransitionStatus` BEFORE acting instead of toasting success on a transition this map refuses.

interface CapexContextValue {
  loaded: boolean;
  requests: CapexRequest[];
  vendors: Vendor[];
  invites: VendorInvite[];
  chatMessages: ChatMessage[];
  sendChatMessage: (msg: ChatMessage) => void;
  plants: string[];
  categories: string[];
  capexMaster: CapexMasterItem[];
  usedCrMap: Record<string, number>;
  getUsedCr: (plant: string) => number;
  usedAmountByMasterItemId: Record<string, number>;
  /**
   * MEASURED daily history of the stock budget metrics — see `kpiSnapshots.ts`. Read-only to
   * consumers: there is deliberately no mutation, because the only legitimate writer is the
   * automatic once-a-day capture below. A dashboard that could write here could fabricate history.
   */
  kpiSnapshots: KpiSnapshot[];
  setAuctionConfig: (requestId: string, config: AuctionConfig) => void;
  addRequest: (req: CapexRequest) => void;
  updateRequest: (id: string, updates: Partial<CapexRequest>, actor?: string) => void;
  addVendor: (vendor: Vendor) => void;
  addInvite: (invite: VendorInvite) => void;
  inviteVendors: (requestId: string, vendorIds: string[], docSelections?: Record<string, DocSelection>) => void;
  updateInvite: (id: string, updates: Partial<VendorInvite>) => void;
  submitQuote: (inviteId: string, quote: Quote) => void;
  addNegotiationMessage: (inviteId: string, msg: NegotiationMessage) => void;
  approveInvite: (inviteId: string) => void;
  addRequestComment: (requestId: string, comment: RequestComment) => void;
  addPlant: (value: string, label: string) => void;
  removePlant: (value: string) => void;
  addCategory: (name: string) => void;
  removeCategory: (name: string) => void;
  updateMasterItem: (id: string, updates: Partial<CapexMasterItem>) => void;
  addMasterItem: (item: CapexMasterItem) => void;
  cloneMasterForFY: (newFy: string) => void;
  masterHeads: string[];
  addMasterHead: (head: string) => void;
  renameMasterHead: (oldHead: string, newHead: string) => void;
  removeMasterHead: (head: string) => void;
  customPlants: PlantMeta[];
  addCustomPlant: (meta: PlantMeta) => void;
  createGreenFieldPlant: (creation: GreenFieldPlantCreation) => void;
  greenFieldBudgetAllocations: GreenFieldBudgetAllocations;
  setGreenFieldPlantBudget: (
    plant: string,
    fy: string,
    projectType: ProjectType,
    budgetCr: number,
  ) => void;
  setGreenFieldSectionBudget: (
    plant: string,
    fy: string,
    projectType: ProjectType,
    division: string,
    budgetCr: number,
  ) => void;
  setGreenFieldHeadBudget: (
    plant: string,
    fy: string,
    projectType: ProjectType,
    division: string,
    head: string,
    budgetCr: number,
  ) => void;
  resetData: () => void;
  // ── Next-FY Brown Field budget proposals ──
  budgetProposals: BudgetProposal[];
  createBudgetProposal: (proposal: BudgetProposal) => void;
  updateBudgetProposal: (id: string, updates: Partial<BudgetProposal>) => void;
  submitBudgetProposal: (id: string) => void;
  /**
   * Green Field only — publish an admin-authored budget STRAIGHT to the master, with no plant-head
   * or Global-Accounts stage. The super admin is the approving authority for Green Field, so a
   * chain that routed their own upload back to them for approval would be ceremony, not control.
   * Writes the master rows AND the plant / section / head envelopes in one pass.
   */
  /**
   * Super-admin stage: approve (→ global accounts) / reject. Passing `editedItems` with an
   * `approved` decision edits the lines and sends the proposal FORWARD carrying those edits.
   * (`needs_correction` remains for the legacy send-back path.)
   */
  decideBudgetProposal: (
    id: string,
    decision: 'approved' | 'rejected' | 'needs_correction',
    actor: string,
    note?: string,
    editedItems?: BudgetProposalItem[],
  ) => void;
  /**
   * Plant-head budget decision via the public email link: approve / reject. Passing `editedItems`
   * with an `approved` decision edits the lines and sends the proposal FORWARD to the admin.
   */
  decideBudgetPlantHead: (
    id: string,
    decision: 'approved' | 'rejected' | 'needs_correction',
    note?: string,
    editedItems?: BudgetProposalItem[],
  ) => void;
  /** Global-accounts budget decision — final gate; approve publishes to the live master. */
  decideBudgetAccounts: (id: string, decision: 'approved' | 'rejected', actor: string, note?: string) => void;
  /** Plant-head request decision via the public email link (approve → sourcing / reject). */
  decideRequestPlantHead: (requestId: string, decision: 'approved' | 'rejected', note?: string) => void;
  // ── Trials (optional QA gate before final payment) ──
  setTrialRequired: (requestId: string, required: boolean, inviteId?: string) => void;
  submitTrial: (inviteId: string, submission: TrialSubmission) => void;
  respondToTrial: (requestId: string, response: 'approved' | 'rejected', inviteId?: string, message?: string) => void;
  /** Vendor re-uploads the PI after the PO is issued. */
  resubmitProformaInvoice: (inviteId: string, pi: ProformaInvoice) => void;
  // ── Adhoc head→head budget reallocation (Brown Field, admin-approved) ──
  adhocBudgetRequests: AdhocBudgetRequest[];
  brownFieldHeadAllocations: BrownFieldHeadBudget[];
  createAdhocBudgetRequest: (req: AdhocBudgetRequest) => void;
  decideAdhocBudgetRequest: (
    id: string,
    decision: 'approved' | 'rejected',
    actor: string,
    note?: string,
  ) => void;
  saveAuctionApprovalDocument: (requestId: string, document: AuctionApprovalDocument) => void;
  sendAuctionApprovalToVendors: (requestId: string, vendorIds: string[]) => void;
  respondToAuctionApproval: (inviteId: string, response: 'approved' | 'rejected') => void;
  sendAuctionApprovalReminder: (inviteId: string) => void;
  excludeVendorFromAuction: (inviteId: string, reason: string) => void;
  // ── Brown Field RFQ flow ──
  setSourcingMode: (requestId: string, mode: 'rfq' | 'auction') => void;
  clearSourcingMode: (requestId: string) => void;
  /** Either side proposes/revises/counters the full quotation. Returns false when rejected (e.g. missing HSN). */
  proposeRfqQuote: (
    inviteId: string,
    quote: RfqQuote,
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
    itemHsn?: Record<string, string>,
    /** Foreign vendors answer the Incoterms questionnaire with their quotation — both save atomically. */
    incoDoc?: IncoTermsDoc,
  ) => boolean;
  /** Either side accepts or rejects the quotation currently on the table. */
  respondToRfqQuote: (
    inviteId: string,
    response: 'approved' | 'rejected',
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
  ) => void;
  /** Re-open an approved RFQ quotation for further negotiation (resets auto-sent documents). */
  reopenRfqQuote: (inviteId: string) => void;
  /** Record the RFQ per-line "Final Decision" winning vendor for a line item. */
  setRfqFinalVendor: (requestId: string, lineItemId: string, vendorId: string) => void;
  /** Set the HSN code on a request line item (drives item-wise GST across all vendors). */
  setLineHsn: (requestId: string, lineItemId: string, hsnCode: string) => void;
  /** Seed reverse-auction opening bids from each vendor's RFQ quotation (lowest = L1). */
  seedAuctionFromRfq: (requestId: string) => void;
  /** Invite a new/one-time vendor by name/email/phone and send the INCO Terms (gates quoting). */
  inviteNewVendor: (requestId: string, info: { name: string; email: string; phone: string; foreign?: boolean }, senderName: string, selection?: DocSelection) => void;
  /** INCO Terms negotiation: vendor fills/counters or sourcing edits & resends. */
  proposeIncoTerms: (inviteId: string, doc: IncoTermsDoc, by: 'sourcing' | 'vendor', senderName: string, message?: string) => void;
  respondToIncoTerms: (inviteId: string, response: 'approved' | 'rejected', by: 'sourcing' | 'vendor', senderName: string, message?: string) => void;
  requestProformaInvoice: (requestId: string, vendorId: string, actor: string) => void;
  // ── Technical specification approval (pre-award gate, per vendor) ──
  /** Attach/remove spec documents or edit the notes on a vendor's spec package. */
  saveTechSpecDraft: (
    inviteId: string,
    patch: { notes?: string; addDocuments?: TechSpecDocument[]; removeDocumentId?: string },
  ) => boolean;
  /** Send (or re-send) a vendor's machine spec to the Technical team; mints/rotates the public link. */
  sendTechSpecForApproval: (inviteId: string, senderName: string, notes?: string) => boolean;
  /** Technical team's verdict from the public /tech-spec/[token] page. */
  decideTechSpec: (
    inviteId: string,
    decision: 'approved' | 'rejected' | 'needs_revision',
    deciderName: string,
    note?: string,
  ) => boolean;
  submitProformaInvoice: (inviteId: string, pi: ProformaInvoice) => void;
  // ── Split award (reverse auction): finalize per-line vendor selections into per-vendor awards ──
  finalizeSplitAward: (requestId: string, decision?: SourcingDecision, onlyVendorId?: string) => void;
  awardAndRequestPi: (requestId: string, decision: SourcingDecision | undefined, actor: string, onlyVendorId?: string) => void;
  // ── Document-approval package (PBG + DLC + one-time payment terms) ──
  sendDocApprovalPackage: (requestId: string, vendorIds: string[]) => void;
  resendDocApprovalPackage: (inviteId: string, note?: string) => void;
  respondToDocApproval: (inviteId: string, response: 'approved' | 'rejected') => void;
  // ── Accounts: FA codes (plant), PO + upload + issue (global), payment milestones ──
  // The optional inviteId targets a single AWARD (split-auction); omit for single-vendor requests.
  assignFaCode: (requestId: string, lineItemId: string, code: string, inviteId?: string) => void;
  submitFaCodes: (requestId: string, actor: string, inviteId?: string, note?: string) => void;
  createPurchaseOrder: (requestId: string, po: PurchaseOrder, milestones: PaymentMilestone[]) => void;
  submitPurchaseOrder: (requestId: string, actor: string) => void;
  issuePurchaseOrder: (requestId: string, po: PurchaseOrder, milestones: PaymentMilestone[], actor: string, inviteId?: string, note?: string) => void;
  markPaymentMade: (requestId: string, milestoneId: string, actor: string, inviteId?: string, note?: string) => void;
}

const CapexContext = createContext<CapexContextValue | null>(null);

function normalizeRequest(req: CapexRequest): CapexRequest {
  const fieldType = req.fieldType ?? 'brown_field';
  const projectType = resolveProjectType(req);
  // Backfill the plant-head approval token for existing/in-flight requests awaiting head approval.
  const approvalToken =
    req.status === 'pending_head_approval'
      ? req.approvalToken ?? generateApprovalToken('request', req.id)
      : req.approvalToken;
  // Backfill the public Plant-Accounts token once the request reaches the fulfillment stages.
  const needsPoToken =
    req.status === 'pi_submitted' || req.status === 'accounts_processing';
  const poToken = needsPoToken ? req.poToken ?? generatePoToken('request', req.id) : req.poToken;
  // Backfill Satish's PO-issue token once the FA codes are in (accounts_processing).
  const poIssueToken =
    req.status === 'accounts_processing'
      ? req.poIssueToken ?? generatePoIssueToken('request', req.id)
      : req.poIssueToken;
  return {
    ...req,
    fieldType,
    projectType,
    greenFieldProjectType: projectType,
    approvalToken,
    poToken,
    poIssueToken,
  };
}

function normalizeMasterItem(item: CapexMasterItem): CapexMasterItem {
  const base = withProjectType({ ...item, fieldType: item.fieldType ?? 'brown_field' });
  return normalizeMasterItemDivision(base);
}

function applyMasterMigrations(
  items: CapexMasterItem[],
  digitisationMigrationVersion: string | undefined,
  flatMasterMigrationVersion: string | undefined,
  greenFieldSectionMigrationVersion: string | undefined,
  brownFieldNestedMigrationVersion: string | undefined,
): CapexMasterItem[] {
  let migrated = items.map(normalizeMasterItem);
  if (digitisationMigrationVersion !== DIGITISATION_MIGRATION_V1) {
    migrated = migrateDigitisationMasterItems(migrated).map(normalizeMasterItem);
  }
  if (flatMasterMigrationVersion !== FLAT_MASTER_MIGRATION_V1) {
    migrated = migrateToFlatMaster(migrated);
  }
  if (greenFieldSectionMigrationVersion !== GREEN_FIELD_SECTION_MIGRATION_V1) {
    migrated = migrateGreenFieldToSections(migrated);
  }
  if (brownFieldNestedMigrationVersion !== BROWN_FIELD_NESTED_MIGRATION_V1) {
    migrated = migrateBrownFieldToNestedDivisions(migrated);
  }
  return migrated;
}

/**
 * Backfill the public Global-Accounts sign-off token for proposals already sitting at the
 * accounts stage (data written before Global Accounts moved off a portal role).
 */
function normalizeBudgetProposal(p: BudgetProposal): BudgetProposal {
  if (p.status !== 'pending_accounts') return p;
  return { ...p, accountsToken: p.accountsToken ?? generateApprovalToken('budget_accounts', p.id) };
}

function normalizeInvite(inv: VendorInvite): VendorInvite {
  const needsPoToken =
    inv.awarded && (inv.awardStatus === 'pi_submitted' || inv.awardStatus === 'accounts_processing');
  const poToken = needsPoToken ? inv.poToken ?? generatePoToken('award', inv.id) : inv.poToken;
  const poIssueToken =
    inv.awarded && inv.awardStatus === 'accounts_processing'
      ? inv.poIssueToken ?? generatePoIssueToken('award', inv.id)
      : inv.poIssueToken;
  return {
    ...inv,
    auctionApprovalStatus: inv.auctionApprovalStatus ?? 'not_sent',
    poToken,
    poIssueToken,
  };
}

/**
 * One-time wipe of workflow + Brown Field planning data from a browser that already holds it.
 * Drops every request, invite, chat thread, adhoc budget request, budget proposal, Brown Field
 * head allocation override and measured KPI snapshot, and empties the IndexedDB blob store. Green
 * Field master / envelopes, vendors, plants and custom heads survive; Brown Field live FY rows are
 * replaced by the (currently empty) seed when `BROWNFIELD_SEED_VERSION` changes. Idempotent via
 * `CLEAN_SLATE_PURGE_V1`.
 *
 * ── Why `kpiSnapshots` IS purged, even though it is a measurement and not workflow data ──
 *
 * Every figure in a snapshot is DERIVED from exactly the records this purge deletes: `committedInr`
 * / `awardedInr` / `paidInr` come from requests + invites, and `allocatedInr` / `breachedHeads` /
 * `overExposureCr` from Brown Field master rows that `BROWNFIELD_SEED_VERSION` clears in the same
 * load pass. Keeping the history would leave a measured series whose earlier points describe a world
 * that no longer exists, and the chart would draw a cliff from (say) ₹4 Cr committed straight to
 * zero — a cliff caused by deleting the evidence, not by anything that happened to the business.
 * That is precisely the confident-but-wrong figure `kpiSnapshots.ts` exists to refuse. Purging
 * instead lets `measuredFrom` restart honestly at the purge date.
 */
function applyCleanSlatePurge(): {
  requests: CapexRequest[];
  invites: VendorInvite[];
  chatMessages: ChatMessage[];
  adhocBudgetRequests: AdhocBudgetRequest[];
  budgetProposals: BudgetProposal[];
  brownFieldHeadAllocations: BrownFieldHeadBudget[];
  kpiSnapshots: KpiSnapshot[];
} {
  // Blobs are keyed off requests/invites, so with those gone the whole map is orphaned.
  void putAllFiles({});
  return {
    requests: [],
    invites: [],
    chatMessages: [],
    adhocBudgetRequests: [],
    budgetProposals: [],
    brownFieldHeadAllocations: [],
    kpiSnapshots: [],
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Sanitize an RFQ quotation at the (untrusted) supplier/sourcing boundary. Returns null if the
 * price is missing/≤0/non-finite; coerces footer charges to non-negative finite numbers (else
 * dropped); keeps a string currency only.
 */
function sanitizeRfqQuote(quote: RfqQuote, allowedItemIds?: string[]): RfqQuote | null {
  const price = Number(quote?.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const nonNeg = (v: unknown): number | undefined => {
    if (v === undefined || v === null || v === ('' as unknown)) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  // Per-line unit prices: keep only finite, non-negative entries.
  let linePrices: Record<string, number> | undefined;
  if (quote.linePrices && typeof quote.linePrices === 'object') {
    const clean: Record<string, number> = {};
    for (const [id, v] of Object.entries(quote.linePrices)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[id] = n;
    }
    if (Object.keys(clean).length) linePrices = clean;
  }
  return {
    price,
    linePrices,
    freight: nonNeg(quote.freight),
    packing: nonNeg(quote.packing),
    service: nonNeg(quote.service),
    // `deliveryDays` was previously dropped here while the form collects it as a REQUIRED field and
    // `deliveryLeadDays` (paymentUtils) reads it to date the final payment — so every RFQ quote lost
    // its lead time on the way in and the expected-payment date silently fell back to the legacy
    // weeks field (usually absent → 0). Both are carried now; `deliveryWeeks` stays for legacy reads.
    deliveryDays: nonNeg(quote.deliveryDays),
    deliveryWeeks: nonNeg(quote.deliveryWeeks),
    warranty: nonNeg(quote.warranty),
    currency: typeof quote.currency === 'string' ? quote.currency : undefined,
    // Per-line supporting documents arrive from the public supplier page — shape-checked, keyed only
    // to line items this request actually has (the caller passes the allow-list).
    lineDocuments: sanitizeLineDocuments(quote.lineDocuments, allowedItemIds),
  };
}

// ── File-blob separation: keep base64 OUT of the localStorage payload (→ IndexedDB) ──
// Strip base64 from requests/invites into a {key → base64} map for IndexedDB; the returned
// lean arrays carry only metadata so the localStorage blob stays well under quota.
function stripRequestFiles(requests: CapexRequest[], files: FileMap): CapexRequest[] {
  return requests.map((req) => {
    let r = req;
    if (req.attachmentBase64) {
      files[`req-att:${req.id}`] = req.attachmentBase64;
      r = { ...r, attachmentBase64: undefined };
    }
    if (req.lineItems?.some((li) => li.attachmentBase64)) {
      r = {
        ...r,
        lineItems: req.lineItems!.map((li) => {
          if (li.attachmentBase64) {
            files[`li-att:${li.id}`] = li.attachmentBase64;
            return { ...li, attachmentBase64: undefined };
          }
          return li;
        }),
      };
    }
    if (req.landDocuments?.some((d) => d.base64)) {
      r = {
        ...r,
        landDocuments: req.landDocuments!.map((d) => {
          if (d.base64) {
            files[`ld:${d.id}`] = d.base64;
            return { ...d, base64: '' };
          }
          return d;
        }),
      };
    }
    if (req.purchaseOrder) {
      const po = req.purchaseOrder;
      let nextPo = po;
      if (po.poDocumentBase64) {
        files[`po:${req.id}`] = po.poDocumentBase64;
        nextPo = { ...nextPo, poDocumentBase64: undefined };
      }
      if (po.poDocuments?.some((d) => d.base64)) {
        nextPo = {
          ...nextPo,
          poDocuments: po.poDocuments.map((d) => {
            if (d.base64) { files[`podoc:${d.id}`] = d.base64; return { ...d, base64: '' }; }
            return d;
          }),
        };
      }
      if (nextPo !== po) r = { ...r, purchaseOrder: nextPo };
    }
    if (req.trialSubmission?.base64) {
      files[`trial-req:${req.id}`] = req.trialSubmission.base64;
      r = { ...r, trialSubmission: { ...req.trialSubmission, base64: '' } };
    }
    return r;
  });
}
/**
 * Per-line quotation documents follow the same rule as every other blob in this app: the base64
 * lives in IndexedDB (`qdoc:<id>`), the metadata stays in the localStorage payload. One document map
 * can be referenced from three places on an invite (the live `rfqQuote`, an auction `Quote`, and the
 * frozen copies inside `rfqThread`), so both directions are factored out here rather than inlined
 * three times — a fix applied to two of three copies is exactly how a blob goes missing.
 */
function stripLineDocuments(
  docs: Record<string, QuoteLineDocument>,
  files: FileMap,
): Record<string, QuoteLineDocument> {
  const out: Record<string, QuoteLineDocument> = {};
  for (const [itemId, d] of Object.entries(docs)) {
    if (d?.base64) {
      files[`qdoc:${d.id}`] = d.base64;
      out[itemId] = { ...d, base64: '' };
    } else {
      out[itemId] = d;
    }
  }
  return out;
}
function hydrateLineDocuments(
  docs: Record<string, QuoteLineDocument>,
  files: FileMap,
): Record<string, QuoteLineDocument> {
  const out: Record<string, QuoteLineDocument> = {};
  for (const [itemId, d] of Object.entries(docs)) {
    const f = d ? files[`qdoc:${d.id}`] : undefined;
    out[itemId] = f ? { ...d, base64: f } : d;
  }
  return out;
}
function stripInviteFiles(invites: VendorInvite[], files: FileMap): VendorInvite[] {
  return invites.map((inv) => {
    let v = inv;
    if (inv.proformaInvoice?.base64) {
      files[`pi:${inv.id}`] = inv.proformaInvoice.base64;
      v = { ...v, proformaInvoice: { ...inv.proformaInvoice, base64: '' } };
    }
    if (inv.quotes?.some((q) => q.attachmentBase64 || q.lineDocuments)) {
      v = {
        ...v,
        quotes: inv.quotes.map((q) => {
          let next = q;
          if (q.attachmentBase64) {
            files[`q-att:${q.id}`] = q.attachmentBase64;
            next = { ...next, attachmentBase64: undefined };
          }
          if (q.lineDocuments) next = { ...next, lineDocuments: stripLineDocuments(q.lineDocuments, files) };
          return next;
        }),
      };
    }
    // Per-line quotation documents on the live RFQ quote (the vendor's datasheet per line item).
    if (inv.rfqQuote?.lineDocuments) {
      v = { ...v, rfqQuote: { ...inv.rfqQuote, lineDocuments: stripLineDocuments(inv.rfqQuote.lineDocuments, files) } };
    }
    // …and on every quotation carried in the RFQ negotiation thread, so re-reading an older offer
    // still resolves its attachments instead of silently losing them at the first persist.
    if (inv.rfqThread?.some((m) => m.quote?.lineDocuments)) {
      v = {
        ...v,
        rfqThread: inv.rfqThread.map((m) =>
          m.quote?.lineDocuments
            ? { ...m, quote: { ...m.quote, lineDocuments: stripLineDocuments(m.quote.lineDocuments, files) } }
            : m,
        ),
      };
    }
    if (inv.purchaseOrder) {
      const po = inv.purchaseOrder;
      let nextPo = po;
      if (po.poDocumentBase64) {
        files[`po-inv:${inv.id}`] = po.poDocumentBase64;
        nextPo = { ...nextPo, poDocumentBase64: undefined };
      }
      if (po.poDocuments?.some((d) => d.base64)) {
        nextPo = {
          ...nextPo,
          poDocuments: po.poDocuments.map((d) => {
            if (d.base64) { files[`podoc:${d.id}`] = d.base64; return { ...d, base64: '' }; }
            return d;
          }),
        };
      }
      if (nextPo !== po) v = { ...v, purchaseOrder: nextPo };
    }
    if (inv.trialSubmission?.base64) {
      files[`trial:${inv.id}`] = inv.trialSubmission.base64;
      v = { ...v, trialSubmission: { ...inv.trialSubmission, base64: '' } };
    }
    if (inv.techSpec?.documents?.some((d) => d.base64)) {
      v = {
        ...v,
        techSpec: {
          ...inv.techSpec,
          documents: inv.techSpec.documents.map((d) => {
            if (d.base64) { files[`techspec:${d.id}`] = d.base64; return { ...d, base64: '' }; }
            return d;
          }),
        },
      };
    }
    return v;
  });
}
// Re-attach base64 from the IndexedDB file map onto loaded (lean) state.
function hydrateRequestFiles(requests: CapexRequest[], files: FileMap): CapexRequest[] {
  return requests.map((req) => {
    let r = req;
    const ra = files[`req-att:${req.id}`];
    if (ra) r = { ...r, attachmentBase64: ra };
    if (req.lineItems?.length) {
      r = {
        ...r,
        lineItems: req.lineItems.map((li) => {
          const f = files[`li-att:${li.id}`];
          return f ? { ...li, attachmentBase64: f } : li;
        }),
      };
    }
    if (req.landDocuments?.length) {
      r = {
        ...r,
        landDocuments: req.landDocuments.map((d) => {
          const f = files[`ld:${d.id}`];
          return f ? { ...d, base64: f } : d;
        }),
      };
    }
    if (req.purchaseOrder) {
      const po = req.purchaseOrder;
      let nextPo = po;
      const single = files[`po:${req.id}`];
      if (single) nextPo = { ...nextPo, poDocumentBase64: single };
      if (po.poDocuments?.length) {
        nextPo = {
          ...nextPo,
          poDocuments: po.poDocuments.map((d) => {
            const f = files[`podoc:${d.id}`];
            return f ? { ...d, base64: f } : d;
          }),
        };
      }
      if (nextPo !== po) r = { ...r, purchaseOrder: nextPo };
    }
    if (req.trialSubmission) {
      const f = files[`trial-req:${req.id}`];
      if (f) r = { ...r, trialSubmission: { ...req.trialSubmission, base64: f } };
    }
    return r;
  });
}
function hydrateInviteFiles(invites: VendorInvite[], files: FileMap): VendorInvite[] {
  return invites.map((inv) => {
    let v = inv;
    const pi = files[`pi:${inv.id}`];
    if (pi && inv.proformaInvoice) v = { ...v, proformaInvoice: { ...inv.proformaInvoice, base64: pi } };
    if (inv.quotes?.length) {
      v = {
        ...v,
        quotes: inv.quotes.map((q) => {
          const f = files[`q-att:${q.id}`];
          const next = f ? { ...q, attachmentBase64: f } : q;
          return q.lineDocuments ? { ...next, lineDocuments: hydrateLineDocuments(q.lineDocuments, files) } : next;
        }),
      };
    }
    if (inv.rfqQuote?.lineDocuments) {
      v = { ...v, rfqQuote: { ...inv.rfqQuote, lineDocuments: hydrateLineDocuments(inv.rfqQuote.lineDocuments, files) } };
    }
    if (inv.rfqThread?.some((m) => m.quote?.lineDocuments)) {
      v = {
        ...v,
        rfqThread: inv.rfqThread.map((m) =>
          m.quote?.lineDocuments
            ? { ...m, quote: { ...m.quote, lineDocuments: hydrateLineDocuments(m.quote.lineDocuments, files) } }
            : m,
        ),
      };
    }
    if (inv.purchaseOrder) {
      const po = inv.purchaseOrder;
      let nextPo = po;
      const single = files[`po-inv:${inv.id}`];
      if (single) nextPo = { ...nextPo, poDocumentBase64: single };
      if (po.poDocuments?.length) {
        nextPo = {
          ...nextPo,
          poDocuments: po.poDocuments.map((d) => {
            const f = files[`podoc:${d.id}`];
            return f ? { ...d, base64: f } : d;
          }),
        };
      }
      if (nextPo !== po) v = { ...v, purchaseOrder: nextPo };
    }
    if (inv.trialSubmission) {
      const f = files[`trial:${inv.id}`];
      if (f) v = { ...v, trialSubmission: { ...inv.trialSubmission, base64: f } };
    }
    if (inv.techSpec?.documents?.length) {
      v = {
        ...v,
        techSpec: {
          ...inv.techSpec,
          documents: inv.techSpec.documents.map((d) => {
            const f = files[`techspec:${d.id}`];
            return f ? { ...d, base64: f } : d;
          }),
        },
      };
    }
    return v;
  });
}

const isGreenFieldRow = (item: CapexMasterItem) =>
  (item.fieldType ?? 'brown_field') === 'green_field';

/**
 * The Green Field seed is **RETIRED** (see GREEN_FIELD_BUDGET_CLEAR_V1). Green Field budgets are
 * authored by the super admin in Budget Planning and published from there, so nothing is seeded and
 * nothing is backfilled — an empty Green Field master is the correct starting state, exactly as the
 * cleared Brown Field FY already is.
 */
const greenFieldSeedMaster: CapexMasterItem[] = [];

/** Merge stored master with seeds; replaces Brown Field once per seed version. */
function mergeCapexMasterOnLoad(
  storedMaster: CapexMasterItem[],
  brownfieldSeedVersion: string | undefined,
  greenFieldClearVersion: string | undefined,
): CapexMasterItem[] {
  const brownFieldSeeds = brownFieldSeedData.map(normalizeMasterItem);
  const greenFieldSeeds = greenFieldSeedMaster.map(normalizeMasterItem);
  // One-time wipe of the seeded Green Field budget. Runs on the STORED rows before anything else,
  // so a browser that already holds the demo budget ends up in the same clean state as a fresh one.
  const clearGreen = greenFieldClearVersion !== GREEN_FIELD_BUDGET_CLEAR_V1;

  if (!storedMaster.length) {
    const seeds = mockCapexMaster.filter((item) => !isGreenFieldRow(item)).map(normalizeMasterItem);
    return applyMasterMigrations(seeds, undefined, undefined, undefined, undefined);
  }

  const kept = clearGreen ? storedMaster.filter((item) => !isGreenFieldRow(item)) : storedMaster;

  if (brownfieldSeedVersion !== BROWNFIELD_SEED_VERSION) {
    const storedGreen = kept.filter(isGreenFieldRow);
    const existingGreenKeys = new Set(storedGreen.map(getMasterBackfillKey));
    const missingGreenSeeds = greenFieldSeeds.filter(
      (seed) => !existingGreenKeys.has(getMasterBackfillKey(seed)),
    );
    return [...storedGreen, ...missingGreenSeeds, ...brownFieldSeeds];
  }

  const existingKeys = new Set(kept.map(getMasterBackfillKey));
  const missingGreenSeeds = greenFieldSeeds.filter(
    (seed) => !existingKeys.has(getMasterBackfillKey(seed)),
  );
  return [...kept, ...missingGreenSeeds];
}


export function initialStatusForRequest(_budget?: number, fieldType: FieldType = 'brown_field'): CapexStatus {
  // Only Green Field skips plant-head approval; Brown Field, Digitisation and IT all route to the
  // plant head (who approves via the emailed public link).
  if (fieldType === 'green_field') return 'sourcing';
  return 'pending_head_approval';
}

function getCurrentFyCode(): string {
  const now = new Date();
  const year = now.getFullYear();
  const fyStart = now.getMonth() >= 3 ? year : year - 1; // April = month 3
  return `${fyStart % 100}${(fyStart + 1) % 100}`;
}

export function CapexProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [requests, setRequests] = useState<CapexRequest[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invites, setInvites] = useState<VendorInvite[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [plants, setPlants] = useState<string[]>(DEFAULT_PLANTS);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [capexMaster, setCapexMaster] = useState<CapexMasterItem[]>([]);
  const [masterHeads, setMasterHeads] = useState<string[]>([]);
  const [customPlants, setCustomPlants] = useState<PlantMeta[]>([]);
  const [brownfieldSeedVersion, setBrownfieldSeedVersion] = useState(BROWNFIELD_SEED_VERSION);
  const [cleanSlatePurgeVersion, setCleanSlatePurgeVersion] = useState(CLEAN_SLATE_PURGE_V1);
  const [digitisationMigrationVersion, setDigitisationMigrationVersion] =
    useState(DIGITISATION_MIGRATION_V1);
  const [flatMasterMigrationVersion, setFlatMasterMigrationVersion] =
    useState(FLAT_MASTER_MIGRATION_V1);
  const [greenFieldSectionMigrationVersion, setGreenFieldSectionMigrationVersion] =
    useState(GREEN_FIELD_SECTION_MIGRATION_V1);
  const [brownFieldNestedMigrationVersion, setBrownFieldNestedMigrationVersion] =
    useState(BROWN_FIELD_NESTED_MIGRATION_V1);
  const [greenFieldBudgetClearVersion, setGreenFieldBudgetClearVersion] =
    useState(GREEN_FIELD_BUDGET_CLEAR_V1);
  const [greenFieldBudgetAllocations, setGreenFieldBudgetAllocations] =
    useState<GreenFieldBudgetAllocations>({ plantBudgets: [], sectionBudgets: [], headBudgets: [] });
  const [budgetProposals, setBudgetProposals] = useState<BudgetProposal[]>([]);
  const [adhocBudgetRequests, setAdhocBudgetRequests] = useState<AdhocBudgetRequest[]>([]);
  const [brownFieldHeadAllocations, setBrownFieldHeadAllocations] = useState<BrownFieldHeadBudget[]>([]);
  /** Measured daily stock-metric history — the only NEW persisted state in the dashboards work. */
  const [kpiSnapshots, setKpiSnapshots] = useState<KpiSnapshot[]>([]);
  // Prevents the persist effect from writing back to localStorage when invites
  // were just read FROM localStorage (storage event path). Writing back would
  // trigger the other tab's storage listener, creating an infinite ping-pong.
  const skipNextPersist = useRef(false);
  /**
   * True once the IndexedDB file map has been read back into state. Until then the in-memory
   * state is LEAN (base64 stripped by the previous session's write), so persisting the file map
   * would overwrite IndexedDB with an empty object and destroy every stored blob — PIs, PO
   * documents, trial uploads, spec sheets, attachments. localStorage still persists normally;
   * only the blob write waits for hydration.
   */
  const filesHydrated = useRef(false);
  /**
   * True when the initial restore threw part-way through. The restore assigns state array by array,
   * and `setLoaded(true)` runs OUTSIDE the try/catch, so a throw mid-restore (say
   * `normalizeBudgetProposal` on one malformed record) leaves the app loaded with the EARLIER arrays
   * correctly restored and the later ones — `kpiSnapshots` and `brownFieldHeadAllocations` among
   * them — still empty.
   *
   * For every other array that is a recoverable annoyance: the localStorage payload is untouched
   * until something re-persists, and the data can be re-derived or re-entered. For `kpiSnapshots` it
   * is PERMANENT loss, because a measured day cannot be recomputed after the fact — that is the
   * whole premise of this file. It would also stamp `breachedHeads`/`overExposureCr` computed with
   * NO adhoc head overrides as measured fact. So the daily capture refuses to run at all in this
   * state: skipping a day leaves an honest gap, which is strictly better than writing a wrong point
   * or truncating the history to it.
   *
   * The underlying fragility pre-dates this feature; this guard deliberately contains it rather than
   * restructuring the load effect.
   */
  const restoreFailed = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Wipe workflow + Brown Field planning data once (see applyCleanSlatePurge). Brown Field
        // live FY rows are replaced by the empty seed when BROWNFIELD_SEED_VERSION changes.
        const purged =
          parsed.cleanSlatePurgeVersion === CLEAN_SLATE_PURGE_V1 ? null : applyCleanSlatePurge();
        const storedRequests = purged?.requests ?? dedupeById<CapexRequest>(parsed.requests ?? []);
        const storedInvites = purged?.invites ?? dedupeById<VendorInvite>(parsed.invites ?? []);
        const storedVendors = dedupeById<Vendor>(parsed.vendors ?? []);
        // The seed is a clean slate now — mockRequests/mockInvites are empty, so an empty stored
        // list simply stays empty rather than re-seeding demo data.
        setRequests(storedRequests.map(normalizeRequest));
        setVendors(storedVendors.length ? storedVendors : mockVendors);
        setInvites(storedInvites.map(normalizeInvite));
        setCleanSlatePurgeVersion(CLEAN_SLATE_PURGE_V1);
        if (!purged && parsed.chatMessages?.length) setChatMessages(parsed.chatMessages);
        if (parsed.plants?.length) setPlants(parsed.plants);
        if (parsed.categories?.length) setCategories(parsed.categories);
        // Backfill Green Field seed rows; replace Brown Field when seed version changes
        const storedMaster: CapexMasterItem[] = parsed.capexMaster?.length
          ? applyMasterMigrations(
              parsed.capexMaster,
              parsed.digitisationMigrationVersion,
              parsed.flatMasterMigrationVersion,
              parsed.greenFieldSectionMigrationVersion,
              parsed.brownFieldNestedMigrationVersion,
            )
          : [];
        setCapexMaster(
          applyMasterMigrations(
            mergeCapexMasterOnLoad(
              storedMaster,
              parsed.brownfieldSeedVersion,
              parsed.greenFieldBudgetClearVersion,
            ),
            DIGITISATION_MIGRATION_V1,
            FLAT_MASTER_MIGRATION_V1,
            GREEN_FIELD_SECTION_MIGRATION_V1,
            BROWN_FIELD_NESTED_MIGRATION_V1,
          ),
        );
        setBrownfieldSeedVersion(BROWNFIELD_SEED_VERSION);
        setDigitisationMigrationVersion(DIGITISATION_MIGRATION_V1);
        setFlatMasterMigrationVersion(FLAT_MASTER_MIGRATION_V1);
        setGreenFieldSectionMigrationVersion(GREEN_FIELD_SECTION_MIGRATION_V1);
        setBrownFieldNestedMigrationVersion(BROWN_FIELD_NESTED_MIGRATION_V1);
        if (Array.isArray(parsed.masterHeads)) setMasterHeads(parsed.masterHeads);
        if (Array.isArray(parsed.customPlants)) setCustomPlants(parsed.customPlants);
        // The Green Field envelopes are wiped in the SAME pass as the Green Field master rows —
        // keeping them would leave a plant/section/head budget describing line items that no longer
        // exist, which every Green Field screen would render as a fully-unspent allocation.
        if (parsed.greenFieldBudgetClearVersion !== GREEN_FIELD_BUDGET_CLEAR_V1) {
          setGreenFieldBudgetAllocations({ plantBudgets: [], sectionBudgets: [], headBudgets: [] });
        } else if (parsed.greenFieldBudgetAllocations) {
          setGreenFieldBudgetAllocations({
            plantBudgets: parsed.greenFieldBudgetAllocations.plantBudgets ?? [],
            sectionBudgets: parsed.greenFieldBudgetAllocations.sectionBudgets ?? [],
            headBudgets: parsed.greenFieldBudgetAllocations.headBudgets ?? [],
          });
        }
        setGreenFieldBudgetClearVersion(GREEN_FIELD_BUDGET_CLEAR_V1);
        if (purged) setBudgetProposals(purged.budgetProposals);
        else if (Array.isArray(parsed.budgetProposals))
          setBudgetProposals(parsed.budgetProposals.map(normalizeBudgetProposal));
        if (!purged && Array.isArray(parsed.adhocBudgetRequests)) setAdhocBudgetRequests(parsed.adhocBudgetRequests);
        if (purged) setBrownFieldHeadAllocations(purged.brownFieldHeadAllocations);
        else if (Array.isArray(parsed.brownFieldHeadAllocations)) setBrownFieldHeadAllocations(parsed.brownFieldHeadAllocations);
        // Measured snapshot history. Restored HERE, in the same pass that flips `loaded` — the daily
        // capture effect gates on `loaded` precisely so it can never merge today's point into an
        // empty store and wipe real history. Purged when the clean slate runs (see the reasoning on
        // `applyCleanSlatePurge`).
        if (purged) setKpiSnapshots(purged.kpiSnapshots);
        else if (Array.isArray(parsed.kpiSnapshots)) setKpiSnapshots(parsed.kpiSnapshots as KpiSnapshot[]);
      } else {
        setRequests(mockRequests.map(normalizeRequest));
        setVendors(mockVendors);
        setInvites(mockInvites);
        setCapexMaster(applyMasterMigrations(mockCapexMaster.map(normalizeMasterItem), undefined, undefined, undefined, undefined));
      }
    } catch {
      // A partial restore may already have applied some arrays and left others empty — suppress the
      // daily KPI snapshot capture, which would otherwise stamp that half-restored state as a
      // permanent, unrecomputable measurement. See `restoreFailed`.
      restoreFailed.current = true;
      // Suppressing the capture is NECESSARY BUT NOT SUFFICIENT, verified live: if the throw landed
      // before `kpiSnapshots` was restored, the array is still empty, and the persist effect (which
      // runs regardless, because `vendors` falls back to a non-empty mock list) writes that empty
      // array straight over the stored history. Every other array here is recoverable — the measured
      // history is not. So salvage it on its own, in its own try/catch, so one malformed record
      // elsewhere in the payload cannot cost the measurements. Combined with the suppressed capture
      // the outcome is: history intact, no new point, an honest gap for the day.
      //
      // The salvage MUST be purge-aware. `purged` is decided early in the try, but `kpiSnapshots` is
      // not zeroed until near the end of it; a throw in that window (e.g. `dedupeById(parsed.vendors)`
      // on a truthy non-array, or `applyMasterMigrations` on a malformed master row) lands here with
      // the PRE-purge payload still in localStorage. Restoring its snapshots would resurrect the
      // measured history the purge had just decided to delete — and permanently, because
      // `cleanSlatePurgeVersion` state initialises to `CLEAN_SLATE_PURGE_V1` and the persist stamps
      // the purge as done, so it never retries. The end state would be a measured series describing
      // the world the purge deleted, sitting on wiped requests/invites/Brown Field master: exactly
      // the fake cliff `applyCleanSlatePurge`'s rationale above says must be refused. So salvage only
      // a payload the purge has already been applied to.
      try {
        const salvaged = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        if (
          Array.isArray(salvaged.kpiSnapshots)
          && salvaged.cleanSlatePurgeVersion === CLEAN_SLATE_PURGE_V1
        ) {
          setKpiSnapshots(salvaged.kpiSnapshots as KpiSnapshot[]);
        }
      } catch { /* nothing recoverable — the payload itself is unparseable */ }
      setRequests(mockRequests.map(normalizeRequest));
      setVendors(mockVendors);
      setInvites(mockInvites);
      setCapexMaster(applyMasterMigrations(mockCapexMaster.map(normalizeMasterItem), undefined, undefined, undefined, undefined));
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return; // invites just came FROM localStorage — no need to write back
    }
    if (!requests.length && !vendors.length && !invites.length && !chatMessages.length) return;
    // Separate large base64 file blobs out of the localStorage payload (→ IndexedDB) so the
    // workflow state always fits the quota and persists reliably.
    const files: FileMap = {};
    const leanRequests = stripRequestFiles(requests, files);
    const leanInvites = stripInviteFiles(invites, files);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          requests: leanRequests,
          vendors,
          invites: leanInvites,
          chatMessages,
          plants,
          categories,
          capexMaster,
          masterHeads,
          customPlants,
          greenFieldBudgetAllocations,
          greenFieldBudgetClearVersion,
          budgetProposals,
          adhocBudgetRequests,
          brownFieldHeadAllocations,
          kpiSnapshots,
          brownfieldSeedVersion,
          cleanSlatePurgeVersion,
          digitisationMigrationVersion,
          flatMasterMigrationVersion,
          greenFieldSectionMigrationVersion,
          brownFieldNestedMigrationVersion,
        })
      );
    } catch (e) {
      console.error('[CapexContext] Failed to persist to localStorage', e);
    }
    // File blobs go to IndexedDB (much larger quota); fire-and-forget. Skipped until hydration
    // has merged the stored blobs back into state — writing the lean map first would wipe them.
    if (filesHydrated.current) void putAllFiles(files);
  }, [requests, vendors, invites, chatMessages, plants, categories, capexMaster, masterHeads, customPlants, greenFieldBudgetAllocations, greenFieldBudgetClearVersion, budgetProposals, adhocBudgetRequests, brownFieldHeadAllocations, kpiSnapshots, brownfieldSeedVersion, cleanSlatePurgeVersion, digitisationMigrationVersion, flatMasterMigrationVersion, greenFieldSectionMigrationVersion, brownFieldNestedMigrationVersion]);

  // Hydrate file blobs from IndexedDB after the initial (lean) load — metadata renders
  // immediately; download links light up once base64 is merged back in.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    getAllFiles().then((files) => {
      if (cancelled) return;
      // Blob writes are unblocked either way — an empty map is a legitimate "nothing stored yet".
      filesHydrated.current = true;
      if (!files || !Object.keys(files).length) return;
      skipNextPersist.current = true;
      setRequests((prev) => hydrateRequestFiles(prev, files));
      setInvites((prev) => hydrateInviteFiles(prev, files));
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // Re-sync requests + invites when the supplier portal tab submits a quote in another window.
  // Request-level fields (e.g. line-item HSN) must sync too — invites alone are not enough for GST.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        const freshInvites = dedupeById<VendorInvite>(parsed.invites ?? []).map(normalizeInvite);
        const freshRequests = dedupeById<CapexRequest>(parsed.requests ?? []).map(normalizeRequest);
        // Budget proposals must sync too so a plant-head budget approval done in the public tab
        // reflects internally (and vice-versa).
        const freshBudgetProposals: BudgetProposal[] | null = Array.isArray(parsed.budgetProposals)
          ? (parsed.budgetProposals as BudgetProposal[]).map(normalizeBudgetProposal)
          : null;
        // The Global-Accounts budget sign-off happens on a PUBLIC tab and publishes new master rows,
        // so capexMaster must cross-sync too or the internal tab shows a stale FY until reload.
        const freshMaster: CapexMasterItem[] | null = Array.isArray(parsed.capexMaster)
          ? (parsed.capexMaster as CapexMasterItem[]).map(normalizeMasterItem)
          : null;
        if (freshInvites.length || freshRequests.length || freshBudgetProposals || freshMaster) {
          skipNextPersist.current = true; // data came FROM localStorage — don't write it back
          if (freshRequests.length) setRequests(freshRequests);
          if (freshInvites.length) setInvites(freshInvites);
          if (freshBudgetProposals) setBudgetProposals(freshBudgetProposals);
          if (freshMaster) setCapexMaster(freshMaster);
          // The cross-tab payload is lean (no base64); re-attach file blobs from IndexedDB.
          getAllFiles().then((files) => {
            if (!files || !Object.keys(files).length) return;
            skipNextPersist.current = true;
            if (freshRequests.length) {
              setRequests((prev) => hydrateRequestFiles(prev, files));
            }
            if (freshInvites.length) {
              setInvites((prev) => hydrateInviteFiles(prev, files));
            }
          });
        }
      } catch {}
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function addRequest(req: CapexRequest) {
    setRequests((prev) => {
      const seq = String(prev.length + 1).padStart(4, '0');
      const requestNo = req.requestNo ?? `CAP-${getCurrentFyCode()}-${seq}`;
      // Mint the plant-head approval link token when the request needs head approval.
      const approvalToken =
        req.status === 'pending_head_approval'
          ? req.approvalToken ?? generateApprovalToken('request', req.id)
          : req.approvalToken;
      const withHistory: CapexRequest = req.statusHistory?.length
        ? { ...req, requestNo, approvalToken }
        : {
            ...req,
            requestNo,
            approvalToken,
            statusHistory: [{ status: req.status, actor: req.createdBy, at: req.createdAt }],
          };
      return dedupeById([...prev, withHistory]);
    });
  }

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

  function addVendor(vendor: Vendor) {
    setVendors((prev) => dedupeById([...prev, vendor]));
  }

  function addInvite(invite: VendorInvite) {
    setInvites((prev) => dedupeById([...prev, invite]));
  }

  function inviteVendors(
    requestId: string,
    vendorIds: string[],
    docSelections?: Record<string, DocSelection>,
  ) {
    // In the Brown Field RFQ flow the vendor quotes first, so inviting a vendor === sending the
    // quotation link: stamp `awaiting_quote`. Auction invites stay status-neutral (no rfqStatus).
    const req = requests.find((r) => r.id === requestId);
    // Brown Field is RFQ by default (no chooser); only an explicit auction is non-RFQ.
    const isRfq = req?.fieldType === 'brown_field' && req?.sourcingMode !== 'auction';
    setInvites((prev) => {
      const existingVendorIds = new Set(
        prev.filter((inv) => inv.requestId === requestId).map((inv) => inv.vendorId)
      );
      const now = Date.now();
      const nowIso = new Date().toISOString();
      const newInvites: VendorInvite[] = vendorIds
        .filter((vendorId) => !existingVendorIds.has(vendorId))
        .map((vendorId) => {
          const vendor = vendors.find((v) => v.id === vendorId);
          const isForeign = !!vendor?.foreign;
          // RFQ vendors must approve the contract documents (Commercial Terms / PBG / DLC / payment
          // terms) BEFORE they can quote, so send the doc-package up front (gated on the supplier
          // portal). Auction vendors approve the pre-bid Business Rules instead, so no package here.
          const rfqBits = isRfq
            ? {
                rfqStatus: 'awaiting_quote' as const,
                ...(vendor
                  ? {
                      docApprovalStatus: 'pending' as const,
                      docApprovalPackage: {
                        ...buildDocApprovalPackage(vendor, { selection: docSelections?.[vendorId] }),
                        sentAt: nowIso,
                      },
                    }
                  : { docApprovalStatus: 'not_sent' as const }),
              }
            : {};
          // Foreign vendors answer the Incoterms questionnaire WITH their quotation — seed the
          // blank doc up front (status `awaiting_vendor`) so the portal knows to ask at submit.
          const incoBits = isForeign
            ? {
                incoTermsStatus: 'awaiting_vendor' as const,
                incoTermsDoc: { ...buildBlankIncoTermsDoc(), sentAt: nowIso },
                incoTermsThread: [
                  { id: `inco-${now}-${vendorId}`, by: 'sourcing' as const, senderName: 'Sourcing', action: 'sent' as const, at: nowIso },
                ],
              }
            : {};
          return {
            id: `inv-${now}-${vendorId}`,
            requestId,
            vendorId,
            token: `tok_${vendorId}_${requestId}_${now}`,
            status: 'invited' as const,
            auctionApprovalStatus: 'not_sent' as const,
            quotes: [],
            negotiationThread: [],
            invitedAt: nowIso,
            ...rfqBits,
            ...incoBits,
          };
        });
      return dedupeById([...prev, ...newInvites]);
    });
  }

  /**
   * Invite a brand-new / one-time vendor by name/email/phone. Creates a one-time `Vendor`, an RFQ
   * invite (awaiting_quote underneath), and sends the INCO Terms (awaiting the vendor to fill them).
   * The vendor must approve the INCO Terms before their price-quote form unlocks.
   */
  function inviteNewVendor(
    requestId: string,
    info: { name: string; email: string; phone: string; foreign?: boolean },
    senderName: string,
    selection?: DocSelection,
  ) {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const vendorId = `v-ot-${nowMs}`;
    const isForeign = !!info.foreign;
    const vendor: Vendor = {
      id: vendorId,
      vendorCode: `OT-${String(nowMs).slice(-6)}`,
      vendorName: info.name.trim() || 'New Vendor',
      category: 'One-time',
      gstin: '',
      pan: '',
      contactName: info.name.trim(),
      contactEmail: info.email.trim(),
      contactPhone: info.phone.trim() || undefined,
      paymentTerms: 'Advance',
      bankName: '',
      accountNumber: '',
      ifsc: '',
      onboardedAt: now,
      oneTime: true,
      foreign: isForeign || undefined,
    };
    addVendor(vendor);
    const doc: IncoTermsDoc = { ...buildBlankIncoTermsDoc(), sentAt: now };
    const invite: VendorInvite = {
      id: `inv-${nowMs}-${vendorId}`,
      requestId,
      vendorId,
      token: `tok_${vendorId}_${requestId}_${nowMs}`,
      status: 'invited',
      auctionApprovalStatus: 'not_sent',
      quotes: [],
      negotiationThread: [],
      invitedAt: now,
      rfqStatus: 'awaiting_quote',
      // Docs-before-price: the one-time vendor approves the doc-package (incl. payment terms) before
      // quoting. Incoterms only gate FOREIGN vendors (international shipping terms).
      docApprovalStatus: 'pending',
      docApprovalPackage: { ...buildDocApprovalPackage(vendor, { selection }), sentAt: now },
      ...(isForeign
        ? {
            incoTermsStatus: 'awaiting_vendor' as const,
            incoTermsDoc: doc,
            incoTermsThread: [
              { id: `inco-${nowMs}`, by: 'sourcing' as const, senderName, action: 'sent' as const, at: now },
            ],
          }
        : {}),
    };
    addInvite(invite);
  }

  /**
   * INCO Terms negotiation (mirrors the RFQ thread). Vendor fills/counters → pending_sourcing;
   * sourcing edits & resends → pending_vendor. Either side then approves/rejects.
   */
  function proposeIncoTerms(
    inviteId: string,
    doc: IncoTermsDoc,
    by: 'sourcing' | 'vendor',
    senderName: string,
    message?: string,
  ) {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const thread = inv.incoTermsThread ?? [];
        const action: IncoTermsMessage['action'] = by === 'vendor' ? 'filled' : 'revised';
        const msg: IncoTermsMessage = {
          id: `inco-${Date.now()}-${inv.vendorId}`,
          by,
          senderName,
          doc,
          action,
          message,
          at: now,
        };
        return {
          ...inv,
          incoTermsDoc: { ...doc, sentAt: by === 'sourcing' ? now : doc.sentAt },
          incoTermsStatus: by === 'sourcing' ? 'pending_vendor' : 'pending_sourcing',
          incoTermsThread: [...thread, msg],
        };
      }),
    );
  }

  function respondToIncoTerms(
    inviteId: string,
    response: 'approved' | 'rejected',
    by: 'sourcing' | 'vendor',
    senderName: string,
    message?: string,
  ) {
    const target = invites.find((i) => i.id === inviteId);
    if (target) {
      const turn = effectiveIncoTermsStatus(target);
      const allowed =
        (by === 'sourcing' && turn === 'pending_sourcing') ||
        (by === 'vendor' && turn === 'pending_vendor');
      if (!allowed) {
        console.error(`respondToIncoTerms: ${by} cannot respond while status is ${turn}`);
        return;
      }
    }
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const thread = inv.incoTermsThread ?? [];
        const msg: IncoTermsMessage = {
          id: `inco-${Date.now()}-${inv.vendorId}`,
          by,
          senderName,
          action: response,
          message,
          at: now,
        };
        return {
          ...inv,
          incoTermsStatus: response,
          incoTermsThread: [...thread, msg],
          incoTermsDoc: inv.incoTermsDoc ? { ...inv.incoTermsDoc, respondedAt: now } : inv.incoTermsDoc,
        };
      }),
    );
  }

  function saveAuctionApprovalDocument(requestId: string, document: AuctionApprovalDocument) {
    setRequests((prev) =>
      prev.map((req) =>
        req.id === requestId
          ? { ...req, auctionApprovalDocument: document }
          : req
      )
    );
  }

  function sendAuctionApprovalToVendors(requestId: string, vendorIds: string[]) {
    const now = new Date().toISOString();

    setInvites((prev) => {
      const existingForRequest = new Set(
        prev.filter((inv) => inv.requestId === requestId).map((inv) => inv.vendorId)
      );
      const nowMs = Date.now();
      const newInvites: VendorInvite[] = vendorIds
        .filter((vendorId) => !existingForRequest.has(vendorId))
        .map((vendorId) => ({
          id: `inv-${nowMs}-${vendorId}`,
          requestId,
          vendorId,
          token: `tok_${vendorId}_${requestId}_${nowMs}`,
          status: 'invited' as const,
          auctionApprovalStatus: 'pending' as const,
          approvalDocumentSentAt: now,
          quotes: [],
          negotiationThread: [],
          invitedAt: now,
        }));

      const updatedInvites = prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        if (!vendorIds.includes(inv.vendorId)) return inv;
        return {
          ...inv,
          auctionApprovalStatus: 'pending' as const,
          approvalDocumentSentAt: now,
        };
      });

      return dedupeById([...updatedInvites, ...newInvites]);
    });

    setRequests((prev) =>
      prev.map((req) => {
        if (req.id !== requestId || !req.auctionApprovalDocument) return req;
        return {
          ...req,
          auctionApprovalDocument: {
            ...req.auctionApprovalDocument,
            sentAt: now,
          },
        };
      })
    );
  }

  function respondToAuctionApproval(inviteId: string, response: 'approved' | 'rejected') {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              auctionApprovalStatus: response,
              approvalRespondedAt: now,
            }
          : inv
      )
    );
  }

  function sendAuctionApprovalReminder(inviteId: string) {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? { ...inv, approvalReminderSentAt: now }
          : inv
      )
    );
  }

  function excludeVendorFromAuction(inviteId: string, reason: string) {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              auctionApprovalStatus: 'excluded',
              approvalExcludedAt: now,
              approvalExclusionReason: reason,
            }
          : inv
      )
    );
  }

  function updateInvite(id: string, updates: Partial<VendorInvite>) {
    setInvites((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv))
    );
  }

  // ── Brown Field RFQ flow ──
  function setSourcingMode(requestId: string, mode: 'rfq' | 'auction') {
    setRequests((prev) =>
      prev.map((req) => (req.id === requestId ? { ...req, sourcingMode: mode } : req)),
    );
    // Choosing RFQ flips already-invited, un-quoted vendors to "awaiting their first quote" and
    // sends each the contract doc-package (to approve before quoting) if they don't already have one.
    if (mode === 'rfq') {
      const nowIso = new Date().toISOString();
      setInvites((prev) =>
        prev.map((inv) => {
          if (inv.requestId !== requestId || inv.rfqQuote || (inv.rfqStatus && inv.rfqStatus !== 'not_sent')) return inv;
          const needsDocs = !inv.docApprovalStatus || inv.docApprovalStatus === 'not_sent';
          const vendor = needsDocs ? vendors.find((v) => v.id === inv.vendorId) : undefined;
          return {
            ...inv,
            rfqStatus: 'awaiting_quote' as const,
            ...(vendor
              ? {
                  docApprovalStatus: 'pending' as const,
                  docApprovalPackage: { ...buildDocApprovalPackage(vendor), sentAt: nowIso },
                }
              : { docApprovalStatus: inv.docApprovalStatus ?? 'not_sent' }),
          };
        }),
      );
    }
  }

  /** Revert the sourcing-mode choice (keeps invited vendors). */
  function clearSourcingMode(requestId: string) {
    setRequests((prev) =>
      prev.map((req) => (req.id === requestId ? { ...req, sourcingMode: undefined } : req)),
    );
  }

  /**
   * Vendor-quotes-first negotiation. The vendor submits/counters a full quotation (by 'supplier')
   * → awaiting sourcing; sourcing counters inline (by 'sourcing') → awaiting vendor. Documents are
   * NOT sent here — they auto-send only once the price is agreed (see respondToRfqQuote). Untrusted
   * supplier input is sanitized: price must be finite > 0; footer charges coerced to non-negative.
   *
   * INCO Terms ride along with a FOREIGN vendor's first quotation (`incoDoc`): the portal collects
   * the 12 answers in a modal behind the Submit button and passes them here, so the quote and the
   * Incoterms land in **one state pass** — either both persist or neither does. A foreign vendor
   * who has never answered the questionnaire cannot submit a quotation without it; the check runs
   * here (not only in the UI) so the invariant holds for every caller.
   */
  function proposeRfqQuote(
    inviteId: string,
    quote: RfqQuote,
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
    itemHsn?: Record<string, string>,
    incoDoc?: IncoTermsDoc,
  ): boolean {
    // Resolve the target FIRST: the sanitizer needs the request's line-item ids to reject a
    // `lineDocuments` map keyed to items this request does not have (the supplier page is public).
    const targetInvite = invites.find((i) => i.id === inviteId);
    const targetRequest = targetInvite
      ? requests.find((r) => r.id === targetInvite.requestId)
      : undefined;
    const allowedItemIds = targetRequest?.lineItems?.map((li) => li.id);
    const sanitized = sanitizeRfqQuote(quote, allowedItemIds);
    if (!sanitized) {
      console.error('proposeRfqQuote: invalid quotation rejected', quote);
      return false;
    }
    // Who owns the per-line documents decides what an ABSENT map means, and the answer differs by
    // side — which is why this is keyed on `by` rather than on emptiness:
    //   • SOURCING has no upload control at all (their counter is built from price fields alone by
    //     `quoteFromForm` in RfqPanel), so an absent map means "not specified". Carrying the
    //     vendor's documents forward is the only correct reading; otherwise countering a price
    //     would silently delete the datasheets the tech-spec gate and the approver's quotation view
    //     both read.
    //   • The SUPPLIER owns their own paperwork and has a control for every line, so their map is
    //     authoritative including when it is empty — a vendor who removes their last attachment
    //     and re-submits must actually see it gone.
    const clean: RfqQuote =
      by === 'supplier' || sanitized.lineDocuments
        ? sanitized
        : { ...sanitized, lineDocuments: targetInvite?.rfqQuote?.lineDocuments };
    let hsnPatch: Record<string, string> | null = null;
    if (by === 'supplier' && targetRequest?.lineItems?.length) {
      hsnPatch = resolveSupplierItemHsn(targetRequest.lineItems, clean, itemHsn);
      if (!hsnPatch) {
        console.error('proposeRfqQuote: missing HSN for one or more line items');
        return false;
      }
    }
    // ── INCO Terms attached to a supplier quotation ──────────────────────────
    let incoPatch: Pick<VendorInvite, 'incoTermsDoc' | 'incoTermsStatus'> | null = null;
    if (by === 'supplier' && targetInvite) {
      const vendor = vendors.find((v) => v.id === targetInvite.vendorId) ?? null;
      const mustAnswer = needsIncoTermsWithQuote(targetInvite, vendor);
      if (incoDoc) {
        if (!incoTermsRequired(vendor)) {
          console.error('proposeRfqQuote: INCO Terms supplied for a vendor that does not need them');
          return false;
        }
        if (!isIncoDocComplete(incoDoc)) {
          console.error('proposeRfqQuote: incomplete INCO Terms rejected — quotation not saved');
          return false;
        }
        incoPatch = {
          incoTermsDoc: { ...incoDoc, sentAt: incoDoc.sentAt ?? new Date().toISOString() },
          incoTermsStatus: 'pending_sourcing',
        };
      } else if (mustAnswer) {
        console.error('proposeRfqQuote: foreign vendor must answer the INCO Terms with the quotation');
        return false;
      }
    }
    const now = new Date().toISOString();
    if (hsnPatch && targetRequest) {
      setRequests((prev) =>
        prev.map((req) => {
          if (req.id !== targetRequest.id || !req.lineItems) return req;
          return {
            ...req,
            lineItems: req.lineItems.map((li) => {
              const nextHsn = hsnPatch![li.id];
              return nextHsn ? { ...li, hsnCode: nextHsn } : li;
            }),
          };
        }),
      );
    }
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const thread = inv.rfqThread ?? [];
        const supplierHasOffered = thread.some((m) => m.by === 'supplier');
        const action: RfqPriceMessage['action'] =
          by === 'supplier' ? (supplierHasOffered ? 'countered' : 'proposed') : 'countered';
        const msg: RfqPriceMessage = {
          id: `rfq-${Date.now()}-${inv.vendorId}`,
          by,
          senderName,
          price: clean.price,
          quote: clean,
          action,
          message,
          at: now,
        };
        // Countering an already-approved quote re-opens the negotiation → stale documents reset.
        const wasApproved = inv.rfqStatus === 'approved';
        // INCO answers submitted with this quotation open their own negotiation thread.
        const incoThread = incoPatch
          ? [
              ...(inv.incoTermsThread ?? []),
              {
                id: `inco-${Date.now()}-${inv.vendorId}`,
                by: 'vendor' as const,
                senderName,
                doc: incoPatch.incoTermsDoc,
                action: 'filled' as const,
                message: 'Submitted with the quotation',
                at: now,
              },
            ]
          : inv.incoTermsThread;
        return {
          ...inv,
          rfqQuote: clean,
          rfqStatus: by === 'sourcing' ? 'pending_vendor' : 'pending_sourcing',
          rfqThread: [...thread, msg],
          ...(wasApproved ? { docApprovalStatus: 'not_sent' as const, docApprovalPackage: undefined } : {}),
          ...(incoPatch ? { ...incoPatch, incoTermsThread: incoThread } : {}),
        };
      }),
    );
    return true;
  }

  /**
   * Either side accepts or rejects the quotation on the table. On acceptance — whether sourcing
   * accepts the vendor's price or the vendor accepts sourcing's counter — the approval documents
   * (Commercial Terms + PBG + DLC, plus one-time payment terms) AUTO-SEND for the vendor to sign
   * off separately (docApprovalStatus → 'pending'). PI is gated on both being approved.
   * A turn guard ensures only the party whose move it is can respond.
   */
  function respondToRfqQuote(
    inviteId: string,
    response: 'approved' | 'rejected',
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
  ) {
    const target = invites.find((i) => i.id === inviteId);
    if (target) {
      const turn = effectiveRfqStatus(target);
      const allowed =
        (by === 'sourcing' && turn === 'pending_sourcing') ||
        (by === 'supplier' && turn === 'pending_vendor');
      if (!allowed) {
        console.error(`respondToRfqQuote: ${by} cannot respond while status is ${turn}`);
        return;
      }
    }
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const thread = inv.rfqThread ?? [];
        const msg: RfqPriceMessage = {
          id: `rfq-${Date.now()}-${inv.vendorId}`,
          by,
          senderName,
          action: response,
          message,
          at: now,
        };
        if (response === 'rejected') {
          return { ...inv, rfqStatus: 'rejected', rfqThread: [...thread, msg] };
        }
        // Approved → auto-send the document package for separate vendor sign-off (unless already approved).
        const docsAlreadyApproved = effectiveDocApprovalStatus(inv.docApprovalStatus) === 'approved';
        const vendor = vendors.find((v) => v.id === inv.vendorId);
        return {
          ...inv,
          rfqStatus: 'approved',
          rfqThread: [...thread, msg],
          ...(docsAlreadyApproved || !vendor
            ? {}
            : {
                docApprovalStatus: 'pending' as const,
                docApprovalPackage: { ...buildDocApprovalPackage(vendor), sentAt: now },
              }),
        };
      }),
    );
  }

  /** RFQ per-line "Final Decision": record the winning vendor for a line item (or clear it). */
  function setRfqFinalVendor(requestId: string, lineItemId: string, vendorId: string) {
    setRequests((prev) =>
      prev.map((req) => {
        if (req.id !== requestId) return req;
        const next = { ...(req.rfqFinalVendorPerItem ?? {}) };
        if (vendorId) next[lineItemId] = vendorId;
        else delete next[lineItemId];
        return { ...req, rfqFinalVendorPerItem: next };
      }),
    );
  }

  /** Set the HSN code on a request line item — drives item-wise GST identically across all vendors. */
  function setLineHsn(requestId: string, lineItemId: string, hsnCode: string) {
    setRequests((prev) =>
      prev.map((req) => {
        if (req.id !== requestId || !req.lineItems) return req;
        return {
          ...req,
          lineItems: req.lineItems.map((li) =>
            li.id === lineItemId ? { ...li, hsnCode: hsnCode || undefined } : li,
          ),
        };
      }),
    );
  }

  /** Re-open an approved RFQ quotation for further negotiation (resets the auto-sent documents). */
  function reopenRfqQuote(inviteId: string) {
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId && inv.rfqStatus === 'approved'
          ? { ...inv, rfqStatus: 'pending_sourcing', docApprovalStatus: 'not_sent', docApprovalPackage: undefined }
          : inv,
      ),
    );
  }

  /**
   * Carry RFQ prices into a reverse auction: for each invited vendor with an RFQ quotation and no
   * existing auction bid, seed an opening `Quote` from their `RfqQuote` (per-line `itemPrices`,
   * grand total, footer charges). The lowest seeded bid becomes L1; vendors can rebid lower.
   * Called when sourcing escalates an RFQ to an auction.
   */
  function seedAuctionFromRfq(requestId: string) {
    const now = new Date().toISOString();
    const validUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        if (!inv.rfqQuote) return inv;
        if (inv.openingQuote || inv.quotes.length > 0) return inv; // already seeded / has a bid
        const rq = inv.rfqQuote;
        const seeded: Quote = {
          id: `q-seed-${inv.vendorId}-${Date.now()}`,
          // Match the auction-bid convention: `price` is the BASE subtotal (excl. freight/packing/
          // service); charges stay separate so consumers (resolveFinalVendor, setAuctionConfig) that
          // add `price + charges` don't double-count.
          price: rq.price,
          itemPrices: rq.linePrices,
          deliveryDays: rq.deliveryDays ?? (rq.deliveryWeeks != null ? Math.round(rq.deliveryWeeks * 7) : 0),
          validUntil,
          submittedAt: now,
          freight: rq.freight,
          packing: rq.packing,
          service: rq.service,
          warranty: rq.warranty,
          currency: rq.currency,
          seededByBuyer: true,
        };
        // Seed the opening bid on `openingQuote`, NOT `quotes` — ranks stay empty (reset) until the
        // vendor submits a fresh bid to reveal their rank. `openingQuote` is the award-price fallback.
        return { ...inv, openingQuote: seeded };
      }),
    );
  }

  /**
   * Finalize a split reverse auction: turn the Final-Decision selections (per-line vendor + price)
   * into one AWARD per winning vendor. Each awarded invite becomes its own fulfillment track
   * (awarded items + amount + awardStatus). Writes invites directly (bypassing approveInvite's
   * single-approval guard, which is intentional here). No contract-terms package is sent here — the
   * vendors already approved the pre-bid "Business Rules" doc (Commercial Terms + PBG + DLC) to
   * participate, so awarded vendors go straight to the PI request. Request status is untouched.
   */
  // ── Technical specification approval (pre-award gate, per vendor) ──────────
  /**
   * Attach / replace the spec package sourcing is preparing for a vendor (documents typically come
   * FROM the vendor). Editable while the package is not with the Technical team; the doc cap keeps
   * the IndexedDB payload bounded. Returns false if the edit was rejected.
   */
  function saveTechSpecDraft(
    inviteId: string,
    patch: { notes?: string; addDocuments?: TechSpecDocument[]; removeDocumentId?: string },
  ): boolean {
    const target = invites.find((i) => i.id === inviteId);
    if (!target) {
      console.error(`[CapexContext] saveTechSpecDraft: invite "${inviteId}" not found`);
      return false;
    }
    if (!canSendTechSpec(target)) {
      console.error('[CapexContext] saveTechSpecDraft: spec is with the Technical team — cannot edit');
      return false;
    }
    const current = target.techSpec ?? buildBlankTechSpec();
    const kept = patch.removeDocumentId
      ? current.documents.filter((d) => d.id !== patch.removeDocumentId)
      : current.documents;
    const nextDocs = [...kept, ...(patch.addDocuments ?? [])];
    if (nextDocs.length > MAX_TECH_SPEC_DOCS) {
      console.error(`[CapexContext] saveTechSpecDraft: at most ${MAX_TECH_SPEC_DOCS} spec documents`);
      return false;
    }
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              techSpec: {
                ...current,
                ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
                documents: nextDocs,
              },
            }
          : inv,
      ),
    );
    return true;
  }

  /**
   * Send this vendor's machine specification to Amber's Technical team for sign-off. Mints (or
   * rotates) the public `/tech-spec/<token>` link, so a superseded link stops working on re-send.
   * State-guarded: only from not_sent / needs_revision / rejected, and only with something to review.
   */
  function sendTechSpecForApproval(inviteId: string, senderName: string, notes?: string): boolean {
    const target = invites.find((i) => i.id === inviteId);
    if (!target) {
      console.error(`[CapexContext] sendTechSpecForApproval: invite "${inviteId}" not found`);
      return false;
    }
    if (!canSendTechSpec(target)) {
      console.error(`[CapexContext] sendTechSpecForApproval: cannot send while ${effectiveTechSpecStatus(target)}`);
      return false;
    }
    // `notes` carries the caller's unsaved edit so the save and the send happen in ONE state pass —
    // saving separately first would be read back stale here and silently overwritten.
    const base = target.techSpec ?? buildBlankTechSpec();
    const current = notes !== undefined ? { ...base, notes } : base;
    if (!isTechSpecReadyToSend(current)) {
      console.error('[CapexContext] sendTechSpecForApproval: attach a document or write notes first');
      return false;
    }
    const now = new Date().toISOString();
    // The sender gets a remark too, not only the approver: sourcing's covering note is what tells
    // the Technical team what changed on a re-send after a send-back.
    const sendRemark = buildApprovalRemark({
      stage: 'sourcing_tech_spec',
      action: 'sent',
      by: senderName,
      text: current.notes,
      at: now,
    });
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              approvalRemarks: appendRemark(inv.approvalRemarks, sendRemark),
              techSpec: {
                ...current,
                status: 'pending_technical' as const,
                token: generateTechSpecToken(inv.id),
                sentAt: now,
                sentBy: senderName,
                // A fresh round clears the previous decision so stale remarks don't read as current.
                decidedAt: undefined,
                decidedBy: undefined,
                decisionNote: undefined,
                thread: [
                  ...current.thread,
                  { id: `ts-${Date.now()}-${inv.vendorId}`, by: 'sourcing' as const, senderName, action: 'sent' as const, at: now },
                ],
              },
            }
          : inv,
      ),
    );
    return true;
  }

  /**
   * The Technical team's verdict, submitted from the public link. Turn-guarded to
   * `pending_technical` so a stale tab cannot re-decide a package that already moved on.
   */
  function decideTechSpec(
    inviteId: string,
    decision: 'approved' | 'rejected' | 'needs_revision',
    deciderName: string,
    note?: string,
  ): boolean {
    const target = invites.find((i) => i.id === inviteId);
    if (!target || !target.techSpec) {
      console.error(`[CapexContext] decideTechSpec: no spec package on invite "${inviteId}"`);
      return false;
    }
    if (!canDecideTechSpec(target)) {
      console.error(`[CapexContext] decideTechSpec: cannot decide while ${effectiveTechSpecStatus(target)}`);
      return false;
    }
    const now = new Date().toISOString();
    const action =
      decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'revision_requested';
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId || !inv.techSpec) return inv;
        return {
          ...inv,
          // Recorded on the shared trail as well as the spec package, so the sourcing surfaces that
          // render remarks for a request pick up the Technical team's verdict without special-casing
          // the tech-spec thread.
          approvalRemarks: appendRemark(
            inv.approvalRemarks,
            buildApprovalRemark({
              stage: 'technical_spec',
              action: decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'sent_back',
              by: deciderName,
              text: note,
              at: now,
            }),
          ),
          techSpec: {
            ...inv.techSpec,
            status: decision,
            decidedAt: now,
            decidedBy: deciderName,
            decisionNote: note?.trim() || undefined,
            // Burn the link once decided — a new one is minted if sourcing re-sends.
            token: undefined,
            thread: [
              ...inv.techSpec.thread,
              { id: `ts-${Date.now()}-${inv.vendorId}`, by: 'technical' as const, senderName: deciderName, action, message: note?.trim() || undefined, at: now },
            ],
          },
        };
      }),
    );
    return true;
  }

  /**
   * Technical-spec gate shared by every award path. Returns the vendor ids that CANNOT be awarded
   * because Amber's Technical team has not approved their machine specification. Enforced here (not
   * only in the UI) so no caller can skip the step.
   */
  function techSpecBlockedVendorIds(requestId: string, vendorIds: string[]): string[] {
    return vendorIds.filter((vid) => {
      const inv = invites.find((i) => i.requestId === requestId && i.vendorId === vid);
      return !inv || techSpecBlocksAward(inv);
    });
  }

  /**
   * Incoterms award gate, enforced here (not only in the UI) exactly like the technical-spec gate
   * above. Returns the vendor ids that CANNOT be awarded because their Incoterms agreement is still
   * being negotiated (or was rejected).
   *
   * SCOPE — `sourcingMode === 'rfq'` ONLY, stated positively on purpose. That is exactly the set of
   * requests where BOTH actors have an Incoterms surface: sourcing's tracker lives in `RfqPanel`
   * (rendered only in RFQ mode) and the vendor's negotiation card lives in `RfqSupplierView` (the
   * supplier portal routes there only for `sourcingMode === 'rfq'`). In auction mode neither surface
   * exists, so blocking an award there would strand it with no actor able to unblock it — a worse
   * failure than the missing gate. Surfacing the tracker in auction mode is the follow-up that would
   * let this widen; see the wave-W report.
   */
  function incoTermsBlockedVendorIds(requestId: string, vendorIds: string[]): string[] {
    const req = requests.find((r) => r.id === requestId);
    if (req?.sourcingMode !== 'rfq') return [];
    return vendorIds.filter((vid) => {
      const inv = invites.find((i) => i.requestId === requestId && i.vendorId === vid);
      return !!inv && incoTermsNegotiationOpen(inv);
    });
  }

  function finalizeSplitAward(requestId: string, decision?: SourcingDecision, onlyVendorId?: string) {
    const request = requests.find((r) => r.id === requestId);
    if (!request) {
      console.error(`[CapexContext] finalizeSplitAward: request "${requestId}" not found`);
      return;
    }
    // The caller passes the freshly-built decision (the just-edited Final-Decision grid) to avoid a
    // stale read of request.sourcingDecision, which setState has not yet committed.
    const dec = decision ?? request.sourcingDecision;
    const lineItems = request.lineItems ?? [];
    if (!dec?.finalVendorPerItem || lineItems.length === 0) {
      console.error('[CapexContext] finalizeSplitAward: missing final decision or line items');
      return;
    }
    const groups = buildAwardGroups(lineItems, dec.finalPrices ?? {}, dec.finalVendorPerItem);
    if (groups.length === 0) {
      console.error('[CapexContext] finalizeSplitAward: no vendors selected in the final decision');
      return;
    }
    // Technical-spec sign-off is a hard pre-award gate (per vendor).
    const targetVendors = groups.map((g) => g.vendorId).filter((v) => !onlyVendorId || v === onlyVendorId);
    const blocked = techSpecBlockedVendorIds(requestId, targetVendors);
    if (blocked.length) {
      console.error('[CapexContext] finalizeSplitAward: technical spec not approved for', blocked);
      return;
    }
    // Incoterms agreement is the second hard pre-award gate (foreign vendors, RFQ path).
    const incoBlocked = incoTermsBlockedVendorIds(requestId, targetVendors);
    if (incoBlocked.length) {
      console.error('[CapexContext] finalizeSplitAward: INCO Terms not agreed for', incoBlocked);
      return;
    }
    // When `onlyVendorId` is given, award just that vendor's group (additive — other vendors are
    // left untouched so sourcing can award "each separately"); otherwise award every group at once.
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        if (onlyVendorId && inv.vendorId !== onlyVendorId) return inv;
        const group = groups.find((g) => g.vendorId === inv.vendorId);
        if (!group) return inv;
        return {
          ...inv,
          status: 'approved' as const,
          awarded: true,
          awardedItemIds: group.itemIds,
          awardAmount: group.amount,
          awardStatus: 'awarded' as const,
          // Carry the request's trial requirement onto each award track.
          ...(request.trialRequired ? { trialRequired: true, trialStatus: 'pending_upload' as const } : {}),
        };
      }),
    );
  }

  /**
   * Sourcing requests a Proforma Invoice from a finalized vendor — moves the request to
   * pi_requested. For award-based (split-auction) requests this advances only THAT award
   * (`awardStatus → pi_requested`) and bumps the coarse request status; for single-vendor / RFQ
   * requests it sets `finalVendorId` + request status as before.
   */
  function requestProformaInvoice(requestId: string, vendorId: string, actor: string) {
    if (techSpecBlockedVendorIds(requestId, [vendorId]).length) {
      console.error('[CapexContext] requestProformaInvoice: technical spec not approved for', vendorId);
      return;
    }
    if (incoTermsBlockedVendorIds(requestId, [vendorId]).length) {
      console.error('[CapexContext] requestProformaInvoice: INCO Terms not agreed for', vendorId);
      return;
    }
    const reqInvites = invites.filter((i) => i.requestId === requestId);
    if (isAwardBased(reqInvites)) {
      const nextInvites = reqInvites.map((i) =>
        i.vendorId === vendorId && i.awarded ? { ...i, awardStatus: 'pi_requested' as const } : i,
      );
      setInvites((prev) =>
        prev.map((i) =>
          i.requestId === requestId && i.vendorId === vendorId && i.awarded
            ? { ...i, awardStatus: 'pi_requested' as const }
            : i,
        ),
      );
      const derived = deriveRequestStatus(nextInvites);
      const req = requests.find((r) => r.id === requestId);
      if (derived === 'pi_requested' && req && PRE_PI_REQUEST_STATUSES.includes(req.status)) {
        updateRequest(requestId, { status: 'pi_requested' }, actor);
      }
      return;
    }
    updateRequest(requestId, { finalVendorId: vendorId, status: 'pi_requested' }, actor);
  }

  /**
   * Unified Final-Decision action for BOTH RFQ and reverse auction: award the vendor(s) chosen in the
   * per-line Final Decision AND request their Proforma Invoice(s) in ONE atomic state pass (so there's
   * no stale-state race between awarding and requesting). Pass `onlyVendorId` to approve a single
   * vendor's award ("each separately"); omit it to approve every chosen vendor at once ("all at once").
   */
  function awardAndRequestPi(
    requestId: string,
    decision: SourcingDecision | undefined,
    actor: string,
    onlyVendorId?: string,
  ) {
    const request = requests.find((r) => r.id === requestId);
    if (!request) {
      console.error(`[CapexContext] awardAndRequestPi: request "${requestId}" not found`);
      return;
    }
    const dec = decision ?? request.sourcingDecision;
    const lineItems = request.lineItems ?? [];
    if (!dec?.finalVendorPerItem || lineItems.length === 0) {
      console.error('[CapexContext] awardAndRequestPi: missing final decision or line items');
      return;
    }
    const groups = buildAwardGroups(lineItems, dec.finalPrices ?? {}, dec.finalVendorPerItem);
    if (groups.length === 0) {
      console.error('[CapexContext] awardAndRequestPi: no vendors selected in the final decision');
      return;
    }
    // Technical-spec sign-off is a hard pre-award gate (per vendor) — award nothing if any of the
    // vendors being awarded in this call is still unapproved.
    const targetVendors = groups.map((g) => g.vendorId).filter((v) => !onlyVendorId || v === onlyVendorId);
    const blocked = techSpecBlockedVendorIds(requestId, targetVendors);
    if (blocked.length) {
      console.error('[CapexContext] awardAndRequestPi: technical spec not approved for', blocked);
      return;
    }
    // Incoterms agreement is the second hard pre-award gate (foreign vendors, RFQ path) — the
    // documented "a foreign vendor cannot be taken to Proforma Invoice until the terms are
    // approved" rule, which until now existed only as a hint string.
    const incoBlocked = incoTermsBlockedVendorIds(requestId, targetVendors);
    if (incoBlocked.length) {
      console.error('[CapexContext] awardAndRequestPi: INCO Terms not agreed for', incoBlocked);
      return;
    }
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        if (onlyVendorId && inv.vendorId !== onlyVendorId) return inv;
        const group = groups.find((g) => g.vendorId === inv.vendorId);
        if (!group) return inv;
        return {
          ...inv,
          status: 'approved' as const,
          awarded: true,
          awardedItemIds: group.itemIds,
          awardAmount: group.amount,
          awardStatus: 'pi_requested' as const,
          // Carry the request's trial requirement onto each award track.
          ...(request.trialRequired ? { trialRequired: true, trialStatus: 'pending_upload' as const } : {}),
        };
      }),
    );
    // Coarse request status follows the awards into fulfillment. Every pre-PI status is bumped,
    // not just `sourcing` — an escalated RFQ can sit at the legacy negotiation/sourcing_approved/
    // buyer_approved states, and leaving the request there stranded the awards (the fulfillment
    // surfaces key off the request status). `ALLOWED_TRANSITIONS` permits all of these → pi_requested.
    if (PRE_PI_REQUEST_STATUSES.includes(request.status)) {
      updateRequest(requestId, { status: 'pi_requested' }, actor);
    }
  }

  /**
   * Vendor uploads the Proforma Invoice (supplier portal). Award-based: advances only THAT award
   * (`awardStatus → pi_submitted`, per-award `piSubmittedAt`) and leaves the request status alone.
   * Single-vendor: moves the request to pi_submitted (request-level piSubmittedAt) as before.
   */
  function submitProformaInvoice(inviteId: string, pi: ProformaInvoice) {
    const now = new Date().toISOString();
    const invite = invites.find((i) => i.id === inviteId);
    const reqInvites = invite ? invites.filter((i) => i.requestId === invite.requestId) : [];
    const awardBased = isAwardBased(reqInvites);
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              proformaInvoice: { ...pi, uploadedAt: pi.uploadedAt || now, submittedByVendor: true },
              ...(inv.awarded
                ? {
                    awardStatus: 'pi_submitted' as const,
                    piSubmittedAt: now,
                    // Mint the public Plant-Accounts token once the award reaches fulfillment.
                    poToken: inv.poToken ?? generatePoToken('award', inv.id),
                  }
                : {}),
            }
          : inv,
      ),
    );
    if (invite && !awardBased) {
      // Mint the request-level token for the Plant-Accounts handoff.
      const req = requests.find((r) => r.id === invite.requestId);
      updateRequest(
        invite.requestId,
        {
          status: 'pi_submitted',
          piSubmittedAt: now,
          poToken: req?.poToken ?? generatePoToken('request', invite.requestId),
        },
        'Vendor',
      );
    }
  }

  // ── Document-approval package (PBG + DLC + one-time payment terms) ──
  function sendDocApprovalPackage(requestId: string, vendorIds: string[]) {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId || !vendorIds.includes(inv.vendorId)) return inv;
        const vendor = vendors.find((v) => v.id === inv.vendorId);
        if (!vendor) return inv;
        const pkg = buildDocApprovalPackage(vendor);
        return { ...inv, docApprovalStatus: 'pending', docApprovalPackage: { ...pkg, sentAt: now } };
      }),
    );
  }

  function resendDocApprovalPackage(inviteId: string, note?: string) {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const vendor = vendors.find((v) => v.id === inv.vendorId);
        if (!vendor) return inv;
        const pkg = buildDocApprovalPackage(vendor, { revisionNote: note });
        return { ...inv, docApprovalStatus: 'pending', docApprovalPackage: { ...pkg, sentAt: now } };
      }),
    );
  }

  function respondToDocApproval(inviteId: string, response: 'approved' | 'rejected') {
    const now = new Date().toISOString();
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? {
              ...inv,
              docApprovalStatus: response,
              docApprovalPackage: inv.docApprovalPackage
                ? { ...inv.docApprovalPackage, respondedAt: now }
                : inv.docApprovalPackage,
            }
          : inv,
      ),
    );
  }

  // ── Accounts: FA codes, PO, payment milestones ──
  // Accounts mutations take an optional `inviteId`: when present the action targets that single
  // AWARD (writes the invite's fa/PO/payment fields + bumps its awardStatus); when omitted it
  // behaves request-level for single-vendor / RFQ requests exactly as before.
  function assignFaCode(requestId: string, lineItemId: string, code: string, inviteId?: string) {
    if (inviteId) {
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId
            ? { ...inv, faCodes: { ...(inv.faCodes ?? {}), [lineItemId]: code } }
            : inv,
        ),
      );
      return;
    }
    setRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? { ...r, faCodes: { ...(r.faCodes ?? {}), [lineItemId]: code } }
          : r,
      ),
    );
  }

  function createPurchaseOrder(requestId: string, po: PurchaseOrder, milestones: PaymentMilestone[]) {
    updateRequest(
      requestId,
      { purchaseOrder: po, paymentMilestones: milestones, status: 'accounts_processing' },
      po.createdBy,
    );
  }

  function submitPurchaseOrder(requestId: string, actor: string) {
    const req = requests.find((r) => r.id === requestId);
    const po = req?.purchaseOrder;
    updateRequest(
      requestId,
      {
        status: 'payment_in_progress',
        ...(po ? { purchaseOrder: { ...po, submittedAt: new Date().toISOString() } } : {}),
      },
      actor,
    );
  }

  /**
   * Plant Accounts (public /po/[token] link): FA codes are assigned (assignFaCode); submitting
   * hands the award/request to Global Accounts ("Satish") for the PO — so this also mints the
   * public PO-issue token that Plant Accounts email him straight from their own page.
   */
  function submitFaCodes(requestId: string, actor: string, inviteId?: string, note?: string) {
    const now = new Date().toISOString();
    const remark = buildApprovalRemark({
      stage: 'plant_accounts_fa',
      action: 'sent',
      by: actor || PLANT_ACCOUNTS_ACTOR,
      text: note,
      at: now,
    });
    if (inviteId) {
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId && inv.awarded
            ? {
                ...inv,
                awardStatus: 'accounts_processing' as const,
                // Ensure the Plant-Accounts link exists (mint if the PI path somehow skipped it).
                poToken: inv.poToken ?? generatePoToken('award', inv.id),
                // Satish's PO-issue link — emailed from the Plant-Accounts page on submit.
                poIssueToken: inv.poIssueToken ?? generatePoIssueToken('award', inv.id),
                approvalRemarks: appendRemark(inv.approvalRemarks, remark),
              }
            : inv,
        ),
      );
      return;
    }
    const req = requests.find((r) => r.id === requestId);
    updateRequest(
      requestId,
      {
        status: 'accounts_processing',
        poToken: req?.poToken ?? generatePoToken('request', requestId),
        poIssueToken: req?.poIssueToken ?? generatePoIssueToken('request', requestId),
        ...remarkPatch(req?.approvalRemarks, remark),
      },
      actor,
    );
  }

  /**
   * Global Accounts ("Satish", public /po-issue/[token] link): assign the PO number, upload the PO
   * document, and ISSUE it to the vendor —
   * the vendor is notified and sees/downloads the PO on the supplier portal. Builds payment
   * milestones and moves the request into payment_in_progress.
   */
  function issuePurchaseOrder(
    requestId: string,
    po: PurchaseOrder,
    milestones: PaymentMilestone[],
    actor: string,
    inviteId?: string,
    note?: string,
  ) {
    const now = new Date().toISOString();
    const remark = buildApprovalRemark({
      stage: 'global_accounts_po',
      action: 'approved',
      by: actor || GLOBAL_ACCOUNTS_ACTOR,
      text: note,
      at: now,
    });
    if (inviteId) {
      setInvites((prev) =>
        prev.map((inv) =>
          // Turn-guarded: only an award awaiting its PO can be issued, so a stale link can never
          // overwrite an issued PO (and reset its milestones).
          inv.id === inviteId && inv.awarded && inv.awardStatus === 'accounts_processing'
            ? {
                ...inv,
                purchaseOrder: { ...po, issuedAt: now, issuedBy: actor, submittedAt: po.submittedAt ?? now },
                paymentMilestones: milestones,
                awardStatus: 'payment_in_progress' as const,
                // Vendor can re-upload the PI against the issued PO.
                piReuploadAllowed: true,
                approvalRemarks: appendRemark(inv.approvalRemarks, remark),
              }
            : inv,
        ),
      );
      return;
    }
    updateRequest(
      requestId,
      {
        purchaseOrder: { ...po, issuedAt: now, issuedBy: actor, submittedAt: po.submittedAt ?? now },
        paymentMilestones: milestones,
        status: 'payment_in_progress',
        // Vendor can re-upload the PI against the issued PO.
        piReuploadAllowed: true,
        ...remarkPatch(requests.find((r) => r.id === requestId)?.approvalRemarks, remark),
      },
      actor,
    );
  }

  /**
   * Tick one payment milestone. `note` is Plant Accounts' remark on that specific payment (UTR,
   * part-payment reason, a hold they lifted) — recorded on the remark trail so the request detail
   * and the accounts tracker show WHY a milestone moved, not only that it did.
   */
  function markPaymentMade(
    requestId: string,
    milestoneId: string,
    actor: string,
    inviteId?: string,
    note?: string,
  ) {
    const now = new Date().toISOString();
    const paymentRemark = buildApprovalRemark({
      stage: 'plant_accounts_payment',
      action: 'noted',
      by: actor || PLANT_ACCOUNTS_ACTOR,
      text: note,
      at: now,
    });
    if (inviteId) {
      // Award-based: tick this award's milestone; final tick completes the award (per-award TAT
      // stop). When every award is completed, the whole request completes.
      const inv = invites.find((i) => i.id === inviteId);
      if (!inv?.paymentMilestones) return;
      const target = inv.paymentMilestones.find((m) => m.id === milestoneId);
      // Block the FINAL payment while a required trial has not been approved.
      if (target?.isFinal && finalPaymentBlockedByTrial(inv)) {
        console.error('[CapexContext] Final payment blocked: trial not yet approved');
        return;
      }
      // The advance is the first NON-final milestone; ticking it starts the delivery-lead clock.
      const isAdvance = inv.paymentMilestones.find((m) => !m.isFinal)?.id === milestoneId;
      const updated = inv.paymentMilestones.map((m) =>
        m.id === milestoneId ? { ...m, status: 'paid' as const, paidAt: now, paidBy: actor } : m,
      );
      const finalDone =
        updated.some((m) => m.isFinal && m.status === 'paid') || updated.every((m) => m.status === 'paid');
      const nextInvites = invites.map((i) =>
        i.id === inviteId
          ? {
              ...i,
              paymentMilestones: updated,
              // Money has moved against the submitted PI, so the vendor can no longer revise it —
              // the first payment closes the post-PO re-upload window for good.
              piReuploadAllowed: false,
              ...(isAdvance && !i.advancePaidAt ? { advancePaidAt: now } : {}),
              ...(finalDone && i.awardStatus === 'payment_in_progress'
                ? { awardStatus: 'completed' as const, tatStoppedAt: now }
                : {}),
              approvalRemarks: appendRemark(i.approvalRemarks, paymentRemark),
            }
          : i,
      );
      setInvites(() => nextInvites);
      const reqAwards = awardedInvites(nextInvites.filter((i) => i.requestId === requestId));
      const allDone = reqAwards.length > 0 && reqAwards.every((a) => a.awardStatus === 'completed');
      const req = requests.find((r) => r.id === requestId);
      if (allDone && req && req.status !== 'completed') {
        updateRequest(requestId, { status: 'completed' }, actor);
      }
      return;
    }
    const req = requests.find((r) => r.id === requestId);
    if (!req?.paymentMilestones) return;
    const target = req.paymentMilestones.find((m) => m.id === milestoneId);
    // Block the FINAL payment while a required trial has not been approved.
    if (target?.isFinal && finalPaymentBlockedByTrial(req)) {
      console.error('[CapexContext] Final payment blocked: trial not yet approved');
      return;
    }
    const isAdvance = req.paymentMilestones.find((m) => !m.isFinal)?.id === milestoneId;
    const updated = req.paymentMilestones.map((m) =>
      m.id === milestoneId ? { ...m, status: 'paid' as const, paidAt: now, paidBy: actor } : m,
    );
    // Ticking the final instalment (or clearing every milestone) stops the TAT clock and completes the request.
    const finalDone =
      updated.some((m) => m.isFinal && m.status === 'paid') || updated.every((m) => m.status === 'paid');
    updateRequest(
      requestId,
      {
        paymentMilestones: updated,
        // First payment closes the post-PO PI re-upload window (see the award branch above).
        piReuploadAllowed: false,
        ...(isAdvance && !req.advancePaidAt ? { advancePaidAt: now } : {}),
        ...(finalDone && req.status === 'payment_in_progress'
          ? { status: 'completed', tatStoppedAt: now }
          : {}),
        ...remarkPatch(req.approvalRemarks, paymentRemark),
      },
      actor,
    );
  }

  function submitQuote(inviteId: string, quote: Quote) {
    // Public bid surface: shape-check the per-line documents against this request's line items
    // before they reach state, exactly as `proposeRfqQuote` does for the RFQ path.
    const invite = invites.find((i) => i.id === inviteId);
    const allowedItemIds = invite
      ? requests.find((r) => r.id === invite.requestId)?.lineItems?.map((li) => li.id)
      : undefined;
    const cleanDocs = sanitizeLineDocuments(quote.lineDocuments, allowedItemIds);
    // Reverse auction re-bid overwrites the existing quote in place. A re-bid that attaches nothing
    // KEEPS the documents already on file — the vendor is revising a price, not withdrawing their
    // datasheets, and the bid form seeds itself from those same documents.
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const existing = inv.quotes[0];
        const nextQuote: Quote = {
          ...quote,
          ...(existing?.id ? { id: existing.id } : {}),
          lineDocuments: cleanDocs ?? existing?.lineDocuments,
        };
        return { ...inv, quotes: [nextQuote], status: 'quote_received' };
      }),
    );
  }

  function addNegotiationMessage(inviteId: string, msg: NegotiationMessage) {
    // [RELIABILITY] Guard: do not silently succeed when the target invite is missing.
    // [RELIABILITY] Guard: do not revert status to 'negotiating' if the invite is already 'approved'.
    setInvites((prev) => {
      const target = prev.find((inv) => inv.id === inviteId);
      if (!target) {
        console.error(`[CapexContext] addNegotiationMessage: invite "${inviteId}" not found — message dropped`);
        return prev;
      }
      return prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        // Preserve status if already approved; otherwise advance to negotiating.
        const nextStatus = inv.status === 'approved' ? 'approved' : 'negotiating';
        return { ...inv, negotiationThread: [...inv.negotiationThread, msg], status: nextStatus };
      });
    });
  }

  function approveInvite(inviteId: string) {
    // [DATA INTEGRITY] Guard: only one invite per request may be approved at a time.
    setInvites((prev) => {
      const target = prev.find((inv) => inv.id === inviteId);
      if (!target) {
        console.error(`[CapexContext] approveInvite: invite "${inviteId}" not found`);
        return prev;
      }
      const alreadyApproved = prev.some(
        (inv) => inv.requestId === target.requestId && inv.status === 'approved'
      );
      if (alreadyApproved) {
        console.error(`[CapexContext] approveInvite: a vendor is already approved for request "${target.requestId}" — operation blocked`);
        return prev;
      }
      return prev.map((inv) =>
        inv.id === inviteId ? { ...inv, status: 'approved' } : inv
      );
    });
  }

  function sendChatMessage(msg: ChatMessage) {
    setChatMessages(prev => [...prev, msg]);
  }

  function addRequestComment(requestId: string, comment: RequestComment) {
    setRequests(prev =>
      prev.map(req =>
        req.id === requestId
          ? { ...req, comments: [...(req.comments ?? []), comment] }
          : req
      )
    )
  }

  function addPlant(value: string, _label: string) {
    setPlants((prev) => prev.includes(value) ? prev : [...prev, value]);
  }

  function removePlant(value: string) {
    setPlants((prev) => prev.filter((p) => p !== value));
    setCustomPlants((prev) => prev.filter((p) => p.value !== value));
  }

  function addCategory(name: string) {
    setCategories((prev) => prev.includes(name) ? prev : [...prev, name]);
  }

  function removeCategory(name: string) {
    setCategories((prev) => prev.filter((c) => c !== name));
  }

  // Derived: budget consumed per plant from non-rejected requests
  const usedCrMap = useMemo(() => {
    const map: Record<string, number> = {};
    requests.forEach(req => {
      if (!req.plant || req.status === 'rejected') return;
      map[req.plant] = (map[req.plant] ?? 0) + (req.budget ?? 0);
    });
    return map;
  }, [requests]);

  function getUsedCr(plant: string): number {
    return (usedCrMap[plant] ?? 0) / 1_00_00_000;
  }

  const usedAmountByMasterItemId = useMemo(() => {
    const map: Record<string, number> = {};
    requests.forEach((req) => {
      if (req.status === 'rejected') return;
      // Either/or, mirroring `allocatedForRequest` in kpiUtils. `req.masterItemId` is a copy of the
      // FIRST line's master link and `req.budget` is the WHOLE request total, so counting both
      // would charge every other line's spend against the first line's head as well.
      if (req.masterItemId && !req.lineItems?.length) {
        map[req.masterItemId] = (map[req.masterItemId] ?? 0) + (req.budget ?? 0);
      }
      req.lineItems?.forEach((line) => {
        if (!line.masterItemId) return;
        map[line.masterItemId] = (map[line.masterItemId] ?? 0) + (line.budget ?? 0);
      });
    });
    return map;
  }, [requests]);

  /**
   * Automatic once-a-day capture of the MEASURED stock-metric snapshot (`kpiSnapshots.ts`). This is
   * the ONLY writer of `kpiSnapshots` — there is no exposed mutation, because a caller that could
   * write here could fabricate history.
   *
   * ── The guard, and why `loaded` is the right one ──
   *
   * `loaded` flips to `true` at the end of the initial localStorage-restore effect, in the SAME
   * batched state update that restores `kpiSnapshots`, `capexMaster`, `requests` and `invites`. So
   * when this effect first runs, `prev` inside the updater is the STORED history, not `[]`. That is
   * the property that matters: `mergeSnapshots` keys on (date, field type, plant) and returns only
   * what it is given, so running it against an empty `prev` would persist today's point as the
   * entire history and destroy every earlier day. Gating on `loaded` makes that unreachable.
   *
   * `filesHydrated` — the ref the blob write waits on — is deliberately NOT part of this guard, and
   * it does not need to be. It exists because the in-memory state is LEAN until IndexedDB is read
   * back, so an early `putAllFiles` would overwrite the blob map with `{}`. Two reasons that hazard
   * cannot reach snapshots: (1) nothing measured here comes from a base64 blob — every figure is
   * derived from `capexMaster` / `requests` / `invites` / `usedAmountByMasterItemId`, all of which
   * are fully restored from localStorage by the time `loaded` is true, and stripping base64 changes
   * none of them; (2) the `putAllFiles` call is still guarded by `filesHydrated.current` inside the
   * persist effect, so the state change this effect triggers writes localStorage only, exactly like
   * every other pre-hydration state change already does. Waiting for hydration would add a
   * dependency on IndexedDB being available for a measurement that does not use it.
   *
   * It is ALSO suppressed when `restoreFailed` is set — see that ref: a half-restored load would
   * otherwise be stamped as permanent measured fact, and truncate the history to it.
   *
   * The ref makes this run once per MOUNT (a plain `[loaded]` dep with a `setState` inside would
   * re-fire forever, since `mergeSnapshots` returns a fresh array). "Once per calendar day" is
   * enforced by the `prev.some(...)` check plus `mergeSnapshots`'s same-day replacement, so even a
   * double-invoke (React StrictMode) or several reloads in one day leave exactly one record per
   * scope per day.
   *
   * ── Multi-tab, precisely ──
   *
   * `CapexProvider` also mounts in the `(public)` layout, so a supplier opening a tokenised link
   * captures too, and the cross-tab `storage` listener deliberately does NOT re-sync `kpiSnapshots`
   * (adding it would make that listener's firing condition effectively always-true, changing when
   * `skipNextPersist` is set for a marginal gain). Consequence, stated exactly: a long-lived tab's
   * next persist writes its own `kpiSnapshots` and DOES destroy a day that another tab captured
   * after this tab loaded. Everything present at this tab's load survives, so the outcome is a
   * missing day — a GAP, never a wrong figure — which is precisely what this layer's gap semantics
   * are built to represent honestly.
   */
  const snapshotCapturedRef = useRef(false);
  useEffect(() => {
    if (!loaded || snapshotCapturedRef.current || restoreFailed.current) return;
    snapshotCapturedRef.current = true;
    const now = Date.now();
    const today = snapshotDateKey(now);
    setKpiSnapshots((prev) => {
      // Already measured today → return the SAME array so no re-render and no re-persist happens.
      if (prev.some((s) => s.date === today)) return prev;
      const todays = buildSnapshots({
        capexMaster,
        requests,
        invites,
        headOverrides: brownFieldHeadAllocations,
        usedAmountByMasterItemId,
        now,
      });
      // Nothing budgeted anywhere yet (clean slate) → nothing to measure. Writing an empty pass
      // would be a no-op anyway; returning `prev` keeps it a true no-op.
      if (!todays.length) return prev;
      return mergeSnapshots(prev, todays, now);
    });
    // Intentionally keyed on `loaded` alone: this is a once-per-load capture of the state as it was
    // restored, not a live subscription that should re-measure on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  function setAuctionConfig(requestId: string, config: AuctionConfig) {
    setRequests((prev) =>
      prev.map((req) => {
        if (req.id !== requestId) return req;
        // Seed the opening "price to beat" = current best price × 0.95 (rounded), unless the caller
        // already supplied one. The current best comes from the seeded opening bids / RFQ quotes.
        let openingBestPrice = config.openingBestPrice;
        if (openingBestPrice == null) {
          const reqInvites = invites.filter((i) => i.requestId === requestId);
          // Compare on an INR basis so a foreign-currency quote isn't mistaken for the lowest.
          const prices: number[] = [];
          for (const inv of reqInvites) {
            const oq = inv.quotes[inv.quotes.length - 1] ?? inv.openingQuote;
            if (oq) prices.push(toInr(oq.price + (oq.freight ?? 0) + (oq.packing ?? 0) + (oq.service ?? 0), oq.currency));
            else if (inv.rfqQuote) prices.push(toInr(rfqTotal(inv.rfqQuote, req.lineItems), inv.rfqQuote.currency));
          }
          if (prices.length) openingBestPrice = Math.round(Math.min(...prices) * 0.95);
        }
        return { ...req, auctionConfig: { ...config, openingBestPrice } };
      }),
    );
  }

  function updateMasterItem(id: string, updates: Partial<CapexMasterItem>) {
    setCapexMaster(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  }

  function addMasterItem(item: CapexMasterItem) {
    setCapexMaster(prev => [...prev, item]);
  }

  function addMasterHead(head: string) {
    const trimmed = head.trim();
    if (!trimmed) return;
    setMasterHeads(prev => prev.includes(trimmed) ? prev : [...prev, trimmed]);
  }

  function addCustomPlant(meta: PlantMeta) {
    setCustomPlants(prev => prev.some(p => p.value === meta.value) ? prev : [...prev, meta]);
    setPlants(prev => prev.includes(meta.value) ? prev : [...prev, meta.value]);
  }

  function createGreenFieldPlant(creation: GreenFieldPlantCreation) {
    const meta: PlantMeta = {
      value: creation.plantValue,
      label: creation.plantLabel,
      state: creation.state,
      assignedUser: creation.assignedUser,
      greenFieldPlant: true,
      greenFieldFy: creation.fy,
    };
    addCustomPlant(meta);
    if (creation.budgetCr != null && creation.budgetCr > 0) {
      setGreenFieldPlantBudget(
        creation.plantValue,
        creation.fy,
        creation.projectType,
        creation.budgetCr,
      );
    }
  }

  function setGreenFieldPlantBudget(
    plant: string,
    fy: string,
    projectType: ProjectType,
    budgetCr: number,
  ) {
    if (budgetCr < 0 || !plant || !fy) return;
    setGreenFieldBudgetAllocations((prev) => {
      const rest = prev.plantBudgets.filter(
        (b) => !(b.plant === plant && b.fy === fy && b.projectType === projectType),
      );
      return {
        ...prev,
        plantBudgets: [...rest, { plant, fy, projectType, budgetCr }],
      };
    });
  }

  function setGreenFieldSectionBudget(
    plant: string,
    fy: string,
    projectType: ProjectType,
    division: string,
    budgetCr: number,
  ) {
    if (budgetCr < 0 || !plant || !fy || !division) return;
    setGreenFieldBudgetAllocations((prev) => {
      const rest = prev.sectionBudgets.filter(
        (b) =>
          !(
            b.plant === plant &&
            b.fy === fy &&
            b.projectType === projectType &&
            b.division === division
          ),
      );
      return {
        ...prev,
        sectionBudgets: [...rest, { plant, fy, projectType, division, budgetCr }],
      };
    });
  }

  function setGreenFieldHeadBudget(
    plant: string,
    fy: string,
    projectType: ProjectType,
    division: string,
    head: string,
    budgetCr: number,
  ) {
    if (budgetCr < 0 || !plant || !fy || !division || !head) return;
    setGreenFieldBudgetAllocations((prev) => {
      const rest = prev.headBudgets.filter(
        (b) =>
          !(
            b.plant === plant &&
            b.fy === fy &&
            b.projectType === projectType &&
            b.division === division &&
            b.head === head
          ),
      );
      return {
        ...prev,
        headBudgets: [...rest, { plant, fy, projectType, division, head, budgetCr }],
      };
    });
  }

  function renameMasterHead(oldHead: string, newHead: string) {
    const trimmed = newHead.trim();
    if (!trimmed || trimmed === oldHead) return;
    setMasterHeads(prev => prev.map(h => h === oldHead ? trimmed : h));
    setCapexMaster(prev => prev.map(item => item.head === oldHead ? { ...item, head: trimmed } : item));
    setGreenFieldBudgetAllocations((prev) => ({
      ...prev,
      headBudgets: prev.headBudgets.map((b) =>
        b.head === oldHead ? { ...b, head: trimmed } : b,
      ),
    }));
  }

  function removeMasterHead(head: string) {
    setMasterHeads(prev => prev.filter(h => h !== head));
    setCapexMaster(prev => prev.map(item => item.head === head ? { ...item, head: 'Misc.' } : item));
  }

  function cloneMasterForFY(newFy: string) {
    const latestFy = capexMaster.length
      ? capexMaster.slice().sort((a, b) => b.fy.localeCompare(a.fy))[0].fy
      : null;
    const sourceItems = latestFy ? capexMaster.filter(i => i.fy === latestFy) : capexMaster;
    const cloned = sourceItems.map(item => ({
      ...item,
      id: `cm-${crypto.randomUUID()}`,
      fy: newFy,
    }));
    setCapexMaster(prev => [...prev, ...cloned]);
    if (latestFy) {
      setGreenFieldBudgetAllocations((prev) => ({
        plantBudgets: [
          ...prev.plantBudgets,
          ...prev.plantBudgets
            .filter((b) => b.fy === latestFy)
            .map((b) => ({ ...b, fy: newFy })),
        ],
        sectionBudgets: [
          ...prev.sectionBudgets,
          ...prev.sectionBudgets
            .filter((b) => b.fy === latestFy)
            .map((b) => ({ ...b, fy: newFy })),
        ],
        headBudgets: [
          ...prev.headBudgets,
          ...prev.headBudgets
            .filter((b) => b.fy === latestFy)
            .map((b) => ({ ...b, fy: newFy })),
        ],
      }));
    }
  }

  // ── Next-FY Brown Field budget proposals ──
  function createBudgetProposal(proposal: BudgetProposal) {
    setBudgetProposals((prev) => dedupeById([...prev, proposal]));
  }

  function updateBudgetProposal(id: string, updates: Partial<BudgetProposal>) {
    setBudgetProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    );
  }

  function submitBudgetProposal(id: string) {
    const now = new Date().toISOString();
    setBudgetProposals((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (p.status !== 'draft' && p.status !== 'needs_correction' && p.status !== 'rejected') return p;
        const wasRework = p.status === 'needs_correction' || p.status === 'rejected';
        return {
          ...p,
          // Every (re)submit RESTARTS from the plant head — mint/rotate the approval link token.
          status: 'pending_plant_head',
          submittedAt: now,
          approvalToken: generateApprovalToken('budget', p.id),
          // A fresh cycle invalidates any previously issued Global-Accounts link.
          accountsToken: undefined,
          resubmitCount: (p.resubmitCount ?? 0) + (wasRework ? 1 : 0),
          // Clear ALL prior-stage decisions/notes on (re)submit so a fresh cycle starts clean.
          correctionNote: undefined,
          edits: undefined,
          plantHeadDecidedAt: undefined,
          plantHeadDecidedBy: undefined,
          adminDecidedAt: undefined,
          adminDecidedBy: undefined,
          accountsDecidedAt: undefined,
          accountsDecidedBy: undefined,
          decidedAt: undefined,
          decidedBy: undefined,
          decisionNote: undefined,
          publishedAt: undefined,
        };
      }),
    );
  }

  /**
   * Plant-head budget decision (public email link, no role): approve → admin; reject → rejected;
   * needs_correction → back to the author with a remark (and optional edited line items).
   *
   * On **approve** the plant head may pass `editedItems` — they adjust the lines and send the
   * proposal FORWARD carrying those edits (the edit is recorded on `proposal.edits`).
   */
  function decideBudgetPlantHead(
    id: string,
    decision: 'approved' | 'rejected' | 'needs_correction',
    note?: string,
    editedItems?: BudgetProposalItem[],
  ) {
    const now = new Date().toISOString();
    setBudgetProposals((prev) =>
      prev.map((p) => {
        if (p.id !== id || p.status !== 'pending_plant_head') return p;
        // One remark per decision, on every branch — the admin who picks this up next reads the
        // plant head's reasoning, not just a status that changed.
        const remarks = remarkPatch(
          p.approvalRemarks,
          buildApprovalRemark({
            stage: 'plant_head_budget',
            action:
              decision === 'approved'
                ? editedItems?.length ? 'forwarded' : 'approved'
                : decision === 'needs_correction' ? 'sent_back' : 'rejected',
            by: 'Plant Head',
            text: note,
            at: now,
          }),
        );
        if (decision === 'approved') {
          return {
            ...applyApproverEdit(p, editedItems, 'plant_head', 'Plant Head', now, note),
            status: 'pending_admin',
            plantHeadDecidedAt: now,
            plantHeadDecidedBy: 'Plant Head',
            ...remarks,
          };
        }
        if (decision === 'needs_correction') {
          return {
            ...p,
            status: 'needs_correction',
            plantHeadDecidedAt: now,
            plantHeadDecidedBy: 'Plant Head',
            correctionNote: note,
            ...(editedItems ? { items: editedItems } : {}),
            ...remarks,
          };
        }
        return {
          ...p,
          status: 'rejected',
          plantHeadDecidedAt: now,
          plantHeadDecidedBy: 'Plant Head',
          decisionNote: note ?? 'Rejected by plant head',
          ...remarks,
        };
      }),
    );
  }

  /**
   * Super-admin budget decision. approve → forwards to Global Accounts (NO publish yet);
   * needs_correction → back to the author with a remark (and optional edited line items); reject → rejected.
   *
   * On **approve** the admin may pass `editedItems` — they adjust the lines and send the proposal
   * FORWARD carrying those edits (recorded on `proposal.edits`), rather than bouncing it back.
   */
  /**
   * Takes the proposal BY VALUE, not by id. The editor saves and publishes in the same click, so an
   * id lookup here would read the pre-save copy of the proposal under React batching and publish
   * stale (often empty) line items. The caller owns the current draft; this owns the write.
   */
  /**
   * Write an APPROVED proposal into the live master. This is the ONLY path from a proposal to a
   * live budget — every field type reaches it through the same chain (Plant Head → Admin → Global
   * Accounts), so no author can put a figure in front of a buyer without an approver.
   *
   * Green Field does two things Brown Field does not:
   *  - it REPLACES its `plant + FY + projectType` scope rather than appending, so a corrected
   *    re-publish cannot leave the old lines beside the new ones and double the plant's budget;
   *  - it writes the plant / section / head envelopes, without which every Green Field screen
   *    renders the plant as having no allocation at all.
   */
  function publishProposalToMaster(target: BudgetProposal) {
    const isGreenField = proposalFieldType(target) === 'green_field';
    const newRows = buildMasterItemsFromProposal(target);

    setCapexMaster((prev) => {
      if (!isGreenField) return [...prev, ...newRows];
      const rest = prev.filter(
        (m) =>
          !(
            (m.fieldType ?? 'brown_field') === 'green_field' &&
            m.plant === target.plant &&
            m.fy === target.targetFy &&
            resolveProjectType(m) === target.projectType
          ),
      );
      return [...rest, ...newRows];
    });

    if (!isGreenField) return;
    const allocations = buildGreenFieldAllocationsFromProposal(target);
    setGreenFieldBudgetAllocations((prev) => {
      const sameScope = (b: { plant: string; fy: string; projectType: ProjectType }) =>
        b.plant === target.plant && b.fy === target.targetFy && b.projectType === target.projectType;
      return {
        plantBudgets: [...prev.plantBudgets.filter((b) => !sameScope(b)), ...allocations.plantBudgets],
        sectionBudgets: [...prev.sectionBudgets.filter((b) => !sameScope(b)), ...allocations.sectionBudgets],
        headBudgets: [...prev.headBudgets.filter((b) => !sameScope(b)), ...allocations.headBudgets],
      };
    });
  }

  function decideBudgetProposal(
    id: string,
    decision: 'approved' | 'rejected' | 'needs_correction',
    actor: string,
    note?: string,
    editedItems?: BudgetProposalItem[],
  ) {
    const now = new Date().toISOString();
    setBudgetProposals((prev) =>
      prev.map((p) => {
        // Guard: only an admin-pending proposal can be decided at this stage.
        if (p.id !== id || p.status !== 'pending_admin') return p;
        const remarks = remarkPatch(
          p.approvalRemarks,
          buildApprovalRemark({
            stage: 'admin_budget',
            action:
              decision === 'approved'
                ? editedItems?.length ? 'forwarded' : 'approved'
                : decision === 'needs_correction' ? 'sent_back' : 'rejected',
            by: ROLE_NAMES[actor] ?? actor,
            text: note,
            at: now,
          }),
        );
        if (decision === 'approved') {
          return {
            ...applyApproverEdit(p, editedItems, 'admin', ROLE_NAMES[actor] ?? actor, now, note),
            status: 'pending_accounts',
            adminDecidedAt: now,
            adminDecidedBy: actor,
            // Mint the public Global-Accounts sign-off link (they have no portal login).
            accountsToken: generateApprovalToken('budget_accounts', p.id),
            ...remarks,
          };
        }
        if (decision === 'needs_correction') {
          return {
            ...p,
            status: 'needs_correction',
            adminDecidedAt: now,
            adminDecidedBy: actor,
            accountsToken: undefined,
            correctionNote: note,
            ...(editedItems ? { items: editedItems } : {}),
            ...remarks,
          };
        }
        return {
          ...p,
          status: 'rejected',
          adminDecidedAt: now,
          adminDecidedBy: actor,
          decisionNote: note,
          accountsToken: undefined,
          ...remarks,
        };
      }),
    );
  }

  /**
   * Global-accounts budget decision (final gate). approve → publishes the proposal's rows as a new
   * live FY in the master (double-publish guarded by the pending_accounts precondition); reject → rejected.
   */
  function decideBudgetAccounts(
    id: string,
    decision: 'approved' | 'rejected',
    actor: string,
    note?: string,
  ) {
    const now = new Date().toISOString();
    // Resolve + guard from CURRENT state before mutating, so publishing to master never depends on the
    // setState updater having run first (avoids a silently-missed publish under React batching).
    const target = budgetProposals.find((p) => p.id === id);
    if (!target || target.status !== 'pending_accounts') return;
    setBudgetProposals((prev) =>
      prev.map((p) =>
        p.id === id && p.status === 'pending_accounts'
          ? {
              ...p,
              status: decision === 'approved' ? 'approved' : 'rejected',
              accountsDecidedAt: now,
              accountsDecidedBy: actor,
              decidedAt: now,
              decidedBy: actor,
              decisionNote: note ?? p.decisionNote,
              ...remarkPatch(
                p.approvalRemarks,
                buildApprovalRemark({
                  stage: 'accounts_budget',
                  action: decision === 'approved' ? 'approved' : 'rejected',
                  by: actor,
                  text: note,
                  at: now,
                }),
              ),
              publishedAt: decision === 'approved' ? now : p.publishedAt,
              // Burn the public link so a stale email cannot re-decide.
              accountsToken: undefined,
            }
          : p,
      ),
    );
    if (decision === 'approved') {
      publishProposalToMaster(target);
    }
  }

  /**
   * Plant-head request approval (public email link, no role): approve → sourcing; reject → rejected.
   *
   * `note` is the plant head's remark. It is recorded on the request's remark trail for BOTH
   * outcomes — an approval that came with a condition attached is exactly as worth reading as a
   * rejection — and, on a rejection, it also becomes the `rejectionReason` the requester sees, so
   * the reason is never the generic placeholder when a real one was typed.
   */
  function decideRequestPlantHead(requestId: string, decision: 'approved' | 'rejected', note?: string) {
    const req = requests.find((r) => r.id === requestId);
    if (!req || req.status !== 'pending_head_approval') return;
    const now = new Date().toISOString();
    const remark = buildApprovalRemark({
      stage: 'plant_head_request',
      action: decision === 'approved' ? 'approved' : 'rejected',
      by: PLANT_HEAD_ACTOR,
      text: note,
      at: now,
    });
    const remarks = remarkPatch(req.approvalRemarks, remark);
    if (decision === 'approved') {
      updateRequest(requestId, { status: 'sourcing', plantHeadDecidedAt: now, ...remarks }, PLANT_HEAD_ACTOR);
    } else {
      updateRequest(
        requestId,
        {
          status: 'rejected',
          plantHeadDecidedAt: now,
          rejectionReason: remark?.text ?? 'Rejected by plant head',
          ...remarks,
        },
        PLANT_HEAD_ACTOR,
      );
    }
  }

  // ── Trials (optional QA gate before final payment) ──
  function setTrialRequired(requestId: string, required: boolean, inviteId?: string) {
    const nextStatus = (cur?: TrialStatus): TrialStatus =>
      required ? (cur && cur !== 'not_required' ? cur : 'pending_upload') : 'not_required';
    if (inviteId) {
      setInvites((prev) =>
        prev.map((i) => (i.id === inviteId ? { ...i, trialRequired: required, trialStatus: nextStatus(i.trialStatus) } : i)),
      );
      return;
    }
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, trialRequired: required, trialStatus: nextStatus(r.trialStatus) } : r)),
    );
  }

  /** Vendor uploads a trial asset (video/photo/report) → sourcing review. */
  function submitTrial(inviteId: string, submission: TrialSubmission) {
    const now = new Date().toISOString();
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite) return;
    // Precondition: a trial must be required and awaiting the vendor's upload (or previously rejected).
    const entity = invite.awarded ? invite : requests.find((r) => r.id === invite.requestId);
    const curStatus = entity?.trialStatus;
    if (!entity?.trialRequired || (curStatus !== 'pending_upload' && curStatus !== 'rejected')) return;
    const sub: TrialSubmission = { ...submission, uploadedAt: submission.uploadedAt || now, submittedByVendor: true };
    const threadEntry: TrialMessage = {
      id: `trial-${Date.now()}`,
      by: 'vendor',
      senderName: 'Vendor',
      action: 'submitted',
      submission: { ...sub, base64: '' }, // metadata-only in the thread (base64 lives on trialSubmission)
      message: sub.note,
      at: now,
    };
    // Award tracks own their trial on the invite; single-vendor/RFQ trials live on the request.
    if (invite.awarded) {
      setInvites((prev) =>
        prev.map((i) =>
          i.id === inviteId
            ? { ...i, trialSubmission: sub, trialStatus: 'pending_review', trialThread: [...(i.trialThread ?? []), threadEntry] }
            : i,
        ),
      );
    } else {
      setRequests((prev) =>
        prev.map((r) =>
          r.id === invite.requestId
            ? { ...r, trialSubmission: sub, trialStatus: 'pending_review', trialThread: [...(r.trialThread ?? []), threadEntry] }
            : r,
        ),
      );
    }
  }

  /** Sourcing approves/rejects a trial (only when in review). reject → 'rejected' (vendor re-uploads). */
  function respondToTrial(requestId: string, response: 'approved' | 'rejected', inviteId?: string, message?: string) {
    const now = new Date().toISOString();
    // Precondition: only act on a trial that is currently under review.
    const entity = inviteId ? invites.find((i) => i.id === inviteId) : requests.find((r) => r.id === requestId);
    if (entity?.trialStatus !== 'pending_review') return;
    const threadEntry: TrialMessage = {
      id: `trial-${Date.now()}`,
      by: 'sourcing',
      senderName: 'Sourcing',
      action: response,
      message,
      at: now,
    };
    const nextStatus: TrialStatus = response === 'approved' ? 'approved' : 'rejected';
    if (inviteId) {
      setInvites((prev) =>
        prev.map((i) => (i.id === inviteId ? { ...i, trialStatus: nextStatus, trialThread: [...(i.trialThread ?? []), threadEntry] } : i)),
      );
      return;
    }
    setRequests((prev) =>
      prev.map((r) => (r.id === requestId ? { ...r, trialStatus: nextStatus, trialThread: [...(r.trialThread ?? []), threadEntry] } : r)),
    );
  }

  /** Vendor re-uploads the PI after the PO is issued (keeps payments in progress). */
  function resubmitProformaInvoice(inviteId: string, pi: ProformaInvoice) {
    const now = new Date().toISOString();
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite) return;
    setInvites((prev) =>
      prev.map((i) =>
        i.id === inviteId
          ? { ...i, proformaInvoice: { ...pi, uploadedAt: pi.uploadedAt || now, submittedByVendor: true }, piReuploadAllowed: false }
          : i,
      ),
    );
    if (!invite.awarded) {
      setRequests((prev) => prev.map((r) => (r.id === invite.requestId ? { ...r, piReuploadAllowed: false } : r)));
    }
  }

  // ── Adhoc head→head budget reallocation (Brown Field, admin-approved) ──
  function createAdhocBudgetRequest(req: AdhocBudgetRequest) {
    setAdhocBudgetRequests((prev) => dedupeById([...prev, req]));
  }

  function upsertBrownFieldHeadBudget(
    prev: BrownFieldHeadBudget[],
    plant: string,
    fy: string,
    projectType: ProjectType,
    head: string,
    budgetCr: number,
  ): BrownFieldHeadBudget[] {
    const rest = prev.filter(
      (b) =>
        !(
          b.plant === plant &&
          b.fy === fy &&
          b.projectType === projectType &&
          b.division === FLAT_MASTER_DIVISION &&
          b.head === head
        ),
    );
    return [...rest, { plant, fy, projectType, division: FLAT_MASTER_DIVISION, head, budgetCr }];
  }

  function decideAdhocBudgetRequest(
    id: string,
    decision: 'approved' | 'rejected',
    actor: string,
    note?: string,
  ) {
    const now = new Date().toISOString();
    const req = adhocBudgetRequests.find((r) => r.id === id);
    setAdhocBudgetRequests((prev) =>
      prev.map((r) =>
        r.id === id && r.status === 'pending_admin'
          ? { ...r, status: decision, decidedAt: now, decidedBy: actor, decisionNote: note }
          : r,
      ),
    );
    // On approval, move the amount from the source head allocation to the destination head.
    if (req && req.status === 'pending_admin' && decision === 'approved') {
      setBrownFieldHeadAllocations((prev) => {
        const fromCurrent = effectiveHeadAllocationCr(
          capexMaster, prev, req.plant, req.fy, req.projectType, req.fromHead,
        );
        const toCurrent = effectiveHeadAllocationCr(
          capexMaster, prev, req.plant, req.fy, req.projectType, req.toHead,
        );
        let next = upsertBrownFieldHeadBudget(prev, req.plant, req.fy, req.projectType, req.fromHead, fromCurrent - req.amountCr);
        next = upsertBrownFieldHeadBudget(next, req.plant, req.fy, req.projectType, req.toHead, toCurrent + req.amountCr);
        return next;
      });
    }
  }

  /**
   * Nuclear reset. `localStorage.clear()` takes the whole `capex_data_v2` payload, so `kpiSnapshots`
   * goes with it — the measured history does NOT survive a reset, and the shape is simply re-created
   * empty on the next load, where the daily capture writes a fresh first point. `measuredFrom` will
   * then report that day, so the dashboards say "measured from <reset date>" rather than implying a
   * history they no longer have. Nothing needs adding here; this comment exists so the interaction is
   * explicit rather than incidental.
   */
  function resetData() {
    localStorage.clear();
    window.location.replace('/login');
  }

  return (
    <CapexContext.Provider
      value={{
        loaded,
        requests,
        vendors,
        invites,
        chatMessages,
        sendChatMessage,
        plants,
        categories,
        capexMaster,
        usedCrMap,
        getUsedCr,
        usedAmountByMasterItemId,
        kpiSnapshots,
        setAuctionConfig,
        addRequest,
        updateRequest,
        addVendor,
        addInvite,
        inviteVendors,
        updateInvite,
        submitQuote,
        addNegotiationMessage,
        approveInvite,
        addRequestComment,
        addPlant,
        removePlant,
        addCategory,
        removeCategory,
        updateMasterItem,
        addMasterItem,
        cloneMasterForFY,
        masterHeads,
        addMasterHead,
        renameMasterHead,
        removeMasterHead,
        customPlants,
        addCustomPlant,
        createGreenFieldPlant,
        greenFieldBudgetAllocations,
        setGreenFieldPlantBudget,
        setGreenFieldSectionBudget,
        setGreenFieldHeadBudget,
        resetData,
        budgetProposals,
        createBudgetProposal,
        updateBudgetProposal,
        submitBudgetProposal,
        decideBudgetProposal,
        decideBudgetPlantHead,
        decideBudgetAccounts,
        decideRequestPlantHead,
        setTrialRequired,
        submitTrial,
        respondToTrial,
        resubmitProformaInvoice,
        adhocBudgetRequests,
        brownFieldHeadAllocations,
        createAdhocBudgetRequest,
        decideAdhocBudgetRequest,
        saveAuctionApprovalDocument,
        sendAuctionApprovalToVendors,
        respondToAuctionApproval,
        sendAuctionApprovalReminder,
        excludeVendorFromAuction,
        setSourcingMode,
        clearSourcingMode,
        proposeRfqQuote,
        respondToRfqQuote,
        reopenRfqQuote,
        setRfqFinalVendor,
        setLineHsn,
        seedAuctionFromRfq,
        inviteNewVendor,
        proposeIncoTerms,
        respondToIncoTerms,
        requestProformaInvoice,
        saveTechSpecDraft,
        sendTechSpecForApproval,
        decideTechSpec,
        submitProformaInvoice,
        finalizeSplitAward,
        awardAndRequestPi,
        sendDocApprovalPackage,
        resendDocApprovalPackage,
        respondToDocApproval,
        assignFaCode,
        submitFaCodes,
        createPurchaseOrder,
        submitPurchaseOrder,
        issuePurchaseOrder,
        markPaymentMade,
      }}
    >
      {children}
    </CapexContext.Provider>
  );
}

export function useCapex(): CapexContextValue {
  const ctx = useContext(CapexContext);
  if (!ctx) throw new Error('useCapex must be used within a CapexProvider');
  return ctx;
}
