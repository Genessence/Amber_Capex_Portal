'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { Check, Pencil, RotateCcw, X, Building2, Plus, ArrowLeft, ChevronRight, SlidersHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES, getPlantForRole } from '@/lib/constants'
import type { CapexMasterItem, PlantMeta } from '@/lib/types'

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

const HEAD_ORDER = ['Automation', 'Machinery', 'General', 'Digitization', 'New Business', 'Safety & Security', 'Misc.']

function headStyle(head: string) {
  return HEAD_STYLE[head] ?? {
    badge:  'bg-slate-100 text-slate-500 border border-slate-200',
    border: 'border-l-slate-300',
    row:    'bg-slate-50/20',
    chip:   'bg-slate-50 border-slate-200 text-slate-500',
    dot:    'bg-slate-400',
  }
}

const BLANK_FORM = { head: 'Automation', department: '', subParticulars: '', rate: '', totalCost: '' }

type PlantFormState = { label: string; state: string; assignedUser: string }
const BLANK_PLANT_FORM: PlantFormState = { label: '', state: '', assignedUser: '' }

export default function CapexMasterPage() {
  const {
    capexMaster, requests, customPlants,
    updateMasterItem, addMasterItem, cloneMasterForFY,
    masterHeads, addMasterHead, renameMasterHead, removeMasterHead, addCustomPlant,
  } = useCapex()

  const reqsByMasterItem = useMemo(() => {
    const map = new Map<string, typeof requests>()
    requests.forEach(req => {
      if (!req.masterItemId) return
      map.set(req.masterItemId, [...(map.get(req.masterItemId) ?? []), req])
    })
    return map
  }, [requests])

  const allFys = useMemo(
    () => [...new Set(capexMaster.map(i => i.fy))].sort((a, b) => b.localeCompare(a)),
    [capexMaster],
  )

  const [view, setView]               = useState<'grid' | 'detail'>('grid')
  const [selectedFy, setSelectedFy]   = useState('')
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editRate, setEditRate]       = useState('')
  const [editAlloc, setEditAlloc]     = useState('')
  const [editHead, setEditHead]       = useState('')
  const [showFyModal, setShowFyModal] = useState(false)
  const [newFyInput, setNewFyInput]   = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm]               = useState(BLANK_FORM)
  const [showCustomHead, setShowCustomHead]   = useState(false)
  const [customHeadInput, setCustomHeadInput] = useState('')
  const [showAddPlant, setShowAddPlant]       = useState(false)
  const [plantForm, setPlantForm]             = useState<PlantFormState>(BLANK_PLANT_FORM)
  const [showHeadsModal, setShowHeadsModal]   = useState(false)
  const [headEdits, setHeadEdits]             = useState<Record<string, string>>({})
  const [headsToDelete, setHeadsToDelete]     = useState<Set<string>>(new Set())
  const [roleKey, setRoleKey]                 = useState(0)

  useEffect(() => {
    const handler = () => { setRoleKey(k => k + 1); setSelectedPlant(null); setView('grid') }
    window.addEventListener('capex_rolechange', handler as EventListener)
    return () => window.removeEventListener('capex_rolechange', handler as EventListener)
  }, [])

  const activeFy = selectedFy || allFys[0] || ''
  const fyItems  = useMemo(() => capexMaster.filter(i => i.fy === activeFy), [capexMaster, activeFy])

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

  const activePlant = useMemo(() => {
    if (view === 'detail' && selectedPlant) return selectedPlant
    const candidate = selectedPlant ?? visiblePlants[0]?.value ?? null
    if (candidate && !visiblePlants.some(p => p.value === candidate)) {
      return visiblePlants[0]?.value ?? null
    }
    return candidate
  }, [selectedPlant, visiblePlants, view])

  const plantItems = useMemo(() => fyItems.filter(i => i.plant === activePlant), [fyItems, activePlant])
  const grandTotal = useMemo(() => plantItems.reduce((s, i) => s + i.totalCost, 0), [plantItems])

  const activeHeads = useMemo(() => {
    const extras = [...new Set([...masterHeads, ...fyItems.map(i => i.head)])]
      .filter(h => h && !HEAD_ORDER.includes(h))
      .sort()
    return [...HEAD_ORDER, ...extras]
  }, [masterHeads, fyItems])

  const grouped = useMemo(() => {
    const map = new Map<string, CapexMasterItem[]>()
    plantItems.forEach(item => {
      const key = item.head || 'Other'
      map.set(key, [...(map.get(key) ?? []), item])
    })
    const sorted = new Map<string, CapexMasterItem[]>()
    activeHeads.forEach(h => { if (map.has(h)) sorted.set(h, map.get(h)!) })
    map.forEach((v, k) => { if (!sorted.has(k)) sorted.set(k, v) })
    return sorted
  }, [plantItems, activeHeads])

  const headSummary = useMemo(() =>
    [...grouped.entries()].map(([head, items]) => ({
      head,
      total: items.reduce((s, i) => s + i.totalCost, 0),
      count: items.length,
    })),
  [grouped])

  function plantStat(val: string) {
    const items = fyItems.filter(i => i.plant === val)
    return { total: items.reduce((s, i) => s + i.totalCost, 0), count: items.length }
  }

  function plantLabel(val: string) {
    return allPlants.find(p => p.value === val)?.label ?? val
  }

  function startEdit(item: CapexMasterItem) {
    setEditingId(item.id)
    setEditHead(item.head)
    setEditRate(String(item.rate))
    setEditAlloc(String(item.totalCost))
  }

  function saveEdit(id: string, originalHead: string) {
    const rate = parseFloat(editRate), totalCost = parseFloat(editAlloc)
    if (!isNaN(rate) && !isNaN(totalCost)) {
      updateMasterItem(id, { head: editHead || originalHead, rate, totalCost })
      if (editHead && editHead !== originalHead) toast.success(`Moved to "${editHead}"`)
      setEditingId(null)
    }
  }

  function cancelEdit() {
    setEditingId(null); setEditHead(''); setEditRate(''); setEditAlloc('')
  }

  function openHeadsModal() {
    setHeadEdits(Object.fromEntries(activeHeads.map(h => [h, h])))
    setHeadsToDelete(new Set())
    setShowHeadsModal(true)
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

  function handleAddItem() {
    if (!form.subParticulars.trim() || !activePlant) return
    const headValue = showCustomHead ? customHeadInput.trim() : form.head
    if (!headValue) return
    if (showCustomHead && customHeadInput.trim()) addMasterHead(customHeadInput.trim())
    const rate = parseFloat(form.rate), totalCost = parseFloat(form.totalCost)
    addMasterItem({
      id: `cm-${crypto.randomUUID()}`,
      fy: activeFy || '2025-26',
      plant: activePlant,
      head: headValue,
      department: form.department.trim(),
      subParticulars: form.subParticulars.trim(),
      rate: isNaN(rate) ? 0 : rate,
      totalCost: isNaN(totalCost) ? 0 : totalCost,
    })
    setForm({ ...BLANK_FORM, head: activeHeads[0] ?? BLANK_FORM.head })
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
      <div className="p-6 h-full flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">CAPEX Master</h1>
            <p className="text-sm text-slate-400 mt-0.5">Select a plant to manage its annual budget · FY {activeFy}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-500 mr-1">FY</label>
            <select
              value={activeFy}
              onChange={e => setSelectedFy(e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
            >
              {allFys.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
            <button
              onClick={() => setShowFyModal(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" /> New FY
            </button>
          </div>
        </div>

        {fyBanner}

        {/* Plant grid */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">

            {visiblePlants.map(plant => {
              const { total, count } = plantStat(plant.value)
              const isEmpty = count === 0
              return (
                <button
                  key={plant.value}
                  onClick={() => { setSelectedPlant(plant.value); setView('detail') }}
                  className="group text-left rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#5B82D4] hover:shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-xl bg-[#EBF0FB] flex items-center justify-center">
                      <Building2 className="w-5 h-5 text-[#153f90]" aria-hidden="true" />
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-[#153f90] mt-1 transition-colors" aria-hidden="true" />
                  </div>
                  <div className="mt-4">
                    <p className="text-[16px] font-bold text-slate-900 leading-tight">{plant.label}</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">{plant.state}</p>
                    {plant.assignedUser && (
                      <p className="text-[11px] text-[#0D9488] mt-1.5 font-medium flex items-center gap-1">
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-[#CCFBF1] text-[#0D9488] text-center leading-3.5 text-[9px] font-bold">P</span>
                        {plant.assignedUser}
                      </p>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {isEmpty ? (
                      <p className="text-[12px] text-slate-400 italic">No items for FY {activeFy}</p>
                    ) : (
                      <div>
                        <p className="text-[24px] font-black text-[#0D9488] font-mono leading-none">₹{total.toFixed(2)}</p>
                        <p className="text-[11px] text-slate-400 mt-1">Crore · {count} line items</p>
                      </div>
                    )}
                  </div>
                </button>
              )
            })}

            {/* Add Plant card */}
            {canAddPlant && (
              <button
                onClick={() => setShowAddPlant(true)}
                className="group text-left rounded-2xl border-2 border-dashed border-slate-200 bg-transparent p-5
                           hover:border-[#0D9488] hover:bg-[#CCFBF1]/20 transition-all
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D9488]"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-[#CCFBF1] flex items-center justify-center transition-colors">
                  <Plus className="w-5 h-5 text-slate-400 group-hover:text-[#0D9488] transition-colors" aria-hidden="true" />
                </div>
                <div className="mt-4">
                  <p className="text-[16px] font-bold text-slate-400 group-hover:text-[#0D9488] transition-colors leading-tight">Add Plant</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">Configure a new plant location</p>
                </div>
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[11px] text-slate-300">Assign head, set state</p>
                </div>
              </button>
            )}

          </div>
        </div>

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

  return (
    <div className="p-6 h-full flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => { setView('grid'); cancelEdit(); setShowAddForm(false) }}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-900 transition-colors"
          aria-label="Back to all plants"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Plants</span>
        </button>
        <span className="text-slate-200 select-none">/</span>
        <h1 className="text-xl font-semibold text-slate-900 flex-1">
          {activePlant ? plantLabel(activePlant) : 'Plant'}
        </h1>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 mr-1">FY</label>
          <select
            value={activeFy}
            onChange={e => setSelectedFy(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-[#0D9488]"
          >
            {allFys.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
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
          {activePlant && (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )}
        </div>
      </div>

      {fyBanner}

      {/* Add-item form */}
      {showAddForm && activePlant && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shrink-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            New Item — {plantLabel(activePlant)} · FY {activeFy}
          </p>
          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium" htmlFor="head-select">Head</label>
              {!showCustomHead ? (
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
            <div className="col-span-2">
              <label className="text-xs text-slate-500 font-medium">Sub Particulars</label>
              <input type="text" value={form.subParticulars} onChange={e => setForm(f => ({ ...f, subParticulars: e.target.value }))}
                placeholder="Item description"
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
            <button onClick={() => { setShowAddForm(false); setShowCustomHead(false); setCustomHeadInput(''); setForm({ ...BLANK_FORM, head: activeHeads[0] ?? BLANK_FORM.head }) }}
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
        ) : plantItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8">
            <Building2 className="w-10 h-10 text-slate-200" aria-hidden="true" />
            <p className="text-sm font-semibold text-slate-500">
              No items for {plantLabel(activePlant)} in FY {activeFy}
            </p>
            <p className="text-xs text-slate-400">Use "Add Item" to begin planning this plant's budget.</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-1 flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#0D9488] hover:bg-[#115E59] text-white rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add First Item
            </button>
          </div>
        ) : (
          <>
            {/* Head summary strip */}
            <div className="shrink-0 flex flex-wrap gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
              {headSummary.map(({ head, total, count }) => {
                const s = headStyle(head)
                return (
                  <div key={head} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-semibold ${s.chip}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
                    {head}
                    <span className="font-mono font-bold ml-1">₹{total.toFixed(2)}</span>
                    <span className="font-normal opacity-60">· {count}</span>
                  </div>
                )
              })}
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-white border-b-2 border-slate-200">
                  <tr>
                    <th className="pl-4 pr-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-9">#</th>
                    <th className="px-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Head</th>
                    <th className="px-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Department</th>
                    <th className="px-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Sub Particulars</th>
                    <th className="px-3 py-3 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider w-28">Rate (Cr)</th>
                    <th className="px-3 py-3 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wider w-32">Total Cost (Cr)</th>
                    <th className="px-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-36">Req. No.</th>
                    <th className="px-3 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider w-32">Sourcing</th>
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
                        <td colSpan={8} className="px-3 py-1.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>{head}</span>
                        </td>
                      </tr>

                      {items.map(item => {
                        rowNum++
                        const isEditing = editingId === item.id
                        return (
                          <tr
                            key={item.id}
                            className={`border-b border-slate-100 border-l-4 ${s.border} ${s.row} hover:brightness-95 transition-all`}
                          >
                            <td className="pl-3 pr-3 py-2.5 text-[11px] text-slate-300 font-medium text-right tabular-nums">{rowNum}</td>
                            <td className="px-3 py-2.5" onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}>
                              {isEditing ? (
                                <select
                                  value={editHead}
                                  onChange={e => setEditHead(e.target.value)}
                                  autoFocus
                                  aria-label="Change budget head"
                                  className="w-full text-[12px] font-semibold border border-violet-300 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-violet-500 text-slate-700 leading-tight"
                                >
                                  {activeHeads.map(h => <option key={h} value={h}>{h}</option>)}
                                </select>
                              ) : (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>{head}</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-[12px] text-slate-500">
                              {item.department || <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-3 py-2.5 text-[13px] text-slate-800 font-medium leading-snug">{item.subParticulars}</td>
                            <td className="px-3 py-2.5 text-right text-[12px] font-mono text-slate-500">
                              {isEditing ? (
                                <input type="number" step="0.001" value={editRate}
                                  onChange={e => setEditRate(e.target.value)}
                                  className="w-24 text-right text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                  aria-label="Edit rate" />
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
                                  className="w-24 text-right text-sm border border-violet-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                  aria-label="Edit total cost" />
                              ) : (
                                item.totalCost > 0 ? item.totalCost.toFixed(2) : <span className="text-slate-300">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
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
                            <td className="px-3 py-2.5">
                              {(() => {
                                const linked = reqsByMasterItem.get(item.id)
                                if (!linked?.length) return <span className="text-slate-300 text-[11px]">—</span>
                                const names = [...new Set(linked.map(r => ROLE_NAMES[r.assignedTo] ?? r.assignedTo))]
                                return <span className="text-[11px] text-slate-600 font-medium">{names.join(', ')}</span>
                              })()}
                            </td>
                            <td className="px-2 py-2.5 text-center">
                              {isEditing ? (
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
                    <td colSpan={5} className="pl-5 pr-4 py-3.5 text-[12px] font-bold text-indigo-300/60 uppercase tracking-wider">
                      {plantLabel(activePlant!)} — Grand Total
                      <span className="ml-2 text-indigo-300/40 font-normal normal-case tracking-normal text-[11px]">({plantItems.length} items)</span>
                    </td>
                    <td className="px-4 py-3.5 text-right text-[19px] font-black text-amber-300 font-mono tracking-tight">
                      ₹{grandTotal.toFixed(2)} Cr
                    </td>
                    <td colSpan={3} />
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
            <p className="text-xs text-slate-400 mb-4">Rename any head · custom heads can also be removed (items move to Misc.)</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {activeHeads.map(head => {
                const s = headStyle(head)
                const isCustomHead = !HEAD_ORDER.includes(head)
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

    </div>
  )
}
