'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useCapex } from '@/lib/capexContext'
import { getPlantForRole, ROLE_NAMES } from '@/lib/constants'
import { invitesByRequest, masterIndex } from '@/lib/kpiUtils'
import { useNow } from '@/components/dashboards/useNow'
import { BuyerDashboard } from '@/components/dashboards/BuyerDashboard'
import { SourcingDashboard } from '@/components/dashboards/SourcingDashboard'
import { AdminDashboard } from '@/components/dashboards/AdminDashboard'
import { MaintenanceDashboard } from '@/components/dashboards/MaintenanceDashboard'

function DashboardResolver() {
  const capex = useCapex()
  const now = useNow()
  const [role, setRole] = useState('buyer')

  useEffect(() => {
    setRole(localStorage.getItem('capex_role') ?? 'buyer')
    const onChange = (e: Event) => setRole((e as CustomEvent).detail as string)
    window.addEventListener('capex_rolechange', onChange as EventListener)
    return () => window.removeEventListener('capex_rolechange', onChange as EventListener)
  }, [])

  const byRequest = useMemo(() => invitesByRequest(capex.invites), [capex.invites])
  const index = useMemo(() => masterIndex(capex.capexMaster), [capex.capexMaster])

  // `now` is 0 until the clock hook mounts (see useNow — hydration safety).
  if (now === 0) {
    return (
      <div className="p-5 h-full flex items-center justify-center">
        <p className="text-sm text-slate-400">Loading dashboard…</p>
      </div>
    )
  }

  const shared = { now, byRequest, index }

  // Explicit props, never the whole context — these are presentational components.
  if (role === 'sourcing_member') {
    return (
      <SourcingDashboard
        {...shared}
        requests={capex.requests.filter(r => r.assignedTo === 'sourcing_member')}
        vendors={capex.vendors}
        customPlants={capex.customPlants}
        snapshots={capex.kpiSnapshots}
      />
    )
  }
  if (role === 'super_admin') {
    return (
      <AdminDashboard
        {...shared}
        requests={capex.requests}
        capexMaster={capex.capexMaster}
        budgetProposals={capex.budgetProposals}
        adhocBudgetRequests={capex.adhocBudgetRequests}
        brownFieldHeadAllocations={capex.brownFieldHeadAllocations}
        usedAmountByMasterItemId={capex.usedAmountByMasterItemId}
        customPlants={capex.customPlants}
        snapshots={capex.kpiSnapshots}
      />
    )
  }
  if (role === 'maintenance') {
    return <MaintenanceDashboard now={now} proposals={capex.budgetProposals} />
  }

  // Every buyer variant, and any unknown role, lands here.
  const plant = getPlantForRole(role)
  const currentUser = ROLE_NAMES[role] ?? ''
  const mine = capex.requests.filter(
    r => r.createdBy === currentUser && (!plant || r.plant === plant),
  )
  return <BuyerDashboard {...shared} requests={mine} plant={plant} />
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-5 text-slate-400">Loading…</div>}>
      <DashboardResolver />
    </Suspense>
  )
}
