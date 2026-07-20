'use client'

import { toast } from 'sonner'
import { CheckCheck, FileInput, BadgeCheck, ClipboardCheck } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { ROLE_NAMES } from '@/lib/constants'
import { buildAwardGroups } from '@/lib/paymentUtils'
import { fmtCurrency } from '@/lib/auctionTheme'
import { TECH_SPEC_STATUS_LABELS, effectiveTechSpecStatus, techSpecBlocksAward } from '@/lib/techSpecUtils'
import type { CapexRequest, Vendor, VendorInvite } from '@/lib/types'

const AWARD_STATUS_LABEL: Record<string, string> = {
  awarded: 'Awarded',
  pi_requested: 'PI requested',
  pi_submitted: 'PI submitted',
  accounts_processing: 'With accounts',
  payment_in_progress: 'Payment in progress',
  completed: 'Completed',
}

/**
 * Unified Final-Decision action bar for BOTH the RFQ and reverse-auction grids. Whatever vendors
 * sourcing picked in the per-line Final Decision column are grouped into awards (split award), and
 * approved + their Proforma Invoice requested either ALL AT ONCE or EACH SEPARATELY — there is no
 * per-vendor approval step on the individual vendor columns. Approving is restricted to the sourcing
 * head / admin; `canAward` gates timing (e.g. the auction must have ended).
 */
export function FinalDecisionActions({
  request,
  invites,
  vendors,
  currentRole,
  canAward,
  blockedReason,
}: {
  request: CapexRequest
  invites: VendorInvite[]
  vendors: Vendor[]
  currentRole: string
  canAward: boolean
  blockedReason?: string
}) {
  const { awardAndRequestPi } = useCapex()
  // Sourcing team can award directly — there is no sourcing-head gate.
  const canFinalize = ['sourcing_member', 'super_admin'].includes(currentRole)
  const actor = ROLE_NAMES[currentRole] ?? currentRole
  const lineItems = request.lineItems ?? []
  const sd = request.sourcingDecision
  const vendorName = (id: string) => vendors.find(v => v.id === id)?.vendorName ?? id
  const inviteFor = (vendorId: string) => invites.find(i => i.vendorId === vendorId)

  const groups = sd?.finalVendorPerItem
    ? buildAwardGroups(lineItems, sd.finalPrices ?? {}, sd.finalVendorPerItem)
    : []
  const allLinesDecided =
    lineItems.length > 0 &&
    lineItems.every(
      it => !!sd?.finalVendorPerItem?.[it.id] && Number(sd?.finalPrices?.[`${it.id}-price`] ?? 0) > 0,
    )
  const pending = groups.filter(g => !inviteFor(g.vendorId)?.awarded)

  // Technical-spec sign-off is a hard pre-award gate, per vendor. Mirrors the guard inside
  // `awardAndRequestPi` so the UI explains the block instead of silently no-op'ing.
  const specBlocked = (vendorId: string) => {
    const inv = inviteFor(vendorId)
    return !inv || techSpecBlocksAward(inv)
  }
  const blockedPending = pending.filter(g => specBlocked(g.vendorId))
  const allBlocked = blockedPending.length === pending.length && pending.length > 0

  function go(vendorId?: string) {
    if (!allLinesDecided) {
      toast.error('Select a vendor and final price for every line first.')
      return
    }
    const blocked = (vendorId ? [vendorId] : pending.map(g => g.vendorId)).filter(specBlocked)
    if (blocked.length) {
      toast.error(
        `Technical specification not approved for ${blocked.map(vendorName).join(', ')} — send it to the Technical team first.`,
      )
      return
    }
    awardAndRequestPi(request.id, sd, actor, vendorId)
    toast.success(
      vendorId
        ? `Awarded ${vendorName(vendorId)} — Proforma Invoice requested`
        : `Awarded ${pending.length - blockedPending.length} vendor(s) — Proforma Invoice requested`,
    )
  }

  const box = 'rounded-lg border border-slate-200 bg-white p-4'

  if (!canFinalize) {
    return <div className={`${box} text-sm text-slate-500`}>Awaiting the sourcing team to award the Final Decision.</div>
  }
  if (groups.length === 0) {
    return (
      <div className={`${box} text-sm text-slate-500`}>
        Pick a vendor and final price for each line in the{' '}
        <span className="font-semibold text-slate-700">Final Decision</span> column to approve &amp; request PIs.
      </div>
    )
  }

  return (
    <div className={`${box} space-y-3`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-slate-900">Final Decision — Approve &amp; Request PI</p>
          <p className="text-xs text-slate-500">
            {groups.length} vendor{groups.length !== 1 ? 's' : ''} selected — approve all at once, or each separately.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAward || !allLinesDecided || pending.length === 0 || blockedPending.length > 0}
          onClick={() => go()}
          title={
            blockedPending.length
              ? `Technical specification pending for ${blockedPending.map(g => vendorName(g.vendorId)).join(', ')}`
              : undefined
          }
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#171717] hover:bg-black text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
          <CheckCheck className="w-4 h-4" /> Approve &amp; Request PI — All{pending.length ? ` (${pending.length})` : ''}
        </button>
      </div>
      {!canAward && blockedReason && <p className="text-xs text-amber-700">{blockedReason}</p>}
      {blockedPending.length > 0 && (
        <p className="text-xs text-amber-700">
          {allBlocked ? 'Technical specification approval is pending' : 'Technical specification approval is pending for'}{' '}
          <span className="font-semibold">{blockedPending.map(g => vendorName(g.vendorId)).join(', ')}</span>
          {' '}— send the machine spec to Amber&apos;s Technical team above and award once it is approved.
        </p>
      )}
      {request.trialRequired && (
        <p className="text-[11px] font-semibold text-blue-700">Item trial is ON — the awarded vendor(s) will upload a trial and the final payment is blocked until you approve it.</p>
      )}
      <div className="border-t border-slate-100 divide-y divide-slate-100">
        {groups.map(g => {
          const inv = inviteFor(g.vendorId)
          const awarded = !!inv?.awarded
          return (
            <div key={g.vendorId} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{vendorName(g.vendorId)}</p>
                <p className="text-xs text-slate-500">
                  {g.itemIds.length} line{g.itemIds.length !== 1 ? 's' : ''} · {fmtCurrency(g.amount)} incl. GST
                </p>
              </div>
              {awarded ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                  <BadgeCheck className="w-3.5 h-3.5" /> {AWARD_STATUS_LABEL[inv?.awardStatus ?? 'awarded'] ?? inv?.awardStatus}
                </span>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  {inv && techSpecBlocksAward(inv) && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded-full">
                      <ClipboardCheck className="w-3 h-3" /> {TECH_SPEC_STATUS_LABELS[effectiveTechSpecStatus(inv)]}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={!canAward || specBlocked(g.vendorId)}
                    title={specBlocked(g.vendorId) ? 'Technical specification is not approved for this vendor yet' : undefined}
                    onClick={() => go(g.vendorId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed">
                    <FileInput className="w-3.5 h-3.5" /> Approve &amp; Request PI
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
