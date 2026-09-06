'use client'

import { Paperclip } from 'lucide-react'
import type { QuoteLineDocument } from '@/lib/types'
import { formatDocSize, lineDocumentHref } from '@/lib/quoteDocuments'

/**
 * The INTERNAL, read-only view of one per-line vendor document — a compact download chip that sits
 * inside a comparison-grid cell (`RfqPanel`, `VendorGrid`) or a quotation line (`RequestQuotationView`).
 *
 * Renders `null` when there is no document, so a grid of twenty lines where two carry a datasheet
 * shows two chips rather than eighteen dashes.
 *
 * When the blob has not been hydrated back from IndexedDB yet it shows the filename WITHOUT a link
 * — the same rule the supplier-side cell follows. A chip that looks clickable and downloads an
 * empty file is worse than one that plainly says "here is the name, not yet loaded".
 */
export function QuoteLineDocLink({
  doc,
  className = '',
}: {
  doc?: QuoteLineDocument
  className?: string
}) {
  if (!doc) return null
  const href = lineDocumentHref(doc)
  const size = formatDocSize(doc.size)
  const title = size ? `${doc.name} · ${size}` : doc.name
  const base = `inline-flex items-center gap-1 max-w-full text-[10px] font-semibold ${className}`

  if (!href) {
    return (
      <span className={`${base} text-slate-400`} title={title}>
        <Paperclip className="w-3 h-3 shrink-0" />
        <span className="truncate">{doc.name}</span>
      </span>
    )
  }
  return (
    <a
      href={href}
      download={doc.name}
      title={title}
      onClick={e => e.stopPropagation()}
      className={`${base} text-blue-700 hover:underline`}
    >
      <Paperclip className="w-3 h-3 shrink-0" />
      <span className="truncate">{doc.name}</span>
    </a>
  )
}
