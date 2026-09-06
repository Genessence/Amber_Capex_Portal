'use client'

import { MAX_REMARK_LENGTH } from '@/lib/approvalRemarks'

/**
 * The ONE remark input used by every approval / handoff surface — the tokenised public pages
 * (plant head, Technical team, Plant Accounts, Global Accounts) and the internal ones (budget
 * approvals, sending a spec). One component means one set of semantics everywhere: the same label
 * treatment, the same required marker, the same length cap as the sanitizer that stores it.
 *
 * `required` only drives the affordance (the red asterisk + the hint); the CALLER still gates its
 * own submit button, and the mutation still refuses an empty remark. A field that merely *looks*
 * required is not a validation layer.
 */
export function RemarkField({
  id,
  label = 'Remarks',
  value,
  onChange,
  required = false,
  placeholder,
  hint,
  rows = 3,
  autoFocus = false,
  disabled = false,
}: {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  /** Show the required marker + hint. Does NOT enforce — the caller disables its own action. */
  required?: boolean
  placeholder?: string
  /** Overrides the default hint under the field. */
  hint?: string
  rows?: number
  autoFocus?: boolean
  disabled?: boolean
}) {
  const remaining = MAX_REMARK_LENGTH - value.length
  const nearLimit = remaining <= 100
  const defaultHint = required
    ? 'A remark is required so the next person knows what to act on.'
    : 'Optional — anything you write here is shown to everyone who acts on this next.'

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label} {required && <span className="text-red-600">*</span>}
        </label>
        {nearLimit && (
          <span
            className={`text-[11px] tabular-nums ${remaining < 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}
            aria-live="polite"
          >
            {remaining} characters left
          </span>
        )}
      </div>
      <textarea
        id={id}
        rows={rows}
        value={value}
        // Hard-capped here as well as in `sanitizeRemarkText` — the sanitizer truncates silently,
        // and silently losing the end of someone's reasoning is worse than refusing the keystroke.
        maxLength={MAX_REMARK_LENGTH}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-required={required}
        className="mt-1 w-full text-sm border border-border rounded-lg px-2.5 py-2 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <p className="mt-1 text-[11px] text-muted-foreground">{hint ?? defaultHint}</p>
    </div>
  )
}
