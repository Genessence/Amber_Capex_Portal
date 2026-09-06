'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  CheckCircle2, XCircle, ClipboardCheck, Clock, RotateCcw, Paperclip, Download, Building2, Cpu, EyeOff,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { RemarkField } from '@/components/RemarkField'
import { RemarkTrail } from '@/components/RemarkTrail'
import { resolveTechSpecTarget } from '@/lib/tokenUtils'
import { SUPPLIER_CARD } from '@/lib/uiTokens'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import {
  TECH_SPEC_STATUS_LABELS,
  anonymousDocumentFileName,
  anonymousDocumentLabel,
  anonymousVendorRef,
  effectiveTechSpecStatus,
} from '@/lib/techSpecUtils'

import { TECHNICAL_TEAM_ACTOR } from '@/lib/constants'

const DECIDER = TECHNICAL_TEAM_ACTOR

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
 *
 * The VENDOR'S IDENTITY IS WITHHELD here by design — the Technical team judges the machine on its
 * technical merit alone. The page renders an anonymous reference (`anonymousVendorRef`) and
 * generic document labels instead of the vendor name and their (often self-named) filenames.
 */
export default function TechSpecApprovalPage() {
  const params = useParams()
  const token = String(params.token ?? '')
  const { invites, requests, loaded, decideTechSpec } = useCapex()
  const [done, setDone] = useState<null | 'approved' | 'rejected' | 'needs_revision'>(null)
  const [note, setNote] = useState('')

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
  // Deliberately NOT resolved to a vendor record — the identity never reaches this page.
  const vendorRef = anonymousVendorRef(invite.id)

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

  const noteFilled = note.trim().length > 0

  function submit(decision: 'approved' | 'rejected' | 'needs_revision') {
    // Send-back and rejection need a reason — sourcing has nothing to act on without one. An
    // APPROVAL may also carry a remark (a caveat, a condition on installation), which is why the
    // field sits above all three buttons rather than behind a mode switch on the negative ones.
    if (decision !== 'approved' && !noteFilled) return
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

        {/* Vendor identity is withheld — the Technical team reviews the machine, not the supplier. */}
        <div className="mt-4 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
            Supplier Reference
          </p>
          <p className="text-sm font-bold text-foreground font-mono">{vendorRef}</p>
          <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1.5">
            <EyeOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            The supplier’s identity is withheld so the specification is assessed on technical merit
            alone. Quote this reference to the sourcing team if you need to discuss the package.
          </p>
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
              {/* Filenames are replaced with generic labels — vendors routinely name their
                  datasheets after themselves, which would defeat the anonymity of this page. */}
              {spec.documents.map((doc, idx) => {
                const label = anonymousDocumentLabel(idx, doc.name)
                return (
                  <a
                    key={doc.id}
                    href={doc.base64 ? `data:${doc.mimeType};base64,${doc.base64}` : undefined}
                    download={anonymousDocumentFileName(idx, doc.name)}
                    aria-disabled={!doc.base64}
                    className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm ${
                      doc.base64 ? 'hover:bg-muted/40 text-foreground' : 'text-muted-foreground cursor-not-allowed'
                    }`}
                  >
                    <Paperclip className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="truncate flex-1" title={label}>{label}</span>
                    {doc.base64 && <Download className="w-4 h-4 shrink-0 text-blue-700" />}
                  </a>
                )
              })}
            </div>
          )}
        </div>

        {/* Earlier rounds of THIS gate — what the Technical team asked for last time, so a re-send
            after a send-back is reviewed against the original objection.

            SCOPED TO `technical_spec` ON PURPOSE. The invite's trail also carries sourcing's and (on
            an awarded invite) Accounts' remarks, written by people who name the vendor freely; this
            page withholds the vendor's identity by design, so it shows only the remarks this page
            itself produced. Sourcing's covering note reaches the team through `spec.notes` above,
            which they are explicitly told to keep vendor-free. */}
        <RemarkTrail
          remarks={invite.approvalRemarks}
          stage="technical_spec"
          title="Your earlier remarks on this specification"
          className="mt-4"
        />

        {/* Decision */}
        <div className="mt-6 space-y-3">
          <RemarkField
            id="tech-note"
            label="Your remarks"
            value={note}
            onChange={setNote}
            placeholder="e.g. Motor rating is below the requested 15 kW — ask the vendor for a revised datasheet."
            hint="Optional to approve, required to send back or reject. Shown to the sourcing team."
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => submit('approved')}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve Specification
            </button>
            <button
              onClick={() => submit('needs_revision')}
              disabled={!noteFilled}
              title={noteFilled ? undefined : 'Write what needs to change above'}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-orange-200 text-orange-700 hover:bg-orange-50 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              <RotateCcw className="w-4 h-4" /> Send Back for Revision
            </button>
            <button
              onClick={() => submit('rejected')}
              disabled={!noteFilled}
              title={noteFilled ? undefined : 'Write a reason for rejection above'}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </div>
          {!noteFilled && (
            <p className="text-[11px] text-muted-foreground">
              Sending back or rejecting needs a remark — sourcing has to know what to fix.
            </p>
          )}
        </div>
      </div>
    </Shell>
  )
}
