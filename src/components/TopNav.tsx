"use client"
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Building2, ChevronDown, ChevronRight, MessageCircle, X, SendHorizonal } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useCapex } from '@/lib/capexContext'

const ROLE_GROUPS = [
  {
    label: "Buyers",
    roles: [
      { value: "buyer_jhajjar_p1", name: "Arjun Mehta", area: "Jhajjar Plant 1" },
      { value: "buyer_jhajjar_p2", name: "Ravi Kumar",   area: "Jhajjar Plant 2" },
    ],
  },
  {
    label: "Sourcing",
    roles: [
      { value: "sourcing_member", name: "Neha Kapoor",  area: "Machinery" },
    ],
  },
  {
    // Plant Accounts + Global Accounts are NOT portal roles — both act on emailed public links.
    label: "Maintenance",
    roles: [
      { value: "maintenance",    name: "Sunil Verma", area: "CAPEX Master / Budget" },
    ],
  },
  {
    label: "Administration",
    roles: [{ value: "super_admin", name: "Super Admin", area: "Full Access" }],
  },
]


function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function getRoleBg(value: string): string {
  if (value.startsWith("buyer"))        return "bg-blue-600"
  if (value === "sourcing_member") return "bg-slate-600"
  if (value === "maintenance")     return "bg-slate-600"
  return "bg-slate-700"
}

const PAGE_LABELS: Record<string, { label: string; sub?: string }> = {
  "/capex/dashboard":  { label: "Dashboard",        sub: "Capital expenditure overview" },
  "/capex/requests":   { label: "CAPEX Requests",   sub: "Vendor sourcing & negotiation" },
  "/capex/new":        { label: "New Request",       sub: "Submit a capital expenditure request" },
  "/sourcing/vendors": { label: "Vendor Directory",  sub: "Manage and onboard vendors" },
  "/capex/master":     { label: "CAPEX Master",       sub: "Per-plant budget planning" },
  "/capex/budget-proposals": { label: "Budget Planning", sub: "Author next-FY budget proposals" },
  "/capex/adhoc-budget": { label: "Adhoc Budget",     sub: "Reallocate budget between heads" },
  "/capex/budget-approvals": { label: "Budget Approvals", sub: "Next-FY proposals & adhoc transfers" },
  "/accounts/queue":   { label: "Accounts Queue",     sub: "FA codes, PO & payments" },
  "/settings":         { label: "Configurations",     sub: "Plants, categories & users" },
}

const PLANT_LABELS: Record<string, string> = {
  jhajjar_p1: "Jhajjar P1",
  jhajjar_p2: "Jhajjar P2",
  ddn_4:      "DDN-4",
  ddn_5:      "DDN-5",
  ddn_6:      "DDN-6",
  supa:       "SUPA",
  rudrapur:   "Rudrapur",
  sircity_1:  "Sri City-1",
  sircity_2:  "Sri City-2",
}

function formatChatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  return isToday
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}

