'use client'

import { useId, useRef, useState } from 'react'
import { Download, Paperclip, Upload, X } from 'lucide-react'
import type { QuoteLineDocument } from '@/lib/types'
import {
  LINE_DOC_ACCEPT,
  formatDocSize,
  lineDocumentHref,
  readQuoteLineDocument,
} from '@/lib/quoteDocuments'

/**
 * The per-line-item document control on the supplier's quotation — ONE implementation shared by the
 * desktop table (`SupplierQuoteTable`) and the mobile cards (`SupplierQuoteCards`).
 *
 * That sharing is the point: this codebase has repeatedly shipped a desktop/mobile pair where one
 * half got a fix and the other did not. File picking, the size cap, the error message and the
 * download affordance all live here, so the two layouts cannot drift.
 *
 * READ mode renders a download link — or, when the blob has not been hydrated from IndexedDB yet,
 * a non-interactive filename. It never renders an anchor with no href.
 */
export function LineDocumentCell({
  itemLabel,
  doc,
  onChange,
  readOnly = false,
  uploadedBy,
  compact = false,
}: {
  /** Line-item description — used for the accessible label, so 20 identical "Attach" inputs differ. */
  itemLabel: string
  doc?: QuoteLineDocument
  /** `null` clears the document. Omitted in read mode. */
  onChange?: (doc: QuoteLineDocument | null) => void
  readOnly?: boolean
  /** Vendor display name stamped on the upload. */
  uploadedBy?: string
  /** Tighter type scale for the desktop table cell. */
  compact?: boolean
}) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const href = lineDocumentHref(doc)
  const size = formatDocSize(doc?.size)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset immediately so re-picking the SAME file after an error still fires a change event.
    e.target.value = ''
    if (!file) return
    setBusy(true)
    const result = await readQuoteLineDocument(file, uploadedBy)
    setBusy(false)
    if (result.error || !result.doc) {
      setError(result.error ?? 'Could not read that file — please try again')
      return
    }
    setError('')
    onChange?.(result.doc)
  }

  if (readOnly || !onChange) {
    if (!doc) return <span className={`${compact ? 'text-xs' : 'text-sm'} text-slate-300`}>—</span>
    return href ? (
      <a
        href={href}
        download={doc.name}
        className={`inline-flex items-center gap-1.5 max-w-full ${compact ? 'text-xs' : 'text-sm'} text-[#2563EB] font-semibold hover:underline`}
        title={doc.name}
      >
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{doc.name}</span>
        <Download className="w-3.5 h-3.5 shrink-0" />
      </a>
    ) : (
      // Blob not hydrated from IndexedDB yet — show the filename, never a dead link.
      <span className={`inline-flex items-center gap-1.5 max-w-full ${compact ? 'text-xs' : 'text-sm'} text-slate-500`} title={doc.name}>
        <Paperclip className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{doc.name}</span>
      </span>
    )
  }

  return (
    <div className="min-w-0">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={LINE_DOC_ACCEPT}
        onChange={handleFile}
        className="sr-only"
        aria-label={`Attach a supporting document for ${itemLabel}`}
      />
      {doc ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <Paperclip className="w-3.5 h-3.5 shrink-0 text-slate-400" />
          <span className="truncate text-xs text-slate-700 flex-1 min-w-0" title={doc.name}>
            {doc.name}
            {size && <span className="text-slate-400"> · {size}</span>}
          </span>
          <button
            type="button"
            onClick={() => { setError(''); onChange(null) }}
            aria-label={`Remove the document attached to ${itemLabel}`}
            className="shrink-0 p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 min-h-[44px] w-full justify-center px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30"
        >
          <Upload className="w-3.5 h-3.5" /> {busy ? 'Reading…' : 'Attach'}
        </button>
      )}
      {error && (
        <p className="mt-1 text-[10px] text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
