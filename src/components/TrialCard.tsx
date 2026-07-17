'use client'

import { useRef, useState } from 'react'
import { FlaskConical, Upload, CheckCircle2, XCircle, Download, Loader2 } from 'lucide-react'
import type { TrialStatus, TrialSubmission, TrialMessage } from '@/lib/types'
import { TRIAL_STATUS_LABELS, TRIAL_STATUS_COLORS } from '@/lib/trialUtils'

const MAX_TRIAL_BYTES = 5 * 1024 * 1024 // 5 MB cap for trial media

function trialKind(mime: string): TrialSubmission['kind'] {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('image/')) return 'photo'
  return 'report'
}

/**
 * Trial (QA) card. `mode='upload'` renders the vendor's trial upload form (supplier portal);
 * `mode='review'` renders sourcing's approve/reject panel + submission preview + thread history.
 */
export function TrialCard({
  mode,
  status,
  submission,
  thread,
  onUpload,
  onApprove,
  onReject,
  className = '',
}: {
  mode: 'upload' | 'review'
  status: TrialStatus
  submission?: TrialSubmission
  thread?: TrialMessage[]
  onUpload?: (submission: TrialSubmission) => void
  onApprove?: () => void
  onReject?: (message?: string) => void
  className?: string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; base64: string; mimeType: string } | null>(null)
  const [note, setNote] = useState('')
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const readFile = (f: File) => {
    setError('')
    if (f.size > MAX_TRIAL_BYTES) {
      setError('File is too large (max 5 MB). Please upload a smaller clip / photo / report.')
      return
    }
    setBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      setFile({ name: f.name, base64: String(reader.result || ''), mimeType: f.type || 'application/octet-stream' })
      setBusy(false)
    }
    reader.onerror = () => { setError('Could not read the file.'); setBusy(false) }
    reader.readAsDataURL(f)
  }

  const submit = () => {
    if (!file || !onUpload) return
    onUpload({
      id: `trial-${Date.now()}`,
      name: file.name,
      base64: file.base64,
      mimeType: file.mimeType,
      uploadedAt: new Date().toISOString(),
      kind: trialKind(file.mimeType),
      note: note.trim() || undefined,
    })
    setFile(null)
    setNote('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-blue-700" />
          <h3 className="text-sm font-bold text-foreground">Item Trial</h3>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TRIAL_STATUS_COLORS[status]}`}>
          {TRIAL_STATUS_LABELS[status]}
        </span>
      </div>

      {/* Current submission preview (both modes) */}
      {submission?.base64 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{submission.name}</p>
            {submission.note && <p className="text-xs text-muted-foreground truncate">{submission.note}</p>}
          </div>
          <a
            href={submission.base64}
            download={submission.name}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:underline"
          >
            <Download className="w-3.5 h-3.5" /> Download
          </a>
        </div>
      )}

      {mode === 'upload' && status !== 'approved' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {status === 'rejected'
              ? 'Your previous trial was not approved. Please upload an updated video / photo / report.'
              : 'Upload a trial video, photo, or inspection report of the item for sourcing to review.'}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="video/*,image/*,.pdf,application/pdf"
            onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f) }}
            className="block w-full text-xs text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3 file:py-1.5 file:text-white file:font-semibold hover:file:bg-blue-800"
          />
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note for sourcing…"
            rows={2}
            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={submit}
            disabled={!file || busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Submit Trial
          </button>
        </div>
      )}

      {mode === 'upload' && status === 'approved' && (
        <p className="text-sm text-emerald-700 font-medium">Trial approved by sourcing. The final payment can now proceed.</p>
      )}

      {mode === 'review' && status === 'pending_review' && (
        <div className="space-y-2">
          <input
            value={rejectNote}
            onChange={e => setRejectNote(e.target.value)}
            placeholder="Reason (if rejecting)…"
            className="w-full text-sm border border-border rounded-lg px-2.5 py-1.5 bg-card focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => onApprove?.()}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm"
            >
              <CheckCircle2 className="w-4 h-4" /> Approve Trial
            </button>
            <button
              onClick={() => onReject?.(rejectNote.trim() || undefined)}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50 font-semibold text-sm"
            >
              <XCircle className="w-4 h-4" /> Reject Trial
            </button>
          </div>
        </div>
      )}

      {mode === 'review' && status === 'pending_upload' && (
        <p className="text-sm text-muted-foreground">Waiting for the vendor to upload the trial.</p>
      )}
      {mode === 'review' && status === 'rejected' && (
        <p className="text-sm text-amber-700 font-medium">Trial rejected — awaiting the vendor to re-upload.</p>
      )}
      {mode === 'review' && status === 'approved' && (
        <p className="text-sm text-emerald-700 font-medium">Trial approved — final payment is unblocked.</p>
      )}

      {/* Thread history */}
      {thread && thread.length > 0 && (
        <div className="mt-3 border-t border-border pt-2 space-y-1">
          {thread.slice(-4).map((m) => (
            <div key={m.id} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground capitalize">{m.by}</span>{' '}
              {m.action}
              {m.message ? `: ${m.message}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
