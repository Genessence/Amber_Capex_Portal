import type { LucideIcon } from "lucide-react"
import {
  FileText, Send, Clock, Search, MessagesSquare, BadgeCheck,
  FileInput, FileCheck2, Calculator, CreditCard, CheckCheck, XCircle,
  Mail,
} from "lucide-react"

/**
 * Semantic badge tones. The portal chrome is black-and-white + blue, but STATUS badges
 * carry colour for clear at-a-glance visibility (paired with a Lucide icon). The five
 * tones map to workflow phases: idle → waiting → in-progress → done → danger.
 */
export const BADGE_TONE = {
  soft:    "bg-slate-100 text-slate-600 border border-slate-200",      // idle / draft / not-sent
  pending: "bg-amber-50 text-amber-700 border border-amber-200",       // awaiting / in-review
  active:  "bg-blue-50 text-blue-700 border border-blue-200",          // in-progress / action taken
  done:    "bg-emerald-50 text-emerald-700 border border-emerald-200", // approved / completed
  danger:  "bg-red-50 text-red-700 border border-red-200",             // rejected / error / overdue
} as const

export const ROLE_NAMES: Record<string, string> = {
  buyer:                  "Arjun Mehta",
  buyer_jhajjar_p1:       "Arjun Mehta",
  buyer_jhajjar_p2:       "Ravi Kumar",
  sourcing_member:        "Neha Kapoor",
  maintenance:            "Sunil Verma",
  plant_accounts:         "Meera Iyer",
  accounts:               "Priya Nair",
  super_admin:            "Super Admin",
}

export const ROLE_PLANT: Record<string, string> = {
  buyer_jhajjar_p1:      "jhajjar_p1",
  buyer_jhajjar_p2:      "jhajjar_p2",
}

