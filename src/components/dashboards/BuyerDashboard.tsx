'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Activity, CheckCheck, FileText, IndianRupee, Timer } from 'lucide-react'
import type { CapexRequest, VendorInvite } from '@/lib/types'
import { CAPEX_STATUS_FLOW } from '@/lib/types'
import { PLANTS, STATUS_LABELS } from '@/lib/constants'
import { StatusBadge } from '@/components/StatusBadge'
import { PAGE_SHELL } from '@/lib/uiTokens'
import {
  MasterIndex, TERMINAL_STATUSES, allocatedForRequest, ballHolders,
  PARTY_LABELS, medianStageDays, requestValue, statusTally, VALUE_BASIS_LABELS,
} from '@/lib/kpiUtils'
import { buyerQueues } from '@/lib/kpiQueues'
import { metricHref } from '@/lib/kpiRoutes'
import { ActionQueue } from './ActionQueue'
import { DashboardSection } from './Section'
import { DashboardGrid, DashboardHeader, EmptyState, KpiGrid } from './layout'
import { KpiTile } from './KpiTile'
import { DonutChart, STATUS_HEX } from './charts'
import { aria, fmtDays, fmtInr, fmtInrFull } from './format'

export function BuyerDashboard({
  requests, byRequest, index, now, plant,
}: {
  requests: CapexRequest[]
  byRequest: Map<string, VendorInvite[]>
  index: MasterIndex
  now: number
  plant: string | null
}) {
  const stats = useMemo(() => {
    const live = requests.filter(r => !TERMINAL_STATUSES.includes(r.status) && r.status !== 'draft')
    const valueInFlight = live.reduce(
      (s, r) => s + requestValue(r, byRequest.get(r.id) ?? [], index).inr, 0,
    )
    const allocated = live.reduce((s, r) => s + allocatedForRequest(r, index), 0)
    const donut = CAPEX_STATUS_FLOW
      .map(s => ({
        label: STATUS_LABELS[s] ?? s,
        value: requests.filter(r => r.status === s).length,
        color: STATUS_HEX[s] ?? '#94a3b8',
      }))
      .filter(d => d.value > 0)

    // `statusTally` is shared with the `my_requests` list route this tile links to, so the tile's
    // "N requests · C completed · R rejected" and the destination's own line are one derivation.
    const tally = statusTally(requests)

    return {
      total: tally.total,
      completed: tally.completed,
      rejected: tally.rejected,
      live: live.length,
      valueInFlight,
      allocated,
      headTat: medianStageDays(requests, 'pending_head_approval', 'sourcing'),
      fullTat: medianStageDays(requests, 'submitted', 'completed'),
      donut,
    }
  }, [requests, byRequest, index])

  const bands = useMemo(() => buyerQueues(requests, byRequest, now), [requests, byRequest, now])
  const underBudget = stats.allocated > 0 && stats.valueInFlight <= stats.allocated

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <DashboardHeader
        title="My CAPEX Dashboard"
        description={`Your requests${plant ? ` · ${PLANTS.find(p => p.value === plant)?.label ?? plant}` : ''} — what needs you, and where the rest are stuck.`}
      />

      <KpiGrid className="shrink-0">
        <KpiTile
          label="My requests" value={String(stats.total)} icon={FileText}
          sub={`${stats.completed} completed · ${stats.rejected} rejected`}
          // Names the predicate the count uses (every status, drafts and closed included) instead
          // of leaving the destination to whatever the list happens to default to.
          href={metricHref('my_requests')}
          ariaLabel={aria(
            `My requests: ${stats.total}`,
            `${stats.completed} completed`,
            `${stats.rejected} rejected`,
          )}
        />
        <KpiTile
          label="In flight" value={String(stats.live)} icon={Activity}
          sub="not yet completed"
        />
        <KpiTile
          label="Value in flight" value={fmtInr(stats.valueInFlight)} icon={IndianRupee}
          sub={fmtInrFull(stats.valueInFlight)}
          caption={`mixed basis — see ${VALUE_BASIS_LABELS.awarded}/${VALUE_BASIS_LABELS.quoted} per request`}
        />
        <KpiTile
          label="Against allocation"
          value={stats.allocated > 0 ? fmtInr(stats.allocated - stats.valueInFlight) : '—'}
          icon={CheckCheck}
          tone={stats.allocated === 0 ? 'neutral' : underBudget ? 'good' : 'danger'}
          sub={stats.allocated > 0
            ? `${fmtInr(stats.allocated)} allocated · ${underBudget ? 'under' : 'over'}`
            : 'no linked budget lines'}
        />
      </KpiGrid>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <DashboardGrid cols={2}>
          <DashboardSection title="Needs you" level={2} card>
            <ActionQueue
              title="Needs you" variant="mine" buckets={bands.mine}
              emptyText="Nothing is waiting on you." showTitle={false} bare
            />
          </DashboardSection>
          <DashboardSection title="Waiting on others" level={2} card>
            <ActionQueue
              title="Waiting on others" variant="waiting" buckets={bands.waiting}
              emptyText="Nothing in flight." showTitle={false} bare
            />
          </DashboardSection>
        </DashboardGrid>

        {/* The table is the tall block, so it takes a column of its own and the two short cards
            stack beside it — the alternative (table full width, two short cards under it) left a
            half-empty row and pushed the table off the fold. */}
        <DashboardGrid cols={2}>
          <DashboardSection title="Who holds the ball" level={2} card>
            {requests.length === 0 ? (
              <EmptyState
                action={
                  <Link
                    href="/capex/new"
                    className="inline-flex items-center min-h-[44px] text-xs font-semibold text-primary hover:underline"
                  >
                    Raise your first CAPEX request →
                  </Link>
                }
              >
                You have not raised a request yet.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th scope="col" className="px-3 py-2">Request</th>
                      <th scope="col" className="px-3 py-2">Status</th>
                      <th scope="col" className="px-3 py-2">With</th>
                      <th scope="col" className="px-3 py-2 text-right">Waiting</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {requests.map(r => {
                      const holds = ballHolders(r, byRequest.get(r.id) ?? [], now)
                      const worst = holds.reduce((a, b) => (b.days > a.days ? b : a), holds[0])
                      return (
                        <tr key={r.id} className="hover:bg-[#EBF0FB]/60">
                          <td className="px-3 py-2">
                            <Link href={`/capex/${r.id}`} className="font-semibold text-primary hover:underline">
                              {r.requestNo ?? r.id.slice(0, 8)}
                            </Link>
                            <span className="ml-2 text-slate-600">{r.subject}</span>
                          </td>
                          <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                          <td className="px-3 py-2 text-slate-600">{PARTY_LABELS[worst.party]}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                            {worst.party === 'none' ? '—' : fmtDays(worst.days)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardSection>

          <div className="space-y-4">
            {/* Two tiles on the column's own tracks — not a 2-column grid inset inside a card,
                which would sit off the grid its neighbours use (the track rule in `layout.tsx`). */}
            <DashboardSection title="Turnaround" level={2}>
              <KpiGrid cols={2}>
              <KpiTile
                label="Plant-head decision" icon={Timer}
                value={fmtDays(stats.headTat.medianDays)}
                sub={`median over ${stats.headTat.sampled} · ${stats.headTat.stillOpen} still open`}
              />
              <KpiTile
                label="Request → completed" icon={Timer}
                value={fmtDays(stats.fullTat.medianDays)}
                sub={`median over ${stats.fullTat.sampled} · ${stats.fullTat.stillOpen} still open`}
              />
              </KpiGrid>
            </DashboardSection>

            <DashboardSection title="My requests by status" level={2} card>
              <DonutChart data={stats.donut} />
            </DashboardSection>
          </div>
        </DashboardGrid>
      </div>
    </div>
  )
}
