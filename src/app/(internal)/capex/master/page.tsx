'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { Check, Pencil, RotateCcw, X, Building2, Plus, ArrowLeft, ChevronRight, SlidersHorizontal, Trash2, ClipboardList, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES, getPlantForRole } from '@/lib/constants'
import type { CapexMasterItem, FieldType, PlantMeta, ProjectType } from '@/lib/types'
import { FIELD_TYPE_LABELS } from '@/lib/types'
import {
  BROWN_FIELD_HEAD_ORDER,
  DEFAULT_PROJECT_TYPE,
  defaultDivisionForFieldType,
  defaultHeadForGreenFieldSection,
  FLAT_MASTER_DIVISION,
  getCanonicalHeadOrder,
  getFieldDivisionHeads,
  getGreenFieldHeadBudgetCr,
  getGreenFieldPlantBudgetCr,
  getGreenFieldSectionBudgetCr,
  getHeadBudgetSummaries,
  greenFieldBudgetStatus,
  GREEN_FIELD_SECTION_ORDER,
  isFlatMasterFieldType,
  isProjectTypeScopedField,
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  resolveProjectType,
  sumGreenFieldHeadBudgetsForPlant,
  sumGreenFieldHeadBudgetsForSection,
  sumGreenFieldSectionBudgetsForPlant,
  type GreenFieldSection,
} from '@/lib/greenFieldConstants'
import { getBrownFieldHeadBudgetCr } from '@/lib/adhocBudgetUtils'

const CR_TO_INR = 10_000_000

// ── Head palette ─────────────────────────────────────────────────────────────

const HEAD_STYLE: Record<string, {
  badge: string
  border: string
  row: string
  chip: string
  dot: string
}> = {
  'Automation':        { badge: 'bg-violet-100 text-violet-700 border border-violet-200', border: 'border-l-violet-400', row: 'bg-violet-50/30',  chip: 'bg-violet-50 border-violet-200 text-violet-700',  dot: 'bg-violet-400' },
  'Machinery':         { badge: 'bg-blue-100 text-blue-700 border border-blue-200',       border: 'border-l-blue-400',   row: 'bg-blue-50/30',    chip: 'bg-blue-50 border-blue-200 text-blue-700',        dot: 'bg-blue-400'   },
  'General':           { badge: 'bg-slate-100 text-slate-600 border border-slate-200',    border: 'border-l-slate-300',  row: 'bg-slate-50/30',   chip: 'bg-slate-50 border-slate-200 text-slate-600',     dot: 'bg-slate-400'  },
  'Digitization':      { badge: 'bg-teal-100 text-teal-700 border border-teal-200',       border: 'border-l-teal-400',   row: 'bg-teal-50/30',    chip: 'bg-teal-50 border-teal-200 text-teal-700',        dot: 'bg-teal-400'   },
  'New Business':      { badge: 'bg-orange-100 text-orange-700 border border-orange-200', border: 'border-l-orange-400', row: 'bg-orange-50/30',  chip: 'bg-orange-50 border-orange-200 text-orange-700',  dot: 'bg-orange-400' },
  'Safety & Security': { badge: 'bg-red-100 text-red-700 border border-red-200',          border: 'border-l-red-400',    row: 'bg-red-50/20',     chip: 'bg-red-50 border-red-200 text-red-700',           dot: 'bg-red-400'    },
  'Misc.':             { badge: 'bg-stone-100 text-stone-500 border border-stone-200',    border: 'border-l-stone-300',  row: 'bg-stone-50/30',   chip: 'bg-stone-50 border-stone-200 text-stone-500',     dot: 'bg-stone-400'  },
}

const HEAD_ORDER = ['Automation', 'Machinery', 'General', 'Digitization', 'New Business', 'Safety & Security', 'Utilities', 'Misc.']

