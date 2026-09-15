'use client'

import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { GreenFieldPlantCreation, ProjectType } from '@/lib/types'
import { PROJECT_TYPE_LABELS } from '@/lib/greenFieldConstants'
import { currentFyCode } from '@/lib/budgetProposalUtils'

/** Slugify a plant name into the stable `value` every plant is keyed by across the portal. */
export function plantSlug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

interface CreatePlantProps {
  projectType: ProjectType
  /** Every plant value already taken — `addCustomPlant` dedupes SILENTLY, so collisions are
      caught here instead of appearing to succeed and doing nothing. */
  existingPlants: string[]
  /** Pre-select the FY the caller is looking at; defaults to the current one. */
  defaultFy?: string
  /** What happens after creation, in the caller's words. */
  subtitle?: string
  ctaLabel?: string
  onClose: () => void
  onCreate: (creation: GreenFieldPlantCreation) => void
}

/**
 * Step 1 of the Green Field flow: register the site on CAPEX Master. Deliberately carries **no
 * budget field** — the budget is authored in Budget Planning as the uploaded hierarchy (plant →
 * section → head → machine) and published through the approval chain, so a figure typed here would
 * be overwritten by the first publish anyway.
 */
export default function CreateGreenFieldPlantModal({
  projectType, existingPlants, defaultFy, subtitle, ctaLabel, onClose, onCreate,
}: CreatePlantProps) {
  const [label, setLabel] = useState('')
  const [state, setState] = useState('')
  const [assignedUser, setAssignedUser] = useState('')
  const [fy, setFy] = useState(defaultFy?.trim() || currentFyCode())

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
      // No budgetCr — the envelope comes from the budget uploaded in Budget Planning.
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
              {subtitle ?? `${PROJECT_TYPE_LABELS[projectType]} · its budget is uploaded in Budget Planning.`}
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
            {ctaLabel ?? 'Create Plant'}
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
