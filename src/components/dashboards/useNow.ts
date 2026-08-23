'use client'

import { useEffect, useState } from 'react'

/**
 * A coarse clock for aging + TAT figures, refreshed every 60s (matching `TatBanner`).
 *
 * Starts at 0 rather than `Date.now()`: these are client components but Next still renders them
 * on the server, and a real timestamp in the initial state would differ between the two passes
 * and trip a hydration mismatch. Callers render a skeleton while `now === 0`.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
