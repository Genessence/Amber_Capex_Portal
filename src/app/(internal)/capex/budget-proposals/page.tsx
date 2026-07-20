'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, Plus, Trash2, Upload, Download, Send, Save, ClipboardList, FileSpreadsheet, Copy, Mail, AlertCircle,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES, PLANT_HEAD_EMAIL, getPlantForRole } from '@/lib/constants'
import { buildApprovalLink } from '@/lib/tokenUtils'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import type { BudgetProposal, BudgetProposalItem, ProjectType } from '@/lib/types'
import {
  BROWN_FIELD_HEAD_ORDER,
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
} from '@/lib/greenFieldConstants'
import {
  BUDGET_PROPOSAL_STATUS_COLORS,
  BUDGET_PROPOSAL_STATUS_LABELS,
  createProposalFromLiveFy,
  emptyProposalItem,
  parsedRowToProposalItem,
  proposalTotalCr,
  summarizeProposalByHead,
  validateProposal,
} from '@/lib/budgetProposalUtils'
import { parseCsvText, parseMasterWorkbook, downloadImportTemplate } from '@/lib/bulkMasterImport'

const ALLOWED_ROLES = ['maintenance', 'sourcing_member', 'super_admin']

function fmtCr(n: number) {
  return `₹${n.toFixed(2)} Cr`
}

