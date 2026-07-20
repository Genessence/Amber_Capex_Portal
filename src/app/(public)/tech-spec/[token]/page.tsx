'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  CheckCircle2, XCircle, ClipboardCheck, Clock, RotateCcw, Paperclip, Download, Building2, Cpu,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { resolveTechSpecTarget } from '@/lib/tokenUtils'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import { TECH_SPEC_STATUS_LABELS, effectiveTechSpecStatus } from '@/lib/techSpecUtils'

const DECIDER = 'Technical Team'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-black flex flex-col">
      <header className="px-5 py-4 border-b border-white/10">
        <div className="max-w-3xl mx-auto flex items-center gap-2 text-white">
          <Cpu className="w-5 h-5 text-blue-400" />
          <span className="font-bold tracking-tight">Amber CAPEX</span>
          <span className="text-white/50 text-sm">· Technical Specification Approval</span>
        </div>
      </header>
      <main className="flex-1 px-4 py-8">
        <div className="max-w-3xl mx-auto">{children}</div>
      </main>
    </div>
  )
}

function Terminal({ icon, title, note }: { icon: React.ReactNode; title: string; note: string }) {
  return (
    <div className={SUPPLIER_CARD}>
      <div className="flex flex-col items-center text-center gap-3 py-4">
        {icon}
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground max-w-md">{note}</p>
      </div>
    </div>
  )
}

/**
 * Public technical-specification approval page (no login). Amber's Technical team signs off a
 * vendor's machine specification BEFORE sourcing can award that vendor and request the Proforma
 * Invoice. Reached through an emailed tokenised link; the token is minted per vendor invite,
 * rotated on every re-send, and burned once a decision is recorded.
 */
