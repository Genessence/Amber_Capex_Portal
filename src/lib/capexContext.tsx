'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import {
  AdhocBudgetRequest,
  AuctionApprovalDocument,
  AuctionConfig,
  BudgetProposal,
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
  PaymentMilestone,
  PlantMeta,
  ProformaInvoice,
  ProjectType,
  PurchaseOrder,
  Quote,
  RequestComment,
  RfqPriceMessage,
  RfqQuote,
  SourcingDecision,
  Vendor,
  VendorInvite,
} from './types';
import { buildMasterItemsFromProposal } from './budgetProposalUtils';
import { buildDocApprovalPackage, effectiveDocApprovalStatus } from './docPackageUtils';
import { buildAwardGroups, deriveRequestStatus, isAwardBased, awardedInvites } from './paymentUtils';
import { effectiveRfqStatus, rfqTotal } from './rfqUtils';
import { buildBlankIncoTermsDoc, effectiveIncoTermsStatus } from './incoTermsUtils';
import { getAllFiles, putAllFiles, type FileMap } from './fileStore';
import { effectiveHeadAllocationCr } from './adhocBudgetUtils';
import { FLAT_MASTER_DIVISION } from './greenFieldConstants';
import { mockCapexMaster, mockInvites, mockRequests, mockVendors } from './mockData';
import { PLANTS } from './constants';
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

const ALLOWED_TRANSITIONS: Record<CapexStatus, CapexStatus[]> = {
  draft:                  ['submitted'],
  submitted:              ['pending_head_approval', 'sourcing'],
  pending_head_approval:  ['sourcing', 'rejected'],
  // RFQ + auction converge into the fulfillment chain directly from sourcing
  // (auction now mirrors RFQ: finalize winner → request PI, no buyer-approval detour)
  sourcing:               ['negotiation', 'sourcing_approved', 'pi_requested'],
  // pi_requested targets below cover legacy/in-flight auction requests parked at
  // negotiation / sourcing_approved / buyer_approved before the buyer step was dropped
  negotiation:            ['sourcing_approved', 'pi_requested', 'rejected'],
  sourcing_approved:      ['buyer_approved', 'pi_requested', 'rejected'],
  buyer_approved:         ['pi_requested'],
  // Shared Brown Field fulfillment chain: PI → accounts/PO → payments → completed.
  // `pi_requested → completed` covers award-based (split-auction) requests, whose granular
  // fulfillment is tracked per-award on the invites while the request status stays coarse
  // (pi_requested) until every award completes.
  pi_requested:           ['pi_submitted', 'completed', 'rejected'],
  pi_submitted:           ['accounts_processing', 'rejected'],
  accounts_processing:    ['payment_in_progress', 'rejected'],
  payment_in_progress:    ['completed'],
  completed:              [],
  rejected:               [],
};

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
  setAuctionConfig: (requestId: string, config: AuctionConfig) => void;
  addRequest: (req: CapexRequest) => void;
  updateRequest: (id: string, updates: Partial<CapexRequest>, actor?: string) => void;
  addVendor: (vendor: Vendor) => void;
  addInvite: (invite: VendorInvite) => void;
  inviteVendors: (requestId: string, vendorIds: string[]) => void;
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
  decideBudgetProposal: (
    id: string,
    decision: 'approved' | 'rejected',
    actor: string,
    note?: string,
  ) => void;
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
  /** Either side proposes/revises/counters the full quotation. */
  proposeRfqQuote: (
    inviteId: string,
    quote: RfqQuote,
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
  ) => void;
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
  inviteNewVendor: (requestId: string, info: { name: string; email: string; phone: string }, senderName: string) => void;
  /** INCO Terms negotiation: vendor fills/counters or sourcing edits & resends. */
  proposeIncoTerms: (inviteId: string, doc: IncoTermsDoc, by: 'sourcing' | 'vendor', senderName: string, message?: string) => void;
  respondToIncoTerms: (inviteId: string, response: 'approved' | 'rejected', by: 'sourcing' | 'vendor', senderName: string, message?: string) => void;
  requestProformaInvoice: (requestId: string, vendorId: string, actor: string) => void;
  submitProformaInvoice: (inviteId: string, pi: ProformaInvoice) => void;
  // ── Split award (reverse auction): finalize per-line vendor selections into per-vendor awards ──
  finalizeSplitAward: (requestId: string, decision?: SourcingDecision) => void;
  // ── Document-approval package (PBG + DLC + one-time payment terms) ──
  sendDocApprovalPackage: (requestId: string, vendorIds: string[]) => void;
  resendDocApprovalPackage: (inviteId: string, note?: string) => void;
  respondToDocApproval: (inviteId: string, response: 'approved' | 'rejected') => void;
  // ── Accounts: FA codes (plant), PO + upload + issue (global), payment milestones ──
  // The optional inviteId targets a single AWARD (split-auction); omit for single-vendor requests.
  assignFaCode: (requestId: string, lineItemId: string, code: string, inviteId?: string) => void;
  submitFaCodes: (requestId: string, actor: string, inviteId?: string) => void;
  createPurchaseOrder: (requestId: string, po: PurchaseOrder, milestones: PaymentMilestone[]) => void;
  submitPurchaseOrder: (requestId: string, actor: string) => void;
  issuePurchaseOrder: (requestId: string, po: PurchaseOrder, milestones: PaymentMilestone[], actor: string, inviteId?: string) => void;
  markPaymentMade: (requestId: string, milestoneId: string, actor: string, inviteId?: string) => void;
}

