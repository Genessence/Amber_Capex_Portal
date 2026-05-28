'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  CapexRequest,
  CapexStatus,
  ChatMessage,
  HEAD_APPROVAL_THRESHOLD,
  NegotiationMessage,
  Quote,
  RequestComment,
  Vendor,
  VendorInvite,
} from './types';
import { mockInvites, mockRequests, mockVendors } from './mockData';
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
  addRequest: (req: CapexRequest) => void;
  updateRequest: (id: string, updates: Partial<CapexRequest>) => void;
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

export function initialStatusForRequest(budget?: number): CapexStatus {
  if (budget && budget > HEAD_APPROVAL_THRESHOLD) return 'pending_head_approval';
  return 'sourcing';
}

export function CapexProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  const [requests, setRequests] = useState<CapexRequest[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invites, setInvites] = useState<VendorInvite[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [plants, setPlants] = useState<string[]>(DEFAULT_PLANTS);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);

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
      } else {
        setRequests(mockRequests);
        setVendors(mockVendors);
        setInvites(mockInvites);
      }
    } catch {
      setRequests(mockRequests);
      setVendors(mockVendors);
      setInvites(mockInvites);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!requests.length && !vendors.length && !invites.length && !chatMessages.length) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ requests, vendors, invites, chatMessages, plants, categories }));
    } catch {
      console.error('[CapexContext] Failed to persist to localStorage');
    }
  }, [requests, vendors, invites, chatMessages, plants, categories]);

  // Re-sync invites when the supplier portal tab submits a quote in another window
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue);
        const fresh = dedupeById<VendorInvite>(parsed.invites ?? []);
        if (fresh.length) setInvites(fresh);
      } catch {}
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function addRequest(req: CapexRequest) {
    setRequests((prev) => dedupeById([...prev, req]));
  }

  function updateRequest(id: string, updates: Partial<CapexRequest>) {
    setRequests((prev) =>
      prev.map((req) => {
        if (req.id !== id) return req;
        if (updates.status && updates.status !== req.status) {
          const allowed = ALLOWED_TRANSITIONS[req.status] ?? [];
          if (!allowed.includes(updates.status)) {
            console.error(
              `[CapexContext] Invalid status transition: ${req.status} → ${updates.status}`
            );
            return req;
          }
        }
        return { ...req, ...updates };
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
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? { ...inv, quotes: [quote], status: 'quote_received' }
          : inv
      )
    );
  }

  function addNegotiationMessage(inviteId: string, msg: NegotiationMessage) {
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId
          ? { ...inv, negotiationThread: [...inv.negotiationThread, msg], status: 'negotiating' }
          : inv
      )
    );
  }

  function approveInvite(inviteId: string) {
    setInvites((prev) =>
      prev.map((inv) =>
        inv.id === inviteId ? { ...inv, status: 'approved' } : inv
      )
    );
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
  }

  function addCategory(name: string) {
    setCategories((prev) => prev.includes(name) ? prev : [...prev, name]);
  }

  function removeCategory(name: string) {
    setCategories((prev) => prev.filter((c) => c !== name));
  }

  function resetData() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('capex_role');
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
