'use client'

import { useState } from 'react'
import { Mail, Send, Copy, Check, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

/**
 * Preview + simulated send of a notification email. The app has no email backend, so "sending" just
 * fires `onSend(to)` (the caller toasts + advances the flow). The recipient is pre-filled but
 * editable; subject/body are read-only previews. When a `link` is provided (e.g. a plant-head
 * approval link), it renders a copyable URL row so the client can see the emailed link layout.
 */
export function EmailPreviewModal({
  open,
  onClose,
  title = 'Email Preview',
  defaultTo,
  subject,
  body,
  link,
  linkLabel = 'Link',
  sendLabel = 'Send email',
  onSend,
}: {
  open: boolean
  onClose: () => void
  title?: string
  defaultTo: string
  subject: string
  body: string
  link?: string
  linkLabel?: string
  sendLabel?: string
  onSend: (to: string) => void
}) {
  const [to, setTo] = useState(defaultTo)
  const [copied, setCopied] = useState(false)

  const copyLink = () => {
    if (!link) return
    navigator.clipboard?.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-700" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="email-to" className="block text-[11px] font-semibold text-muted-foreground mb-1">To</label>
            <input
              id="email-to"
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">Subject</p>
            <p className="text-sm font-semibold text-foreground border border-border rounded-lg px-2.5 py-1.5 bg-muted/30 break-words">{subject}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">Message</p>
            <pre className="text-xs text-foreground whitespace-pre-wrap font-sans border border-border rounded-lg px-3 py-2 bg-muted/20 max-h-72 overflow-y-auto">{body}</pre>
          </div>
          {link && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-1">{linkLabel}</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={e => e.currentTarget.select()}
                  className="flex-1 text-xs font-mono border border-border rounded-lg px-2.5 py-1.5 bg-muted/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <button
                  onClick={copyLink}
                  className="px-2.5 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 inline-flex items-center gap-1.5 shrink-0 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                <ExternalLink className="w-3 h-3" /> Open link
              </a>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold border border-border rounded-lg bg-card hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => { if (to.trim()) onSend(to.trim()) }}
            disabled={!to.trim()}
            className="px-3 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-800 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card"
          >
            <Send className="w-3.5 h-3.5" /> {sendLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