const GF_HEAD_STYLE: Record<string, typeof HEAD_STYLE[string]> = {
  'Land Buying':              { badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200', border: 'border-l-emerald-500', row: 'bg-emerald-50/30', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-500' },
  'Land Infrastructure':      { badge: 'bg-lime-100 text-lime-800 border border-lime-200',         border: 'border-l-lime-500',    row: 'bg-lime-50/30',    chip: 'bg-lime-50 border-lime-200 text-lime-800',         dot: 'bg-lime-500'    },
  'Admin Blocks':             { badge: 'bg-teal-100 text-teal-800 border border-teal-200',         border: 'border-l-teal-500',    row: 'bg-teal-50/30',    chip: 'bg-teal-50 border-teal-200 text-teal-800',         dot: 'bg-teal-500'    },
  'Furniture':                { badge: 'bg-amber-100 text-amber-800 border border-amber-200',       border: 'border-l-amber-500',   row: 'bg-amber-50/30',   chip: 'bg-amber-50 border-amber-200 text-amber-800',       dot: 'bg-amber-500'   },
  'Compliances':              { badge: 'bg-rose-100 text-rose-800 border border-rose-200',          border: 'border-l-rose-500',    row: 'bg-rose-50/30',    chip: 'bg-rose-50 border-rose-200 text-rose-800',          dot: 'bg-rose-500'    },
  'Moulding Shop':                 { badge: 'bg-sky-100 text-sky-800 border border-sky-200',             border: 'border-l-sky-500',     row: 'bg-sky-50/30',     chip: 'bg-sky-50 border-sky-200 text-sky-800',             dot: 'bg-sky-500'     },
  'Paint Shop':               { badge: 'bg-indigo-100 text-indigo-800 border border-indigo-200',     border: 'border-l-indigo-500',  row: 'bg-indigo-50/30',  chip: 'bg-indigo-50 border-indigo-200 text-indigo-800',   dot: 'bg-indigo-500'  },
  'Press Shop':                    { badge: 'bg-blue-100 text-blue-800 border border-blue-200',           border: 'border-l-blue-500',    row: 'bg-blue-50/30',    chip: 'bg-blue-50 border-blue-200 text-blue-800',           dot: 'bg-blue-500'    },
  'Copper Shop':                 { badge: 'bg-violet-100 text-violet-800 border border-violet-200',     border: 'border-l-violet-500',  row: 'bg-violet-50/30',  chip: 'bg-violet-50 border-violet-200 text-violet-800',   dot: 'bg-violet-500'  },
  'Assembly Shop':                 { badge: 'bg-cyan-100 text-cyan-800 border border-cyan-200',           border: 'border-l-cyan-500',    row: 'bg-cyan-50/30',    chip: 'bg-cyan-50 border-cyan-200 text-cyan-800',          dot: 'bg-cyan-500'    },
  'IT Shop':                       { badge: 'bg-slate-100 text-slate-700 border border-slate-200',       border: 'border-l-slate-500',   row: 'bg-slate-50/30',   chip: 'bg-slate-50 border-slate-200 text-slate-700',       dot: 'bg-slate-500'   },
  'Automation Shop':               { badge: 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200', border: 'border-l-fuchsia-500', row: 'bg-fuchsia-50/30', chip: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800', dot: 'bg-fuchsia-500' },
  'Tool Room Shop':                { badge: 'bg-orange-100 text-orange-800 border border-orange-200',     border: 'border-l-orange-500',  row: 'bg-orange-50/30',  chip: 'bg-orange-50 border-orange-200 text-orange-800',   dot: 'bg-orange-500'  },
  'Tool Room':                     { badge: 'bg-orange-100 text-orange-800 border border-orange-200',     border: 'border-l-orange-500',  row: 'bg-orange-50/30',  chip: 'bg-orange-50 border-orange-200 text-orange-800',   dot: 'bg-orange-500'  },
  'Research and Development':        { badge: 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200', border: 'border-l-fuchsia-500', row: 'bg-fuchsia-50/30', chip: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-800', dot: 'bg-fuchsia-500' },
  'Plant Machinery':                 { badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200',   border: 'border-l-emerald-500', row: 'bg-emerald-50/30', chip: 'bg-emerald-50 border-emerald-200 text-emerald-800', dot: 'bg-emerald-500' },
  'Information Technology':          { badge: 'bg-indigo-100 text-indigo-800 border border-indigo-200',     border: 'border-l-indigo-500',  row: 'bg-indigo-50/30',  chip: 'bg-indigo-50 border-indigo-200 text-indigo-800',   dot: 'bg-indigo-500'  },
  'Lab & Quality Shop':            { badge: 'bg-pink-100 text-pink-800 border border-pink-200',           border: 'border-l-pink-500',    row: 'bg-pink-50/30',    chip: 'bg-pink-50 border-pink-200 text-pink-800',          dot: 'bg-pink-500'    },
  'Storage Shop':                  { badge: 'bg-yellow-100 text-yellow-800 border border-yellow-200',     border: 'border-l-yellow-500',  row: 'bg-yellow-50/30',  chip: 'bg-yellow-50 border-yellow-200 text-yellow-800',   dot: 'bg-yellow-500'  },
  'Fire & Safety':            { badge: 'bg-red-100 text-red-800 border border-red-200',              border: 'border-l-red-500',     row: 'bg-red-50/30',     chip: 'bg-red-50 border-red-200 text-red-800',             dot: 'bg-red-500'     },
  'N2/O2/Helium/LPG/PNG':     { badge: 'bg-purple-100 text-purple-800 border border-purple-200',     border: 'border-l-purple-500',  row: 'bg-purple-50/30',  chip: 'bg-purple-50 border-purple-200 text-purple-800',   dot: 'bg-purple-500'  },
  'ETP/STP':                  { badge: 'bg-green-100 text-green-800 border border-green-200',        border: 'border-l-green-500',   row: 'bg-green-50/30',   chip: 'bg-green-50 border-green-200 text-green-800',       dot: 'bg-green-500'   },
  'Electrical':               { badge: 'bg-amber-100 text-amber-900 border border-amber-300',        border: 'border-l-amber-600',   row: 'bg-amber-50/30',   chip: 'bg-amber-50 border-amber-300 text-amber-900',       dot: 'bg-amber-600'   },
  'Misc.':                    { badge: 'bg-stone-100 text-stone-500 border border-stone-200',       border: 'border-l-stone-300',   row: 'bg-stone-50/30',   chip: 'bg-stone-50 border-stone-200 text-stone-500',       dot: 'bg-stone-400'   },
}

HEAD_STYLE['Utilities'] = { badge: 'bg-cyan-100 text-cyan-700 border border-cyan-200', border: 'border-l-cyan-400', row: 'bg-cyan-50/30', chip: 'bg-cyan-50 border-cyan-200 text-cyan-700', dot: 'bg-cyan-400' }

function headStyle(head: string) {
  return GF_HEAD_STYLE[head] ?? HEAD_STYLE[head] ?? {
    badge:  'bg-slate-100 text-slate-500 border border-slate-200',
    border: 'border-l-slate-300',
    row:    'bg-slate-50/20',
    chip:   'bg-slate-50 border-slate-200 text-slate-500',
    dot:    'bg-slate-400',
  }
}

const BLANK_FORM = { head: 'Automation', department: '', subParticulars: '', qty: '', rate: '', totalCost: '' }

type PlantFormState = { label: string; state: string; assignedUser: string }
const BLANK_PLANT_FORM: PlantFormState = { label: '', state: '', assignedUser: '' }

type GreenFieldPlantFormState = {
  label: string
  state: string
  assignedUser: string
  fy: string
  projectType: ProjectType
  budgetCr: string
}
const BLANK_GREEN_PLANT_FORM = (fy: string): GreenFieldPlantFormState => ({
  label: '',
  state: '',
  assignedUser: '',
  fy,
  projectType: DEFAULT_PROJECT_TYPE,
  budgetCr: '',
})

function formatOverLakhs(inr: number) {
  return `₹${(inr / 100_000).toFixed(1)} L`
}

export default function CapexMasterPage() {
  const {
    capexMaster, requests, customPlants, usedAmountByMasterItemId,
    updateMasterItem, addMasterItem, cloneMasterForFY,
    masterHeads, addMasterHead, renameMasterHead, removeMasterHead, addCustomPlant,
    createGreenFieldPlant, greenFieldBudgetAllocations,
    setGreenFieldSectionBudget, setGreenFieldHeadBudget,
    brownFieldHeadAllocations,
  } = useCapex()

  const reqsByMasterItem = useMemo(() => {
    const map = new Map<string, typeof requests>()
    requests.forEach(req => {
      const ids = new Set<string>()
      if (req.masterItemId) ids.add(req.masterItemId)
      req.lineItems?.forEach(li => { if (li.masterItemId) ids.add(li.masterItemId) })
      ids.forEach(id => map.set(id, [...(map.get(id) ?? []), req]))
    })
    return map
  }, [requests])

  const [fieldTab, setFieldTab]       = useState<FieldType>('brown_field')
  const [selectedHeadFilter, setSelectedHeadFilter] = useState<string | null>(null)
  const [selectedGreenFieldSection, setSelectedGreenFieldSection] =
    useState<GreenFieldSection | null>(null)
  const [selectedProjectType, setSelectedProjectType] =
    useState<ProjectType | null>(null)

  const [view, setView]               = useState<'grid' | 'detail'>('grid')
  const [selectedFy, setSelectedFy]   = useState('')
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editRate, setEditRate]       = useState('')
  const [editAlloc, setEditAlloc]     = useState('')
  const [editQty, setEditQty]         = useState('')
  const [editHead, setEditHead]       = useState('')
  const [showFyModal, setShowFyModal] = useState(false)
  const [newFyInput, setNewFyInput]   = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm]               = useState(BLANK_FORM)
  const [showCustomHead, setShowCustomHead]   = useState(false)
  const [customHeadInput, setCustomHeadInput] = useState('')
  const [showAddPlant, setShowAddPlant]       = useState(false)
  const [showCreateGreenPlant, setShowCreateGreenPlant] = useState(false)
  const [greenPlantForm, setGreenPlantForm]   = useState<GreenFieldPlantFormState>(() => BLANK_GREEN_PLANT_FORM(''))
  const [showSetFyModal, setShowSetFyModal]   = useState(false)
  const [setFyInput, setSetFyInput]           = useState('')
  const [plantForm, setPlantForm]             = useState<PlantFormState>(BLANK_PLANT_FORM)
  const [showHeadsModal, setShowHeadsModal]   = useState(false)
  const [headEdits, setHeadEdits]             = useState<Record<string, string>>({})
  const [headsToDelete, setHeadsToDelete]     = useState<Set<string>>(new Set())
  const [newManageHeadInput, setNewManageHeadInput] = useState('')
  const [roleKey, setRoleKey]                 = useState(0)
  const [showHeadBudgetModal, setShowHeadBudgetModal] = useState(false)
  const [showSectionBudgetModal, setShowSectionBudgetModal] = useState(false)
  const [sectionBudgetModalTarget, setSectionBudgetModalTarget] = useState<{
    section: GreenFieldSection
    isEdit?: boolean
  } | null>(null)
  const [sectionBudgetInput, setSectionBudgetInput] = useState('')
  const [headBudgetModalTarget, setHeadBudgetModalTarget] = useState<{
    head: string
    division: GreenFieldSection
    isEdit?: boolean
  } | null>(null)
  const [headBudgetInput, setHeadBudgetInput] = useState('')

  useEffect(() => {
    const handler = () => {
      setRoleKey(k => k + 1)
      setSelectedPlant(null)
      setSelectedGreenFieldSection(null)
      setSelectedProjectType(null)
      setView('grid')
    }
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [])

  const activeProjectType = selectedProjectType ?? DEFAULT_PROJECT_TYPE

  // FY list is scoped to the active field tab so publishing a future Brown Field FY
  // does not change the default FY shown on the Green Field / Digitisation / IT tabs.
  const allFys = useMemo(
    () => [...new Set(
      capexMaster.filter(i => (i.fieldType ?? 'brown_field') === fieldTab).map(i => i.fy),
    )].sort((a, b) => b.localeCompare(a)),
    [capexMaster, fieldTab],
  )

  // Self-correct when the sticky selected FY isn't valid for the current tab.
  const activeFy = (selectedFy && allFys.includes(selectedFy)) ? selectedFy : (allFys[0] || '')
  const fyItems  = useMemo(
    () => capexMaster.filter(i => {
      if (i.fy !== activeFy) return false
      if ((i.fieldType ?? 'brown_field') !== fieldTab) return false
      if (isProjectTypeScopedField(fieldTab)) {
        return resolveProjectType(i) === activeProjectType
      }
      return true
    }),
    [capexMaster, activeFy, fieldTab, activeProjectType],
  )
  const canonicalHeadOrder = useMemo(
    () => [...getCanonicalHeadOrder(fieldTab)],
    [fieldTab],
  )

  const allPlants = useMemo((): PlantMeta[] => {
    const customVals = new Set(customPlants.map(p => p.value))
    const defaults: PlantMeta[] = PLANTS.filter(p => !customVals.has(p.value))
    return [...defaults, ...customPlants]
  }, [customPlants])

  const visiblePlants = useMemo(() => {
    const role = typeof window !== 'undefined' ? (localStorage.getItem('capex_role') ?? '') : ''
    const plantFilter = getPlantForRole(role)
    return plantFilter ? allPlants.filter(p => p.value === plantFilter) : allPlants
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey, allPlants])

  const currentRole = useMemo(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('capex_role') ?? ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey])

  const canAddPlant = ['super_admin', 'sourcing_head'].includes(currentRole)
  const canManageGreenField = ['sourcing_member', 'sourcing_head', 'super_admin'].includes(currentRole)
  // Brown Field live-FY budgets are read-only: changes flow through next-FY proposals
  // (Budget Planning) or Adhoc reallocation — never direct master edits.
  const brownFieldLocked = fieldTab === 'brown_field'

  const activePlant = useMemo(() => {
    if (view === 'detail' && selectedPlant) return selectedPlant
    const candidate = selectedPlant ?? visiblePlants[0]?.value ?? null
    if (candidate && !visiblePlants.some(p => p.value === candidate)) {
      return visiblePlants[0]?.value ?? null
    }
    return candidate
  }, [selectedPlant, visiblePlants, view])

  const plantItems = useMemo(() => fyItems.filter(i => i.plant === activePlant), [fyItems, activePlant])
  const scopeItems = useMemo(() => {
    if (fieldTab === 'green_field' && selectedGreenFieldSection) {
      return plantItems.filter(i => i.division === selectedGreenFieldSection)
    }
    return plantItems
  }, [fieldTab, selectedGreenFieldSection, plantItems])
  const greenFieldSectionSummaries = useMemo(() => {
    if (fieldTab !== 'green_field' || !activePlant) return []
    return GREEN_FIELD_SECTION_ORDER.map(section => {
      const items = plantItems.filter(i => i.division === section)
      const subParticularsCr = items.reduce((s, i) => s + i.totalCost, 0)
      const allocatedCr = getGreenFieldSectionBudgetCr(
        greenFieldBudgetAllocations,
        activePlant,
        activeFy,
        activeProjectType,
        section,
      )
      const headAllocatedCr = sumGreenFieldHeadBudgetsForSection(
        greenFieldBudgetAllocations,
        activePlant,
        activeFy,
        activeProjectType,
        section,
      )
      const status = greenFieldBudgetStatus(
        allocatedCr,
        headAllocatedCr,
      )
      return {
        section,
        total: subParticularsCr,
        count: items.length,
        headAllocatedCr,
        subParticularsCr,
        ...status,
      }
    })
  }, [fieldTab, plantItems, activePlant, activeFy, activeProjectType, greenFieldBudgetAllocations])
  const displayItems = useMemo(() => {
    const base = scopeItems
    if (selectedHeadFilter) {
      return base.filter(i => i.head === selectedHeadFilter)
    }
    return base
  }, [scopeItems, selectedHeadFilter])
  const grandTotal = useMemo(() => displayItems.reduce((s, i) => s + i.totalCost, 0), [displayItems])

  const activeHeads = useMemo(() => {
    if (fieldTab === 'green_field' && selectedGreenFieldSection) {
      const predefined = [...getFieldDivisionHeads('green_field', selectedGreenFieldSection)]
      const extras = [...new Set(scopeItems.map(i => i.head))]
        .filter(h => h && !predefined.includes(h))
        .sort()
      return [...predefined, ...extras]
    }
    const extras = [...new Set([...masterHeads, ...scopeItems.map(i => i.head)])]
      .filter(h => h && !canonicalHeadOrder.includes(h))
      .sort()
    return [...canonicalHeadOrder, ...extras]
  }, [fieldTab, selectedGreenFieldSection, masterHeads, scopeItems, canonicalHeadOrder])

  const grouped = useMemo(() => {
    const map = new Map<string, CapexMasterItem[]>()
    displayItems.forEach(item => {
      const key = item.head || 'Other'
      map.set(key, [...(map.get(key) ?? []), item])
    })
    const sorted = new Map<string, CapexMasterItem[]>()
    activeHeads.forEach(h => { if (map.has(h)) sorted.set(h, map.get(h)!) })
    map.forEach((v, k) => { if (!sorted.has(k)) sorted.set(k, v) })
    return sorted
  }, [displayItems, activeHeads])

  const headSummary = useMemo(() => {
    let summaries = getHeadBudgetSummaries(scopeItems)
    if (fieldTab === 'green_field' && selectedGreenFieldSection) {
      const predefined = [...getFieldDivisionHeads('green_field', selectedGreenFieldSection)]
      const existing = new Set(summaries.map(s => s.head))
      predefined.forEach(head => {
        if (!existing.has(head)) summaries.push({ head, totalCr: 0, count: 0 })
      })
      const order = activeHeads
      summaries = [...summaries].sort(
        (a, b) => order.indexOf(a.head) - order.indexOf(b.head) || b.totalCr - a.totalCr,
      )
    }
    if (fieldTab === 'brown_field') {
      const customHeadSet = new Set(masterHeads)
      summaries = summaries.filter(s => s.count > 0 || customHeadSet.has(s.head))
      masterHeads.forEach(head => {
        if (!summaries.some(s => s.head === head)) {
          summaries.push({ head, totalCr: 0, count: 0 })
        }
      })
      const order = activeHeads
      summaries = [...summaries].sort(
        (a, b) => order.indexOf(a.head) - order.indexOf(b.head) || b.totalCr - a.totalCr,
      )
    }
    return summaries.map(({ head, totalCr, count }) => {
      const items = scopeItems.filter(i => i.head === head)
      const usedCr = items.reduce((s, i) => s + i.totalCost, 0)
      if (fieldTab === 'green_field' && activePlant && selectedGreenFieldSection) {
        const allocatedCr = getGreenFieldHeadBudgetCr(
          greenFieldBudgetAllocations,
          activePlant,
          activeFy,
          activeProjectType,
          selectedGreenFieldSection,
          head,
        )
        const gfStatus = greenFieldBudgetStatus(allocatedCr, usedCr)
        const plannedINR = (allocatedCr ?? usedCr) * CR_TO_INR
        const usedINR = items.reduce((s, i) => s + (usedAmountByMasterItemId[i.id] ?? 0), 0)
        return {
          head,
          total: gfStatus.hasAllocation ? gfStatus.allocatedCr : usedCr,
          usedCr,
          count,
          allocatedCr: gfStatus.allocatedCr,
          remainingCr: gfStatus.remainingCr,
          hasAllocation: gfStatus.hasAllocation,
          over: gfStatus.over,
          overCr: gfStatus.over ? Math.abs(gfStatus.remainingCr) : 0,
          requestOver: usedINR > plannedINR,
          requestOverCr: (usedINR - plannedINR) / CR_TO_INR,
        }
      }
      // Brown Field: an approved Adhoc transfer overrides the head's allocation (else use line-item sum).
      const overrideCr = fieldTab === 'brown_field' && activePlant
        ? getBrownFieldHeadBudgetCr(brownFieldHeadAllocations, activePlant, activeFy, activeProjectType, head)
        : null
      const allocatedCr = overrideCr ?? totalCr
      const plannedINR = allocatedCr * CR_TO_INR
      const usedINR = items.reduce((s, i) => s + (usedAmountByMasterItemId[i.id] ?? 0), 0)
      return {
        head,
        total: allocatedCr,
        usedCr: totalCr,
        count,
        allocatedCr,
        remainingCr: 0,
        hasAllocation: false,
        over: usedINR > plannedINR,
        overCr: (usedINR - plannedINR) / CR_TO_INR,
        requestOver: usedINR > plannedINR,
        requestOverCr: (usedINR - plannedINR) / CR_TO_INR,
      }
    })
  }, [scopeItems, usedAmountByMasterItemId, fieldTab, selectedGreenFieldSection, activeHeads, masterHeads, activePlant, activeFy, activeProjectType, greenFieldBudgetAllocations, brownFieldHeadAllocations])

  function itemOverrun(item: CapexMasterItem) {
    const plannedINR = item.totalCost * CR_TO_INR
    const usedINR = usedAmountByMasterItemId[item.id] ?? 0
    return usedINR > plannedINR ? usedINR - plannedINR : 0
  }

  function plantHasOverrun(plantValue: string) {
    return fyItems
      .filter(i => i.plant === plantValue)
      .some(item => itemOverrun(item) > 0)
  }

  function plantStat(val: string) {
    const items = fyItems.filter(i => i.plant === val)
    const usedCr = items.reduce((s, i) => s + i.totalCost, 0)
    if (fieldTab === 'green_field') {
      const allocatedCr = getGreenFieldPlantBudgetCr(
        greenFieldBudgetAllocations,
        val,
        activeFy,
        activeProjectType,
      )
      const distributedCr = sumGreenFieldSectionBudgetsForPlant(
        greenFieldBudgetAllocations,
        val,
        activeFy,
        activeProjectType,
      )
      const plantStatus = greenFieldBudgetStatus(allocatedCr, distributedCr)
      return {
        total: usedCr,
        count: items.length,
        allocatedCr: allocatedCr ?? 0,
        distributedCr,
        usedCr,
        hasPlantBudget: allocatedCr != null && allocatedCr > 0,
        plantOver: plantStatus.over,
        plantRemainingCr: plantStatus.remainingCr,
      }
    }
    return { total: usedCr, count: items.length }
  }

  function projectTypeStat(projectType: ProjectType, tab: FieldType = fieldTab) {
    const items = capexMaster.filter(i =>
      i.fy === activeFy &&
      (i.fieldType ?? 'brown_field') === tab &&
      resolveProjectType(i) === projectType,
    )
    return { total: items.reduce((s, i) => s + i.totalCost, 0), count: items.length }
  }

  const greenFieldCreatedPlants = useMemo(() => {
    const plantValues = new Set(
      capexMaster
        .filter(i => (i.fieldType ?? 'brown_field') === 'green_field' && i.fy === activeFy)
        .map(i => i.plant),
    )
    return allPlants.filter(p => p.greenFieldPlant || plantValues.has(p.value))
  }, [capexMaster, activeFy, allPlants])

  const needsProjectTypeStep = isProjectTypeScopedField(fieldTab) && !selectedProjectType

  function plantLabel(val: string) {
    return allPlants.find(p => p.value === val)?.label ?? val
  }

  function startEdit(item: CapexMasterItem) {
    if (brownFieldLocked) return
    setEditingId(item.id)
    setEditHead(item.head)
    setEditRate(String(item.rate))
    setEditAlloc(String(item.totalCost))
    setEditQty(item.qty != null ? String(item.qty) : '')
  }

  function saveEdit(id: string, originalHead: string) {
    if (brownFieldLocked) return
    const rate = parseFloat(editRate), totalCost = parseFloat(editAlloc)
    const qtyParsed = editQty.trim() === '' ? undefined : parseFloat(editQty)
    if (!isNaN(rate) && !isNaN(totalCost) && (qtyParsed === undefined || !isNaN(qtyParsed))) {
      updateMasterItem(id, {
        head: editHead || originalHead,
        rate,
        totalCost,
        ...(qtyParsed !== undefined ? { qty: qtyParsed } : {}),
      })
      if (editHead && editHead !== originalHead) toast.success(`Moved to "${editHead}"`)
      setEditingId(null)
    }
  }

  function cancelEdit() {
    setEditingId(null); setEditHead(''); setEditRate(''); setEditAlloc(''); setEditQty('')
  }

  function openHeadsModal() {
    setHeadEdits(Object.fromEntries(activeHeads.map(h => [h, h])))
    setHeadsToDelete(new Set())
    setNewManageHeadInput('')
    setShowHeadsModal(true)
  }

  function handleAddManageHead() {
    if (brownFieldLocked) return
    const trimmed = newManageHeadInput.trim()
    if (!trimmed) return
    addMasterHead(trimmed)
    setNewManageHeadInput('')
    setHeadEdits(prev => ({ ...prev, [trimmed]: trimmed }))
    // Brown Field returns early above (locked), so no brown-field branch is needed here.
    toast.success(`Head "${trimmed}" added`)
  }

  function saveHeadEdits() {
    let changed = 0
    headsToDelete.forEach(head => {
      removeMasterHead(head)
      changed++
    })
    Object.entries(headEdits).forEach(([original, edited]) => {
      if (headsToDelete.has(original)) return
      const trimmed = edited.trim()
      if (trimmed && trimmed !== original) {
        renameMasterHead(original, trimmed)
        changed++
      }
    })
    if (changed > 0) toast.success(`${changed} change${changed > 1 ? 's' : ''} applied`)
    setShowHeadsModal(false)
  }

  function handleCloneFY() {
    const fy = newFyInput.trim()
    if (!fy) return
    cloneMasterForFY(fy); setSelectedFy(fy); setNewFyInput(''); setShowFyModal(false)
  }

  function getDefaultHeadForAddForm() {
    if (selectedHeadFilter) return selectedHeadFilter
    if (fieldTab === 'green_field' && selectedGreenFieldSection) {
      return defaultHeadForGreenFieldSection(selectedGreenFieldSection)
    }
    return activeHeads[0] ?? BLANK_FORM.head
  }

  function openAddItemForm() {
    setShowCustomHead(false)
    setCustomHeadInput('')
    setForm(f => ({ ...f, head: getDefaultHeadForAddForm() }))
    setShowAddForm(v => !v)
  }

  function handleAddItem() {
    if (brownFieldLocked) return
    if (!form.subParticulars.trim() || !activePlant) return
    if (fieldTab === 'green_field' && (!selectedGreenFieldSection || !selectedHeadFilter)) return
    const headValue = selectedHeadFilter ?? (showCustomHead ? customHeadInput.trim() : form.head)
    if (!headValue) return
    if (showCustomHead && customHeadInput.trim()) addMasterHead(customHeadInput.trim())
    const rate = parseFloat(form.rate), totalCost = parseFloat(form.totalCost)
    const qtyParsed = form.qty.trim() === '' ? undefined : parseFloat(form.qty)
    addMasterItem({
      id: `cm-${crypto.randomUUID()}`,
      fieldType: fieldTab,
      ...(isProjectTypeScopedField(fieldTab)
        ? { projectType: activeProjectType, greenFieldProjectType: activeProjectType }
        : {}),
      division:
        fieldTab === 'green_field' && selectedGreenFieldSection
          ? selectedGreenFieldSection
          : isFlatMasterFieldType(fieldTab)
            ? FLAT_MASTER_DIVISION
            : defaultDivisionForFieldType(fieldTab),
      fy: activeFy || '2025-26',
      plant: activePlant,
      head: headValue,
      department: form.department.trim(),
      subParticulars: form.subParticulars.trim(),
      rate: isNaN(rate) ? 0 : rate,
      totalCost: isNaN(totalCost) ? 0 : totalCost,
      ...(qtyParsed !== undefined && !isNaN(qtyParsed) ? { qty: qtyParsed } : {}),
    })
    setForm({ ...BLANK_FORM, head: getDefaultHeadForAddForm() })
    setShowCustomHead(false); setCustomHeadInput(''); setShowAddForm(false)
  }

  function handleAddPlant() {
    const label = plantForm.label.trim()
    if (!label) return
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const meta: PlantMeta = {
      value,
      label,
      state: plantForm.state.trim(),
      assignedUser: plantForm.assignedUser.trim() || undefined,
    }
    addCustomPlant(meta)
    setPlantForm(BLANK_PLANT_FORM); setShowAddPlant(false)
    toast.success(`Plant "${label}" added`)
  }

  function openCreateGreenPlantModal() {
    const fy = activeFy || allFys[0] || '2026-27'
    setGreenPlantForm({
      ...BLANK_GREEN_PLANT_FORM(fy),
      projectType: selectedProjectType ?? activeProjectType,
    })
    setShowCreateGreenPlant(true)
  }

  function handleCreateGreenFieldPlant() {
    const label = greenPlantForm.label.trim()
    const fy = greenPlantForm.fy.trim()
    if (!label || !fy) return
    const budgetParsed = parseFloat(greenPlantForm.budgetCr)
    const budgetCr = !isNaN(budgetParsed) && budgetParsed > 0 ? budgetParsed : undefined
    const plantValue = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    createGreenFieldPlant({
      plantValue,
      plantLabel: label,
      state: greenPlantForm.state.trim(),
      assignedUser: greenPlantForm.assignedUser.trim() || undefined,
      projectType: greenPlantForm.projectType,
      fy,
      budgetCr,
    })
    setSelectedFy(fy)
    setShowCreateGreenPlant(false)
    setGreenPlantForm(BLANK_GREEN_PLANT_FORM(fy))
    toast.success(
      budgetCr != null
        ? `Green Field plant "${label}" created with ₹${budgetCr.toFixed(2)} Cr budget`
        : `Green Field plant "${label}" created for FY ${fy}`,
    )
  }

  function openSectionBudgetModal(section: GreenFieldSection, isEdit = false) {
    const existing = activePlant
      ? getGreenFieldSectionBudgetCr(
          greenFieldBudgetAllocations,
          activePlant,
          activeFy,
          activeProjectType,
          section,
        )
      : undefined
    setSectionBudgetModalTarget({ section, isEdit })
    setSectionBudgetInput(existing != null ? String(existing) : '')
    setShowSectionBudgetModal(true)
  }

  function enterGreenFieldSection(section: GreenFieldSection) {
    setSelectedGreenFieldSection(section)
    setSelectedHeadFilter(null)
    setShowAddForm(false)
    setForm(f => ({
      ...f,
      head: defaultHeadForGreenFieldSection(section),
    }))
  }

  function handleSelectGreenFieldSection(section: GreenFieldSection) {
    if (!activePlant) return
    const existing = getGreenFieldSectionBudgetCr(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
      section,
    )
    if (existing == null) {
      openSectionBudgetModal(section)
      return
    }
    enterGreenFieldSection(section)
  }

  function saveSectionBudget() {
    if (!sectionBudgetModalTarget || !activePlant) return
    const budgetCr = parseFloat(sectionBudgetInput)
    if (isNaN(budgetCr) || budgetCr < 0) {
      toast.error('Enter a valid section budget amount in Crore')
      return
    }
    const { section, isEdit } = sectionBudgetModalTarget
    setGreenFieldSectionBudget(
      activePlant,
      activeFy,
      activeProjectType,
      section,
      budgetCr,
    )
    setShowSectionBudgetModal(false)
    setSectionBudgetModalTarget(null)
    setSectionBudgetInput('')
    toast.success(`Budget for "${section}" set to ₹${budgetCr.toFixed(2)} Cr`)
    if (!isEdit) {
      enterGreenFieldSection(section)
    }
  }

  function openHeadBudgetModal(head: string, division: GreenFieldSection, isEdit = false) {
    const existing = activePlant
      ? getGreenFieldHeadBudgetCr(
          greenFieldBudgetAllocations,
          activePlant,
          activeFy,
          activeProjectType,
          division,
          head,
        )
      : undefined
    setHeadBudgetModalTarget({ head, division, isEdit })
    setHeadBudgetInput(existing != null ? String(existing) : '')
    setShowHeadBudgetModal(true)
  }

  function handleSelectGreenFieldHead(head: string) {
    if (!selectedGreenFieldSection || !activePlant) return
    const existing = getGreenFieldHeadBudgetCr(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
      selectedGreenFieldSection,
      head,
    )
    if (existing == null) {
      openHeadBudgetModal(head, selectedGreenFieldSection)
      return
    }
    enterGreenFieldHead(head)
  }

  function enterGreenFieldHead(head: string) {
    setSelectedHeadFilter(head)
    setShowCustomHead(false)
    setCustomHeadInput('')
    setShowAddForm(false)
    setForm(f => ({ ...f, head }))
  }

  function saveHeadBudget() {
    if (!headBudgetModalTarget || !activePlant) return
    const budgetCr = parseFloat(headBudgetInput)
    if (isNaN(budgetCr) || budgetCr < 0) {
      toast.error('Enter a valid budget amount in Crore')
      return
    }
    const { head, isEdit } = headBudgetModalTarget
    setGreenFieldHeadBudget(
      activePlant,
      activeFy,
      activeProjectType,
      headBudgetModalTarget.division,
      head,
      budgetCr,
    )
    setShowHeadBudgetModal(false)
    setHeadBudgetModalTarget(null)
    setHeadBudgetInput('')
    toast.success(`Budget for "${head}" set to ₹${budgetCr.toFixed(2)} Cr`)
    if (!isEdit) {
      enterGreenFieldHead(head)
    }
  }

  const activeGreenFieldPlantBudget = useMemo(() => {
    if (fieldTab !== 'green_field' || !activePlant) return null
    const allocatedCr = getGreenFieldPlantBudgetCr(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
    )
    const distributedCr = sumGreenFieldHeadBudgetsForPlant(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
    )
    const sectionAllocatedCr = sumGreenFieldSectionBudgetsForPlant(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
    )
    const subParticularsCr = plantItems.reduce((s, i) => s + i.totalCost, 0)
    return {
      distributedCr: sectionAllocatedCr,
      headAllocatedCr: distributedCr,
      subParticularsCr,
      ...greenFieldBudgetStatus(allocatedCr, sectionAllocatedCr),
      hasPlantBudget: allocatedCr != null && allocatedCr > 0,
    }
  }, [fieldTab, activePlant, activeFy, activeProjectType, greenFieldBudgetAllocations, plantItems])

  const activeGreenFieldHeadBudget = useMemo(() => {
    if (fieldTab !== 'green_field' || !activePlant || !selectedGreenFieldSection || !selectedHeadFilter) {
      return null
    }
    const allocatedCr = getGreenFieldHeadBudgetCr(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
      selectedGreenFieldSection,
      selectedHeadFilter,
    )
    const usedCr = displayItems.reduce((s, i) => s + i.totalCost, 0)
    return {
      ...greenFieldBudgetStatus(allocatedCr, usedCr),
      hasAllocation: allocatedCr != null,
    }
  }, [
    fieldTab,
    activePlant,
    selectedGreenFieldSection,
    selectedHeadFilter,
    activeFy,
    activeProjectType,
    greenFieldBudgetAllocations,
    displayItems,
  ])

  const activeGreenFieldSectionBudget = useMemo(() => {
    if (fieldTab !== 'green_field' || !activePlant || !selectedGreenFieldSection) {
      return null
    }
    const allocatedCr = getGreenFieldSectionBudgetCr(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
      selectedGreenFieldSection,
    )
    const headAllocatedCr = sumGreenFieldHeadBudgetsForSection(
      greenFieldBudgetAllocations,
      activePlant,
      activeFy,
      activeProjectType,
      selectedGreenFieldSection,
    )
    const subParticularsCr = scopeItems.reduce((s, i) => s + i.totalCost, 0)
    return {
      headAllocatedCr,
      subParticularsCr,
      ...greenFieldBudgetStatus(allocatedCr, headAllocatedCr),
      hasSectionBudget: allocatedCr != null && allocatedCr > 0,
    }
  }, [
    fieldTab,
    activePlant,
    selectedGreenFieldSection,
    activeFy,
    activeProjectType,
    greenFieldBudgetAllocations,
    scopeItems,
  ])

  function handleSetFy() {
    const fy = setFyInput.trim()
    if (!fy) return
    setSelectedFy(fy)
    setSetFyInput('')
    setShowSetFyModal(false)
    toast.success(`Active FY set to ${fy}`)
  }

  // ── FY clone banner (shared between views) ─────────────────────────────────
  const fyBanner = showFyModal && (
    <div className="flex items-center gap-3 bg-[#CCFBF1] border border-[#5EEAD4] rounded-xl px-4 py-3 shrink-0">
      <p className="text-sm font-medium text-[#115E59] shrink-0">Clone all items to new FY:</p>
      <input value={newFyInput} onChange={e => setNewFyInput(e.target.value)} placeholder="e.g. 2026-27"
        className="text-sm border border-[#5EEAD4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488] w-36" />
      <button onClick={handleCloneFY} disabled={!newFyInput.trim()}
        className="px-3 py-1.5 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] disabled:opacity-40 text-white rounded-lg">
        Clone
      </button>
      <button onClick={() => setShowFyModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded ml-auto">
        <X className="w-4 h-4" />
      </button>
    </div>
  )

  // ── GRID VIEW ──────────────────────────────────────────────────────────────
  if (view === 'grid') {
    return (
      <div className="p-5 h-full flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-center justify-between shrink-0 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">CAPEX Master</h1>
            <p className="text-xs text-slate-400 mt-0.5">Select a plant to manage its annual budget · FY {activeFy}</p>
            <div className="flex gap-2 mt-3 flex-wrap">
              {(['brown_field', 'green_field', 'digitisation', 'information_technology'] as FieldType[]).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    setFieldTab(tab)
                    setSelectedPlant(null)
                    setSelectedProjectType(null)
                    setSelectedHeadFilter(null)
                    setSelectedGreenFieldSection(null)
                    setView('grid')
                  }}
                  className={[
                    'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors',
                    fieldTab === tab
                      ? tab === 'green_field'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : tab === 'digitisation'
                          ? 'bg-teal-600 text-white border-teal-600'
                          : tab === 'information_technology'
                            ? 'bg-indigo-600 text-white border-indigo-600'
                            : 'bg-[#153f90] text-white border-[#153f90]'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                  ].join(' ')}
                >
                  {FIELD_TYPE_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-slate-500 mr-1">FY</label>
            <select
              value={activeFy}
              onChange={e => setSelectedFy(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
            >
              {allFys.map(fy => <option key={fy} value={fy}>{fy}</option>)}
              {activeFy && !allFys.includes(activeFy) && (
                <option value={activeFy}>{activeFy}</option>
              )}
            </select>
            {fieldTab === 'green_field' && canManageGreenField && (
              <button
                type="button"
                onClick={() => { setSetFyInput(activeFy || ''); setShowSetFyModal(true) }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
              >
                Set FY
              </button>
            )}
            <button
              onClick={() => setShowFyModal(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Clone FY
            </button>
          </div>
        </div>

        {fyBanner}

        {/* Brown / Green — project type selection */}
        {needsProjectTypeStep ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <p className="text-sm text-slate-500 mb-4 flex items-center gap-2">
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-bold bg-[#153f90] text-white">Amber</span>
              Choose a business category before selecting a plant.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pb-4">
              {PROJECT_TYPES.map(pt => {
                const { total, count } = projectTypeStat(pt, fieldTab)
                const isEmpty = count === 0
                return (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setSelectedProjectType(pt)}
                    className="group text-left rounded-xl border border-slate-200 bg-white p-4 hover:shadow-lg hover:border-emerald-400 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                  >
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-emerald-700" aria-hidden="true" />
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-700 mt-1 transition-colors" aria-hidden="true" />
                    </div>
                    <div className="mt-3">
                      <p className="text-[16px] font-bold text-slate-900 leading-tight">
                        {PROJECT_TYPE_LABELS[pt]}
                      </p>
                      <p className="text-[12px] text-slate-400 mt-0.5">{FIELD_TYPE_LABELS[fieldTab]} master</p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      {isEmpty ? (
                        <p className="text-[12px] text-slate-400 italic">No items for FY {activeFy}</p>
                      ) : (
                        <div>
                          <p className="text-[24px] font-black font-mono leading-none text-emerald-700">
                            ₹{total.toFixed(2)}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">Crore · {count} line items</p>
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
        /* Plant grid */
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isProjectTypeScopedField(fieldTab) && selectedProjectType && (
            <div className="flex items-center gap-3 mb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedProjectType(null)
                  setSelectedPlant(null)
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Categories</span>
              </button>
              <span className="text-slate-200 select-none">/</span>
              <span className="text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                {PROJECT_TYPE_LABELS[selectedProjectType]}
              </span>
            </div>
          )}
          {fieldTab === 'green_field' && (
            <p className="text-sm text-slate-500 mb-4">Created plants — select to manage budget heads and line items.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">

            {(fieldTab === 'green_field' ? greenFieldCreatedPlants : visiblePlants).map(plant => {
              const stat = plantStat(plant.value)
              const { total, count } = stat
              const isEmpty = count === 0
              const hasOverrun = plantHasOverrun(plant.value)
              const gfStat = fieldTab === 'green_field' ? stat as ReturnType<typeof plantStat> & {
                hasPlantBudget?: boolean
                allocatedCr?: number
                distributedCr?: number
                plantOver?: boolean
                plantRemainingCr?: number
              } : null
              return (
                <button
                  key={plant.value}
                  onClick={() => {
                    setSelectedPlant(plant.value)
                    setSelectedHeadFilter(null)
                    setSelectedGreenFieldSection(null)
                    setView('detail')
                  }}
                  className={[
                    'group text-left rounded-xl border bg-white p-4 hover:shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]',
                    hasOverrun ? 'border-red-300 hover:border-red-400' : 'border-slate-200 hover:border-[#5B82D4]',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-[#EBF0FB] flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-[#153f90]" aria-hidden="true" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#153f90] mt-1 transition-colors" aria-hidden="true" />
                  </div>
                  <div className="mt-3">
                    <p className="text-[16px] font-bold text-slate-900 leading-tight">{plant.label}</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">{plant.state}</p>
                    {plant.assignedUser && (
                      <p className="text-[11px] text-[#0D9488] mt-1.5 font-medium flex items-center gap-1">
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-[#CCFBF1] text-[#0D9488] text-center leading-3.5 text-[9px] font-bold">P</span>
                        {plant.assignedUser}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    {fieldTab === 'green_field' && gfStat?.hasPlantBudget ? (
                      <div>
                        <p className="text-[11px] text-slate-500 font-medium">Plant budget</p>
                        <p className={['text-[24px] font-black font-mono leading-none mt-0.5', gfStat.plantOver ? 'text-red-600' : 'text-emerald-700'].join(' ')}>
                          ₹{gfStat.allocatedCr!.toFixed(2)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          ₹{gfStat.distributedCr!.toFixed(2)} Cr to sections · {count} line item{count !== 1 ? 's' : ''}
                        </p>
                        {gfStat.plantOver ? (
                          <p className="text-[11px] font-semibold text-red-600 mt-1">
                            Over by ₹{Math.abs(gfStat.plantRemainingCr!).toFixed(2)} Cr (head allocation)
                          </p>
                        ) : gfStat.hasPlantBudget && gfStat.plantRemainingCr! > 0 ? (
                          <p className="text-[11px] font-semibold text-emerald-700 mt-1">
                            ₹{gfStat.plantRemainingCr!.toFixed(2)} Cr unallocated to sections
                          </p>
                        ) : null}
                      </div>
                    ) : isEmpty ? (
                      <p className="text-[12px] text-slate-400 italic">No items for FY {activeFy}</p>
                    ) : (
                      <div>
                        <p className={['text-[24px] font-black font-mono leading-none', hasOverrun ? 'text-red-600' : 'text-[#0D9488]'].join(' ')}>
                          ₹{total.toFixed(2)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">Crore · {count} line items</p>
                        {hasOverrun && (
                          <p className="text-[11px] font-semibold text-red-600 mt-1">Budget overrun on one or more heads</p>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}

            {/* Green Field — create plant (sourcing / admin) */}
            {fieldTab === 'green_field' && canManageGreenField && selectedProjectType && (
              <button
                type="button"
                onClick={openCreateGreenPlantModal}
                className="group text-left rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/30 p-4
                           hover:border-emerald-500 hover:bg-emerald-50 transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <div className="w-10 h-10 rounded-xl bg-emerald-100 group-hover:bg-emerald-200 flex items-center justify-center transition-colors">
                  <Plus className="w-5 h-5 text-emerald-700 group-hover:text-emerald-800 transition-colors" aria-hidden="true" />
                </div>
                <div className="mt-3">
                  <p className="text-[16px] font-bold text-emerald-800 group-hover:text-emerald-900 transition-colors leading-tight">
                    Create Green Field Plant
                  </p>
                  <p className="text-[12px] text-emerald-700/70 mt-0.5">
                    Add plant for FY {PROJECT_TYPE_LABELS[selectedProjectType]} · budgets added on detail page
                  </p>
                </div>
                <div className="mt-3 pt-3 border-t border-emerald-200/60">
                  <p className="text-[11px] text-emerald-700/60">Available in Brown Field after creation</p>
                </div>
              </button>
            )}

            {/* Brown / Digitisation / IT — add plant */}
            {fieldTab !== 'green_field' && canAddPlant && (
              <button
                onClick={() => setShowAddPlant(true)}
                className="group text-left rounded-xl border-2 border-dashed border-slate-200 bg-transparent p-4
                           hover:border-[#0D9488] hover:bg-[#CCFBF1]/20 transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-[#CCFBF1] flex items-center justify-center transition-colors">
                  <Plus className="w-5 h-5 text-slate-400 group-hover:text-[#0D9488] transition-colors" aria-hidden="true" />
                </div>
                <div className="mt-3">
                  <p className="text-[16px] font-bold text-slate-400 group-hover:text-[#0D9488] transition-colors leading-tight">Add Plant</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">Configure a new plant location</p>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-[11px] text-slate-300">Assign head, set state</p>
                </div>
              </button>
            )}

          </div>
        </div>
        )}

        {/* Set FY modal (Green Field) */}
        {showSetFyModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Set Financial Year</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Enter or switch the active FY for Green Field master</p>
                </div>
                <button onClick={() => setShowSetFyModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                autoFocus
                type="text"
                value={setFyInput}
                onChange={e => setSetFyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSetFy()}
                placeholder="e.g. 2026-27"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600 mb-4"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSetFy}
                  disabled={!setFyInput.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg"
                >
                  Apply FY
                </button>
                <button
                  onClick={() => setShowSetFyModal(false)}
                  className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create Green Field Plant modal */}
        {showCreateGreenPlant && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-6 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Create Green Field Plant</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Plant will be added to Green Field master and Brown Field plant list
                  </p>
                </div>
                <button
                  onClick={() => { setShowCreateGreenPlant(false); setGreenPlantForm(BLANK_GREEN_PLANT_FORM(activeFy)) }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-6 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">
                      Plant Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={greenPlantForm.label}
                      onChange={e => setGreenPlantForm(f => ({ ...f, label: e.target.value }))}
                      placeholder="e.g. Pune Greenfield"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">State / Location</label>
                    <input
                      type="text"
                      value={greenPlantForm.state}
                      onChange={e => setGreenPlantForm(f => ({ ...f, state: e.target.value }))}
                      placeholder="e.g. Maharashtra"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">
                      Financial Year <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={greenPlantForm.fy}
                      onChange={e => setGreenPlantForm(f => ({ ...f, fy: e.target.value }))}
                      placeholder="e.g. 2026-27"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">Business Category</label>
                    <select
                      value={greenPlantForm.projectType}
                      onChange={e => setGreenPlantForm(f => ({ ...f, projectType: e.target.value as ProjectType }))}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      {PROJECT_TYPES.map(pt => (
                        <option key={pt} value={pt}>{PROJECT_TYPE_LABELS[pt]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">Assign Plant Head</label>
                    <input
                      type="text"
                      value={greenPlantForm.assignedUser}
                      onChange={e => setGreenPlantForm(f => ({ ...f, assignedUser: e.target.value }))}
                      placeholder="e.g. Vikram Nair"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-500 block mb-1.5">
                      Overall Plant Budget (Cr) <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={greenPlantForm.budgetCr}
                      onChange={e => setGreenPlantForm(f => ({ ...f, budgetCr: e.target.value }))}
                      placeholder="e.g. 150.00"
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Total envelope for this plant — distribute to section heads after creation.
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 p-6 border-t border-slate-100 shrink-0">
                <button
                  onClick={handleCreateGreenFieldPlant}
                  disabled={!greenPlantForm.label.trim() || !greenPlantForm.fy.trim() || !greenPlantForm.budgetCr.trim() || parseFloat(greenPlantForm.budgetCr) <= 0}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg"
                >
                  Create Plant
                </button>
                <button
                  onClick={() => { setShowCreateGreenPlant(false); setGreenPlantForm(BLANK_GREEN_PLANT_FORM(activeFy)) }}
                  className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add Plant modal */}
        {showAddPlant && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Add New Plant</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Plant will appear in the CAPEX Master grid</p>
                </div>
                <button onClick={() => { setShowAddPlant(false); setPlantForm(BLANK_PLANT_FORM) }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1.5">
                    Plant Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={plantForm.label}
                    onChange={e => setPlantForm(f => ({ ...f, label: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddPlant()}
                    placeholder="e.g. Manesar Plant 1"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1.5">State / Location</label>
                  <input
                    type="text"
                    value={plantForm.state}
                    onChange={e => setPlantForm(f => ({ ...f, state: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddPlant()}
                    placeholder="e.g. Haryana"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1.5">Assign Plant Head</label>
                  <input
                    type="text"
                    value={plantForm.assignedUser}
                    onChange={e => setPlantForm(f => ({ ...f, assignedUser: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddPlant()}
                    placeholder="e.g. Vikram Nair"
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-6">
                <button
                  onClick={handleAddPlant}
                  disabled={!plantForm.label.trim()}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#0D9488] hover:bg-[#115E59] disabled:opacity-40 text-white rounded-lg transition-colors"
                >
                  Add Plant
                </button>
                <button
                  onClick={() => { setShowAddPlant(false); setPlantForm(BLANK_PLANT_FORM) }}
                  className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    )
  }

  // ── DETAIL VIEW ────────────────────────────────────────────────────────────
  let rowNum = 0
  const isGreenFieldAwaitingHead =
    fieldTab === 'green_field' && !!selectedGreenFieldSection && !selectedHeadFilter
  const isBrownFieldAwaitingHead =
    fieldTab === 'brown_field' && !selectedHeadFilter
  const isAwaitingHeadSelection = isGreenFieldAwaitingHead || isBrownFieldAwaitingHead
  const canAddMasterItem =
    !!activePlant && (
      fieldTab === 'digitisation' ||
      fieldTab === 'information_technology' ||
      (fieldTab === 'green_field' && !!selectedGreenFieldSection && !!selectedHeadFilter)
      // Brown Field is read-only (brownFieldLocked) — budgets change via Budget Planning / Adhoc only.
    )

  return (
    <div className="p-5 h-full flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => {
            setView('grid')
            cancelEdit()
            setShowAddForm(false)
            setSelectedGreenFieldSection(null)
            setSelectedHeadFilter(null)
          }}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
          aria-label="Back to all plants"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Plants</span>
        </button>
        {fieldTab === 'brown_field' && selectedHeadFilter && (
          <>
            <span className="text-slate-200 select-none">/</span>
            <button
              type="button"
              onClick={() => {
                setSelectedHeadFilter(null)
                setShowAddForm(false)
                cancelEdit()
              }}
              className="text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
            >
              {activePlant ? plantLabel(activePlant) : 'Plant'}
            </button>
            <span className="text-slate-200 select-none">/</span>
            <span className="text-sm font-semibold text-[#153f90]">{selectedHeadFilter}</span>
          </>
        )}
        {fieldTab === 'green_field' && selectedGreenFieldSection && (
          <>
            <span className="text-slate-200 select-none">/</span>
            <button
              type="button"
              onClick={() => {
                setSelectedGreenFieldSection(null)
                setSelectedHeadFilter(null)
                setShowAddForm(false)
                cancelEdit()
              }}
              className="text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
            >
              {activePlant ? plantLabel(activePlant) : 'Plant'}
            </button>
            <span className="text-slate-200 select-none">/</span>
            <button
              type="button"
              onClick={() => {
                if (selectedHeadFilter) {
                  setSelectedHeadFilter(null)
                  setShowAddForm(false)
                  cancelEdit()
                }
              }}
              className={[
                'text-sm font-medium transition-colors',
                selectedHeadFilter
                  ? 'text-slate-400 hover:text-slate-900'
                  : 'text-slate-800 font-semibold cursor-default',
              ].join(' ')}
            >
              {selectedGreenFieldSection}
            </button>
            {selectedHeadFilter && (
              <>
                <span className="text-slate-200 select-none">/</span>
                <span className="text-sm font-semibold text-emerald-800">{selectedHeadFilter}</span>
              </>
            )}
          </>
        )}
        {!(fieldTab === 'green_field' && selectedGreenFieldSection) && !(fieldTab === 'brown_field' && selectedHeadFilter) && (
          <span className="text-slate-200 select-none">/</span>
        )}
        <h1 className="text-xl font-semibold text-slate-900 flex-1">
          {fieldTab === 'brown_field' && selectedHeadFilter
            ? selectedHeadFilter
            : fieldTab === 'green_field' && selectedGreenFieldSection && selectedHeadFilter
            ? selectedHeadFilter
            : fieldTab === 'green_field' && selectedGreenFieldSection
              ? selectedGreenFieldSection
              : activePlant
                ? plantLabel(activePlant)
                : 'Plant'}
          {!(fieldTab === 'green_field' && selectedGreenFieldSection) && !(fieldTab === 'brown_field' && selectedHeadFilter) && (
            <>
              <span className={[
                'ml-2 text-xs font-semibold px-2 py-0.5 rounded-full align-middle',
                fieldTab === 'green_field' ? 'bg-emerald-100 text-emerald-800' :
                fieldTab === 'digitisation' ? 'bg-teal-100 text-teal-800' :
                fieldTab === 'information_technology' ? 'bg-indigo-100 text-indigo-800' :
                'bg-slate-100 text-slate-600',
              ].join(' ')}>
                {FIELD_TYPE_LABELS[fieldTab]}
              </span>
              {isProjectTypeScopedField(fieldTab) && selectedProjectType && (
                <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full align-middle bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {PROJECT_TYPE_LABELS[selectedProjectType]}
                </span>
              )}
            </>
          )}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {(['brown_field', 'green_field', 'digitisation', 'information_technology'] as FieldType[]).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setFieldTab(tab)
                setSelectedProjectType(null)
                setSelectedGreenFieldSection(null)
                setSelectedHeadFilter(null)
                cancelEdit()
                setShowAddForm(false)
              }}
              className={[
                'px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-colors',
                fieldTab === tab
                  ? tab === 'green_field' ? 'bg-emerald-600 text-white border-emerald-600'
                  : tab === 'digitisation' ? 'bg-teal-600 text-white border-teal-600'
                  : tab === 'information_technology' ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-[#153f90] text-white border-[#153f90]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
              ].join(' ')}
            >
              {FIELD_TYPE_LABELS[tab]}
            </button>
          ))}
          <label className="text-xs font-semibold text-slate-500 mr-1">FY</label>
          <select
            value={activeFy}
            onChange={e => setSelectedFy(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
          >
            {allFys.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
          {brownFieldLocked ? (
            <Link
              href="/capex/budget-proposals"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
            >
              <ClipboardList className="w-3.5 h-3.5" /> Plan Next-FY Budget
            </Link>
          ) : (
            <>
              <button
                onClick={() => setShowFyModal(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> New FY
              </button>
              <button
                onClick={openHeadsModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" /> Manage Heads
              </button>
            </>
          )}
          {canAddMasterItem && (
            <button
              onClick={openAddItemForm}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )}
          {fieldTab === 'green_field' && selectedHeadFilter && selectedGreenFieldSection && (
            <button
              type="button"
              onClick={() => openHeadBudgetModal(selectedHeadFilter, selectedGreenFieldSection, true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Head Budget
            </button>
          )}
          {fieldTab === 'green_field' && selectedGreenFieldSection && (
            <button
              type="button"
              onClick={() => openSectionBudgetModal(selectedGreenFieldSection, true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Section Budget
            </button>
          )}
        </div>
      </div>

      {fyBanner}

      {fieldTab === 'green_field' && activePlant && activeGreenFieldPlantBudget?.hasPlantBudget && !selectedHeadFilter && (
        <div className={[
          'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 shrink-0 text-sm',
          activeGreenFieldPlantBudget.over
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900',
        ].join(' ')}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Plant budget</span>
            <p className="font-black font-mono text-lg">₹{activeGreenFieldPlantBudget.allocatedCr.toFixed(2)} Cr</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">To sections</span>
            <p className="font-bold font-mono">₹{activeGreenFieldPlantBudget.distributedCr.toFixed(2)} Cr</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">To heads</span>
            <p className="font-bold font-mono">₹{activeGreenFieldPlantBudget.headAllocatedCr.toFixed(2)} Cr</p>
          </div>
          <div className="ml-auto">
            {activeGreenFieldPlantBudget.over ? (
              <span className="text-xs font-bold text-red-700">
                Section allocation over by ₹{Math.abs(activeGreenFieldPlantBudget.remainingCr).toFixed(2)} Cr
              </span>
            ) : activeGreenFieldPlantBudget.remainingCr > 0 ? (
              <span className="text-xs font-semibold text-emerald-800">
                ₹{activeGreenFieldPlantBudget.remainingCr.toFixed(2)} Cr unallocated to sections
              </span>
            ) : (
              <span className="text-xs font-semibold text-emerald-800">Fully allocated to sections</span>
            )}
          </div>
        </div>
      )}

      {fieldTab === 'green_field' && activeGreenFieldSectionBudget?.hasSectionBudget && selectedGreenFieldSection && !selectedHeadFilter && (
        <div className={[
          'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 shrink-0 text-sm',
          activeGreenFieldSectionBudget.over
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900',
        ].join(' ')}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{selectedGreenFieldSection} budget</span>
            <p className="font-black font-mono text-lg">₹{activeGreenFieldSectionBudget.allocatedCr.toFixed(2)} Cr</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">To heads</span>
            <p className="font-bold font-mono">₹{activeGreenFieldSectionBudget.headAllocatedCr.toFixed(2)} Cr</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Sub-particulars</span>
            <p className="font-bold font-mono">₹{activeGreenFieldSectionBudget.subParticularsCr.toFixed(2)} Cr</p>
          </div>
          <div className="ml-auto">
            {activeGreenFieldSectionBudget.over ? (
              <span className="text-xs font-bold text-red-700">
                Head allocation over by ₹{Math.abs(activeGreenFieldSectionBudget.remainingCr).toFixed(2)} Cr
              </span>
            ) : activeGreenFieldSectionBudget.remainingCr > 0 ? (
              <span className="text-xs font-semibold text-emerald-800">
                ₹{activeGreenFieldSectionBudget.remainingCr.toFixed(2)} Cr unallocated to heads
              </span>
            ) : (
              <span className="text-xs font-semibold text-emerald-800">Fully allocated to heads</span>
            )}
          </div>
        </div>
      )}

      {fieldTab === 'green_field' && activeGreenFieldHeadBudget?.hasAllocation && selectedHeadFilter && (
        <div className={[
          'flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 shrink-0 text-sm',
          activeGreenFieldHeadBudget.over
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900',
        ].join(' ')}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{selectedHeadFilter} budget</span>
            <p className="font-black font-mono text-lg">₹{activeGreenFieldHeadBudget.allocatedCr.toFixed(2)} Cr</p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide opacity-70">Sub-particulars</span>
            <p className="font-bold font-mono">₹{activeGreenFieldHeadBudget.usedCr.toFixed(2)} Cr</p>
          </div>
          <div className="ml-auto">
            {activeGreenFieldHeadBudget.over ? (
              <span className="text-xs font-bold text-red-700">
                Over by ₹{Math.abs(activeGreenFieldHeadBudget.remainingCr).toFixed(2)} Cr
              </span>
            ) : activeGreenFieldHeadBudget.remainingCr > 0 ? (
              <span className="text-xs font-semibold text-emerald-800">
                ₹{activeGreenFieldHeadBudget.remainingCr.toFixed(2)} Cr remaining
              </span>
            ) : (
              <span className="text-xs font-semibold text-emerald-800">Fully utilised</span>
            )}
          </div>
        </div>
      )}

      {/* Add-item form */}
      {showAddForm && activePlant && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shrink-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            New Item — {plantLabel(activePlant)} · FY {activeFy}
          </p>
          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium" htmlFor="head-select">Head</label>
              {selectedHeadFilter ? (
                <div className="mt-1 inline-flex items-center px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  {selectedHeadFilter}
                </div>
              ) : !showCustomHead ? (
                <select
                  id="head-select"
                  value={form.head}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setShowCustomHead(true)
                      setForm(f => ({ ...f, head: '' }))
                    } else {
                      setForm(f => ({ ...f, head: e.target.value }))
                    }
                  }}
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488] bg-white"
                >
                  {activeHeads.map(h => <option key={h} value={h}>{h}</option>)}
                  <option disabled>──────────</option>
                  <option value="__custom__">+ Create new head…</option>
                </select>
              ) : (
                <div className="mt-1 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      type="text"
                      value={customHeadInput}
                      onChange={e => { setCustomHeadInput(e.target.value); setForm(f => ({ ...f, head: e.target.value })) }}
                      placeholder="New head name"
                      maxLength={40}
                      aria-label="New budget head name"
                      className="flex-1 text-sm border border-[#5EEAD4] rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
                    />
                    <button
                      type="button"
                      onClick={() => { setShowCustomHead(false); setCustomHeadInput(''); setForm(f => ({ ...f, head: activeHeads[0] ?? HEAD_ORDER[0] })) }}
                      aria-label="Cancel custom head"
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-[#115E59] bg-[#CCFBF1] border border-[#5EEAD4] rounded px-2 py-1 leading-snug">
                    This head will be added for FY {activeFy}. You can rename it later from the section header.
                  </p>
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Department</label>
              <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                placeholder="e.g. HEX"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Sub Particulars</label>
              <input type="text" value={form.subParticulars} onChange={e => setForm(f => ({ ...f, subParticulars: e.target.value }))}
                placeholder="Item description"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Qty</label>
              <input type="number" step="1" min="0" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                placeholder="0"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 font-medium">Rate</label>
                <input type="number" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]" />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium">Total (Cr)</label>
                <input type="number" step="0.01" value={form.totalCost} onChange={e => setForm(f => ({ ...f, totalCost: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488]" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddItem} disabled={!form.subParticulars.trim()}
              className="px-4 py-1.5 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] disabled:opacity-40 text-white rounded-lg">Add</button>
            <button onClick={() => { setShowAddForm(false); setShowCustomHead(false); setCustomHeadInput(''); setForm({ ...BLANK_FORM, head: getDefaultHeadForAddForm() }) }}
              className="px-4 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* Table area */}
      <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {!activePlant ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            No plant selected.
          </div>
        ) : fieldTab === 'green_field' && !selectedGreenFieldSection ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-sm text-slate-500 mb-4">
              Select a section to manage budget heads and line items for {plantLabel(activePlant)}.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {greenFieldSectionSummaries.map(({ section, count, allocatedCr, usedCr, over, remainingCr, hasAllocation, headAllocatedCr, subParticularsCr }) => {
                const s = headStyle(section)
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => handleSelectGreenFieldSection(section)}
                    className={[
                      'group text-left rounded-xl border bg-white p-4 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600',
                      over ? 'border-red-300 hover:border-red-400' : 'border-slate-200 hover:border-emerald-500',
                    ].join(' ')}
                  >
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>
                      {section}
                    </span>
                    {hasAllocation ? (
                      <>
                        <p className={['text-2xl font-black font-mono mt-3', over ? 'text-red-700' : 'text-emerald-700'].join(' ')}>
                          ₹{allocatedCr.toFixed(2)} <span className="text-xs font-semibold">Cr allocated</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          ₹{usedCr.toFixed(2)} Cr to heads · ₹{subParticularsCr.toFixed(2)} Cr in sub-particulars
                        </p>
                        {over ? (
                          <p className="text-[11px] font-bold text-red-600 mt-1">Over by ₹{Math.abs(remainingCr).toFixed(2)} Cr</p>
                        ) : remainingCr > 0 ? (
                          <p className="text-[11px] font-semibold text-emerald-700 mt-1">₹{remainingCr.toFixed(2)} Cr remaining</p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <p className="text-2xl font-black font-mono text-emerald-700 mt-3">
                          Assign budget
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {count} line item{count !== 1 ? 's' : ''} · ₹{headAllocatedCr.toFixed(2)} Cr already to heads
                        </p>
                      </>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-emerald-600 mt-3 transition-colors" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : isAwaitingHeadSelection ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-sm text-slate-500 mb-4">
              {fieldTab === 'green_field'
                ? `Select a budget head under ${selectedGreenFieldSection} for ${plantLabel(activePlant)}.`
                : `Select a budget head for ${plantLabel(activePlant)}.`}
            </p>
            {fieldTab === 'brown_field' && headSummary.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center py-12 px-6">
                <Building2 className="w-10 h-10 text-slate-200" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-500">No budget heads with line items yet</p>
                <p className="text-xs text-slate-400 max-w-sm">
                  Heads appear here once they have master line items. Use Manage Heads to add a new head, then add items inside it.
                </p>
                <button
                  type="button"
                  onClick={openHeadsModal}
                  className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#153f90] hover:bg-[#0f2d6b] text-white rounded-lg transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" /> Manage Heads
                </button>
              </div>
            ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {headSummary.map(({ head, total, usedCr, count, over, overCr, hasAllocation, remainingCr }) => {
                const s = headStyle(head)
                const isGreen = fieldTab === 'green_field'
                return (
                  <button
                    key={head}
                    type="button"
                    onClick={() => {
                      if (isGreen) {
                        handleSelectGreenFieldHead(head)
                      } else {
                        setSelectedHeadFilter(head)
                        setShowCustomHead(false)
                        setCustomHeadInput('')
                        setShowAddForm(false)
                        setForm(f => ({ ...f, head }))
                      }
                    }}
                    className={[
                      'text-left rounded-xl border-2 p-4 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2',
                      isGreen ? 'focus-visible:ring-emerald-600' : 'focus-visible:ring-[#153f90]',
                      over
                        ? 'border-red-300 bg-red-50/80 hover:border-red-400'
                        : isGreen
                          ? 'border-slate-200 bg-white hover:border-emerald-500'
                          : 'border-slate-200 bg-white hover:border-[#153f90]',
                    ].join(' ')}
                  >
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>
                      {head}
                    </span>
                    {isGreen && hasAllocation ? (
                      <>
                        <p className={[
                          'text-xl font-black font-mono mt-3',
                          over ? 'text-red-700' : 'text-emerald-700',
                        ].join(' ')}>
                          ₹{total.toFixed(2)} <span className="text-[10px] font-semibold">Cr allocated</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          ₹{usedCr.toFixed(2)} Cr used · {count} sub-particular{count !== 1 ? 's' : ''}
                        </p>
                        {over ? (
                          <p className="text-[10px] font-bold text-red-600 mt-1">Over by ₹{overCr.toFixed(2)} Cr</p>
                        ) : remainingCr > 0 ? (
                          <p className="text-[10px] font-semibold text-emerald-700 mt-1">₹{remainingCr.toFixed(2)} Cr remaining</p>
                        ) : !hasAllocation ? (
                          <p className="text-[10px] text-amber-600 mt-1 font-medium">Click to assign budget</p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <p className={[
                          'text-xl font-black font-mono mt-3',
                          over ? 'text-red-700' : isGreen ? 'text-emerald-700' : 'text-[#153f90]',
                        ].join(' ')}>
                          {isGreen ? 'Assign budget' : `₹${total.toFixed(2)}`}{' '}
                          {!isGreen && <span className="text-[10px] font-semibold">Cr</span>}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {isGreen ? 'Set head budget on first open' : `${count} sub-particular${count !== 1 ? 's' : ''}`}
                        </p>
                        {over && !isGreen && (
                          <p className="text-[10px] font-bold text-red-600 mt-1">Over by ₹{overCr.toFixed(2)} Cr</p>
                        )}
                      </>
                    )}
                    <ChevronRight className={[
                      'w-4 h-4 text-slate-300 mt-3',
                      isGreen ? 'group-hover:text-emerald-600' : '',
                    ].join(' ')} aria-hidden="true" />
                  </button>
                )
              })}
            </div>
            )}
          </div>
        ) : (fieldTab === 'green_field' || fieldTab === 'brown_field') && selectedHeadFilter && displayItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <Building2 className="w-10 h-10 text-slate-200" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-500">
              No items in {selectedHeadFilter} for FY {activeFy}
            </p>
            {brownFieldLocked ? (
              <>
                <p className="text-xs text-slate-400">Live FY budgets are locked. Plan changes in the next FY.</p>
                <Link
                  href="/capex/budget-proposals"
                  className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
                >
                  <ClipboardList className="w-3.5 h-3.5" /> Plan Next-FY Budget
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-400">Use &quot;Add Item&quot; to begin planning this head&apos;s budget.</p>
                <button
                  onClick={openAddItemForm}
                  className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add First Item
                </button>
              </>
            )}
          </div>
        ) : displayItems.length === 0 && headSummary.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <Building2 className="w-10 h-10 text-slate-200" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-500">
              {fieldTab === 'green_field' && selectedGreenFieldSection
                ? `No items in ${selectedGreenFieldSection} for FY ${activeFy}`
                : `No items for ${plantLabel(activePlant)} in FY ${activeFy}`}
            </p>
            <p className="text-xs text-slate-400">Use &quot;Add Item&quot; to begin planning this plant&apos;s budget.</p>
            {canAddMasterItem && (
              <button
                onClick={openAddItemForm}
                className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add First Item
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Head summary — selectable budget cards (Digitisation / IT only) */}
            {(fieldTab === 'digitisation' || fieldTab === 'information_technology') && (
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedHeadFilter(null)
                    setShowCustomHead(false)
                    setCustomHeadInput('')
                    setForm(f => ({ ...f, head: activeHeads[0] ?? BLANK_FORM.head }))
                  }}
                  className={[
                    'text-left rounded-xl border-2 p-3 transition-all',
                    selectedHeadFilter === null
                      ? 'border-[#153f90] bg-white shadow-sm ring-2 ring-[#153f90]/15'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  ].join(' ')}
                >
                  <p className="text-xs font-bold text-slate-800">All Heads</p>
                  <p className="text-lg font-black font-mono mt-1 text-[#153f90]">
                    ₹{scopeItems.reduce((s, i) => s + i.totalCost, 0).toFixed(2)}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{scopeItems.length} items</p>
                </button>
                {headSummary.map(({ head, total, count, over, overCr }) => {
                  const s = headStyle(head)
                  const selected = selectedHeadFilter === head
                  return (
                    <button
                      key={head}
                      type="button"
                      onClick={() => {
                        setSelectedHeadFilter(head)
                        setShowCustomHead(false)
                        setCustomHeadInput('')
                        setForm(f => ({ ...f, head }))
                      }}
                      className={[
                        'text-left rounded-xl border-2 p-3 transition-all',
                        selected
                          ? over
                            ? 'border-red-500 bg-red-50 ring-2 ring-red-200'
                            : 'bg-white shadow-sm ring-2 border-[#153f90] ring-[#153f90]/15'
                          : over
                            ? 'border-red-300 bg-red-50/80 hover:border-red-400'
                            : 'border-slate-200 bg-white hover:border-slate-300',
                      ].join(' ')}
                    >
                      <p className="text-xs font-bold text-slate-800 leading-snug">{head}</p>
                      <p className={['text-lg font-black font-mono mt-1', over ? 'text-red-700' : 'text-[#153f90]'].join(' ')}>
                        ₹{total.toFixed(2)} <span className="text-[10px] font-semibold">Cr</span>
                      </p>
                      <p className="text-[10px] text-slate-400 mt-1">{count} sub-particular{count !== 1 ? 's' : ''}</p>
                      {over && (
                        <p className="text-[10px] font-bold text-red-600 mt-1">Over by ₹{overCr.toFixed(2)} Cr</p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {/* Brown / Green Field — compact head switcher when inside a head */}
            {(fieldTab === 'green_field' || fieldTab === 'brown_field') && selectedHeadFilter && (
            <div className="shrink-0 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
              <div className="flex flex-wrap gap-2">
                {headSummary.map(({ head, total, over }) => {
                  const selected = selectedHeadFilter === head
                  const isGreen = fieldTab === 'green_field'
                  return (
                    <button
                      key={head}
                      type="button"
                      onClick={() => {
                        if (isGreen && selectedGreenFieldSection) {
                          if (head === selectedHeadFilter) return
                          handleSelectGreenFieldHead(head)
                        } else {
                          setSelectedHeadFilter(head)
                          setShowAddForm(false)
                          cancelEdit()
                          setForm(f => ({ ...f, head }))
                        }
                      }}
                      className={[
                        'text-left rounded-lg border px-3 py-2 transition-all text-xs',
                        selected
                          ? over
                            ? 'border-red-500 bg-red-50 font-bold text-red-800'
                            : isGreen
                              ? 'border-emerald-600 bg-emerald-50 font-bold text-emerald-800'
                              : 'border-[#153f90] bg-[#EBF0FB] font-bold text-[#153f90]'
                          : over
                            ? 'border-red-200 bg-red-50/50 text-red-700 hover:border-red-400'
                            : isGreen
                              ? 'border-slate-200 bg-white text-slate-600 hover:border-emerald-400'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-[#153f90]',
                      ].join(' ')}
                    >
                      {head}
                      <span className="ml-1.5 font-mono text-[10px] opacity-70">₹{total.toFixed(2)} Cr</span>
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-white border-b-2 border-slate-200">
                  <tr>
                    <th className="pl-4 pr-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-9">#</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Head</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Department</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sub Particulars</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider w-20">Qty</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider w-28">Rate (Cr)</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider w-32">Total Cost (Cr)</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Req. No.</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-32">Sourcing</th>
                    <th className="w-10" />
                  </tr>
                </thead>

                {[...grouped.entries()].map(([head, items]) => {
                  const s = headStyle(head)
                  return (
                    <tbody key={head}>
                      {/* Section header row */}
                      <tr className={`border-b border-slate-100 border-l-4 ${s.border} bg-slate-50/80`}>
                        <td className="pl-3 pr-3 py-1.5" />
                        <td colSpan={9} className="px-3 py-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>{head}</span>
                        </td>
                      </tr>

                      {items.map(item => {
                        rowNum++
                        const isEditing = editingId === item.id
                        const overrunINR = itemOverrun(item)
                        return (
                          <tr
                            key={item.id}
                            className={[
                              'border-b border-slate-100 border-l-4 hover:brightness-95 transition-all',
                              overrunINR > 0 ? 'bg-red-50/80 border-l-red-500' : `${s.border} ${s.row}`,
                            ].join(' ')}
                          >
                            <td className="pl-3 pr-3 py-2 text-[11px] text-slate-300 font-medium text-right tabular-nums">{rowNum}</td>
                            <td className="px-3 py-2.5" onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}>
                              {isEditing ? (
                                <select
                                  value={editHead}
                                  onChange={e => setEditHead(e.target.value)}
                                  autoFocus
                                  aria-label="Change budget head"
                                  className="w-full text-[12px] font-semibold border border-violet-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-700 leading-tight"
                                >
                                  {activeHeads.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>{head}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-[12px] text-slate-500">
                              {item.department || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2 text-[13px] text-slate-800 font-medium leading-snug">{item.subParticulars}</td>
                            <td className="px-3 py-2.5 text-right text-[12px] font-mono text-slate-600">
                              {isEditing ? (
                                <input type="number" step="1" min="0" value={editQty}
                                  onChange={e => setEditQty(e.target.value)}
                                  className="w-16 text-right text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                                  aria-label="Edit quantity" />
                              ) : item.qty != null && item.qty > 0 ? (
                                item.qty.toLocaleString('en-IN')
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[12px] font-mono text-slate-500">
                              {isEditing ? (
                                <input type="number" step="0.001" value={editRate}
                                  onChange={e => setEditRate(e.target.value)}
                                  className="w-24 text-right text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                                  aria-label="Edit rate" />
                              ) : item.rateRs != null && item.rateRs > 0 ? (
                                item.rateRs.toLocaleString('en-IN')
                              ) : (
                                item.rate >= 1000
                                  ? item.rate.toLocaleString('en-IN')
                                  : item.rate > 0 ? item.rate.toFixed(3).replace(/\.?0+$/, '') : '—'
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-[13px] font-mono font-bold text-slate-700">
                              {isEditing ? (
                                <input type="number" step="0.01" value={editAlloc}
                                  onChange={e => setEditAlloc(e.target.value)}
                                  className="w-24 text-right text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-violet-500"
                                  aria-label="Edit total cost" />
                              ) : (
                                <span className="inline-flex items-center gap-1.5 justify-end">
                                  {item.totalCost > 0 ? item.totalCost.toFixed(2) : <span className="text-slate-300">—</span>}
                                  {overrunINR > 0 && (
                                    <span className="text-[10px] font-bold text-red-600 whitespace-nowrap">
                                      ↑ {formatOverLakhs(overrunINR)} over
                                    </span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {(() => {
                                const linked = reqsByMasterItem.get(item.id)
                                if (!linked?.length) return <span className="text-slate-300 text-[11px]">—</span>
                                return (
                                  <div className="flex flex-col gap-1">
                                    {linked.map(req => (
                                      <Link key={req.id} href={`/capex/${req.id}`}
                                        className="inline-block text-[11px] font-bold text-[#153f90] bg-[#EBF0FB] border border-[#C8D5F4] px-1.5 py-0.5 rounded hover:bg-[#C8D5F4] transition-colors">
                                        {req.requestNo ?? req.id.slice(0, 8)}
                                      </Link>
                                    ))}
                                  </div>
                                )
                              })()}
                            </td>
                            <td className="px-3 py-2">
                              {(() => {
                                const linked = reqsByMasterItem.get(item.id)
                                if (!linked?.length) return <span className="text-slate-300 text-[11px]">—</span>
                                const names = [...new Set(linked.map(r => ROLE_NAMES[r.assignedTo] ?? r.assignedTo))]
                                return <span className="text-[11px] text-slate-600 font-medium">{names.join(', ')}</span>
                              })()}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              {brownFieldLocked ? (
                                <span title="Live FY budget is locked — use Budget Planning" className="inline-flex p-1 text-slate-300">
                                  <Lock className="w-3 h-3" />
                                </span>
                              ) : isEditing ? (
                                <button onClick={() => saveEdit(item.id, item.head)} aria-label="Save changes"
                                  className="p-1 text-violet-600 hover:bg-violet-100 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button onClick={() => startEdit(item)} aria-label={`Edit ${item.subParticulars}`}
                                  className="p-1 text-slate-300 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  )
                })}

                <tfoot>
                  <tr className="bg-[#1e1b4b]">
                    <td colSpan={6} className="pl-5 pr-4 py-3.5 text-[12px] font-bold text-indigo-300/60 uppercase tracking-wider">
                      {plantLabel(activePlant!)} — Grand Total
                      <span className="ml-2 text-indigo-300/40 font-normal normal-case tracking-normal text-[11px]">({displayItems.length} items)</span>
                    </td>
                    <td className="px-4 py-3.5 text-right text-[19px] font-black text-amber-300 font-mono tracking-tight">
                      ₹{grandTotal.toFixed(2)} Cr
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Manage Heads modal */}
      {showHeadsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold text-slate-900">Manage Heads</h2>
              <button onClick={() => setShowHeadsModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              {fieldTab === 'brown_field'
                ? 'Rename heads, remove custom heads, or add a new head to start budgeting.'
                : 'Rename any head · custom heads can also be removed (items move to Misc.)'}
            </p>
            {fieldTab === 'brown_field' && (
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={newManageHeadInput}
                  onChange={e => setNewManageHeadInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddManageHead()}
                  placeholder="New head name"
                  maxLength={40}
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#153f90]"
                />
                <button
                  type="button"
                  onClick={handleAddManageHead}
                  disabled={!newManageHeadInput.trim()}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#153f90] hover:bg-[#0f2d6b] disabled:opacity-40 text-white rounded-lg"
                >
                  Add Head
                </button>
              </div>
            )}
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {activeHeads.map(head => {
                const s = headStyle(head)
                const isCustomHead = !canonicalHeadOrder.includes(head)
                const markedForDelete = headsToDelete.has(head)
                return (
                  <div key={head} className={`flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors ${markedForDelete ? 'opacity-40' : ''}`}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${s.badge} ${markedForDelete ? 'line-through' : ''}`}>
                      {head}
                    </span>
                    <input
                      type="text"
                      value={headEdits[head] ?? head}
                      onChange={e => setHeadEdits(prev => ({ ...prev, [head]: e.target.value }))}
                      maxLength={40}
                      disabled={markedForDelete}
                      className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#0D9488] disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    {isCustomHead && (
                      <button
                        onClick={() => setHeadsToDelete(prev => {
                          const next = new Set(prev)
                          if (next.has(head)) next.delete(head); else next.add(head)
                          return next
                        })}
                        aria-label={markedForDelete ? `Undo remove "${head}"` : `Remove head "${head}"`}
                        className={`p-1.5 rounded-lg transition-colors shrink-0 ${markedForDelete ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100' : 'text-red-400 hover:text-red-600 hover:bg-red-50'}`}
                      >
                        {markedForDelete
                          ? <RotateCcw className="w-3.5 h-3.5" />
                          : <Trash2 className="w-3.5 h-3.5" />
                        }
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={saveHeadEdits}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
              >
                Save Changes
              </button>
              <button
                onClick={() => setShowHeadsModal(false)}
                className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Green Field section budget assignment modal */}
      {showSectionBudgetModal && sectionBudgetModalTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {sectionBudgetModalTarget.isEdit ? 'Edit Section Budget' : 'Assign Section Budget'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {sectionBudgetModalTarget.section}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowSectionBudgetModal(false)
                  setSectionBudgetModalTarget(null)
                  setSectionBudgetInput('')
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {activeGreenFieldPlantBudget?.hasPlantBudget && (
              <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Plant budget: ₹{activeGreenFieldPlantBudget.allocatedCr.toFixed(2)} Cr ·
                {' '}₹{activeGreenFieldPlantBudget.distributedCr.toFixed(2)} Cr already to sections
              </p>
            )}
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">
              Overall budget for this section (Cr) <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              type="number"
              step="0.01"
              min="0"
              value={sectionBudgetInput}
              onChange={e => setSectionBudgetInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveSectionBudget()}
              placeholder="e.g. 40.00"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <p className="text-[11px] text-slate-400 mt-2">
              Head budgets inside this section will be deducted from this section envelope. Over-budget is shown as a warning only.
            </p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={saveSectionBudget}
                disabled={!sectionBudgetInput.trim() || parseFloat(sectionBudgetInput) < 0}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg"
              >
                {sectionBudgetModalTarget.isEdit ? 'Save Budget' : 'Assign & Open Section'}
              </button>
              <button
                onClick={() => {
                  setShowSectionBudgetModal(false)
                  setSectionBudgetModalTarget(null)
                  setSectionBudgetInput('')
                }}
                className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Green Field head budget assignment modal */}
      {showHeadBudgetModal && headBudgetModalTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {headBudgetModalTarget.isEdit ? 'Edit Head Budget' : 'Assign Head Budget'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {headBudgetModalTarget.head} · {headBudgetModalTarget.division}
                </p>
              </div>
              <button
                onClick={() => {
                  setShowHeadBudgetModal(false)
                  setHeadBudgetModalTarget(null)
                  setHeadBudgetInput('')
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {activeGreenFieldSectionBudget?.hasSectionBudget && (
              <p className="text-xs text-slate-500 mb-4 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Section budget: ₹{activeGreenFieldSectionBudget.allocatedCr.toFixed(2)} Cr ·
                {' '}₹{activeGreenFieldSectionBudget.headAllocatedCr.toFixed(2)} Cr already to heads
              </p>
            )}
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">
              Overall budget for this head (Cr) <span className="text-red-400">*</span>
            </label>
            <input
              autoFocus
              type="number"
              step="0.01"
              min="0"
              value={headBudgetInput}
              onChange={e => setHeadBudgetInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveHeadBudget()}
              placeholder="e.g. 25.00"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <p className="text-[11px] text-slate-400 mt-2">
              Sub-particular line items will be deducted from this head budget. Over-budget is shown as a warning only.
            </p>
            <div className="flex gap-2 mt-6">
              <button
                onClick={saveHeadBudget}
                disabled={!headBudgetInput.trim() || parseFloat(headBudgetInput) < 0}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg"
              >
                {headBudgetModalTarget.isEdit ? 'Save Budget' : 'Assign & Open Head'}
              </button>
              <button
                onClick={() => {
                  setShowHeadBudgetModal(false)
                  setHeadBudgetModalTarget(null)
                  setHeadBudgetInput('')
                }}
                className="px-4 py-2.5 text-sm font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
