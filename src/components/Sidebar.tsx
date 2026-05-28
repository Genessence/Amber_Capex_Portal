"use client"
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from "react"
import {
  FilePlus, List, Users, Settings,
  ChevronLeft, ChevronRight, LogOut,
  LayoutDashboard,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ROLE_META: Record<string, { name: string; label: string; colorClass: string; dot: string }> = {
  buyer:             { name: "Arjun Mehta",     label: "Buyer",             colorClass: "bg-blue-600",   dot: "bg-blue-500"   },
  sourcing_member:   { name: "Neha Kapoor",     label: "Sourcing Engineer", colorClass: "bg-violet-600", dot: "bg-violet-500" },
  sourcing_member_2: { name: "Vikram Malhotra", label: "Sourcing Engineer", colorClass: "bg-violet-600", dot: "bg-violet-500" },
  sourcing_member_3: { name: "Priya Nair",      label: "Sourcing Engineer", colorClass: "bg-violet-600", dot: "bg-violet-500" },
  sourcing_member_4: { name: "Ananya Reddy",    label: "Sourcing Engineer", colorClass: "bg-violet-600", dot: "bg-violet-500" },
  sourcing_head:     { name: "Rajiv Sinha",     label: "Sourcing Head",     colorClass: "bg-violet-800", dot: "bg-violet-700" },
  super_admin:       { name: "Super Admin",     label: "Full Access",       colorClass: "bg-slate-700",  dot: "bg-slate-500"  },
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

type NavLink = {
  href: string
  label: string
  icon: React.ElementType
  roles?: string[]
}

const NAV: NavLink[] = [
  { href: '/capex/dashboard',  label: 'Dashboard',   icon: LayoutDashboard },
  { href: '/capex/new',        label: 'New Request', icon: FilePlus, roles: ['buyer', 'super_admin'] },
  { href: '/capex/requests',   label: 'Requests',    icon: List },
  { href: '/sourcing/vendors', label: 'Vendors',     icon: Users,    roles: ['sourcing_member', 'sourcing_member_2', 'sourcing_member_3', 'sourcing_member_4', 'sourcing_head', 'super_admin'] },
  { href: '/settings',         label: 'Settings',    icon: Settings, roles: ['super_admin'] },
]

export function Sidebar() {
  const pathname    = usePathname()
  const router      = useRouter()
  const [currentRole, setCurrentRole] = useState("buyer")
  const [collapsed,   setCollapsed]   = useState(false)

  useEffect(() => {
    const storedRole = localStorage.getItem('capex_role')
    if (storedRole) setCurrentRole(storedRole)
    const storedCollapsed = localStorage.getItem('sidebar_collapsed')
    if (storedCollapsed === 'true') setCollapsed(true)

    const onRoleChange = (e: CustomEvent) => setCurrentRole(e.detail)
    window.addEventListener('capex_rolechange', onRoleChange as EventListener)
    return () => window.removeEventListener('capex_rolechange', onRoleChange as EventListener)
  }, [])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('sidebar_collapsed', String(next))
  }

  const resetAndLogout = () => {
    localStorage.removeItem("capex_role")
    router.push("/login")
  }

  const meta         = ROLE_META[currentRole] ?? ROLE_META.buyer
  const visibleLinks = NAV.filter(link => !link.roles || link.roles.includes(currentRole))

  return (
    <div
      role="navigation"
      aria-label="Primary navigation"
      className={cn(
        "flex h-screen flex-col border-r border-slate-200 bg-white transition-all duration-200 overflow-x-hidden shrink-0",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* ── Branding ─────────────────────────────────────────── */}
      <div
        className={cn(
          "shrink-0 border-b border-slate-200 relative overflow-hidden",
          collapsed ? "flex items-center justify-center h-14" : "px-4 py-3"
        )}
      >
        {collapsed ? (
          <div
            aria-label="Amber Enterprises CAPEX Portal"
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: "linear-gradient(135deg,#F59E0B,#D97706)" }}
          >
            <span className="text-white text-base font-black leading-none select-none" aria-hidden="true">A</span>
          </div>
        ) : (
          <>
            {/* amber accent bar */}
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 bottom-0 w-0.5"
              style={{ background: "linear-gradient(180deg,#F59E0B,#D97706)" }}
            />
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 bottom-0 w-8 opacity-[0.04]"
              style={{ background: "linear-gradient(90deg,#F59E0B,transparent)" }}
            />
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/amber-logo.png" alt="Amber Enterprises" className="h-7 w-auto object-contain shrink-0" />
              <div>
                <p className="text-[13px] font-bold text-slate-900 leading-tight tracking-tight">CAPEX Portal</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Nav links ────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" aria-label="Workspace">
        {!collapsed && (
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-2 mb-2" aria-hidden="true">
            Workspace
          </p>
        )}
        {visibleLinks.map(link => {
          const Icon     = link.icon
          const isActive = pathname === link.href || pathname.startsWith(link.href + '/')
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-label={collapsed ? link.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center rounded-lg text-[13px] font-medium transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1",
                collapsed ? "justify-center w-11 h-11 mx-auto" : "gap-2.5 px-3 py-2.5",
                isActive
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-colors",
                  collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
                  isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700"
                )}
              />
              {!collapsed && <span>{link.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* ── Collapse toggle ───────────────────────────────────── */}
      <div className="px-2 pb-2">
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={cn(
            "flex items-center rounded-lg text-[12px] font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1",
            collapsed ? "justify-center w-11 h-11 mx-auto" : "gap-2 px-3 py-2.5 w-full"
          )}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" aria-hidden="true" />
            : (
              <>
                <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                <span>Collapse</span>
              </>
            )
          }
        </button>
      </div>

      {/* ── User footer ───────────────────────────────────────── */}
      <div className="border-t border-slate-200 p-2 space-y-1">
        {/* identity row — not interactive, just display */}
        <div
          aria-label={`Signed in as ${meta.name}, ${meta.label}`}
          className={cn(
            "flex items-center rounded-lg",
            collapsed ? "justify-center p-1.5" : "gap-2.5 px-2 py-2"
          )}
        >
          {/* avatar */}
          <div className="relative shrink-0" aria-hidden="true">
            <div
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-white text-[11px] font-bold",
                meta.colorClass
              )}
            >
              {getInitials(meta.name)}
            </div>
            {/* online dot */}
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white",
                meta.dot
              )}
            />
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-slate-800 truncate leading-tight">{meta.name}</p>
              <p className="text-[11px] text-slate-400 truncate leading-tight">{meta.label}</p>
            </div>
          )}
        </div>

        {/* logout */}
        <button
          onClick={resetAndLogout}
          aria-label="Log out"
          className={cn(
            "flex items-center rounded-lg text-[12px] font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1",
            collapsed ? "justify-center w-11 h-9 mx-auto" : "gap-2 px-2 py-2 w-full"
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </div>
  )
}