export function TopNav() {
  const router   = useRouter()
  const pathname = usePathname()
  const { chatMessages, sendChatMessage, customPlants } = useCapex()

  const allRoleGroups = useMemo(() => {
    // Custom plants add per-plant Buyer roles (plant heads act via email links, not portal roles).
    const dynamicBuyers = customPlants.map(p => ({ value: `buyer_${p.value}`, name: p.assignedUser ?? "Buyer", area: p.label }))
    return ROLE_GROUPS.map(g =>
      g.label === "Buyers" ? { ...g, roles: [...g.roles, ...dynamicBuyers] } : g,
    )
  }, [customPlants])

  const ALL_ROLES = useMemo(() => allRoleGroups.flatMap(g => g.roles), [allRoleGroups])

  const [showRolePicker, setShowRolePicker] = useState(false)
  const [currentRole,    setCurrentRole]    = useState("buyer")
  const [currentPlant,   setCurrentPlant]   = useState("jhajjar_p1")
  const [chatOpen,       setChatOpen]       = useState(false)
  const [selectedContact, setSelectedContact] = useState<string | null>(null)
  const [msgText,        setMsgText]        = useState("")

  const roleRef     = useRef<HTMLDivElement>(null)
  const triggerRef  = useRef<HTMLButtonElement>(null)
  const threadRef   = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem('capex_role')
    if (stored) setCurrentRole(stored)
    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener('capex_rolechange', onRoleChange as EventListener)
    return () => window.removeEventListener('capex_rolechange', onRoleChange as EventListener)
  }, [])

  useEffect(() => {
    setCurrentPlant(localStorage.getItem('capex_plant') ?? 'jhajjar_p1')
    const onPlantChange = (e: CustomEvent) => setCurrentPlant(e.detail)
    window.addEventListener('capex_plantchange', onPlantChange as EventListener)
    return () => window.removeEventListener('capex_plantchange', onPlantChange as EventListener)
  }, [])

  // Scroll thread to bottom when messages change or contact selected
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [chatMessages, selectedContact])

  // Close role picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (roleRef.current && !roleRef.current.contains(e.target as Node)) {
        setShowRolePicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowRolePicker(false)
      triggerRef.current?.focus()
    }
  }, [])

  const switchRole = (value: string) => {
    setCurrentRole(value)
    setShowRolePicker(false)
    localStorage.setItem('capex_role', value)
    window.dispatchEvent(new CustomEvent('capex_rolechange', { detail: value }))
    router.push("/capex/requests")
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    if (!msgText.trim() || !selectedContact) return
    const contact = ALL_ROLES.find(r => r.value === selectedContact)
    const me = ALL_ROLES.find(r => r.value === currentRole)
    if (!contact || !me) return
    sendChatMessage({
      id: `cm-${Date.now()}`,
      from: currentRole,
      fromName: me.name,
      to: selectedContact,
      toName: contact.name,
      text: msgText.trim(),
      at: new Date().toISOString(),
    })
    setMsgText("")
  }

  const active    = ALL_ROLES.find(r => r.value === currentRole) ?? ALL_ROLES[0]
  const contacts  = ALL_ROLES.filter(r => r.value !== currentRole)
  const pageMeta  = PAGE_LABELS[pathname]
    ?? (pathname.startsWith("/capex/") ? { label: "CAPEX Detail", sub: "Request view" } : { label: "Portal" })

  // Unread: messages to current user not in open conversation
  const unread = chatMessages.filter(m =>
    m.to === currentRole && (!chatOpen || m.from !== selectedContact)
  ).length

  // Thread for selected contact
  const thread = selectedContact
    ? chatMessages
        .filter(m =>
          (m.from === currentRole && m.to === selectedContact) ||
          (m.from === selectedContact && m.to === currentRole)
        )
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    : []

  // Last message per contact (for preview)
  const lastMsg = (contactValue: string) =>
    chatMessages
      .filter(m =>
        (m.from === currentRole && m.to === contactValue) ||
        (m.from === contactValue && m.to === currentRole)
      )
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0]

  const contactUnread = (contactValue: string) =>
    chatMessages.filter(m => m.from === contactValue && m.to === currentRole).length

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-5 relative z-50 shrink-0 shadow-xs">
        {/* ── Page title ── */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-primary bg-accent px-2.5 py-1 rounded-lg shrink-0 border border-primary/10">
            <Building2 className="w-3 h-3" aria-hidden="true" />
            {PLANT_LABELS[currentPlant] ?? currentPlant}
          </span>
          <div className="hidden sm:block w-px h-4 bg-border shrink-0" />
          <h1 className="text-[15px] font-bold text-foreground tracking-tight truncate">{pageMeta.label}</h1>
          {pageMeta.sub && (
            <>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              <span className="text-[13px] text-slate-400 truncate hidden md:block">{pageMeta.sub}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* ── Chat button ── */}
          <button
            onClick={() => setChatOpen(o => !o)}
            aria-label="Open chat"
            className={`relative p-2 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              chatOpen ? "bg-accent border-primary/20 text-primary" : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <MessageCircle className="w-[18px] h-[18px]" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>

          {/* ── Role switcher ── */}
          <div ref={roleRef} className="relative" onKeyDown={handleKeyDown}>
            <button
              ref={triggerRef}
              onClick={() => setShowRolePicker(v => !v)}
              aria-haspopup="true"
              aria-expanded={showRolePicker}
              aria-label={`Switch user — currently ${active.name}`}
              className={[
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-all border",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                showRolePicker
                  ? "bg-muted border-border shadow-inner"
                  : "bg-card border-border hover:bg-muted hover:border-border",
              ].join(" ")}
            >
              <span aria-hidden="true" className={`flex items-center justify-center w-7 h-7 rounded-full text-white text-[10px] font-bold shrink-0 ${getRoleBg(currentRole)}`}>
                {getInitials(active.name)}
              </span>
              <span className="hidden sm:flex flex-col items-start leading-none min-w-0">
                <span className="text-slate-800 font-semibold text-[12px] truncate max-w-[100px]">{active.name}</span>
                <span className="text-slate-400 text-[10px] truncate max-w-[100px]">{active.area}</span>
              </span>
              <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-150 shrink-0 ${showRolePicker ? "rotate-180" : ""}`} />
            </button>

            {showRolePicker && (
              <div role="menu" aria-label="Switch user"
                className="absolute right-0 mt-2 w-64 rounded-xl bg-white shadow-xl shadow-slate-200/80 ring-1 ring-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150 flex flex-col max-h-[70vh]">
                <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Switch User</p>
                </div>
                <div className="overflow-y-auto">
                {allRoleGroups.map(group => (
                  <div key={group.label}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em] bg-slate-50/60 border-b border-slate-100">
                      {group.label}
                    </div>
                    {group.roles.map(role => {
                      const isSelected = currentRole === role.value
                      return (
                        <button key={role.value} role="menuitem" onClick={() => switchRole(role.value)}
                          aria-current={isSelected ? "true" : undefined}
                          className={[
                            "w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            isSelected ? "bg-foreground" : "hover:bg-muted",
                          ].join(" ")}
                        >
                          <span aria-hidden="true" className={`flex items-center justify-center w-8 h-8 rounded-full text-white text-[11px] font-bold shrink-0 ${getRoleBg(role.value)}`}>
                            {getInitials(role.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[13px] font-semibold leading-tight truncate ${isSelected ? "text-white" : "text-slate-800"}`}>{role.name}</p>
                            <p className="text-[11px] truncate mt-0.5 text-slate-400">{role.area}</p>
                          </div>
                          {isSelected && <span aria-label="Currently active" className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Chat drawer ── */}
      {chatOpen && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={(e) => { if (e.target === e.currentTarget) setChatOpen(false) }}>
          {/* Scrim */}
          <div className="absolute inset-0 bg-slate-900/20" />

          {/* Panel */}
          <div className="relative w-full max-w-xl bg-white shadow-2xl flex flex-col h-full border-l border-slate-200">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-white shrink-0">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-primary" />
                <p className="text-sm font-bold text-slate-900">Messages</p>
              </div>
              <button onClick={() => setChatOpen(false)} aria-label="Close chat"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-1 min-h-0">
              {/* Contact list */}
              <div className="w-56 shrink-0 border-r border-slate-100 flex flex-col bg-slate-50 overflow-y-auto">
                <p className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">People</p>
                {contacts.map(contact => {
                  const last = lastMsg(contact.value)
                  const uCount = contactUnread(contact.value)
                  const isActive = selectedContact === contact.value
                  return (
                    <button key={contact.value} onClick={() => setSelectedContact(contact.value)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        isActive ? "bg-accent border-r-2 border-primary" : "hover:bg-card"
                      }`}>
                      <span className={`flex items-center justify-center w-8 h-8 rounded-full text-white text-[10px] font-bold shrink-0 ${getRoleBg(contact.value)}`}>
                        {getInitials(contact.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-[12px] font-semibold text-slate-800 truncate">{contact.name}</p>
                          {last && <span className="text-[10px] text-slate-400 shrink-0">{formatChatTime(last.at)}</span>}
                        </div>
                        <p className="text-[11px] text-slate-400 truncate mt-0.5">
                          {last ? last.text : contact.area}
                        </p>
                      </div>
                      {uCount > 0 && (
                        <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                          {uCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Thread */}
              <div className="flex-1 flex flex-col min-h-0">
                {selectedContact ? (() => {
                  const contact = ALL_ROLES.find(r => r.value === selectedContact)!
                  return (
                    <>
                      {/* Contact header */}
                      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center gap-2.5 bg-white shrink-0">
                        <span className={`flex items-center justify-center w-7 h-7 rounded-full text-white text-[10px] font-bold ${getRoleBg(contact.value)}`}>
                          {getInitials(contact.name)}
                        </span>
                        <div>
                          <p className="text-[13px] font-semibold text-slate-800">{contact.name}</p>
                          <p className="text-[10px] text-slate-400">{contact.area}</p>
                        </div>
                      </div>

                      {/* Messages */}
                      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {thread.length === 0 ? (
                          <p className="text-xs text-slate-400 text-center py-8">No messages yet. Say hi!</p>
                        ) : thread.map(msg => {
                          const isMine = msg.from === currentRole
                          return (
                            <div key={msg.id} className={`flex flex-col gap-0.5 ${isMine ? "items-end" : "items-start"}`}>
                              <div className={`max-w-xs rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                                isMine ? "bg-primary text-primary-foreground rounded-tr-sm" : "bg-muted text-foreground rounded-tl-sm"
                              }`}>
                                {msg.text}
                              </div>
                              <span className="text-[10px] text-slate-400 px-1">{formatChatTime(msg.at)}</span>
                            </div>
                          )
                        })}
                      </div>

                      {/* Input */}
                      <form onSubmit={handleSend} className="px-4 py-3 border-t border-slate-100 flex gap-2 shrink-0 bg-white">
                        <input value={msgText} onChange={e => setMsgText(e.target.value)}
                          placeholder={`Message ${contact.name}…`}
                          className="flex-1 rounded-xl border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50" />
                        <button type="submit" disabled={!msgText.trim()}
                          className="p-2 rounded-xl bg-primary hover:bg-primary/90 disabled:bg-muted text-primary-foreground transition-colors">
                          <SendHorizonal className="w-4 h-4" />
                        </button>
                      </form>
                    </>
                  )
                })() : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <MessageCircle className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">Select a person to start chatting</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
