'use client'

import { useMemo } from 'react'
import { Paperclip, Wallet } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { formatCurrency, isForeignCurrency } from '@/lib/currencyUtils'
import { inrQuoteGrandTotal, latestQuote, quoteGrandTotal } from '@/lib/paymentUtils'
import { inrRfqTotal, rfqLineUnitPrice, rfqTotal } from '@/lib/rfqUtils'
import type { CapexLineItem, CapexMasterItem, CapexRequest, VendorInvite } from '@/lib/types'

const CR_TO_INR = 10_000_000

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

function allocatedInr(masterItemId: string | undefined, master: CapexMasterItem[]): number | null {
  if (!masterItemId) return null
  const row = master.find(m => m.id === masterItemId)
  return row ? row.totalCost * CR_TO_INR : null
}

/** Green when the ask is inside the allocation, red when it breaches it. */
function VarianceChip({ cost, allocated }: { cost?: number; allocated: number | null }) {
  if (allocated === null || cost === undefined || cost <= 0) return <span className="text-muted-foreground">—</span>
  const diff = cost - allocated
  const base = 'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap border'
  if (diff > 0) return <span className={`${base} text-red-700 bg-red-50 border-red-200`}>{inr(diff)} over</span>
  if (diff < 0) return <span className={`${base} text-emerald-700 bg-emerald-50 border-emerald-200`}>{inr(Math.abs(diff))} under</span>
  return <span className={`${base} text-slate-600 bg-slate-100 border-slate-200`}>On budget</span>
}

/** One vendor's offer, normalised across the three places a price can live on an invite. */
interface QuotationEntry {
  inviteId: string
  vendorName: string
  /** Where the price came from — buyers capture quotes at request creation, sourcing runs RFQ/auction. */
  source: 'Added at request' | 'RFQ quotation' | 'Auction bid'
  currency: string
  /** Grand total in the quote's own currency. */
  total: number
  /** Grand total on an INR basis, so vendors in different currencies compare honestly. */
  inrTotal: number
  freight?: number
  packing?: number
  service?: number
  deliveryDays?: number
  warranty?: number
  attachmentName?: string
  unitPrices: Record<string, number>
  submittedAt?: string
}

function buildEntries(
  invites: VendorInvite[],
  lineItems: CapexLineItem[],
  vendorName: (id: string) => string,
): QuotationEntry[] {
  const entries: QuotationEntry[] = []
  for (const inv of invites) {
    // Prefer the live RFQ quotation; fall back to the auction / buyer-seeded Quote.
    if (inv.rfqQuote) {
      const q = inv.rfqQuote
      entries.push({
        inviteId: inv.id,
        vendorName: vendorName(inv.vendorId),
        source: 'RFQ quotation',
        currency: q.currency ?? 'INR',
        total: rfqTotal(q, lineItems),
        inrTotal: inrRfqTotal(q, lineItems),
        freight: q.freight,
        packing: q.packing,
        service: q.service,
        deliveryDays: q.deliveryDays ?? (q.deliveryWeeks != null ? q.deliveryWeeks * 7 : undefined),
        warranty: q.warranty,
        unitPrices: Object.fromEntries(
          lineItems
            .map(li => [li.id, rfqLineUnitPrice(q, li.id)] as const)
            .filter((pair): pair is readonly [string, number] => pair[1] != null),
        ),
      })
      continue
    }
    const q = latestQuote(inv)
    if (!q) continue
    entries.push({
      inviteId: inv.id,
      vendorName: vendorName(inv.vendorId),
      source: q.seededByBuyer ? 'Added at request' : 'Auction bid',
      currency: q.currency ?? 'INR',
      total: quoteGrandTotal(q),
      inrTotal: inrQuoteGrandTotal(q),
      freight: q.freight,
      packing: q.packing,
      service: q.service,
      deliveryDays: q.deliveryDays,
      warranty: q.warranty,
      attachmentName: q.attachmentName,
      unitPrices: q.itemPrices ?? {},
      submittedAt: q.submittedAt,
    })
  }
  return entries.sort((a, b) => a.inrTotal - b.inrTotal)
}

/**
 * The full commercial picture of a request: what each line was ALLOCATED in the CAPEX master, what
 * it is expected to COST, and every vendor QUOTATION captured against it.
 *
 * Approvers get this on the public approval link and internally on the request detail — without the
 * budget and the quotations side by side an approver is being asked to sign off on a number they
 * cannot see. Quotes are compared on an INR basis (`inrTotal`) so a foreign-currency offer is never
 * mistaken for the cheapest; the original amount is shown alongside.
 */