export default function TechSpecApprovalPage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const { invites, requests, vendors, loaded, decideTechSpec } = useCapex()
  const [done, setDone] = useState<null | 'approved' | 'rejected' | 'needs_revision'>(null)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<null | 'needs_revision' | 'rejected'>(null)

  const target = useMemo(() => resolveTechSpecTarget(token, invites, requests), [token, invites, requests])

  if (!loaded) {
    return (
      <Shell>
        <Terminal icon={<Clock className="w-10 h-10 text-muted-foreground" />} title="Loading…" note="Fetching the specification package." />
      </Shell>
    )
  }

  if (done) {
    const cfg = {
      approved: {
        icon: <CheckCircle2 className="w-10 h-10 text-emerald-500" />,
        title: 'Specification Approved',
        note: 'Your approval has been recorded. Sourcing can now award this vendor and request their Proforma Invoice.',
      },
      needs_revision: {
        icon: <RotateCcw className="w-10 h-10 text-orange-500" />,
        title: 'Sent Back for Revision',
        note: 'Your remarks were sent to the sourcing team. They will revise the specification and send it back for your approval.',
      },
      rejected: {
        icon: <XCircle className="w-10 h-10 text-red-500" />,
        title: 'Specification Rejected',
        note: 'Your rejection has been recorded. This vendor cannot be awarded on this specification.',
      },
    }[done]
    return <Shell><Terminal icon={cfg.icon} title={cfg.title} note={cfg.note} /></Shell>
  }

  if (!target) {
    return (
      <Shell>
        <Terminal
          icon={<XCircle className="w-10 h-10 text-red-500" />}
          title="Link Invalid or Expired"
          note="This specification link could not be matched to a live approval. It may already have been actioned, or superseded by a newer revision — please check with the sourcing team."
        />
      </Shell>
    )
  }

  const { invite, request } = target
  const spec = invite.techSpec
  const status = effectiveTechSpecStatus(invite)
  const vendor = vendors.find(v => v.id === invite.vendorId)

  // Only actionable while it is genuinely with the Technical team.
  if (status !== 'pending_technical' || !spec) {
    return (
      <Shell>
        <Terminal
          icon={<CheckCircle2 className="w-10 h-10 text-emerald-500" />}
          title="Already Actioned"
          note={`This specification is now "${TECH_SPEC_STATUS_LABELS[status]}". No further approval is needed here.`}
        />
      </Shell>
    )
  }

  // The spec of the machine = the request's line items (description carries the specification) plus
  // whatever documents sourcing attached, which is usually the vendor's own datasheet.
  const lines = invite.awardedItemIds?.length
    ? (request.lineItems ?? []).filter(li => invite.awardedItemIds!.includes(li.id))
    : request.lineItems ?? []

  function submit(decision: 'approved' | 'rejected' | 'needs_revision') {
    if (decision !== 'approved' && !note.trim()) return
    if (decideTechSpec(invite.id, decision, DECIDER, note)) setDone(decision)
  }

  return (
    <Shell>
      <div className={SUPPLIER_CARD}>
        <div className="flex items-center gap-2 mb-1">
          <ClipboardCheck className="w-4 h-4 text-blue-700" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Machine Specification Approval
          </span>
        </div>
        <h1 className="text-xl font-bold text-foreground">{request.subject || 'Capex Request'}</h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
          <span>{request.requestNo}</span>
          <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {request.plant ?? '—'}</span>
          <span>{FIELD_TYPE_LABELS[request.fieldType ?? 'brown_field']}</span>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Vendor</p>
          <p className="text-sm font-bold text-foreground">{vendor?.vendorName ?? invite.vendorId}</p>
          {vendor?.vendorCode && <p className="text-xs text-muted-foreground">{vendor.vendorCode}</p>}
        </div>

        {/* Requested specification (line items) */}
        {lines.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Requested Specification ({lines.length} {lines.length === 1 ? 'item' : 'items'})
            </p>
            <div className="rounded-lg border border-border divide-y divide-border">
              {lines.map(li => (
                <div key={li.id} className="px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{li.description || li.masterHead || 'Item'}</p>
                    <span className="text-xs text-muted-foreground shrink-0">
                      Qty {li.quantity}{li.uom ? ` ${li.uom}` : ''}
                    </span>
                  </div>
                  {li.machineCapacity && (
                    <p className="text-xs text-muted-foreground mt-0.5">Capacity: {li.machineCapacity}</p>
                  )}
                  {li.specs && <p className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap">{li.specs}</p>}
                  {li.remarks && !li.specs && (
                    <p className="text-xs text-foreground/80 mt-1 whitespace-pre-wrap">{li.remarks}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sourcing's notes */}
        {spec.notes && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes from Sourcing</p>
            <p className="text-sm text-foreground whitespace-pre-wrap rounded-lg border border-border bg-muted/30 px-3 py-2.5">
              {spec.notes}
            </p>
          </div>
        )}

        {/* Vendor-provided spec documents */}
        <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Specification Documents ({spec.documents.length})
          </p>
          {spec.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents were attached — review against the specification above.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {spec.documents.map(doc => (
                <a
                  key={doc.id}
                  href={doc.base64 ? `data:${doc.mimeType};base64,${doc.base64}` : undefined}
                  download={doc.name}
                  aria-disabled={!doc.base64}
                  className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm ${
                    doc.base64 ? 'hover:bg-muted/40 text-foreground' : 'text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  <Paperclip className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1" title={doc.name}>{doc.name}</span>
                  {doc.fromVendor && (
                    <span className="text-[10px] font-semibold border border-border rounded-full px-1.5 py-0.5 shrink-0">
                      From vendor
                    </span>
                  )}
                  {doc.base64 && <Download className="w-4 h-4 shrink-0 text-blue-700" />}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Decision */}
        {mode === null ? (
          <div className="mt-6 flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => submit('approved')}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve Specification
            </button>
            <button
              onClick={() => { setNote(''); setMode('needs_revision') }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-orange-200 text-orange-700 hover:bg-orange-50 font-semibold text-sm"
            >
              <RotateCcw className="w-4 h-4" /> Send Back for Revision
            </button>
            <button
              onClick={() => { setNote(''); setMode('rejected') }}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div>
              <label htmlFor="tech-note" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {mode === 'needs_revision' ? 'What needs to change?' : 'Reason for rejection'} <span className="text-red-600">*</span>
              </label>
              <textarea
                id="tech-note"
                rows={3}
                value={note}
                onChange={e => setNote(e.target.value)}
                autoFocus
                placeholder={
                  mode === 'needs_revision'
                    ? 'e.g. Motor rating is below the requested 15 kW — ask the vendor for a revised datasheet.'
                    : 'e.g. The offered machine does not meet the compliance standard required for this line.'
                }
                className="mt-1 w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => submit(mode)}
                disabled={!note.trim()}
                className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-white font-semibold text-sm disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed ${
                  mode === 'needs_revision' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {mode === 'needs_revision' ? <RotateCcw className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {mode === 'needs_revision' ? 'Send Back to Sourcing' : 'Confirm Rejection'}
              </button>
              <button
                onClick={() => setMode(null)}
                className="px-4 py-2.5 rounded-lg bg-white border border-border text-muted-foreground hover:bg-muted/40 font-semibold text-sm"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">A remark is required so sourcing knows what to fix.</p>
          </div>
        )}
      </div>
    </Shell>
  )
}
