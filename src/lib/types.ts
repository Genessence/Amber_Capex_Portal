export type CapexStatus =
  | 'draft'
  | 'submitted'
  | 'pending_head_approval'
  | 'sourcing'
  | 'negotiation'
  | 'sourcing_approved'
  | 'buyer_approved'
  | 'rejected';

export const CAPEX_STATUS_FLOW: CapexStatus[] = [
  'draft',
  'submitted',
  'pending_head_approval',
  'sourcing',
  'negotiation',
  'sourcing_approved',
  'buyer_approved',
  'rejected',
];

export const HEAD_APPROVAL_THRESHOLD = 1_000_000; // ₹10,00,000

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

export interface CapexRequest {
  id: string;
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
  createdBy: string;
  createdAt: string;
  comments?: RequestComment[];
  statusHistory?: { status: CapexStatus; actor: string; at: string }[]
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
  paymentTerms: 'Net-30' | 'Net-60' | 'Advance';
  bankName: string;
  accountNumber: string;
  ifsc: string;
  onboardedAt: string;
}

export interface Quote {
  id: string;
  price: number;
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

export interface VendorInvite {
  id: string;
  requestId: string;
  vendorId: string;
  token: string;
  status: 'invited' | 'quote_received' | 'negotiating' | 'approved' | 'rejected';
  quotes: Quote[];
  negotiationThread: NegotiationMessage[];
  invitedAt: string;
}
