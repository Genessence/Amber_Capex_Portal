'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ClipboardCheck, Paperclip, Send, Trash2, ChevronDown, Download, Copy, Mail, CheckCircle2,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import { buildTechSpecLink } from '@/lib/tokenUtils'
import { TECHNICAL_TEAM_EMAIL } from '@/lib/constants'
import { FOCUS_RING, INPUT, LABEL } from '@/lib/auctionTheme'
import {
  MAX_TECH_SPEC_DOCS,
  MAX_TECH_SPEC_FILE_BYTES,
  TECH_SPEC_HINTS,
  TECH_SPEC_STATUS_COLORS,
  TECH_SPEC_STATUS_LABELS,
  canSendTechSpec,
  effectiveTechSpecStatus,
  isTechSpecReadyToSend,
} from '@/lib/techSpecUtils'
import type { CapexRequest, TechSpecDocument, Vendor, VendorInvite } from '@/lib/types'

const fmtTs = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

/**
 * Technical specification approval — the pre-award gate. For each candidate vendor, sourcing
 * attaches the machine's spec documents (typically the datasheet the VENDOR provided), adds notes,
 * and sends the package to Amber's Technical team through a public `/tech-spec/<token>` link. The
 * Technical team approves, sends it back for revision, or rejects; sourcing revises and re-sends.
 * A vendor cannot be awarded until their spec is approved (enforced in `awardAndRequestPi`).
 */