const CapexContext = createContext<CapexContextValue | null>(null);

function normalizeRequest(req: CapexRequest): CapexRequest {
  const fieldType = req.fieldType ?? 'brown_field';
  const projectType = resolveProjectType(req);
  return {
    ...req,
    fieldType,
    projectType,
    greenFieldProjectType: projectType,
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

function normalizeInvite(inv: VendorInvite): VendorInvite {
  return { ...inv, auctionApprovalStatus: inv.auctionApprovalStatus ?? 'not_sent' };
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
function sanitizeRfqQuote(quote: RfqQuote): RfqQuote | null {
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
    deliveryWeeks: nonNeg(quote.deliveryWeeks),
    warranty: nonNeg(quote.warranty),
    currency: typeof quote.currency === 'string' ? quote.currency : undefined,
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
    if (req.purchaseOrder?.poDocumentBase64) {
      files[`po:${req.id}`] = req.purchaseOrder.poDocumentBase64;
      r = { ...r, purchaseOrder: { ...req.purchaseOrder, poDocumentBase64: undefined } };
    }
    return r;
  });
}
function stripInviteFiles(invites: VendorInvite[], files: FileMap): VendorInvite[] {
  return invites.map((inv) => {
    let v = inv;
    if (inv.proformaInvoice?.base64) {
      files[`pi:${inv.id}`] = inv.proformaInvoice.base64;
      v = { ...v, proformaInvoice: { ...inv.proformaInvoice, base64: '' } };
    }
    if (inv.quotes?.some((q) => q.attachmentBase64)) {
      v = {
        ...v,
        quotes: inv.quotes.map((q) => {
          if (q.attachmentBase64) {
            files[`q-att:${q.id}`] = q.attachmentBase64;
            return { ...q, attachmentBase64: undefined };
          }
          return q;
        }),
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
      const f = files[`po:${req.id}`];
      if (f) r = { ...r, purchaseOrder: { ...req.purchaseOrder, poDocumentBase64: f } };
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
          return f ? { ...q, attachmentBase64: f } : q;
        }),
      };
    }
    return v;
  });
}

const greenFieldSeedMaster = mockCapexMaster.filter(
  (item) => (item.fieldType ?? 'brown_field') === 'green_field',
);

/** Merge stored master with seeds; replaces Brown Field once per seed version. */
function mergeCapexMasterOnLoad(
  storedMaster: CapexMasterItem[],
  brownfieldSeedVersion: string | undefined,
): CapexMasterItem[] {
  const brownFieldSeeds = brownFieldSeedData.map(normalizeMasterItem);
  const greenFieldSeeds = greenFieldSeedMaster.map(normalizeMasterItem);

  if (!storedMaster.length) {
    return applyMasterMigrations(mockCapexMaster.map(normalizeMasterItem), undefined, undefined, undefined, undefined);
  }

  if (brownfieldSeedVersion !== BROWNFIELD_SEED_VERSION) {
    const storedGreen = storedMaster.filter(
      (item) => (item.fieldType ?? 'brown_field') === 'green_field',
    );
    const existingGreenKeys = new Set(storedGreen.map(getMasterBackfillKey));
    const missingGreenSeeds = greenFieldSeeds.filter(
      (seed) => !existingGreenKeys.has(getMasterBackfillKey(seed)),
    );
    return [...storedGreen, ...missingGreenSeeds, ...brownFieldSeeds];
  }

  const existingKeys = new Set(storedMaster.map(getMasterBackfillKey));
  const missingGreenSeeds = greenFieldSeeds.filter(
    (seed) => !existingKeys.has(getMasterBackfillKey(seed)),
  );
  return [...storedMaster, ...missingGreenSeeds];
}


