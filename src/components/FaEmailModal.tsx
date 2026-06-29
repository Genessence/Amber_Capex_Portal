'use client'

import { useState } from 'react'
import { Mail, Send } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

/**
 * Preview + simulated send of the FA-code notification email. The app has no email backend, so
 * "sending" just fires `onSend(to)` (the caller toasts + advances the flow). The recipient is
 * pre-filled but editable; the subject and body are read-only previews of the formatted email.
 */
export function FaEmailModal({
  open,
  onClose,
  defaultTo,
  subject,
  body,
  onSend,
}: {
  open: boolean
  onClose: () => void
  defaultTo: string
  subject: string
  body: string
  onSend: (to: string) => void
}) {
  const [to, setTo] = useState(defaultTo)

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-teal-700" /> FA Codes — Email Preview
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="fa-email-to" className="block text-[11px] font-semibold text-muted-foreground mb-1">To</label>
            <input
              id="fa-email-to"
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
            className="px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-card"
          >
            <Send className="w-3.5 h-3.5" /> Send email
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