export function RequestQuotationView({
  request,
  className = '',
  heading = 'Budget & Quotation',
  showLineBudget = true,
}: {
  request: CapexRequest
  className?: string
  heading?: string
  /**
   * Set false where the surface already renders the allocated-vs-cost line table (the internal
   * request detail), leaving only the vendor quotations — no duplicated grid.
   */
  showLineBudget?: boolean
}) {
  const { capexMaster, invites, vendors } = useCapex()

  const lineItems = useMemo(() => request.lineItems ?? [], [request.lineItems])

  const rows = useMemo(
    () =>
      lineItems.map(li => ({
        item: li,
        allocated: allocatedInr(li.masterItemId, capexMaster),
        cost: li.budget,
      })),
    [lineItems, capexMaster],
  )

  const totals = useMemo(() => {
    const allocated = rows.reduce((s, r) => s + (r.allocated ?? 0), 0)
    const cost = rows.reduce((s, r) => s + (r.cost ?? 0), 0)
    return {
      allocated: rows.some(r => r.allocated !== null) ? allocated : null,
      cost: cost || (lineItems.length ? undefined : request.budget),
    }
  }, [rows, lineItems.length, request.budget])

  const entries = useMemo(() => {
    const mine = invites.filter(i => i.requestId === request.id)
    const name = (id: string) => vendors.find(v => v.id === id)?.vendorName ?? id
    return buildEntries(mine, lineItems, name)
  }, [invites, request.id, vendors, lineItems])

  const lowestInr = entries.length ? entries[0].inrTotal : null

  return (
    <div className={`bg-card border border-border rounded-xl p-4 ${className}`}>
      <h2 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5" /> {heading}
      </h2>

      {/* ── Allocated vs expected cost, per line ── */}
      {!showLineBudget ? null : lineItems.length > 0 ? (
        <div className="border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-xs min-w-[560px]">
            <thead>
              <tr className="bg-[#F4F4F5] text-slate-600">
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider w-8">#</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Item</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider w-20">Qty</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider w-28">Allocated</th>
                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider w-28">Est. Cost</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider w-28">Vs Budget</th>
                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider hidden lg:table-cell">Preferred Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ item, allocated, cost }, idx) => (
                <tr key={item.id} className={idx % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                  <td className="px-3 py-2 text-muted-foreground font-bold">{idx + 1}</td>
                  <td className="px-3 py-2">
                    <span className="font-semibold text-foreground">{item.description || item.masterHead || 'Item'}</span>
                    {item.masterHead && <span className="ml-1.5 text-muted-foreground">· {item.masterHead}</span>}
                    {item.machineCapacity && (
                      <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-foreground border border-border">
                        {item.machineCapacity}
                      </span>
                    )}
                    {item.specs && <p className="text-muted-foreground mt-0.5 leading-snug">{item.specs}</p>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{item.quantity}{item.uom ? ` ${item.uom}` : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-foreground">
                    {allocated !== null ? inr(allocated) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                    {cost ? inr(cost) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2"><VarianceChip cost={cost} allocated={allocated} /></td>
                  <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
                    {item.vendorRecommendation?.vendorName ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#F4F4F5] font-bold border-t border-border">
                <td colSpan={3} className="px-3 py-2">Total · {rows.length} {rows.length === 1 ? 'line' : 'lines'}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {totals.allocated !== null ? inr(totals.allocated) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.cost ? inr(totals.cost) : '—'}</td>
                <td className="px-3 py-2"><VarianceChip cost={totals.cost} allocated={totals.allocated} /></td>
                <td className="hidden lg:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        // Legacy single-item requests carry no line-item grid.
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <span className="text-muted-foreground">Quantity: <span className="font-semibold text-foreground">{request.quantity}</span></span>
          <span className="text-muted-foreground">Est. Cost: <span className="font-semibold text-foreground">{request.budget ? inr(request.budget) : '—'}</span></span>
        </div>
      )}

      {/* ── Vendor quotations ── */}
      <div className={showLineBudget ? 'mt-4' : ''}>
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Vendor Quotations ({entries.length})
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-3">
            No vendor quotation has been captured yet — sourcing will obtain quotations by RFQ or reverse auction
            after approval.
          </p>
        ) : (
          <div className="space-y-2">
            {entries.map(e => {
              const isLowest = entries.length > 1 && e.inrTotal === lowestInr
              const foreign = isForeignCurrency(e.currency)
              return (
                <div
                  key={e.inviteId}
                  className={`rounded-lg border px-3 py-2.5 ${isLowest ? 'border-emerald-300 bg-emerald-50/40' : 'border-border bg-card'}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                        {e.vendorName}
                        {isLowest && (
                          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-1.5 py-0.5">
                            Lowest
                          </span>
                        )}
                        <span className="text-[10px] font-semibold text-muted-foreground border border-border rounded-full px-1.5 py-0.5">
                          {e.source}
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                        {e.freight ? <span>Freight {formatCurrency(e.freight, e.currency)}</span> : null}
                        {e.packing ? <span>Packing {formatCurrency(e.packing, e.currency)}</span> : null}
                        {e.service ? <span>Service {formatCurrency(e.service, e.currency)}</span> : null}
                        {e.deliveryDays ? <span>Delivery {e.deliveryDays} days</span> : null}
                        {e.warranty ? <span>Warranty {e.warranty} yr</span> : null}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums text-foreground">{inr(e.inrTotal)}</p>
                      {foreign && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {formatCurrency(e.total, e.currency)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Per-line prices, when the quote was priced line by line */}
                  {lineItems.length > 0 && Object.keys(e.unitPrices).length > 0 && (
                    <ul className="mt-2 pt-2 border-t border-border/70 space-y-0.5">
                      {lineItems.map(li => {
                        const unit = e.unitPrices[li.id]
                        if (unit == null) return null
                        const qty = parseFloat(li.quantity) || 1
                        return (
                          <li key={li.id} className="flex items-center justify-between gap-3 text-[11px]">
                            <span className="text-muted-foreground truncate">{li.description || li.masterHead || 'Item'}</span>
                            <span className="tabular-nums text-foreground shrink-0">
                              {formatCurrency(unit, e.currency)} × {qty} ={' '}
                              <span className="font-semibold">{formatCurrency(unit * qty, e.currency)}</span>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {e.attachmentName && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1">
                      <Paperclip className="w-3 h-3" /> {e.attachmentName}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