export function initialStatusForRequest(_budget?: number, fieldType: FieldType = 'brown_field'): CapexStatus {
  if (
    fieldType === 'green_field' ||
    fieldType === 'digitisation' ||
    fieldType === 'information_technology'
  ) {
    return 'sourcing';
  }
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
  const [digitisationMigrationVersion, setDigitisationMigrationVersion] =
    useState(DIGITISATION_MIGRATION_V1);
  const [flatMasterMigrationVersion, setFlatMasterMigrationVersion] =
    useState(FLAT_MASTER_MIGRATION_V1);
  const [greenFieldSectionMigrationVersion, setGreenFieldSectionMigrationVersion] =
    useState(GREEN_FIELD_SECTION_MIGRATION_V1);
  const [brownFieldNestedMigrationVersion, setBrownFieldNestedMigrationVersion] =
    useState(BROWN_FIELD_NESTED_MIGRATION_V1);
  const [greenFieldBudgetAllocations, setGreenFieldBudgetAllocations] =
    useState<GreenFieldBudgetAllocations>({ plantBudgets: [], sectionBudgets: [], headBudgets: [] });
  const [budgetProposals, setBudgetProposals] = useState<BudgetProposal[]>([]);
  const [adhocBudgetRequests, setAdhocBudgetRequests] = useState<AdhocBudgetRequest[]>([]);
  const [brownFieldHeadAllocations, setBrownFieldHeadAllocations] = useState<BrownFieldHeadBudget[]>([]);
  // Prevents the persist effect from writing back to localStorage when invites
  // were just read FROM localStorage (storage event path). Writing back would
  // trigger the other tab's storage listener, creating an infinite ping-pong.
  const skipNextPersist = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const storedRequests = dedupeById<CapexRequest>(parsed.requests ?? []);
        const storedVendors = dedupeById<Vendor>(parsed.vendors ?? []);
        const storedInvites = dedupeById<VendorInvite>(parsed.invites ?? []);
        setRequests(
          storedRequests.length
            ? storedRequests.map(normalizeRequest)
            : mockRequests.map(normalizeRequest),
        );
        setVendors(storedVendors.length ? storedVendors : mockVendors);
        setInvites(
          (storedInvites.length ? storedInvites : mockInvites).map(normalizeInvite)
        );
        if (parsed.chatMessages?.length) setChatMessages(parsed.chatMessages);
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
            mergeCapexMasterOnLoad(storedMaster, parsed.brownfieldSeedVersion),
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
        if (parsed.greenFieldBudgetAllocations) {
          setGreenFieldBudgetAllocations({
            plantBudgets: parsed.greenFieldBudgetAllocations.plantBudgets ?? [],
            sectionBudgets: parsed.greenFieldBudgetAllocations.sectionBudgets ?? [],
            headBudgets: parsed.greenFieldBudgetAllocations.headBudgets ?? [],
          });
        }
        if (Array.isArray(parsed.budgetProposals)) setBudgetProposals(parsed.budgetProposals);
        if (Array.isArray(parsed.adhocBudgetRequests)) setAdhocBudgetRequests(parsed.adhocBudgetRequests);
        if (Array.isArray(parsed.brownFieldHeadAllocations)) setBrownFieldHeadAllocations(parsed.brownFieldHeadAllocations);
      } else {
        setRequests(mockRequests.map(normalizeRequest));
        setVendors(mockVendors);
        setInvites(mockInvites);
        setCapexMaster(applyMasterMigrations(mockCapexMaster.map(normalizeMasterItem), undefined, undefined, undefined, undefined));
      }
    } catch {
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
          budgetProposals,
          adhocBudgetRequests,
          brownFieldHeadAllocations,
          brownfieldSeedVersion,
          digitisationMigrationVersion,
          flatMasterMigrationVersion,
          greenFieldSectionMigrationVersion,
          brownFieldNestedMigrationVersion,
        })
      );
    } catch (e) {
      console.error('[CapexContext] Failed to persist to localStorage', e);
    }
    // File blobs go to IndexedDB (much larger quota); fire-and-forget.
    void putAllFiles(files);
  }, [requests, vendors, invites, chatMessages, plants, categories, capexMaster, masterHeads, customPlants, greenFieldBudgetAllocations, budgetProposals, adhocBudgetRequests, brownFieldHeadAllocations, brownfieldSeedVersion, digitisationMigrationVersion, flatMasterMigrationVersion, greenFieldSectionMigrationVersion, brownFieldNestedMigrationVersion]);

  // Hydrate file blobs from IndexedDB after the initial (lean) load — metadata renders
  // immediately; download links light up once base64 is merged back in.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    getAllFiles().then((files) => {
      if (cancelled || !files || !Object.keys(files).length) return;
      skipNextPersist.current = true;
      setRequests((prev) => hydrateRequestFiles(prev, files));
      setInvites((prev) => hydrateInviteFiles(prev, files));
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  // Re-sync invites when the supplier portal tab submits a quote in another window
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        const fresh = dedupeById<VendorInvite>(parsed.invites ?? []);
        if (fresh.length) {
          skipNextPersist.current = true; // data came FROM localStorage — don't write it back
          setInvites(fresh);
          // The cross-tab payload is lean (no base64); re-attach file blobs from IndexedDB.
          getAllFiles().then((files) => {
            if (!files || !Object.keys(files).length) return;
            skipNextPersist.current = true;
            setInvites((prev) => hydrateInviteFiles(prev, files));
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
      const withHistory: CapexRequest = req.statusHistory?.length
        ? { ...req, requestNo }
        : {
            ...req,
            requestNo,
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

  function inviteVendors(requestId: string, vendorIds: string[]) {
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
          // RFQ vendors must approve the contract documents (Commercial Terms / PBG / DLC / payment
          // terms) BEFORE they can quote, so send the doc-package up front (gated on the supplier
          // portal). Auction vendors approve the pre-bid Business Rules instead, so no package here.
          const vendor = isRfq ? vendors.find((v) => v.id === vendorId) : undefined;
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
            ...(isRfq
              ? {
                  rfqStatus: 'awaiting_quote' as const,
                  ...(vendor
                    ? {
                        docApprovalStatus: 'pending' as const,
                        docApprovalPackage: { ...buildDocApprovalPackage(vendor), sentAt: nowIso },
                      }
                    : { docApprovalStatus: 'not_sent' as const }),
                }
              : {}),
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
    info: { name: string; email: string; phone: string },
    senderName: string,
  ) {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const vendorId = `v-ot-${nowMs}`;
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
      // quoting, after the INCO-terms gate. Built here since we already have the vendor object.
      docApprovalStatus: 'pending',
      docApprovalPackage: { ...buildDocApprovalPackage(vendor), sentAt: now },
      incoTermsStatus: 'awaiting_vendor',
      incoTermsDoc: doc,
      incoTermsThread: [
        { id: `inco-${nowMs}`, by: 'sourcing', senderName, action: 'sent', at: now },
      ],
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
   */
  function proposeRfqQuote(
    inviteId: string,
    quote: RfqQuote,
    by: 'sourcing' | 'supplier',
    senderName: string,
    message?: string,
  ) {
    const clean = sanitizeRfqQuote(quote);
    if (!clean) {
      console.error('proposeRfqQuote: invalid quotation rejected', quote);
      return;
    }
    const now = new Date().toISOString();
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
        return {
          ...inv,
          rfqQuote: clean,
          rfqStatus: by === 'sourcing' ? 'pending_vendor' : 'pending_sourcing',
          rfqThread: [...thread, msg],
          ...(wasApproved ? { docApprovalStatus: 'not_sent' as const, docApprovalPackage: undefined } : {}),
        };
      }),
    );
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
    const seedItems = requests.find((r) => r.id === requestId)?.lineItems;
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        if (!inv.rfqQuote) return inv;
        if (inv.quotes.length > 0) return inv; // vendor already has an auction bid — don't overwrite
        const rq = inv.rfqQuote;
        const seeded: Quote = {
          id: `q-seed-${inv.vendorId}-${Date.now()}`,
          price: rfqTotal(rq, seedItems),
          itemPrices: rq.linePrices,
          deliveryDays: rq.deliveryWeeks != null ? Math.round(rq.deliveryWeeks * 7) : 0,
          validUntil,
          submittedAt: now,
          freight: rq.freight,
          packing: rq.packing,
          service: rq.service,
          warranty: rq.warranty,
          currency: rq.currency,
          seededByBuyer: true,
        };
        return { ...inv, quotes: [seeded] };
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
  function finalizeSplitAward(requestId: string, decision?: SourcingDecision) {
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
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.requestId !== requestId) return inv;
        const group = groups.find((g) => g.vendorId === inv.vendorId);
        if (!group) return inv;
        return {
          ...inv,
          status: 'approved' as const,
          awarded: true,
          awardedItemIds: group.itemIds,
          awardAmount: group.amount,
          awardStatus: 'awarded' as const,
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
      if (derived === 'pi_requested' && req && req.status === 'sourcing') {
        updateRequest(requestId, { status: 'pi_requested' }, actor);
      }
      return;
    }
    updateRequest(requestId, { finalVendorId: vendorId, status: 'pi_requested' }, actor);
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
              ...(inv.awarded ? { awardStatus: 'pi_submitted' as const, piSubmittedAt: now } : {}),
            }
          : inv,
      ),
    );
    if (invite && !awardBased) {
      updateRequest(invite.requestId, { status: 'pi_submitted', piSubmittedAt: now }, 'Vendor');
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

  /** Plant Accounts: FA codes are assigned (assignFaCode); submitting hands the award/request to Global Accounts. */
  function submitFaCodes(requestId: string, actor: string, inviteId?: string) {
    if (inviteId) {
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId && inv.awarded
            ? { ...inv, awardStatus: 'accounts_processing' as const }
            : inv,
        ),
      );
      return;
    }
    updateRequest(requestId, { status: 'accounts_processing' }, actor);
  }

  /**
   * Global Accounts: assign the PO number, upload the PO document, and ISSUE it to the vendor —
   * the vendor is notified and sees/downloads the PO on the supplier portal. Builds payment
   * milestones and moves the request into payment_in_progress.
   */
  function issuePurchaseOrder(
    requestId: string,
    po: PurchaseOrder,
    milestones: PaymentMilestone[],
    actor: string,
    inviteId?: string,
  ) {
    const now = new Date().toISOString();
    if (inviteId) {
      setInvites((prev) =>
        prev.map((inv) =>
          inv.id === inviteId && inv.awarded
            ? {
                ...inv,
                purchaseOrder: { ...po, issuedAt: now, issuedBy: actor, submittedAt: po.submittedAt ?? now },
                paymentMilestones: milestones,
                awardStatus: 'payment_in_progress' as const,
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
      },
      actor,
    );
  }

  function markPaymentMade(requestId: string, milestoneId: string, actor: string, inviteId?: string) {
    const now = new Date().toISOString();
    if (inviteId) {
      // Award-based: tick this award's milestone; final tick completes the award (per-award TAT
      // stop). When every award is completed, the whole request completes.
      const inv = invites.find((i) => i.id === inviteId);
      if (!inv?.paymentMilestones) return;
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
              ...(finalDone && i.awardStatus === 'payment_in_progress'
                ? { awardStatus: 'completed' as const, tatStoppedAt: now }
                : {}),
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
        ...(finalDone && req.status === 'payment_in_progress'
          ? { status: 'completed', tatStoppedAt: now }
          : {}),
      },
      actor,
    );
  }

  function submitQuote(inviteId: string, quote: Quote) {
    // Reverse auction re-bid overwrites the existing quote in place.
    setInvites((prev) =>
      prev.map((inv) => {
        if (inv.id !== inviteId) return inv;
        const existingId = inv.quotes[0]?.id;
        const nextQuote = existingId ? { ...quote, id: existingId } : quote;
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
      if (req.masterItemId) {
        map[req.masterItemId] = (map[req.masterItemId] ?? 0) + (req.budget ?? 0);
      }
      req.lineItems?.forEach((line) => {
        if (!line.masterItemId) return;
        map[line.masterItemId] = (map[line.masterItemId] ?? 0) + (line.budget ?? 0);
      });
    });
    return map;
  }, [requests]);

  function setAuctionConfig(requestId: string, config: AuctionConfig) {
    setRequests((prev) =>
      prev.map((req) => (req.id === requestId ? { ...req, auctionConfig: config } : req)),
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
    setBudgetProposals((prev) =>
      prev.map((p) =>
        p.id === id && (p.status === 'draft' || p.status === 'rejected')
          ? { ...p, status: 'pending_admin', submittedAt: new Date().toISOString() }
          : p,
      ),
    );
  }

  function decideBudgetProposal(
    id: string,
    decision: 'approved' | 'rejected',
    actor: string,
    note?: string,
  ) {
    const now = new Date().toISOString();
    let toPublish: BudgetProposal | null = null;
    setBudgetProposals((prev) =>
      prev.map((p) => {
        // Guard: only a pending proposal can be decided (prevents double-publish).
        if (p.id !== id || p.status !== 'pending_admin') return p;
        if (decision === 'approved') toPublish = p;
        return {
          ...p,
          status: decision,
          decidedAt: now,
          decidedBy: actor,
          decisionNote: note,
          publishedAt: decision === 'approved' ? now : undefined,
        };
      }),
    );
    // Publish the approved proposal's rows as a new live FY in the master.
    if (toPublish) {
      const newRows = buildMasterItemsFromProposal(toPublish);
      setCapexMaster((prev) => [...prev, ...newRows]);
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
        submitProformaInvoice,
        finalizeSplitAward,
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
