'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Check, Pencil, RotateCcw, X, Building2, Plus } from 'lucide-react'
import { useCapex } from '@/lib/capexContext'
import { PLANTS, ROLE_NAMES } from '@/lib/constants'
import type { CapexMasterItem } from '@/lib/types'

// ── Head palette ─────────────────────────────────────────────────────────────

const HEAD_STYLE: Record<string, {
  badge: string       // badge bg + text
  border: string      // left-border color class
  row: string         // row tint
  chip: string        // summary chip
  dot: string         // summary dot
}> = {
  'Automation':        { badge: 'bg-violet-100 text-violet-700 border border-violet-200', border: 'border-l-violet-400', row: 'bg-violet-50/30',  chip: 'bg-violet-50 border-violet-200 text-violet-700',  dot: 'bg-violet-400' },
  'Machinery':         { badge: 'bg-blue-100 text-blue-700 border border-blue-200',       border: 'border-l-blue-400',   row: 'bg-blue-50/30',    chip: 'bg-blue-50 border-blue-200 text-blue-700',        dot: 'bg-blue-400'   },
  'General':           { badge: 'bg-slate-100 text-slate-600 border border-slate-200',    border: 'border-l-slate-300',  row: 'bg-slate-50/30',   chip: 'bg-slate-50 border-slate-200 text-slate-600',     dot: 'bg-slate-400'  },
  'Digitization':      { badge: 'bg-teal-100 text-teal-700 border border-teal-200',       border: 'border-l-teal-400',   row: 'bg-teal-50/30',    chip: 'bg-teal-50 border-teal-200 text-teal-700',        dot: 'bg-teal-400'   },
  'New Business':      { badge: 'bg-amber-100 text-amber-700 border border-amber-200',    border: 'border-l-amber-400',  row: 'bg-amber-50/30',   chip: 'bg-amber-50 border-amber-200 text-amber-700',     dot: 'bg-amber-400'  },
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

export default function CapexMasterPage() {
  const { capexMaster, requests, updateMasterItem, addMasterItem, cloneMasterForFY, masterHeads, addMasterHead } = useCapex()

  // Index requests by masterItemId for O(1) lookup
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
  const [selectedFy, setSelectedFy]       = useState('')
  const [selectedPlant, setSelectedPlant] = useState<string | null>(null)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [editRate, setEditRate]           = useState('')
  const [editAlloc, setEditAlloc]         = useState('')
  const [showFyModal, setShowFyModal]     = useState(false)
  const [newFyInput, setNewFyInput]       = useState('')
  const [showAddForm, setShowAddForm]     = useState(false)
  const [form, setForm]                   = useState(BLANK_FORM)

  const activeFy    = selectedFy || allFys[0] || ''
  const fyItems     = useMemo(() => capexMaster.filter(i => i.fy === activeFy), [capexMaster, activeFy])

  const plantsWithData = useMemo(() => {
    const set = new Set(fyItems.map(i => i.plant))
    return PLANTS.filter(p => set.has(p.value))
  }, [fyItems])

  const activePlant  = selectedPlant ?? plantsWithData[0]?.value ?? null
  const plantItems   = useMemo(() => fyItems.filter(i => i.plant === activePlant), [fyItems, activePlant])
  const grandTotal   = useMemo(() => plantItems.reduce((s, i) => s + i.totalCost, 0), [plantItems])

  const activeHeads = useMemo(() => {
    const extras = [...new Set([...masterHeads, ...fyItems.map(i => i.head)])]
      .filter(h => h && !HEAD_ORDER.includes(h))
      .sort()
    return [...HEAD_ORDER, ...extras]
  }, [masterHeads, fyItems])

  // Group by head in canonical order
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

  // Head subtotals for summary strip
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
  function plantLabel(val: string) { return PLANTS.find(p => p.value === val)?.label ?? val }

  function startEdit(item: CapexMasterItem) {
    setEditingId(item.id)
    setEditRate(String(item.rate))
    setEditAlloc(String(item.totalCost))
  }
  function saveEdit(id: string) {
    const rate = parseFloat(editRate), totalCost = parseFloat(editAlloc)
    if (!isNaN(rate) && !isNaN(totalCost)) updateMasterItem(id, { rate, totalCost })
    setEditingId(null)
  }
  function handleCloneFY() {
    const fy = newFyInput.trim()
    if (!fy) return
    cloneMasterForFY(fy); setSelectedFy(fy); setNewFyInput(''); setShowFyModal(false)
  }
  function handleAddItem() {
    if (!form.subParticulars.trim() || !activePlant) return
    const rate = parseFloat(form.rate), totalCost = parseFloat(form.totalCost)
    addMasterItem({
      id: `cm-${crypto.randomUUID()}`, fy: activeFy || '2025-26', plant: activePlant,
      head: form.head, department: form.department.trim(), subParticulars: form.subParticulars.trim(),
      rate: isNaN(rate) ? 0 : rate, totalCost: isNaN(totalCost) ? 0 : totalCost,
    })
    setForm(BLANK_FORM); setShowAddForm(false)
  }

  let rowNum = 0

  return (
    <div className="p-6 h-full flex flex-col gap-4">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">CAPEX Master</h1>
          <p className="text-sm text-slate-400 mt-0.5">Annual budget plan — {activeFy}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-500 mr-1">FY</label>
          <select
            value={activeFy}
            onChange={e => setSelectedFy(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {allFys.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
          <button
            onClick={() => setShowFyModal(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> New FY
          </button>
          {activePlant && (
            <button
              onClick={() => setShowAddForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Item
            </button>
          )}
        </div>
      </div>

      {/* ── FY clone banner ─────────────────────────────────────────────────── */}
      {showFyModal && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 shrink-0">
          <p className="text-sm font-medium text-amber-900 shrink-0">Clone all items to new FY:</p>
          <input value={newFyInput} onChange={e => setNewFyInput(e.target.value)} placeholder="e.g. 2026-27"
            className="text-sm border border-amber-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 w-36" />
          <button onClick={handleCloneFY} disabled={!newFyInput.trim()}
            className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg">
            Clone
          </button>
          <button onClick={() => setShowFyModal(false)} className="p-1.5 text-slate-400 hover:text-slate-700 rounded ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Add-item form ───────────────────────────────────────────────────── */}
      {showAddForm && activePlant && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shrink-0">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
            New Item — {plantLabel(activePlant)} · FY {activeFy}
          </p>
          <div className="grid grid-cols-5 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium">Head</label>
              <select value={form.head} onChange={e => setForm(f => ({ ...f, head: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                {activeHeads.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">Department</label>
              <input type="text" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                placeholder="e.g. HEX"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 font-medium">Sub Particulars</label>
              <input type="text" value={form.subParticulars} onChange={e => setForm(f => ({ ...f, subParticulars: e.target.value }))}
                placeholder="Item description"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 font-medium">Rate</label>
                <input type="number" step="0.01" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium">Total (Cr)</label>
                <input type="number" step="0.01" value={form.totalCost} onChange={e => setForm(f => ({ ...f, totalCost: e.target.value }))}
                  placeholder="0.00"
                  className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddItem} disabled={!form.subParticulars.trim()}
              className="px-4 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg">Add</button>
            <button onClick={() => { setShowAddForm(false); setForm(BLANK_FORM) }}
              className="px-4 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Main body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 gap-4">

        {/* ── Left: plant cards ─────────────────────────────────────────────── */}
        <div className="w-52 shrink-0 flex flex-col gap-2 overflow-y-auto">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest px-1 mb-1">Plants</p>
          {plantsWithData.length === 0 && <p className="text-sm text-slate-400 px-1">No data for this FY.</p>}
          {plantsWithData.map(plant => {
            const { total, count } = plantStat(plant.value)
            const active = activePlant === plant.value
            return (
              <button
                key={plant.value}
                onClick={() => { setSelectedPlant(plant.value); setShowAddForm(false) }}
                aria-pressed={active}
                className={[
                  'w-full text-left rounded-xl border px-4 py-3.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                  active ? 'bg-amber-500 border-amber-500 shadow-md' : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-sm',
                ].join(' ')}
              >
                <div className="flex items-start gap-2.5">
                  <Building2 className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-white/80' : 'text-slate-400'}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className={`text-[13px] font-semibold leading-tight truncate ${active ? 'text-white' : 'text-slate-800'}`}>{plant.label}</p>
                    <p className={`text-[11px] mt-0.5 ${active ? 'text-amber-100' : 'text-slate-400'}`}>{plant.state}</p>
                    <p className={`text-[15px] font-black mt-2.5 font-mono ${active ? 'text-white' : 'text-amber-600'}`}>₹{total.toFixed(2)} Cr</p>
                    <p className={`text-[11px] ${active ? 'text-amber-100' : 'text-slate-400'}`}>{count} line items</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Right: table area ─────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {!activePlant ? (
            <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
              Select a plant to view its CAPEX plan
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
                        {items.map(item => {
                          rowNum++
                          const isEditing = editingId === item.id
                          return (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-100 border-l-4 ${s.border} ${s.row} hover:brightness-95 transition-all`}
                            >
                              <td className="pl-3 pr-3 py-2.5 text-[11px] text-slate-300 font-medium text-right tabular-nums">
                                {rowNum}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>
                                  {head}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-[12px] text-slate-500">
                                {item.department || <span className="text-slate-300">—</span>}
                              </td>
                              <td className="px-3 py-2.5 text-[13px] text-slate-800 font-medium leading-snug">
                                {item.subParticulars}
                              </td>
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
                              {/* Req. No. — linked requests */}
                              <td className="px-3 py-2.5">
                                {(() => {
                                  const linked = reqsByMasterItem.get(item.id)
                                  if (!linked?.length) return <span className="text-slate-300 text-[11px]">—</span>
                                  return (
                                    <div className="flex flex-col gap-1">
                                      {linked.map(req => (
                                        <Link
                                          key={req.id}
                                          href={`/capex/${req.id}`}
                                          className="inline-block text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded hover:bg-amber-100 transition-colors"
                                        >
                                          {req.requestNo ?? req.id.slice(0, 8)}
                                        </Link>
                                      ))}
                                    </div>
                                  )
                                })()}
                              </td>
                              {/* Sourcing member */}
                              <td className="px-3 py-2.5">
                                {(() => {
                                  const linked = reqsByMasterItem.get(item.id)
                                  if (!linked?.length) return <span className="text-slate-300 text-[11px]">—</span>
                                  const names = [...new Set(linked.map(r => ROLE_NAMES[r.assignedTo] ?? r.assignedTo))]
                                  return (
                                    <span className="text-[11px] text-slate-600 font-medium">{names.join(', ')}</span>
                                  )
                                })()}
                              </td>
                              <td className="px-2 py-2.5 text-center">
                                {isEditing ? (
                                  <button onClick={() => saveEdit(item.id)} aria-label="Save changes"
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
                    <tr className="bg-slate-900">
                      <td colSpan={7} className="pl-5 pr-4 py-3.5 text-[12px] font-bold text-slate-400 uppercase tracking-wider">
                        {plantLabel(activePlant)} — Grand Total
                        <span className="ml-2 text-slate-600 font-normal normal-case tracking-normal text-[11px]">
                          ({plantItems.length} items)
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right text-[17px] font-black text-amber-400 font-mono">
                        ₹{grandTotal.toFixed(2)} Cr
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
