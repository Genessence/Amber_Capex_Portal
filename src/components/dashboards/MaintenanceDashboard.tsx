'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ClipboardList, RotateCcw, Scissors, Timer } from 'lucide-react'
import type { BudgetProposal } from '@/lib/types'
import { PAGE_SHELL } from '@/lib/uiTokens'
import { ageInDays, median } from '@/lib/kpiUtils'
import { maintenanceQueues } from '@/lib/kpiQueues'
import {
  approverEditImpact, BUDGET_PROPOSAL_STATUS_COLORS, BUDGET_PROPOSAL_STATUS_LABELS,
  proposalTotalCr, summarizeProposalByHead,
} from '@/lib/budgetProposalUtils'
import { ActionQueue } from './ActionQueue'
import { DashboardSection } from './Section'
import { DashboardGrid, DashboardHeader, EmptyState, KpiGrid } from './layout'
import { KpiTile } from './KpiTile'
import { HBarChart } from './charts'
import { approverEditPresentation, aria, fmtCr, fmtDays } from './format'

const DAY = 86_400_000

export function MaintenanceDashboard({ now, proposals: all }: { now: number; proposals: BudgetProposal[] }) {
  // Proposals are stamped with the raw role value at creation (`createBlankProposal({ createdBy: role })`
  // in capex/budget-proposals/page.tsx) — not the ROLE_NAMES display name — so scope on the role key.
  const proposals = useMemo(
    () => all.filter(p => p.createdBy === 'maintenance'),
    [all],
  )

  const stats = useMemo(() => {
    const published = proposals.filter(p => p.status === 'approved')
    const proposedCr = proposals.reduce((s, p) => s + proposalTotalCr(p), 0)
    const publishedCr = published.reduce((s, p) => s + proposalTotalCr(p), 0)
    const editImpact = approverEditImpact(proposals)
    const turnarounds = published
      .map(p => (p.submittedAt && p.accountsDecidedAt
        ? (new Date(p.accountsDecidedAt).getTime() - new Date(p.submittedAt).getTime()) / DAY
        : null))
      .filter((d): d is number => d != null && d >= 0)

    // Head composition of the most recent target FY the author is working on. Grouping goes
    // through the canonical `summarizeProposalByHead` (also used by capex/budget-proposals) so
    // this never drifts from the Budget Planning page's own per-head breakdown.
    const latest = [...proposals].sort((a, b) =>
      (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))[0]

    return {
      proposedCr, publishedCr,
      trimCr: editImpact.trimCr,
      turnaround: median(turnarounds),
      turnaroundSample: turnarounds.length,
      resubmits: editImpact.resubmits,
      latest,
      headBars: summarizeProposalByHead(latest?.items ?? [])
        .map(h => ({ label: h.head, value: Number(h.totalCr.toFixed(2)) })),
    }
  }, [proposals])

  const bands = useMemo(() => maintenanceQueues(proposals, now), [proposals, now])

  // Label / sign / tone flip lives in one shared helper so this tile and the Administration
  // "Approver edit impact" tile — the same derived quantity — can never disagree.
  const edit = approverEditPresentation(stats.trimCr)

  return (
    <div className={`${PAGE_SHELL} space-y-4`}>
      <DashboardHeader
        title="Budget Planning Dashboard"
        description="Your next-FY proposals — what needs your rework, where each one sits, and what approvers changed."
      />

      <KpiGrid className="shrink-0">
        <KpiTile
          label="Proposed" value={fmtCr(stats.proposedCr)} icon={ClipboardList}
          sub={`${proposals.length} proposal(s)`} href="/capex/budget-proposals"
          ariaLabel={aria(`Proposed: ${fmtCr(stats.proposedCr)}`, `${proposals.length} proposal(s)`)}
        />
        <KpiTile
          label="Published live" value={fmtCr(stats.publishedCr)} icon={ClipboardList}
          tone={stats.publishedCr > 0 ? 'good' : 'neutral'} sub="approved and live on master"
          href="/capex/budget-proposals"
          ariaLabel={aria(`Published live: ${fmtCr(stats.publishedCr)}`, 'approved and live on master')}
        />
        <KpiTile
          label={edit.label} value={edit.value} icon={Scissors}
          tone={edit.tone} caption={edit.caption}
          href="/capex/budget-proposals"
          ariaLabel={aria(`${edit.label}: ${edit.value}`, edit.caption)}
        />
        <KpiTile
          label="Approval turnaround" value={fmtDays(stats.turnaround)} icon={Timer}
          sub={`median over ${stats.turnaroundSample} published`} href="/capex/budget-proposals"
          ariaLabel={aria(`Approval turnaround: ${fmtDays(stats.turnaround)}`, `median over ${stats.turnaroundSample} published`)}
        />
      </KpiGrid>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
        <DashboardGrid cols={2}>
          <DashboardSection title="Needs you" level={2} card>
            <ActionQueue
              title="Needs you" variant="mine" buckets={bands.mine}
              emptyText="Nothing needs your rework." showTitle={false} bare
            />
          </DashboardSection>
          <DashboardSection title="With approvers" level={2} card>
            <ActionQueue
              title="With approvers" variant="waiting" buckets={bands.waiting}
              emptyText="Nothing is in approval." showTitle={false} bare
            />
          </DashboardSection>
        </DashboardGrid>

        <DashboardGrid cols={2}>
          <DashboardSection
            title={stats.latest ? `FY ${stats.latest.targetFy} composition by head (₹ Cr)` : 'Composition by head (₹ Cr)'}
            level={2}
            card
          >
            <HBarChart data={stats.headBars} emptyText="No lines authored yet." />
          </DashboardSection>

          <DashboardSection
            title="Rework"
            level={2}
            card
            aside={
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {stats.resubmits} resubmission(s)
              </span>
            }
          >
            {proposals.length === 0 ? (
              <EmptyState
                action={
                  <Link
                    href="/capex/budget-proposals"
                    className="inline-flex items-center min-h-[44px] text-xs font-semibold text-primary hover:underline"
                  >
                    Start next year&rsquo;s budget →
                  </Link>
                }
              >
                You have not authored a budget yet.
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th scope="col" className="px-3 py-2">Target FY</th>
                      <th scope="col" className="px-3 py-2 text-right">Total</th>
                      <th scope="col" className="px-3 py-2">Stage</th>
                      <th scope="col" className="px-3 py-2 text-right">Age</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {proposals.map(p => (
                      <tr key={p.id} className="hover:bg-[#EBF0FB]/60">
                        <td className="px-3 py-2 font-semibold">
                          <Link href="/capex/budget-proposals" className="text-primary hover:underline">
                            {p.targetFy || '—'}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtCr(proposalTotalCr(p))}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[p.status]}`}>
                            {BUDGET_PROPOSAL_STATUS_LABELS[p.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                          {fmtDays(ageInDays(p.submittedAt ?? p.createdAt, now))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardSection>
        </DashboardGrid>
      </div>
    </div>
  )
}