export const SOURCING_ENGINEERS = [
  { value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" },
]

// Distinct colour per status so the workflow stage is obvious at a glance (icon reinforces it).
export const STATUS_COLORS: Record<string, string> = {
  draft:                 "bg-slate-100 text-slate-600 border border-slate-200",
  submitted:             "bg-blue-50 text-blue-700 border border-blue-200",
  pending_head_approval: "bg-amber-50 text-amber-700 border border-amber-200",
  sourcing:              "bg-sky-50 text-sky-700 border border-sky-200",
  negotiation:           "bg-violet-50 text-violet-700 border border-violet-200",
  sourcing_approved:     "bg-emerald-50 text-emerald-700 border border-emerald-200",
  buyer_approved:        "bg-emerald-50 text-emerald-700 border border-emerald-200",
  pi_requested:          "bg-orange-50 text-orange-700 border border-orange-200",
  pi_submitted:          "bg-amber-50 text-amber-700 border border-amber-200",
  accounts_processing:   "bg-cyan-50 text-cyan-700 border border-cyan-200",
  payment_in_progress:   "bg-indigo-50 text-indigo-700 border border-indigo-200",
  completed:             "bg-green-100 text-green-800 border border-green-300",
  rejected:              "bg-red-50 text-red-700 border border-red-200",
}

/** Lucide icon per request status — carries meaning now that colour does not. */
export const STATUS_ICONS: Record<string, LucideIcon> = {
  draft:                 FileText,
  submitted:             Send,
  pending_head_approval: Clock,
  sourcing:              Search,
  negotiation:           MessagesSquare,
  sourcing_approved:     BadgeCheck,
  buyer_approved:        BadgeCheck,
  pi_requested:          FileInput,
  pi_submitted:          FileCheck2,
  accounts_processing:   Calculator,
  payment_in_progress:   CreditCard,
  completed:             CheckCheck,
  rejected:              XCircle,
}

export const STATUS_LABELS: Record<string, string> = {
  draft:                 "Draft",
  submitted:             "Submitted",
  pending_head_approval: "With Plant Head",
  sourcing:              "In Sourcing",
  negotiation:           "Negotiation",
  sourcing_approved:     "Sourcing Approved",
  buyer_approved:        "Approved",
  pi_requested:          "PI Requested",
  pi_submitted:          "PI Submitted",
  accounts_processing:   "With Accounts",
  payment_in_progress:   "Payment In Progress",
  completed:             "Completed",
  rejected:              "Rejected",
}

// Priority climbs as a monochrome weight ramp; only the top tier borrows the danger red.
export const PRIORITY_COLORS: Record<string, string> = {
  low:      "bg-slate-100 text-slate-600 border border-slate-200",
  medium:   "bg-blue-50 text-blue-700 border border-blue-200",
  high:     "bg-amber-50 text-amber-700 border border-amber-200",
  critical: "bg-red-50 text-red-700 border border-red-200",
}

export const INVITE_STATUS_COLORS: Record<string, string> = {
  invited:        BADGE_TONE.soft,
  quote_received: BADGE_TONE.pending,
  negotiating:    BADGE_TONE.active,
  approved:       BADGE_TONE.done,
  rejected:       BADGE_TONE.danger,
}

/** Lucide icon per vendor-invite status (mirrors STATUS_ICONS approach). */
export const INVITE_STATUS_ICONS: Record<string, LucideIcon> = {
  invited:        Mail,
  quote_received: FileText,
  negotiating:    MessagesSquare,
  approved:       BadgeCheck,
  rejected:       XCircle,
}

export function getPlantForRole(role: string): string | null {
  if (role in ROLE_PLANT) return ROLE_PLANT[role]
  if (role.startsWith('buyer_')) return role.slice(6)
  return null
}

/**
 * Recipient for the FA-code notification email (sent once after Plant Accounts submit FA codes).
 * The app has no email backend — the send is simulated (preview modal + toast). This is a
 * placeholder address; the recipient is editable in the modal before sending.
 */
export const FA_CODE_RECIPIENT_EMAIL = "asset.register@amber-enterprises.in"

/**
 * Recipient for the PO handoff email — "Sandeep" on the Global Accounts team. After Plant Accounts
 * submit FA codes, this notifies Global Accounts via a **public** `/po/[token]` link (no login) to
 * raise the PO. Simulated send (preview + toast).
 */
export const GLOBAL_ACCOUNTS_EMAIL = "sandeep.accounts@amber-enterprises.in"

/**
 * Recipient for the technical specification approval email. Amber's Technical team signs off a
 * vendor's machine spec BEFORE sourcing can award that vendor — they have no portal login, so the
 * emailed **public** `/tech-spec/[token]` link is the real payload. Simulated send (preview + toast);
 * the address is a placeholder, editable in the preview modal.
 */
export const TECHNICAL_TEAM_EMAIL = "technical.team@amber-enterprises.in"

/**
 * Default recipient for plant-head approval emails (budget + request). The plant head has no portal
 * login — the emailed public link is the real payload; the address is a placeholder, editable in
 * the preview modal before "sending".
 */
export const PLANT_HEAD_EMAIL = "plant.head@amber-enterprises.in"

export const PLANTS = [
  { value: "jhajjar_p1", label: "Jhajjar Plant 1", state: "Haryana" },
  { value: "jhajjar_p2", label: "Jhajjar Plant 2", state: "Haryana" },
  { value: "ddn_4",      label: "DDN-4",             state: "Uttarakhand" },
  { value: "ddn_5",      label: "DDN-5",             state: "Uttarakhand" },
  { value: "ddn_6",      label: "DDN-6",             state: "Uttarakhand" },
  { value: "supa",      label: "SUPA",              state: "Maharashtra" },
  { value: "rudrapur",  label: "Rudrapur",          state: "Uttarakhand" },
  { value: "sircity_1", label: "Sri City-1",        state: "Andhra Pradesh" },
  { value: "sircity_2", label: "Sri City-2",        state: "Andhra Pradesh" },
]
