'use client'

import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { createAuctionApprovalDocument, DEFAULT_AUCTION_RULES } from '@/lib/auctionDocumentUtils'
import { ROLE_NAMES } from '@/lib/constants'
import type { AuctionApprovalDocument, CapexRequest } from '@/lib/types'

/**
 * The ONE "Configure Auction Document" form — the Business Rules for Reverse Auction that go to
 * vendors for approval before anyone can bid. It is opened from two places:
 *   • the RFQ panel's **Start Reverse Auction** button (a popup — escalating an RFQ now REQUIRES
 *     the document to be configured and sent first), and
 *   • the reverse-auction panel's own setup card (a request that entered auction mode directly).
 * One implementation, so the two entry points cannot drift apart. The form only BUILDS the document
 * (`onSubmit(doc)`); what happens next — escalate + send, or just send — belongs to the caller.
 *
 * The auction duration + threshold chosen here are stamped on the document (`durationDays`,
 * `threshold`) so the Start Auction control can read them back later, in a different component.
 */

const FIELD =
  'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400'
const LBL = 'text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1'

type Loc = { name: string; state: string; subLocationCount?: number }

function isoDatePlus(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function DeliveryLocationRow({
  location,
  onChange,
  onRemove,
  showRemove,
}: {
  location: Loc
  onChange: (updates: Partial<Loc>) => void
  onRemove: () => void
  showRemove: boolean
}) {
  return (
    <div className="flex items-start gap-2 bg-slate-50 p-3 rounded-lg">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          value={location.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Location name (e.g., Jhajjar)"
          aria-label="Delivery location name"
          className={FIELD}
        />
        <input
          type="text"
          value={location.state}
          onChange={e => onChange({ state: e.target.value })}
          placeholder="State (e.g., Haryana)"
          aria-label="Delivery location state"
          className={FIELD}
        />
        <input
          type="number"
          value={location.subLocationCount || ''}
          onChange={e => onChange({ subLocationCount: e.target.value ? parseInt(e.target.value) : undefined })}
          placeholder="Sub-locations (optional)"
          aria-label="Number of sub-locations"
          className={FIELD}
        />
      </div>
      {showRemove && (
        <button type="button" onClick={onRemove} aria-label="Remove location" className="p-2 text-red-500 hover:bg-red-50 rounded-md">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

export function AuctionDocumentForm({
  request,
  currentRole,
  rfqFloor,
  submitLabel,
  submitDisabled,
  onSubmit,
  onCancel,
}: {
  request: CapexRequest
  currentRole: string
  /** Lowest RFQ quotation (INR), used to pre-fill the threshold. */
  rfqFloor: number | null
  submitLabel: string
  /** Extra caller-side gate (e.g. no vendor selected). */
  submitDisabled?: boolean
  onSubmit: (doc: AuctionApprovalDocument) => void
  onCancel: () => void
}) {
  const [auctionDate, setAuctionDate] = useState(() => isoDatePlus(3))
  const [auctionOpeningTime, setAuctionOpeningTime] = useState('11:00')
  const [auctionClosingTime, setAuctionClosingTime] = useState('12:00')
  const [bidderAcceptanceDeadlineDate, setBidderAcceptanceDeadlineDate] = useState(() => isoDatePlus(2))
  const [bidderAcceptanceDeadlineTime, setBidderAcceptanceDeadlineTime] = useState('17:00')
  const [vendorRevertDeadlineAt, setVendorRevertDeadlineAt] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    return d.toISOString().slice(0, 16)
  })
  const [deliveryLocations, setDeliveryLocations] = useState<Loc[]>([{ name: '', state: '' }])
  const [bidValidityDays, setBidValidityDays] = useState(DEFAULT_AUCTION_RULES.bidValidityDays)
  const [maxDecrements, setMaxDecrements] = useState(DEFAULT_AUCTION_RULES.maxDecrements)
  const [extensionDurationMins, setExtensionDurationMins] = useState(DEFAULT_AUCTION_RULES.extensionDurationMinutes)
  const [maxExtensionsPerBidder, setMaxExtensionsPerBidder] = useState(DEFAULT_AUCTION_RULES.maxExtensionsPerBidder)
  const [currency, setCurrency] = useState(DEFAULT_AUCTION_RULES.currency)
  const [durationDays, setDurationDays] = useState(request.auctionConfig?.durationDays ?? 7)
  const [threshold, setThreshold] = useState(
    String(request.auctionConfig?.threshold ?? rfqFloor ?? request.budget ?? ''),
  )

  const incomplete = !auctionDate || !auctionOpeningTime || !auctionClosingTime

  function submit() {
    if (incomplete || submitDisabled) return
    const currentUser = {
      name: ROLE_NAMES[currentRole] || currentRole,
      designation: currentRole.replace(/_/g, ' ') || 'Sourcing Member',
      email: 'sourcing@ambergroupindia.com',
      mobile: '+91 99999 99999',
    }
    const doc = createAuctionApprovalDocument(request, currentUser, {
      auctionDate,
      auctionOpeningTime: `${auctionOpeningTime} Hrs`,
      auctionClosingTime: `${auctionClosingTime} Hrs`,
      bidderAcceptanceDeadlineDate,
      bidderAcceptanceDeadlineTime: `${bidderAcceptanceDeadlineTime} Hrs`,
      vendorRevertDeadlineAt,
      deliveryLocations:
        request.fieldType === 'green_field' ? deliveryLocations.filter(l => l.name && l.state) : undefined,
      rules: {
        bidValidityDays,
        maxDecrements,
        extensionDurationMinutes: extensionDurationMins,
        maxExtensionsPerBidder,
        currency,
      },
      supplyFrame: 'As per Amber Terms and Conditions',
      paymentTerms: '60 Days from the date of Invoice (Open Account)',
    })
    const th = Number(threshold)
    onSubmit({
      ...doc,
      durationDays,
      threshold: threshold && Number.isFinite(th) && th > 0 ? th : undefined,
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Auction Dates &amp; Times</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="adf-date" className={LBL}>Auction Date</label>
            <input id="adf-date" type="date" value={auctionDate} onChange={e => setAuctionDate(e.target.value)} className={FIELD} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="adf-open" className={LBL}>Open Time</label>
              <input id="adf-open" type="time" value={auctionOpeningTime} onChange={e => setAuctionOpeningTime(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor="adf-close" className={LBL}>Close Time</label>
              <input id="adf-close" type="time" value={auctionClosingTime} onChange={e => setAuctionClosingTime(e.target.value)} className={FIELD} />
            </div>
          </div>
          <div>
            <label htmlFor="adf-bad" className={LBL}>Bidder Acceptance Deadline Date</label>
            <input id="adf-bad" type="date" value={bidderAcceptanceDeadlineDate} onChange={e => setBidderAcceptanceDeadlineDate(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label htmlFor="adf-bat" className={LBL}>Bidder Acceptance Deadline Time</label>
            <input id="adf-bat" type="time" value={bidderAcceptanceDeadlineTime} onChange={e => setBidderAcceptanceDeadlineTime(e.target.value)} className={FIELD} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="adf-revert" className={LBL}>Vendor Revert Expected By</label>
            <input id="adf-revert" type="datetime-local" value={vendorRevertDeadlineAt} onChange={e => setVendorRevertDeadlineAt(e.target.value)} className={FIELD} />
          </div>
        </div>
      </div>

      {request.fieldType === 'green_field' && (
        <div className="border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Delivery Locations</h3>
          <div className="space-y-2">
            {deliveryLocations.map((loc, idx) => (
              <DeliveryLocationRow
                key={idx}
                location={loc}
                onChange={updates => setDeliveryLocations(prev => prev.map((l, i) => (i === idx ? { ...l, ...updates } : l)))}
                onRemove={() => setDeliveryLocations(prev => prev.filter((_, i) => i !== idx))}
                showRemove={deliveryLocations.length > 1}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setDeliveryLocations(prev => [...prev, { name: '', state: '' }])}
            className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-slate-800"
          >
            <Plus className="w-4 h-4" /> Add Location
          </button>
        </div>
      )}

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Auction Rules (Optional)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="adf-validity" className={LBL}>Bid Validity (days)</label>
            <input id="adf-validity" type="number" value={bidValidityDays} onChange={e => setBidValidityDays(Number(e.target.value))} className={FIELD} />
          </div>
          <div>
            <label htmlFor="adf-decr" className={LBL}>Max Decrements</label>
            <input id="adf-decr" type="number" value={maxDecrements} onChange={e => setMaxDecrements(Number(e.target.value))} className={FIELD} />
          </div>
          <div>
            <label htmlFor="adf-ext" className={LBL}>Extension (mins)</label>
            <input id="adf-ext" type="number" value={extensionDurationMins} onChange={e => setExtensionDurationMins(Number(e.target.value))} className={FIELD} />
          </div>
          <div>
            <label htmlFor="adf-maxext" className={LBL}>Max Extensions</label>
            <input id="adf-maxext" type="number" value={maxExtensionsPerBidder} onChange={e => setMaxExtensionsPerBidder(Number(e.target.value))} className={FIELD} />
          </div>
          <div>
            <label htmlFor="adf-cur" className={LBL}>Currency</label>
            <input id="adf-cur" type="text" value={currency} onChange={e => setCurrency(e.target.value)} placeholder="INR" className={FIELD} />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Auction Configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="adf-duration" className={LBL}>Duration (days)</label>
            <select id="adf-duration" value={durationDays} onChange={e => setDurationDays(Number(e.target.value))} className={FIELD}>
              {Array.from({ length: 30 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="adf-threshold" className={LBL}>Threshold price (₹)</label>
            <input id="adf-threshold" type="number" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="Buyer estimate" className={FIELD} />
            {rfqFloor != null && (
              <p className="text-[10px] text-slate-400 mt-1">
                Pre-filled from lowest RFQ quote (₹{Math.round(rfqFloor).toLocaleString('en-IN')}) — editable.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          onClick={submit}
          disabled={incomplete || submitDisabled}
          className="flex-1 px-4 py-2 min-h-[44px] rounded-lg bg-[#171717] hover:bg-black disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 min-h-[44px] rounded-lg border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
