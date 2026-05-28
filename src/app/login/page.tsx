"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const ROLES = [
  { value: "buyer",          label: "Buyer" },
  { value: "sourcing_member",label: "Sourcing Member" },
  { value: "sourcing_head",  label: "Sourcing Head" },
  { value: "super_admin",    label: "Super Admin" },
]


export default function LoginPage() {
  const router = useRouter()
  const [email,    setEmail]    = useState("")
  const [password, setPassword] = useState("")
  const [role,     setRole]     = useState("buyer")
  const [showPass, setShowPass] = useState(false)
  const [loading,  setLoading]  = useState(false)

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setTimeout(() => {
      localStorage.setItem("capex_role", role)
      window.dispatchEvent(new CustomEvent("capex_rolechange", { detail: role }))
      router.push("/capex/requests")
    }, 600)
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex">

      {/* Full-bleed backdrop */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url("https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1920&q=80")` }}
      />
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/70 to-slate-950/50" />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/50 via-transparent to-transparent" />

      {/* Left — hero branding */}
      <div className="relative z-10 flex flex-col justify-between flex-1 px-16 py-14 select-none">

        <div className="flex items-center gap-2.5">
          <img src="/amber-logo.png" alt="Amber" className="h-6 w-auto object-contain brightness-0 invert opacity-80" />
          <div className="h-4 w-px bg-white/20" />
          <span className="text-[11px] font-semibold text-white/45 tracking-[0.15em] uppercase">CAPEX Portal</span>
        </div>

        <div className="space-y-6 max-w-lg">
          <p className="text-[11px] font-bold tracking-[0.2em] text-amber-400 uppercase">
            Capital Expenditure Management
          </p>
          <h1 className="text-[52px] leading-[1.05] font-black text-white tracking-tight">
            Full pipeline<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-amber-500">
              visibility
            </span>
            , from<br />
            request to closure.
          </h1>
          <p className="text-white/45 text-[15px] leading-relaxed">
            Track vendor sourcing, quote negotiation, and approvals across all Amber CAPEX requests.
          </p>


        </div>

        <p className="text-white/20 text-[11px] tracking-wide">
          Amber Enterprises Ltd. All rights reserved.
        </p>
      </div>

      {/* Right — glass login card */}
      <div className="relative z-10 flex items-center justify-center w-[440px] shrink-0 px-10 py-14">
        <div className="w-full bg-white/10 backdrop-blur-2xl border border-white/15 rounded-3xl p-8 shadow-2xl">

          <div className="mb-8">
            <h2 className="text-[22px] font-bold text-white leading-tight">Sign in</h2>
            <p className="text-white/40 text-sm mt-1">Amber Enterprises CAPEX Portal</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Login ID */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">
                Login ID
              </label>
              <input
                type="text"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="yourname@amberenterprises.in"
                className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400/40 transition-all"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 pr-11 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:ring-amber-400/60 focus:border-amber-400/40 transition-all"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Role switcher */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">
                Sign in as
              </label>
              <Select value={role} onValueChange={v => { if (v) setRole(v) }}>
                <SelectTrigger className="w-full bg-white/10 border-white/15 text-white data-placeholder:text-white/25 focus:ring-amber-400/60 h-11 rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-[14px] transition-all duration-200",
                  loading
                    ? "bg-white/10 text-white/30 cursor-not-allowed"
                    : "bg-amber-400 hover:bg-amber-300 text-slate-900 shadow-lg shadow-amber-400/20 active:scale-[0.99]"
                )}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Signing in…
                  </span>
                ) : (
                  <>Sign In <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

    </div>
  )
}