export default function BudgetProposalsPage() {
  const router = useRouter()
  const {
    capexMaster, customPlants, budgetProposals,
    createBudgetProposal, updateBudgetProposal, submitBudgetProposal,
  } = useCapex()

  const [role, setRole] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('rac')
  const [plant, setPlant] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const r = localStorage.getItem('capex_role') ?? ''
    if (!ALLOWED_ROLES.includes(r)) {
      router.replace('/capex/requests')
      return
    }
    setRole(r)
    const scoped = getPlantForRole(r)
    if (scoped) setPlant(scoped)
    const handler = (e: Event) => setRole((e as CustomEvent).detail)
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [router])

  const rolePlant = getPlantForRole(role)

  const allPlants = useMemo(() => {
    const base = PLANTS.map(p => ({ value: p.value, label: p.label }))
    const extra = customPlants
      .filter(p => !p.greenFieldPlant && !base.some(b => b.value === p.value))
      .map(p => ({ value: p.value, label: p.label }))
    let list = [...base, ...extra]
    if (rolePlant) list = list.filter(p => p.value === rolePlant)
    return list
  }, [customPlants, rolePlant])

  const plantLabel = (v: string) => allPlants.find(p => p.value === v)?.label ?? v

  // Proposals for the current scope (plant + projectType)
  const scopedProposals = useMemo(
    () =>
      budgetProposals
        .filter(p => (!plant || p.plant === plant) && p.projectType === projectType)
        .sort((a, b) => (b.createdAt).localeCompare(a.createdAt)),
    [budgetProposals, plant, projectType],
  )

  const editing = budgetProposals.find(p => p.id === editingId) ?? null

  function handleCreate() {
    if (!plant) return
    const proposal = createProposalFromLiveFy({
      capexMaster, plant, projectType, createdBy: role,
    })
    if (!proposal.items.length && !proposal.sourceFy) {
      // No live Brown Field master for this scope — start blank with current FY guess.
      proposal.items = []
    }
    createBudgetProposal(proposal)
    setEditingId(proposal.id)
    toast.success(`Draft proposal created for ${plantLabel(plant)} · ${proposal.targetFy || 'new FY'}`)
  }

  if (editing) {
    return (
      <BudgetProposalEditor
        proposal={editing}
        plantLabel={plantLabel(editing.plant)}
        onBack={() => setEditingId(null)}
        onSave={(updates) => updateBudgetProposal(editing.id, updates)}
        onSubmit={() => {
          const errors = validateProposal(editing)
          if (errors.length) { toast.error(errors[0]); return }
          submitBudgetProposal(editing.id)
          setEditingId(null)
          toast.success('Proposal submitted to Plant Head for approval')
        }}
        fileRef={fileRef}
      />
    )
  }

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <Link href="/capex/master" className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-slate-600" /> Budget Planning
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Author next-FY Brown Field budgets. Submitted proposals go to admin for approval, then publish as the new live FY.
          </p>
        </div>
      </div>

      {/* Scope selectors */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {PROJECT_TYPES.map(pt => (
            <button key={pt} onClick={() => setProjectType(pt)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                projectType === pt ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {PROJECT_TYPE_LABELS[pt]}
            </button>
          ))}
        </div>
        <select
          value={plant ?? ''}
          onChange={e => setPlant(e.target.value || null)}
          disabled={!!rolePlant}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        >
          <option value="">Select plant…</option>
          {allPlants.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {plant && (
          <button onClick={handleCreate}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Next-FY Proposal
          </button>
        )}
      </div>

      {/* Proposals list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!plant ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-20">
            <FileSpreadsheet className="w-10 h-10 text-slate-200" />
            <p className="text-sm text-muted-foreground">Select a plant to view or create budget proposals.</p>
          </div>
        ) : scopedProposals.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-20">
            <FileSpreadsheet className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold text-muted-foreground">No proposals yet for {plantLabel(plant)} · {PROJECT_TYPE_LABELS[projectType]}</p>
            <p className="text-xs text-muted-foreground">Create a next-FY proposal to plan a new budget.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground text-[12px] uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Target FY</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Lines</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Total</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Created By</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {scopedProposals.map(p => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-semibold text-foreground">{p.targetFy || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.items.length}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtCr(proposalTotalCr(p))}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[p.status]}`}>
                        {BUDGET_PROPOSAL_STATUS_LABELS[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground text-[12px]">{ROLE_NAMES[p.createdBy] ?? p.createdBy}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(p.status === 'draft' || p.status === 'rejected' || p.status === 'needs_correction') ? (
                        <button onClick={() => setEditingId(p.id)}
                          className="text-xs font-semibold text-primary hover:underline">Edit & Submit</button>
                      ) : (
                        <button onClick={() => setEditingId(p.id)}
                          className="text-xs font-semibold text-muted-foreground hover:underline">View</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Editor ────────────────────────────────────────────────────────────────────

interface EditorProps {
  proposal: BudgetProposal
  plantLabel: string
  onBack: () => void
  onSave: (updates: Partial<BudgetProposal>) => void
  onSubmit: () => void
  fileRef: React.RefObject<HTMLInputElement | null>
}

function BudgetProposalEditor({ proposal, plantLabel, onBack, onSave, onSubmit, fileRef }: EditorProps) {
  const [targetFy, setTargetFy] = useState(proposal.targetFy)
  const [items, setItems] = useState<BudgetProposalItem[]>(proposal.items)
  const [importMode, setImportMode] = useState<'replace' | 'append'>('append')
  const [emailOpen, setEmailOpen] = useState(false)
  // Draft, rejected AND sent-back-for-correction are editable (correction restarts the flow).
  const editableStatuses = ['draft', 'rejected', 'needs_correction']
  const readOnly = !editableStatuses.includes(proposal.status)
  const approvalLink = proposal.approvalToken ? buildApprovalLink(proposal.approvalToken) : ''
  const emailSubject = `Budget Approval — ${plantLabel} · FY ${proposal.targetFy}`
  const emailBody = [
    'Dear Plant Head,',
    '',
    `A next-FY Brown Field budget proposal for ${plantLabel} (FY ${proposal.targetFy}) requires your approval.`,
    '',
    'Please review and Approve / Reject using the secure link below:',
    approvalLink,
    '',
    'Regards,',
    'Amber Enterprises CAPEX Portal',
  ].join('\n')

  const headOptions = useMemo(
    () => [...new Set([...BROWN_FIELD_HEAD_ORDER, ...items.map(i => i.head)])],
    [items],
  )
  const headSummary = useMemo(() => summarizeProposalByHead(items), [items])
  const total = useMemo(() => items.reduce((s, i) => s + (i.totalCost || 0), 0), [items])

  function patchItem(id: string, patch: Partial<BudgetProposalItem>) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      const next = { ...it, ...patch }
      // Auto-derive totalCost (Cr) when qty & rateRs are present and totalCost wasn't directly edited.
      if (('qty' in patch || 'rateRs' in patch) && next.qty != null && next.rateRs != null) {
        next.totalCost = +(next.qty * next.rateRs / 1_00_00_000).toFixed(4)
      }
      return next
    }))
  }

  function addRow() {
    setItems(prev => [...prev, emptyProposalItem(headOptions[0] ?? 'Misc.')])
  }
  function removeRow(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  function save() {
    onSave({ targetFy: targetFy.trim(), items })
    toast.success('Draft saved')
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const result = file.name.toLowerCase().endsWith('.csv')
        ? parseCsvText(await file.text())
        : await parseMasterWorkbook(file)
      if (result.errors.length) toast.error(result.errors[0])
      const imported = result.rows.map(parsedRowToProposalItem)
      if (!imported.length) { toast.error('No valid rows found in the file.'); return }
      setItems(prev => importMode === 'replace' ? imported : [...prev, ...imported])
      toast.success(`Imported ${imported.length} line${imported.length > 1 ? 's' : ''} (${importMode})`)
    } catch {
      toast.error('Could not read the file. Use the template format.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground">
            Budget Proposal · {plantLabel}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Based on FY {proposal.sourceFy ?? '—'} · status{' '}
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[proposal.status]}`}>
              {BUDGET_PROPOSAL_STATUS_LABELS[proposal.status]}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-muted-foreground">Target FY</label>
          <input
            value={targetFy}
            onChange={e => setTargetFy(e.target.value)}
            disabled={readOnly}
            placeholder="2027-28"
            className="w-28 text-sm border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />
        </div>
      </div>

      {/* Rejection reason (rejected at any stage — author may revise and resubmit). */}
      {proposal.status === 'rejected' && (
        <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Proposal rejected</p>
            <p className="text-sm text-red-700 mt-0.5">
              {proposal.decisionNote || 'This proposal was rejected. You can revise it and resubmit — it restarts from the plant head.'}
            </p>
          </div>
        </div>
      )}

      {/* Correction remark from the super-admin (sent back for correction). */}
      {proposal.status === 'needs_correction' && (
        <div className="shrink-0 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-orange-800">Sent back for correction</p>
            <p className="text-sm text-orange-700 mt-0.5">
              {proposal.correctionNote || 'The admin asked for changes. Make your corrections and resubmit — it restarts from the plant head.'}
            </p>
          </div>
        </div>
      )}

      {/* Awaiting plant-head approval — the emailed public link. */}
      {proposal.status === 'pending_plant_head' && (
        <div className="shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-amber-800">Awaiting Plant Head approval (sent via email)</p>
            <p className="text-xs text-amber-700 mt-0.5">The plant head approves or rejects through the secure link.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => { if (approvalLink) { navigator.clipboard?.writeText(approvalLink); toast.success('Approval link copied') } }}
              className="px-3 py-2 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" /> Copy link
            </button>
            <button
              onClick={() => setEmailOpen(true)}
              className="px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Mail className="w-3.5 h-3.5" /> Preview email
            </button>
          </div>
        </div>
      )}

      <EmailPreviewModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        title="Plant Head Budget Approval — Email Preview"
        defaultTo={PLANT_HEAD_EMAIL}
        subject={emailSubject}
        body={emailBody}
        link={approvalLink}
        linkLabel="Plant-head approval link"
        sendLabel="Send to Plant Head"
        onSend={(to) => { toast.success(`Budget approval email sent to ${to}`); setEmailOpen(false) }}
      />

      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-border rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add Line
          </button>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(['append', 'replace'] as const).map(m => (
              <button key={m} onClick={() => setImportMode(m)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md capitalize transition-colors ${
                  importMode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}>
                {m}
              </button>
            ))}
          </div>
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-border rounded-lg">
            <Upload className="w-3.5 h-3.5" /> Bulk Upload
          </button>
          <button onClick={() => downloadImportTemplate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-border rounded-lg">
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          <div className="flex-1" />
          <button onClick={save}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-border rounded-lg">
            <Save className="w-3.5 h-3.5" /> Save Draft
          </button>
          <button onClick={() => { onSave({ targetFy: targetFy.trim(), items }); onSubmit() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
            <Send className="w-3.5 h-3.5" /> Submit to Plant Head
          </button>
        </div>
      )}

      {/* Head summary */}
      <div className="flex flex-wrap gap-2 shrink-0">
        {headSummary.map(h => (
          <span key={h.head} className="text-[11px] font-medium bg-muted text-foreground/80 border border-border rounded-full px-2.5 py-1">
            {h.head}: <span className="font-mono font-semibold">{fmtCr(h.totalCr)}</span> · {h.count}
          </span>
        ))}
        <span className="text-[11px] font-bold bg-slate-50 text-slate-800 border border-slate-200 rounded-full px-2.5 py-1 ml-auto">
          Total: {fmtCr(total)}
        </span>
      </div>

      {/* Items table */}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-[11px] uppercase tracking-wide sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-semibold w-40">Head</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Department</th>
              <th className="text-left px-3 py-2 font-semibold">Sub Particulars</th>
              <th className="text-right px-3 py-2 font-semibold w-20">Qty</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Rate (₹)</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Total (Cr)</th>
              {!readOnly && <th className="px-2 py-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={readOnly ? 6 : 7} className="px-3 py-8 text-center text-muted-foreground text-xs">
                No lines. Add a line or bulk-upload a workbook.
              </td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-t border-border">
                <td className="px-3 py-1.5">
                  <input list="bp-heads" value={it.head} disabled={readOnly}
                    onChange={e => patchItem(it.id, { head: e.target.value })}
                    className="w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                <td className="px-3 py-1.5">
                  <input value={it.department} disabled={readOnly}
                    onChange={e => patchItem(it.id, { department: e.target.value })}
                    className="w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                <td className="px-3 py-1.5">
                  <input value={it.subParticulars} disabled={readOnly}
                    onChange={e => patchItem(it.id, { subParticulars: e.target.value })}
                    className="w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" value={it.qty ?? ''} disabled={readOnly}
                    onChange={e => patchItem(it.id, { qty: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                    className="w-full text-[13px] text-right border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" value={it.rateRs ?? ''} disabled={readOnly}
                    onChange={e => patchItem(it.id, { rateRs: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
                    className="w-full text-[13px] text-right border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="number" value={it.totalCost || ''} disabled={readOnly}
                    onChange={e => patchItem(it.id, { totalCost: parseFloat(e.target.value) || 0 })}
                    className="w-full text-[13px] text-right font-mono font-semibold border border-transparent hover:border-border focus:border-primary rounded px-1.5 py-1 bg-transparent focus:outline-none disabled:opacity-70" />
                </td>
                {!readOnly && (
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => removeRow(it.id)} className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="bp-heads">
          {headOptions.map(h => <option key={h} value={h} />)}
        </datalist>
      </div>
    </div>
  )
}
