"use client"
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from "react"
import {
  FilePlus, List, Users, Settings,
  ChevronLeft, ChevronRight, LogOut,
  LayoutDashboard, TableProperties,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCapex } from '@/lib/capexContext'
import type { PlantMeta } from '@/lib/types'

const ROLE_META: Record<string, { name: string; label: string; colorClass: string; dot: string; plant?: string }> = {
  buyer:                  { name: "Arjun Mehta",  label: "Buyer",                colorClass: "bg-blue-600",   dot: "bg-blue-500"   },
  buyer_jhajjar_p1:       { name: "Arjun Mehta",  label: "Buyer · Jhajjar P1",   colorClass: "bg-blue-600",   dot: "bg-blue-500",  plant: "jhajjar_p1" },
  buyer_jhajjar_p2:       { name: "Ravi Kumar",   label: "Buyer · Jhajjar P2",   colorClass: "bg-blue-600",   dot: "bg-blue-500",  plant: "jhajjar_p2" },
  sourcing_member:        { name: "Neha Kapoor",  label: "Sourcing Member",      colorClass: "bg-violet-600", dot: "bg-violet-500" },
  plant_head:             { name: "Karan Mehta",  label: "Plant Head",           colorClass: "bg-[#0D9488]",  dot: "bg-[#14B8A6]", plant: "all" },
  plant_head_jhajjar_p1:  { name: "Karan Mehta",  label: "Plant Head · P1",      colorClass: "bg-[#0D9488]",  dot: "bg-[#14B8A6]", plant: "jhajjar_p1" },
  plant_head_jhajjar_p2:  { name: "Ajay Gupta",   label: "Plant Head · P2",      colorClass: "bg-[#0D9488]",  dot: "bg-[#14B8A6]", plant: "jhajjar_p2" },
  sourcing_head:          { name: "Rajiv Sinha",  label: "Sourcing Head",        colorClass: "bg-violet-800", dot: "bg-violet-700" },
  super_admin:            { name: "Super Admin",  label: "Full Access",          colorClass: "bg-slate-700",  dot: "bg-slate-500"  },
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function buildDynamicMeta(role: string, customPlants: PlantMeta[]) {
  for (const p of customPlants) {
    if (role === `buyer_${p.value}`)
      return { name: p.assignedUser ?? "Buyer", label: `Buyer · ${p.label}`, colorClass: "bg-blue-600", dot: "bg-blue-500" }
    if (role === `plant_head_${p.value}`)
      return { name: p.assignedUser ?? "Plant Head", label: `Plant Head · ${p.label}`, colorClass: "bg-[#0D9488]", dot: "bg-[#14B8A6]" }
  }
  return null
}

function roleCanSeeLink(role: string, linkRoles: string[] | undefined): boolean {
  if (!linkRoles) return true
  if (linkRoles.includes(role)) return true
  if (role.startsWith('buyer_') && linkRoles.some(r => r.startsWith('buyer_'))) return true
  if (role.startsWith('plant_head_') && linkRoles.some(r => r.startsWith('plant_head_'))) return true
  return false
}

type NavLink = {
  href: string
  label: string
  icon: React.ElementType
  roles?: string[]
  params?: string
}

const NAV: NavLink[] = [
  { href: '/capex/dashboard',  label: 'Dashboard',        icon: LayoutDashboard, roles: ['buyer', 'buyer_jhajjar_p1', 'buyer_jhajjar_p2', 'sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/capex/new',        label: 'New Request',       icon: FilePlus,        roles: ['buyer', 'buyer_jhajjar_p1', 'buyer_jhajjar_p2', 'super_admin'] },
  { href: '/capex/requests',   label: 'Pending Approvals', icon: List,            roles: ['plant_head', 'plant_head_jhajjar_p1', 'plant_head_jhajjar_p2'], params: '?filter=pending_head_approval' },
  { href: '/capex/requests',   label: 'All Requests',      icon: List,            roles: ['plant_head', 'plant_head_jhajjar_p1', 'plant_head_jhajjar_p2'] },
  { href: '/capex/requests',   label: 'Requests',          icon: List,            roles: ['buyer', 'buyer_jhajjar_p1', 'buyer_jhajjar_p2', 'sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/sourcing/vendors', label: 'Vendors',           icon: Users,           roles: ['sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/capex/master',     label: 'CAPEX Master',      icon: TableProperties, roles: ['plant_head', 'plant_head_jhajjar_p1', 'plant_head_jhajjar_p2', 'sourcing_member', 'sourcing_head', 'super_admin'] },
  { href: '/settings',         label: 'Configurations',    icon: Settings,        roles: ['super_admin'] },
]

export function Sidebar() {
  const pathname    = usePathname()
  const router      = useRouter()
  const searchParams = useSearchParams()
  const currentSearch = searchParams.toString() ? `?${searchParams.toString()}` : ''
  const [currentRole, setCurrentRole] = useState("buyer")
  const [collapsed,   setCollapsed]   = useState(false)
  const { customPlants } = useCapex()

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

  const meta         = ROLE_META[currentRole] ?? buildDynamicMeta(currentRole, customPlants) ?? ROLE_META.buyer
  const visibleLinks = NAV.filter(link => roleCanSeeLink(currentRole, link.roles))

  return (
    <div
      role="navigation"
      aria-label="Primary navigation"
      className={cn(
        "flex h-screen flex-col border-r border-[#2558B8] bg-[#2558B8] transition-all duration-200 overflow-x-hidden shrink-0",
        collapsed ? "w-14" : "w-56"
      )}
    >
      {/* ── Branding ─────────────────────────────────────────── */}
      <div
        className={cn(
          "shrink-0 border-b border-white/10 relative overflow-hidden",
          collapsed ? "flex items-center justify-center h-14" : "px-4 py-3"
        )}
      >
        {collapsed ? (
          <div
            aria-label="Amber Enterprises CAPEX Portal"
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm"
            style={{ background: "linear-gradient(135deg,#0D9488,#0a7a70)" }}
          >
            <span className="text-white text-base font-black leading-none select-none" aria-hidden="true">A</span>
          </div>
        ) : (
          <>
            {/* white accent bar */}
            <div
              aria-hidden="true"
              className="absolute left-0 top-0 bottom-0 w-0.5 bg-white/10"
            />
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/amber-logo.png" alt="Amber Enterprises" className="h-7 w-auto object-contain shrink-0" />
              <div>
                <p className="text-[13px] font-bold text-white leading-tight tracking-tight">CAPEX Portal</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Nav links ────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5" aria-label="Workspace">
        {!collapsed && (
          <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest px-2 mb-2" aria-hidden="true">
            Workspace
          </p>
        )}
        {visibleLinks.map((link, idx) => {
          const Icon     = link.icon
          const fullHref = `${link.href}${link.params ?? ''}`
          const isActive = link.params
            ? pathname === link.href && currentSearch === link.params
            : (pathname === link.href || pathname.startsWith(link.href + '/'))
              && !visibleLinks.some(l => l.params && l.href === link.href && currentSearch === l.params)
          return (
            <Link
              key={`${link.href}-${idx}`}
              href={fullHref}
              aria-label={collapsed ? link.label : undefined}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group flex items-center rounded-lg text-[13px] font-medium transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1",
                collapsed ? "justify-center w-11 h-11 mx-auto" : "gap-2.5 px-3 py-2.5",
                isActive
                  ? "bg-white/[0.11] border-l-[2.5px] border-[#0D9488] text-white pl-[9px]"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "shrink-0 transition-colors",
                  collapsed ? "h-[18px] w-[18px]" : "h-4 w-4",
                  isActive ? "text-white" : "text-white/40 group-hover:text-white"
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
            "flex items-center rounded-lg text-[12px] font-medium text-white/50 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488] focus-visible:ring-offset-1",
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
      <div className="border-t border-white/10 p-2 space-y-1">
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
                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#2558B8]",
                meta.dot
              )}
            />
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-white truncate leading-tight">{meta.name}</p>
              <p className="text-[11px] text-white/50 truncate leading-tight">{meta.label}</p>
            </div>
          )}
        </div>

        {/* logout */}
        <button
          onClick={resetAndLogout}
          aria-label="Log out"
          className={cn(
            "flex items-center rounded-lg text-[12px] font-medium text-white/50 hover:bg-white/10 hover:text-red-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1",
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