export function TechSpecPanel({
  request,
  invites,
  vendors,
  canManage,
  senderName,
}: {
  request: CapexRequest
  invites: VendorInvite[]
  vendors: Vendor[]
  canManage: boolean
  senderName: string
}) {
  const { saveTechSpecDraft, sendTechSpecForApproval } = useCapex()
  const [openId, setOpenId] = useState<string | null>(null)
  const [emailFor, setEmailFor] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})

  const vendorName = (id: string) => vendors.find(v => v.id === id)?.vendorName ?? id

  // Candidates: anyone who has actually put a price on the table (RFQ quote, auction bid, or a
  // seeded opening bid), plus anyone already awarded. Those are the only vendors that can be awarded.
  const candidates = useMemo(
    () =>
      invites.filter(
        inv => inv.requestId === request.id && (!!inv.rfqQuote || inv.quotes.length > 0 || !!inv.openingQuote || inv.awarded),
      ),
    [invites, request.id],
  )

  if (candidates.length === 0) return null

  function notesFor(inv: VendorInvite) {
    return noteDraft[inv.id] ?? inv.techSpec?.notes ?? ''
  }

  async function addFiles(inv: VendorInvite, fileList: FileList | null) {
    if (!fileList?.length) return
    const existing = inv.techSpec?.documents.length ?? 0
    const files = Array.from(fileList)
    if (existing + files.length > MAX_TECH_SPEC_DOCS) {
      toast.error(`At most ${MAX_TECH_SPEC_DOCS} specification documents per vendor`)
      return
    }
    const oversized = files.find(f => f.size > MAX_TECH_SPEC_FILE_BYTES)
    if (oversized) {
      toast.error(`"${oversized.name}" is over 2 MB`)
      return
    }
    const docs: TechSpecDocument[] = await Promise.all(
      files.map(
        file =>
          new Promise<TechSpecDocument>((resolve, reject) => {
            const reader = new FileReader()
            reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
            reader.onload = () =>
              resolve({
                id: `tsd-${crypto.randomUUID()}`,
                name: file.name,
                base64: ((reader.result as string) ?? '').split(',')[1] ?? '',
                mimeType: file.type || 'application/octet-stream',
                uploadedAt: new Date().toISOString(),
                uploadedBy: senderName,
                fromVendor: true,
              })
            reader.readAsDataURL(file)
          }),
      ),
    ).catch(err => {
      toast.error(err instanceof Error ? err.message : 'Could not read the file')
      return [] as TechSpecDocument[]
    })
    if (!docs.length) return
    if (saveTechSpecDraft(inv.id, { addDocuments: docs })) {
      toast.success(`${docs.length} specification document${docs.length > 1 ? 's' : ''} attached`)
    }
  }

  function saveNotes(inv: VendorInvite) {
    if (saveTechSpecDraft(inv.id, { notes: notesFor(inv) })) {
      setNoteDraft(prev => { const next = { ...prev }; delete next[inv.id]; return next })
      toast.success('Specification notes saved')
    }
  }

  function send(inv: VendorInvite) {
    // Hand any unsaved note edit to the mutation so the save + send land in ONE state pass —
    // saving first and sending after would read the notes back stale.
    if (sendTechSpecForApproval(inv.id, senderName, noteDraft[inv.id])) {
      setNoteDraft(prev => { const next = { ...prev }; delete next[inv.id]; return next })
      setEmailFor(inv.id)
      toast.success(`Specification sent to the Technical team for ${vendorName(inv.vendorId)}`)
    } else {
      toast.error('Attach a specification document or add notes before sending')
    }
  }

  async function copyLink(token?: string) {
    if (!token) return
    try {
      await navigator.clipboard.writeText(buildTechSpecLink(token))
      toast.success('Approval link copied')
    } catch {
      toast.error('Could not copy the link')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 bg-[#F4F4F5] border-b border-slate-200">
        <ClipboardCheck className="w-3.5 h-3.5 text-slate-400" />
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
          Technical Spec Approval — required before award
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {candidates.map(inv => {
          const status = effectiveTechSpecStatus(inv)
          const spec = inv.techSpec
          const isOpen = openId === inv.id
          const editable = canManage && canSendTechSpec(inv)
          const ready = isTechSpecReadyToSend({
            ...(spec ?? { id: '', status: 'not_sent' as const, documents: [], thread: [] }),
            notes: notesFor(inv),
          })
          const link = spec?.token ? buildTechSpecLink(spec.token) : ''

          return (
            <li key={inv.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{vendorName(inv.vendorId)}</p>
                  <p className="text-[11px] text-slate-700">{TECH_SPEC_HINTS[status]}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TECH_SPEC_STATUS_COLORS[status]}`}>
                    {TECH_SPEC_STATUS_LABELS[status]}
                  </span>
                  <button
                    onClick={() => setOpenId(isOpen ? null : inv.id)}
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Close' : 'Open'} the technical specification for ${vendorName(inv.vendorId)}`}
                    className={`flex items-center gap-1 text-[11px] font-semibold text-[#171717] hover:underline ${FOCUS_RING} rounded`}
                  >
                    {isOpen ? 'Close' : status === 'not_sent' ? 'Prepare' : 'Open'}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Technical team's remark on the last decision */}
              {spec?.decisionNote && (status === 'needs_revision' || status === 'rejected') && (
                <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[11px] text-orange-900">
                  <span className="font-semibold">Technical team:</span> {spec.decisionNote}
                </p>
              )}

              {isOpen && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
                  {/* Documents */}
                  <div>
                    <p className={LABEL}>Specification documents {spec?.documents.length ? `(${spec.documents.length}/${MAX_TECH_SPEC_DOCS})` : ''}</p>
                    {spec?.documents.length ? (
                      <ul className="space-y-1.5 mb-2">
                        {spec.documents.map(doc => (
                          <li key={doc.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                            <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="text-[12px] text-slate-800 truncate flex-1" title={doc.name}>{doc.name}</span>
                            {doc.fromVendor && (
                              <span className="text-[9px] font-semibold text-slate-500 border border-slate-200 rounded-full px-1.5 py-0.5 shrink-0">
                                From vendor
                              </span>
                            )}
                            {doc.base64 && (
                              <a
                                href={`data:${doc.mimeType};base64,${doc.base64}`}
                                download={doc.name}
                                aria-label={`Download ${doc.name}`}
                                className="p-1 text-slate-400 hover:text-[#2563EB] shrink-0"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                            )}
                            {editable && (
                              <button
                                onClick={() => saveTechSpecDraft(inv.id, { removeDocumentId: doc.id }) && toast.success('Document removed')}
                                aria-label={`Remove ${doc.name}`}
                                className="p-1 text-slate-300 hover:text-red-600 shrink-0"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-slate-500 mb-2">
                        No documents attached yet — upload the spec sheet the vendor provided.
                      </p>
                    )}
                    {editable && (
                      <label className={`inline-flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-[12px] text-slate-600 hover:bg-slate-50 ${FOCUS_RING}`}>
                        <Paperclip className="w-3.5 h-3.5" />
                        Upload vendor spec document (PDF / image / doc, max 2 MB)
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.dwg"
                          onChange={e => { void addFiles(inv, e.target.files); e.target.value = '' }}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>

                  {/* Notes to the technical team */}
                  <div>
                    <label htmlFor={`ts-notes-${inv.id}`} className={LABEL}>Notes for the Technical team</label>
                    <textarea
                      id={`ts-notes-${inv.id}`}
                      rows={3}
                      value={notesFor(inv)}
                      disabled={!editable}
                      onChange={e => setNoteDraft(prev => ({ ...prev, [inv.id]: e.target.value }))}
                      onBlur={() => { if (editable && noteDraft[inv.id] !== undefined) saveNotes(inv) }}
                      placeholder="Machine model, capacity, deviations from the requested spec, points to verify…"
                      className={`${INPUT} resize-y disabled:bg-slate-100 disabled:text-slate-600`}
                    />
                  </div>

                  {/* Actions */}
                  {canManage && (
                    <div className="flex flex-wrap items-center gap-2">
                      {canSendTechSpec(inv) ? (
                        <button
                          onClick={() => send(inv)}
                          disabled={!ready}
                          title={ready ? undefined : 'Attach a document or write notes first'}
                          aria-label={`Send the specification for ${vendorName(inv.vendorId)} to the Technical team`}
                          className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold bg-[#171717] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg ${FOCUS_RING}`}
                        >
                          <Send className="w-3.5 h-3.5" />
                          {status === 'not_sent' ? 'Send to Technical team' : 'Re-send to Technical team'}
                        </button>
                      ) : status === 'approved' ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approved by {spec?.decidedBy || 'Technical'} · {fmtTs(spec?.decidedAt)}
                        </span>
                      ) : null}

                      {link && (
                        <>
                          <button
                            onClick={() => void copyLink(spec?.token)}
                            aria-label="Copy the technical approval link"
                            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg ${FOCUS_RING}`}
                          >
                            <Copy className="w-3.5 h-3.5" /> Copy link
                          </button>
                          <button
                            onClick={() => setEmailFor(inv.id)}
                            aria-label="Preview the technical approval email"
                            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 rounded-lg ${FOCUS_RING}`}
                          >
                            <Mail className="w-3.5 h-3.5" /> Preview email
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  {spec?.sentAt && (
                    <p className="text-[10px] text-slate-400">
                      Sent {fmtTs(spec.sentAt)}{spec.sentBy ? ` by ${spec.sentBy}` : ''}
                      {spec.decidedAt ? ` · decided ${fmtTs(spec.decidedAt)}` : ''}
                    </p>
                  )}
                </div>
              )}

              {emailFor === inv.id && spec?.token && (
                <EmailPreviewModal
                  open
                  onClose={() => setEmailFor(null)}
                  onSend={to => { setEmailFor(null); toast.success(`Specification approval email sent to ${to}`) }}
                  title="Technical Specification Approval"
                  defaultTo={TECHNICAL_TEAM_EMAIL}
                  subject={`Spec Approval Needed — ${request.requestNo ?? request.id.slice(0, 8)} · ${vendorName(inv.vendorId)}`}
                  link={buildTechSpecLink(spec.token)}
                  body={[
                    'Dear Technical Team,',
                    '',
                    `A machine specification requires your approval before we can award the vendor for ${request.requestNo ?? request.id.slice(0, 8)} — ${request.subject}.`,
                    '',
                    `Vendor: ${vendorName(inv.vendorId)}`,
                    `Documents attached: ${spec.documents.length}`,
                    ...(spec.notes ? ['', `Notes from sourcing: ${spec.notes}`] : []),
                    '',
                    'Please review and Approve / Send back for revision / Reject using the secure link below:',
                    buildTechSpecLink(spec.token),
                    '',
                    'Regards,',
                    'Amber Enterprises CAPEX Portal',
                  ].join('\n')}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
