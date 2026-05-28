"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

export function LoginGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem("capex_role")) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  if (!ready) return null
  return <>{children}</>
}
