export const ROLE_NAMES: Record<string, string> = {
  buyer:                  "Arjun Mehta",
  buyer_jhajjar_p1:       "Arjun Mehta",
  buyer_jhajjar_p2:       "Ravi Kumar",
  sourcing_member:        "Neha Kapoor",
  plant_head:             "Karan Mehta",
  plant_head_jhajjar_p1:  "Karan Mehta",
  plant_head_jhajjar_p2:  "Ajay Gupta",
  sourcing_head:          "Rajiv Sinha",
  maintenance:            "Sunil Verma",
  plant_accounts:         "Meera Iyer",
  accounts:               "Priya Nair",
  super_admin:            "Super Admin",
}

export const ROLE_PLANT: Record<string, string> = {
  buyer_jhajjar_p1:      "jhajjar_p1",
  buyer_jhajjar_p2:      "jhajjar_p2",
  plant_head_jhajjar_p1: "jhajjar_p1",
  plant_head_jhajjar_p2: "jhajjar_p2",
}

export const SOURCING_ENGINEERS = [
  { value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" },
]

export const STATUS_COLORS: Record<string, string> = {
  draft:                 "bg-slate-100 text-slate-600",
  submitted:             "bg-blue-100 text-blue-800",
  pending_head_approval: "bg-[#EDE9FE] text-[#5B21B6]",
  sourcing:              "bg-[#DBEAFE] text-[#1E40AF]",
  negotiation:           "bg-[#FEF9C3] text-[#854D0E]",
  sourcing_approved:     "bg-emerald-100 text-emerald-800",
  buyer_approved:        "bg-[#DCFCE7] text-[#166534]",
  pi_requested:          "bg-[#FFEDD5] text-[#9A3412]",
  pi_submitted:          "bg-[#FEF3C7] text-[#92400E]",
  accounts_processing:   "bg-[#CFFAFE] text-[#155E75]",
  payment_in_progress:   "bg-[#E0E7FF] text-[#3730A3]",
  completed:             "bg-[#DCFCE7] text-[#14532D]",
  rejected:              "bg-red-100 text-red-700",
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

export const PRIORITY_COLORS: Record<string, string> = {
  low:      "bg-slate-300 text-slate-800",
  medium:   "bg-blue-500 text-white",
  high:     "bg-orange-500 text-white",
  critical: "bg-red-600 text-white",
}

export const INVITE_STATUS_COLORS: Record<string, string> = {
  invited:        "bg-slate-100 text-slate-600",
  quote_received: "bg-[#DBEAFE] text-[#1E40AF]",
  negotiating:    "bg-[#FEF9C3] text-[#854D0E]",
  approved:       "bg-[#DCFCE7] text-[#166534]",
  rejected:       "bg-red-100 text-red-700",
}

export function getPlantForRole(role: string): string | null {
  if (role in ROLE_PLANT) return ROLE_PLANT[role]
  if (role.startsWith('buyer_')) return role.slice(6)
  if (role.startsWith('plant_head_')) return role.slice(11)
  return null
}

/**
 * Recipient for the FA-code notification email (sent once after Plant Accounts submit FA codes).
 * The app has no email backend — the send is simulated (preview modal + toast). This is a
 * placeholder address; the recipient is editable in the modal before sending.
 */
export const FA_CODE_RECIPIENT_EMAIL = "asset.register@amber-enterprises.in"

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
