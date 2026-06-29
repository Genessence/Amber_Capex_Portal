'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeftRight, Send } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES, getPlantForRole } from '@/lib/constants'
import type { AdhocBudgetRequest, ProjectType } from '@/lib/types'
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, getLatestMasterFyForField } from '@/lib/greenFieldConstants'
import {
  ADHOC_STATUS_COLORS,
  ADHOC_STATUS_LABELS,
  effectiveHeadAllocationCr,
  headsForScope,
  headSpareCr,
  headUsedCr,
  validateAdhoc,
} from '@/lib/adhocBudgetUtils'

const ALLOWED = ['sourcing_member', 'sourcing_head', 'super_admin', 'plant_head', 'plant_head_jhajjar_p1', 'plant_head_jhajjar_p2']

function fmtCr(n: number) {
  return `₹${n.toFixed(2)} Cr`
}

export default function AdhocBudgetPage() {
  const router = useRouter()
  const {
    capexMaster, customPlants, usedAmountByMasterItemId,
    brownFieldHeadAllocations, adhocBudgetRequests, createAdhocBudgetRequest,
  } = useCapex()

  const [role, setRole] = useState('')
  const [projectType, setProjectType] = useState<ProjectType>('rac')
  const [plant, setPlant] = useState<string | null>(null)
  const [fromHead, setFromHead] = useState('')
  const [toHead, setToHead] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    const r = localStorage.getItem('capex_role') ?? ''
    if (!ALLOWED.includes(r) && !r.startsWith('plant_head_')) { router.replace('/capex/requests'); return }
    setRole(r)
    const scoped = getPlantForRole(r)
    if (scoped) setPlant(scoped)
    const handler = (e: Event) => setRole((e as CustomEvent).detail)
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [router])

  const rolePlant = getPlantForRole(role)
  const fy = useMemo(() => getLatestMasterFyForField(capexMaster, 'brown_field'), [capexMaster])

  const allPlants = useMemo(() => {
    const base = PLANTS.map(p => ({ value: p.value, label: p.label }))
    const extra = customPlants.filter(p => !p.greenFieldPlant && !base.some(b => b.value === p.value)).map(p => ({ value: p.value, label: p.label }))
    let list = [...base, ...extra]
    if (rolePlant) list = list.filter(p => p.value === rolePlant)
    return list
  }, [customPlants, rolePlant])
  const plantLabel = (v: string) => allPlants.find(p => p.value === v)?.label ?? v

  const heads = useMemo(
    () => (plant ? headsForScope(capexMaster, plant, fy, projectType) : []),
    [capexMaster, plant, fy, projectType],
  )

  function headStats(head: string) {
    if (!plant) return { alloc: 0, used: 0, spare: 0 }
    const alloc = effectiveHeadAllocationCr(capexMaster, brownFieldHeadAllocations, plant, fy, projectType, head)
    const used = headUsedCr(capexMaster, usedAmountByMasterItemId, plant, fy, projectType, head)
    const spare = headSpareCr(capexMaster, brownFieldHeadAllocations, usedAmountByMasterItemId, plant, fy, projectType, head)
    return { alloc, used, spare }
  }

  const fromSpare = fromHead ? headStats(fromHead).spare : 0
  const errors = plant ? validateAdhoc({ fromHead, toHead, amountCr: parseFloat(amount) || 0, fromSpareCr: fromSpare }) : ['Select a plant.']
  const myRequests = adhocBudgetRequests
    .filter(r => (!plant || r.plant === plant) && r.projectType === projectType)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  function submit() {
    if (!plant || errors.length) { toast.error(errors[0] ?? 'Fix the form'); return }
    const req: AdhocBudgetRequest = {
      id: `adhoc-${crypto.randomUUID()}`,
      plant, fy, projectType,
      fromHead, toHead,
      amountCr: parseFloat(amount),
      reason: reason.trim() || undefined,
      status: 'pending_admin',
      createdBy: ROLE_NAMES[role] ?? role,
      createdByRole: role,
      createdAt: new Date().toISOString(),
    }
    createAdhocBudgetRequest(req)
    setFromHead(''); setToHead(''); setAmount(''); setReason('')
    toast.success('Adhoc budget request submitted for admin approval')
  }

  return (
    <div className="p-5 h-full flex flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-primary" /> Adhoc Budget Reallocation
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Move budget between heads within the same plant (Brown Field, FY {fy}). Requires admin approval.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          {PROJECT_TYPES.map(pt => (
            <button key={pt} onClick={() => { setProjectType(pt); setFromHead(''); setToHead('') }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${projectType === pt ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
              {PROJECT_TYPE_LABELS[pt]}
            </button>
          ))}
        </div>
        <select value={plant ?? ''} onChange={e => { setPlant(e.target.value || null); setFromHead(''); setToHead('') }} disabled={!!rolePlant}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60">
          <option value="">Select plant…</option>
          {allPlants.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>

      {plant && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
          {/* Form */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3 self-start">
            <h2 className="font-semibold text-foreground">New Transfer · {plantLabel(plant)}</h2>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">From Head (source)</label>
              <select value={fromHead} onChange={e => setFromHead(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Select head…</option>
                {heads.map(h => <option key={h} value={h}>{h} — {fmtCr(headStats(h).spare)} spare</option>)}
              </select>
              {fromHead && <p className="text-[11px] text-muted-foreground mt-1">Spare available: <span className="font-semibold">{fmtCr(fromSpare)}</span></p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">To Head (destination)</label>
              <select value={toHead} onChange={e => setToHead(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Select head…</option>
                {heads.filter(h => h !== fromHead).map(h => <option key={h} value={h}>{h} — {fmtCr(headStats(h).used)} used / {fmtCr(headStats(h).alloc)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Amount (Cr)</label>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted-foreground mb-1">Reason (optional)</label>
              <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this reallocation needed?"
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            </div>
            {errors.length > 0 && amount && <p className="text-xs text-red-600">{errors[0]}</p>}
            <button onClick={submit} disabled={errors.length > 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50">
              <Send className="w-4 h-4" /> Submit for Admin Approval
            </button>
          </div>

          {/* History */}
          <div className="rounded-xl border border-border bg-card p-4 overflow-y-auto">
            <h2 className="font-semibold text-foreground mb-3">Requests · {PROJECT_TYPE_LABELS[projectType]}</h2>
            {myRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No adhoc requests yet for this scope.</p>
            ) : (
              <div className="space-y-2">
                {myRequests.map(r => (
                  <div key={r.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{r.fromHead} → {r.toHead}</p>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ADHOC_STATUS_COLORS[r.status]}`}>{ADHOC_STATUS_LABELS[r.status]}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{fmtCr(r.amountCr)} · by {r.createdBy}{r.reason ? ` · ${r.reason}` : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
