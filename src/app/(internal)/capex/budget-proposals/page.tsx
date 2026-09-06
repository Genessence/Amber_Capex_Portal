'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowLeft, Plus, Trash2, Upload, Download, Send, Save, ClipboardList, FileSpreadsheet, Copy, Mail, AlertCircle,
  Building2, X,
} from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES, PLANT_HEAD_EMAIL, getPlantForRole } from '@/lib/constants'
import { buildApprovalLink } from '@/lib/tokenUtils'
import { EmailPreviewModal } from '@/components/EmailPreviewModal'
import type {
  BudgetProposal, BudgetProposalItem, FieldType, GreenFieldPlantCreation, ProjectType,
} from '@/lib/types'
import { currentFyCode } from '@/lib/budgetProposalUtils'
import {
  BROWN_FIELD_HEAD_ORDER,
  GREEN_FIELD_SECTION_HEADS,
  GREEN_FIELD_SECTION_ORDER,
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
} from '@/lib/greenFieldConstants'
import {
  BUDGET_PROPOSAL_STATUS_COLORS,
  BUDGET_PROPOSAL_STATUS_LABELS,
  createBlankProposal,
  emptyProposalItem,
  greenFieldPlantBudgetCr,
  parsedRowToProposalItem,
  proposalFieldType,
  proposalTotalCr,
  summarizeProposalByHead,
  summarizeProposalGreenField,
  validateProposal,
} from '@/lib/budgetProposalUtils'
import { parseCsvText, parseMasterWorkbook, downloadImportTemplate } from '@/lib/bulkMasterImport'

const ALLOWED_ROLES = ['maintenance', 'sourcing_member', 'super_admin']

/**
 * Green Field planning is **super-admin only**. The CAPEX-master authors (maintenance / sourcing)
 * plan the next Brown Field FY; a Green Field budget is a whole new plant's envelope and is set by
 * the admin, who publishes it directly with no approval chain.
 */
const GREEN_FIELD_ROLES = ['super_admin']

const FIELD_TABS: { value: FieldType; label: string }[] = [
  { value: 'brown_field', label: 'Brown Field' },
  { value: 'green_field', label: 'Green Field' },
]

function fmtCr(n: number) {
  return `₹${n.toFixed(2)} Cr`
}

