'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import {
  CapexMasterItem,
  CapexRequest,
  CapexStatus,
  ChatMessage,
  NegotiationMessage,
  PlantMeta,
  Quote,
  RequestComment,
  Vendor,
  VendorInvite,
} from './types';
import { mockCapexMaster, mockInvites, mockRequests, mockVendors } from './mockData';
import { PLANTS } from './constants';

const STORAGE_KEY = 'capex_data_v2';

const DEFAULT_PLANTS = PLANTS.map((p) => p.value);
const DEFAULT_CATEGORIES = ['Machinery', 'Infrastructure', 'IT', 'Tooling'];

const ALLOWED_TRANSITIONS: Record<CapexStatus, CapexStatus[]> = {
  draft:                  ['submitted'],
  submitted:              ['pending_head_approval', 'sourcing'],
  pending_head_approval:  ['sourcing', 'rejected'],
  sourcing:               ['negotiation', 'sourcing_approved'],
  negotiation:            ['sourcing_approved', 'rejected'],
  sourcing_approved:      ['buyer_approved', 'rejected'],
  buyer_approved:         [],
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
  resetData: () => void;
}

const CapexContext = createContext<CapexContextValue | null>(null);

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function initialStatusForRequest(_budget?: number): CapexStatus {
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
        setRequests(storedRequests.length ? storedRequests : mockRequests);
        setVendors(storedVendors.length ? storedVendors : mockVendors);
        setInvites(storedInvites.length ? storedInvites : mockInvites);
        if (parsed.chatMessages?.length) setChatMessages(parsed.chatMessages);
        if (parsed.plants?.length) setPlants(parsed.plants);
        if (parsed.categories?.length) setCategories(parsed.categories);
        setCapexMaster(parsed.capexMaster?.length ? parsed.capexMaster : mockCapexMaster);
        if (Array.isArray(parsed.masterHeads)) setMasterHeads(parsed.masterHeads);
        if (Array.isArray(parsed.customPlants)) setCustomPlants(parsed.customPlants);
      } else {
        setRequests(mockRequests);
        setVendors(mockVendors);
        setInvites(mockInvites);
        setCapexMaster(mockCapexMaster);
      }
    } catch {
      setRequests(mockRequests);
      setVendors(mockVendors);
      setInvites(mockInvites);
      setCapexMaster(mockCapexMaster);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return; // invites just came FROM localStorage — no need to write back
    }
    if (!requests.length && !vendors.length && !invites.length && !chatMessages.length) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ requests, vendors, invites, chatMessages, plants, categories, capexMaster, masterHeads, customPlants })
      );
    } catch {
      console.error('[CapexContext] Failed to persist to localStorage');
    }
  }, [requests, vendors, invites, chatMessages, plants, categories, capexMaster, masterHeads, customPlants]);

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
    setInvites((prev) => {
      const existingVendorIds = new Set(
        prev.filter((inv) => inv.requestId === requestId).map((inv) => inv.vendorId)
      );
      const now = Date.now();
      const newInvites: VendorInvite[] = vendorIds
        .filter((vendorId) => !existingVendorIds.has(vendorId))
        .map((vendorId) => ({
          id: `inv-${now}-${vendorId}`,
          requestId,
          vendorId,
          token: `tok_${vendorId}_${requestId}_${now}`,
          status: 'invited' as const,
          quotes: [],
          negotiationThread: [],
          invitedAt: new Date().toISOString(),
        }));
      return dedupeById([...prev, ...newInvites]);
    });
  }

  function updateInvite(id: string, updates: Partial<VendorInvite>) {
    setInvites((prev) =>
      prev.map((inv) => (inv.id === id ? { ...inv, ...updates } : inv))
    );
  }

  function submitQuote(inviteId: string, quote: Quote) {
    // [RELIABILITY] Append quote instead of replacing — preserves revision history.
    // The UI already assumes quotes[] is a growing array (quoteIndex, "N revisions").
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? { ...inv, quotes: [...inv.quotes, quote], status: 'quote_received' }
          : inv
      )
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

  function renameMasterHead(oldHead: string, newHead: string) {
    const trimmed = newHead.trim();
    if (!trimmed || trimmed === oldHead) return;
    setMasterHeads(prev => prev.map(h => h === oldHead ? trimmed : h));
    setCapexMaster(prev => prev.map(item => item.head === oldHead ? { ...item, head: trimmed } : item));
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
        resetData,
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
