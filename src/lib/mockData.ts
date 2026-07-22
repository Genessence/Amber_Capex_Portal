import { CapexRequest, Vendor, VendorInvite, CapexMasterItem } from './types';
import { finalizeMockCapexMaster } from './greenFieldConstants';
import { brownFieldSeedData } from './brownFieldSeedData';

export const mockVendors: Vendor[] = [
  {
    id: 'v1',
    vendorCode: 'VND-001',
    vendorName: 'Tata Motors Ancillaries',
    category: 'Machinery',
    gstin: '27AABCT3518Q1ZK',
    pan: 'AABCT3518Q',
    contactName: 'Ramesh Tiwari',
    contactEmail: 'ramesh.tiwari@tata-ancillaries.in',
    paymentTerms: 'Net-30',
    bankName: 'HDFC Bank',
    accountNumber: '50200012345678',
    ifsc: 'HDFC0001234',
    onboardedAt: '2023-04-10T09:00:00.000Z',
  },
  {
    id: 'v2',
    vendorCode: 'VND-002',
    vendorName: 'Siemens India',
    category: 'IT',
    gstin: '27AAACS6560P1ZX',
    pan: 'AAACS6560P',
    contactName: 'Anita Sharma',
    contactEmail: 'anita.sharma@siemens.com',
    paymentTerms: 'Net-60',
    bankName: 'Citibank',
    accountNumber: '0123456789',
    ifsc: 'CITI0100000',
    onboardedAt: '2023-06-15T10:30:00.000Z',
  },
  {
    id: 'v3',
    vendorCode: 'VND-003',
    vendorName: 'Bosch Packaging',
    category: 'Tooling',
    gstin: '29AABCB1234A1ZZ',
    pan: 'AABCB1234A',
    contactName: 'Klaus Mueller',
    contactEmail: 'k.mueller@bosch-packaging.in',
    paymentTerms: 'Advance',
    bankName: 'Deutsche Bank',
    accountNumber: '9876543210',
    ifsc: 'DEUT0784BBY',
    onboardedAt: '2023-08-01T08:00:00.000Z',
  },
  {
    id: 'v4',
    vendorCode: 'VND-004',
    vendorName: 'L&T Infrastructure',
    category: 'Infrastructure',
    gstin: '27AAACL1234B1ZP',
    pan: 'AAACL1234B',
    contactName: 'Suresh Iyer',
    contactEmail: 'suresh.iyer@lnt-infra.com',
    paymentTerms: 'Net-30',
    bankName: 'SBI',
    accountNumber: '3456789012345',
    ifsc: 'SBIN0001234',
    onboardedAt: '2022-11-20T11:00:00.000Z',
  },
  {
    id: 'v5',
    vendorCode: 'VND-005',
    vendorName: 'Delta Electronics',
    category: 'Machinery',
    gstin: '07AABCD5678E1ZQ',
    pan: 'AABCD5678E',
    contactName: 'Priya Venkatesh',
    contactEmail: 'p.venkatesh@delta-electronics.in',
    paymentTerms: 'Net-60',
    bankName: 'ICICI Bank',
    accountNumber: '123456789012',
    ifsc: 'ICIC0001234',
    onboardedAt: '2024-01-05T14:00:00.000Z',
  },
];

/**
 * Demo requests/invites were removed so the portal seeds a **clean slate** — vendors, plants and the
 * CAPEX master still seed (they are reference data), but there are no pre-made requests.
 * `LEGACY_DEMO_REQUEST_IDS` / `LEGACY_DEMO_INVITE_IDS` are the ids the old seed used; the provider
 * purges exactly those from existing localStorage once (see `DEMO_DATA_PURGE_V1`), so a browser that
 * already holds the demo data gets the same clean slate without touching anything the user created.
 */
export const LEGACY_DEMO_REQUEST_IDS = [
  'REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005',
  'REQ-006', 'REQ-007', 'REQ-008', 'REQ-009', 'REQ-010',
] as const;

export const LEGACY_DEMO_INVITE_IDS = [
  'inv-001', 'inv-002', 'inv-003', 'inv-004', 'inv-005', 'inv-006',
] as const;

/** Bump to re-run the one-time purge of the legacy demo requests/invites. */
export const DEMO_DATA_PURGE_V1 = 'demo_purge_v1';

export const mockRequests: CapexRequest[] = [];

export const mockInvites: VendorInvite[] = [];

const greenFieldMockCapexMaster: CapexMasterItem[] = [
  // Green Field demo — sectioned structure (FY 2025-26, RAC)
  { id: 'cm-gf-p1-001', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p1', division: 'Plant Machinery', head: 'Press Shop', department: 'Production', subParticulars: '6 Axis Robot — press shop line 1', rate: 0.21, totalCost: 1.26 },
  { id: 'cm-gf-p1-002', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p1', division: 'Plant Machinery', head: 'Assembly Shop', department: 'Sheet Metal', subParticulars: 'Power Press (200T)', rate: 0.35, totalCost: 1.40 },
  { id: 'cm-gf-p1-003', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p1', division: 'Compliances', head: 'Compliances', department: 'Civil', subParticulars: 'Admin block civil works', rate: 0.50, totalCost: 0.50 },
  { id: 'cm-gf-p1-004', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p1', division: 'Utilities', head: 'Electrical', department: 'Electrical', subParticulars: 'HT substation & transformer', rate: 0.80, totalCost: 0.80 },
  { id: 'cm-gf-p1-005', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p1', division: 'Utilities', head: 'Misc.', department: 'Projects', subParticulars: 'Contingency allocation', rate: 0.25, totalCost: 0.25 },
  { id: 'cm-gf-p2-001', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p2', division: 'Plant Machinery', head: 'Assembly Shop', department: 'Assembly', subParticulars: 'Assembly line — phase 1', rate: 1.20, totalCost: 1.20 },
  { id: 'cm-gf-p2-002', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'jhajjar_p2', division: 'Compliances', head: 'Compliances', department: 'Civil', subParticulars: 'Roads & drainage', rate: 0.40, totalCost: 0.40 },
  { id: 'cm-gf-pune-001', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'pune', division: 'Plant Machinery', head: 'Research and Development', department: 'Production', subParticulars: 'Vision inspection system', rate: 0.15, totalCost: 0.15 },
  { id: 'cm-gf-pune-002', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'pune', division: 'Plant Machinery', head: 'Paint Shop', department: 'Paint Shop', subParticulars: 'Powder coating line', rate: 0.60, totalCost: 0.60 },
  { id: 'cm-gf-pune-003', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'pune', division: 'Utilities', head: 'Fire & Safety', department: 'EHS', subParticulars: 'Fire hydrant & sprinkler system', rate: 0.30, totalCost: 0.30 },
  { id: 'cm-gf-pune-004', fieldType: 'green_field', projectType: 'rac', fy: '2025-26', plant: 'pune', division: 'Information Technology', head: 'Information Technology', department: 'IT', subParticulars: 'Core network & server room', rate: 0.20, totalCost: 0.20 },
];

const rawMockCapexMaster: CapexMasterItem[] = [
  ...brownFieldSeedData,
  ...greenFieldMockCapexMaster,
];

export const mockCapexMaster = finalizeMockCapexMaster(rawMockCapexMaster);