export default function BudgetProposalsPage() {
  const router = useRouter()
  const {
    capexMaster, customPlants, budgetProposals,
    createBudgetProposal, updateBudgetProposal, submitBudgetProposal, publishGreenFieldBudget,
    createGreenFieldPlant,
  } = useCapex()

  const [role, setRole] = useState('')
  const [fieldType, setFieldType] = useState<FieldType>('brown_field')
  const [projectType, setProjectType] = useState<ProjectType>('rac')
  const [plant, setPlant] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreatePlant, setShowCreatePlant] = useState(false)
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
    const handler = (e: Event) => {
      const next = (e as CustomEvent).detail as string
      setRole(next)
      // Switching to a role without Green Field rights must not leave them on the Green Field tab
      // looking at a budget they cannot author.
      if (!GREEN_FIELD_ROLES.includes(next)) setFieldType('brown_field')
    }
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [router])

  const rolePlant = getPlantForRole(role)
  const canGreenField = GREEN_FIELD_ROLES.includes(role)
  const isGreenField = fieldType === 'green_field'

  /**
   * Green Field plants are the ones CREATED as Green Field — a Green Field budget is a brand-new
   * site, so the roster is not the Brown Field plant list. A seeded plant that already carries a
   * published Green Field budget stays selectable too, otherwise re-publishing an existing year
   * would be impossible.
   */
  const greenFieldPlants = useMemo(() => {
    const withGreenBudget = new Set(
      capexMaster.filter(m => (m.fieldType ?? 'brown_field') === 'green_field').map(m => m.plant),
    )
    const seen = new Set<string>()
    const list: { value: string; label: string }[] = []
    const push = (value: string, label: string) => {
      if (seen.has(value)) return
      seen.add(value)
      list.push({ value, label })
    }
    customPlants.forEach(p => {
      if (p.greenFieldPlant || withGreenBudget.has(p.value)) push(p.value, p.label)
    })
    PLANTS.forEach(p => { if (withGreenBudget.has(p.value)) push(p.value, p.label) })
    return list
  }, [customPlants, capexMaster])

  const brownFieldPlants = useMemo(() => {
    const base = PLANTS.map(p => ({ value: p.value, label: p.label }))
    const extra = customPlants
      .filter(p => !p.greenFieldPlant && !base.some(b => b.value === p.value))
      .map(p => ({ value: p.value, label: p.label }))
    return [...base, ...extra]
  }, [customPlants])

  const allPlants = useMemo(() => {
    const list = isGreenField ? greenFieldPlants : brownFieldPlants
    return rolePlant ? list.filter(p => p.value === rolePlant) : list
  }, [isGreenField, greenFieldPlants, brownFieldPlants, rolePlant])

  /**
   * A plant selected on one tab usually does not exist on the other (Green Field plants are not in
   * the Brown Field roster and vice versa). Leaving a stale selection would show an empty list
   * under a plant name the dropdown cannot even display, so the selection is cleared on switch.
   */
  useEffect(() => {
    if (plant && !allPlants.some(p => p.value === plant)) setPlant(rolePlant ?? null)
  }, [allPlants, plant, rolePlant])

  const plantLabel = (v: string) => allPlants.find(p => p.value === v)?.label ?? v

  // Proposals for the current scope (plant + projectType)
  const scopedProposals = useMemo(
    () =>
      budgetProposals
        .filter(p =>
          (!plant || p.plant === plant) &&
          p.projectType === projectType &&
          proposalFieldType(p) === fieldType,
        )
        .sort((a, b) => (b.createdAt).localeCompare(a.createdAt)),
    [budgetProposals, plant, projectType, fieldType],
  )

  const editing = budgetProposals.find(p => p.id === editingId) ?? null

  /**
   * Start a blank budget. Takes the plant explicitly so it can be called in the same tick a plant
   * is created — reading the `plant` state there would still hold the pre-create value.
   */
  function handleCreate(forPlant: string | null = plant, label?: string, targetFy?: string) {
    if (!forPlant) return
    // Always a BLANK draft — the previous FY's budget is never carried over.
    const proposal = createBlankProposal({
      capexMaster, plant: forPlant, projectType, fieldType, createdBy: role, targetFy,
    })
    createBudgetProposal(proposal)
    setEditingId(proposal.id)
    toast.success(
      `Blank draft created for ${label ?? plantLabel(forPlant)} · ${proposal.targetFy || 'new FY'} — upload your lines`,
    )
  }

  /**
   * Create the Green Field site, select it, and drop straight into its blank budget — carrying the
   * FY the plant was created for, so the budget cannot open on a different year than the site.
   */
  function handlePlantCreated(value: string, label: string, fy: string) {
    setShowCreatePlant(false)
    setPlant(value)
    handleCreate(value, label, fy)
  }

  if (editing) {
    return (
      <BudgetProposalEditor
        proposal={editing}
        plantLabel={plantLabel(editing.plant)}
        onBack={() => setEditingId(null)}
        onSave={(updates) => updateBudgetProposal(editing.id, updates)}
        onSubmit={(next) => {
          // `next` is the editor's LIVE draft. Validating `editing` here would read the copy from
          // before this click's save, so an upload-then-publish in one go would validate nothing.
          const errors = validateProposal(next)
          if (errors.length) { toast.error(errors[0]); return }
          if (proposalFieldType(next) === 'green_field') {
            publishGreenFieldBudget(next, ROLE_NAMES[role] ?? role)
            setEditingId(null)
            toast.success(`Green Field budget published as FY ${next.targetFy} — buyers can raise Green Field requests against it now`)
            return
          }
          submitBudgetProposal(next.id)
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
            {isGreenField
              ? 'Upload a Green Field plant budget — plant → section → head → per-machine. Publishing makes it the live FY buyers raise Green Field requests against.'
              : 'Author next-FY Brown Field budgets. Submitted proposals go to admin for approval, then publish as the new live FY.'}
          </p>
        </div>
      </div>

      {/* Budget type — Green Field is offered to the super admin only. It gets its OWN labelled
          row rather than a third grey pill group in the scope line: three identical pill groups
          side by side made the new one invisible, which is exactly how it was first missed. */}
      {canGreenField && (
        <div className="shrink-0 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Budget type
          </span>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {FIELD_TABS.map(t => (
              <button key={t.value} onClick={() => { setFieldType(t.value); setEditingId(null) }}
                aria-pressed={fieldType === t.value}
                className={`px-4 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${
                  fieldType === t.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {isGreenField
              ? 'Publishes straight to the live FY — no approval chain.'
              : 'Goes to Plant Head → Admin → Global Accounts for approval.'}
          </span>
        </div>
      )}

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
        {isGreenField && (
          <button onClick={() => setShowCreatePlant(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg transition-colors">
            <Building2 className="w-3.5 h-3.5" /> Create Green Field Plant
          </button>
        )}
        {plant && (
          <button onClick={() => handleCreate()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-500 hover:bg-slate-600 text-white rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" /> {isGreenField ? 'Upload Budget for this Plant' : 'New Next-FY Proposal'}
          </button>
        )}
      </div>

      {showCreatePlant && (
        <CreateGreenFieldPlantModal
          projectType={projectType}
          existingPlants={[...PLANTS.map(p => p.value), ...customPlants.map(p => p.value)]}
          onClose={() => setShowCreatePlant(false)}
          onCreate={(creation) => {
            createGreenFieldPlant(creation)
            toast.success(`Green Field plant "${creation.plantLabel}" created — now upload its budget`)
            handlePlantCreated(creation.plantValue, creation.plantLabel, creation.fy)
          }}
        />
      )}

      {/* Proposals list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!plant ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-20">
            {isGreenField ? (
              <>
                <Building2 className="w-10 h-10 text-slate-200" />
                <p className="text-sm font-semibold text-muted-foreground">
                  {greenFieldPlants.length === 0
                    ? 'No Green Field plants yet'
                    : 'Select a Green Field plant'}
                </p>
                {/* The order matters and is stated, because a Green Field budget cannot exist
                    before the site it belongs to. */}
                <p className="text-xs text-muted-foreground max-w-md">
                  Step 1 — create the plant. Step 2 — upload its budget: plant → section → head →
                  per-machine, in one sheet.
                </p>
                <button onClick={() => setShowCreatePlant(true)}
                  className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
                  <Building2 className="w-3.5 h-3.5" /> Create Green Field Plant
                </button>
              </>
            ) : (
              <>
                <FileSpreadsheet className="w-10 h-10 text-slate-200" />
                <p className="text-sm text-muted-foreground">Select a plant to view or create budget proposals.</p>
              </>
            )}
          </div>
        ) : scopedProposals.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-20">
            <FileSpreadsheet className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold text-muted-foreground">
              No {isGreenField ? 'Green Field budgets' : 'proposals'} yet for {plantLabel(plant)} · {PROJECT_TYPE_LABELS[projectType]}
            </p>
            <p className="text-xs text-muted-foreground">
              {isGreenField
                ? 'Create a budget, download the template and upload the plant’s full hierarchy.'
                : 'Create a next-FY proposal to plan a new budget.'}
            </p>
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
  onSubmit: (next: BudgetProposal) => void
  fileRef: React.RefObject<HTMLInputElement | null>
}

function BudgetProposalEditor({ proposal, plantLabel, onBack, onSave, onSubmit, fileRef }: EditorProps) {
  const fieldType = proposalFieldType(proposal)
  const isGreenField = fieldType === 'green_field'
  const [targetFy, setTargetFy] = useState(proposal.targetFy)
  const [plantBudgetCr, setPlantBudgetCr] = useState(proposal.plantBudgetCr ?? 0)
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

  const headOptions = useMemo(() => {
    // Green Field heads are the shops / utilities inside the four sections; a section with no
    // predefined heads (Compliances, IT) uses the section name as its own head.
    const base = isGreenField
      ? GREEN_FIELD_SECTION_ORDER.flatMap(sec => {
          const heads = GREEN_FIELD_SECTION_HEADS[sec]
          return heads.length ? [...heads] : [sec as string]
        })
      : BROWN_FIELD_HEAD_ORDER
    return [...new Set([...base, ...items.map(i => i.head)])]
  }, [items, isGreenField])
  const headSummary = useMemo(() => summarizeProposalByHead(items), [items])
  const gfSummary = useMemo(
    () => (isGreenField ? summarizeProposalGreenField(items) : []),
    [items, isGreenField],
  )
  const total = useMemo(() => items.reduce((s, i) => s + (i.totalCost || 0), 0), [items])
  // The plant envelope the sections are distributed out of: the admin's own figure where they typed
  // one, else the sum of the section envelopes — never a silent 0, which would read as "over".
  const effectivePlantBudget = plantBudgetCr > 0
    ? plantBudgetCr
    : gfSummary.reduce((s, sec) => s + sec.budgetCr, 0)
  const plantOverAllocated = effectivePlantBudget > 0 && total > effectivePlantBudget + 0.0001

  // The downloadable template is pre-filled from THIS plant's existing budget, so authors see real
  // sub-particulars across their own heads rather than one invented row. Falls back to the wider
  // Brown Field master when the plant itself has no rows yet.
  const { capexMaster } = useCapex()
  const templateSource = useMemo(() => {
    const brownField = capexMaster.filter(m => (m.fieldType ?? 'brown_field') === fieldType)
    const scoped = brownField.filter(
      m => m.plant === proposal.plant && (m.projectType ?? 'rac') === (proposal.projectType ?? 'rac'),
    )
    // Deliberately NOT filtered to one FY. Picking the "latest" FY sampled whatever next-FY
    // proposal was published most recently — often a line or two — instead of the real multi-crore
    // budget, producing a thin template. The sheet has no FY column, so pooling every FY for the
    // plant is invisible to the author and always gives the richest, widest sample.
    return scoped.length ? scoped : brownField
  }, [capexMaster, proposal.plant, proposal.projectType, fieldType])

  function patchItem(id: string, patch: Partial<BudgetProposalItem>) {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it
      // Rate was removed from the budget, so Total (Cr) is always entered directly — never derived
      // from a hidden rate (which would silently overwrite what the author typed).
      return { ...it, ...patch }
    }))
  }

  function addRow() {
    setItems(prev => [
      ...prev,
      emptyProposalItem(headOptions[0] ?? 'Misc.', isGreenField ? GREEN_FIELD_SECTION_ORDER[0] : undefined),
    ])
  }
  function removeRow(id: string) {
    setItems(prev => prev.filter(it => it.id !== id))
  }

  function save() {
    onSave({ targetFy: targetFy.trim(), items, plantBudgetCr: isGreenField ? plantBudgetCr : undefined })
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
      const imported = result.rows.map(r => parsedRowToProposalItem(r, fieldType))
      if (!imported.length) { toast.error('No valid rows found in the file.'); return }
      // The plant envelope is a sheet-level figure — take it from the first row that carries one.
      const uploadedPlantBudget = result.rows.find(r => (r.plantBudgetCr ?? 0) > 0)?.plantBudgetCr
      if (isGreenField && uploadedPlantBudget) setPlantBudgetCr(uploadedPlantBudget)
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
            Blank draft · status{' '}
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${BUDGET_PROPOSAL_STATUS_COLORS[proposal.status]}`}>
              {BUDGET_PROPOSAL_STATUS_LABELS[proposal.status]}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isGreenField && (
            <>
              <label className="text-xs font-semibold text-muted-foreground">Plant Budget (Cr)</label>
              <input
                type="number" value={plantBudgetCr || ''} disabled={readOnly}
                onChange={e => setPlantBudgetCr(parseFloat(e.target.value) || 0)}
                placeholder="55"
                title="The overall plant envelope the sections are distributed out of. Left blank, it is the sum of the section budgets."
                className="w-24 text-sm text-right font-mono border border-border rounded-lg px-3 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              />
            </>
          )}
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
          <button onClick={() => downloadImportTemplate(templateSource, fieldType)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-border rounded-lg">
            <Download className="w-3.5 h-3.5" /> Template
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
          <div className="flex-1" />
          <button onClick={save}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 border border-border rounded-lg">
            <Save className="w-3.5 h-3.5" /> Save Draft
          </button>
          <button onClick={() => {
              const next: BudgetProposal = {
                ...proposal,
                targetFy: targetFy.trim(),
                items,
                plantBudgetCr: isGreenField ? plantBudgetCr : undefined,
              }
              onSave({ targetFy: next.targetFy, items: next.items, plantBudgetCr: next.plantBudgetCr })
              onSubmit(next)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg">
            <Send className="w-3.5 h-3.5" /> {isGreenField ? 'Publish Budget' : 'Submit to Plant Head'}
          </button>
        </div>
      )}

      {/* Green Field hierarchy: plant → section → head, each with its envelope vs what the machine
          lines under it actually consume. This is the whole point of the wider template. */}
      {isGreenField && gfSummary.length > 0 && (
        <div className="shrink-0 rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Budget distribution
            </p>
            <p className="text-[12px] font-semibold">
              Plant: <span className="font-mono">{fmtCr(effectivePlantBudget)}</span>
              <span className="text-muted-foreground"> · allocated to machines </span>
              <span className={`font-mono ${plantOverAllocated ? 'text-red-600' : 'text-emerald-600'}`}>
                {fmtCr(total)}
              </span>
              {plantOverAllocated && <span className="text-red-600"> · over plant budget</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {gfSummary.map(sec => (
              <div key={sec.section} className="rounded-lg border border-border bg-muted/40 px-2.5 py-2 min-w-[190px]">
                <p className="text-[12px] font-bold text-foreground">
                  {sec.section} · <span className="font-mono">{fmtCr(sec.budgetCr)}</span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {sec.heads.map(h => (
                    <li key={h.head} className="text-[11px] text-muted-foreground flex justify-between gap-3">
                      <span className="truncate">{h.head} ({h.count})</span>
                      <span className={`font-mono shrink-0 ${h.usedCr > h.budgetCr + 0.0001 ? 'text-red-600' : 'text-foreground/80'}`}>
                        {fmtCr(h.usedCr)} / {fmtCr(h.budgetCr)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Head summary */}
      <div className={`flex flex-wrap gap-2 shrink-0 ${isGreenField ? 'hidden' : ''}`}>
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
              {isGreenField && <th className="text-left px-3 py-2 font-semibold w-44">Section</th>}
              <th className="text-left px-3 py-2 font-semibold w-40">Head</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Department</th>
              <th className="text-left px-3 py-2 font-semibold">Sub Particulars</th>
              <th className="text-right px-3 py-2 font-semibold w-20">Qty</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Total (Cr)</th>
              {!readOnly && <th className="px-2 py-2 w-10"></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={(readOnly ? 5 : 6) + (isGreenField ? 1 : 0)} className="px-3 py-8 text-center text-muted-foreground text-xs">
                No lines. Add a line or bulk-upload a workbook.
              </td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-t border-border">
                {isGreenField && (
                  <td className="px-3 py-1.5">
                    {/* A free-text section would silently file the machine under an envelope the
                        request wizard never renders, so it is a closed list. */}
                    <select
                      value={it.division && (GREEN_FIELD_SECTION_ORDER as readonly string[]).includes(it.division)
                        ? it.division : GREEN_FIELD_SECTION_ORDER[0]}
                      disabled={readOnly}
                      onChange={e => patchItem(it.id, { division: e.target.value })}
                      className="w-full text-[13px] border border-transparent hover:border-border focus:border-primary rounded px-1 py-1 bg-transparent focus:outline-none disabled:opacity-70"
                    >
                      {GREEN_FIELD_SECTION_ORDER.map(sec => <option key={sec} value={sec}>{sec}</option>)}
                    </select>
                  </td>
                )}
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

// ── Create Green Field Plant ──────────────────────────────────────────────────

/** Slugify a plant name into the stable `value` every plant is keyed by across the portal. */
function plantSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

interface CreatePlantProps {
  projectType: ProjectType
  /** Every plant value already taken — `addCustomPlant` dedupes SILENTLY, so collisions are
      caught here instead of appearing to succeed and doing nothing. */
  existingPlants: string[]
  onClose: () => void
  onCreate: (creation: GreenFieldPlantCreation) => void
}

/**
 * Step 1 of the Green Field flow: register the site. Deliberately carries **no budget field** — the
 * budget arrives in step 2 as the uploaded hierarchy (plant → section → head → machine), and a
 * figure typed here would be overwritten by the first publish anyway.
 */
function CreateGreenFieldPlantModal({ projectType, existingPlants, onClose, onCreate }: CreatePlantProps) {
  const [label, setLabel] = useState('')
  const [state, setState] = useState('')
  const [assignedUser, setAssignedUser] = useState('')
  const [fy, setFy] = useState(currentFyCode())

  const slug = plantSlug(label)
  const duplicate = !!slug && existingPlants.includes(slug)
  const fyValid = /^\d{4}-\d{2}$/.test(fy.trim())
  const error =
    !label.trim() ? 'Enter a plant name.'
    : !slug ? 'Plant name must contain at least one letter or number.'
    : duplicate ? `A plant named "${label.trim()}" already exists.`
    : !fyValid ? 'Financial year must be in YYYY-YY format (e.g. 2026-27).'
    : null

  function submit() {
    if (error) { toast.error(error); return }
    onCreate({
      plantValue: slug,
      plantLabel: label.trim(),
      state: state.trim(),
      assignedUser: assignedUser.trim() || undefined,
      projectType,
      fy: fy.trim(),
      // No budgetCr — the envelope comes from the uploaded sheet in step 2.
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog" aria-modal="true" aria-labelledby="gf-plant-title">
      <div className="w-full max-w-md rounded-xl bg-card border border-border shadow-lg">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div>
            <h2 id="gf-plant-title" className="text-base font-bold text-foreground">Create Green Field Plant</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Step 1 of 2 · {PROJECT_TYPE_LABELS[projectType]}. You&apos;ll upload its budget next.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Plant name" required>
            <input autoFocus value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Sri City Plant 1"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
          </Field>
          <Field label="State">
            <input value={state} onChange={e => setState(e.target.value)}
              placeholder="e.g. Andhra Pradesh"
              className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Financial year" required>
              <input value={fy} onChange={e => setFy(e.target.value)} placeholder="2026-27"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            </Field>
            <Field label="Plant head (optional)">
              <input value={assignedUser} onChange={e => setAssignedUser(e.target.value)} placeholder="Name"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            </Field>
          </div>
          {label.trim() && error && (
            <p className="text-xs text-red-600 flex items-start gap-1.5" role="alert">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button onClick={onClose}
            className="px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground">
            Cancel
          </button>
          <button onClick={submit} disabled={!!error}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed">
            Create &amp; Continue to Budget
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">
        {label}{required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
