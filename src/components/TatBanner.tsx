'use client'

import { useEffect, useState } from 'react'
import { Timer, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { computeTat, formatDaysFromMs } from '@/lib/tatUtils'

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

/**
 * Live TAT / delay-liability banner. Recomputes every 60s. Renders only once a PI is submitted.
 */
export function TatBanner({
  piSubmittedAt,
  tatStoppedAt,
  vendorAmount,
}: {
  piSubmittedAt?: string
  tatStoppedAt?: string
  vendorAmount: number
}) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  if (now == null) return null
  const tat = computeTat({ piSubmittedAt, vendorAmount, tatStoppedAt, now })
  if (!tat.applicable) return null

  // Closed — final payment made.
  if (!tat.running) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-slate-600 mt-0.5" />
        <div>
          <p className="font-semibold text-slate-900">TAT Closed — Final Payment Made</p>
          <p className="text-sm text-slate-800/80 mt-0.5">
            {tat.deductionPct > 0
              ? `Delay liability of ${tat.deductionPct}% (${fmt(tat.deductionAmount)}) applied.`
              : 'Delivered within TAT — no delay deduction.'}
          </p>
        </div>
      </div>
    )
  }

  // Within grace — clock hasn't started accruing yet.
  if (tat.weeksLate === 0 && tat.msToGrace > 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <Timer className="w-5 h-5 text-slate-600 mt-0.5" />
        <div>
          <p className="font-semibold text-slate-900">TAT Clock — Grace Period</p>
          <p className="text-sm text-slate-800/80 mt-0.5">
            Delay liability begins in {formatDaysFromMs(tat.msToGrace)} (PI + 1 week). No deduction yet.
          </p>
        </div>
      </div>
    )
  }

  // Running and late.
  const escalated = tat.escalated
  return (
    <div className={`rounded-xl border p-4 flex items-start gap-3 ${escalated ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <AlertTriangle className={`w-5 h-5 mt-0.5 ${escalated ? 'text-red-600' : 'text-slate-600'}`} />
      <div>
        <p className={`font-semibold ${escalated ? 'text-red-900' : 'text-slate-900'}`}>
          TAT Running — {tat.weeksLate} week{tat.weeksLate === 1 ? '' : 's'} late
        </p>
        <p className={`text-sm mt-0.5 ${escalated ? 'text-red-800/80' : 'text-slate-800/80'}`}>
          Delay liability: <span className="font-bold">{tat.deductionPct}%</span> ({fmt(tat.deductionAmount)})
          {escalated
            ? ' — escalated rate of 5% per week is in effect (past the 5% threshold).'
            : ' — accruing at 0.5% per week up to 5%.'}
        </p>
      </div>
    </div>
  )
}
