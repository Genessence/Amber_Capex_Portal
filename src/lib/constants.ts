export const ROLE_NAMES: Record<string, string> = {
  buyer:          "Arjun Mehta",
  sourcing_member: "Neha Kapoor",
  plant_head:     "Karan Mehta",
  sourcing_head:  "Rajiv Sinha",
  super_admin:    "Super Admin",
}

export const SOURCING_ENGINEERS = [
  { value: "sourcing_member", name: "Neha Kapoor", area: "Machinery" },
]

export const STATUS_COLORS: Record<string, string> = {
  draft:                 "bg-slate-400 text-white",
  submitted:             "bg-blue-600 text-white",
  pending_head_approval: "bg-orange-500 text-white",
  sourcing:              "bg-violet-600 text-white",
  negotiation:           "bg-amber-500 text-slate-900",
  sourcing_approved:     "bg-teal-600 text-white",
  buyer_approved:        "bg-green-600 text-white",
  rejected:              "bg-red-600 text-white",
}

export const STATUS_LABELS: Record<string, string> = {
  draft:                 "Draft",
  submitted:             "Submitted",
  pending_head_approval: "Pending Approval",
  sourcing:              "In Sourcing",
  negotiation:           "Negotiation",
  sourcing_approved:     "Sourcing Approved",
  buyer_approved:        "Approved",
  rejected:              "Rejected",
}

export const PRIORITY_COLORS: Record<string, string> = {
  low:      "bg-slate-300 text-slate-800",
  medium:   "bg-blue-500 text-white",
  high:     "bg-orange-500 text-white",
  critical: "bg-red-600 text-white",
}

export const INVITE_STATUS_COLORS: Record<string, string> = {
  invited:        "bg-slate-400 text-white",
  quote_received: "bg-blue-600 text-white",
  negotiating:    "bg-amber-500 text-slate-900",
  approved:       "bg-green-600 text-white",
  rejected:       "bg-red-600 text-white",
}

export const PLANTS = [
  { value: "jhajjar_p1", label: "Jhajjar Plant 1", state: "Haryana" },
  { value: "jhajjar_p2", label: "Jhajjar Plant 2", state: "Haryana" },
  { value: "chennai",    label: "Chennai",          state: "Tamil Nadu" },
  { value: "rajpura",    label: "Rajpura",          state: "Punjab" },
  { value: "pune",       label: "Pune",             state: "Maharashtra" },
  { value: "ahmedabad",  label: "Ahmedabad",        state: "Gujarat" },
]
