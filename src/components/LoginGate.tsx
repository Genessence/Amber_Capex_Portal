"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { RETIRED_ROLES } from "@/lib/constants"

export function LoginGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const role = localStorage.getItem("capex_role")
    // A retired role (Plant Accounts / Global Accounts / the old head roles) would leave the user
    // with no navigation at all — clear it and send them back to the role picker.
    if (role && (RETIRED_ROLES as readonly string[]).includes(role)) {
      localStorage.removeItem("capex_role")
      router.replace("/login")
      return
    }
    if (!role) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  if (!ready) return null
  return <>{children}</>
}
